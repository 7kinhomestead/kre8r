/**
 * VaultΩr 2.0 shot worker — src/vault/shot-worker.js
 *
 * Runs footage through the shot layer:
 *   scripts/vision/shotscan.py (NVDEC proxy → AdaptiveDetector → ranked frames)
 *   → src/utils/vlm.js (the Farmhand) → shots + shot_analysis tables.
 *
 * Design rules baked in:
 *   - resumable: footage with existing shots is skipped; INSERT OR IGNORE on shots
 *   - 3 concurrent detections (decode is the bottleneck, CPU/NVDEC parallelize);
 *     describes serialize naturally at llama-server
 *   - prompt is NOT creator-hardcoded (Engine vs Soul): VLM_SHOT_PROMPT env or the
 *     generic default; creator-profile injection lands with the taxonomy work in V2
 */

const { spawn } = require('child_process');
const path = require('path');
const db = require('../db');
const vlm = require('../utils/vlm');
const embed = require('../utils/embed');
const logger = require('../utils/logger');

const SHOTSCAN = path.join(__dirname, '..', '..', 'scripts', 'vision', 'shotscan.py');
const PYTHON = process.env.PYTHON_BIN || 'python';
const CONCURRENT_DETECT = 3;

const DEFAULT_PROMPT =
  process.env.VLM_SHOT_PROMPT ||
  'You are logging footage for a video editor\'s catalog. Describe this shot in ' +
  '2-3 sentences: who/what is visible, the action, the location type, anything ' +
  'editorially notable. Then on a new line: TAGS: 5 comma-separated tags.';

const state = {
  running: false,
  total: 0,
  done: 0,
  segmentsLogged: 0,
  emptyDescriptions: 0,
  current: [],
  errors: [],
  startedAt: null,
};

function pickSource(row) {
  return row.proxy_path || row.organized_path || row.file_path;
}

function runShotscan(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-u', SHOTSCAN, filePath], {
      windowsHide: true,
    });
    let out = '';
    let errTail = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errTail = (errTail + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`shotscan exit ${code}: ${errTail}`));
      try {
        const parsed = JSON.parse(out);
        if (!parsed.ok) return reject(new Error(parsed.error || 'shotscan not ok'));
        resolve(parsed);
      } catch (e) {
        reject(new Error(`shotscan bad JSON: ${e.message}`));
      }
    });
  });
}

async function processFootage(row, tier) {
  const src = pickSource(row);
  state.current.push(row.id);
  try {
    const scan = await runShotscan(src);
    const insertShot = db.prepare(
      `INSERT OR IGNORE INTO footage_shots (footage_id, shot_idx, start_s, end_s, detect_source)
       VALUES (?, ?, ?, ?, ?)`);
    const getShotId = db.prepare(
      'SELECT id FROM footage_shots WHERE footage_id = ? AND shot_idx = ?');
    const insertAnalysis = db.prepare(
      `INSERT OR REPLACE INTO footage_shot_analysis
       (shot_id, description, tags, model, tier, sharpness, frame_time_s, empty_retries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const seg of scan.segments) {
      insertShot.run(row.id, seg.idx, seg.start, seg.end, scan.detect_source);
      const shotRow = getShotId.get(row.id, seg.idx);
      if (!shotRow) continue;
      if (!seg.frames_b64 || seg.frames_b64.length === 0) continue;

      const result = await vlm.describeFrames(seg.frames_b64, DEFAULT_PROMPT, { tier });
      let description = result.text;
      let tags = null;
      const tagMatch = description.match(/TAGS:\s*(.+)$/im);
      if (tagMatch) {
        tags = tagMatch[1].trim();
        description = description.replace(/TAGS:\s*.+$/im, '').trim();
      }
      insertAnalysis.run(
        shotRow.id, description, tags, result.model, tier,
        seg.best_sharpness, seg.best_frame_time, result.retries);
      state.segmentsLogged++;
      if (!result.text) state.emptyDescriptions++;

      // V2: semantic vector for this shot (CPU embedder; soft-fails clean)
      if (description && db.isVecLoaded()) {
        try {
          const vec = await embed.embedText(`${description} ${tags || ''}`, 'document');
          if (vec) {
            db.getRawDb().prepare(
              'INSERT OR REPLACE INTO shot_vec (rowid, embedding) VALUES (?, ?)'
            ).run(BigInt(shotRow.id), vec);
          }
        } catch (e) {
          logger.warn({ shot_id: shotRow.id, err: e.message }, '[shot-worker] embed skipped');
        }
      }
    }
    logger.info({ footage_id: row.id, segments: scan.segments.length },
      '[shot-worker] footage logged');

    // THE CLASSIFIER SWAP: clip-level classification synthesized from the ledger
    // (replaces the 3-thumbnails→Claude flow). Fills ONLY empty fields — human
    // labels are law and are never overwritten.
    try {
      await synthesizeClipSummary(row);
    } catch (e) {
      logger.warn({ footage_id: row.id, err: e.message }, '[shot-worker] synthesis skipped');
    }
  } catch (err) {
    logger.error({ footage_id: row.id, err: err.message }, '[shot-worker] failed');
    state.errors.push({ footage_id: row.id, error: err.message });
  } finally {
    state.current = state.current.filter(id => id !== row.id);
    state.done++;
  }
}

/**
 * synthesizeClipSummary(row) — derive clip-level classification from the shot
 * ledger via one local TEXT call ($0). Only fills fields the human hasn't set.
 */
async function synthesizeClipSummary(row) {
  const needsType = !row.shot_type;
  const needsDesc = !row.description;
  const needsSubj = !row.subjects;
  if (!needsType && !needsDesc && !needsSubj) return;

  const segs = db.prepare(
    `SELECT s.start_s, s.end_s, a.description
     FROM footage_shots s JOIN footage_shot_analysis a ON a.shot_id = s.id
     WHERE s.footage_id = ? AND a.description IS NOT NULL AND a.description != ''
     ORDER BY s.shot_idx LIMIT 40`).all(row.id);
  if (segs.length === 0) return;

  const ledgerText = segs.map(s =>
    `[${Math.round(s.start_s)}-${Math.round(s.end_s)}s] ${s.description}`).join('\n');
  const prompt =
    'Below is a per-segment shot log of one video clip. Reply with ONLY a JSON object:\n' +
    '{"shot_type":"b-roll|talking-head|dialogue|action|completed-video",' +
    '"description":"one 2-sentence clip summary",' +
    '"subjects":["up to 8 short subject tags"]}\n\nSHOT LOG:\n' + ledgerText;

  const r = await vlm.askText(prompt, { budgets: [500, 1200, 2000] });
  if (!r.text) return;
  let parsed;
  try {
    parsed = JSON.parse(r.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, ''));
  } catch (_) {
    return; // malformed synthesis is a no-op, never a corruption
  }
  const VALID_TYPES = new Set(['b-roll', 'talking-head', 'dialogue', 'action', 'completed-video']);
  const updates = {};
  if (needsType && VALID_TYPES.has(parsed.shot_type)) updates.shot_type = parsed.shot_type;
  if (needsDesc && typeof parsed.description === 'string' && parsed.description.trim())
    updates.description = parsed.description.trim();
  if (needsSubj && Array.isArray(parsed.subjects) && parsed.subjects.length)
    updates.subjects = JSON.stringify(parsed.subjects.slice(0, 8).map(String));
  if (Object.keys(updates).length) {
    db.updateFootage(row.id, updates);
    logger.info({ footage_id: row.id, fields: Object.keys(updates) },
      '[shot-worker] clip summary synthesized from ledger');
  }
}

/**
 * Backfill: shot-log up to `limit` footage rows that have no shots yet.
 * Fire-and-forget from the route; poll getStatus() for progress.
 */
async function runBackfill({ limit = 10, tier = 'triage', shotTypes = null } = {}) {
  if (state.running) throw new Error('shot worker already running');
  const typeFilter = shotTypes && shotTypes.length
    ? `AND f.shot_type IN (${shotTypes.map(() => '?').join(',')})`
    : '';
  const rows = db.prepare(
    `SELECT f.* FROM footage f
     LEFT JOIN footage_shots s ON s.footage_id = f.id
     WHERE s.id IS NULL
       AND COALESCE(f.shot_type, '') != 'unusable'
       ${typeFilter}
     GROUP BY f.id
     ORDER BY f.id DESC
     LIMIT ?`).all(...(shotTypes || []), limit);

  const server = await vlm.ensureServer(tier);
  if (!server.ok) throw new Error(`Farmhand unavailable: ${server.reason}`);
  const effectiveTier = server.tier === 'external' ? tier : server.tier;

  // Embedding server is nice-to-have — vectors backfill later if it's down
  if (db.isVecLoaded()) {
    const e = await embed.ensureServer();
    if (!e.ok) logger.warn({ reason: e.reason }, '[shot-worker] embeddings offline this run');
  }

  Object.assign(state, {
    running: true, total: rows.length, done: 0, segmentsLogged: 0,
    emptyDescriptions: 0, current: [], errors: [],
    startedAt: new Date().toISOString(),
  });

  (async () => {
    const queue = [...rows];
    const workers = Array.from({ length: CONCURRENT_DETECT }, async () => {
      while (queue.length) {
        const row = queue.shift();
        if (row) await processFootage(row, effectiveTier);
      }
    });
    await Promise.all(workers);
    state.running = false;
    logger.info({ done: state.done, segments: state.segmentsLogged,
      empty: state.emptyDescriptions, errors: state.errors.length },
      '[shot-worker] backfill complete');
  })().catch(err => {
    state.running = false;
    logger.error({ err: err.message }, '[shot-worker] backfill crashed');
  });

  return { queued: rows.length, tier: effectiveTier };
}

function getStatus() {
  return { ...state };
}

// Auto-backfill after ingest: debounced 90s so a folder drop of 40 clips
// triggers ONE run after the dust settles, not 40. Silent no-op when the
// worker is already running or the Farmhand can't get VRAM — pending rows
// are picked up by the next run either way (the LEFT JOIN is the queue).
let _autoTimer = null;
function scheduleAutoBackfill() {
  if (_autoTimer) clearTimeout(_autoTimer);
  _autoTimer = setTimeout(async () => {
    _autoTimer = null;
    if (state.running) return;
    try {
      const r = await runBackfill({ limit: 100, tier: 'triage' });
      logger.info(r, '[shot-worker] auto-backfill after ingest');
    } catch (err) {
      logger.info({ err: err.message }, '[shot-worker] auto-backfill deferred');
    }
  }, 90_000);
}

module.exports = { runBackfill, processFootage, synthesizeClipSummary, scheduleAutoBackfill, getStatus };
