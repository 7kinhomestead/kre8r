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
  if (!cutsCols.includes('transcript_excerpt')) {
    db.run('ALTER TABLE cuts ADD COLUMN transcript_excerpt TEXT');
    console.log('[DB] Migration: added cuts.transcript_excerpt');
  }
  if (!cutsCols.includes('why_it_matters')) {
    db.run('ALTER TABLE cuts ADD COLUMN why_it_matters TEXT');
    console.log('[DB] Migration: added cuts.why_it_matters');
  }
  if (!cutsCols.includes('suggested_use')) {
    db.run('ALTER TABLE cuts ADD COLUMN suggested_use TEXT');
    console.log('[DB] Migration: added cuts.suggested_use');
  }
  if (!cutsCols.includes('saved_for_later')) {
    db.run('ALTER TABLE cuts ADD COLUMN saved_for_later INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added cuts.saved_for_later');
  }

  // VaultΩr: orientation column + resolution-based backfill
  if (!footageCols.includes('orientation')) {
    db.run('ALTER TABLE footage ADD COLUMN orientation TEXT');
    console.log('[DB] Migration: added footage.orientation');
    // Backfill existing records from their resolution string (e.g. "1920x1080")
    // width > height * 1.1 → horizontal, height > width * 1.1 → vertical, else → square
    db.run(`
      UPDATE footage SET orientation = CASE
        WHEN resolution IS NULL THEN NULL
        WHEN CAST(SUBSTR(resolution, 1, INSTR(resolution, 'x') - 1) AS REAL)
             > CAST(SUBSTR(resolution, INSTR(resolution, 'x') + 1) AS REAL) * 1.1
             THEN 'horizontal'
        WHEN CAST(SUBSTR(resolution, INSTR(resolution, 'x') + 1) AS REAL)
             > CAST(SUBSTR(resolution, 1, INSTR(resolution, 'x') - 1) AS REAL) * 1.1
             THEN 'vertical'
        ELSE 'square'
      END
      WHERE resolution IS NOT NULL AND INSTR(resolution, 'x') > 0
    `);
    console.log('[DB] Migration: backfilled footage.orientation from resolution');
  }

  // Projects table: DaVinci columns
  const projectsCols = (db.exec('PRAGMA table_info(projects)')[0]?.values || []).map(r => r[1]);
  if (!projectsCols.includes('davinci_project_name')) {
    db.run('ALTER TABLE projects ADD COLUMN davinci_project_name TEXT');
    console.log('[DB] Migration: added projects.davinci_project_name');
  }
  if (!projectsCols.includes('davinci_project_state')) {
    db.run('ALTER TABLE projects ADD COLUMN davinci_project_state TEXT');
    console.log('[DB] Migration: added projects.davinci_project_state');
  }
  if (!projectsCols.includes('davinci_last_updated')) {
    db.run('ALTER TABLE projects ADD COLUMN davinci_last_updated DATETIME');
    console.log('[DB] Migration: added projects.davinci_last_updated');
  }

  // CutΩr: off_script_gold flag on footage (set when gold moments are found)
  if (!footageCols.includes('off_script_gold')) {
    db.run('ALTER TABLE footage ADD COLUMN off_script_gold INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added footage.off_script_gold');
  }

  // Footage table: BRAW proxy columns
  if (!footageCols.includes('braw_source_path')) {
    db.run('ALTER TABLE footage ADD COLUMN braw_source_path TEXT');
    console.log('[DB] Migration: added footage.braw_source_path');
  }
  if (!footageCols.includes('is_proxy')) {
    db.run('ALTER TABLE footage ADD COLUMN is_proxy INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added footage.is_proxy');
  }

  // DaVinci timelines table
  db.run(`CREATE TABLE IF NOT EXISTS davinci_timelines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL,
    timeline_name  TEXT NOT NULL,
    timeline_index INTEGER NOT NULL DEFAULT 1,
    state          TEXT NOT NULL DEFAULT 'pending',
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at   DATETIME,
    notes          TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_davinci_tl_project ON davinci_timelines(project_id)');

  // VaultΩr: clip_distribution table (CREATE TABLE IF NOT EXISTS is safe)
  db.run(`CREATE TABLE IF NOT EXISTS clip_distribution (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id      INTEGER NOT NULL,
    platform        TEXT NOT NULL,
    posted_at       DATETIME,
    post_url        TEXT,
    posted_manually INTEGER NOT NULL DEFAULT 1,
    notes           TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(footage_id, platform),
    FOREIGN KEY (footage_id) REFERENCES footage(id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_clip_dist_footage  ON clip_distribution(footage_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_clip_dist_platform ON clip_distribution(platform)');

  // AnalytΩr: add url column to posts
  const postsCols = (db.exec('PRAGMA table_info(posts)')[0]?.values || []).map(r => r[1]);
  if (!postsCols.includes('url')) {
    db.run('ALTER TABLE posts ADD COLUMN url TEXT');
    console.log('[DB] Migration: added posts.url');
  }
  if (!postsCols.includes('angle')) {
    db.run('ALTER TABLE posts ADD COLUMN angle TEXT');
    console.log('[DB] Migration: added posts.angle');
  }

  // EditΩr: footage.transcript — full Whisper text stored inline for fast multi-clip analysis
  if (!footageCols.includes('transcript')) {
    db.run('ALTER TABLE footage ADD COLUMN transcript TEXT');
    console.log('[DB] Migration: added footage.transcript');
  }

  // EditΩr: projects.editor_state
  const projectsCols2 = (db.exec('PRAGMA table_info(projects)')[0]?.values || []).map(r => r[1]);
  if (!projectsCols2.includes('editor_state')) {
    db.run('ALTER TABLE projects ADD COLUMN editor_state TEXT');
    console.log('[DB] Migration: added projects.editor_state');
  }

  // ComposΩr: projects.composor_state
  const projectsCols3 = (db.exec('PRAGMA table_info(projects)')[0]?.values || []).map(r => r[1]);
  if (!projectsCols3.includes('composor_state')) {
    db.run('ALTER TABLE projects ADD COLUMN composor_state TEXT');
    console.log('[DB] Migration: added projects.composor_state');
  }

  // ComposΩr: composor_tracks table
  db.run(`CREATE TABLE IF NOT EXISTS composor_tracks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL,
    scene_label       TEXT    NOT NULL,
    scene_index       INTEGER NOT NULL DEFAULT 0,
    scene_type        TEXT    NOT NULL DEFAULT 'buildup',
    duration_seconds  REAL,
    suno_prompt       TEXT,
    suno_job_id       TEXT,
    suno_track_url    TEXT,
    suno_track_path   TEXT,
    public_path       TEXT,
    selected          INTEGER NOT NULL DEFAULT 0,
    generation_index  INTEGER NOT NULL DEFAULT 1,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  // ComposΩr: public_path column (added after initial table creation)
  const composorCols = (db.exec('PRAGMA table_info(composor_tracks)')[0]?.values || []).map(r => r[1]);
  if (!composorCols.includes('public_path')) {
    db.run('ALTER TABLE composor_tracks ADD COLUMN public_path TEXT');
    console.log('[DB] Migration: added composor_tracks.public_path');
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_composor_project ON composor_tracks(project_id)');

  // EditΩr: selects table
  db.run(`CREATE TABLE IF NOT EXISTS selects (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id                INTEGER NOT NULL,
    script_section            TEXT    NOT NULL,
    section_index             INTEGER NOT NULL DEFAULT 0,
    takes                     TEXT    NOT NULL DEFAULT '[]',
    selected_takes            TEXT    NOT NULL DEFAULT '[]',
    winner_footage_id         INTEGER,
    gold_nugget               INTEGER NOT NULL DEFAULT 0,
    fire_suggestion           TEXT,
    davinci_timeline_position INTEGER NOT NULL DEFAULT 0,
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_selects_project ON selects(project_id)');

  // WritΩr: writr_scripts table
  db.run(`CREATE TABLE IF NOT EXISTS writr_scripts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id        INTEGER NOT NULL,
    entry_point       TEXT    NOT NULL DEFAULT 'shoot_first',
    input_type        TEXT    NOT NULL DEFAULT 'what_happened',
    raw_input         TEXT,
    generated_outline TEXT,
    generated_script  TEXT,
    beat_map_json     TEXT,
    hook_variations   TEXT,
    story_found       TEXT,
    anchor_moment     TEXT,
    missing_beats     TEXT,
    iteration_count   INTEGER NOT NULL DEFAULT 0,
    approved          INTEGER NOT NULL DEFAULT 0,
    approved_at       DATETIME,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_writr_scripts_project ON writr_scripts(project_id)');

  // DirectΩr / ShootDay: shoot_takes table
  db.run(`CREATE TABLE IF NOT EXISTS shoot_takes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    beat_index  INTEGER NOT NULL,
    beat_name   TEXT    NOT NULL DEFAULT '',
    take_number INTEGER NOT NULL DEFAULT 1,
    status      TEXT    NOT NULL DEFAULT 'needed',
    note        TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_shoot_takes_project ON shoot_takes(project_id)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_shoot_takes_beat ON shoot_takes(project_id, beat_index)');

  // PipΩr: project config columns
  const projectsCols4 = (db.exec('PRAGMA table_info(projects)')[0]?.values || []).map(r => r[1]);
  if (!projectsCols4.includes('setup_depth')) {
    db.run('ALTER TABLE projects ADD COLUMN setup_depth TEXT');
    console.log('[DB] Migration: added projects.setup_depth');
  }
  if (!projectsCols4.includes('entry_point')) {
    db.run('ALTER TABLE projects ADD COLUMN entry_point TEXT');
    console.log('[DB] Migration: added projects.entry_point');
  }
  if (!projectsCols4.includes('story_structure')) {
    db.run('ALTER TABLE projects ADD COLUMN story_structure TEXT');
    console.log('[DB] Migration: added projects.story_structure');
  }
  if (!projectsCols4.includes('content_type')) {
    db.run('ALTER TABLE projects ADD COLUMN content_type TEXT');
    console.log('[DB] Migration: added projects.content_type');
  }
  if (!projectsCols4.includes('high_concept')) {
    db.run('ALTER TABLE projects ADD COLUMN high_concept TEXT');
    console.log('[DB] Migration: added projects.high_concept');
  }
  if (!projectsCols4.includes('estimated_duration_minutes')) {
    db.run('ALTER TABLE projects ADD COLUMN estimated_duration_minutes INTEGER');
    console.log('[DB] Migration: added projects.estimated_duration_minutes');
  }
  if (!projectsCols4.includes('pipr_complete')) {
    db.run('ALTER TABLE projects ADD COLUMN pipr_complete INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added projects.pipr_complete');
  }
  if (!projectsCols4.includes('writr_complete')) {
    db.run('ALTER TABLE projects ADD COLUMN writr_complete INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added projects.writr_complete');
  }
  if (!projectsCols4.includes('active_script_id')) {
    db.run('ALTER TABLE projects ADD COLUMN active_script_id INTEGER');
    console.log('[DB] Migration: added projects.active_script_id');
  }

  // WritΩr: three output modes + session grouping
  const writrScriptsCols = (db.exec('PRAGMA table_info(writr_scripts)')[0]?.values || []).map(r => r[1]);
  if (!writrScriptsCols.includes('mode')) {
    db.run("ALTER TABLE writr_scripts ADD COLUMN mode TEXT NOT NULL DEFAULT 'full'");
    console.log('[DB] Migration: added writr_scripts.mode');
  }
  if (!writrScriptsCols.includes('session_id')) {
    db.run('ALTER TABLE writr_scripts ADD COLUMN session_id TEXT');
    console.log('[DB] Migration: added writr_scripts.session_id');
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
        thumbnail_path, quality_flag, organized_path, used_in, transcript_path,
        orientation, braw_source_path, is_proxy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.project_id         || null,
      record.file_path,
      record.original_filename  || null,
      record.shot_type          || null,
      record.subcategory        || null,
      record.description        || null,
      record.duration           || null,
      record.resolution         || null,
      record.codec              || null,
      record.file_size          || null,
      record.creation_timestamp || null,
      record.thumbnail_path     || null,
      record.quality_flag       || null,
      record.organized_path     || null,
      record.used_in            || '[]',
      record.transcript_path    || null,
      record.orientation        || null,
      record.braw_source_path   || null,
      record.is_proxy           ? 1 : 0
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function updateFootage(id, fields) {
  const allowed = [
    'shot_type', 'subcategory', 'description', 'quality_flag',
    'organized_path', 'thumbnail_path', 'project_id', 'used_in', 'transcript_path',
    'orientation', 'braw_source_path', 'is_proxy', 'resolution', 'codec',
    'duration', 'file_size', 'creation_timestamp', 'transcript', 'off_script_gold'
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
// DISTRIBUTION HELPERS (VaultΩr)
// ─────────────────────────────────────────────

function upsertDistribution({ footage_id, platform, posted_at, post_url, posted_manually, notes }) {
  _run(
    `INSERT INTO clip_distribution (footage_id, platform, posted_at, post_url, posted_manually, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(footage_id, platform) DO UPDATE SET
       posted_at       = excluded.posted_at,
       post_url        = excluded.post_url,
       posted_manually = excluded.posted_manually,
       notes           = excluded.notes`,
    [footage_id, platform, posted_at || null, post_url || null, posted_manually ?? 1, notes || null]
  );
  persist();
}

function deleteDistribution(footage_id, platform) {
  _run(`DELETE FROM clip_distribution WHERE footage_id = ? AND platform = ?`, [footage_id, platform]);
  persist();
}

function getDistributionByFootage(footage_id) {
  return _all(`SELECT * FROM clip_distribution WHERE footage_id = ? ORDER BY platform`, [footage_id]);
}

function getAllDistribution() {
  return _all(`SELECT * FROM clip_distribution ORDER BY footage_id, platform`);
}

// ─────────────────────────────────────────────
// DAVINCI HELPERS
// ─────────────────────────────────────────────

const DAVINCI_STATES = [
  'created', 'proxies_rendering', 'awaiting_creator_grade',
  'grade_approved', 'rough_cut_ready', 'awaiting_creator_review',
  'picture_lock', 'delivery_ready'
];

// Legal state transitions — each key can move to any of its values
const DAVINCI_TRANSITIONS = {
  'created':                 ['proxies_rendering', 'awaiting_creator_grade'],
  'proxies_rendering':       ['awaiting_creator_grade'],
  'awaiting_creator_grade':  ['grade_approved'],
  'grade_approved':          ['rough_cut_ready'],
  'rough_cut_ready':         ['awaiting_creator_review'],
  'awaiting_creator_review': ['picture_lock'],
  'picture_lock':            ['delivery_ready'],
  'delivery_ready':          []
};

function updateProjectDavinciState(projectId, newState, davinciProjectName) {
  if (!DAVINCI_STATES.includes(newState)) {
    throw new Error(`Invalid DaVinci state: ${newState}`);
  }
  const project = _get(`SELECT davinci_project_state FROM projects WHERE id = ?`, [projectId]);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const currentState = project.davinci_project_state;
  if (currentState) {
    const allowed = DAVINCI_TRANSITIONS[currentState] || [];
    if (!allowed.includes(newState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
    }
  }

  const sets   = ['davinci_project_state = ?', 'davinci_last_updated = CURRENT_TIMESTAMP'];
  const values = [newState];
  if (davinciProjectName) { sets.push('davinci_project_name = ?'); values.push(davinciProjectName); }
  _run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, [...values, projectId]);
  persist();
}

function createDavinciTimeline({ project_id, timeline_name, timeline_index, state, notes }) {
  const result = _run(
    `INSERT INTO davinci_timelines (project_id, timeline_name, timeline_index, state, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [project_id, timeline_name, timeline_index ?? 1, state ?? 'pending', notes ?? null]
  );
  persist();
  return result.lastInsertRowid;
}

function getDavinciTimelines(projectId) {
  return _all(
    `SELECT * FROM davinci_timelines WHERE project_id = ? ORDER BY timeline_index ASC`,
    [projectId]
  );
}

function updateDavinciTimeline(id, fields) {
  const allowed = ['state', 'completed_at', 'notes'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const sets   = updates.map(k => `${k} = ?`);
  const values = updates.map(k => fields[k]);
  _run(`UPDATE davinci_timelines SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  persist();
}

function getDavinciProjectStatus(projectId) {
  const project   = getProject(projectId);
  if (!project) return null;
  const timelines = getDavinciTimelines(projectId);
  return { ...project, davinci_timelines: timelines };
}

function getFootageByBrawPath(brawPath) {
  return _get(`SELECT * FROM footage WHERE braw_source_path = ?`, [brawPath]);
}

function findBrawByBasename(brawBasename) {
  // Match the last segment of braw_source_path against a given filename.
  // Used to link *_proxy.mp4 files back to their original BRAW record.
  return _get(
    `SELECT * FROM footage
     WHERE braw_source_path IS NOT NULL
       AND (braw_source_path = ? OR braw_source_path LIKE ? OR braw_source_path LIKE ?)`,
    [brawBasename, `%/${brawBasename}`, `%\\${brawBasename}`]
  );
}

function getAllProjectsWithDavinci() {
  return _all(
    `SELECT p.*, ps.stage_status FROM projects p
     LEFT JOIN pipeline_state ps ON ps.project_id = p.id
     WHERE p.davinci_project_name IS NOT NULL
     ORDER BY p.created_at DESC`
  );
}

// ─────────────────────────────────────────────
// CUTS HELPERS (CutΩr)
// ─────────────────────────────────────────────

function insertCut(cut) {
  const result = _run(
    `INSERT INTO cuts
       (project_id, footage_id, start_timestamp, end_timestamp, duration_seconds,
        cut_type, description, reasoning, rank, clip_path,
        transcript_excerpt, why_it_matters, suggested_use)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cut.project_id,
      cut.footage_id          || null,
      cut.start_timestamp,
      cut.end_timestamp,
      cut.duration_seconds    || null,
      cut.cut_type            || 'social',
      cut.description         || null,
      cut.reasoning           || null,
      cut.rank                || null,
      cut.clip_path           || null,
      cut.transcript_excerpt  || null,
      cut.why_it_matters      || null,
      cut.suggested_use       || null
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
  // Preserve off_script_gold entries the creator explicitly saved for later
  // (saved_for_later = 1 or approved = 1). Re-runs should not wipe the library.
  _run(
    `DELETE FROM cuts WHERE project_id = ?
     AND NOT (cut_type = 'off_script_gold' AND (saved_for_later = 1 OR approved = 1))`,
    [projectId]
  );
  persist();
}

function saveOffScriptGoldForLater(cutId) {
  _run(`UPDATE cuts SET saved_for_later = 1 WHERE id = ?`, [cutId]);
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
// POST HELPERS (AnalytΩr)
// ─────────────────────────────────────────────

function savePost({ project_id, caption_id, platform, content, media_path, scheduled_at, posted_at, post_id, status, url, angle }) {
  const result = _run(
    `INSERT INTO posts (project_id, caption_id, platform, content, media_path, scheduled_at, posted_at, post_id, status, url, angle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project_id,
      caption_id   || null,
      platform,
      content      || null,
      media_path   || null,
      scheduled_at || null,
      posted_at    || null,
      post_id      || null,
      status       || 'posted',
      url          || null,
      angle        || null
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function getPostsByProject(projectId) {
  return _all(`SELECT * FROM posts WHERE project_id = ? ORDER BY posted_at DESC, created_at DESC`, [projectId]);
}

function updatePost(id, fields) {
  const allowed = ['status', 'posted_at', 'post_id', 'url', 'error_message', 'angle', 'content', 'media_path'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (updates.length === 0) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  _run(`UPDATE posts SET ${setClauses} WHERE id = ?`, [...updates.map(k => fields[k]), id]);
  persist();
}

function deletePost(id) {
  _run(`DELETE FROM analytics WHERE post_id = ?`, [id]);
  _run(`DELETE FROM posts WHERE id = ?`, [id]);
  persist();
}

// ─────────────────────────────────────────────
// ANALYTICS HELPERS (AnalytΩr)
// ─────────────────────────────────────────────

function upsertMetric(postId, projectId, platform, metricName, metricValue) {
  const existing = _get(
    `SELECT id FROM analytics WHERE post_id = ? AND platform = ? AND metric_name = ?`,
    [postId, platform, metricName]
  );
  if (existing) {
    _run(
      `UPDATE analytics SET metric_value = ?, recorded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [metricValue, existing.id]
    );
  } else {
    _run(
      `INSERT INTO analytics (post_id, project_id, platform, metric_name, metric_value)
       VALUES (?, ?, ?, ?, ?)`,
      [postId, projectId, platform, metricName, metricValue]
    );
  }
  persist();
}

function getAnalyticsByPost(postId) {
  return _all(`SELECT * FROM analytics WHERE post_id = ? ORDER BY metric_name`, [postId]);
}

function getAnalyticsByProject(projectId) {
  return _all(
    `SELECT a.*, p.platform as post_platform, p.content, p.url, p.posted_at, p.angle
     FROM analytics a
     JOIN posts p ON p.id = a.post_id
     WHERE a.project_id = ?
     ORDER BY p.posted_at DESC, a.metric_name`,
    [projectId]
  );
}

function getAnalyticsSummary(projectId) {
  // Best platform by total views
  const byPlatform = _all(
    `SELECT platform, SUM(metric_value) as total_views
     FROM analytics
     WHERE project_id = ? AND metric_name = 'views'
     GROUP BY platform
     ORDER BY total_views DESC`,
    [projectId]
  );
  // Best post by views
  const bestPost = _get(
    `SELECT p.id, p.platform, p.content, p.url, p.angle, a.metric_value as views
     FROM analytics a
     JOIN posts p ON p.id = a.post_id
     WHERE a.project_id = ? AND a.metric_name = 'views'
     ORDER BY a.metric_value DESC
     LIMIT 1`,
    [projectId]
  );
  // Total posts
  const totalPosts = _get(`SELECT COUNT(*) as n FROM posts WHERE project_id = ?`, [projectId]);
  // Posts by platform
  const postsByPlatform = _all(
    `SELECT platform, COUNT(*) as n FROM posts WHERE project_id = ? GROUP BY platform`,
    [projectId]
  );
  return {
    best_platform: byPlatform[0]?.platform || null,
    platform_views: byPlatform,
    best_post: bestPost || null,
    total_posts: totalPosts?.n || 0,
    posts_by_platform: postsByPlatform
  };
}

// ─────────────────────────────────────────────
// COMPOSΩR — Track helpers
// ─────────────────────────────────────────────

function insertComposorTrack(track) {
  const result = _run(
    `INSERT INTO composor_tracks
       (project_id, scene_label, scene_index, scene_type, duration_seconds,
        suno_prompt, suno_job_id, suno_track_url, suno_track_path, public_path,
        selected, generation_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      track.project_id,
      track.scene_label,
      track.scene_index        ?? 0,
      track.scene_type         || 'buildup',
      track.duration_seconds   || null,
      track.suno_prompt        || null,
      track.suno_job_id        || null,
      track.suno_track_url     || null,
      track.suno_track_path    || null,
      track.public_path        || null,
      track.selected           ? 1 : 0,
      track.generation_index   ?? 1
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function updateComposorTrack(id, fields) {
  const allowed = ['suno_job_id', 'suno_track_url', 'suno_track_path', 'public_path', 'selected', 'suno_prompt'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k));
  if (!sets.length) return;
  const sql     = `UPDATE composor_tracks SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
  _run(sql, [...sets.map(k => fields[k]), id]);
  persist();
}

function getComposorTracksByProject(projectId) {
  return _all(
    `SELECT * FROM composor_tracks WHERE project_id = ? ORDER BY scene_index ASC, generation_index ASC`,
    [projectId]
  );
}

function selectComposorTrack(trackId) {
  // Get the track to find project + scene
  const track = _get(`SELECT * FROM composor_tracks WHERE id = ?`, [trackId]);
  if (!track) return;
  // Unselect all tracks in same scene
  _run(
    `UPDATE composor_tracks SET selected = 0 WHERE project_id = ? AND scene_index = ?`,
    [track.project_id, track.scene_index]
  );
  // Select this one
  _run(`UPDATE composor_tracks SET selected = 1 WHERE id = ?`, [trackId]);
  persist();
}

function deleteComposorTracksByProject(projectId) {
  _run(`DELETE FROM composor_tracks WHERE project_id = ?`, [projectId]);
  persist();
}

function updateProjectComposorState(projectId, state) {
  _run(`UPDATE projects SET composor_state = ? WHERE id = ?`, [state, projectId]);
  persist();
}

// ─────────────────────────────────────────────
// EDITΩR — Selects helpers
// ─────────────────────────────────────────────

function insertSelect(section) {
  const result = _run(
    `INSERT INTO selects
       (project_id, script_section, section_index, takes, selected_takes,
        winner_footage_id, gold_nugget, fire_suggestion, davinci_timeline_position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      section.project_id,
      section.script_section,
      section.section_index             ?? 0,
      JSON.stringify(section.takes          || []),
      JSON.stringify(section.selected_takes || []),
      section.winner_footage_id         || null,
      section.gold_nugget               ? 1 : 0,
      section.fire_suggestion           || null,
      section.davinci_timeline_position ?? section.section_index ?? 0
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function getSelectsByProject(projectId) {
  return _all(
    `SELECT * FROM selects WHERE project_id = ? ORDER BY section_index ASC`,
    [projectId]
  ).map(s => ({
    ...s,
    takes:          JSON.parse(s.takes          || '[]'),
    selected_takes: JSON.parse(s.selected_takes || '[]'),
    gold_nugget:    !!s.gold_nugget
  }));
}

function deleteSelectsByProject(projectId) {
  _run(`DELETE FROM selects WHERE project_id = ?`, [projectId]);
  persist();
}

function updateProjectEditorState(projectId, state) {
  _run(`UPDATE projects SET editor_state = ? WHERE id = ?`, [state, projectId]);
  persist();
}

// ─────────────────────────────────────────────
// PIPΩR — Project config helpers
// ─────────────────────────────────────────────

function updateProjectPipr(projectId, fields) {
  const allowed = [
    'setup_depth', 'entry_point', 'story_structure', 'content_type',
    'high_concept', 'estimated_duration_minutes', 'pipr_complete'
  ];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  _run(`UPDATE projects SET ${setClauses} WHERE id = ?`, [...updates.map(k => fields[k]), projectId]);
  persist();
}

function updateProjectWritr(projectId, fields) {
  const allowed = ['writr_complete', 'active_script_id'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  _run(`UPDATE projects SET ${setClauses} WHERE id = ?`, [...updates.map(k => fields[k]), projectId]);
  persist();
}

// ─────────────────────────────────────────────
// WRITΩR — Script helpers
// ─────────────────────────────────────────────

function insertWritrScript(data) {
  const result = _run(
    `INSERT INTO writr_scripts
       (project_id, entry_point, input_type, raw_input,
        generated_outline, generated_script, beat_map_json,
        hook_variations, story_found, anchor_moment, missing_beats,
        iteration_count, approved, mode, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.project_id,
      data.entry_point       || 'shoot_first',
      data.input_type        || 'what_happened',
      data.raw_input         || null,
      data.generated_outline || null,
      data.generated_script  || null,
      data.beat_map_json     ? JSON.stringify(data.beat_map_json)    : null,
      data.hook_variations   ? JSON.stringify(data.hook_variations)  : null,
      data.story_found       || null,
      data.anchor_moment     ? JSON.stringify(data.anchor_moment)    : null,
      data.missing_beats     ? JSON.stringify(data.missing_beats)    : null,
      data.iteration_count   || 0,
      data.approved          ? 1 : 0,
      data.mode              || 'full',
      data.session_id        || null
    ]
  );
  persist();
  return result.lastInsertRowid;
}

function getWritrScript(id) {
  const row = _get(`SELECT * FROM writr_scripts WHERE id = ?`, [id]);
  return row ? _parseWritrScript(row) : null;
}

function getWritrScriptsByProject(projectId) {
  return _all(
    `SELECT * FROM writr_scripts WHERE project_id = ? ORDER BY created_at DESC`,
    [projectId]
  ).map(_parseWritrScript);
}

function getApprovedWritrScript(projectId) {
  const row = _get(
    `SELECT * FROM writr_scripts WHERE project_id = ? AND approved = 1 ORDER BY approved_at DESC LIMIT 1`,
    [projectId]
  );
  return row ? _parseWritrScript(row) : null;
}

function _parseWritrScript(row) {
  if (!row) return null;
  return {
    ...row,
    approved:        !!row.approved,
    beat_map_json:   row.beat_map_json   ? JSON.parse(row.beat_map_json)   : null,
    hook_variations: row.hook_variations ? JSON.parse(row.hook_variations) : null,
    anchor_moment:   row.anchor_moment   ? JSON.parse(row.anchor_moment)   : null,
    missing_beats:   row.missing_beats   ? JSON.parse(row.missing_beats)   : null
  };
}

function updateWritrScript(id, fields) {
  const allowed = [
    'generated_outline', 'generated_script', 'beat_map_json',
    'hook_variations', 'story_found', 'anchor_moment', 'missing_beats',
    'iteration_count', 'approved', 'approved_at', 'raw_input'
  ];
  const json_fields = new Set(['beat_map_json', 'hook_variations', 'anchor_moment', 'missing_beats']);
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const sets   = updates.map(k => `${k} = ?`);
  const values = updates.map(k => json_fields.has(k) && fields[k] !== null
    ? JSON.stringify(fields[k])
    : fields[k]
  );
  sets.push('updated_at = CURRENT_TIMESTAMP');
  _run(`UPDATE writr_scripts SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  persist();
}

function approveWritrScript(projectId, scriptId) {
  // Mark approved in writr_scripts
  _run(
    `UPDATE writr_scripts SET approved = 1, approved_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [scriptId]
  );
  // Set active on project
  _run(
    `UPDATE projects SET active_script_id = ?, writr_complete = 1
     WHERE id = ?`,
    [scriptId, projectId]
  );
  // Sync approved script text into the scripts table so SelectsΩr reads it
  const ws = getWritrScript(scriptId);
  if (ws?.generated_script) {
    upsertScript(projectId, {
      full_script:      ws.generated_script,
      approved_version: ws.generated_script,
      outline:          ws.generated_outline || null
    });
  }
  persist();
}

// ─────────────────────────────────────────────
// ARCHIVE / DELETE
// ─────────────────────────────────────────────

function archiveProject(id) {
  _run(`UPDATE projects SET status = 'archived' WHERE id = ?`, [id]);
  persist();
}

function unarchiveProject(id) {
  _run(`UPDATE projects SET status = 'active' WHERE id = ?`, [id]);
  persist();
}

function deleteProject(id) {
  // ON DELETE CASCADE in schema handles all child table cleanup automatically
  _run(`DELETE FROM projects WHERE id = ?`, [id]);
  persist();
}

function getArchivedProjects() {
  return _all(`
    SELECT p.*, ps.gate_a_approved, ps.gate_b_approved, ps.gate_c_approved,
           ps.stage_status
    FROM projects p
    LEFT JOIN pipeline_state ps ON ps.project_id = p.id
    WHERE p.status = 'archived'
    ORDER BY p.created_at DESC
  `);
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
  archiveProject,
  unarchiveProject,
  deleteProject,
  getArchivedProjects,
  getPipelineSummary,
  // VaultΩr
  insertFootage,
  updateFootage,
  getFootageById,
  getAllFootage,
  searchFootageByWhere,
  getFootageStats,
  footageFilePathExists,
  upsertDistribution,
  deleteDistribution,
  getDistributionByFootage,
  getAllDistribution,
  getFootageByBrawPath,
  findBrawByBasename,
  // DaVinci
  DAVINCI_STATES,
  DAVINCI_TRANSITIONS,
  updateProjectDavinciState,
  createDavinciTimeline,
  getDavinciTimelines,
  updateDavinciTimeline,
  getDavinciProjectStatus,
  getAllProjectsWithDavinci,
  // CutΩr
  insertCut,
  getCutsByProject,
  getCutById,
  approveCut,
  updateCutClipPath,
  deleteCutsByProject,
  saveOffScriptGoldForLater,
  getScript,
  upsertScript,
  // AnalytΩr
  savePost,
  getPostsByProject,
  updatePost,
  deletePost,
  upsertMetric,
  getAnalyticsByPost,
  getAnalyticsByProject,
  getAnalyticsSummary,
  // ComposΩr
  insertComposorTrack,
  updateComposorTrack,
  getComposorTracksByProject,
  selectComposorTrack,
  deleteComposorTracksByProject,
  updateProjectComposorState,
  // EditΩr
  insertSelect,
  getSelectsByProject,
  deleteSelectsByProject,
  updateProjectEditorState,
  // PipΩr
  updateProjectPipr,
  updateProjectWritr,
  // WritΩr
  insertWritrScript,
  getWritrScript,
  getWritrScriptsByProject,
  getApprovedWritrScript,
  updateWritrScript,
  approveWritrScript,
  // ShootDay
  getShootTakes,
  upsertShootTake,
  resetShootTakes
};


// ─────────────────────────────────────────────
// SHOOTDAY — Take helpers
// ─────────────────────────────────────────────

function getShootTakes(projectId) {
  return _all(
    `SELECT * FROM shoot_takes WHERE project_id = ? ORDER BY beat_index ASC`,
    [projectId]
  );
}

function upsertShootTake(projectId, beatIndex, beatName, status, note) {
  const existing = _get(
    `SELECT id, take_number FROM shoot_takes WHERE project_id = ? AND beat_index = ?`,
    [projectId, beatIndex]
  );
  if (existing) {
    const newTake = status === 'needed'
      ? existing.take_number              // reset doesn't increment
      : (existing.take_number + 1);      // good/skip = new take attempt
    _run(
      `UPDATE shoot_takes SET status = ?, note = ?, take_number = ?,
         beat_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE project_id = ? AND beat_index = ?`,
      [status, note || null, newTake, beatName || '', projectId, beatIndex]
    );
  } else {
    _run(
      `INSERT INTO shoot_takes (project_id, beat_index, beat_name, take_number, status, note)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [projectId, beatIndex, beatName || '', status, note || null]
    );
  }
  persist();
  return _get(
    `SELECT * FROM shoot_takes WHERE project_id = ? AND beat_index = ?`,
    [projectId, beatIndex]
  );
}

function resetShootTakes(projectId) {
  _run(`DELETE FROM shoot_takes WHERE project_id = ?`, [projectId]);
  persist();
}

