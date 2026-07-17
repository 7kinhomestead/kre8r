# CutΩr — Architectural Review
*Opus multi-agent audit.*

## Synthesis
This materially changes finding cutor-3. When a WritΩr script is approved (the normal path), `approveWritrScript` *syncs* the text into the legacy `scripts` table at line 4059-4067 with an explicit comment "so SelectsΩr reads it." So `db.getScript(projectId)` in CutΩr **does** return the approved script for any project where WritΩr ran through approval. The finding's claim that "`script` is almost always null" and "off-script gold never fires" is wrong for the normal flow. I have enough to synthesize accurately.

---

# CutΩr Review — Synthesis

## Verification note
I verified all load-bearing claims against the source. **One finding (cutor-3) is materially incorrect** and I've corrected it below — it changes the priority ranking.

## Top 3 by creator impact

**1. CutΩr is 100% non-functional — two independent hard blocks (cutor-1 + cutor-2).**
- **`MODEL` is undefined (cutor-1, confirmed).** `src/vault/cutor.js:335` references `MODEL`, which is declared nowhere in the file. This line runs on *every* analysis, immediately before the Claude call, so `identifyCuts()` throws `ReferenceError: MODEL is not defined` every time and the job dies via `failJob`. Critical, real, one-line fix (delete `model: MODEL` from the progress payload, or define the constant). This is the literal reason "the creator wants to use it but can't."
- **No frontend, no nav entry (cutor-2, confirmed).** `public/cutor.html` does not exist and there is zero `cutor` reference in `public/js/nav.js`. The entire `/api/cutor` backend (start, SSE status, cuts, approve, extract) is unreachable from the UI. Even with the MODEL crash fixed, the creator has no door in.

These two together fully explain non-adoption. Fix both and CutΩr becomes usable. Everything else is quality.

**2. `approveCut` silently ignores the approve/reject flag (cutor-4, confirmed).** `db.approveCut(id)` (`db.js:3216`) takes one parameter and unconditionally sets `approved = 1`. Both the route (`cutor.js:328`) and the off-script path (`:344`) pass a second `approved` argument that is dropped. Sending `{approved:false}` still approves. A reject toggle in the future UI would do the literal opposite of its label — and given the Prime Directive (recovery path), an un-undoable approve is a real trust problem. Cheap fix.

**3. Extraction is frame-inaccurate on the approved boundary (cutor-5, confirmed).** `extractor.js:74-83` uses `-ss` as an *input* option (fast seek) + `-c copy` (stream copy). Stream copy can only cut on keyframes, so the actual clip start snaps to the nearest preceding keyframe — up to a full GOP (often 1–2s on h264 proxies) off the timestamp the creator approved, plus possible frozen frames in the first GOP. For short-form, the approved hook word can get clipped or preceded by garbage. This is the one quality bug that directly damages the creator-facing output, so it ranks above the cleanup items.

## Correction to the findings (important)

**cutor-3 (reads wrong script table) is largely WRONG and should be downgraded from critical to low/informational.** The finding assumes `scripts` is dead and `script` is "almost always null," killing the off-script-gold pass. But `approveWritrScript()` at `db.js:4059-4067` explicitly **syncs the approved WritΩr script text into the legacy `scripts` table** (comment: "so SelectsΩr reads it") on every approval. So `db.getScript(projectId)` — what CutΩr calls — *does* return the approved script for any normally-approved project, and the off-script-gold pass *does* fire. The reviewer missed the sync bridge. The only residual issue: CutΩr reads a denormalized mirror rather than the source of truth, so a script approved through a path that bypasses `approveWritrScript` would be missed. Worth a one-line robustness improvement (fall back to `getApprovedWritrScript`), but it is not a silent dead feature and not critical.

## CutΩr's actual role
Per its own header and prompts, CutΩr is the **cut-planning brain that sits between VaultΩr and the edit**: it takes a transcribed clip + the approved script + the selected package angle, and asks Claude for four things — (1) ranked social clips, (2) retention trims (dead air/filler in the main flow), (3) one CTA placement, and (4) **off-script gold** (moments where Jason went off-script and was more authentic than the written version). Output lands in the `cuts` table for review, then ffmpeg extraction. The off-script-gold pass is its genuinely distinctive, on-brand feature — nothing else in the pipeline does it, and it maps perfectly to the creator's documented "goes off-script — those moments are often better" trait.

## Is it differentiated from ClipsΩr and AssemblΩr?
- **vs AssemblΩr: yes, cleanly.** AssemblΩr (`src/editor/assemblr.js`) is the beat-mapped *selects engine* feeding the main DaVinci edit (coverage_confidence, visual perception, beat briefs). CutΩr is transcript/script-driven cut identification. Different inputs, different outputs. No real overlap.
- **vs ClipsΩr: NO — this is a genuine problem (cutor-7, confirmed).** Both transcribe via the same `transcribeFile()`, both ask Claude to pick short-form TikTok/Reels moments, both extract with ffmpeg. CutΩr writes `cuts`; ClipsΩr writes `clips` and can push to DaVinci. To a solo creator they look like the same tool with no documented division of labor — a direct Secondary-Directive violation ("does this add a decision?"). This overlap, combined with the missing nav entry, means the creator likely doesn't even know CutΩr exists or which to run.

## What would unblock it
**Immediate (makes it work at all):**
1. Fix `MODEL` (cutor-1) — delete the token or define the constant. ~1 min.
2. Build `public/cutor.html` + add a nav entry between VaultΩr and ClipsΩr (cutor-2). The backend contract already exists (start → SSE status → cuts grid → approve → extract).

**Make it trustworthy / correct:**
3. Fix `approveCut` to honor the flag (cutor-4).
4. Re-encode or output-side `-ss` for frame-accurate boundaries (cutor-5).

**Resolve the identity problem (the strategic unblock):**
5. Draw and document one boundary with ClipsΩr — recommend: **CutΩr = full-edit cut planning** (retention trims + CTA + off-script gold + ranked selects that feed the main DaVinci edit) vs **ClipsΩr = standalone social repurposing of finished videos.** Then give CutΩr a DaVinci path (cutor-8: reuse `scripts/davinci/clip-markers.py` to write retention/CTA/off-script as Resolve markers), since the camera workflow is BRAW→DaVinci and CutΩr's analysis is currently stranded as isolated mp4 copies.

**Lower priority:** persist/GC the in-memory job store for restart recovery (cutor-6, Prime-Directive relevant since Whisper on 4K is the longest-running step); surface multi-clip projects instead of silently analyzing `footage[0]` (cutor-10); swap `console.warn` for pino (cutor-9); and replace the hardcoded "7 Kin Homestead / 725K" string in `buildOffScriptPrompt` (cutor.js:117) with `getCreatorContext()` — an Engine-vs-Soul violation the main prompt already gets right (cutor-11).

**Relevant files:** `C:\Users\18054\kre8r\src\vault\cutor.js`, `C:\Users\18054\kre8r\src\routes\cutor.js`, `C:\Users\18054\kre8r\src\vault\extractor.js`, `C:\Users\18054\kre8r\src\db.js` (approveCut:3216, getScript:3242, approveWritrScript sync:4059), `C:\Users\18054\kre8r\public\js\nav.js` (missing entry), `C:\Users\18054\kre8r\public\cutor.html` (missing).

## Full Findings (11 total)
### [CRITICAL] `MODEL` is undefined — ReferenceError crashes every cut analysis
**Dimension:** bug | **Location:** src/vault/cutor.js:335
**Problem:** In src/vault/cutor.js line 335, `onProgress?.({ stage: 'analyzing', model: MODEL })` references a variable `MODEL` that is never declared, imported, or assigned anywhere in the file (the only `MODEL` token in the file is this usage). When identifyCuts() reaches this line — which it does on EVERY run, right before calling Claude — Node throws `ReferenceError: MODEL is not defined`. The throw is caught by the outer try/catch in the route's async pipeline and surfaces as failJob, so the creator sees the job die with 'MODEL is not defined' and no cuts are ever produced. This alone makes CutΩr 100% non-functional and is the most likely literal reason the creator 'wants to use it but can't.'
**Fix:** Either remove `model: MODEL` from the onProgress payload, or define the model constant near the top of cutor.js (e.g. `const MODEL = process.env.CUTOR_MODEL || process.env.ANTHROPIC_MODEL || 'claude-...'`) and pass it through to callClaude/_callClaudeShared so the progress event reports the real model in use.

### [CRITICAL] No frontend (cutor.html) and no nav entry — tool is unreachable in the UI
**Dimension:** bug | **Location:** public/cutor.html (missing); public/js/nav.js (no entry)
**Problem:** The route is mounted at /api/cutor in server.js:618 and a full job/SSE backend exists, but public/cutor.html does not exist in the repo and there is zero reference to 'cutor' or 'CutΩr' in public/js/nav.js. There is no link, button, or page anywhere in the app that lets the creator start a cut job, view identified cuts, approve them, or trigger extraction. The entire CutΩr feature is backend-only — the creator has no door into it. This is a primary blocker to adoption independent of the MODEL bug.
**Fix:** Build public/cutor.html with: a project/footage picker, a 'Start' button hitting POST /api/cutor/start, an SSE progress view on GET /api/cutor/status/:job_id, a cuts review grid from GET /api/cutor/cuts/:project_id with approve toggles (POST /api/cutor/approve/:cut_id), and an Extract button (POST /api/cutor/extract/:project_id). Add a CutΩr nav entry in public/js/nav.js in the POST-PRODUCTION group, positioned between VaultΩr and ClipsΩr to match its pipeline slot.

### [CRITICAL] Reads wrong script table — off-script gold pass and script-aware reasoning never fire
**Dimension:** inter-tool | **Location:** src/vault/cutor.js:285-286 (getScript) vs db.js:3999 (getApprovedWritrScript)
**Problem:** identifyCuts() loads the script via db.getScript(projectId) (src/vault/cutor.js:285), which queries the legacy `scripts` table (db.js:3242-3244). But the live WritΩr pipeline writes approved scripts to the `writr_scripts` table (db.js insert at 3960, approve at 4049), and the correct accessor is getApprovedWritrScript(projectId) (db.js:3999). Because the `scripts` table is effectively unused by WritΩr, `script` is almost always null in CutΩr. Consequences: (1) the off-script gold detector at cutor.js:351-369 is gated on `if (script)` and therefore never runs — a headline CutΩr feature is silently dead; (2) the main cut prompt always uses the 'No approved script — reason from transcript alone' branch, degrading clip selection quality. This is a silent integration break, not a crash.
**Fix:** Replace `const scriptRecord = db.getScript(projectId); const script = scriptRecord?.approved_version || scriptRecord?.full_script || null;` with a read from the WritΩr table, e.g. `const ws = db.getApprovedWritrScript(projectId); const script = ws?.full_script || ws?.approved_version || null;` (confirm the parsed field name from _parseWritrScript). Optionally fall back to getScript() for legacy projects.

### [HIGH] approveCut ignores the `approved` argument — cannot un-approve a cut
**Dimension:** bug | **Location:** src/db.js:3216-3218; called from src/routes/cutor.js approve handler
**Problem:** The route POST /api/cutor/approve/:cut_id computes `approved = req.body.approved !== false` (defaults true, supports passing false to reject) and calls `db.approveCut(cutId, approved)` (src/routes/cutor.js, approve handler). But db.approveCut(id) (db.js:3216-3218) takes only one parameter and unconditionally runs `UPDATE cuts SET approved = 1 ...`. The second argument is silently dropped, so sending {approved:false} still marks the cut approved. A creator can never reject/un-approve a cut once toggled, and any future UI reject button would be a no-op that does the opposite of what it says.
**Fix:** Make approveCut honor the flag: `function approveCut(id, approved = true) { _run('UPDATE cuts SET approved = ?, approved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?', [approved ? 1 : 0, approved ? 1 : 0, id]); }`. Also note off-script-gold/approve route correctly calls approveCut(id, true), which remains compatible.

### [MEDIUM] Fast-seek stream-copy extraction produces inaccurate / unplayable cut boundaries
**Dimension:** bug | **Location:** src/vault/extractor.js:69-89
**Problem:** extractClip() in src/vault/extractor.js:69-89 places `-ss` as an input option (fast seek before -i) combined with `-c copy` (stream copy, no re-encode). With stream copy, ffmpeg can only cut on keyframes, so the actual clip start jumps to the nearest preceding keyframe and the requested decimal timestamp from the transcript is not honored. For social clips this means the hook word the creator approved may be clipped early/late, and the first GOP can show frozen/garbled frames until the next keyframe. The comment claims fast seek is 'accurate enough for speech cuts,' but combined with copy it is frame-inaccurate by up to the GOP length (often 1-2s on BRAW-proxy h264).
**Fix:** For frame-accurate social clips, re-encode the cut (drop -c copy, use libx264 -crf 18 -preset veryfast with -ss as an OUTPUT option after -i for accurate seek), or use the two-pass keyframe+trim approach. If zero re-encode is a hard requirement, at minimum document that boundaries snap to keyframes and surface that to the creator in the UI.

### [MEDIUM] In-memory job store loses all CutΩr jobs on restart and never garbage-collects
**Dimension:** improvement | **Location:** src/routes/cutor.js:42-77
**Problem:** The route keeps jobs in a module-level `Map` (src/routes/cutor.js:42). Jobs are never deleted, so a long-running Electron session leaks memory for every analysis/extraction run. More importantly for the Prime Directive ('never lose creative state'): if the Electron app or server restarts mid-transcription (Whisper on a 4K clip can take many minutes), the job_id 404s on reconnect and the SSE stream is gone — the creator loses visibility into in-flight work with no recovery path. ClipsΩr shares this same pattern but CutΩr's transcription step is the longest-running in the app.
**Fix:** Add a TTL cleanup (delete finished jobs after N minutes, as AnimΩr does) to stop the leak. For recovery, persist job status keyed by footage_id/project_id (or reuse the transcribe-queue) so a reconnecting client can re-attach or see the last known stage after a restart.

### [MEDIUM] CutΩr and ClipsΩr overlap heavily — unclear which the creator should use for social clips
**Dimension:** workflow-order | **Location:** src/vault/cutor.js vs src/routes/clipsr.js / src/vault/clipsr.js
**Problem:** Both CutΩr (src/vault/cutor.js) and ClipsΩr (src/routes/clipsr.js + src/vault/clipsr.js) transcribe footage via the same transcribeFile() and then ask Claude to pick short-form social clips, then extract with ffmpeg. CutΩr writes to the `cuts` table; ClipsΩr writes to a separate `clips` table and can push to DaVinci (requires('./davinci')). For a solo creator this is two tools that appear to do the same job (identify TikTok/Reels moments) with no documented division of labor — violating the Secondary Directive ('does this add a decision?'). The creator may not know CutΩr exists or which one to run, compounding the adoption problem.
**Fix:** Decide and document one clear boundary: e.g. CutΩr = full-edit cut planning (retention trims + CTA + off-script gold + ranked selects feeding the main DaVinci edit), ClipsΩr = standalone social repurposing of finished videos. Then either merge the social-clip identification into one engine or make each tool's nav label/description state its distinct job so the creator never has to choose blind.

### [MEDIUM] CutΩr does not integrate with DaVinci despite sitting in the edit-planning slot
**Dimension:** bug | **Location:** src/vault/extractor.js (no DaVinci); compare src/routes/clipsr.js:23
**Problem:** ClipsΩr imports and uses the DaVinci scripting bridge (require('./davinci'), src/routes/clipsr.js:23) to push clips into Resolve, and the project's camera workflow is BRAW -> DaVinci proxy. CutΩr produces retention cuts, a CTA marker, and ranked selects — exactly the data that would be most valuable as Resolve timeline markers / a rough-cut timeline — but extractor.js only ffmpeg-copies isolated clip files to public/clips and has no DaVinci path at all. The creator editing in Resolve gets no benefit from CutΩr's retention/CTA analysis; they'd have to manually transcribe CutΩr's timestamps back into the timeline.
**Fix:** Add an optional 'send to DaVinci' action that writes CutΩr's retention cuts and CTA timestamp as Resolve timeline markers (reuse scripts/davinci/clip-markers.py, already in the repo) and/or assembles approved social selects onto a timeline — turning CutΩr's analysis into something the creator can act on inside their actual edit environment.

### [LOW] console.warn used for off-script-gold failure instead of pino logger
**Dimension:** improvement | **Location:** src/vault/cutor.js:366
**Problem:** src/vault/cutor.js:366 uses `console.warn('[CutΩr] Off-script gold pass failed:', e.message)`. CLAUDE.md coding conventions mandate src/utils/logger.js (pino) for all error/warn logging in new code and prohibit console.* — this line violates that and the failure won't appear in structured logs the rest of the app uses.
**Fix:** Import the pino logger and replace with `logger.warn({ err: e, projectId }, 'CutΩr off-script gold pass failed')`.

### [LOW] start endpoint silently analyzes only the first footage item, hiding multi-clip projects
**Dimension:** improvement | **Location:** src/routes/cutor.js start handler; src/vault/cutor.js:306-322
**Problem:** In POST /api/cutor/start, when no footage_id is supplied the route does `targetFootage = all[0]` (src/routes/cutor.js) and identifyCuts() similarly grabs `withTranscript[0]`. A homestead shoot day typically produces many clips per project; CutΩr silently analyzes just the first and ignores the rest, with no indication to the creator that other footage was skipped. The creator may conclude CutΩr 'missed' most of their best moments.
**Fix:** Either return the list of all transcribed footage so the UI can let the creator pick (and show how many clips exist), or loop CutΩr over every transcribed footage item in the project and aggregate cuts. At minimum, emit a progress event noting 'analyzing 1 of N clips' so the limitation is visible.

### [LOW] Duplicated transcript-to-text and footageMeta construction
**Dimension:** simplification | **Location:** src/vault/cutor.js:41-43, 113-115, 300-321
**Problem:** buildPrompt() and buildOffScriptPrompt() each independently rebuild the `transcript.segments.map(...).join('\n')` text block (cutor.js:41-43 and 113-115), and identifyCuts() duplicates the full footageMeta object construction in both the footage_id and no-footage_id branches (cutor.js:300-305 and 316-321). This is needless duplication that has already drifted (the off-script prompt also hardcodes '7 Kin Homestead / 725K' instead of using getCreatorContext(), violating Engine-vs-Soul).
**Fix:** Extract a `transcriptToText(transcript)` helper and a `buildFootageMeta(rec)` helper, and replace the hardcoded creator string in buildOffScriptPrompt with getCreatorContext() values to keep the Soul out of the Engine.
