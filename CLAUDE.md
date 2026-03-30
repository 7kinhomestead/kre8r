# Kre8Ωr — Claude Code Session Context

## What This Project Is
Kre8Ωr is a complete AI-native content production OS for solo creators. It is built
for 7 Kin Homestead — an off-grid homesteading creator with 725k TikTok, 54k YouTube,
80k Lemon8, and a paid Kajabi community called ROCK RICH.

The system eliminates the administrative layer between having an idea and that idea
reaching an audience. Every feature must reduce decisions for the creator, never add them.

## Prime Directive
Does this feature reduce the number of decisions the creator has to make, or does it
add one? If it adds one — redesign it.

## Tech Stack
- Runtime: Node.js (ES modules where possible)
- Server: Express.js on port 3000
- Database: SQLite via sql.js with persist-to-disk
- AI: Anthropic Claude API (claude-sonnet-4-6)
- Video processing: ffmpeg + ffprobe (local)
- Transcription: Whisper (local Python)
- DaVinci integration: Python scripting API (port 9237, Local mode)
- Music: Suno API (when configured) or Prompt Mode
- Frontend: Vanilla HTML/CSS/JS, dark theme, teal (#00C9A7) accents

## Project Structure
- `server.js` — Express server, mounts all routes
- `src/db.js` — SQLite database, all migrations
- `src/routes/` — API route handlers
- `src/vault/` — VaultΩr intake, search, organizer
- `src/editor/` — EditΩr selects engine, b-roll bridge
- `src/composor/` — ComposΩr scene analyzer, Suno client, prompt writer
- `scripts/davinci/` — Python scripts for DaVinci Resolve integration
- `public/` — All frontend HTML files
- `database/` — SQLite db file and schema
- `docs/` — System Bible, workflow docs, setup guides
- `creator-profile.json` — Soul config for 7 Kin Homestead instance

## Creator Voice Profile
Straight-talking, warm, funny, never corporate, mission-driven, slips jokes in to
cut tension. "Most unserious serious person to ever make a video." Goes off-script
often — those moments are frequently better than the scripted version.

## Content Angles
- Financial Take: ROI, real numbers, cost breakdowns
- System Is Rigged: opt out and win
- Rock Rich Episode: doing a lot with a little

## ROCK RICH Community (Kajabi)
- The Greenhouse 🌱 — free tier (tag: greenhouse)
- The Garden 🌿 — $19/month (tag: garden)
- The Founding 50 🏆 — $297 one-time (tag: founding-50)

## Camera and Footage
- Primary camera: Blackmagic (shoots .braw)
- Proxy workflow: DaVinci exports H.264 QuickTime proxies to intake folder
- VaultΩr watches: `C:/Users/18054/Videos/intake`
- External drives: H drive for production footage
- 17TB archive drive for raw footage storage

## Pipeline Stages (Current Build State)
✅ Phase 1: M1-M4 distribution tools connected
✅ VaultΩr: footage ingestion, classification, BRAW proxy workflow
✅ DaVinci integration: project creation, color space, bin structure, timelines
✅ CutΩr: Whisper transcription, Claude cut identification, clip extraction
✅ ReviewΩr: rough cut approval UI
✅ EditΩr: selects builder, b-roll bridge, DaVinci selects timeline
✅ ComposΩr: scene analysis, Suno prompt generation, manual upload workflow
✅ DistributΩr: PackageΩr, CaptionΩr, MailΩr, GateΩr all connected through database

🔜 Phase 3: Id8Ωr (ideation), DirectΩr (production management)
🔜 Phase 4: PostΩr (automated platform posting)
🔜 Phase 5: OperatΩr (analytics, intelligence)

## Build Rules
- Never copy or move original footage files — VaultΩr stores paths only
- No copy-paste between tools — all data flows through the shared SQLite database
- Every pipeline stage has a defined input, output, and handoff point
- The system is restartable at any stage
- Engine (pipeline logic) is separate from Soul (creator-profile.json) for future commercialization

## Key Files to Read for Context
- `docs/Kre8r-Master-System-Bible-v1.0.pdf` — full architecture reference
- `creator-profile.json` — current instance config
- `database/schema.sql` — full database schema
- `SESSION-LOG.md` — what was built last session
- `TODO.md` — next three tasks

## Coding Conventions
- Use async/await throughout, never callbacks
- Always use try/catch on database operations
- SSE (Server-Sent Events) for all long-running operations — never block the HTTP response
- Rate limit all Claude Vision API calls — max 3 concurrent, 1 second between batches
- All DaVinci Python scripts use `callable()` guards for Resolve 20 API compatibility
- Never hardcode creator-specific data — always read from `creator-profile.json`
- Commit at the end of every session with SESSION-LOG.md and TODO.md updated

## Common Issues and Fixes
- Port 3000 in use: server is already running in another terminal, don't restart
- DaVinci timeline exists error: script now handles with timestamped fallback
- BRAW files show no thumbnail: correct — they need proxy export first
- Whisper only hears "You": wrong clip, likely b-roll misclassified as talking-head
- Claude JSON truncated: max_tokens is 8192 on selects; transcripts auto-trim at 6000 words; JSON repair recovers partial responses

## External Services
- Anthropic API: key in `.env` as `ANTHROPIC_API_KEY`
- Suno API: key in `.env` as `SUNO_API_KEY` (optional — runs in Prompt Mode without it)
- DaVinci Resolve Studio 20.3.2.9 must be running for all davinci scripts
- Python 3.12 at `C:/Users/18054/AppData/Local/Programs/Python/Python312/python.exe`

## Session Start Checklist
1. `cd C:\Users\18054\kre8r`
2. `node server.js` (check port 3000 not in use)
3. Open DaVinci Resolve if doing video work
4. Read `SESSION-LOG.md` and `TODO.md`
5. Tell creator current state and next steps
