/**
 * scripts/build-template-db.js
 * Creates database/kre8r-template.db — schema only, zero data rows.
 *
 * This file ships inside the Electron installer so new users get the correct
 * schema on first launch without any of Jason's data. electron/main.js copies
 * it to AppData on first run if no kre8r.db exists there yet.
 *
 * Run after any schema migration to keep the template up to date:
 *   npm run build-template-db
 *
 * The template is committed to git (safe — no personal data).
 * kre8r.db is gitignored; kre8r-template.db is not.
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const SCHEMA_PATH   = path.join(__dirname, '../database/schema.sql');
const TEMPLATE_PATH = path.join(__dirname, '../database/kre8r-template.db');

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error('✗ schema.sql not found:', SCHEMA_PATH);
  process.exit(1);
}

// Remove any existing template so we start truly fresh
if (fs.existsSync(TEMPLATE_PATH)) {
  fs.unlinkSync(TEMPLATE_PATH);
  console.log('  Removed old template');
}

const db = new Database(TEMPLATE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Step 1: Base schema (schema.sql) ─────────────────────────────────────────
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);
console.log('✓ Base schema applied');

// ── Step 2: Migration-only tables (created in src/db.js runMigrations, not schema.sql)
// Order matters — some tables have FK refs to projects.

db.exec(`CREATE TABLE IF NOT EXISTS davinci_timelines (
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
db.exec('CREATE INDEX IF NOT EXISTS idx_davinci_tl_project ON davinci_timelines(project_id)');

db.exec(`CREATE TABLE IF NOT EXISTS clip_distribution (
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
db.exec('CREATE INDEX IF NOT EXISTS idx_clip_dist_footage  ON clip_distribution(footage_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_clip_dist_platform ON clip_distribution(platform)');

db.exec(`CREATE TABLE IF NOT EXISTS composor_tracks (
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
db.exec('CREATE INDEX IF NOT EXISTS idx_composor_project ON composor_tracks(project_id)');

db.exec(`CREATE TABLE IF NOT EXISTS selects (
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
db.exec('CREATE INDEX IF NOT EXISTS idx_selects_project ON selects(project_id)');

db.exec(`CREATE TABLE IF NOT EXISTS writr_scripts (
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
  mode              TEXT    NOT NULL DEFAULT 'full',
  session_id        TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_writr_scripts_project ON writr_scripts(project_id)');

db.exec(`CREATE TABLE IF NOT EXISTS shoot_takes (
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
db.exec('CREATE INDEX IF NOT EXISTS idx_shoot_takes_project ON shoot_takes(project_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shoot_takes_beat ON shoot_takes(project_id, beat_index)');

db.exec(`CREATE TABLE IF NOT EXISTS kv_store (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS beta_applications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  channel_url      TEXT    NOT NULL,
  platform         TEXT,
  upload_frequency TEXT,
  why_text         TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_beta_status  ON beta_applications(status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_beta_created ON beta_applications(created_at)');

db.exec(`CREATE TABLE IF NOT EXISTS bug_reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  what_tried       TEXT,
  what_happened    TEXT,
  severity         TEXT    NOT NULL DEFAULT 'minor',
  page             TEXT,
  project_id       INTEGER,
  browser          TEXT,
  console_errors   TEXT,
  timestamp        TEXT,
  reporter_name    TEXT,
  status           TEXT    NOT NULL DEFAULT 'open',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_bugreports_status   ON bug_reports(status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_bugreports_severity ON bug_reports(severity)');
db.exec('CREATE INDEX IF NOT EXISTS idx_bugreports_created  ON bug_reports(created_at)');

db.exec(`CREATE TABLE IF NOT EXISTS nps_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  score      INTEGER NOT NULL,
  comment    TEXT,
  page       TEXT,
  project_id INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_nps_created ON nps_scores(created_at)');

db.exec(`CREATE TABLE IF NOT EXISTS token_usage (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tool             TEXT    NOT NULL,
  session_id       TEXT,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  estimated_cost   REAL    NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_token_tool    ON token_usage(tool)');
db.exec('CREATE INDEX IF NOT EXISTS idx_token_session ON token_usage(session_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_token_created ON token_usage(created_at)');

console.log('✓ All migration-only tables created');

// ── Step 3: Column migrations on base-schema tables ───────────────────────────

const footageCols = db.pragma('table_info(footage)').map(r => r.name);
if (!footageCols.includes('creation_timestamp'))  db.exec('ALTER TABLE footage ADD COLUMN creation_timestamp TEXT');
if (!footageCols.includes('organized_path'))       db.exec('ALTER TABLE footage ADD COLUMN organized_path TEXT');
if (!footageCols.includes('transcript_path'))      db.exec('ALTER TABLE footage ADD COLUMN transcript_path TEXT');
if (!footageCols.includes('orientation'))          db.exec('ALTER TABLE footage ADD COLUMN orientation TEXT');
if (!footageCols.includes('off_script_gold'))      db.exec('ALTER TABLE footage ADD COLUMN off_script_gold INTEGER DEFAULT 0');
if (!footageCols.includes('braw_source_path'))     db.exec('ALTER TABLE footage ADD COLUMN braw_source_path TEXT');
if (!footageCols.includes('is_proxy'))             db.exec('ALTER TABLE footage ADD COLUMN is_proxy INTEGER DEFAULT 0');
if (!footageCols.includes('transcript'))           db.exec('ALTER TABLE footage ADD COLUMN transcript TEXT');

const cutsCols = db.pragma('table_info(cuts)').map(r => r.name);
if (!cutsCols.includes('reasoning'))          db.exec('ALTER TABLE cuts ADD COLUMN reasoning TEXT');
if (!cutsCols.includes('clip_path'))          db.exec('ALTER TABLE cuts ADD COLUMN clip_path TEXT');
if (!cutsCols.includes('rank'))               db.exec('ALTER TABLE cuts ADD COLUMN rank INTEGER');
if (!cutsCols.includes('transcript_excerpt')) db.exec('ALTER TABLE cuts ADD COLUMN transcript_excerpt TEXT');
if (!cutsCols.includes('why_it_matters'))     db.exec('ALTER TABLE cuts ADD COLUMN why_it_matters TEXT');
if (!cutsCols.includes('suggested_use'))      db.exec('ALTER TABLE cuts ADD COLUMN suggested_use TEXT');
if (!cutsCols.includes('saved_for_later'))    db.exec('ALTER TABLE cuts ADD COLUMN saved_for_later INTEGER DEFAULT 0');

const projectsCols = db.pragma('table_info(projects)').map(r => r.name);
if (!projectsCols.includes('davinci_project_name'))       db.exec('ALTER TABLE projects ADD COLUMN davinci_project_name TEXT');
if (!projectsCols.includes('davinci_project_state'))      db.exec('ALTER TABLE projects ADD COLUMN davinci_project_state TEXT');
if (!projectsCols.includes('davinci_last_updated'))       db.exec('ALTER TABLE projects ADD COLUMN davinci_last_updated DATETIME');
if (!projectsCols.includes('editor_state'))               db.exec('ALTER TABLE projects ADD COLUMN editor_state TEXT');
if (!projectsCols.includes('composor_state'))             db.exec('ALTER TABLE projects ADD COLUMN composor_state TEXT');
if (!projectsCols.includes('id8r_data'))                  db.exec('ALTER TABLE projects ADD COLUMN id8r_data TEXT');
if (!projectsCols.includes('setup_depth'))                db.exec('ALTER TABLE projects ADD COLUMN setup_depth TEXT');
if (!projectsCols.includes('entry_point'))                db.exec('ALTER TABLE projects ADD COLUMN entry_point TEXT');
if (!projectsCols.includes('story_structure'))            db.exec('ALTER TABLE projects ADD COLUMN story_structure TEXT');
if (!projectsCols.includes('content_type'))               db.exec('ALTER TABLE projects ADD COLUMN content_type TEXT');
if (!projectsCols.includes('high_concept'))               db.exec('ALTER TABLE projects ADD COLUMN high_concept TEXT');
if (!projectsCols.includes('estimated_duration_minutes')) db.exec('ALTER TABLE projects ADD COLUMN estimated_duration_minutes INTEGER');
if (!projectsCols.includes('pipr_complete'))              db.exec('ALTER TABLE projects ADD COLUMN pipr_complete INTEGER NOT NULL DEFAULT 0');
if (!projectsCols.includes('writr_complete'))             db.exec('ALTER TABLE projects ADD COLUMN writr_complete INTEGER NOT NULL DEFAULT 0');
if (!projectsCols.includes('active_script_id'))           db.exec('ALTER TABLE projects ADD COLUMN active_script_id INTEGER');
if (!projectsCols.includes('source'))                     db.exec("ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'kre8r'");
if (!projectsCols.includes('collaborators'))              db.exec('ALTER TABLE projects ADD COLUMN collaborators TEXT');

const postsCols = db.pragma('table_info(posts)').map(r => r.name);
if (!postsCols.includes('url'))              db.exec('ALTER TABLE posts ADD COLUMN url TEXT');
if (!postsCols.includes('angle'))            db.exec('ALTER TABLE posts ADD COLUMN angle TEXT');
if (!postsCols.includes('thumbnail_url'))    db.exec('ALTER TABLE posts ADD COLUMN thumbnail_url TEXT');
if (!postsCols.includes('format'))           db.exec('ALTER TABLE posts ADD COLUMN format TEXT');
if (!postsCols.includes('duration_seconds')) db.exec('ALTER TABLE posts ADD COLUMN duration_seconds INTEGER');

console.log('✓ All column migrations applied');

// ── Step 4: Verify zero data rows ─────────────────────────────────────────────
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map(r => r.name);

let totalRows = 0;
tables.forEach(t => {
  const n = db.prepare(`SELECT COUNT(*) as n FROM "${t}"`).get().n;
  totalRows += n;
  if (n > 0) console.warn(`  ⚠ ${t} has ${n} rows — should be 0!`);
});

if (totalRows === 0) {
  console.log(`✓ Verified: ${tables.length} tables, zero data rows`);
} else {
  console.error(`✗ Template contains ${totalRows} data rows — aborting`);
  db.close();
  fs.unlinkSync(TEMPLATE_PATH);
  process.exit(1);
}

console.log('\nTables in template:');
tables.forEach(t => console.log(`  – ${t}`));

db.close();

const size = fs.statSync(TEMPLATE_PATH).size;
console.log(`\n✓ Template saved → ${TEMPLATE_PATH} (${(size / 1024).toFixed(1)} KB)\n`);
