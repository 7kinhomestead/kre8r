/**
 * VaultΩr Intake Pipeline — src/vault/intake.js
 *
 * Accepts a folder path, finds all video files, extracts metadata + thumbnail
 * via ffprobe/ffmpeg, classifies each clip with Claude Vision, and writes
 * everything to the footage table.
 *
 * Designed to be resilient: one bad file never aborts the whole batch.
 * Works gracefully when ffmpeg is not installed (surfaces clear errors).
 */

'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const db = require('../db');

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov', '.mts', '.avi', '.mkv']);
const THUMBNAIL_DIR = path.join(__dirname, '..', '..', 'public', 'thumbnails');
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

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
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return; // unreadable directory — skip silently
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(full);
        }
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
  const fmt    = metadata.format || {};
  const vStream = (metadata.streams || []).find(s => s.codec_type === 'video');

  const duration  = parseFloat(fmt.duration) || null;
  const file_size = parseInt(fmt.size, 10)   || fs.statSync(filePath).size;

  const width  = vStream?.width;
  const height = vStream?.height;
  const resolution = (width && height) ? `${width}x${height}` : null;
  const codec = vStream?.codec_name || null;

  // creation_time lives in format tags or stream tags
  const creation_timestamp =
    fmt.tags?.creation_time ||
    vStream?.tags?.creation_time ||
    null;

  return { duration, file_size, resolution, codec, creation_timestamp };
}

// ─────────────────────────────────────────────
// FFMPEG — THUMBNAIL EXTRACTION
// ─────────────────────────────────────────────

function thumbnailSlug(filePath) {
  // MD5 of the absolute path → always unique, no collisions across folders
  return crypto.createHash('md5').update(path.resolve(filePath)).digest('hex');
}

function extractThumbnail(filePath, duration) {
  // 3s mark, or 10% of duration if the clip is shorter than 30 seconds
  const timeOffset = (duration && duration < 30)
    ? Math.max(0.5, duration * 0.1)
    : 3;

  const slug      = thumbnailSlug(filePath);
  const thumbFile = slug + '.jpg';
  const thumbPath = path.join(THUMBNAIL_DIR, thumbFile);
  const thumbUrl  = `/thumbnails/${thumbFile}`;  // public URL

  // Skip if already extracted
  if (fs.existsSync(thumbPath)) {
    return Promise.resolve({ thumbPath, thumbUrl });
  }

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .screenshots({
        timestamps: [timeOffset],
        filename: thumbFile,
        folder: THUMBNAIL_DIR,
        size: '640x?'
      })
      .on('end', () => resolve({ thumbPath, thumbUrl }))
      .on('error', reject);
  });
}

// ─────────────────────────────────────────────
// CLAUDE VISION — CLIP CLASSIFICATION
// ─────────────────────────────────────────────

const VISION_PROMPT = `You are analyzing a video thumbnail from a homesteading and off-grid living content creator (7 Kin Homestead). Categorize this clip and return ONLY a JSON object with these exact fields:
{
  "shot_type": "one of: dialogue, talking-head, b-roll, action, unusable",
  "subcategory": "one of: wide, medium, close-up, detail, null — only populate for b-roll, null for all others",
  "description": "a 1-2 sentence description of what is visible in the frame — specific and useful for search",
  "quality_flag": "one of: hero, usable, review, discard",
  "quality_reason": "one sentence explaining the quality flag"
}
Be specific in descriptions. 'Person talking in front of trees' is not useful. 'Creator in grey shirt speaking to camera, outdoor background with forest visible, good lighting' is useful.`;

async function classifyWithVision(thumbPath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const imageData = fs.readFileSync(thumbPath).toString('base64');

  const { default: fetch } = await import('node-fetch');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
          },
          { type: 'text', text: VISION_PROMPT }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();
  const raw  = data.content[0].text;

  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

// ─────────────────────────────────────────────
// SINGLE FILE PROCESSOR
// ─────────────────────────────────────────────

async function processFile(filePath, options = {}) {
  const { projectId = null, onProgress = null } = options;

  const original_filename = path.basename(filePath);

  // Skip duplicates
  if (db.footageFilePathExists(filePath)) {
    return { file: filePath, status: 'skipped', reason: 'already ingested' };
  }

  // ── 1. ffprobe ──────────────────────────────
  let meta;
  try {
    const raw = await probeFile(filePath);
    meta = parseMetadata(filePath, raw);
  } catch (e) {
    return { file: filePath, status: 'error', stage: 'ffprobe', error: e.message };
  }

  onProgress?.({ stage: 'probed', file: original_filename, meta });

  // ── 2. thumbnail ────────────────────────────
  let thumbPath = null, thumbUrl = null;
  try {
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
    ({ thumbPath, thumbUrl } = await extractThumbnail(filePath, meta.duration));
  } catch (e) {
    // Non-fatal: store the record without a thumbnail
    console.warn(`[VaultΩr] Thumbnail failed for ${original_filename}: ${e.message}`);
  }

  onProgress?.({ stage: 'thumbnail', file: original_filename, thumbUrl });

  // ── 3. Claude Vision ─────────────────────────
  let classification = {};
  if (thumbPath && fs.existsSync(thumbPath)) {
    try {
      classification = await classifyWithVision(thumbPath);
    } catch (e) {
      console.warn(`[VaultΩr] Vision failed for ${original_filename}: ${e.message}`);
      // Store the record with null classification — can be re-run later
    }
  }

  onProgress?.({ stage: 'classified', file: original_filename, classification });

  // ── 4. DB insert ────────────────────────────
  const id = db.insertFootage({
    project_id:         projectId,
    file_path:          filePath,
    original_filename,
    shot_type:          classification.shot_type          || null,
    subcategory:        classification.subcategory        || null,
    description:        classification.description        || null,
    quality_flag:       classification.quality_flag       || null,
    duration:           meta.duration,
    resolution:         meta.resolution,
    codec:              meta.codec,
    file_size:          meta.file_size,
    creation_timestamp: meta.creation_timestamp,
    thumbnail_path:     thumbUrl,
    organized_path:     null,
    used_in:            '[]'
  });

  onProgress?.({ stage: 'saved', file: original_filename, id });

  return {
    id,
    file: filePath,
    status: 'ok',
    shot_type:    classification.shot_type    || null,
    quality_flag: classification.quality_flag || null,
    thumb:        thumbUrl
  };
}

// ─────────────────────────────────────────────
// MAIN ENTRY POINT — ingestFolder
// ─────────────────────────────────────────────

async function ingestFolder(folderPath, options = {}) {
  const { projectId = null, onProgress = null } = options;

  // 1. ffmpeg check
  const ffmpegAvailable = await checkFfmpeg();
  if (!ffmpegAvailable) {
    return {
      ok: false,
      error: 'ffmpeg is not installed or not in PATH. See SETUP.md for installation instructions.',
      total: 0, processed: 0, skipped: 0, errors: []
    };
  }

  // 2. Folder check
  if (!fs.existsSync(folderPath)) {
    return {
      ok: false,
      error: `Folder not found: ${folderPath}`,
      total: 0, processed: 0, skipped: 0, errors: []
    };
  }

  // 3. Discover files
  const files = findVideoFiles(folderPath);
  onProgress?.({ stage: 'discovered', total: files.length });

  if (files.length === 0) {
    return { ok: true, total: 0, processed: 0, skipped: 0, errors: [], by_shot_type: {} };
  }

  // 4. Process each file
  const results = { processed: 0, skipped: 0, errors: [], by_shot_type: {}, by_quality: {} };

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    onProgress?.({ stage: 'processing', index: i + 1, total: files.length, file: path.basename(filePath) });

    const result = await processFile(filePath, { projectId, onProgress });

    if (result.status === 'ok') {
      results.processed++;
      const st = result.shot_type || 'unclassified';
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
    ok: true,
    total:    files.length,
    processed: results.processed,
    skipped:   results.skipped,
    errors:    results.errors,
    by_shot_type: results.by_shot_type,
    by_quality:   results.by_quality
  };
}

// ─────────────────────────────────────────────
// SINGLE FILE ENTRY POINT (used by watcher)
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

module.exports = { ingestFolder, ingestFile, findVideoFiles, checkFfmpeg };
