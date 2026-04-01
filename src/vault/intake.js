/**
 * VaultΩr Intake Pipeline — src/vault/intake.js
 *
 * Accepts a folder path, finds all video files, extracts metadata + three
 * thumbnails via ffprobe/ffmpeg, classifies each clip with Claude Vision
 * (all three frames in one call), and writes everything to the footage table.
 *
 * Thumbnail strategy:
 *   Thumb A — 10% of duration (or 2s for clips under 10s)
 *   Thumb B — 50% of duration (or 5s for clips under 10s)  ← display thumbnail
 *   Thumb C — 80% of duration (or 8s for clips under 10s)
 *   All three are sent to Claude Vision together. Middle frame (B) is stored
 *   as the display thumbnail. All three files are kept on disk.
 *
 * Resilience: one bad file never aborts the whole batch.
 */

'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const db = require('../db');

if (process.env.FFMPEG_PATH)  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov', '.mts', '.avi', '.mkv', '.braw', '.r3d', '.ari']);
const RAW_EXTENSIONS        = new Set(['.braw', '.r3d', '.ari']);
const BRAW_EXTENSIONS       = new Set(['.braw']); // Blackmagic RAW — no ffprobe at all, proxy-only workflow
const THUMBNAIL_DIR         = path.join(__dirname, '..', '..', 'public', 'thumbnails');
const ANTHROPIC_VERSION     = '2023-06-01';
const MODEL                 = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

// ─────────────────────────────────────────────
// VISION RATE LIMIT QUEUE
// Max 3 concurrent Vision API calls.
// After each slot is released, waits BATCH_DELAY_MS before the next call
// starts — prevents bursting all 3 at the exact same millisecond.
// ─────────────────────────────────────────────

const VISION_CONCURRENCY  = 3;
const BATCH_DELAY_MS      = 1000;

class VisionQueue {
  constructor(concurrency, batchDelay) {
    this.concurrency = concurrency;
    this.batchDelay  = batchDelay;
    this.active      = 0;
    this.queue       = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._tick();
    });
  }

  _tick() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(fn)
        .then(result => { resolve(result); this._release(); })
        .catch(err   => { reject(err);    this._release(); });
    }
  }

  _release() {
    this.active--;
    setTimeout(() => this._tick(), this.batchDelay);
  }
}

const visionQueue = new VisionQueue(VISION_CONCURRENCY, BATCH_DELAY_MS);

// ─────────────────────────────────────────────
// RETRY WITH EXPONENTIAL BACKOFF
// ─────────────────────────────────────────────

async function withRetry(fn, maxRetries = 3, baseDelayMs = 2000) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 2s, 4s, 8s
        console.warn(`[VaultΩr] Vision attempt ${attempt + 1} failed: ${err.message} — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────
// FFMPEG AVAILABILITY CHECK
// ─────────────────────────────────────────────

function checkFfmpeg() {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => resolve(!err));
  });
}

// ─────────────────────────────────────────────
// FILE DISCOVERY
// ─────────────────────────────────────────────

function findVideoFiles(folderPath) {
  const results = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) results.push(full);
      }
    }
  }
  walk(folderPath);
  return results;
}

// ─────────────────────────────────────────────
// FFPROBE — METADATA EXTRACTION
// ─────────────────────────────────────────────

function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

function parseMetadata(filePath, metadata) {
  const fmt     = metadata.format || {};
  const vStream = (metadata.streams || []).find(s => s.codec_type === 'video');

  const duration  = parseFloat(fmt.duration) || null;
  const file_size = parseInt(fmt.size, 10)   || fs.statSync(filePath).size;
  const width     = vStream?.width;
  const height    = vStream?.height;
  const resolution = (width && height) ? `${width}x${height}` : null;
  const codec      = vStream?.codec_name || null;
  const creation_timestamp =
    fmt.tags?.creation_time || vStream?.tags?.creation_time || null;

  return { duration, file_size, resolution, codec, creation_timestamp };
}

function fallbackMetadata(filePath) {
  const stat = fs.statSync(filePath);
  return {
    duration:           null,
    file_size:          stat.size,
    resolution:         null,
    codec:              path.extname(filePath).slice(1).toUpperCase(),
    creation_timestamp: stat.birthtime?.toISOString() || stat.mtime?.toISOString() || null
  };
}

// ─────────────────────────────────────────────
// FFMPEG — THREE-THUMBNAIL EXTRACTION
// ─────────────────────────────────────────────

function thumbnailSlug(filePath) {
  return crypto.createHash('md5').update(path.resolve(filePath)).digest('hex');
}

/**
 * Calculate the three time offsets for a clip.
 * Clips under 10s use fixed marks; longer clips use percentages.
 * All marks are clamped to within 0.5s of clip end.
 */
function thumbnailOffsets(duration) {
  if (!duration || duration < 10) {
    // Fixed marks for short clips — clamped to actual duration
    const clamp = (t) => duration ? Math.min(t, duration - 0.5) : t;
    return [clamp(2), clamp(5), clamp(8)];
  }
  return [duration * 0.10, duration * 0.50, duration * 0.80];
}

/**
 * Extract a single thumbnail at `timeOffset` seconds into `filePath`.
 * Saves to `outPath`. No-ops if the file already exists.
 */
function extractOneThumbnail(filePath, timeOffset, outPath) {
  if (fs.existsSync(outPath)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .screenshots({
        timestamps: [Math.max(0, timeOffset)],
        filename:   path.basename(outPath),
        folder:     path.dirname(outPath),
        size:       '640x?'
      })
      .on('end', resolve)
      .on('error', reject);
  });
}

/**
 * Extract all three thumbnails for a clip.
 * Returns { a, b, c } — each with { path, url } — and { displayPath, displayUrl }
 * pointing to thumbnail B (the middle frame).
 * On failure, returns null.
 */
async function extractThumbnails(filePath, duration) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

  const slug    = thumbnailSlug(filePath);
  const offsets = thumbnailOffsets(duration);
  const labels  = ['a', 'b', 'c'];

  const thumbs = labels.map((label, i) => ({
    label,
    offset: offsets[i],
    filePath: path.join(THUMBNAIL_DIR, `${slug}_thumb_${label}.jpg`),
    url:      `/thumbnails/${slug}_thumb_${label}.jpg`
  }));

  // Extract all three — individual failures are tolerated
  let anySuccess = false;
  for (const t of thumbs) {
    try {
      await extractOneThumbnail(filePath, t.offset, t.filePath);
      anySuccess = true;
    } catch (e) {
      // Mark as missing; Vision will receive whichever frames succeeded
      t.failed = true;
    }
  }

  if (!anySuccess) return null;

  // Thumb B (index 1) is the display thumbnail
  const display = thumbs[1].failed ? thumbs.find(t => !t.failed) : thumbs[1];

  return {
    a:           thumbs[0],
    b:           thumbs[1],
    c:           thumbs[2],
    displayPath: display?.filePath || null,
    displayUrl:  display?.url      || null
  };
}

// ─────────────────────────────────────────────
// CLAUDE VISION — MULTI-IMAGE CLASSIFICATION
// ─────────────────────────────────────────────

const VISION_PROMPT = `You are analyzing three thumbnails from different points in a video clip (early, middle, late) from a homesteading and off-grid living content creator (7 Kin Homestead). Use all three frames together to make your classification — do not judge on any single frame alone. A blurry early frame with sharp middle and late frames is a usable or hero clip, not a discard. Return ONLY a JSON object:
{
  "shot_type": "one of: dialogue, talking-head, b-roll, action, unusable",
  "subcategory": "one of: wide, medium, close-up, detail, null — only for b-roll, null for all others",
  "description": "1-2 sentences describing what is visible across the three frames — specific and search-useful",
  "quality_flag": "one of: hero, usable, review, discard",
  "quality_reason": "one sentence explaining the flag",
  "orientation": "one of: horizontal, vertical, square"
}
Be specific in descriptions. 'Person talking in front of trees' is not useful. 'Creator in grey shirt speaking to camera, outdoor background with forest visible, good lighting' is useful.`;

async function classifyWithVision(thumbs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');

  // Build content array: up to three images followed by the prompt text.
  // Skip any thumb that failed extraction.
  const content = [];
  for (const t of [thumbs.a, thumbs.b, thumbs.c]) {
    if (!t || t.failed || !fs.existsSync(t.filePath)) continue;
    const imageData = fs.readFileSync(t.filePath).toString('base64');
    content.push({
      type:   'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
    });
  }

  if (content.length === 0) throw new Error('No thumbnail images available for Vision');

  content.push({ type: 'text', text: VISION_PROMPT });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 512,
      messages:   [{ role: 'user', content }]
    })
  });

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
// SINGLE FILE PROCESSOR
// ─────────────────────────────────────────────

async function processFile(filePath, options = {}) {
  const { projectId = null, onProgress = null } = options;
  const original_filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Skip duplicates
  if (db.footageFilePathExists(filePath)) {
    return { file: filePath, status: 'skipped', reason: 'already ingested' };
  }

  // ── BRAW fast path: no ffprobe, no thumbnails, no Vision ──────────────────
  // BRAW is Blackmagic RAW — proprietary codec, ffmpeg cannot decode it.
  // Write a minimal record immediately; proxy export via DaVinci generates
  // the actual working file. The proxy will update this record on ingest.
  if (BRAW_EXTENSIONS.has(ext)) {
    const stat = fs.statSync(filePath);
    const id = db.insertFootage({
      project_id:         projectId,
      file_path:          filePath,
      original_filename,
      shot_type:          'b-roll',
      subcategory:        null,
      description:        'BRAW source — proxy export required before classification',
      quality_flag:       'review',
      orientation:        null,
      duration:           null,
      resolution:         null,
      codec:              'BRAW',
      file_size:          stat.size,
      creation_timestamp: stat.birthtime?.toISOString() || stat.mtime?.toISOString() || null,
      thumbnail_path:     null,
      organized_path:     null,
      used_in:            '[]',
      braw_source_path:   filePath,
      is_proxy:           false
    });
    onProgress?.({ stage: 'saved', file: original_filename, id, braw: true });
    return { id, file: filePath, status: 'ok', braw: true, shot_type: 'b-roll', quality_flag: 'review', orientation: null, thumb: null };
  }

  // ── Proxy detection: check if this matches a known BRAW source ────────────
  // Proxy naming convention: [original_braw_name]_proxy.mp4 or _proxy.mov
  // DaVinci Resolve exports QuickTime (.mov) by default; MP4 is also supported.
  const isProxy = /_proxy\.(mp4|mov)$/i.test(original_filename);
  if (isProxy) {
    const brawBasename = original_filename.replace(/_proxy\.(mp4|mov)$/i, '.braw');
    const brawRecord = db.findBrawByBasename?.(brawBasename) || null;
    if (brawRecord) {
      return await processProxyUpdate(filePath, brawRecord, { projectId, onProgress });
    }
    // No matching BRAW found — ingest as a regular clip record
  }

  // ── Standard pipeline: ffprobe → thumbnails → Vision → insert ─────────────
  const isRaw = RAW_EXTENSIONS.has(ext);
  let meta;
  try {
    const raw = await probeFile(filePath);
    meta = parseMetadata(filePath, raw);
  } catch (e) {
    if (isRaw) {
      console.warn(`[VaultΩr] ffprobe could not read ${original_filename} (${ext.slice(1).toUpperCase()} — no native decoder). Using filesystem metadata.`);
      meta = fallbackMetadata(filePath);
    } else {
      return { file: filePath, status: 'error', stage: 'ffprobe', error: e.message };
    }
  }

  onProgress?.({ stage: 'probed', file: original_filename, meta });

  // ── 2. Three thumbnails ──────────────────────
  let thumbs = null;
  try {
    thumbs = await extractThumbnails(filePath, meta.duration);
  } catch (e) {
    console.warn(`[VaultΩr] Thumbnails skipped for ${original_filename}: ${e.message}`);
  }

  onProgress?.({ stage: 'thumbnail', file: original_filename, displayUrl: thumbs?.displayUrl });

  // ── 3. Claude Vision ────────────────────────
  let classification = {};
  if (thumbs) {
    try {
      classification = await visionQueue.run(() => withRetry(() => classifyWithVision(thumbs)));
    } catch (e) {
      console.warn(`[VaultΩr] Vision failed for ${original_filename} after retries: ${e.message}`);
    }
  }

  onProgress?.({ stage: 'classified', file: original_filename, classification });

  // ── 4. DB insert ─────────────────────────────
  const id = db.insertFootage({
    project_id:         projectId,
    file_path:          filePath,
    original_filename,
    shot_type:          classification.shot_type    || null,
    subcategory:        classification.subcategory  || null,
    description:        classification.description  || null,
    quality_flag:       classification.quality_flag || null,
    orientation:        classification.orientation  || null,
    duration:           meta.duration,
    resolution:         meta.resolution,
    codec:              meta.codec,
    file_size:          meta.file_size,
    creation_timestamp: meta.creation_timestamp,
    thumbnail_path:     thumbs?.displayUrl || null,
    organized_path:     null,
    used_in:            '[]',
    braw_source_path:   null,
    is_proxy:           isProxy ? true : false
  });

  onProgress?.({ stage: 'saved', file: original_filename, id });

  return {
    id,
    file:         filePath,
    status:       'ok',
    shot_type:    classification.shot_type    || null,
    quality_flag: classification.quality_flag || null,
    orientation:  classification.orientation  || null,
    thumb:        thumbs?.displayUrl || null
  };
}

/**
 * A _proxy.mp4 matched a known BRAW record.
 * Run the full pipeline on the proxy, then update the original BRAW record
 * with the metadata + thumbnails so it becomes a fully classified clip.
 */
async function processProxyUpdate(proxyPath, brawRecord, options = {}) {
  const { projectId = null, onProgress = null } = options;
  const original_filename = path.basename(proxyPath);

  let meta;
  try {
    const raw = await probeFile(proxyPath);
    meta = parseMetadata(proxyPath, raw);
  } catch (e) {
    return { file: proxyPath, status: 'error', stage: 'ffprobe', error: e.message };
  }

  let thumbs = null;
  try { thumbs = await extractThumbnails(proxyPath, meta.duration); } catch(e) {}

  let classification = {};
  if (thumbs) {
    try {
      classification = await visionQueue.run(() => withRetry(() => classifyWithVision(thumbs)));
    } catch(e) {
      console.warn(`[VaultΩr] Vision failed for proxy ${path.basename(proxyPath)} after retries: ${e.message}`);
    }
  }

  // Update the original BRAW record (not the proxy path) with all the good data
  db.updateFootage(brawRecord.id, {
    shot_type:          classification.shot_type    || brawRecord.shot_type,
    subcategory:        classification.subcategory  || null,
    description:        classification.description  || brawRecord.description,
    quality_flag:       classification.quality_flag || brawRecord.quality_flag,
    orientation:        classification.orientation  || null,
    duration:           meta.duration,
    resolution:         meta.resolution,
    codec:              meta.codec,
    file_size:          brawRecord.file_size,        // keep original BRAW size
    creation_timestamp: meta.creation_timestamp || brawRecord.creation_timestamp,
    thumbnail_path:     thumbs?.displayUrl || null
  });

  onProgress?.({ stage: 'saved', file: original_filename, id: brawRecord.id, proxy_update: true });

  return {
    id:           brawRecord.id,
    file:         proxyPath,
    status:       'ok',
    proxy_update: true,
    shot_type:    classification.shot_type    || null,
    quality_flag: classification.quality_flag || null,
    orientation:  classification.orientation  || null,
    thumb:        thumbs?.displayUrl || null
  };
}

// ─────────────────────────────────────────────
// INGEST FOLDER — main entry point
// ─────────────────────────────────────────────

async function ingestFolder(folderPath, options = {}) {
  const { projectId = null, onProgress = null } = options;

  const ffmpegAvailable = await checkFfmpeg();
  if (!ffmpegAvailable) {
    return {
      ok: false,
      error: 'ffmpeg is not installed or not in PATH. See SETUP.md.',
      total: 0, processed: 0, skipped: 0, errors: []
    };
  }

  if (!fs.existsSync(folderPath)) {
    return {
      ok: false,
      error: `Folder not found: ${folderPath}`,
      total: 0, processed: 0, skipped: 0, errors: []
    };
  }

  const files = findVideoFiles(folderPath);
  onProgress?.({ stage: 'discovered', total: files.length });

  if (files.length === 0) {
    return { ok: true, total: 0, processed: 0, skipped: 0, errors: [], by_shot_type: {} };
  }

  const results = { processed: 0, skipped: 0, errors: [], by_shot_type: {}, by_quality: {} };

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    onProgress?.({ stage: 'processing', index: i + 1, total: files.length, file: path.basename(filePath) });

    const result = await processFile(filePath, { projectId, onProgress });

    if (result.status === 'ok') {
      results.processed++;
      const st = result.shot_type    || 'unclassified';
      const qf = result.quality_flag || 'unclassified';
      results.by_shot_type[st] = (results.by_shot_type[st] || 0) + 1;
      results.by_quality[qf]   = (results.by_quality[qf]   || 0) + 1;
    } else if (result.status === 'skipped') {
      results.skipped++;
    } else {
      results.errors.push({ file: path.basename(filePath), stage: result.stage, error: result.error });
    }
  }

  return {
    ok:          true,
    total:       files.length,
    processed:   results.processed,
    skipped:     results.skipped,
    errors:      results.errors,
    by_shot_type: results.by_shot_type,
    by_quality:   results.by_quality
  };
}

// ─────────────────────────────────────────────
// INGEST SINGLE FILE — used by watcher
// ─────────────────────────────────────────────

async function ingestFile(filePath, options = {}) {
  const ffmpegAvailable = await checkFfmpeg();
  if (!ffmpegAvailable) {
    return { ok: false, error: 'ffmpeg not installed — see SETUP.md' };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `Unsupported file type: ${ext}` };
  }

  const result = await processFile(filePath, options);
  return { ok: result.status === 'ok', ...result };
}

// ─────────────────────────────────────────────
// RECLASSIFY — re-run Vision on an existing clip's thumbnails
// ─────────────────────────────────────────────

/**
 * Re-run Claude Vision on an existing footage record using its stored thumbnails.
 * Reconstructs the thumbs object from the display thumbnail URL (stored in DB),
 * then updates shot_type / subcategory / description / quality_flag / orientation.
 */
async function reclassifyById(footageId) {
  const record = db.getFootageById(footageId);
  if (!record) throw new Error(`Footage ${footageId} not found`);

  // Derive thumbnail slug from the stored display URL:
  //   /thumbnails/abc123_thumb_b.jpg  →  slug = "abc123"
  // Then reconstruct all three thumb paths.
  let thumbs = null;

  if (record.thumbnail_path) {
    const thumbFilename = path.basename(record.thumbnail_path);            // abc123_thumb_b.jpg
    const slug          = thumbFilename.replace(/_thumb_[abc]\.jpg$/, ''); // abc123

    const buildThumb = (label) => {
      const filePath = path.join(THUMBNAIL_DIR, `${slug}_thumb_${label}.jpg`);
      const url      = `/thumbnails/${slug}_thumb_${label}.jpg`;
      const exists   = fs.existsSync(filePath);
      return { label, filePath, url, failed: !exists };
    };

    const a = buildThumb('a');
    const b = buildThumb('b');
    const c = buildThumb('c');

    // Need at least one thumbnail to proceed
    if (!a.failed || !b.failed || !c.failed) {
      const display = !b.failed ? b : (!a.failed ? a : c);
      thumbs = { a, b, c, displayPath: display.filePath, displayUrl: display.url };
    }
  }

  // If no thumbnails stored, try re-extracting from the proxy file_path
  if (!thumbs && record.file_path && fs.existsSync(record.file_path)) {
    const ext = path.extname(record.file_path).toLowerCase();
    if (!BRAW_EXTENSIONS.has(ext)) {
      try {
        const raw  = await probeFile(record.file_path);
        const meta = parseMetadata(record.file_path, raw);
        thumbs = await extractThumbnails(record.file_path, meta.duration);
      } catch (e) {
        throw new Error(`Cannot extract thumbnails for footage ${footageId}: ${e.message}`);
      }
    }
  }

  if (!thumbs) {
    throw new Error(
      `Footage ${footageId} has no thumbnails and is BRAW — ingest its proxy first.`
    );
  }

  const classification = await visionQueue.run(() => withRetry(() => classifyWithVision(thumbs)));

  db.updateFootage(footageId, {
    shot_type:    classification.shot_type    || null,
    subcategory:  classification.subcategory  || null,
    description:  classification.description  || null,
    quality_flag: classification.quality_flag || null,
    orientation:  classification.orientation  || null,
  });

  return { id: footageId, ...classification };
}

module.exports = { ingestFolder, ingestFile, findVideoFiles, checkFfmpeg, reclassifyById };
