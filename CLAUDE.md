# Kre8Ωr — Claude Code Session Context

## What This Project Is
Kre8Ωr is a complete AI-native content production OS for solo creators. Built
for 7 Kin Homestead — an off-grid homesteading creator with 725k TikTok, 54k YouTube,
80k Lemon8, and a paid Kajabi community called ROCK RICH. Built in ~3 weeks with
Claude Code. No prior coding experience.

The system eliminates the administrative layer between having an idea and that idea
reaching an audience. Every feature must protect the creator's creative thread and
reduce decisions, never add them.

## Prime Directive
**Never lose creative state. Never break the creative thread without a recovery path.**

A creator's momentum, context, and direction are the most valuable things in the
system. Code, data, and features exist to protect them. When anything fails — API
call, crash, network drop, wrong button — the creator should be able to pick up
exactly where they were, with everything intact.

Ask of every feature and every failure mode: *if this goes wrong right now, what
does the creator lose, and how do they get it back?* If the answer is "they lose
everything and start over" — redesign it.

## Secondary Directive
Does this feature reduce the number of decisions the creator has to make, or does it
add one? If it adds one — redesign it.

Decision count matters, but it is downstream of the Prime Directive. A feature that
adds zero decisions but silently destroys creative state on failure violates the
Prime Directive. Protect the thread first. Minimize decisions second.

## The Engine vs Soul Principle
Engine (pipeline logic) is always separate from Soul (creator-profile.json).
creator-profile.json is the injectable "soul" of any instance — voice profiles,
community tiers, content angles, platform data, vault paths. This is the foundation
of future multi-tenancy. Never hardcode creator-specific data anywhere in the engine.

## Tech Stack
- Runtime: Node.js 18+
- Server: Express.js on port 3000
- Database: SQLite via better-sqlite3 (synchronous, WAL mode, file-based)
- AI: Anthropic Claude API (claude-sonnet-4-6), shared caller in src/utils/claude.js
- Video processing: ffmpeg + ffprobe via ffmpeg-static + ffprobe-static (bundled cross-platform binaries)
  FFMPEG_PATH / FFPROBE_PATH env vars bootstrapped in server.js — set before any route loads
- Transcription: Whisper (local Python)
- DaVinci integration: Python scripting API (port 9237, Local mode, Windows only)
- Music: Suno API (when configured) or Prompt Mode
- Social publishing: Meta Graph API (Instagram/Facebook), YouTube Data API v3
- ngrok: video/image tunnel for Meta API uploads (NGROK_AUTHTOKEN in .env, required for Instagram + FB image posts)
- Email: MailerLite v2 API (src/routes/mailerlite.js) — broadcast send + scheduling
- Audience: Kajabi Public API (OAuth2 client_credentials)
- Auth: express-session + better-sqlite3 session store, bcrypt password hashing
- Frontend: Vanilla HTML/CSS/JS, dark theme, teal (#14b8a6) accents
- Desktop: Electron (electron/main.js) — wraps Express server, 5-min rolling SQLite backup
- Process manager: PM2 (local dev / DigitalOcean)

## CRITICAL DATABASE RULE
Kre8Ωr uses better-sqlite3 — synchronous, file-based SQLite with WAL mode.
NEVER edit the .db file directly with sqlite3 CLI or any external tool while
the server is running. All reads and writes MUST go through the live server API.
Direct edits to the file while the server holds a WAL lock can corrupt data.

## Project Structure
- `server.js` — Express server, mounts all routes
- `src/db.js` — SQLite database, all migrations
- `src/routes/` — API route handlers (one file per module)
- `src/vault/` — VaultΩr intake, watcher, search, organizer
- `src/editor/` — SelectsΩr v2 engine, b-roll bridge
- `src/composor/` — ComposΩr scene analyzer, Suno client
- `src/writr/` — WritΩr script generation, voice analyzer
- `src/pipr/` — PipΩr beat tracker, config
- `src/postor/` — PostΩr publishing engine: meta.js, youtube.js, queue-processor.js, video-tunnel.js
- `src/utils/claude.js` — Shared Claude API caller (use this everywhere)
- `src/utils/sse.js` — SSE helpers (attachSseStream, startSseResponse) — use for all SSE endpoints
- `src/utils/logger.js` — pino logger — use everywhere, never console.error in new code
- `src/utils/profile-validator.js` — load/validate creator-profile.json — never raw JSON.parse
- `scripts/davinci/` — Python scripts for DaVinci Resolve integration
- `public/` — All frontend HTML files (one per module)
- `public/js/nav.js` — Shared nav component (kre8r-nav div + initNav())
- `electron/main.js` — Electron main process (wraps Express, opens BrowserWindow)
- `database/` — SQLite db file + kre8r-electron-backup.db (5-min rolling backup)
- `creator-profile.json` — Soul config for 7 Kin Homestead instance
- `DEVNOTES.md` — Critical dev notes including DB write rule
- `OPUS_REVIEW.md` — First senior architecture review (Sessions 1–24)
- `OPUS_REVIEW_V2.md` — Second Opus review (Sessions 25–31, pre-V1.0 desktop app)

## Full Pipeline (Current Build State)

### PRE-PRODUCTION
✅ SeedΩr (`/seedr.html`) — Idea vault. `ideas` table: title, concept, angle, notes, status.
   Bulk entry mode (paste 23 ideas → AI parses all). "Promote to Project" → pre-fills PipΩr.
   ConstellΩr view: Three.js 3D constellation graph, semantic clusters, color-coded by angle.
   Ideas persist forever, never tied to a session.

✅ Id8Ωr (`/id8r.html`) — Ideation engine. 3 modes: Shape It / Find It / Deep Dive.
   Conversation → sequential web research → package (3 titles, 3 thumbnails, 3 hooks)
   → Vision Brief → pipeline handoff to PipΩr/WritΩr.
   Session persisted in sessionStorage. Known issue: rate limiting on research phase.
   REDESIGN PLANNED: cut mind map, add fast concept pass → creator chooses → deep research.

✅ PipΩr (`/pipr.html`) — Project creation, story structure (Save the Cat / Story Circle
   / VSL / Freeform / SHORT FORM), beat map, pipeline state tracking.
   Short-form sub-structures: Hook→Tension→Payoff, Open Loop, PAS, Before→Bridge→After, etc.

✅ WritΩr (`/writr.html`) — Script generation in Jason's actual voice using analyzed
   voice profiles. 3 modes: full script / bullets / hybrid. Voice blend slider.
   Beat cards show emotional_function descriptions. Short-form mode: 150–300 words, timing per beat.

✅ DirectΩr (`/director.html`) — Shot list and crew brief generation.

✅ ShootDay (`/shootday.html`) — Day-of checklist, offline QR package for Cari's phone.

✅ TeleprΩmpter (`/teleprompter.html`) — 3-device system: display / control / voice.
   QR codes on setup screen for voice device and control device (deep-link with ?mode=).
   Voice device: mic drives scroll speed. Session code required on voice device load.
   Field workflow: Phone 1 hotspot → teleprompter.kre8r.app for all 3 devices.
   Known issues: Solo tab crashes app; no back button from display screen.

### PRODUCTION
- Blackmagic camera shoots .braw files
- BRAW files go to: H:\ (camera SSD) or production folder
- Proxy export: DaVinci → H.264 MP4 → D:\kre8r\intake → VaultΩr watcher picks up

### POST-PRODUCTION
✅ VaultΩr (`/vault.html`) — Footage intelligence database. Watches D:\kre8r\intake.
   Supports: talking-head, b-roll, action, dialogue, completed-video, unusable.
   BRAW proxy workflow: BRAW record created → DaVinci exports proxy → proxy links back
   to BRAW record via _proxy.mp4 naming convention (findBrawByBasename).
   Voice analysis button on completed-video cards → feeds WritΩr voice library.
   Subject/topic search not yet implemented (planned).

✅ EditΩr (`/editor.html`) — SelectsΩr v2 engine (selects-new.js).
   Three shoot modes: SCRIPTED / HYBRID / FREEFORM.
   Decision gate: classifies clips by shot_type before any selection logic.
   Accepts both talking-head (hyphen) and talking_head (underscore) — normalized at intake.
   Confidence check removed — routes purely on shot_type.
   Known issue: proxy_path must be set before transcription can run.

✅ ReviewΩr (`/reviewr.html`) — Rough cut approval UI. Pure rough cut approval only.
   Selects list (approve/skip/reorder), extract approved clips (ffmpeg stream copy).
   CutΩr removed from ReviewΩr — now lives in ClipsΩr.

✅ ComposΩr (`/composor.html`) — Scene analysis, Suno prompt generation.

✅ ClipsΩr — Viral clip extraction. Accepts approved cuts from ReviewΩr.
   For short-form: role flips to validator (checks hook timing, retention arc, CTA, loop-ability).
   `cuts` table + `/api/cutor/` routes.
   ClipsΩr → CaptionΩr → PostΩr is the short-form exit path.

### DISTRIBUTION
✅ GateΩr (`/m1-approval-dashboard.html`) — Community gating.
✅ PackageΩr (`/m2-package-generator.html`) — Platform packaging.

✅ CaptionΩr (`/m3-caption-generator.html`) — AI captions per platform (TikTok, Instagram,
   Facebook, YouTube, Lemon8). Per-clip results. "📤 Send to PostΩr" button on each clip:
   writes { ig_caption, fb_caption, description, clip_label } to localStorage → opens PostΩr
   in new tab → PostΩr reads + clears on load (one-shot prefill, zero copy/paste).

✅ MailΩr (`/mailor.html`) — Broadcast A/B emails, blog posts, community posts, Facebook posts.
   Voice blend slider. Kajabi connection banner. Blog + community post checkboxes.
   📘 Facebook Post checkbox: Claude generates FB caption + hashtags → editable card with
   Post Now or Schedule tabs → calls /api/postor/fb-post or /api/postor/queue.
   Email send: MailerLite v2 API. "Send in ~10 min" or "📅 Schedule" tabs with date/time picker
   and quick buttons (+1d/+2d/+3d/+1wk). sends_at ISO string passed to /api/mailerlite/send.
   Old M4 page still exists at /m4-email-generator.html (legacy, keep for now).

✅ PostΩr (`/postor.html`) — Multi-platform social publishing.
   Platforms live: YouTube ✅, Facebook video ✅, Facebook text/image post ✅, Instagram Reels ✅
   TikTok: pending Content Posting API access.
   Post Now / 📅 Schedule toggle. Schedule: queue table + 60s processor (setInterval in server.js).
   Week/day calendar view with status-coded chips (pending/posting/posted/failed). Cancel option.
   CaptionΩr prefill: reads localStorage.captionr_prefill on load, auto-fills ig-caption,
   fb-description, description fields, clears entry immediately (one-shot).
   ngrok tunnel (video-tunnel.js / createFileTunnel): spins up per-upload HTTP server + ngrok
   tunnel so Meta API can reach local files. Required for Instagram and Facebook image posts.
   `src/postor/`: meta.js (Instagram + Facebook), youtube.js (YouTube), queue-processor.js,
   video-tunnel.js (createFileTunnel — supports video + image MIME types).
   DB: postor_queue table (id, video_path, image_path, platforms JSON, captions, scheduled_at, status).
   Connections stored in postor_connections table (youtube, facebook, instagram).

✅ AudiencΩr (`/audience.html`) — Kajabi contacts, tags, offers, broadcast-tag SSE.
   Contacts load via GET /contacts (no pagination params — Kajabi returns all at once).
   Tag filter: known issue, Kajabi 500s on filtered requests.

### ANALYTICS & INTELLIGENCE
✅ MirrΩr (`/mirrr.html`) — YouTube Analytics. 313 videos, 2504 metrics synced.
   `viral_clips` table. Click-to-edit on clip cards (hook, why_it_works, caption, hashtags).
   Auto-save on blur → PATCH /api/mirrr/viral-clips/:id.
   MirrΩr calibration context injected into WritΩr and Id8Ωr prompts.

✅ NorthΩr (`/northr.html`) — Creator dashboard. Email performance (last 5 campaigns,
   open/click rates). Publishing calendar (real publish dates). Days Since Last Email.
   Evaluate Last Month: score + weight badges. Copyright Health stats (planned — MarkΩr/GuardΩr).

### INFRASTRUCTURE
✅ Auth (`/login`) — Session-based login (express-session + better-sqlite3 store).
   `users` table (bcrypt passwords), `sessions` table. Owner / viewer roles.
   First run: seeds default owner from KRE8R_OWNER_PW env var.
   kre8r.app protected by this auth (replaces old nginx basic auth).

✅ SyncΩr (`/sync.html`) — Cross-device project sync.
   `src/routes/local-sync.js` — local proxy (config, push, pull, import).
   createProjectFromSnapshot: non-destructive, ID-preserving import.
   Desktop → kre8r.app → Laptop confirmed working end-to-end.

✅ Electron Desktop App — `electron/main.js` wraps Express server in BrowserWindow.
   Setup wizard on first run (getUserCount() === 0 → /setup). Diagnostic error dialog on failure.
   5-min rolling SQLite backup → database/kre8r-electron-backup.db.
   Installer: `npm run dist:win` → `dist/Kre8Ωr Setup 1.0.0.exe` (~238MB).
   `window.__KRE8R_ELECTRON` flag set by main.js — use this to detect Electron context in frontend.

## Creator Profile
**Jason Rutland** — 7 Kin Homestead
- Voice: Straight-talking, warm, funny, never corporate. "Sharp-tongued neighbor
  talks over a fence." Goes off-script often — those moments are frequently better.
- 6 analyzed voice profiles from real videos in WritΩr voice library
- Partner: Cari — camera operator and director. Cari profile planned for Rock Rich Shows.
- Kids: 5. House: 700 sq ft. Shoots outdoors only.

## Content Angles (creator-profile.json)
- `financial` — Real numbers, cost breakdowns, ROI math
- `system` — System Is Rigged, opt out and win
- `rockrich` — Rock Rich Episode: doing a lot with a little. Resourcefulness as superpower.
  **SHOW FORMAT**: Gold Rush meets How the Universe Works, off-grid edition.
  Narrative spine: "Today Jason set out to ___ and the environment ___ed him."
  Short doc style. Tension arc. Discovery Channel DNA.
  Rock Rich Episodes planned to be heavily produced again using Kre8Ωr tools.
  Format analysis pipeline planned: analyze 3-4 best episodes → store as format profile.
- `howto` — Practical how-to, step by step
- `mistakes` — Hard-won lessons
- `lifestyle` — Day in the life on the homestead
- `viral` — High curiosity, counterintuitive, scroll-stopping

## ROCK RICH Community (Kajabi)
- The Greenhouse 🌱 — free tier
- The Garden 🌿 — $19/month
- The Founding 50 🏆 — $297 one-time (limited spots, inner circle)
- Kajabi API: OAuth2 connected. Contacts/tags/offers live. Broadcasts: copy/paste only
  (Kajabi API has no broadcast endpoint yet).

## Camera and Footage
- Primary: Blackmagic (shoots .braw) — BRAW requires DaVinci proxy export before processing
- Proxy output: D:\kre8r\intake (VaultΩr watcher)
- Production footage: H:\ (camera SSD, external)
- Large archive: D:\ (Big Ol' Storage Drive — all VaultΩr paths point here)
- Main drive C:\ has limited space — never write footage or proxies there

## DaVinci Integration (Windows only)
- Resolve Studio 20.3.2.9 must be running before any DaVinci API calls
- Python path detection: detectPython() tries python3, python, py in order
- All 6 Python scripts use callable() guards for Resolve 20 API compatibility
- stdout = JSON only, stderr = logs (Node.js reads stdout)
- create-project.py known issue: defaults to 4K DCI instead of reading footage resolution
- Unicode charmap fix applied: encoding="utf-8" in metadata doc write

## Nav Component
Every HTML page must use:
```html
<div id="kre8r-nav"></div>
<!-- at bottom of body: -->
<script src="/js/nav.js" defer></script>
<script>window.addEventListener('load', () => initNav())</script>
```
NOT <nav id="main-nav"> — that pattern doesn't work.

## Coding Conventions
- Use async/await throughout, never callbacks
- Always use try/catch on database operations
- SSE for all long-running operations — never block HTTP response
- Rate limit Claude Vision: max 3 concurrent, 1 second between batches
- All DB writes must go through live server API (see CRITICAL DATABASE RULE)
- Use src/utils/claude.js for all Claude API calls — never inline the fetch
- Shared callClaude(prompt, maxTokens = 8192) — always pass explicit maxTokens
- Never hardcode creator data — always read from creator-profile.json
- All SSE endpoints must use src/utils/sse.js (attachSseStream or startSseResponse)
- Load/validate creator-profile.json through src/utils/profile-validator.js — never raw JSON.parse
- Log errors via src/utils/logger.js (pino) — never console.error in new code
- Commit at end of every session with SESSION-LOG.md updated

## Known Issues / Technical Debt (Priority Order)
1. Id8Ωr redesign: cut mind map, add fast concept pass → choose → deep research
2. VaultΩr subject/topic tagging for semantic search
3. AudiencΩr tag filter (Kajabi 500 on filtered requests)
4. BRAW proxy timeout — 30min per job too short for large files
5. Project resolution defaults to 4K DCI instead of reading footage resolution
6. ~~No automated tests, no error monitoring, no structured logging~~ — FIXED Session 32 (pino logging, test-sse.js, DIAG button)
7. ~~No backup strategy for SQLite file~~ — Electron 5-min rolling backup to database/kre8r-electron-backup.db
8. ~~Hardcoded Windows paths~~ — FIXED Session 31 (DB_PATH, FFMPEG_PATH, CREATOR_PROFILE_PATH all env-var driven)
9. Whisper model download has no progress indicator on first transcription run (looks like hang)
10. ~~MirrΩr: `no such column: pr.angle` and `TypeError: Assignment to constant variable`~~ — FIXED
11. TeleprΩmpter: Solo tab crashes the app — Solo tab Cloud Launch breaks teleprompter, requires full restart
12. TeleprΩmpter: No back button from display screen — only exit is "📋 Scripts" button (hidden by default)
13. PostΩr: TikTok platform stub — wired in UI but pending TikTok Content Posting API access approval

## Planned Features (Not Yet Built)
- MarkΩr + GuardΩr — Copyright protection + community enforcement (spec in TODO.md, build plan: 3 sessions)
- TikTok Content Posting API — pending access for @7.kin.jason
- Rock Rich Episode format profile (analyze best episodes → WritΩr show mode)
- Cari creator profile (second voice profile for Rock Rich Shows)
- RetentΩr — viral clip / retention cut module (post-edit, split from SelectsΩr)
- AffiliateΩr — track links, commissions, video placement, performance
- VaultΩr subject/topic tagging at ingest for semantic search
- Analytics feedback loop (TikTok/YouTube performance → Id8Ωr recommendations)
- Multi-tenant creator profiles (auth infrastructure in place, tenant isolation not built)
- Playwright automation for Kajabi (broadcasts, sequences, community posts)
- Android APK for field TeleprΩmpter (zero-signal fallback, sideload)
- NotebookLM/Gamma integration in Id8Ωr research phase
- Configurable workflow order (onboarding wizard)

## Commercialization Notes
- kre8r.app — live on DigitalOcean, SSL, nginx, session-based auth (owner login via KRE8R_OWNER_PW)
- Deploy: cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master &&
  sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
- DigitalOcean console more reliable than SSH
- Domain: kre8r.app (purchased)
- GitHub: github.com/7kinhomestead/kre8r (private, master branch)
- Target: use it publicly → document publicly → find operator partner
- Founding 50 developer member also interested
- Read OPUS_REVIEW_V2.md for current senior architecture assessment (updated pre-V1.0)

## Session Start Checklist
1. Read SESSION-LOG.md and TODO.md
2. Read OPUS_REVIEW_V2.md for architectural context (current); OPUS_REVIEW.md for original
3. Check PM2 status: pm2 status
4. Open DaVinci Resolve if doing video work
5. Confirm VaultΩr watcher path in startup log (should say D:/kre8r/intake)
6. Tell creator current state and ask what to hit first
