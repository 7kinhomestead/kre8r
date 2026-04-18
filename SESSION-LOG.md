# Session 45 — PostΩr Scheduler + MailΩr Social + CaptionΩr Wiring (2026-04-17)

## Goal
Wire the full distribution layer end-to-end: scheduled posting from PostΩr, Facebook image/text posts and email scheduling from MailΩr, and one-click caption handoff from CaptionΩr to PostΩr.

## What Was Built

### PostΩr Scheduler — ✅ COMPLETE

**Backend (`src/postor/queue-processor.js` — new module):**
- `start()` called once from `server.js` after DB init — `setInterval(run, 60_000)`
- `processItem(item)` loops platforms, calls existing publish functions (meta.publishInstagramReel, meta.publishFacebookVideo, yt.uploadVideo), marks item posted/partial/failed
- `getPendingQueueItems()` — `WHERE status='pending' AND scheduled_at <= datetime('now')`

**DB (`src/db.js`):**
- `postor_queue` table: id, video_path, platforms (JSON), title, description, ig_caption, fb_description, yt_privacy, yt_tags, yt_category_id, yt_scheduled_at, scheduled_at, status, result, error, created_at
- Migration: `image_path` column added (for MailΩr Facebook photo posts)
- Functions: `addToPostorQueue`, `getPostorQueue`, `getPostorQueueItem`, `updatePostorQueueItem`, `cancelPostorQueueItem`, `getPendingQueueItems`

**Routes (`src/routes/postor.js`):**
- `GET /api/postor/queue` — returns queue items for calendar date range
- `POST /api/postor/queue` — adds scheduled post (video_path required only for video platforms)
- `DELETE /api/postor/queue/:id` — cancels pending item

**Frontend (`public/postor.html`):**
- Post Now / 📅 Schedule mode tabs — button label updates contextually
- Schedule date + time picker, +1d/+2d/+3d/+1wk quick buttons
- `doPost()` branches on `postMode` — schedule mode POSTs to `/api/postor/queue`, instant fires to `/api/postor/post`
- Collapsible "View Schedule" calendar panel — week view + day view, nav arrows
- Chips per day: status-coded (pending/posting/posted/failed), click to expand details + cancel option
- Calendar auto-refreshes after queuing a post

### MailΩr — Facebook Social Post + Email Scheduling — ✅ COMPLETE

**`src/postor/video-tunnel.js` refactor:**
- `createVideoTunnel` is now an alias for `createFileTunnel` — detects content type from extension
- Supports images (.jpg/.jpeg/.png/.gif/.webp) as well as video (.mp4/.mov/.avi/.webm)

**`src/postor/meta.js` — `publishFacebookPost` (new function):**
- Text-only: `POST /{page_id}/feed` with `message` — no ngrok needed
- Image + caption: `POST /{page_id}/photos` with ngrok tunnel URL + caption

**`src/postor/queue-processor.js` — `facebook_post` platform:**
- New platform case calls `meta.publishFacebookPost({ caption, imagePath })`

**`src/routes/postor.js` — `POST /api/postor/fb-post`:**
- Immediate Facebook text/image post (no SSE, no video_path required) — called by MailΩr

**`src/routes/mailerlite.js` — scheduled email send:**
- `/send` now accepts optional `sends_at` ISO string — defaults to +10 min, enforces 5-min minimum buffer

**`src/routes/mailor.js` — `gen_fb_post` flag:**
- Accepts `gen_fb_post: true` on `/broadcast` — runs a separate Claude call, returns `fb_post: { caption, suggested_hashtags }`

**`public/mailor.html`:**
- `📘 Facebook Post` checkbox in Generate section
- Facebook Post card appears in results: editable caption textarea (AI pre-filled + hashtags), optional image path, Post Now / Schedule tabs, quick buttons, "Post to Facebook" / "Add to Queue" button
- Email schedule picker in MailerLite send section: "Send in ~10 min" vs "📅 Schedule" tabs, date/time + quick buttons, button label updates contextually

### CaptionΩr → PostΩr One-Click Handoff — ✅ COMPLETE

**`public/m3-caption-generator.html`:**
- Each clip result card gets a teal **"📤 Send to PostΩr"** button
- `sendToPostor(clipIndex)` stores `{ ig_caption, fb_caption, description, clip_label }` in `localStorage` then opens PostΩr in a new tab
- Platform mapping: `ig_caption` ← Instagram caption, `fb_caption` ← Facebook caption, `description` ← TikTok caption (punchy general fallback)

**`public/postor.html`:**
- `checkCaptionrPrefill()` called on load — reads `localStorage.captionr_prefill`, pre-fills `ig-caption`, `fb-description`, `description` fields, **deletes the entry immediately** (one-shot), shows the existing teal prefill notice with "📋 CaptionΩr (clip desc…) → fields auto-filled. Pick your video and post."

## Commits
- Prior: `6516ab1` (Facebook page selector)

## Status
Full distribution layer wired. PostΩr can schedule posts weeks out. MailΩr generates and distributes Facebook posts. CaptionΩr hands captions directly to PostΩr with one click. Zero copy/paste required anywhere in the distribution loop.

---

# Session 44 — Instagram Reels Live (2026-04-18)

## Goal
Get Instagram @7.kin.jason connected and posting Reels from PostΩr.

## What Was Built

### Instagram — ✅ FULLY WORKING (end-to-end live Reel posted)

**Root cause of all previous failures:** Meta's new App Dashboard (2024+) removed Instagram Content Publishing as a selectable use case. None of the 13 available use cases in the new interface expose `instagram_content_publish`. The only working path is creating an app using the legacy "Other (going away soon)" type which preserves the old Products interface.

**App created:** SAR-2 Kre8r-IG (Instagram App ID: 1701682370871590) — "Other" type, Business subtype, Sunburned Ass Ranch portfolio, Instagram product added → `instagram_business_content_publish` permission available.

**Token:** Generated via Instagram API setup page → "Add account" → accepted tester invite on Instagram → one-time token → stored via `manual-instagram-token` endpoint. Instagram user ID: 26555261717467626.

**Video tunnel (new module: `src/postor/video-tunnel.js`):**
- New Instagram API (`graph.instagram.com`) requires a publicly accessible `video_url` — no resumable upload
- Spins up a minimal HTTP server on a random local port (not 3000)
- Only serves one file at one one-time token URL — main Kre8r server never exposed
- Tunnels via ngrok (port 443, firewall-safe) — requires `NGROK_AUTHTOKEN` in `.env`
- Auto-cleanup after Instagram downloads the video

**`publishInstagramReel` rewrite (`src/postor/meta.js`):**
- Switched from `graph.facebook.com` resumable upload to `graph.instagram.com` + `video_url`
- Added `GRAPH_IG = 'https://graph.instagram.com'` constant
- All 4 API calls (init, poll, publish, permalink) now use GRAPH_IG
- Tunnel opens → init container → poll for FINISHED (tunnel stays open during download) → tunnel closes → publish

**`manual-instagram-token` endpoint (`src/routes/postor.js`):**
- Fixed: was calling `graph.facebook.com/v21.0/me?fields=id,username` — deprecated
- Now calls `graph.instagram.com/me?fields=id` (unversioned, no username field)

**Packages installed:** `localtunnel` (abandoned — port 7769 blocked by firewall), `@ngrok/ngrok` (final solution — uses port 443)

## Facebook Page Selector — TODO
`_meta_pages` shows 8 pages including former client "Mastering Modern Selling". Need a page selector dropdown on the Facebook tab in PostΩr so the user explicitly chooses which page to post to and can never accidentally post to the wrong one.

## Scheduler — TODO
Requested. Queue posts for a future time. Design TBD.

## Commits
- Previous: `777e2fd`, `20d6f85`, `764a502`

## Status
Instagram Reels posting confirmed live. First test Reel published to @7.kin.jason. Facebook posting still working. ClipsΩr → PostΩr → Instagram pipeline operational.

---

# Session 43 — PostΩr Meta Integration + Instagram Battle (2026-04-17)

## Goal
Connect Facebook and Instagram to PostΩr for direct video publishing. Add pipeline prefill (auto-populate title/captions from PackageΩr/CaptionΩr when a project video is picked). Add YouTube Studio post-upload checklist.

## What Was Built

### PostΩr Pipeline Prefill
- `GET /api/postor/project/:id/prefill` — when a vault video with a `project_id` is picked in PostΩr, auto-fetches the selected package title, YouTube description, and per-platform captions (instagram, facebook, tiktok, youtube)
- `postor.html` — `onVaultPick()` calls `prefillFromProject()` on videos with a project_id. Teal notice banner shows what was pre-populated, dismissable. `clearPrefill()` resets all fields.

### YouTube Studio Checklist Card
- After successful YouTube upload, a checklist card appears with a direct **"Open in Studio →"** link to `studio.youtube.com/video/{VIDEO_ID}/edit`
- 8 checkboxes: Monetization, End Screens, Cards, Chapters, Thumbnail, Subtitles/CC, Language, Playlist
- "All steps done ✓" message when all checked

### Meta OAuth — Manual Token Flow (bypass broken redirect URI)
- `POST /api/postor/auth/meta/manual-token` — accepts a Graph API Explorer user token, exchanges for long-lived token, discovers pages, stores facebook + instagram connections
- `POST /api/postor/auth/meta/select-page` — stores a specific page from the page list as active Facebook connection
- `POST /api/postor/auth/meta/link-instagram` — uses stored page token to query `instagram_business_account` field
- `POST /api/postor/auth/meta/manual-instagram-token` — accepts Instagram token from Graph API Explorer with Instagram actor selected, calls `/me` to get ig_user_id
- `POST /api/postor/auth/meta/set-instagram-id` — last-resort hardcode: stores ig_user_id directly using existing FB page token
- `GET /api/postor/auth/meta/debug-instagram` — diagnostic endpoint: tries all IG-related fields on stored page token + user token, reports what permissions are actually granted

### Meta OAuth — HTTPS Fix for kre8r.app
- `src/postor/meta.js` `getCallbackUrl()` — now reads `X-Forwarded-Proto` header so OAuth behind nginx correctly constructs `https://` redirect URIs instead of `http://`

### TODO.md — Desktop-Only Gate
- Added full section documenting which features require local Electron context (PostΩr upload, VaultΩr watcher, EditΩr preview, DaVinci, Whisper, Teleprompter QR) with three suggested gating approaches

## Facebook Posting — ✅ WORKING
- Manually connected 7 Kin Homestead page (ID: 349249388773693) via `manual-token` + `select-page`
- Tested end-to-end: video posted successfully to Facebook Page
- Page token stored, `publish_video` scope working

## Instagram Posting — BLOCKED (documented, not abandoned)
Root cause: Kre8r app (ID: 1989481785304507) lives in Jason Rutland's business portfolio. Instagram @7.kin.jason lives in Sunburned Ass Ranch portfolio. `instagram_content_publish` scope requires the app and IG account to be in the same portfolio.

**Progress made this session:**
- SAR system user "Kre8r" created (ID: 61567987943128)
- SAR Kre8r app found (ID: 920653054187075) — has "Manage everything on your Page" use case
- Instagram use case blocked by requiring Instagram browser login to add
- User's Instagram password unavailable on computer; phone login not transferable

**To unblock next session:**
1. Log into Instagram on computer (use Forgot Password → reset via phone SMS)
2. In developers.facebook.com → SAR Kre8r app (920653054187075) → Add use cases → Instagram
3. Assign Kre8r system user (61567987943128) as admin on that app
4. Generate never-expiring system user token → run `POST /api/postor/auth/meta/manual-token` locally
5. `ig_user_id` will populate → test Reel publish

## Commits
- `777e2fd` PostΩr: Facebook connected, pipeline prefill, YouTube Studio checklist
- `20d6f85` PostΩr: fix HTTPS redirect URI for DO, add Instagram debug/manual-link endpoints
- `764a502` PostΩr: temporarily strip instagram_content_publish from OAuth scopes

## Status
All changes committed and pushed. Facebook posting live and tested. Instagram unblocked path clearly documented. DO server running (PM2 id 4, port 3000).

---

# Session 42 — WritΩr Storyboard Brief Pipeline: Root Cause Diagnosis + Fix (2026-04-17)

## Goal
Fix the storyboard builder returning "No brief found" even after running the full Id8Ωr pipeline.

## Root Causes Found (3 separate issues)

### 1. Id8Ωr Sessions Were Not Crash-Safe
- `const sessions = new Map()` — sessions lived only in RAM
- Every server restart (happened repeatedly during session 41 debugging) wiped all sessions
- User completed Id8Ωr pipeline → server restarted → session gone → "Send to PipΩr" found no session → project created with empty `id8r_data`
- **Fix: `src/routes/id8r.js`** — `persistSession(sessionId)` saves full session to `session_checkpoints` table after every key step (start, fast-concepts, choose, research, package, brief). `getOrRestoreSession(sessionId)` replaces all `sessions.get()` calls — tries memory first, falls back to DB checkpoint on miss. Session now survives server restart.

### 2. send-pipeline Now Supports Existing Projects
- `/api/id8r/send-pipeline` always created a new project — no way to attach a brief to an existing project
- Added optional `project_id` body param: if provided, updates that project instead of creating a new one
- Allows retroactively linking an Id8Ωr session to a PipΩr project

### 3. WritΩr Storyboard Wasn't Reading from project-config.json
- `buildWritrPromptContext()` reads from `vault/project-context.json` — returns `''` if no `concept` field
- Fallback checked `project.id8r_data` DB column — also empty for session-lost projects
- **But `project-config.json` had the full brief the whole time** — high_concept, script, talking points, hooks, audience insight, all of it — written by PipΩr when the creator pastes the brief
- That file was never part of the fallback chain
- **Fix: `src/routes/writr.js`** — both storyboard and beat/write endpoints now check `config.script` / `config.what_happened` / `config.high_concept` from the already-loaded `readConfig()` result as a third fallback

## Final Fallback Priority (storyboard + beat writer)
1. `vault/project-context.json` — written by Id8Ωr send-pipeline (ideal)
2. `projects.id8r_data` DB column — same Id8Ωr data, second copy
3. **`project-config.json` script/what_happened/high_concept** ← NEW — full brief from PipΩr paste field
4. Project title + high_concept from DB record (last resort, stays on topic but no talking points)

## Id8Ωr Package Error Fix (from session 41, continued)
- Token limit raised 1024 → 2048 for package endpoint
- Angle field constrained to 1 sentence max to prevent token overflow
- Retry button added to package error screen in `public/id8r.html`

## Commits This Session
- `6aa849e` fix(id8r): raise package endpoint token limit 1024 → 2048
- `dc2e401` fix(id8r): add retry button on package error screen
- `2bde2e9` fix(writr): inject full project brief into beat writer context
- `af8bbd4` fix(writr): fallback to id8r_data when project-context.json missing
- `188a921` fix(writr): add id8r_data fallback to storyboard builder
- `914ef0d` fix(writr): remove hard-fail when no Id8r brief — build from project record
- `53609bf` fix(id8r): persist sessions to SQLite checkpoints — survives server restart
- `f9aa46c` fix(writr): read brief from project-config.json when vault context missing

## Status
All changes committed. Running in `npm run electron:dev`. Project 667 "Why I Chose the Harder Life" now has the full brief available via project-config.json fallback. New Id8Ωr sessions are checkpoint-persisted — server restart no longer loses creative work.

## Pending / Next Session
- Verify storyboard pipeline end-to-end on project 667 with real brief content
- Push commits to GitHub + deploy to DigitalOcean
- DaVinci Mac/Linux path fix (Python scripts — `sys.platform` detection)

---

# Session 41 — Beta Hardening + SeedΩr Fixes + WritΩr Storyboard Pipeline (2026-04-16)

## Goal
Remove API key from beta onboarding, add per-tenant token tracking, fix SeedΩr constellation bugs, build multi-step storyboard pipeline for WritΩr.

## What Was Built / Fixed

### Beta Onboarding — API Key Removed
- `public/onboarding.html` — Removed Anthropic API key field from Step 6 (Jason pays centrally during beta). Added "AI is included" note. Fixed verify endpoint check `data.valid` → `data.ok`.
- `src/routes/onboarding.js` — Removed `anthropic_api_key` from destructuring and profile save.

### Token Tracking — Per-Tenant Cost Visibility
- `src/db.js` — Migration adds `tenant_slug TEXT` column + index to `token_usage` table. `logTokenUsage()` writes directly to singleton db (bypasses tenant routing), auto-captures current tenant slug. `getTokenStats()` returns `by_tenant` breakdown.
- `src/utils/claude.js` — Both `callClaude` and `callClaudeMessages` now log every API call with input/output tokens and cost estimate (`$3/M input, $15/M output`).
- `public/admin.html` — "By Creator" table in token stats renders `by_tenant` field.

### KRE8R-MARKETING.md — Long-Form Narrative Doc
- Created `KRE8R-MARKETING.md` — ~4,800 word narrative marketing document covering all 15 tools, 10 objections handled, Engine vs Soul architecture, hero story (first Kre8r video = #1/10, 2x Dave Ramsey velocity at 36 hours). Fed into NotebookLM for podcast generation.

### SeedΩr — Constellation Fixes
- Canvas drag broken by stacked event listeners — fixed with `canvas.cloneNode(false)` to wipe all listeners on reinit.
- Ideas doubling after integrate — `result.newNodes` filtered to only `newIdeaIds` set after Claude responds.
- Token overflow with 40 ideas (8192 limit hit) — raised to 16000, then addressed at root by capping all calls at 20 ideas.
- Status staleness — fresh status merged from `allIdeas` on every `initConstellation`.
- Promote → PipΩr handoff — `updateProjectMeta()` was silently ignoring `id8r_data`. Fixed to call `updateProjectId8r()`.

### SeedΩr — State Machine Redesign (20-idea rate limiting by design)
- Bulk import capped at 20 ideas with toast warning if more arrive.
- Seed selector modal for initial generation when vault has >20 ideas.
- `generateConstellation(ideaIds)` sends optional `ideaIds` in JSON body.
- Server `/constellation` endpoint accepts optional `ideaIds` filter array.
- `updateConstellationButtons()` controls visibility of Reset/Add/Generate based on constellation state.
- "Regenerate" locked when constellation exists; only "Add 20 More" and "Reset Map" available.

### WritΩr — Multi-Step Storyboard Pipeline
- `src/routes/writr.js` — 5 new endpoints:
  - `POST /:id/storyboard` (SSE) — maps Id8Ωr research/brief onto each PipΩr beat. Returns `story_moment`, `source_material`, `jason_direction`, `transition_note` per beat. Saves to project config.
  - `GET /:id/storyboard` — loads saved storyboard + beat_scripts from config.
  - `PATCH /:id/storyboard` — saves creator edits to beat assignments.
  - `POST /:id/beat/write` (SSE) — writes one beat with voice profile, adjacent beat context, word target, and previous beat tail for continuity.
  - `POST /:id/assemble` (SSE) — assembles all beat scripts, seam-smooth pass, saves as WritrScript record.
- `public/writr.html` — Full storyboard pipeline UI:
  - 3-step bar (Storyboard → Write Beats → Assemble) in Panel 1.
  - Storyboard beat cards in Panel 2: editable story moment, source material, direction, per-beat Write button, written preview.
  - Write All Beats → sequential per-beat generation with real-time card updates.
  - Assemble → seam pass → saves to DB → existing approve/revise/iterate flow takes over.
  - The Room gains 📋 Source Material panel showing storyboard beat assignments.
  - Quick Script (old one-shot path) fully preserved below "— or —" divider.

## Pending / Next Session
- DaVinci Mac/Linux path fix (Python scripts — `sys.platform` detection for default paths)
- Push commits to GitHub + deploy to DigitalOcean
- WritΩr storyboard UX polish after first real use (tune word targets, voice prompt, seam pass quality)

---

# Session 40 — Cleanup Bugs + Beta Architecture Planning (2026-04-15)

## Goal
Close known cleanup bugs, reduce app size, plan multi-tenant beta architecture.

## What Was Built / Fixed

### VaultΩr — Voice Analyze Button
- `public/vault.html` — Added `event.stopPropagation()` to voice button onclick — click was bubbling to card and opening tile instead of running analysis
- `public/vault.html` — Fixed response check: `data.ok` → `data.job_id` (route returns `{job_id}`, not `{ok:true}`) — success toast never fired before this fix

### NorthΩr / Dashboard — Attention Required Zone
- `public/index.html` — Added early-return in `renderAttentionZone()` for projects with `status === 'published'` or `current_stage === 'COMPLETE'` — completed projects were generating spurious attention cards (PipΩr setup needed, etc.) after being marked done

### TeleprΩmpter — Two Bugs Fixed
- `public/teleprompter.html` — Hide Cloud Launch button when Solo tab is active. Solo is a one-device mode (no control phone needed). Clicking Cloud Launch from Solo was triggering a cloud WebSocket connection that crashed the app in Electron and required a full restart.
- `public/teleprompter.html` — Exit button (✕) made significantly more visible: opacity raised from 45% → 85%, border from 12% → 28%, size from 36px → 42px. Button existed but was effectively invisible.

### Playwright → devDependencies
- `package.json` — Moved `playwright: ^1.59.1` from `dependencies` to `devDependencies`
- `src/routes/playwright.js` — Added try/catch around `require('playwright')` in /connect route — returns clean 503 if not installed instead of crashing
- Playwright was the main contributor to 238MB app size. Packaged Electron builds no longer include it. DO production server also stops installing it on `npm install --production`.

### TODO.md
- Marked Idea Vault / SeedΩr as ✅ DONE (built Session 33 — was never updated in TODO)

## Architecture Planning — Beta Multi-Tenancy
- Audited all Kajabi API dependencies — only meaningful ones are morning bulk sync + webhook receiver
- Audited Mac/Linux cross-platform compatibility:
  - Core app (all AI tools) = cross-platform today
  - DaVinci Python scripts = Windows default paths only, but env var overrides already exist — 1-2 hour fix to add `sys.platform` detection for Mac/Linux default paths
  - Camera SSD `H:\` assumptions = minor messaging fix
  - Mac .dmg build = needs Mac machine or CI (config already in package.json)
- Decision: Option B (one DO server, per-tenant subdomain + isolated DB/profile per creator) for beta
- Mac creators use browser (kre8r.app subdomain), Windows creators use Electron app
- Token costs: ~$30-80 for 30-day beta with 3-5 creators, Jason pays centrally

## Key Decisions Made
- DaVinci Resolve runs on Mac and Linux — not Windows-only. Fix is platform path detection in Python scripts, not a rewrite.
- Playwright not needed in packaged app or on DO server — browser automation is a local dev tool
- Voice library: 3-video analysis cap per tenant for beta
- Beta data collection: feature usage events + in-app feedback widget + admin panel (all 3 methods)
- YouTube API compliance: record screencast of PostΩr uploading a video — that's all they need

## Deployed
All changes pushed to GitHub (`master`) and deployed to DigitalOcean.

---

# Session 39 — MailΩr Premiere Email end-to-end (2026-04-15)

## Goal
Get video premiere email Send Now working end-to-end in MailΩr: dropdown, generate, send via MailerLite.

## What Was Built / Fixed

### MailΩr Premiere Email — full send pipeline
- `src/routes/postor.js` — `GET /premiere-videos` rewritten: returns all active kre8r/youtube_import projects (not just those with youtube_video_id). Fixed `no such column: p.angle` — `angle`/`hook` don't exist on projects table, use `high_concept` as fallback.
- `public/mailor.html` — Premiere tab: YouTube URL input added (user pastes link); project_id as select value; `pmGenerate()` shows "✦ Writing…" on button; inline error div for persistent feedback; `pmSend()` fetches `/api/mailerlite/sender` first.
- `src/routes/mailerlite.js` — Multiple fixes in `POST /api/mailerlite/send`:
  - `from_email` → `from` in emails array (ML v2 field name)
  - Removed invalid top-level `subject` from campaign body
  - `'all'` audience now sends to all subscribers (no groups filter) instead of passing stale tier group IDs
  - Env vars (`MAILERLITE_FROM_EMAIL`, `MAILERLITE_FROM_NAME`) checked first — immune to profile overwrites
  - Send endpoint: `/campaigns/{id}/actions/send` → `/campaigns/{id}/schedule` with `{delivery:'instant'}` (ML v2 has no `/actions/send`)
  - Step-specific error messages: "Campaign create failed" vs "Campaign send failed (id=...)"
- `src/routes/mailerlite.js` — `GET /api/mailerlite/sender` endpoint added (resolves from env → profile)
- `{$name}` personalization token fixed across all 6 generation prompts (broadcast, sequence, premiere, welcome emails)
- Morning bulk sync scheduled in `server.js` at 8 AM local time via setInterval tick

## Key API Discovery
MailerLite v2 (`connect.mailerlite.com`):
- Campaign emails array: `from` (not `from_email`), `content` (HTML, not `html`)
- No top-level `subject` on campaign body — only inside `emails[]`
- Send immediately: `POST /campaigns/{id}/schedule` with `{"delivery":"instant"}` — `/actions/send` does not exist

---

# Session 38 — PostΩr + YouTube Analytics Sync (2026-04-14)

## Goal
Build PostΩr multi-platform video posting module, wire YouTube Analytics API into MirrΩr and NorthΩr, fix Electron login/tour persistence.

## What Was Built

### PostΩr — Multi-Platform Video Publishing
- `src/postor/youtube.js` — Google OAuth2 + YouTube Data API v3 resumable upload
- `src/postor/meta.js` — Meta OAuth2 (Instagram Reels + Facebook video, single auth flow)
- `src/postor/tiktok.js` — Stub (coming soon, TikTok API not ready)
- `src/routes/postor.js` — All OAuth endpoints, single post, bulk queue, analytics sync, history
- `public/postor.html` — Full UI: platform connection cards, single/bulk mode, analytics panel, post history
- `public/youtube-api-design-doc.html` — YouTube API Services compliance document
- Nav entry added (Dist section)

### YouTube Analytics Sync (313 videos, 2504 metrics)
- `src/postor/youtube-analytics.js` — Full channel sync via YouTube Analytics API v2
- Auto-seeds all channel videos into DB as import projects (createImportProject + createImportPost)
- Two-pass approach for >200 videos: top 200 by views, then remaining via filters=video==id1,id2,...
- **Critical API discovery:** `sort` + `maxResults` are REQUIRED for `dimensions=video` (not documented in general params — only in Available Reports section). Without them API returns misleading "query not supported."
- Uses explicit channel ID (`channel==UCFiYtvJimJzFZLH6rzNkc5Q`) — brand accounts fail with `channel==MINE`
- Metrics synced: views, watch_time, avg_watch_time, completion_rate, followers_gained, likes, comment_count, shares
- MirrΩr DNA cache busted after each sync so coaching rebuilds with fresh data
- **Revenue blocked:** `estimatedRevenue` is explicitly non-functional for channel reports (documented Google restriction). Requires Content Owner / CMS tier (MCN-level access). Standard YPP channels cannot access via API regardless of scope.

### Electron Login + Tour Persistence Fixes
- `src/routes/auth.js` — Detects Electron User-Agent, forces 30-day persistent cookie on login (previously session-only cookie died on every app quit)
- `src/routes/auth.js` — Added `GET/POST /auth/kv/:key` per-user KV endpoints (namespaced by userId)
- `public/js/tour.js` — Tour completion now saved server-side via KV store (survives Electron restarts)

### DB Additions
- `monthly_revenue` table — month, platform, revenue_usd
- `platform_connections` table — OAuth tokens per platform
- `postor_posts` table — PostΩr job tracking
- `db.getAllYouTubePosts()`, `db.upsertMonthlyRevenue()`, `db.getMonthlyRevenue()` etc.

## Key Technical Findings
- YouTube Analytics API `dimensions=video` = "Top Videos" report type. `sort` and `maxResults` (≤200) are mandatory. Omitting either returns "The query is not supported" with no indication of what's missing.
- `estimatedRevenue` with `dimensions=month` rejects all dates for channel-type principals — this is a documented Google restriction, not a scope/date issue.
- YouTube Data API v3 must be separately enabled in Google Cloud Console (distinct from Analytics API).
- PostΩr handles both shorts and long-form — YouTube auto-classifies by duration/aspect ratio.

## Result
MirrΩr now has real retention, watch time, completion rate, and engagement data across 313 videos. Channel DNA analysis significantly more accurate. NorthΩr pipeline health, stalled project alerts, and consistency tracking all working with live data.

---

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

