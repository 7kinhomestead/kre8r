# Kre8Ωr — Active TODO
# Full specs and archived tasks → TODO-ARCHIVE.md

---

## 🟢 KAJABI CONVERSION ENGINE — activation next (Session 94, 2026-06-18)
**Memory:** `project_kajabi_game.md` · **Theme zip:** `D:\Downloads\7kin-course-template.zip`

**DONE ✅:** Free course "Rock Rich Starting System" LIVE (3 modules / 10 lessons incl. Freedom Calculator hinge) · reusable data-driven theme · completion beacon baked into theme + verified end-to-end (real member views + completions landing in MissionΩr) · front gate → community funnel.

**NEXT (tomorrow):**
- [ ] **Activation — route the ~1,512 lurkers to the live course.** Front-gate link into the course + a community announcement / DM nudge. This is the real lever now.
- [ ] **Harden the beacon endpoint for production.** Today it only records while Jason's local server + ngrok tunnel are UP (MissionΩr reads the LOCAL Electron DB). Decide: (a) keep the always-on tunnel, or (b) deploy `/api/kajabi-track` to the kre8r.app droplet AND give MissionΩr a droplet read path. Keep tunnel window open meanwhile.
- [ ] **Purge test rows** — add an admin-gated `DELETE /api/kajabi-track/admin` (never touch the WAL DB directly) to clear `DIAGNOSTIC localhost` / `Manual confirm` / `Test Lesson` so MissionΩr's count starts clean.
- [ ] **Tier-pricing thread** — close the $297 one-time Founding 50, add a recurring tier above Garden, annual Garden option.
- [ ] **7-Day Ignition email sequence** + Garden $19 value features.

---

## 🚀 NEXT — kre8r-land BLAST-OFF Phase 2 (flipper supply engine)
**Plan:** `C:\Users\18054\kre8r-land\BLAST-OFF-PLAN.md`
**Phase 0 complete ✅ — Fable verified June 10 2026.**
**Phase 1 complete ✅ — Fable + production verified June 10 2026.**
- Alert emails live via MailerSend, tracking links working, fence ladder gating, verdicts behind ?member=1

### Verdict backfill (run when ready — use limit=20 per call, NOT 50)
```
curl -s -X POST "https://7kinhomestead.land/api/admin/backfill-verdicts?limit=20" -H "x-internal-key: KEY"
```
Call repeatedly until `remaining` → ~0.

### Phase 2 — Inventory engine (seller/flipper supply)
See BLAST-OFF-PLAN.md Phase 2 for full spec. Key items:
- 2.1(b) Validate seller URLs (reject javascript: hrefs)
- 2.1(d) Per-seller daily row cap (2,000/day)
- 2.1(e) Geocode + score seller listings on approve
- 2.2 Flipper outreach kit (TikTok + email template — Jason task)
- 2.3 "Contact about this land" lead capture form on listing detail

### Phase 3 — SEO surface (after Phase 2, Fable designs URLs FIRST)
- Fable designs URL/routing scheme before Sonnet writes any code

### Pre-launch security
- [ ] **Rotate MailerSend API key** (exposed in prior chat session — do this first)

---

## INTEGRATIONS — BACKLOG

### Google Analytics MCP
- Official MCP server from Google (released Mar 2026)
- Install: `pipx run analytics-mcp` — Python 3.10+ required
- Auth: Google Cloud OAuth credentials + `gcloud auth application-default login`
- Add to Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json`)
- Enables: run_report, run_realtime_report, run_funnel_report — query GA4 in conversation
- Use case: track video→site→community conversion path, realtime traffic from launches
- Guide: https://developers.google.com/analytics/devguides/MCP
- **Prereq: confirm GA4 tracking code is live on 7kinhomestead.com / kre8r.app first**

---

## WESTERN SKIN — NEXT SESSION (Session 91)

### 1. Deputy Fitch AIE Architecture Fix (CARRY)
- Dale/Fitch still uses local Claude — has no real task data
- Same pattern as McCandless fix: pass `persona_prefix` to AIE Job 64 endpoint
- Wire in `src/routes/mission.js` dale-chat → proxy to AIE with Fitch persona prompt

### 2. Panels 4 & 6 — Parchment Background (CARRY)
- Audience and Family panels not showing parchment texture in western skin
- Check `[data-skin="western"]` CSS overrides for those panel IDs

### 3. Remaining Cutscene Backlog
- `tax-payment.mp4` — McCandless watches federal tax collector clean out the vault, pours a whiskey, looks at camera
- `brand-deal-arrives.mp4` — Wells Fargo stage coach pulls up, strongbox unloaded at the bank
- `runway-critical.mp4` — Vault door swings open on empty vault, single coin rolls across the floor
- `debt-paid.mp4` — Banker tears up promissory note, drops it in lantern flame, pours two glasses

### ~~video-published cutscene~~ ✅ Done Session 90
- Crew celebration at Belle's: all five toast, Belle winks — `video-publish-cut-scene.mp4`
- Wired via BroadcastChannel from PostΩr → mission-control playPublishCutscene()

---

## 🚀 PRODUCT VISION — NARRATIVE SKIN UNIVERSES (Session 89)

Each skin is not just a visual theme — it is a COMPLETE NARRATIVE UNIVERSE.
The bridge characters, cutscenes, audio, language, and events all swap with the skin.

**Examples:**
- **Starfleet Command** (default) — Number One, Grex, Vaelyn, Dale. Space battle TARGET LOCK. Warp launch on publish.
- **Wild West** — Sheriff is First Officer. Grex becomes a Scrooge-type banker. Vaelyn is the card sharp at the saloon. Dale is the panicked deputy. TARGET LOCK is a gunfight at the OK Corral. Publishing a video = horse galloping off into sunset.
- **Jumanji** — You're trapped in the game. Each metric is a survival challenge. Grex is the game's treasure mechanic. Publishing = escaping a level.
- **Spy Thriller** — Number One is M. Vaelyn is the field operative. Grex is Q (reluctantly giving you gadgets). TARGET LOCK = mission briefing. Warp = extraction.
- **Fabio Romance** (for women-owned businesses) — entire cast and narrative reframes around the romance novel world. The admin becomes the most dramatic part of the day for a completely different reason. 😂

**Architecture:** Already exists in SkinManager's `getCrewPersona()`. Extend to:
- Swap crew MANIFEST (names, titles, clips, voices, colors)
- Swap cutscene files (per-skin cutscenes folder)
- Swap audio hooks (comm chime, alert, victory sound)
- Swap language tokens ("Captain" → "Sheriff", "Target Lock" → "Draw!", "FIRE" → "RIDE!")
- Swap background lore in crew system prompts

**This is the product.** The worst part of running a creator business just became the most interesting part of the day — and it can be ANY story you want.

Add to BRIDGE-DESIGN-SPEC.md Section 4 (Skins). This is the killer differentiator.

---

## NEXT TASKS (Session 71)

### ~~1. Check Apr 30 blog post YouTube embeds~~ ✅ Done Session 71
### ~~2. Blog body editor — verify working~~ ✅ Done Session 71
### ~~3. Restart Electron / voice calibration~~ ✅ Done Session 71
### ~~4. Load Rock Rich email sequences into MailerLite~~ ✅ Done — firing all day
### ~~5. HarvestΩr bridge verify~~ ✅ Live — one member got in with no help, did the thing

---

## COMPLETED THIS SESSION (Session 76) ✅
- ~~AssemblΩr Phase 1: VaultΩr auto-transcription queue~~ ✅ `transcribe-queue.js` + watcher wiring
- ~~AssemblΩr Phase 2: AI assembly re-enabled (Call 2), short-takes prompt, gold merger~~ ✅
- ~~AssemblΩr Phase 3: Two-panel approval UI (Proposed Sequence + All Takes), inline player~~ ✅
- ~~AssemblΩr Phase 4: EditΩr Room persistent chat + BrollΩr context injection~~ ✅
- ~~AssemblΩr Phase 5: DaVinci Output~~ ✅ Already done — build-selects.py handles selected_takes subclips
- ~~Whisper model re-download bug~~ ✅ Fixed with --download-root cache pin

---

## COMPLETED THIS SESSION (Session 77) ✅
- ~~VisualΩr stream fix (revert to --get-url) + merge logic (additive, not replace)~~ ✅
- ~~Vision token ceiling 2048→4096~~ ✅
- ~~Visual Intelligence Profile injected into WritΩr, BrollΩr, EditΩr Room, VectΩr~~ ✅
- ~~WritΩr iterate JSON truncation fix (script-first + regex fallback)~~ ✅
- ~~TikTok PP/TOS app name fix + Kre8Ωr→Kre8r global replace~~ ✅ Resubmitted
- ~~Post-Mortem feature (NorthΩr slide-out panel, Opus chat, brief lock)~~ ✅ Live + tested
- ~~Post-Mortem channel avg bug, transcript URL fallback, brief slice bug~~ ✅ All fixed
- ~~Clear Brief button (amber, shows if active brief exists)~~ ✅

---

## COMPLETED THIS SESSION (Session 78) ✅
- ~~TikTok OAuth PKCE fix~~ ✅ Root cause: TikTok uses hex-encoded SHA256 for code_challenge (not base64url per RFC 7636). Fixed in `src/postor/tiktok.js` `generatePkce()`. OAuth now connects with full scope (user.info.basic, video.publish, video.upload).
- ~~TikTok PKCE session loss fix~~ ✅ Verifier moved from `req.session` to `kv_store` keyed by state with 10-min TTL — survives Electron navigation to external domain and back.

---

## NEXT TASKS (Session 89) — Priority Order

### 1. YouTube Subscriber Count Not Showing in SCIENCE Panel
- `mirrr.js` now writes `yt_channel_stats` to kv_store after every sync ✅
- `getAudienceData()` reads it ✅
- But AUDIENCE panel still shows blank SUBS — may be a `YOUTUBE_CHANNEL_HANDLE` env var missing,
  or the kv key isn't being read correctly in the frontend render path
- Debug: trigger MirrΩr sync, then check `GET /api/mission/dashboard` response for `yt_subscribers`
- Also check: does `YOUTUBE_CHANNEL_HANDLE` exist in AppData .env?

---

## NEXT TASKS (Session 88) — Priority Order

### 1. Session D — Holographic Comm Windows
Per BRIDGE-DESIGN-SPEC.md Section 5.
- Build `CommManager` — singleton video overlay, edge-fade mask, scanline/flicker CSS, entrance static-burst, exit squash animation
- Comm chime / static-hiss audio (ElevenLabs sound generation or stub)
- Wire Number One, Grex, Dale to hologram windows (replace current drawer channels)
- Clip manifests: idle loop + speaking clip per crew member
- Higgsfield for character video generation when ready

### 2. Session B Polish (quick)
- Runway arc still not filling — check OrgΩr predictions endpoint returning runway_months
- Port bank panels still slightly cramped at 280px

### 3. Tertiary Hover Reveals (Session B.5)
Each station gets a mechanical reveal on hover:
- CONN: iris open (clip-path), gate timeline + beat map
- OPS: right-side slide out, 90-day forecast
- TACTICAL: radial expand, events + warm lead DMs
- SCIENCE: sensor scan materialize, per-video analytics
- COMMS: slide down from bottom, near-a-store + price trends
- CREW: holographic expand to portrait frames
- ElevenLabs sound: panel reveal chirp per station

### 4. June 12 Challenge Closeout (URGENT — 11 days)
Pull challenge completers, award badges, draft Garden DMs.

### 5. Session E — Living Three.js Universe
Data-reactive starfield: activity→density, alert→color shift, nebula zones, ship silhouette calm-reward, projects as star systems on trajectory lanes, brand-deals as inbound vessels.

## NEXT TASKS (Session 87) — Priority Order

### 1. Session B Polish — data gaps + panel sizing
- Verify days_since_last_video now populates (backend fix shipped)
- Verify yt_subscribers now populates (fallback lookups added)
- Port bank panel height still slightly cramped — fine-tune flex values
- Runway arc not filling (check runway_months value from OrgΩr predictions)

### 2. Tertiary Hover Reveals (Session B.5)
Per conversation — each panel gets a mechanical reveal on hover/click:
- CONN: iris open (clip-path animation), reveals gate timeline + beat map status
- OPS: right-side slide out into Tactical Table space, reveals 90-day forecast
- TACTICAL: radial expand, reveals community events feed + warm lead DMs
- SCIENCE: sensor scan sweep (line sweeps top-to-bottom), per-video analytics materialize
- COMMS: panel slides down from bottom edge, reveals near-a-store + price trends
- CREW: holographic expand, crew sigils rotate to portrait frames
- Animation language: cubic-bezier(0.16,1,0.3,1) throughout, no bounces, one open at a time
- ElevenLabs Sound Effects API for panel sounds (Session C wire-in)

### 3. Session C — Skins System
SkinManager, token validation, [data-skin] injection, particle-module swap.
LCARS Classic as proof of concept. Refit Bay screen.
ElevenLabs sound generation for comm chimes, static, chirps.

### 4. June 12 Challenge Closeout (10 days away!)
Pull completers via Kajabi MCP, award badges, draft Garden DMs.

### 5. Character casting (pending Jason's decision)
Crew personas for Dale, Science Officer, Tactical Officer, Counselor, Engineer.

## NEXT TASKS (Session 86) — Priority Order

### 1. Session B — Panel Instrument Redesign (OPS + TACTICAL first)
Per BRIDGE-DESIGN-SPEC.md Section 3. The richest data stations first.

**OPS/Business:**
- Runway as 270° fuel gauge arc (needle in red/amber/teal zone)
- Income as live oscilloscope waveform (13 weeks of weekly_gi)
- Bucket shield-bars (5 thin vertical fill bars, floor-alert flashing)
- Crypto lateral bars with coin tickers
- Tax vault shield charge ring with days-to-quarterly countdown

**TACTICAL/Community:**
- Shield-strength ring (three nested arcs: Greenhouse/Garden/Founding50)
- Lurker graduation velocity (members who moved ≥25→>25 in 30d)
- Warm leads with boarding-opportunity framing

**Then:** CONN, SCIENCE, COMMS, ENGINEERING

### 2. Fix port bank panel heights
The port bank panels are a bit cramped at 280px. Consider:
- min-height on each panel adjusted to share port-bank height evenly
- Or: CREW station shrinks further (it doesn't need much space)

### 3. Session C — Skins System
Build SkinManager: token validation, [data-skin] injection, particle-module swap.
Refactor all hardcoded values to CSS custom properties.
Build LCARS Classic as proof of concept.
Build the Refit Bay screen.

### 4. June 12 Challenge Closeout (11 days away)
Pull challenge completers via Kajabi MCP, award badges, draft Garden DMs.

### 5. Character casting decision
The crew character personas (pending Jason's decision after sleeping on it):
- Number One: Riker-archetype (current) — confirm or refine
- Dale: Young Kirk / SNW-era First Officer feel?
- New crew: Science Officer, Tactical Officer, Ship's Counselor, Engineer
See BRIDGE-DESIGN-SPEC.md Section 5 for full crew roster

## NEXT TASKS (Session 85) — Priority Order

### 1. OrgΩr Business Panel — finish wiring
The snapshot endpoint now uses correct URLs/auth. Needs verification after restart.
If still failing: add debug logging to mission.js org proxy to see exact error.
OrgΩr response shape: { balances: { reserves, wages, taxes, ... } } — map correctly.

### 2. KinOS Family Panel — verify after restart
Should be working (schedule/upcoming returns [] for no events = correct).
Confirm panel shows "online" with empty state rather than "offline".

### 3. The Doctor CFO — wire into Mission Control when OrgΩr Plaid build is done
- New comm channel alongside Dale: "⚕ OPEN CHANNEL — THE DOCTOR"
- Business panel upgrades to show real Plaid account balances
- The Doctor character prompt: holographic CMO energy, "Please state the nature of the financial emergency"
- Coordinates with OrgΩr conversation build

### 4. Number One voice tuning
en-GB-RyanNeural is too cheerful. Try en-US-ChristopherNeural or en-US-GuyNeural.
Add SSML rate/pitch adjustments to Edge TTS call for more measured Vulcan delivery.
Set EDGE_TTS_VOICE env var to override without code change.

### 5. Community Game — June 12 challenge closeout (13 days)
Pull challenge completers via Kajabi MCP, award badges, draft personalized Garden DMs.

### 6. Update all kre8r pages to Star Trek HUD aesthetic
Mission Control established the design system. Apply progressively as modules are touched.
CSS variables already defined (--mc-teal, --mc-panel, etc.) — use as design tokens.

## NEXT TASKS (Session 84) — Priority Order

### 1. June 12 Challenge Closeout (TIME SENSITIVE — 13 days)
- Pull list_challenge_entries(challenge_id=deb3ff8d, completed=true) via MCP
- Jason awards Starting Line badge manually in Kajabi
- Tag completers `starting-line-done` + untag `lurker-nurture`
- Draft personalized Garden DMs for each completer (read their entry text, write in Jason's voice)
- Jason reviews + sends via MCP send_dm

### 2. Tag 1,226 Lurkers + Wire the Sequence
- Enable contacts toolset, create `lurker-nurture` tag if it doesn't exist
- Tag all community_members where tier='greenhouse' AND progress_score <= 25
- Jason sets up Kajabi Automation: lurker-nurture tag applied → subscribe to Lurker Nurture sequence
- Build the Lurker Nurture sequence via MCP (3 emails, Day 0/7/12)

### 3. Draft the 19 Warm Lead DMs
- 19 warm leads in DB (24 original minus 5 paying members removed)
- Enable communities toolset → list_posts for each warm lead's recent activity
- Draft personalized Garden DM for each in Jason's voice
- Jason reviews in AudiencΩr → approves → send via MCP

### 4. Mission Control — Wire to Real Data (when ready)
- Replace mock data in mission-control-mockup.html with real fetch calls to /api/mission/snapshot
- Wire dismiss/snooze on attention cards → /api/mission/attention/dismiss
- Rename mockup → production file
- This becomes the default Electron startup route

### 5. SaaS Hardening Quick Fixes
- SESSION_SECRET fail-fast (1 line, server.js)
- PostΩr double-fire guard (5 lines, queue-processor.js)
- app.set('trust proxy', 1) (1 line, server.js)

## NEXT TASKS (Session 83) — Priority Order

### 0. Weekly Community Snapshot (first thing, fresh session)
Same process as Session 82. Say "Run the weekly community snapshot."
This time also page through contacts client-side to correct ~35-37 paying member tiers.

### 1. Tier Correction for ~35-37 Paying Members
Since search_contacts filters don't work (MCP beta bug):
- Page through all contacts (25/page, ~223 pages — OR filter by is_member=true first)
- Client-side filter: contacts with tag "Founding 50 - Member" or "Garden - Member"
- Match to community_members table by email
- Run UPDATE tier on matched records
- Or: add a separate /api/community/update-tiers endpoint that accepts { founding50_emails, garden_emails }

### 2. Tag 1,226 Lurkers with lurker-nurture
- Enable contacts toolset
- Pull community_members where tier='greenhouse' AND progress_score <= 25
- tag_contact each one with lurker-nurture tag (tag ID TBD — create if needed)
- Jason sets up Kajabi Automation: lurker-nurture tag applied → subscribe to Lurker Nurture sequence

### 3. Draft Warm Lead DMs
- 24 warm leads in the DB ready for personalized Garden DMs
- Say "draft warm lead DMs" — I'll read each member's recent posts and write in Jason's voice
- Jason reviews each in AudiencΩr → approves → I send via send_dm

### 4. Build Lurker Nurture Email Sequence via MCP
- create_sequence + add_sequence_email (Day 0/7/12)
- Day 0: "Still thinking about going off-grid?" → Starting Line Challenge CTA
- Day 7: Social proof / community story angle
- Day 12: Last call (challenge closes June 12)

## NEXT TASKS (Session 82) — Priority Order

### 0. FIRST THING — Full Community Snapshot (before reading any files)
Say: "Run the full community snapshot"
- Pull all 1,366 members via Kajabi MCP (14 pages × 100)
- Push to /api/community/sync with INTERNAL_API_KEY
- Warm leads auto-detect, score distribution fills out, Garden pipeline becomes actionable
- Must be done on a fresh context window (context-hungry — 14 MCP pages)

### 1. Build Email Sequences via MCP
- Lurker Nurture sequence (3 emails, Day 0/7/12, Starting Line Challenge CTA)
- New Member Welcome sequence (update/complement MailerLite sequence)
- Use create_sequence + add_sequence_email via Kajabi MCP
- Jason wires one Kajabi Automation: "Tag applied: lurker-nurture → Subscribe to sequence"

### 2. Tag 1,332 Lurkers
- After full sync is done, pull all members with progress_score ≤ 25
- Tag each with `lurker-nurture` via MCP contacts toolset
- This triggers the Kajabi Automation → lurker nurture sequence fires

### 3. June 12 Challenge Closeout Plan
- Pull list_challenge_entries(completed=true) for deb3ff8d
- Jason awards Starting Line badge manually in Kajabi
- I tag completers `starting-line-done` + untag `lurker-nurture`
- Draft personalized Garden DM for each completer (read their entry, write in Jason's voice)
- Jason reviews + sends via send_dm

### 4. Joleen Sims — Community Leader
- Promote in Kajabi admin (Community Settings → Members → Promote)
- I'll draft her a private briefing about the lurker strategy

### 5. SaaS Hardening Quick Fixes (1 session)
- SESSION_SECRET fail-fast (1 line, server.js)
- PostΩr double-fire guard (5 lines, queue-processor.js)
- app.set('trust proxy', 1) (1 line, server.js)

## NEXT TASKS (Session 81) — Priority Order

### 0. OrgΩr Community Manager Hat → MCP Mapping
- Open OrgΩr and grab the community manager hat pack
- Map every function in that hat against what the Kajabi MCP can actually do NOW
- Identify: fully automatable via MCP / needs Jason / needs kre8r integration
- This informs the entire community game strategy going forward

### 1. Rock Rich Community Game — Build the Playing Field
**Tags to create in Kajabi (via MCP contacts toolset):**
- `lurker-nurture` — score 25, hasn't posted
- `starting-line-done` — completed Starting Line Challenge
- `engaged` — score moved to 50+

**Sequences to build (via MCP emails toolset):**
- Lurker Nurture (3 emails, Day 0/7/12, Starting Line CTA)
- New Member Welcome (3 emails, Day 0/3/7)

**Jason does once in Kajabi Automations:**
- "Tag applied: lurker-nurture → Subscribe to Lurker Nurture sequence"

**After sequences are built:**
- Tag all 1,332 score-25 members with `lurker-nurture`
- Weekly check: pull tagged members, find score movers, untag graduates

### 2. kre8r Community Snapshots Table
Wire Kajabi community data into kre8r for historical paper trail:
- New DB table: `community_snapshots` (member_id, progress_score, posts_count,
  comments_count, last_active_at, tag_state, snapshot_date)
- Weekly cron job: pull all members via Kajabi API, store snapshot
- AudiencΩr: show engagement trends, score movers, activation rate
- NorthΩr: community health widget alongside YouTube analytics

### 3. Joleen Sims — Community Leader Role
- She's the anchor: 24 posts, 75 comments, active since day one
- Promote to Community Leader in Kajabi admin
- Create private "Leaders Chat" channel, brief her on the lurker strategy
- I can send her a weekly report of new members worth a personal welcome

### 4. Starting Line Challenge — June 12 Closeout
When challenge ends June 12:
- I pull list_challenge_entries(completed=true)
- Jason awards Starting Line badge manually in Kajabi to completers
- I tag completers `starting-line-done` and untag from `lurker-nurture`
- Review: how many of the 1,332 lurkers converted?

## NEXT TASKS (Session 80) — Priority Order

### 1. SaaS Hardening — Quick Fixes (1 session, all low-risk)
Surfaced by OPUS_REVIEW_V3.md. Do these before showing Trav.

**a. SESSION_SECRET fail-fast** (`server.js:244`)
- Replace hardcoded fallback with: `if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set')`
- Electron mode: same check, fail at main.js startup with dialog

**b. PostΩr double-fire guard** (`src/postor/queue-processor.js:158`)
- Add `let running = false` at top of `run()`. Return immediately if `running`. Set false in finally.
- Also: transactionally update status to `'posting'` BEFORE the await so a crash-restart doesn't re-fire

**c. `app.set('trust proxy', 1)`** (`server.js`)
- Add after `app.use(express.json())`. Required for `req.protocol`, `req.ip`, and rate limiting
  to work correctly behind nginx. Meta callback already works around this symptom manually.

**d. Affiliate redirect rate limiting** (`server.js:/r/:partnerKey/:linkKey`)
- Add `express-rate-limit` (already in deps?) or a simple per-IP in-memory counter
- 30 req/min per IP is plenty — prevents click-stuffing and DoS

### 2. SaaS Hardening — OAuth Token Encryption (~1 session)
- `platform_connections` stores `access_token`/`refresh_token` as plaintext TEXT
- Encrypt at rest: `crypto.createCipheriv('aes-256-gcm', keyFromSessionSecret, iv)`
- Key derivation: `crypto.scryptSync(process.env.SESSION_SECRET, tenant_slug, 32)`
- Decrypt on read in `getPostorConnection()` / `getAllPostorConnections()`
- Migration: one-time encrypt pass for existing records at startup
- ~50 lines, `src/utils/token-crypto.js`

### 3. Post-Mortem Brief → WritΩr + Id8Ωr injection (carried from Session 78)
- Locked brief has `root_cause`, `adjustments[]`, `avoid` — wire into:
  - WritΩr `id8rBlock`: "LAST VIDEO POST-MORTEM: avoid [pattern]" — same pattern as Strategic Brief
  - Id8Ωr concept phase: inject the avoid pattern so next idea doesn't repeat the failure
- Only inject if brief exists and is < 30 days old
- Read from `db.getActivePostMortemBrief()` — already exists in db.js

### 4. Run Frame Analysis Batch on Existing Vault (when ready)
- Open VaultΩr → scroll to 👁 Frame Analysis panel
- Select shot types: talking-head (start here — highest editorial value)
- Model: Haiku (default) — ~$0.004/clip, est. ~$16 for 4k clips
- Batch size: 200 → run repeatedly until progress bar hits 100%
- Then run b-roll, social-clip passes
- Visual data flows into AssemblΩr automatically once in DB

### 5. Background Worker Tenant Context (~2 sessions, needed before tenant #2)
The biggest gap to multi-tenancy (per OPUS_REVIEW_V3.md):
- VaultΩr watcher runs once at boot on Jason's DB — needs per-tenant watcher instances
- `transcribe-queue.js`, `frame-analysis-queue.js` — jobs write via `_activeDb()` but fire
  outside any tenant context → silently write to Jason's DB for all tenants
- `postor/queue-processor.js` setInterval — same problem
- `scheduleMorningSync`, `scheduleVectrAutoRun` — tenant-blind
- Fix pattern: each periodic job iterates over all tenants + wraps work in `tenantContext.run()`
- VaultΩr SSE sseClients Sets are global — tenant B's vault receives tenant A's events
- Approach: tenant-keyed SSE client sets in both queue files

### 6. TikTok — Alt account for posting demo (carried from Session 78)
- Upload is blocked: `unaudited_client_can_only_post_to_private_accounts` — TikTok restricts unreviewed apps to posting on private accounts only (server-side, no code workaround)
- Jason's main account (725k TikTok) cannot be set to private even temporarily
- Fix: create a throwaway alt TikTok account → set it to Private → add it as a tester in TikTok Developer Portal → connect it in PostΩr → record demo upload → submit that as the review video
- Once TikTok approves the app: add `TIKTOK_APPROVED=true` to `.env` — privacy level will follow UI selection instead of forcing SELF_ONLY
- Note: `tiktok-reviewer` is a Kre8r.app login only — no TikTok account tied to it

### 7. BrollΩr — Save to Vault download helper
- CDN URLs expire (Higgsfield ~7-30 days) — local copy is the only safe long-term storage
- Add "⬇ Download to Intake" button on each video result that pipes the URL through
  the server to D:\kre8r\intake so VaultΩr auto-ingests it (no manual browser download)
- Route: `POST /api/brollr/download-to-vault` — streams remote URL → local file → triggers watcher

### 8. BrollΩr — Speak endpoint (lip sync)
- Wire `/v1/speak/higgsfield` — takes input_image + input_audio (WAV only) + prompt
- UI: upload audio clip + select character image → generate talking-head video
- Unlocks "talking to younger self" concept: generate younger-Jason image → record VO → lip sync
- SDK: `client.generate('/v1/speak/higgsfield', { input_image, input_audio, prompt, quality, duration })`

---

## NEXT TASKS (Session 75)

### ~~1. TikTok Re-submission~~ ✅ Done Session 74
- Fixed: /tos and /privacy routes live (express.static extensions: ['html'])
- Fixed: ToS + PP links added to login page and landing page footer
- Fixed: Homepage URL changed to kre8r.app/landing (not login page)
- Test account created (tiktok-reviewer / RockRich2026!) and submitted to reviewer
- Resubmitted — awaiting TikTok review (est. a few days)

### 2. ClipsΩr → DaVinci freeze-frame (PAUSED — resume when ready)
- No-overlap prompt rule + post-processing dedup applied — not yet verified
- Root pattern: clips with overlapping frame ranges from same source cause DaVinci cache collision
- If still freezing: try SetInPoint/SetOutPoint on MediaPoolItem instead of explicit frames
- Nuclear option: revert clip-markers.py to marker approach (full source + colored markers,
  creator blades manually) — originally described in file header, avoids all AppendToTimeline issues

### 3. Performance Velocity Alerts — NorthΩr
- MirrΩr sync runs on schedule; compare latest metrics to previous snapshot
- Alert thresholds: CTR spike (+2% in 24h), views velocity (2x baseline in 8h), comment surge
- NorthΩr dashboard: amber/red banner when a video is spiking

### 5. Auto Short-Clip ID from Timeline Transcript
- After timeline transcript is saved, Claude scans full text for high-tension moments
- Scores each segment: hook potential, curiosity gap, standalone shareability
- Pre-populates ClipsΩr with suggested clip ranges (start/end timestamps)
- Creator confirms or skips — no hunting through the video manually

### 6. Analytics → Angle Weighting in Id8Ωr
- MirrΩr data: calculate avg views/CTR/retention per content angle
- Inject performance weights into Id8Ωr system prompt: "system angle is currently outperforming by 3x"
- SeedΩr constellation: color intensity reflects angle performance, not just angle type

### 7. Gemini 2.5 Pro — Id8Ωr Research Phase (Claude orchestrates Gemini)
- Add GEMINI_API_KEY to .env (Google AI Studio — free tier during preview)
- Claude generates research queries → Gemini fetches with Google Search grounding → Claude synthesizes
- Toggle: if no GEMINI_API_KEY, fall back to current Claude research (graceful degradation)
- Test protocol: same topic through both pipelines, blind score hook quality, let videos decide

## COMPLETED THIS SESSION (Session 73) ✅
- ~~StudioΩr — YouTube Studio Intelligence Bridge~~ ✅ Live. Brief persists in DB indefinitely.
- ~~Comment Intelligence → SeedΩr~~ ✅ Live. 💬 From Comments button in SeedΩr toolbar.
- ~~Studio Intel brief expiry~~ ✅ No hard expiry. Timestamp shown. Amber at 30 days.
- ~~CleanΩr driver scan~~ ✅ PowerShell -File fix. Jason updated AMD + Realtek drivers.

---

## NEXT TASKS (Session 72)

### 1. Trusted Partner Badge — OLH Listings (kre8r-land)
- Add "7 Kin Trusted Partner" badge to OnlineLandHub listings on the land finder page
- Same badge style as BillyLand treatment
- Badge should be visually distinct — signals vetted/trusted source to visitors
- Wire per-source so each partner (BillyLand, LandLimited, OLH) gets its own badge

### 2. Partner Contract — Mock Up + Send
- Draft partnership contract for trusted land partners (BillyLand, LandLimited, OLH)
- Cover: referral commission rate, affiliate param requirements, data usage, term
- Send to partners for review/signing

### 3. MirrΩr — Full Video Reanalysis Sync
- Run the sync that reanalyzes all YouTube videos with updated calibration context
- Not done yet — back-burnered during Session 70/71 work
- Will feed updated retention/hook data back into Id8Ωr + WritΩr recommendations

### 4. kre8r-land Production DB Backup Cron
- Wire daily backup on 7kinhomestead droplet — same pattern as kre8r.app (3am, 14-day rolling)
- sqlite3 CLI not installed — use node + better-sqlite3 backup script
- Script: `/home/landapp/kre8r-land/scripts/backup-db.js`
- Cron: `0 3 * * * node /home/landapp/kre8r-land/scripts/backup-db.js >> /home/landapp/logs/backup.log 2>&1`

### 5. TikTok App Approval (waiting)
- Still in review as of May 3, 2026
- Check status — once approved, wire TikTok Analytics module (TikTΩkr)

### 6. Cari Electron Setup — back-burnered
- Not needed now given recent workflow wins. Revisit if she needs direct pipeline access.

---

## NEXT TASKS (Session 63)

### ~~1. Replace kre8r-land Tool Page Links with Tracked /r/ URLs~~ ✅ Done Session 64
- db.js migration seeds 27 affiliate_links (all tool + gear page items) with show_on_gear=1
- water.html: IBC Tote + Big Berkey → https://kre8r.app/r/amazon/{key} (both render views)
- solar.html: LiTime 100Ah/200Ah + SunGold panels → /r/ tracked URLs
- lifestyle.html: Pressure Canner, Chest Freezer, Meyer Hatchery, Baker Creek → /r/ tracked URLs
- gear.html: All 20 fallback items updated to /r/ URLs; live API already returns proper hrefs

### 2. Land Finder Tool — TBD (discuss with Jason)

### 3. Cari Electron Setup (when Cari is home)
- Install Kre8Ωr Setup .exe on Cari's laptop
- Add `INTERNAL_API_KEY=d6d13be62e9ff637e09cde86cf506201b85413a4a63f8ff0338ac5fed0efc7a2` to her `.env`
  (AppData\Roaming\kre8r\.env — Electron creates this folder on first run)
- Walk her through 📥 Pull from Live → edit → 📤 Push to Live workflow
- Once confirmed working: she stops editing directly on kre8r.app for anything beyond gear
- Safe to extend sync to other tables (projects etc.) only AFTER this is confirmed

### 4. KinOS Auth Activation (when Cari is home)
- Set `KINOS_ADMIN_PW` + `SESSION_SECRET` in kinos/.env on the live server
- `pm2 restart kinos`
- Login as Jason → go to `/manage-passwords` → set passwords for all family members
- Set Karen last (she gets the 10-year cookie, logs in once, never again)

### 4. Kre8r Publish Schedule → KinOS Family Calendar Bridge
- When a project reaches `distribution` stage in PipΩr, POST to KinOS `/api/calendar/events`
  or similar — so YouTube publish date shows on the family calendar
- Requires: KinOS calendar event endpoint + Kre8r bridge call on stage change

### 5. Deploy KinOS + OrgΩr to Shared DigitalOcean Droplet
- Spin up $12/mo shared droplet for KinOS + OrgΩr
- Nginx config: kinos.life → port 3001, orgr.yourdomain.com → port 3002
- PM2 ecosystem file for both apps
- Set `ORGR_URL` + `ORGR_DEFAULT_ORG_ID` in Kre8r `.env` to activate commission bridge

---

## ACTIVE BACKLOG

### 7 Kin Trusted Partners Infrastructure — kre8r-land
Three confirmed partners: **BillyLand**, **LandLimited**, **OnlineLandHub** (RSS + referral commission).
- `trusted_partners` table: name, site_url, rss_feed_url, affiliate_param, commission_rate, logo_url, description, status
- Aggregator auto-appends affiliate param to every listing URL at ingest (per-source, stored in partners table)
- `/api/land/partners` route — returns active partners list
- **"7 Kin Trusted" display** on land finder page: vetted source badges on listings + a partner section showing logos/descriptions
- OnlineLandHub RSS feed: wire into `src/aggregator/sources.js` once feed URL confirmed
- Future: partner dashboard showing referral click counts (UTM tracking via redirect endpoint)

### Testimonials Section (need 3–4 total)
- 1 strong one saved → `TESTIMONIALS.md` (Founding 50, solar tool, April 2026)
- Collect 2–3 more from community, then build testimonials section on:
  kre8r-land tool pages, gear page, Rock Rich landing page
- Tag each one with what it speaks to (solar tool, community, novice-friendly, etc.)

### Media Kit — Press Email
press@7kinhomestead.com needs to exist before kit goes public.
Simplest: forward from press@7kinhomestead.com → 7kinmedia@gmail.com via Zoho (free tier).

### MirrΩr: Last Synced Indicator + Sync Now Button
- Store last_synced_at in kv_store after each MirrΩr sync
- NorthΩr: "YouTube data last synced: X days ago" + 🔄 Sync Now button
- Amber warning if > 7 days stale

### Desktop-Only Feature Gates (before beta launch)
Detect via `window.__KRE8R_ELECTRON`. Add "🖥️ Desktop App Only" badges on:
PostΩr upload, VaultΩr watcher, EditΩr proxy playback, DaVinci, Whisper, TeleprΩmpter QR codes.

### TikTok Analytics Module (after TikTok app approval ~April 28-30)
Separate from MirrΩr. Own DB tables (tiktok_videos, tiktok_metrics).
Short-form calibration context feeds WritΩr SHORT FORM only — never mixed with YouTube.
ConstellΩr: platform selector [YouTube] [TikTok] [All Ideas] view.

### VaultΩr Full-Text Tag Search
Tag cloud chip filter ✅ live. Remaining: text input → filter across all tag values in real time.

### Cari Editor Role
New role between owner/viewer in Kre8r auth. Read + upload, no admin/delete.
Needs OrgΩr auth built first (same session).

---

## KNOWN ISSUES

| Issue | Status |
|-------|--------|
| TeleprΩmpter: no back button from display screen | Open |
| AudiencΩr tag filter (Kajabi 500 on filtered requests) | Low priority |
| TikTok posting app in review | Waiting on Apple |
| OrgΩr PM2 process lost after machine restart | Fix: re-register with pm2 start |
| ~~VaultΩr loop fix not live until Kre8r restarts~~ | ✅ Confirmed fixed + live Session 63 |
| ~~AffiliateΩr partner add + links loading broken~~ | ✅ Fixed (db.prepare export) Session 63 |

---

## INFRASTRUCTURE NOTES

- Kre8r: port 3000 (Electron desktop + kre8r.app on DO)
- KinOS: port 3001 (kinos.life — ✅ auth activated, hub site live)
- OrgΩr: port 3002 (local only — activate with ORGR_ADMIN_PW when needed)
- Deploy: `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r`
- OrgΩr PM2: `node %APPDATA%\npm\node_modules\pm2\bin\pm2 start server.js --name orgboard` (run from C:\Users\18054\orgboard)

---

## BETA LAUNCH — INTENTIONALLY BACK-BURNERED
Jason is keeping Kre8Ωr private for now. Having a superpower and not leveling the
playing field. Revisit when/if the calculus changes. Checklist preserved below for reference.
- [x] OrgΩr auth
- [x] KinOS auth + hub site live
- [ ] Desktop-only feature gates
- [ ] Remove API key field from public/setup.html (operator pays)
- [ ] MirrΩr last-synced indicator
- [ ] press@7kinhomestead.com email forward
