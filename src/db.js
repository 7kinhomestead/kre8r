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

  // AssemblΩr — proxy_path on footage so transcription always has a working file
  const footageColsAssemblr = db.pragma('table_info(footage)').map(r => r.name);
  if (!footageColsAssemblr.includes('proxy_path')) {
    db.exec('ALTER TABLE footage ADD COLUMN proxy_path TEXT');
    console.log('[DB] Migration: added footage.proxy_path');
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
}

// persist() removed — better-sqlite3 writes directly to disk on every operation

// ─────────────────────────────────────────────
// LOW-LEVEL HELPERS — better-sqlite3 API
// ─────────────────────────────────────────────

function _run(sql, params = []) {
  const result = db.prepare(sql).run(params);
  return { lastInsertRowid: result.lastInsertRowid };
}

function _get(sql, params = []) {
  return db.prepare(sql).get(params) ?? null;
}

function _all(sql, params = []) {
  return db.prepare(sql).all(params);
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

// Native Kre8Ωr projects only — excludes youtube_import.
// Use this everywhere EXCEPT MirrΩr which needs the full YouTube history.
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
    WHERE p.status != 'archived' AND p.source != 'youtube_import'
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

function getGlobalChannelHealth() {
  // All queries exclude archived projects — archived kre8r duplicates must not inflate totals
  const totalViews = _get(
    `SELECT COALESCE(SUM(a.metric_value),0) as n
     FROM analytics a
     JOIN posts po ON po.id = a.post_id
     JOIN projects pr ON pr.id = po.project_id
     WHERE a.metric_name = 'views' AND pr.status != 'archived'`
  );
  const avgViews = _get(
    `SELECT COALESCE(AVG(v),0) as n FROM (
       SELECT SUM(a.metric_value) as v
       FROM analytics a
       JOIN posts po ON po.id = a.post_id
       JOIN projects pr ON pr.id = po.project_id
       WHERE a.metric_name = 'views' AND pr.status != 'archived'
       GROUP BY a.project_id
     )`
  );
  const bestVideo = _get(
    `SELECT pr.id, pr.title, pr.topic, po.platform, po.url, a.metric_value as views
     FROM analytics a
     JOIN posts po ON po.id = a.post_id
     JOIN projects pr ON pr.id = po.project_id
     WHERE a.metric_name = 'views' AND pr.status != 'archived'
     ORDER BY a.metric_value DESC LIMIT 1`
  );
  const totalVideos = _get(
    `SELECT COUNT(*) as n FROM projects WHERE status != 'archived'`
  );
  const topAngle = _get(
    `SELECT pr.topic, COUNT(*) as n
     FROM projects pr
     JOIN posts po ON po.project_id = pr.id
     JOIN analytics a ON a.post_id = po.id
     WHERE a.metric_name = 'views' AND a.metric_value > 0
       AND pr.topic IS NOT NULL AND pr.status != 'archived'
     GROUP BY pr.topic ORDER BY SUM(a.metric_value) DESC LIMIT 1`
  );
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

  return {
    total_views:          totalViews?.n  || 0,
    avg_views:            Math.round(avgViews?.n || 0),
    longform_avg_views:   Math.round(longformAvg?.n || 0),
    best_video:           bestVideo      || null,
    total_videos:         totalVideos?.n || 0,
    top_topic:            topAngle?.topic || null,
    format_breakdown:     fmtBreakdown,
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

function updateProjectPipr(projectId, fields) {
  const allowed = [
    'setup_depth', 'entry_point', 'story_structure', 'content_type',
    'high_concept', 'estimated_duration_minutes', 'pipr_complete',
    'shoot_folder', 'archive_state', 'archived_at'
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
  // When source is explicitly 'youtube_import' (MirrΩr) use the full set; otherwise native projects only.
  const projects = source ? getAllProjectsBySource(source) : getKre8rProjects();
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

function logTokenUsage({ tool, session_id, input_tokens, output_tokens, estimated_cost }) {
  _run(
    `INSERT INTO token_usage (tool, session_id, input_tokens, output_tokens, estimated_cost)
     VALUES (?, ?, ?, ?, ?)`,
    [tool, session_id || null, input_tokens || 0, output_tokens || 0, estimated_cost || 0]
  );
  // No persist() needed — better-sqlite3 writes on every operation
}

function getTokenStats() {
  const today = new Date().toISOString().split('T')[0];

  const todayTotals = _get(
    `SELECT
       COALESCE(SUM(input_tokens), 0)   AS input_tokens,
       COALESCE(SUM(output_tokens), 0)  AS output_tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimated_cost
     FROM token_usage
     WHERE DATE(created_at) = ?`,
    [today]
  );

  const allTime = _get(
    `SELECT
       COALESCE(SUM(input_tokens), 0)   AS input_tokens,
       COALESCE(SUM(output_tokens), 0)  AS output_tokens,
       COALESCE(SUM(estimated_cost), 0) AS estimated_cost
     FROM token_usage`
  );

  const byTool = _all(
    `SELECT tool,
       SUM(input_tokens)   AS input_tokens,
       SUM(output_tokens)  AS output_tokens,
       SUM(estimated_cost) AS estimated_cost,
       COUNT(*)            AS call_count
     FROM token_usage
     GROUP BY tool
     ORDER BY SUM(estimated_cost) DESC`
  );

  const id8rAvg = _get(
    `SELECT
       COALESCE(AVG(session_cost), 0) AS avg_cost,
       COUNT(*)                       AS session_count
     FROM (
       SELECT session_id, SUM(estimated_cost) AS session_cost
       FROM token_usage
       WHERE tool = 'id8r' AND session_id IS NOT NULL
       GROUP BY session_id
     )`
  );

  return {
    today: {
      input_tokens:  todayTotals?.input_tokens  || 0,
      output_tokens: todayTotals?.output_tokens || 0,
      estimated_cost: Math.round((todayTotals?.estimated_cost || 0) * 10000) / 10000
    },
    all_time: {
      input_tokens:  allTime?.input_tokens  || 0,
      output_tokens: allTime?.output_tokens || 0,
      estimated_cost: Math.round((allTime?.estimated_cost || 0) * 10000) / 10000
    },
    by_tool: byTool,
    id8r_avg_cost: Math.round((id8rAvg?.avg_cost || 0) * 10000) / 10000,
    id8r_session_count: id8rAvg?.session_count || 0
  };
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
      AND (pr.source IS NULL OR pr.source != 'youtube_import')
  `);

  const daysSinceLastPublish = lastPost?.last_publish
    ? Math.floor((Date.now() - new Date(lastPost.last_publish).getTime()) / 86400000)
    : 999;

  // Last email sent (use most recent approved email as proxy)
  const lastEmail = _get(
    `SELECT created_at FROM emails WHERE approved = 1 ORDER BY created_at DESC`
  );
  const daysSinceLastEmail = lastEmail?.created_at
    ? Math.floor((Date.now() - new Date(lastEmail.created_at).getTime()) / 86400000)
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
     WHERE p.status NOT IN ('published', 'archived') AND p.source != 'youtube_import'
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

module.exports = {
  initDb,
  createProject,
  getProject,
  getAllProjects,
  getKre8rProjects,
  getAllProjectsBySource,
  setProjectSource,
  updateProjectStage,
  markProjectPublished,
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
  getAnalyticsByPost,
  getAnalyticsByProject,
  getAnalyticsSummary,
  getGlobalChannelHealth,
  getRecentProjectsWithAnalytics,
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
  getPublishingStats,
  getPipelineHealth,
};
