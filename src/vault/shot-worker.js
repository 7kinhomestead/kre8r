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
    }
    logger.info({ footage_id: row.id, segments: scan.segments.length },
      '[shot-worker] footage logged');
  } catch (err) {
    logger.error({ footage_id: row.id, err: err.message }, '[shot-worker] failed');
    state.errors.push({ footage_id: row.id, error: err.message });
  } finally {
    state.current = state.current.filter(id => id !== row.id);
    state.done++;
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

module.exports = { runBackfill, processFootage, getStatus };
