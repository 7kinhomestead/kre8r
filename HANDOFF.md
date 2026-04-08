# Kre8Ωr — Handoff Document
**Generated:** 2026-04-08 | **Session:** 24 | **Build Status:** Active Development

---

## What This System Is

Kre8Ωr is an AI-native content production OS for solo creators. Built for Jason Rutland
(7 Kin Homestead — off-grid homesteading creator). It eliminates the administrative layer
between having an idea and that idea reaching an audience — covering pre-production through
distribution in a single system. Built in ~3 weeks with Claude Code by a creator with no
prior coding experience.

---

## Current Session State (Session 24)

### Feature 1: Claude API Retry Wrapper — generate.js
`src/routes/generate.js` had a local 29-line `callClaude` with zero retry logic.
Removed it. Now uses `callClaudeMessages` from `src/utils/claude.js` (shared util with
full exponential backoff on 429, 529, ECONNRESET, ETIMEDOUT). All three call sites (PackageΩr,
CaptionΩr, MailΩr) are identical thin wrappers. Silent retry — no SSE noise for regular JSON routes.

### Feature 2: Id8Ωr Phase Checkpoints — crash-safe research state
Id8Ωr research takes 6+ minutes. A server restart mid-research wiped everything.
Solution: checkpoint after every phase_result. Recovery banner on next page load.
- New DB table: `session_checkpoints` (upsert via ON CONFLICT)
- New endpoint: `GET /api/id8r/checkpoint/:sessionId`
- Frontend: `checkForCheckpoint()` on load, recovery banner with phase summary + age
- "Show saved research" rebuilds feed from checkpoint, re-enables Continue if all 3 phases
- Retry toast on 429: fixed-position, auto-fades after retry delay

### Feature 3: VaultΩr Duplicate Detection UI (Session 25 addition)
- "🔍 Find Duplicates" button added to FOOTAGE LIBRARY header (id=`findDupesBtn`)
- Results area `id=dupesResults` below header, hidden by default
- Calls `GET /api/vault/duplicates` — groups by filename, keeps oldest, archives extras
- Per-clip Archive buttons + per-group "Archive N duplicates" bulk action
- Uses existing `/api/vault/footage/:id/archive` and `/api/vault/footage/bulk-archive` endpoints

---

## Full Tool Inventory

| Tool | URL | Status | Notes |
|------|-----|--------|-------|
| Id8Ωr | /id8r.html | Active | Phase checkpoints added S24. Redesign planned (cut mind map). |
| PipΩr | /pipr.html | Active | Story structure, beat map, pipeline state |
| WritΩr | /writr.html | Active | Jason's voice, 6 analyzed profiles, The Room conversation mode |
| DirectΩr | /director.html | Active | Shot list + crew brief |
| ShootDay | /shootday.html | Active | Day-of checklist, offline QR for Cari's phone |
| TeleprΩmpter | /teleprompter.html | Active | 3-device: display / control / voice (QR setup) |
| VaultΩr | /vault.html | Active | Footage DB, subject tagging, duplicate detection, archive to D: |
| EditΩr | /editor.html | Active | SelectsΩr v2, SCRIPTED/HYBRID/FREEFORM modes |
| AssemblΩr | (route: /api/editor/assemble) | Active | Smart beat assembly engine, shoot folder system |
| ReviewΩr | /reviewr.html | Active | Rough cut approval UI |
| ComposΩr | /composor.html | Active | Scene analysis, Suno prompt generation |
| GateΩr | /m1-approval-dashboard.html | Active | Community gating |
| PackageΩr | /m2-package-generator.html | Active | Platform packaging (retry wrapper added S24) |
| CaptionΩr | /m3-caption-generator.html | Active | AI captions per platform (retry wrapper added S24) |
| MailΩr | /mailor.html | Active | Broadcast A/B emails, blog posts, community posts (retry added S24) |
| AudiencΩr | /audience.html | Active | Kajabi contacts, tags, offers, broadcast-tag SSE |
| MirrΩr | /mirrr.html | Active | Channel intelligence, YouTube sync as background job |
| NorthΩr | /northr.html | Active | Content strategy, goal-setting, gap analysis |
| AnalytΩr | /analytr.html | Active | Analytics |
| ShowsΩr | /shows.html | Active | Rock Rich show format tracking |
| Soul BuildΩr | /soul-buildr.html | Active | creator-profile.json wizard (no JSON, native pickers) |
| Lab | /lab.html | Active | Experimental features |
| Operator | /operator.html | Active | Admin/operator view |
| Beta Invite | /beta-invite.html | Active | Beta applicant intake |
| M4 (legacy) | /m4-email-generator.html | Legacy | Keep — old email generator |

---

## Architecture

- **Runtime:** Node.js 18+, Express on port 3000
- **DB:** better-sqlite3, WAL mode — `C:\Users\18054\kre8r\database\kre8r.db`
  - Direct disk writes on every operation. No manual persist() calls.
  - In Electron mode: DB_PATH env var points to AppData.
  - Safe to query from CLI while server is running (WAL mode allows concurrent reads).
- **AI:** Anthropic claude-sonnet-4-6, shared caller `src/utils/claude.js`
  - `callClaude(prompt, maxTokens)` — single-message wrapper
  - `callClaudeMessages(messages, maxTokens)` — multi-turn, full retry/backoff
  - Exponential backoff on 429, 529, ECONNRESET, ETIMEDOUT — built in
- **Video:** ffmpeg + ffprobe (local), Whisper (local Python transcription)
- **DaVinci:** Python scripting API, port 9237, Local mode, Windows only (Resolve must be open)
- **Music:** Suno API (when configured) or Prompt Mode
- **Kajabi:** OAuth2 client_credentials — contacts/tags/offers live; broadcasts = copy/paste only
- **Process manager:** PM2 (fork mode)
- **Frontend:** Vanilla HTML/CSS/JS, dark theme, teal (#14b8a6) accents

---

## Key File Locations

| File | Purpose |
|------|---------|
| `server.js` | Express server, mounts all routes |
| `src/db.js` | SQLite schema, all migrations, all DB helper functions |
| `src/utils/claude.js` | Shared Claude API caller — use this everywhere |
| `src/routes/vault.js` | VaultΩr API routes |
| `src/routes/id8r.js` | Id8Ωr routes + checkpoint endpoints |
| `src/routes/generate.js` | PackageΩr / CaptionΩr / MailΩr generation |
| `src/routes/mirrr.js` | MirrΩr routes + YouTube background job |
| `src/vault/intake.js` | Footage ingest, BRAW proxy linking, reclassify |
| `src/vault/search.js` | Claude-generated SQL search |
| `src/editor/selects-new.js` | SelectsΩr v2 engine |
| `src/composor/` | ComposΩr scene analyzer, Suno client |
| `src/writr/` | WritΩr script generation, voice analyzer |
| `src/pipr/` | PipΩr beat tracker, config |
| `scripts/davinci/` | Python scripts for DaVinci Resolve integration |
| `public/js/nav.js` | Shared nav component |
| `public/js/bug-reporter.js` | Bug reporting widget |
| `creator-profile.json` | Soul config — Jason / 7 Kin Homestead instance |
| `database/kre8r.db` | SQLite DB file |
| `CLAUDE.md` | Full project bible — read first every session |
| `SESSION-LOG.md` | Per-session build log |
| `TODO.md` | Current priority queue |
| `DEVNOTES.md` | Critical dev notes |
| `OPUS_REVIEW.md` | Senior architecture review — read for context |

---

## Database Schema Highlights

| Table | Purpose |
|-------|---------|
| `footage` | All vault clips — path, shot_type, duration, transcript, subjects, proxy_path, organized |
| `projects` | PipΩr projects — story structure, beat map, pipeline state |
| `writr_scripts` | Generated scripts per project |
| `selects` | Editor selects per project |
| `shoot_takes` | Individual takes per beat per project |
| `clip_distribution` | Folder-based clip organization |
| `davinci_timelines` | DaVinci project links |
| `composor_tracks` | ComposΩr scene/music tracks |
| `session_checkpoints` | Id8Ωr crash recovery — upsert per session_id |
| `background_jobs` | Long-running ops (subjects tagging, YouTube sync) — survive navigation |
| `kv_store` | Generic key-value store |
| `shows` / `show_episodes` | Rock Rich show format tracking |
| `content_goals` / `northr_alerts` / `strategy_reports` | NorthΩr strategy layer |
| `token_usage` | Claude API cost tracking |
| `bug_reports` / `nps_scores` / `beta_applications` | Ops/feedback tables |

---

## Background Job System (Sessions 23-24)

Long-running ops (VaultΩr subject tagging, MirrΩr YouTube sync) run as background jobs
in the DB so they survive browser tab navigation and server restarts.

**How it works:**
1. Client POSTs to start the job — server creates a `background_jobs` row, returns `job_id`
2. Server runs the job async, updating `progress` / `ok` / `errors` as it goes
3. Client opens `GET /api/vault/jobs/:jobId/stream` — SSE stream of progress events
4. On page reload: `GET /api/vault/jobs/active/:type` — auto-reconnect if job is still running
5. Job status: `pending` → `running` → `done` / `error`

**Active job types:**
- `reclassify-subjects` — VaultΩr subject backfill (tag all untagged clips with Claude Vision)
- `mirrr-youtube-sync` — MirrΩr YouTube channel data pull

---

## Recent Build History (Sessions 20-25)

| Session | What Was Built |
|---------|----------------|
| S20 | AssemblΩr UI — beat-map viewer with take-swap |
| S21 | VaultΩr archive UI — storage meters + Archive to D: panel |
| S22 | Electron: DB rolling backup, right-click context menu (spell check + copy/paste) |
| S23 | VaultΩr semantic subject tagging — Vision at ingest, backfill SSE, subject pills on cards. Background jobs infrastructure. DaVinci Proxy Generator Lite workflow confirmed (24/24 proxies ingested overnight). creator-profile.json JSON parse fix. |
| S24 | Claude retry wrapper in generate.js. Id8Ωr phase checkpoints — crash-safe 6-min research. MirrΩr YouTube sync as background job. Soul Builder onboarding wizard + Pipeline Tour. |
| S25 | VaultΩr duplicate detection UI (Find Duplicates button + archiving workflow) |

---

## Known Issues & Technical Debt (Priority Order)

1. **Id8Ωr redesign** — cut mind map, add fast concept pass → creator chooses → deep research
2. **VaultΩr subject/topic tagging for semantic search** — partial (subjects column exists, search not yet subject-aware)
3. **AudiencΩr tag filter** — Kajabi 500s on filtered requests
4. **BRAW proxy timeout** — 30min per job too short for large files
5. **Project resolution defaults to 4K DCI** instead of reading footage resolution
6. **No automated tests, no error monitoring, no structured logging**
7. **Hardcoded Windows paths** in some Python scripts
8. **Rock Rich Episode format profile** not yet built (analyze best episodes → WritΩr show mode)

---

## Deployment

- **Live URL:** kre8r.app (DigitalOcean, password: demo/kre8r2024)
- **Deploy command:**
  ```bash
  cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
  sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
  ```
- **GitHub:** github.com/7kinhomestead/kre8r (private, master branch)
- **Current commit:** `c6af5c5` — MirrΩr: YouTube sync as background job, auto-load cached results on open
- **Note:** DigitalOcean console more reliable than SSH for deploys

---

## Nav Component (Every Page Must Use)

```html
<div id="kre8r-nav"></div>
<!-- at bottom of body: -->
<script src="/js/nav.js" defer></script>
<script>window.addEventListener('load', () => initNav())</script>
```

Do NOT use `<nav id="main-nav">` — that pattern does not work.

---

## Creator Profile Quick Reference

**Jason Rutland — 7 Kin Homestead**
- Voice: Straight-talking, warm, funny, never corporate. "Sharp-tongued neighbor talks over a fence." Goes off-script often — those moments are frequently better.
- Partner: Cari (camera operator / director). Cari profile planned for Rock Rich Shows.
- Shoots outdoors only. Primary camera: Blackmagic (BRAW). Proxy workflow: DaVinci → H.264 → D:\kre8r\intake.
- Platforms: TikTok (largest), YouTube, Lemon8, Kajabi community (ROCK RICH).
- ROCK RICH tiers: The Greenhouse (free), The Garden ($19/mo), The Founding 50 ($297 one-time).
- 6 analyzed voice profiles in WritΩr voice library.
- Content angles: financial, system, rockrich, howto, mistakes, lifestyle, viral.
- Rock Rich Episode format: Gold Rush meets How the Universe Works, off-grid edition. "Today Jason set out to ___ and the environment ___ed him." Short doc, tension arc, Discovery Channel DNA.

**Footage paths:**
- BRAW source: `D:\1 .braw watch folder` (DaVinci Proxy Generator Lite watches this)
- Proxy output / VaultΩr watcher: `D:\kre8r\intake`
- Camera SSD: `H:\`
- Archive/storage: `D:\`
- Never write footage to `C:\` — limited space

---

## Next Priorities

1. AssemblΩr end-to-end test with real Cari/Jason footage (SCRIPTED mode, alternating beats)
2. NorthΩr v2 — goal-setting conversation (proactive, not reactive to gaps)
3. Soul BuildΩr full wizard testing
4. Pipeline Tour polish
5. MirrΩr content-dna + content-secrets as background jobs
6. Deploy to DigitalOcean after each session
7. Id8Ωr redesign (deprioritized — working fine for now)

---

## Session Start Checklist

1. Read `SESSION-LOG.md` and `TODO.md`
2. Read `OPUS_REVIEW.md` for architectural context
3. Check PM2 status: `pm2 status`
4. Open DaVinci Resolve if doing video work
5. Confirm VaultΩr watcher path in startup log (should say `D:/kre8r/intake` or `D:\1 .braw watch folder`)
6. Tell creator current state and ask what to hit first

---

## Prime Directive (Always)

**Never lose creative state. Never break the creative thread without a recovery path.**

Ask of every feature and every failure mode: *if this goes wrong right now, what does the creator lose, and how do they get it back?*

Secondary: Does this feature reduce decisions or add one? If it adds one — redesign it.
