/**
 * VaultΩr Folder Organizer — src/vault/organizer.js
 *
 * Copies ingested footage from its original location into the organized_folder
 * defined in creator-profile.json, using a clean naming convention:
 *
 *   YYYY-MM-DD_description-slug_shottype_NNN.ext
 *
 * Examples:
 *   2026-03-28_wide-shot-garden-beds-morning_b-roll_001.mp4
 *   2026-03-28_creator-grey-shirt-speaking-camera_talking-head_002.mov
 *
 * Rules:
 *   - Files are COPIED, never moved — originals stay untouched
 *   - Already-organized files (organized_path set) are skipped
 *   - Subfolders: organized/<shot_type>/ — keeps the vault browsable
 *   - NNN is a zero-padded sequence counter scoped to that shot_type subfolder
 *   - If description is null, uses original filename stem as slug
 *   - Date comes from creation_timestamp → falls back to ingested_at → today
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const db = require('../db');

const PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function loadOrganizedFolder() {
  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    return profile?.vault?.organized_folder || null;
  } catch (e) {
    return null;
  }
}

/**
 * Turn an arbitrary string into a safe filename slug.
 * Keeps only alphanumerics and hyphens, max 40 chars.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // strip special chars
    .trim()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-{2,}/g, '-')         // collapse multiple hyphens
    .slice(0, 40)
    .replace(/-$/, '');             // no trailing hyphen
}

/**
 * Extract YYYY-MM-DD from a timestamp string or Date.
 * Falls back to today if the input is unparseable.
 */
function toDateStr(timestamp) {
  if (!timestamp) return new Date().toISOString().slice(0, 10);
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Count existing files in a directory matching a prefix pattern,
 * to determine the next sequence number.
 */
function nextSeqNum(dir) {
  if (!fs.existsSync(dir)) return 1;
  const entries = fs.readdirSync(dir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp4', '.mov', '.mts', '.avi', '.mkv'].includes(ext);
  });
  return entries.length + 1;
}

/**
 * Build the destination filename for a footage record.
 */
function buildDestFilename(record, seqNum) {
  const dateStr  = toDateStr(record.creation_timestamp || record.ingested_at);
  const shotType = (record.shot_type || 'unclassified').replace(/[^a-z0-9-]/gi, '-');

  // Description slug — use description if available, else original filename stem
  const rawText  = record.description
    ? record.description.split('.')[0]          // first sentence only
    : path.basename(record.original_filename || record.file_path, path.extname(record.file_path));
  const slug     = slugify(rawText) || 'clip';

  const seq  = String(seqNum).padStart(3, '0');
  const ext  = path.extname(record.original_filename || record.file_path).toLowerCase();

  return `${dateStr}_${slug}_${shotType}_${seq}${ext}`;
}

// ─────────────────────────────────────────────
// ORGANIZE ONE FILE
// ─────────────────────────────────────────────

async function organizeFile(footageId, overrideDestDir = null) {
  const record = db.getFootageById(footageId);
  if (!record) return { ok: false, error: `Footage id ${footageId} not found` };

  if (record.organized_path) {
    return { ok: true, skipped: true, reason: 'already organized', organized_path: record.organized_path };
  }

  if (!fs.existsSync(record.file_path)) {
    return { ok: false, error: `Source file not found: ${record.file_path}` };
  }

  // Resolve destination root
  const organizedRoot = overrideDestDir || loadOrganizedFolder();
  if (!organizedRoot) {
    return { ok: false, error: 'vault.organized_folder not set in creator-profile.json' };
  }

  // Subfolder by shot_type
  const subDir = path.join(organizedRoot, record.shot_type || 'unclassified');
  fs.mkdirSync(subDir, { recursive: true });

  // Build filename and handle rare collisions
  let seqNum   = nextSeqNum(subDir);
  let filename = buildDestFilename(record, seqNum);
  let destPath = path.join(subDir, filename);

  // Collision guard — bump seqNum until free
  while (fs.existsSync(destPath)) {
    seqNum++;
    filename = buildDestFilename(record, seqNum);
    destPath = path.join(subDir, filename);
  }

  // Copy (not move) the file
  try {
    fs.copyFileSync(record.file_path, destPath);
  } catch (e) {
    return { ok: false, error: `Copy failed: ${e.message}` };
  }

  // Store public-style path (forward slashes) in DB
  const organizedPath = destPath.replace(/\\/g, '/');
  db.updateFootage(footageId, { organized_path: organizedPath });

  return { ok: true, id: footageId, organized_path: organizedPath, filename };
}

// ─────────────────────────────────────────────
// ORGANIZE BATCH — all unorganized footage
// ─────────────────────────────────────────────

async function organizeAll(options = {}) {
  const { projectId = null, onProgress = null, overrideDestDir = null } = options;

  const all = db.getAllFootage({ project_id: projectId });
  const unorganized = all.filter(r => !r.organized_path && fs.existsSync(r.file_path));

  if (unorganized.length === 0) {
    return { ok: true, total: 0, organized: 0, skipped: 0, errors: [] };
  }

  onProgress?.({ stage: 'start', total: unorganized.length });

  const results = { organized: 0, skipped: 0, errors: [] };

  for (let i = 0; i < unorganized.length; i++) {
    const record = unorganized[i];
    onProgress?.({ stage: 'organizing', index: i + 1, total: unorganized.length, file: record.original_filename });

    const result = await organizeFile(record.id, overrideDestDir);

    if (result.ok && !result.skipped) {
      results.organized++;
      onProgress?.({ stage: 'organized', file: record.original_filename, organized_path: result.organized_path });
    } else if (result.skipped) {
      results.skipped++;
    } else {
      results.errors.push({ id: record.id, file: record.original_filename, error: result.error });
      onProgress?.({ stage: 'error', file: record.original_filename, error: result.error });
    }
  }

  return {
    ok: true,
    total:     unorganized.length,
    organized: results.organized,
    skipped:   results.skipped,
    errors:    results.errors
  };
}

module.exports = { organizeFile, organizeAll };
