# Kre8Ωr — Dev Notes & Decision Log

Running record of hard-won decisions, dead ends, and architecture reasoning.
When a problem takes more than one session to solve, write it here.
Future Claude reads this before touching anything related.

---

## kre8r-land deploy + sitemap — hard-won facts (Session 95, 2026-06-19)

Building the `.land` `/about` page surfaced two things worth never re-learning:

1. **The `.land` sitemap is GENERATED, not hand-edited.** `public/sitemap-hubs.xml` (and `sitemap.xml`,
   `sitemap-listings-*.xml`) are written by `src/utils/sitemap.js` → `generateSitemaps()`, run from the
   pipeline cron. They're **gitignored**, so editing the XML by hand does nothing — the cron overwrites it.
   To add a static page to the sitemap, add its path to the `STATIC_PAGES` array in `src/utils/sitemap.js`.
   It appears on the next pipeline regen (not instantly on deploy).
2. **The land droplet rejects my SSH key for root — I cannot deploy it.** Of the DO boxes in
   `~/.ssh/known_hosts`, my key only opens `143.244.179.113` (hostname `kinOS`, which does NOT host
   kre8r-land). The land box (one of `64.23.152.96` / `64.23.158.236`) returns `Permission denied
   (publickey)` for root. So **kre8r-land deploys must be handed to Jason** to run — give him the
   canonical `sudo -iu landapp …` one-liner (memory `project_land_deploy.md`); don't try to SSH-deploy it.
   `7kinhomestead.land` is behind Cloudflare now, so the hostname no longer resolves to the droplet.

For new `.land` pages: deploy first, confirm the URL returns 200 live, **then** Search Console → URL
Inspection → Request Indexing. Requesting before it's live makes Google cache a 404. The sitemap is
passive/slow discovery; Request Indexing is the fast lane.

---

## Kajabi course beacon + theme — hard-won fixes (Session 94, 2026-06-18)

**Context:** The Rock Rich free course + completion beacon live on Kajabi (theme = the rebuilt
`D:\Downloads\7kin-course-template.zip`). Full narrative in memory `project_kajabi_game.md`.

1. **Beacon TIMING bug (the big one).** The completion beacon (in the theme's `templates/post.liquid`)
   was firing **before** `window.RR_COURSE` existed. `RR_COURSE` is injected near the page bottom
   (`layouts/theme.liquid` footer) but the beacon renders in the lesson content, which the browser
   parses earlier → at beacon-init `RR_COURSE` was `undefined` → it fell through to the hardcoded
   `'https://kre8r.app/api/kajabi-track'` default → 401, nothing recorded. The tell: console showed
   `window.RR_COURSE.trackEndpoint` = the right (ngrok) URL when typed manually post-load, yet the
   POST fired to kre8r.app **before** `scripts.js` logged. **FIX: wrap the beacon body in
   `initBeacon()` gated on `DOMContentLoaded`** so it reads `RR_COURSE` after the footer defines it.
   Lesson for any theme-injected script that depends on `RR_COURSE`: defer it, or inject `RR_COURSE`
   into `<head>`.

2. **Kajabi themes: every zip upload is a NEW immutable VERSION; the LATEST is always active.**
   (Confirmed by Jason, Jun 18.) These are custom-uploaded themes (not marketplace), so there is NO
   "update" and NO delete — uploading a zip creates a new theme id, old versions pile up forever, and the
   newest upload is the one that's live. **Operating rule: ALWAYS edit the LATEST version.** Two edit paths:
     - Theme SETTINGS (player_type, track_endpoint, colors, section copy) → edit the latest version IN
       PLACE via Customize or MCP `update_theme_content`. No upload needed, no new version.
     - Theme FILES (*.liquid, scripts.js) → can ONLY change by uploading a new zip = new latest version,
       and that RESETS all settings to the zip's `settings_data.json` defaults.
   So get the live id from a fresh `get_course` `active_theme_id` every time before editing — do NOT trust a
   cached id (we watched it churn 2166563771 → 2166563978 → 2166564468 across uploads). Because a
   file-change upload wipes settings back to zip defaults, the canonical `D:\Downloads\7kin-course-template.zip`
   bakes the correct defaults (ngrok track_endpoint + player_type:inline) so a fresh upload comes up working
   with zero reconfiguration.

3. **ngrok free "dev domain" is permanent, not random.** Every ngrok account gets one free static
   *dev domain* (`<words>.ngrok-free.dev`) that is reused every restart — it is NOT a throwaway URL.
   Pinned it via `NGROK_DOMAIN` in `.env`; `scripts/beacon-tunnel.js` now passes `domain` and prints
   the exact `/api/kajabi-track` endpoint. Paste-into-Kajabi-once. (Tunnel + local server must be UP for
   completions to record — MissionΩr reads the LOCAL Electron DB, not the droplet.)

4. **Theme zip must be built from the original Kajabi export.** A from-scratch .NET zip got rejected
   ("you can only upload .zip"); PowerShell `Compress-Archive` writes backslash entry paths Kajabi
   (Linux) won't import. Working method: COPY the original `7kin-solar-v1-3-*.zip` and swap only the
   edited files via `System.IO.Compression` Update mode (forward-slash entry names preserved).

5. **Can't inline-embed a 7kinhomestead.land tool in Kajabi** — kre8r-land `helmet` sends
   `X-Frame-Options: SAMEORIGIN` (CSP is off but frameguard isn't). So the Freedom Calculator module
   uses a launch-in-new-tab button + bookmark coaching, not an iframe. To embed later, set
   `frameguard:false` on the kre8r-land server.

6. **`node --check` every inline-JS paste before shipping** (already a guardrail) — and remember a
   *successful* `sendBeacon`/no-cors POST is SILENT in the console; only failures log. "Nothing thrown"
   after a beacon = success, not nothing happening. Verify by reading the DB, not the console.

---

## Grand Synthesis — Senior Engineering Assessment (Session 91)

**READ THIS FIRST before any architectural work.**
`C:\Users\18054\kre8r\docs\tool-reviews\grand-synthesis.md`

The most complete picture of Kre8r ever produced. Covers all 5 Tier-1 tools (SeedΩr,
Id8Ωr, WritΩr, VaultΩr, AssemblΩr) with 4 Opus agents per tool + cross-tool synthesis.

**The 7 systemic findings (apply across the whole codebase):**
1. False Success — operations report completion they didn't achieve. Fix: read-back before success.
2. Silent Column Drop — writes vanish through whitelists/unguarded parses. Fix: log unknown keys.
3. Dual Schema Paths — columns in one migration but not both. Fix: always bootstrapTenant + runMigrations.
4. Two Co-Equal Machines — two paths per tool, intelligence injected into only one.
5. Lossy One-Directional Handoffs — seams drop structured data; no backward feedback loops.
6. visual_description Under-Distribution — paid on 4000 clips, reaches 2/12 tools.
7. Inconsistent Object Shapes — selected_takes, beat_map_json, id8r_data all have multiple shapes.

**Critical path (priority order):**
1. Instrument silent-drop layer (log allow-list misses, read-back before success)
2. VaultΩr dedicated session (server-side filters, indexes, layout inversion)
3. Publish fan-out event ✅ DONE — idea.status='produced', Post-Mortem seeded on ship
4. AssemblΩr MVP rewrite (direct subclips, DaVinci read-back, one button)
5. One shared context builder per tool (WritΩr storyboard gets all intelligence)
6. Distribute visual_description ✅ DONE — WritΩr shoot_first + PostΩr captions
7. Pre-multi-tenancy gates (SESSION_SECRET, queue overlap, OAuth encryption)

**Verdict (Opus):** "The soul is sound, the engine is real, the gauges lie — and fixing the
gauges is now the highest-leverage work left. A quarter of focused work, not a rebuild."

**Individual tool reviews:** `docs/tool-reviews/` — seedr, id8r, writr, vaultr, assemblr
**Fixes applied Session 91:** `docs/tool-reviews/fixes-implemented.md`

---

## Mission Control Remote Proxy — Hard-Won Patterns (Session 84)

### The snapshot had the wrong endpoints (and nobody noticed)
The `/api/mission/snapshot` endpoint was calling `${ORG_URL}/api/treasor/summary`
(doesn't exist) and `${KINOS_URL}/api/today` (doesn't exist), with `x-internal-key`
(wrong header). The dedicated `/api/mission/org` and `/api/mission/kinos` routes
had been fixed correctly but the snapshot never called them — it had its own inline
fetches that were still wrong.
LESSON: When fixing proxy endpoints, grep for ALL places the old URL appears, not just
the named proxy route.

### OrgΩr + KinOS auth: x-internal-token NOT x-internal-key
Both sibling apps use `x-internal-token` header with `ORGR_INTERNAL_TOKEN` /
`KINOS_INTERNAL_TOKEN` env vars. kre8r uses `x-internal-key` with `INTERNAL_API_KEY`.
These are DIFFERENT. Never mix them up.
Token: 91117b0fcda79005f8cabac4b3eed09b95875bcfbf6d9343 (set in all three apps)

### Remote HTTPS calls need longer timeouts
fetchWithTimeout defaults to 2000ms. HTTPS calls to kinos.life droplet take 2-5s.
Always pass 8000 (8s) for any fetchWithTimeout call to ORG_URL or KINOS_URL.
Local calls (localhost:3000) can stay at default 2000ms.

### OrgΩr dashboard response shape
GET /api/treasor/dashboard/:orgId returns:
{ balances: { reserves: {id, available, allocated, spent}, wages: {...}, ... } }
NOT: { gross_income, reserves, tax_setaside } — those field names don't exist.
Map from balances.reserves.available etc.

### KinOS real endpoints (on kinos.life)
- Events: GET /api/schedule/upcoming?days=1 → array of event objects
- Tasks: GET /api/tasks → array (filter overdue client-side)
- Inventory low: GET /api/inventory/low → array
- Morning brief: POST /api/ai/morning-briefing (X-Member-Id: 1 for Jason)
All protected by x-internal-token header.

### AppData .env is what Electron reads
kre8r's Electron app reads env from `AppData\Roaming\kre8r\.env`, NOT the project
`.env`. Any env changes MUST go in both places, or only AppData if Electron-only.
Path: C:\Users\18054\AppData\Roaming\kre8r\.env

### msedge-tts API: toStream returns object not readable
msedge-tts `tts.toStream(text)` returns `{ audioStream, metadataStream, requestId }`.
The audio IS NOT the return value itself — use `const { audioStream } = tts.toStream(text)`.
Using `tts.toStream(text).on(...)` fails silently (no error, just nothing plays).

### Number One SSE: backend sends {type:'token', text:'...'} not {token:'...'}
Frontend was checking `parsed.token` but backend sends `parsed.text`.
Always check: `var token = parsed.text || parsed.token || null`.

---

## Kajabi MCP — Hard-Won Patterns (Sessions 80-82)

### Toolset eviction — must re-enable constantly
The Kajabi MCP evicts inactive toolsets after ~2-3 uses. Max 3 active at once.
Pattern for bulk member pulls: enable_toolset → list_members (saves to file) →
bash (process file, extract cursor) → list_members → repeat.
The enable_toolset call itself takes one of the 3 slots — if you have analytics +
contacts + communities active, adding a 4th evicts the LRU. Always call
enable_toolset at the start of each message turn before any community tool use.

### list_members pagination — all results save to tool-result files
When list_members result > 200k chars, it saves to:
C:/Users/18054/.claude/projects/C--Users-18054-kre8r/{session-id}/tool-results/
Use `fs.readdirSync(BASE).filter(f=>f.includes('list_members')).sort()` to get
the latest file. Parse with JSON.parse(fs.readFileSync(latest)).
Slim the data immediately (only keep needed fields) to avoid context bloat.
Accumulate pages to: C:/Users/18054/kre8r/scripts/sync-members.json

### Full 1,366-member sync pattern (14 pages)
1. enable_toolset communities
2. list_members per=100, sort_by=joined_at_asc (no cursor = page 1)
3. bash: extract cursor + slim + append to sync-members.json
4. Repeat steps 1-3 with cursor from previous page
5. Final page: has_more=false, no cursor
6. Process sync-members.json and POST to /api/community/sync

Toolset is evicted between turns (messages). Re-enable at start of each turn.
Each turn can handle 2-3 list_members calls before eviction.
Total time for 14 pages: ~10 minutes.

### search_contacts filters are BROKEN (MCP beta)
All filter parameters (has_tag_id, net_revenue_greater_than, has_offer_id, etc.)
are silently ignored. Response always shows `filters_applied: null` and
returns all 5,564 contacts sorted newest-first.
DO NOT try to filter contacts via search_contacts until Kajabi fixes this.

### Tier detection — use contact tags, NOT access_group_ids
Kajabi stores tier as CRM tags on contacts:
- "Greenhouse - Member" → tag ID 2150101628 (1,357 contacts)
- "Garden - Member"     → tag ID 2150101641 (36 contacts)
- "Founding 50 - Member" → tag ID 2150101640 (33 contacts)

Founding 50 members also have Garden + Greenhouse tags (cumulative access).
Net unique paying members: ~36 (Garden 36 - overlap with F50 ≈ 35-37 total).

list_members has NO access_group_ids filter — the CLAUDE.md note saying
"list_members filtered by access_group_ids" was wrong. Correct approach:
page through contacts, filter client-side by tag name, match to community_members
by email, UPDATE tier. ~223 pages of contacts at 25/page to scan.
Better approach: use a custom /api/community/update-tiers endpoint that accepts
{ founding50_emails, garden_emails } arrays after client-side filtering.

### create_announcement and create_post — silent success bug (CRITICAL)
Both return "Unexpected response shape from communities service" even when
they SUCCEED. Post IS created, notifications sent. NEVER retry.
Always check Kajabi admin or list_posts/list_announcements to verify before retry.
Retrying creates duplicates blasted to all 1,366 members.

### Community sync route whitelist (server.js)
/api/community/sync is whitelisted from session auth:
`if (req.path.startsWith('/api/community/sync')) return next();`
GET routes (/api/community/health, /warm-leads, /events, /movers) require
normal session auth — they're only accessed from the logged-in AudiencΩr UI.

### Warm lead detection — greenhouse only
warm_leads table only gets populated with `tier = 'greenhouse'` members.
Garden and Founding 50 members never appear in warm_leads regardless of score.
This prevents DM pitches to people who are already paying.

---

## Frame Analysis Queue — Architecture Decisions (Session 79)

### activeCount pattern replaces processing boolean
Original queue used `let processing = false` — works for 1 concurrent job but can't be
extended to N concurrent without a rewrite. Replaced with:
```js
let activeCount = 0;
function maxConcurrent() {
  const hasLive = Array.from(jobs.values()).some(j => j.status === 'processing' && !j.batch);
  return hasLive ? 1 : MAX_BATCH_CONCURRENT;
}
```
Live (watcher-triggered) jobs always run solo. Once only batch jobs are active, up to
`MAX_BATCH_CONCURRENT` (default 3, env: `FRAME_BATCH_CONCURRENCY`) run in parallel.
The `batch: true` flag is set at enqueue time. Never mix patterns — always use `activeCount`
for any new queue that might need concurrency later.

### Per-job model override for batch backfill
Live jobs use `FRAME_ANALYSIS_MODEL` (Opus — best editorial judgment).
Batch backfill uses `BATCH_ANALYSIS_MODEL` (Haiku — ~$0.004/clip vs ~$0.23 Opus).
Model stored on the job object at enqueue time, not at processing time. This means
a job queued as batch stays batch even if concurrency mode changes before it runs.
Default BATCH_ANALYSIS_MODEL: `claude-haiku-4-5`.

### visual_analyzed_at IS NULL as idempotency cursor
No separate job/cursor table needed for batch backfill.
`getUnanalyzedFootage({ shot_types, project_id, limit })` uses `visual_analyzed_at IS NULL`
as the natural cursor. Call the batch endpoint again after a restart and it automatically
resumes from where the DB left off — already-done clips are skipped, nothing to track.

### Circular dependency: intake.js → frame-analysis-queue.js
`watcher.js` requires `intake.js`. `intake.js` would require `frame-analysis-queue.js`.
`frame-analysis-queue.js` requires `db.js`. No circular deps there. But if `watcher.js`
ever required `frame-analysis-queue.js` AND `intake.js` required it too, there could be
issues depending on module load order. Safe solution: in `intake.js:processProxyUpdate()`,
use a lazy require inside the function:
```js
const fxQueue = require('./frame-analysis-queue');
```
This avoids any top-level circular at module load time.

---

## SaaS Hardening — Critical Findings from Opus Review V3 (Session 79)

These items need fixing before kre8r goes multi-tenant. See OPUS_REVIEW_V3.md for full context.

### 1. SESSION_SECRET hardcoded fallback (server.js:244)
```js
// CURRENT (dangerous):
secret: process.env.SESSION_SECRET || 'kre8r-session-secret-change-in-production'
// FIX:
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET env var is required');
```
Any deploy that forgets the env var runs on a known-public string, making all sessions forgeable.
Fix before any beta opens.

### 2. PostΩr double-fire race (src/postor/queue-processor.js:158)
`setInterval(run, 60_000)` + `await processItem` inside `run`. If an Instagram upload
takes > 60s (common), the next tick starts a parallel `run()` and the same post fires twice.
Fix: `let running = false` guard at top of `run()`, set `true` on entry, `false` in `finally`.
Also: update status to `'posting'` in DB BEFORE the await — so a crash-restart can't re-fire.

### 3. OAuth tokens plaintext in platform_connections
Fine for single-creator desktop (same OS trust boundary). Not acceptable for multi-tenant SaaS.
Encrypt with `aes-256-gcm`. Key: `crypto.scryptSync(SESSION_SECRET, tenant_slug, 32)`.
~50 lines in `src/utils/token-crypto.js`. Include a one-time migration on startup.
See TODO.md Task 2 for full spec.

### 4. trust proxy not set (server.js)
`app.set('trust proxy', 1)` is missing. Behind nginx, `req.protocol`, `req.ip`, and any
rate-limit middleware all read wrong values. The Meta OAuth callback works around this
manually (`x-forwarded-proto` direct read) — that's the symptom. Add the one-liner.

### 5. searchFootageByWhere SQL injection surface (src/db.js:2688)
Claude-generated WHERE clause interpolated into SQL with a regex blocklist sanitizer.
Blocklist is bypassable (e.g. `REPLACE INTO`, nested CTEs, `PRAGMA writable_schema=1`).
Fix: have Claude return `{filters: [{col, op, val}]}` JSON → server builds safe parameterized SQL.
Don't touch until you're ready to rewrite the VaultΩr search prompt too.

### 6. Background workers are tenant-blind
The biggest multi-tenancy gap. VaultΩr watcher, transcribe-queue, frame-analysis-queue,
postor queue-processor, scheduleMorningSync, scheduleVectrAutoRun all fire outside any
`tenantContext.run()`. They silently operate on Jason's singleton DB even on multi-tenant hosts.
Fix pattern: each periodic job must iterate `db.getAllTenants()` and wrap per-tenant work in
`tenantContext.run({ db: tenantDb, profile, slug }, async () => { ... })`.
See TODO.md Task 5 for full spec. This is ~2 sessions of work.

### 7. SSE sseClients Sets are global across tenants
Both `transcribe-queue.js` and `frame-analysis-queue.js` use a module-level `Set` for
SSE clients. In multi-tenant mode, tenant B's vault page receives tenant A's ingest events.
Fix: key the Sets by tenant slug. `Map<slug, Set<res>>`.

---

## Post-Mortem Feature — Architecture Decisions + Bugs (Session 77)

### getGlobalChannelHealth() return shape
`getGlobalChannelHealth()` returns `avg_views` at the TOP LEVEL (legacy YouTube field),
NOT nested under `health.youtube`. The per-platform breakdown is under `health.by_platform`.
Correct access: `health.avg_views` — NOT `health.youtube.avg_views` (always undefined/0).

### Transcript fetch: youtube_url vs youtube_video_id
MirrΩr-synced projects have `youtube_video_id` set but `youtube_url` is often null.
Always fall back: `project.youtube_url || \`https://www.youtube.com/watch?v=${project.youtube_video_id}\``
yt-dlp VTT caption fetch requires a valid URL — without this fallback transcripts silently
fail for the majority of the video library.

### Brief generation: slice from END not START
When locking a Post-Mortem brief, slicing `convText.slice(0, N)` is WRONG. Post-mortems
naturally start with a first impression that gets revised through dialogue. The real diagnosis
lives at the END of the conversation, not the start.
Fix: keep first 1500 chars (context hook) + last 8500 chars (conclusion), with
`[...conversation continues...]` separator. Also add explicit prompt instruction:
"base the brief on the FINAL diagnosis reached at the END, not the first impression."
First live test confirmed this was the bug — brief locked the wrong initial diagnosis.

### Brief clear endpoint (admin escape hatch)
`DELETE /api/postmortem/brief/active` archives the active brief (status='cleared').
The `✕ Clear Brief` amber button in the panel shows on open if an active brief exists
(fetched in parallel with videos load). Also shows immediately after a new lock.
This exists because Opus can lock the wrong thing — always have a clear path to undo.

---

## VisualΩr — Stream + Token Fixes (Session 77)

### yt-dlp approach: stay with --get-url
Two approaches were tried for fetching video frames:
1. `--get-url`: resolves YouTube URL to direct stream URL. Node streams frames directly
   from the CDN stream. Works reliably. **This is the correct approach.**
2. Download-first: download full video to disk, then extract frames with ffmpeg.
   Introduced complexity and errors. Reverted.
Never go back to download-first for VisualΩr frame extraction.

### Vision token ceiling
20 frames × ~350 chars/frame ≈ 7000 chars of frame descriptions. 2048 tokens is not
enough — Claude Vision truncates mid-JSON. Set to 4096. If running more frames, increase
proportionally: each frame ≈ 200 tokens of response budget.

### Merge logic (additive, not replace)
`visual_intelligence_video_results` kv key stores raw per-video analysis results array.
New VisualΩr runs dedupe by `.title` and merge — previous results survive partial re-runs.
Only the final Opus synthesis (`visual_intelligence_profile`) gets regenerated each run.
DELETE endpoint clears BOTH keys atomically so they never drift out of sync.

---

## WritΩr Iterate JSON Truncation (Session 77)

### Root cause
`src/writr/claude.js` has its own Claude caller (not `src/utils/claude.js`) — separate
file, separate token limit (16384), no repairJSON. When `iterate.js` returned JSON with
`changes_made` as the FIRST field and `script` last, truncated responses contained only
the changes array — never the script. JSON.parse failed on the truncated result.

### Fix (two layers)
1. **Field ordering**: `script` FIRST in JSON schema, `changes_made` LAST. Even if
   truncated, the script value is always emitted before the array.
2. **Regex fallback**: if JSON.parse still fails, extract script value directly:
   `/"script"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/` — handles escaped characters inside
   the string value. Returns a usable script object with a note in changes_made.
This pattern should be copied to any other writr prompt that has a `script` field.

---

## Database

Kre8Ωr uses better-sqlite3 — synchronous, file-based SQLite with WAL mode.
NEVER modify the DB with direct sqlite3 CLI commands or external tools while
the server is running. All DB writes MUST go through the live server API.
Direct edits to the file while the server holds a WAL lock can corrupt data.

Electron DB lives at: `AppData\Roaming\kre8r\kre8r.db` (NOT database/kre8r.db)
Server DB lives at: whatever DB_PATH env var points to.

When adding new columns via `addCol()` in runMigrations(), the Electron AppData
DB doesn't pick them up until the app does a TRUE full restart (not page refresh).
`insertSelect` has a graceful fallback that force-ALTERs missing columns on the
fly so assembly never hard-blocks on a missing column mid-session.

---

## AssemblΩr — Architecture & Hard-Won Fixes (Sessions 75–77)

### Workflow reality
Jason records the FULL video multiple times in one long session. Everything
lands in ONE long proxy clip (e.g. A010_04231559_C028.mov). Take 1 starts at
~1:42, Take 7 starts at ~45:39 — all in the same file, same footage_id.

This is NOT the old multi-file workflow where each take was a separate clip.
Every assembly decision must account for this.

### Call 1 (mapBeatsInClip)
Tags every transcript segment to the beat it covers. Returns `beat_coverage`
(array of beat occurrences with start/end timestamps) and `gold_moments`.
Runs once per clip. For a single long clip it returns ALL beats × ALL takes.

### Call 2 (assembleBeat)
Given all tagged takes for ONE beat, picks the best sequence.
**Prompt must say:** Jason records full video multiple times — each "take" is
a complete 1-4 minute occurrence of this beat, not a 1-3 sentence short take.
Default: pick ONE best complete take (FULL_TAKE). Only mix sentences from a
second take if something specific is broken in the primary. Max 4 entries.

If the prompt says "short takes / 1-3 sentences" it will produce 9-cut
Frankenstein assemblies mixing sentences from across the entire 50-minute clip.
That was the original prompt — it was wrong for this workflow.

### Gold moment assignment
Gold moments are assigned to beats using the beat occurrence WINDOWS that
Call 1 already returned for that clip — not post-hoc proximity guessing.
Per-clip, per-result: `beatWindows` built from `bc.occurrences`, gold moments
assigned inline before moving to the next clip.

Old approach defaulted `bestBeatIdx = 0` when no overlap was found, dumping
every orphaned gold moment into Beat 1. Fixed Session 77.

### selected_takes sort
After `applyHandlesToAssembly`, sort by `start` ascending. All takes live in
one long clip — later takes are at higher timestamps. Without this sort,
Claude's editorial ordering (e.g. "lead with take 4, close with take 3") puts
45-minute content before 3-minute content in the DaVinci timeline.

### Whisper
Default engine. Set `TRANSCRIBE_ENGINE=resolve` to opt into DaVinci transcription
(adds 45s+ cold-start every time, fails unless Resolve timeline is loaded).
Model set in .env via `WHISPER_MODEL`. `base` was hardcoded in .env — change to
`turbo` (fast, near-large accuracy) or `medium`. First run downloads the model.
`--download-root` flag was removed — not supported by all installed versions.

---

## DaVinci Integration — Hard-Won Fixes (Sessions 75–77)

### Per-beat timeline architecture (current approach)
Each beat gets its own isolated Resolve timeline: `BEAT_01_You`, `BEAT_02_Need`, etc.
Main `02_SELECTS` timeline assembles them as compound clips in order.

**Why:** DaVinci's AppendToTimeline silently rejects clips from the same source
when the new IN point is at or behind the last OUT point used for that clip in
the current timeline. With a single long proxy clip used for all beats, adjacent
beats' handles overlap (Beat 3 ends at 23995, Beat 4 starts at 23871) and half
the beats silently vanish from the timeline with no error.

Per-beat timelines reset source state per timeline — no cross-beat conflicts.

Previous approaches tried (all failed):
- Individual AppendToTimeline calls per clip → Resolve drops rapid-fire calls silently
- Batch all beats in one AppendToTimeline call → same silent rejection
- `time.sleep(0.15)` between clips → didn't help
- Clamping src_in to last_end+1 → technically worked but wrong architecture
- `gold_nugget` filter was excluding half the beats entirely (they were in
  `gold_sections` list which never got placed) — silent, no error

### GetMediaPoolItem() on timelines
Available Resolve 18+. Used to get the MediaPoolItem for a beat timeline so it
can be appended as a compound clip to the main timeline. On Studio 20.3.2.9 ✅.
If unavailable, beat timelines are still created — user drags them manually.

### ENAMETOOLONG on Windows spawn
Windows command-line limit is 8191 chars. `--selects_json` blows past it with
a full project's worth of sections. Fix: write payload to temp JSON file in
`os.tmpdir()`, pass `--payload_file <path>`. Python reads + hydrates all fields.
Temp file cleaned up after process exits. Old individual args kept for compat.

### AppendToTimeline pacing
0.2s after creating each beat timeline, 0.3s after placing clips in it.
0.2s after switching to main timeline, 0.2s between compound clip appends.
Resolve scripting API is not designed for high-frequency calls — without delays
it silently drops operations.

### DaVinci 21 differences
Still being mapped (Session 77). Nothing solid yet — check YouTube eventually.
Jason is handling manually for now while learning what changed.

### build-selects.py payload format (current)
Node writes to `%TEMP%/kre8r-selects-<job.id>.json`:
```json
{
  "project_id": 42,
  "project_name": "2026-05-08_Title_042",
  "sections": [...],        // db.getSelectsByProject() output, selected_takes already parsed
  "footage_paths": {...},   // { footage_id → best available path }
  "fps": 24
}
```
Python reads this via `--payload_file`. Old `--selects_json` / `--footage_paths_json`
args still accepted for backward compatibility.

---

## VaultΩr / Transcription

### Proxy dedup
`footageFilePathExists` checks both `file_path` AND `proxy_path` — prevents
re-ingestion loop on server restart for proxies already linked to a BRAW record.

### BRAW proxy naming convention
DaVinci exports proxy as `<basename>_proxy.mp4`. VaultΩr's `findBrawByBasename`
links it back to the BRAW record. project_id propagates from proxy → BRAW record
via `processProxyUpdate`.

---

## PostΩr / TikTok

### TikTok PKCE — Hex, Not Base64url (Session 78)
TikTok's PKCE implementation is non-standard. RFC 7636 S256 method uses base64url encoding.
TikTok uses **hex encoding** of the SHA256 digest instead.

Official TikTok example (developers.tiktok.com/doc/login-kit-desktop):
```js
code_challenge = CryptoJS.SHA256(code_verifier).toString(CryptoJS.enc.Hex)
```

Correct Node.js implementation in `src/postor/tiktok.js`:
```js
const verifier  = crypto.randomBytes(32).toString('hex');          // 64 hex chars
const challenge = crypto.createHash('sha256').update(verifier).digest('hex'); // 64 hex chars
```
Challenge is 64 chars (hex). If you see a 43-char base64url challenge, it's wrong for TikTok.

### TikTok PKCE — Store in DB, Not Session (Session 78)
In Electron, `req.session`-based PKCE storage breaks. The main window navigates to TikTok's
external OAuth page; TikTok's consent page fires a `bytedance://` deep-link attempt that
causes navigation state changes and can lose the session cookie. Verifier is gone by callback.

Fix: store in `kv_store` as `tiktok_pkce_${state}` with 10-min TTL. Never use `req.session`
for TikTok OAuth state in Electron context.

### TikTok Upload — Unaudited App Restriction (Session 78)
Unreviewed apps get `unaudited_client_can_only_post_to_private_accounts` (403) from
`/post/publish/video/init/`. TikTok checks the account's privacy setting server-side —
no `privacy_level` value in the request body bypasses this. The TikTok ACCOUNT must be
set to Private for uploads to succeed during the unreviewed phase.

Workaround for demo: create alt TikTok account → set Private → add as tester → use for demo.
Once TikTok approves Content Posting API access: add `TIKTOK_APPROVED=true` to `.env` — the
`effectivePrivacy` logic in `uploadVideo()` will then use the user's UI selection.

### TikTok app rejected April 2026: missing ToS/PP links on homepage, login page
used as homepage URL. Fixed Session 74:
- `/tos` and `/privacy` routes live (express.static with extensions: ['html'])
- ToS + PP links added to login page and landing page footer
- Homepage URL changed to `/landing`
- Test account provided to reviewer (tiktok-reviewer / RockRich2026!)
- Resubmitted May 7 2026 — awaiting re-review

`getCallbackUrl()` reads `x-forwarded-proto` header for https detection behind nginx.

---

## Auth / Sessions

Session-based login. `users` table (bcrypt). `sessions` table (better-sqlite3 store).
Owner / viewer roles. First run seeds default owner from `KRE8R_OWNER_PW` env var.
kre8r.app protected by this auth — replaces old nginx basic auth.

Public routes whitelisted in server.js middleware:
`/login`, `/setup`, `/landing`, `/download`, `/tos`, `/privacy`,
`/api/releases/*`, `/api/auth/*`, all internal API keys checked separately.

---

## Infrastructure

### Deploy (DigitalOcean)
```
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master &&
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```
DigitalOcean console more reliable than SSH for deploy.

### Electron DB path
`app.getPath('userData')` → `AppData\Roaming\kre8r\kre8r.db`
Reinstalling never overwrites the database. DB_PATH env var set by main.js.

### Gemini / Google AI Studio
Model set in .env via `GEMINI_MODEL`. Default: `gemini-2.5-flash`. Swap to `gemini-2.5-pro`
for higher quality at the cost of speed. Used in Id8Ωr research phases 1 & 2 with Google
Search grounding for live web results. Falls back to Claude training knowledge automatically
if `GOOGLE_AI_API_KEY` is missing or Gemini fails.

### VisualΩr (planned — needs modal.com account)
Visual Intelligence module. Lives in MirrΩr tab. Electron-only (needs local footage files).
Analyzes top-performing videos via Modal.com frame extraction + vision models.
Outputs Visual Intelligence Profile → stored in kv_store → injects into WritΩr b-roll
suggestions and BrollΩr prompts. Output travels to kre8r.app even though analysis is
Electron-only. Avoids all psychology terminology per creator preference.

---

### PM2 OrgΩr (local)
```
node %APPDATA%\npm\node_modules\pm2\bin\pm2 start server.js --name orgboard
```
Run from `C:\Users\18054\orgboard`. Process lost after machine restart — re-run to restore.
