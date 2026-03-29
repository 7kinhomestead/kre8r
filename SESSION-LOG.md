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
