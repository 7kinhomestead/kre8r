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
function renderTemplate(bodyTemplate, variables) {
  let rendered = bodyTemplate;
  for (const [key, val] of Object.entries(variables || {})) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(re, val || '');
  }
  return rendered;
}

// ── Signing page HTML builder ──────────────────────────────────────────────
function buildSigningPage({ status, agreement, errorMsg }) {
  const bodyContent = (() => {
    if (errorMsg) {
      return `<div class="msg error">${errorMsg}</div>`;
    }
    if (status === 'not_found') {
      return `<div class="msg error">Agreement not found. This link may be invalid or expired.</div>`;
    }
    if (status === 'already_signed') {
      const date = agreement.signed_at
        ? new Date(agreement.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'a previous date';
      return `<div class="msg success">This agreement has already been signed on ${date}.</div>`;
    }
    if (status === 'success') {
      return `<div class="msg success">&#10003; Signed! A copy has been emailed to you.</div>`;
    }
    // status === 'pending' — show the signing form
    const bodyHtml = (agreement.body_snapshot || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    return `
      <div class="agreement-body">${bodyHtml}</div>
      <div class="sig-section">
        <h3>Sign this Agreement</h3>
        <div class="field">
          <label for="signer-name">Full Legal Name</label>
          <input type="text" id="signer-name" placeholder="Your full legal name" required autocomplete="name">
        </div>
        <label class="checkbox-label">
          <input type="checkbox" id="agree-check">
          I have read and agree to the terms above
        </label>
        <button class="btn-sign" onclick="submitSignature()">Sign Agreement</button>
        <div id="sign-error" class="sign-error" style="display:none"></div>
      </div>
      <div class="footer">
        By signing, you agree to be bound by the terms above. Signed agreements are timestamped and legally binding.
      </div>
      <script>
        async function submitSignature() {
          const name  = document.getElementById('signer-name').value.trim();
          const check = document.getElementById('agree-check').checked;
          const errEl = document.getElementById('sign-error');
          errEl.style.display = 'none';
          if (!name)  { errEl.textContent = 'Please enter your full legal name.'; errEl.style.display = ''; return; }
          if (!check) { errEl.textContent = 'You must check the box to confirm you have read the agreement.'; errEl.style.display = ''; return; }
          const btn = document.querySelector('.btn-sign');
          btn.disabled = true; btn.textContent = 'Signing…';
          try {
            const res = await fetch(location.pathname.replace('/sign/', '/api/contracts/sign/'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ signer_name: name })
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
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0a;--card:#141414;--border:#222;--border2:#333;
  --off:rgba(255,255,255,.88);--muted:rgba(255,255,255,.48);
  --teal:#14b8a6;--green:#22c55e;--red:#ef4444;
}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--bg);color:var(--off);font-size:15px;min-height:100vh;padding:0 0 60px}
.header{background:#111;border-bottom:1px solid var(--border);padding:18px 24px;display:flex;align-items:center;gap:14px}
.header-logo{font-size:20px;font-weight:800;color:var(--teal);letter-spacing:-.3px}
.header-sub{font-size:13px;color:var(--muted);margin-top:2px}
.container{max-width:780px;margin:0 auto;padding:32px 24px}
.agreement-body{
  background:var(--card);border:1px solid var(--border);border-radius:10px;
  padding:28px 32px;line-height:1.8;font-size:14px;color:var(--off);
  white-space:pre-wrap;font-family:'DM Sans',system-ui,sans-serif;
  margin-bottom:28px;max-height:65vh;overflow-y:auto;
}
.sig-section{background:#111;border:1px solid var(--teal);border-radius:10px;padding:28px 32px;margin-bottom:24px}
.sig-section h3{font-size:17px;font-weight:700;color:var(--teal);margin-bottom:18px}
.field{margin-bottom:16px}
.field label{display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.field input{width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:7px;padding:10px 14px;color:var(--off);font-size:15px;font-family:inherit}
.field input:focus{outline:none;border-color:var(--teal)}
.checkbox-label{display:flex;align-items:flex-start;gap:10px;font-size:14px;cursor:pointer;margin-bottom:20px;line-height:1.5;color:var(--off)}
.checkbox-label input{margin-top:3px;accent-color:var(--teal);width:16px;height:16px;flex-shrink:0}
.btn-sign{width:100%;padding:14px;background:var(--teal);border:none;border-radius:8px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;transition:opacity .15s}
.btn-sign:hover{opacity:.87}
.btn-sign:disabled{opacity:.45;cursor:not-allowed}
.sign-error{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:10px 14px;font-size:13px;color:var(--red);margin-top:12px}
.footer{font-size:12px;color:var(--muted);line-height:1.6;text-align:center;padding:0 20px}
.msg{padding:20px 24px;border-radius:10px;font-size:15px;font-weight:600;text-align:center}
.msg.success{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:var(--green);font-size:18px;padding:32px}
.msg.error{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);color:var(--red)}
@media(max-width:600px){.agreement-body{padding:18px;max-height:55vh}.sig-section{padding:20px}.container{padding:20px 14px}}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="header-logo">7 Kin Homestead</div>
    <div class="header-sub">Partnership Agreement</div>
  </div>
</div>
<div class="container">
${bodyContent}
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

    const { signer_name } = req.body;
    if (!signer_name || !signer_name.trim()) {
      return res.status(400).json({ ok: false, error: 'signer_name required' });
    }

    const signedAt = new Date().toISOString();
    const signerIp = req.ip || req.connection?.remoteAddress || 'unknown';
    db.updateAgreementStatus(agreement.id, 'signed', signer_name.trim(), signerIp, signedAt);

    // Send confirmation emails (non-blocking — don't fail the sign request on email error)
    const signedDate = new Date(signedAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const agreementBodyHtml = (agreement.body_snapshot || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const partnerHtml = `
      <h2 style="color:#14b8a6">Your agreement has been signed</h2>
      <p>Hi ${signer_name.trim()},</p>
      <p>Thank you for signing the <strong>${agreement.partner_name || 'Partnership'}</strong> agreement with 7 Kin Homestead on ${signedDate}.</p>
      <p style="color:#888">Signed by: ${signer_name.trim()} | IP: ${signerIp} | Timestamp: ${signedAt}</p>
      <hr style="border-color:#222;margin:20px 0">
      <div style="font-family:monospace;font-size:13px;white-space:pre-wrap">${agreementBodyHtml}</div>`;

    const jasonHtml = `
      <h2 style="color:#14b8a6">Agreement signed: ${agreement.partner_name}</h2>
      <p><strong>${signer_name.trim()}</strong> (${agreement.partner_email}) signed the partnership agreement on ${signedDate}.</p>
      <p style="color:#888">IP: ${signerIp} | Timestamp: ${signedAt}</p>
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

    // Build the signing URL
    const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host     = req.headers['x-forwarded-host'] || req.headers.host || 'kre8r.app';
    const signingUrl = `${protocol}://${host}/sign/${token}`;

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
