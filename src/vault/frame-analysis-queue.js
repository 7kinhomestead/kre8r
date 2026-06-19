/**
 * VaultΩr Frame Analysis Queue — src/vault/frame-analysis-queue.js
 *
 * Background queue that extracts sample frames from talking-head clips and
 * sends them to Claude Vision for editorial analysis. Runs independently of
 * and in parallel with the transcription queue.
 *
 * What it produces per clip (stored as footage.visual_description JSON):
 *   - overall_quality: hero | strong | usable | review
 *   - eye_contact_consistency: direct | mostly_direct | wandering | off_camera
 *   - energy_arc: builds | flat | drops | variable
 *   - peak_energy_range: { start_pct, end_pct } — where delivery is strongest
 *   - physical_demonstration: bool + description — b-roll anchor point signal
 *   - lighting_quality: excellent | good | acceptable | poor
 *   - posture_energy: animated | neutral | slumped | moving
 *   - recommended_start_pct / end_pct: auto-trim hints
 *   - editorial_notes: free-text editorial summary
 *
 * Design:
 *   - Concurrency: 1 live (watcher-triggered), up to MAX_BATCH_CONCURRENT for batch
 *   - Checks visual_analyzed_at — skips already-analyzed clips unless force=true
 *   - Per-job model override: live uses FRAME_ANALYSIS_MODEL, batch uses BATCH_ANALYSIS_MODEL
 *   - Always uses proxy_path over file_path; skips undecoded RAW formats
 *   - SSE broadcast to any connected vault clients (same pattern as transcribe-queue)
 *   - Frame temps land in os.tmpdir() and are deleted after the API call
 *
 * Models:
 *   - Live:  FRAME_ANALYSIS_MODEL env var (default: claude-opus-4-5) — best editorial judgment
 *   - Batch: BATCH_ANALYSIS_MODEL env var (default: claude-haiku-4-5) — fast & cheap backfill
 */

'use strict';

const ffmpeg       = require('fluent-ffmpeg');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');
const EventEmitter = require('events');

const db     = require('../db');
const logger = require('../utils/logger');
const { getCreatorContext } = require('../utils/creator-context');

if (process.env.FFMPEG_PATH)  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

const ANTHROPIC_VERSION    = '2023-06-01';
const FRAME_ANALYSIS_MODEL = process.env.FRAME_ANALYSIS_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const BATCH_ANALYSIS_MODEL = process.env.BATCH_ANALYSIS_MODEL || 'claude-haiku-4-5';
const MAX_BATCH_CONCURRENT = parseInt(process.env.FRAME_BATCH_CONCURRENCY || '3', 10);

const RAW_EXTENSIONS = new Set(['.braw', '.r3d', '.ari']);

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

let jobCounter  = 0;
const jobs      = new Map();   // jobId → job
const pending   = [];          // ordered jobIds
let activeCount = 0;           // how many jobs are currently running

const sseClients = new Set();

// ─────────────────────────────────────────────
// SSE BROADCAST
// ─────────────────────────────────────────────

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    if (!res.writableEnded) res.write(payload);
    else sseClients.delete(res);
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getQueueStatus() {
  const allJobs = Array.from(jobs.values()).sort((a, b) => a.queued_at - b.queued_at);
  const active  = allJobs.filter(j => j.status === 'processing');
  return {
    active_count:  activeCount,
    pending_count: pending.length,
    total_jobs:    allJobs.length,
    active_jobs:   active,
    // legacy singular — kept for backwards compat with existing UI
    active_job:    active[0] || null,
    recent:        allJobs.slice(-20).reverse()
  };
}

/** Get the best decodable file path — proxy beats raw, skip undecoded RAW formats. */
function getDecodablePath(record) {
  if (record.proxy_path) {
    const p = record.proxy_path.replace(/\//g, path.sep);
    if (fs.existsSync(p)) return p;
  }
  const fp  = (record.file_path || '').replace(/\//g, path.sep);
  const ext = path.extname(fp).toLowerCase();
  if (RAW_EXTENSIONS.has(ext)) return null; // cannot decode BRAW without DaVinci
  return fs.existsSync(fp) ? fp : null;
}

/**
 * Calculate frame sample timestamps for a clip.
 * - Under 2 min:  every 15s, max 8 frames
 * - 2–10 min:     every 30s, max 20 frames
 * - Over 10 min:  every 60s, max 20 frames
 */
function frameSampleOffsets(duration) {
  if (!duration || duration <= 0) return [duration * 0.25, duration * 0.50, duration * 0.75].filter(Boolean);

  let interval;
  if (duration < 120)  interval = 15;
  else if (duration < 600) interval = 30;
  else interval = 60;

  const offsets = [];
  for (let t = interval; t < duration - 1; t += interval) {
    offsets.push(parseFloat(t.toFixed(1)));
    if (offsets.length >= 20) break;
  }

  // Always include a frame near the start and end
  if (offsets.length === 0 || offsets[0] > 5) offsets.unshift(Math.min(3, duration * 0.05));
  const nearEnd = Math.max(duration - 5, duration * 0.90);
  if (offsets[offsets.length - 1] < nearEnd) offsets.push(parseFloat(nearEnd.toFixed(1)));

  return offsets.slice(0, 20);
}

/**
 * Extract a single JPEG frame at `offset` seconds from `filePath`.
 * Saves to `outPath`. Returns true on success.
 */
function extractFrame(filePath, offset, outPath) {
  return new Promise((resolve) => {
    ffmpeg(filePath)
      .screenshots({
        timestamps: [Math.max(0, offset)],
        filename:   path.basename(outPath),
        folder:     path.dirname(outPath),
        size:       '640x?'
      })
      .on('end',   () => resolve(true))
      .on('error', () => resolve(false));
  });
}

// ─────────────────────────────────────────────
// CLAUDE VISION — FRAME ANALYSIS CALL
// ─────────────────────────────────────────────

function buildFrameAnalysisPrompt(frameCount, intervalSeconds, durationSeconds, creatorCtx) {
  return `You are a video editor analyzing ${frameCount} frames sampled every ${intervalSeconds}s across a ${Math.round(durationSeconds)}s talking-head clip by ${creatorCtx.creatorName || creatorCtx.brand} (${creatorCtx.niche} creator).

Analyze the FULL SET of frames together to assess this clip's editorial value for a polished YouTube video.

Return ONLY this JSON — no explanation, no markdown:
{
  "overall_quality": "hero | strong | usable | review",
  "eye_contact_consistency": "direct | mostly_direct | wandering | off_camera",
  "energy_arc": "builds | flat | drops | variable",
  "peak_energy_range": { "start_pct": 0, "end_pct": 100 },
  "physical_demonstration": false,
  "demonstration_description": null,
  "background_consistency": "consistent | varied",
  "lighting_quality": "excellent | good | acceptable | poor",
  "lighting_issues": null,
  "speaker_visible_pct": 95,
  "posture_energy": "animated | neutral | slumped | moving",
  "recommended_start_pct": 0,
  "recommended_end_pct": 100,
  "editorial_notes": "1-2 sentences — what makes this clip editorially notable or problematic"
}

Guidelines:
- overall_quality: "hero" = exceptional delivery, lighting, and eye contact. "review" = visible problems need editor eyes.
- eye_contact_consistency: is the speaker looking INTO the camera lens, or off to the side / down at notes?
- energy_arc: does delivery energy increase (builds), stay flat, decrease (drops), or vary unpredictably?
- peak_energy_range: percentage window (0–100) of the clip where energy and engagement are highest — this is where the best usable material lives.
- physical_demonstration: true if the speaker is showing, building, holding, or handling something physical (a tool, plant, structure, food, animal). Set demonstration_description to a specific description of what is being shown.
- recommended_start_pct / end_pct: if you see dead air, gear adjustment, or cleanup at clip edges, trim them (e.g. start_pct: 5 = skip first 5% of clip). Use 0 and 100 if the clip is clean.
- speaker_visible_pct: percentage of frames where the speaker is clearly in frame and visible.
- editorial_notes: the single most useful thing an editor should know about this clip.`;
}

async function analyzeFrames(filePath, duration, footageId, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');
  const creatorCtx = getCreatorContext();

  // Calculate sample offsets
  const offsets = frameSampleOffsets(duration);
  const tmpDir  = path.join(os.tmpdir(), `kre8r-frames-${footageId}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Extract frames
  const extracted = [];
  for (let i = 0; i < offsets.length; i++) {
    const outPath = path.join(tmpDir, `frame_${String(i).padStart(3, '0')}.jpg`);
    const ok = await extractFrame(filePath, offsets[i], outPath);
    if (ok && fs.existsSync(outPath)) {
      extracted.push({ offset: offsets[i], filePath: outPath });
    }
  }

  if (extracted.length === 0) {
    throw new Error('No frames could be extracted from clip');
  }

  // Build content array: frames first, then the prompt
  const content = [];
  for (const frame of extracted) {
    const imageData = fs.readFileSync(frame.filePath).toString('base64');
    content.push({
      type:   'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
    });
  }

  // Calculate representative interval for the prompt
  const intervalSeconds = extracted.length > 1
    ? Math.round((extracted[extracted.length - 1].offset - extracted[0].offset) / (extracted.length - 1))
    : Math.round(duration / 4);

  content.push({
    type: 'text',
    text: buildFrameAnalysisPrompt(extracted.length, intervalSeconds, duration, creatorCtx)
  });

  // Cleanup temp frames (best-effort, don't block)
  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  };

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model:      model || FRAME_ANALYSIS_MODEL,
        max_tokens: 1024,
        messages:   [{ role: 'user', content }]
      })
    });
  } finally {
    cleanup();
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data    = await response.json();
  const raw     = data.content[0].text;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

// ─────────────────────────────────────────────
// ENQUEUE
// ─────────────────────────────────────────────

/**
 * Enqueue a footage item for frame analysis.
 * @param {number}  footageId
 * @param {string}  filePath   — decodable file path (proxy preferred)
 * @param {string}  [label]    — display label for UI
 * @param {boolean} [force]    — re-analyze even if already done
 * @param {string}  [model]    — override model (e.g. BATCH_ANALYSIS_MODEL)
 * @param {boolean} [batch]    — marks job as batch (shown differently in UI)
 */
function enqueue(footageId, filePath, label = null, force = false, model = null, batch = false) {
  if (!footageId || !filePath) return { ok: false, reason: 'missing footage_id or file_path' };

  // Check DB — already analyzed?
  try {
    const record = db.getFootageById(footageId);
    if (!force && record?.visual_analyzed_at) {
      return { ok: false, reason: 'already analyzed', footage_id: footageId };
    }
    // Resolve the best decodable path from DB record
    const decodable = getDecodablePath(record || { file_path: filePath });
    if (!decodable) return { ok: false, reason: 'no decodable file available (BRAW without proxy?)' };
    filePath = decodable;
  } catch (e) {
    logger.warn({ err: e, footageId }, '[FrameQueue] DB check failed');
  }

  // Already in queue?
  for (const [, job] of jobs) {
    if (job.footage_id === footageId && (job.status === 'pending' || job.status === 'processing')) {
      return { ok: false, reason: 'already in queue', job_id: job.id };
    }
  }

  const jobId = `faq_${++jobCounter}_${footageId}`;
  const job = {
    id:           jobId,
    footage_id:   footageId,
    file_path:    filePath,
    label:        label || path.basename(filePath),
    model:        model || FRAME_ANALYSIS_MODEL,
    batch:        !!batch,
    status:       'pending',
    queued_at:    Date.now(),
    started_at:   null,
    completed_at: null,
    error:        null,
  };
  jobs.set(jobId, job);
  pending.push(jobId);

  logger.info({ footageId, file: path.basename(filePath), model: job.model, batch }, '[FrameQueue] Enqueued for frame analysis');
  broadcast({ type: 'frame_enqueued', job: _safeJob(job), queue: getQueueStatus() });

  setImmediate(processNext);
  return { ok: true, job_id: jobId };
}

/**
 * Batch enqueue: loads unanalyzed footage from DB and queues all of them.
 * Uses BATCH_ANALYSIS_MODEL (Haiku) to keep costs low.
 * @param {object} opts
 * @param {string[]} [opts.shot_types]  — defaults to ['talking-head']
 * @param {number}   [opts.project_id]
 * @param {number}   [opts.limit]       — max clips to load per call (default 200)
 * @param {boolean}  [opts.force]       — re-queue already-analyzed clips
 * @param {string}   [opts.model]       — override model (default: BATCH_ANALYSIS_MODEL)
 */
function enqueueBatch({ shot_types, project_id, limit = 200, force = false, model } = {}) {
  const batchModel = model || BATCH_ANALYSIS_MODEL;
  const types      = shot_types || ['talking-head'];

  // When force=true we can't use getUnanalyzedFootage filter — get all instead
  let records;
  if (force) {
    // Fetch more than limit then filter by type, since getAllFootage only accepts a single shot_type
    const raw = db.getAllFootage({ project_id, limit: limit * 3 });
    records   = raw.filter(r => types.includes(r.shot_type)).slice(0, limit);
  } else {
    records = db.getUnanalyzedFootage({ shot_types: types, project_id, limit });
  }

  let queued = 0;
  let skipped = 0;
  for (const rec of records) {
    const decodable = getDecodablePath(rec);
    if (!decodable) { skipped++; continue; }
    const result = enqueue(rec.id, decodable, rec.original_filename || null, force, batchModel, true);
    if (result.ok) queued++;
    else skipped++;
  }

  logger.info({ queued, skipped, model: batchModel }, '[FrameQueue] Batch enqueue complete');
  broadcast({ type: 'frame_batch_started', queued, skipped, model: batchModel, queue: getQueueStatus() });

  return { ok: true, queued, skipped, model: batchModel };
}

// ─────────────────────────────────────────────
// PROCESS LOOP — supports concurrent workers
// ─────────────────────────────────────────────

function maxConcurrent() {
  // If any active job is a live (non-batch) job → 1 slot only
  // Once all active are batch → allow up to MAX_BATCH_CONCURRENT
  const hasLive = Array.from(jobs.values()).some(j => j.status === 'processing' && !j.batch);
  return hasLive ? 1 : MAX_BATCH_CONCURRENT;
}

async function processNext() {
  if (pending.length === 0) return;
  if (activeCount >= maxConcurrent()) return;

  const jobId = pending.shift();
  const job   = jobs.get(jobId);
  if (!job) { setImmediate(processNext); return; }

  activeCount++;
  job.status     = 'processing';
  job.started_at = Date.now();

  logger.info({ jobId, footage_id: job.footage_id, model: job.model }, '[FrameQueue] Starting frame analysis');
  broadcast({ type: 'frame_started', job: _safeJob(job), queue: getQueueStatus() });

  // Kick off next slot immediately — we support concurrency
  setImmediate(processNext);

  try {
    // Get duration from DB record for frame sampling
    const record   = db.getFootageById(job.footage_id);
    const duration = record?.duration || 60; // fallback 60s if unknown

    const result = await analyzeFrames(job.file_path, duration, job.footage_id, job.model);

    // Store to DB
    db.updateFootage(job.footage_id, {
      visual_description:  JSON.stringify(result),
      visual_analyzed_at:  new Date().toISOString(),
    });

    job.status       = 'done';
    job.completed_at = Date.now();
    job.result       = result;

    logger.info({
      jobId,
      footage_id:      job.footage_id,
      overall_quality: result.overall_quality,
      eye_contact:     result.eye_contact_consistency,
      model:           job.model,
    }, '[FrameQueue] Frame analysis complete');

    broadcast({ type: 'frame_done', job: _safeJob(job), queue: getQueueStatus() });

  } catch (err) {
    job.status       = 'error';
    job.error        = err.message;
    job.completed_at = Date.now();

    logger.error({ jobId, footage_id: job.footage_id, err }, '[FrameQueue] Frame analysis failed');
    broadcast({ type: 'frame_error', job: _safeJob(job), queue: getQueueStatus() });

  } finally {
    activeCount--;
    // 1s breath between jobs — helps with API rate limits
    setTimeout(processNext, 1000);
  }
}

// ─────────────────────────────────────────────
// SSE CONNECT
// ─────────────────────────────────────────────

function connectSse(res) {
  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'frame_status', queue: getQueueStatus() })}\n\n`);
  res.on('close', () => sseClients.delete(res));
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _safeJob(job) {
  const { result: _r, ...rest } = job;
  return rest;
}

module.exports = {
  enqueue,
  enqueueBatch,
  getQueueStatus,
  connectSse,
  getDecodablePath,
  BATCH_ANALYSIS_MODEL,
  FRAME_ANALYSIS_MODEL,
};
