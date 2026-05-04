'use strict';
/**
 * Contracts — Agreement Templates + Partner Signing
 *
 * Authenticated routes (session or internal key):
 *   GET    /api/contracts/templates        — list all templates
 *   POST   /api/contracts/templates        — create template
 *   PATCH  /api/contracts/templates/:id    — update template
 *   DELETE /api/contracts/templates/:id    — delete template
 *   GET    /api/contracts/agreements       — list all agreements
 *   POST   /api/contracts/agreements/send  — create + send agreement to partner
 *   GET    /api/contracts/agreements/:id   — get single agreement
 *
 * Public routes (no auth — partner access):
 *   GET  /sign/:token    — signing page HTML
 *   POST /api/contracts/sign/:token  — submit signature
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');
const logger  = require('../utils/logger');

// ── Auth: session OR internal API key (same pattern as blog.js) ───────────
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  const key = req.headers['x-internal-key'];
  if (key && key === process.env.INTERNAL_API_KEY) return next();
  res.status(401).json({ ok: false, error: 'Not authenticated' });
}

// ── MailerSend email helper ────────────────────────────────────────────────
async function sendMailerSend(to, toName, subject, html) {
  const apiKey   = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'jason@7kinhomestead.com';
  const fromName  = process.env.MAILERSEND_FROM_NAME  || 'Jason | 7 Kin Homestead';

  if (!apiKey) {
    logger.warn('[contracts] MAILERSEND_API_KEY not set — skipping email send');
    return { skipped: true };
  }

  const body = {
    from: { email: fromEmail, name: fromName },
    to:   [{ email: to, name: toName || to }],
    subject,
    html,
  };

  const res = await fetch('https://api.mailersend.com/v1/email', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    logger.error({ status: res.status, body: txt }, '[contracts] MailerSend send failed');
    throw new Error(`MailerSend error ${res.status}: ${txt}`);
  }

  return { ok: true };
}

// ── Template variable replacement ─────────────────────────────────────────
// Empty / missing values are intentionally left as {{variable}} so the signing
// page can detect them and present them as signer-fillable input fields.
function renderTemplate(bodyTemplate, variables) {
  let rendered = bodyTemplate;
  for (const [key, val] of Object.entries(variables || {})) {
    if (val === undefined || val === null || val === '') continue; // preserve placeholder
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(re, val);
  }
  return rendered;
}

// ── Signing page HTML builder ──────────────────────────────────────────────
function buildSigningPage({ status, agreement, errorMsg }) {
  const bodyContent = (() => {
    if (errorMsg) {
      return `<div class="msg-wrap"><div class="msg error">${errorMsg}</div></div>`;
    }
    if (status === 'not_found') {
      return `<div class="msg-wrap"><div class="msg error">Agreement not found. This link may be invalid or expired.</div></div>`;
    }
    if (status === 'already_signed') {
      const date = agreement.signed_at
        ? new Date(agreement.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'a previous date';
      return `<div class="msg-wrap"><div class="msg success">&#10003; This agreement was signed on ${date}.</div></div>`;
    }
    if (status === 'success') {
      return `<div class="msg-wrap"><div class="msg success">&#10003; Signed! A copy has been emailed to you.</div></div>`;
    }
    // status === 'pending' — show the signing form
    // Detect any {{variable}} placeholders remaining in body_snapshot — these are
    // signer-fillable fields that Jason left blank when sending.
    const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
    const rawBody = agreement.body_snapshot || '';
    const signerVars = [...new Set([...rawBody.matchAll(PLACEHOLDER_RE)].map(m => m[1]))];

    // Render body with placeholders highlighted (styled spans the JS will update live)
    const bodyHtml = rawBody
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g,
        '<span class="ph" data-key="$1">{{$1}}</span>')
      .replace(/\n/g, '<br>');

    // Build signer-fillable fields section (only shown if there are remaining vars)
    const toLabel = k => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const signerFieldsHtml = signerVars.length > 0 ? `
      <div class="signer-fields">
        <div class="sf-heading">Complete your details before signing</div>
        <div class="sf-grid">
          ${signerVars.map(v => `
          <div class="field">
            <label for="sf-${v}">${toLabel(v)}</label>
            <input type="text" id="sf-${v}" class="sf-input" data-key="${v}"
              placeholder="${toLabel(v)}" oninput="updatePreview(this)">
          </div>`).join('')}
        </div>
      </div>` : '';

    return `
      <div class="title-block">
        <div class="doc-eyebrow">For Signature</div>
        <div class="doc-title">${agreement.partner_name || 'Partner'} Agreement</div>
      </div>
      ${signerFieldsHtml}
      <div class="agreement-body" id="agreement-body">${bodyHtml}</div>
      <div class="attest">
        <div class="attest-title">Electronic Signature</div>
        <div class="name-field">
          <label for="signer-name">Full Legal Name</label>
          <input type="text" id="signer-name" placeholder="Your full legal name" required autocomplete="name">
        </div>
        <label class="checkbox-label">
          <input type="checkbox" id="esign-check">
          I consent to conduct this transaction using electronic records and electronic signatures, as permitted under the U.S. Electronic Signatures in Global and National Commerce Act (ESIGN) and applicable state law.
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="agree-check">
          I have read, understand, and agree to all terms of this agreement.
        </label>
        <button class="btn-sign" onclick="submitSignature()">Sign Agreement</button>
        <div id="sign-error" class="sign-error" style="display:none"></div>
      </div>
      <script>
        // Live preview — update {{placeholder}} spans as signer types
        function updatePreview(input) {
          const key = input.dataset.key;
          const val = input.value.trim();
          document.querySelectorAll('.ph[data-key="' + key + '"]').forEach(el => {
            el.textContent = val || ('{{' + key + '}}');
            el.classList.toggle('ph-filled', !!val);
          });
        }

        async function submitSignature() {
          const name       = document.getElementById('signer-name').value.trim();
          const esignCheck = document.getElementById('esign-check').checked;
          const agreeCheck = document.getElementById('agree-check').checked;
          const errEl      = document.getElementById('sign-error');
          errEl.style.display = 'none';
          if (!name)       { errEl.textContent = 'Please enter your full legal name.'; errEl.style.display = ''; return; }
          if (!esignCheck) { errEl.textContent = 'You must consent to electronic signature to proceed.'; errEl.style.display = ''; return; }
          if (!agreeCheck) { errEl.textContent = 'You must confirm you have read and agree to the terms.'; errEl.style.display = ''; return; }

          // Validate all signer-fillable fields are filled
          const sfInputs = document.querySelectorAll('.sf-input');
          const emptyFields = [...sfInputs].filter(el => !el.value.trim());
          if (emptyFields.length > 0) {
            emptyFields[0].focus();
            errEl.textContent = 'Please fill in all required fields before signing.';
            errEl.style.display = '';
            return;
          }

          // Collect signer field values
          const signerFields = {};
          sfInputs.forEach(el => { signerFields[el.dataset.key] = el.value.trim(); });

          const btn = document.querySelector('.btn-sign');
          btn.disabled = true; btn.textContent = 'Signing…';
          try {
            const res = await fetch(location.pathname.replace('/sign/', '/api/contracts/sign/'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                signer_name:   name,
                signer_fields: signerFields,
                user_agent:    navigator.userAgent
              })
            });
            const data = await res.json();
            if (data.ok) {
              document.querySelector('.sig-section').innerHTML = '<div class="msg success">&#10003; Signed! A copy has been emailed to you.</div>';
            } else {
              errEl.textContent = data.error || 'Signing failed. Please try again.';
              errEl.style.display = '';
              btn.disabled = false; btn.textContent = 'Sign Agreement';
            }
          } catch (_) {
            errEl.textContent = 'Network error. Please try again.';
            errEl.style.display = '';
            btn.disabled = false; btn.textContent = 'Sign Agreement';
          }
        }
      </script>`;
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Partnership Agreement — 7 Kin Homestead</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --accent:#14b8a6;--accent-wash:rgba(20,184,166,.07);--accent-rule:rgba(20,184,166,.25);
  --ink:#0a0a0a;--ink-2:#2a2a2a;--ink-muted:#6b6b6b;--ink-faint:#9a9a9a;
  --rule:#d8d8d8;--paper:#fff;--bg:#eceae6;
  --amber:#f59e0b;--red:#dc2626;--green:#16a34a;
  --f-display:'Bebas Neue','Impact',sans-serif;
  --f-body:'DM Sans',-apple-system,Segoe UI,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{background:var(--bg);}
body{font-family:var(--f-body);font-weight:300;color:var(--ink);line-height:1.55;
     -webkit-font-smoothing:antialiased;padding:40px 16px 80px;}

/* ── Document shell ── */
.sheet{width:100%;max-width:780px;margin:0 auto;background:var(--paper);
       box-shadow:0 10px 30px rgba(0,0,0,.08);display:flex;flex-direction:column;}

/* ── Header / letterhead ── */
.head{display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:end;
      padding:0.6in 0.75in 14px;border-bottom:2px solid var(--accent);}
.head-logo{width:68px;height:68px;display:flex;align-items:center;justify-content:center;
           background:var(--accent-wash);border:1px solid var(--accent-rule);border-radius:4px;
           overflow:hidden;flex-shrink:0;}
.head-logo img{width:100%;height:100%;object-fit:contain;padding:6px;}
.head-id{display:flex;flex-direction:column;gap:3px;}
.head-eyebrow{font-family:var(--f-display);font-size:10px;letter-spacing:.32em;color:var(--accent);}
.head-org{font-family:var(--f-display);font-size:26px;letter-spacing:.03em;color:var(--ink);}
.head-doctype{font-family:var(--f-display);font-size:13px;letter-spacing:.22em;color:var(--ink-muted);}
.head-meta{display:flex;flex-direction:column;gap:4px;align-items:flex-end;min-width:140px;}
.head-meta-row{font-family:var(--f-display);font-size:10px;letter-spacing:.15em;color:var(--ink-muted);}
.head-meta-row span{color:var(--ink-2);}

/* ── Title block ── */
.title-block{padding:18px 0.75in 14px;border-bottom:1px solid var(--rule);}
.doc-eyebrow{font-family:var(--f-display);font-size:10px;letter-spacing:.28em;color:var(--accent);margin-bottom:4px;}
.doc-title{font-family:var(--f-display);font-size:30px;letter-spacing:.02em;color:var(--ink);}

/* ── Signer-fillable fields ── */
.signer-fields{padding:18px 0.75in;background:#fffbeb;border-bottom:1px solid #fde68a;}
.sf-heading{font-family:var(--f-display);font-size:11px;letter-spacing:.22em;color:var(--amber);margin-bottom:14px;}
.sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.field{display:flex;flex-direction:column;gap:4px;}
.field label{font-family:var(--f-display);font-size:9px;letter-spacing:.22em;color:var(--ink-muted);}
.field input{background:var(--paper);border:1px solid var(--rule);border-radius:3px;
             padding:8px 11px;color:var(--ink);font-size:13px;font-family:var(--f-body);
             transition:border-color .15s;}
.field input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-wash);}

/* ── Agreement body ── */
.agreement-body{
  padding:24px 0.75in;line-height:1.75;font-size:13.5px;color:var(--ink-2);
  white-space:pre-wrap;font-family:var(--f-body);font-weight:300;
  max-height:55vh;overflow-y:auto;border-bottom:1px solid var(--rule);
  background:var(--paper);
}
.agreement-body::-webkit-scrollbar{width:4px;}
.agreement-body::-webkit-scrollbar-track{background:transparent;}
.agreement-body::-webkit-scrollbar-thumb{background:var(--rule);border-radius:4px;}

/* ── Attestation / signature section ── */
.attest{padding:22px 0.75in 28px;border-bottom:1px solid var(--rule);}
.attest-title{font-family:var(--f-display);font-size:12px;letter-spacing:.22em;color:var(--ink-2);margin-bottom:16px;}
.name-field{display:flex;flex-direction:column;gap:4px;margin-bottom:18px;}
.name-field label{font-family:var(--f-display);font-size:9px;letter-spacing:.22em;color:var(--ink-muted);}
.name-field input{background:var(--paper);border:1px solid var(--rule);border-radius:3px;
                  padding:9px 12px;color:var(--ink);font-size:14px;font-family:var(--f-body);
                  transition:border-color .15s;}
.name-field input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-wash);}
.checkbox-label{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;cursor:pointer;
                margin-bottom:10px;line-height:1.6;color:var(--ink-2);
                padding:10px 12px;border:1px solid var(--rule);border-radius:3px;background:#f9f9f9;
                transition:border-color .15s,background .15s;}
.checkbox-label:has(input:checked){border-color:var(--accent);background:var(--accent-wash);}
.checkbox-label input{margin-top:2px;accent-color:var(--accent);width:14px;height:14px;flex-shrink:0;}
.btn-sign{width:100%;margin-top:16px;padding:13px;background:var(--accent);border:none;border-radius:3px;
          font-family:var(--f-display);font-size:16px;letter-spacing:.12em;color:#fff;
          cursor:pointer;transition:background .15s,opacity .15s;}
.btn-sign:hover{background:#0ea098;}
.btn-sign:disabled{opacity:.4;cursor:not-allowed;}
.sign-error{background:#fef2f2;border:1px solid #fecaca;border-radius:3px;
            padding:9px 12px;font-size:12px;color:var(--red);margin-top:10px;}

/* ── Footer ── */
.foot{padding:12px 0.75in 0.5in;display:flex;justify-content:space-between;
      font-family:var(--f-display);font-size:9px;letter-spacing:.12em;
      text-transform:uppercase;color:var(--ink-faint);}

/* ── Status messages ── */
.msg-wrap{padding:0.75in;}
.msg{padding:24px 28px;border-radius:4px;font-family:var(--f-display);font-size:18px;
     letter-spacing:.04em;text-align:center;}
.msg.success{background:#f0fdf4;border:1px solid #bbf7d0;color:var(--green);}
.msg.error{background:#fef2f2;border:1px solid #fecaca;color:var(--red);}

/* ── Placeholder highlights in body ── */
.ph{background:rgba(245,158,11,.14);color:#92400e;border-radius:2px;padding:0 3px;
    font-weight:500;border-bottom:1.5px dashed var(--amber);transition:all .2s;}
.ph.ph-filled{background:var(--accent-wash);color:#0f766e;border-bottom-color:var(--accent);}

@media(max-width:600px){
  body{padding:0 0 60px;}
  .sheet{box-shadow:none;}
  .head,.title-block,.signer-fields,.agreement-body,.attest,.foot{padding-left:20px;padding-right:20px;}
  .head{grid-template-columns:auto 1fr;padding-top:24px;}
  .head-meta{display:none;}
}
@media print{
  body{background:#fff;padding:0;}
  .sheet{box-shadow:none;}
  .attest{display:none;}
  .foot{position:static;}
}
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div class="head-logo"><img src="/media-kit-images/logo.png" alt="7 Kin Homestead"></div>
    <div class="head-id">
      <div class="head-eyebrow">Partnership Agreement</div>
      <div class="head-org">7 Kin Homestead</div>
      <div class="head-doctype">Off-Grid · Resourceful · Rock Rich</div>
    </div>
    <div class="head-meta">
      <div class="head-meta-row">Web <span>7kinhomestead.land</span></div>
      <div class="head-meta-row">Email <span>jason@7kinhomestead.com</span></div>
    </div>
  </div>
  ${bodyContent}
  <div class="foot">
    <span>7 Kin Homestead · 7kinhomestead.land</span>
    <span>Signed electronically · ESIGN Act compliant</span>
  </div>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES — no auth required
// ─────────────────────────────────────────────────────────────────────────────

// GET /sign/:token — serve the signing page
router.get('/sign/:token', (req, res) => {
  try {
    const agreement = db.getAgreementByToken(req.params.token);
    if (!agreement) {
      return res.status(404).send(buildSigningPage({ status: 'not_found' }));
    }
    if (agreement.status === 'signed') {
      return res.send(buildSigningPage({ status: 'already_signed', agreement }));
    }
    res.send(buildSigningPage({ status: 'pending', agreement }));
  } catch (err) {
    logger.error({ err }, '[contracts] GET /sign/:token failed');
    res.status(500).send(buildSigningPage({ errorMsg: 'Server error. Please try again later.' }));
  }
});

// POST /api/contracts/sign/:token — submit signature
router.post('/api/contracts/sign/:token', async (req, res) => {
  try {
    const agreement = db.getAgreementByToken(req.params.token);
    if (!agreement) {
      return res.status(404).json({ ok: false, error: 'Agreement not found' });
    }
    if (agreement.status === 'signed') {
      return res.status(409).json({ ok: false, error: 'Already signed' });
    }

    const { signer_name, signer_fields, user_agent } = req.body;
    if (!signer_name || !signer_name.trim()) {
      return res.status(400).json({ ok: false, error: 'signer_name required' });
    }

    const signedAt  = new Date().toISOString();
    const signerIp  = req.ip || req.connection?.remoteAddress || 'unknown';
    const signerAgent = (user_agent || '').slice(0, 512); // cap length

    // Final render: fill in any signer-provided field values before locking
    let finalBody = agreement.body_snapshot || '';
    if (signer_fields && typeof signer_fields === 'object' && Object.keys(signer_fields).length > 0) {
      finalBody = renderTemplate(finalBody, signer_fields);
    }

    // Append legally-required audit trail block to the stored agreement body
    const signedDate = new Date(signedAt).toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
    });
    finalBody += `\n\n${'─'.repeat(60)}\nELECTRONIC SIGNATURE AUDIT TRAIL\n${'─'.repeat(60)}\nSigned by:    ${signer_name.trim()}\nDate/Time:    ${signedDate}\nTimestamp:    ${signedAt}\nIP Address:   ${signerIp}\nBrowser:      ${signerAgent || 'not recorded'}\nESIGN Act consent confirmed by signer at time of signing.\n${'─'.repeat(60)}`;

    db.updateAgreementBodySnapshot(agreement.id, finalBody);
    agreement.body_snapshot = finalBody; // use in confirmation emails below

    db.updateAgreementStatus(agreement.id, 'signed', signer_name.trim(), signerIp, signedAt, signerAgent);

    // Send confirmation emails (non-blocking — don't fail the sign request on email error)
    // body_snapshot already contains the full audit trail block at this point
    const agreementBodyHtml = (agreement.body_snapshot || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const partnerHtml = `
      <h2 style="color:#14b8a6">Your agreement has been signed</h2>
      <p>Hi ${signer_name.trim()},</p>
      <p>Thank you for signing the <strong>${agreement.partner_name || 'Partnership'}</strong> agreement with 7 Kin Homestead. Your electronic signature, IP address, browser, and timestamp have been recorded. The full signed agreement including audit trail is below for your records.</p>
      <hr style="border-color:#222;margin:20px 0">
      <div style="font-family:monospace;font-size:13px;white-space:pre-wrap">${agreementBodyHtml}</div>`;

    const jasonHtml = `
      <h2 style="color:#14b8a6">Agreement signed: ${agreement.partner_name}</h2>
      <p><strong>${signer_name.trim()}</strong> (${agreement.partner_email}) signed the partnership agreement. Full audit trail is embedded at the bottom of the agreement below.</p>
      <hr style="border-color:#222;margin:20px 0">
      <div style="font-family:monospace;font-size:13px;white-space:pre-wrap">${agreementBodyHtml}</div>`;

    Promise.all([
      sendMailerSend(
        agreement.partner_email, signer_name.trim(),
        `Signed: 7 Kin Homestead Partnership Agreement`, partnerHtml
      ).catch(e => logger.error({ err: e }, '[contracts] partner confirmation email failed')),
      sendMailerSend(
        'jason@7kinhomestead.com', 'Jason',
        `Agreement Signed — ${agreement.partner_name}`, jasonHtml
      ).catch(e => logger.error({ err: e }, '[contracts] jason confirmation email failed')),
    ]);

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, '[contracts] POST /api/contracts/sign/:token failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/contracts/templates
router.get('/api/contracts/templates', requireAuth, (req, res) => {
  try {
    res.json({ ok: true, templates: db.getAgreementTemplates() });
  } catch (err) {
    logger.error({ err }, '[contracts] GET templates failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/contracts/templates
router.post('/api/contracts/templates', requireAuth, (req, res) => {
  try {
    const { name, body } = req.body;
    if (!name || !body) return res.status(400).json({ ok: false, error: 'name and body required' });
    const tmpl = db.insertAgreementTemplate(name.trim(), body);
    res.json({ ok: true, template: tmpl });
  } catch (err) {
    logger.error({ err }, '[contracts] POST templates failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/contracts/templates/:id
router.patch('/api/contracts/templates/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, body } = req.body;
    if (!name || !body) return res.status(400).json({ ok: false, error: 'name and body required' });
    const tmpl = db.updateAgreementTemplate(id, name.trim(), body);
    if (!tmpl) return res.status(404).json({ ok: false, error: 'Template not found' });
    res.json({ ok: true, template: tmpl });
  } catch (err) {
    logger.error({ err }, '[contracts] PATCH templates/:id failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/contracts/templates/:id
router.delete('/api/contracts/templates/:id', requireAuth, (req, res) => {
  try {
    db.deleteAgreementTemplate(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, '[contracts] DELETE templates/:id failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/contracts/agreements
router.get('/api/contracts/agreements', requireAuth, (req, res) => {
  try {
    res.json({ ok: true, agreements: db.getAgreements() });
  } catch (err) {
    logger.error({ err }, '[contracts] GET agreements failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/contracts/agreements/send — create + send agreement
router.post('/api/contracts/agreements/send', requireAuth, async (req, res) => {
  try {
    const { template_id, partner_name, partner_email, variables } = req.body;
    if (!partner_name || !partner_email) {
      return res.status(400).json({ ok: false, error: 'partner_name and partner_email required' });
    }

    const tmpl = template_id ? db.getAgreementTemplate(parseInt(template_id)) : null;
    const rawBody = tmpl ? tmpl.body : (req.body.body || '');
    if (!rawBody) {
      return res.status(400).json({ ok: false, error: 'template_id or body required' });
    }

    // Merge partner_name into variables so {{partner_name}} always resolves
    const vars = Object.assign({ partner_name }, variables || {});
    const bodySnapshot = renderTemplate(rawBody, vars);
    const token = crypto.randomBytes(32).toString('hex');

    const agreement = db.insertAgreement(
      template_id || null, partner_name.trim(), partner_email.trim(),
      vars, bodySnapshot, token
    );
    db.markAgreementSent(agreement.id, new Date().toISOString());

    // Build the signing URL — always use the live public URL so links work
    // regardless of whether the request came from Electron (localhost) or the server.
    const liveBase   = (process.env.LIVE_API_URL || 'https://kre8r.app').replace(/\/$/, '');
    const signingUrl = `${liveBase}/sign/${token}`;

    // Email to partner
    const partnerHtml = `
      <h2 style="color:#14b8a6">Partnership Agreement — 7 Kin Homestead</h2>
      <p>Hi ${partner_name},</p>
      <p>Jason from 7 Kin Homestead has sent you a partnership agreement to review and sign.</p>
      <p style="margin:24px 0">
        <a href="${signingUrl}" style="background:#14b8a6;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          Review &amp; Sign Agreement
        </a>
      </p>
      <p style="color:#888;font-size:13px">Or copy this link: ${signingUrl}</p>
      <p>Please review the full agreement before signing. Once signed, you will receive a copy by email.</p>`;

    // Confirmation email to Jason
    const jasonHtml = `
      <h2 style="color:#14b8a6">Agreement sent to ${partner_name}</h2>
      <p>A partnership agreement has been sent to <strong>${partner_email}</strong>.</p>
      <p>Signing link: <a href="${signingUrl}">${signingUrl}</a></p>
      <p style="color:#888;font-size:13px">Agreement ID: ${agreement.id}</p>`;

    await Promise.all([
      sendMailerSend(
        partner_email.trim(), partner_name.trim(),
        `Partnership Agreement from 7 Kin Homestead — Please Sign`, partnerHtml
      ).catch(e => logger.error({ err: e }, '[contracts] partner send email failed')),
      sendMailerSend(
        'jason@7kinhomestead.com', 'Jason',
        `Agreement Sent — ${partner_name}`, jasonHtml
      ).catch(e => logger.error({ err: e }, '[contracts] jason send notification failed')),
    ]);

    res.json({ ok: true, agreement, signing_url: signingUrl });
  } catch (err) {
    logger.error({ err }, '[contracts] POST agreements/send failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/contracts/agreements/:id
router.get('/api/contracts/agreements/:id', requireAuth, (req, res) => {
  try {
    const agreement = db.getAgreement(parseInt(req.params.id));
    if (!agreement) return res.status(404).json({ ok: false, error: 'Agreement not found' });
    res.json({ ok: true, agreement });
  } catch (err) {
    logger.error({ err }, '[contracts] GET agreements/:id failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
