/**
 * Kre8Ωr Database — src/db.js
 * sql.js (pure WebAssembly SQLite) — no native compilation required.
 * In-memory database with manual persistence via db.export() → disk.
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'database', 'kre8r.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

let db;

// ─────────────────────────────────────────────
// INIT & PERSISTENCE
// ─────────────────────────────────────────────

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys=ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  runMigrations();
  persist();
  return db;
}

function runMigrations() {
  // Add columns to footage table that were introduced in Phase 2.
  // ALTER TABLE ADD COLUMN is safe on existing data — new rows get NULL.
  const footageCols = (db.exec('PRAGMA table_info(footage)')[0]?.values || [])
    .map(r => r[1]);

  if (!footageCols.includes('creation_timestamp')) {
    db.run('ALTER TABLE footage ADD COLUMN creation_timestamp TEXT');
    console.log('[DB] Migration: added footage.creation_timestamp');
  }
  if (!footageCols.includes('organized_path')) {
    db.run('ALTER TABLE footage ADD COLUMN organized_path TEXT');
    console.log('[DB] Migration: added footage.organized_path');
  }
  if (!footageCols.includes('transcript_path')) {
    db.run('ALTER TABLE footage ADD COLUMN transcript_path TEXT');
    console.log('[DB] Migration: added footage.transcript_path');
  }

  // CutΩr columns on cuts table
  const cutsCols = (db.exec('PRAGMA table_info(cuts)')[0]?.values || []).map(r => r[1]);
  if (!cutsCols.includes('reasoning')) {
    db.run('ALTER TABLE cuts ADD COLUMN reasoning TEXT');
    console.log('[DB] Migration: added cuts.reasoning');
  }
  if (!cutsCols.includes('clip_path')) {
    db.run('ALTER TABLE cuts ADD COLUMN clip_path TEXT');
    console.log('[DB] Migration: added cuts.clip_path');
  }
  if (!cutsCols.includes('rank')) {
    db.run('ALTER TABLE cuts ADD COLUMN rank INTEGER');
    console.log('[DB] Migration: added cuts.rank');
  }
}

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─────────────────────────────────────────────
// LOW-LEVEL HELPERS (replace better-sqlite3 API)
// ─────────────────────────────────────────────

function _run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  const rowid = db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? null;
  stmt.free();
  return { lastInsertRowid: rowid };
}

function _get(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function _all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─────────────────────────────────────────────
// PROJECT HELPERS
// ─────────────────────────────────────────────

function createProject(title, topic, youtubeUrl, youtubeVideoId) {
  const result = _run(
    `INSERT INTO projects (title, topic, youtube_url, youtube_video_id) VALUES (?, ?, ?, ?)`,
    [title || 'Untitled', topic || null, youtubeUrl || null, youtubeVideoId || null]
  );
  const projectId = result.lastInsertRowid;
  _run(`INSERT INTO pipeline_state (project_id) VALUES (?)`, [projectId]);
  persist();
  return getProject(projectId);
}

function getProject(id) {
  return _get(`
    SELECT p.*, ps.gate_a_approved, ps.gate_b_approved, ps.gate_c_approved,
           ps.stage_status, ps.gate_a_approved_at, ps.gate_b_approved_at, ps.gate_c_approved_at
    FROM projects p
    LEFT JOIN pipeline_state ps ON ps.project_id = p.id
    WHERE p.id = ?
  `, [id]);
}

function getAllProjects() {
  return _all(`
    SELECT p.*, ps.gate_a_approved, ps.gate_b_approved, ps.gate_c_approved,
           ps.stage_status,
           (SELECT COUNT(*) FROM packages WHERE project_id = p.id) as package_count,
           (SELECT COUNT(*) FROM captions WHERE project_id = p.id AND approved = 1) as approved_captions,
           (SELECT COUNT(*) FROM emails WHERE project_id = p.id AND approved = 1) as approved_emails,
           (SELECT COUNT(*) FROM cuts WHERE project_id = p.id AND cut_type = 'social') as social_cuts,
           (SELECT COUNT(*) FROM cuts WHERE project_id = p.id AND cut_type = 'social' AND approved = 1) as approved_cuts,
           (SELECT COUNT(*) FROM cuts WHERE project_id = p.id AND clip_path IS NOT NULL) as extracted_clips,
           (SELECT COUNT(*) FROM footage WHERE project_id = p.id) as footage_count
    FROM projects p
    LEFT JOIN pipeline_state ps ON ps.project_id = p.id
    WHERE p.status != 'archived'
    ORDER BY p.created_at DESC
  `);
}

function updateProjectStage(projectId, stage) {
  _run(`UPDATE projects SET current_stage = ? WHERE id = ?`, [stage, projectId]);
  _run(`UPDATE pipeline_state SET current_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`, [stage, projectId]);
}

function updateProjectMeta(projectId, { youtube_url, youtube_video_id, topic }) {
  _run(
    `UPDATE projects SET
       youtube_url = COALESCE(?, youtube_url),
       youtube_video_id = COALESCE(?, youtube_video_id),
       topic = COALESCE(?, topic)
     WHERE id = ?`,
    [youtube_url || null, youtube_video_id || null, topic || null, projectId]
  );
  persist();
}

// ─────────────────────────────────────────────
// PACKAGE HELPERS
// ─────────────────────────────────────────────

function savePackages(projectId, packages) {
  _run(`DELETE FROM packages WHERE project_id = ?`, [projectId]);

  for (const pkg of packages) {
    _run(
      `INSERT INTO packages (project_id, package_number, title, hook, rationale, thumbnail_concept, youtube_description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [projectId, pkg.number, pkg.title, pkg.hook, pkg.rationale, pkg.thumbnail_concept, pkg.youtube_description]
    );
  }

  updateProjectStage(projectId, 'M2');
  persist();
}

function getPackages(projectId) {
  return _all(`SELECT * FROM packages WHERE project_id = ? ORDER BY package_number`, [projectId]);
}

function selectPackage(projectId, packageNumber, note) {
  _run(`UPDATE packages SET is_selected = 0 WHERE project_id = ?`, [projectId]);
  _run(
    `UPDATE packages SET is_selected = 1, selected_at = CURRENT_TIMESTAMP, selection_note = ?
     WHERE project_id = ? AND package_number = ?`,
    [note || null, projectId, packageNumber]
  );
  _run(
    `UPDATE pipeline_state SET gate_a_approved = 1, gate_a_approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ?`,
    [projectId]
  );
  updateProjectStage(projectId, 'M3');
  persist();
}

function getSelectedPackage(projectId) {
  return _get(`SELECT * FROM packages WHERE project_id = ? AND is_selected = 1`, [projectId]);
}

// ─────────────────────────────────────────────
// CAPTION HELPERS
// ─────────────────────────────────────────────

function saveCaptions(projectId, clips) {
  _run(`DELETE FROM captions WHERE project_id = ?`, [projectId]);

  for (const clip of clips) {
    for (const [platform, text] of Object.entries(clip.captions)) {
      _run(
        `INSERT INTO captions (project_id, clip_label, timestamp_start, timestamp_end, description, platform, caption_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          `Clip ${clip.clip_id}`,
          clip.timestamp ? clip.timestamp.split('–')[0]?.trim() : null,
          clip.timestamp ? clip.timestamp.split('–')[1]?.trim() : null,
          clip.description || null,
          platform,
          text
        ]
      );
    }
  }

  updateProjectStage(projectId, 'M3-captions');
  persist();
}

function getCaptions(projectId) {
  return _all(`SELECT * FROM captions WHERE project_id = ? ORDER BY clip_label, platform`, [projectId]);
}

function approveCaption(captionId) {
  _run(`UPDATE captions SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE id = ?`, [captionId]);
  persist();
}

function approveAllCaptions(projectId) {
  _run(`UPDATE captions SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE project_id = ?`, [projectId]);
  _run(
    `UPDATE pipeline_state SET gate_b_approved = 1, gate_b_approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ?`,
    [projectId]
  );
  updateProjectStage(projectId, 'M4');
  persist();
}

// ─────────────────────────────────────────────
// EMAIL HELPERS
// ─────────────────────────────────────────────

function saveEmails(projectId, emailData) {
  _run(`DELETE FROM emails WHERE project_id = ?`, [projectId]);

  // Day 0
  if (emailData.day0?.everyone) {
    _run(
      `INSERT INTO emails (project_id, send_day, tier, subject, body) VALUES (?, ?, ?, ?, ?)`,
      [projectId, 0, 'everyone', emailData.day0.everyone.subject, emailData.day0.everyone.body]
    );
  }
  // Day 3
  for (const [tier, email] of Object.entries(emailData.day3 || {})) {
    _run(
      `INSERT INTO emails (project_id, send_day, tier, subject, body) VALUES (?, ?, ?, ?, ?)`,
      [projectId, 3, tier, email.subject, email.body]
    );
  }
  // Day 7
  for (const [tier, email] of Object.entries(emailData.day7 || {})) {
    _run(
      `INSERT INTO emails (project_id, send_day, tier, subject, body) VALUES (?, ?, ?, ?, ?)`,
      [projectId, 7, tier, email.subject, email.body]
    );
  }

  updateProjectStage(projectId, 'M4-emails');
  persist();
}

function getEmails(projectId) {
  return _all(`SELECT * FROM emails WHERE project_id = ? ORDER BY send_day, tier`, [projectId]);
}

function approveAllEmails(projectId) {
  _run(`UPDATE emails SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE project_id = ?`, [projectId]);
  _run(
    `UPDATE pipeline_state SET gate_c_approved = 1, gate_c_approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ?`,
    [projectId]
  );
  updateProjectStage(projectId, 'M5');
  persist();
}

// ─────────────────────────────────────────────
// FOOTAGE HELPERS (VaultΩr)
// ─────────────────────────────────────────────

function insertFootage(record) {
  const result = _run(
    `INSERT INTO footage
       (project_id, file_path, original_filename, shot_type, subcategory, description,
        duration, resolution, codec, file_size, creation_timestamp,
        thumbnail_path, quality_flag, organized_path, used_in, transcript_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.project_id || null,
      record.file_path,
      record.original_filename || null,
      record.shot_type || null,
      record.subcategory || null,
      record.description || null,
      record.duration || null,
      record.resolution || null,
      record.codec || null,
      record.file_size || null,
      record.creation_timestamp || null,
      record.thumbnail_path || null,
      record.quality_flag || null,
      record.organized_path || null,
      record.used_in || '[]',
      record.transcript_path || null
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function updateFootage(id, fields) {
  const allowed = [
    'shot_type', 'subcategory', 'description', 'quality_flag',
    'organized_path', 'thumbnail_path', 'project_id', 'used_in', 'transcript_path'
  ];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (updates.length === 0) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  const values = updates.map(k => fields[k]);
  _run(`UPDATE footage SET ${setClauses} WHERE id = ?`, [...values, id]);
  persist();
}

function getFootageById(id) {
  return _get(`SELECT * FROM footage WHERE id = ?`, [id]);
}

function getAllFootage({ shot_type, quality_flag, project_id } = {}) {
  let sql = `SELECT * FROM footage WHERE 1=1`;
  const params = [];
  if (shot_type)    { sql += ` AND shot_type = ?`;    params.push(shot_type); }
  if (quality_flag) { sql += ` AND quality_flag = ?`; params.push(quality_flag); }
  if (project_id)   { sql += ` AND project_id = ?`;   params.push(project_id); }
  sql += ` ORDER BY ingested_at DESC`;
  return _all(sql, params);
}

function searchFootageByWhere(whereClause) {
  // whereClause is a Claude-generated SQL WHERE fragment
  // Sanitize: must not contain semicolons or common injection patterns
  if (/;|--|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b/i.test(whereClause)) {
    throw new Error('Invalid WHERE clause');
  }
  return _all(`SELECT * FROM footage WHERE ${whereClause} ORDER BY ingested_at DESC`);
}

function getFootageStats() {
  const total    = _get(`SELECT COUNT(*) as n FROM footage`);
  const byType   = _all(`SELECT shot_type, COUNT(*) as n FROM footage GROUP BY shot_type`);
  const byQuality = _all(`SELECT quality_flag, COUNT(*) as n FROM footage GROUP BY quality_flag`);
  return { total: total?.n || 0, by_shot_type: byType, by_quality: byQuality };
}

function footageFilePathExists(filePath) {
  return !!_get(`SELECT id FROM footage WHERE file_path = ?`, [filePath]);
}

// ─────────────────────────────────────────────
// CUTS HELPERS (CutΩr)
// ─────────────────────────────────────────────

function insertCut(cut) {
  const result = _run(
    `INSERT INTO cuts
       (project_id, footage_id, start_timestamp, end_timestamp, duration_seconds,
        cut_type, description, reasoning, rank, clip_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cut.project_id,
      cut.footage_id     || null,
      cut.start_timestamp,
      cut.end_timestamp,
      cut.duration_seconds || null,
      cut.cut_type        || 'social',
      cut.description     || null,
      cut.reasoning       || null,
      cut.rank            || null,
      cut.clip_path       || null
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function getCutsByProject(projectId) {
  return _all(
    `SELECT * FROM cuts WHERE project_id = ? ORDER BY rank ASC, id ASC`,
    [projectId]
  );
}

function getCutById(id) {
  return _get(`SELECT * FROM cuts WHERE id = ?`, [id]);
}

function approveCut(id) {
  _run(`UPDATE cuts SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  persist();
}

function updateCutClipPath(id, clipPath) {
  _run(`UPDATE cuts SET clip_path = ? WHERE id = ?`, [clipPath, id]);
  persist();
}

function deleteCutsByProject(projectId) {
  _run(`DELETE FROM cuts WHERE project_id = ?`, [projectId]);
  persist();
}

// ─────────────────────────────────────────────
// SCRIPT HELPERS (CutΩr)
// ─────────────────────────────────────────────

function getScript(projectId) {
  return _get(`SELECT * FROM scripts WHERE project_id = ?`, [projectId]);
}

function upsertScript(projectId, { outline, full_script, approved_version }) {
  const existing = getScript(projectId);
  if (existing) {
    _run(
      `UPDATE scripts SET outline = COALESCE(?, outline),
         full_script = COALESCE(?, full_script),
         approved_version = COALESCE(?, approved_version)
       WHERE project_id = ?`,
      [outline || null, full_script || null, approved_version || null, projectId]
    );
  } else {
    _run(
      `INSERT INTO scripts (project_id, outline, full_script, approved_version)
       VALUES (?, ?, ?, ?)`,
      [projectId, outline || null, full_script || null, approved_version || null]
    );
  }
  persist();
}

// ─────────────────────────────────────────────
// PIPELINE SUMMARY (for PipelineΩr dashboard)
// ─────────────────────────────────────────────

function getPipelineSummary() {
  const projects = getAllProjects();
  return projects.map(p => ({
    ...p,
    needs_attention: !p.gate_a_approved || !p.gate_b_approved || !p.gate_c_approved
  }));
}

module.exports = {
  initDb,
  createProject,
  getProject,
  getAllProjects,
  updateProjectStage,
  updateProjectMeta,
  savePackages,
  getPackages,
  selectPackage,
  getSelectedPackage,
  saveCaptions,
  getCaptions,
  approveCaption,
  approveAllCaptions,
  saveEmails,
  getEmails,
  approveAllEmails,
  getPipelineSummary,
  // VaultΩr
  insertFootage,
  updateFootage,
  getFootageById,
  getAllFootage,
  searchFootageByWhere,
  getFootageStats,
  footageFilePathExists,
  // CutΩr
  insertCut,
  getCutsByProject,
  getCutById,
  approveCut,
  updateCutClipPath,
  deleteCutsByProject,
  getScript,
  upsertScript
};
