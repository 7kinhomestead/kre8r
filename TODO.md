# Kre8Ωr — Roadmap to Downloadable App

**The destination:** A creator downloads a `.exe` (Windows) or `.dmg` (Mac), runs an install wizard,
enters their Anthropic API key, and has a fully working Kre8Ωr desktop app. No terminal. No Node.
No PM2. A real app with an icon in the taskbar.

**The route:** Feature polish → Electron wrapper → Bundle dependencies → Setup wizard → Package → Ship.

---

## ⚠️ BEFORE BETA LAUNCH — Desktop-Only Features Need a Gate

Several features only work in the local Electron app. On kre8r.app (the hosted web version),
these features will fail or look broken for beta tenants. Before onboarding real beta creators,
decide: **hide them, disable them, or replace them with web-native equivalents.**

### Features that require local/Electron context:

| Feature | Why it breaks on web | Options |
|---|---|---|
| **PostΩr — YouTube/Meta upload** | Uses absolute local file paths. OAuth was set up against localhost:3000 redirect URIs. | Option A: hide PostΩr entirely on hosted. Option B: web-upload (S3 staging area). Option C: show "Desktop App only" banner. |
| **PostΩr — Pipeline prefill** | Works on web (DB read only), but useless without video upload | Same as above — hide with upload |
| **VaultΩr intake watcher** | Watches `D:\kre8r\intake` — local Windows path, no equivalent on DO | Option A: hide watcher status. Option B: manual upload endpoint (drag-drop to server). |
| **EditΩr — proxy video playback** | `proxy_path` is a local Windows path, won't play in browser over web | Option A: disable video preview. Option B: upload proxy to server. |
| **DaVinci integration** | `scripts/davinci/*.py` only runs on local Windows with Resolve installed | Hide entire DaVinci section (already behind a Resolve detection guard). |
| **Whisper transcription** | Requires local Python + Whisper on PATH | Show "Transcription requires Desktop App" state. |
| **Teleprompter QR codes** | QRs point to `localhost:3000` — useless on web | Generate QR to tenant subdomain instead. |

### Suggested approach (pick one per session):
- **Quick gate:** On non-Electron context, detect via `window.__KRE8R_ELECTRON` flag (already set by
  Electron main.js). Hide or replace with a "🖥️ Desktop App Only" badge on affected UI sections.
- **Medium lift:** Add `IS_ELECTRON` env var on startup. Expose as `/api/capabilities` endpoint.
  Frontend reads it on load and conditionally renders/hides sections.
- **Full web-native:** Replace file-path-dependent flows with cloud upload (multer → temp storage → process).
  Much bigger lift, but unlocks the full pipeline for web beta users.

**Priority:** Gate first (fastest), replace later if web users need those features.
**Note:** Pre-production and distribution tools (Id8Ωr, PipΩr, WritΩr, CaptionΩr, MailΩr, NorthΩr)
all work perfectly on web — only post-production and hardware-adjacent features are affected.

---

## NEXT SESSION — Top Tasks

### 0. MarkΩr + GuardΩr — Copyright Protection + Community Enforcement
**Why now:** Creator is actively publishing to TikTok, YouTube, Instagram. Content protection
and community health are active needs. Spec already in TODO.md (see below). Build plan: 3 sessions.
- **MarkΩr:** Detect if creator's content is being reposted without credit. Monitor platform search
  for known video fingerprints/titles. Alert dashboard.
- **GuardΩr:** Community enforcement for Rock Rich (Kajabi). Flag violating members, automated
  responses, escalation workflow.
See full spec below.

---

### ~~1. Update CLAUDE.md to Reflect Current Build State~~ ✅ DONE Session 46
All modules documented. PostΩr, SeedΩr, ClipsΩr, MirrΩr, NorthΩr, SyncΩr, Electron, Auth all current.

### ~~2. Project Folder Architecture — Pipeline-Wide~~ ✅ DONE (prev session)
PipΩr creates [id]_[slug]/{raw,completed,clips} at project creation. ShootDay shows all 3
copyable paths. VaultΩr watcher depth:5, parseProjectFromPath auto-assigns project_id +
shot_type on ingest. ClipsΩr breadcrumb now shows actual project clips/ path.

### ~~3. PostΩr Batch Mode — Campaign Builder~~ ✅ DONE Sessions 46+47
Campaign tab live. caption_package prefill. Schedule board. Lock Schedule → postor_queue.

### ~~4. Workflow audit stragglers~~ ✅ DONE Session 48
Whisper progress chain, PipΩr structure suggestion, SeedΩr→Id8Ωr dedup, ClipsΩr→PostΩr breadcrumb,
NorthΩr This Week grid, WritΩr+MailΩr voice defaults, caption voice coherence, TeleprΩmpter Solo crash,
GateΩr unified review queue — all shipped.

---

### 5. VaultΩr: Subject/Topic Tagging at Ingest
**Why now:** Vault is growing. Finding the right b-roll for a script requires scrolling through
thumbnails by memory. Tagging creates the search layer.

**What to build:**
- At ingest, after thumbnail generation, call Claude Vision on the thumbnail frame
- Generate `tags: ["outdoor", "chickens", "greenhouse", "solarpanel"]` — 3–8 tags max
- Store as `tags TEXT` (JSON array) on vault_footage
- Add tag search to VaultΩr sidebar: text input → filters footage list in real time
- Optional: tag cloud summary at top of sidebar (top 10 most common tags)
- DB migration: `tags TEXT` column on vault_footage (nullable, safe to add)

**Scope:** 1 session. Backend: watcher.js + vault route. Frontend: VaultΩr sidebar filter.

---

### 6. MirrΩr: Analytics Re-Sync Schedule
**Why now:** YouTube sync runs once on setup. Metrics go stale. Creator needs a "last synced"
indicator and a quick way to re-sync before monthly evaluation or before a campaign decision.

**What to build:**
- Add `last_synced_at TEXT` column to a settings kv store (or use existing `db.getKv/setKv`)
- Store timestamp after each successful sync run
- NorthΩr dashboard: show "YouTube data last synced: 3 days ago" near the MirrΩr stats block
- Add "🔄 Sync Now" button that calls existing `/api/mirrr/sync` endpoint + updates timestamp
- Optional: amber warning if last sync > 7 days old ("Data may be stale")

**Scope:** ~2 hours. Touches NorthΩr frontend + small backend timestamp tracking.

---

### ~~7. TikTok API — Research & Wire~~ ✅ DONE Session 49
Full OAuth 2.0 + PKCE + FILE_UPLOAD posting built. Compliance UI (privacy, duet/comment/stitch,
commercial disclosure) live in PostΩr. App submitted for TikTok review April 19 2026.
**Status: In Review — expected approval 5-10 business days.**
Once approved, posting works with no code changes needed.

---

## Project Folder Architecture — Pipeline-Wide Alignment

### The Problem
VaultΩr watches a flat folder. Footage has no project context on disk. Every DaVinci export path
requires manual browsing. Clips land anonymously — Campaign Builder has no way to know which
project they belong to without manual association.

### The Solution — One Folder Per Project, Created at Project Birth

**Folder structure (created by PipΩr at project creation):**
```
D:\kre8r\intake\
  42_solar-water-heater\        ← [id]_[slugified-title] — human readable + machine parseable
    raw\                        ← BRAW files copied from camera SSD (H:\)
      proxy\                    ← DaVinci auto-creates + populates this (do not create manually)
        shot_001_proxy.mp4
    completed\                  ← DaVinci final render destination
    clips\                      ← DaVinci social clip export destination → Campaign Builder source
```

**Naming convention:** `[project_id]_[slug]` e.g. `42_solar-water-heater`
VaultΩr splits on first `_` to extract project ID. Slug is for human navigation in Explorer.

### One-Time DaVinci Config (Jason does this manually, once)
In DaVinci Resolve: Preferences → Proxy Media (or Proxy Generator settings)
- Change watch folder from `D:\1 .braw watch folder` → `D:\kre8r\intake`
- DaVinci watches 5 levels deep — all project `raw/` subfolders are within range
- DaVinci auto-creates `raw/proxy/` and generates proxies there unattended
- Never needs to be changed again — every new project folder is automatically in the watch zone

### Pipeline Touchpoints — What Gets Built

#### PipΩr (project creation route — `src/routes/pipr.js`)
- On `POST /api/projects` (project creation): generate slug from project title
- `fs.mkdirSync(path.join(INTAKE_PATH, `${project.id}_${slug}`), { recursive: true })`
- Create subfolders: `raw/`, `completed/`, `clips/` (do NOT create `raw/proxy/` — DaVinci owns that)
- Store `folder_path` on the project record: new column `projects.folder_path TEXT`
- If intake path doesn't exist (DO server, non-Electron): skip silently, log warning

#### ShootDay (`public/shootday.html`)
- New section: **"📁 Project Folder Paths"** — shown after project select
- Three rows, each with a path + 📋 copy-to-clipboard button:
  - **BRAW destination:** `[folder_path]\raw\` — "Copy cards here after shoot"
  - **Render destination:** `[folder_path]\completed\` — "Paste into DaVinci render output"
  - **Clips destination:** `[folder_path]\clips\` — "Paste into DaVinci clip export"
- Clear instruction: "Paste these into DaVinci export dialogs — no browsing required"
- Fetch paths from `GET /api/projects/:id` (folder_path already on the record)

#### VaultΩr Watcher (`src/vault/watcher.js`)
- Change chokidar to watch recursively: `chokidar.watch(INTAKE_PATH, { depth: 5 })`
- On new file detected: parse path to determine context
  - File in `[id]_[slug]/raw/proxy/` → proxy file → find or create BRAW record, link proxy, set project_id
  - File in `[id]_[slug]/completed/` → completed-video → auto-set shot_type, set project_id
  - File in `[id]_[slug]/clips/` → social-clip → auto-set shot_type, set project_id
  - File directly in `intake/` (flat, legacy) → existing behavior unchanged
- Helper: `parseProjectFromPath(filePath)` → returns `{ projectId, subfolder }` or null

#### Campaign Builder (PostΩr)
- "Unpackaged clips" source: `vault_footage WHERE project_id = ? AND shot_type = 'social-clip' AND id NOT IN (SELECT footage_id FROM postor_queue)`
- No manual association needed — folder path tells VaultΩr everything at ingest

### DB Changes
- `projects` table: add `folder_path TEXT` — full absolute path to the project folder
- No changes to `vault_footage` — `project_id` column already exists (confirm) or add it

### Backward Compatibility
- Existing footage records with no project_id: unaffected, continue to show in VaultΩr normally
- Flat intake files (no subfolder): existing watcher behavior preserved as fallback
- Projects created before this feature: no folder_path, ShootDay shows "No folder — project predates folder support" with option to create folder manually

### Build Plan (1 session)
1. DB migration: `folder_path` on projects
2. PipΩr route: slug generation + `fs.mkdirSync` on project create
3. ShootDay: fetch + display 3 paths with copy buttons
4. VaultΩr watcher: recursive + `parseProjectFromPath` helper + auto project_id + shot_type
5. Verify: create test project → confirm folders appear → drop a file → confirm VaultΩr associates it

---

## PostΩr Batch Mode — Campaign Builder

### The Problem
The current flow (CaptionΩr → "Send to PostΩr" → new tab → pick video → schedule) works for one clip.
For a week of content it's a chore. Six clips = six separate trips through the same loop.

### The Insight
The queue processor (60s interval) IS already the local clock. Platforms don't need to schedule — Kre8r does.
What's missing: a way to feed the queue in bulk and a scheduling board to assign clips to time slots.

### The Workflow
```
DaVinci exports clips → [project_folder]/clips/ → VaultΩr picks up, auto-associates with project
    ↓
PostΩr "Campaign" tab: "Unpackaged clips" list — shot_type='social-clip', no postor_queue entry
    ↓
Creator selects clips → "Generate Captions for All" → CaptionΩr runs in batch (one Claude call per clip)
    ↓
Scheduling board: week grid (Mon–Sun × time slots). Drag clips into slots. Assign platforms per slot.
    ↓
"Lock Schedule" → all slots drop into postor_queue with correct scheduled_at timestamps
    ↓
Queue processor fires on Kre8r's clock. Platform scheduling irrelevant.
```

### Entry Points (two paths, same destination)
1. **VaultΩr path (primary):** "Unpackaged clips" = vault_footage records with no postor_queue entry.
   Filter by date range (default: last 7 days). Select all or pick individually.
2. **Drag-drop path (fast lane):** Drag a folder of .mp4 files directly into the Campaign tab.
   Kre8r ingests them on the spot (creates vault_footage records if they don't exist) + runs captions.
   Useful for clips that bypassed the normal VaultΩr intake.

### Scheduling Board UI
- **Week grid:** 7 columns (days) × time slot rows (configurable: e.g. 7am, 12pm, 5pm, 8pm)
- **Clip cards:** thumbnail + duration + AI-generated title. Drag from sidebar → drop into slot.
- **Platform badges:** per slot, toggle which platforms this clip goes to (IG, FB, YT, TikTok)
- **Caption preview:** hover/click a slot → see the platform-specific captions (editable inline)
- **Lock Schedule button:** validates all slots have video + at least one platform → batch-insert to postor_queue
- **Conflicts:** if a slot already has a queued post, show warning before overwriting

### Batch Caption Generation
- One Claude call per clip (same CaptionΩr prompts, just automated in a loop)
- SSE progress stream: "Generating captions for clip 3 of 7…"
- Results stored: either a new `caption_packages` table or as JSON on the vault_footage record
- Editable after generation — creator can tweak before locking schedule

### DB Changes
- New column on `vault_footage`: `caption_package TEXT` (JSON: { tiktok, instagram, facebook, youtube, lemon8 })
  OR a separate `caption_packages` table if we want versioning
- `postor_queue` already has all needed columns — no changes required

### Build Plan (1–2 sessions)
**Session A:**
- "Campaign" tab in postor.html (alongside existing single-post UI — not replacing it)
- "Unpackaged clips" list from VaultΩr
- Batch caption generation with SSE progress
- Caption review/edit UI per clip

**Session B:**
- Scheduling board (week grid, drag-drop with sortable.js or similar)
- Platform badges per slot
- "Lock Schedule" → batch postor_queue insert
- Drag-drop folder intake (fast-lane path)

### Design Principle
Single-post mode stays exactly as-is for one-offs. Campaign mode is additive — the tab next to it.
Creator never loses access to the quick flow. Batch is opt-in, not a replacement.

---

## ✅ PHASES 2, 3 & 5 — Electron + Bundling + Packaging — DONE Session 32–33

Desktop app boots on Jason's laptop. Login screen, server starts, DB initialises.
Setup wizard on first run (no more hardcoded credentials). Installer: `npm run dist:win` → `dist/Kre8Ωr Setup 1.0.0.exe`

**Key fixes locked in (Session 33):**
- `npmRebuild: false` + `scripts/prebuild-sqlite.js` — correct Electron 41 ABI (NMV 145) every build
- server.js loads from inside asar via `app.getAppPath()` — all require() calls resolve correctly
- Diagnostic error dialog on startup failure — no more silent white screen
- `!node_modules` removed from files — was silently stripping all dependencies
- First-run setup wizard: getUserCount() === 0 → redirect to /setup, create owner account

**Remaining before wider distribution:**
- [ ] Remove Anthropic API key field from `public/setup.html` — operator pays API fees, users don't enter their own key
- [x] App size: 238MB — Playwright moved to devDependencies Session 40. Estimated savings ~100MB.
- [ ] Mac build: untested (needs Mac machine or CI)
- [ ] Code signing: self-signed for now, SmartScreen warning on Windows install is expected

---

## ✅ PostΩr — DONE Sessions 38 + 44 + 45

YouTube, Facebook, Instagram posting all live. Scheduler live. MailΩr FB social post live. CaptionΩr→PostΩr handoff live.
YouTube Analytics sync: 313 videos, 2504 metrics into MirrΩr.

**Still needed:**
- [ ] **YouTube ad revenue** — blocked by Google (Content Owner tier required, not standard YPP). Manual entry in NorthΩr from YouTube Studio CSV.
- [x] **Facebook video posting** — ✅ working (7 Kin Homestead page connected, page selector built)
- [x] **Facebook text/image post** — ✅ working (from MailΩr → publishFacebookPost, ngrok tunnel for images)
- [x] **Instagram Reels** — ✅ LIVE (Session 44). SAR-2 Kre8r-IG app, new Instagram API, ngrok video tunnel, @7.kin.jason confirmed posting
- [x] **PostΩr Scheduler** — ✅ LIVE (Session 45). Queue table, 60s processor, week/day calendar, Post Now/Schedule toggle
- [x] **CaptionΩr → PostΩr handoff** — ✅ LIVE (Session 45). One-click "Send to PostΩr", localStorage prefill, zero copy/paste
- [x] **MailΩr → Facebook post** — ✅ LIVE (Session 45). Gen checkbox, editable caption, Post Now/Schedule
- [ ] **TikTok** — waiting on TikTok Content Posting API access
- [ ] **Analytics re-sync schedule** — add a "last synced" timestamp and prompt to re-sync weekly
- [ ] **Archive stalled projects** — open each in PipΩr → 📦 Archive (2 projects in pre-production queue)

---

## MarkΩr + GuardΩr — Copyright Protection + Community Enforcement

> "The distribution of the defense should match the distribution of the attack."
> Thieves are everywhere. So is the audience.

### The Problem
Stolen videos get posted by accounts that block the creator. The creator never sees them.
The audience does. They want to help but have no tool and no permission structure.
The creator has no affordable, automated enforcement path. DMCA is manual, per-platform, tedious.

### The Solution — Two Linked Products

**MarkΩr** (inside Kre8r, creator-facing):
Every video that exits through PostΩr gets an invisible forensic watermark embedded automatically.
The creator never thinks about it. The watermark encodes creator ID + video ID + date + channel.
Designed so that a simple color inversion reveals a structured visible pattern — the "GSR test."
All vault footage gets perceptual-hashed and audio-fingerprinted as a parallel detection layer.
Incoming fan reports land in a Kre8r inbox. One click → Claude drafts the DMCA notice.

**GuardΩr** (public-facing, fan-facing):
A standalone page at a creator-controlled URL (e.g. `guard.7kinhomestead.com`).
Any fan can submit a URL or screenshot of a suspicious video.
The system checks it against the creator's fingerprint library.
If it matches: "You caught one. This has been reported to the team."
A community counter shows total violations caught. Fans have agency. Theft becomes a shared story.

### Why This Matters Beyond Copyright
The parasocial relationship has a structural imbalance — creators give everything, most fans
never pay. This creates a non-monetary value exchange:
- Fan contributes real, tangible value (catching a thief)
- No money changes hands — the relationship deepens without being commercialized
- "I protect this creator" is an identity, not a transaction
- The adversarial shared story ("we caught one") is stronger community glue than merch ever will be

---

### Architecture

#### Detection Layers (strongest to most fragile against attacks)

| Layer | Method | Survives screen recording | Survives re-encoding | Survives heavy compression |
|---|---|---|---|---|
| 1 | Perceptual hash (visual) | ✅ | ✅ | ⚠️ partial |
| 2 | Audio fingerprint | ✅ | ✅ | ✅ |
| 3 | Invisible spatial watermark | ✅ | ✅ | ⚠️ partial |
| 4 | "Invert to reveal" visual proof | ✅ | ✅ | ⚠️ if strong enough |

Multiple layers = multiple shots at detection. A video that defeats one layer rarely defeats all three.

#### Database Tables (all added via migration in db.js)

```sql
-- Watermark registry — one row per watermarked export
CREATE TABLE watermarks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_id       INTEGER,        -- FK to vault_footage (nullable for non-vault uploads)
  video_path       TEXT NOT NULL,  -- original source path
  watermarked_path TEXT,           -- output path with watermark embedded
  seed             TEXT NOT NULL,  -- unique random seed for this embed
  watermark_code   TEXT NOT NULL,  -- encoded payload: creatorId+videoId+date+channel
  channel          TEXT,           -- 'instagram' | 'facebook' | 'youtube' | 'original'
  embedded_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Visual fingerprints — keyframes sampled from each vault video
CREATE TABLE video_fingerprints (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_id       INTEGER,
  video_path       TEXT NOT NULL,
  frame_index      INTEGER,        -- which frame (e.g. every 5s)
  frame_time_s     REAL,
  phash            TEXT NOT NULL,  -- 64-bit perceptual hash hex string
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audio fingerprints — chromaprint/dejavu style per video
CREATE TABLE audio_fingerprints (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  footage_id       INTEGER,
  video_path       TEXT NOT NULL,
  fingerprint_data TEXT NOT NULL,  -- JSON array of hash offsets
  duration_s       REAL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fan reports — incoming from GuardΩr public site
CREATE TABLE guard_reports (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  submitted_url        TEXT,
  submitted_file_path  TEXT,       -- if they uploaded a screenshot/clip
  submitter_note       TEXT,
  platform             TEXT,       -- 'tiktok' | 'instagram' | 'facebook' | 'youtube' | 'other'
  match_type           TEXT,       -- 'watermark' | 'phash' | 'audio' | 'multi' | 'none'
  match_confidence     REAL,       -- 0–100
  matched_footage_id   INTEGER,
  matched_video_title  TEXT,
  evidence_json        TEXT,       -- full evidence package: matched frames, hashes, watermark decode
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|dismissed|filed|resolved
  claim_platform       TEXT,       -- which platform the DMCA was filed against
  claim_reference      TEXT,       -- platform's claim ID or confirmation number
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Watermark Embedding — How It Works

The embed runs as an FFmpeg operation triggered by PostΩr before any upload.

**The pattern:**
- A unique seed is generated per video export (stored in `watermarks` table)
- The seed drives a pseudo-random selection of pixel positions across keyframes
- Each selected pixel's luma value is bumped by ±1 in a structured pattern
- The pattern encodes the watermark code in a spread-spectrum layout

**The "invert to reveal" mechanism:**
- Normal view: pixel value 128 → watermarked: 129 (invisible — within just-noticeable-difference)
- Inverted view: 255-129=126 vs 255-128=127 → the watermarked pixel is now systematically different
- Thousands of pixels following the same seed pattern → a structured shape emerges when inverted
- That structure is the visual proof of origin — analogous to GSR on the hands

**What it survives:**
Screen recording, normal re-encoding (H.264/H.265 at quality ≥ CRF 23), basic color filters,
speed changes, flipping, clipping/trimming (any surviving frame carries the pattern).

**What defeats it:**
AI-powered watermark removal (Topaz, etc.) — but these tools leave their own artifacts,
which become a secondary evidence layer. Perfect removal is a different crime than the original theft.

#### Detection Flow (when a fan submits to GuardΩr)

```
Submission → (URL or file)
    ↓
Extract frames (FFmpeg, every 2s) + extract audio
    ↓
Run perceptual hash on each frame → compare against video_fingerprints table
    ↓
Run audio fingerprint → compare against audio_fingerprints table
    ↓
Run watermark extraction on best-match frames → decode seed → look up in watermarks table
    ↓
Aggregate confidence score (weighted: phash 40%, audio 40%, watermark 20%)
    ↓
If confidence ≥ 70%: confirmed match → insert guard_reports row → show fan result
If confidence 40–69%: possible match → ask fan for more info
If confidence < 40%: no match found
```

#### GuardΩr Public Site — UI Flow

```
Landing:  Creator photo + tagline. "Found a stolen video? Report it here."
          Community counter: "Community has flagged [N] violations"

Submit:   Paste a URL  OR  Upload a screenshot / short clip
          Optional note: "where did you find this?"

Checking: Animated "investigating…" state (2–5s depending on method)

Results:
  MATCH   → "🚨 You caught one. This video matches [title], originally posted [date].
              Your report has been sent to Jason's team."
              [Show side-by-side: original thumbnail vs submitted content]
              [Inversion tool: "Click to see the hidden watermark"]
              [Counter bumps: "You've helped protect Jason 3 times"]

  PARTIAL → "🔍 This looks familiar. Can you tell us more?"
              [Form for extra context]

  CLEAN   → "✅ We don't see a match. This might be licensed or original content."
```

**The browser-based inversion tool:**
Client-side only (Canvas API). No server call needed. Fan uploads frame, clicks "Invert."
The watermark pattern appears. This is the moment — the GSR on the hands.
Shareable: "Look what shows up when you invert this stolen video frame."
That screenshot of the inverted pattern becomes organic content about the theft,
which is simultaneously evidence AND audience engagement.

#### Claims Engine — DMCA Automation

When a report is confirmed, Jason opens it in his Kre8r GuardΩr inbox and sees:
- The submitted URL/screenshot
- The matched original video with timestamp
- Confidence score + which detection layer triggered
- Decoded watermark (if applicable)

One click → Claude generates a complete DMCA notice pre-populated with:
- Original work identification + ownership assertion
- URL to the infringing copy
- Watermark evidence summary (confidence score, detection method)
- Good-faith statement
- Accuracy statement under penalty of perjury
- Signature block

**Platform-specific formats stored as Claude prompt templates:**
- YouTube: references youtube.com/copyright_complaint_form fields
- Meta (Instagram/Facebook): references Rights Manager
- TikTok: references tiktok.com/legal/report/copyright
- Generic: DMCA letter for email/legal use

**NorthΩr integration:**
New stat block: "Copyright Health"
- Reports received this month: N
- Confirmed violations: N
- Claims filed: N
- Claims resolved: N

---

### Build Plan — 3 Sessions

#### MarkΩr Session A — Fingerprint Infrastructure
*Goal: Every vault video is fingerprinted. Every PostΩr export gets watermarked. Detection endpoint exists.*

- DB migrations: `watermarks`, `video_fingerprints`, `audio_fingerprints`, `guard_reports` tables
- `src/markr/` directory (new module, same pattern as postor/)
  - `fingerprint.js` — FFmpeg-based pHash extraction per video (keyframes every 5s)
  - `watermark.js` — FFmpeg-based embed + the inversion-visible pattern
  - `detect.js` — comparison engine: accepts a file/URL, returns match result
- `src/routes/markr.js` — API routes
  - `POST /api/markr/fingerprint-vault` — batch job, fingerprints all vault footage
  - `POST /api/markr/check` — the detection endpoint (used by GuardΩr)
  - `GET /api/markr/watermarks` — view watermark registry
- Hook into PostΩr: watermark embeds automatically before any upload
- Python subprocess for audio fingerprinting (chromaprint via `fpcalc` binary — small, no GPU)

#### GuardΩr Session B — Public Fan Site
*Goal: Fans can submit URLs and screenshots. Confirmed matches flow into Kre8r inbox.*

- Public route `/guard` (no auth required) — reads creator-profile.json for branding
- GuardΩr landing page (`public/guardr.html`) — URL input + file upload
- Client-side inversion tool (Canvas API, zero server calls for the visual proof)
- Community counter pulled from `guard_reports` table
- "You caught one" confirmation state with side-by-side visual
- Creator-configurable: URL slug, brand colors, creator photo — all from creator-profile.json
- GuardΩr inbox module in Kre8r (`public/guardr-inbox.html`)
  - Incoming reports list with confidence scores
  - Evidence view per report
  - Confirm / Dismiss / File actions

#### ClaimsΩr Session C — DMCA Automation + NorthΩr Integration
*Goal: One-click from confirmed report to drafted DMCA notice.*

- Claude generates DMCA notices from evidence package (platform-specific templates)
- Filed claims tracked in `guard_reports.status` + `claim_reference`
- Email the notice to platform DMCA agent directly from Kre8r (via MailerLite or raw SMTP)
- NorthΩr: "Copyright Health" stats block
- Optional: automatic weekly scan of known offender account URLs (if fan has previously reported them)

---

### Open Questions Before Building

1. **Watermark strength vs invisibility tradeoff** — needs tuning against Jason's actual footage.
   A 4K HDR video tolerates more embedding than a compressed 1080p. Test before locking algo.

2. **Audio fingerprinting dependency** — `fpcalc` (Chromaprint binary) needs to be bundled in
   the Electron app the same way FFmpeg is. Confirm binary availability before Session A.

3. **GuardΩr URL** — `guard.7kinhomestead.com` (creator-branded, recommended) or
   `guard.kre8r.app?creator=7kinhomestead` (platform-branded, multi-creator ready)?
   Jason's call. The code supports both.

4. **Fan identity** — No account required for submissions (zero friction = more submissions).
   Return visitor gets a cookie: "You've helped X times." No leaderboard (competitive dynamics
   would attract trolls submitting false reports to game the count).

5. **False positive rate** — perceptual hashing will occasionally flag similar-looking content
   from other creators. The confidence threshold (70% default) + human review step in the inbox
   prevents automated misfires. Claude never auto-files — Jason approves every claim.

---



Full email pipeline end-to-end. Session 39 closed the loop:
- MailΩr premiere email: dropdown fixed, generate + send working, 10-min schedule delay for ML review
- Broadcast send: ML v2 API wired correctly (from field, schedule endpoint, all-subscribers mode)
- Welcome emails: ML automations handle sending (3 tiers configured by Jason in ML dashboard)
- No double emails: removed transactional send from webhook receiver — ML automation is sole sender
- Morning bulk sync: runs on DO at 12:00 UTC (8 AM Eastern) — catches anyone webhook missed
- NorthΩr: email performance section (last 5 campaigns, open/click rates, color-coded)
- NorthΩr: publishing calendar wired to real publish dates
- NorthΩr: Days Since Last Email pulls from ML sent campaign date
- Test Fire: in-page preview modal (window.open blocked in Electron)
- MailerLite on $50/mo plan. Sender config in .env (immune to Electron profile overwrites)
- Deployed to DO ✅

**Still needed:**
- [ ] Cancel Kajabi API subscription ($25/mo — no broadcast endpoint, not worth keeping)
- [ ] Investigate why Kajabi webhook isn't firing new members to DO in real-time (60 members joined, none appeared in ML via webhook)

## ✅ Cross-Device Sync — DONE Session 35

SyncΩr fully operational. Desktop pushes to kre8r.app, laptop pulls and imports.

- `src/routes/local-sync.js` — local proxy (config, push, pull, import)
- `public/sync.html` — full sync UI with snapshot viewer
- `src/db.js` — createProjectFromSnapshot (non-destructive, ID-preserving)
- `/api/sync/token` — operator token recovery endpoint
- Desktop → kre8r.app → Laptop confirmed working end-to-end ✅

**Still needed:**
- [ ] Build new laptop installer when new features are added (`npm run dist:win`)
- [ ] Project export between machines (full project package with footage refs) — listed for future

---

## ✅ V1 MUST-HAVE — Idea Vault (SeedΩr) — DONE Session 33

Built as standalone `seedr.html`. Full spec delivered:
- `ideas` table in SQLite: id, title, concept, angle, notes, status, created_at
- List view with keyword/angle/date search
- Bulk entry mode (paste 23 ideas → AI parses and logs them all)
- "Promote to Project" button → pre-fills PipΩr with idea context
- Ideas persist forever, never tied to a session

**V1.1 — ConstellΩr view** — ALSO DONE Session 33
- 3D constellation graph (Three.js) in SeedΩr, toggle between list and constellation view
- Claude generates connection graph on vault load — semantic clusters, edges between related ideas
- Node size = idea strength/development stage; edge thickness = connection strength
- Click node → idea detail panel slides in with Promote to Project
- Color coded by content angle

---

## PHASE 1 — Feature & Polish (before packaging anything)
*Get the app right before wrapping it. ~3-4 sessions.*

---

### ✅ P1-A — ReviewΩr Refocus (rough cut only) — DONE Session 27

Strip CutΩr analysis out of ReviewΩr entirely. One job: does this rough cut work as a long-form video?

**What gets removed from reviewr.html:**
- "Run CutΩr" button and all CutΩr result sections (social clips, retention cuts, CTA, off-script gold)
- All `/api/cutor/` fetch calls
- ClipsΩr advance banner (already correctly placed after ComposΩr)

**What stays:**
- Project select
- Selects list (approve / skip / reorder)
- Extract approved clips button (ffmpeg stream copy)
- ComposΩr advance banner
- PackageΩr bypass banner

**DB:** `cuts` table and `/api/cutor/` routes stay — ClipsΩr uses them. UI only.
**Doc:** `09-reviewr.html` already updated to reflect the decision. No doc changes needed after build.

---

### ✅ P1-B — Short-Form Pipeline Mode — DONE Session 27

Add `content_type` ('long' | 'short') as a first-class flag that flows through the entire pipeline.

**DB:** `projects` table — add `content_type TEXT DEFAULT 'long'`

**Id8Ωr:** Detect short-form intent in conversation OR ask explicitly at session start.
When short: research prompt shifts to scroll-stopping angles, hook formats, viral patterns.
Vision Brief adapts: hook = opening 3 seconds, title = caption hook.

**PipΩr:** Add SHORT FORM tile. Sub-structures:
- Hook → Tension → Payoff
- Open Loop
- PAS (Problem / Agitate / Solve)
- Before → Bridge → After
- 5-Point List
- Hot Take
- Tutorial
Beat map: 3–7 beats max, each with second-range duration target (e.g. "Hook: 0–3s").

**WritΩr:** When short — 150–300 words max, hook beat = one punchy sentence, timing shown per card.

**EditΩr:** Add SHORTS shoot mode — single best take per beat, no multi-take comparison.

**ClipsΩr:** When short — video IS the clip. Role flips to validator:
checks hook timing, retention arc, CTA presence, loop-ability. Outputs validation report + captions.

---

### ✅ P1-C — ClipsΩr Inline Editing — DONE Session 27

Click-to-edit on hook text, why_it_works, caption, and hashtags fields on each clip card.
Auto-save on blur → `PATCH /api/mirrr/viral-clips/:id`
Visual cue: light border + cursor change on click, reverts to display on save.

---

### ✅ P1-D — MirrΩr First Real Evaluation Run — DONE Session 27

The compounding intelligence loop activates here.
1. Run YouTube sync → confirm video performance data in DB
2. NorthΩr → Evaluate Last Month → confirm evaluation card renders with score + weight badges
3. Id8Ωr → run a concept → confirm mirrrBlock appears in server logs
4. WritΩr → generate script → confirm MIRRΩR CALIBRATION section in prompt context

---

### ✅ P1-E — Cosmetic Polish Pass — DONE Session 27

Before packaging, one focused pass on rough edges:
- Any "Rockridge" / stale creator name artifacts still in generated content prompts
- Empty states that don't explain what to do next
- Error messages that say nothing useful
- Mobile responsiveness on key pages (TeleprΩmpter, ShootDay)
- CLAUDE.md: update tech stack — still says sql.js, migration to better-sqlite3 is done

---

### ⚡ P1-F — Deploy Sessions 26+27 to DigitalOcean — CODE PUSHED, RUN VIA DO CONSOLE

```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

---

### ✅ P1-G — Auth System + TeleprΩmpter Subdomain — Session 28

See Phase 1-G below for implementation details (built this session).

---

## PHASE 1-G — Auth + Field TeleprΩmpter (Session 28)

### Auth — kre8r.app login system
Full session-based login replacing nginx basic auth.
- `users` table: id, username, password_hash (bcrypt), role ('owner' | 'viewer'), created_at
- `sessions` table via express-session + better-sqlite3 session store
- `/login` page (dark theme, matches app) — POST → sets session cookie
- Auth middleware on all routes except /login and /health
- Owner role: full access. Viewer role: read-only, no destructive actions.
- First run: seeds default owner (jason / set via env var KRE8R_OWNER_PW)
- Remove nginx basic auth (htpasswd) once Express auth is confirmed working

### teleprompter.kre8r.app subdomain
Dedicated subdomain for field teleprompter use. Same DigitalOcean droplet.
- DNS: A record `teleprompter.kre8r.app` → same IP as kre8r.app
- Nginx: new server block for teleprompter.kre8r.app → proxy port 3000
- SSL: certbot --expand to add teleprompter.kre8r.app to existing cert
- Express: detect Host header, serve teleprompter.html with no main-app auth wall
- Auth model: session code IS the auth — 4-digit code required to join any session
  so hitting the URL blind does nothing useful
- Script fetch: teleprompter calls existing /api/projects/:id/script endpoint
  (no separate API needed — same server)

**Field workflow:**
1. Jason selects project in kre8r.app desktop before leaving
2. Display device (laptop) opens teleprompter.kre8r.app, loads project, generates session QR codes
3. Phone 1 (hotspot): scans QR → control mode. Phone 1 data provides internet to all devices.
4. Phone 2 (voice): scans QR → voice mode
5. All three reach teleprompter.kre8r.app through Phone 1's hotspot data. Zero office wifi needed.

---

### 📱 Android APK — Beta User Onboarding + Zero-Signal Fallback

**When to build:** After beta users are onboarded. Dedicated session.

**Primary use case:** Zero mobile signal locations (no data on hotspot phone).
For normal field use, teleprompter.kre8r.app through Phone 1's hotspot data handles it.

**Architecture (Phone 1 = server in the field):**
- Phase 1 (office, on same wifi as desktop): Scan QR from Kre8r → app fetches script, stores locally
- Phase 2 (field, no signal): App starts NanoHTTPD server + Java-WebSocket on Phone 1
- Laptop: scans QR from app → browser opens `http://[phone1-hotspot-ip]:PORT/` → display mode
- Phone 2: scans QR → browser → voice mode
- Phone 1 app: control interface + WebSocket hub. Zero internet needed.

**Libraries:** NanoHTTPD (HTTP server in Android), Java-WebSocket, ZXing (QR scanner)
**Size estimate:** ~400-500 lines Kotlin + bundled teleprompter.html assets
**Distribution:** Sideload APK (Settings → Unknown sources). NOT Play Store.

**Beta user onboarding flow:**
- Upon first login to kre8r.app: modal/banner — "Download the Field TeleprΩmpter app"
- QR code to download the APK directly from kre8r.app/downloads/kre8r-teleprompter.apk
- Small written tutorial (3 steps): Enable unknown sources → scan QR → install
- Tutorial lives at kre8r.app/teleprompter-setup (simple HTML page, printable)
- Also shown in ShootDay checklist ("Field kit ready?")

---

## PHASE 4 — First-Run Setup Wizard ← NEXT
*Wrap the existing app in a real desktop window. ~1-2 sessions.*

The Express server runs inside Electron's main process.
The HTML frontend runs in an Electron BrowserWindow.
No terminal visible. Real app icon. Works like a native app.

**Steps:**
1. `npm install --save-dev electron electron-builder`
2. Create `electron/main.js`:
   - Start Express server programmatically (import server.js, don't spawn)
   - Open BrowserWindow pointing to `http://localhost:3000`
   - Handle app lifecycle: quit on window close, system tray option
   - Splash screen while server starts
3. Add `"main": "electron/main.js"` to package.json
4. Add npm scripts: `"electron:dev"`, `"electron:build"`
5. Test: `npm run electron:dev` — should open app window, no terminal

**App identity:**
- Name: Kre8Ωr
- Icon: `build/icon.ico` (Windows), `build/icon.icns` (Mac), `build/icon.png` (Linux)
- Window: 1280×800 minimum, resizable, no default Electron menu bar

---

## PHASE 3 — Bundle Dependencies
*Make the app self-contained — user installs nothing else. ~2-3 sessions.*

| Dependency | Solution | Notes |
|------------|----------|-------|
| Node.js runtime | Electron bundles automatically | Nothing to do |
| better-sqlite3 | `electron-rebuild` after install | Needs native recompile for Electron's Node version |
| ffmpeg + ffprobe | `ffmpeg-static` npm package | Prebuilt binaries, cross-platform |
| Python + Whisper | Optional in v1 — see below | Hardest dependency |
| Anthropic API | HTTPS call | Nothing to bundle |

**better-sqlite3:**
```bash
npm install --save-dev electron-rebuild
./node_modules/.bin/electron-rebuild -f -w better-sqlite3
```
Add to package.json scripts: `"postinstall": "electron-rebuild -f -w better-sqlite3"`

**ffmpeg:**
```bash
npm install ffmpeg-static ffprobe-static
```
Replace hardcoded `ffmpeg`/`ffprobe` path calls with:
```js
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
```

**Python/Whisper — v1 strategy (make optional):**
- App detects Python/Whisper on PATH at startup
- If not found: transcription features show "Transcription requires Python + Whisper" with setup link
- VaultΩr, WritΩr, ClipsΩr, MailΩr all work without it
- v1.1: auto-download portable Python + Whisper on first transcription attempt

**File paths — must be dynamic in packaged app:**
All hardcoded paths (database location, intake folder, etc.) must use Electron's `app.getPath()`:
- Database: `app.getPath('userData')/kre8r.db`
- Intake folder: configurable, defaults to `app.getPath('home')/kre8r/intake`
- Public/clips: inside app resources or userData

---

## PHASE 4 — First-Run Setup Wizard
*New users get configured automatically on first launch. ~1-2 sessions.*

On first launch: if no config exists → show setup screen before app loads.

**Step 1 — API Key (required)**
- Input: Anthropic API key
- Validate: test call to Claude API, confirm it works
- Won't proceed without a valid key
- Stored in: OS keychain via `keytar` npm package (never plaintext)

**Step 2 — Intake Folder**
- Default: `~/kre8r/intake` (created automatically if missing)
- Creator can change to any folder (e.g. DaVinci proxy output folder)
- VaultΩr watcher starts here

**Step 3 — Optional Integrations**
- Kajabi: OAuth2 connect button (opens browser for auth flow)
- Suno API key (optional — Prompt Mode works without it)
- Both skippable — can configure later in app settings

**Step 4 — DaVinci (Windows only, shown only if Resolve detected)**
- Confirm Python path for scripting API
- Test connection to port 9237

**Config stored:** `app.getPath('userData')/config.json`
Subsequent launches: skip wizard entirely, load app directly.
Settings page in-app lets creator update any config value later.

---

## PHASE 5 — Packaging + Installer
*Build the actual .exe / .dmg installer files. ~1-2 sessions.*

**electron-builder config (`electron-builder.yml`):**
```yaml
appId: com.kre8r.app
productName: Kre8Ωr
directories:
  output: dist
win:
  target: nsis
  icon: build/icon.ico
nsis:
  installerIcon: build/icon.ico
  installerHeaderIcon: build/icon.ico
  createDesktopShortcut: true
  createStartMenuShortcut: true
mac:
  target: dmg
  icon: build/icon.icns
files:
  - "**/*"
  - "!tool-purpose-docs/**"
  - "!.git/**"
```

**Build commands:**
```bash
npm run electron:build        # builds for current platform
npm run electron:build:win    # Windows .exe from any platform (via Wine or CI)
npm run electron:build:mac    # Mac .dmg
```

**Code signing:**
- Windows: Authenticode certificate — prevents SmartScreen "Unknown publisher" warning (~$300/yr or use self-signed for beta)
- Mac: Apple Developer account required for Gatekeeper approval ($99/yr)
- For beta: unsigned is fine, users right-click → Open to bypass warning

**Distribution:**
- GitHub Releases: upload `.exe` and `.dmg` to a release tag
- Link from website: `https://github.com/7kinhomestead/kre8r/releases/latest`
- Auto-update: `electron-updater` checks GitHub releases on launch, prompts to update

---

## PHASE 6 — Beta Testing
*Put it in real hands before public release. ~2-3 sessions.*

- Install on a second machine (not the dev machine) — confirm cold install works
- Developer friend (the one who is already using kre8r.app) — ideal first beta tester
- 5–10 creators from the community — free beta access in exchange for feedback
- Document every setup friction point → fix before public release
- Confirm: API key entry, VaultΩr watcher, DaVinci integration, first video pipeline end-to-end

---

## Email Marketing — Distribution Pipeline Decision

**The problem:** Kajabi's API has no broadcast send endpoint. MailΩr generates email copy but final
send requires manual copy/paste. This is the last un-automated step in the distribution pipeline.

**Research completed Session 28.**

### Option A — Wait on Kajabi (free, best outcome)
Kajabi is known to be building out their email API surface. If they ship a broadcast endpoint,
the problem solves itself at zero extra cost. **Action: ask Kajabi support if broadcast API
is on the roadmap and rough timeframe.**

### Option B — Mailerlite (~$20/mo, best value if going third-party)
Subscriber-count based (same model as Kit, easier to predict). Full broadcast API on all paid
plans. ~$20/mo at 5k subscribers vs Kit's $89–109/mo. 92% inbox placement rate.
Kre8r calls their API directly — no Zapier. One session to wire into MailΩr.

### Option C — Brevo (~$18/mo, cheapest, volume-based)
Prices by emails sent, not subscribers. ~$18/mo for 40k sends/month (5k subs × 2/week).
Full broadcast API. Free tier (300/day) usable for dev/testing. Slight unpredictability
if send volume spikes.

### Option D — Upgrade Kit to Creator ($39–109/mo depending on subs)
Known platform, already had account, best creator features. But $89/mo at 5k subs is
painful alongside Kajabi. Only worth it if already heavily invested in Kit ecosystem.

### Comparison at 5k subscribers
| Platform | Price | Broadcast API |
|---|---|---|
| Kit Creator | $89–109/mo | ✅ |
| Mailerlite | ~$20/mo | ✅ |
| Brevo | ~$18/mo | ✅ |
| EmailOctopus | $24/mo | ✅ |
| Resend | $40/mo | ✅ |
| Kajabi (if they ship it) | $0 extra | ❓ |

**Decision pending Kajabi support call. If Kajabi punts → build Mailerlite integration in MailΩr.**

When building: `src/routes/mailerlite.js` (or `kitr.js`), same pattern as kajabi.js.
POST /api/mailerlite/send-broadcast → calls Mailerlite v2 API with subject + HTML body + tag segment.
MailΩr gets a second send button alongside the Kajabi copy/paste option.

---

## Technical Debt (cleared or confirmed)

- ~~better-sqlite3 migration~~ — DONE (confirmed Session 26)
- ~~Tool purpose docs~~ — DONE (Session 26)
- Engine vs Soul audit — ongoing (creator-profile.json purpose field added Session 26)
- No automated tests — acceptable for now, address before commercial launch
- AudiencΩr tag filter — Kajabi 500 on filtered requests, low priority

---

## PM2 Quick Reference (local dev only — not needed after Electron)

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```

---

## TeleprΩmpter — Known Issues (Session 36)

- [ ] **Solo tab crashes the app** — clicking Cloud Launch from the Solo tab fails and breaks
      the teleprompter entirely. Requires full app restart to recover. Solo tab needs its own
      Cloud Launch path or Cloud Launch should be disabled/hidden when Solo tab is active.

- [ ] **No way back from display screen** — once the teleprompter starts there is no back button
      or escape route. The only option is the "📋 Scripts" button in the controls overlay but
      controls are hidden by default. Add a persistent back/exit button or make controls always
      visible for the first few seconds. Closing the app and restarting should not be required.

---

## ✅ DONE — Session 26 (2026-04-09)

- 3 pipeline handoff gaps wired: VaultΩr→EditΩr, ReviewΩr→ComposΩr, ComposΩr→ClipsΩr
- Id8Ωr rate limiting fix: compact prompts, max_uses caps, delays 120s→30s, Phase 3 wait removed
- 19 tool purpose docs created (tool-purpose-docs/) — indexed, branded, Engine vs Soul clean
- ReviewΩr doc rewritten: pure rough cut approval, CutΩr explained as moved to ClipsΩr
- DirectΩr doc corrected: beat map → shot list today, V2.0 AI shot direction planned
- Creator purpose added to creator-profile.json as load-bearing soul config
- Short-form pipeline architecture logged with full implementation spec
- ReviewΩr refocus decision logged with full implementation spec
- CLAUDE.md stale sql.js note identified (needs updating)
