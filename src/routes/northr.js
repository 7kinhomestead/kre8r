/**
 * NorthΩr Routes — src/routes/northr.js
 *
 * GET  /api/northr/alerts              — get all active (undismissed) alerts
 * POST /api/northr/alerts/:id/read     — mark alert read
 * POST /api/northr/alerts/:id/dismiss  — dismiss alert
 * POST /api/northr/check               — manually trigger threshold check
 * GET  /api/northr/strategy/latest     — get latest strategy report
 * POST /api/northr/strategy/generate   — generate monthly strategy (SSE)
 * GET  /api/northr/dashboard           — aggregate: alerts + pipeline + stats + goals
 * POST /api/northr/goals               — upsert monthly goals
 * GET  /api/northr/goals/current       — get current month goals
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { checkAllThresholds, generateMonthlyStrategy, currentMonth, currentYear } = require('../utils/strategy-engine');

// ─── GET /alerts ───────────────────────────────────────────────────────────────
router.get('/alerts', (req, res) => {
  try {
    const alerts = db.getAllAlerts();
    const unread = alerts.filter(a => !a.read).length;
    res.json({ alerts, unread_count: unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /alerts/:id/read ─────────────────────────────────────────────────────
router.post('/alerts/:id/read', (req, res) => {
  try {
    db.markAlertRead(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /alerts/:id/dismiss ─────────────────────────────────────────────────
router.post('/alerts/:id/dismiss', (req, res) => {
  try {
    db.dismissAlert(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /check — manually trigger threshold check ───────────────────────────
router.post('/check', async (req, res) => {
  try {
    const newAlerts = await checkAllThresholds();
    res.json({ ok: true, new_alerts: newAlerts.length, alerts: newAlerts });
  } catch (err) {
    console.error('[northr/check]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /strategy/latest ─────────────────────────────────────────────────────
router.get('/strategy/latest', (req, res) => {
  try {
    const { month, year } = req.query;
    const report = db.getLatestReport(
      month || currentMonth(),
      year  ? parseInt(year, 10) : currentYear()
    );
    if (!report) return res.json({ report: null });
    let parsed = null;
    try { parsed = JSON.parse(report.content); } catch { parsed = report.content; }
    res.json({ report: { ...report, content: parsed } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /strategy/generate — SSE stream ────────────────────────────────────
router.post('/strategy/generate', async (req, res) => {
  const { month = currentMonth(), year = currentYear() } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('status', { message: 'Gathering your data…' });
    await new Promise(r => setTimeout(r, 300));

    send('status', { message: 'Building strategy with Claude…' });
    const strategy = await generateMonthlyStrategy(month, parseInt(year, 10));

    send('complete', { strategy, month, year });
    res.end();
  } catch (err) {
    console.error('[northr/strategy/generate]', err);
    send('error', { message: err.message });
    res.end();
  }
});

// ─── GET /dashboard ───────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const alerts        = db.getAllAlerts();
    const unread_count  = alerts.filter(a => !a.read).length;
    const pipeline      = db.getPipelineHealth();
    const stats         = db.getPublishingStats(30);
    const goals         = db.getGoal(currentMonth(), currentYear());
    const latest_report = db.getLatestReport(currentMonth(), currentYear());

    let report_content = null;
    if (latest_report?.content) {
      try { report_content = JSON.parse(latest_report.content); } catch { report_content = null; }
    }

    // Build publish calendar (last 90 days)
    const publishedProjects = db._allRaw
      ? db._allRaw(`SELECT title, published_at FROM projects WHERE status = 'published' AND published_at IS NOT NULL ORDER BY published_at DESC`)
      : [];

    res.json({
      alerts,
      unread_count,
      pipeline,
      stats,
      goals,
      report: report_content ? { ...latest_report, content: report_content } : null,
    });
  } catch (err) {
    console.error('[northr/dashboard]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /goals — upsert monthly goals ──────────────────────────────────────
router.post('/goals', (req, res) => {
  try {
    const { month = currentMonth(), year = currentYear(), ...rest } = req.body;
    const goal = db.createGoal({ month, year: parseInt(year, 10), ...rest });
    res.json({ ok: true, goal });
  } catch (err) {
    console.error('[northr/goals]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /goals/current ───────────────────────────────────────────────────────
router.get('/goals/current', (req, res) => {
  try {
    const goal = db.getGoal(currentMonth(), currentYear());
    res.json({ goal: goal || null, month: currentMonth(), year: currentYear() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /recent-projects — native projects for "mark published" UI ───────────
router.get('/recent-projects', (req, res) => {
  try {
    const projects = db.getKre8rProjects().filter(p => p.status !== 'archived').slice(0, 30);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /projects/:id/mark-published ────────────────────────────────────────
router.post('/projects/:id/mark-published', (req, res) => {
  try {
    const id          = parseInt(req.params.id, 10);
    const { published_at } = req.body;
    db.markProjectPublished(id, published_at || null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[northr/mark-published]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
