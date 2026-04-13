# Session 37 — Email Automation + Teleprompter Field Mode (2026-04-13)

## Goal
Wire Kajabi webhook → Mailerlite group sync, build welcome email automation, fix teleprompter cloud launch for field use without shared WiFi.

## What Was Built

### Teleprompter Field Mode (Cloud Launch)
- `public/teleprompter.html` — Cloud Launch button replaces "Generate Field QR"
- `launchViaCloud()` — POSTs script to teleprompter.kre8r.app, sets cloudLaunchActive flag
- `connectDisplayWS()` — uses `wss://teleprompter.kre8r.app` when cloudLaunchActive
- `updateQRForSession()` — QR codes now use module-level `base` (cloud domain when cloud active)
- `VOICE_BASE = 1.5` — independent voice scroll speed constant, decoupled from display speed slider
- `src/routes/teleprompter.js` — in-memory fieldScripts Map, 6-char code, 24h TTL, auth-bypassed on subdomain
- Versions 1.0.1–1.0.6 shipped via auto-updater

### Welcome Email Automation
- `src/routes/kajabi-webhook.js` — `fireWelcomeEmail()` wired into `/receive` after Mailerlite sync
- Template CRUD: `GET/POST /welcome-email/:tier`, `POST /welcome-email/:tier/generate`, `POST /welcome-email/test`
- Claude generates tier-specific welcome copy from creator-profile.json voice
- `public/audience.html` — Welcome Emails tab: per-tier armed/unarmed status, Generate + Edit + Test Fire
- Note: Mailerlite transactional API not available on current plan — welcome emails via Mailerlite automations instead

### Mailerlite Group Counts Fix
- `src/routes/mailerlite.js` — fixed `g.total` → `g.active_count` (Mailerlite API returns active_count not total)
- Group cards in AudiencΩr now show real subscriber counts

### DO Server Configuration
- `creator-profile.json` created on DO server (was gitignored, never existed there)
- `MAILERLITE_API_KEY` added to DO server .env
- Kajabi webhook → Mailerlite group add confirmed working end-to-end

## Bugs Fixed
- `callClaude` destructure moved to top-level require (not inside async handler)
- `callClaude` returns parsed object — removed redundant `raw.match()` + `JSON.parse()`
- Releases endpoint sorted descending so newest installer serves first
- Voice scroll speed decoupled from display speed slider (VOICE_BASE constant)

## Known Issues (carried forward)
- Mailerlite transactional API unavailable — Test Fire fails, use Mailerlite automations for welcome emails
- Session lost on every server restart (express-session in-memory) — needs persistent session store
- Desktop app shows Mailerlite group counts as 0 until local server restarted after fix deployment

---

# Session 35 — Cross-Device Sync Complete (2026-04-12)

## Goal
Complete SyncΩr — cross-device sync between desktop and laptop via kre8r.app.

## What Was Built

### SyncΩr infrastructure
- `src/routes/local-sync.js` — local proxy route mounted at `/api/local-sync`
  - GET /config — read stored server URL + token status
  - POST /config — save to .env (token optional if already stored)
  - GET /status — live connection test against remote server
  - POST /push — export all local projects + creator profile → kre8r.app
  - POST /pull — fetch latest snapshot from kre8r.app
  - POST /import — non-destructive project import (skips existing IDs)
- `public/sync.html` — full sync UI: server URL, token, test, push, pull, snapshot viewer, project import
- `src/db.js` — added `createProjectFromSnapshot`: preserves original IDs, creates pipeline_state rows, handles extended columns safely
- `server.js` — mounted `/api/local-sync` after auth guard
- `public/js/nav.js` — added ⟳ Sync link to nav bar

### Sync token recovery endpoint
- `GET /api/sync/token` — operator endpoint to retrieve real sync tokens (for when startup log is gone)
- Auth: requires OPERATOR_SECRET if set, open if not set (matches pattern of /register and /tenants)

### Bug fixes
- POST /config now allows URL-only updates without re-entering the token
- Token endpoint auth logic fixed (was blocking when OPERATOR_SECRET not set)

## End-to-End Test Results
- Desktop pushed 320KB snapshot to kre8r.app ✅
- Laptop installed new Electron build, pulled snapshot ✅
- 204 projects visible in snapshot (non-archived only — getAllProjects filters archived) ✅
- Status field preserved on import — archived stays archived, active stays active ✅
- **Cross-device sync fully operational** ✅

## Commits
- `7c65eca` — Add SyncΩr — cross-device sync UI and local proxy route
- `79bb229` — Add /api/sync/token endpoint for operator token recovery
- `9df4388` — Fix sync/token auth: allow access when OPERATOR_SECRET not set

## Status at End of Session
- Desktop ↔ kre8r.app ↔ Laptop sync: WORKING ✅
- Laptop installer built and installed ✅
- All sync work deployed to kre8r.app ✅

---

# Session 34 — ABI Conflict Attempt, Mailerlite Import Fix (2026-04-11)

## Goal
Fix the subscriber CSV import error, stabilize the ABI conflict between dev and Electron, address multi-user architecture question.

## ABI Conflict — npm pre-scripts (attempted, then reverted)
- Added `preelectron`, `prestart`, `predev` npm hooks to auto-swap better-sqlite3 binary between NMV 145 (Electron) and NMV 137 (system Node)
- Rewrote `scripts/prebuild-sqlite.js` with stamp-file check (`scripts/.sqlite-mode`) to skip download if binary already correct
- Created `scripts/rebuild-sqlite-node.js` — same stamp pattern for dev server direction
- **Problem:** `preelectron` ran `prebuild-install` on every bat file launch → download blocked Electron from opening
- **Resolution:** Removed all pre-script hooks entirely. Binary was already at NMV 145 and working. Pre-scripts are only needed for `dist:win` (already explicit there). No hooks = no breakage.

## Mailerlite Import Fix
- Root cause: Mailerlite v2 `/subscribers/import` requires a CSV **file upload** (multipart), not JSON
- Fix: rewrote `src/routes/mailerlite.js` `/subscribers/import` handler to use individual `POST /subscribers` upserts instead — 10 concurrent, Promise.allSettled so partial failures don't abort the batch
- Response now returns `{ ok, imported, failed }` counts
- **Status:** Not confirmed working yet — server restart may be needed; CSV parser may also break on Kajabi's quoted-comma fields

## Architecture Discussions
- **Multi-user desktop app:** Not a real problem. Each installation = one creator. Second user (e.g. Cari) gets a second login via existing user management. Multi-tenancy is a hosted-server (kre8r.app) concern, not desktop V1.
- **Webhooks + localhost:** Kajabi webhooks require a public HTTPS URL — localhost desktop installs can't receive them. Correct model: desktop users use CSV import; webhooks are a hosted-server feature. AudiencΩr webhook tab should detect localhost and show a message instead of the webhook URL.

## Status at End of Session
- Electron bat file: working ✅
- Mailerlite import: not confirmed — needs restart + retest
- Remaining items logged in TODO

---

# Session 33 — Mailerlite Integration, Kajabi Webhook, Electron Fixes, Setup Wizard (2026-04-11)

## Goal
Fix Electron app on laptop (ABI + dotenv errors), build Mailerlite email integration, build Kajabi webhook receiver, fix first-run credential setup, strip Anthropic branding from frontend.

## Electron App — Three Root Cause Fixes
- **Build 1 (dotenv missing):** `!node_modules` in package.json files array was silently stripping all dependencies from asar. Removed that line.
- **Build 2 (server.js unpacked but deps in asar):** Node can't bridge from unpacked file into asar modules. Fixed by keeping server.js inside asar, loading via `app.getAppPath()` instead of `getResourcePath()`.
- **Build 3 (NMV 137 vs 145):** `@electron/rebuild` used system Node headers. Fixed by using `prebuild-install --runtime electron --target 41.1.1` to fetch correct prebuilt. Added `scripts/prebuild-sqlite.js` and `npmRebuild: false`.
- **Old process conflict:** Stale PID on port 3000 serving old routes. Killed manually.
- Laptop confirmed: login screen ✅, server starts ✅, DB initialises ✅

## Mailerlite Integration — src/routes/mailerlite.js
- `GET /status` — checks key, calls /groups, returns {connected, groupCount, groups}
- `POST /groups/sync` — creates Greenhouse/Garden/Founding 50 if missing, writes IDs to creator-profile.json under `integrations.mailerlite_groups`
- `POST /subscribers/import` — bulk import (later fixed in Session 34 — see above)
- `POST /send` — creates campaign, sets content, sends immediately
- `GET /stats` — last 10 campaigns with open_rate, click_rate
- Mounted in server.js at `/api/mailerlite`

## AudiencΩr — public/audience.html (rebuilt)
Four tabs replacing the broken Kajabi contacts view:
- **Groups** — live subscriber counts per tier (Greenhouse/Garden/Founding 50)
- **Import CSV** — drag-and-drop, client-side parse, batch import to selected group
- **Campaigns** — last 10 with open/click rates
- **Webhook** — copyable URL, mapping table, test panel, event log

## MailΩr — Mailerlite Send Button
- Added Mailerlite send section to mailor.html: audience checkboxes (per tier), Send Now button
- Calls `POST /api/mailerlite/send` with subject + html_body + selected group_ids
- Copy/paste fallback retained alongside it

## Kajabi Webhook Receiver — src/routes/kajabi-webhook.js
- `POST /receive` — PUBLIC endpoint (mounted before auth middleware), always returns 200
  - `member.created` → Greenhouse
  - `purchase.created / offer.purchase` → keyword match: "Garden"/"$19" → Garden, "Founding"/"$297" → Founding 50, else Greenhouse
  - `member.removed` → log only (no Mailerlite delete)
  - Logs last 20 events to kv_store under `kajabi_webhook_log`
- `POST /test` — session-auth dry run
- `GET /config` — returns webhook URL, group config status, last 20 events
- Mounted at `/api/kajabi-webhook` before auth middleware in server.js

## Setup Wizard — First-Run Credential Fix
- Removed hardcoded `jason / kre8r2024` auto-seed from `src/db.js`
- Added `getUserCount()` export to db.js
- First-run detection middleware in server.js: if getUserCount() === 0, redirect to /setup
- `GET /setup`, `GET /setup.html` routes added (public, no auth)
- `POST /setup-api` handler: validates inputs, bcrypt hashes password, creates owner, writes ANTHROPIC_API_KEY to .env, updates creator-profile.json
- `public/setup.html` — dark theme wizard (name, username, password, confirm password, intake folder)
- **Pending:** Remove Anthropic API key field — operator pays the fees, users don't enter their own key

## Phase 0 — Strip Anthropic/Claude Branding
- Removed all Claude/Anthropic references from frontend HTML (footers, tooltips, about text)
- Committed: `54d855a Phase 0 — Strip Claude/Anthropic branding from all frontend UI`

## Commits This Session
- `54d855a` Phase 0 — Strip Claude/Anthropic branding from all frontend UI

---

# Session 32 — Phase 1/2/3 Reliability + Electron Packaging (2026-04-11)

## Goal
Execute the full pre-V1.0 Electron packaging checklist from the Opus review. All three phases completed in one session.

## Phase 1 — Reliability (Items 3–6)

**Item 3: creator-profile.json schema validation**
- Added `schema_version: 1` to creator-profile.json
- `src/utils/profile-validator.js` — validates required fields, migration framework (v0→v1 auto-stamps), vault path accessibility warning
- `GET /api/creator-profile` uses validator, returns structured errors instead of generic 500
- Health check and startup banner updated to use validator

**Item 4: Observability**
- `src/utils/logger.js` — pino structured logging, JSON to `logs/kre8r.log` always (even in dev), pino-pretty to console in dev, 10MB rotation
- `GET /api/health/diagnostic` — returns last 150 log lines + log file path
- `DIAG` button in index.html status bar — copies diagnostic snapshot to clipboard for support

**Item 5: SSE timeouts + heartbeats**
- `src/utils/sse.js` — shared helper: `startSseResponse()` and `attachSseStream()`, 20s keepalive heartbeat, 8-minute hard timeout
- `editor.js` `sseStream()` — refactored to use shared helper (SelectsΩr + b-roll SSE)
- `cutor.js` — both `/status/:job_id` and `/install-whisper` use shared helper

**Item 6: kre8r doctor**
- `GET /api/doctor` — checks AI (live ping), ffmpeg, Python, Whisper, creator profile validation, vault intake path, disk space (Windows), DaVinci
- `public/doctor.html` — full preflight UI with skeleton loading, green/red/warn rows, fix hints, re-run button
- `⚕` nav link added to desktop menu

## Phase 2 — Electron Packaging (Items 7–11)

**Item 7: getResourcePath() helper**
- `electron/main.js` — `getResourcePath(...parts)`: dev = `__dirname/..`, packaged = `process.resourcesPath/app.asar.unpacked/`
- All `path.join(__dirname, '../...')` calls updated to use helper
- `package.json` — `asarUnpack`: server.js, src/, database/, better-sqlite3, ffmpeg-static unpacked so child_process.spawn works

**Item 8: Node 20 LTS sidecar**
- `electron/main.js` — `getNodeBin()` resolves bundled sidecar at `resources/node/`, falls back to system node in dev
- `package.json` — `extraResources` configured for node-win/ and node-mac/ directories
- `scripts/download-node-sidecar.js` — downloads Node 20.19.1 LTS binary (win/mac) into `build-resources/`
- `npm run download-node` / `npm run download-node:all` scripts

**Item 9: Server crash supervisor + Reconnecting UI**
- `electron/main.js` — auto-restart on unexpected server exit; calls `__kre8rShowReconnect` in renderer
- `app.isQuitting` flag prevents restart loop on deliberate quit
- `public/js/nav.js` — `__kre8rShowReconnect` / `__kre8rHideReconnect` overlay available on every page

**Item 10: App icons**
- `scripts/generate-icons.js` updated — now also generates multi-size `kre8r-icon.ico`
- `package.json win.icon` updated to `.ico`
- macOS `.icns` note: requires `iconutil` on Mac (run `iconutil -c icns kre8r-icon.iconset`)

**Item 11: Whisper model management**
- `src/vault/transcribe.js` — `WHISPER_MODELS_DIR` env var for `--download_root`, `options.model` per-job override
- `GET /api/cutor/models` — returns all 8 Whisper model options with sizes, current active, downloaded status
- `electron/main.js` — `WHISPER_MODELS_DIR` + `LOG_DIR` passed to server pointing to `userData/`

## Phase 3 — Pre-Launch Polish (Items 12–14)

**Item 12: data-flow.md**
- Complete cross-module dependency map: DB tables, read/write matrix for every module, pipeline order diagram, external services

**Item 13: SSE integration tests**
- `scripts/test-sse.js` — 6 tests: WritΩr, EditΩr, CutΩr status/install, models, doctor
- Auth-aware (accepts 401 as "route exists"; full SSE test with TEST_USER/TEST_PASS)
- `npm run test:sse` — all 6 pass

**Item 14: Data export**
- `GET /api/export/all` — JSON snapshot of projects + footage, downloads as `kre8r-export-YYYY-MM-DD.json`

## Commits
- `992940b` Phase 1 reliability — schema validation, structured logging, SSE heartbeats
- `b933b6c` Phase 1 reliability — kre8r doctor preflight screen
- `21dea34` Phase 2 Electron packaging — resource paths, Node sidecar, crash supervisor
- `52e198e` Phase 3 pre-launch polish — data-flow doc, SSE tests, data export

---

# Session 31 — Pre-Electron Audit + Mac Readiness + Whisper One-Click Install (2026-04-11)

## Goal
Pre-Electron audit (per OPUS recommendations), Mac compatibility plan, Whisper one-click install in EditΩr.

## Pre-Electron Audit — Findings & Fixes

### Already done (no changes needed)
- `src/db.js` — `process.env.DB_PATH` with Electron comment already in place
- `src/vault/intake.js` + `extractor.js` — `FFMPEG_PATH`/`FFPROBE_PATH` env var guards already wired
- `src/vault/transcribe.js` — `python3` first in candidate list, runs whisper as `python3 -m whisper`, injects ffmpeg bin dir into child PATH
- `electron/main.js` — `node` vs `node.exe` platform check, `CREATOR_PROFILE_PATH` already abstracted

### Changes made

**`package.json`** — Added `ffmpeg-static ^5.3.0` and `ffprobe-static ^3.1.0` to dependencies. Installed.

**`server.js`** — Added ffmpeg bootstrap block (after Electron mode block, before error handlers):
- Auto-sets `FFMPEG_PATH` from `require('ffmpeg-static')` if env var not already set
- Auto-sets `FFPROBE_PATH` from `require('ffprobe-static').path` if env var not already set
- Logs which binary is being used on startup
- Priority: env var (Electron/Docker) → ffmpeg-static package → system PATH

**`electron/main.js`** — Added ffmpeg-static path resolution before server spawn:
- Resolves ffmpeg-static and ffprobe-static in Electron's process
- Passes `FFMPEG_PATH` and `FFPROBE_PATH` explicitly into server spawn env
- Falls back gracefully if packages not present

**`src/routes/soul-buildr.js`** — Two fixes in voice analysis transcription:
- Replaced `execSync('ffmpeg ...')` with `execSync('"${ffmpegBin}" ...')` using `process.env.FFMPEG_PATH || 'ffmpeg'`
- Removed `--device cuda` from Whisper call — Whisper now auto-selects (CUDA on Windows/Linux with NVIDIA, Metal on Apple Silicon, CPU fallback)

### Not bugs (confirmed)
- `fix_analytr.js`, `build-runbook*.js` — hardcoded D:\ in content strings, one-off utility scripts not loaded by server
- `creator-profile.json` vault paths (`D:\`) — soul config, correct. Mac users configure their own paths via setup wizard

## Mac Compatibility Assessment

**What works on Mac right now:**
- ffmpeg/ffprobe — bundled binaries (ffmpeg-static) handle Mac ARM and Intel automatically ✅
- better-sqlite3 — same install process, different platform binary ✅
- Python detection — `python3` first in WHISPER_CANDIDATES (exactly what Mac has) ✅
- Whisper CLI — `pip install openai-whisper` puts `whisper` binary on PATH on Mac ✅
- DaVinci Resolve — runs on Mac, same Python API, port 9237, same scripts ✅
- Electron dmg target — already in package.json build config ✅

**What a Mac user needs to install once:**
1. Python (often pre-installed; fallback: `brew install python3`)
2. `pip3 install openai-whisper` — now handled by one-click install in EditΩr
3. First transcription downloads Whisper model (~500 MB, automatic)

## Whisper One-Click Install — EditΩr

### New files/functions

**`src/vault/transcribe.js`** — Added two exports:
- `detectPython()` — probes WHISPER_CANDIDATES with `--version` to find Python independent of Whisper
- `resetWhisperCache()` — resets `_whisperBinary` / `_whisperVersion` to null so next `checkWhisper()` re-probes

**`src/routes/cutor.js`** — Added `POST /api/cutor/install-whisper`:
- SSE endpoint — streams pip install output line by line
- Detects Python first; if missing returns `{ type:'done', ok:false, error:'no_python' }`
- Runs `{pythonBin} -m pip install --upgrade openai-whisper`
- On success: calls `resetWhisperCache()` then sends `{ type:'done', ok:true }`
- Streams: `{ type:'status' }` → `{ type:'line' }` → `{ type:'done' }`

**`public/editor.html`** — Banner redesign (state machine):

States:
- `no_python` — Python not found. Shows brew/python.org link. Manual only.
- `no_whisper` — Python found, Whisper missing. Shows "Install Whisper" button.
- `installing` — SSE in progress. Shows scrolling log output. Actions hidden.
- `success` — Install done. Green banner. Auto-dismisses after 3 seconds.
- `error` — pip failed. Shows error text. "Try Again" button.

Flow:
1. `checkDeps()` fires on page load (non-blocking)
2. Calls `/api/cutor/check` — if `whisper: true`, banner stays hidden
3. If Whisper missing: shows `no_whisper` state with "Install Whisper" button (optimistic — server handles no-python case)
4. Button click → `installWhisper()` → SSE stream → live pip output in scrolling log
5. On success → `success` state → auto-dismiss 3s
6. If server returns `no_python` → switches to `no_python` state with manual instructions
7. "Check Again" button always available to re-probe after manual install

CSS: `.dep-banner`, `.dep-icon`, `.dep-body`, `.dep-title`, `.dep-msg`, `.dep-cmd`, `.dep-progress`, `.dep-log`, `.dep-actions`, `.dep-recheck`, `.dep-dismiss`

## Status at End of Session
- Pre-Electron audit: complete ✅
- Mac compatibility: complete ✅ (ffmpeg bundled, Python/Whisper cross-platform, paths abstracted)
- Whisper one-click install: complete ✅
- Server running clean, no startup errors
- Next: Phase 2 Electron wrapper, then Opus review for V1.0

---

# Session 30 — KRE8R Website Prototype (2026-04-11)

## What Was Built

### public/kre8r-gate.html — Full Three.js cinematic website prototype

Accessible at `/gate` or `/kre8r-gate` (public route, no auth).

**Portal / wormhole scene:**
- 5000-particle starfield with gaussian falloff GLSL shaders (no cartoon circles)
- Teal energy ring portal: main ring (emissive 4.0), shimmer ring (animated plasma shader), corona, void disc
- 400 orbital particles around ring
- ACESFilmicToneMapping, EffectComposer: RenderPass → UnrealBloomPass → grain/aberration ShaderPass → OutputPass
- Scroll-driven CatmullRomCurve3 camera path (14 control points, z=8 to z=-45)
- Custom easeScroll: slow hero approach, portal acceleration, slow zone at Id8r, cruise to WritΩr
- Custom cursor (8px teal dot + 32px ring), mouse-reactive portal tilt
- Page height 900vh

**Id8r station (z=-22):**
- BigBang class — 2500 particles, 5 phases: nebula → compressing → singularity → exploding → formed
- Nebula particles drift toward cursor position (mouseNDC × 4.0 / 2.8 → BigBang local space)
- Trigger locks cursor position as singularity — everything collapses to wherever cursor rests
- Explosion bursts from that exact point
- Dark void overlay (CSS, above bloom so it's truly dark) grows from singularity screen position
- ID8ΩR label + 4 research brief cards fade in: Elevator Pitch / The Hook / Talking Points / The Result
- Cards represent actual Id8r output — the demo IS the metaphor

**Transit (z=-22 → z=-45):**
- PIP<span>Ω</span>R waypoint label fades in/out during transit (scrollT 0.806–0.870)
- Scroll-driven opacity in animation loop, no CSS transition

**WritΩr station (z=-45):**
- WritrStation class — 3000 particles, 8 row targets
- Teal particles (voice) start left, amber particles (research) start off-screen right and stream in
- Two distinct clouds converge, interweave as they spring to row targets
- Rows form, hold 1.5s, then scatter outward radially
- _showScript() fires: kills Id8r elements → waits 1.2s → reveals WritΩr content
- Station label (WRITΩR) + script header + 3 beat cards stagger in (450ms apart)
- Pipeline map cascades: ID8ΩR → PIPΩR → WRITΩR → EDITΩR → COMPOSΩR → MAILΩR

**Ω symbol:**
- .omega CSS class: DM Sans weight 200, 0.82em, aligned to Bebas Neue caps height
- Applied to all station labels and pipeline map tool names
- KRE8R hero wordmark stays clean (no Ω — brand spec)

**Race condition fix:**
- writrScriptShown flag: set true only when WritΩr content actually hits screen
- _revealId8r() guards on writrScriptShown (not writrActivated) — Id8r cards show correctly
- _showScript() is single authoritative fadeout point for Id8r elements

## server.js changes
- /gate, /kre8r-gate, /kre8r-gate.html routes added (public, no auth)
- Auth bypass middleware updated for gate paths

## Pending on Website
- DO deploy needed to see all changes (pull + pm2 restart)
- Test full scroll journey end-to-end after deploy
- Next stations to build: EditΩr, ComposΩr (or a CTA / launch page at the end)
- Consider a scroll-to-top / loop after pipeline map

## Session Notes
- Jason is having a rough day — website work was a productive creative distraction
- Password is still "NEWPASSWORD" — needs changing
- Kajabi broadcast API call still pending
- Email platform decision (MailerLite vs wait for Kajabi) still pending



---

# Kre8Ωr Session Log — 2026-04-10 (Session 29 — Solo Mode, Session Survival, Voice Commands)

## What Was Built — Session 29

---

### TeleprΩmpter: Session Survival

**`public/teleprompter.html`** — If the page reloads or crashes during filming, everything is recovered automatically.

- `saveRecoveryState()` — called when `startTeleprompter()` runs. Saves script text, project name, font size, speaker filter, and scroll position to `localStorage.tp_recovery`.
- `updateRecoveryScroll()` — called every 5 seconds from `animTick`, keeps scroll position current.
- `checkSessionRecovery()` — checks for recovery data < 10 minutes old on page load.
- `showRecoveryOverlay(recovery)` — shows "SESSION FOUND" overlay with 3-second countdown and project name. Auto-resumes. "Start Fresh" escape hatch clears state.
- `resumeSessionNow()` — rebuilds `loadedScript` from stored text, restores font/speaker filter, calls `startTeleprompter()`, then restores scroll position.
- Recovery is cleared on deliberate `backToSelector()` — only triggers on accidental reload.

---

### TeleprΩmpter: Solo Mode

**`public/teleprompter.html`** — New "🎬 Solo" tab on the selector screen. One phone handles everything Jason was doing with two phones (voice + control).

**Solo Display (phone IS the teleprompter):**
- "🎬 Solo" tab shows same project selector
- "🎬 Start Solo →" button calls `startSoloMode()`:
  - Calls `startTeleprompter()` (display mode)
  - Requests Wake Lock (screen stays on)
  - Auto-starts voice sync after 800ms
- No second phone needed for solo filming

**Enhanced Voice Device (phone as voice + control combined):**
- Beat navigation pills now appear on the voice device screen
- Populated via `script_sync` WebSocket message when display loads a script
- `vdBuildBeatPills(rawText)` — processes script, builds pill buttons
- `vdUpdateBeatPill(beatN)` — highlights current beat (driven by `beat_update` messages)
- Tapping a beat pill seeks display to that position via `vdSend('seek_pct', pct)`
- Restart button added to voice device seek row
- Voice device handles `script_sync` and `beat_update` WebSocket messages

---

### TeleprΩmpter: Voice Commands

**`public/teleprompter.html`** — New "🎙 Cmd" hold button on the display controls bar.

Hold the button → speak → release → command executes. Web Speech API SpeechRecognition (Chrome/Edge/Safari).

Supported commands:
- `pause` / `stop` / `hold` → pauses scroll
- `play` / `go` / `roll` / `start` → starts scroll
- `restart` / `from the top` → scrolls to top, pauses
- `beat N` (beat 3, beat five) → seeks to that beat marker
- `next beat` / `previous beat` → relative beat navigation
- `back N` / `back 10 seconds` → seeks backwards
- `forward N seconds` → seeks forward
- `faster` / `speed up` → speed + 1
- `slower` / `slow down` → speed - 1

Toast feedback on screen for 2.5 seconds. Button pulses while listening. `processVoiceCmd()` tries up to 3 speech alternatives before showing "didn't catch that."

**Commits:** 8227692, 9e037f7, 83bbfbd

---

## What Was Built — Session 28

---

### TeleprΩmpter: processScript() Bug Fixes

**`public/teleprompter.html`** — Two real bugs fixed, found via 35-test simulation suite:

**Bug 1 — B-roll inline stripping:**
Lines containing b-roll as a parenthetical (e.g. `"Three years (b-roll: timelapse) teaches things."`)
were being dropped entirely because `DROP_KEYWORDS` ran BEFORE inline stripping.
Fix: moved DROP_KEYWORDS check to AFTER inline stripping (step 5b instead of step 4).

**Bug 2 — Paren-prefixed spoken lines:**
Lines like `"(b-roll: laughing) Backup plan always works."` were dropped entirely by the
`if (fc === '(') continue` guard before the spoken content could be extracted.
Fix: when a line starts with `(`, attempt to strip leading b-roll/insert prefix first,
then decide based on what remains — if anything spoken left, keep it.

35/35 unit tests pass. Test file: `test-processscript.js` (can be deleted after this session).

---

### Mark Complete — Pipeline Control

**`src/db.js`** — `markProjectComplete(projectId, publishedAt)`:
Sets `projects.status = 'published'` AND `projects.current_stage = 'COMPLETE'`
AND `pipeline_state.current_stage = 'COMPLETE'`. The definitive done signal for all tools.

**`src/routes/projects.js`** — `PATCH /api/projects/:id/complete`

**`public/northr.html`** — Two places to mark complete:
1. Stalled cards (🟡 section) now have a `✓ Done` button inline — one tap
2. Mark Published section upgraded to `✓ Mark Complete`, shows COMPLETE badge when done

**To use now:** Open NorthΩr → stalled list → hit `✓ Done` on the Rock Rich video.

---

### Auth System — Session Login Replaces Nginx Basic Auth

**`src/db.js`** — `users` table added with migration:
```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'owner',
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```
Seeds default owner on first run. Username: `jason`, password: `kre8r2024` (change before deploy).
Set `KRE8R_USERNAME` / `KRE8R_PASSWORD` env vars to override seed values.
Auth functions exported: `getUserByUsername`, `getUserById`, `getAllUsers`, `createUser`,
`updateUserPassword`, `deleteUser`.

**`src/routes/auth.js`** — New route file:
- `POST /auth/login` — bcrypt compare → set session cookie
- `POST /auth/logout` — destroy session
- `GET /auth/me` — returns current user info
- `GET /auth/users` — list all users (owner only)
- `POST /auth/users` — create user with role (owner only)
- `DELETE /auth/users/:id` — delete user, can't delete self (owner only)
- `POST /auth/users/:id/password` — change password (owner only)

**`public/login.html`** — New login page. Dark theme, matches app.
Redirects to `?next=` original destination after login.

**`server.js`** — Session middleware + auth guard added:
- `express-session` with `kre8r.sid` cookie, 30-day expiry, httpOnly
- Auth guard middleware blocks all routes unless:
  - `req.hostname === 'teleprompter.kre8r.app'` (subdomain bypass)
  - `/login`, `/auth/*`, `/api/beta`, `/api/health`, public marketing pages
- API routes return `401 { error, redirect }` instead of HTML redirect
- HTML routes redirect to `/login?next=[original-url]`

**`public/js/nav.js`** — Sign out button `⏏` added to top nav bar (calls `/auth/logout`).

**Dependencies added:** `bcryptjs`, `express-session`

---

### Architecture Decision: Field TeleprΩmpter

**Problem:** Outside office wifi, phones connect through Phone 1's hotspot data.
`kre8r.app` was shared with dev friend. Needed a clean field solution.

**Decision:** `teleprompter.kre8r.app` subdomain (same DO droplet, same server).
The subdomain bypasses user auth — session codes protect individual sessions.
All field devices reach the subdomain through Phone 1's mobile data via hotspot.
This is NOT offline — "outside wifi range" still has mobile data. True offline
(zero signal) is a future Android APK (documented in TODO.md).

**Still to do (separate session):**
1. DNS A record: `teleprompter.kre8r.app` → same DigitalOcean IP
2. Nginx server block for the subdomain
3. SSL: `certbot --expand` to add the subdomain to existing cert

---

### TODO.md Updates

- P1-G section added: Auth + Field TeleprΩmpter plan documented
- Android APK section added: beta onboarding flow, zero-signal architecture,
  NanoHTTPD + Java-WebSocket approach, sideload instructions for users

---

## DigitalOcean Deploy — Session 28

**Full step-by-step in DEPLOY-SESSION28.md** — see that file.

---

# Kre8Ωr Session Log — 2026-04-10 (Session 27 — Phase 1 Feature Execution: Short-Form, ReviewΩr Refocus, ClipsΩr Editing, MirrΩr Loop)

## What Was Built — Session 27

---

### P1-A: ReviewΩr Refocused — Pure Rough Cut Approval

**`public/reviewr.html`** — Complete rewrite. CutΩr analysis stripped entirely.
- Beat cards: section index, beat label, gold_nugget badge, takes count, selected duration
- Expand to show fire_suggestion note and all takes with winner badge
- Status pills: beats count, gold moments count, total runtime
- Empty state guides user to EditΩr to run SelectsΩr first
- Three advance banners: ComposΩr (teal), ClipsΩr (green), PackageΩr (blue)
- All banner hrefs wired with `?project_id=` on project select

---

### P1-B: Short-Form Pipeline Mode

**`src/db.js`** — Added `format TEXT DEFAULT 'long'` column to projects table

**`src/pipr/beats.js`** — 7 new short-form beat structures:
  - SHORT_HOOK_TENSION_PAYOFF, SHORT_OPEN_LOOP, SHORT_PAS, SHORT_BEFORE_AFTER
  - SHORT_LIST, SHORT_HOT_TAKE, SHORT_TUTORIAL
  - Each beat has `duration_label` (e.g. "0–3s"), `target_pct` for 60s video, `short_form: true`

**`public/pipr.html`** — Short-form section added to structure picker
  - SHORT FORM visual divider + 7 new structure cards with teal "SHORT" badge
  - Beat preview shows duration_label for short-form structures
  - BEAT_TEMPLATES client-side object synced with beats.js
  - `form.format` set to 'short' when short_ structure selected

**`src/routes/pipr.js`** — Format detection on project create
  - `isShort = story_structure.startsWith('short_')` → sets format field in DB

**`src/routes/writr.js`** — SHORT-FORM FORMAT block injected into id8rBlock
  - 150–300 word limit, 10-word hook rule, no filler, payoff in last 10–15s

**`public/writr.html`** — SHORT FORM badge shown when `project.format === 'short'`

---

### P1-C: ClipsΩr Inline Editing

**`public/clipsr.html`** — Click-to-edit on 4 fields in each clip card:
  - `hook`: contenteditable div with onblur → saveClipField()
  - `why_it_works`: contenteditable div with onblur → saveClipField()
  - `caption`: existing textarea, added onblur → saveClipField()
  - `hashtags`: contenteditable div with onblur (Enter/Escape blur)
  - `saveClipField()` async function: PUT /api/clipsr/clips/:id, saving-flash animation on success
  - `copyHook` and `copyHashtags` updated to read live element content

---

### P1-D: MirrΩr Evaluation Loop — Fixed and Verified

**Bug fixed: `src/db.js`** — `getVideosByMonth()` used `pr.angle` which doesn't exist on `projects`.
  Fixed to `po.angle` (angle is on the `posts` table, aliased `po`).

**`src/routes/mirrr.js`** — `evaluate-strategy` endpoint improvements:
  - `evalMonth` / `evalYear` changed from `const` to `let` for fallback reassignment
  - Fallback: if no strategy report for requested month, uses most recent available
  - Error message improved: "No strategy reports found. Generate a strategy in NorthΩr first."

**Verified full loop:**
  1. evaluate-strategy → Claude evaluates → `saveStrategyEvaluation()` stores result
  2. GET /api/mirrr/evaluations → returns stored eval with score, weight badges
  3. Id8Ωr `mirrrBlock` reads from `getRecentEvaluations()` — injects MIRRΩR CALIBRATION
  4. WritΩr `buildWritrPromptContext()` also reads evaluations → MIRRΩR CALIBRATION in every script prompt

---

### P1-E: Cosmetic Polish

**`CLAUDE.md`** — Cleaned up:
  - better-sqlite3 migration removed from Planned Features (completed)
  - Confusing duplicate MirrΩr entry removed
  - Known Issues renumbered (2 was missing after sql.js migration item was removed)

**`public/northr.html`** — Evaluations empty state text improved to explain the required flow

**Audit findings (no changes needed):**
  - "Rockridge" references in src/ are all defensive fixes (Whisper transcription correction) — correct
  - Empty states across all key pages (EditΩr, VaultΩr, WritΩr, ComposΩr, ClipsΩr, ReviewΩr) are descriptive
  - TeleprΩmpter and ShootDay both have mobile viewport meta + media queries

---

### P1-F: Deploy

Git commit pushed to origin/master (github.com/7kinhomestead/kre8r).
SSH access not available from this machine — use DigitalOcean console:

```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

---

## Session 27 State — End of Session

- ✅ P1-A through P1-E complete
- 🔲 P1-F: deploy commands above — run via DigitalOcean console
- Phase 2 (Electron wrapper) is next when Phase 1 is fully deployed

---

# Kre8Ωr Session Log — 2026-04-09 (Session 26 — Pipeline Audit, Tool Purpose Docs, Rate Limiting Fix, Short-Form Architecture)

## What Was Built — Session 26

---

### Fix 1: Three Pipeline Handoff Gaps Wired

**VaultΩr → EditΩr** (`public/vault.html`)
- Added "→ Continue to EditΩr" button to page-header (always visible, links to `/editor.html`)
- Modified `.page-header` to flex layout to accommodate button alongside title

**ReviewΩr → ComposΩr** (`public/reviewr.html`)
- Added "SCORE YOUR EDIT" advance-banner above existing ClipsΩr banner
- `goComposrBtn` href wired with `project_id` on project select
- `goClipsrBtn` href also wired with `project_id` (was previously static)

**ComposΩr → ClipsΩr** (`public/composor.html`)
- Added "→ Continue to ClipsΩr" link button alongside existing "Push to DaVinci" in advance-banner
- `goClipsrBtn` href wired with `project_id` on project select

---

### Fix 2: Id8Ωr Research Rate Limiting

**Root cause confirmed:** Phase 2 had zero `max_uses` limit on web_search — Claude could fire unlimited searches. Full 14-message conversation sent to every research phase (oversized prompts). 120s delays after every phase including VaultΩr check (which does zero web searches).

**`src/routes/id8r.js`:**
- Built compact `conceptBrief` string (chosen concept + last 2 user messages) replacing full `conversationText` in research phases — dramatically smaller prompts
- Phase 1 web_search: `max_uses: 3 → 2`, response tokens 1024 → 800
- Phase 2 web_search: **added `max_uses: 2`** (was unlimited — root cause), response tokens 1024 → 800
- Phase 1 delay: 120s → 30s
- Phase 2 delay: 120s → 30s
- Phase 3 (VaultΩr) delay: **removed entirely** — local check, no web searches
- Total research wait time: was 6+ minutes hardcoded → now under 2 minutes worst case

---

### Feature 3: Tool Purpose Docs — Full Pipeline (19 files)

Created `tool-purpose-docs/` directory with complete pipeline documentation:

- `index.html` — master index, all tools by phase, status badges, navigation
- `01-id8r.html` through `17-automator.html` — one doc per tool in pipeline order
- `18-collaboratr.html` — CoLABoratr/Lab lateral tool doc (gold "THINKING SPACE" framing)

**Design system:** Bebas Neue + DM Sans, `#0a0a0a` background, teal `#14b8a6` primary, red/gold accents only, no purple/green. Matches 7kinhomestead.com brand.

**Each doc covers:** What It Is (plain English, creative-first) → How It Works (numbered steps, tech detail in dim text) → What It Creates (data + files two-column) → Valuable Final Product (teal-tiled box) → Hands Off To → Prev/Next footer navigation.

**Engine vs Soul pass:** Full anonymization of all creator-specific references across all 19 files. Zero remaining hits for creator name, camera operator name, show names, community tier names, follower counts, or location-specific language. Docs are ready for any beta user.

**Corrections made mid-session:**
- `01-id8r.html` — fixed "sessionStorage" claim → localStorage (UI) + SQLite DB checkpoints (research)
- `04-director.html` — corrected to reflect actual behavior (beat map → shot list display, not AI shot direction from script). V2.0 gold callout added.
- `09-reviewr.html` — fully rewritten to reflect decision to remove CutΩr analysis. Pure rough cut approval. Gold callout explaining why CutΩr moved to ClipsΩr.

---

### Decisions Logged in TODO.md

**Task 0A — Short-Form Pipeline Mode:**
Full architecture for short-form as a first-class content type. `content_type` column on `projects` table carries context through entire pipeline. Id8Ωr detects intent, PipΩr gets Short Form tile with 7 structures (Hook/Tension/Payoff, Open Loop, PAS, Before/After/Bridge, Listicle, Hot Take, Tutorial), WritΩr adapts output length and hook treatment, ClipsΩr flips role for short-form (validates rather than extracts). Commercial unlock — enables short-form-only creator workflows.

**Task 0 — ReviewΩr Refocus:**
Strip CutΩr analysis (social clips, retention cuts, CTA placement, off-script gold) from ReviewΩr UI. One job: rough cut approval. `cuts` table and `/api/cutor/` routes stay — used by ClipsΩr downstream.

---

### Also Confirmed This Session

- **better-sqlite3 migration** — already complete (CLAUDE.md was stale, still said sql.js)
- **Id8Ωr concept-selection flow** — already wired in UI (concepts screen → choose → targeted research)
- **DirectΩr** — confirmed it's a beat-map → shot list converter, not AI shot direction. V2.0 planned.
- **CoLABoratr/Lab** — confirmed it's `/lab.html`, Creative Director chat with full project context

---

# Kre8Ωr Session Log — 2026-04-09 (Session 25 — MirrΩr Self-Evaluation + Compounding Intelligence Loop + Distribution Readiness)

## What Was Built — Session 25

---

### Feature 1: MirrΩr Self-Evaluation System

**The insight:** "It's not only holding up a mirrr to me, it can hold up a mirror to itself."

Strategy generates → month passes → YouTube data comes back → MirrΩr evaluates whether its own recommendations were correct → stores calibration → next strategy is informed by evidence of what worked.

**`src/db.js`:**
- Migration: `evaluation TEXT` + `evaluated_at DATETIME` added to `strategy_reports`
- `saveStrategyEvaluation(id, json)` — writes structured evaluation back to report row
- `getRecentEvaluations(n)` — returns last N evaluated reports for prompt injection
- `getVideosByMonth(month, year)` — actual videos + views/likes/comments for any month

**`src/routes/mirrr.js`:**
- `POST /api/mirrr/evaluate-strategy` — fetches strategy for target month, gets actual YouTube performance data, asks Claude to score accuracy (0–10) and assign UP/DOWN/NEUTRAL weight adjustments per recommendation, stores structured JSON back to report + kv_store
- `GET /api/mirrr/evaluations` — returns N most recent evaluated reports for NorthΩr display
- Top-level `callClaude` + `getCreatorContext` imports cleaned up

**`src/utils/strategy-engine.js`:**
- `generateMonthlyStrategy` loads last 3 evaluations via `getRecentEvaluations`
- `buildStrategyPrompt` now receives + injects calibration block: per-month accuracy scores, weight adjustments (UP/DOWN), calibration notes — strategy learns from its own track record

**`public/northr.html`:**
- "🪞 Evaluate Last Month" ghost button next to Generate Strategy
- New STRATEGY EVALUATIONS section — collapsible cards with score (color-coded green/amber/red), one-line verdict, What Worked / What Missed / Calibration Notes, weight adjustment badges (UP/DOWN), and performance stats (videos, total views, avg/video)
- `loadEvaluations()` called on page init; reloads after evaluation runs

---

### Feature 2: DaVinci Audio Fix + End-Time Buffer

**Bug 1:** `mediaType: 1` in `AppendToTimeline` = video only. Removed the flag entirely — default behavior includes both video and audio.

**Bug 2:** Whisper timestamps end at the last phoneme. DaVinci was cutting on the final syllable. Added `end_s + 1.5` seconds buffer to `end_frame` calculation — every sentence now has room to land before the cut.

**File:** `scripts/davinci/create-social-clips.py`

---

### Feature 3: MirrΩr Calibration Wired Into Id8Ωr and WritΩr

The self-evaluation data now flows all the way upstream — concept generation and script writing are both informed by what angles actually overperformed vs underperformed.

**`src/routes/id8r.js` `/concepts` endpoint:**
- Loads last 2 evaluations via `getRecentEvaluations`
- Injects `mirrrBlock` alongside existing `intelligenceBlock` + `clipsrBlock`
- Concept angle selection explicitly biased: UP-weighted angles favored, DOWN-weighted angles must justify their place

**`src/utils/project-context-builder.js` `buildWritrPromptContext()`:**
- New MIRRΩR CALIBRATION section appended after ClipsΩr patterns block
- Per-evaluation: score, one-line verdict, what overperformed, what underperformed, calibration notes

**Full intelligence flow after this session:**
```
ClipsΩr approves clip → clipsr_content_patterns
    → Id8Ωr concepts / WritΩr scripts / NorthΩr strategy

MirrΩr evaluates strategy vs real YouTube results
    → NorthΩr strategy (calibration block)
    → Id8Ωr concepts (mirrrBlock — bias toward proven angles)
    → WritΩr scripts (MIRRΩR CALIBRATION section in context)
```

---

### Feature 4: Story Structure Performance Loop — PipΩr Gets Smart

**The gap:** PipΩr showed static descriptions for every story structure. It had no idea that Save the Cat averaged 2× more views than Story Circle on this channel.

**`src/db.js`:**
- `getStructurePerformance()` — aggregates avg/max/total views + video count per `story_structure` for all kre8r projects with real YouTube data. Ordered by avg_views DESC.

**`src/routes/pipr.js`:**
- `GET /api/pipr/structure-performance` — returns performance keyed by structure slug for O(1) frontend lookup

**`public/pipr.html`:**
- On load: fetches structure performance, injects live badge into each structure card
- Top performer (within 90% of best) gets ⭐ and brighter teal border
- Badge shows: "⭐ avg 45k views · 8 videos" with hover tooltip for full stats
- New CSS: `.structure-perf-badge`, `.perf-top`, `.perf-low` variants

**`src/routes/mirrr.js` evaluate-strategy:**
- Loads `getStructurePerformance()` at evaluation time
- Injects all-time structure breakdown into evaluation prompt
- Added `structure_performance[]` to evaluation JSON schema: per-structure verdict (top/strong/neutral/underperforming) + `pipr_recommendation`

**`src/utils/strategy-engine.js`:**
- `buildStrategyPrompt` receives + injects `structurePerf` block
- `recommended_mix` schema now includes `structure_hint` — which PipΩr structure to use for each content type
- NorthΩr renders `structure_hint` on mix cards (teal label, uppercase)

---

### Feature 5: NorthΩr 3-Month Growth Trajectory

**The request:** "I am here now but I want to be at X in 3 months — back-engineer the path."

**`src/routes/northr.js`:**
- `POST /api/northr/growth-plan` (SSE) — reads current state from DB (health, publishing stats, pipeline, MirrΩr evaluations, structure performance), accepts optional user targets (subscribers, avg views, videos/month, revenue), asks Claude to back-engineer month-by-month plan. Inferred targets if none provided. Caches to `kv_store['growth_plan']`.
- `GET /api/northr/growth-plan` — returns cached plan with targets

**`public/northr.html`:**
- New 3-MONTH TRAJECTORY section above Monthly Goals
- Target inputs: YouTube subs, avg views/video, videos/month, monthly revenue (all optional)
- Rendered plan: inferred target chips, gap analysis, non-negotiables, 3 month cards (theme + targets + actions + milestone + early warning), highest-leverage move, biggest risk, PipΩr structure recommendation for the quarter
- Plan persists and reloads on page open; target inputs restored from cache
- New CSS: growth month cards, target chips, callout cards (leverage/risk/structure)

---

### Feature 6: Distribution Readiness — ClipsΩr into PackageΩr + MailΩr

**The gap:** PackageΩr only pulled CutΩr clips (EditΩr workflow). Videos going through VaultΩr → ClipsΩr skipped EditΩr entirely — PackageΩr had nothing but a topic title. MailΩr same problem.

**`src/db.js`:**
- `getApprovedViralClipsByProject(projectId)` — queries `viral_clips` by `project_id` filtered to `status='approved'`, joins footage for transcript access
- `getCompletedFootageByProject(projectId)` — returns the completed-video footage for a project (for transcript injection)

**`src/routes/generate.js` (PackageΩr):**
- Injects ClipsΩr approved hooks + why_it_works + captions before CutΩr clips
- Injects first 2000 chars of video transcript from completed-video footage
- Prompt explicitly anchors packages to the exact moments the creator approved

**`src/routes/mailor.js` (MailΩr):**
- Injects top 3 ClipsΩr approved hooks + why_it_works + captions
- #1 gold-ranked hook explicitly anchors one A/B subject line
- Injects first 1000 chars of transcript for editorial context

---

## Commits This Session

```
2d600f6 Distribution readiness: wire ClipsΩr into PackageΩr + MailΩr; fix DaVinci end-time
285ecfb Story structure performance loop + NorthΩr 3-month growth trajectory
aece4b4 Fix DaVinci audio bug; wire MirrΩr calibration into Id8Ωr and WritΩr
0b14ece Add MirrΩr self-evaluation system — strategy holds up a mirror to itself
ea1a195 ClipsΩr fixes: live DaVinci button, Rock Rich correction, state ref (carried from prior session)
```

---

## Session Notes

- Session started April 8, ended April 9 (date rollover)
- Rock Rich Community Launch video fully through ClipsΩr — approved clips stored, project at M1
- DaVinci social clips project created (audio was silent — fixed; end-time cut off — fixed)
- Distribution pipeline fully prepped for morning run: GateΩr → PackageΩr → CaptionΩr → MailΩr
- Server running cleanly at session close: PID 27868, 20min uptime, 0 error logs

---

# Kre8Ωr Session Log — 2026-04-08 (Session 24 — Claude Retry Feedback + Id8Ωr Phase Checkpoints)

## What Was Built — Session 24

---

### Feature 1: Claude API Retry Wrapper — generate.js

**Problem:** `src/routes/generate.js` had a local `callClaude` with zero retry logic.
A single 429 or network blip would crash PackageΩr, CaptionΩr, or MailΩr with no recovery.

**Fix:**
- Removed the 29-line local `callClaude` in `generate.js`
- Added `const { callClaudeMessages } = require('../utils/claude')` — shared util already has
  full exponential backoff on 429, 529, ECONNRESET, ETIMEDOUT
- Thin wrapper keeps all three call sites identical: `callClaude(system, user, tokens)`
- These routes are regular JSON (not SSE), so silent retry is the right behavior

**Files:** `src/routes/generate.js`

---

### Feature 2: Id8Ωr Phase Checkpoints — crash-safe research state

**Problem:** Id8Ωr research takes 6+ minutes (3 phases × 120s waits). A server restart
mid-research wipes everything — creator loses YouTube research, data phase, vault check.

**Solution:** Checkpoint after every phase_result. Recovery banner on next page load.

**`src/db.js`:**
- New table: `session_checkpoints (session_id PK, tool, data JSON, updated_at INTEGER)`
- `setCheckpoint(sessionId, tool, data)` — upsert via ON CONFLICT
- `getCheckpoint(sessionId)` — returns parsed data or null
- `deleteCheckpoint(sessionId)` — called on successful send-pipeline
- All three exported

**`src/routes/id8r.js`:**
- After each `send({ stage: 'phase_result', phase: N })`: `db.setCheckpoint(session_id, 'id8r', { phase: N, chosenConcept, phase1, phase2, phase3 })`
- After successful send-pipeline: `db.deleteCheckpoint(session_id)`
- New endpoint: `GET /api/id8r/checkpoint/:sessionId` — returns `{ found, tool, data, updated_at }`

**`public/id8r.html`:**
- `onResearchEvent`: handles `ev.stage === 'retrying'` — shows fixed-position toast:
  "Claude is busy — retrying in Xs… (attempt N)" with auto-fade after retry delay
- On load: async `checkForCheckpoint()` — queries `/api/id8r/checkpoint/:id`,
  shows recovery banner with phase summary + age ("saved 12m ago")
- "Show saved research" button: rebuilds research feed cards from checkpoint data,
  marks `researchComplete = true` + enables Continue button if all 3 phases present
- Dismiss button: closes banner, checkpoint stays in DB for next load

---

## What Was Built — Session 23

---

### VaultΩr Semantic Subject Tagging — Complete

**Problem:** 24 clips ingested overnight via Proxy Generator Lite. Without subject tags,
talking-head footage is hard to search or locate meaningfully.

**Philosophy:** Claude Vision already runs at ingest. We just weren't saving the topics it
sees. Adding subjects costs zero extra API calls on new footage, and existing clips can be
backfilled via re-classify (thumbnails already on disk — no re-ingest needed).

**`src/db.js`:**
- Migration: `ALTER TABLE footage ADD COLUMN subjects TEXT` (JSON array, idempotent)
- `insertFootage`: added `subjects` to column list and VALUES
- `updateFootage`: added `subjects` to allowed fields list

**`src/vault/intake.js`:**
- `getVisionPrompt()`: added `subjects` array to Vision JSON spec —
  "3-8 specific searchable tags: 'goat' not 'animal', 'raised garden bed' not 'garden'"
- `insertFootage` call: stores `JSON.stringify(classification.subjects)` on new ingest
- `processProxyUpdate` updateFootage call: stores subjects when proxy links to BRAW
- `reclassifyById` updateFootage call: stores subjects on individual reclassify

**`src/vault/search.js`:**
- Added `subjects TEXT` column to SCHEMA_CONTEXT so Claude generates correct WHERE clauses
- Updated LIKE rules: searches subjects alongside description
- Updated example: "chickens or goats" now searches both columns

**`src/routes/vault.js`:**
- Added `POST /api/vault/reclassify-subjects` SSE endpoint
- Finds all footage where `subjects IS NULL` but `thumbnail_path` exists
- Calls `reclassifyById` on each — no file touching, uses existing thumbnails
- Streams `start / tagging / tagged / done / error` events

**`public/vault.html`:**
- "⟳ Tag Subjects" button in FOOTAGE LIBRARY section header
- Live progress counter ("Tagging 3 / 24…") via SSE ReadableStream
- On done: reloads footage grid so subject pills appear immediately
- Subject pills render on every card (up to 5 tags, small gray chips)
- Folder path input now pre-fills from `/api/vault/watcher` on load (no more hardcoded path)
- `prefillWatcherPath()` called at DOMContentLoaded

---

### creator-profile.json JSON Parse Fix

**Problem:** User set `intake_folder` to `D:\1 .braw watch folder` but `\1` is an
invalid JSON escape sequence. Server silently fell back to old `D:/kre8r/intake` path.
Server also had a stale node process holding port 3000 across PM2 restarts.

**Fix:**
- Corrected `D:\1 .braw watch folder` → `D:\\1 .braw watch folder` in creator-profile.json
- Killed stale PID via PowerShell `Stop-Process -Force`
- Restarted PM2 — watcher now confirms `D:\1 .braw watch folder`

---

### DaVinci Proxy Generator Lite Workflow — Confirmed Working

- Proxy Generator watches `D:\1 .braw watch folder` (source BRAW location)
- Generates `.mov` proxies with same base name as original
- VaultΩr watcher has `depth: 5` — picks up proxies in DaVinci subfolders automatically
- `findBrawByBasename()` links proxies back to BRAW records by filename stem
- Result: 24/24 proxies ingested overnight with zero intervention ✓

---

## Next Session — Priority Order

### 1. Soul Builder Onboarding Wizard (`/setup.html`)
Full UI wizard that writes creator-profile.json through plain-English steps.
No JSON, no typed paths — native folder pickers (Electron), OAuth buttons,
dropdowns for camera type. Each step has a "why this matters" explanation.
Steps: Who are you → Voice → Footage folders → Camera type → Platform connections
→ Community tiers → Done (writes profile, starts watcher, shows dashboard).

### 2. Pipeline Tour
Interactive overlay walkthrough — 8 stops following the creative thread from
idea to posted. Triggered on first login, re-triggerable via "?" in nav.
Written the way you'd explain it to Cari. Plain English throughout.

### 3. Deploy to DigitalOcean (subjects + watcher path fix)
```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

### 4. AssemblΩr end-to-end test with today's Cari/Jason dialogue footage
First real in-pipeline shoot. SCRIPTED mode, alternating beats.
Watch beat_mapped SSE events closely — first multi-person assembly.

### 5. MirrΩr Content Universe rebuild + NorthΩr first strategy run
(UI tasks — user does these)

---

## Session Notes

- This session was context-summarized once mid-session
- Restart count on PM2 is high (60+) due to the stale process crash loop — not a sign
  of instability, just accumulated from the port conflict troubleshooting
- TODO.md needs update next session (Soul Builder + Tour added as top priorities)

---


---

## Session 33 — Electron Desktop App: Working on Laptop

**Date:** 2026-04-11

### What We Did

Debugged and fixed the Electron desktop app end-to-end. After 3 previous failed
builds (white screen, then module errors), the app now boots and runs on Jason's
laptop. Three root causes were found and fixed in sequence:

---

**Root Cause 1 — `!node_modules` excluded all dependencies from the asar**

The `files` array in package.json had `"!node_modules"` which silently stripped
every npm dependency from the packaged app. First error: `Cannot find module 'dotenv'`.
Fix: removed the exclusion. electron-builder handles node_modules automatically.

**Root Cause 2 — server.js was unpacked but node_modules were not**

Initially server.js was in `asarUnpack` (real file on disk) but its dependencies
stayed inside the asar. Node's module resolution can't bridge that gap.
Fix: moved server.js back into the asar. Load via `app.getAppPath()` — Electron's
asar interception handles all `require()` calls transparently. Only native binaries
(better-sqlite3, ffmpeg, ffprobe) need to be real files (asarUnpack).

**Root Cause 3 — better-sqlite3 ABI mismatch (NMV 137 vs 145)**

Electron 41's runtime uses NMV 145 (its own ABI, separate from Node 24's 137).
`@electron/rebuild` was building from source using system Node headers (NMV 137)
because `~/.electron-gyp` wasn't being populated with Electron's headers.
The correct prebuilt (`better-sqlite3-v12.8.0-electron-v145-win32-x64`) exists
and was cached by npm. Fix: `prebuild-install --runtime electron --target 41.1.1`
fetches the correct binary. `npmRebuild: false` in electron-builder config prevents
it from overwriting it. `scripts/prebuild-sqlite.js` runs as part of `dist:win`.

---

### Diagnostic Tooling Added

Added `dialog.showErrorBox()` on the 15-second server timeout — shows actual stderr
from the server process instead of silently opening a blank white window. This is
what enabled diagnosing all three root causes from the laptop without DevTools.

---

### Files Changed

- `electron/main.js` — load server via `app.getAppPath()`, diagnostic error dialog,
  stderr buffer collection, `utilityProcess.fork()` retained
- `package.json` — removed `!node_modules`, removed server.js/src from asarUnpack,
  `npmRebuild: false`, `prebuild-sqlite` script added to dist:win
- `scripts/prebuild-sqlite.js` — new script, installs correct Electron 41 prebuilt
  for better-sqlite3 before every dist:win build

---

### Result

- Login screen appears on first launch ✓
- Server starts, DB initialises, session auth works ✓
- Default credentials: jason / kre8r2024
- Deployed to kre8r.app ✓

---

## Next Session — Priority Order

### 1. Soul BuildΩr Onboarding Wizard (`/setup.html`)
Full UI wizard that writes creator-profile.json through plain-English steps.
No JSON, no typed paths — native folder pickers (Electron), OAuth buttons,
dropdowns for camera type. Each step has a "why this matters" explanation.

### 2. Pipeline Tour
Interactive overlay walkthrough — 8 stops following the creative thread.
Triggered on first login, re-triggerable via "?" in nav.

### 3. MirrΩr bugs
`no such column: pr.angle` DB error and `TypeError: Assignment to constant variable`
in mirrr.js — both pre-existing, need fixing before commercial launch.

### 4. Email API decision
Kajabi broadcast API: ask support if on roadmap.
If no → build Mailerlite integration in MailΩr (one session).

### 5. App size optimisation (238MB)
Main culprits: playwright (~100MB+), sharp. Playwright can move to devDependencies
if Kajabi automation isn't used in the packaged app. Investigate before next build.

