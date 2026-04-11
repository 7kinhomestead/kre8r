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
- Audience: Kajabi Public API (OAuth2 client_credentials)
- Frontend: Vanilla HTML/CSS/JS, dark theme, teal (#14b8a6) accents
- Process manager: PM2

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
- `src/utils/claude.js` — Shared Claude API caller (use this everywhere)
- `scripts/davinci/` — Python scripts for DaVinci Resolve integration
- `public/` — All frontend HTML files (one per module)
- `public/js/nav.js` — Shared nav component (kre8r-nav div + initNav())
- `database/` — SQLite db file
- `creator-profile.json` — Soul config for 7 Kin Homestead instance
- `DEVNOTES.md` — Critical dev notes including DB write rule
- `OPUS_REVIEW.md` — First senior architecture review (Sessions 1–24)
- `OPUS_REVIEW_V2.md` — Second Opus review (Sessions 25–31, pre-V1.0 desktop app)

## Full Pipeline (Current Build State)

### PRE-PRODUCTION
✅ Id8Ωr (`/id8r.html`) — Ideation engine. 3 modes: Shape It / Find It / Deep Dive.
   Conversation → sequential web research (120s between phases) → package
   (3 titles, 3 thumbnails, 3 hooks) → Vision Brief → pipeline handoff to PipΩr/WritΩr.
   Session persisted in sessionStorage. Known issue: rate limiting on research phase.
   REDESIGN PLANNED: cut mind map, add fast concept pass → creator chooses → deep research.

✅ PipΩr (`/pipr.html`) — Project creation, story structure (Save the Cat / Story Circle
   / VSL / Freeform), beat map, pipeline state tracking.

✅ WritΩr (`/writr.html`) — Script generation in Jason's actual voice using analyzed
   voice profiles. 3 modes: full script / bullets / hybrid. Voice blend slider.
   Beat cards show emotional_function descriptions.

✅ DirectΩr (`/director.html`) — Shot list and crew brief generation.

✅ ShootDay (`/shootday.html`) — Day-of checklist, offline QR package for Cari's phone.

✅ TeleprΩmpter (`/teleprompter.html`) — 3-device system: display / control / voice.
   QR codes on setup screen for voice device and control device (deep-link with ?mode=).
   Voice device: mic drives scroll speed. Session code required on voice device load.

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

✅ ReviewΩr (`/reviewr.html`) — Rough cut approval UI.

✅ ComposΩr (`/composor.html`) — Scene analysis, Suno prompt generation.

### DISTRIBUTION
✅ GateΩr (`/m1-approval-dashboard.html`) — Community gating.
✅ PackageΩr (`/m2-package-generator.html`) — Platform packaging.
✅ CaptionΩr (`/m3-caption-generator.html`) — AI captions per platform.
✅ MailΩr (`/mailor.html`) — Broadcast A/B emails, blog posts, community posts.
   Voice blend slider. Kajabi connection banner. Blog + community post checkboxes.
   Old M4 page still exists at /m4-email-generator.html (legacy, keep for now).
✅ AudiencΩr (`/audience.html`) — Kajabi contacts, tags, offers, broadcast-tag SSE.
   Contacts load via GET /contacts (no pagination params — Kajabi returns all at once).
   Tag filter: known issue, Kajabi 500s on filtered requests.

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
- Commit at end of every session with SESSION-LOG.md updated

## Known Issues / Technical Debt (Priority Order)
1. Id8Ωr redesign: cut mind map, add fast concept pass → choose → deep research
2. VaultΩr subject/topic tagging for semantic search
3. AudiencΩr tag filter (Kajabi 500 on filtered requests)
4. BRAW proxy timeout — 30min per job too short for large files
5. Project resolution defaults to 4K DCI instead of reading footage resolution
6. No automated tests, no error monitoring, no structured logging
7. No backup strategy for SQLite file
8. ~~Hardcoded Windows paths~~ — FIXED Session 31 (DB_PATH, FFMPEG_PATH, CREATOR_PROFILE_PATH all env-var driven)
9. Whisper model download has no progress indicator on first transcription run (looks like hang)

## Planned Features (Not Yet Built)
- Rock Rich Episode format profile (analyze best episodes → WritΩr show mode)
- Cari creator profile (second voice profile for Rock Rich Shows)
- Configurable workflow order (onboarding wizard)
- RetentΩr — viral clip / retention cut module (post-edit, split from SelectsΩr)
- CoverageΩr — coverage tracking
- Affiliate link manager
- AffiliateΩr (working name) — track links, commissions, video placement, performance
- NotebookLM/Gamma integration in Id8Ωr research phase
- VaultΩr subject/topic tagging at ingest
- Analytics feedback loop (TikTok/YouTube performance → Id8Ωr recommendations)
- Multi-tenant creator profiles
- Playwright automation for Kajabi (broadcasts, sequences, community posts)

## Commercialization Notes
- kre8r.app — live on DigitalOcean, SSL, nginx, password protected (demo/kre8r2024)
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
