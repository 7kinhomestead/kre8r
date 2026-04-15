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
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER,   -- nullable — footage can exist before project assignment
  file_path           TEXT NOT NULL,
  original_filename   TEXT,
  shot_type           TEXT,      -- dialogue | talking-head | b-roll | action | unusable
  subcategory         TEXT,      -- wide | medium | close-up | detail (b-roll only, else null)
  description         TEXT,      -- Claude Vision content description
  duration            REAL,      -- seconds
  resolution          TEXT,      -- e.g. "3840x2160"
  codec               TEXT,
  file_size           INTEGER,   -- bytes
  creation_timestamp  TEXT,      -- from file metadata
  thumbnail_path      TEXT,      -- path to extracted thumbnail
  quality_flag        TEXT,      -- hero | usable | review | discard
  organized_path      TEXT,      -- destination path after folder reorganization (null until organized)
  used_in             TEXT NOT NULL DEFAULT '[]',  -- JSON array of project_ids
  ingested_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
-- DAVINCI TIMELINES
-- One row per DaVinci timeline per project.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS davinci_timelines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL,
  timeline_name  TEXT NOT NULL,
  timeline_index INTEGER NOT NULL DEFAULT 1,
  state          TEXT NOT NULL DEFAULT 'pending',  -- pending | active | awaiting_creator | complete
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME,
  notes          TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────
-- CLIP DISTRIBUTION
-- Where each VaultΩr clip has been posted.
-- One row per footage × platform. Platform list mirrors creator-profile.json.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clip_distribution (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_id      INTEGER NOT NULL,
  platform        TEXT NOT NULL,   -- tiktok | youtube | facebook | instagram | lemon8 | other
  posted_at       DATETIME,        -- null = not yet posted
  post_url        TEXT,
  posted_manually INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(footage_id, platform),
  FOREIGN KEY (footage_id) REFERENCES footage(id) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_davinci_timelines_project ON davinci_timelines(project_id);
CREATE INDEX IF NOT EXISTS idx_clip_dist_footage  ON clip_distribution(footage_id);
CREATE INDEX IF NOT EXISTS idx_clip_dist_platform ON clip_distribution(platform);

-- ─────────────────────────────────────────────
-- IDEA VAULT (SeedΩr)
-- Persistent idea library. Every seed captured here before it becomes a project.
-- Status: raw → in_development → produced
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ideas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  concept     TEXT,
  angle       TEXT,        -- financial | system | rockrich | howto | mistakes | lifestyle | viral
  hook        TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'raw',     -- raw | in_development | produced
  source      TEXT NOT NULL DEFAULT 'manual',  -- manual | id8r | bulk
  brief_data  TEXT,        -- JSON: enriched brief from Id8Ωr session
  cluster     TEXT,        -- Claude-assigned semantic cluster label
  connections TEXT,        -- JSON: [{id, weight, reason}] — related idea IDs
  project_id  INTEGER,     -- set when promoted to a PipΩr project
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ideas_status  ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_angle   ON ideas(angle);
CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at);
