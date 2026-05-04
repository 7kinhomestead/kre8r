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
        <div class="sf-heading">&#9998; Fill in your details before signing</div>
        ${signerVars.map(v => `
        <div class="field">
          <label for="sf-${v}">${toLabel(v)}</label>
          <input type="text" id="sf-${v}" class="sf-input" data-key="${v}"
            placeholder="${toLabel(v)}" oninput="updatePreview(this)">
        </div>`).join('')}
      </div>` : '';

    return `
      ${signerFieldsHtml}
      <div class="agreement-body" id="agreement-body">${bodyHtml}</div>
      <div class="sig-section">
        <h3>Sign this Agreement</h3>
        <div class="field">
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
      <div class="footer">
        By signing, you confirm your identity, consent to electronic signature, and agree to be bound by the terms above.<br>
        Your signature, IP address, browser, and timestamp are recorded as part of the legally binding audit trail.
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
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,600;0,700;1,400&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --paper:#faf9f6;--white:#fff;--ink:#1a1a1a;--ink2:#3a3a3a;--muted:#6b7280;
  --teal:#14b8a6;--teal-light:rgba(20,184,166,.08);--teal-mid:rgba(20,184,166,.18);
  --border:#e5e2db;--border2:#d1cec7;
  --amber:#f59e0b;--red:#dc2626;--green:#16a34a;
}
body{font-family:'DM Sans',system-ui,sans-serif;background:#ede9e0;color:var(--ink);font-size:15px;min-height:100vh;padding:32px 16px 80px}

/* ── Page / document shell ── */
.page{max-width:760px;margin:0 auto;background:var(--white);border-radius:4px;
      box-shadow:0 4px 6px rgba(0,0,0,.07),0 12px 40px rgba(0,0,0,.10),0 1px 0 rgba(0,0,0,.05);}

/* ── Letterhead ── */
.lh-accent{height:5px;background:linear-gradient(90deg,var(--teal),#0ea5e9);border-radius:4px 4px 0 0;}
.lh{padding:32px 48px 24px;border-bottom:1.5px solid var(--border);}
.lh-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;}
.lh-brand{display:flex;flex-direction:column;gap:4px;}
.lh-name{font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:700;
         color:var(--ink);letter-spacing:-.3px;line-height:1;}
.lh-name span{color:var(--teal);}
.lh-tag{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:4px;}
.lh-meta{text-align:right;font-size:11px;color:var(--muted);line-height:1.7;}
.lh-meta a{color:var(--muted);text-decoration:none;}
.lh-divider{margin-top:20px;border:none;border-top:1px solid var(--border);}
.doc-title{margin-top:16px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--teal);}

/* ── Agreement body ── */
.agreement-body{
  padding:36px 48px;line-height:1.85;font-size:14px;color:var(--ink2);
  white-space:pre-wrap;font-family:'DM Sans',system-ui,sans-serif;font-weight:300;
  max-height:58vh;overflow-y:auto;border-bottom:1px solid var(--border);
  background:var(--paper);
}
.agreement-body::-webkit-scrollbar{width:5px;}
.agreement-body::-webkit-scrollbar-track{background:transparent;}
.agreement-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px;}

/* ── Signer-fillable fields ── */
.signer-fields{padding:24px 48px;background:#fffbeb;border-bottom:1px solid #fde68a;}
.sf-heading{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
            color:var(--amber);margin-bottom:16px;}
.field{margin-bottom:14px;}
.field label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;
             letter-spacing:.08em;color:var(--muted);margin-bottom:5px;}
.field input{width:100%;background:var(--white);border:1px solid var(--border2);
             border-radius:6px;padding:9px 13px;color:var(--ink);font-size:14px;
             font-family:inherit;transition:border-color .15s;}
.field input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-mid);}

/* ── Signature section ── */
.sig-section{padding:32px 48px;background:var(--white);}
.sig-section h3{font-family:'Playfair Display',Georgia,serif;font-size:18px;color:var(--ink);
                margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border);}
.checkbox-label{display:flex;align-items:flex-start;gap:10px;font-size:13px;cursor:pointer;
                margin-bottom:16px;line-height:1.6;color:var(--ink2);
                padding:12px 14px;border:1px solid var(--border);border-radius:7px;
                background:var(--paper);transition:border-color .15s;}
.checkbox-label:has(input:checked){border-color:var(--teal);background:var(--teal-light);}
.checkbox-label input{margin-top:2px;accent-color:var(--teal);width:15px;height:15px;flex-shrink:0;}
.name-field{margin-bottom:20px;}
.name-field label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;
                  letter-spacing:.08em;color:var(--muted);margin-bottom:5px;}
.name-field input{width:100%;background:var(--white);border:1.5px solid var(--border2);
                  border-radius:6px;padding:10px 14px;color:var(--ink);font-size:15px;
                  font-family:inherit;transition:border-color .15s;}
.name-field input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-mid);}
.btn-sign{width:100%;padding:14px;background:var(--teal);border:none;border-radius:7px;
          font-size:15px;font-weight:700;color:#fff;cursor:pointer;
          letter-spacing:.03em;transition:background .15s,opacity .15s;margin-top:6px;}
.btn-sign:hover{background:#0ea098;}
.btn-sign:disabled{opacity:.4;cursor:not-allowed;}
.sign-error{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;
            padding:10px 14px;font-size:13px;color:var(--red);margin-top:12px;}

/* ── Footer ── */
.doc-footer{padding:16px 48px 28px;text-align:center;font-size:11px;color:var(--muted);
            line-height:1.7;border-top:1px solid var(--border);}
.doc-footer strong{color:var(--ink2);}

/* ── Status messages ── */
.msg-wrap{padding:48px;}
.msg{padding:24px 28px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;}
.msg.success{background:#f0fdf4;border:1px solid #bbf7d0;color:var(--green);font-size:18px;padding:36px;}
.msg.error{background:#fef2f2;border:1px solid #fecaca;color:var(--red);}

/* ── Placeholder highlights ── */
.ph{background:rgba(245,158,11,.15);color:#b45309;border-radius:3px;padding:1px 4px;
    font-weight:600;border-bottom:1.5px dashed var(--amber);transition:all .2s;}
.ph.ph-filled{background:var(--teal-light);color:#0f766e;border-bottom-color:var(--teal);}

@media(max-width:620px){
  .lh,.agreement-body,.signer-fields,.sig-section,.doc-footer{padding-left:20px;padding-right:20px;}
  body{padding:0 0 60px;background:#e5e0d8;}
  .page{border-radius:0;}
}
@media print{
  body{background:white;padding:0;}
  .page{box-shadow:none;}
  .sig-section{display:none;}
}
</style>
</head>
<body>
<div class="page">
  <div class="lh-accent"></div>
  <div class="lh">
    <div class="lh-top">
      <div class="lh-brand">
        <div class="lh-name">7 Kin <span>Homestead</span></div>
        <div class="lh-tag">Off-Grid · Resourceful · Rock Rich</div>
      </div>
      <div class="lh-meta">
        7kinhomestead.land<br>
        <a href="mailto:jason@7kinhomestead.com">jason@7kinhomestead.com</a>
      </div>
    </div>
    <hr class="lh-divider">
    <div class="doc-title">Partnership Agreement</div>
  </div>
  ${bodyContent}
  <div class="doc-footer">
    <strong>7 Kin Homestead</strong> · 7kinhomestead.land<br>
    This is a legally binding electronic agreement. Your signature, IP address, browser, and timestamp are recorded per the U.S. ESIGN Act.
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
