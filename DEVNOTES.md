# Kre8Ωr — Dev Notes & Decision Log

Running record of hard-won decisions, dead ends, and architecture reasoning.
When a problem takes more than one session to solve, write it here.
Future Claude reads this before touching anything related.

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
