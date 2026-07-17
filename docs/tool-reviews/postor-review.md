# PostΩr — Architectural Review
*Opus multi-agent audit. Special focus: workflow order + what's blocking daily use.*

## Synthesis
I'll synthesize the PostΩr review. Let me work through deduplication and analysis of the findings.

The findings are self-contained and detailed enough to synthesize directly. Let me produce the consolidated review.

# PostΩr Review — Synthesis

## Deduplication Summary
The 27 raw findings collapse to **18 unique issues**. The queue overlap-guard bug was reported 5 times (PB1, PO-3, PO-4[2nd], POSTOR-INT-005, and known issue #2) — all one issue. Caption-table fragmentation reported 3× (PO-4[1st], POSTOR-INT-004), dev-only OAuth bypass routes 2× (PO-7, PO-8[2nd]), nav-order 3× (PO-1[1st], POSTOR-INT-006, PO-5). Two separate `PO-1`/`PO-2`/`PO-3` ID namespaces existed in the input (workflow batch vs simplification batch) — merged by content.

---

## CRITICAL

**C1. Queue processor has no re-entrancy guard → duplicate public posts** *(merges PB1, PO-3, PO-4, POSTOR-INT-005, known issue #2)*
`src/postor/queue-processor.js` `start()` guards double-*start* but `run()` on the 60s `setInterval` has no in-flight lock. IG polls up to 3 min, TikTok ~2.5 min, FB/YT buffer whole files — uploads routinely exceed 60s. Overlapping ticks both read `getPendingQueueItems()` before `status` flips to `'posting'` (set inside `processItem` at line 50, not atomically claimed), publishing the same video twice to 725k-follower accounts. Irreversible, public, no recovery path — direct Prime Directive violation.
*Fix:* module-level `let running=false` checked at top of `run()`, reset in `finally`; **plus** atomic claim — `UPDATE postor_queue SET status='posting' WHERE id=? AND status='pending'`, proceed only if `changes===1`.

**C2. Queued TikTok posts always recorded as failed/partial** *(PB2)*
`tiktok.uploadVideo()` returns `{post_id, post_url}` with no `ok` field (tiktok.js:358-361). Queue success logic `Object.values(results).every(r=>r.ok)` reads `undefined` → status `'failed'` for a post that actually went live. Creator sees failure, re-posts → duplicate. Error string reads literally `tiktok: undefined`.
*Fix:* add `ok:true` to tiktok.uploadVideo return (normalize all platform modules; meta+youtube already do).

---

## HIGH

**H1. No AssemblΩr/ComposΩr → PostΩr handoff** *(PO-2[workflow], compounded by PO-5)*
After the final cut is approved in ComposΩr/ReviewΩr there is no "Send to PostΩr." PostΩr's only source is a flat all-time `<select>` of every completed video (`/vault-videos`). The CaptionΩr→PostΩr deep-link (`captionr_prefill` in localStorage, postor.html:1834) proves the pattern works — ComposΩr/ReviewΩr just lack it. The creator finishes editing and hits a cold, contextless picker; the project thread is dropped and re-established by hand. **Highest creator-impact blocker.**
*Fix:* "Distribute → PostΩr" button writing `footage_id`+`project_id` to localStorage, deep-link `/postor.html?project_id=X`, auto-select + auto-`prefillFromProject()`.

**H2. Queued YouTube ignores privacy → always public** *(PB3)*
Queue calls `yt.uploadVideo({privacy: item.yt_privacy})` but uploadVideo destructures `privacyStatus` (youtube.js:132), defaulting to `'public'` (line 148). A scheduled private/unlisted video publishes PUBLIC to 54k subs, silently.
*Fix:* one-word change — `privacy:` → `privacyStatus:` in queue-processor.js:90.

**H3. Items stuck in 'posting' on crash never recovered** *(PB4)*
`status='posting'` set before multi-minute upload; on Electron restart mid-upload the row hangs forever (`getPendingQueueItems` selects only `'pending'`). Scheduled post silently never fires. Prime Directive violation.
*Fix:* startup recovery sweep `UPDATE postor_queue SET status='pending' WHERE status='posting'` (or stale-threshold via `updated_at`).

**H4. Partial-failure posts never retried, never surfaced** *(PB5)*
`'partial'` status is written then abandoned — failed platforms silently dropped, only `console.error`. YT goes live, IG never posts, creator never told.
*Fix:* surface partial/failed to Mission Control alert query; retry-failed-platforms affordance + badge in history.

**H5. Publish fan-out fires only from queue, never immediate posts** *(POSTOR-INT-001)*
`firePublishFanOut()` (marks SeedΩr idea `produced`, seeds Post-Mortem brief) lives only in queue-processor. The default "Post Now" button never calls it → most posts produce no Post-Mortem brief and never signal "idea shipped." Silently breaks known issue #5 at the source.
*Fix:* extract to `src/postor/fanout.js`, call from immediate `/post` route on all-success; both paths converge.

**H6. ClipsΩr output never reaches Campaign Builder** *(POSTOR-INT-002)*
`getUnpackagedClips()` selects `footage WHERE shot_type='social-clip'`, but ClipsΩr writes `viral_clips` timestamp ranges and never renders/inserts a `social-clip` footage row. AI-identified viral moments cannot flow into PostΩr distribution; creator re-cuts manually.
*Fix:* on viral_clip render, insert `social-clip` footage row carrying project_id + rendered path + seeded caption; or UNION viral_clips into `getUnpackagedClips`.

**H7. Pipeline TikTok/YouTube captions fetched but dropped** *(PO-2[caption])*
`/prefill` returns captions for all 4 platforms but `prefillFromProject()` (postor.html:2379) maps only IG and FB. TikTok caption (biggest platform, 725k) is silently discarded; no dedicated YouTube caption field.
*Fix:* map `data.captions.tiktok`; add TikTok caption field; show which platforms got captions.

**H8. Bulk Queue ignores all per-platform captions** *(PO-3[caption])*
Bulk sends one shared description; `/post-queue` hard-skips TikTok entirely and falls IG back to shared text. Campaign Builder's `addClipToQueue` collapses its rich per-platform captions to `firstCap`. Exactly when platform-native captions matter most (many clips), all the upstream caption work is flattened.
*Fix:* carry the per-platform caption object end-to-end through the queue; stop hard-skipping TikTok.

**H9. No "post this whole project" one-click path** *(PO-5[workflow])*
Everything is joined by `project_id` (video, title, YT description, captions, clips) yet the creator manually picks the video, waits for prefill, toggles platforms, then switches to Campaign mode for the clips. The 20-min-vs-2-min gap: assembly is already done upstream, PostΩr makes them re-assemble by hand.
*Fix:* project-first entry → main video (pre-captioned, platforms pre-toggled) + social clips in one review list → "Send/Schedule all" with default staggered cadence.

**H10. Three competing posting modes force a mode decision first** *(PO-1[simplification])*
Single / Bulk Queue / Campaign overlap heavily, each with its own caption-fill, toggle renderer, progress UI. Jason thinks "I have N videos, send them out," not in these buckets. Adds a decision (Secondary Directive violation).
*Fix:* collapse to one surface — a list of things-to-post, each with platform multi-select + optional time; post-now = schedule-now; "Generate captions" becomes a row action.

**H11. YouTube OAuth breaks behind nginx on kre8r.app** *(PB10)*
`youtube.getCallbackUrl` uses `req.protocol` while meta/tiktok read `x-forwarded-proto`. Behind nginx without `trust proxy`, redirect_uri becomes `http://` → `redirect_uri_mismatch`, YouTube connect silently fails in production multi-tenant deploy.
*Fix:* `req.get('x-forwarded-proto')||req.protocol`, or `app.set('trust proxy',1)` in server.js.

---

## MEDIUM

**M1. Campaign captions vs CaptionΩr captions — two tables, never reconciled** *(PO-4[caption-fragmentation] + POSTOR-INT-004)*
Campaign Builder writes `footage.caption_package`; `/prefill` reads the `captions` table. Captions generated in one surface vanish in another → re-generation, wasted Claude calls, state-fragmentation against Prime Directive.
*Fix:* one source of truth — Campaign Builder upserts into `captions` table (project_id+footage_id+platform), or `getCaptions` falls back to `caption_package`.

**M2. MirrΩr bridge only fires for YouTube + only immediate posts** *(POSTOR-INT-003)*
`db.savePost` gated on `platform==='youtube'` and absent from queue-processor. Scheduled YT posts and all IG/FB/TikTok posts never write a `posts` row — MirrΩr is accidentally YouTube-only despite 725k-TikTok weighting.
*Fix:* move `savePost` into shared success path for every platform + add to queue processor; or have MirrΩr consume `postor_posts`.

**M3. FB image post throws "not connected" for valid connections** *(PB6)*
`publishFacebookPost` checks `conn.connected` — a field never persisted (only synthesized in the route's `/connections` response). Always undefined → always throws. Breaks MailΩr fb-post and queue `facebook_post`.
*Fix:* `if(!conn) throw` matching the other two publish functions (meta.js:277-278).

**M4. ngrok tunnel is an invisible prerequisite that silently fails Meta posts** *(PO-5[improvement])*
IG/FB need a public URL via ngrok; if down/unauthed the post fails deep in upload as opaque `platform_error`. No pre-flight.
*Fix:* pre-flight tunnel reachability check in `/post` + queue before marking `'posting'`; tunnel-status badge by IG/FB chips.

**M5. Lock Schedule fires N sequential POSTs with no rollback/de-dupe** *(PO-6[workflow])*
On mid-loop network drop, 1-6 persist, 7-12 don't, but board keeps all 12; re-click duplicates 1-6 (`addToPostorQueue` has no uniqueness on video+time+platform). Compounds C1.
*Fix:* remove placements per-success; server-side idempotency guard on (video_path, scheduled_at, platforms).

**M6. Stable per-post defaults re-decided every time** *(PO-6[improvement])*
YT category defaults to 22/People&Blogs (wrong — content is Howto/homestead), tags empty, platforms default off. Pure admin friction.
*Fix:* persist last-used / profile-configured defaults from creator-profile.json (Engine/Soul-separated); pre-check usual platforms, default category to Howto/Style 26.

**M7. No connection-health pre-flight before composing** *(PO-7)*
Creator composes, then discovers at publish that a platform is disconnected or the Meta 60-day token lapsed. No Meta token-refresh path (unlike youtube.js `refreshToken()`).
*Fix:* connection-health strip (connected / expiring / needs-linking); Meta token-expiry check mirroring `youtube.getValidToken()`.

**M8. FB/YT read entire file into memory (readFileSync)** *(PB8)*
Multi-GB exports can OOM the Electron main process mid-run, stranding the item in `'posting'` (C1/H3) and abandoning the rest of the loop.
*Fix:* streaming/chunked upload (like TikTok module) or `statSync` threshold → resumable.

**M9. PostΩr uses console.* instead of pino logger** *(PO-8[improvement])*
Violates CLAUDE.md convention; publish-failure paths land in stdout without structured fields — invisible to aggregation, hard to diagnose "my post didn't go out."
*Fix:* replace with `log.error({module:'postor',event,platform,err,video_path})`; prioritize queue + publish error paths.

**M10. TikTok PKCE rows nulled not deleted → unbounded kv growth** *(PB7)*
Consumed/expired PKCE state written as `null` rather than removed; no TTL sweep → dead `tiktok_pkce_*` rows accumulate.
*Fix:* add `db.deleteKv()` + periodic sweep of expired rows.

---

## LOW

**L1. Six dev-only Meta token-bypass routes ship in production** *(PO-7[simplification] + PO-8[simplification])* — `manual-token`/`link-instagram`/`debug-instagram`/`set-instagram-id`/`manual-instagram-token`/`select-page`; two hardcode `'7.kin.jason'` (Engine/Soul violation); `debug-instagram` echoes raw tokens. *Fix:* gate behind `NODE_ENV!=='production'`, remove hardcoded literals, redact token output.

**L2. IG processing timeout treated as hard failure though "may still publish"** *(PB9)* — creator told failed, re-posts → duplicate Reel; tunnel already closed so a mid-download IG 404s. *Fix:* record `'pending_confirmation'`, poll creation_id later before declaring failure.

**L3. No save-state recovery for interrupted immediate-post SSE jobs** *(PO-9)* — in-memory `jobs` Map is volatile; on restart the spinner never resolves, `postor_posts` stuck in `'posting'`. *Fix:* startup sweep marks stale rows `needs_review` with UI badge.

---

## TOP 3 BY CREATOR IMPACT (non-filming-day blockers)

1. **C1 — Queue double-post (no overlap guard).** The single thing that will make Jason stop trusting the scheduler. A duplicate public post to 725k TikTok / 54k YouTube is visible, embarrassing, and unrecoverable. Until this is fixed, scheduled posting cannot be relied on — which is *exactly* the non-filming-day use case (batch-and-schedule). Tiny, isolated fix; highest payoff. **Fix first.**

2. **H1 + H9 — No project-first handoff into PostΩr.** This is the 20-min-vs-2-min gap. On an editing/distribution day Jason finishes a cut and faces a cold all-time dropdown, then has to mode-hop to caption and schedule the clips — re-assembling by hand what `project_id` already joins. A "Distribute → PostΩr" deep-link + one-click "publish this project (main video + staggered clips)" turns the tool's core job from *construct* to *confirm*. This is the difference between PostΩr being used daily vs avoided.

3. **H7 + H8 + M1 — Captions silently lost/flattened.** Across single-post (TikTok+YT dropped), bulk (everything flattened, TikTok skipped), and the two-table split, the platform-native captions that CaptionΩr/Campaign Builder generated keep vanishing. Jason re-types captions for his biggest platform by hand — the pipeline's central promise ("caption once, post everywhere") is broken at the last mile. High admin friction precisely on batch-distribution days.

---

## WORKFLOW ORDER VERDICT

**Current nav (`public/js/nav.js`, `dist` group):**
GateΩr(M1) → PackageΩr(M2) → CaptionΩr(M3) → MailΩr(M4) → AudiencΩr(M5) → **PostΩr** → AutomatΩr → MirrΩr → AnalyticΩr → …

**Problem:** PostΩr — the single most-used action (publish the video) — sits at position 6, *below* AudiencΩr (audience-intelligence, which logically assumes publishing already happened) and intermixed with MirrΩr/AnalyticΩr (pure analytics that *consume* PostΩr's output). The M1–M5 numbering visually stops at AudiencΩr, making PostΩr read as an orphan tacked on the end. The creator must scan past 5 siblings to find "the post button" (Secondary Directive violation). The data flow contradicts the order: PostΩr's `/prefill` depends directly on PackageΩr (`getSelectedPackage`) and CaptionΩr (`getCaptions`), and MailΩr actually *calls into* PostΩr (`/fb-post`) — so PostΩr is a mid-pipeline producer wrongly placed after its consumers.

**Correct post-production → distribution sequence (matches CLAUDE.md ACTUAL PIPELINE and the data dependencies):**

```
POST-PRODUCTION:   VaultΩr → EditΩr/AssemblΩr → ReviewΩr → ComposΩr → ClipsΩr
                                                              │
                              [Distribute → PostΩr deep-link] ┘   ← H1: the missing seam
                                                              ▼
DISTRIBUTION:      GateΩr(M1) → PackageΩr(M2) → CaptionΩr(M3) → PostΩr(M4) → MailΩr(M5) → AudiencΩr(M6)
                              ───────────── visual separator ─────────────
ANALYTICS:         MirrΩr → AnalyticΩr → NorthΩr → VectΩr → Post-Mortem → StudioΩr
```

**Specific recommendation:**
1. **Move PostΩr to immediately follow CaptionΩr** — CaptionΩr's output (`captions` table) is PostΩr's direct prefill input. The chain reads `package → caption → POST → measure`, the natural mental model.
2. **Renumber so PostΩr is a stage, not an orphan** — give it M4 (push MailΩr→M5, AudiencΩr→M6) so it reads as a numbered pipeline step.
3. **Split the bloated 14-item `dist` group** into two sub-sections matching CLAUDE.md's two sections: **Distribution** (Gate→Package→Caption→Post→Mail→Audience) and **Analytics** (Mirr→Analyticr→Import). This stops the consumer (MirrΩr) from sitting next to the producer (PostΩr).
4. **The nav reorder is cosmetic; the real sequence fix is H1** — the post-production→distribution handoff is broken at the *seam*, not just mislabeled in nav. ComposΩr/ReviewΩr (where the approved cut lives) must hand off to PostΩr the way CaptionΩr already does. Fixing nav order without fixing the handoff just makes the orphan easier to find, not easier to use.

**Net:** PostΩr belongs at the *end of distribution authoring, before analytics* — position M4, right after CaptionΩr, with a hard separator before the read-only analytics tools. The pipeline is `produce the cut → package → caption → POST → (email/audience) → then measure`.

— Source files: `C:\Users\18054\kre8r\src\postor\queue-processor.js`, `C:\Users\18054\kre8r\src\postor\tiktok.js`, `C:\Users\18054\kre8r\src\postor\youtube.js`, `C:\Users\18054\kre8r\src\postor\meta.js`, `C:\Users\18054\kre8r\src\routes\postor.js`, `C:\Users\18054\kre8r\src\db.js`, `C:\Users\18054\kre8r\public\postor.html`, `C:\Users\18054\kre8r\public\js\nav.js`

## Full Findings (33 total)
### [CRITICAL] Queue processor has no overlap guard — slow upload causes concurrent run() ticks and double-fire
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\queue-processor.js:222-245 (run/start), status write at line 50
**Problem:** start() in queue-processor.js uses setInterval(run, 60s) with only a one-time `started` flag guard. There is no re-entrancy guard on run() itself. run() awaits processItem sequentially over all pending items; a single video upload to YouTube/IG/TikTok routinely exceeds 60s (IG polls up to 3 min, TikTok up to ~2.5 min, FB readFileSync of a large file into memory then upload). When run() is still awaiting a slow upload and the 60s interval fires again, a second run() executes concurrently. The status='posting' write at line 50 is the only thing preventing re-selection — but it is set INSIDE processItem AFTER getPendingQueueItems() has already returned the row to BOTH overlapping runs if the second tick's getPendingQueueItems() executes before the first run reached that item. Net: same scheduled post can fire twice → duplicate publishes to the creator's 725k-follower accounts. This is the known issue #2 but is genuinely unguarded.
**Fix:** Add a module-level `let running = false;` re-entrancy guard: at the top of run() do `if (running) return; running = true;` and reset it in a finally. This serializes ticks. Additionally make claiming atomic: change the pending fetch+mark to a single UPDATE...WHERE status='pending' RETURNING id (or update to 'posting' first, then process only rows you successfully transitioned) so two overlapping runs cannot both claim the same row.

### [CRITICAL] Queued TikTok post is always recorded as failed/partial — uploadVideo return lacks `ok` field
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\queue-processor.js:104-116 (tiktok call) and 125-127 (allOk/anyOk); root cause C:\Users\18054\kre8r\src\postor\tiktok.js:358-361
**Problem:** queue-processor.js computes success with `Object.values(results).every(r => r.ok)` (line 125) and `.some(r => r.ok)` (line 126). tiktok.uploadVideo() returns `{ post_id, post_url }` with NO `ok` property (tiktok.js lines 358-361). So for a TikTok queue item, r.ok is undefined → allOk=false, anyOk=false → status computed as 'failed' even though the video actually published/sent to inbox successfully. The error string built at lines 132-135 will read `tiktok: undefined`. The creator sees a failed post in history for a post that actually went live — and may manually re-post, causing a duplicate. (The immediate /post route avoids this because it wraps results as `{ ok: true, ...result }` in postor.js, but the queue path does not.)
**Fix:** Either add `ok: true` to the object returned by tiktok.uploadVideo (tiktok.js line 358), or in queue-processor wrap every platform result the way the route does: `results.tiktok = { ok: true, ...r }`. Best to normalize all platform modules to return `ok: true` (meta + youtube already do; tiktok is the outlier).

### [HIGH] Queued YouTube posts ignore creator's privacy setting — always published public
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\queue-processor.js:90 (privacy:) vs C:\Users\18054\kre8r\src\postor\youtube.js:132/148 (privacyStatus)
**Problem:** queue-processor.js line 86-94 calls yt.uploadVideo({ ..., privacy: item.yt_privacy || 'public', ... }). But youtube.uploadVideo destructures `privacyStatus` (youtube.js line 132), not `privacy`. The `privacy` key is silently dropped, so privacyStatus is undefined and falls through to the default `'public'` at line 148. A creator who scheduled a video as 'private' or 'unlisted' via the PostΩr queue gets it published PUBLIC to 54k YouTube subscribers. Silent — no error surfaces. (The immediate /post route is correct: it passes privacyStatus.)
**Fix:** In queue-processor.js change `privacy: item.yt_privacy || 'public'` to `privacyStatus: item.yt_privacy || 'public'` to match uploadVideo's destructured parameter name.

### [HIGH] Items stuck in 'posting' on crash/restart are never recovered — scheduled post silently never fires
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\queue-processor.js:50; C:\Users\18054\kre8r\src\db.js:5913-5920
**Problem:** processItem sets status='posting' at line 50, then does the (possibly multi-minute) uploads. If the process crashes or Electron is closed/restarted mid-upload (very common on a desktop app), the row is left at status='posting'. getPendingQueueItems() (db.js:5913) selects ONLY status='pending', so a 'posting' row is never re-picked. The scheduled post silently never publishes and never shows an error — it just hangs in 'posting' forever. Violates the Prime Directive (creator loses the post with no recovery path).
**Fix:** On queue processor start(), run a one-time recovery sweep that resets stale rows: `UPDATE postor_queue SET status='pending' WHERE status='posting'` (or add an `updated_at` and only reset rows older than e.g. 15 min). Optionally include 'posting' rows older than a threshold in getPendingQueueItems so they retry.

### [HIGH] Queue partial-failure ('partial' status) is never retried and not surfaced — half-posted video silently abandoned
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\queue-processor.js:125-136
**Problem:** processItem computes status='partial' when some platforms succeed and others fail (line 127), writes the partial error string, and stops. getPendingQueueItems only re-selects status='pending', so a 'partial' item is never retried — the platforms that failed are silently dropped. There is no UI alert path from the queue processor (only console.error). For a multi-platform scheduled post where, say, IG's ngrok tunnel was down, YouTube goes live but IG never posts and the creator is never told. Combined with PB2/PB3 this means the 'partial' bucket quietly swallows real failures.
**Fix:** Surface partial/failed queue outcomes to the creator (Mission Control already reads postor_queue for failed counts — ensure 'partial' is included in that alert query). Provide a retry affordance that re-posts only the failed platforms, or at minimum a clear failed/partial badge in PostΩr history so nothing is silently lost.

### [MEDIUM] publishFacebookPost checks conn.connected which is never stored — throws 'Facebook not connected' for valid connections
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\meta.js:277-278
**Problem:** In meta.js publishFacebookPost (line 277-278): `const conn = db.getPostorConnection('facebook'); if (!conn?.connected) throw new Error('Facebook not connected');`. The stored platform_connections row has columns access_token/account_id/account_name but NO `connected` column — `connected:true` is only synthesized in the route's /connections response (postor.js byPlatform map), never persisted. So conn.connected is always undefined for the raw DB row, making `!conn?.connected` always true → this throws even when Facebook IS connected. This breaks MailΩr's fb-post / facebook_post flow and the queue's facebook_post path. (Contrast publishFacebookVideo/publishInstagramReel at lines 214/128 which correctly check only `if (!conn)`.)
**Fix:** Change the guard to `if (!conn) throw new Error('Facebook not connected');` and rely on the subsequent pageId/pageToken null-check at line 282, matching the other two publish functions.

### [MEDIUM] TikTok PKCE/state record is not deleted on successful exchange failure paths, and uses setKv(null) instead of delete — orphaned/replayable state
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\routes\postor.js tiktok callback (db.setKv(`tiktok_pkce_${state}`, null) calls)
**Problem:** In postor.js tiktok callback, the PKCE record is cleared via db.setKv(`tiktok_pkce_${state}`, null) on the timeout path and after retrieval. But if tiktok.exchangeCode throws (network error, TikTok error), the verifier was already cleared before the try (good), however on the FIRST guard where pkceRaw is missing it redirects without issue. The real gap: the success path deletes the kv by writing null rather than removing the row, so the kv table accumulates null-valued tiktok_pkce_* rows indefinitely (no TTL cleanup job). More importantly, state is single-use only because the row is nulled — but there is no check that the row hasn't already been consumed (a nulled-then-reread returns null → treated as expired, which is acceptable). Primary concern is unbounded kv growth of dead PKCE rows.
**Fix:** Add a db.deleteKv() and use it to actually remove consumed/expired PKCE rows, or run a periodic sweep deleting tiktok_pkce_* rows past their expires timestamp. Keeps kv_store from accumulating dead OAuth state.

### [MEDIUM] Facebook video upload reads entire file into memory with readFileSync — large BRAW-sourced exports can OOM the Electron process and silently kill an in-flight queue run
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\meta.js:225,250 (publishFacebookVideo)
**Problem:** meta.publishFacebookVideo (line 225) does `fs.readFileSync(videoPath)` then Buffer.concat with the whole file for a manual multipart body (line 250). youtube.uploadVideo similarly buffers the whole file. For a multi-GB completed-video export this can exhaust memory in the Electron main process. If it OOMs mid-run, the queue item is left in 'posting' (see PB4) and every other pending item in that run() loop is abandoned. No streaming, no size guard.
**Fix:** Stream the upload (use FB's resumable/chunked video upload API like the TikTok module already does with chunked PUTs, or pipe a read stream into a streaming multipart encoder). At minimum, fs.statSync the file and reject/route-to-resumable above a threshold rather than readFileSync-ing arbitrarily large files.

### [LOW] Instagram processing timeout treated as hard failure though video 'may still publish' — creator told it failed when it may go live
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\postor\meta.js:180-184
**Problem:** meta.publishInstagramReel line 180 throws 'Instagram processing timed out (3 min limit) — video may still publish' when status never reaches FINISHED in 36 polls. This propagates as a failed post (postor_posts status='failed' / queue 'failed'). But as the message itself admits, IG may still finish processing and publish. The creator sees 'failed', re-posts, and ends up with a duplicate Reel. The tunnel is also already closed in the finally (line 183), so even if IG was mid-download it now 404s.
**Fix:** On timeout, record a distinct 'processing'/'pending_confirmation' status rather than 'failed', and add a follow-up status check (poll the creation_id later) before declaring failure, so the creator is not prompted to re-post a Reel that publishes itself.

### [LOW] youtube.getCallbackUrl uses req.protocol while meta/tiktok honor x-forwarded-proto — OAuth redirect_uri mismatch behind nginx on kre8r.app
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\src\postor\youtube.js getCallbackUrl (req.protocol)
**Problem:** youtube.js getCallbackUrl builds the redirect URI from req.protocol directly. Behind nginx on kre8r.app (DigitalOcean deploy), req.protocol is 'http' unless app.set('trust proxy', 1) is configured, so the callback URL becomes http:// while Google has https:// registered → redirect_uri_mismatch, YouTube connect silently fails in production. meta.js (line 49) and tiktok.js (line 55) both correctly read x-forwarded-proto. This is an inconsistency that breaks YouTube OAuth specifically on the hosted multi-tenant deploy.
**Fix:** Make youtube.getCallbackUrl read `req.get('x-forwarded-proto') || req.protocol` to match meta.js/tiktok.js, or set `app.set('trust proxy', 1)` in server.js so req.protocol is correct behind nginx.

### [HIGH] PostΩr is positioned AFTER AudiencΩr/MirrΩr in nav — publish step buried below analytics tools
**Dimension:** workflow-order | **Location:** public/js/nav.js:67-85 (dist group)
**Problem:** The Distribution nav (public/js/nav.js, 'dist' group) lists: GateΩr(M1) -> PackageΩr(M2) -> CaptionΩr(M3) -> MailΩr(M4) -> AudiencΩr(M5) -> PostΩr -> AutomatΩr -> MirrΩr -> AnalyticΩr -> ... PostΩr is the ACTUAL publish action, yet it sits at position 6, below AudiencΩr (an audience-intelligence/analytics-facing tool) and just above MirrΩr/AnalyticΩr (pure analytics). This contradicts the CLAUDE.md pipeline which ends DISTRIBUTION with PostΩr -> then a SEPARATE ANALYTICS section (MirrΩr -> NorthΩr -> VectΩr -> Post-Mortem). The data flow confirms PostΩr is the producer that MirrΩr/AnalyticΩr consume (PostΩr writes posts + analytics tables that MirrΩr reads). Having the consumer (MirrΩr) listed near a producer (PostΩr) with the analytics tools intermixed obscures the natural 'package -> caption -> post -> measure' order. For a creator who wants to spend MORE post-production time here, the single most-used action (post the video) requires scanning past 5 sibling items, and the M1-M5 numbering visually stops at AudiencΩr making PostΩr look like an afterthought tacked on the end. Violates Secondary Directive (reduce decisions): the creator must decide which of 6+ dist tools is 'the post button.'
**Fix:** Reorder the 'dist' group to follow execution order: GateΩr(M1) -> PackageΩr(M2) -> CaptionΩr(M3) -> PostΩr -> MailΩr(M4) -> AudiencΩr(M5), then a visual separator, then the analytics/read tools (MirrΩr, AnalyticΩr, Analytics Import). PostΩr should immediately follow CaptionΩr because CaptionΩr's output (captions table) is PostΩr's direct input via /project/:id/prefill. Give PostΩr a sublabel (e.g. 'M6' or 'POST') so it reads as a numbered pipeline stage, not an orphan. Consider splitting the bloated 14-item 'dist' group into 'Distribution' (Gate->Package->Caption->Post->Mail->Audience) and 'Analytics' (Mirr->Analyticr->Import) sub-sections to match the two CLAUDE.md sections.

### [HIGH] No direct AssemblΩr/ComposΩr -> PostΩr handoff — completed video re-discovered by manual vault scroll
**Dimension:** workflow-order | **Location:** src/routes/postor.js (/vault-videos, /project/:id/prefill); public/postor.html:2345-2395 (onVaultPick/prefillFromProject); public/composor.html / public/reviewr.html (missing handoff)
**Problem:** The creator's core loop is approve script -> vault footage -> assemble -> distribute, but the assemble->distribute seam is broken. After AssemblΩr/ComposΩr produces a finished cut, there is no deep-link or 'Send to PostΩr' action. PostΩr's only video source is GET /api/postor/vault-videos which queries db.getAllFootage({shot_type:'completed-video'}) and dumps EVERY completed video into a flat <select> dropdown (postor.html onVaultPick). The creator must remember the filename, scroll the dropdown, pick the right one, and only THEN does prefillFromProject() fire to pull title/captions. CaptionΩr already has a handoff path (localStorage 'captionr_prefill' read at postor.html:1834), proving the deep-link pattern exists and works — but ComposΩr/ReviewΩr (where the final approved cut lives) have no equivalent. This is the biggest 'blocker' for using the tool more: the creator finishes editing in one tool and hits a cold, contextless picker in another. Violates Prime Directive adjacent concern — the creative thread (which project this video belongs to) is dropped and must be manually re-established.
**Fix:** Add a 'Distribute -> PostΩr' button to ComposΩr/ReviewΩr that writes the completed video's footage_id + project_id to localStorage (mirror the existing 'captionr_prefill' contract) and deep-links to /postor.html?project_id=X. On PostΩr load, auto-select that video in the picker and immediately call prefillFromProject() so title, youtube_description, and per-platform captions populate with zero manual steps. Additionally, filter /vault-videos to default to the most-recent / in-progress project's completed video rather than all-time, with an 'all videos' toggle — turning the post step from a search into a confirm.

### [HIGH] Queue processor 60s setInterval has no overlap guard — concurrent fire double-posts on slow uploads
**Dimension:** improvement | **Location:** src/postor/queue-processor.js (run/processItem, no in-flight lock); src/postor/meta.js (3-min IG poll); src/postor/youtube.js (readFileSync full-buffer upload)
**Problem:** Known issue #2 confirmed. src/postor/queue-processor.js start() guards double-start with a 'started' flag but the run() body invoked by setInterval(60s) has no in-flight lock. publishInstagramReel polls status_code up to 36x5s (3 minutes) per Meta upload (src/postor/meta.js), and YouTube/Facebook read the ENTIRE file into memory with readFileSync and PUT/POST it — easily exceeding 60s for large 4K videos. When tick N is still uploading and tick N+1 fires, both can pick up the same 'posting' queue row (status is only set to 'posting' inside processItem, not atomically claimed before the next tick reads), causing the SAME video to be published TWICE to the platform. This is a direct Prime Directive violation in the destructive direction: a double-post to 725k TikTok / 54k YouTube is public, embarrassing, and not silently recoverable. It also undermines 'use the tool more' — a creator burned by a duplicate public post will distrust the scheduler.
**Fix:** Add a module-level boolean (e.g. let running=false) checked at the top of run(): if running, log-and-return immediately, set true in a try, reset in finally. Independently, make queue claiming atomic: before processing, UPDATE postor_queue SET status='claimed' WHERE id=? AND status='pending' and only proceed if changes===1, so even concurrent ticks (or a future multi-worker setup) cannot grab the same row. This is a small, isolated, high-value fix.

### [MEDIUM] CaptionΩr (M3) and Campaign Builder write captions to two different tables — PostΩr prefill misses Campaign captions
**Dimension:** workflow-order | **Location:** src/routes/postor.js (/project/:id/prefill reads getCaptions; /campaign/generate-captions writes updateFootageCaptionPackage); captions table vs footage.caption_package
**Problem:** There are two caption-production paths feeding PostΩr and they are not unified. (1) CaptionΩr writes to the captions table; PostΩr's /project/:id/prefill reads db.getCaptions(projectId) and groups by platform. (2) PostΩr's own Campaign Builder (/campaign/generate-captions) writes to the footage table's caption_package column via db.updateFootageCaptionPackage — a DIFFERENT table. Result: a creator who generated captions in the Campaign Builder for a long-form video will NOT see them appear when they pick that video in the main post form (prefill only reads the captions table). Conversely CaptionΩr output does not surface in the Campaign Builder clip cards (which read footage.caption_package). This fragments the 'caption once, post everywhere' workflow and forces re-generation, adding a decision/step (Secondary Directive violation) and wasting Claude API calls.
**Fix:** Unify the read path: have /project/:id/prefill also fall back to footage.caption_package for the picked video when the captions table is empty for that project, and have the Campaign Builder PATCH route (/campaign/captions/:footage_id) optionally mirror into the captions table keyed by project_id. At minimum, document and surface in the UI which caption source is active so the creator isn't silently posting stale or empty captions.

### [MEDIUM] ngrok tunnel dependency for Meta uploads is an invisible prerequisite that silently fails the post
**Dimension:** improvement | **Location:** src/postor/meta.js (publishInstagramReel/publishFacebookPost tunnel use); src/postor/video-tunnel.js; src/routes/postor.js POST /post (no pre-flight)
**Problem:** Known issue: Meta (Instagram Reel + Facebook image) publishing requires a public video_url, served via src/postor/video-tunnel.js (createFileTunnel / ngrok). publishInstagramReel opens a tunnel, hands Meta the URL, polls 3 min, then closes it (meta.js). If ngrok is not running / NGROK_AUTHTOKEN missing / tunnel fails to bind, the IG/FB post fails deep inside the upload with a generic platform error surfaced as 'platform_error' in the SSE stream — the creator sees 'Error' on the IG chip with no actionable cause. For a creator who wants to lean on this tool, an opaque dependency that must be alive before posting (but is never checked up front) is a recurring silent blocker. There is no pre-flight connectivity check in the post route before committing the postor_posts 'posting' row.
**Fix:** Add a pre-flight check in POST /post (and the queue processor) when platforms include instagram/facebook with an image/video: verify the tunnel is reachable and emit a clear, early SSE event ('Instagram needs the ngrok tunnel — start it / set NGROK_AUTHTOKEN') BEFORE marking the post 'posting'. Surface tunnel status as a badge in the PostΩr connections panel next to the IG/FB chips so the creator sees readiness at a glance, turning a mid-upload failure into a pre-flight nudge.

### [MEDIUM] Schedule Board 'Lock Schedule' fires N sequential awaited POSTs with no partial-rollback or de-dupe
**Dimension:** inter-tool | **Location:** public/postor.html (lockSchedule loop); src/routes/postor.js POST /api/postor/queue; db.addToPostorQueue (no dedupe)
**Problem:** lockSchedule() in postor.html loops every placement and awaits a separate POST /api/postor/queue per cell. If the creator scheduled 12 clips and the network drops at clip 7, clips 1-6 are persisted to postor_queue, 7-12 are not, and the UI reports 'X scheduled, Y failed' but the schedPlacements board still holds ALL 12 (it only clears on ok>0 wholesale, then rebuilds empty). Re-clicking 'Lock Schedule' would re-submit the already-scheduled 1-6, creating duplicate queue rows for the same video+time because addToPostorQueue has no uniqueness constraint on (video_path, scheduled_at, platform). Combined with PO-3's lack of overlap guard, duplicate queue rows become duplicate public posts. This weakens trust in the scheduling feature the creator is being asked to use more.
**Fix:** Remove successfully-scheduled placements from schedPlacements as each POST returns ok (not wholesale at the end), so a retry only re-sends the failed ones. Add a server-side idempotency guard in addToPostorQueue: skip insert if an active (non-cancelled) queue row already exists for the same video_path + scheduled_at + identical platforms set. Optionally batch the placements into a single POST so the operation is atomic.

### [LOW] Six dev-only Meta/Instagram token-bypass routes ship in production PostΩr route
**Dimension:** simplification | **Location:** src/routes/postor.js (manual-token, link-instagram, debug-instagram, set-instagram-id, manual-instagram-token; hardcoded '7.kin.jason')
**Problem:** src/routes/postor.js contains a cluster of manual/dev-bypass endpoints: /auth/meta/manual-token, /auth/meta/link-instagram, /auth/meta/debug-instagram, /auth/meta/set-instagram-id, /auth/meta/manual-instagram-token. Several hardcode creator-specific data ('7.kin.jason' account_name in two places) — a direct violation of the CLAUDE.md Engine-vs-Soul rule ('Never hardcode creator-specific data'). /debug-instagram echoes raw page tokens and permission scopes into the JSON response (token-leak surface). These were scaffolding to get past the localhost redirect-URI problem during setup and now bloat the route and present a security/multi-tenancy hazard for the kre8r.app beta.
**Fix:** Gate all five bypass routes behind a NODE_ENV !== 'production' check (or a DEV_TOOLS env flag), and remove the hardcoded '7.kin.jason' literals — derive account_name from the Graph /me response or creator-profile.json via profile-validator.js. Drop or redact token values from /debug-instagram output before beta.

### [MEDIUM] PostΩr uses console.error/console.log instead of the pino logger, against project convention
**Dimension:** improvement | **Location:** src/routes/postor.js (console.log/console.error in youtube callback, meta callback, selectPage, manual-token, link-instagram, prefill, fb-post, sync-analytics, post-queue catch)
**Problem:** CLAUDE.md mandates src/utils/logger.js (pino) for errors and forbids console.error in new code. PostΩr partially adopts log.* (TikTok paths) but still uses raw console.log/console.error throughout: YouTube callback ('[postor] YouTube connected', 'YouTube callback error'), Meta callback/selectPage, manual-token, link-instagram, prefill error, fb-post failure, sync-analytics failure, and the post-queue catch ('[postor/queue] ... failed'). This means platform-post failures the creator cares about (the exact thing that blocks reliable distribution) land in stdout without structured module/event fields, making them invisible to log aggregation and hard to diagnose when a creator reports 'my post didn't go out.' Inconsistent observability directly slows fixing the blockers that keep the creator from using the tool more.
**Fix:** Replace remaining console.* calls with log.info/log.error including {module:'postor', event, platform, err, video_path} structured fields, matching the existing TikTok and post_failed log lines already in the file. Prioritize the post-queue and publish error paths so distribution failures are queryable.

### [LOW] No save-state recovery if PostΩr SSE job is interrupted mid-upload — in-memory jobs Map is volatile
**Dimension:** improvement | **Location:** src/routes/postor.js (in-memory jobs Map, createJob/finishJob); postor_posts rows left in 'posting'
**Problem:** PostΩr's job store is an in-memory Map (createJob/jobs.set). If the server restarts (Electron relaunch, crash) while a multi-platform post is mid-flight, the job and its SSE stream vanish; the postor_posts row is stranded in 'posting' with no resumption or surfaced error. The creator's UI shows a spinner that never resolves, and there is no 'this post is stuck, retry?' affordance. For the immediate-post path this is a Prime-Directive-adjacent gap (the creative action's outcome is lost — did it post or not?). The creator must check each platform manually to find out. This is a smaller risk than the queue double-post (PO-3) but compounds distrust.
**Fix:** On server startup, sweep postor_posts for rows stuck in 'posting' older than a threshold and mark them 'unknown'/'needs_review' with a UI badge prompting the creator to verify on-platform. Persist minimal job state (or rely on the postor_posts row as source of truth) so the history view can show 'interrupted — verify' instead of a silent stall.

### [HIGH] Publish fan-out (idea→produced, Post-Mortem seed) fires only from the queue, never from immediate posts
**Dimension:** inter-tool | **Location:** src/routes/postor.js POST /post (~line 775-789) vs src/postor/queue-processor.js firePublishFanOut (line 163-220)
**Problem:** firePublishFanOut() — which marks the originating SeedΩr idea as 'produced' and seeds a blank post_mortem_briefs row — lives ONLY in src/postor/queue-processor.js (processItem, line 143-149). The immediate-post route POST /api/postor/post in src/routes/postor.js completes the loop differently: it writes postor_posts, writes a posts row for MirrΩr (line 779), and ends. It never calls firePublishFanOut. So any video published immediately (the default, primary path in the UI — the 'Post Now' button) NEVER marks its idea produced and NEVER seeds a Post-Mortem brief. The learning loop and the constellation 'this idea shipped' signal only close when the creator uses scheduled queue posting, which for a full long-form video is the less common path. This silently breaks Active Known Issue #5 (Post-Mortem brief injection) at the source — most posts produce no brief to inject. Violates the Secondary Directive: the creator must now manually remember to create a Post-Mortem, an added decision.
**Fix:** Extract firePublishFanOut into a shared module (e.g. src/postor/fanout.js) and call it from the immediate /post route after finishJob when all platforms succeeded (results all ok), passing { video_path, project_id }. Guard it the same way (non-fatal try/catch). Both the immediate route and the queue processor should converge on one fan-out path.

### [HIGH] ClipsΩr output never reaches the Campaign Builder — viral_clips vs footage shot_type='social-clip' mismatch
**Dimension:** inter-tool | **Location:** src/db.js getUnpackagedClips (line 2825: WHERE f.shot_type='social-clip') vs src/routes/clipsr.js (writes viral_clips, never social-clip footage)
**Problem:** The Campaign Builder clip picker calls db.getUnpackagedClips() (src/db.js line 2817), which selects FROM footage WHERE f.shot_type = 'social-clip'. But ClipsΩr (src/routes/clipsr.js, src/vault/clipsr.js) operates on 'completed-video' footage and writes its results into the viral_clips table as timestamp ranges (hook/caption/hashtags/why_it_works/rank/platform_fit) — it never renders or inserts a physical footage row with shot_type='social-clip'. There is no render/export step in clipsr.js (grep for render/export/insertFootage returns nothing). Result: the Campaign Builder's 'unpackaged social clips' list is structurally fed by a shot_type that ClipsΩr never produces. The two clip systems are disconnected — the AI-identified viral moments from ClipsΩr cannot flow into PostΩr's caption-generation + schedule-board distribution flow. The creator has to manually cut clips elsewhere and re-ingest them as social-clip footage for the Campaign Builder to see them.
**Fix:** Bridge the two: either (a) when a ClipsΩr viral_clip is rendered/exported, insert a footage row with shot_type='social-clip' carrying source project_id, file_path of the rendered clip, and seed description from the viral_clip hook/why_it_works; or (b) extend getUnpackagedClips to UNION viral_clips (rows with a rendered output path) so the Campaign Builder picker surfaces ClipsΩr moments directly. Pre-seed caption_package from the viral_clip.caption/hashtags so the AI caption call has a head start.

### [MEDIUM] MirrΩr bridge (savePost) only fires for YouTube and only on immediate posts
**Dimension:** inter-tool | **Location:** src/routes/postor.js (lines 779, ~908 — youtube-gated) and src/postor/queue-processor.js processItem (no savePost call)
**Problem:** The posts-table bridge that lets MirrΩr see a published video immediately (db.savePost) is gated on platform === 'youtube' in BOTH the immediate route (src/routes/postor.js line 779) and the bulk queue route (line ~908). The 60s queue processor (src/postor/queue-processor.js processItem) does NOT call savePost at all — it only updates postor_queue status and fires the fan-out. So: (1) scheduled posts never write a posts row, meaning a scheduled YouTube video won't appear in MirrΩr until the next analytics sync cycle; and (2) Instagram/Facebook/TikTok posts never write a posts row from any path, so MirrΩr has no cross-platform publish record despite Jason's distribution being 725k-TikTok-weighted. MirrΩr is effectively YouTube-only by virtue of where the bridge was wired, not by design.
**Fix:** Move the savePost bridge into the shared post-success path so it fires for every successfully-posted platform (pass platform, result.post_url, post_id), and add it to queue-processor.js processItem for both scheduled and bulk deliveries. If MirrΩr is intentionally YouTube-only today, document that and have it consume postor_posts (which already records all platforms) rather than the narrower posts table.

### [MEDIUM] Campaign Builder captions are written to footage.caption_package, invisible to CaptionΩr and the prefill endpoint
**Dimension:** inter-tool | **Location:** src/routes/postor.js generate-captions (updateFootageCaptionPackage → footage.caption_package) vs /project/:id/prefill (db.getCaptions → captions table)
**Problem:** The Campaign Builder generate-captions flow (POST /api/postor/campaign/generate-captions) saves AI-generated per-platform captions via db.updateFootageCaptionPackage() into the footage.caption_package column. But PostΩr's own prefill endpoint GET /api/postor/project/:id/prefill reads from the captions table (db.getCaptions) — a different store written by CaptionΩr. The two caption systems never reconcile: a caption generated in the Campaign Builder for a clip is not visible to CaptionΩr, to the prefill auto-fill on the main Post form, or to MailΩr's social distribution. Same conceptual data (platform-native captions) lives in two tables keyed differently (footage_id vs project_id+platform), so the creator can generate captions in one surface and find them missing in another. This is a state-fragmentation risk against the Prime Directive — captions are creative state that can appear lost depending on which screen you open.
**Fix:** Pick one source of truth for captions. Simplest: have the Campaign Builder also upsert into the captions table (keyed by project_id + footage_id + platform) so CaptionΩr, prefill, and MailΩr all see the same data; or have getCaptions fall back to footage.caption_package for project clips. At minimum, surface in the UI that Campaign captions are clip-scoped and separate from project captions.

### [HIGH] Queue processor still has no overlap guard — known issue #2 confirmed in code
**Dimension:** bug | **Location:** src/postor/queue-processor.js start() line 222-245 (setInterval line 243, no running flag)
**Problem:** src/postor/queue-processor.js start() guards double-start with the 'started' flag (line 223) but the setInterval at line 243 has no in-flight guard. run() awaits processItem sequentially for each pending item, but a single slow upload (Instagram Reel polling alone allows up to 3 minutes per meta.js, plus watermarking and a full-file YouTube resumable PUT) easily exceeds the 60s tick. The next interval fires run() concurrently, re-reads db.getPendingQueueItems(), and — because processItem only flips status to 'posting' at its own start (line 50) — a slow item whose status hasn't flipped yet, or a new pending item, gets picked up by two overlapping runs. This is the documented double-fire risk and it is unmitigated. For a creator posting to 725k followers, a duplicate TikTok/IG publish is a real reputational/algorithmic cost and is hard to undo (violates 'how do they get it back?').
**Fix:** Add a module-level 'isRunning' boolean: at the top of run() return early if isRunning is true; set it before the loop and clear it in a finally. Belt-and-suspenders: have getPendingQueueItems exclude status='posting' (it likely already targets 'pending'), and flip each item to 'posting' in the same query/transaction that selects it (claim-then-process) so two overlapping runs cannot claim the same row.

### [LOW] Nav DISTRIBUTION order puts PostΩr after MailΩr/AudiencΩr but the data dependency is CaptionΩr→PostΩr
**Dimension:** workflow-order | **Location:** public/js/nav.js DISTRIBUTION section vs CLAUDE.md pipeline definition
**Problem:** The current nav DISTRIBUTION order is GateΩr → PackageΩr → CaptionΩr → MailΩr → AudiencΩr → PostΩr, but PostΩr's prefill endpoint depends directly on PackageΩr (getSelectedPackage) and CaptionΩr (getCaptions) output, and MailΩr actually calls back INTO PostΩr (POST /api/postor/fb-post for social distribution). PostΩr is positioned last in nav yet is a mid-pipeline dependency for MailΩr's FB cross-post. CLAUDE.md's own ACTUAL PIPELINE lists '...ClipsΩr → PostΩr' as the post-production tail, while the nav buries PostΩr after the audience/email tools. This is a minor ordering/mental-model mismatch, not a data bug, but it means the creator reaches the publish tool after tools that assume publishing already happened (AudiencΩr) or that invoke it (MailΩr).
**Fix:** Consider placing PostΩr immediately after CaptionΩr (its direct upstream) in the DISTRIBUTION nav, before MailΩr/AudiencΩr — matching both the data dependency and the CLAUDE.md ACTUAL PIPELINE. If the current order is intentional (email-first workflow), note it; the MailΩr→PostΩr fb-post callback at least should be documented so the cross-tool dependency is discoverable.

### [HIGH] Three competing posting surfaces (Single / Bulk / Campaign) force a mode decision before any work
**Dimension:** simplification | **Location:** public/postor.html:1341-1344 (mode-switcher), setMode() :2680
**Problem:** The first decision PostΩr forces on Jason is 'which of three modes am I in?' — Single Post, Bulk Queue, or Campaign. They overlap heavily: Single can post-now OR schedule; Bulk Queue posts many at once; Campaign generates captions then ALSO schedules via a drag-drop board. Each mode has its own caption-fill logic, its own platform-toggle renderer (renderBulkToggles vs platform-toggles), and its own progress UI. A creator publishing one finished long-form video and a batch of three shorts must mentally route each task to the right tab. This is a decision PostΩr adds, not reduces (Secondary Directive). The modes exist because they grew separately, not because the creator thinks in those buckets — Jason thinks 'I have N videos, send them out.'
**Fix:** Collapse to a single surface: a list of 'things to post' (1 or many rows), each with a platform multi-select and an optional schedule time. Post-now is just schedule=now. Campaign caption-generation becomes an action ('Generate captions') on rows that lack them, not a separate mode. One flow handles 1 video or 10.

### [HIGH] Pipeline-authored TikTok and YouTube captions are fetched but silently dropped in the single-post form
**Dimension:** inter-tool | **Location:** public/postor.html:2379-2386 (prefillFromProject); compare src/routes/postor.js prefill endpoint which returns captionMap.tiktok
**Problem:** GET /api/postor/project/:id/prefill returns captions for youtube, instagram, facebook AND tiktok. But prefillFromProject() (postor.html:2363) only maps instagram and facebook into form fields. data.captions.tiktok is never assigned anywhere, and there is no dedicated YouTube caption field — YouTube falls back to youtube_description. So the platform-native caption CaptionΩr wrote for TikTok (the creator's BIGGEST platform at 725k) is thrown away, and Jason either posts a generic description to TikTok or re-types the caption by hand. This breaks the pipeline promise that upstream tools already did the work, and it silently loses creative state (Prime Directive) — the caption existed and vanished with no indication.
**Fix:** Map data.captions.tiktok into the TikTok override (there is no TikTok caption field today — add one, or reuse title/description binding) and surface a YouTube caption/description distinction. Show in the prefill notice exactly which platforms got captions so a missing one is visible, not silent.

### [HIGH] Bulk Queue ignores all per-platform captions — every platform gets one shared description
**Dimension:** inter-tool | **Location:** src/routes/postor.js /post-queue (tiktok skip + shared caption fallback); public/postor.html getQueueItems(), addClipToQueue() collapses finalCaps to firstCap
**Problem:** In Bulk Queue, getQueueItems() (frontend) collects only video_path, title, description, scheduled_at. doBulkPost() sends a single shared.description plus an optional per-row description override. There is no ig_caption / fb_description / tiktok caption per row. The /post-queue route confirms this: instagram caption falls back to shared.ig_caption||description, and tiktok is hard-skipped entirely (pushEvent stage:'skip'). So the moment Jason posts in bulk — exactly when platform-native captions matter most across many clips — every platform on every video gets the same blob of text, discarding everything CaptionΩr and the Campaign Builder generated. The Campaign Builder DOES carry per-platform captions, but its 'Add to Queue' path (addClipToQueue) collapses them back to a single description (firstCap), re-flattening the work.
**Fix:** Carry the per-platform caption object end-to-end through the queue (queue row -> /post-queue -> publish). The Campaign Builder already has the captions object; pass it intact instead of flattening to firstCap. Stop hard-skipping TikTok in /post-queue now that TikTok publishing exists.

### [CRITICAL] Queue processor has no overlap guard — a slow upload double-fires the next 60s tick (Prime Directive violation)
**Dimension:** bug | **Location:** src/postor/queue-processor.js start()/run() (setInterval, no in-flight lock)
**Problem:** queue-processor.js runs run() on a 60s setInterval with a 'started' flag that only prevents double-START, not overlapping RUNS. A large BRAW-derived video to YouTube + IG + FB + TikTok routinely takes >60s. When run() is still inside processItem() at the next tick, a second run() begins, re-reads due queue rows, and can pick up the same item before its status flips to 'posting' — publishing the same video twice to the same platform. For a 725k-follower creator a duplicate public post is a real, visible failure and a 'lost the thread' moment with no recovery path (it's already live). This is listed as known issue #2 but is the single highest-severity item: it can cause irreversible public duplicate posts.
**Fix:** Add a module-level isRunning boolean: set true at the top of run(), return immediately if already true, clear in a finally. Belt-and-suspenders: claim each queue row atomically (UPDATE ... SET status='posting' WHERE id=? AND status='pending', check changes===1) before publishing so a concurrent tick can't grab it.

### [HIGH] No 'post this whole project' one-click path despite everything being linked by project_id
**Dimension:** workflow-order | **Location:** src/routes/postor.js prefill + campaign endpoints (all keyed by project_id) but no unified 'publish project' route; public/postor.html requires manual mode-hopping
**Problem:** Every input PostΩr needs is already joined by project_id: the completed video (footage), the package title + YT description, the per-platform captions, and the social clips. Yet the creator must manually: pick the vault video, wait for prefill, eyeball the auto-filled fields, toggle platforms, then (separately) switch to Campaign mode to caption and schedule the clips. The data model supports 'here is project #N — publish the main video to YT/FB/IG and queue the 4 clips to TikTok/IG/Shorts on a cadence' as a single intent, but the UI has no such entry point. This is the core 20-min-vs-2-min gap: the assembly of the post is already done upstream; PostΩr makes the creator re-assemble it by hand across modes.
**Fix:** Add a project-first entry: select a project -> PostΩr shows the main video (pre-captioned, platforms pre-toggled from connected accounts) AND its social clips (pre-captioned via caption_package) in one review list -> one 'Send / Schedule all' action. Default the cadence (e.g. clips staggered across the week) so the creator confirms rather than constructs.

### [MEDIUM] Default platform decisions (privacy, category, schedule, which platforms) are manual every time despite being stable per creator
**Dimension:** improvement | **Location:** public/postor.html:1395-1418 (yt-privacy default public, yt-category default 22); platform-toggles default off
**Problem:** For every single post Jason re-decides: YouTube privacy (defaults 'public' — fine), YouTube category (defaults 22/People & Blogs, but his content is overwhelmingly Howto/homestead — wrong default), tags (empty), and which platforms to toggle on. His posting pattern is highly stable (same 3-4 platforms, same category, same privacy). These are decisions the system could remember from creator-profile.json or his last N posts and pre-apply, leaving him to confirm. Re-picking category/tags/platforms on every video is pure admin friction with no creative value (Secondary Directive: every feature reduces decisions).
**Fix:** Persist last-used (or profile-configured) defaults: pre-check the platforms Jason always uses, default category to his dominant category (Howto/Style 26), and pre-fill recurring tags. Source from creator-profile.json so it stays Engine/Soul-separated, not hardcoded.

### [MEDIUM] No connection-state gating or warning before the creator builds a post for a disconnected platform
**Dimension:** improvement | **Location:** src/routes/postor.js /connections (returns state but UI doesn't pre-flight); meta long-lived token has no refresh path unlike youtube.js refreshToken()
**Problem:** The single-post form lets the creator fill out title, caption, TikTok settings, schedule — then discovers at publish time (or via a per-platform error event) that the platform is not connected, the Meta token expired (60-day long-lived token will silently lapse), or no FB page/IG account is linked. There is no pre-flight that says 'TikTok is connected, YouTube token expires in 3 days, Instagram not linked.' For a creator spending real time here, hitting a wall after composing is a friction spike and a near-miss on losing the thread (the composed caption may be lost on navigation).
**Fix:** Surface a compact connection-health strip at the top of PostΩr: per platform show connected / token-expiring / needs-linking, and disable or warn on toggles for unhealthy platforms before composition. Add a Meta token-expiry check mirroring youtube.getValidToken() so IG/FB don't silently fail mid-post.

### [MEDIUM] Campaign caption flattening and the dev-only OAuth endpoints add cognitive and surface-area clutter
**Dimension:** simplification | **Location:** src/routes/postor.js (manual-token / link-instagram / debug-instagram / set-instagram-id / manual-instagram-token); public/postor.html addClipToQueue() firstCap collapse
**Problem:** The route file carries six overlapping Meta-linking dev bypasses (manual-token, link-instagram, debug-instagram, set-instagram-id, manual-instagram-token, select-page). These were scaffolding to get IG connected and now permanently widen the surface a creator (or future tenant) can stumble into, and they obscure the one real connect path. Separately, the Campaign Builder generates rich per-platform captions but its only handoff to actual posting (addClipToQueue) discards them down to one firstCap — so the most decision-heavy part of the tool produces output the next step can't use, forcing the creator to re-edit in the queue.
**Fix:** Move the dev OAuth bypass endpoints behind an env-gated dev flag (or delete now that OAuth works) so the production posting surface is one clean connect-per-platform flow. Fix addClipToQueue to carry the full caption object so Campaign work survives into the queue (ties to PO-3).
