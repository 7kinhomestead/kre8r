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
const embed = require('../utils/embed');
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

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ ok: false, error: 'q required' });

    // Text hits (exact/substring)
    const like = `%${q}%`;
    const textRows = db.prepare(
      `SELECT s.id AS shot_id, s.footage_id, s.shot_idx, s.start_s, s.end_s,
              a.description, a.tags,
              f.original_filename, f.file_path, f.proxy_path, f.shot_type, f.project_id
       FROM footage_shot_analysis a
       JOIN footage_shots s ON s.id = a.shot_id
       JOIN footage f ON f.id = s.footage_id
       WHERE a.description LIKE ? OR a.tags LIKE ?
       ORDER BY s.footage_id DESC, s.shot_idx
       LIMIT 100`).all(like, like);

    // Semantic hits (meaning) — merged in, deduped, when the stack is up
    let semRows = [];
    let semantic = false;
    if (db.isVecLoaded() && await embed.isUp()) {
      const qVec = await embed.embedText(q, 'query');
      if (qVec) {
        semantic = true;
        const knn = db.getRawDb().prepare(
          'SELECT rowid, distance FROM shot_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 30'
        ).all(qVec);
        if (knn.length) {
          const ids = knn.map(k => Number(k.rowid));
          const dist = new Map(knn.map(k => [Number(k.rowid), k.distance]));
          semRows = db.prepare(
            `SELECT s.id AS shot_id, s.footage_id, s.shot_idx, s.start_s, s.end_s,
                    a.description, a.tags,
                    f.original_filename, f.file_path, f.proxy_path, f.shot_type, f.project_id
             FROM footage_shots s
             JOIN footage_shot_analysis a ON a.shot_id = s.id
             JOIN footage f ON f.id = s.footage_id
             WHERE s.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
          semRows.forEach(r => { r.distance = dist.get(r.shot_id); });
          semRows.sort((x, y) => x.distance - y.distance);
        }
      }
    }

    const seen = new Set(textRows.map(r => r.shot_id));
    const merged = [...textRows, ...semRows.filter(r => !seen.has(r.shot_id))];
    res.json({ ok: true, q, semantic, count: merged.length, results: merged });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Backfill vectors for analysis rows that don't have one yet (existing ledgers)
router.post('/embed-backfill', async (req, res) => {
  try {
    if (!db.isVecLoaded()) return res.status(409).json({ ok: false, error: 'sqlite-vec unavailable' });
    const e = await embed.ensureServer();
    if (!e.ok) return res.status(409).json({ ok: false, error: e.reason });
    const rows = db.prepare(
      `SELECT a.shot_id, a.description, a.tags
       FROM footage_shot_analysis a
       LEFT JOIN shot_vec v ON v.rowid = a.shot_id
       WHERE v.rowid IS NULL AND a.description IS NOT NULL AND a.description != ''
       LIMIT ${Math.min(parseInt(req.body?.limit, 10) || 2000, 10000)}`).all();
    let done = 0;
    const ins = db.getRawDb().prepare(
      'INSERT OR REPLACE INTO shot_vec (rowid, embedding) VALUES (?, ?)');
    for (const r of rows) {
      const vec = await embed.embedText(`${r.description} ${r.tags || ''}`, 'document');
      if (vec) { ins.run(BigInt(r.shot_id), vec); done++; }
    }
    logger.info({ done, of: rows.length }, '[shots] embed backfill');
    res.json({ ok: true, embedded: done, candidates: rows.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/server/stop', (req, res) => {
  const stopped = vlm.stopServer();
  res.json({ ok: true, stopped });
});

// Bin-review corrections intake — persists the pasted payload so a browser
// crash or cleared localStorage can never lose Jason's review work (Prime
// Directive). Corrections are applied to the bin map by hand/Fable; this is
// the durable inbox.
router.post('/bin-corrections', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return res.status(400).json({ ok: false, error: 'empty corrections payload' });
    }
    const key = `binreview_corrections_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(payload));
    const count = Array.isArray(payload) ? payload.length
      : (payload.corrections ? payload.corrections.length : 1);
    logger.info({ key, count }, '[shots] bin-review corrections stored');
    res.json({ ok: true, key, count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/bin-corrections', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT key, value, updated_at FROM kv_store
       WHERE key LIKE 'binreview_corrections_%' ORDER BY key DESC LIMIT 50`).all();
    res.json({ ok: true, batches: rows.map(r => ({
      key: r.key, saved_at: r.updated_at, payload: JSON.parse(r.value) })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
