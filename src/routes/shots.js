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

// Embed every analysis row that doesn't have a vector yet. Shared by the
// manual backfill endpoint and the auto-embed pass after ledger imports.
// Single-flight: concurrent import batches each fire this, but vec0 tables
// don't tolerate racing inserts (no OR REPLACE semantics) — one pass at a
// time, and per-row tolerance for the rare straggler.
let _embedBusy = false;
async function embedMissingShots(limit = 5000) {
  if (_embedBusy) return { ok: true, skipped: 'pass already running' };
  _embedBusy = true;
  try {
    if (!db.isVecLoaded()) return { ok: false, reason: 'sqlite-vec unavailable' };
    const e = await embed.ensureServer();
    if (!e.ok) return { ok: false, reason: e.reason };
    const rows = db.prepare(
      `SELECT a.shot_id, a.description, a.tags
       FROM footage_shot_analysis a
       LEFT JOIN shot_vec v ON v.rowid = a.shot_id
       WHERE v.rowid IS NULL AND a.description IS NOT NULL AND a.description != ''
       LIMIT ?`).all(Math.min(limit, 10000));
    let done = 0;
    const ins = db.getRawDb().prepare(
      'INSERT INTO shot_vec (rowid, embedding) VALUES (?, ?)');
    for (const r of rows) {
      const vec = await embed.embedText(`${r.description} ${r.tags || ''}`, 'document');
      if (vec) {
        try { ins.run(BigInt(r.shot_id), vec); done++; }
        catch (_) { /* row landed via another path — fine */ }
      }
    }
    logger.info({ done, of: rows.length }, '[shots] embed pass');
    return { ok: true, embedded: done, candidates: rows.length };
  } finally {
    _embedBusy = false;
  }
}

// Backfill vectors for analysis rows that don't have one yet (existing ledgers).
// Session auth OR internal key (whitelisted in server.js) — tooling shouldn't
// need a browser console for this.
router.post('/embed-backfill', async (req, res) => {
  const keyOk = process.env.INTERNAL_API_KEY &&
    req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY;
  if (!req.session?.userId && !keyOk) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const result = await embedMissingShots(parseInt(req.body?.limit, 10) || 5000);
    if (!result.ok) return res.status(409).json({ ok: false, error: result.reason });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/server/stop', (req, res) => {
  const stopped = vlm.stopServer();
  res.json({ ok: true, stopped });
});

// ── B-rollΩr slot proposals (V3) ─────────────────────────────────────────────
// POST /api/shots/propose { text, s2_only?, per_line? }
// Splits the text into lines/beats, embeds each, KNN-searches the shot vault,
// returns non-talking-head b-roll candidates per line. The draft-brain:
// it proposes, the creator decides — never the other way around.
router.post('/propose', async (req, res) => {
  // Session (the SlotΩr page) OR internal key (tooling / Resolve pushers)
  const keyOk = process.env.INTERNAL_API_KEY &&
    req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY;
  if (!req.session?.userId && !keyOk) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    if (!db.isVecLoaded()) return res.status(409).json({ ok: false, error: 'sqlite-vec unavailable' });
    const e = await embed.ensureServer();
    if (!e.ok) return res.status(409).json({ ok: false, error: e.reason });

    const raw = String(req.body?.text || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'text required' });
    const s2Only = req.body?.s2_only !== false; // This-Season law is the default
    const perLine = Math.min(parseInt(req.body?.per_line, 10) || 4, 8);
    const S2_RX = /Rock Rich Season 2|680_s2|680_season|Cari's phone|drone mapping/i;

    const lines = raw.split(/\r?\n+/).map(l => l.trim())
      .filter(l => l.length >= 15).slice(0, 40);

    const knn = db.getRawDb().prepare(
      'SELECT rowid, distance FROM shot_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 14');
    const detail = db.prepare(
      `SELECT s.id, s.footage_id, s.start_s, s.end_s, a.description, a.tags,
              f.original_filename, f.shot_type, f.file_path, f.proxy_path, f.thumbnail_path
       FROM footage_shots s
       JOIN footage_shot_analysis a ON a.shot_id = s.id
       JOIN footage f ON f.id = s.footage_id
       WHERE s.id = ?`);

    const slots = [];
    for (const line of lines) {
      const vec = await embed.embedText(line, 'query');
      if (!vec) { slots.push({ line, picks: [] }); continue; }
      const picks = [];
      for (const h of knn.all(vec)) {
        const d = detail.get(Number(h.rowid));
        if (!d) continue;
        if (s2Only && !S2_RX.test(`${d.file_path || ''} ${d.proxy_path || ''}`)) continue;
        if (String(d.shot_type || '').replace('_', '-') === 'talking-head') continue;
        if (/talking (to|into|at) (the )?camera|speaks? to the camera|speaking and gestur/i.test(d.description || '')) continue;
        picks.push({
          footage_id: d.footage_id, filename: d.original_filename,
          start_s: Math.round(d.start_s), end_s: Math.round(d.end_s),
          description: String(d.description || '').slice(0, 240),
          thumbnail: d.thumbnail_path || null, file_path: d.file_path,
          distance: Number(h.distance.toFixed(3)),
        });
        if (picks.length >= perLine) break;
      }
      slots.push({ line, picks });
    }
    res.json({ ok: true, s2_only: s2Only, slots });
  } catch (err) {
    logger.error({ err: err.message }, '[shots] propose failed');
    res.status(500).json({ ok: false, error: err.message });
  }
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

// ── Ledger import bridge ─────────────────────────────────────────────────────
// POST /api/shots/import-ledger — bulk-import scratchpad shot-log JSONs into
// footage_shots/footage_shot_analysis. Machine-to-machine: X-Internal-Key auth
// (whitelisted in server.js), matches clips to vault footage by path/filename.
router.post('/import-ledger', (req, res) => {
  if (!process.env.INTERNAL_API_KEY ||
      req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  try {
    const items = (req.body && req.body.items) || [];
    const path = require('path');
    const norm = p => String(p || '').toLowerCase().replace(/\//g, '\\');

    // Build a lookup of vault footage by full paths and by basename
    const rows = db.prepare(
      'SELECT id, file_path, proxy_path, organized_path, original_filename FROM footage').all();
    const byPath = new Map();
    const byBase = new Map();
    for (const r of rows) {
      for (const p of [r.file_path, r.proxy_path, r.organized_path]) {
        if (p) byPath.set(norm(p), r.id);
      }
      if (r.original_filename) {
        const b = r.original_filename.toLowerCase();
        byBase.set(b, (byBase.get(b) || []).concat(r.id));
      }
    }

    const insShot = db.prepare(
      `INSERT OR IGNORE INTO footage_shots (footage_id, shot_idx, start_s, end_s, detect_source)
       VALUES (?, ?, ?, ?, ?)`);
    const getShot = db.prepare(
      'SELECT id FROM footage_shots WHERE footage_id = ? AND shot_idx = ?');
    const insAnal = db.prepare(
      `INSERT OR IGNORE INTO footage_shot_analysis
       (shot_id, description, tags, model, tier, sharpness, frame_time_s)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);

    let matched = 0, unmatched = [], segs = 0;
    for (const item of items) {
      const p = norm(item.path);
      let fid = byPath.get(p);
      if (!fid) {
        // staged copies carry an "NNNN_" vault-id prefix — try that, then basename
        const base = path.basename(String(item.path || ''));
        const idm = base.match(/^(\d{2,6})_/);
        if (idm) {
          const cand = db.prepare('SELECT id FROM footage WHERE id = ?').get(Number(idm[1]));
          if (cand) fid = cand.id;
        }
        if (!fid) {
          const ids = byBase.get(base.toLowerCase().replace(/^\d{2,6}_/, ''));
          if (ids && ids.length === 1) fid = ids[0];
        }
      }
      if (!fid) { unmatched.push(item.path); continue; }
      matched++;
      for (const s of item.segments || []) {
        insShot.run(fid, s.idx, s.start, s.end, s.detect_source || 'imported');
        const sr = getShot.get(fid, s.idx);
        if (sr && (s.desc || s.tags)) {
          let desc = s.desc || '';
          let tags = s.tags || null;
          const tm = desc.match(/TAGS:\s*(.+)$/im);
          if (tm && !tags) { tags = tm[1].trim(); desc = desc.replace(/TAGS:\s*.+$/im, '').trim(); }
          // Scrub prompt-echo junk the VLM occasionally leaks into output
          desc = desc.replace(/\/?no_think/gi, '')
                     .replace(/Then on a new line:?\s*TAGS:.*$/is, '').trim();
          if (tags) {
            tags = String(tags).replace(/\/?no_think/gi, '').replace(/^,+|,+$/g, '').trim();
            if (!tags || /jason,\s*cari,\s*one of the kids/i.test(tags)) tags = null;
          }
          insAnal.run(sr.id, desc, tags, s.model || 'import', s.tier || 'triage',
                      s.sharpness ?? null, s.frame_time ?? null);
          segs++;
        }
      }
    }
    logger.info({ matched, unmatched: unmatched.length, segs }, '[shots] ledger import batch');
    res.json({ ok: true, matched, segments: segs, unmatched, auto_embed: 'queued' });
    // Auto-embed the new rows — fire-and-forget so the import response is instant.
    // This is what retires the DevTools console ritual.
    setImmediate(() => embedMissingShots().catch(err =>
      logger.warn({ err: err.message }, '[shots] post-import auto-embed failed')));
  } catch (err) {
    logger.error({ err: err.message }, '[shots] import-ledger failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
