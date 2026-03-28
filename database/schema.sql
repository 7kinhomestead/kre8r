-- Kre8\u03a9r SQLite Schema — Section 11
-- One database to rule the entire pipeline.
-- Every module reads from and writes to this.

-- PRAGMA journal_mode=WAL; -- removed: incompatible with sql.js in-memory mode
-- PRAGMA foreign_keys=ON; -- set in initDb() code instead

-- ─────────────────────────────────────────────
-- PROJECTS
-- One row per video. The root of everything.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  topic           TEXT,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | archived | published
  current_stage   TEXT NOT NULL DEFAULT 'M0.1',     -- pipeline stage code
  youtube_url     TEXT,
  youtube_video_id TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at    DATETIME
);

-- ─────────────────────────────────────────────
-- PIPELINE STATE
-- Stage + gate tracking for every active project.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_state (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL UNIQUE,
  current_stage   TEXT NOT NULL DEFAULT 'M0.1',
  stage_status    TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | complete | blocked
  gate_a_approved INTEGER NOT NULL DEFAULT 0,
  gate_b_approved INTEGER NOT NULL DEFAULT 0,
  gate_c_approved INTEGER NOT NULL DEFAULT 0,
  gate_a_approved_at DATETIME,
  gate_b_approved_at DATETIME,
  gate_c_approved_at DATETIME,
  notes           TEXT,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- SCRIPTS
-- Outline and full script per project.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scripts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL UNIQUE,
  outline           TEXT,
  full_script       TEXT,
  approved_version  TEXT,
  iteration_history TEXT NOT NULL DEFAULT '[]',  -- JSON array
  approved          INTEGER NOT NULL DEFAULT 0,
  approved_at       DATETIME,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- SHOTS
-- Shot list per project from DirectΩr / ShotListΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  shot_number     INTEGER,
  scene_number    INTEGER,
  location        TEXT,
  shot_type       TEXT,      -- dialogue | talking-head | b-roll | action | establishing
  subcategory     TEXT,      -- wide | medium | close-up | detail | aerial
  subject         TEXT,
  description     TEXT,
  duration_estimate TEXT,
  priority        TEXT,      -- hero | required | nice-to-have
  notes           TEXT,
  captured        INTEGER NOT NULL DEFAULT 0,
  captured_at     DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- FOOTAGE
-- Every clip in the VaultΩr. Heart of EditΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS footage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER,  -- nullable — footage can exist before project assignment
  file_path       TEXT NOT NULL,
  original_filename TEXT,
  shot_type       TEXT,
  subcategory     TEXT,
  description     TEXT,
  duration        REAL,
  resolution      TEXT,
  codec           TEXT,
  file_size       INTEGER,
  thumbnail_path  TEXT,
  quality_flag    TEXT,      -- hero | usable | review | discard
  used_in         TEXT NOT NULL DEFAULT '[]',  -- JSON array of project_ids
  ingested_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- ─────────────────────────────────────────────
-- CUTS
-- Identified clip moments from CutΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  footage_id      INTEGER,
  start_timestamp TEXT,
  end_timestamp   TEXT,
  duration_seconds REAL,
  cut_type        TEXT,      -- retention | CTA | social
  description     TEXT,
  approved        INTEGER NOT NULL DEFAULT 0,
  approved_at     DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (footage_id) REFERENCES footage(id)
);

-- ─────────────────────────────────────────────
-- PACKAGES
-- 5 content packages per project from PackageΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL,
  package_number      INTEGER NOT NULL,
  title               TEXT,
  hook                TEXT,
  rationale           TEXT,
  thumbnail_concept   TEXT,
  youtube_description TEXT,
  is_selected         INTEGER NOT NULL DEFAULT 0,
  selected_at         DATETIME,
  selection_note      TEXT,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- CAPTIONS
-- Per clip, per platform from CaptionΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS captions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  cut_id          INTEGER,
  clip_label      TEXT,        -- e.g. "Clip 01"
  timestamp_start TEXT,
  timestamp_end   TEXT,
  description     TEXT,
  platform        TEXT NOT NULL, -- tiktok | instagram | facebook | shorts | lemon8
  caption_text    TEXT,
  approved        INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  change_notes    TEXT,
  approved_at     DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (cut_id) REFERENCES cuts(id)
);

-- ─────────────────────────────────────────────
-- EMAILS
-- 7-email sequence from MailΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  send_day        INTEGER NOT NULL,  -- 0 | 3 | 7
  tier            TEXT NOT NULL,     -- everyone | greenhouse | garden | founding
  subject         TEXT,
  body            TEXT,
  approved        INTEGER NOT NULL DEFAULT 0,
  approved_at     DATETIME,
  sent_at         DATETIME,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- POSTS
-- Scheduled and sent social posts from PostΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  caption_id      INTEGER,
  platform        TEXT NOT NULL,
  content         TEXT,
  media_path      TEXT,
  scheduled_at    DATETIME,
  posted_at       DATETIME,
  post_id         TEXT,        -- platform's post ID after publishing
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | scheduled | posted | failed
  error_message   TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (caption_id) REFERENCES captions(id)
);

-- ─────────────────────────────────────────────
-- ANALYTICS
-- Platform performance data from AnalyticΩr.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER,
  post_id         INTEGER,
  platform        TEXT NOT NULL,
  metric_name     TEXT NOT NULL,   -- views | watch_time | completion_rate | shares | saves | ctr | followers_gained
  metric_value    REAL,
  recorded_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_packages_project ON packages(project_id);
CREATE INDEX IF NOT EXISTS idx_packages_selected ON packages(project_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_captions_project ON captions(project_id);
CREATE INDEX IF NOT EXISTS idx_captions_platform ON captions(platform);
CREATE INDEX IF NOT EXISTS idx_emails_project ON emails(project_id);
CREATE INDEX IF NOT EXISTS idx_emails_day_tier ON emails(project_id, send_day, tier);
CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id);
CREATE INDEX IF NOT EXISTS idx_footage_project ON footage(project_id);
CREATE INDEX IF NOT EXISTS idx_footage_quality ON footage(quality_flag);
CREATE INDEX IF NOT EXISTS idx_cuts_project ON cuts(project_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_analytics_project ON analytics(project_id);
