/**
 * Kre8Ωr — Beta API
 * All beta-testing infrastructure: applications, bug reports, NPS, funnel, stats.
 *
 * Public (no auth):
 *   POST /api/beta/apply
 *   POST /api/beta/report
 *   POST /api/beta/nps
 *
 * Admin:
 *   GET  /api/beta/applications
 *   PATCH /api/beta/applications/:id
 *   GET  /api/beta/reports
 *   PATCH /api/beta/report/:id
 *   GET  /api/beta/nps
 *   GET  /api/beta/funnel
 *   GET  /api/beta/stats
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Optional email alert for blocker bugs (requires ALERT_EMAIL in .env)
async function maybeSendBlockerAlert(report) {
  const alertEmail = process.env.ALERT_EMAIL;
  if (!alertEmail || report.severity !== 'blocker') return;
  // Emit to console for now — wire to nodemailer or Kajabi webhook later
  console.error(
    `[Beta] 🔴 BLOCKER reported by ${report.reporter_name || 'Anonymous'} on ${report.page}\n` +
    `  Tried: ${report.what_tried}\n` +
    `  Got:   ${report.what_happened}`
  );
}

// ─────────────────────────────────────────────
// APPLICATIONS
// ─────────────────────────────────────────────

router.post('/apply', (req, res) => {
  try {
    const { name, channel_url, platform, upload_frequency, why_text } = req.body;
    if (!name?.trim())         return res.status(400).json({ ok: false, error: 'Name is required' });
    if (!channel_url?.trim())  return res.status(400).json({ ok: false, error: 'Channel URL is required' });
    if (!why_text?.trim())     return res.status(400).json({ ok: false, error: 'Please tell us why you want access' });

    const id = db.insertBetaApplication({
      name: name.trim(), channel_url: channel_url.trim(),
      platform: platform || null, upload_frequency: upload_frequency || null,
      why_text: why_text.trim()
    });
    console.log(`[Beta] Application #${id} — ${name.trim()} (${channel_url.trim()})`);
    res.json({ ok: true, id, message: "Application received. We'll be in touch within 48 hours." });
  } catch (err) {
    console.error('[Beta] apply error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/applications', (req, res) => {
  try {
    const applications = db.getAllBetaApplications();
    res.json({ ok: true, applications, count: applications.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/applications/:id', (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'approved', 'rejected', 'waitlisted'];
    if (!valid.includes(status)) return res.status(400).json({ ok: false, error: `status must be one of: ${valid.join(', ')}` });
    db.updateBetaApplicationStatus(parseInt(req.params.id), status);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// BUG REPORTS
// ─────────────────────────────────────────────

router.post('/report', async (req, res) => {
  try {
    const { what_tried, what_happened, severity, page, project_id,
            browser, console_errors, timestamp, reporter_name } = req.body;

    const id = db.insertBugReport({
      what_tried, what_happened, severity: severity || 'minor',
      page, project_id: project_id ? parseInt(project_id) : null,
      browser, console_errors, timestamp, reporter_name
    });

    console.log(`[Beta] Bug #${id} [${severity || 'minor'}] on ${page} — ${what_tried?.substring(0, 60)}`);
    await maybeSendBlockerAlert({ severity, reporter_name, page, what_tried, what_happened });

    res.json({ ok: true, id });
  } catch (err) {
    console.error('[Beta] report error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/reports', (req, res) => {
  try {
    const reports = db.getBugReports();
    res.json({ ok: true, reports, count: reports.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/report/:id', (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['open', 'in-progress', 'resolved', 'wontfix'];
    if (!valid.includes(status)) return res.status(400).json({ ok: false, error: `status must be one of: ${valid.join(', ')}` });
    db.updateBugReportStatus(parseInt(req.params.id), status);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// NPS SCORES
// ─────────────────────────────────────────────

router.post('/nps', (req, res) => {
  try {
    const { score, comment, page, project_id } = req.body;
    if (score === undefined || score === null) return res.status(400).json({ ok: false, error: 'score is required' });
    const numScore = parseInt(score);
    if (isNaN(numScore) || numScore < 0 || numScore > 10) return res.status(400).json({ ok: false, error: 'score must be 0–10' });

    const id = db.insertNpsScore({
      score: numScore, comment: comment || null,
      page: page || null, project_id: project_id ? parseInt(project_id) : null
    });
    console.log(`[Beta] NPS score ${numScore}/10 on ${page}`);
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[Beta] nps error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/nps', (req, res) => {
  try {
    const scores = db.getNpsScores();
    const { avg, count } = db.getNpsAverage();
    res.json({ ok: true, scores, avg, count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// FUNNEL
// ─────────────────────────────────────────────

router.get('/funnel', (req, res) => {
  try {
    const funnel = db.getBetaFunnel();
    res.json({ ok: true, funnel });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// STATS (overview row on admin dashboard)
// ─────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const stats = db.getBetaStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// TOKEN STATS — AI API usage and cost tracking
// ─────────────────────────────────────────────

router.get('/token-stats', (req, res) => {
  try {
    const stats = db.getTokenStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
