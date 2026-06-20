# Kre8Ωr — Claude Code Session Context

## What This Project Is
AI-native content production OS for solo creators. Built for Jason Rutland — 7 Kin Homestead
(725k TikTok, 54k YouTube, 80k Lemon8, ROCK RICH Kajabi community). Built with Claude Code,
no prior coding experience. Eliminates the admin layer between idea and audience.

## Prime Directive
**Never lose creative state. Never break the creative thread without a recovery path.**
Ask of every feature: *if this goes wrong right now, what does the creator lose, and how do they get it back?*

## Secondary Directive
Does this feature reduce decisions or add one? If it adds one — redesign it.

## Engine vs Soul
Engine (pipeline logic) always separate from Soul (creator-profile.json). Never hardcode
creator-specific data. Foundation of future multi-tenancy.

## Tech Stack
- Node.js 18+ / Express on port 3000 / SQLite via better-sqlite3 (WAL mode)
- AI: Anthropic Claude API — shared caller `src/utils/claude.js` (use this everywhere)
- Video: ffmpeg/ffprobe via ffmpeg-static (FFMPEG_PATH/FFPROBE_PATH set in server.js before routes load)
- Transcription: Whisper (local Python). DaVinci: Python scripting API (port 9237, Windows only)
- Social: Meta Graph API, YouTube Data API v3, TikTok (pending review)
- Email: MailerLite v2. Audience: Kajabi Public API + Kajabi MCP (Claude Desktop)
- Auth: express-session + better-sqlite3 store, bcrypt. Frontend: Vanilla HTML/CSS/JS, teal accents
- Desktop: Electron (electron/main.js) wraps Express, 5-min rolling SQLite backup
- ngrok: required for Instagram/Facebook image uploads (NGROK_AUTHTOKEN in .env)

## CRITICAL DATABASE RULE
better-sqlite3 + WAL mode. NEVER edit .db directly while server runs — WAL lock = corruption.
All reads/writes through live server API. Electron DB: `AppData\Roaming\kre8r\kre8r.db` (NOT database/kre8r.db).
**New columns MUST go in BOTH `bootstrapTenantTables()` (tenant DBs) AND `runMigrations()` (Jason's AppData DB). These are separate code paths.**

## Project Structure
- `server.js` — Express, mounts all routes, startup logic
- `src/db.js` — SQLite schema + all migrations
- `src/routes/` — one file per module
- `src/vault/` — VaultΩr: intake.js, watcher.js, transcribe-queue.js, frame-analysis-queue.js
- `src/editor/` — assemblr.js (SelectsΩr v2 engine)
- `src/postor/` — meta.js, youtube.js, queue-processor.js, video-tunnel.js
- `src/utils/claude.js` — shared Claude caller. `src/utils/sse.js` — SSE helpers. `src/utils/logger.js` — pino
- `src/utils/profile-validator.js` — always use this, never raw JSON.parse for creator-profile.json
- `public/js/nav.js` — shared nav component
- `creator-profile.json` — soul config. `DEVNOTES.md` — hard-won fixes. `SESSION-LOG.md` — history

## Pipeline (All Built)
**PRE-PRODUCTION:** SeedΩr (ideas + ConstellΩr) → Id8Ωr (ideation, web research) → PipΩr (project, beat map) → WritΩr (scripts in Jason's voice) → DirectΩr (shot list) → ShootDay → TeleprΩmpter (3-device)

**POST-PRODUCTION:** VaultΩr (footage DB, frame analysis, watcher D:\kre8r\intake) → EditΩr/AssemblΩr (beat-mapped selects, visual perception) → ReviewΩr → ComposΩr → ClipsΩr

**DISTRIBUTION:** GateΩr → PackageΩr → CaptionΩr → MailΩr (MailerLite + blog) → PostΩr (YT/FB/IG/TikTok pending) → AudiencΩr

**ANALYTICS:** MirrΩr (YouTube) → NorthΩr (dashboard) → VectΩr (strategy) → Post-Mortem → StudioΩr

**INFRASTRUCTURE:** Auth, SyncΩr, Electron desktop, CleanΩr, OrgΩr bridge, HarvestΩr bridge, AffiliateΩr, MarkΩr/GuardΩr, Privacy/TOS pages

## Key Module Notes

**VaultΩr:** Frame analysis queue: FRAME_ANALYSIS_MODEL (live/Opus) vs BATCH_ANALYSIS_MODEL (batch/Haiku).
`visual_analyzed_at IS NULL` = idempotency cursor for batch. Batch UI panel in vault.html above Footage Library.
BRAW proxy: findBrawByBasename, _proxy.mp4 convention. Watcher: D:\kre8r\intake, depth 5.

**AssemblΩr:** 2-call architecture. Call 1: maps beats + injects visual_description signals (⚡ peak energy zone, b-roll anchors). Call 2: returns coverage_confidence + critique_note. Beat cards show beat_brief badge in editor.html. DB: selects.beat_brief, critique_note, coverage_confidence.

**PostΩr:** TikTok full OAuth+PKCE built, awaiting review. PKCE verifier stored in kv_store (not session) — survives Electron navigation. ngrok tunnel required for Meta uploads. Queue processor: setInterval 60s (⚠️ no overlap guard — see DEVNOTES).

**WritΩr:** Voice calibration from 190 transcripts in data/voice-calibration.json. loadVoiceCalibrationBlock() injected into all 5 prompt builders.

**MailΩr:** MailerLite v2. Blog: TITLE:/--- delimiter format. Push-to-live proxies via INTERNAL_API_KEY.

## Kajabi MCP (Claude Desktop — Session 80)
Site ID: 2148808568. Community ID: 972809 (Rock Rich).
Enable toolsets before use (max 3 active): communities, contacts, analytics, emails, etc.

⚠️ **create_announcement + create_post SILENT SUCCESS BUG:** Both return "Unexpected response shape"
even when they SUCCEED. Post IS created, notifications sent. NEVER retry — check Kajabi admin first.

**Community Game Strategy:** 1,332/1,366 members at progress_score 25 (lurkers). No native Kajabi
"first post" trigger. Solution: tag `lurker-nurture` → nurture sequence → weekly MCP delta check
(score 25→50 = unsub signal). Challenge: Rock Rich Starting Line (ID: deb3ff8d, runs to June 12 2026).
Badge awarded manually at close (Kajabi badge-on-completion feature is buggy). MVPs: Joleen Sims (anchor).
MCP can: read members/posts/challenges, create_post, send_dm, tag/untag contacts, create sequences+emails.

**Bridge Design Spec:** C:/Users/18054/kre8r/BRIDGE-DESIGN-SPEC.md — 46K word Opus spec.
Three Laws: Calm at rest / Shape before number / Never lose the thread.
Contract: "The ship kept the watch. Now the Captain is aboard."
Session roadmap: A(layout✅) → B(instruments✅) → C(skins✅) → D(holograms) → E(living universe) → F(crew)
Skins: public/js/skin-manager.js + public/js/skins/*.js + public/refit-bay.html
Active skins: starfleet-command(free), lcars-classic($10), hearth($12), nostromo(inline), omega-directive(inline)
Key bug: CSS must use var(--mc-bg)/var(--mc-panel) not hardcoded hex for skins to work
SkinManager fix: never call SkinManager.load(default) if localStorage has a saved skin — overwrites preference

**Full community snapshot process (run at start of fresh session):**
1. Enable communities toolset (must re-enable every ~2-3 MCP calls — it evicts)
2. Pull ALL members paginated (list_members, 100/page, sort_by=joined_at_asc, ~14 pages)
   - Results save to tool-results/ files automatically (too large for context)
   - Slim + accumulate to C:/Users/18054/kre8r/scripts/sync-members.json via Bash
   - Extract cursor from each file to continue pagination
3. Transform all members (map onboarding.progress_score, engagement fields)
4. POST to http://localhost:3000/api/community/sync with x-internal-key header
   Body: { members, metrics, snapshot_date, founding50_ids: [], garden_ids: [] }
5. Server auto-detects warm leads, events, tier corrections, score movers

**Tier detection:** list_members has NO access_group_ids filter (earlier note was wrong).
Tiers live as CRM tags on contacts. Tag IDs:
- Founding 50 = 2150101640 (33 members, $297 one-time)
- Garden = 2150101641 (36 members, $19/mo — includes F50 overlap, ~3-4 Garden-only)
- Greenhouse = 2150101628 (1,357 free members)
search_contacts filters are BROKEN in MCP beta (filters_applied: null always).
Tier correction: page contacts client-side, filter by tag name, match by email.
**INTERNAL_API_KEY** is in C:\Users\18054\kre8r\.env

## Creator Profile
**Jason Rutland** — 7 Kin Homestead. Voice: straight-talking, warm, funny, never corporate.
"Sharp-tongued neighbor talks over a fence." Goes off-script — those moments are often better.
Partner: Cari (camera). 5 kids. 700 sq ft. Shoots outdoors only.
Content angles: financial, system, rockrich (Gold Rush meets How the Universe Works), howto, mistakes, lifestyle, viral.
ROCK RICH tiers: Greenhouse 🌱 (free) / Garden 🌿 ($19/mo) / Founding 50 🏆 ($297 one-time).
Camera: Blackmagic BRAW → DaVinci proxy → D:\kre8r\intake. Archive: D:\. Never write to C:\.

## Coding Conventions
- async/await everywhere, try/catch on all DB ops
- SSE for all long-running ops — use src/utils/sse.js (attachSseStream or startSseResponse)
- src/utils/claude.js for all Claude calls — never inline fetch. Always pass explicit maxTokens.
- src/utils/logger.js (pino) for errors — never console.error in new code
- Nav pattern: `<div id="kre8r-nav"></div>` + initNav() — NOT `<nav id="main-nav">`
- Never hardcode creator data — always from creator-profile.json via profile-validator.js

## Active Known Issues (not yet fixed)
1. SESSION_SECRET hardcoded fallback in server.js — fail-fast needed before beta
2. PostΩr queue processor no overlap guard — double-fire on slow uploads
3. OAuth tokens plaintext in platform_connections — needs aes-256-gcm
4. Background workers tenant-blind (watcher, queues, cron) — biggest multi-tenancy gap
5. Post-Mortem brief not yet injected into WritΩr/Id8Ωr
6. TikTok app review pending (resubmitted May 7 2026)
7. TeleprΩmpter: no back button from display screen
8. Id8Ωr redesign planned (cut mind map, fast concept pass first)
9. Frame analysis batch on existing 4k clips — run manually in VaultΩr 👁 panel

## Commercialization
- kre8r.app on DigitalOcean. Deploy: `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r`
- GitHub: github.com/7kinhomestead/kre8r (private, master). Domain: kre8r.app.
- OPUS_REVIEW_V3.md — pre-Trav architectural review (co-founder conversation prep).
- Multi-tenancy: request path isolated (AsyncLocalStorage ✅). Background workers NOT yet tenant-aware.

## Session Start Checklist
1. Read SESSION-LOG.md and TODO.md
2. Check PM2 / confirm Electron is running
3. Tell creator current state, ask what to hit first
