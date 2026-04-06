# Kre8Ωr Session Log — 2026-04-05 (Session 21 — Engine vs Soul Audit + better-sqlite3 Migration)

## What Was Built — Session 21

---

### Engine vs Soul Audit — Complete

Full audit of all hardcoded creator-specific data across the codebase. Every violation replaced with reads from `creator-profile.json` via shared utility.

**New utility: `src/utils/creator-context.js`**
- `getCreatorContext()` — returns brand, creatorName, partnerName, voiceSummary, communityName, communityTiers, followerSummary, tiktokHandle, youtubeHandle, niche, tagline, contentAnglesText, profile
- `getCreatorOneLiner()`, `getCommunityBlock()`, `getVoiceBlock()`, `loadProfile()`
- `fmtFollowers()` helper (725000 → "725k")

**Files fixed (12 total):**
- `src/routes/id8r.js` — Replaced static `SYSTEM_PROMPTS` with `buildSystemPrompts()` fn using `getCreatorContext()`; all 8 callClaude sites pass sessionId; "Jason"/"7 Kin"/"725k" all sourced from profile
- `src/routes/generate.js` — System prompts, angle descriptions, goal map all dynamic from profile
- `src/routes/mailor.js` — `buildTierContext()` reads profile tiers; brand/community/followers dynamic; `founding_50` key fix
- `src/routes/analytr.js` — `isLiveStream()`, channel handle, coaching/thumbnail/DNA prompts all dynamic
- `src/routes/mirrr.js` — Same fixes as analytr.js
- `src/editor/selects.js` — Prompt uses profile niche/brand/followers
- `src/editor/selects-new.js` — Freeform rant and off-script gold prompts use profile fields
- `src/vault/intake.js` — VISION_PROMPT uses profile niche/brand
- `src/vault/cutor.js` — CutΩr system prompt uses profile fields
- `src/routes/davinci.js` — `--creator_name` arg uses `getCreatorContext().brand`

**`creator-profile.json` additions:**
- Added `creator.name`, `creator.full_name`, `creator.partner`, `creator.niche`, `creator.tagline`, `creator.mission` fields

---

### better-sqlite3 Migration — Complete

Migrated from sql.js (WebAssembly in-memory) to better-sqlite3 (native synchronous SQLite).

**`src/db.js`:**
- `const Database = require('better-sqlite3')` replacing sql.js
- `initDb()` now synchronous; WAL mode + foreign keys enabled via PRAGMA
- New helpers: `_run()`, `_get()`, `_all()` wrapping better-sqlite3 prepared statements
- `persist()` removed entirely — better-sqlite3 writes directly to disk
- `token_usage` table added (tool, session_id, input_tokens, output_tokens, estimated_cost)
- `logTokenUsage()` and `getTokenStats()` exported

**`server.js`:**
- `await initDb()` → `initDb()` (synchronous)
- Health check includes `instance` from creator-profile.json
- Console banner dynamically reads brand name from creator-profile.json

---

### Token Tracking — Id8Ωr

- All Claude API calls in id8r.js now log to `token_usage` table with sessionId
- `src/routes/beta.js` — `GET /api/beta/token-stats` endpoint
- `public/admin.html` — Section 6 "Token Usage & AI Cost" with stat cards + per-tool breakdown table

---

### App Icon + Favicon

- **`public/images/kre8r-icon.svg`** — 512×512 app icon. Bold K with Ω integrated into notch negative space. Dark background #0e0f0e, teal gradient #00d4b8→#009e88, rounded corners rx=80.
- **`public/favicon.svg`** — Same design, square (no rx) for favicon compatibility.

---

## Commits This Session
- (see git log)

---

# Kre8Ωr Session Log — 2026-04-05 (Session 20 — Marketing Kit + Collaborator Soul System)

## What Was Built — Session 20

---

### Marketing Kit — 3 public pages + beta API

Built the full Kre8Ωr public marketing presence:

- **`public/landing.html`** — Full marketing landing page. Particle canvas hero, pipeline diagram, live MirrΩr constellation mockup (canvas animation, 40 dots, 4 cluster labels), 4 HTML UI mockups (WritΩr, Id8Ωr, MirrΩr coaching, Pipeline), 17 tool cards grid, philosophy + Sine Resistentia etymology, beta application form → `/api/beta/apply`.
- **`public/media-kit.html`** — Print-optimized media kit. Brand story (Jaffa/Stargate etymology), problem/solution, 4-phase product overview, 7 Kin case study with full channel stats, brand assets (swatches, typography, wordmark, voice guidelines), print CSS.
- **`public/beta-invite.html`** — Minimal personal beta invitation. What you get / what we need, credentials block with `[USERNAME_PLACEHOLDER]` / `[PASSWORD_PLACEHOLDER]`, getting started guide (Soul BuildΩr → Id8Ωr → pipeline).
- **`src/routes/beta.js`** — `POST /api/beta/apply` (public), `GET /api/beta/applications` (admin), `PATCH /api/beta/applications/:id` (status update).
- **`src/db.js`** — `beta_applications` table migration (id, name, channel_url, platform, upload_frequency, why_text, status DEFAULT 'pending', created_at) + `insertBetaApplication`, `getAllBetaApplications`, `updateBetaApplicationStatus` helpers.

**Express routing fix:** Public routes declared FIRST in `server.js` — before `express.static` and any future auth middleware. Both `/landing` and `/landing.html` variants registered (same for media-kit and beta-invite). `/api/beta` also mounted at top.

**Production nginx fix:** `chmod 755` on `/home/kre8r` directories and `chmod 644` on the three HTML files. Landing, media-kit, and beta-invite now publicly accessible on kre8r.app without basic auth.

---

### Collaborator Soul System (committed earlier in session)

- **Soul BuildΩr** — 3-screen collaborator wizard (Who / Voice / Generate), export soul as `.kre8r`, import collaborator soul, update mode with list of all collaborator profiles.
- **PipΩr** — "WHO'S IN THIS VIDEO?" checkbox section on screen 1, loads all available creator profiles.
- **WritΩr** — Loads collaborator souls when project has them, injects multi-voice context with `[JASON]`/`[CARI]` speaker labels per beat.
- **DirectΩr** — `[J]` teal / `[C]` amber speaker badges on shot cards.
- **ShootDay** — Same speaker badges on beat cards.
- **DB** — `projects.collaborators` column (JSON array of slugs) + `getProjectCollaborators` / `updateProjectCollaborators` helpers.

---

### Other Fixes (same session)

- **Pipeline dashboard** — YouTube import filter: `getKre8rProjects()` excludes `source = 'youtube_import'`.
- **MirrΩr rebrand** — AnalΩzr → MirrΩr throughout nav, routes, and UI.
- **Production Runbook V2** — Dark theme rewrite matching `7-Kin-Content-OS-Architecture.docx`: `1a1a1a` bg, `00C4B4` teal, `0a2e2b` deep teal panels, Arial, cover with "KRE8**Ω**R" at 88pt.

---

## Commits This Session
- `2f58176` — pipeline dashboard fix, MirrΩr rebrand, runbook V2 script
- `4354471` — WISHLIST.md: Beta Feedback System entry
- `2f6aba8` — Collaborator soul system (8 files, 931 insertions)
- `173695f` — Runbook V2 dark theme + soul system commit (combined push)
- `b583fe4` — Marketing kit: landing, media-kit, beta-invite, beta API, DB migration
- `36c1e1a` — Fix: public routes before static/auth middleware, .html variants added

---

# Kre8Ωr Session Log — 2026-04-04 (Session 19 — PipΩr Id8Ωr Brief Enrichment + Bug Fixes)

## What Was Built — Session 19

---

### PipΩr — Id8Ωr Concept Card on Screen 2 (`public/pipr.html`)

Added a hidden teal info card (`#id8r-concept-card`) above the structure grid on screen 2. When a project arrives from Id8Ωr with `id8r_data`, the card shows:
- `✨ Id8Ωr Concept` label
- `#id8r-concept-headline` — `chosenConcept.headline`
- `#id8r-concept-why` — `chosenConcept.why`

Gives the creator context for picking story structure without having to remember what Id8Ωr recommended. Hidden by default — only appears when `id8r_data` exists and has a concept headline.

---

### PipΩr — Full Brief Block Pre-fill on Screen 3 (`public/pipr.html`)

Extended `checkLoadProject()` to parse `p.id8r_data` and build a formatted brief block injected into all three screen 3 content textareas (`#f-script`, `#f-what-happened`, `#f-hybrid-concept`) simultaneously. Whichever variant screen 3 shows based on `entry_point`, it's pre-filled.

**Brief block format:**
```
CONCEPT: {chosenConcept.headline}
WHY THIS WORKS: {chosenConcept.why}
OPENING HOOK: {chosenConcept.hook}
RESEARCH FINDINGS: {researchSummary — first 800 chars}
SELECTED TITLE: {packageData.titles[0].text}
SELECTED HOOKS:
- {packageData.hooks[0].text}
- {packageData.hooks[1].text}
ELEVATOR PITCH: {briefData.elevator_pitch}
STORY ANGLE: {briefData.story_angle}
TALKING POINTS: (5 bullets)
WHAT NOT TO DO: (3 bullets)
CONCEPT NOTE: {briefData.pipeline_brief.concept_note}
```

**Bug fixed in same pass:** `packageData.titles` and `packageData.hooks` are arrays of `{text, angle}` / `{text, type}` objects — not plain strings. Added `.text || fallback` so the title and hook lines render correctly.

---

### ComposΩr — Project Dropdown Bug Fix (`public/composor.html`)

**Root cause:** `GET /api/projects` returns a plain array, but `composor.html` was doing `(d.projects || []).forEach(...)` — `d.projects` was always `undefined`, fallback `[]` always used, dropdown was always empty.

**Fix:** `(Array.isArray(d) ? d : d.projects || []).forEach(...)`

**Audit:** Checked all 9 other files that call `GET /api/projects`. ComposΩr was the only one with the bug. director.html, editor.html, writr.html, m1, m5 all handle the plain array correctly. reviewr.html and shootday.html already had defensive fallbacks.

---

### Commits This Session

```
c34d4da  fix: ComposΩr project dropdown, PipΩr Id8r brief enrichment, nav fixes, crew brief PDF
d85366c  chore: Session 18 log + TODO update
0090197  feat: inject WritΩr script into PackageΩr, CaptionΩr, and MailΩr prompts
0f1c8c6  feat: crew brief PDF download using reportlab
3d9a4f8  feat: DirectΩr + ShootDay UX clarity improvements
```

---

## Files Changed — Session 19

| File | Change |
|------|--------|
| `public/pipr.html` | Id8Ωr concept card on screen 2; full brief block pre-fill in checkLoadProject(); .text fix for titles/hooks; briefData enrichment (elevator pitch, story angle, talking points, what not to do, concept note) |
| `public/composor.html` | Fixed project dropdown — `d.projects` → `Array.isArray(d) ? d : d.projects \|\| []` |

---

## Server State — End of Session 19
- PM2 online, all changes committed and pushed to master
- DigitalOcean deploy still needed: `pip install reportlab` required before crew brief PDF works on server
- Project 23 (Propane Water Heater) confirmed: full id8r_data with concept, briefData, packageData — ready to run through PipΩr → WritΩr
- Project 21 and 22 are duplicate tankless projects — consider archiving in favour of project 23

## Live Tests Confirmed — End of Session 19

**✅ Full pre-pipeline run (Id8Ωr → PipΩr → WritΩr):** Ran perfectly end-to-end. Id8Ωr concept card, brief block pre-fill, and all handoffs working as built.

**✅ AutomatΩr → Kajabi broadcast:** Ran perfectly. 4,300 emails sent. Playwright flow fully proven in production.

---

# Kre8Ωr Session Log — 2026-04-04 (Session 18 — Crew Brief PDF + Data Flow Gaps)

## What Was Built — Session 18

---

### DirectΩr + ShootDay UX Clarity (`public/director.html`, `public/shootday.html`)

- DirectΩr subtitle updated: "Your PipΩr beat map becomes a shot list. Select a project to load everything."
- `#selector-info` div shows beat count + structure + WritΩr flag after project load
- Both package buttons renamed to "📱 Send to Cari's Phone →" with "Generates an offline page she can open without wifi" subtitle
- Crew Brief panel: added "Share this with your crew before the shoot" descriptor + `📄 Download PDF` button (hidden until project loaded)
- ShootDay: `#project-title-bar` shows `projectTitle · STORY STRUCTURE` when project loaded
- ShootDay: Script tab labelled "WritΩr Script"
- ShootDay: Project selector cards show EP_LABELS badge (Script First / Shoot First / Vault First / Hybrid)
- ShootDay: One-time swipe tip card (localStorage `sd_swipe_shown`) prepended to shot list on first visit

---

### Crew Brief PDF (`scripts/pdf/crew-brief.py`, `src/routes/shootday.js`, `public/director.html`)

**New Python script** `scripts/pdf/crew-brief.py` — full reportlab PDF generator:
- Dark header with project title + date + target duration
- High concept card (teal border)
- Meta table: entry point, story structure, beats count, shoot location
- Beat map — one card per beat with shot type badge (TH=teal, B-roll=amber, action=red), beat name, emotional function, reality note, SAY TO CAMERA box (teal left border)
- Key Moments section — TH beats only, indexed
- Footer
- Reads JSON from stdin, writes PDF bytes to stdout

**`src/routes/shootday.js`** — New `GET /api/shootday/crew-brief/:project_id` route:
- Builds payload with project, beats, config, date, duration_minutes
- Spawns `crew-brief.py` via detectPython() + spawn()
- Returns `application/pdf` with Content-Disposition filename

**`public/director.html`** — `downloadCrewBriefPdf()` function fetches route, creates blob URL, auto-downloads with project-specific filename.

---

### Data Flow Gap Fix (`src/routes/generate.js`, `src/routes/mailor.js`)

**Problem identified:** PackageΩr, CaptionΩr, and MailΩr were generating from topic/clips alone — never reading the approved WritΩr script or project context from DB.

**`src/routes/generate.js`** — PackageΩr and CaptionΩr routes both now call `db.getApprovedWritrScript(project_id)` and inject `APPROVED SCRIPT:\n{scriptText}` into the Claude prompt when a script exists.

**`src/routes/mailor.js`** — Both `/broadcast` and `/sequence` routes now call `db.getProject(project_id)` and `db.getApprovedWritrScript(project_id)` when `project_id` is provided. Injects `PROJECT CONTEXT:` block with title, content_angle, high_concept, and first 500 chars of script.

---

### Commits This Session

```
0090197  feat: inject WritΩr script into PackageΩr, CaptionΩr, and MailΩr prompts
0f1c8c6  feat: crew brief PDF download using reportlab
3d9a4f8  feat: DirectΩr + ShootDay UX clarity improvements
044ef84  chore: Session 17 log + TODO update
```

---

## Files Changed This Session

| File | Change |
|------|--------|
| `public/director.html` | selector-info, PDF button, pkg-btn UX, downloadCrewBriefPdf() |
| `public/shootday.html` | project-title-bar, EP_LABELS badge, WritΩr Script label, swipe tip |
| `scripts/pdf/crew-brief.py` | New — full reportlab crew brief generator |
| `src/routes/shootday.js` | detectPython(), crew-brief/:project_id route |
| `src/routes/generate.js` | PackageΩr + CaptionΩr WritΩr script injection |
| `src/routes/mailor.js` | broadcast + sequence project context injection |

---

## Server State — End of Session 18
- All changes committed to master
- DigitalOcean deploy needed: `pip install reportlab` required on server before PDF route works
- Project 21 (Tankless Water Heater): needs PipΩr story structure + beats → then WritΩr
- 7 proxy files still waiting in `D:/kre8r/intake` — ingest not yet triggered

---

# Kre8Ωr Session Log — 2026-04-03/04 (Session 17 — Id8Ωr→PipΩr Handoff, WritΩr Research Context, Nav Audit)

## What Was Built — Session 17

---

### Id8Ωr → PipΩr Handoff Fix (`src/routes/id8r.js`, `public/pipr.html`, `src/db.js`)

**Root cause:** `pipr.html?project_id=` was intercepted by the existing `checkSettingsMode()` IIFE which showed the archive/settings panel instead of loading the project. Fixed by switching to `?load_project=` as a distinct param.

**`src/db.js`** — New `id8r_data` TEXT column on projects table (migration reuses `projectsCols3` check). New `updateProjectId8r(projectId, data)` function serializes the full Id8Ωr session as JSON blob.

**`src/routes/id8r.js` — `/send-pipeline`** — now calls `db.createProject()`, then `db.updateProjectPipr()` (sets `entry_point`, `content_type`, `high_concept`), then `db.updateProjectId8r()` (stores `chosenConcept`, `researchSummary`, `packageData`, `briefData`). Redirect uses `?load_project=` for PipΩr, `?project_id=` for WritΩr (unchanged).

**`public/pipr.html`** — Three additions:
1. `checkLoadProject()` IIFE — reads `?load_project=`, fetches project from API, pre-fills topic/title/entry_point, calls `selectEntry()` to mark card and auto-advance to screen 1, shows arrival banner after 350ms delay
2. Id8Ωr arrival banner (`#id8r-arrival-banner`) — teal notice: "Arrived from Id8Ωr — concept and entry point pre-loaded"
3. Vault first entry card (4th option): "I HAVE FOOTAGE IN THE VAULT" — triggers `vault_first` entry point

---

### WritΩr — Id8Ωr Research Context Injection (`src/routes/writr.js`, all 3 engines)

**Problem:** Script generation had no knowledge of WHY the video was being made — no concept, no research findings, no chosen angle.

**`src/routes/writr.js`** — Reads `project.id8r_data` JSON blob and builds `id8rBlock` string with section header `## CONTENT INTELLIGENCE FROM ID8ΩR RESEARCH`. Includes: chosen concept headline/why/hook, research summary (first 600 chars), top titles, elevator pitch, talking points, content angle.

**`src/writr/script-first.js`**, **`src/writr/shoot-first.js`**, **`src/writr/hybrid.js`** — All three engines updated: `buildPrompt()` now accepts `id8rBlock` and injects it between `## PROJECT CONFIG` and `## BEAT MAP`. `generateXxx()` functions pass it through.

**vault_first engine branch (`src/routes/writr.js`)** — Fetches all footage assigned to the project from DB, formats as clip inventory (`[shot_type] filename (Ns): transcript excerpt…`), passes to `generateShootFirst` with the clip list as `whatHappened`. Falls back gracefully if no clips found.

---

### Nav Audit + Update (`public/js/nav.js`, `public/mailor.html`)

**Audit** — All 23 HTML files checked for nav compliance (kre8r-nav div + nav.js script + initNav() call). Found `mailor.html` had div + script but no `initNav()` call — nav never rendered.

**`public/js/nav.js`** — Full dropdown restructure:
- Pre: Id8Ωr, PipΩr, WritΩr
- Prod: DirectΩr, ShootDay, TeleprΩmpter
- Post: VaultΩr, EditΩr, ReviewΩr, ComposΩr
- Dist: GateΩr (M1), PackageΩr (M2), CaptionΩr (M3), MailΩr (M4), AudiencΩr (M5), AutomatΩr, MirrΩr (soon)
- Removed: ResearchΩr, CoverageΩr, m4-email-generator
- Renamed: AnalytΩr → MirrΩr, fixed AudienceΩr → AudiencΩr

**`public/mailor.html`** — Added missing `initNav()` call.

---

### MailΩr — Link Inserter + HTML Email Output (`public/mailor.html`, `src/routes/mailor.js`)

Broadcast body changed from static display div to editable `<textarea>` pre-filled with generated HTML. Link inserter below each version card: label input + URL input + Insert Link button — wraps selected text as `<a>` tag or inserts at cursor. Claude now outputs HTML (`<p>`, `<br>`, `<a>`) not plain text for TinyMCE compatibility.

---

### Commits This Session

```
b912682  feat: nav restructure + fix MailΩr missing initNav
a2a11ab  feat: PipΩr vault_first entry point, Id8r auto-skip screen 0, arrival banner
89ab5fd  fix: Id8r→PipΩr handoff, research data preservation, WritΩr Id8r context injection
(+ Session 16 AutomatΩr commits — see below)
```

---

## Files Changed This Session

| File | Change |
|------|--------|
| `src/routes/id8r.js` | /send-pipeline: createProject + updateProjectPipr + updateProjectId8r + ?load_project= |
| `src/db.js` | id8r_data column migration + updateProjectId8r() function |
| `public/pipr.html` | checkLoadProject() IIFE, arrival banner, vault_first entry card |
| `src/routes/writr.js` | id8rBlock building + vault_first engine branch |
| `src/writr/script-first.js` | id8rBlock param + injection in buildPrompt |
| `src/writr/shoot-first.js` | id8rBlock param + injection in buildPrompt |
| `src/writr/hybrid.js` | id8rBlock param + injection in buildPrompt |
| `public/js/nav.js` | Full nav restructure — correct order, removed stale items, renamed tools |
| `public/mailor.html` | Added missing initNav() call; link inserter; editable body textarea |
| `src/routes/mailor.js` | HTML output prompt rule |
| `SESSION-LOG.md` | This file |
| `TODO.md` | Updated next 3 tasks |

---

## Server State — End of Session 17
- All changes committed and pushed to master
- Deployed to kre8r.app via `git pull + pm2 restart`
- Project 21 (Tankless Water Heater) needs PipΩr run (story structure + beats) before WritΩr
- 7 proxy files still waiting in `D:/kre8r/intake` — ingest not yet triggered

---

# Kre8Ωr Session Log — 2026-04-03 (Session 16 — AutomatΩr Playwright Broadcast End-to-End)

## What Was Built — Session 16

---

### AutomatΩr — Playwright `sendBroadcast` End-to-End (`src/playwright/kajabi.js`)

Iteratively fixed every step of the Kajabi broadcast wizard flow until the full run worked end to end.
All fixes used `page.evaluate()` JS clicks — Kajabi's React/web-component UI rejects standard Playwright selectors at almost every step.

**Step 3** — `Email Broadcast` type selection
Replaced 4-attempt guessing chain with single targeted evaluate:
```js
document.querySelector('[data-js-tabs-target="email-campaign-selection-option-broadcast"]').click()
```

**Step 5** — `Use Classic Editor` click
Replaced `waitForSelector` + `page.click()` with evaluate DOM walk:
```js
const els = Array.from(document.querySelectorAll('button, a'));
els.find(e => e.textContent.trim().includes('Classic Editor')).click();
```

**Step 6** — Broadcast title field
- Exact selector `#email_broadcast_title` confirmed
- Title now uses naming convention: `YYYY-MM-DD - {subject} - {segment || 'All Members'}`
- Continue button found via evaluate across `button` + `input[type="submit"]`, matching text or `.value`
- `waitForLoadState('networkidle')` → `waitForTimeout(3000)` (Kajabi SPA doesn't fire networkidle reliably)

**Step 7** — Segment + Save and Continue
- Removed all segment `selectOption` attempts — Kajabi default is already All Members, touching it broke the flow
- Save and Continue click unified across `pds-button`, `button`, `input[type="submit"]`

**Step 8** — Subject + body
- Subject: `input[name="email_broadcast[subject]"]` or `#email_broadcast_subject`
- Body: TinyMCE API injection — `window.tinymce.activeEditor.setContent(body)` with fallback to editor ID
- 3s wait before TinyMCE inject to allow iframe to initialize

---

### MailΩr — Link Inserter + HTML Email Output (`public/mailor.html`, `src/routes/mailor.js`)

**`src/routes/mailor.js`** — Prompt rule updated from "Plain text only" to "Output the email body as HTML" — `<p>`, `<br>`, `<a href>` tags. TinyMCE renders HTML natively; plain text did not.

**`public/mailor.html`** — Broadcast body output changed from static display div to editable `<textarea>` pre-filled with generated HTML. Link inserter added below each version card:
- Label input + URL input + Insert Link button
- Wraps selected text as `<a href="URL">selected</a>` or inserts at cursor
- Copy Body and Send via Kajabi both pull from live textarea (edits and inserted links included)

---

### Commits This Session

```
88c0b50  fix: Steps 3+4 sendBroadcast — 4-attempt broadcast type selection + :not([disabled]) Continue button
588b72e  fix: Step 3 sendBroadcast — click Email Broadcast via data-js-tabs-target attribute
72d0850  fix: Step 6 sendBroadcast — exact #email_broadcast_title selector + evaluate Continue click
109f231  fix: Step 6 sendBroadcast — also match 'Create' button text and data-disable-with
0b1361e  fix: Step 5 sendBroadcast — evaluate click Classic Editor button
ef05644  fix: Step 6 sendBroadcast — include input[type=submit] and .value checks in Continue click
86d9a83  fix: Step 6 waitForTimeout(3000); Step 7 segment via select[name=segment] with fallback
47e3b76  fix: Step 7 sendBroadcast — pds-button web component click + segment fallback to All Members
3d21d3f  fix: Step 6 title convention; Step 8 exact subject selector + TinyMCE body injection
c9d9528  feat: MailΩr link inserter + HTML email body output for TinyMCE
79a8454  fix: Step 7 sendBroadcast — skip segment selection, use default All Members
02852d0  feat: AutomatΩr Playwright broadcast flow working end to end
```

---

# Kre8Ωr Session Log — 2026-04-02 (Session 15 — Docs, Proxy Pipeline Debug, Selects Fix)

## What Was Built — Session 15

---

### Documentation (`README.md`, `OPUS_REVIEW.md`)

- **`README.md`** — Created clean professional README covering: what Kre8Ωr is, prerequisites, installation, environment variables, instance configuration, running locally (dev + PM2), full pipeline overview, module reference for every tool, project structure, tech stack, database notes, DaVinci caveat, license.
- **`OPUS_REVIEW.md`** — Created structured architecture review document for Charlie meeting (potential technical co-founder). Covers: pipeline overview, tech stack, 5 evaluation questions (architecture health, Id8Ωr flow, commercial viability, creator profile pattern, what's missing), current known issues, commercialization thinking.
- Both committed and pushed: `a3f58cb — docs: README, OPUS_REVIEW — clean professional docs for Charlie meeting`

---

### VaultΩr — Export Proxies Button (`public/vault.html`)

- Added **Export Proxies** button to each DaVinci project card in the `renderDvpCard()` function
- Button ID: `ep-btn-{project_id}` — allows disabling during render
- Click flow: `prompt()` for BRAW folder path → `POST /api/davinci/export-proxies` with `{ project_id, braw_folder_path }` → disables button + shows "Rendering…" → toast on success/failure → `loadDavinciProjects()` refresh
- `exportProxies(projectId, projectName)` function added after `addNextTimeline()`
- Endpoint already existed (`src/routes/davinci.js` line 159) — this was the missing UI

---

### EditΩr Selects Engine — Bug Fixes (`src/editor/selects-new.js`)

Three fixes to unblock CutΩr from running on project 18 footage:

1. **`script.trim()` guard** — Added `typeof script === 'string'` check before both `.trim()` calls in `detectShootMode()`. Prevents crash when `script` is not a string (e.g. object or null from DB).

2. **`talking_head` shot type** — `classifyClipForSelects()` only checked for `'talking-head'` and `'dialogue'`. VaultΩr stores the value as `'talking_head'` (underscore). Added `|| shotType === 'talking_head'` to the condition — clips now correctly route to selects logic instead of falling through to `keep_flag`.

3. **Confidence check removed** — `classifyClipForSelects()` had `|| confidence < 0.7` in the mixed/uncertain branch. `classification_confidence` is not stored in the DB for any current footage (returns `undefined` → defaults to `0`). The `0 < 0.7` check was blocking every clip. Removed entirely — routing now based on `shot_type` only, which VaultΩr classification provides reliably.

---

### Proxy Pipeline — Investigation & Diagnosis

Investigated why clips 587 and 588 (project 18, `A009_` BRAW files from `H:\The Rock Rich Community Launch\`) can't be transcribed:

- Both have `proxy_path: undefined` — no proxies ingested yet
- `callWhisper(clip.file_path || clip.proxy_path)` falls back to the `.braw` path which Whisper can't read
- VaultΩr intake watcher confirmed on `D:/kre8r/intake`
- **Found:** 7 proxy `.mp4` files already exist in `D:/kre8r/intake` including `A009_03211400_C039_proxy.mp4` and `A009_03211408_C040_proxy.mp4`
- **Root cause:** Proxies are in the intake folder but have NOT been ingested yet — confirmed `findBrawByBasename()` exists in `db.js` and will correctly match on backslash path patterns, so ingest will auto-link them once triggered
- **Resolution:** Trigger VaultΩr ingest on `D:/kre8r/intake` to pick up the waiting proxy files

---

### DB Maintenance

- Unassigned 5 stale clips (IDs 582–586) from project 18 via `PATCH /api/vault/footage/:id { project_id: null }`
- Project 18 now has exactly 2 clips: 587 and 588

---

## Files Changed This Session

| File | Change |
|------|--------|
| `README.md` | Created — full professional README |
| `OPUS_REVIEW.md` | Created — architecture review for Charlie meeting |
| `public/vault.html` | Export Proxies button + `exportProxies()` function |
| `src/editor/selects-new.js` | script.trim() guard, talking_head match, confidence check removed |
| `public/js/nav.js` | CutΩr added then reverted (cutor.html doesn't exist yet) |
| `SESSION-LOG.md` | This file |
| `TODO.md` | Updated next 3 tasks |

---

## Server State — End of Session 15
- PM2: online, pid 24020, 57.9mb, no errors
- Watcher: `D:/kre8r/intake` — 7 proxy files waiting to be ingested
- All selects-engine fixes saved and restarted

---

# Kre8Ωr Session Log — 2026-04-02 (Session 14 — Id8Ωr Research Phase Overhaul)

## What Was Built — Session 14

---

### Id8Ωr — Bug Fixes & Rate Limit Architecture (`src/routes/id8r.js`, `public/id8r.html`)

#### Bug Fixes
- **Double-fire on mode select** — `querySelectorAll('[data-mode]')` was attaching click listeners to both `.mode-card` divs AND the `.mode-btn` buttons inside them, triggering two `/start` calls per click. Fixed by scoping selector to `.mode-card[data-mode]` only — button clicks bubble up to the card once.
- **`anthropic-beta` header** — confirmed correct value `'web-search-2025-03-05'` was in place from previous session.

#### Research Phase — Complete Rewrite
**Root cause:** 3 parallel Claude web_search calls (each up to 2048 tokens output) + summarization all fired within the same rate-limit window (30k input tokens/min), causing cascade failures on mindmap/package/brief.

**Backend changes (`src/routes/id8r.js`):**
- Research passes changed from `Promise.allSettled` parallel → fully sequential
- Added `getRecentMessages(messages, maxExchanges=6)` helper — windows conversation to seed + last 12 messages for all Claude calls
- YouTube and Data `max_tokens` reduced 2048 → 1024
- `/start` handler `max_tokens` reduced 512 → 256
- Research phase restructured into 4 explicit phases with SSE events:
  - `phase_start` → `phase_result` → `phase_wait {duration:65}` → 65s server-side `setTimeout` → next phase
  - Phase 1: YouTube (Claude web_search)
  - Phase 2: Data & Facts (Claude web_search)
  - Phase 3: VaultΩr cross-reference (local DB, no Claude)
  - Phase 4: Summarization (Claude, no wait after)
- Summarization wrapped in proper try/catch — fallback only fires on actual error
- Summarization input sliced: YouTube/Data at 2000 chars, Vault at 500
- `/mindmap`, `/package`, `/brief` all use `session.researchSummary` (condensed) not raw `session.researchResults`
- `/mindmap` adds `session.mindmapCache` — subsequent calls return cached result instantly
- `conversationText` in all downstream routes uses `getRecentMessages()` window

**Frontend changes (`public/id8r.html`):**
- Static 3-card research grid replaced with a live `#research-feed` — cards append dynamically as events arrive
- `phase_result` renders a phase card per type:
  - YouTube: extracts title lines as visual cards + truncated text
  - Data: extracts bullet points as `<ul>` + truncated text
  - Vault: clip name cards or plain status text
- `phase_wait` renders a countdown card with:
  - Large ticking countdown number (65 → 0)
  - Rotating musing quote (10 MUSINGS array, rotates every 10s with fade transition)
  - Progress bar depleting in sync with countdown
  - "Skip wait →" button — clears countdown visually, server wait continues naturally
- Delegated `click` handler on `#research-feed` handles all show-more/show-less toggles for dynamically created content

---

### Debug Logging Added & Left In
- `[mindmap] messages chars / summary chars / total chars` — console.log before Claude call in `/mindmap`
- Intentionally left for ongoing token monitoring

---

## Server State — End of Session 14
- PM2: online, pid 20468, uptime ~26min, 0 restarts since last manual restart
- All changes saved, no uncommitted issues
- Id8Ωr full flow tested: mode select → conversation → research phases → mind map

---

# Kre8Ωr Session Log — 2026-03-31 (Session 13 — Deployment + Upload Feature)

## What Was Built — Session 13

---

### Pre-Deploy UI Fixes (3 pages)

#### EditΩr — Footage Guard (`public/editor.html`)
- Added `projectsMap` to store full project objects on load
- `onProjectChange()` now checks `footage_count === 0` before enabling Build Selects
- If no footage assigned: Build Selects button disabled, amber notice shown inline:
  *"No footage assigned to this project yet. Go to VaultΩr and assign footage first."*
- Guard div injected once and toggled on project change — no DOM bloat

#### M2 PackageΩr — Empty State (`public/m2-package-generator.html`)
- `renderCutorPanel()` previously returned silently when `clips.length === 0`
- Now shows the CutΩr panel with count "0 APPROVED CLIPS" and message:
  *"Run CutΩr first to identify your strongest moments — packages will be built around those clips."*

#### ComposΩr — Prompt Mode UX (`public/composor.html`)
- Replaced amber warning energy with teal "active feature" framing
- `.suno-fallback` CSS changed from amber → teal (background, border, text color)
- Added `.prompt-mode-banner` CSS block + `#promptModeBanner` HTML element
- `checkSunoKey()` now toggles the banner: shows teal panel when `!sunoOk`:
  *"PROMPT MODE ACTIVE — Claude will write your Suno prompts. Paste them at suno.com/create."*
- Status pill changed from `⚠ No Suno Key` → `● Prompt Mode` (teal, not amber)
- Per-track fallback text: `"📋 Copy prompt → paste at suno.com/create → upload audio above"`

---

### Project 19 Archived
- Called `PATCH /api/projects/19/archive` to remove test project "1" from dashboard

---

### db.js — approveWritrScript Fix (`src/db.js`)
- `approveWritrScript()` now un-approves any previously approved script for the same project before marking the new one approved
- Prevents multiple `approved = 1` rows per project which caused stale script bugs in TeleprΩmpter

---

### Voice Profile — Owner Financed Land (`creator-profile.json`)
- Added full voice analysis entry for "Owner Financed Land.mp4"
- Captures rapid-fire sentence rhythm, embedded humor pattern, directness=8, formality=2
- Available for WritΩr weighted profile blending

---

### Git — Branches Aligned
- `feat/editor` and `master` pushed to GitHub
- Discovered `main` (GitHub default branch) was stale at an older commit
- `master` merged into `main` and force-synced — all branches now at same tip
- `master` is the working branch; every push now goes to both `master` and `main`

---

### DigitalOcean Deployment Scripts (`deploy/`)

#### `deploy/digitalocean-setup.sh`
Full fresh-droplet setup script for Ubuntu 22.04 LTS. Steps:
1. `apt-get update` + system packages (ffmpeg, nginx, certbot, python3-pip, ufw)
2. Node.js 20 via NodeSource
3. openai-whisper via pip3
4. PM2 global install
5. `kre8r` user creation
6. Git clone from `github.com/7kinhomestead/kre8r`
7. `npm install --production`
8. `.env` creation with `ANTHROPIC_API_KEY` placeholder
9. PM2 start + save + systemd startup hook
10. nginx reverse proxy: port 80 → 3000, WebSocket upgrade headers, `proxy_buffering off` for SSE, 500MB upload limit
11. Basic auth: username `demo` / password `kre8r2024` via `apache2-utils` + `.htpasswd`
12. UFW firewall: SSH + Nginx Full only

Run on fresh droplet:
```
curl -fsSL https://raw.githubusercontent.com/7kinhomestead/kre8r/main/deploy/digitalocean-setup.sh | bash
```

#### `deploy/deploy.sh`
One-liner redeploy script for future code pushes:
```bash
bash /home/kre8r/kre8r/deploy/deploy.sh
# git pull → npm install → pm2 restart
```

---

### VaultΩr — Direct Device Upload (`src/routes/vault.js` + `public/vault.html`)

#### Backend — `POST /api/vault/upload`
- New multer disk-storage instance: saves to `./uploads/` (override via `UPLOAD_DIR` env var)
- `uploads/` directory auto-created on server start if missing
- Accepts: mp4, mov, mts, avi, mkv, braw, r3d, ari — up to 10GB
- Filenames: `{timestamp}_{original_name}` to prevent collisions
- Runs `ingestFile()` (same path as folder ingest) for full classification pipeline
- Streams SSE: `uploaded` → `ingesting` → Vision classification events → `done`
- Deletes uploaded file from disk if intake fails (no orphaned files)

#### Frontend — "Upload from Device" section (`public/vault.html`)
- New `<!-- Upload from Device -->` section between Ingest Folder and DaVinci Projects panels
- Drag-and-drop zone with `dragover` / `dragleave` / `drop` handlers
- Hidden `<input type="file" accept="video/*">` fills the entire zone for tap-to-select (mobile-friendly)
- XHR upload (not fetch) for byte-level `progress` events
- Progress bar: 0–60% = upload bytes, 60–100% = intake classification
- SSE chunks parsed from `xhr.responseText` as they arrive (chunked streaming)
- Multi-file queue: files uploaded and ingested sequentially
- `fmtBytes()` helper formats transfer progress as KB / MB / GB
- Upload project select wired into `loadProjects()` targets array — auto-populated
- New CSS: `.upload-drop-zone`, `.upload-drop-zone.drag-over`, `.upload-progress-bar-*`, `.upload-log`, `.upload-bytes`
- Mobile-responsive: reduced padding at `max-width: 600px`

---

## Files Changed This Session

| File | Change |
|------|--------|
| `public/editor.html` | footage_count guard, projectsMap |
| `public/m2-package-generator.html` | empty state when no cuts |
| `public/composor.html` | Prompt Mode banner, teal fallback styling |
| `public/vault.html` | Upload from Device section + JS + CSS |
| `src/routes/vault.js` | POST /api/vault/upload endpoint |
| `src/db.js` | approveWritrScript un-approves previous |
| `creator-profile.json` | Owner Financed Land voice sample |
| `deploy/digitalocean-setup.sh` | Full DigitalOcean setup script |
| `deploy/deploy.sh` | Redeploy script |
| `SESSION-LOG.md` | This file |
| `TODO.md` | Updated next 3 tasks |

---

## Commits This Session

```
a0f2063  feat: VaultΩr direct device upload with live progress
386ae9e  Add DigitalOcean deployment scripts
760f1f4  Pre-deployment: all fixes, audit complete, ready for kre8r.app
5aa2ab7  Merge feat/editor → master
```

---

## Server State
- Local: PM2 running `kre8r` on port 3000
- GitHub: `main` and `master` both at `a0f2063` (in sync)
- Deploy script: live at `https://raw.githubusercontent.com/7kinhomestead/kre8r/main/deploy/digitalocean-setup.sh`

---

## Session 15 — 2026-04-05

### What Was Built

**MirrΩr — Content DNA (new section in mirrr.html)**
- D3.js v7 force-directed constellation graph — 263 YouTube nodes sized by view count, colored by topic cluster
- Niche Definition panel — SSE-streamed Claude analysis of channel identity
- Audience Profile panel — structured cards (demographics, desires, fears, trust signals) with "Save to My Soul →" button that writes to `creator-profile.json`
- Three new routes in `src/routes/mirrr.js`:
  - `GET /api/mirrr/content-dna/graph` — builds node/cluster data, top-50 clustering, 24h kv_store cache
  - `POST /api/mirrr/content-dna` — streams Claude niche + audience analysis via SSE
  - `PATCH /api/mirrr/creator-profile-audience` — saves audience profile to creator-profile.json

**Graph clustering improvements**
- Cache-first: serves from `kv_store` in 4.7ms on hit; busts on `?refresh=1`
- Top-50 by view count sent to Claude for clustering (not all 263) — token-safe, fast
- All 263 nodes tagged using title-lookup map with fallback cluster
- Prompt rewritten: top 10 videos listed explicitly, cluster names must be anchored to high-performing videos not keyword patterns — "Financial Escape" earns its name from the 421k-view video, not title matching

**Source discrimination — dropdown pollution fix**
- `projects.source TEXT DEFAULT 'kre8r'` column added via migration in `src/db.js`
- YouTube imports stamped `source='youtube_import'` at ingest
- `GET /api/projects?source=kre8r` filter added to `src/routes/projects.js`
- 6 tool HTML files patched (`writr`, `composor`, `director`, `shootday`, `editor`, `reviewr`) — all dropdowns now exclude YouTube import projects

**kv_store cache table**
- `CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME)` added to `src/db.js` migrations
- `getKv(key)` / `setKv(key, value)` helpers added and exported

**MirrΩr stat cards bug fix**
- Root cause: `buffer.split('\n')` in inject-dna-js.js evaluated the `\n` as a literal LF character inside a backtick template literal, embedding a real newline into the HTML file at `buffer.split('` + LF + `');`
- This broke the entire inline `<script>` block, silently preventing `loadChannelHealth()` from ever running
- Fixed via hex byte replacement (`0a` → `5c6e`) using `fix_mirrr.js`
- Verified clean with extracted script block check — "No broken LF pattern found — CLEAN"

**Graph metric bug fix**
- `getAnalyticsByProject()` returns `metric_value` column; graph route was reading `.value` (undefined)
- All 263 nodes were silently assigned `views: 0` — "top 50" was arbitrary order
- Fixed: `.value` → `.metric_value` on all three metrics (views, likes, comments)
- After fix: top node correctly shows 421,582 views, clustering reflects real performance distribution

**kie.ai 402 noise suppression**
- `src/composor/suno-client.js`: 402/429 responses now throw a `noCredits` error object — no `console.error`, no PM2 log spam
- Catch block demoted to `console.log` for no-credits path
- `src/routes/composor.js`: after 3 consecutive `no_credits` results, queue bails, remaining tracks stamped `NO_CREDITS`, `credits_exhausted` SSE event pushed
- `public/composor.html`: `credits_exhausted` event now renders amber 💳 banner with generated count and manual generation instructions

**WISHLIST.md**
- Added: MirrΩr Content Format Discrimination (long form / short form / live stream, `contentDetails.duration` parsing, format badges on constellation nodes, live streams dimmed + excluded from coaching averages by default)

### Files Changed
| File | Change |
|---|---|
| `public/mirrr.html` | Content DNA section (graph, niche panel, audience panel), D3.js, fixed LF syntax bug |
| `src/routes/mirrr.js` | 3 new content-dna routes, YouTube import source stamp, graph metric fix, improved clustering prompt |
| `src/db.js` | `projects.source` migration, `kv_store` table, `getKv`/`setKv`, `getAllProjectsBySource`, `setProjectSource`, `getPipelineSummary(source)` |
| `src/routes/projects.js` | `?source=` filter on `GET /api/projects` |
| `src/composor/suno-client.js` | 402/429 noCredits error, no console.error spam |
| `src/routes/composor.js` | Consecutive 402 bail, NO_CREDITS stamp, credits_exhausted SSE |
| `public/composor.html` | credits_exhausted amber banner |
| `public/writr.html` | `?source=kre8r` on projects fetch |
| `public/director.html` | `?source=kre8r` on projects fetch |
| `public/shootday.html` | `?source=kre8r` on projects fetch |
| `public/editor.html` | `?source=kre8r` on projects fetch |
| `public/reviewr.html` | `?source=kre8r` on projects fetch |
| `WISHLIST.md` | Content format discrimination entry |
| `fix_mirrr.js` | One-shot hex repair script (kept in repo) |

### Known Issues Identified This Session
- "Financial Escape" cluster absorbs 227 of 263 videos — channel's content skews heavily financial, this is accurate not a bug. Will naturally rebalance when TikTok/Lemon8 data is added.
- Content DNA niche and audience panels not yet tested end-to-end (graph confirmed working; SSE panels need live test)

### Commits This Session
```
c253b66  feat: cluster names anchored to top-performing videos — top 10 explicit, performance defines identity
bc51706  wish: MirrΩr content format discrimination — long form / short form / live stream
bd97196  fix: graph nodes now read metric_value (not .value) — real view counts restore node sizing
624516e  fix: MirrΩr stat cards JS parse bug, kie.ai 402 noise suppression, ComposΩr credits exhausted banner
42f5d29  fix: kie.ai noise suppression, stat cards syntax fix, credits_exhausted UI banner
3053422  feat: Content DNA graph caching, top 50 clustering, source discrimination fix
f3dce5b  feat: Content DNA constellation graph, niche definition, audience profile, dropdown pollution fix
```

### Server State
- Local: PM2 online, port 3000, 90 restarts, 81MB — clean
- GitHub: master at `c253b66`
- DigitalOcean: not yet deployed this session (see TODO Task 2)

---

## Session 14 — 2026-04-02

### What Was Built
- SelectsΩr v2 (`src/editor/selects-new.js`) — three shoot modes (SCRIPTED/HYBRID/FREEFORM),
  decision gate, conservative cuts, mixed clip flagging. Confidence check removed —
  routes purely on shot_type. Accepts both talking-head and talking_head.
- `src/utils/claude.js` — shared Claude API caller extracted, used everywhere
- BRAW auto-proxy trigger — intake.js fires DaVinci proxy export automatically on BRAW ingest
- Vault paths moved to D:\ — main drive protected
- BRAW → proxy → classify pipeline tested end to end (4 clips live)
- MailΩr (`/mailor.html`) — new page, broadcast A/B mode, sequence mode, voice blend,
  blog post + community post checkboxes, Kajabi connection banner, copy working
- VaultΩr completed-video classification — 132 clips reclassified, gold tag, filter chip,
  natural language search vocabulary updated
- Voice analysis button on completed-video cards in VaultΩr
- TeleprΩmpter — dual QR codes with role deep-links (?mode=voice / ?mode=control),
  teal divider, removed personal labels. Session entry screen for voice device.
- AudiencΩr (`/audience.html`) — Kajabi OAuth2, contacts live, tags, offers, broadcast-tag SSE
- KajabiΩr backend (`src/routes/kajabi.js`) — full OAuth2 client, token cache, all endpoints
- Id8Ωr (`/id8r.html` + `src/routes/id8r.js`) — full ideation engine. 3 modes, conversation,
  sequential web research with 120s phase waits + musings countdown, package cards
  (3 titles / 3 thumbnails / 3 hooks), Vision Brief, pipeline handoff to PipΩr/WritΩr.
  Session persisted in sessionStorage. Start Over button.
- WritΩr beat cards now show emotional_function description
- detectPython() added to davinci.js — tries python3/python/py in order
- create-project.py unicode charmap fix (encoding="utf-8")
- VaultΩr natural language search updated with completed-video vocabulary
- Nav fixed: MailΩr link corrected to /mailor.html, AudiencΩr added at M5
- README.md created — Charlie-ready, 10-minute setup guide
- OPUS_REVIEW.md created — senior architecture review
- CLAUDE.md fully updated — complete current state

### What Was Tested
- Full BRAW → proxy → VaultΩr classify pipeline (end to end)
- Upload on kre8r.app (fixed nginx proxy_request_buffering off)
- MailΩr broadcast A/B generation with voice profiles
- AudiencΩr Kajabi contacts loading live
- TeleprΩmpter 3-device shoot — Rock Rich launch video filmed in 20 minutes
  (vs 2-4 hours previously — 6x productivity improvement)
- Id8Ωr full flow through package cards (rate limiting on mind map resolved partially)
- SelectsΩr v2 with real Rock Rich footage (proxy path linking issue identified)

### Known Issues Identified This Session
- Id8Ωr rate limiting on research phase 2 — YouTube web_search consuming too many tokens
- Id8Ωr mind map — cut in next session, replace with fast concept pass → choose → deep
- SelectsΩr proxy_path must be set before transcription can run
- BRAW proxy naming convention match requires _proxy.mp4 suffix and watcher running
- AudiencΩr tag filter — Kajabi 500s on filtered contact requests
- rock_rich_episode (underscore) vs rockrich inconsistency in pipr.html

### Deployments
- Multiple deploys to kre8r.app throughout session
- All changes live on master branch

### Session Notes
- Teleprompter shoot: 20 minutes for Rock Rich Community Launch video (vs 2-4hrs)
- Opus architecture review conducted — see OPUS_REVIEW.md
- Jason manually edited Rock Rich launch video (deadline driven)
- Charlie meeting Saturday at 11am (after jiu jitsu)
- New monitor purchased 🖥️
