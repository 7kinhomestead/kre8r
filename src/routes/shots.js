/**
 * Shot layer routes — /api/shots (VaultΩr 2.0 V1.5)
 *
 * POST /backfill        { limit?, tier?, shot_types? } → queue a backfill run
 * GET  /status          → worker progress
 * GET  /footage/:id     → the shot ledger for one footage record
 * GET  /search?q=       → plain-text search across descriptions/tags (semantic in V2)
 * POST /server/stop     → release the Farmhand's VRAM (e.g. before opening Resolve)
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const vlm = require('../utils/vlm');
const worker = require('../vault/shot-worker');
const logger = require('../utils/logger');

router.post('/backfill', async (req, res) => {
  try {
    const { limit, tier, shot_types } = req.body || {};
    const result = await worker.runBackfill({
      limit: Math.min(parseInt(limit, 10) || 10, 200),
      tier: tier === 'quality' ? 'quality' : 'triage',
      shotTypes: Array.isArray(shot_types) ? shot_types : null,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err: err.message }, '[shots] backfill failed to start');
    res.status(409).json({ ok: false, error: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const counts = db.prepare(
      `SELECT COUNT(DISTINCT footage_id) AS footage_with_shots,
              COUNT(*) AS total_shots
       FROM footage_shots`).get();
    res.json({ ok: true, worker: worker.getStatus(), totals: counts,
               server_up: await vlm.isUp(), tier: vlm.currentTier() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/footage/:id', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT s.id, s.shot_idx, s.start_s, s.end_s, s.detect_source,
              a.description, a.tags, a.model, a.tier, a.sharpness, a.frame_time_s
       FROM footage_shots s
       LEFT JOIN footage_shot_analysis a ON a.shot_id = s.id
       WHERE s.footage_id = ?
       ORDER BY s.shot_idx`).all(req.params.id);
    res.json({ ok: true, footage_id: Number(req.params.id), shots: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ ok: false, error: 'q required' });
    const like = `%${q}%`;
    const rows = db.prepare(
      `SELECT s.footage_id, s.shot_idx, s.start_s, s.end_s,
              a.description, a.tags,
              f.original_filename, f.file_path, f.proxy_path, f.shot_type, f.project_id
       FROM footage_shot_analysis a
       JOIN footage_shots s ON s.id = a.shot_id
       JOIN footage f ON f.id = s.footage_id
       WHERE a.description LIKE ? OR a.tags LIKE ?
       ORDER BY s.footage_id DESC, s.shot_idx
       LIMIT 200`).all(like, like);
    res.json({ ok: true, q, count: rows.length, results: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/server/stop', (req, res) => {
  const stopped = vlm.stopServer();
  res.json({ ok: true, stopped });
});

module.exports = router;
