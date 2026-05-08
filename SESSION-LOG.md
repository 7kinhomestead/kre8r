# SESSION-LOG — Active (Sessions 55–current)
# Older sessions → SESSION-LOG-ARCHIVE.md

---

# Session 76 — AssemblΩr Full Rebuild: Auto-Transcription, AI Assembly, EditΩr Room (2026-05-08)

## Goal
5-phase AssemblΩr rebuild: fix everything that was broken (full-clip placement, model re-download,
no auto-transcription, no edit context bridge). Build a real AI editor that assembles short takes
into a coherent rough cut beat-by-beat, then gives Jason a persistent editing partner to think
through story decisions.

## What Was Built

### Phase 1 — VaultΩr Auto-Transcription Queue
**`src/vault/transcribe-queue.js`** (NEW)
- Background EventEmitter queue — one Whisper job at a time, never blocks ingest
- In-memory job tracking: job_id, status (pending/running/done/failed), progress events
- SSE broadcast to connected clients so vault.html can show live transcription status
- Idempotent — checks DB for existing transcript_path before enqueueing, no double-work
- `enqueue(footageId, filePath, label)` — key export; returns `{ ok, job_id, reason }`

**`src/vault/watcher.js`** (MODIFIED)
- Auto-enqueues talking-head clips after ingest: `if (result.shot_type === 'talking-head' && result.id)`
- No manual "Transcribe" button needed — footage lands in vault, transcription starts

**`src/vault/transcribe.js`** (MODIFIED)  
- `WHISPER_CACHE_DIR`: `database/whisper-model-cache/` (env override: `WHISPER_CACHE_DIR`)
- `--download-root` flag added to Whisper spawn — fixes repeated model re-download bug
- Model now cached once, subsequent transcriptions start immediately

**`src/routes/vault.js`** (MODIFIED)
- `GET /api/vault/transcribe-queue/status` — current queue state
- `GET /api/vault/transcribe-queue/stream` — SSE stream for live progress
- `POST /api/vault/transcribe-queue/add` — manually enqueue a clip (footageId)

**`public/vault.html`** (MODIFIED)
- Transcription queue pill: hidden when idle, shows "🎙 Transcribing N queued" when active
- `🎙 Transcribe` button on talking-head cards without transcript
- `✓ Transcribed` badge on already-transcribed cards
- SSE EventSource: `startTxQueueStream()` → `updateTxQueuePill()` + `refreshCardById()`
- `@keyframes pulse` animation on active queue pill

### Phase 2 — AssemblΩr Core Intelligence
**`src/utils/claude.js`** (MODIFIED)
- `callClaudeMessages` now accepts `options.model` override
- Enables per-call model selection without touching the global MODEL constant

**`src/editor/assemblr.js`** (MAJOR REWRITE)
- `ASSEMBLY_MODEL` constant: `claude-sonnet-4-6` (override via `CLAUDE_ASSEMBLY_MODEL` env)
- **Root bug fixed**: `assembleBeat()` (Call 2) was disabled — full clips were placed instead
- Re-enabled Call 2 per beat with model override and `extractAssemblyJson()` for preamble-tolerant parsing
- Short-takes prompt: "Takes are 1-3 sentences each — sequence them like building blocks"
- Gold moment merger: gold takes merged into nearest beat pool (tagged `quality:'gold'`) instead of being exiled to separate sections
- `assembly_note` property attached to sequence array — Claude's one-sentence editorial strategy
- Sections now store:
  - `takes`: all tagged takes (building blocks for approval UI)
  - `selected_takes`: Claude's proposed ordered sequence with handles applied
  - `assembly_note`: editorial strategy note
  - `assembly_mode: 'ai_assembled'`

**`src/db.js`** (MODIFIED)
- Migration: `addCol('selects', 'assembly_note', 'TEXT')`
- Migration: `addCol('selects', 'assembly_mode', 'TEXT')`
- `insertSelect`: 11-parameter insert including both new columns
- `getSelectsByProject`: returns `assembly_note` and `assembly_mode`

### Phase 3 — Approval UI (Two-Panel View)
**`public/editor.html`** (MULTIPLE MODIFICATIONS)
- `buildSequenceHTML()` (NEW): "PROPOSED SEQUENCE" panel — Claude's cut list, one card per segment
  - Timecode, level badge (color-coded by quality), ▶ play button, editorial note
  - Hidden when sequence empty or old full_clip format
- `buildTakesHTML()` (UPDATED): "ALL TAKES" panel with quality colors
  - strong=green, clean=teal, fumbled=red, partial=amber, gold=gold
  - `✓ IN SEQ` badge if take appears in proposed sequence
  - Play button per take
- Assembly note: teal callout box showing Claude's editorial strategy when present
- Badge: "N segs assembled" instead of old "tap to swap"
- `playClipSegment(filePath, startSec, endSec)`:
  - Floating fixed-position video player (bottom-right, 320×180px)
  - `file://` URL for Electron proxy playback
  - Auto-stops at `endSec` via `ontimeupdate`
- `closePlayer()` — dismiss video overlay

### Phase 4 — EditΩr Room (Persistent Editing Partner)
**`src/routes/editr-room.js`** (NEW)
- SSE streaming chat: `POST /api/editr-room/chat`
  - `buildSystemPrompt()`: rich context block — beat map with assembly status, WritΩr script excerpt, voice profile
  - "Editor-to-editor talk" persona — no corporate filler, short direct responses, willing to pushback
  - Uses `callClaudeStream` token-by-token
  - Keepalive heartbeat every 20s
- Session persistence: `GET/POST/DELETE /api/editr-room/session/:project_id`
  - Stored in kv_store as `editr_room_session_{project_id}` (auto-parsed JSON)
- Context endpoint: `GET /api/editr-room/context/:project_id`
  - Compact beat summary + recent 6 messages for BrollΩr injection

**`server.js`** (MODIFIED)
- `app.use('/api/editr-room', require('./src/routes/editr-room'))`

**`public/editor.html`** (MODIFIED — EditΩr Room panel)
- "💬 EditΩr Room" button in project bar (enabled on project load)
- 420px slide-out panel, full viewport height
- Message history: user messages right-aligned teal, assistant messages dark-card
- `loadEditrRoomSession()` → restore prior conversation on project load
- `sendEditrRoomMsg()` → SSE token stream → incremental render
- `clearEditrRoomSession()` → DELETE session API → clear UI
- `toggleEditrRoom()` → slide panel in/out

**`src/routes/brollr.js`** (MODIFIED — context injection)
- `/analyze` endpoint: loads PipΩr beats + assembly notes + EditΩr Room conversation
- Builds `editorContext` block: beat names, emotional functions, assembly notes, recent chat turns
- Appends to analyze prompt → b-roll suggestions serve the narrative, not just look cool

### Phase 5 — DaVinci Output (Already Complete)
- `build-selects.py` already handles `selected_takes` with start/end timestamps (prior session)
- Phase 2: `AppendToTimeline` with `startFrame`/`endFrame` per segment — real subclip cuts
- Phase 3: Beat-header markers + gold moment markers on top of assembled cuts
- PipΩr beat markers from `project-config.json` (covered/missing/out-of-sequence)
- `editor.js` `/davinci/build/:project_id` auto-creates DaVinci project if not linked
- Data flow: `assemblr.js` → `insertSelect` → `getSelectsByProject` → `build-selects.py` ✓

## Commits
- (this session)

---

# Session 75 — BrollΩr Soul Characters + Two-Step Pipeline + Prompt Engineering (2026-05-08)

## Goal
Complete BrollΩr Soul ID character system, fix all Higgsfield API timeout issues,
add image review step before animation, prove full pipeline end-to-end with Jason's
actual face in generated b-roll for a loneliness video.

## What Was Built / Fixed

### BrollΩr — Image Review Step (two-step pipeline)
- **`src/routes/brollr.js`** — generate route now stops at Step 1 (text→image) and emits
  `image_ready` SSE event with `image_url`. Does NOT auto-proceed to video.
- New **`POST /api/brollr/animate`** SSE route — Step 2 only. Takes `generation_id` + `image_url`,
  POSTs to `/v1/image2video/dop`, polls to completion, emits `done` with `result_url`.
- `status: 'image_ready'` saved to DB between steps so image URL is preserved.

### BrollΩr — Regen Image with Prompt Editing
- **`public/brollr.html`** — image preview box now contains a **"Refine prompt"** textarea
  pre-populated on `image_ready` SSE event with the prompt that generated the image.
- **`regenImage(idx)`** function — syncs refined text back to main prompt textarea, clears
  preview, calls `generateMoment(idx)`. Edit prompt → regen without losing context.
- ↺ Regen Image button in preview box (distinct from main Generate button).
- Image preview box styled with teal border to stand out from card.

### BrollΩr — Timeout Fixes (all routes)
All Higgsfield operations were timing out. Extended across the board:
- Soul ID training: SSE 10min → **25min**, `maxPollTime` 5min → **25min**, `pollInterval: 8000`
- Heartbeat messages every 60s during training queue wait ("X min elapsed")
- Image generation: poll 3min → **8min**, SSE 5min → **10min**
- Animate to video: poll 5min → **10min**, SSE 6min → **12min**

### BrollΩr — Animate Button Stuck Fix
- Added `finally` block to `animateMoment()` — button always resets to "▶ Animate to Video"
  regardless of whether SSE ended with done/error or silently disconnected.
  Previously: silent timeout left button permanently disabled.

### BrollΩr — Soul ID System (Characters tab)
- `brollr_characters` table migration includes `notes TEXT` column (safe ALTER TABLE)
- `createBrollCharacter` accepts `notes` param
- `GET /api/brollr/characters/higgsfield-list` — direct axios to `platform.higgsfield.ai/v1/custom-references`
- `POST /api/brollr/characters/import` — save existing Soul ID without training
- `PATCH /api/brollr/characters/:id` — update notes field, auto-saves on blur
- Appearance notes auto-injected into every generation prompt via `notesClause`
- Character selector on every moment card — `soul_id` passed to both generate + animate routes
- `populateMomentCharSelects()` rebuilds dropdowns after character list changes

### Soul ID Training — Key Discovery
- Platform Soul IDs (trained on higgsfield.ai UI) are NOT accessible to developer API — separate workspaces
- Jason trained Soul ID via BrollΩr developer API flow using 500 API credits (~$3)
- v1 `HiggsfieldClient` required for training (has `uploadImage()` + `createSoulId()`)
- v2 `createHiggsfieldClient` only has `subscribe()` — no upload/training methods

## Prompt Engineering Discoveries
Working patterns for Higgsfield Soul model:
- Describe LIGHT not objects (avoid "phone screen" → describe "cold blue-white uplight from below frame")
- Negative prompts backfire — saying "WE CANNOT SEE THE SCREEN" makes it draw the screen
- Physical posture language works: "shoulders back, weight shifting forward, jaw set"
- Compositional direction works: "the man looks small in the space"
- "Something in his hands just below frame" hides props cleanly
- Repeating forbidden concepts in caps reinforces them — omit entirely instead

## Creative Output — Loneliness Video B-Roll Package
Full cinematic b-roll package generated with Jason's Soul ID:
- Late night phone glow / insomnia shot (dark living room, lamp, mug)
- Eating alone at dinner table — phone in hand, food going cold, empty chair
- Cul-de-sac at dusk — two men getting out of cars, no eye contact (Coen Brothers aesthetic)
- Office chair / ceiling stare — fluorescent light, corporate-neutral room
- Resolution shot — man setting phone face-down and rising with purpose
- BBQ scene — two men at grill, both on phones, grill unattended
- BONUS: Jason in blacksmith leather apron forging metal, SpaceX rocket launching outside window, completely unbothered

All clips downloaded and dropped into `D:\kre8r\intake` for VaultΩr ingestion.

## Confirmed Working Higgsfield Endpoints
- Image: `POST platform.higgsfield.ai/v1/text2image/soul` — `{ params: { prompt, width_and_height: '2048x1152', custom_reference_id?, custom_reference_strength: 1 } }`
- Video: `POST platform.higgsfield.ai/v1/image2video/dop` — `{ params: { model: 'dop-turbo', prompt, input_images: [{ type: 'image_url', image_url }] } }`
- Poll: `GET platform.higgsfield.ai/requests/{jobSetId}/status` → `images[0].url` / `video.url`
- Auth: `Authorization: Key KEY_ID:KEY_SECRET`

## Files Changed
- `src/routes/brollr.js` — two-step pipeline, animate route, timeout fixes, heartbeat, character routes
- `public/brollr.html` — image preview + refine prompt UI, regenImage(), animateMoment finally block, character tab JS
- `src/db.js` — brollr_characters notes column migration

---

# Session 74 — ClipsΩr → DaVinci Integration Debug + TikTok Rejection (2026-05-07)

## Goal
Fix ClipsΩr → DaVinci Resolve pipeline: freeze-frame clips, wrong timestamps, transcription
path timeouts. Then pivot to TikTok app re-submission after rejection from developer.tiktok.

## What Was Built / Fixed

### ClipsΩr — Timestamp & Transcription Fixes

**`src/vault/clipsr.js`** (analysis engine):
- Post-processing `lastSpeechEnd` clamp: removed +2s buffer → cut tight to last word.
  `end > lastSpeechEnd → end = lastSpeechEnd` (no padding; editor adds breathing room in Resolve)
- Prompt updated: timing rules now explicitly say "no buffer, no padding — cut tight to last word"
- Added no-overlap rule to prompt: "Clips must NOT overlap. Each clip's start must be after
  the previous clip's end. If two moments share overlapping time ranges, pick the stronger one."
- Added hard dedup safety net in post-processing: walks clips in rank order, drops any clip
  whose start < previous clip's end. Lower-ranked overlapping clip is dropped silently with warning log.
  Renames internal `clips` to `clampedClips` first, then builds final `clips` array from dedup loop.

**`scripts/davinci/clip-markers.py`**:
- Added project-level fps lock BEFORE any timeline creation:
  `project.SetSetting("timelineFrameRate", fps_str)` + `timelinePlaybackFrameRate`
  Verifies actual fps after setting and warns if mismatch >0.01.
- Removed per-timeline `SetSetting` (no-op once project rate locked)
- Added timeline fps verification after each `CreateEmptyTimeline`
- Fixed `NameError: markers_added` — return dict used old variable names → updated to `clips_added`/`clip_timelines`
- Added `project.SetCurrentTimeline(clip_tl)` before each `AppendToTimeline` call (was all going to overview)
- Added `_run_ts` timestamp suffix to all timeline names — prevents name collisions on re-runs
- Added `--duration` arg and `max_source_frame` clamp — prevents requesting frames past source end
- Reverted per-iteration `ImportMedia` back to single `source_item` (re-import caused confusion)

**`src/vault/transcribe.js`**:
- Whisper timeout: 45_000ms (was 10_000 — too short for torch cold-start)
- `resetWhisperCache()` called before Whisper fallback to clear stale binary detection

**`scripts/davinci/resolve-transcribe.py`**:
- Added upfront `GetTranscription()` check before calling `TranscribeAudio()` — skip if already transcribed
- PATH 2 now checks both "caption" AND "subtitle" track types (DaVinci v21 creates "caption" not "subtitle")
- `_find_best_transcript_track()` logs all track types found
- `TRANSCRIPTION_TIMEOUT_SEC = 90` (was 300), `TIMELINE_MAX_WAIT = 45` (was 300)

**`src/routes/clipsr.js`**:
- Slug-file cache clearing when `force_retranscribe=true` (was returning stale timestamps from previous video)
- Bounds check: clips starting beyond `footage.duration * 1.05` return 400 error
- Passes `--duration String(footage.duration || 0)` to clip-markers.py

## Freeze-Frame Investigation (UNRESOLVED — paused)

### Root cause candidates exhausted:
1. **Stale slug-file cache** — fixed (wrong 66-min timestamps were from a different video)
2. **Timeline name collisions** — fixed (timestamp suffix)
3. **Wrong current timeline** — fixed (SetCurrentTimeline before each append)
4. **FPS conform mismatch** (project 24fps vs source 29.97fps) — fixed in code, user confirmed
   project changed to 29.97 in DaVinci settings, restarted — **still freezes**
5. **AppendToTimeline non-deterministic failure** — clips 1&2 one run, clips 1&6 next run.
   Pattern is non-deterministic. Not a frame-math problem.

### Key finding:
Clips that freeze-frame are always those whose **end times overlap or share the same endFrame**.
In the latest run: GOLD clip (6:44→7:40) and SOCIAL #6 (7:13→7:40) — both clamped to
`lastSpeechEnd = 7:40`. Clip 6 is entirely within clip 1's frame range. DaVinci's AppendToTimeline
has a media engine cache collision when two clips from the same source share overlapping frame ranges.

### No-overlap fix applied (prompt rule + post-processing dedup) but not yet verified — paused.

### Remaining options if overlap fix doesn't resolve it:
- Try `SetInPoint(frame)` / `SetOutPoint(frame)` on MediaPoolItem then AppendToTimeline without
  explicit frames — different internal DaVinci code path
- Revert to **marker approach**: full source on overview timeline, colored duration-span markers
  per clip, creator blades at boundaries. Zero AppendToTimeline calls. Originally described in
  file header. Non-destructive, matches how professional editors use Resolve.

## TikTok — App Rejected, Re-submission Needed
- TikTok developer review rejected the Kre8r app submission
- User received feedback from developer.tiktok — details TBD next session
- TikTok OAuth, posting code, and compliance UI already built (Session 49)
- Likely needs: policy page updates, scope/permission justifications, or app description changes

## Commits This Session
- `src/vault/clipsr.js` — no-overlap prompt rule + dedup safety net + lastSpeechEnd clamp fix
- `scripts/davinci/clip-markers.py` — fps lock, SetCurrentTimeline fix, _run_ts suffix, duration clamp

---

# Session 73 — Studio Intel Bridge, Comment Intelligence, CleanΩr fixes (2026-05-05)

## Goal
Build YouTube Studio Intelligence Bridge (Ask Studio → Kre8r context injection),
Comment Intelligence → SeedΩr pipeline, fix CleanΩr driver scan PowerShell quoting,
fix Studio Intel SSE silent failure, fix brief expiry logic.

## What Was Built / Fixed

### StudioΩr — YouTube Studio Intelligence Bridge
- **`src/routes/studio-intel.js`**: new route file
  - `POST /api/studio-intel/queries` — Claude generates 9 targeted Ask Studio queries
    organized by category (Audience Fears, Content Gaps, Retention Patterns, etc.)
    using MirrΩr + VectΩr brief as context. Topic hint optional.
  - `POST /api/studio-intel/synthesize` — SSE. Accepts query/response pairs + Jason's
    instinct textarea. Claude synthesizes into structured Intelligence Brief with 7 sections:
    The Signal, What They're Afraid Of, Content Gaps, What's Working, Instinct Check,
    Next Video Angles, Inject Into Strategy paragraph.
  - `GET /api/studio-intel/brief` — returns saved brief from kv_store
  - `DELETE /api/studio-intel/brief` — clear brief
  - Brief saved to `kv_store` key `studio_intel_brief` — persists indefinitely (no expiry)
- **`server.js`**: `app.use('/api/studio-intel', ...)` mounted
- **`public/northr.html`**: 📊 Studio Intel button added to hero (alongside VectΩr ⬡)
  - Full slide-out panel: topic hint input, Generate Queries, query cards with copy buttons
    and response paste areas, Your Audience Instinct textarea, Synthesize button,
    brief output with streaming tokens, Load Saved Brief + Start Over footer buttons
  - Query cards + responses persist to `localStorage` — survive app restarts
  - Brief timestamp header shows age ("generated today" / "X days ago")
  - Amber warning after 30 days: "This brief is over 30 days old — consider refreshing"
- **Context injection**: Studio Intel "Inject Into Strategy" paragraph auto-injected into:
  - `src/routes/vectr.js` — VectΩr strategic session system prompt
  - `src/routes/id8r.js` — both concept generation phases (shape_it + research)
  - `src/routes/ideas.js` — Comment Intelligence from-comments prompt

### Brief Expiry Logic Fix
- Removed 7-day hard expiry — brief persists until replaced or manually cleared
- Age label shown in human-readable form ("3d ago") in all injection contexts
- Frontend shows timestamp on brief load; 30-day amber advisory (not expiry)

### SSE Silent Failure Fix (studio-intel.js)
- `startSseResponse(res)` returns `{ send, end }` object — was incorrectly assigned
  to `send` variable directly. Fixed destructuring: `const { send, end } = startSseResponse(res)`
- All `res.end()` calls replaced with `end()` for proper SSE cleanup

### Comment Intelligence → SeedΩr
- **`src/routes/ideas.js`**: `POST /api/ideas/from-comments` endpoint
  - Accepts raw comment paste + optional source video title
  - Claude mines comments for latent video ideas — fear language, unanswered questions,
    emotional signals, follow-up requests hidden in the text
  - Each idea includes: title, concept, angle, hook, notes (the specific comment signal)
  - Tagged `source: 'comment_intelligence'` for filtering
  - Studio Intel content gaps injected as context if brief exists
  - Returns preview array — frontend confirms before saving
- **`public/seedr.html`**: 💬 From Comments button (teal) added to toolbar
  - Modal: source video field + large comment paste area
  - Idea cards show concept, angle, and the exact comment thread that inspired it
  - Click to select/deselect; all checked by default
  - Save Selected → batch POST to `/api/ideas`

### CleanΩr — Driver Scan Fix
- PowerShell `-Command "..."` wrapper mangled nested quotes in WMI DriverDate expression
- Fixed: write script to temp `.ps1` file, run with `-File` flag (no escaping needed)
- Temp file cleaned up after execution
- Driver date context: 2006-06-21 is Windows inbox driver stamp — not real outdated dates
- Real drivers worth updating: AMD Chipset (SMBus/PCI/GPIO), Realtek PCIe GbE
- User updated AMD chipset + Realtek drivers this session

### Server Recovery (kre8r.app 502)
- `src/routes/cleanr.js` was untracked — server.js referenced it but file wasn't committed
- Server crashed on startup with `Cannot find module './src/routes/cleanr'`
- Fix: committed all session 73 untracked files, pushed, pulled on DigitalOcean
- `package-lock.json` local changes on server blocked merge — fixed with `git checkout --`

### OLH Contract Verification
- Confirmed OLH agreements exist in cloud DB (kre8r.app), not Electron local DB
- Agreement ID 4: Dustin Murphy, signed May 5 2026 9:28 PM UTC ✅
  - Terms: 10% OLH commission, 25% referral fee to 7 Kin, payments on the 5th
- Agreement ID 3: May 4 version, had `{{payment_day}}` template bug, never signed (fine)
- Electron app DB ≠ kre8r.app cloud DB — contracts visible at kre8r.app/affiliator.html

## Results
- 302K view video ("The Game Is Rigged") — now #2 all-time in 2 weeks
- Today's launch ("I Was Scared of This Too") outperforming 302K video in first 8 hours:
  4.6K views, 9.3% CTR, 4:06 avg duration (51% retention on 8-min video), #1 of 10
- First Studio Intel brief generated: "Loneliness is the load-bearing wall" — audience
  is emotionally convinced but socially paralyzed. 3 video angles identified.
- Brief auto-injected into VectΩr + Id8Ωr context going forward

## Strategic Notes
- CS PhD (University of Minnesota) reached out to collaborate on community tools — call scheduled
- Gemini 2.5 Pro research orchestrator logged for next session (free tier API)
- Full strategic roadmap documented in TODO.md Session 73 backlog

---

# Session 72 — Contracts v2, Signature Solar, AnimΩr (2026-05-03)

## Goal
Finish contracts module (signer-fillable fields, ESIGN compliance, signing page letterhead),
research Signature Solar partnership, add `?src=` content-source tracking to AffiliateΩr,
and build AnimΩr — Remotion motion-graphics renderer.

## What Was Built / Fixed

### Contracts — Signer-Fillable Fields
- `renderTemplate()`: skips empty values — `{{variable}}` placeholders preserved in body_snapshot
  when Jason doesn't fill them in. Signer fills them on the signing page.
- `buildSigningPage()`: detects remaining `{{vars}}`, renders editable input fields with
  live preview update. POST `/api/contracts/sign/:token` accepts `signer_fields`, does
  final render + calls `updateAgreementBodySnapshot`.
- `src/db.js`: added `updateAgreementBodySnapshot` helper.

### Contracts — ESIGN Act Compliance
- Second checkbox added: explicit ESIGN Act consent (separate from "I agree to terms").
- `user_agent` captured at signing time → `signer_agent` column added to `agreements` table
  (safe ALTER TABLE migration in db.js).
- Audit trail block appended to `body_snapshot` before locking:
  signer name, date/time, ISO timestamp, IP address, browser, ESIGN consent statement.

### Contracts — Signing Page Letterhead
- Rebuilt to match QualΩr checksheet print aesthetic:
  `background:#eceae6` linen body, white paper `#fff` with shadow, Bebas Neue display,
  DM Sans 300 body, teal accent rule under header, `--ink:#0a0a0a`.
- Logo: `public/media-kit-images/logo.png` replaces "7K" monogram.
- Signing URL always uses `LIVE_API_URL` env var (not request host) — fixes localhost
  links when sent from Electron.
- Confirmation email: `buildAgreementEmail()` — inline-style table email matching
  letterhead aesthetic. Logo at absolute URL, ESIGN audit trail in teal-accented box.

### AffiliateΩr — Content Source Tracking (`?src=`)
- `affiliate_clicks` table: `src TEXT` column added (safe migration in db.js).
- `server.js` redirect handler: captures `req.query.src`, inserts into clicks row.
- `src/routes/affiliator.js`: `bySrc` analytics query added.
- `public/affiliator.html`: "Clicks by Content Source" table in analytics tab.
  Usage: `/r/signature-solar/main?src=solar-vid-123`

### AnimΩr — Remotion Motion Graphics
- **`src/animr/Root.jsx`**: Remotion root registering all 3 compositions.
- **`src/animr/compositions/BarChart.jsx`**: animated cost comparison (already built prev session).
- **`src/animr/compositions/CountUp.jsx`**: count-up with glow (already built prev session).
- **`src/animr/compositions/StatCard.jsx`**: animated stat card (already built prev session).
- **`src/routes/animr.js`**: render API:
  - `POST /api/animr/render` — starts job, returns jobId
  - `GET  /api/animr/render/:id/stream` — SSE render progress
  - `GET  /api/animr/renders` — list completed MP4s
  - `DELETE /api/animr/renders/:filename` — delete render
  - Uses `@remotion/bundler` + `@remotion/renderer` (already installed).
  - Outputs to `public/animr-renders/` (auto-created).
- **`public/animr.html`**: full UI — composition picker (BarChart/CountUp/StatCard),
  props configuration per composition, bars editor (add/remove/color), duration/fps controls,
  SSE progress with bundle + render phases, result preview with download + PostΩr send,
  library tab for all rendered files (hover-to-play).
- **`server.js`**: `app.use('/api/animr', ...)` mounted.
- **`public/js/nav.js`**: AnimΩr added to Post section.

## Signature Solar Meeting
- Signature Solar offered $24k / 20kw solar system in exchange for being first partner
  when their commission program relaunches (company values aligned).
- AffiliateΩr partner already set up. Will use `/r/signature-solar/main?src=[video-id]`
  for per-video tracking once commission program live.

---

# Session 70 — Voice Calibration, Email Sequences, AnalyticΩr Fixes, Blog Error 153 (2026-05-03)

## Goal
Wire voice calibration into all WritΩr prompts. Run calibration across 190 transcripts.
Rewrite Rock Rich email sequences in Jason's voice. Fix AnalyticΩr LAND key errors.
Add fence question log. Fix MailerLite stats + Days Since Email. Fix blog YouTube Error 153.

## What Was Built / Fixed

### Voice Calibration (`loadVoiceCalibrationBlock`)
- `src/writr/claude.js`: added `loadVoiceCalibrationBlock()` — reads from kv_store,
  falls back to `data/voice-calibration.json`, backfills kv_store on first server load.
- Injected into all 5 WritΩr prompt builders:
  `script-first.js`, `shoot-first.js`, `hybrid.js`, `iterate.js`, `src/routes/writr.js`
- `scripts/voice-calibration.js`: fixed dotenv override issue (`{ override: true }`),
  added Opus JSON repair fallback for malformed batch output.
- Calibration ran across 190 transcripts (19 batches × 10) via Opus. ~$8.46.
  Result stored in `data/voice-calibration.json` + kv_store.

### Email Sequences (Rock Rich Community)
- Rewrote full welcome sequence (6 emails) + upgrade sequence (Day 8+) in Jason's voice
  using calibration findings: "ask me how I know", "that's not nothing", specific numbers,
  fence post rule, conversational rhythm.
- Word count of transcript DB surfaced (~X words) and injected into Email 4 ("Two questions").
- Sequences ready to load into MailerLite.

### AnalyticΩr — LAND_INTERNAL_KEY
- `LAND_INTERNAL_KEY=7kin2026landXsecret99` added to `.env` (was missing entirely).
- All AnalyticΩr land panels now load correctly.

### AnalyticΩr — Fence Question Log
- `GET /api/analyticr/fence-questions` proxy added to `src/routes/analyticr.js`.
  Proxies to `/api/fence/questions` on kre8r-land with LAND_INTERNAL_KEY.
- `analyticr.html`: new "Fence Questions" panel renders full question text, topic,
  tier (color-coded pill), matched video, email captured, timestamp.

### AnalyticΩr — Email Stats Fixes (`src/routes/northr.js`)
- ML v2 rates nested under `c.stats?.open_rate` (not `c.open_rate`) — fixed.
- Added `unsubscribe_rate` + `click_to_open` to campaign mapping.
- `fetchMlAutomationStats()` added — fetches all automations + stats.
- Welcome sequence performance by tier now renders in AnalyticΩr via `automation_stats`.
- Days Since Email override: live ML campaign `sent_at` compared to DB value,
  uses whichever is more recent. Fixes "35d" showing when last send was 4d ago.

### MailerLite CAN-SPAM Compliance (`src/routes/mailerlite.js`)
- `{$company_address}`, `{$unsubscribe_url}`, `{$unsubscribe}` added to `wrappedHtml`
  template. MailerLite API was blocking campaign scheduling without these.

### Blog: YouTube Error 153 — Full Investigation + Fix
- **Root cause**: YouTube's 2023 player update requires `web-share` in the `allow`
  attribute and `referrerpolicy="strict-origin-when-cross-origin"`. Missing these
  triggers "Video player configuration error" (Error 153). Also removed deprecated
  `modestbranding=1` parameter. Switched from `youtube-nocookie.com` to `youtube.com`.
- **kre8r-land** `public/blog-post.html`: iframe updated to full current YouTube embed spec.
- **mailor.js blog system prompt**: explicit `Do NOT include <iframe> tags` rule added
  so future deep dive output never puts a conflicting embed in the body HTML.
- **Additional blog fixes this session**:
  - Delete button in Manage Posts was silently broken for posts with apostrophes in
    title (inline onclick JS string delimiter issue). Fixed to pass `this` + read
    title from DOM.
  - Modal `backdrop click` listener ran before modal HTML existed (TypeError halted
    script execution, blocking all functions defined after it). Fixed with
    `DOMContentLoaded` deferral.
  - Auto-close modal after successful delete.
  - **Body editor** added to Manage Posts: ✏ button expands raw HTML textarea,
    fetches body lazily via `GET /api/blog/body-live/:id` proxy, saves via patch-to-live.
  - `GET /admin/posts/:id` (returns full post incl. body) added to `src/routes/blog.js`.
  - `GET /body-live/:id` proxy route added to `src/routes/blog.js`.

## Commits — kre8r
- `4a6ee2c` voice calibration + AnalyticΩr fence questions + northr stats fixes + ML compliance
- `ec41938` fix: delete button broken for posts with apostrophes in title
- `f3f0b74` feat: Manage Posts body editor + auto-close after delete
- `5cd4212` fix: Manage Posts body editor now loads body from server
- `05a0ccf` fix: defer manage-posts-modal backdrop listener to DOMContentLoaded

## Commits — kre8r-land
- iframe updated: web-share + referrerpolicy + youtube.com + no modestbranding (Error 153 fix)

## Known Outstanding
- Body editor textarea still populating empty for the current post — body may be genuinely
  empty in DB (push-to-live may not have stored it). Hard refresh MailΩr may also be needed.
- Apr 30 blog posts should also be checked — same old iframe spec, probably also 153ing.

---

# Session 69 — HarvestΩr Architecture Planning + Kajabi Bridge (2026-04-30)

## Goal
Architecture review of GAMIFICATION_SPEC_V3.md (Opus-reviewed). Confirm tech stack decisions.
Wire Kajabi membership verification bridge on kre8r.app so HarvestΩr can verify members
without needing its own Kajabi credentials.

## What Was Built / Fixed

### HarvestΩr Architecture Decisions (no code — planning session)
- **Stack confirmed**: PWA → Capacitor → App Store. Vanilla JS + Express, same pattern as kre8r-land.
  Zero framework friction, Capacitor wraps the existing web app, no rewrite.
- **Location**: `C:\Users\18054\harvestomr\` — sibling to kre8r and kre8r-land. Own repo,
  own SQLite DB, own PM2 entry. Being scaffolded in a separate conversation.
- **Server**: Port 3011 on 7kinhomestead droplet. Nginx block for `rockrich.7kinhomestead.land`.
- **Auth**: Magic link (MailerSend free tier — 3k/month, same MailerLite login at mailersend.com).
  Do NOT use MailerLite for transactional — different product, wrong deliverability profile.
- **Kajabi role**: Gating only. HarvestΩr verifies membership via kre8r.app bridge (internal key),
  then manages all gamification state in its own DB. Kajabi community tab = WebView inside the app.
- **WKWebView gotcha**: On iOS, Capacitor WKWebView does NOT share Safari cookie store.
  Members will hit Kajabi login inside the Community tab on first open — session persists after that.
  "Seamless if already logged in on Safari" is Android-only. Noted in spec.
- **Kajabi as gating only** (correct call): Points, challenges, wins, skills, endorsements, leaderboards
  all live in HarvestΩr's own SQLite DB. Kajabi API queried only to confirm active membership tier.

### Kajabi Verification Bridge — kre8r.app (`src/routes/kajabi.js` + `server.js`)
- `POST /api/kajabi/member-check` added to kajabi.js:
  - Auth: `X-Internal-Key` header (INTERNAL_API_KEY)
  - Body: `{ email }`
  - Looks up contact by email via Kajabi API, checks tag relationships for tier tags
  - Returns `{ active: true, kajabi_contact_id, tier }` or `{ active: false, reason }`
  - Tier priority: founding50 (3) > garden (2) > greenhouse (1) — returns highest held
  - Reuses existing `KAJABI_TIER_TAGS` + `TIER_PRIORITY` constants already in kajabi.js
- `server.js`: `/api/kajabi/member-check` whitelisted in global auth guard (internal key
  handled inside route)
- HarvestΩr magic link flow: email → member-check → if active, issue magic link token →
  create/update local member record with kajabi_contact_id + tier

### Spec Files Added
- `GAMIFICATION_SPEC.md` — original spec (V1)
- `GAMIFICATION_SPEC_V2.md` — V2 (pre-Opus review)
- V3 lives in the harvestomr repo (being built in separate conversation)

## Commits — kre8r
- `(this session)` HarvestΩr: Kajabi member-check bridge + server.js whitelist

---

# Session 68 — Blog Post YouTube Embed Fix + Manage Posts Panel (2026-04-30)

## Goal
Fix missing YouTube video embed on second published blog post. Make blog body editable before
publishing. Add Field Notes blog card to 7kinhomestead.land/links page. Add Manage Posts panel
to MailΩr so published posts can be edited/fixed without regenerating.

## What Was Built / Fixed

### Blog: YouTube Embed Fix
- **Root bug**: `publishBlogPost()` in mailor.html used `currentProjectYoutubeUrl` which is only
  set when a project is loaded via the project picker. If blog was generated from a video directly
  (without a loaded project), it stayed null and the embed never made it into the DB.
- **Fix**: `publishBlogPost()` now falls back to `document.getElementById('seq-video-url')?.value`
  — the video picker input — so the URL is always captured regardless of project load state.

### Blog: parseBlogResponse Hardening
- Added trailing meta-commentary strip: after last closing HTML `>`, any non-HTML text is chopped.
  Fixes "code at bottom of post" — Claude occasionally appends dividers or explanatory sentences
  after the final closing tag.

### Blog: Manage Posts Panel (MailΩr)
- **📋 Manage Posts** button added next to the Blog Post checkbox in MailΩr.
- Opens a full-screen modal listing all live posts fetched from production.
- Each post card shows: title, status dot, date, read time, video indicator (✅/⚠).
- **Inline YouTube URL editor**: paste URL into input under any post, hit Update/Add Video.
  Patches the live post via `PATCH /api/blog/posts/:id` without touching body or title.
- **Delete button**: confirms then permanently removes post from live site.
- New proxy routes added to `src/routes/blog.js`:
  - `GET  /list-live` → proxies to `GET /api/blog/admin/posts` on production (internal key)
  - `POST /patch-to-live/:id` → proxies to `PATCH /api/blog/posts/:id` on production
  - `POST /delete-live/:id` → proxies to `DELETE /api/blog/posts/:id` on production
- All three proxy routes whitelisted in server.js global auth guard (both local and production).
- Production `PATCH` + `DELETE` + admin `GET` endpoints whitelisted in server.js so internal key
  reaches blog.js `requireAuth` without being blocked first.

### kre8r-land: Field Notes Blog Card
- Added "The Research Behind The Videos" section to `public/links/index.html`.
- `link-card teal` pointing to `https://7kinhomestead.land/blog` with 📓 icon.
- Inserted between TikTok card and Tools section.
- Deployed to 7kinhomestead droplet.

## Commits — kre8r
- `b273627` Blog: make body editable (contenteditable, render HTML, read DOM on publish)
- `f02d4ca` Blog: fix missing YouTube embed on published posts
- `c8471da` Blog: Manage Posts panel in MailΩr

## Commits — kre8r-land
- `8678201` Links: add Field Notes blog card

---

# Session 67 — Blog Pipeline Live + kre8r-land Crash Audit (2026-04-30)

## Goal
Get first blog post live at 7kinhomestead.land/blog. Fix kre8r-land crash loop (3500 restarts).
Fix blog JSON truncation. Debug and resolve the "Not authenticated" publish chain.

## What Was Built / Fixed

### Blog Pipeline — End-to-End Live
- **Root bug**: production server.js global auth guard was intercepting `POST /api/blog/posts`
  before blog.js's `requireAuth` (which accepts the internal key) ever ran. Only `GET` was
  whitelisted. Fix: added `POST /api/blog/posts` to server.js whitelist.
- **Push-to-live proxy** (`src/routes/blog.js`): local server proxies publish to kre8r.app
  using `INTERNAL_API_KEY`. No session needed. Same pattern as AffiliateΩr sync.
- **Blog JSON truncation fix** (`src/routes/mailor.js`): replaced JSON response format with
  plain-text `TITLE: xxx\n---\nHTML body` delimiter format. Claude no longer tries to JSON-encode
  long HTML bodies. `callClaudeRaw()` + `parseBlogResponse()` added.
- **parseBlogResponse hardened**: strips markdown code fences, extracts `<body>` from full HTML
  documents, handles `# heading` and `**bold**` in title line, has fallback for missing delimiter.
- **Blog system prompt tightened**: explicit rules — no meta-commentary, no full HTML documents,
  no code fences, skip missing URLs rather than fabricate them, strict TITLE:/--- format.
- **Publish button UX**: after success, button replaces itself with
  `✓ Published · View Post →` link to `7kinhomestead.land/blog/{slug}`.
- **First post live**: "Nobody Told Me This — And It Would Have Changed Everything"
  published at 7kinhomestead.land/blog. YouTube thumbnail, TOC, Rock Rich CTA working.

### kre8r-land Crash Audit (Opus background agent)
All 8 issues found and fixed, deployed:
1. **CRITICAL** `stateFull` ReferenceError (`sources.js`) — Temporal Dead Zone bug. Variable
   used on line 348 before declared on line 354. Threw on every OLH aggregator run.
   Primary cause of the 3500-restart crash loop. Fix: moved declaration above usage.
2. **HIGH** No `unhandledRejection` / `uncaughtException` handlers — any unhandled async
   error killed the process in Node 18+. Added both handlers to server.js.
3. **HIGH** `migrateOlhUrls()` bare call at module load — if DB not ready, crashed
   `require('./src/cron')` and server never started. Wrapped in try/catch.
4. **MEDIUM** SIGTERM handler could stall — `server.close()` callback never fired if
   `closeAllConnections` unavailable. Added 10s force-exit fallback (`gracefulShutdown()`).
5. **FRONTEND** `openPP()` crashed on `price/acres = 0 or null` — `Math.round(Infinity)`
   and `NaN.toLocaleString()` failures. Guarded all values with `|| 0` fallbacks.
6. **FRONTEND** `l.score` undefined — `ppScoreNum` rendered "undefined". Fixed with `score = l.score || 0`.
7. **BACKEND** `GET /:id` missing try/catch in listings.js — unstructured 500 on DB error.
8. **FRONTEND** `l.loc.split(',')` TypeError — guarded with `(l.loc || '').split(',')`.
9. **PM2** Added `listen_timeout: 10000` to ecosystem.config.js (OLH migration on boot).

## Commits — kre8r
- `ede494d` Blog: push-to-live proxy + internal key auth for POST /posts
- `81c2361` Blog: remove requireAuth from push-to-live (local-only route)
- `52ab55f` Blog: whitelist push-to-live from auth guard
- `77272a4` Blog: plain-text response format — no more JSON parsing on long HTML bodies
- `9c12d7d` Blog: harden parseBlogResponse + strict system prompt
- `dca9c75` Blog: whitelist POST /api/blog/posts in server.js auth guard (THE fix)

## Commits — kre8r-land
- `71e614c` Crash audit fixes: stateFull TDZ, SIGTERM, unhandledRejection, openPP guards

---

# Session 65 — AffiliateΩr Two-Way Sync + Opus 4.7 Audit + OLH URL Fix (2026-04-29)

## Goal
Wire Electron → production gear sync (Push/Pull), run Opus 4.7 architecture audit and close
all 5 punch list items, fix OLH listings going to 404 pages, stabilize multi-user DB topology.

## What Was Built / Fixed

### AffiliateΩr — Two-Way Sync (`kre8r`)
- `src/routes/affiliator.js`:
  - `POST /push-to-live`: local endpoint reads ALL `affiliate_links` from AppData DB, POSTs
    to production with `INTERNAL_API_KEY`. Sends all items (not just show_on_gear=1) so
    hidden/inactive state propagates correctly.
  - `POST /sync-from-electron`: production endpoint, `X-Internal-Key` auth. Full upsert —
    new rows INSERT, existing rows UPDATE with last-write-wins on `updated_at`.
  - `GET /gear-export`: production endpoint, returns all `affiliate_links` for pull sync.
  - `POST /pull-from-live`: local endpoint fetches gear-export from production, upserts into
    local DB. Allows Jason to pull Cari's kre8r.app edits before working.
  - `applySyncBatch()` helper: shared upsert logic for both sync endpoints. Handles INSERT
    for new rows, last-write-wins UPDATE for existing rows, skips UNIQUE collisions.
  - All manual edit paths now stamp `updated_at=datetime('now')`.
- `src/db.js`:
  - Added `updated_at DATETIME` column to `affiliate_links` via safe ALTER TABLE migration.
  - Added explicit pragma check for `updated_at` after batch migration (older SQLite compat).
  - Added `transaction: (fn) => _activeDb().transaction(fn)` to module.exports — routes were
    getting "db.transaction is not a function" because proxy never exposed it.
- `server.js`: auth whitelist entries for `/sync-from-electron`, `/gear-export`.
- `public/affiliator.html`:
  - Added 📥 Pull from Live button alongside 📤 Push to Live.
  - `pullFromLive()` function — shows "X added, Y updated" or "already in sync".
  - Push feedback now shows inserted + updated counts separately.

### DB Topology Investigation
- Confirmed: `.bat` launcher uses `AppData\Roaming\kre8r\kre8r.db` (12MB, active).
- `database/kre8r.db` in project folder was stale (4.8MB, April 23) — deleted.
- `kre8r-electron-backup.db` was git-tracked — untracked, added to `.gitignore`.
- `db.js` now logs loud warning when `DB_PATH` is unset.

### Opus 4.7 Architecture Audit (Sessions 32–65)
Full senior review of DB topology, multi-user sync, AffiliateΩr, and post-V2 additions.
All 5 punch list items closed:
1. ✅ Production DB backup — daily 3am cron, 14-day rolling (`/home/kre8r/backups/`)
2. ✅ `updated_at` + last-write-wins sync — prevents silent overwrites between Jason/Cari
3. ✅ INSERT/DELETE gap fixed — `applySyncBatch()` upsert + soft-delete via `active=0`
4. ✅ Stale DB deleted, backup untracked from git, `DB_PATH` warning added to `db.js`
5. ✅ Cari access model decision — parked (Electron setup when she's home), added to TODO

### OLH URL Format Fix (`kre8r-land`)
- Root cause: OLH feed has no URL field. Old construction was `{titleSlug}-{tract}` — wrong.
  Correct format verified against live site: `properties/{state}-land-for-sale/{titleSlug}`.
- `src/aggregator/sources.js`: fixed URL construction for all future OLH ingests.
- `src/aggregator/index.js`: one-time migration `migrateOlhUrls()` runs on startup.
  - Row-by-row with individual try/catch (UNIQUE collision fallback appends tract number).
  - Sentinel: skips if any OLH URL already contains `-land-for-sale/`.
  - Result: **134 OLH URLs fixed**, 551 skipped (no state/title data).
- Fixed port 3010 crash loop on kre8r-land server (PM2 auto-restart hitting EADDRINUSE).
- Fixed git object permissions (`chown -R landapp:landapp .git` after root pull).

## DB Notes
- Production DB backup cron installed: `sudo -u kre8r crontab -l` on kre8r.app droplet.
- `INTERNAL_API_KEY` confirmed set in kre8r.app `.env` and local `.env`.
- kre8r-land DB: `land.db` on `7kinhomestead` droplet at `/home/landapp/kre8r-land/database/`.

## Commits
- kre8r: ff39fe6, 6ccbc01, 6893176, 21218eb, 6eee43a, f1a6aca, 7192529, c68bf44
- kre8r-land: d31f646, 3972e49

---

# Session 63 — AffiliateΩr Gear Page + VaultΩr Dedup + db.prepare Fix (2026-04-26)

## Goal
Recover interrupted session (power outage mid-affiliator edit), finish gear page on
kre8r-land, add OG image scraping + manual upload to AffiliateΩr, fix partner add broken,
clean VaultΩr 35k phantom records, confirm vault loop fix live.

## What Was Built / Fixed

### AffiliateΩr — Gear Page Images (`kre8r`)
- `src/routes/affiliator.js`:
  - Added `multer` image upload to `public/uploads/affiliate/` → `POST /links/:id/image`
  - Added `scrapeOgImage()` → background OG scrape on link create + `POST /links/:id/rescrape`
  - `GET /gear-public`: now includes `og_image_url`; makes local upload paths absolute URLs
  - `POST /links`: changed from `RETURNING id` + `.get()` → `.run()` + `lastInsertRowid`
    (RETURNING id not reliable across better-sqlite3 versions — this was breaking partner add
    and links loading)
- `src/db.js`:
  - Added `og_image_url TEXT` column to `affiliate_links` via safe ALTER TABLE migration
  - Added `purgeArchivedFootage()` — hard-deletes all `quality_flag = 'archived'` records
  - Added `countFootage()` — paginated count for vault pagination bar
  - **Root fix**: added `prepare: (sql) => _activeDb().prepare(sql)` to `module.exports` —
    affiliator.js called `db.prepare()` directly but it was never exported; every single
    affiliator API call was silently 500-ing; partners tab showed empty, add partner did nothing
- `public/affiliator.html`:
  - Product image section in link modal: preview thumbnail, 📷 Upload Image, 🔄 Re-fetch from URL
  - `_activeLinkId` state tracks open link for post-save image upload
  - `setImgPreview()`, `uploadLinkImage()`, `rescrapeOg()` functions

### gear.html — kre8r-land (`kre8r-land`)
- Replaced hardcoded `GEAR` array with `GEAR_FALLBACK` + live fetch from `kre8r.app/api/affiliator/gear-public`
- `normalizeItem()` maps API shape to card fields
- `renderGear(items)` function — works with both live data and fallback
- Deployed to 7kinhomestead.land/gear — confirmed live ✅

### VaultΩr Cleanup (`kre8r`)
- `src/routes/vault.js`: added `POST /dedupe` and `POST /purge-archived` routes
- `public/vault.html`: Dedupe + Purge Dupes + Reset Scan buttons in scan-done banner
- Ran dedupe + purge — cleaned 35k phantom records (root cause: `runIngest` never cleared
  `to_ingest` array in prior session, same 3,853 files ingested ~9 times)

### VaultΩr Loop Fix — Confirmed Live (Session 62b fixes)
- `footageFilePathExists` now checks both `file_path` and `proxy_path` — proxy re-ingest loop eliminated
- `processProxyUpdate` propagates `project_id` to BRAW record — project assignment no longer silently dropped
- Vault confirmed stable: drop proxy → ingests once ✅

## Commits Needed
- kre8r: db.prepare export fix + og_image_url migration + purgeArchivedFootage + vault routes + affiliator image endpoints
- kre8r-land: gear.html live fetch (already committed `323262d`)

---

# Session 62b — VaultΩr Proxy Re-ingestion Loop + Project Assignment Fix (2026-04-26) AffiliateΩr + Three-App Auth Layer + VectΩr Auto-Run (2026-04-25)

## Goal
Build AffiliateΩr in Kre8r, wire session-based auth into KinOS and OrgΩr, implement
VectΩr Sunday auto-run cron, and architect the cross-app deployment strategy.

## What Was Built

### AffiliateΩr (`kre8r`)
- `src/db.js`: 3 new tables — `affiliate_partners`, `affiliate_links`, `affiliate_clicks`
- Pre-seeded 12 known partners (Amazon active, 11 pending with signup URLs)
- `src/routes/affiliator.js`: full CRUD for partners + links, analytics, tracked URL builder
- `server.js`: `/r/:partnerKey/:linkKey` public redirect endpoint (whitelisted from auth),
  click logging with optional `?vid=PROJECT_ID` video attribution, `/api/affiliator` mount
- `public/affiliator.html`: 4-tab UI — Partners (signup checklist), Tracked Links,
  Analytics (clicks/estimated commission/30-day chart), Link Generator
- `public/js/nav.js`: AffiliateΩr added to Dist dropdown

### KinOS Auth Layer (`kinos`)
- `bcrypt` + `express-session` installed
- `src/db.js`: `password_hash`, `remember_token` columns added to `family_members`;
  `express_sessions` table added
- `server.js`: inline SQLiteStore, session middleware, auth middleware (X-Member-Id
  injection from session — zero changes to 9 route files), login/logout/me/set-password
  routes, `KINOS_ADMIN_PW` first-run seed for parent accounts, `KINOS_INTERNAL_TOKEN` cron bypass
- `public/login.html`: avatar picker — 8 family member cards, click yours, enter password
- `public/manage-passwords.html`: admin sees all 8 members, sets any password; status badge
  flips live; Karen's card shows ♾ grandparent pill
- Karen (id=8, `grandparent_mode:true`): 10-year cookie on login — never logs in again
- Open-access fallback when no passwords configured (dev mode preserved)

### OrgΩr Auth Layer (`orgboard`)
- `bcrypt` + `express-session` installed; `.gitignore` created (first git repo init)
- `src/db.js`: `users` table + `express_sessions` table added
- `server.js`: same SQLiteStore pattern; auth middleware; full user CRUD API
  (`/api/auth/login`, `/api/auth/logout`, `/api/auth/users`, `/api/auth/set-password`,
  `/api/auth/status`); `ORGR_ADMIN_PW` seeds jason admin; duplicate `db` require removed
- `public/login.html`: clean username/password form
- `public/manage-users.html`: admin UI — add users, change passwords, delete users,
  role badges (admin/user), card turns green on save

### VectΩr Auto-Run (`kre8r`)
- `src/routes/vectr.js`: new `POST /api/vectr/weekly-auto` — runs full sync + calls
  Claude (non-streaming via `callClaudeMessages`) to generate strategic pre-read;
  stores result in `kv_store` as `vectr_auto_draft`; new `GET/DELETE /api/vectr/auto-draft`
- `server.js`: `scheduleVectrAutoRun()` — Sunday 14:00 UTC (10am ET) cron, fires
  `weekly-auto` endpoint, logs result
- `public/northr.html`: amber banner appears when auto-draft is waiting;
  `openVectrWithDraft()` opens VectΩr panel with pre-read injected as first assistant message;
  `checkVectrAutoDraft()` called on DOMContentLoaded

## Deployment Notes
**Three-app architecture decision:**
- Kre8r → stays on its own DO droplet (video processing, heavy workloads)
- KinOS + OrgΩr → shared $12/mo DO droplet (both are lightweight Express + SQLite)
- kinos.life already live; OrgΩr needs domain assignment
- Inter-app calls between KinOS + OrgΩr: localhost on shared droplet (reliable)
- Kre8r ↔ KinOS/OrgΩr: HTTPS with internal API key (established pattern)

**To activate auth on live servers:**
- KinOS: set `KINOS_ADMIN_PW` + `SESSION_SECRET` in .env, restart → seed fires automatically;
  log in as Jason → go to `/manage-passwords` → set all family member passwords;
  set Karen's last — she logs in once, never again (10-year cookie)
- OrgΩr: set `ORGR_ADMIN_PW` + `SESSION_SECRET` in .env, restart → jason seeded;
  go to `/manage-users` → add any additional users

## Pending (Next Sessions)
- Deploy KinOS + OrgΩr to shared DigitalOcean droplet
- Activate KinOS auth: set `KINOS_ADMIN_PW` + `SESSION_SECRET`, set passwords when Cari home
- Kre8r publish schedule → KinOS family calendar bridge (Tier 1 remaining)
- Rock Rich format profile in WritΩr (Tier 2)
- Update kre8r-land tool pages with tracked `/r/` affiliate URLs

---

# Session 62 — Dale Morning Brief + Affiliate→TreasΩr Bridge (2026-04-25)

## Goal
Build Dale morning CSW generator (OrgΩr Tier 1) and the AffiliateΩr → OrgΩr TreasΩr
commission bridge (Tier 1 cross-app bridge).

## What Was Built

### Dale Morning CSW Generator (`orgboard`)
- `src/routes/csw.js`: `POST /api/csw/morning-generate` — finds exec AIE per org (via
  `exec_aie_job_id` or falls back to top-level job with a persona), pulls org state:
  all stats + conditions, stale open orders >24h, TreasΩr bucket balances, active
  battle plans, strategic brief from Kre8r snapshot; builds full morning brief prompt
  as Dale persona; calls Claude to produce 2-3 CSWs as a JSON array; inserts all as
  `trigger_type: 'morning_brief'` status `pending`; idempotent — skips if already ran today
- `server.js`: daily 7am `setInterval` cron fires `morning-generate` with internal token;
  logs CSW count to console on completion
- **Live test**: generated 2 real CSWs on first run — situations referenced actual Kre8r
  pipeline data (content stalled 10+ days, email list 26 days cold, $0 TreasΩr)

### AffiliateΩr → OrgΩr TreasΩr Commission Bridge (`kre8r`)
- `src/db.js`: new `affiliate_commissions` table — tracks confirmed earnings with
  `orgr_synced` flag and `orgr_income_id` for reconciliation
- `src/routes/affiliator.js`:
  - `GET /api/affiliator/commissions` — list history with partner names
  - `POST /api/affiliator/commissions` — logs commission locally, then bridges to OrgΩr
    `POST /api/treasor/income/:orgId` (fire-and-store pattern)
- `.env`: added `ORGR_URL`, `ORGR_DEFAULT_ORG_ID`, `ORGR_INTERNAL_TOKEN` commented stubs
  (activate when OrgΩr is deployed and accessible from Kre8r)

## Activation Notes
- `ORGR_URL=http://localhost:3002` (local) or `https://orgr.yourdomain.com` (deployed)
- `ORGR_DEFAULT_ORG_ID=4` (7 Kin org id in OrgΩr)
- Commission bridge is dormant until both env vars are set — fails silently, logs locally

## Commits
- orgboard: `9ebcdc6 Add Dale morning brief generator — daily 7am CSW cron`
- kre8r: `69aafaf Add AffiliateΩr commission logging + OrgΩr TreasΩr bridge`

---

# Session 62b — VaultΩr Proxy Re-ingestion Loop + Project Assignment Fix (2026-04-26)

## Goal
Diagnose VaultΩr acting "dumb" — same clip ingesting repeatedly + footage not showing
in EditΩr even after project assignment.

## Root Causes Found

### Bug 1 — Proxy re-ingestion loop (`src/db.js`)
`footageFilePathExists(filePath)` only checked `file_path` column. Proxy files processed
via `processProxyUpdate` never get their own `file_path` record — only the BRAW record's
`proxy_path` column gets updated. So every server restart or chokidar re-trigger returned
"not ingested" for the proxy file, causing the full proxy pipeline to re-run endlessly.

**Fix**: `footageFilePathExists` now checks both `file_path` and `proxy_path`.

### Bug 2 — Project context not propagated through proxy update (`src/vault/intake.js`)
`processProxyUpdate` updated classification, thumbnails, codec, duration etc. but never
wrote `project_id` to the BRAW record. If BRAW was ingested before project context was
known (flat intake folder, no `[id]_slug` subfolder), and the proxy arrived via the
watcher with a projectId, the project assignment was silently dropped.

**Fix**: `processProxyUpdate` now writes `project_id` to the BRAW record if the BRAW
had none and the caller passed one.

## Intake Workflow Clarification (for old projects)
Projects created before the `[id]_slug` folder convention don't get auto-assigned by
the watcher. Two recovery paths:
1. Use VaultΩr bulk-assign after ingest (select clips → "Assign to Project")
2. Name the intake subfolder `[project_id]_anything` and watcher auto-assigns going forward

## Commits
- kre8r: fixes in `src/db.js` (footageFilePathExists proxy_path check) + `src/vault/intake.js` (project_id propagation) — confirmed live Session 63

---

# Session 60 — BattlePlanΩr Print Polish + Receipt Scanner Bridge (2026-04-24)

## Goal
Polish BattlePlanΩr print output (3 nitpicks from PDF review), build KinΩS receipt scanner
bridge into TreasΩr, and fix the receipt scanner itself which Cari reported as never working.

## What Was Built

### BattlePlanΩr Print Fixes (`orgboard/public/battleplan.html`)
- **Header**: Removed `· PLAN` type suffix; "BATTLE PLAN" now renders in red bold only
- **Legend cards**: Added `height:100%` to `.legend .l` — all 4 tier cards now equal height
- **Page breaks (from prior session)**: Already confirmed working perfectly by user

### TreasΩr ↔ KinΩS Receipt Scanner Bridge
**Backend** (`orgboard/src/routes/treasor.js`):
- New `POST /api/treasor/scan-receipt` endpoint — proxies base64 image to KinΩS at
  `http://localhost:3001/api/ai/scan-receipt`, returns parsed receipt JSON
- Server-side proxy means it works even when TreasΩr is accessed remotely

**Frontend** (`orgboard/public/treasor.html`):
- "📷 Scan Receipt" button added to Entry tab (teal, alongside Log Income / Log Expense / PO)
- Hidden `<input type="file" accept="image/*" capture="environment">` for camera/upload
- Canvas resize: 1600px max, 0.90 quality (same as KinΩS) before sending to backend
- Review modal: shows store name, date, all line items, total; pre-fills description/vendor/date/amount
- Bucket selector (auto-populated with org's configured buckets)
- Logs as single expense via existing `POST /api/treasor/expenses/:orgId` → updates balances live

### KinΩS Receipt Scanner Bug Fix (`kinos/src/routes/ai.js`)
**Root cause**: `max_tokens: 1500` was too low — a real grocery receipt with 20+ items
generates 2000–3000 tokens of JSON. Claude's response was being truncated mid-JSON,
causing `JSON.parse` to throw and returning a generic error to Cari.
- Bumped `max_tokens` from 1500 → 4096 for `scan-receipt` route
- Added explicit try/catch around `JSON.parse` with clear, actionable error message
- Requires `pm2 restart kinos` to go live

## Commits
- kinos: `Fix receipt scanner — bump max_tokens 1500→4096, add parse error handling`
- orgboard: not a git repo

---

# Session 59 — 7KH Homepage v11 + Water PDF + Member Count API (2026-04-24)

## Goal
Complete the Kajabi 7kinhomestead.com homepage v11: hover-expand tool preview video strip,
community section video replacement. Fix water calculator PDF. Build live member count API.

## What Was Built

### Water Calculator PDF Report (`kre8r-land/public/water.html`)
- Fixed broken `@media print` CSS (was accidentally nested inside `@media(max-width:480px)`)
- Replaced with solar-tool-style `window.open('','_blank')` isolated white HTML report
- Blue `#3b82f6` CTA button, 4 metric cards, spec table, water law box, BOM tables (Good/Better/Best)
- Affiliate links in BOM. Auto-prints on load via `window.onload=()=>window.print()`

### 7kinhomestead.land Homepage Video Banners (`kre8r-land/public/index.html`)
- Wistia autoplay/muted/loop video banners added above each of 5 tool cards
- IDs: Land=ppyykneltj, Lifestyle=311y3wvfph, Freedom=ao65emty5y, Solar=3uiwl9626y, Water=fhyf4qzggj

### Kajabi Homepage v11 (`7kin-homepage_v11.html` — full page custom code block)
**Tool Preview Strip** (below existing v10 Tool Shed block):
- 5 Wistia video tiles in a single row, hover → scale(2.35) forward over siblings
- Siblings dim to opacity:.22 + brightness(.45) while one is hovered
- CSS `:has()` expands strip padding-bottom from 64px → 420px on hover (no JS needed)
- Edge tiles: `transform-origin:top left` (first) / `top right` (last) — prevents off-screen bleed
- Middle tiles: `transform-origin:top center`
- Full-width Kajabi breakout: `width:100vw; left:50%; margin-left:-50vw`
- Tool description fades in on hover. Mobile: horizontal scroll, tap to expand.
- No "Open Tool" button — build value, require community join

**Community Section Video** (replaces base64 Jason photo):
- Wistia `aaairbit16` replaces `<div class="community-img">` base64 JPEG
- Hover: `scale(1.04)` + red glow (subtle — card is already full-size)
- Desktop hover → play, mouseleave → pause. Mobile tap toggles.
- Member badge overlay: `500+` count (red Bebas Neue), "People who 'get it'", subtext

### `/api/member-count` Endpoint (`kre8r-land/src/routes/member-count.js`)
- Public CORS-open endpoint at `https://7kinhomestead.land/api/member-count`
- Kajabi OAuth2 client_credentials token (same pattern as kre8r main AudiencΩr)
- Fetches contacts, caches result 1 hour in-memory
- `MEMBER_COUNT_OVERRIDE` env var: when set, skips Kajabi call (currently set to 500)
- Fallback chain: live → stale cache → hardcoded 500 (never breaks the badge)
- v11 community badge JS fetches this endpoint on load and updates `#community-count`
- Deployed to 7kinhomestead.land, live and tested

### 7 Kin Trusted Partners (TODO added)
- BillyLand, LandLimited, OnlineLandHub confirmed as trusted partners
- OnlineLandHub: RSS feed + referral commission agreement in place
- Full infrastructure spec added to TODO.md (partners table, affiliate param injection, badge display)

## Commits
- kre8r-land: `Add /api/member-count - live Kajabi count with 1h cache`
- kre8r-land: `Add MEMBER_COUNT_OVERRIDE env var`
- kre8r-land: `Homepage: add Wistia autoplay video banners to all 5 tool cards`
- kre8r-land: `Water tool: replace @media print with solar-style window.open PDF report`
- kre8r (main): TODO.md updated (Trusted Partners spec added)
- Kajabi v11: local file only — paste into Kajabi custom code block to deploy

---

# Session 58 — OIC + Dale AIE + Nav Redesign (2026-04-22)

## Goal
Build the Organizational Information Center (OIC) — weekly stat graphs, VFP conditions, Dale's
full org context. Fix Dale's stat blindspot. Redesign board.html nav to icon bar.

## What Was Built

### OIC — Organizational Information Center (`public/oic.html` + `src/routes/oic.js`)
Standalone page at `/oic`. Icon nav matching board.html aesthetic.
- **VFP Board**: every org/division/job VFP seeded into `vfp_conditions` table with condition badges
- **Stat cards**: 13-week line graphs (Chart.js), Y-axis auto-scales to data range (not zero-based),
  division-colored lines, current value prominent, delta % vs prior week, gap-aware (null = no line)
- **Condition badges**: clickable on every stat and VFP — picker sets Power/Affluence/Normal/Emergency/Danger/Non-Existence/Unassigned
- **+ Report button**: manual weekly snapshot entry per stat (date picker, value, note)
- **Responsible post**: assign which job owns each stat (shown on card)
- **⟳ Collect This Week**: manual trigger for weekly snapshot collection
- **⬡ Seed VFPs**: one-click seeds all org/division/job VFPs into condition board

### Weekly Snapshot Scheduler (`server.js`)
- `stat_weekly_snapshots` table: `UNIQUE(stat_id, week_start)` — one row per stat per Sunday
- Scheduler fires hourly; on Sunday 18:xx triggers collection for all orgs
- Startup missed-collection check: if Sunday has passed and no snapshots exist, collects immediately
- Collection pulls latest `stat_reports` value per stat and locks it as that week's Sunday snapshot
- 1-year retention (all rows kept); 13 weeks displayed in OIC graphs

### Dale's Context (fixed + expanded)
- **Stat blindspot fixed**: removed `kre8r_key IS NOT NULL` filter — Dale now sees ALL org stats
- Stats block now includes `condition` level and `owner` (responsible job title) per stat
- Employee chat route also fixed with same scope expansion

### Board.html Nav Redesign
- Full icon bar replacing text buttons: 34px icon buttons with CSS tooltip (::after, data-tip)
- Grouped by: View toggles | Intelligence (🔍 Analyze, 💬 Chat, 📊 OIC) | Admin (📦 Orders, 📬 CSW, 📋 Policy DB, 🎓 Qual, ⚖ Admin Scale) | System (🔗 Kre8r, ⎙ Export, ⚙ Org Settings)
- CSW badge wired to new `.n-badge` class
- Labels: POLICY DB, QUAL (renamed from POLICIES, QUALS)

### DB Migrations
- `ALTER TABLE stats ADD COLUMN condition TEXT DEFAULT 'unassigned'`
- `ALTER TABLE stats ADD COLUMN responsible_job_id INTEGER`
- New: `stat_weekly_snapshots (stat_id, org_id, week_start, value, note, source, UNIQUE(stat_id,week_start))`
- New: `vfp_conditions (org_id, source_type, source_id, title, responsible_job_id, condition, notes)`

### Action Library
- `orgboard.stat.report { stat_id, org_id, value, note, week_start }` — AIEs can report stats via CSW

## Smoke Test
- OIC endpoint: ✅ 7 divisions, 3 stats, 13-week slots populated
- VFP seed: ✅ 43 VFPs seeded for 7 Kin Homestead
- Weekly collect: ✅ fired on startup (missed-collection check), kre8r stat captured for Apr 19

## Commits
- (OrgΩr has no git repo — all changes in C:\Users\18054\orgboard)

---

# Session 57 — OrgΩr AIE (AI Employees) + CSW System (2026-04-22)

## Goal
Build AI Employees (AIEs) — real job cards with persona_name + personality fields — postable
to any job on the org board. Build a full Completed Staff Work (CSW) system following Hubbard
Admin Tech: AIEs generate CSWs on orders, humans respond Approve/Reject/CSWP/Dev-T, approved
CSWs execute deterministic actions (create policy, append log, create order, etc.).

## What Was Built

### AIE Job Fields (OrgΩr `src/db.js` + `src/routes/jobs.js`)
- `persona_name TEXT` + `personality TEXT` columns on `jobs` table (ALTER migrations)
- Jobs PUT endpoint updated to allow both fields
- AIE marker shows on job cards: ⬡ [name] badge, colored ASK button
- Job drawer: "Posted Employee Name" + Personality textarea
- Exec AIE: `exec_aie_job_id INTEGER` on `orgs` table — job with no division_id gets full org context

### CSW System (`src/routes/csw.js` + `src/routes/actions.js` — new files)
**`csws` table:** Full lifecycle — situation, analysis, options_considered, recommendation,
action_requested, action_type, action_payload, status (pending/approved/rejected/cswp/devt/failed),
response_note, devt_type, routed_to_job_id, timestamps.
**`job_log_entries` table:** Persistent memory per job — type, content, ref_csw_id.

**`actions.js` (action executor):** Deterministic switch dispatch on action_type:
- `orgboard.policy.create/update` — writes to job_policies table
- `orgboard.order.create` — inserts org_orders
- `orgboard.job_log.append` — appends to job_log_entries
- `orgboard.no_action` — acknowledged, no write
- `kre8r.project.update_stage` / `.flag_stalled` / `kre8r.ideas.update_status` — cross-app via fetch

**`csw.js` routes:** GET list (with joins), GET count (badge), GET /:id, POST (create),
POST /:id/approve (execute + log), /reject, /cswp, /devt.

### CSW Generator + Order Processor (`src/routes/claude-assist.js`)
- `buildAieContext(jobId)` — loads job, division, policies, stats (Exec AIE gets all-org stats),
  last 20 job log entries. Altitude: division_id null → Exec AIE → full org stats context.
- `POST /api/claude/csw/:jobId` — streams Claude to produce structured JSON CSW, self-checks
  for Dev-T, saves to csws table, auto-logs to job_log_entries.
- `POST /api/claude/order/:jobId` — creates org_orders (issued_to_aie=1), triggers CSW generator.
- ACTION_LIBRARY constant injected into system prompt — valid types + payload schemas.

### Employee Chat (`/api/claude/employee/:jobId`)
SSE chat endpoint with full persona context (division, policies, stats, personality, job log).
AIE notation in org analysis: `[AIE: name]` shown in analyze + chat job maps.

### Board UI (`public/board.html`)
- `📋 CSW <badge>` button in topbar, 30s badge polling via `pollCswBadge()`
- CSW slide-in panel: card per CSW with full situation/analysis/options/recommendation,
  action type + payload display, Approve/Reject/CSWP/Dev-T action bar
- Policy pre-fill: action_payload content editable inline before approval
- Job log section in job drawer (loads on edit open)
- ORDER button in emp-modal: converts input text to order → POST /api/claude/order/:jobId
- Exec AIE select in org settings

## Smoke Test Results
All 5 status paths verified end-to-end:
- devt (self-filed, not_needing_approval) ✅
- approved (action executed, job log auto-written) ✅
- rejected (note stored) ✅
- cswp (returned to sender with note) ✅
- failed (invalid action payload caught, badge excludes failed) ✅

## Commits
- (OrgΩr has no git repo — changes live in C:\Users\18054\orgboard)

---

# Session 56 — Media Kit Fixes + Kre8r↔OrgΩr Bridge (2026-04-22)

## Goal
Fix media kit visual issues (hero text clipping, portrait headshot swap, logo cell overflow).
Build a permanent live API bridge between Kre8r and OrgΩr so all Kre8r business metrics
report into the org board with customizable stat mappings per division.

## What Was Built

### Media Kit Fixes (`public/media-kit.html` + `public/media-kit-kajabi.html`)
- Hero text clipping: `html{overflow-x:hidden}`, font `clamp(48px,5vw,80px)`, grid `1.5fr 1fr`
- Portrait: swapped to `jason-headshot.png` (1250×2000 proper headshot), `object-position:center top`
- Logo cells: `.logo-cell img{width:100%;height:100%;object-fit:contain;display:block;}`

### Kre8r Stats Export Endpoint (`src/routes/stats-export.js` — new)
`GET /api/stats-export` — X-Internal-Key auth (INTERNAL_API_KEY env var), auth-whitelisted.
Exports: pipeline health, publishing stats (30d), vault counts, projects, ideas, viral clips,
copyright marks, active strategic brief, live MailerLite email metrics. All in try/catch.

### OrgΩr Kre8r Bridge (`C:\Users\18054\orgboard\src\routes\kre8r-bridge.js` — new)
6 endpoints: POST /sync/:orgId, GET /snapshot/:orgId, GET /available/:orgId,
GET /mappings/:orgId, POST /map, DELETE /map/:statId.
DB: `kre8r_key TEXT` migration on stats table + new `kre8r_bridge_snapshots` table.
OrgΩr server.js + .env updated. Restarted with --update-env.

### OrgΩr Board UI (`public/board.html`)
- `🔗 KRE8R` button in topbar
- Slide-in panel: Available tab (all stat keys + MAP button) + Mapped tab (active mappings + unmap)
- Assign modal: pick division, label, unit → creates/updates stats row with kre8r_key
- Division header badges: live stat values render inline on division headers after sync
- `loadKre8rMappings()` called on every org load so badges are always fresh

## Commits
- `15d2e0a` — Kre8r stats-export endpoint
- `cda2026` — Session 56 wrap-up docs

---

# Session 55 — VectΩr + VaultΩr Tag Filter + SyncΩr Overwrite + v1.0.7 (2026-04-20)

## Goal
VectΩr weekly strategic session (full build A+B), VaultΩr tag chip client-side filtering,
SyncΩr overwrite import for teleprompter laptop, Electron installer v1.0.7.

## What Was Built

### VectΩr — Weekly Strategic Session (NorthΩr slide-out panel)
**Backend (`src/routes/vectr.js`):** 7 endpoints — sync, SSE chat (full context + pushback
mechanic), session persist (kv_store), brief lock/history, active brief getter.
`strategic_briefs` table + 8 db functions. Active brief injected into Id8Ωr + WritΩr prompts.

**Frontend (northr.html):** Amber ⬡ button, 460px slide-out panel, live sync progress,
SSE chat stream, ⬡ Lock Vector button → brief review modal.

Proven in use: Jason ran a full session, landed a strategic direction, fixed a script tied
to a 125k-view / 5k-like / 525-comment video. Creator quote: "this tool is amazing."

### VaultΩr Tag Chip Client-Side Filtering
Backend/DB/Vision/cloud already existed. Fix: 8 edits to vault.html — activeFilters.tag,
applyFilters() tag match, active pill, session persist, tag cloud highlight. Zero API calls.

### SyncΩr Overwrite Import
`replaceProjectFromSnapshot()` in db.js. `/import` accepts `overwrite:true`.
Amber checkbox in sync.html. Teleprompter laptop now gets clean project updates on pull.

### Electron v1.0.7
Built + deployed to kre8r.app/download. `npm run dist:win` → 238MB installer.

## Commits
- `390cc86` — 12 files, 1964 insertions
