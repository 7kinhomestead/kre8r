/**
 * CutΩr Clip Extractor — src/vault/extractor.js
 *
 * Uses ffmpeg to extract approved cut moments from source footage at exact
 * timestamps. Full resolution, no re-encoding (stream copy), no quality loss.
 *
 * Output: public/clips/<project_slug>/<rank>_<start>-<end>_<description-slug>.ext
 *
 * Skips:
 *   - Cuts not yet approved (unless force=true)
 *   - CTA cuts (timestamp markers, not real clips)
 *   - Cuts whose clip_path already exists on disk
 *
 * Updates cuts.clip_path in the DB after each successful extraction.
 */

'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');

const db = require('../db');

if (process.env.FFMPEG_PATH)  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

const CLIPS_DIR = path.join(__dirname, '..', '..', 'public', 'clips');

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function slugify(text) {
  if (!text) return 'clip';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
}

function formatTs(seconds) {
  // e.g. 12.5 → "12.5" safe for filenames
  return String(parseFloat(seconds).toFixed(1)).replace('.', '_');
}

function buildClipFilename(cut, projectSlug, ext) {
  const rank  = cut.rank != null ? String(cut.rank).padStart(2, '0') : 'xx';
  const start = formatTs(cut.start_timestamp);
  const end   = formatTs(cut.end_timestamp);
  const slug  = slugify(cut.description);
  return `${rank}_${start}-${end}_${slug}${ext}`;
}

function projectSlug(project) {
  return slugify(project.title || 'project-' + project.id);
}

// ─────────────────────────────────────────────
// SINGLE CLIP EXTRACTION
// Uses stream copy (-c copy) for zero quality loss.
// Fast seek (-ss before -i) is accurate enough for speech cuts.
// ─────────────────────────────────────────────

function extractClip(sourcePath, startSecs, endSecs, outputPath) {
  return new Promise((resolve, reject) => {
    const duration = parseFloat((endSecs - startSecs).toFixed(3));
    if (duration <= 0) return reject(new Error('Duration is zero or negative'));

    ffmpeg(sourcePath)
      .inputOptions([
        `-ss ${startSecs}`           // fast seek before -i
      ])
      .outputOptions([
        `-to ${duration}`,           // relative end (duration from seek point)
        '-c copy',                   // stream copy — no re-encode, no quality loss
        '-avoid_negative_ts make_zero',  // fix PTS after seek
        '-movflags +faststart'       // web-friendly MP4
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`ffmpeg: ${err.message}`)))
      .run();
  });
}

// ─────────────────────────────────────────────
// EXTRACT ONE CUT
// ─────────────────────────────────────────────

async function extractCut(cutId, options = {}) {
  const { force = false } = options;

  const cut = db.getCutById(cutId);
  if (!cut) return { ok: false, error: `Cut ${cutId} not found` };

  // Skip CTA markers
  if (cut.cut_type === 'CTA') {
    return { ok: true, skipped: true, reason: 'CTA markers are not extracted as clips' };
  }

  // Skip unapproved unless forced
  if (!cut.approved && !force) {
    return { ok: true, skipped: true, reason: 'Not yet approved — approve in ReviewΩr or use force=true' };
  }

  // Skip if already extracted and file still exists
  if (cut.clip_path && fs.existsSync(cut.clip_path)) {
    return { ok: true, skipped: true, reason: 'Already extracted', clip_path: cut.clip_path };
  }

  // Get source footage
  const footage = db.getFootageById(cut.footage_id);
  if (!footage) return { ok: false, error: `Footage ${cut.footage_id} not found` };
  if (!fs.existsSync(footage.file_path)) {
    return { ok: false, error: `Source file not found: ${footage.file_path}` };
  }

  const project = db.getProject(cut.project_id);
  const pSlug   = projectSlug(project || { id: cut.project_id });
  const ext     = path.extname(footage.file_path).toLowerCase() || '.mp4';

  // Build output path
  const clipDir = path.join(CLIPS_DIR, pSlug);
  fs.mkdirSync(clipDir, { recursive: true });

  const filename   = buildClipFilename(cut, pSlug, ext);
  const outputPath = path.join(clipDir, filename);

  const startSecs = parseFloat(cut.start_timestamp);
  const endSecs   = parseFloat(cut.end_timestamp);

  try {
    await extractClip(footage.file_path, startSecs, endSecs, outputPath);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // Public URL path
  const clipUrl = `/clips/${pSlug}/${filename}`;
  db.updateCutClipPath(cut.id, clipUrl);

  return {
    ok:        true,
    cut_id:    cut.id,
    clip_path: clipUrl,
    filename,
    start:     startSecs,
    end:       endSecs,
    duration:  parseFloat((endSecs - startSecs).toFixed(3))
  };
}

// ─────────────────────────────────────────────
// EXTRACT ALL APPROVED CUTS FOR A PROJECT
// ─────────────────────────────────────────────

async function extractProject(projectId, options = {}) {
  const { force = false, onProgress = null } = options;

  const cuts = db.getCutsByProject(projectId);
  const eligible = cuts.filter(c =>
    c.cut_type !== 'CTA' &&
    (c.approved || force) &&
    !(c.clip_path && fs.existsSync(c.clip_path))
  );

  if (eligible.length === 0) {
    return {
      ok: true,
      total: 0,
      extracted: 0,
      skipped: 0,
      errors: [],
      message: force
        ? 'No cuts to extract (all already extracted or no social/retention cuts exist)'
        : 'No approved cuts to extract — approve clips in ReviewΩr first'
    };
  }

  onProgress?.({ stage: 'start', total: eligible.length });

  const results = { extracted: 0, skipped: 0, errors: [] };

  for (let i = 0; i < eligible.length; i++) {
    const cut = eligible[i];
    onProgress?.({
      stage:    'extracting',
      index:    i + 1,
      total:    eligible.length,
      cut_id:   cut.id,
      cut_type: cut.cut_type,
      start:    cut.start_timestamp,
      end:      cut.end_timestamp
    });

    const result = await extractCut(cut.id, { force });

    if (result.ok && !result.skipped) {
      results.extracted++;
      onProgress?.({ stage: 'extracted', cut_id: cut.id, clip_path: result.clip_path });
    } else if (result.skipped) {
      results.skipped++;
    } else {
      results.errors.push({ cut_id: cut.id, error: result.error });
      onProgress?.({ stage: 'error', cut_id: cut.id, error: result.error });
    }
  }

  return {
    ok:        true,
    total:     eligible.length,
    extracted: results.extracted,
    skipped:   results.skipped,
    errors:    results.errors,
    cuts:      db.getCutsByProject(projectId)
  };
}

module.exports = { extractCut, extractProject, CLIPS_DIR };
