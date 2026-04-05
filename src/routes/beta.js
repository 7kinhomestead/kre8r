/**
 * Kre8Ωr — Beta Applications
 * POST /api/beta/apply — public endpoint, no auth required
 * GET  /api/beta/applications — admin, returns all applications
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ─────────────────────────────────────────────
// POST /api/beta/apply
// ─────────────────────────────────────────────
router.post('/apply', (req, res) => {
  try {
    const { name, channel_url, platform, upload_frequency, why_text } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Name is required' });
    }
    if (!channel_url || !channel_url.trim()) {
      return res.status(400).json({ ok: false, error: 'Channel URL is required' });
    }
    if (!why_text || !why_text.trim()) {
      return res.status(400).json({ ok: false, error: 'Please tell us why you want access' });
    }

    const id = db.insertBetaApplication({
      name:             name.trim(),
      channel_url:      channel_url.trim(),
      platform:         platform || null,
      upload_frequency: upload_frequency || null,
      why_text:         why_text.trim()
    });

    console.log(`[Beta] New application #${id} from ${name.trim()} — ${channel_url.trim()}`);

    res.json({
      ok: true,
      id,
      message: 'Application received. We\'ll be in touch within 48 hours.'
    });
  } catch (err) {
    console.error('[Beta] Apply error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/beta/applications — admin
// ─────────────────────────────────────────────
router.get('/applications', (req, res) => {
  try {
    const applications = db.getAllBetaApplications();
    res.json({ ok: true, applications, count: applications.length });
  } catch (err) {
    console.error('[Beta] Get applications error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/beta/applications/:id — update status
// ─────────────────────────────────────────────
router.patch('/applications/:id', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'rejected', 'waitlisted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `Status must be one of: ${validStatuses.join(', ')}` });
    }
    db.updateBetaApplicationStatus(parseInt(req.params.id), status);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Beta] Update status error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
