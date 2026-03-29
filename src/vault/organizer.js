/**
 * VaultΩr Organizer — src/vault/organizer.js
 *
 * Writes a logical organized_path reference to the database.
 * NO files are copied, moved, or created — originals stay exactly where they are.
 *
 * The organized_path string follows the naming convention:
 *   <organized_folder>/<shot_type>/YYYY-MM-DD_description-slug_shottype_NNN.ext
 *
 * This is a display reference only — it shows what the file WOULD be called
 * in an organized structure, without touching the filesystem at all.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const db   = require('../db');

const PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');
}

function toDateStr(timestamp) {
  if (!timestamp) return new Date().toISOString().slice(0, 10);
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the logical reference path for a footage record.
 * No file is created — this string is stored in organized_path as a DB reference.
 */
function buildLogicalPath(record, seqNum, organizedRoot) {
  const dateStr  = toDateStr(record.creation_timestamp || record.ingested_at);
  const shotType = (record.shot_type || 'unclassified').replace(/[^a-z0-9-]/gi, '-');

  const rawText = record.description
    ? record.description.split('.')[0]
    : path.basename(
        record.original_filename || record.file_path,
        path.extname(record.file_path)
      );
  const slug     = slugify(rawText) || 'clip';
  const seq      = String(seqNum).padStart(3, '0');
  const ext      = path.extname(record.original_filename || record.file_path).toLowerCase();
  const filename = `${dateStr}_${slug}_${shotType}_${seq}${ext}`;

  // Normalise to forward slashes — this is a display/reference value
  const logicalPath = [organizedRoot, shotType, filename]
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/\//g, '/');

  return { logicalPath, filename };
}

/**
 * Determine the next sequence number for a given shot_type by counting
 * how many footage records for that type already have an organized_path.
 */
function nextSeqForShotType(shotType) {
  const all        = db.getAllFootage({ shot_type: shotType || 'unclassified' });
  const organized  = all.filter(r => r.organized_path);
  return organized.length + 1;
}

// ─────────────────────────────────────────────
// ORGANIZE ONE CLIP — DB update only, no file ops
// ─────────────────────────────────────────────

async function organizeFile(footageId) {
  const record = db.getFootageById(footageId);
  if (!record) return { ok: false, error: `Footage id ${footageId} not found` };

  if (record.organized_path) {
    return { ok: true, skipped: true, reason: 'already tagged', organized_path: record.organized_path };
  }

  const profile = loadProfile();
  const organizedRoot = profile?.vault?.organized_folder;
  if (!organizedRoot) {
    return { ok: false, error: 'vault.organized_folder not set in creator-profile.json' };
  }

  const seqNum = nextSeqForShotType(record.shot_type);
  const { logicalPath, filename } = buildLogicalPath(record, seqNum, organizedRoot);

  // Write logical reference to DB — no file is touched
  db.updateFootage(footageId, { organized_path: logicalPath });

  return { ok: true, id: footageId, organized_path: logicalPath, filename };
}

// ─────────────────────────────────────────────
// ORGANIZE BATCH — DB updates only
// ─────────────────────────────────────────────

async function organizeAll(options = {}) {
  const { projectId = null, onProgress = null } = options;

  const all        = db.getAllFootage({ project_id: projectId });
  const unorganized = all.filter(r => !r.organized_path);

  if (unorganized.length === 0) {
    return { ok: true, total: 0, organized: 0, skipped: 0, errors: [] };
  }

  onProgress?.({ stage: 'start', total: unorganized.length });

  const results = { organized: 0, skipped: 0, errors: [] };

  for (let i = 0; i < unorganized.length; i++) {
    const record = unorganized[i];
    onProgress?.({
      stage: 'organizing', index: i + 1,
      total: unorganized.length, file: record.original_filename
    });

    const result = await organizeFile(record.id);

    if (result.ok && !result.skipped) {
      results.organized++;
      onProgress?.({ stage: 'tagged', file: record.original_filename, organized_path: result.organized_path });
    } else if (result.skipped) {
      results.skipped++;
    } else {
      results.errors.push({ id: record.id, file: record.original_filename, error: result.error });
      onProgress?.({ stage: 'error', file: record.original_filename, error: result.error });
    }
  }

  return {
    ok:        true,
    total:     unorganized.length,
    organized: results.organized,
    skipped:   results.skipped,
    errors:    results.errors
  };
}

module.exports = { organizeFile, organizeAll };
