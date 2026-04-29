/**
 * Kre8Ωr Database — src/db.js
 * better-sqlite3 — native synchronous SQLite, WAL mode, direct disk writes.
 * No in-memory buffering, no manual persist() calls, real ACID transactions.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In Electron mode, DB_PATH env var points to the user's AppData directory.
// In server/PM2 mode, fall back to the local database/ folder.
const DB_PATH     = process.env.DB_PATH    || path.join(__dirname, '..', 'database', 'kre8r.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

// Tenant context — transparently routes queries to the active tenant's DB.
// tenantContext.run({ db, profile, slug }, next) in middleware activates a context.
// Falls back to the owner singleton `db` when no tenant context is active.
const tenantContext = require('./utils/tenant-context');

let db;

// ─────────────────────────────────────────────
// INIT & PERSISTENCE
// ─────────────────────────────────────────────

function initDb() {
  // Ensure database directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(DB_PATH);

  // WAL mode: concurrent reads, no full-file rewrite on every write
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL'); // safe with WAL, faster than FULL

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  runMigrations();
  return db;
}

function runMigrations() {
  // Add columns to footage table that were introduced in Phase 2.
  // ALTER TABLE ADD COLUMN is safe on existing data — new rows get NULL.
  const footageCols = db.pragma('table_info(footage)').map(r => r.name);

  if (!footageCols.includes('creation_timestamp')) {
    db.exec('ALTER TABLE footage ADD COLUMN creation_timestamp TEXT');
    console.log('[DB] Migration: added footage.creation_timestamp');
  }
  if (!footageCols.includes('organized_path')) {
    db.exec('ALTER TABLE footage ADD COLUMN organized_path TEXT');
    console.log('[DB] Migration: added footage.organized_path');
  }
  if (!footageCols.includes('transcript_path')) {
    db.exec('ALTER TABLE footage ADD COLUMN transcript_path TEXT');
    console.log('[DB] Migration: added footage.transcript_path');
  }

  // CutΩr columns on cuts table
  const cutsCols = db.pragma('table_info(cuts)').map(r => r.name);
  if (!cutsCols.includes('reasoning')) {
    db.exec('ALTER TABLE cuts ADD COLUMN reasoning TEXT');
    console.log('[DB] Migration: added cuts.reasoning');
  }
  if (!cutsCols.includes('clip_path')) {
    db.exec('ALTER TABLE cuts ADD COLUMN clip_path TEXT');
    console.log('[DB] Migration: added cuts.clip_path');
  }
  if (!cutsCols.includes('rank')) {
    db.exec('ALTER TABLE cuts ADD COLUMN rank INTEGER');
    console.log('[DB] Migration: added cuts.rank');
  }
  if (!cutsCols.includes('transcript_excerpt')) {
    db.exec('ALTER TABLE cuts ADD COLUMN transcript_excerpt TEXT');
    console.log('[DB] Migration: added cuts.transcript_excerpt');
  }
  if (!cutsCols.includes('why_it_matters')) {
    db.exec('ALTER TABLE cuts ADD COLUMN why_it_matters TEXT');
    console.log('[DB] Migration: added cuts.why_it_matters');
  }
  if (!cutsCols.includes('suggested_use')) {
    db.exec('ALTER TABLE cuts ADD COLUMN suggested_use TEXT');
    console.log('[DB] Migration: added cuts.suggested_use');
  }
  if (!cutsCols.includes('saved_for_later')) {
    db.exec('ALTER TABLE cuts ADD COLUMN saved_for_later INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added cuts.saved_for_later');
  }

  // VaultΩr: orientation column + resolution-based backfill
  if (!footageCols.includes('orientation')) {
    db.exec('ALTER TABLE footage ADD COLUMN orientation TEXT');
    console.log('[DB] Migration: added footage.orientation');
    // Backfill existing records from their resolution string (e.g. "1920x1080")
    // width > height * 1.1 → horizontal, height > width * 1.1 → vertical, else → square
    db.exec(`
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
  const projectsCols = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsCols.includes('davinci_project_name')) {
    db.exec('ALTER TABLE projects ADD COLUMN davinci_project_name TEXT');
    console.log('[DB] Migration: added projects.davinci_project_name');
  }
  if (!projectsCols.includes('davinci_project_state')) {
    db.exec('ALTER TABLE projects ADD COLUMN davinci_project_state TEXT');
    console.log('[DB] Migration: added projects.davinci_project_state');
  }
  if (!projectsCols.includes('davinci_last_updated')) {
    db.exec('ALTER TABLE projects ADD COLUMN davinci_last_updated DATETIME');
    console.log('[DB] Migration: added projects.davinci_last_updated');
  }

  // CutΩr: off_script_gold flag on footage (set when gold moments are found)
  if (!footageCols.includes('off_script_gold')) {
    db.exec('ALTER TABLE footage ADD COLUMN off_script_gold INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added footage.off_script_gold');
  }

  // Footage table: BRAW proxy columns
  if (!footageCols.includes('braw_source_path')) {
    db.exec('ALTER TABLE footage ADD COLUMN braw_source_path TEXT');
    console.log('[DB] Migration: added footage.braw_source_path');
  }
  if (!footageCols.includes('is_proxy')) {
    db.exec('ALTER TABLE footage ADD COLUMN is_proxy INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added footage.is_proxy');
  }

  // DaVinci timelines table
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

  // VaultΩr: clip_distribution table (CREATE TABLE IF NOT EXISTS is safe)
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

  // AnalytΩr: add url column to posts
  const postsCols = db.pragma('table_info(posts)').map(r => r.name);
  if (!postsCols.includes('url')) {
    db.exec('ALTER TABLE posts ADD COLUMN url TEXT');
    console.log('[DB] Migration: added posts.url');
  }
  if (!postsCols.includes('angle')) {
    db.exec('ALTER TABLE posts ADD COLUMN angle TEXT');
    console.log('[DB] Migration: added posts.angle');
  }
  if (!postsCols.includes('thumbnail_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN thumbnail_url TEXT');
    console.log('[DB] Migration: added posts.thumbnail_url');
  }
  if (!postsCols.includes('format')) {
    db.exec('ALTER TABLE posts ADD COLUMN format TEXT');
    console.log('[DB] Migration: added posts.format');
  }
  if (!postsCols.includes('duration_seconds')) {
    db.exec('ALTER TABLE posts ADD COLUMN duration_seconds INTEGER');
    console.log('[DB] Migration: added posts.duration_seconds');
  }

  // EditΩr: footage.transcript — full Whisper text stored inline for fast multi-clip analysis
  if (!footageCols.includes('transcript')) {
    db.exec('ALTER TABLE footage ADD COLUMN transcript TEXT');
    console.log('[DB] Migration: added footage.transcript');
  }

  // EditΩr: projects.editor_state
  const projectsCols2 = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsCols2.includes('editor_state')) {
    db.exec('ALTER TABLE projects ADD COLUMN editor_state TEXT');
    console.log('[DB] Migration: added projects.editor_state');
  }

  // ComposΩr: projects.composor_state
  const projectsCols3 = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsCols3.includes('composor_state')) {
    db.exec('ALTER TABLE projects ADD COLUMN composor_state TEXT');
    console.log('[DB] Migration: added projects.composor_state');
  }

  // Id8Ωr: projects.id8r_data — JSON blob of research session (chosenConcept, researchSummary, packageData, briefData)
  if (!projectsCols3.includes('id8r_data')) {
    db.exec('ALTER TABLE projects ADD COLUMN id8r_data TEXT');
    console.log('[DB] Migration: added projects.id8r_data');
  }

  // ComposΩr: composor_tracks table
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

  // ComposΩr: public_path column (added after initial table creation)
  const composorCols = db.pragma('table_info(composor_tracks)').map(r => r.name);
  if (!composorCols.includes('public_path')) {
    db.exec('ALTER TABLE composor_tracks ADD COLUMN public_path TEXT');
    console.log('[DB] Migration: added composor_tracks.public_path');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_composor_project ON composor_tracks(project_id)');

  // EditΩr: selects table
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

  // WritΩr: writr_scripts table
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
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_writr_scripts_project ON writr_scripts(project_id)');

  // DirectΩr / ShootDay: shoot_takes table
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

  // PipΩr: project config columns
  const projectsCols4 = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsCols4.includes('setup_depth')) {
    db.exec('ALTER TABLE projects ADD COLUMN setup_depth TEXT');
    console.log('[DB] Migration: added projects.setup_depth');
  }
  if (!projectsCols4.includes('entry_point')) {
    db.exec('ALTER TABLE projects ADD COLUMN entry_point TEXT');
    console.log('[DB] Migration: added projects.entry_point');
  }
  if (!projectsCols4.includes('story_structure')) {
    db.exec('ALTER TABLE projects ADD COLUMN story_structure TEXT');
    console.log('[DB] Migration: added projects.story_structure');
  }
  if (!projectsCols4.includes('content_type')) {
    db.exec('ALTER TABLE projects ADD COLUMN content_type TEXT');
    console.log('[DB] Migration: added projects.content_type');
  }
  if (!projectsCols4.includes('high_concept')) {
    db.exec('ALTER TABLE projects ADD COLUMN high_concept TEXT');
    console.log('[DB] Migration: added projects.high_concept');
  }
  if (!projectsCols4.includes('estimated_duration_minutes')) {
    db.exec('ALTER TABLE projects ADD COLUMN estimated_duration_minutes INTEGER');
    console.log('[DB] Migration: added projects.estimated_duration_minutes');
  }
  if (!projectsCols4.includes('pipr_complete')) {
    db.exec('ALTER TABLE projects ADD COLUMN pipr_complete INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added projects.pipr_complete');
  }
  if (!projectsCols4.includes('writr_complete')) {
    db.exec('ALTER TABLE projects ADD COLUMN writr_complete INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added projects.writr_complete');
  }
  if (!projectsCols4.includes('active_script_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN active_script_id INTEGER');
    console.log('[DB] Migration: added projects.active_script_id');
  }

  // WritΩr: three output modes + session grouping
  const writrScriptsCols = db.pragma('table_info(writr_scripts)').map(r => r.name);
  if (!writrScriptsCols.includes('mode')) {
    db.exec("ALTER TABLE writr_scripts ADD COLUMN mode TEXT NOT NULL DEFAULT 'full'");
    console.log('[DB] Migration: added writr_scripts.mode');
  }
  if (!writrScriptsCols.includes('session_id')) {
    db.exec('ALTER TABLE writr_scripts ADD COLUMN session_id TEXT');
    console.log('[DB] Migration: added writr_scripts.session_id');
  }

  // AnalΩzr: projects.source — kre8r (native) vs youtube_import
  const projectsColsDna = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsColsDna.includes('source')) {
    db.exec("ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'kre8r'");
    console.log('[DB] Migration: added projects.source');
  }

  // One-time fix: YouTube-imported projects that got source='kre8r' due to the DEFAULT
  // on the ALTER TABLE migration. Any project with a youtube_video_id that has never
  // been through PipΩr setup (pipr_complete=0/null) is definitively a YouTube import.
  {
    const fixed = db.prepare(`
      UPDATE projects
      SET source = 'youtube_import'
      WHERE youtube_video_id IS NOT NULL
        AND source = 'kre8r'
        AND (pipr_complete IS NULL OR pipr_complete = 0)
    `).run();
    if (fixed.changes > 0) {
      console.log(`[DB] Migration: re-stamped ${fixed.changes} YouTube-import projects with source='youtube_import'`);
    }
  }

  // Fix: CSV-imported projects that landed with source='kre8r' because createImportProject
  // didn't set source yet. Identify them by current_stage='PUBLISHED' and no pipr_complete.
  // Only fix non-YouTube ones (youtube_video_id is null) since YouTube ones are handled above.
  {
    const platforms = ['tiktok', 'instagram', 'facebook'];
    for (const p of platforms) {
      const fixed = db.prepare(`
        UPDATE projects
        SET source = '${p}_import'
        WHERE current_stage = 'PUBLISHED'
          AND source = 'kre8r'
          AND youtube_video_id IS NULL
          AND id IN (
            SELECT DISTINCT project_id FROM posts WHERE platform = '${p}'
          )
      `).run();
      if (fixed.changes > 0) {
        console.log('[DB] Migration: re-stamped ' + fixed.changes + ' ' + p + ' CSV-import projects');
      }
    }
  }

  // AnalΩzr: kv_store — generic key/value cache (channel DNA clusters, profiles, etc.)
  db.exec(`CREATE TABLE IF NOT EXISTS kv_store (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Collaborator soul support — JSON array of creator slugs assigned to a project
  const projectsColsCollab = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsColsCollab.includes('collaborators')) {
    db.exec('ALTER TABLE projects ADD COLUMN collaborators TEXT');
    console.log('[DB] Migration: added projects.collaborators');
  }

  // Beta applications — public landing page form submissions
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_beta_status ON beta_applications(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_beta_created ON beta_applications(created_at)');

  // Bug reports — in-app beta feedback
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

  // NPS scores — post-workflow satisfaction
  db.exec(`CREATE TABLE IF NOT EXISTS nps_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    score      INTEGER NOT NULL,
    comment    TEXT,
    page       TEXT,
    project_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_nps_created ON nps_scores(created_at)');

  // Token usage tracking — AI API cost monitoring
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

  // SequenceΩr — email nurture/onboarding sequence builder
  db.exec(`CREATE TABLE IF NOT EXISTS email_sequences (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT,
    goal_type        TEXT    NOT NULL DEFAULT 'onboard',
    goal_description TEXT,
    audience         TEXT,
    email_count      INTEGER NOT NULL DEFAULT 5,
    timeframe_days   INTEGER NOT NULL DEFAULT 14,
    voice_profile    TEXT,
    chat_history     TEXT    NOT NULL DEFAULT '[]',
    plan             TEXT,
    status           TEXT    NOT NULL DEFAULT 'planning',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sequence_emails (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_id  INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    subject      TEXT,
    body         TEXT,
    send_day     INTEGER NOT NULL DEFAULT 0,
    purpose      TEXT,
    revised_at   DATETIME,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_seq_emails_seq ON sequence_emails(sequence_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_seq_created ON email_sequences(created_at)');

  // ShowΩr: shows + show_episodes + show_notifications tables
  db.exec(`CREATE TABLE IF NOT EXISTS shows (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT    NOT NULL,
    description             TEXT,
    show_type               TEXT    NOT NULL DEFAULT 'serialized',
    season                  INTEGER NOT NULL DEFAULT 1,
    season_arc              TEXT,
    central_question        TEXT,
    finale_answer           TEXT,
    audience_transformation TEXT,
    target_episodes         INTEGER NOT NULL DEFAULT 12,
    arc_position            TEXT    NOT NULL DEFAULT 'pilot',
    status                  TEXT    NOT NULL DEFAULT 'active',
    creator_id              TEXT    NOT NULL DEFAULT 'primary',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_shows_creator ON shows(creator_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_shows_status  ON shows(status)');

  db.exec(`CREATE TABLE IF NOT EXISTS show_episodes (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id                  INTEGER REFERENCES shows(id) ON DELETE CASCADE,
    project_id               INTEGER REFERENCES projects(id),
    episode_number           INTEGER,
    season                   INTEGER NOT NULL DEFAULT 1,
    title                    TEXT,
    what_was_established     TEXT,
    seeds_planted            TEXT,
    arc_advancement          TEXT,
    character_moments        TEXT,
    central_question_status  TEXT    NOT NULL DEFAULT 'introduced',
    episode_summary          TEXT,
    status                   TEXT    NOT NULL DEFAULT 'planned',
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_show_eps_show    ON show_episodes(show_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_show_eps_project ON show_episodes(project_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS show_notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id    INTEGER REFERENCES shows(id),
    type       TEXT,
    message    TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_show_notif_show ON show_notifications(show_id)');

  // ShowΩr: add show_id and episode_number to projects table
  const projectsColsShow = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsColsShow.includes('show_id')) {
    db.exec('ALTER TABLE projects ADD COLUMN show_id INTEGER');
    console.log('[DB] Migration: added projects.show_id');
  }
  if (!projectsColsShow.includes('episode_number')) {
    db.exec('ALTER TABLE projects ADD COLUMN episode_number INTEGER');
    console.log('[DB] Migration: added projects.episode_number');
  }

  // ShowΩr: add what_next_episode_should_address to show_episodes
  const showEpCols = db.pragma('table_info(show_episodes)').map(r => r.name);
  if (!showEpCols.includes('what_next_episode_should_address')) {
    db.exec('ALTER TABLE show_episodes ADD COLUMN what_next_episode_should_address TEXT');
    console.log('[DB] Migration: added show_episodes.what_next_episode_should_address');
  }
  if (!showEpCols.includes('youtube_url')) {
    db.exec('ALTER TABLE show_episodes ADD COLUMN youtube_url TEXT');
    console.log('[DB] Migration: added show_episodes.youtube_url');
  }
  if (!showEpCols.includes('themes')) {
    db.exec('ALTER TABLE show_episodes ADD COLUMN themes TEXT');
    console.log('[DB] Migration: added show_episodes.themes');
  }
  if (!showEpCols.includes('audience_signals')) {
    db.exec('ALTER TABLE show_episodes ADD COLUMN audience_signals TEXT');
    console.log('[DB] Migration: added show_episodes.audience_signals');
  }

  // NorthΩr — strategy and accountability engine
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      target_videos INTEGER DEFAULT 0,
      target_emails INTEGER DEFAULT 0,
      target_social_posts INTEGER DEFAULT 0,
      target_episodes INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(month, year)
    );

    CREATE TABLE IF NOT EXISTS northr_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      severity TEXT DEFAULT 'warning',
      title TEXT,
      message TEXT,
      action_url TEXT,
      action_label TEXT,
      read INTEGER DEFAULT 0,
      dismissed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS strategy_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT,
      year INTEGER,
      report_type TEXT DEFAULT 'monthly',
      content TEXT,
      data_snapshot TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── One-time dedup: remove duplicate YouTube posts caused by pre-upsert-guard
  //    imports. For each project that has more than one YouTube post, keep the one
  //    with the highest view count (or the latest id if no views) and delete the rest
  //    along with their analytics rows.
  try {
    const dupProjects = db.prepare(`
      SELECT project_id, COUNT(*) as cnt
      FROM posts
      WHERE platform = 'youtube'
      GROUP BY project_id
      HAVING cnt > 1
    `).all();

    if (dupProjects.length > 0) {
      console.log(`[DB] Dedup migration: found ${dupProjects.length} projects with duplicate YouTube posts`);
      for (const row of dupProjects) {
        // Keep the post with the most views; tie-break on highest id (most recent insert)
        const keep = db.prepare(`
          SELECT po.id
          FROM posts po
          LEFT JOIN analytics a ON a.post_id = po.id AND a.metric_name = 'views'
          WHERE po.project_id = ? AND po.platform = 'youtube'
          ORDER BY COALESCE(a.metric_value, 0) DESC, po.id DESC
          LIMIT 1
        `).get(row.project_id);

        if (!keep) continue;

        // Delete analytics rows for all OTHER posts on this project+platform
        db.prepare(`
          DELETE FROM analytics
          WHERE post_id IN (
            SELECT id FROM posts
            WHERE project_id = ? AND platform = 'youtube' AND id != ?
          )
        `).run(row.project_id, keep.id);

        // Delete the duplicate posts themselves
        db.prepare(`
          DELETE FROM posts
          WHERE project_id = ? AND platform = 'youtube' AND id != ?
        `).run(row.project_id, keep.id);
      }
      console.log(`[DB] Dedup migration: cleaned duplicate YouTube posts`);
      // Bust the DNA/Secrets cache so MirrΩr rebuilds with corrected view counts
      try {
        db.prepare(`UPDATE kv_store SET value = NULL WHERE key IN (
          'channel_dna_clusters','channel_dna_secrets','channel_dna_secrets_video_count'
        )`).run();
        console.log('[DB] Dedup migration: cleared DNA cache — views will recalculate on next open');
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[DB] Dedup migration error (non-fatal):', err.message);
  }

  // AssemblΩr / Shoot Folder — project-level camera SSD folder + archive tracking
  const projectsColsAssemblr = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsColsAssemblr.includes('shoot_folder')) {
    db.exec('ALTER TABLE projects ADD COLUMN shoot_folder TEXT');
    console.log('[DB] Migration: added projects.shoot_folder');
  }
  if (!projectsColsAssemblr.includes('archive_state')) {
    db.exec("ALTER TABLE projects ADD COLUMN archive_state TEXT");
    console.log('[DB] Migration: added projects.archive_state');
  }
  if (!projectsColsAssemblr.includes('archived_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN archived_at DATETIME');
    console.log('[DB] Migration: added projects.archived_at');
  }
  if (!projectsColsAssemblr.includes('folder_path')) {
    db.exec('ALTER TABLE projects ADD COLUMN folder_path TEXT');
    console.log('[DB] Migration: added projects.folder_path (intake project folder)');
  }

  // Short-form pipeline — format flag ('long' | 'short') flows through entire pipeline
  const projectsColsFormat = db.pragma('table_info(projects)').map(r => r.name);
  if (!projectsColsFormat.includes('format')) {
    db.exec("ALTER TABLE projects ADD COLUMN format TEXT NOT NULL DEFAULT 'long'");
    console.log('[DB] Migration: added projects.format (long|short)');
  }

  // AssemblΩr — proxy_path on footage so transcription always has a working file
  const footageColsAssemblr = db.pragma('table_info(footage)').map(r => r.name);
  if (!footageColsAssemblr.includes('proxy_path')) {
    db.exec('ALTER TABLE footage ADD COLUMN proxy_path TEXT');
    console.log('[DB] Migration: added footage.proxy_path');
  }
  // Campaign Builder — generated caption package per clip (JSON: {tiktok, instagram, facebook, shorts, lemon8})
  if (!footageColsAssemblr.includes('caption_package')) {
    db.exec('ALTER TABLE footage ADD COLUMN caption_package TEXT');
    console.log('[DB] Migration: added footage.caption_package');
  }

  // VaultΩr semantic search — subjects array from Claude Vision
  const footageColsSub = db.pragma('table_info(footage)').map(r => r.name);
  if (!footageColsSub.includes('subjects')) {
    db.exec('ALTER TABLE footage ADD COLUMN subjects TEXT');
    console.log('[DB] Migration: added footage.subjects');
  }

  // Id8Ωr phase checkpoints — crash-safe creative state between research phases
  db.exec(`CREATE TABLE IF NOT EXISTS session_checkpoints (
    session_id  TEXT    PRIMARY KEY,
    tool        TEXT    NOT NULL,
    data        TEXT    NOT NULL,
    updated_at  INTEGER NOT NULL
  )`);

  // Background jobs — long-running ops that survive browser navigation
  db.exec(`CREATE TABLE IF NOT EXISTS background_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    progress    INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    ok          INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    result      TEXT,
    error       TEXT,
    meta        TEXT,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bgjobs_type   ON background_jobs(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bgjobs_status ON background_jobs(status)');

  // WritΩr Room — server-side session persistence (prevents loss of beat revision work)
  db.exec(`CREATE TABLE IF NOT EXISTS writr_room_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL UNIQUE,
    messages    TEXT    NOT NULL DEFAULT '[]',
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_room_sessions_project ON writr_room_sessions(project_id)');

  // ClipsΩr — viral clip candidates extracted from completed videos
  db.exec(`CREATE TABLE IF NOT EXISTS viral_clips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id  INTEGER NOT NULL REFERENCES footage(id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    rank        INTEGER NOT NULL DEFAULT 1,
    start_time  REAL    NOT NULL,
    end_time    REAL    NOT NULL,
    duration    REAL,
    hook        TEXT,
    caption     TEXT,
    hashtags    TEXT,
    platform_fit TEXT,
    why_it_works TEXT,
    clip_type   TEXT    NOT NULL DEFAULT 'social',
    status      TEXT    NOT NULL DEFAULT 'candidate',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_viral_clips_footage ON viral_clips(footage_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_viral_clips_status  ON viral_clips(status)');

  // MirrΩr self-evaluation — strategy_reports gets evaluation columns
  const stratCols = db.pragma('table_info(strategy_reports)').map(r => r.name);
  if (!stratCols.includes('evaluation')) {
    db.exec('ALTER TABLE strategy_reports ADD COLUMN evaluation TEXT');
    console.log('[DB] Migration: added strategy_reports.evaluation');
  }
  if (!stratCols.includes('evaluated_at')) {
    db.exec('ALTER TABLE strategy_reports ADD COLUMN evaluated_at DATETIME');
    console.log('[DB] Migration: added strategy_reports.evaluated_at');
  }

  // ── Users table (auth system) ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'owner',
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // No automatic seed — fresh installs start with an empty users table.
  // The first-run setup wizard (GET /setup, POST /setup-api) creates the owner account.

  // ── Tenants (multi-tenancy sync + webhook routing) ─────────────────────────
  // Each tenant = one creator instance. The local desktop install IS a tenant.
  // On a hosted server, multiple tenants can share the same Express instance.
  // tenant_slug: URL-safe identifier used in webhook URLs (/api/tenant/:slug/...)
  // sync_token:  Bearer token the desktop app uses to push/pull data
  // data_dir:    Absolute path to this tenant's data folder (db, profile, .env)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_slug   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      display_name  TEXT    NOT NULL,
      sync_token    TEXT    NOT NULL UNIQUE,
      data_dir      TEXT,
      plan          TEXT    NOT NULL DEFAULT 'solo',
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_sync_at  TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenants_slug  ON tenants(tenant_slug)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenants_token ON tenants(sync_token)');

  // ── Sync log — track push/pull events per tenant ───────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
      direction   TEXT    NOT NULL,  -- 'push' | 'pull'
      payload_kb  REAL,
      status      TEXT    NOT NULL DEFAULT 'ok',
      error       TEXT,
      synced_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Persistent sessions — survive server restarts ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS express_sessions (
      sid        TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON express_sessions(expires_at)');

  // ── PostΩr — monthly revenue (YouTube Analytics API) ─────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS monthly_revenue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    month       TEXT    NOT NULL,
    platform    TEXT    NOT NULL DEFAULT 'youtube',
    revenue_usd REAL    NOT NULL DEFAULT 0,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(month, platform)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_monthly_rev_month ON monthly_revenue(month)');

  // ── PostΩr — platform connections + post history ───────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS platform_connections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    platform         TEXT    NOT NULL UNIQUE,
    access_token     TEXT    NOT NULL,
    refresh_token    TEXT,
    token_expires_at INTEGER,
    account_id       TEXT,
    account_name     TEXT,
    extra_data       TEXT,
    connected_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS postor_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER,
    platform     TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    video_path   TEXT,
    title        TEXT,
    description  TEXT,
    post_url     TEXT,
    post_id      TEXT,
    scheduled_at DATETIME,
    posted_at    DATETIME,
    error        TEXT,
    metadata     TEXT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_project  ON postor_posts(project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_platform ON postor_posts(platform)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_status   ON postor_posts(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_created  ON postor_posts(created_at)');

  // ── PostΩr Queue — scheduled posts ───────────────────────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS postor_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_path      TEXT    NOT NULL,
    platforms       TEXT    NOT NULL,  -- JSON array e.g. ["instagram","facebook"]
    title           TEXT,
    description     TEXT,
    ig_caption      TEXT,
    fb_description  TEXT,
    yt_privacy      TEXT    DEFAULT 'public',
    yt_tags         TEXT,              -- JSON array
    yt_category_id  INTEGER DEFAULT 22,
    yt_scheduled_at TEXT,
    scheduled_at    TEXT    NOT NULL,  -- ISO timestamp (UTC)
    status          TEXT    NOT NULL DEFAULT 'pending', -- pending|posting|posted|failed
    result          TEXT,              -- JSON result per platform
    error           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_postor_queue_status       ON postor_queue(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_postor_queue_scheduled_at ON postor_queue(scheduled_at)');

  // image_path column for Facebook photo posts added in MailΩr social distribution
  const queueCols = db.pragma('table_info(postor_queue)').map(r => r.name);
  if (!queueCols.includes('image_path')) {
    db.exec('ALTER TABLE postor_queue ADD COLUMN image_path TEXT');
    console.log('[DB] Migration: added postor_queue.image_path');
  }

  // Token usage: tenant_slug column for per-creator cost tracking
  const tokenCols = db.pragma('table_info(token_usage)').map(r => r.name);
  if (!tokenCols.includes('tenant_slug')) {
    db.exec('ALTER TABLE token_usage ADD COLUMN tenant_slug TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_token_tenant ON token_usage(tenant_slug)');
    console.log('[DB] Migration: added token_usage.tenant_slug');
  }

  // ── MarkΩr — copyright protection infrastructure ──────────────────────────

  // Watermark registry — one row per watermarked export
  db.exec(`CREATE TABLE IF NOT EXISTS watermarks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id       INTEGER,
    video_path       TEXT    NOT NULL,
    watermarked_path TEXT,
    seed             TEXT    NOT NULL,
    watermark_code   TEXT    NOT NULL,
    channel          TEXT    NOT NULL DEFAULT 'original',
    embedded_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_watermarks_footage ON watermarks(footage_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_watermarks_path    ON watermarks(video_path)');

  // Visual fingerprints — pHash per keyframe from each vault video
  db.exec(`CREATE TABLE IF NOT EXISTS video_fingerprints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id   INTEGER,
    video_path   TEXT    NOT NULL,
    frame_index  INTEGER,
    frame_time_s REAL,
    phash        TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_vfp_footage ON video_fingerprints(footage_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vfp_path    ON video_fingerprints(video_path)');

  // Audio fingerprints — per-video RMS energy signature
  db.exec(`CREATE TABLE IF NOT EXISTS audio_fingerprints (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id       INTEGER,
    video_path       TEXT    NOT NULL UNIQUE,
    fingerprint_data TEXT    NOT NULL,
    duration_s       REAL,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_afp_footage ON audio_fingerprints(footage_id)');

  // Fan reports — incoming from GuardΩr public site
  db.exec(`CREATE TABLE IF NOT EXISTS guard_reports (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_url        TEXT,
    submitted_file_path  TEXT,
    submitter_note       TEXT,
    platform             TEXT,
    report_type          TEXT    NOT NULL DEFAULT 'unknown',
    is_likely_legitimate INTEGER NOT NULL DEFAULT 0,
    match_type           TEXT,
    match_confidence     REAL,
    matched_footage_id   INTEGER,
    matched_video_title  TEXT,
    evidence_json        TEXT,
    status               TEXT    NOT NULL DEFAULT 'pending',
    claim_platform       TEXT,
    claim_reference      TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_guard_status  ON guard_reports(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_guard_created ON guard_reports(created_at)');

  // Add report_type + is_likely_legitimate to existing guard_reports tables (safe migration)
  const guardCols = db.pragma('table_info(guard_reports)').map(r => r.name);
  if (!guardCols.includes('report_type')) {
    db.exec("ALTER TABLE guard_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'unknown'");
    console.log('[DB] Migration: added guard_reports.report_type');
  }
  if (!guardCols.includes('is_likely_legitimate')) {
    db.exec('ALTER TABLE guard_reports ADD COLUMN is_likely_legitimate INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration: added guard_reports.is_likely_legitimate');
  }

  console.log('[DB] MarkΩr tables verified');

  // ── AffiliateΩr — click tracking + partner management ────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_partners (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_key    TEXT    NOT NULL UNIQUE,
    partner_name   TEXT    NOT NULL,
    tag_param      TEXT,
    tag_value      TEXT,
    commission_pct REAL    NOT NULL DEFAULT 0,
    signup_url     TEXT,
    status         TEXT    NOT NULL DEFAULT 'pending',
    notes          TEXT,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_links (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_key     TEXT    NOT NULL,
    link_key        TEXT    NOT NULL,
    label           TEXT    NOT NULL,
    destination_url TEXT    NOT NULL,
    tool            TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(partner_key, link_key)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_aff_links_partner ON affiliate_links(partner_key)');
  // Gear page columns — safe migrations, silently skip if already exist
  ['show_on_gear INTEGER DEFAULT 0','gear_category TEXT','gear_price TEXT','gear_emoji TEXT','gear_description TEXT','og_image_url TEXT']
    .forEach(col => { try { db.exec(`ALTER TABLE affiliate_links ADD COLUMN ${col}`); } catch(_) {} });
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_key TEXT    NOT NULL,
    link_key    TEXT,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    referrer    TEXT,
    clicked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_aff_clicks_partner ON affiliate_clicks(partner_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_aff_clicks_date    ON affiliate_clicks(clicked_at)');
  db.exec(`CREATE TABLE IF NOT EXISTS affiliate_commissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_key     TEXT    NOT NULL,
    link_key        TEXT,
    amount          REAL    NOT NULL,
    description     TEXT,
    received_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    orgr_synced     INTEGER NOT NULL DEFAULT 0,
    orgr_income_id  INTEGER,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed known partners if table is empty
  const affCount = db.prepare('SELECT COUNT(*) AS n FROM affiliate_partners').get().n;
  if (affCount === 0) {
    const ins = db.prepare(`INSERT OR IGNORE INTO affiliate_partners
      (partner_key,partner_name,tag_param,tag_value,commission_pct,signup_url,status,notes)
      VALUES (?,?,?,?,?,?,?,?)`);
    const seeds = [
      ['amazon','Amazon Associates','tag','7kinhomestead-20',3,'https://affiliate-program.amazon.com','active','Already active — tag 7kinhomestead-20'],
      ['billyLand','BillyLand',null,null,0,'https://billyland.com/affiliates','pending','Trusted partner — land listings'],
      ['landLimited','LandLimited',null,null,0,'https://landlimited.com','pending','Trusted partner — land listings'],
      ['onlineLandHub','OnlineLandHub',null,null,0,'https://onlinelandhub.com','pending','RSS feed + referral commission agreed'],
      ['meyerHatchery','Meyer Hatchery',null,null,0,'https://www.meyerhatchery.com/affiliates','pending','Chicks + poultry'],
      ['signatureSolar','Signature Solar',null,null,0,'https://signaturesolar.com/affiliate-program','pending','Solar equipment — direct, up to 9%, 7-day cookie'],
      ['liTime','LiTime Batteries',null,null,5,'https://ui.awin.com/merchant-profile/71451','pending','LiFePO4 batteries — on Awin (already have account), 5-6%'],
      ['sunGold','SunGold Power',null,null,6,'https://sungoldpower.com/pages/affiliate-program','pending','Solar panels — direct, 6%'],
      ['murrayMcmurray','Murray McMurray Hatchery',null,null,0,'https://www.mcmurrayhatchery.com/affiliates.html','pending','Hatchery + livestock'],
      ['trueLeaf','True Leaf Market',null,null,0,'https://trueleafmarket.com/pages/affiliate-program-trueleafmarket','pending','Seeds + sprouting — Pepperjam, fast approval'],
      ['yeti','YETI',null,null,6,'https://app.impact.com/advertiser-advertiser-info/YETI.brand','pending','Coolers/drinkware — on Impact (already have account), 5-7%, 30-day cookie'],
      ['carhartt','Carhartt',null,null,6,'https://www.carhartt.com/affiliate','pending','Work gear — on Impact (already have account), 4-8%'],
      ['harvestRight','Harvest Right',null,null,7,'https://affiliates.harvestright.com/home','pending','Freeze dryers — direct (iDevAffiliate), 3-10% tiered, 45-day cookie'],
      ['lehmans','Lehman\'s',null,null,0,'https://www.lehmans.com/affiliates','pending','Non-electric/off-grid supplies — Pepperjam, fast approval'],
      ['tractorSupply','Tractor Supply Co',null,null,0,'https://www.tractorsupply.com/tsc/cms/policies-information/affiliate-program','pending','Farm/animal/tool supplies — Partnerize, 2-3 days'],
      ['northernTool','Northern Tool + Equipment',null,null,0,'https://www.northerntool.com/affiliate-program','pending','Tools + equipment — CJ Affiliate, fast approval'],
      ['milwaukee','Milwaukee Tool',null,null,8,'https://www.flexoffers.com/affiliate-programs/milwaukee-affiliate-program/','pending','Power tools — CJ Affiliate, up to 10%'],
      ['duluthTrading','Duluth Trading Company',null,null,7,'https://www.duluthtrading.com/affiliate-program.html','pending','Work gear — AvantLink, 5-10%, 14-day cookie'],
    ];
    const tx = db.transaction(() => { for (const s of seeds) ins.run(...s); });
    tx();
    console.log('[DB] AffiliateΩr: seeded 18 partner records');
  }

  // Migration: remove no-program partners, add new gear shop partners
  // Idempotent — checks for bakerCreek existence before running
  const bakerExists = db.prepare("SELECT id FROM affiliate_partners WHERE partner_key='bakerCreek'").get();
  if (bakerExists) {
    const ins = db.prepare(`INSERT OR IGNORE INTO affiliate_partners
      (partner_key,partner_name,tag_param,tag_value,commission_pct,signup_url,status,notes)
      VALUES (?,?,?,?,?,?,?,?)`);
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM affiliate_partners WHERE partner_key IN ('bakerCreek','premier1')").run();
      ins.run('yeti','YETI',null,null,6,'https://app.impact.com/advertiser-advertiser-info/YETI.brand','pending','Coolers/drinkware — on Impact (already have account), 5-7%, 30-day cookie');
      ins.run('carhartt','Carhartt',null,null,6,'https://www.carhartt.com/affiliate','pending','Work gear — on Impact (already have account), 4-8%');
      ins.run('harvestRight','Harvest Right',null,null,7,'https://affiliates.harvestright.com/home','pending','Freeze dryers — direct (iDevAffiliate), 3-10% tiered, 45-day cookie');
      ins.run('lehmans',"Lehman's",null,null,0,'https://www.lehmans.com/affiliates','pending','Non-electric/off-grid supplies — Pepperjam, fast approval');
      ins.run('tractorSupply','Tractor Supply Co',null,null,0,'https://www.tractorsupply.com/tsc/cms/policies-information/affiliate-program','pending','Farm/animal/tool supplies — Partnerize, 2-3 days');
      ins.run('northernTool','Northern Tool + Equipment',null,null,0,'https://www.northerntool.com/affiliate-program','pending','Tools + equipment — CJ Affiliate, fast approval');
      ins.run('milwaukee','Milwaukee Tool',null,null,8,'https://www.flexoffers.com/affiliate-programs/milwaukee-affiliate-program/','pending','Power tools — CJ Affiliate, up to 10%');
      ins.run('duluthTrading','Duluth Trading Company',null,null,7,'https://www.duluthtrading.com/affiliate-program.html','pending','Work gear — AvantLink, 5-10%, 14-day cookie');
      // Update existing entries with corrected URLs + commission rates
      db.prepare("UPDATE affiliate_partners SET signup_url='https://signaturesolar.com/affiliate-program', notes='Solar equipment — direct, up to 9%, 7-day cookie' WHERE partner_key='signatureSolar'").run();
      db.prepare("UPDATE affiliate_partners SET commission_pct=5, signup_url='https://ui.awin.com/merchant-profile/71451', notes='LiFePO4 batteries — on Awin (already have account), 5-6%' WHERE partner_key='liTime'").run();
      db.prepare("UPDATE affiliate_partners SET commission_pct=6, signup_url='https://sungoldpower.com/pages/affiliate-program' WHERE partner_key='sunGold'").run();
      db.prepare("UPDATE affiliate_partners SET signup_url='https://trueleafmarket.com/pages/affiliate-program-trueleafmarket', notes='Seeds + sprouting — Pepperjam, fast approval' WHERE partner_key='trueLeaf'").run();
    });
    tx();
    console.log('[DB] AffiliateΩr migration: removed bakerCreek+premier1, added 8 new gear shop partners');
  }

  // ── VectΩr — Strategic Briefs ─────────────────────────────────────────────
  // strategic_briefs lives only in bootstrapTenantTables; add here so Jason's
  // main DB gets the table created on first startup after this migration lands.
  db.exec(`CREATE TABLE IF NOT EXISTS strategic_briefs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_context  TEXT,
    conversation_json TEXT,
    brief_json        TEXT NOT NULL,
    locked_at         TEXT NOT NULL DEFAULT (datetime('now')),
    status            TEXT NOT NULL DEFAULT 'active',
    superseded_at     TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_brief_status ON strategic_briefs(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_brief_locked ON strategic_briefs(locked_at)');
  console.log('[DB] VectΩr strategic_briefs table verified');

  // ── AffiliateΩr — Seed tracked tool-page links ──────────────────────────────
  // These links power /r/ redirects on kre8r-land tool pages.
  // INSERT OR IGNORE is idempotent — safe to run on every startup.
  const seedLinks = db.prepare(`INSERT OR IGNORE INTO affiliate_links
    (partner_key, link_key, label, destination_url, tool, show_on_gear, gear_category, gear_emoji, gear_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const toolLinkSeeds = [
    // Water page
    ['amazon',       'ibc-tote',          'IBC Tote (275 gal)',         'https://www.amazon.com/s?k=ibc+tote+275+gallon+food+grade&tag=7kinhomestead-20',        'water',     1, 'Water Storage',  '💧', 'Food-grade poly, stackable. Stack 4–6 for serious storage.'],
    ['amazon',       'big-berkey',        'Big Berkey Gravity Filter',  'https://www.amazon.com/s?k=big+berkey+gravity+filter&tag=7kinhomestead-20',             'water',     1, 'Water Filtration','🧹', 'No pump, no electricity. Removes 99.9% of bacteria. Drinking-water ready.'],
    ['amazon',       'pressure-canner',   'Presto 23qt Pressure Canner','https://www.amazon.com/s?k=presto+23qt+pressure+canner&tag=7kinhomestead-20',          'lifestyle', 1, 'Food Preservation','🫙', 'The non-negotiable. Food preservation starts here.'],
    ['amazon',       'chest-freezer',     '7cu ft Chest Freezer',       'https://www.amazon.com/s?k=7+cubic+foot+chest+freezer&tag=7kinhomestead-20',            'lifestyle', 1, 'Food Storage',   '❄️', 'Butcher your own meat. Store a full season.'],
    ['amazon',       'baker-creek-seeds', 'Baker Creek Heirloom Seeds', 'https://www.rareseeds.com/',                                                             'lifestyle', 1, 'Seeds',          '🌱', 'Non-GMO. Save your own seed year after year.'],
    // Solar page
    ['liTime',       '100ah-battery',     'LiTime LiFePO4 100Ah',       'https://www.amazon.com/s?k=LiTime+LiFePO4+100Ah+battery&tag=7kinhomestead-20',          'solar',     1, 'Batteries',      '🔋', 'Built-in BMS. Drop-in replacement. Trusted by 7 Kin.'],
    ['liTime',       '200ah-battery',     'LiTime LiFePO4 200Ah',       'https://www.amazon.com/s?k=LiTime+LiFePO4+200Ah+self-heating+battery&tag=7kinhomestead-20','solar',  1, 'Batteries',      '🔋', 'Self-heating, built-in BMS. For larger off-grid systems.'],
    ['sunGold',      'panels',            'SunGold Power Solar Panels',  'https://www.amazon.com/s?k=SunGold+Power+solar+panel&tag=7kinhomestead-20',             'solar',     1, 'Solar Panels',   '☀️', 'Bifacial, up to 30% more power. Personally used by Jason.'],
    // Hatchery
    ['meyerHatchery','egg-chickens',      'Meyer Hatchery — Egg Chickens','https://www.meyerhatchery.com/category_s/1.htm',                                       'lifestyle', 1, 'Livestock',      '🐣', 'Start here. 6 hens. Master this before anything else.'],
    // Gear page — Solar
    ['signatureSolar','200w-panel',        '200W Monocrystalline Panel',   'https://signaturesolar.com/collections/solar-panels',                                  'solar',     1, 'Solar',          '🔆', 'The panel we built our whole system around. Reliable output, built to survive hail and dumb mistakes.'],
    ['amazon',       'mppt-controller',   '40A MPPT Charge Controller',   'https://www.amazon.com/s?k=40A+MPPT+charge+controller+solar&tag=7kinhomestead-20',     'solar',     1, 'Solar',          '⚡', 'MPPT over PWM every single time. The brain of the system.'],
    ['signatureSolar','lifepo4-100ah',     '100Ah LiFePO4 Battery',        'https://signaturesolar.com/collections/lithium-batteries',                             'solar',     1, 'Solar',          '🔋', 'Switched from lead-acid and haven\'t looked back. 4000+ cycles, no maintenance.'],
    ['amazon',       'pure-sine-inverter','2000W Pure Sine Inverter',      'https://www.amazon.com/s?k=2000W+pure+sine+wave+inverter&tag=7kinhomestead-20',        'solar',     1, 'Solar',          '🔌', 'Pure sine or don\'t bother. Modified sine waves will kill your sensitive electronics.'],
    // Gear page — Water
    ['amazon',       'shurflo-pump',      '12V Diaphragm Water Pump',     'https://www.amazon.com/s?k=shurflo+12v+diaphragm+water+pump&tag=7kinhomestead-20',     'water',     1, 'Water',          '💧', 'Runs off a single solar panel. Quiet, reliable, handles 20-foot head.'],
    ['amazon',       'poly-tank-1500',    '1500 Gallon Poly Storage Tank', 'https://www.tankdepot.com/category/above-ground-poly-tanks',                           'water',     1, 'Water',          '🛢️', 'Rainwater collection anchor. UV-stabilized black poly. Get bigger than you think you need.'],
    // Gear page — Tools
    ['milwaukee',    'reciprocating-saw', 'Reciprocating Saw',             'https://www.amazon.com/s?k=Milwaukee+reciprocating+saw&tag=7kinhomestead-20',          'tools',     1, 'Tools',          '🪚', 'The tool Jason reaches for more than any other. Demo, rough framing, cutting fence posts.'],
    ['amazon',       'post-hole-digger',  'Post Hole Digger (Manual)',     'https://www.amazon.com/s?k=manual+post+hole+digger+clamshell&tag=7kinhomestead-20',    'tools',     1, 'Tools',          '⛏️', 'Two handles, two blades, zero fuel costs. Your hands will adapt.'],
    ['amazon',       'dewalt-drill',      '18V Cordless Drill Kit',        'https://www.amazon.com/s?k=DeWalt+18V+cordless+drill+kit&tag=7kinhomestead-20',        'tools',     1, 'Tools',          '🔧', 'Two batteries, a charger, and a case. 18V platform works across a dozen tools.'],
    // Gear page — Animals
    ['murrayMcmurray','dual-purpose-chicks','Dual-Purpose Meat & Layer Chicks','https://www.mcmurrayhatchery.com/category/dual-purpose-breeds',                    'lifestyle', 1, 'Animals',        '🐔', 'When you want eggs AND a freezer full of chicken. Murray McMurray since 1917.'],
    ['amazon',       'chicken-feeder',    'Galvanized Hanging Feeder',     'https://www.amazon.com/s?k=galvanized+hanging+poultry+feeder&tag=7kinhomestead-20',    'lifestyle', 1, 'Animals',        '🌾', 'Simple, rodent-resistant, doesn\'t mold like plastic.'],
    // Gear page — Garden
    ['trueLeaf',     'microgreens-seeds', 'Microgreens Seed Variety Pack', 'https://www.trueleafmarket.com/collections/microgreens',                               'lifestyle', 1, 'Garden',         '🌱', 'Fastest food production in a small space. Best germination rates tested.'],
    ['amazon',       'raised-bed',        '4x8 Raised Bed Kit',            'https://www.amazon.com/s?k=galvanized+steel+4x8+raised+bed+kit&tag=7kinhomestead-20',  'lifestyle', 1, 'Garden',         '🥕', 'Galvanized steel. Doesn\'t rot, doesn\'t leach, doesn\'t warp.'],
    // Gear page — Food Prep
    ['amazon',       'mason-jars',        'Ball Wide Mouth Mason Jars',    'https://www.amazon.com/s?k=Ball+wide+mouth+mason+jars+12+pack&tag=7kinhomestead-20',   'lifestyle', 1, 'Food Prep',      '🫙', 'The standard for a reason. Buy cases, not 12-packs. You will run out.'],
    // Gear page — Fencing
    ['amazon',       'premier1-netting',  'ElectroNet Poultry Netting',    'https://www.premier1supplies.com/c/poultry-fencing',                                   'lifestyle', 1, 'Fencing',        '⚡', 'Moveable electric poultry fence. Premier1 is the only brand worth buying.'],
    ['amazon',       'field-fence',       'Field Fence 330ft Roll',        'https://www.amazon.com/s?k=Red+Brand+field+fence+330ft&tag=7kinhomestead-20',          'lifestyle', 1, 'Fencing',        '🪢', 'For permanent perimeter. Heavy gauge, holds up to weather and goats.'],
    ['amazon',       'tpost-driver',      'T-Post Driver',                 'https://www.amazon.com/s?k=t-post+driver+manual&tag=7kinhomestead-20',                 'lifestyle', 1, 'Fencing',        '🔩', '30 seconds per post once you get the rhythm. Your shoulders will thank you.'],
  ];
  const linkTx = db.transaction(() => { for (const r of toolLinkSeeds) seedLinks.run(...r); });
  linkTx();
  console.log('[DB] AffiliateΩr tool-page links verified');

  // ── AffiliateΩr — Fix tag + wire real storefront product URLs ────────────────
  // One-time migration: replaces placeholder search URLs with real Amazon product
  // pages from Jason's storefront. Tag corrected to jasonrutland-20 everywhere.
  // Sentinel: presence of 'water-bladder' link_key = already run.
  const storefrontDone = db.prepare("SELECT id FROM affiliate_links WHERE partner_key='amazon' AND link_key='water-bladder'").get();
  if (!storefrontDone) {
    const T = 'jasonrutland-20';
    const upd = db.prepare('UPDATE affiliate_links SET destination_url=?, label=?, gear_description=? WHERE partner_key=? AND link_key=?');
    const updUrl = db.prepare('UPDATE affiliate_links SET destination_url=? WHERE partner_key=? AND link_key=?');

    // Fix the fake 7kinhomestead-20 tag on every existing link that used it
    db.prepare("UPDATE affiliate_links SET destination_url=REPLACE(destination_url,'7kinhomestead-20',?)").run(T);

    // Update existing links with real product URLs
    upd.run(`https://www.amazon.com/dp/B0FFPH444Z?tag=${T}`, '2500 Gallon Vertical Water Storage Tank', '2500 gal UV-resistant poly tank by Elkhart Plastics. The real homestead anchor.', 'amazon', 'poly-tank-1500');
    upd.run(`https://www.amazon.com/dp/B0BYH8J176?tag=${T}`, 'LiTime 12V 230Ah LiFePO4 Battery', '4000+ cycles, no maintenance. The battery bank we actually run.', 'liTime', '100ah-battery');
    upd.run(`https://www.amazon.com/dp/B0FWRFLF31?tag=${T}`, 'SunGold 10×590W Bifacial Solar Panels', 'N-type bifacial — generates from both sides. What we run on the homestead.', 'sunGold', 'panels');
    updUrl.run(`https://www.amazon.com/dp/B0DG8MLDST?tag=${T}`, 'amazon', 'pure-sine-inverter');
    updUrl.run(`https://www.amazon.com/dp/B0CL3K19XH?tag=${T}`, 'milwaukee', 'reciprocating-saw');
    // Fix wrong brand entries (Signature Solar → SunGold, placeholder → real product)
    upd.run(`https://www.amazon.com/dp/B0C278SVF5?tag=${T}`, 'SunGold 8×450W Solar Panels', 'CEC-listed monocrystalline. Solid starter array for off-grid cabins and shops.', 'signatureSolar', '200w-panel');
    upd.run(`https://www.amazon.com/dp/B0BYH8J176?tag=${T}`, 'LiTime 12V 230Ah LiFePO4 Battery', '4000+ cycles, built-in BMS. What we switched to from lead-acid.', 'signatureSolar', 'lifepo4-100ah');
    upd.run(`https://www.amazon.com/dp/B0DG8MLDST?tag=${T}`, 'SunGold 6500W 48V Solar Inverter', 'Split-phase, built-in dual MPPT, WiFi monitoring. Powers the whole homestead.', 'amazon', 'pure-sine-inverter');
    // Fix DeWalt drill → Milwaukee combo kit
    upd.run(`https://www.amazon.com/dp/B017Y7WG7Q?tag=${T}`, 'Milwaukee M18 Fuel 6-Tool Combo Kit', '6 tools, 2 batteries, charger, 2 bags. The kit that runs the whole build.', 'amazon', 'dewalt-drill');

    // Insert new storefront products — Water list
    const ins = db.prepare(`INSERT OR IGNORE INTO affiliate_links
      (partner_key,link_key,label,destination_url,tool,show_on_gear,gear_category,gear_emoji,gear_description)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const newLinks = [
      // Water
      ['amazon','water-bladder',      '1000 Gallon Foldable Water Bladder',  `https://www.amazon.com/dp/B0CKW3NLSF?tag=${T}`,  'water', 1, 'Water',      '🛢️', 'Foldable, portable, 1000 gal. Drought reserve, fire prevention, emergency supply.'],
      ['amazon','rain-barrel',        '200 Gallon Collapsible Rain Barrel',   `https://www.amazon.com/dp/B0FPXQZ87N?tag=${T}`,  'water', 1, 'Water',      '💧', 'Foldable rain barrel with faucet. 200 gal for garden irrigation and collection.'],
      ['amazon','ibc-tote-cover',     'IBC Tote Cover 275 Gal (Waterproof)',  `https://www.amazon.com/dp/B0DLP33GMH?tag=${T}`,  'water', 1, 'Water',      '🔲', '600D heavy-duty waterproof UV cover with zipper. Protects your IBC from weather.'],
      ['amazon','ibc-tote-adapter',   'IBC Tote Hose Adapter 275–330 Gal',   `https://www.amazon.com/dp/B0F54JPYPP?tag=${T}`,  'water', 1, 'Water',      '🔧', 'Multi-thread adapter with 3/4" brass hose faucet. Taps your IBC to a garden hose.'],
      // Solar — additional panel configs
      ['sunGold','500w-panels',       'SunGold 10×500W Mono Solar Panels',    `https://www.amazon.com/dp/B0F2HSH34F?tag=${T}`,  'solar', 1, 'Solar',      '☀️', '10-panel 5000W system, IP68, UL61730. On/off-grid. What we built the homestead on.'],
      ['sunGold','450w-panels',       'SunGold 8×450W Solar Panels (CEC)',    `https://www.amazon.com/dp/B0C278SVF5?tag=${T}`,  'solar', 1, 'Solar',      '☀️', 'CEC-listed, Class A cells. 3600W total. Solid starter array for cabins and shops.'],
      ['sunGold','10000w-inverter',   'SunGold 10000W 48V Solar Inverter',    `https://www.amazon.com/dp/B0CJV387LX?tag=${T}`,  'solar', 1, 'Solar',      '🔌', '10kW split-phase, dual MPPT, 200A charging, AC 120/240V. Full-homestead scale.'],
      ['sunGold','6500w-inverter',    'SunGold 6500W 48V Solar Inverter',     `https://www.amazon.com/dp/B0DG8MLDST?tag=${T}`,  'solar', 1, 'Solar',      '🔌', 'Split-phase, dual MPPT, WiFi monitoring, pure sine wave. Powers the whole build.'],
      ['amazon', 'generator',         'Westinghouse 12500W Dual Fuel Generator',`https://www.amazon.com/dp/B07Q1DLKBG?tag=${T}`,'solar', 1, 'Solar',      '⚡', 'Gas or propane, remote start, transfer-switch ready. Backup when the sun doesn\'t cooperate.'],
      ['amazon', 'wire-cable',        '10 Gauge Tinned Copper Wire (30+30 ft)',`https://www.amazon.com/dp/B08HSC5NW5?tag=${T}`,  'solar', 1, 'Solar',      '🔌', 'Tinned copper resists corrosion. Red + black 10 AWG for solar, marine, and trailer wiring.'],
      ['amazon', 'crimping-tool',     'Battery Cable Lug Crimping Tool',      `https://www.amazon.com/dp/B00MVE48Z6?tag=${T}`,  'solar', 1, 'Solar',      '🔧', 'Handles 8–1/0 AWG with built-in wire shear. The right tool for battery terminal work.'],
      ['amazon', 'battery-lugs',      '1/0 AWG Battery Lugs + Heat Shrink',   `https://www.amazon.com/dp/B08R6TX3XM?tag=${T}`,  'solar', 1, 'Solar',      '🔩', '10 ring terminal lugs with 3:1 heat shrink. 3/8" hole, heavy-duty battery connections.'],
      ['liTime', '230ah-battery',     'LiTime 12V 230Ah LiFePO4 Battery',     `https://www.amazon.com/dp/B0BYH8J176?tag=${T}`,  'solar', 1, 'Batteries',  '🔋', '4000+ deep cycles, no maintenance. The battery bank we actually run on the homestead.'],
      // Milwaukee tools
      ['milwaukee','combo-6tool',     'Milwaukee M18 Fuel 6-Tool Combo Kit',  `https://www.amazon.com/dp/B017Y7WG7Q?tag=${T}`,  'tools', 1, 'Tools',      '🧰', '6 tools, 2×5Ah batteries, charger, 2 bags. The M18 platform that runs the homestead.'],
      ['milwaukee','combo-2tool',     'Milwaukee M18 Fuel 2-Tool Combo Kit',  `https://www.amazon.com/dp/B0BB8FDVLQ?tag=${T}`,  'tools', 1, 'Tools',      '🔧', 'M18 Fuel 2-tool kit. Good entry into the M18 system.'],
      ['milwaukee','battery-60ah',    'Milwaukee M18 6.0Ah Battery 2-Pack',   `https://www.amazon.com/dp/B0DW488CLH?tag=${T}`,  'tools', 1, 'Tools',      '🔋', 'HIGH Output REDLITHIUM 6.0Ah. More runtime for heavy cuts and long sessions.'],
      ['milwaukee','battery-50ah',    'Milwaukee M18 5Ah Battery 2-Pack',     `https://www.amazon.com/dp/B0B8TDYXBP?tag=${T}`,  'tools', 1, 'Tools',      '🔋', 'XC Extended Capacity 5Ah 2-pack. Standard workhorse batteries for the M18 system.'],
      ['milwaukee','oscillating-tool','Milwaukee M18 Fuel Oscillating Multi-Tool',`https://www.amazon.com/dp/B0B7HWXDRJ?tag=${T}`,'tools',1,'Tools',       '🔪', 'Cordless oscillating tool kit. Precision cuts, sanding, demo — indispensable for finish work.'],
      ['milwaukee','circular-saw',    'Milwaukee M18 Circular Saw 7-1/4"',    `https://www.amazon.com/dp/B07VWKR5YN?tag=${T}`,  'tools', 1, 'Tools',      '🪚', 'Rear-handle 7-1/4" cordless circular saw. Runs all day on M18 batteries.'],
      ['milwaukee','string-trimmer',  'Milwaukee M18 Fuel String Trimmer',    `https://www.amazon.com/dp/B0F1G2XR3P?tag=${T}`,  'tools', 1, 'Tools',      '🌿', 'Quik-LOK attachment system. Battery-powered, no exhaust on the homestead.'],
      ['milwaukee','tape-measure',    'Milwaukee Compact Magnetic Tape Measure',`https://www.amazon.com/dp/B082L6Q7WV?tag=${T}`, 'tools', 1, 'Tools',      '📏', 'Wide blade, magnetic tip, compact. The one on every tool belt on the homestead.'],
    ];
    const newLinkTx = db.transaction(() => { for (const r of newLinks) ins.run(...r); });
    newLinkTx();
    console.log('[DB] AffiliateΩr storefront migration: tag fixed + 22 real product links added');
  }

  // ── AffiliateΩr — Fix 3 ASINs that were returning 500 ─────────────────────
  // Sentinel: wire-cable updated to the correct welding-cable ASIN
  const asinFixDone = db.prepare("SELECT id FROM affiliate_links WHERE partner_key='amazon' AND link_key='wire-cable' AND destination_url LIKE '%B016HFD788%'").get();
  if (!asinFixDone) {
    const T = 'jasonrutland-20';
    const asinFix = db.prepare('UPDATE affiliate_links SET destination_url=?, label=?, gear_description=? WHERE partner_key=? AND link_key=?');
    asinFix.run(
      `https://www.amazon.com/dp/B09ZPG2Y9F?tag=${T}`,
      'IBC Tote Waterproof Cover (275 Gal)',
      '600D heavy-duty waterproof UV cover with zipper access. Keeps your IBC tote protected year-round.',
      'amazon', 'ibc-tote-cover'
    );
    asinFix.run(
      `https://www.amazon.com/dp/B0FKH2QW5Z?tag=${T}`,
      '50–2000 Gallon Foldable Water Storage Tank',
      'Heavy-duty PVC foldable water tank. Emergency reserve, rainwater, fire prevention — collapses flat when not in use.',
      'amazon', 'water-bladder'
    );
    asinFix.run(
      `https://www.amazon.com/dp/B016HFD788?tag=${T}`,
      'EWCS 1/0 Gauge Welding Cable Combo Pack (15+15 ft)',
      'Extra-flexible 600V welding cable, black + red. The right wire for serious battery bank connections.',
      'amazon', 'wire-cable'
    );
    console.log('[DB] AffiliateΩr: fixed 3 ASIN 500s (ibc-tote-cover, water-bladder, wire-cable)');
  }

  // ── AffiliateΩr — Gear Categories ─────────────────────────────────────────
  // DB-backed categories for gear.html filter chips and link modal dropdown.
  // color_var references a CSS variable name defined in gear.html :root.
  db.exec(`CREATE TABLE IF NOT EXISTS gear_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_key    TEXT    NOT NULL UNIQUE,
    cat_label  TEXT    NOT NULL,
    cat_emoji  TEXT    NOT NULL DEFAULT '📦',
    color_var  TEXT    NOT NULL DEFAULT '--teal',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gear_cats_sort ON gear_categories(sort_order)');

  // Seed 7 existing categories if table is empty
  const gearCatCount = db.prepare('SELECT COUNT(*) AS n FROM gear_categories').get().n;
  if (gearCatCount === 0) {
    const insC = db.prepare(`INSERT OR IGNORE INTO gear_categories
      (cat_key, cat_label, cat_emoji, color_var, sort_order) VALUES (?,?,?,?,?)`);
    const catTx = db.transaction(() => {
      insC.run('solar',   'Solar',    '☀️', '--gold',   1);
      insC.run('water',   'Water',    '💧', '--blue',   2);
      insC.run('tools',   'Tools',    '🔧', '--orange', 3);
      insC.run('animals', 'Animals',  '🐓', '--green',  4);
      insC.run('garden',  'Garden',   '🌱', '--teal',   5);
      insC.run('food',    'Food Prep','🥫', '--red',    6);
      insC.run('fencing', 'Fencing',  '🪢', '--purple', 7);
    });
    catTx();
    console.log('[DB] AffiliateΩr: seeded 7 gear categories');
  }
}

/**
 * bootstrapTenantTables(tdb)
 *
 * Applies the complete current schema to a fresh tenant DB instance.
 * Called by tenant-db-cache.js after schema.sql (which only has the base 14 tables).
 * All statements are idempotent (CREATE TABLE IF NOT EXISTS / ALTER TABLE guarded).
 * Does NOT run backfill/dedup one-time migrations — those are Jason's-data-only.
 */
function bootstrapTenantTables(tdb) {
  const exec = sql => { try { tdb.exec(sql); } catch (_) {} };
  const cols = tbl => tdb.pragma(`table_info(${tbl})`).map(r => r.name);
  const addCol = (tbl, col, def) => { if (!cols(tbl).includes(col)) exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); };

  // ── Column additions to base-schema tables ────────────────────────────────
  addCol('footage', 'creation_timestamp',  'TEXT');
  addCol('footage', 'organized_path',      'TEXT');
  addCol('footage', 'transcript_path',     'TEXT');
  addCol('footage', 'orientation',         'TEXT');
  addCol('footage', 'braw_source_path',    'TEXT');
  addCol('footage', 'is_proxy',            'INTEGER NOT NULL DEFAULT 0');
  addCol('footage', 'transcript',          'TEXT');
  addCol('footage', 'proxy_path',          'TEXT');
  addCol('footage', 'subjects',            'TEXT');

  addCol('cuts', 'reasoning',         'TEXT');
  addCol('cuts', 'clip_path',         'TEXT');
  addCol('cuts', 'rank',              'INTEGER');
  addCol('cuts', 'transcript_excerpt','TEXT');
  addCol('cuts', 'why_it_matters',    'TEXT');
  addCol('cuts', 'suggested_use',     'TEXT');
  addCol('cuts', 'saved_for_later',   'INTEGER NOT NULL DEFAULT 0');

  addCol('posts', 'url',              'TEXT');
  addCol('posts', 'angle',            'TEXT');
  addCol('posts', 'thumbnail_url',    'TEXT');
  addCol('posts', 'format',           'TEXT');
  addCol('posts', 'duration_seconds', 'INTEGER');

  addCol('projects', 'editor_state',                 'TEXT');
  addCol('projects', 'composor_state',               'TEXT');
  addCol('projects', 'id8r_data',                    'TEXT');
  addCol('projects', 'setup_depth',                  'TEXT');
  addCol('projects', 'entry_point',                  'TEXT');
  addCol('projects', 'story_structure',              'TEXT');
  addCol('projects', 'content_type',                 'TEXT');
  addCol('projects', 'high_concept',                 'TEXT');
  addCol('projects', 'estimated_duration_minutes',   'INTEGER');
  addCol('projects', 'pipr_complete',                'INTEGER NOT NULL DEFAULT 0');
  addCol('projects', 'writr_complete',               'INTEGER NOT NULL DEFAULT 0');
  addCol('projects', 'active_script_id',             'INTEGER');
  addCol('projects', 'source',                       "TEXT NOT NULL DEFAULT 'kre8r'");
  addCol('projects', 'collaborators',                'TEXT');
  addCol('projects', 'show_id',                      'INTEGER');
  addCol('projects', 'episode_number',               'INTEGER');
  addCol('projects', 'shoot_folder',                 'TEXT');
  addCol('projects', 'archive_state',                'TEXT');
  addCol('projects', 'archived_at',                  'DATETIME');
  addCol('projects', 'format',                       "TEXT NOT NULL DEFAULT 'long'");
  addCol('projects', 'high_concept_angles',          'TEXT');
  addCol('projects', 'research_bundle_json',         'TEXT');

  // ── Tables added by migrations (not in base schema.sql) ───────────────────
  exec(`CREATE TABLE IF NOT EXISTS davinci_timelines (
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
  exec('CREATE INDEX IF NOT EXISTS idx_davinci_tl_project ON davinci_timelines(project_id)');

  exec(`CREATE TABLE IF NOT EXISTS clip_distribution (
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
  exec('CREATE INDEX IF NOT EXISTS idx_clip_dist_footage  ON clip_distribution(footage_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_clip_dist_platform ON clip_distribution(platform)');

  exec(`CREATE TABLE IF NOT EXISTS composor_tracks (
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
  exec('CREATE INDEX IF NOT EXISTS idx_composor_project ON composor_tracks(project_id)');

  exec(`CREATE TABLE IF NOT EXISTS selects (
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
  exec('CREATE INDEX IF NOT EXISTS idx_selects_project ON selects(project_id)');

  exec(`CREATE TABLE IF NOT EXISTS writr_scripts (
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
    mode              TEXT    NOT NULL DEFAULT 'full',
    session_id        TEXT,
    iteration_count   INTEGER NOT NULL DEFAULT 0,
    approved          INTEGER NOT NULL DEFAULT 0,
    approved_at       DATETIME,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_writr_scripts_project ON writr_scripts(project_id)');

  exec(`CREATE TABLE IF NOT EXISTS shoot_takes (
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
  exec('CREATE INDEX IF NOT EXISTS idx_shoot_takes_project ON shoot_takes(project_id)');
  exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shoot_takes_beat ON shoot_takes(project_id, beat_index)');

  exec(`CREATE TABLE IF NOT EXISTS kv_store (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS beta_applications (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    channel_url      TEXT    NOT NULL,
    platform         TEXT,
    upload_frequency TEXT,
    why_text         TEXT,
    status           TEXT    NOT NULL DEFAULT 'pending',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_beta_status ON beta_applications(status)');
  exec('CREATE INDEX IF NOT EXISTS idx_beta_created ON beta_applications(created_at)');

  exec(`CREATE TABLE IF NOT EXISTS bug_reports (
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
  exec('CREATE INDEX IF NOT EXISTS idx_bugreports_status   ON bug_reports(status)');
  exec('CREATE INDEX IF NOT EXISTS idx_bugreports_severity ON bug_reports(severity)');
  exec('CREATE INDEX IF NOT EXISTS idx_bugreports_created  ON bug_reports(created_at)');

  exec(`CREATE TABLE IF NOT EXISTS nps_scores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    score      INTEGER NOT NULL,
    comment    TEXT,
    page       TEXT,
    project_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_nps_created ON nps_scores(created_at)');

  exec(`CREATE TABLE IF NOT EXISTS token_usage (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tool           TEXT    NOT NULL,
    session_id     TEXT,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL    NOT NULL DEFAULT 0,
    tenant_slug    TEXT,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_token_tool    ON token_usage(tool)');
  exec('CREATE INDEX IF NOT EXISTS idx_token_session ON token_usage(session_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_token_created ON token_usage(created_at)');
  exec('CREATE INDEX IF NOT EXISTS idx_token_tenant  ON token_usage(tenant_slug)');

  exec(`CREATE TABLE IF NOT EXISTS email_sequences (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT,
    goal_type        TEXT    NOT NULL DEFAULT 'onboard',
    goal_description TEXT,
    audience         TEXT,
    email_count      INTEGER NOT NULL DEFAULT 5,
    timeframe_days   INTEGER NOT NULL DEFAULT 14,
    voice_profile    TEXT,
    chat_history     TEXT    NOT NULL DEFAULT '[]',
    plan             TEXT,
    status           TEXT    NOT NULL DEFAULT 'planning',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec(`CREATE TABLE IF NOT EXISTS sequence_emails (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_id  INTEGER NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    subject      TEXT,
    body         TEXT,
    send_day     INTEGER NOT NULL DEFAULT 0,
    purpose      TEXT,
    revised_at   DATETIME,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_seq_emails_seq  ON sequence_emails(sequence_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_email_seq_created ON email_sequences(created_at)');

  exec(`CREATE TABLE IF NOT EXISTS shows (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT    NOT NULL,
    description             TEXT,
    show_type               TEXT    NOT NULL DEFAULT 'serialized',
    season                  INTEGER NOT NULL DEFAULT 1,
    season_arc              TEXT,
    central_question        TEXT,
    finale_answer           TEXT,
    audience_transformation TEXT,
    target_episodes         INTEGER NOT NULL DEFAULT 12,
    arc_position            TEXT    NOT NULL DEFAULT 'pilot',
    status                  TEXT    NOT NULL DEFAULT 'active',
    creator_id              TEXT    NOT NULL DEFAULT 'primary',
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_shows_creator ON shows(creator_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_shows_status  ON shows(status)');

  exec(`CREATE TABLE IF NOT EXISTS show_episodes (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id                         INTEGER REFERENCES shows(id) ON DELETE CASCADE,
    project_id                      INTEGER REFERENCES projects(id),
    episode_number                  INTEGER,
    season                          INTEGER NOT NULL DEFAULT 1,
    title                           TEXT,
    what_was_established            TEXT,
    seeds_planted                   TEXT,
    arc_advancement                 TEXT,
    character_moments               TEXT,
    central_question_status         TEXT    NOT NULL DEFAULT 'introduced',
    episode_summary                 TEXT,
    what_next_episode_should_address TEXT,
    youtube_url                     TEXT,
    themes                          TEXT,
    audience_signals                TEXT,
    status                          TEXT    NOT NULL DEFAULT 'planned',
    created_at                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_show_eps_show    ON show_episodes(show_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_show_eps_project ON show_episodes(project_id)');

  exec(`CREATE TABLE IF NOT EXISTS show_notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id    INTEGER REFERENCES shows(id),
    type       TEXT,
    message    TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_show_notif_show ON show_notifications(show_id)');

  exec(`CREATE TABLE IF NOT EXISTS content_goals (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    month               TEXT NOT NULL,
    year                INTEGER NOT NULL,
    target_videos       INTEGER DEFAULT 0,
    target_emails       INTEGER DEFAULT 0,
    target_social_posts INTEGER DEFAULT 0,
    target_episodes     INTEGER DEFAULT 0,
    notes               TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(month, year)
  )`);

  exec(`CREATE TABLE IF NOT EXISTS northr_alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL,
    severity     TEXT DEFAULT 'warning',
    title        TEXT,
    message      TEXT,
    action_url   TEXT,
    action_label TEXT,
    read         INTEGER DEFAULT 0,
    dismissed    INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS strategy_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    month         TEXT,
    year          INTEGER,
    report_type   TEXT DEFAULT 'monthly',
    content       TEXT,
    data_snapshot TEXT,
    evaluation    TEXT,
    evaluated_at  DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS session_checkpoints (
    session_id  TEXT    PRIMARY KEY,
    tool        TEXT    NOT NULL,
    data        TEXT    NOT NULL,
    updated_at  INTEGER NOT NULL
  )`);

  exec(`CREATE TABLE IF NOT EXISTS background_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    progress    INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    ok          INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    result      TEXT,
    error       TEXT,
    meta        TEXT,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_bgjobs_type   ON background_jobs(type)');
  exec('CREATE INDEX IF NOT EXISTS idx_bgjobs_status ON background_jobs(status)');

  exec(`CREATE TABLE IF NOT EXISTS writr_room_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL UNIQUE,
    messages    TEXT    NOT NULL DEFAULT '[]',
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_room_sessions_project ON writr_room_sessions(project_id)');

  exec(`CREATE TABLE IF NOT EXISTS viral_clips (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id   INTEGER NOT NULL REFERENCES footage(id) ON DELETE CASCADE,
    project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    rank         INTEGER NOT NULL DEFAULT 1,
    start_time   REAL    NOT NULL,
    end_time     REAL    NOT NULL,
    duration     REAL,
    hook         TEXT,
    caption      TEXT,
    hashtags     TEXT,
    platform_fit TEXT,
    why_it_works TEXT,
    clip_type    TEXT    NOT NULL DEFAULT 'social',
    status       TEXT    NOT NULL DEFAULT 'candidate',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_viral_clips_footage ON viral_clips(footage_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_viral_clips_status  ON viral_clips(status)');

  exec(`CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'owner',
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS tenants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_slug   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT    NOT NULL,
    sync_token    TEXT    NOT NULL UNIQUE,
    data_dir      TEXT,
    plan          TEXT    NOT NULL DEFAULT 'solo',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_sync_at  TEXT
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_tenants_slug  ON tenants(tenant_slug)');
  exec('CREATE INDEX IF NOT EXISTS idx_tenants_token ON tenants(sync_token)');

  exec(`CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
    direction   TEXT    NOT NULL,
    payload_kb  REAL,
    status      TEXT    NOT NULL DEFAULT 'ok',
    error       TEXT,
    synced_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS express_sessions (
    sid        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON express_sessions(expires_at)');

  exec(`CREATE TABLE IF NOT EXISTS monthly_revenue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    month       TEXT    NOT NULL,
    platform    TEXT    NOT NULL DEFAULT 'youtube',
    revenue_usd REAL    NOT NULL DEFAULT 0,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(month, platform)
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_monthly_rev_month ON monthly_revenue(month)');

  exec(`CREATE TABLE IF NOT EXISTS platform_connections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    platform         TEXT    NOT NULL UNIQUE,
    access_token     TEXT    NOT NULL,
    refresh_token    TEXT,
    token_expires_at INTEGER,
    account_id       TEXT,
    account_name     TEXT,
    extra_data       TEXT,
    connected_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  exec(`CREATE TABLE IF NOT EXISTS postor_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER,
    platform     TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    video_path   TEXT,
    title        TEXT,
    description  TEXT,
    post_url     TEXT,
    post_id      TEXT,
    scheduled_at DATETIME,
    posted_at    DATETIME,
    error        TEXT,
    metadata     TEXT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_project  ON postor_posts(project_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_platform ON postor_posts(platform)');
  exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_status   ON postor_posts(status)');
  exec('CREATE INDEX IF NOT EXISTS idx_postor_posts_created  ON postor_posts(created_at)');

  exec(`CREATE TABLE IF NOT EXISTS ideas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    concept     TEXT,
    angle       TEXT,
    hook        TEXT,
    notes       TEXT,
    status      TEXT    NOT NULL DEFAULT 'vault',
    brief_data  TEXT,
    project_id  INTEGER REFERENCES projects(id),
    connections TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_ideas_status  ON ideas(status)');
  exec('CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at)');

  // MarkΩr tables
  exec(`CREATE TABLE IF NOT EXISTS watermarks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id       INTEGER,
    video_path       TEXT    NOT NULL,
    watermarked_path TEXT,
    seed             TEXT    NOT NULL,
    watermark_code   TEXT    NOT NULL,
    channel          TEXT    NOT NULL DEFAULT 'original',
    embedded_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_watermarks_footage ON watermarks(footage_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_watermarks_path    ON watermarks(video_path)');

  exec(`CREATE TABLE IF NOT EXISTS video_fingerprints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id   INTEGER,
    video_path   TEXT    NOT NULL,
    frame_index  INTEGER,
    frame_time_s REAL,
    phash        TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_vfp_footage ON video_fingerprints(footage_id)');
  exec('CREATE INDEX IF NOT EXISTS idx_vfp_path    ON video_fingerprints(video_path)');

  exec(`CREATE TABLE IF NOT EXISTS audio_fingerprints (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    footage_id       INTEGER,
    video_path       TEXT    NOT NULL UNIQUE,
    fingerprint_data TEXT    NOT NULL,
    duration_s       REAL,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_afp_footage ON audio_fingerprints(footage_id)');

  exec(`CREATE TABLE IF NOT EXISTS guard_reports (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_url        TEXT,
    submitted_file_path  TEXT,
    submitter_note       TEXT,
    platform             TEXT,
    report_type          TEXT    NOT NULL DEFAULT 'unknown',
    is_likely_legitimate INTEGER NOT NULL DEFAULT 0,
    match_type           TEXT,
    match_confidence     REAL,
    matched_footage_id   INTEGER,
    matched_video_title  TEXT,
    evidence_json        TEXT,
    status               TEXT    NOT NULL DEFAULT 'pending',
    claim_platform       TEXT,
    claim_reference      TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_guard_status  ON guard_reports(status)');
  exec('CREATE INDEX IF NOT EXISTS idx_guard_created ON guard_reports(created_at)');

  // ─── VectΩr — Strategic Briefs ────────────────────────────────────────────
  exec(`CREATE TABLE IF NOT EXISTS strategic_briefs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_context  TEXT,
    conversation_json TEXT,
    brief_json        TEXT NOT NULL,
    locked_at         TEXT NOT NULL DEFAULT (datetime('now')),
    status            TEXT NOT NULL DEFAULT 'active',
    superseded_at     TEXT
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_brief_status ON strategic_briefs(status)');
  exec('CREATE INDEX IF NOT EXISTS idx_brief_locked ON strategic_briefs(locked_at)');

  // ─── AffiliateΩr — Gear Categories ────────────────────────────────────────
  exec(`CREATE TABLE IF NOT EXISTS gear_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_key    TEXT    NOT NULL UNIQUE,
    cat_label  TEXT    NOT NULL,
    cat_emoji  TEXT    NOT NULL DEFAULT '📦',
    color_var  TEXT    NOT NULL DEFAULT '--teal',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  exec('CREATE INDEX IF NOT EXISTS idx_gear_cats_sort ON gear_categories(sort_order)');
}

// persist() removed — better-sqlite3 writes directly to disk on every operation

// ─────────────────────────────────────────────
// LOW-LEVEL HELPERS — better-sqlite3 API
// ─────────────────────────────────────────────

function _activeDb() {
  return tenantContext.getDb() || db;
}

function _run(sql, params = []) {
  const result = _activeDb().prepare(sql).run(params);
  return { lastInsertRowid: result.lastInsertRowid };
}

function _get(sql, params = []) {
  return _activeDb().prepare(sql).get(params) ?? null;
}

function _all(sql, params = []) {
  return _activeDb().prepare(sql).all(params);
}

// ─────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────

function getUserByUsername(username) {
  return _get('SELECT * FROM users WHERE username = ?', [username]);
}

function getUserById(id) {
  return _get('SELECT id, username, role, created_at FROM users WHERE id = ?', [id]);
}

function getAllUsers() {
  return _all('SELECT id, username, role, created_at FROM users ORDER BY id');
}

function getUserCount() {
  return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
}

function createUser(username, passwordHash, role = 'viewer') {
  return _run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, passwordHash, role]);
}

function updateUserPassword(id, passwordHash) {
  _run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

function deleteUser(id) {
  _run('DELETE FROM users WHERE id = ?', [id]);
}

// ─────────────────────────────────────────────
// TENANT HELPERS
// ─────────────────────────────────────────────

function createTenant({ tenant_slug, display_name, sync_token, data_dir = null, plan = 'solo' }) {
  return _run(
    `INSERT INTO tenants (tenant_slug, display_name, sync_token, data_dir, plan) VALUES (?, ?, ?, ?, ?)`,
    [tenant_slug, display_name, sync_token, data_dir, plan]
  );
}

function getTenantBySlug(slug) {
  return _get('SELECT * FROM tenants WHERE tenant_slug = ? AND active = 1', [slug]);
}

function getTenantByToken(token) {
  return _get('SELECT * FROM tenants WHERE sync_token = ? AND active = 1', [token]);
}

function getAllTenants() {
  return _all('SELECT * FROM tenants ORDER BY created_at DESC');
}

function updateTenantLastSync(id) {
  _run('UPDATE tenants SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

function logSync(tenant_id, direction, payload_kb, status = 'ok', error = null) {
  _run(
    `INSERT INTO sync_log (tenant_id, direction, payload_kb, status, error) VALUES (?, ?, ?, ?, ?)`,
    [tenant_id, direction, payload_kb || 0, status, error]
  );
}

// ─────────────────────────────────────────────
// PROJECT HELPERS
// ─────────────────────────────────────────────

function createProject(title, topic, youtubeUrl, youtubeVideoId) {
  const result = _run(
    `INSERT INTO projects (title, topic, youtube_url, youtube_video_id, current_stage) VALUES (?, ?, ?, ?, 'M0.1')`,
    [title || 'Untitled', topic || null, youtubeUrl || null, youtubeVideoId || null]
  );
  const projectId = result.lastInsertRowid;
  _run(`INSERT INTO pipeline_state (project_id, current_stage) VALUES (?, 'M0.1')`, [projectId]);
  return getProject(projectId);
}

/** Import a project record from a sync snapshot.
 *  Preserves the original ID so cross-device references stay consistent.
 *  Caller is responsible for checking the ID doesn't already exist. */
// Overwrite-import: wipe the existing local row and re-insert from snapshot.
// Safe for devices like the teleprompter laptop that don't own any local data —
// the project on disk is just a stale copy from a previous sync.
function replaceProjectFromSnapshot(project) {
  const id = project.id;
  // Remove pipeline_state first (FK child), then projects
  _run(`DELETE FROM pipeline_state WHERE project_id = ?`, [id]);
  _run(`DELETE FROM projects WHERE id = ?`,               [id]);
  // Re-insert via the normal snapshot function
  return createProjectFromSnapshot(project);
}

function createProjectFromSnapshot(project) {
  const knownCols = db.pragma('table_info(projects)').map(r => r.name);

  // Build column/value lists dynamically — only include cols that exist in this schema
  const safe = ['id', 'title', 'topic', 'status', 'current_stage',
                 'youtube_url', 'youtube_video_id', 'created_at', 'published_at',
                 'source', 'setup_depth', 'entry_point', 'story_structure',
                 'content_type', 'high_concept', 'estimated_duration_minutes',
                 'pipr_complete', 'writr_complete', 'active_script_id',
                 'high_concept_angles', 'research_bundle_json',
                 'vision_brief_json', 'director_notes'];

  const cols = safe.filter(c => knownCols.includes(c) && project[c] !== undefined);
  const vals = cols.map(c => project[c]);

  if (cols.length === 0) throw new Error('No valid columns to insert');

  _run(
    `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals
  );

  // Create matching pipeline_state row
  const psId = project.id;
  const existing = _get('SELECT id FROM pipeline_state WHERE project_id = ?', [psId]);
  if (!existing) {
    _run(`INSERT INTO pipeline_state (project_id, current_stage, gate_a_approved, gate_b_approved, gate_c_approved)
          VALUES (?, ?, ?, ?, ?)`,
      [psId,
       project.current_stage || 'M0.1',
       project.gate_a_approved || 0,
       project.gate_b_approved || 0,
       project.gate_c_approved || 0]);
  }
  return getProject(psId);
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

// Native Kre8Ωr projects only — excludes all platform imports (youtube, tiktok, instagram, facebook).
// Use this everywhere EXCEPT MirrΩr which needs the full import history.
function getKre8rProjects() {
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
      AND p.source NOT IN ('youtube_import', 'tiktok_import', 'instagram_import', 'facebook_import')
    ORDER BY p.created_at DESC
  `);
}

function getAllProjectsBySource(source) {
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
    WHERE p.status != 'archived' AND p.source = ?
    ORDER BY p.created_at DESC
  `, [source]);
}

function setProjectSource(projectId, source) {
  _run(`UPDATE projects SET source = ? WHERE id = ?`, [source, projectId]);
}

function updateProjectStage(projectId, stage) {
  _run(`UPDATE projects SET current_stage = ? WHERE id = ?`, [stage, projectId]);
  _run(`UPDATE pipeline_state SET current_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`, [stage, projectId]);
}

function markProjectPublished(projectId, publishedAt) {
  const date = publishedAt || new Date().toISOString();
  _run(`UPDATE projects SET status = 'published', published_at = ? WHERE id = ?`, [date, projectId]);
  _run(`UPDATE pipeline_state SET updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`, [projectId]);
}

/** Mark a project fully complete: status=published, current_stage=COMPLETE, pipeline updated.
 *  This is the definitive "it's done and posted" signal visible to all tools. */
function markProjectComplete(projectId, publishedAt) {
  const date = publishedAt || new Date().toISOString();
  _run(
    `UPDATE projects SET status = 'published', current_stage = 'COMPLETE', published_at = ? WHERE id = ?`,
    [date, projectId]
  );
  _run(
    `UPDATE pipeline_state SET current_stage = 'COMPLETE', updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`,
    [projectId]
  );
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
}

function getCaptions(projectId) {
  return _all(`SELECT * FROM captions WHERE project_id = ? ORDER BY clip_label, platform`, [projectId]);
}

function approveCaption(captionId) {
  _run(`UPDATE captions SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE id = ?`, [captionId]);
}

function approveAllCaptions(projectId) {
  _run(`UPDATE captions SET approved = 1, approved_at = CURRENT_TIMESTAMP WHERE project_id = ?`, [projectId]);
  _run(
    `UPDATE pipeline_state SET gate_b_approved = 1, gate_b_approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ?`,
    [projectId]
  );
  updateProjectStage(projectId, 'M4');
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
        orientation, braw_source_path, is_proxy, subjects)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      record.is_proxy           ? 1 : 0,
      record.subjects           || null
    ]
  );
  return result.lastInsertRowid;
}

function updateFootage(id, fields) {
  const allowed = [
    'shot_type', 'subcategory', 'description', 'quality_flag',
    'organized_path', 'thumbnail_path', 'project_id', 'used_in', 'transcript_path',
    'orientation', 'braw_source_path', 'is_proxy', 'resolution', 'codec',
    'duration', 'file_size', 'creation_timestamp', 'transcript', 'off_script_gold',
    'proxy_path', 'subjects'
  ];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (updates.length === 0) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  const values = updates.map(k => fields[k]);
  _run(`UPDATE footage SET ${setClauses} WHERE id = ?`, [...values, id]);
}

function getFootageById(id) {
  return _get(`SELECT * FROM footage WHERE id = ?`, [id]);
}

// Campaign Builder — clips that landed in [project]/clips/ and haven't been queued yet
function getUnpackagedClips(projectId = null) {
  const params = [];
  let sql = `
    SELECT f.*,
           p.title AS project_title,
           p.folder_path AS project_folder_path
    FROM footage f
    LEFT JOIN projects p ON p.id = f.project_id
    WHERE f.shot_type = 'social-clip'
      AND f.id NOT IN (
        SELECT footage_id FROM postor_queue
        WHERE footage_id IS NOT NULL
      )
  `;
  if (projectId) { sql += ` AND f.project_id = ?`; params.push(projectId); }
  sql += ` ORDER BY f.ingested_at DESC`;
  return _all(sql, params);
}

function updateFootageCaptionPackage(footageId, captionPackageJson) {
  _run(
    `UPDATE footage SET caption_package = ? WHERE id = ?`,
    [JSON.stringify(captionPackageJson), footageId]
  );
}

function getAllFootage({ shot_type, quality_flag, project_id, limit, offset } = {}) {
  let sql = `SELECT * FROM footage WHERE 1=1`;
  const params = [];
  if (shot_type)    { sql += ` AND shot_type = ?`;    params.push(shot_type); }
  if (quality_flag) { sql += ` AND quality_flag = ?`; params.push(quality_flag); }
  if (project_id)   { sql += ` AND project_id = ?`;   params.push(project_id); }
  sql += ` ORDER BY ingested_at DESC`;
  if (limit != null) {
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset || 0);
  }
  return _all(sql, params);
}

function countFootage({ shot_type, quality_flag, project_id } = {}) {
  let sql = `SELECT COUNT(*) AS n FROM footage WHERE 1=1`;
  const params = [];
  if (shot_type)    { sql += ` AND shot_type = ?`;    params.push(shot_type); }
  if (quality_flag) { sql += ` AND quality_flag = ?`; params.push(quality_flag); }
  if (project_id)   { sql += ` AND project_id = ?`;   params.push(project_id); }
  return (_get(sql, params)?.n) || 0;
}

// Deduplicate footage records by original_filename.
// Keeps the record with the most complete data (thumbnail > proxy > project assignment).
// Archives the rest (soft delete — sets quality_flag = 'archived').
// Returns { archived, groups } counts.
function purgeArchivedFootage() {
  const result = _activeDb().prepare('DELETE FROM footage WHERE quality_flag = ?').run('archived');
  return { deleted: result.changes ?? 0 };
}

function dedupeFootage() {
  const groups = _all(`
    SELECT original_filename, COUNT(*) AS cnt
    FROM footage
    WHERE quality_flag != 'archived' AND original_filename IS NOT NULL
    GROUP BY original_filename
    HAVING cnt > 1
  `);

  let archived = 0;

  for (const group of groups) {
    const records = _all(`
      SELECT id,
        (CASE WHEN thumbnail_path IS NOT NULL AND thumbnail_path != '' THEN 3 ELSE 0 END) +
        (CASE WHEN proxy_path IS NOT NULL THEN 2 ELSE 0 END) +
        (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END) AS score
      FROM footage
      WHERE original_filename = ? AND quality_flag != 'archived'
      ORDER BY score DESC, id ASC
    `, [group.original_filename]);

    // Keep the first (best score, lowest id on tie) — archive the rest
    for (let i = 1; i < records.length; i++) {
      _run(`UPDATE footage SET quality_flag = 'archived' WHERE id = ?`, [records[i].id]);
      archived++;
    }
  }

  return { archived, groups: groups.length };
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
  // Normalize to both slash styles so watcher paths (backslash) and scan paths
  // (forward slash or mixed) match the same DB record regardless of how it was inserted.
  const fwd  = filePath.replace(/\\/g, '/');
  const back = filePath.replace(/\//g, '\\');
  return !!_get(
    `SELECT id FROM footage WHERE
       file_path = ? OR proxy_path = ? OR
       file_path = ? OR proxy_path = ? OR
       file_path = ? OR proxy_path = ?`,
    [filePath, filePath, fwd, fwd, back, back]
  );
}

// ─────────────────────────────────────────────
// DUPLICATE FOOTAGE DETECTION (VaultΩr)
// ─────────────────────────────────────────────

/** Find groups of footage with identical original_filename. Returns array of groups. */
function findDuplicateFootage() {
  const dupes = _all(`
    SELECT original_filename, COUNT(*) as count
    FROM footage
    WHERE original_filename IS NOT NULL
      AND (quality_flag IS NULL OR quality_flag != 'archived')
    GROUP BY original_filename
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);
  if (!dupes.length) return [];

  return dupes.map(d => {
    const clips = _all(
      `SELECT id, file_path, original_filename, shot_type, quality_flag,
              description, duration, file_size, thumbnail_path, ingested_at,
              resolution, subjects
       FROM footage
       WHERE original_filename = ?
         AND (quality_flag IS NULL OR quality_flag != 'archived')
       ORDER BY ingested_at ASC`,
      [d.original_filename]
    );
    return { filename: d.original_filename, count: d.count, clips };
  });
}

/** Soft-archive a footage record by setting quality_flag = 'archived'. */
function archiveFootage(id) {
  _run(`UPDATE footage SET quality_flag = 'archived' WHERE id = ?`, [id]);
}

/** Bulk archive multiple footage records. */
function bulkArchiveFootage(ids) {
  if (!ids || !ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  _run(`UPDATE footage SET quality_flag = 'archived' WHERE id IN (${placeholders})`, ids);
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
}

function deleteDistribution(footage_id, platform) {
  _run(`DELETE FROM clip_distribution WHERE footage_id = ? AND platform = ?`, [footage_id, platform]);
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
}

function createDavinciTimeline({ project_id, timeline_name, timeline_index, state, notes }) {
  const result = _run(
    `INSERT INTO davinci_timelines (project_id, timeline_name, timeline_index, state, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [project_id, timeline_name, timeline_index ?? 1, state ?? 'pending', notes ?? null]
  );
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

/**
 * findProjectByShootPath(filePath)
 *
 * Given any file path (e.g. H:\WaterSystem\A001.braw), check whether it lives
 * inside any project's configured shoot_folder. Returns the matching project
 * record or null. Used by VaultΩr intake for auto project-assignment.
 */
function findProjectByShootPath(filePath) {
  if (!filePath) return null;
  const projects = _all(`SELECT id, shoot_folder FROM projects WHERE shoot_folder IS NOT NULL AND shoot_folder != ''`);
  // Normalize separators for comparison
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  for (const p of projects) {
    const folder = p.shoot_folder.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    if (normalizedFile.startsWith(folder + '/') || normalizedFile === folder) {
      return _get('SELECT * FROM projects WHERE id = ?', [p.id]);
    }
  }
  return null;
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
}

function updateCutClipPath(id, clipPath) {
  _run(`UPDATE cuts SET clip_path = ? WHERE id = ?`, [clipPath, id]);
}

function deleteCutsByProject(projectId) {
  // Preserve off_script_gold entries the creator explicitly saved for later
  // (saved_for_later = 1 or approved = 1). Re-runs should not wipe the library.
  _run(
    `DELETE FROM cuts WHERE project_id = ?
     AND NOT (cut_type = 'off_script_gold' AND (saved_for_later = 1 OR approved = 1))`,
    [projectId]
  );
}

function saveOffScriptGoldForLater(cutId) {
  _run(`UPDATE cuts SET saved_for_later = 1 WHERE id = ?`, [cutId]);
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
}

// ─────────────────────────────────────────────
// POST HELPERS (AnalytΩr)
// ─────────────────────────────────────────────

function savePost({ project_id, caption_id, platform, content, media_path, scheduled_at, posted_at, post_id, status, url, angle, thumbnail_url, format, duration_seconds }) {
  const result = _run(
    `INSERT INTO posts (project_id, caption_id, platform, content, media_path, scheduled_at, posted_at, post_id, status, url, angle, thumbnail_url, format, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project_id,
      caption_id       || null,
      platform,
      content          || null,
      media_path       || null,
      scheduled_at     || null,
      posted_at        || null,
      post_id          || null,
      status           || 'posted',
      url              || null,
      angle            || null,
      thumbnail_url    || null,
      format           || null,
      duration_seconds !== undefined ? duration_seconds : null,
    ]
  );
  return result.lastInsertRowid;
}

function getPostsByProject(projectId) {
  return _all(`SELECT * FROM posts WHERE project_id = ? ORDER BY posted_at DESC, created_at DESC`, [projectId]);
}

// Analytics CSV import helpers ─────────────────────────────────────────────────
function getPostByUrl(url) {
  if (!url) return null;
  return _get(`SELECT * FROM posts WHERE url = ? LIMIT 1`, [url]);
}

function getPostByProjectAndPlatform(projectId, platform) {
  return _get(`SELECT * FROM posts WHERE project_id = ? AND platform = ? LIMIT 1`, [projectId, platform]);
}

function getProjectByYouTubeVideoId(videoId) {
  if (!videoId) return null;
  return _get(`SELECT * FROM projects WHERE youtube_video_id = ? LIMIT 1`, [videoId]);
}

// Create a lightweight project record for a CSV-imported video.
// source = 'tiktok_import' | 'instagram_import' | 'facebook_import' | 'youtube_import'
function createImportProject({ title, platform, published_at, url, youtube_video_id }) {
  const source = `${platform}_import`;
  // Truncate title to 200 chars — TikTok captions can be huge
  const safeTitle = (title || `${platform} import`).slice(0, 200).trim() || `${platform} import`;
  const result = _run(
    `INSERT INTO projects (title, status, current_stage, source, published_at, youtube_url, youtube_video_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      safeTitle,
      'published',
      'PUBLISHED',
      source,
      published_at || null,
      platform === 'youtube' ? (url || null) : null,
      youtube_video_id || null,
    ]
  );
  return result.lastInsertRowid;
}

// Create a post record tied to an import project.
function createImportPost({ projectId, platform, content, posted_at, url, format, duration_seconds, platform_post_id }) {
  const result = _run(
    `INSERT INTO posts (project_id, platform, content, posted_at, url, status, format, duration_seconds, post_id)
     VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?)`,
    [
      projectId,
      platform,
      (content || '').slice(0, 2000) || null,
      posted_at  || null,
      url        || null,
      format     || null,
      duration_seconds != null ? duration_seconds : null,
      platform_post_id || null,
    ]
  );
  return result.lastInsertRowid;
}

function updatePost(id, fields) {
  const allowed = ['status', 'posted_at', 'post_id', 'url', 'error_message', 'angle', 'content', 'media_path', 'format', 'duration_seconds'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (updates.length === 0) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  _run(`UPDATE posts SET ${setClauses} WHERE id = ?`, [...updates.map(k => fields[k]), id]);
}

function deletePost(id) {
  _run(`DELETE FROM analytics WHERE post_id = ?`, [id]);
  _run(`DELETE FROM posts WHERE id = ?`, [id]);
}

// AnalΩzr: format classification helpers ─────────────────────────────────────

function updatePostFormat(postId, format, durationSeconds) {
  _run('UPDATE posts SET format = ?, duration_seconds = ? WHERE id = ?', [format, durationSeconds, postId]);
}

// Returns {projectId: {format, duration_seconds}} for all youtube posts — used
// by the graph route to filter/badge nodes without N+1 queries.
function getYouTubeFormats() {
  const rows = _all(`SELECT project_id, format, duration_seconds FROM posts WHERE platform = 'youtube'`);
  const map  = {};
  for (const r of rows) map[r.project_id] = { format: r.format || null, duration_seconds: r.duration_seconds };
  return map;
}

// Count projects imported from YouTube channel bulk import.
function countImportedProjects() {
  return _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'youtube_import'`)?.n || 0;
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
// ANALYTΩR — Global helpers
// ─────────────────────────────────────────────

// Returns TikTok posts with aggregated metrics, excluding #onthisday reposts.
// Used by the TikTok Pattern Analysis feature in MirrΩr.
// ─────────────────────────────────────────────
// META ANALYTICS HELPERS (MirrΩr)
// ─────────────────────────────────────────────

// Returns all published FB/IG postor_posts that have a platform post_id — the
// set we can actually fetch insights for.
function getMetaSyncablePosts() {
  return _all(
    `SELECT * FROM postor_posts
     WHERE platform IN ('facebook', 'facebook_post', 'instagram')
       AND status = 'posted'
       AND post_id IS NOT NULL
     ORDER BY posted_at DESC`
  );
}

// Ensures a row exists in the `posts` analytics table for a given postor_post.
// Mirrors the bridge pattern used by the YouTube publisher.
// Returns the posts.id to use with upsertMetric().
function bridgeMetaPost({ platform, post_id, project_id, posted_at, post_url, description, title }) {
  const existing = _get(
    `SELECT id FROM posts WHERE post_id = ? AND platform = ? LIMIT 1`,
    [post_id, platform]
  );
  if (existing) return existing.id;
  const result = _run(
    `INSERT INTO posts (project_id, platform, post_id, posted_at, url, status, content)
     VALUES (?, ?, ?, ?, ?, 'posted', ?)`,
    [
      project_id   || null,
      platform,
      post_id,
      posted_at    || null,
      post_url     || null,
      (description || title || '').slice(0, 2000) || null,
    ]
  );
  return result.lastInsertRowid;
}

function getTikTokPostsForAnalysis() {
  return _all(
    `SELECT po.id, po.content, po.url, po.posted_at,
       COALESCE(SUM(CASE WHEN a.metric_name='views'         THEN a.metric_value ELSE 0 END), 0) as views,
       COALESCE(SUM(CASE WHEN a.metric_name='likes'         THEN a.metric_value ELSE 0 END), 0) as likes,
       COALESCE(SUM(CASE WHEN a.metric_name='comment_count' THEN a.metric_value ELSE 0 END), 0) as comments,
       COALESCE(SUM(CASE WHEN a.metric_name='shares'        THEN a.metric_value ELSE 0 END), 0) as shares
     FROM posts po
     LEFT JOIN analytics a ON a.post_id = po.id
     WHERE po.platform = 'tiktok'
       AND (po.content IS NULL OR LOWER(po.content) NOT LIKE '%#onthisday%')
     GROUP BY po.id
     HAVING views > 0 OR po.content IS NOT NULL
     ORDER BY views DESC`
  );
}

function getGlobalChannelHealth() {
  // Per-platform stats — keeps YouTube and TikTok numbers separate so they don't
  // corrupt each other (TikTok views are 10-100x YouTube, completely different scale).
  const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook'];

  const byPlatform = {};
  for (const plat of PLATFORMS) {
    const total = _get(
      `SELECT COALESCE(SUM(a.metric_value),0) as n
       FROM analytics a
       JOIN posts po ON po.id = a.post_id
       JOIN projects pr ON pr.id = po.project_id
       WHERE a.metric_name = 'views' AND po.platform = ? AND pr.status != 'archived'`,
      [plat]
    );
    const avg = _get(
      `SELECT COALESCE(AVG(v),0) as n FROM (
         SELECT SUM(a.metric_value) as v
         FROM analytics a
         JOIN posts po ON po.id = a.post_id
         JOIN projects pr ON pr.id = po.project_id
         WHERE a.metric_name = 'views' AND po.platform = ? AND pr.status != 'archived'
         GROUP BY a.project_id
       )`,
      [plat]
    );
    const best = _get(
      `SELECT pr.id, pr.title, po.url, a.metric_value as views
       FROM analytics a
       JOIN posts po ON po.id = a.post_id
       JOIN projects pr ON pr.id = po.project_id
       WHERE a.metric_name = 'views' AND po.platform = ? AND pr.status != 'archived'
       ORDER BY a.metric_value DESC LIMIT 1`,
      [plat]
    );
    const count = _get(
      `SELECT COUNT(DISTINCT pr.id) as n
       FROM projects pr
       JOIN posts po ON po.project_id = pr.id
       WHERE po.platform = ? AND pr.status != 'archived'`,
      [plat]
    );
    byPlatform[plat] = {
      total_views: total?.n || 0,
      avg_views:   Math.round(avg?.n || 0),
      best_video:  best || null,
      count:       count?.n || 0,
    };
  }

  // YouTube-specific: longform avg + format breakdown (unchanged — strategy engine uses these)
  const longformAvg = _get(
    `SELECT COALESCE(AVG(a.metric_value), 0) as n
     FROM analytics a
     JOIN posts po ON po.id = a.post_id
     JOIN projects pr ON pr.id = po.project_id
     WHERE a.metric_name = 'views'
       AND po.platform = 'youtube'
       AND po.format IN ('longform', 'standard')
       AND pr.status != 'archived'`
  );
  const formatCounts = _all(
    `SELECT COALESCE(po.format, 'longform') as fmt, COUNT(DISTINCT po.project_id) as n
     FROM posts po
     JOIN projects pr ON pr.id = po.project_id
     WHERE po.platform = 'youtube' AND pr.status != 'archived'
     GROUP BY COALESCE(po.format, 'longform')`
  );
  const fmtBreakdown = { longform: 0, standard: 0, micro: 0, short: 0, live: 0 };
  for (const row of formatCounts) fmtBreakdown[row.fmt] = row.n;

  // Top topic (YouTube only — same query strategy engine already uses)
  const topAngle = _get(
    `SELECT pr.topic, COUNT(*) as n
     FROM projects pr
     JOIN posts po ON po.project_id = pr.id
     JOIN analytics a ON a.post_id = po.id
     WHERE a.metric_name = 'views' AND a.metric_value > 0
       AND po.platform = 'youtube'
       AND pr.topic IS NOT NULL AND pr.status != 'archived'
     GROUP BY pr.topic ORDER BY SUM(a.metric_value) DESC LIMIT 1`
  );

  // Cross-platform totals (for dashboard headline numbers)
  const totalVideos = _get(`SELECT COUNT(*) as n FROM projects WHERE status != 'archived'`);

  return {
    // Legacy fields — keep for backward compat with strategy engine + existing MirrΩr calls
    total_views:        byPlatform.youtube.total_views,   // YouTube only (was always YouTube)
    avg_views:          byPlatform.youtube.avg_views,
    longform_avg_views: Math.round(longformAvg?.n || 0),
    best_video:         byPlatform.youtube.best_video,
    total_videos:       totalVideos?.n || 0,
    top_topic:          topAngle?.topic || null,
    format_breakdown:   fmtBreakdown,
    // New: per-platform breakdown for MirrΩr multi-platform display
    by_platform:        byPlatform,
  };
}

function getRecentProjectsWithAnalytics(limit = 10) {
  return _all(
    `SELECT
       pr.id, pr.title, pr.topic, pr.youtube_video_id, pr.created_at,
       (SELECT MAX(po.posted_at) FROM posts po WHERE po.project_id = pr.id) as last_posted_at,
       (SELECT po.thumbnail_url FROM posts po WHERE po.project_id = pr.id AND po.platform = 'youtube' AND po.thumbnail_url IS NOT NULL LIMIT 1) as thumbnail_url,
       (SELECT GROUP_CONCAT(DISTINCT po.platform) FROM posts po WHERE po.project_id = pr.id) as platforms,
       (SELECT SUM(a.metric_value) FROM analytics a JOIN posts po ON po.id = a.post_id
        WHERE po.project_id = pr.id AND a.metric_name = 'views') as total_views,
       (SELECT AVG(a.metric_value) FROM analytics a JOIN posts po ON po.id = a.post_id
        WHERE po.project_id = pr.id AND a.metric_name = 'completion_rate') as avg_completion_rate,
       (SELECT SUM(a.metric_value) FROM analytics a JOIN posts po ON po.id = a.post_id
        WHERE po.project_id = pr.id AND a.metric_name = 'comment_count') as total_comments,
       (SELECT SUM(a.metric_value) FROM analytics a JOIN posts po ON po.id = a.post_id
        WHERE po.project_id = pr.id AND a.metric_name = 'likes') as total_likes
     FROM projects pr
     WHERE pr.status != 'archived'
       AND (pr.source IS NULL OR pr.source NOT IN ('youtube_import','tiktok_import','instagram_import','facebook_import'))
     ORDER BY
       (SELECT MAX(po.posted_at) FROM posts po WHERE po.project_id = pr.id) DESC,
       pr.created_at DESC
     LIMIT ?`,
    [limit]
  );
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
  return result.lastInsertRowid;
}

function updateComposorTrack(id, fields) {
  const allowed = ['suno_job_id', 'suno_track_url', 'suno_track_path', 'public_path', 'selected', 'suno_prompt'];
  const sets    = Object.keys(fields).filter(k => allowed.includes(k));
  if (!sets.length) return;
  const sql     = `UPDATE composor_tracks SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
  _run(sql, [...sets.map(k => fields[k]), id]);
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
}

function deleteComposorTracksByProject(projectId) {
  _run(`DELETE FROM composor_tracks WHERE project_id = ?`, [projectId]);
}

function getPendingSunoTracks(projectId) {
  // Tracks that have a prompt written but no audio downloaded yet
  return _all(
    `SELECT * FROM composor_tracks
     WHERE project_id = ? AND suno_prompt IS NOT NULL AND suno_track_path IS NULL
     ORDER BY scene_index ASC, generation_index ASC`,
    [projectId]
  );
}

function truncateLongSunoPrompts() {
  // One-time maintenance: cap all existing suno_prompts to 200 chars
  const tracks = _all(
    `SELECT id, suno_prompt FROM composor_tracks WHERE suno_prompt IS NOT NULL AND length(suno_prompt) > 200`
  );
  tracks.forEach(t => {
    _run(`UPDATE composor_tracks SET suno_prompt = ? WHERE id = ?`, [t.suno_prompt.substring(0, 200), t.id]);
  });
  return tracks.length;
}

function updateProjectComposorState(projectId, state) {
  _run(`UPDATE projects SET composor_state = ? WHERE id = ?`, [state, projectId]);
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
}

/** Update the selected take on a single selects row (used by AssemblΩr review UI). */
function updateSelectTake(selectId, { winner_footage_id, selected_takes }) {
  _run(
    `UPDATE selects SET winner_footage_id = ?, selected_takes = ? WHERE id = ?`,
    [winner_footage_id || null, selected_takes || '[]', selectId]
  );
}

function updateProjectEditorState(projectId, state) {
  _run(`UPDATE projects SET editor_state = ? WHERE id = ?`, [state, projectId]);
}

// ─────────────────────────────────────────────
// PIPΩR — Project config helpers
// ─────────────────────────────────────────────

function updateProjectId8r(projectId, data) {
  _run(`UPDATE projects SET id8r_data = ? WHERE id = ?`, [JSON.stringify(data), projectId]);
}

// ─────────────────────────────────────────────
// SESSION CHECKPOINTS — crash-safe phase state
// ─────────────────────────────────────────────

/** Upsert a checkpoint for any tool session. data must be a plain object. */
function setCheckpoint(sessionId, tool, data) {
  db.prepare(`
    INSERT INTO session_checkpoints (session_id, tool, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      tool       = excluded.tool,
      data       = excluded.data,
      updated_at = excluded.updated_at
  `).run(sessionId, tool, JSON.stringify(data), Date.now());
}

/** Retrieve a checkpoint by session ID. Returns parsed data or null. */
function getCheckpoint(sessionId) {
  const row = db.prepare(`SELECT * FROM session_checkpoints WHERE session_id = ?`).get(sessionId);
  if (!row) return null;
  try { row.data = JSON.parse(row.data); } catch (_) {}
  return row;
}

/** Delete a checkpoint once the session completes successfully. */
function deleteCheckpoint(sessionId) {
  db.prepare(`DELETE FROM session_checkpoints WHERE session_id = ?`).run(sessionId);
}

// ─────────────────────────────────────────────
// BACKGROUND JOBS
// ─────────────────────────────────────────────

function createJob(type, meta = {}) {
  const result = db.prepare(
    `INSERT INTO background_jobs (type, status, meta) VALUES (?, 'pending', ?)`
  ).run(type, JSON.stringify(meta));
  return getJob(result.lastInsertRowid);
}

function getJob(id) {
  const row = db.prepare(`SELECT * FROM background_jobs WHERE id = ?`).get(id);
  if (!row) return null;
  try { if (row.meta) row.meta = JSON.parse(row.meta); } catch (_) {}
  try { if (row.result) row.result = JSON.parse(row.result); } catch (_) {}
  return row;
}

function getActiveJobByType(type) {
  const row = db.prepare(
    `SELECT * FROM background_jobs WHERE type = ? AND status IN ('pending','running') ORDER BY id DESC LIMIT 1`
  ).get(type);
  if (!row) return null;
  try { if (row.meta) row.meta = JSON.parse(row.meta); } catch (_) {}
  return row;
}

function updateJobProgress(id, { progress, total, ok, errors }) {
  db.prepare(`
    UPDATE background_jobs
    SET status = 'running', progress = ?, total = ?, ok = ?, errors = ?
    WHERE id = ?
  `).run(progress ?? 0, total ?? 0, ok ?? 0, errors ?? 0, id);
}

function finishJob(id, { ok, errors, total, result } = {}) {
  db.prepare(`
    UPDATE background_jobs
    SET status = 'done', ok = ?, errors = ?, total = ?,
        result = ?, finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(ok ?? 0, errors ?? 0, total ?? 0, result ? JSON.stringify(result) : null, id);
}

function failJob(id, errorMsg) {
  db.prepare(`
    UPDATE background_jobs
    SET status = 'error', error = ?, finished_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(errorMsg, id);
}

function updateProjectPipr(projectId, fields) {
  const allowed = [
    'setup_depth', 'entry_point', 'story_structure', 'content_type',
    'high_concept', 'estimated_duration_minutes', 'pipr_complete',
    'shoot_folder', 'folder_path', 'archive_state', 'archived_at', 'format'
  ];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  _run(`UPDATE projects SET ${setClauses} WHERE id = ?`, [...updates.map(k => fields[k]), projectId]);
}

function updateProjectWritr(projectId, fields) {
  const allowed = ['writr_complete', 'active_script_id'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const setClauses = updates.map(k => `${k} = ?`).join(', ');
  _run(`UPDATE projects SET ${setClauses} WHERE id = ?`, [...updates.map(k => fields[k]), projectId]);
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
}

function approveWritrScript(projectId, scriptId) {
  // Un-approve any previously approved script for this project first
  _run(
    `UPDATE writr_scripts SET approved = 0, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ? AND approved = 1 AND id != ?`,
    [projectId, scriptId]
  );
  // Mark the new script approved
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
}

// ─────────────────────────────────────────────
// ARCHIVE / DELETE
// ─────────────────────────────────────────────

function archiveProject(id) {
  _run(`UPDATE projects SET status = 'archived' WHERE id = ?`, [id]);
}

function bulkArchiveProjects(ids) {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  _run(`UPDATE projects SET status = 'archived' WHERE id IN (${placeholders})`, ids);
}

function bulkDeleteProjects(ids) {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  _run(`DELETE FROM projects WHERE id IN (${placeholders})`, ids);
}

function unarchiveProject(id) {
  _run(`UPDATE projects SET status = 'active' WHERE id = ?`, [id]);
}

function deleteProject(id) {
  // ON DELETE CASCADE in schema handles all child table cleanup automatically
  _run(`DELETE FROM projects WHERE id = ?`, [id]);
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

function getPipelineSummary(source) {
  // Single source of truth: always use getKre8rProjects() (blacklist approach) for native
  // projects. Only use getAllProjectsBySource() when explicitly requesting import sets
  // (e.g. source='youtube_import' for MirrΩr).
  const isImportSource = source && source.endsWith('_import');
  const projects = isImportSource ? getAllProjectsBySource(source) : getKre8rProjects();
  return projects.map(p => ({
    ...p,
    needs_attention: !p.gate_a_approved || !p.gate_b_approved || !p.gate_c_approved
  }));
}

// ─────────────────────────────────────────────
// KV STORE — generic key/value cache
// ─────────────────────────────────────────────

function getKv(key) {
  const row = _get('SELECT value FROM kv_store WHERE key = ?', [key]);
  return row ? JSON.parse(row.value) : null;
}

function setKv(key, value) {
  _run(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, JSON.stringify(value)]
  );
}

// ─────────────────────────────────────────────
// TOKEN USAGE — helpers
// ─────────────────────────────────────────────

function logTokenUsage({ tool, session_id, input_tokens, output_tokens, estimated_cost, tenant_slug }) {
  // ALWAYS write to the singleton main DB — never to a tenant DB.
  // This lets Jason see all API costs centrally regardless of which tenant made the call.
  const slug = tenant_slug !== undefined ? tenant_slug : (tenantContext.getSlug() || null);
  db.prepare(
    `INSERT INTO token_usage (tool, session_id, input_tokens, output_tokens, estimated_cost, tenant_slug)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run([tool, session_id || null, input_tokens || 0, output_tokens || 0, estimated_cost || 0, slug]);
}

function getTokenStats() {
  const today = new Date().toISOString().split('T')[0];

  const todayTotals = db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0)   AS input_tokens,
       COALESCE(SUM(output_tokens), 0)  AS output_tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimated_cost
     FROM token_usage
     WHERE DATE(created_at) = ?`
  ).get([today]);

  const allTime = db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0)   AS input_tokens,
       COALESCE(SUM(output_tokens), 0)  AS output_tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimated_cost
     FROM token_usage`
  ).get([]);

  const byTool = db.prepare(
    `SELECT tool,
       SUM(input_tokens)   AS input_tokens,
       SUM(output_tokens)  AS output_tokens,
       SUM(estimated_cost) AS estimated_cost,
       COUNT(*)            AS call_count
     FROM token_usage
     GROUP BY tool
     ORDER BY SUM(estimated_cost) DESC`
  ).all([]);

  const byTenant = db.prepare(
    `SELECT
       COALESCE(tenant_slug, 'jason') AS tenant,
       COALESCE(SUM(input_tokens), 0)   AS input_tokens,
       COALESCE(SUM(output_tokens), 0)  AS output_tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimated_cost,
       COUNT(*) AS call_count
     FROM token_usage
     GROUP BY tenant_slug
     ORDER BY SUM(estimated_cost) DESC`
  ).all([]);

  const id8rAvg = db.prepare(
    `SELECT
       COALESCE(AVG(session_cost), 0) AS avg_cost,
       COUNT(*)                       AS session_count
     FROM (
       SELECT session_id, SUM(estimated_cost) AS session_cost
       FROM token_usage
       WHERE tool = 'id8r' AND session_id IS NOT NULL
       GROUP BY session_id
     )`
  ).get([]);

  return {
    today: {
      input_tokens:   todayTotals?.input_tokens   || 0,
      output_tokens:  todayTotals?.output_tokens  || 0,
      estimated_cost: Math.round((todayTotals?.estimated_cost || 0) * 10000) / 10000
    },
    all_time: {
      input_tokens:   allTime?.input_tokens   || 0,
      output_tokens:  allTime?.output_tokens  || 0,
      estimated_cost: Math.round((allTime?.estimated_cost || 0) * 10000) / 10000
    },
    by_tool:   byTool,
    by_tenant: byTenant,
    id8r_avg_cost:      Math.round((id8rAvg?.avg_cost || 0) * 10000) / 10000,
    id8r_session_count: id8rAvg?.session_count || 0
  };
}

function getTokenUsageByTenant(slug) {
  return db.prepare(
    `SELECT
       COALESCE(SUM(input_tokens), 0)   AS input_tokens,
       COALESCE(SUM(output_tokens), 0)  AS output_tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimated_cost,
       COUNT(*)                          AS call_count
     FROM token_usage
     WHERE tenant_slug = ?`
  ).get([slug]) || { input_tokens: 0, output_tokens: 0, estimated_cost: 0, call_count: 0 };
}

// ─────────────────────────────────────────────
// BUG REPORTS — helpers
// ─────────────────────────────────────────────

function insertBugReport({ what_tried, what_happened, severity, page, project_id, browser, console_errors, timestamp, reporter_name }) {
  const result = _run(
    `INSERT INTO bug_reports
       (what_tried, what_happened, severity, page, project_id, browser, console_errors, timestamp, reporter_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      what_tried       || null,
      what_happened    || null,
      severity         || 'minor',
      page             || null,
      project_id       || null,
      browser          || null,
      console_errors   || null,
      timestamp        || new Date().toISOString(),
      reporter_name    || null
    ]
  );
  return result.lastInsertRowid;
}

function getBugReports() {
  return _all(`SELECT * FROM bug_reports ORDER BY created_at DESC`);
}

function updateBugReportStatus(id, status) {
  _run(`UPDATE bug_reports SET status = ? WHERE id = ?`, [status, id]);
}

function getBugReportStats() {
  const open     = _get(`SELECT COUNT(*) as n FROM bug_reports WHERE status = 'open'`);
  const resolved = _get(`SELECT COUNT(*) as n FROM bug_reports WHERE status = 'resolved'`);
  const inProg   = _get(`SELECT COUNT(*) as n FROM bug_reports WHERE status = 'in-progress'`);
  return {
    open:        open?.n     || 0,
    resolved:    resolved?.n || 0,
    in_progress: inProg?.n   || 0
  };
}

// ─────────────────────────────────────────────
// NPS SCORES — helpers
// ─────────────────────────────────────────────

function insertNpsScore({ score, comment, page, project_id }) {
  const result = _run(
    `INSERT INTO nps_scores (score, comment, page, project_id) VALUES (?, ?, ?, ?)`,
    [score, comment || null, page || null, project_id || null]
  );
  return result.lastInsertRowid;
}

function getNpsScores() {
  return _all(`SELECT * FROM nps_scores ORDER BY created_at DESC`);
}

function getNpsAverage() {
  const row = _get(`SELECT AVG(score) as avg, COUNT(*) as n FROM nps_scores`);
  return { avg: row?.avg ? Math.round(row.avg * 10) / 10 : null, count: row?.n || 0 };
}

// ─────────────────────────────────────────────
// BETA FUNNEL — pipeline completion at each stage
// ─────────────────────────────────────────────

function getBetaFunnel() {
  const total = _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'kre8r'`);
  const base  = total?.n || 0;

  const pipr  = _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'kre8r' AND pipr_complete = 1`);
  const writr = _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'kre8r' AND writr_complete = 1`);
  const vault = _get(`SELECT COUNT(*) as n FROM projects p WHERE p.source = 'kre8r'
    AND EXISTS (SELECT 1 FROM footage f WHERE f.project_id = p.id)`);
  const mirrr = _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'kre8r'
    AND youtube_video_id IS NOT NULL AND youtube_video_id != ''`);

  // id8r: projects that have id8r_data set
  const id8r  = _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'kre8r'
    AND id8r_data IS NOT NULL AND id8r_data != ''`);

  // director: projects with at least one shoot_take record
  const director = _get(`SELECT COUNT(*) as n FROM projects p WHERE p.source = 'kre8r'
    AND EXISTS (SELECT 1 FROM shoot_takes st WHERE st.project_id = p.id)`);

  const stages = [
    { stage: 'soul',     label: 'Soul BuildΩr', count: base },
    { stage: 'id8r',     label: 'Id8Ωr',         count: id8r?.n    || 0 },
    { stage: 'pipr',     label: 'PipΩr',          count: pipr?.n    || 0 },
    { stage: 'writr',    label: 'WritΩr',          count: writr?.n   || 0 },
    { stage: 'director', label: 'DirectΩr',        count: director?.n || 0 },
    { stage: 'vault',    label: 'VaultΩr',         count: vault?.n   || 0 },
    { stage: 'mirrr',    label: 'MirrΩr',          count: mirrr?.n   || 0 }
  ];

  return stages.map((s, i) => ({
    ...s,
    percentage: base > 0 ? Math.round((s.count / base) * 100) : 0,
    dropoff:    i > 0 ? stages[i - 1].count - s.count : 0,
    dropoff_pct: i > 0 && stages[i - 1].count > 0
      ? Math.round(((stages[i - 1].count - s.count) / stages[i - 1].count) * 100)
      : 0
  }));
}

// ─────────────────────────────────────────────
// BETA STATS — overview numbers for admin dashboard
// ─────────────────────────────────────────────

function getBetaStats() {
  const bugs       = getBugReportStats();
  const nps        = getNpsAverage();
  const pipelines  = _get(`SELECT COUNT(*) as n FROM projects WHERE source = 'kre8r'`);
  // soul_count: always 1 primary + any collaborator files (counted separately via file listing)
  return {
    soul_count:    1,
    pipeline_runs: pipelines?.n || 0,
    open_bugs:     bugs.open,
    resolved_bugs: bugs.resolved,
    in_progress_bugs: bugs.in_progress,
    avg_nps:       nps.avg,
    nps_count:     nps.count
  };
}

// ─────────────────────────────────────────────
// BETA APPLICATIONS — helpers
// ─────────────────────────────────────────────

function insertBetaApplication({ name, channel_url, platform, upload_frequency, why_text }) {
  const result = _run(
    `INSERT INTO beta_applications (name, channel_url, platform, upload_frequency, why_text)
     VALUES (?, ?, ?, ?, ?)`,
    [name, channel_url, platform || null, upload_frequency || null, why_text || null]
  );
  return result.lastInsertRowid;
}

function getAllBetaApplications() {
  return _all(`SELECT * FROM beta_applications ORDER BY created_at DESC`);
}

function updateBetaApplicationStatus(id, status) {
  _run(`UPDATE beta_applications SET status = ? WHERE id = ?`, [status, id]);
}

// ─────────────────────────────────────────────
// COLLABORATOR SOUL — helpers
// ─────────────────────────────────────────────

function getProjectCollaborators(projectId) {
  const p = _get(`SELECT collaborators FROM projects WHERE id = ?`, [projectId]);
  if (!p?.collaborators) return [];
  try { return JSON.parse(p.collaborators); } catch (_) { return []; }
}

function updateProjectCollaborators(projectId, collaborators) {
  _run(`UPDATE projects SET collaborators = ? WHERE id = ?`,
       [JSON.stringify(collaborators), projectId]);
}

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
  return _get(
    `SELECT * FROM shoot_takes WHERE project_id = ? AND beat_index = ?`,
    [projectId, beatIndex]
  );
}

function resetShootTakes(projectId) {
  _run(`DELETE FROM shoot_takes WHERE project_id = ?`, [projectId]);
}

// ─────────────────────────────────────────────
// SHOW HELPERS
// ─────────────────────────────────────────────

function createShow(data) {
  const result = _run(
    `INSERT INTO shows
       (name, description, show_type, season, season_arc, central_question,
        finale_answer, audience_transformation, target_episodes, arc_position, creator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name || 'Untitled Show',
      data.description || null,
      data.show_type || 'serialized',
      data.season || 1,
      data.season_arc || null,
      data.central_question || null,
      data.finale_answer || null,
      data.audience_transformation || null,
      data.target_episodes || 12,
      data.arc_position || 'pilot',
      data.creator_id || 'primary',
    ]
  );
  return getShow(result.lastInsertRowid);
}

function getShow(id) {
  return _get(`SELECT * FROM shows WHERE id = ?`, [id]);
}

function getAllShows() {
  return _all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM show_episodes WHERE show_id = s.id) AS total_episodes,
      (SELECT COUNT(*) FROM show_episodes WHERE show_id = s.id AND status = 'complete') AS completed_episodes
    FROM shows s
    WHERE s.status != 'archived'
    ORDER BY s.created_at DESC
  `);
}

function updateShow(id, data) {
  const allowed = [
    'name', 'description', 'show_type', 'season', 'season_arc',
    'central_question', 'finale_answer', 'audience_transformation',
    'target_episodes', 'arc_position', 'status',
  ];
  const fields = Object.keys(data).filter(k => allowed.includes(k));
  if (!fields.length) return;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => data[f]);
  _run(`UPDATE shows SET ${sets} WHERE id = ?`, [...vals, id]);
}

function createShowEpisode(data) {
  const episodeNumber = data.episode_number || getNextEpisodeNumber(data.show_id);
  const result = _run(
    `INSERT INTO show_episodes
       (show_id, project_id, episode_number, season, title, what_was_established,
        seeds_planted, arc_advancement, character_moments, central_question_status,
        episode_summary, what_next_episode_should_address, youtube_url, themes, audience_signals, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.show_id,
      data.project_id || null,
      episodeNumber,
      data.season || 1,
      data.title || null,
      data.what_was_established || null,
      Array.isArray(data.seeds_planted) ? JSON.stringify(data.seeds_planted) : (data.seeds_planted || null),
      data.arc_advancement || null,
      Array.isArray(data.character_moments) ? JSON.stringify(data.character_moments) : (data.character_moments || null),
      data.central_question_status || 'introduced',
      data.episode_summary || null,
      data.what_next_episode_should_address || null,
      data.youtube_url || null,
      Array.isArray(data.themes) ? JSON.stringify(data.themes) : (data.themes || null),
      data.audience_signals ? JSON.stringify(data.audience_signals) : null,
      data.status || 'planned',
    ]
  );
  // Link project back to show if project_id provided
  if (data.project_id) {
    try {
      _run(`UPDATE projects SET show_id = ?, episode_number = ? WHERE id = ?`,
        [data.show_id, episodeNumber, data.project_id]);
    } catch (_) {}
  }
  return getShowEpisode(result.lastInsertRowid);
}

function getShowEpisodes(showId) {
  return _all(`
    SELECT se.*, p.title AS project_title, p.status AS project_status
    FROM show_episodes se
    LEFT JOIN projects p ON p.id = se.project_id
    WHERE se.show_id = ?
    ORDER BY se.season ASC, se.episode_number ASC
  `, [showId]);
}

function getShowEpisode(id) {
  return _get(`SELECT * FROM show_episodes WHERE id = ?`, [id]);
}

function updateShowEpisode(id, data) {
  const allowed = [
    'title', 'what_was_established', 'seeds_planted', 'arc_advancement',
    'character_moments', 'central_question_status', 'episode_summary', 'status',
    'project_id', 'episode_number', 'what_next_episode_should_address',
    'youtube_url', 'themes', 'audience_signals',
  ];
  const fields = Object.keys(data).filter(k => allowed.includes(k));
  if (!fields.length) return;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => data[f]);
  _run(`UPDATE show_episodes SET ${sets} WHERE id = ?`, [...vals, id]);
}

function getNextEpisodeNumber(showId) {
  const row = _get(
    `SELECT COALESCE(MAX(episode_number), 0) + 1 AS next FROM show_episodes WHERE show_id = ?`,
    [showId]
  );
  return row ? row.next : 1;
}

function buildSeasonContext(showId) {
  const show = getShow(showId);
  if (!show) return null;

  const episodes = getShowEpisodes(showId);
  const completed = episodes.filter(e => e.status === 'complete');

  // Gather all seeds_planted from non-archived episodes as an array
  const seeds_unresolved = [];
  episodes.forEach(e => {
    if (!e.seeds_planted) return;
    let parsed;
    try { parsed = JSON.parse(e.seeds_planted); } catch (_) { parsed = null; }
    if (Array.isArray(parsed)) {
      parsed.forEach(s => seeds_unresolved.push(s));
    } else if (typeof e.seeds_planted === 'string' && e.seeds_planted.trim()) {
      seeds_unresolved.push(e.seeds_planted.trim());
    }
  });

  // Build narrative threads from established facts
  const threads = completed
    .filter(e => e.what_was_established)
    .map(e => ({ episode: e.episode_number, established: e.what_was_established }));

  const next_episode_number = getNextEpisodeNumber(showId);

  // Determine arc position based on progress
  const completedCount = completed.length;
  const totalTarget = show.target_episodes || 12;
  let arc_position = show.arc_position || 'pilot';
  if (completedCount === 0) arc_position = 'pilot';
  else if (completedCount < Math.floor(totalTarget * 0.25)) arc_position = 'escalation';
  else if (completedCount < Math.floor(totalTarget * 0.55)) arc_position = 'midpoint';
  else if (completedCount < Math.floor(totalTarget * 0.85)) arc_position = 'endgame';
  else arc_position = 'finale';

  // Pull what_next_episode_should_address from the most recent completed episode
  const mostRecentCompleted = completed.length
    ? completed[completed.length - 1]
    : null;
  const what_next_should_address = mostRecentCompleted?.what_next_episode_should_address || null;

  return {
    show,
    episodes: completed,
    seeds_unresolved,
    threads,
    arc_position,
    next_episode_number,
    current_episode: episodes.find(e => e.status === 'in_progress') || null,
    what_next_should_address,
  };
}

// ─────────────────────────────────────────────
// NORTHΩR HELPERS
// ─────────────────────────────────────────────

function createGoal(data) {
  const { month, year, target_videos = 0, target_emails = 0, target_social_posts = 0, target_episodes = 0, notes = null } = data;
  try {
    const result = _run(
      `INSERT INTO content_goals (month, year, target_videos, target_emails, target_social_posts, target_episodes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(month, year) DO UPDATE SET
         target_videos = excluded.target_videos,
         target_emails = excluded.target_emails,
         target_social_posts = excluded.target_social_posts,
         target_episodes = excluded.target_episodes,
         notes = excluded.notes`,
      [month, year, target_videos, target_emails, target_social_posts, target_episodes, notes]
    );
    return getGoal(month, year);
  } catch (e) {
    // Fallback for SQLite versions without ON CONFLICT DO UPDATE
    const existing = getGoal(month, year);
    if (existing) {
      updateGoal(existing.id, data);
      return getGoal(month, year);
    }
    _run(
      `INSERT INTO content_goals (month, year, target_videos, target_emails, target_social_posts, target_episodes, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [month, year, target_videos, target_emails, target_social_posts, target_episodes, notes]
    );
    return getGoal(month, year);
  }
}

function getGoal(month, year) {
  return _get(`SELECT * FROM content_goals WHERE month = ? AND year = ?`, [month, year]);
}

function updateGoal(id, data) {
  const allowed = ['target_videos', 'target_emails', 'target_social_posts', 'target_episodes', 'notes'];
  const fields = Object.keys(data).filter(k => allowed.includes(k));
  if (!fields.length) return;
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => data[f]);
  _run(`UPDATE content_goals SET ${sets} WHERE id = ?`, [...vals, id]);
}

function createAlert(data) {
  const { type, severity = 'warning', title, message, action_url, action_label } = data;
  const result = _run(
    `INSERT INTO northr_alerts (type, severity, title, message, action_url, action_label) VALUES (?, ?, ?, ?, ?, ?)`,
    [type, severity, title || null, message || null, action_url || null, action_label || null]
  );
  return _get(`SELECT * FROM northr_alerts WHERE id = ?`, [result.lastInsertRowid]);
}

function getUnreadAlerts() {
  return _all(`SELECT * FROM northr_alerts WHERE read = 0 AND dismissed = 0 ORDER BY created_at DESC`);
}

function getAllAlerts() {
  return _all(`SELECT * FROM northr_alerts WHERE dismissed = 0 ORDER BY created_at DESC LIMIT 50`);
}

function getAlertByType(type) {
  return _get(`SELECT * FROM northr_alerts WHERE type = ? AND dismissed = 0 ORDER BY created_at DESC`, [type]);
}

function markAlertRead(id) {
  _run(`UPDATE northr_alerts SET read = 1 WHERE id = ?`, [id]);
}

function dismissAlert(id) {
  _run(`UPDATE northr_alerts SET dismissed = 1, read = 1 WHERE id = ?`, [id]);
}

function createStrategyReport(data) {
  const { month, year, report_type = 'monthly', content, data_snapshot } = data;
  const result = _run(
    `INSERT INTO strategy_reports (month, year, report_type, content, data_snapshot) VALUES (?, ?, ?, ?, ?)`,
    [month, year, report_type, content || null, data_snapshot || null]
  );
  return _get(`SELECT * FROM strategy_reports WHERE id = ?`, [result.lastInsertRowid]);
}

function getLatestReport(month, year) {
  if (month && year) {
    return _get(`SELECT * FROM strategy_reports WHERE month = ? AND year = ? ORDER BY created_at DESC`, [month, year]);
  }
  return _get(`SELECT * FROM strategy_reports ORDER BY created_at DESC`);
}

// Returns avg/max/count views broken down by story_structure for all kre8r projects
// with real YouTube performance data. PipΩr shows this as live performance badges.
function getStructurePerformance() {
  return _all(
    `SELECT
       pr.story_structure,
       COUNT(DISTINCT pr.id)                      AS video_count,
       ROUND(AVG(COALESCE(v.views, 0)))           AS avg_views,
       MAX(COALESCE(v.views, 0))                  AS max_views,
       SUM(COALESCE(v.views, 0))                  AS total_views
     FROM projects pr
     JOIN (
       SELECT po.project_id, SUM(a.metric_value) AS views
       FROM posts po
       JOIN analytics a ON a.post_id = po.id
       WHERE po.platform = 'youtube'
         AND a.metric_name = 'views'
       GROUP BY po.project_id
     ) v ON v.project_id = pr.id
     WHERE pr.story_structure IS NOT NULL
       AND pr.source = 'kre8r'
       AND pr.status != 'archived'
     GROUP BY pr.story_structure
     ORDER BY avg_views DESC`
  );
}

function saveStrategyEvaluation(id, evaluationJson) {
  _run(
    `UPDATE strategy_reports SET evaluation = ?, evaluated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(evaluationJson), id]
  );
}

// Returns the N most recent strategy reports that have been evaluated (have evaluation column set)
function getRecentEvaluations(limit = 3) {
  return _all(
    `SELECT id, month, year, content, evaluation, evaluated_at
     FROM strategy_reports
     WHERE evaluation IS NOT NULL
     ORDER BY evaluated_at DESC
     LIMIT ?`,
    [limit]
  );
}

// Returns videos published in a given month+year window with their view counts
function getVideosByMonth(month, year) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // End of that month: use start of next month
  const nextMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const nextYear  = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
  const endDate   = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return _all(
    `SELECT pr.id, pr.title, pr.topic, po.angle,
            po.posted_at, po.url, po.format,
            COALESCE((
              SELECT SUM(a.metric_value) FROM analytics a
              WHERE a.post_id = po.id AND a.metric_name = 'views'
            ), 0) as views,
            COALESCE((
              SELECT SUM(a.metric_value) FROM analytics a
              WHERE a.post_id = po.id AND a.metric_name = 'likes'
            ), 0) as likes,
            COALESCE((
              SELECT SUM(a.metric_value) FROM analytics a
              WHERE a.post_id = po.id AND a.metric_name = 'comment_count'
            ), 0) as comments
     FROM projects pr
     JOIN posts po ON po.project_id = pr.id AND po.platform = 'youtube'
     WHERE po.posted_at >= ? AND po.posted_at < ?
       AND pr.source != 'youtube_import'
     ORDER BY po.posted_at ASC`,
    [startDate, endDate]
  );
}

function getPublishingStats(days = 30) {
  // ── Read from posts table — the single source of truth for published content ──
  // Excludes youtube_import archive (historical bulk import — not current cadence).
  // Uses posted_at which is set at actual publish time by the sync and post routes.
  const lastPost = _get(`
    SELECT
      MAX(po.posted_at) AS last_publish,
      COUNT(*)          AS total_posts,
      COUNT(CASE WHEN po.posted_at > datetime('now', '-30 days') THEN 1 END) AS posts_this_month,
      COUNT(CASE WHEN po.posted_at > datetime('now', '-60 days')
        AND po.posted_at <= datetime('now', '-30 days') THEN 1 END) AS posts_last_month
    FROM posts po
    JOIN projects pr ON pr.id = po.project_id
    WHERE po.status = 'posted'
      AND po.posted_at IS NOT NULL
      AND (pr.source IS NULL OR pr.source NOT IN ('youtube_import','tiktok_import','instagram_import','facebook_import'))
  `);

  const daysSinceLastPublish = lastPost?.last_publish
    ? Math.floor((Date.now() - new Date(lastPost.last_publish).getTime()) / 86400000)
    : 999;

  // Last email sent — approved email in project pipeline OR standalone MailerLite send
  const lastEmail = _get(
    `SELECT created_at FROM emails WHERE approved = 1 ORDER BY created_at DESC`
  );
  const lastMlSend = _get(
    `SELECT value FROM kv_store WHERE key = 'last_mailerlite_send'`
  );
  const lastMlSendDate = lastMlSend?.value ? new Date(JSON.parse(lastMlSend.value)) : null;
  const lastEmailDate  = lastEmail?.created_at ? new Date(lastEmail.created_at) : null;
  const mostRecentEmail = lastMlSendDate && lastEmailDate
    ? (lastMlSendDate > lastEmailDate ? lastMlSendDate : lastEmailDate)
    : (lastMlSendDate || lastEmailDate);
  const daysSinceLastEmail = mostRecentEmail
    ? Math.floor((Date.now() - mostRecentEmail.getTime()) / 86400000)
    : 999;

  // Last MirrΩr sync timestamp (written by analytr sync route)
  const lastSync = _get(`SELECT value, updated_at FROM kv_store WHERE key = 'mirrr_last_sync'`);

  return {
    last_publish_date:       lastPost?.last_publish || null,
    days_since_last_publish: daysSinceLastPublish,
    videos_this_month:       lastPost?.posts_this_month || 0,
    videos_last_month:       lastPost?.posts_last_month || 0,
    total_posts:             lastPost?.total_posts || 0,
    days_since_last_email:   daysSinceLastEmail,
    mirrr_last_sync:         lastSync?.updated_at || null,
  };
}

function getPipelineHealth() {
  const allActive = _all(
    `SELECT p.id, p.title, p.current_stage, p.created_at, p.status, ps.updated_at, ps.stage_status
     FROM projects p
     LEFT JOIN pipeline_state ps ON ps.project_id = p.id
     WHERE p.status NOT IN ('published', 'archived')
       AND (p.source IS NULL OR p.source NOT IN ('youtube_import','tiktok_import','instagram_import','facebook_import'))
     ORDER BY p.created_at DESC`
  );

  // Stage categorization
  const STAGE_MAP = {
    pre:  s => s && (s.startsWith('M0') || s === 'idea' || s === 'pending'),
    prod: s => s && s.startsWith('M1'),
    post: s => s && (s === 'M2' || s.startsWith('M2.')),
    dist: s => s && (s.startsWith('M3') || s.startsWith('M4') || s === 'M5'),
  };

  const STAGE_LABELS = {
    pre:  { name: 'Pre-production', url: 'id8r.html' },
    prod: { name: 'Production',     url: 'shootday.html' },
    post: { name: 'Post',           url: 'editor.html' },
    dist: { name: 'Distribution',   url: 'm1-approval-dashboard.html' },
  };

  const now = Date.now();
  const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  let in_pre_production = 0;
  let in_production = 0;
  let in_post = 0;
  let in_distribution = 0;
  const stalled = [];

  for (const p of allActive) {
    const stage = p.current_stage || 'M0.1';
    if (STAGE_MAP.pre(stage))  in_pre_production++;
    else if (STAGE_MAP.prod(stage)) in_production++;
    else if (STAGE_MAP.post(stage)) in_post++;
    else if (STAGE_MAP.dist(stage)) in_distribution++;

    // Stalled: no update in 7+ days
    const lastUpdate = p.updated_at || p.created_at;
    const msSinceUpdate = now - new Date(lastUpdate).getTime();
    if (msSinceUpdate > STALE_MS) {
      let stageKey = 'pre';
      if (STAGE_MAP.prod(stage)) stageKey = 'prod';
      else if (STAGE_MAP.post(stage)) stageKey = 'post';
      else if (STAGE_MAP.dist(stage)) stageKey = 'dist';
      const stageInfo = STAGE_LABELS[stageKey];
      stalled.push({
        id:           p.id,
        title:        p.title || `Project ${p.id}`,
        stage:        stage,
        stage_name:   stageInfo.name,
        stage_url:    stageInfo.url,
        days_stalled: Math.floor(msSinceUpdate / (1000 * 60 * 60 * 24)),
        stalled_since: new Date(lastUpdate).toISOString().slice(0, 10),
      });
    }
  }

  return {
    in_pre_production,
    in_production,
    in_post,
    in_distribution,
    total_active: allActive.length,
    stalled,
  };
}

// ─────────────────────────────────────────────
// WritΩr Room Session — server-side persistence
// ─────────────────────────────────────────────

function getRoomSession(projectId) {
  const row = _get(`SELECT * FROM writr_room_sessions WHERE project_id = ?`, [projectId]);
  if (!row) return null;
  try {
    return { ...row, messages: JSON.parse(row.messages) };
  } catch (_) {
    return { ...row, messages: [] };
  }
}

function upsertRoomSession(projectId, messages) {
  const json = JSON.stringify(messages || []);
  const existing = _get(`SELECT id FROM writr_room_sessions WHERE project_id = ?`, [projectId]);
  if (existing) {
    _run(
      `UPDATE writr_room_sessions SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`,
      [json, projectId]
    );
  } else {
    _run(
      `INSERT INTO writr_room_sessions (project_id, messages) VALUES (?, ?)`,
      [projectId, json]
    );
  }
}

function clearRoomSession(projectId) {
  _run(`DELETE FROM writr_room_sessions WHERE project_id = ?`, [projectId]);
}

// ─────────────────────────────────────────────
// ClipsΩr — viral clip DB functions
// ─────────────────────────────────────────────

function insertViralClip(data) {
  const result = _run(
    `INSERT INTO viral_clips (footage_id, project_id, rank, start_time, end_time, duration, hook, caption, hashtags, platform_fit, why_it_works, clip_type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.footage_id, data.project_id || null, data.rank || 1,
      data.start_time, data.end_time, data.duration || null,
      data.hook || null, data.caption || null, data.hashtags || null,
      data.platform_fit ? JSON.stringify(data.platform_fit) : null,
      data.why_it_works || null, data.clip_type || 'social', data.status || 'candidate'
    ]
  );
  return result.lastInsertRowid;
}

function getViralClipsByFootage(footageId) {
  return _all(`SELECT * FROM viral_clips WHERE footage_id = ? ORDER BY rank ASC`, [footageId]);
}

// Returns { footage_id: count } for all footage that has clips — single query, no N+1
function getViralClipCounts() {
  const rows = _all(`SELECT vc.footage_id, COUNT(*) as count FROM viral_clips vc LEFT JOIN footage f ON f.id = vc.footage_id WHERE vc.status != 'skipped' AND (f.quality_flag IS NULL OR f.quality_flag != 'archived') GROUP BY vc.footage_id`);
  const map = {};
  rows.forEach(r => { map[r.footage_id] = r.count; });
  return map;
}

// Returns approved viral clips for a project — used by PackageΩr and MailΩr
// to inject the strongest moments + reasoning into downstream generation prompts.
// Checks both vc.project_id (direct) AND footage.project_id (for clips saved
// before the project_id fix — ensures existing approved clips are found).
function getApprovedViralClipsByProject(projectId) {
  return _all(
    `SELECT vc.*, f.transcript
     FROM viral_clips vc
     LEFT JOIN footage f ON f.id = vc.footage_id
     WHERE vc.status = 'approved'
       AND (vc.project_id = ? OR f.project_id = ?)
       AND (f.quality_flag IS NULL OR f.quality_flag != 'archived')
     ORDER BY vc.rank ASC`,
    [projectId, projectId]
  );
}

// Returns N most recently approved clips across all footage.
// Used as fallback when footage isn't linked to a project.
function getRecentApprovedClips(limit = 20) {
  return _all(
    `SELECT vc.*, f.transcript, f.original_filename, f.project_id as footage_project_id
     FROM viral_clips vc
     LEFT JOIN footage f ON f.id = vc.footage_id
     WHERE vc.status = 'approved'
     ORDER BY vc.updated_at DESC
     LIMIT ?`,
    [limit]
  );
}

// Returns the completed-video footage for a project (for transcript injection)
function getCompletedFootageByProject(projectId) {
  return _get(
    `SELECT * FROM footage
     WHERE project_id = ? AND shot_type = 'completed-video'
     ORDER BY id DESC LIMIT 1`,
    [projectId]
  );
}

function updateViralClip(id, fields) {
  const allowed = ['hook', 'caption', 'hashtags', 'why_it_works', 'status', 'rank', 'platform_fit'];
  const updates = Object.keys(fields).filter(k => allowed.includes(k));
  if (!updates.length) return;
  const sets = updates.map(k => `${k} = ?`);
  const vals = updates.map(k => k === 'platform_fit' && typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k]);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  _run(`UPDATE viral_clips SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
}

function deleteViralClipsByFootage(footageId) {
  _run(`DELETE FROM viral_clips WHERE footage_id = ?`, [footageId]);
}

function getViralClipById(id) {
  return db.prepare(`SELECT * FROM viral_clips WHERE id = ?`).get(id) || null;
}

function _debugViews() {
  // Total views by platform
  const byPlatform = db.prepare(`
    SELECT a.platform, COUNT(*) as rows, SUM(a.metric_value) as total_views
    FROM analytics a
    WHERE a.metric_name = 'views'
    GROUP BY a.platform
    ORDER BY total_views DESC
  `).all();

  // Posts per project (find any with >1 YouTube post)
  const dupPosts = db.prepare(`
    SELECT project_id, COUNT(*) as post_count
    FROM posts WHERE platform = 'youtube'
    GROUP BY project_id HAVING post_count > 1
  `).all();

  // Analytics rows per post (find any with >1 views row for same post)
  const dupAnalytics = db.prepare(`
    SELECT post_id, COUNT(*) as row_count
    FROM analytics WHERE metric_name = 'views'
    GROUP BY post_id HAVING row_count > 1
  `).all();

  // Top 5 projects by view count (to spot outliers)
  const top5 = db.prepare(`
    SELECT pr.title, pr.source, pr.status, po.platform,
           SUM(a.metric_value) as views, COUNT(a.id) as analytics_rows
    FROM analytics a
    JOIN posts po ON po.id = a.post_id
    JOIN projects pr ON pr.id = po.project_id
    WHERE a.metric_name = 'views'
    GROUP BY pr.id, po.platform
    ORDER BY views DESC LIMIT 5
  `).all();

  // Grand total
  const grandTotal = db.prepare(
    `SELECT SUM(metric_value) as n FROM analytics WHERE metric_name = 'views'`
  ).get();

  const ytOnly = db.prepare(
    `SELECT SUM(a.metric_value) as n FROM analytics a
     JOIN posts po ON po.id = a.post_id
     WHERE a.metric_name = 'views' AND po.platform = 'youtube'`
  ).get();

  return {
    grand_total_all_platforms: grandTotal?.n || 0,
    youtube_only_total:        ytOnly?.n || 0,
    by_platform:               byPlatform,
    duplicate_posts:           dupPosts,
    duplicate_analytics_rows:  dupAnalytics,
    top_5_videos:              top5,
  };
}

// Force WAL checkpoint — call after critical writes (uploads, approvals) to
// ensure data survives a crash before the automatic checkpoint interval.
function checkpoint() {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) {}
}

// ─── Idea Vault (SeedΩr) ──────────────────────────────────────────────────────

function createIdea({ title, concept, angle, hook, notes, source = 'manual' } = {}) {
  const r = _run(
    `INSERT INTO ideas (title, concept, angle, hook, notes, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title, concept || null, angle || null, hook || null, notes || null, source]
  );
  return r.lastInsertRowid;
}

function getIdea(id) {
  return _get('SELECT * FROM ideas WHERE id = ?', [id]);
}

function getAllIdeas({ status, angle, search } = {}) {
  let sql = 'SELECT * FROM ideas WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (angle)  { sql += ' AND angle = ?';  params.push(angle);  }
  if (search) {
    sql += ' AND (title LIKE ? OR concept LIKE ? OR hook LIKE ? OR notes LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  sql += ' ORDER BY created_at DESC';
  return _all(sql, params);
}

function updateIdea(id, fields) {
  const allowed = ['title','concept','angle','hook','notes','status','brief_data','cluster','connections','project_id'];
  const sets    = ['updated_at = CURRENT_TIMESTAMP'];
  const vals    = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
    }
  }
  if (sets.length === 1) return; // nothing to update
  vals.push(id);
  _run(`UPDATE ideas SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function deleteIdea(id) {
  _run('DELETE FROM ideas WHERE id = ?', [id]);
}

function bulkCreateIdeas(ideas) {
  const ids = [];
  const insert = db.prepare(
    `INSERT INTO ideas (title, concept, angle, hook, notes, source)
     VALUES (?, ?, ?, ?, ?, 'bulk')`
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const r = insert.run(
        row.title, row.concept || null, row.angle || null,
        row.hook || null, row.notes || null
      );
      ids.push(r.lastInsertRowid);
    }
  });
  insertMany(ideas);
  return ids;
}

module.exports = {
  initDb,
  checkpoint,
  bootstrapTenantTables, // used by tenant-db-cache to fully initialise new tenant DBs
  getRawDb: () => db,  // used by session store in server.js
  // Raw prepare — routes that build inline SQL (e.g. affiliator.js) need this.
  // Delegates to _activeDb() so tenant context is respected.
  prepare: (sql) => _activeDb().prepare(sql),
  transaction: (fn) => _activeDb().transaction(fn),
  // Auth
  getUserByUsername,
  getUserById,
  getAllUsers,
  getUserCount,
  createUser,
  updateUserPassword,
  deleteUser,
  // Tenants
  createTenant,
  getTenantBySlug,
  getTenantByToken,
  getAllTenants,
  updateTenantLastSync,
  logSync,
  // Projects
  createProject,
  createProjectFromSnapshot,
  replaceProjectFromSnapshot,
  getProject,
  getAllProjects,
  getKre8rProjects,
  getAllProjectsBySource,
  setProjectSource,
  updateProjectStage,
  markProjectPublished,
  markProjectComplete,
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
  bulkArchiveProjects,
  bulkDeleteProjects,
  unarchiveProject,
  deleteProject,
  getArchivedProjects,
  getPipelineSummary,
  // KV Store
  getKv,
  setKv,
  // Token Usage
  logTokenUsage,
  getTokenStats,
  getTokenUsageByTenant,
  // VaultΩr
  insertFootage,
  updateFootage,
  getFootageById,
  getUnpackagedClips,
  updateFootageCaptionPackage,
  getAllFootage,
  countFootage,
  dedupeFootage,
  purgeArchivedFootage,
  searchFootageByWhere,
  getFootageStats,
  footageFilePathExists,
  findDuplicateFootage,
  archiveFootage,
  bulkArchiveFootage,
  upsertDistribution,
  deleteDistribution,
  getDistributionByFootage,
  getAllDistribution,
  getFootageByBrawPath,
  findBrawByBasename,
  findProjectByShootPath,
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
  updatePostFormat,
  deletePost,
  getYouTubeFormats,
  countImportedProjects,
  upsertMetric,
  // Analytics CSV import
  getPostByUrl,
  getPostByProjectAndPlatform,
  getProjectByYouTubeVideoId,
  createImportProject,
  createImportPost,
  getAnalyticsByPost,
  getAnalyticsByProject,
  getAnalyticsSummary,
  getGlobalChannelHealth,
  getRecentProjectsWithAnalytics,
  getTikTokPostsForAnalysis,
  getMetaSyncablePosts,
  bridgeMetaPost,
  // ComposΩr
  insertComposorTrack,
  updateComposorTrack,
  getComposorTracksByProject,
  selectComposorTrack,
  deleteComposorTracksByProject,
  getPendingSunoTracks,
  truncateLongSunoPrompts,
  updateProjectComposorState,
  // EditΩr
  insertSelect,
  getSelectsByProject,
  deleteSelectsByProject,
  updateSelectTake,
  updateProjectEditorState,
  // Id8Ωr
  updateProjectId8r,
  // Session Checkpoints
  setCheckpoint,
  getCheckpoint,
  deleteCheckpoint,
  // Background Jobs
  createJob,
  getJob,
  getActiveJobByType,
  updateJobProgress,
  finishJob,
  failJob,
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
  // Collaborator Soul
  getProjectCollaborators,
  updateProjectCollaborators,
  // ShootDay
  getShootTakes,
  upsertShootTake,
  resetShootTakes,
  // Beta Applications
  insertBetaApplication,
  getAllBetaApplications,
  updateBetaApplicationStatus,
  // Bug Reports
  insertBugReport,
  getBugReports,
  updateBugReportStatus,
  getBugReportStats,
  // NPS
  insertNpsScore,
  getNpsScores,
  getNpsAverage,
  // Funnel + Stats
  getBetaFunnel,
  getBetaStats,
  // ShowΩr
  createShow,
  getShow,
  getAllShows,
  updateShow,
  createShowEpisode,
  getShowEpisodes,
  getShowEpisode,
  updateShowEpisode,
  getNextEpisodeNumber,
  buildSeasonContext,
  // WritΩr Room Sessions
  getRoomSession,
  upsertRoomSession,
  clearRoomSession,
  // ClipsΩr
  insertViralClip,
  getViralClipById,
  getViralClipsByFootage,
  getViralClipCounts,
  getApprovedViralClipsByProject,
  getRecentApprovedClips,
  getCompletedFootageByProject,
  updateViralClip,
  deleteViralClipsByFootage,
  // Diagnostics
  _debugViews,
  // NorthΩr
  createGoal,
  getGoal,
  updateGoal,
  createAlert,
  getUnreadAlerts,
  getAllAlerts,
  getAlertByType,
  markAlertRead,
  dismissAlert,
  createStrategyReport,
  getLatestReport,
  getStructurePerformance,
  saveStrategyEvaluation,
  getRecentEvaluations,
  getVideosByMonth,
  getPublishingStats,
  getPipelineHealth,
  // SequenceΩr
  createEmailSequence,
  getEmailSequence,
  getAllEmailSequences,
  updateEmailSequence,
  deleteEmailSequence,
  upsertSequenceEmail,
  getSequenceEmails,
  deleteSequenceEmails,
  // PostΩr
  getPostorConnection,
  getAllPostorConnections,
  upsertPostorConnection,
  deletePostorConnection,
  createPostorPost,
  updatePostorPost,
  getPostorPosts,
  getAllYouTubePosts,
  // PostΩr Queue
  addToPostorQueue,
  getPostorQueue,
  getPostorQueueItem,
  updatePostorQueueItem,
  cancelPostorQueueItem,
  getPendingQueueItems,
  upsertMonthlyRevenue,
  getMonthlyRevenue,
  getRevenueForMonth,
  // Idea Vault
  createIdea,
  getIdea,
  getAllIdeas,
  updateIdea,
  deleteIdea,
  bulkCreateIdeas,
  // MarkΩr
  insertWatermark,
  getWatermarkByPath,
  getWatermarkById,
  getAllWatermarks,
  getWatermarkStats,
  insertVideoFingerprint,
  getVideoFingerprints,
  getAllVideoFingerprints,
  getVideoFingerprintStats,
  deleteVideoFingerprints,
  insertAudioFingerprint,
  getAudioFingerprint,
  getAllAudioFingerprints,
  getAudioFingerprintStats,
  insertGuardReport,
  getGuardReport,
  getAllGuardReports,
  updateGuardReport,
  getGuardReportStats,
  getUnfingerprintedFootage,
  // VectΩr
  insertStrategicBrief,
  getActiveBrief,
  getAllStrategicBriefs,
  getVectrSession,
  setVectrSession,
  clearVectrSession,
  getVectrSyncCache,
  setVectrSyncCache,
};

// ─────────────────────────────────────────────
// SequenceΩr — email sequence builder
// ─────────────────────────────────────────────

function createEmailSequence({ name, goal_type, goal_description, audience, email_count, timeframe_days, voice_profile }) {
  const result = _run(
    `INSERT INTO email_sequences (name, goal_type, goal_description, audience, email_count, timeframe_days, voice_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name || null, goal_type || 'onboard', goal_description || null, audience || null,
     email_count || 5, timeframe_days || 14, voice_profile || null]
  );
  return _get('SELECT * FROM email_sequences WHERE id = ?', [result.lastInsertRowid]);
}

function getEmailSequence(id) {
  return _get('SELECT * FROM email_sequences WHERE id = ?', [id]);
}

function getAllEmailSequences() {
  return _all('SELECT * FROM email_sequences ORDER BY updated_at DESC');
}

function updateEmailSequence(id, fields) {
  const allowed = ['name','goal_type','goal_description','audience','email_count','timeframe_days',
                   'voice_profile','chat_history','plan','status'];
  const sets    = [];
  const vals    = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (!sets.length) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  _run(`UPDATE email_sequences SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function deleteEmailSequence(id) {
  _run('DELETE FROM email_sequences WHERE id = ?', [id]);
}

function upsertSequenceEmail(sequenceId, position, { subject, body, send_day, purpose }) {
  const existing = _get('SELECT id FROM sequence_emails WHERE sequence_id = ? AND position = ?', [sequenceId, position]);
  if (existing) {
    _run(
      `UPDATE sequence_emails SET subject=?, body=?, send_day=?, purpose=?, revised_at=CURRENT_TIMESTAMP WHERE id=?`,
      [subject, body, send_day ?? 0, purpose || null, existing.id]
    );
    return existing.id;
  } else {
    const r = _run(
      `INSERT INTO sequence_emails (sequence_id, position, subject, body, send_day, purpose) VALUES (?,?,?,?,?,?)`,
      [sequenceId, position, subject, body, send_day ?? 0, purpose || null]
    );
    return r.lastInsertRowid;
  }
}

function getSequenceEmails(sequenceId) {
  return _all('SELECT * FROM sequence_emails WHERE sequence_id = ? ORDER BY position', [sequenceId]);
}

function deleteSequenceEmails(sequenceId) {
  _run('DELETE FROM sequence_emails WHERE sequence_id = ?', [sequenceId]);
}

// ─────────────────────────────────────────────
// PostΩr — Platform Connections + Post History
// ─────────────────────────────────────────────

function getPostorConnection(platform) {
  return _get('SELECT * FROM platform_connections WHERE platform = ?', [platform]);
}

function getAllPostorConnections() {
  return _all('SELECT platform, account_id, account_name, extra_data, connected_at, updated_at FROM platform_connections ORDER BY platform');
}

function upsertPostorConnection(platform, { access_token, refresh_token, token_expires_at, account_id, account_name, extra_data } = {}) {
  _run(`
    INSERT INTO platform_connections (platform, access_token, refresh_token, token_expires_at, account_id, account_name, extra_data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform) DO UPDATE SET
      access_token     = excluded.access_token,
      refresh_token    = COALESCE(excluded.refresh_token, refresh_token),
      token_expires_at = excluded.token_expires_at,
      account_id       = excluded.account_id,
      account_name     = excluded.account_name,
      extra_data       = excluded.extra_data,
      updated_at       = CURRENT_TIMESTAMP
  `, [
    platform,
    access_token,
    refresh_token    || null,
    token_expires_at || null,
    account_id       || null,
    account_name     || null,
    extra_data       ? (typeof extra_data === 'string' ? extra_data : JSON.stringify(extra_data)) : null,
  ]);
}

function deletePostorConnection(platform) {
  _run('DELETE FROM platform_connections WHERE platform = ?', [platform]);
}

function createPostorPost({ project_id, platform, status, video_path, title, description, metadata, scheduled_at } = {}) {
  const r = _run(`
    INSERT INTO postor_posts (project_id, platform, status, video_path, title, description, metadata, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    project_id   || null,
    platform,
    status       || 'pending',
    video_path   || null,
    title        || null,
    description  || null,
    metadata     ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
    scheduled_at || null,
  ]);
  return r.lastInsertRowid;
}

function updatePostorPost(id, fields) {
  const allowed = ['status','post_url','post_id','posted_at','error','metadata'];
  const sets    = [];
  const vals    = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (!sets.length) return;
  vals.push(id);
  _run(`UPDATE postor_posts SET ${sets.join(', ')} WHERE id = ?`, vals);
}

// Get all YouTube posts from the main posts table (CSV imports + MirrΩr)
function getAllYouTubePosts() {
  return _all(`SELECT id, project_id, url, platform FROM posts WHERE platform = 'youtube' AND url IS NOT NULL`);
}

// Monthly revenue store — used by NorthΩr for actual revenue vs. goal
function upsertMonthlyRevenue(month, platform, revenue) {
  // month format: YYYY-MM
  _run(`
    INSERT INTO monthly_revenue (month, platform, revenue_usd)
    VALUES (?, ?, ?)
    ON CONFLICT(month, platform) DO UPDATE SET
      revenue_usd = excluded.revenue_usd,
      updated_at  = CURRENT_TIMESTAMP
  `, [month, platform, revenue]);
}

function getMonthlyRevenue(year) {
  if (year) {
    return _all(`SELECT * FROM monthly_revenue WHERE month LIKE ? ORDER BY month DESC`, [`${year}-%`]);
  }
  return _all(`SELECT * FROM monthly_revenue ORDER BY month DESC LIMIT 24`);
}

function getRevenueForMonth(month) {
  // month: YYYY-MM
  const rows = _all(`SELECT SUM(revenue_usd) as total FROM monthly_revenue WHERE month = ?`, [month]);
  return rows[0]?.total || 0;
}

function getPostorPosts({ project_id, platform, limit = 50 } = {}) {
  let sql    = 'SELECT * FROM postor_posts WHERE 1=1';
  const params = [];
  if (project_id) { sql += ' AND project_id = ?'; params.push(project_id); }
  if (platform)   { sql += ' AND platform = ?';   params.push(platform);   }
  sql += ' ORDER BY created_at DESC';
  if (limit)      { sql += ' LIMIT ?'; params.push(limit); }
  return _all(sql, params);
}

// ─── PostΩr Queue ─────────────────────────────────────────────────────────────

function addToPostorQueue({ video_path, platforms, title, description, ig_caption,
  fb_description, yt_privacy, yt_tags, yt_category_id, yt_scheduled_at, scheduled_at,
  image_path }) {
  const r = _run(`
    INSERT INTO postor_queue
      (video_path, platforms, title, description, ig_caption, fb_description,
       yt_privacy, yt_tags, yt_category_id, yt_scheduled_at, scheduled_at, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    video_path    || '',       // empty string for image-only / text-only posts
    JSON.stringify(platforms || []),
    title         || null,
    description   || null,
    ig_caption    || null,
    fb_description|| null,
    yt_privacy    || 'public',
    yt_tags       ? JSON.stringify(yt_tags) : null,
    yt_category_id|| 22,
    yt_scheduled_at || null,
    scheduled_at,
    image_path    || null,
  ]);
  return r.lastInsertRowid;
}

function getPostorQueue({ from, to } = {}) {
  let sql = 'SELECT * FROM postor_queue WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND scheduled_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND scheduled_at <= ?'; params.push(to);   }
  sql += ' ORDER BY scheduled_at ASC';
  return _all(sql, params);
}

function getPostorQueueItem(id) {
  return _get('SELECT * FROM postor_queue WHERE id = ?', [id]);
}

function updatePostorQueueItem(id, { status, result, error } = {}) {
  const sets = [], vals = [];
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (result !== undefined) { sets.push('result = ?'); vals.push(result); }
  if (error  !== undefined) { sets.push('error  = ?'); vals.push(error);  }
  if (!sets.length) return;
  vals.push(id);
  _run(`UPDATE postor_queue SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function cancelPostorQueueItem(id) {
  _run(`UPDATE postor_queue SET status = 'cancelled' WHERE id = ? AND status = 'pending'`, [id]);
}

function getPendingQueueItems() {
  return _all(`
    SELECT * FROM postor_queue
    WHERE status = 'pending'
      AND scheduled_at <= datetime('now')
    ORDER BY scheduled_at ASC
  `);
}

// ─────────────────────────────────────────────
// MarkΩr HELPERS
// ─────────────────────────────────────────────

function insertWatermark({ footage_id, video_path, watermarked_path, seed, watermark_code, channel = 'original' }) {
  return _run(
    `INSERT INTO watermarks (footage_id, video_path, watermarked_path, seed, watermark_code, channel)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [footage_id || null, video_path, watermarked_path || null, seed, watermark_code, channel]
  );
}

function getWatermarkByPath(videoPath) {
  return _get('SELECT * FROM watermarks WHERE video_path = ? ORDER BY rowid DESC LIMIT 1', [videoPath]);
}

function getWatermarkById(id) {
  return _get('SELECT * FROM watermarks WHERE id = ?', [id]);
}

function getAllWatermarks() {
  return _all('SELECT * FROM watermarks ORDER BY embedded_at DESC');
}

function getWatermarkStats() {
  return _get(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT video_path) as unique_videos,
      MAX(embedded_at) as last_embedded
    FROM watermarks
  `);
}

// Video fingerprints
function insertVideoFingerprint({ footage_id, video_path, frame_index, frame_time_s, phash }) {
  return _run(
    `INSERT INTO video_fingerprints (footage_id, video_path, frame_index, frame_time_s, phash)
     VALUES (?, ?, ?, ?, ?)`,
    [footage_id || null, video_path, frame_index, frame_time_s, phash]
  );
}

function getVideoFingerprints(videoPath) {
  return _all('SELECT * FROM video_fingerprints WHERE video_path = ? ORDER BY frame_index', [videoPath]);
}

function getAllVideoFingerprints() {
  return _all('SELECT * FROM video_fingerprints ORDER BY video_path, frame_index');
}

function getVideoFingerprintStats() {
  return _get(`
    SELECT
      COUNT(DISTINCT video_path) as videos_fingerprinted,
      COUNT(*) as total_frames
    FROM video_fingerprints
  `);
}

function deleteVideoFingerprints(videoPath) {
  _run('DELETE FROM video_fingerprints WHERE video_path = ?', [videoPath]);
}

// Audio fingerprints
function insertAudioFingerprint({ footage_id, video_path, fingerprint_data, duration_s }) {
  return _run(
    `INSERT OR REPLACE INTO audio_fingerprints (footage_id, video_path, fingerprint_data, duration_s)
     VALUES (?, ?, ?, ?)`,
    [footage_id || null, video_path, fingerprint_data, duration_s || null]
  );
}

function getAudioFingerprint(videoPath) {
  return _get('SELECT * FROM audio_fingerprints WHERE video_path = ?', [videoPath]);
}

function getAllAudioFingerprints() {
  return _all('SELECT * FROM audio_fingerprints ORDER BY created_at');
}

function getAudioFingerprintStats() {
  return _get(`
    SELECT
      COUNT(*) as videos_fingerprinted,
      SUM(duration_s) as total_duration_s
    FROM audio_fingerprints
  `);
}

// Guard reports
// Report types where the content is likely legitimate use, not theft
const LEGITIMATE_REPORT_TYPES = ['stitch_duet', 'reaction', 'licensed'];

function insertGuardReport({ submitted_url, submitted_file_path, submitter_note, platform,
                              report_type, match_type, match_confidence, matched_footage_id,
                              matched_video_title, evidence_json }) {
  const rtype = report_type || 'unknown';
  const isLegit = LEGITIMATE_REPORT_TYPES.includes(rtype) ? 1 : 0;
  return _run(
    `INSERT INTO guard_reports
       (submitted_url, submitted_file_path, submitter_note, platform,
        report_type, is_likely_legitimate,
        match_type, match_confidence, matched_footage_id, matched_video_title, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      submitted_url || null, submitted_file_path || null, submitter_note || null, platform || null,
      rtype, isLegit,
      match_type || null, match_confidence || null, matched_footage_id || null,
      matched_video_title || null, evidence_json || null,
    ]
  );
}

function getGuardReport(id) {
  return _get('SELECT * FROM guard_reports WHERE id = ?', [id]);
}

function getAllGuardReports({ status } = {}) {
  const params = [];
  let sql = 'SELECT * FROM guard_reports WHERE 1=1';
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  return _all(sql, params);
}

function updateGuardReport(id, fields) {
  const sets = [], vals = [];
  const allowed = ['status', 'claim_platform', 'claim_reference', 'is_likely_legitimate'];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!sets.length) return;
  vals.push(id);
  _run(`UPDATE guard_reports SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function getGuardReportStats() {
  return _get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN status = 'filed'     THEN 1 ELSE 0 END) as filed,
      SUM(CASE WHEN status = 'resolved'  THEN 1 ELSE 0 END) as resolved
    FROM guard_reports
  `);
}

// Vault footage that hasn't been fingerprinted yet
function getUnfingerprintedFootage() {
  return _all(`
    SELECT f.*
    FROM footage f
    WHERE f.file_path IS NOT NULL
      AND f.shot_type NOT IN ('unusable')
      AND NOT EXISTS (
        SELECT 1 FROM video_fingerprints vf WHERE vf.footage_id = f.id
      )
    ORDER BY f.created_at DESC
  `);
}

// ─────────────────────────────────────────────
// VectΩr — Strategic Briefs + Session
// ─────────────────────────────────────────────

function insertStrategicBrief({ platform_context, conversation_json, brief_json }) {
  // Supersede all existing active briefs first
  _run(`UPDATE strategic_briefs SET status = 'superseded', superseded_at = CURRENT_TIMESTAMP WHERE status = 'active'`);
  const result = _run(
    `INSERT INTO strategic_briefs (platform_context, conversation_json, brief_json, status)
     VALUES (?, ?, ?, 'active')`,
    [
      platform_context ? JSON.stringify(platform_context) : null,
      conversation_json ? JSON.stringify(conversation_json) : null,
      JSON.stringify(brief_json),
    ]
  );
  return result.lastInsertRowid;
}

function getActiveBrief() {
  const row = _get(`SELECT * FROM strategic_briefs WHERE status = 'active' ORDER BY locked_at DESC LIMIT 1`);
  if (!row) return null;
  try {
    return {
      ...row,
      brief_json:        row.brief_json        ? JSON.parse(row.brief_json)        : null,
      platform_context:  row.platform_context  ? JSON.parse(row.platform_context)  : null,
      conversation_json: row.conversation_json ? JSON.parse(row.conversation_json) : null,
    };
  } catch (_) { return row; }
}

function getAllStrategicBriefs(limit = 10) {
  return _all(
    `SELECT id, status, locked_at, superseded_at, brief_json FROM strategic_briefs ORDER BY locked_at DESC LIMIT ?`,
    [limit]
  ).map(r => ({
    ...r,
    brief_json: r.brief_json ? (() => { try { return JSON.parse(r.brief_json); } catch (_) { return null; } })() : null,
  }));
}

// VectΩr session — stored in kv_store as 'vectr_session' (JSON array of messages)
function getVectrSession() {
  const row = _get(`SELECT value FROM kv_store WHERE key = 'vectr_session'`);
  if (!row?.value) return [];
  try { return JSON.parse(row.value); } catch (_) { return []; }
}

function setVectrSession(messages) {
  _run(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES ('vectr_session', ?, CURRENT_TIMESTAMP)`,
    [JSON.stringify(messages || [])]
  );
}

function clearVectrSession() {
  _run(`DELETE FROM kv_store WHERE key = 'vectr_session'`);
}

// VectΩr sync cache — stored in kv_store as 'vectr_sync_cache'
function getVectrSyncCache() {
  const row = _get(`SELECT value, updated_at FROM kv_store WHERE key = 'vectr_sync_cache'`);
  if (!row?.value) return null;
  try { return { data: JSON.parse(row.value), updated_at: row.updated_at }; } catch (_) { return null; }
}

function setVectrSyncCache(data) {
  _run(
    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES ('vectr_sync_cache', ?, CURRENT_TIMESTAMP)`,
    [JSON.stringify(data)]
  );
}

