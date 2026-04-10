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
