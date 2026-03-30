# Kre8Ωr Session Log — 2026-03-30 (Session 7)

## What Was Built — Session 7

### PipΩr — Complete Project Configuration & Creative Contract System

Full 8-part PipΩr system built from scratch:

**Part A — DB Migrations (`src/db.js`)**
- 7 new columns on `projects` table: `setup_depth`, `entry_point`, `story_structure`,
  `content_type`, `high_concept`, `estimated_duration_minutes`, `pipr_complete`
- `updateProjectPipr(projectId, fields)` helper + exported
- All columns migrated on first server start (confirmed live)

**Part B — Beat Maps (`src/pipr/beats.js`)**
- `SAVE_THE_CAT` — 15 beats with emotional function + reality notes
- `STORY_CIRCLE` — 8 beats (Dan Harmon)
- `VSL_ARC` — 7 beats for sales/conversion videos
- `FREE_FORM` — empty (no structure)
- `getBeats(structure)` + `buildBeatMap(structure, durationMinutes)` — includes `target_seconds`

**Part C — Beat Tracker (`src/pipr/beat-tracker.js`)**
- `readConfig(projectId)` / `writeConfig(projectId, config)` — file-system JSON store at `database/projects/[id]/project-config.json`
- `matchSectionToBeat()` — keyword matching (score ≥ 2) + pct proximity fallback
- `updateBeatCoverage(projectId)` — maps selects → beats, detects out-of-sequence, writes updated config

**Part D — PipΩr Wizard UI (`public/pipr.html`)**
- 5-screen wizard: Entry Point → Project Basics → Story Structure → Content Input → Beat Map Preview
- Deep-mode beat editing (override name + target_pct per beat)
- POST /api/pipr/create on completion → redirect to /?project=id

**Part E — PipelineΩr Integration (`public/index.html`)**
- Global alert bar above main when any project has unmet beats or no PipΩr setup
- NEW PROJECT section replaced with "Start New Project in PipΩr →" link card
- Each project card now shows: PipΩr ✓ badge, beat progress bar, missing/OOS beat tags
- `PipΩr →` action button per project card
- `loadPipeline()` now fetches `/api/pipr/report` in parallel with projects

**Part F — DaVinci Beat Markers (`scripts/davinci/build-selects.py`)**
- `load_project_config(project_id)` reads project-config.json from database/projects/
- After placing all clips, adds colored beat markers at `target_pct × total_timeline_frames`:
  - Green = covered beat
  - Orange = out-of-sequence beat
  - Red = critical missing beat (Hook, CTA, All Is Lost, Catalyst, Finale, Break into Three)
  - Cyan = other missing beat
- Summary marker now includes beat count

**Part G — API Routes (`src/routes/pipr.js`)**
- `POST /api/pipr/create` — create project + config + write JSON
- `GET  /api/pipr/beats-preview` — beat template preview (no project needed)
- `GET  /api/pipr/report` — all-projects beat coverage summary
- `POST /api/pipr/mine` — run config miner
- `GET  /api/pipr/:project_id` — full config
- `PATCH /api/pipr/:project_id` — update config + sync DB fields
- `GET  /api/pipr/:project_id/beats` — beat map with coverage
- `POST /api/pipr/:project_id/beats/update` — re-run beat coverage from selects

**Part H — Config Miner (`src/pipr/config-miner.js`)**
- `minePatterns()` — reads all project-config.json files, computes structure frequencies,
  avg duration, emotional palette patterns, writes to `creator-profile.json.storytelling_patterns`

**server.js**
- Mounted `app.use('/api/pipr', require('./src/routes/pipr'))`
- Added PipΩr URL to terminal startup output

### Also Fixed (continuation from previous session)
- ComposΩr `public_path` persistence: DB column + route populate + client fallback chain
- broll-bridge.js: wrong column name (`resolve_project_name` → `davinci_project_name`), fps comment

---

# Kre8Ωr Session Log — 2026-03-30

## Summary

Session 6 completed the SelectsΩr chunked-analysis architecture (four iterations to
final working state), hardened transcript summarization aggressiveness, and fixed
the BRAW proxy export audio silence bug (root cause: `mediaType:1` in AppendToTimeline
was stripping audio from the timeline before render).

---

## What Was Built / Changed

### SelectsΩr — Chunked Claude analysis (`src/editor/selects.js`)

Complete rewrite of the Claude call layer. Replaced single large prompt (was
hitting the 8192-token output limit with 5 VSL clips) with a self-contained
`analyzeTranscripts(clips, context, emit)` function.

**Module-level constants:**
```js
const CHUNK_SIZE          = 2;     // max clips per Claude call
const MAX_WORDS_PER_CHUNK = 3000;  // hard word limit per chunk prompt
```
Startup log confirms both are live: `[SelectsΩr] Module loaded — CHUNK_SIZE=2, MAX_WORDS_PER_CHUNK=3000`

**`analyzeTranscripts(clips, context, emit)`** — new sole entry point for Claude:
1. Summarizes every clip transcript (filler drop + compression) before chunking
2. Splits clips into chunks respecting both CHUNK_SIZE and MAX_WORDS_PER_CHUNK
3. Calls `analyzeChunk()` once per chunk (prompt includes "chunk N of M" header so
   Claude knows to identify all sections without worrying about completeness)
4. Collects all sections from all chunks
5. If > 1 chunk: calls `mergeChunkedSections()` — sends only section labels + footage_ids
   (no transcripts) to Claude for deduplication and script-order unification
6. Returns `{ sections[], overall_notes }`

`buildSelects()` step 4 replaced with a single clean call:
```js
const analysis = await analyzeTranscripts(
  transcribedClips,
  { script, concept, projectTitle: project.title },
  (ev) => onProgress?.(ev)
);
```

**Summarization aggressiveness increased:**
- `isFiller()`: drops any segment with fewer than 4 words (was: only pure filler vocab)
- `summarizeSegment()`: compresses on word count > 50 (was: sentence count > 2)
  - Single run-on sentence > 50 words: first 25 words + `[…]` + last 5 words

**Old single-call path removed entirely.** No fallback. No `buildChunks()` helper.
No inline step 3b/4 block in `buildSelects`.

**SSE progress stages (new names):**
- `chunks_planned` — `{ total_chunks, total_clips }`
- `analyzing_chunk` — `{ current, total, clip_count, word_count, message }`
- `chunk_done` — `{ current, total, sections, message }`
- `merging` — `{ total_sections, message }`
- `merge_done` — `{ sections, message }`

**`public/editor.html`** — UI handlers updated to match new stage names. Each chunk
logs to the browser panel with clip range and word count.

---

### BRAW proxy export — audio silence fix (`scripts/davinci/braw-proxy-export.py`)

**Root cause:** `AppendToTimeline` was called with `"mediaType": 1` which tells
DaVinci Resolve to add the video stream only. Audio was never placed on the
timeline so render produced silent MP4s regardless of what codec settings were set.

**Fix 1 — Remove `mediaType` from clip_dicts (the actual bug):**
```python
# Before (video-only — root cause of silence):
{"mediaPoolItem": item, "startFrame": 0, "endFrame": -1, "mediaType": 1}

# After (video + audio — all tracks included):
{"mediaPoolItem": item, "startFrame": 0, "endFrame": -1}
```

**Fix 2 — Explicit audio render settings (belt-and-suspenders):**
```python
"ExportAudio":     True,
"AudioCodec":      "AAC",    # uppercase — Resolve 20 is case-sensitive
"AudioBitrate":    320,      # kbps
"AudioChannels":   2,        # stereo
"AudioSampleRate": 48000,    # Hz
```
Per-clip log: `[audio] Settings for <stem>: ExportAudio=True, Codec=AAC, Bitrate=320kbps, Channels=2 (stereo), SampleRate=48000Hz`

---

## Files Changed This Session

| File | Change |
|------|--------|
| `src/editor/selects.js` | Full chunk architecture rewrite — `analyzeTranscripts` function |
| `public/editor.html` | SSE stage name handlers updated for new chunk events |
| `scripts/davinci/braw-proxy-export.py` | Audio silence fix: removed `mediaType:1`, added explicit AAC render settings |

---

# Kre8Ωr Session Log — 2026-03-29

## Summary

Session 5 completed ComposΩr (Phase 2) in full, fixed a critical SelectsΩr JSON
truncation bug, added Prompt Mode manual workflow tooling to ComposΩr, fixed the
braw-proxy-export.py timeline collision error, and fixed a data-mapping bug that
was silently preventing ComposΩr tracks from rendering in the UI at all.

---

## What Was Built / Changed

### ComposΩr — Parts E–H (completion of Phase 2)

**`server.js`**
- Mounted `/api/composor` route.

**`scripts/davinci/place-music.py`** — NEW FILE
- Opens DaVinci project by name (with `_NNN` suffix scan fallback).
- Gets or creates `04_AUDIO` timeline.
- Imports each selected MP3 via `media_pool.ImportMedia`, appends to audio track 1.
- Places Blue markers at each scene's approximate start position.
- Renames audio track to `Music -6dB` as a volume reminder.
- Outputs JSON result to stdout; all logs to stderr.

**`public/composor.html`** — NEW FILE (full UI, 3 sections)
- **Scene Analysis section**: scene cards with type badge, energy level, emotional direction, genre direction, duration hint.
- **Track Selection section**: per-scene blocks with 3 variation rows; audio player when audio exists; generating spinner; suno-fallback message; Select button; Copy Prompt button; Open in Suno → link.
- **DaVinci Status section**: info block, Push to DaVinci button (unlocks when all scenes selected), advance banner.
- SSE job stream for both generation and DaVinci push.
- Suno key status pill in project bar (Active / Prompt Mode).

**Nav updated on all 9 pages** — ComposΩr link added between EditΩr and ReviewΩr.

**`public/index.html`** — Added ComposΩr quick-action card; ComposΩr nav tag.

**`SETUP.md`** — Added `SUNO_API_KEY` documentation with Prompt Mode explanation.

---

### ComposΩr — Prompt Mode manual workflow improvements

**`src/routes/composor.js`**
- Added `POST /api/composor/upload/:project_id` endpoint.
  - Accepts multipart `file` + `scene_label` + `scene_index`.
  - Multer saves to `public/music/<project_id>/<scene_slug>/uploaded_<ts>_<name>`.
  - Inserts track row, marks it selected via `selectComposorTrack()`.
  - Advances `composor_state` to `complete` if all scenes now have a selection.
  - 50 MB file size limit; audio MIME + extension filter.

**`public/composor.html`** (Prompt Mode additions)
- **"Open in Suno →"** link button (purple) per track — opens `suno.com/create` in new tab, appears whenever a prompt exists.
- **"⬆ Upload Track"** button per scene block — triggers hidden file input, POSTs to `/api/composor/upload`, shows inline status (`Uploading…` → `✓ Uploaded & selected` or error), then reloads tracks.
- **Data mapping bug fixed**: `loadTracks` was reading `d.groups` (never returned by the API); now correctly builds from `d.scenes[].tracks[]` and derives `public_path` from `suno_track_url` for local files. This was silently preventing all track rendering.
- **`updateStatusBar` fixed**: was using `d.groups` for track counts — now uses `scenes.flatMap(sc => sc.tracks)`.
- **`renderTracks` refactored**: now accepts scenes array directly (needed `scene_index` per block for upload targeting).

---

### SelectsΩr — JSON truncation fix (`src/editor/selects.js`)

Three changes to prevent "Claude returned malformed JSON: Unterminated string":

1. **`max_tokens` raised from 4096 → 8192** — previous limit was being hit with dense multi-clip selects output.

2. **Transcript summarization** (`TRANSCRIPT_WORD_LIMIT = 6000`):
   - Before building the Claude prompt, counts total words across all transcripts.
   - If > 6000 words: each clip's transcript is trimmed to `max(100, floor(6000 / clipCount))` words.
   - `truncateTranscript()` keeps leading segments plus the final segment as a tail anchor (so Claude still knows clip duration).
   - Progress event `transcript_trim` emitted with `total_words` and `budget_per_clip`.

3. **JSON repair** (`repairJSON` + `findLastCompleteSection`):
   - If `JSON.parse` fails, walks the `sections` array character-by-character tracking brace depth.
   - Finds the last `}` that closes a complete section object.
   - Appends `],"overall_notes":"[truncated...]"}` and attempts a second parse.
   - Falls through to the original error only if repair also fails.

---

### braw-proxy-export.py — Timeline collision fix

**`scripts/davinci/braw-proxy-export.py`** — `create_proxy_source_timeline()` rewritten:

**Root cause**: `DeleteTimelines()` was called but its return value was discarded. When deletion silently failed (Resolve returns `False` for timelines that are current or locked), `CreateEmptyTimeline` was called with the same name → returned `None` → bare `RuntimeError`.

**Fix (4-step strategy)**:
1. Scan all timelines by index, find existing match — log index found.
2. Call `DeleteTimelines([tl])`, capture return value, log `succeeded` or `FAILED`.
3. Create with original name only if nothing existed or deletion confirmed.
   - If `CreateEmptyTimeline` still returns `None` after reported success → log and fall through.
4. Timestamp fallback: `00_PROXY_SOURCE_<unix_timestamp>` — guaranteed unique.
   - If this also fails → `RuntimeError` with manual instructions.

Every decision path produces a `[timeline]` log line to stderr.

---

## Files Changed This Session

| File | Change |
|------|--------|
| `server.js` | Mount `/api/composor` |
| `scripts/davinci/place-music.py` | NEW — DaVinci 04_AUDIO timeline placement |
| `scripts/davinci/braw-proxy-export.py` | Fix timeline collision (4-step deletion strategy) |
| `src/routes/composor.js` | Add `/upload/:project_id` endpoint + multer |
| `src/editor/selects.js` | max_tokens 8192, transcript trim, JSON repair |
| `public/composor.html` | NEW — full ComposΩr UI; fixed data mapping bugs |
| `public/index.html` | ComposΩr quick-action card + nav tag |
| `public/vault.html` | ComposΩr nav link |
| `public/editor.html` | ComposΩr nav link |
| `public/reviewr.html` | ComposΩr nav link |
| `public/m1-approval-dashboard.html` | ComposΩr nav link |
| `public/m2-package-generator.html` | ComposΩr nav link |
| `public/m3-caption-generator.html` | ComposΩr nav link |
| `public/m4-email-generator.html` | ComposΩr nav link |
| `public/m5-analytics.html` | ComposΩr nav link |
| `public/operator.html` | ComposΩr nav link |
| `SETUP.md` | SUNO_API_KEY docs + Prompt Mode explanation |

## Known Issues Carried Forward

- `broll-bridge.js` line ~85: wrong column `resolve_project_name` → should be `project.davinci_project_name` (silent fallback to `project.title`, functionally OK for now).
- `broll-bridge.js` line ~92: `project.fps` doesn't exist → silently defaults to 24 (fine for current footage).
- ComposΩr `suno_track_path` (local disk path) is saved to DB but `public_path` (`/music/...` URL) is never persisted for Suno-generated tracks — only works for uploaded tracks. Will need a DB column or route-level derivation if Suno generation is enabled.

---

# Kre8Ωr Session Log — 2026-03-28

## Summary

Phase 1 completed in full. All four tools migrated to Express + SQLite, database
migrated from better-sqlite3 to sql.js, and the complete M1→M4 gate pipeline wired
end-to-end with error handling and live dashboard refresh.

---

## What Was Built

### M3 — CaptionΩr (`public/m3-caption-generator.html`)

Migrated from standalone localStorage/direct-Anthropic prototype to Express-connected tool.

- Removed browser-side API key — all generation proxied through Express
- `generate()` POSTs to `/api/generate/captions`
- `loadProjectContext()` calls `GET /api/projects/:id/context` to pre-fill video title
  and selected package title on load
- Gate B fires `POST /api/projects/:id/captions/approve-all` on "Copy All for Gate B"
- Error toast if Gate B API call fails (was silent catch)
- Warning toast if `currentProjectId` is null — directs user to open M3 from M2
- `?project_id=X` param threaded through URL; shared nav with M3 active in amber

---

### M4 — MailΩr (`public/m4-email-generator.html`)

Migrated from standalone prototype to Express-connected tool.

- `generate()` POSTs to `/api/generate/emails`
- `loadProjectContext()` pre-fills video title, YouTube URL, and package title
- Gate C fires `POST /api/projects/:id/emails/approve-all` on "Copy All for Gate C"
- Error toast if Gate C API call fails (was silent catch)
- Warning toast if `currentProjectId` is null
- 7-email sequence map (Day 0/3/7) preserved; tier toggles preserved
- Shared nav with M4 active in purple

---

### M1 — GateΩr (`public/m1-approval-dashboard.html`)

Complete rebuild — original was 100% static. New version is fully dynamic.

- Fetches `GET /api/projects` on load and on refresh button click
- Renders projects into three gate queues: A (package selection), B (caption approval),
  C (email approval) — plus an "awaiting generation" bucket
- Gate A: package card grid from DB; requires explicit card select + Approve click
- Gate B: caption previews grouped by clip_label; Approve All button when captions exist;
  "Go to M3" link when captions haven't been generated yet
- Gate C: email previews grouped by send_day; Approve All button when emails exist;
  "Go to M4" link when emails haven't been generated yet
- **After each gate approval, calls `loadDashboard()` after 1.2s** so the project moves
  to the next gate section without requiring a manual refresh
- All-projects list with status badges at the bottom of the page

---

### Database migration — `better-sqlite3` → `sql.js`

`better-sqlite3` requires C++ build tools and failed on Windows. Replaced with `sql.js`
(pure WebAssembly, zero native compilation).

**Files changed:**

| File | Change |
|------|--------|
| `package.json` | Removed `better-sqlite3`, added `sql.js ^1.14.1` |
| `database/schema.sql` | Removed `PRAGMA journal_mode=WAL` (incompatible with in-memory mode) |
| `src/db.js` | Full rewrite — async `initDb()`, `persist()` helper, `_run/_get/_all` helpers, `updateProjectMeta()` |
| `server.js` | Async `start()` that `await initDb()` before `app.listen()` |
| `src/routes/generate.js` | Replaced `db.getDb().prepare().run()` with `db.updateProjectMeta()` |

**sql.js key behaviors:**
- Init is async (`await initSqlJs()`)
- Database is in-memory — `persist()` writes `db.export()` to disk after every write
- No `.get()` / `.all()` on statements — use `stmt.step()` + `stmt.getAsObject()` loop
- No `.transaction()` — use sequential `_run()` calls
- WAL journal mode is incompatible with in-memory VFS — removed from schema

---

### Gate pipeline wiring (`m1`, `m2`, `m3`, `m4`)

End-to-end gate flow fixed. Three root causes identified and resolved:

**M1 — no dashboard reload after approval**
After `approveGateA/B/C` succeeded, the DOM showed "approved" but the next gate section
never appeared. Fixed: each approval now calls `setTimeout(loadDashboard, 1200)`.

**M2 — fire-and-forget with no error surface**
`fetch(...).then(() => showToast('✓ Gate A approved', 'green'))` fired the success toast
on ANY response, including 500s. No `.catch()` handler existed. Fixed: checks `res.ok`,
reads error body on failure, shows amber toast, catches network failures.

**M3 + M4 — silently swallowed gate approvals**
Both `copyAllForGateB` and `copyAllForGateC` had `catch(e) { /* non-critical */ }`. API
failures were invisible. Also: missing `currentProjectId` (user opened tool directly
without `?project_id=`) was silently ignored. Fixed: both now surface error toasts on
failure and warn when no project is linked.

---

## System State at End of Phase 1

All Phase 1 deliverables complete, smoke-tested, and committed.

```
server.js                      Express, async startup, port 3000
src/db.js                      sql.js, 11 tables, persist-to-disk
src/routes/projects.js         REST API — projects, packages, captions, emails, gates
src/routes/generate.js         Claude proxy — /packages, /captions, /emails
public/index.html              PipelineΩr dashboard
public/m1-approval-dashboard.html   GateΩr — fully dynamic, auto-reloads after approval
public/m2-package-generator.html    PackageΩr — Gate A with error handling
public/m3-caption-generator.html    CaptionΩr — Gate B with error handling
public/m4-email-generator.html      MailΩr — Gate C with error handling
database/schema.sql            11 tables, sql.js-compatible
creator-profile.json           7 Kin Homestead soul config
.env                           ANTHROPIC_API_KEY (not in repo)
```

**To run:**
```
npm start
# → http://localhost:3000
```

**Gate flow:**
```
M2: Generate packages → select one → Gate A written + toast
M3: Generate captions → Copy All for Gate B → Gate B written + toast
M4: Generate emails  → Copy All for Gate C → Gate C written + toast
M1: Each approval auto-reloads to show project in next gate section
```

---

# Kre8Ωr Session Log — 2026-03-29

## Summary

Phase 2 — VaultΩr completed in full across 8 steps. The footage intelligence database
is fully operational: ingest, classify with Claude Vision, auto-watch, organize, search
with natural language, and browse via a dedicated UI. VaultΩr is linked into all tool
navbars and appears in the server startup banner.

---

## What Was Built

### Step 1 — Dependencies

Added to `package.json`:
- `fluent-ffmpeg ^2.1.3` — ffprobe metadata extraction + thumbnail generation
- `chokidar ^5.0.0` — folder watcher for auto-ingest
- `multer ^2.1.1` — multipart form handling (reserved for future file upload)

`sharp` was excluded — ffmpeg handles JPEG thumbnail extraction natively, no need for
a second image library that requires native compilation.

---

### Step 2 — Database migration (`src/db.js`, `database/schema.sql`)

`footage` table extended with two new columns:
- `creation_timestamp TEXT` — from file metadata (camera-recorded datetime)
- `organized_path TEXT` — destination path after folder reorganization (null until organized)

Migration pattern in `runMigrations()`: `PRAGMA table_info(footage)` → check existing
column names → `ALTER TABLE ADD COLUMN` only if missing. Safe on any DB state.

Seven footage helper functions added to `src/db.js` and exported:
`insertFootage`, `updateFootage`, `getFootageById`, `getAllFootage`,
`searchFootageByWhere`, `getFootageStats`, `footageFilePathExists`

`updateFootage` uses an allowed-fields whitelist to prevent arbitrary column writes.
`searchFootageByWhere` sanitizes Claude-generated WHERE clauses (blocks semicolons,
DROP, DELETE, INSERT, UPDATE).

`creator-profile.json` updated with `vault` config block:
```json
"vault": {
  "intake_folder": "C:/Users/18054/Videos/intake",
  "organized_folder": "C:/Users/18054/Videos/organized",
  "supported_extensions": [".mp4", ".mov", ".mts", ".avi", ".mkv"],
  "thumbnail_quality": 85
}
```

---

### Step 3 — Intake pipeline (`src/vault/intake.js`)

Full per-file pipeline: ffprobe → thumbnail → Claude Vision → DB insert.

Key design decisions:
- **Thumbnails**: extracted at 3s mark (or 10% of duration for clips < 30s). Filename
  is MD5 of absolute file path — unique across all folders, no basename collisions.
- **Claude Vision**: `claude-sonnet-4-6`, base64 JPEG, returns `shot_type`, `subcategory`,
  `description`, `quality_flag`, `quality_reason`. Markdown fence stripping applied.
- **Resilience**: one bad file never aborts the batch. ffprobe errors → skip with
  `{ status: 'error' }`. Thumbnail failure → non-fatal, record stored without thumb.
  Vision failure → non-fatal, record stored with null classification for later re-run.
- **Dedup**: `footageFilePathExists()` checked at start of each file — already-ingested
  files return `{ status: 'skipped' }` immediately.
- **ffmpeg check**: `checkFfmpeg()` uses `ffmpeg.getAvailableFormats()` callback.
  If ffmpeg not installed, returns `{ ok: false, error: '...' }` cleanly.

`server.js` updated:
- `app.use('/api/vault', require('./src/routes/vault'))` mounted
- Async startup now `await initDb()` before `app.listen()`

`src/routes/vault.js` — 6 endpoints:
```
GET  /api/vault/status          ffmpeg check + DB stats
POST /api/vault/ingest          folder intake, SSE progress streaming
GET  /api/vault/footage         list with filters (shot_type, quality_flag, project_id, q)
GET  /api/vault/footage/:id     single clip
PATCH /api/vault/footage/:id    update fields
POST /api/vault/search          natural language search
```

SSE streaming: when client sends `Accept: text/event-stream`, `/ingest` streams
`data: {...}\n\n` events for each pipeline stage (discovered → processing → probed →
thumbnail → classified → saved → done).

---

### Step 4 — Folder watcher (`src/vault/watcher.js`)

chokidar watches `vault.intake_folder` from `creator-profile.json`.

- `awaitWriteFinish: { stabilityThreshold: 4000 }` — waits for file copy to complete
  before triggering ingest (prevents reading mid-copy files)
- `ignoreInitial: true` — files already in the folder at startup are not re-ingested
- `depth: 5` — watches up to 5 subdirectory levels
- Watcher auto-starts at server boot via `startWatcher()` in `server.js` (non-fatal
  if intake folder doesn't exist — creates it)
- Intake folder created automatically with `fs.mkdirSync(..., { recursive: true })`

Three control endpoints added to `src/routes/vault.js`:
```
GET  /api/vault/watcher         running status + watched path
POST /api/vault/watcher/start   start watcher (or restart after stop)
POST /api/vault/watcher/stop    stop watcher cleanly
```

---

### Step 5 — Folder organizer (`src/vault/organizer.js`)

Copies ingested clips to `vault.organized_folder` using naming convention:
```
YYYY-MM-DD_description-slug_shottype_NNN.ext
```

Examples:
```
2026-03-28_wide-shot-garden-beds-morning_b-roll_001.mp4
2026-03-28_creator-grey-shirt-speaking-camera_talking-head_002.mov
```

Key rules:
- Files are **copied, never moved** — originals stay untouched
- Subfolders by `shot_type` (e.g. `organized/b-roll/`, `organized/talking-head/`)
- `NNN` sequence number scoped to the shot_type subfolder — counts existing files
- Collision guard: bumps sequence until a free filename is found
- Date from `creation_timestamp` → fallback to `ingested_at` → fallback to today
- Description slug: first sentence of Claude description, slugified to max 40 chars,
  falls back to original filename stem if description is null
- Already-organized files (`organized_path` set) are skipped with `{ skipped: true }`

Two endpoints added:
```
POST /api/vault/organize              organize all unorganized footage, SSE supported
POST /api/vault/footage/:id/organize  organize a single clip
```

---

### Step 6 — Search engine (`src/vault/search.js`)

Natural language → Claude Haiku → SQLite WHERE clause → footage results.

Uses `claude-haiku-4-5` (not Sonnet) — search queries are simple text-to-SQL,
no vision needed. Fast and low-cost.

System prompt sends the full `footage` table schema with column types, allowed enum
values, and 7 worked examples covering common query patterns. Claude returns a bare
WHERE clause fragment — no SELECT, no WHERE keyword, no semicolons.

`db.searchFootageByWhere()` applies a second sanitization layer (blocks semicolons,
DROP, DELETE, INSERT, UPDATE) before executing.

Both search paths were already wired in `src/routes/vault.js` from Step 3:
- `POST /api/vault/search` — body `{ q: "..." }`
- `GET /api/vault/footage?q=...` — query param triggers search path

Graceful degradation: if `ANTHROPIC_API_KEY` not set, returns `{ error: "ANTHROPIC_API_KEY not set" }` — does not crash.

---

### Step 7 — VaultΩr UI (`public/vault.html`)

Full footage intelligence UI. Same dark design system (Bebas Neue + DM Sans, `--teal`,
`--bg`, `--bg-card` variables) as all other tools.

**Status bar**: ffmpeg availability pill, watcher on/off pill (clickable toggle that
calls `/watcher/start` or `/watcher/stop`), total clips, hero count, b-roll count.

**Ingest panel**: folder path input, optional project selector (populated from
`/api/projects`), `▶ Ingest` button. SSE progress stream rendered as:
- Progress bar (0% → 100%)
- Scrolling log with color-coded lines (green = ok, amber = warn, red = error)
- On completion: auto-reloads footage grid and status bar

**Filter bar**: shot type chips (All / B-roll / Talking Head / Dialogue / Action /
Unusable) + quality chips (All / Hero / Usable / Review / Discard) + natural language
search input with 600ms debounce and animated spinner.

**Thumbnail grid**: responsive `auto-fill minmax(220px, 1fr)`. Each card shows 16:9
thumbnail (with placeholder on missing), filename, 2-line description, shot type badge,
quality badge, duration. Cards open the clip modal on click.

**Clip modal**: full-size thumbnail, metadata grid (duration, resolution, codec, file
size, original path), editable shot type / subcategory / quality / description fields,
**Save changes** (PATCH to API), **Organize file** (copy to organized folder + shows
`✓ Organized` on success). Subcategory field dims to 40% opacity when shot type is not
b-roll.

---

### Step 8 — Navigation update

VaultΩr link added to the `<div class="nav">` in all 5 existing tools:
- `public/index.html` — styled with teal background to match the VaultΩr brand color
- `public/m1-approval-dashboard.html` — added before the ↻ Refresh button
- `public/m2-package-generator.html`
- `public/m3-caption-generator.html`
- `public/m4-email-generator.html`

`server.js` startup banner updated:
```
  VaultΩr    → http://localhost:3000/vault.html
```

`SETUP.md` created with ffmpeg installation instructions (winget, Chocolatey, Scoop,
manual) and npm dependency table.

---

## System State at End of Phase 2

```
server.js                         Auto-starts VaultΩr watcher on boot
src/vault/intake.js               ffprobe → thumbnail → Claude Vision → DB
src/vault/watcher.js              chokidar auto-ingest on file drop
src/vault/organizer.js            copy + rename to organized folder
src/vault/search.js               natural language → Haiku → SQL WHERE
src/routes/vault.js               9 endpoints: status, ingest, footage CRUD,
                                  organize, search, watcher control
public/vault.html                 Full VaultΩr UI
database/schema.sql               footage table with creation_timestamp + organized_path
src/db.js                         7 new footage helpers + runMigrations()
creator-profile.json              vault config block added
SETUP.md                          ffmpeg install instructions
All public/*.html                 VaultΩr in shared nav
```

**ffmpeg required for full functionality:**
```
winget install Gyan.FFmpeg
# Then restart the server
```

**Once ffmpeg is installed + ANTHROPIC_API_KEY is set in .env:**
- Drop a video into `C:/Users/18054/Videos/intake` → auto-classified within seconds
- `POST /api/vault/ingest` with a folder path → batch classify with progress stream
- Search: "hero b-roll of the garden, under 30 seconds" → Claude WHERE → results
- Organize: copies to `C:/Users/18054/Videos/organized/<shot_type>/YYYY-MM-DD_slug_type_NNN.ext`

**CLAUDE_MODEL note:** `.env` currently has `claude-sonnet-4-20250514`. Update to
`claude-sonnet-4-6` at the start of the next session.

---

# Kre8Ωr Session Log — 2026-03-29 (Session 2)

## Summary

Phase 2 extensions and Phase 3 completion. CutΩr wired end-to-end (route + ReviewΩr UI
+ nav deep-linking), VaultΩr extended with RAW format support, the full nav consolidated
into a DistributΩr dropdown, M5 AnalytΩr built from scratch, OperatΩr master dashboard
built, and several UI polish fixes applied across all 9 pages.

---

## What Was Built / Changed

### CutΩr — Steps 4-6 (`src/routes/cutor.js`, `public/reviewr.html`, nav)

**Route (`src/routes/cutor.js`)** — job-based SSE pipeline:
- In-memory `Map<jobId, { status, events[], emitter }>` — events buffered so late SSE
  subscribers receive all prior events on connect
- `POST /api/cutor/start` — spawns Whisper transcription then Claude cut analysis async,
  returns `{ job_id }` immediately
- `GET /api/cutor/status/:job_id` — SSE stream, flushes buffer then streams live
- `GET /api/cutor/cuts/:project_id` — fetch saved cuts from DB
- `POST /api/cutor/approve/:cut_id` — mark cut approved
- `POST /api/cutor/extract/:project_id` — ffmpeg stream-copy extracts approved cuts,
  SSE progress, updates `clip_path` in DB

**ReviewΩr UI (`public/reviewr.html`)**:
- Project + footage selectors; `?project_id=X` deep-link auto-selects on load
- SSE progress log for transcribe + analyze pipeline
- Ranked social clip cards with approve button, expandable Claude reasoning
- Retention cuts + CTA placement sections (hidden if none)
- Extract panel with SSE progress bar; clip_path links update post-extraction
- Advance-to-M2 banner appears after successful extraction

**Nav (Step 6)**: ReviewΩr linked from all navbars with `?project_id=` threading;
`getAllProjects()` extended with `social_cuts`, `approved_cuts`, `extracted_clips`,
`footage_count` subquery columns; pipeline cards show cut status pills + CutΩr button.

---

### VaultΩr RAW format support (`src/vault/intake.js`)

- `.braw` (Blackmagic), `.r3d` (RED), `.ari` (ARRI) added to `SUPPORTED_EXTENSIONS`
- `RAW_EXTENSIONS` Set separates formats where ffprobe may legitimately fail
- `fallbackMetadata(filePath)` uses `fs.statSync` for file size + birthtime
- Three-tier fallback: ffprobe → filesystem metadata → null fields; file always ingests

---

### DistributΩr dropdown nav consolidation (all pages)

M1-M4 individual nav links collapsed into a single hover dropdown labeled `DistributΩr`.
Sub-items: GateΩr, PackageΩr, CaptionΩr, MailΩr. Active state on button when on any
M1-M4 page; matching item highlighted inside menu.

Bugs fixed during this work:
- `.logo span { font-size:11px }` was hitting the teal color span, making `8Ω` render
  small. Fixed: renamed selector to `.logo .sub`, added `class="sub"` only to subtitles.
- `inline-flex` + `gap:4px` on `.nav-drop-btn` placed "Distribut", `<span>Ω</span>`,
  and "r" as three flex items with visible gaps. Fixed: removed `gap:4px`.

---

### M5 AnalytΩr (`public/m5-analytics.html`, `src/routes/analytics.js`, `src/db.js`)

**DB migrations**: `posts.url TEXT` and `posts.angle TEXT` added via `runMigrations()`.

**DB helpers added**: `savePost`, `getPostsByProject`, `updatePost`, `deletePost`,
`upsertMetric`, `getAnalyticsByPost`, `getAnalyticsByProject`, `getAnalyticsSummary`.

**Route** mounted at `/api/analytics`: 6 endpoints covering post CRUD, metric upsert
(EAV into analytics table), project summary, and full analytics with post context.

**UI**: project selector, summary cards (total posts / best platform / top post),
platform filter chips, per-post cards with inline metric editors per platform:
- TikTok: views, completion_rate, shares, followers_gained
- YouTube: views, watch_time, ctr, avg_view_duration, subscribers_gained
- Instagram: reach, saves, shares, profile_visits
- Facebook: reach, engagement, link_clicks
- Lemon8: views, engagement, follower_growth
- Email: open_rate, click_rate, unsubscribes
- Rock Rich: new_members

---

### OperatΩr dashboard (`public/operator.html`, `src/routes/operator.js`)

**Route** mounted at `/api/operator`:
- `GET /api/operator` — projects bucketed into queue / ready / archive in one request.
  Archive = all 5 core platforms (TikTok/YouTube/Instagram/Facebook/Lemon8) posted.
- `POST /api/operator/mark-posted` / `unmark-posted` — toggle platform posted status

**UI** — three-column kanban:
- **Queue**: stage badge, days old, blocking gate warning, quick-jump to correct tool
- **Ready to Publish**: per-platform checkboxes; checking all 5 auto-moves card to Archive
- **Archive**: last post date, total views from analytics, link to AnalytΩr

---

### Nav additions + UI polish (all 9 pages)

- AnalytΩr added as standalone nav link (not inside DistributΩr — analytics is
  post-distribution, not a distribution step)
- OperatΩr added as standalone nav link after AnalytΩr
- Logo subtitles removed from all pages ("7 Kin Homestead", "Pipeline", tool names)
- `.nav-drop-btn` changed from `display:inline-flex;align-items:center` to
  `display:inline-block;white-space:nowrap` — fixes the floating `r` rendering bug
  where inline-flex was splitting button text into separate flex children

---

## System State at End of Session

```
src/routes/cutor.js               Job-based SSE CutΩr pipeline (5 endpoints)
src/routes/analytics.js           M5 AnalytΩr API (6 endpoints)
src/routes/operator.js            OperatΩr dashboard API (3 endpoints)
src/db.js                         posts.url + posts.angle migrations;
                                  8 new analytics/post helpers
src/vault/intake.js               .braw / .r3d / .ari with graceful fallback
public/reviewr.html               Full ReviewΩr UI (SSE + cut cards + extract)
public/m5-analytics.html          AnalytΩr — per-platform post tracking
public/operator.html              OperatΩr — Queue/Ready/Archive kanban
All public/*.html (9 files)       AnalytΩr + OperatΩr in nav; logo cleaned;
                                  DistributΩr button rendering fixed
```

**Nav order on all pages:**
PipelineΩr · VaultΩr · ReviewΩr · AnalytΩr · OperatΩr · DistributΩr▾

**Server health:** `GET /api/health` → `{"status":"ok","anthropic_configured":true}`

---

# Kre8Ωr Session Log — 2026-03-29 (Session 3)

## Summary

DaVinci Resolve integration built end-to-end (Parts A–H), VaultΩr extended with
distribution tracking, folder view, and session persistence. All DaVinci scripting
confirmed working on Resolve Studio 20.3.2.9.

---

## What Was Built / Changed

### VaultΩr — Distribution Tracking Layer

**DB** (`src/db.js`, `database/schema.sql`):
- `clip_distribution` table: `(footage_id, platform, posted_at, post_url,
  posted_manually, notes)` with `UNIQUE(footage_id, platform)` and cascade delete
- Helpers: `upsertDistribution`, `deleteDistribution`, `getDistributionByFootage`,
  `getAllDistribution`

**API** (`src/routes/vault.js`):
- `GET /api/vault/distribution` — bulk load all records (avoids N+1 on page load)
- `POST /api/vault/footage/:id/distribution` — upsert per platform
- `DELETE /api/vault/footage/:id/distribution/:platform`
- `GET /api/vault/footage/:id` extended with `last_modified` from `fs.statSync`

**UI** (`public/vault.html`):
- Platform indicator dots on clip cards (TT · YT · FB · IG · L8 · +) — teal when posted
- Distribution section in clip modal with per-platform toggle, date, URL, notes
- `buildDistMap(records)` — indexes all distribution as `{ [footage_id]: { [platform]: record } }` for O(1) card rendering
- New filter groups: Orientation (All / ↔ H / ↕ V) and Distribution (All / Unposted / TT / YT / FB / IG / L8)
- Expanded status bar: Total | Unorganized | Hero | B-roll | Talking Head
- Folder view mode toggle (Grid | Folder) — collapsible sections by shot_type then parent dir, collapsed by default
- Persistent filter + view state via `sessionStorage` key `vault_state`
- "Show organized" toggle (default off) — hides clips where `organized_path` is not null

---

### DaVinci Resolve Integration (Parts A–H)

**Part A — DB migrations** (`src/db.js`):
- `projects`: added `davinci_project_name`, `davinci_project_state`, `davinci_last_updated`
- `footage`: added `braw_source_path`, `is_proxy`
- `davinci_timelines` table: `(project_id, timeline_name, timeline_index, state,
  created_at, completed_at, notes)` with cascade delete
- `DAVINCI_STATES` (8 states) and `DAVINCI_TRANSITIONS` dict — strict state machine,
  illegal transitions throw before any DB write
- Helpers: `updateProjectDavinciState`, `createDavinciTimeline`, `getDavinciTimelines`,
  `updateDavinciTimeline`, `getDavinciProjectStatus`, `getAllProjectsWithDavinci`
- `findBrawByBasename(brawBasename)` — matches proxy MP4s back to BRAW source records

**Part B — `scripts/davinci/create-project.py`**:
- DaVinci Resolve scripting API bootstrap with Windows DLL path handling
- `check_studio(resolve)` — logs product name + version to stderr; confirms Studio license
- Full bin structure (7 top-level bins + sub-bins) via `AddSubFolder`
- Color science: `davinciYRGBColorManaged` set first, then color spaces via
  `try_set_color_space()` — tries multiple key name formats and string values to handle
  Resolve API differences across versions; probes available keys and logs them to stderr
- S-curve (lift blacks 5%, highlights 95%) via `GetColorAdjustments` / `SetColorAdjustments`
  — all method calls use `callable(getattr(...))` not `hasattr()` to handle Resolve 20
  attributes that exist as None rather than as real methods
- Project metadata `.txt` file written to `00_PROJECT_DOCS` bin
- `01_PROXY_GRADE` timeline created with 4K/24fps settings and orange marker
- Returns `{ ok, project_name, timeline_name, clip_count, scurve_clips, resolve_version, resolve_studio, errors }`

**Part C — `scripts/davinci/braw-proxy-export.py`**:
- Scans recursively for `.braw` files; H.265 4K 80Mbps proxy render via Resolve render queue
- `wait_for_render()` polls `IsRenderingInProgress()` every 5s up to 7200s (2hr timeout)

**Part D — `scripts/davinci/add-timeline.py`**:
- Creates `02_SELECTS` through `08_DELIVERY` timelines progressively
- `skip_if_exists` logic; DaVinci markers from `cuts_json`; platform-specific delivery specs

**Part E — `src/vault/intake.js` BRAW update**:
- `BRAW_EXTENSIONS = new Set(['.braw'])` fast-path — skips ffprobe entirely
- Writes stub record immediately with `codec: 'BRAW'`, `quality_flag: 'review'`
- Proxy detection: `*_proxy.mp4` suffix → `findBrawByBasename()` → `processProxyUpdate()`
  updates original BRAW record with full metadata (no duplicate row)

**Part F — `src/routes/davinci.js`** (new file):
- `runScript(scriptName, args, timeoutMs)` — spawns Python, parses stdout JSON, logs stderr
- 6 endpoints: `GET /projects`, `GET /project/:id`, `POST /create-project`,
  `POST /export-proxies`, `POST /add-timeline`, `POST /update-state`,
  `POST /grade-approved/:project_id`
- Mounted in `server.js` at `/api/davinci`

**Part G — `public/vault.html` DaVinci panel**:
- BRAW filter chips: All / Needs Proxy / Has Proxy / No BRAW
- PROXY NEEDED badge on clip cards for BRAW stubs without a proxy
- DaVinci Projects panel (hidden until projects exist): state badge, timeline chips,
  action buttons (Create Proxies, Grade Approved, Add Timeline, Update State)

**Part H — `docs/davinci-workflow.md`**:
- Complete workflow reference: shoot → ingest → proxy → grade → selects → delivery
- DaVinci scripting setup (corrected: Local mode uses socket, no port required)
- Timeline progression, bin structure, state machine, recovery procedures

---

### DaVinci Scripting Setup — Key Corrections

Two errors in original docs corrected after real-world testing:

1. **No port field in Local mode**: Original docs said to enter port `9237`. Incorrect —
   Local mode uses a named socket, not TCP. Port only applies to Network mode.
   `docs/davinci-workflow.md` updated; socket verification test replaced with
   `DaVinciResolveScript.scriptapp('Resolve').GetVersionString()`.

2. **Color science mode key**: `"davinciYRGB"` (unmanaged) → `"davinciYRGBColorManaged"`.
   Color space input/output settings are silently ignored in unmanaged mode.

3. **Resolve 20 callable attributes**: `hasattr()` returns True for attributes that are
   `None` in Resolve 20's scripting proxy. All method existence checks changed to
   `callable(getattr(obj, method_name, None))`.

---

## Confirmed Working on Resolve Studio 20.3.2.9

- `check_studio()` correctly detects "DaVinci Resolve Studio" and logs version string
- Project creation succeeds: bins, timeline, metadata doc all created
- `colorScienceMode: "davinciYRGBColorManaged"` sets correctly
- Color space key probe logging active — will confirm exact Resolve 20 key names
  on next test run with footage

---

## DB Reset Utility

For test resets (no exported helper — use sql.js directly):
```bash
node -e "
const fs = require('fs'), path = require('path'), initSqlJs = require('sql.js');
const DB_PATH = path.join(__dirname, 'database', 'kre8r.db');
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  db.run('UPDATE projects SET davinci_project_name=NULL, davinci_project_state=NULL, davinci_last_updated=NULL WHERE id=N');
  db.run('DELETE FROM davinci_timelines WHERE project_id=N');
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
});
"
```

---

## System State at End of Session

```
scripts/davinci/create-project.py    Resolve project + bins + grade timeline (confirmed working)
scripts/davinci/braw-proxy-export.py BRAW → H.265 proxy render via Resolve queue
scripts/davinci/add-timeline.py      Progressive timeline builder (02–08)
src/routes/davinci.js                6 API endpoints, Python spawn bridge
src/db.js                            DaVinci state machine + 6 new helpers;
                                     distribution tracking + 4 helpers;
                                     BRAW-specific footage helpers
src/vault/intake.js                  BRAW fast-path + proxy detection
src/routes/vault.js                  Distribution API (3 new endpoints)
public/vault.html                    Distribution dots/modal, folder view,
                                     session persistence, BRAW filters,
                                     DaVinci Projects panel
docs/davinci-workflow.md             Complete workflow reference (corrected)
server.js                            /api/davinci route mounted
```

---

# Kre8Ωr Session Log — 2026-03-29 (Session 4)

## Summary

CutΩr TODO Task 3 completed (Whisper path hardening, ReviewΩr UX, malformed JSON
surfacing). Whisper model upgraded to `medium`. M2 PackageΩr connected to CutΩr output
with server-side context injection. EditΩr built in full — 7 parts covering DB, SelectsΩr
engine, DaVinci timeline builder, B-roll Bridge, API routes, UI, and global nav update.

---

## What Was Built / Changed

### CutΩr — Task 3 completion

**Whisper binary detection (`src/vault/transcribe.js`)**:
- Replaced hardcoded `PYTHON_PATH` with a fallback chain: `py → python3 → python`
- `WHISPER_CANDIDATES` uses `[PYTHON_PATH]` if env var set, else full chain
- `_testWhisperBinary(bin)` probes `bin -m whisper --help` with 10s timeout; resolves version string or null
- `detectWhisperBinary()` iterates candidates, caches result in module-level `_whisperBinary`
- `checkWhisper()` exported — returns `{ whisper, whisper_binary, whisper_version }`
- `runWhisper()` made async; throws descriptive error if no binary found
- Whisper spawn gets `timeout: 600_000` (10 minutes)
- Default model changed: `WHISPER_MODEL = process.env.WHISPER_MODEL || 'medium'`

**`GET /api/cutor/check`** added to `src/routes/cutor.js`:
- Runs `checkFfmpeg()` + `checkWhisper()` in parallel
- Returns `{ ffmpeg, whisper, whisper_binary, whisper_version }`

**ReviewΩr UX (`public/reviewr.html`)**:
- Dependency banner (`.dep-banner`) — shown on load if ffmpeg or Whisper missing
- `checkDependencies()` called on init; disables Transcribe button with explanation
- "Re-run Analysis" button — clears cuts and re-runs full pipeline
- `clipUrl(p)` helper — converts absolute path to `/clips/${filename}` for browser-safe links
- Advance banner now passes `?project_id=` to M2

**Claude JSON safety** (`src/vault/cutor.js`):
- `callClaude()` wraps `JSON.parse` in try/catch — surfaces parse error + first 300 chars of raw response

---

### Whisper model upgrade

Changed `src/vault/transcribe.js` line 39:
```
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'medium'
```
Previously `'base'`. Medium is significantly more accurate for real-world audio.

---

### M2 PackageΩr ↔ CutΩr connection (`src/routes/generate.js`, `public/m2-package-generator.html`, `public/reviewr.html`)

**Server-side context injection** (`src/routes/generate.js`):
- When `project_id` is present in `/api/generate/packages`, pulls approved social clips via `db.getCutsByProject()`
- Filters `cut_type === 'social' && approved`, sorts by rank
- Injects timestamped clip list with description + reasoning into Claude `userPrompt`
- `fmtTs(s)` helper formats seconds as `M:SS.s`

**CutΩr context panel** (`public/m2-package-generator.html`):
- `.cutor-panel` div (teal-bordered) shown when `project_id` present + approved clips exist
- `loadProject()` fetches `/api/cutor/cuts/:id` in parallel with project load
- `renderCutorPanel(clips)` renders ranked clip list with timestamps + reasoning

**ReviewΩr advance banner**:
- "Go to PackageΩr" link now sets `href` to include `?project_id=X` after extraction

---

### EditΩr — Full build (Parts A–G)

**Part A — DB (`src/db.js`)**:
- `footage.transcript TEXT` migration — cached Whisper JSON to avoid re-transcribing
- `projects.editor_state TEXT` migration — tracks `selects_ready`, `broll_imported`
- `selects` table: `(project_id, script_section, section_index, takes TEXT, selected_takes TEXT, winner_footage_id, gold_nugget, fire_suggestion, davinci_timeline_position)`
- Helper functions: `insertSelect`, `getSelectsByProject`, `deleteSelectsByProject`, `updateProjectEditorState`
- All four functions exported

**Part B — `src/editor/selects.js`** (SelectsΩr engine):
- Accepts `project_id` + `onProgress` callback
- Pulls all talking-head / dialogue footage for the project
- Checks `footage.transcript` (DB) → `footage.transcript_path` (disk) → runs Whisper
- Caches new transcripts back to `footage.transcript` column
- Sends all transcripts + approved script / concept to Claude (`max_tokens: 4096`)
- Claude maps segments → script sections, picks winner takes, flags gold nuggets, adds fire suggestions
- Saves to `selects` table; sets `editor_state = 'selects_ready'`

**Part C — `scripts/davinci/build-selects.py`**:
- Opens existing Resolve project by exact name or `_NNN` suffix scan
- Creates `02_SELECTS` timeline (versioned `_v2`, `_v3` if exists — Resolve has no delete API)
- Clips placed on Track 1 with specific start/end timestamps from selects takes
- Markers: Purple (overview), Blue (section header), Green (winner), Red (gold nugget + 20-frame gap), Orange (fire suggestion / b-roll)

**Part D — `src/editor/broll-bridge.js` + `scripts/davinci/import-broll.py`**:
- `getBrollSuggestions(projectId)` — filters sections whose `fire_suggestion` mentions b-roll keywords; returns sections + all b-roll footage candidates
- `importBroll(projectId, assignments, onProgress)` — resolves file paths, spawns `import-broll.py`
- Python script: finds `02_SELECTS` timeline, reads Blue markers to find section positions, places b-roll clips on Track 2 with Orange markers

**Part E — `src/routes/editor.js`** (new file):
- Same SSE job pattern as `cutor.js` (shared `jobs` Map, `createJob/pushEvent/finishJob/failJob`)
- `POST /api/editor/selects/build/:project_id` — SelectsΩr engine
- `GET /api/editor/selects/status/:job_id` — SSE stream (also used for DaVinci jobs)
- `GET /api/editor/selects/:project_id` — load selects data
- `DELETE /api/editor/selects/:project_id` — clear + reset state
- `POST /api/editor/davinci/build/:project_id` — build `02_SELECTS` in Resolve
- `GET /api/editor/broll/:project_id` — b-roll suggestions + candidates
- `POST /api/editor/broll/import/:project_id` — import b-roll (SSE job)
- `GET /api/editor/broll/status/:job_id` — SSE stream
- Mounted in `server.js` at `/api/editor`

**Part F — `public/editor.html`**:
- Two-panel layout: SelectsΩr (left) + B-Roll Importer (right)
- Project dropdown with `?project_id=` URL param support
- Build Selects button → SSE progress log → section cards rendered
- Section cards: section index, label, takes count, winner badge, gold nugget badge, fire note badge; expandable body shows takes list with winner highlighted + fire note box
- Push to DaVinci button → SSE progress log
- B-roll panel: per-section dropdowns populated from VaultΩr b-roll footage; Import B-Roll button
- Status pills: state, sections count, gold nuggets, fire notes
- Advance banner → ReviewΩr with `?project_id=`

**Part G — Nav update (9 files)**:
- `EditΩr` link added between VaultΩr and ReviewΩr in all pages
- `index.html`: uses `m-tag` teal style to match VaultΩr + ReviewΩr
- All other pages: plain `<a>` matching existing nav style

---

## DB Migrations Applied This Session

```
[DB] Migration: added footage.transcript
[DB] Migration: added projects.editor_state
```
`selects` table created via `CREATE TABLE IF NOT EXISTS` (no migration log line — runs at schema init).

---

## Known Issues / Watch for Next Session

- `broll-bridge.js:importBroll()` reads `db.getDavinciTimelines(projectId)[0]?.resolve_project_name`
  but the `davinci_timelines` table has no such column. The Resolve project name is on
  `projects.davinci_project_name`. Fix: use `project.davinci_project_name` directly.
- `project.fps` used in `broll-bridge.js` — this column doesn't exist in the `projects` table.
  Currently defaults to 24 gracefully. If per-project fps is needed, add the column.
- Server startup banner does not yet list EditΩr.

---

## System State at End of Session

```
src/editor/selects.js               SelectsΩr engine (Whisper + Claude selects)
src/editor/broll-bridge.js          B-roll suggestion + Resolve import bridge
scripts/davinci/build-selects.py    02_SELECTS timeline builder (Blue/Green/Red/Orange markers)
scripts/davinci/import-broll.py     B-roll → Track 2 of 02_SELECTS
src/routes/editor.js                9 API endpoints, SSE job system
src/db.js                           selects table + 4 helpers; footage.transcript +
                                    projects.editor_state migrations + exports
src/vault/transcribe.js             Binary fallback chain; medium model; checkWhisper()
src/routes/cutor.js                 GET /check endpoint
src/vault/cutor.js                  Malformed JSON surfaced in callClaude()
src/routes/generate.js              CutΩr context injection into M2 package prompt
public/editor.html                  Full EditΩr UI (two-panel)
public/reviewr.html                 Dep banner; Re-run button; clipUrl(); project_id threading
public/m2-package-generator.html    CutΩr context panel; EditΩr in nav
All public/*.html (9 files)         EditΩr in nav (VaultΩr → EditΩr → ReviewΩr)
server.js                           /api/editor mounted
```

**Nav order on all pages:**
PipelineΩr · VaultΩr · EditΩr · ReviewΩr · AnalytΩr · OperatΩr · DistributΩr▾
