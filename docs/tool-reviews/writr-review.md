# WritΩr — Architectural Review
*Opus multi-agent audit. Four dimensions: bugs · improvements · inter-tool · simplification.*

## Synthesis
All key claims verified against source. The `finishJob(job, ...)` calls at lines 537/568 confirm `job` is referenced inside the `/generate` SSE handler that uses `startSseResponse` (line 506) — there is no `job` in scope, confirming writr-1. The `_parseWritrScript` raw parses (writr-2), positional `callClaude(prompt, 4096)` (writr-4), no mode guard in `getApprovedWritrScript`/`approveWritrScript` (WRITR-IT-2) all confirmed.

I have enough to produce the synthesis.

---

# WritΩr Architectural Review — Synthesized

Four Opus reviewers, 30 raw findings, deduplicated to **20 distinct issues**. Verified the top claims against source (file/line confirmed for writr-1, -2, -4, WRITR-IT-2). Two finding-clusters dominate: a **silent data-loss chain** in the approval/save path, and a **fork-in-the-road decision overload** between the quick-generate and storyboard pipelines.

---

## DEDUPLICATION MAP

Merged clusters (kept the most complete version, noted corroboration):

- **Format-variant cost** — `writr-008` ≡ `W4`. Kept `writr-008` (clearer fix path), corroborated by W4 (downstream-consumer evidence).
- **Approve-wrong-format / mode guard** — `WRITR-IT-2` (full file:line evidence) is the bug; `W3` is its UX framing. Kept both but linked: IT-2 = the data-integrity bug, W3 = the missing "lock & send" completion action. They are one problem at two altitudes.
- **Two parallel paths** — `writr-001` ≡ `W1` ≡ (UX half of) `W2`. Kept `W1` (most precise file:line on the `— or —` fork) as primary, `writr-001` as the architectural recommendation.
- **Storyboard bypasses intelligence injections** — `writr-004` ≡ `WRITR-IT-3`, with `writr-002` (REALITY_RULE/SLOP_RULE) and `writr-009` (duplicated fallback ladder) as the same root cause. Merged into one finding with the shared-helper fix.
- **Mode redundancy** — `writr-011` ≡ `W2` (vault_first phantom). Kept `writr-011` (covers script_first+vault_first), W2 corroborates the phantom backend branch.
- **Iterate drops context** — `writr-006` stands alone, related to the 004/IT-3 cluster (same fix family: shared context builder).

---

## PRIORITIZED FINDINGS

### CRITICAL
*(none rated critical by reviewers; the two below are high-severity but functionally critical — they silently destroy or corrupt the approved creative artifact, the exact Prime Directive violation)*

---

### HIGH

**H1 — `finishJob(job)` ReferenceError on every paste-in generation** `(writr-1)`
`src/routes/writr.js:537` and `:568`. **Verified:** the `/generate` handler streams via `startSseResponse()` (line 506) and never creates a `job`. Both `finishJob(job, …)` calls throw `ReferenceError: job is not defined`. On success the `complete` event is written first (line 559) so the script saves, but the throw fires a spurious second `{stage:'error'}`; on the `!result.ok` path (line 537) it's a double error event.
**Fix:** delete both `finishJob(job, …)` calls. Failure path → `write({stage:'error'}); return end();`. Success path → after the `complete` write, `end(); return;`.

**H2 — Bullets/hybrid variant can become the approved script** `(WRITR-IT-2, framed by W3)`
`public/writr.html:1527-1535` (onApprove posts `currentScript.id`), `src/db.js:4029` (approveWritrScript, no mode guard), `src/db.js:3991` (**verified:** getApprovedWritrScript selects `approved=1` with no mode filter). If the creator is on the Bullets/Hybrid tab at approval, 3-5 word memory triggers become the source of truth for AssemblΩr, MailΩr, PostΩr, BrΩllr, teleprompter. Silent, no recovery prompt.
**Fix:** in `onApprove()` resolve `currentScripts.full?.id` not the active tab; OR in `approveWritrScript`, if `row.mode !== 'full'` look up the same-`session_id` full row and approve that. Bullets/hybrid are views, never source of truth.

**H3 — `_parseWritrScript` raw `JSON.parse` 500s ALL script reads for a project** `(writr-2)`
`src/db.js:3999-4008`. **Verified:** four unguarded `JSON.parse` (beat_map_json/hook_variations/anchor_moment/missing_beats). One corrupt/truncated row throws, propagating through `GET /:project_id/config` and `/scripts` as a 500 — the creator loses access to every good draft in that project. Script text is intact but unreachable.
**Fix:** `const safe=(s,d)=>{try{return s?JSON.parse(s):d}catch{return d}}`. The codebase already does exactly this at db.js:6108 — apply the same pattern here.

**H4 — Room /approve saves approved script with empty `beat_map_json`** `(writr-3, +writr-010 extraction bug, +writr-11 normalization)`
`POST /:project_id/room/approve`. Inserts from `script_text` with `beat_map_json=null`, then flips `writr_complete=1`. Downstream (assemblr.js, teleprompter.js, shootday.js) read `beat_map_json` to align footage — they get nothing and silently degrade. Compounded by `writr-010`: `extractScriptFromRoom()` (writr.html) picks "longest message containing BEAT", which can lock a *critique about* the script as the script.
**Fix:** parse `[● BEAT: name]` markers out of `script_text` into a minimal beat_map before insert (or copy from prior active script); require an explicit fenced SCRIPT block / creator selection instead of the length heuristic; validate ≥2 beat markers before allowing approve.

**H5 — Storyboard pipeline bypasses ALL upstream intelligence + anti-fabrication guardrails** `(writr-004 ≡ WRITR-IT-3, +writr-002, +writr-009)`
`/storyboard`, `/beat/write`, `/assemble` build prompts from `buildWritrPromptContext` + raw fallbacks only. They inject NONE of what `/generate` injects: VectΩr brief, VisualΩr, MirrΩr calibration, short-form constraints, TikTok clip-planting, the 190-transcript `loadVoiceCalibrationBlock()`, and — critically (`writr-002`) — **REALITY_RULE and SLOP_RULE are absent**. The richer, id8r-gated path that produces the *most strategic* scripts is the *least* protected against fabrication and gets *less* context than quick-generate. Root cause is `writr-009`: the id8rBlock fallback ladder is copy-pasted 3× and has drifted.
**Fix:** extract `buildFullWritrContext(projectId, {format})` (VectΩr + VisualΩr + Post-Mortem + short-form + TikTok + voice calibration + REALITY_RULE + SLOP_RULE) and call it from `/generate` AND all three storyboard handlers. Single highest-leverage consistency fix.

**H6 — Two co-equal generation paths forked by `— or —` with no guidance** `(W1 ≡ writr-001)`
`public/writr.html:511-541` (storyboardPipelineGroup / storyboardDivider / quickScriptLabel), `showStoryboardPipeline() ~2838`. When a project has Id8Ωr data (the normal case), the creator sees the full Storyboard pipeline AND the Generate button, separated by a literal `— or —`, with nothing explaining the tradeoff. This is a meta-decision ("which generator?") *before* any real work — the single largest Secondary-Directive violation in the tool.
**Fix:** make Generate the always-default "just write the script" primary. Demote storyboard to a collapsed "Build it beat-by-beat instead" affordance that expands on click. Remove the symmetric fork.

**H7 — Post-Mortem brief never injected into WritΩr** `(WRITR-IT-1, = CLAUDE.md known issue #5)`
`src/routes/writr.js` generate route injects VectΩr `getActiveBrief()` but never `getActivePostMortemBrief()` (`src/db.js:6148-6173`). `project-context-builder.js` has zero post-mortem references. The analytics→ideation learning loop is broken at the script stage — the next script can't learn from the last video's real performance.
**Fix:** right after the VectΩr brief block, add a parallel `getActivePostMortemBrief()` block (`root_cause`, `adjustments`, `avoid`) with the same "shape tone, never override the stated concept" guard. Mirror into `buildRoomSystemPrompt()`.

**H8 — Three overlapping voice blocks injected into one prompt** `(writr-003, related W6)`
Each generate injects voice 3×: `loadVoiceCalibrationBlock()` ("highest priority"), `buildVoiceSummary()` (profile defaults or weighted library), and the `soul_profiles` voice fields in `buildWritrPromptContext()`. Three distillations of the same voice with divergent "signature phrases" / "never says" lists and contradictory priority signals. Token bloat + mixed signals.
**Fix:** single voice authority — when library profiles are explicitly selected, suppress calibration (user override); otherwise calibration is the sole source and drop soul_profiles voice fields. (`W6`: hide the primary/secondary/blend selector unless `getProjectCollaborators().length > 1`.)

---

### MEDIUM

**M1 — Generate route saves 3 rows + vault `.txt` with crash-recovery ordered LAST** `(writr-5)`
The vault `.txt` (the recovery net) is written *after* the three `insertWritrScript` calls. If the first insert throws (WAL lock, disk full), the outer catch fires and the expensive Claude result is gone — the recovery save never runs.
**Fix:** move the vault `.txt` save to *before* the DB inserts; on insert failure still surface script text to the client.

**M2 — `generateFormatVariants` silently substitutes the full script on failure** `(writr-7)`
`.catch` handlers write a `tab_complete` with `script: fullScript`, persisting full text under `mode='bullets'`/`'hybrid'`, marked "loaded". Creator opens Bullets and silently sees the full script — wrong-format output presented as correct.
**Fix:** on conversion failure, skip saving that mode (leave tab in retry state) rather than persisting full text under the wrong mode.

**M3 — Format variants are 2 extra eager Claude calls per generate** `(writr-008 ≡ W4)`
`generateFormatVariants()` fires bullets+hybrid on *every* generate before the creator decides to keep the draft. For multi-iteration sessions that's 2 wasted paid calls per discarded draft, plus latency on the critical "see my draft" moment, plus a forced 3-tab decision. Downstream consumers only read `full`.
**Fix:** generate only `full`; produce bullets/hybrid lazily on tab-click or at lock time. The tab UI already supports a loading state.

**M4 — Config writes have no concurrency guard (lost updates)** `(writr-8)`
`/beat/write`, `/storyboard` PATCH, `/assemble` each do `readConfig()→mutate→writeConfig()` on `project-config.json`. Concurrent "Write This Beat" clicks + debounced storyboard PATCH → second write clobbers the first. A freshly written beat or storyboard edit silently lost.
**Fix:** per-project in-process write mutex/queue, or merge only changed keys instead of rewriting the whole config.

**M5 — Iterate engine drops nearly all upstream context** `(writr-6 + writr-006)`
`src/writr/iterate.js buildPrompt` receives only voiceSummary + voiceCalBlock + story_structure + brand. No id8rBlock (concept/talking points/guardrails), no VectΩr, no VisualΩr, no footage. Revisions drift off-strategy and can reintroduce a banned angle. Also: `/iterate` falls back to `beat_map:[]` when Claude truncates (losing beat structure across iterations) and never sets `active_script_id` to the new row.
**Fix:** pass id8rBlock + VectΩr/short-form into `iterateScript` (reuse the shared context builder from H5); on empty `result.beat_map` fall back to `existing.beat_map_json`; set `active_script_id` to the new iteration id.

**M6 — `paste-in` calls `callClaude(prompt, 4096)` — positional arg ignored** `(writr-4)`
`src/writr/paste-in.js:82`. **Verified.** `callClaude(prompt, { maxTokens, raw })` — passing a Number destructures to all-undefined, so maxTokens defaults to 16384 and the 4096 cap is silently ignored.
**Fix:** `callClaude(prompt, { maxTokens: 4096 })`. Audit other callers for the same confusion.

**M7 — shoot_first/hybrid send transcripts but ignore VaultΩr `visual_description`** `(writr-7/IT-issue)`
`summariseTranscripts()` uses words only (transcript/shot_type/subject). VaultΩr's frame-analysis `visual_description` + peak-energy/b-roll-anchor signals — which AssemblΩr explicitly uses — never reach the story-finder. WritΩr picks the anchor_moment from words while the downstream selects engine sees words+vision; the anchor may not be the visually strongest moment.
**Fix:** include `visual_description` (+ peak-energy flag) in each per-clip block for shoot_first/hybrid/vault_first.

**M8 — shoot_first `footage_id`/`anchor_moment` links not persisted for EditΩr** `(WRITR-IT-4)`
shoot_first maps real moments to beats with per-beat `footage_id` + an anchor `footage_id`, but the route saves only `beat_map` into `beat_map_json` and doesn't persist `anchor_moment` or surface the footage_id mapping in a form EditΩr reads. AssemblΩr re-derives selects from scratch; WritΩr's footage→beat linkage is discarded between tools.
**Fix:** confirm `footage_id`/`real_moment` survive end-to-end; have AssemblΩr seed beat-to-clip alignment from WritΩr's assignments as a prior; persist `anchor_moment` to the selects record.

---

### LOW

- **L1 — SSE generate has no overlap guard** `(writr-9)`. Frontend auto-retry can re-POST `/generate` mid-completion → double-inserts a full/bullets/hybrid triplet, racing on active_script_id. *Fix:* per-project in-flight lock + disable re-submit until stream settles.
- **L2 — paste_in `session_id: null` collides in sibling-tab lookup** `(writr-10)`. `loadSiblingTabs` filters by session_id; null matches other null-session rows from old generations, loading unrelated scripts into tabs. *Fix:* assign paste_in a unique session_id; hide bullets/hybrid tabs for paste_in.
- **L3 — Redundant/phantom modes** `(writr-11 ≡ W2)`. `vault_first` is a backend branch with no clean frontend trigger (phantom); `script_first` overlaps `paste_in`; `hybrid` rarely beats shoot_first+pasted concept. *Fix:* merge vault_first into shoot_first (auto-include vault clips), fold script_first into paste_in with a "tidy it up" toggle, or remove the unreachable branch.
- **L4 — No write-back of `missing_beats`/`[BEAT NEEDED]` to PipΩr/DirectΩr/ShootDay** `(WRITR-IT-5, W5)`. Gaps are saved on the script row but the creator must manually re-translate them into a re-shoot plan. *Fix:* write `missing_beats`/`coverage_description` into `config.coverage_gaps` so the production plan surfaces them as shot-list items.
- **L5 — hook_variations generated then discarded** `(writr-5/005)`. 3 hook variants are generated/saved but never surfaced as a picker; hooks (the highest-leverage element for a 725k creator) are the least surfaced. *Fix:* render hook_variations as a one-click beat-1 swap, seeded from Id8Ωr's chosen hook.
- **L6 — No "why this script looks like this" rationale card** `(writr-012, W5)`. `story_found`/`anchor_moment`/`missing_beats` exist in the complete event but aren't shown as a persistent rationale, so creators fire vague prose-level revisions instead of correcting the premise once. *Fix:* render a dismissible "Story decisions" card above the script.
- **L7 — Manual transcript-load gate is redundant** `(W5)`. `/generate` already calls `getAllFootage` internally; the manual "Load Footage Transcripts" button only feeds the textarea preview. *Fix:* auto-load on shoot_first open; make it a passive preview, not a gate.

---

## TOP 3 BY CREATOR IMPACT

1. **H2 — Approving a Bullets/Hybrid tab silently locks 3-word memory triggers as the canonical script.** Every downstream tool (selects, mail, captions, teleprompter) then receives fragments instead of prose, with no warning and no recovery prompt. This is the cleanest Prime-Directive violation: the creative artifact is silently corrupted at the exact handoff moment. One-line fix (`approve the full sibling`), enormous blast radius.

2. **H6 + H5 — The storyboard/quick-generate fork forces a meta-decision, and the path most creators are nudged toward (storyboard, id8r-gated) is the one stripped of voice calibration, strategic briefs, AND the anti-fabrication guardrails.** A creator using the "richer" path gets a less on-voice, less on-strategy, and *fabrication-prone* script — the opposite of the intent. Fixing both (one default path + one shared context builder) simultaneously kills the worst decision-load violation and the worst consistency gap.

3. **H3 + H1 — Latent crashes that destroy reach to creative state.** One malformed JSON cell 500s *every* script in a project (H3); paste-in throws a ReferenceError on every run (H1). Both are small fixes already patterned elsewhere in the codebase, and both directly break "never lose the thread."

---

## VERDICT

**Is the 5-mode structure right?** The *modes* are not the problem — `script_first`/`shoot_first`/`hybrid` are auto-detected from PipΩr's `entry_point`, so the creator never names them (correct decision-reduction). The real problems are: (a) **two co-equal generation *machines*** (quick-generate vs storyboard) forked with no guidance — that's the decision overload, not the mode count; (b) **mode sprawl at the edges** — `vault_first` is a phantom (backend branch, no clean frontend trigger), `script_first` overlaps `paste_in`, `hybrid` rarely earns its 3-call cost. So: collapse 6 generate-branches to **4 real verbs** — *shoot_first* (auto-includes vault clips), *paste_in* (with a "tidy it up" toggle absorbing script_first), *storyboard*, *iterate* — and present them as one implicit question ("what raw material do you have?"), never a named mode.

**Minimum viable path to a script** (the directive: *the script must be DONE before the camera comes up, with the fewest decisions*):

> **One "Write the script" button → draft appears (full only, lazy variants) → optional "Revise" → one "Lock & Send to Teleprompter" action.**

Concretely:
1. **Generate is the always-default** primary action; storyboard collapses to a power-user "build it beat-by-beat" disclosure (H6).
2. **Generate `full` only**; bullets/hybrid produced lazily at tab-click or lock time (M3) — removes 2 Claude calls and a 3-way decision from the happy path.
3. **All paths share one `buildFullWritrContext()`** so quick and storyboard see identical intelligence + guardrails (H5), and iterate stops drifting (M5).
4. **Approval = one "Lock & Send to Teleprompter"** that always locks the `full` sibling, records the chosen format as a property of the locked script, marks `writr_complete`, and confirms "On your phone now" (H2 + W3) — collapsing "which format? did I approve? is it on my phone?" into a single decisive action.

That sequence is **two required clicks** (Write → Lock) with everything else as optional progressive disclosure. The current happy path requires the creator to first choose a *generator*, then reconcile *three format tabs* against a *separate approve step* — three decisions the directive says should already be resolved by the time the camera comes up.

**Sequencing recommendation:** ship the safety/data-loss fixes first (H1, H2, H3, H4, M1 — small, verified, high blast-radius), then the consistency refactor (H5/H7/H8 shared context builder, which also unblocks M5), then the UX collapse (H6 + W3 + M3). The shared-context-builder refactor (H5) is the keystone — it resolves the single largest cluster (writr-002/004/006/009 + IT-1/IT-3) in one move.

## Full Findings (34 total)
### [HIGH] finishJob(job) references undefined `job` in /generate paste-in branch — ReferenceError
**Dimension:** bug | **Location:** src/routes/writr.js ~lines 537 and 568 (inside router.post('/generate'), paste_in branch)
**Problem:** The POST /api/writr/generate handler streams directly via startSseResponse() and never calls createJob(), so no `job` variable exists in its scope. The paste_in branch calls finishJob(job, null) (line ~537) and finishJob(job, { script_id: pasteId }) (line ~568). `job` is undefined there, so finishJob throws `ReferenceError: job is not defined`. On the success path the 'complete' SSE event (with script_id) is written BEFORE finishJob throws, so the script is saved and the client usually settles on 'complete' first — but the throw still fires the outer catch, emitting a spurious second {stage:'error'} event. On the result.ok===false early-return path it produces a double error event. It is a latent crash on every paste-in generation and should be removed/replaced with end().
**Fix:** Remove the finishJob(job, ...) calls in the paste_in branch and use the streaming `end()` instead. On the failure path: write({stage:'error',...}); return end(). On success: after the 'complete' write, call end(); return. Do not reference `job` — this handler has no job object.

### [HIGH] _parseWritrScript does raw JSON.parse with no try/catch — one corrupt row 500s all script reads
**Dimension:** bug | **Location:** src/db.js lines 3999-4009 (_parseWritrScript), consumed by getWritrScriptsByProject/getWritrScript
**Problem:** _parseWritrScript() in db.js unconditionally JSON.parse()es beat_map_json, hook_variations, anchor_moment, and missing_beats with no error handling. getWritrScriptsByProject() maps every project row through this. If any single writr_scripts row has malformed JSON in one of these columns (e.g. a truncated/partial write, or legacy data), the parse throws, which propagates up through GET /:project_id/config and GET /:project_id/scripts, returning a 500. The creator then cannot load ANY script for that project — including good drafts — violating the prime directive (never lose creative state). The generated_script text itself is intact in the DB but becomes unreachable through the UI.
**Fix:** Wrap each JSON.parse in a safe helper that returns null (or [] for arrays) on parse failure, e.g. const safe=(s,d)=>{try{return s?JSON.parse(s):d}catch{return d}}. This keeps the script text reachable even when metadata columns are corrupt.

### [HIGH] Room /approve saves approved script with empty beat_map_json — breaks downstream AssemblΩr/Teleprompter/ShootDay
**Dimension:** bug | **Location:** src/routes/writr.js router.post('/:project_id/room/approve'); consumers src/editor/assemblr.js, src/routes/teleprompter.js, src/routes/shootday.js
**Problem:** POST /:project_id/room/approve inserts a new writr_scripts row from script_text with no beat_map_json field, then calls approveWritrScript() marking it the active approved script. Downstream consumers (assemblr.js, teleprompter.js, shootday.js, lab.js) read getApprovedWritrScript().beat_map_json to align footage to beats. Because the room-approved script has beat_map_json=null, the beat-mapped selects engine and teleprompter beat display get no structure — silently degrading those tools with no warning to the creator. The room-revised text often still contains [● BEAT: ...] markers that could be parsed into a beat map but aren't.
**Fix:** Before inserting, parse [● BEAT: name] markers out of script_text into a minimal beat_map_json array (or copy beat_map_json from the project's prior active script), so approved room scripts carry beat structure downstream.

### [MEDIUM] paste-in calls callClaude(prompt, 4096) but second arg must be an options object — maxTokens silently ignored
**Dimension:** bug | **Location:** src/writr/paste-in.js line 82
**Problem:** src/writr/claude.js defines callClaude(prompt, { systemPrompt, maxTokens, raw } = {}). paste-in.js line 82 calls callClaude(prompt, 4096). Destructuring a Number yields undefined for all properties, so maxTokens defaults to 16384 and raw stays false. Not a crash, but the intended 4096 cap is silently ignored and the call parses JSON (raw=false) as expected only by luck. Indicates the author believed in a positional maxTokens API that doesn't exist for this module.
**Fix:** Change to callClaude(prompt, { maxTokens: 4096 }). Audit other callers for the same positional-vs-object confusion.

### [MEDIUM] Generate route saves 3 script rows sequentially with no try/catch — a mid-save DB failure loses the generated script
**Dimension:** bug | **Location:** src/routes/writr.js /generate — the three insertWritrScript calls and the vault.saveVaultData block that follows
**Problem:** In /generate, after generation succeeds the route does fullId=insertWritrScript(...full...); bulletsId=insertWritrScript(...bullets...); hybridId=insertWritrScript(...hybrid...); updateProjectWritr(...). These DB writes are not wrapped in their own try (they sit in the big outer try). The 'complete' SSE event with script_ids is sent AFTER all three inserts. If insertWritrScript throws on the first (full) row — e.g. WAL lock, disk full — the outer catch fires write({stage:'error'}) and the creator loses the entire just-generated script with no recovery beyond the best-effort vault .txt (which is saved AFTER the inserts, so it never runs either). The expensive Claude generation result is gone. The vault save (crash-recovery net) is ordered after the DB inserts, so it does not protect against insert failure.
**Fix:** Move the vault .txt save (crash-recovery) to BEFORE the DB inserts so the script text is always persisted to disk even if the DB write fails. Wrap the inserts so a failure still surfaces the script text to the client for manual recovery.

### [MEDIUM] iterate creates a NEW script row but never carries beat_map forward when Claude omits it — and never updates active_script_id
**Dimension:** bug | **Location:** src/routes/writr.js router.post('/iterate'); src/writr/claude.js JSON-recovery fallback (beat_map:[])
**Problem:** POST /iterate inserts a new writr_scripts row using result.beat_map (from the iterate Claude call). The iterate prompt asks Claude to return beat_map, but if the response is truncated the claude.js fallback returns beat_map:[] (script recovered, beats lost). The new iteration row then has an empty beat map even though the prior draft had a full one — losing beat structure across iterations. Separately, /iterate does NOT call updateProjectWritr({active_script_id:newId}), so project.active_script_id still points at the pre-iteration draft; the config endpoint's 'active' resolution can surface the older script as active after an iteration.
**Fix:** When result.beat_map is empty, fall back to existing.beat_map_json so beat structure persists across iterations. Consider setting active_script_id to the new iteration id (matching generate/assemble behavior) so the freshest draft is the active one.

### [MEDIUM] generateFormatVariants swallows bullets/hybrid failures and silently substitutes the full script — creator can't tell tabs failed
**Dimension:** bug | **Location:** src/routes/writr.js generateFormatVariants() .catch blocks (bullets and hybrid)
**Problem:** In the route, generateFormatVariants() .catch handlers write a tab_complete event with script: fullScript and an error field, then resolve to fullScript. The DB then stores the FULL script text under mode='bullets' and mode='hybrid'. The frontend setTabState marks the tab 'loaded' and switchTab renders it normally. The creator opens the Bullets tab and silently sees the full script (or duplicate of Full), with no indication the bullets conversion failed. This is a silent failure that produces wrong-format output presented as correct.
**Fix:** On format-conversion failure, either skip saving that mode (leave the tab in an error/retry state) or set the tab to a visibly failed state in the frontend, rather than persisting the full script under the bullets/hybrid mode and marking it loaded.

### [MEDIUM] Storyboard/beat-write/assemble persist scripts and beat_scripts into project-config.json via read-modify-write with no concurrency guard — lost updates
**Dimension:** bug | **Location:** src/routes/writr.js /:project_id/beat/write, /:project_id/storyboard (PATCH), /:project_id/assemble — all do readConfig()+writeConfig() on project-config.json
**Problem:** writeBeat saves config.beat_scripts[i] by readConfig()->mutate->writeConfig(). writeAllBeats calls writeBeat sequentially (awaited, OK), but the frontend allows clicking individual 'Write This Beat' buttons concurrently, and saveSbEdit PATCHes the whole storyboard on a debounce timer in parallel. Each path does its own readConfig/writeConfig on the same project-config.json. Two overlapping writes (e.g. a beat-write completing while a storyboard PATCH fires) read the same base config and the second writeConfig clobbers the first's changes — a freshly written beat script or a storyboard edit can be silently lost. No locking or atomic merge exists.
**Fix:** Serialize config writes per project (in-process mutex/queue) or merge only the specific keys being changed rather than rewriting the whole config object, to prevent read-modify-write lost updates.

### [LOW] SSE generate has no overlap guard — a re-fired generate while one is running double-inserts scripts
**Dimension:** bug | **Location:** src/routes/writr.js /generate (no in-flight guard); public/js writr streamWritr retry logic
**Problem:** streamWritr in the frontend auto-retries on chunk/network errors (streamWritr._retrying is a single shared flag, not per-call). If a generation is slow and the connection blips, a retry POSTs /generate again while the original may still be completing server-side. There is no server-side idempotency or in-flight guard per project, so two concurrent generations can each insert a full/bullets/hybrid triplet and each call updateProjectWritr(active_script_id), racing on which becomes active. Wasted Claude spend and duplicate drafts.
**Fix:** Add a per-project in-flight lock for generate (reject or no-op a second concurrent generate), and/or make the frontend disable re-submit until the stream settles instead of blind-retrying.

### [LOW] Generate 'complete' event omits beat_map for paste_in; frontend loadSiblingTabs depends on session_id that paste_in sets to null
**Dimension:** bug | **Location:** src/routes/writr.js paste_in branch (session_id:null); public/js loadSiblingTabs filter on session_id
**Problem:** The paste_in branch saves a single row with session_id: null and emits stage:'complete' with mode:'full'. The frontend's three-tab flow (loadSiblingTabs) filters scripts by session_id===session_id; with a null session_id the sibling lookup can match other null-session rows from older generations, potentially loading an unrelated script into a tab. paste_in also never generates bullets/hybrid, so those tabs stay empty while the UI may still show them.
**Fix:** Assign a unique session_id to the paste_in row (like generate does) so sibling-tab filtering can't collide with other null-session rows, and explicitly hide bullets/hybrid tabs for paste_in mode.

### [MEDIUM] approveWritrScript sets writr_complete=1 but unapprove only best-effort clears it; room/approve + assemble bypass beat_map producing downstream-blind 'complete' state
**Dimension:** inter-tool | **Location:** src/db.js approveWritrScript (sets writr_complete=1); consumers src/routes/teleprompter.js, src/routes/pipr.js, src/editor/assemblr.js, src/routes/shootday.js
**Problem:** Multiple approval entry points (POST /approve, /room/approve, /assemble->then approve) set writr_complete=1 (via approveWritrScript), which gates teleprompter.js project listing and pipr.js pipeline progress. But room/approve produces a script with no beat_map_json (finding writr-3) and assemble's beat_map_json uses storyboard-derived beats with different field names (name/beat_name/story_moment) than the generate path. Downstream consumers that key on specific beat fields (assemblr.js peak-zone logic, shootday merge) can silently mis-align because the beat_map shape differs by approval path while writr_complete uniformly signals 'ready'.
**Fix:** Normalize beat_map_json shape across all approval paths (ensure beat_name + index present), and ensure room/approve attaches a beat map before flipping writr_complete, so 'complete' guarantees downstream-usable structure.

### [HIGH] Three parallel script-production paths create the exact decision-load the Secondary Directive forbids
**Dimension:** simplification | **Location:** src/routes/writr.js (POST /generate vs POST /:project_id/storyboard, /beat/write, /assemble); writr.html showStoryboardPipeline()
**Problem:** WritΩr now exposes THREE distinct ways to produce a script: (1) the 5 documented entry-point modes via POST /generate (script_first, shoot_first, hybrid, paste_in) plus an undocumented 6th 'vault_first'; (2) the iterate loop; and (3) a completely separate Storyboard pipeline (POST /storyboard -> /beat/write -> /assemble) that builds a script beat-by-beat. The storyboard path duplicates everything the generate path already does (context building, voice block assembly, beat mapping, vault save, insertWritrScript) but with its own prompts and its own fallback chains. The creator must now decide: quick generate vs storyboard pipeline? Which entry point? That is decisions ADDED, not removed. The frontend even gates these with showStoryboardPipeline(hasId8r) + a 'Quick Script' label, meaning the UI itself has to explain two competing flows.
**Fix:** Pick ONE primary path and make the other an internal implementation detail. The storyboard pipeline is the better product (it shows the creator the structure before writing, edits are non-destructive, and per-beat regeneration costs less). Recommend: make storyboard the default flow when id8r/beats exist, collapse script_first/shoot_first/hybrid into a single 'what do you have?' input that auto-routes, and keep paste_in + iterate as the only explicit alternate verbs. Target surface: one 'Build it' button + 'I already wrote it' (paste) + 'Revise' (iterate).

### [HIGH] Storyboard/beat-write/assemble prompts omit REALITY_RULE and SLOP_RULE — the anti-fabrication guardrails
**Dimension:** bug | **Location:** src/routes/writr.js — storyboard mapping prompt (~line with 'You are mapping research'), /beat/write prompt, /assemble seamPrompt
**Problem:** REALITY_RULE (never invent moments) and SLOP_RULE (no AI-speak) are injected into every legacy engine (script-first, shoot-first, hybrid, iterate) and the Room. But the storyboard pipeline prompts — buildStoryboard's mapping prompt, the per-beat /beat/write prompt, and the /assemble seam prompt — contain NEITHER. The /beat/write prompt only says 'never corporate' inline and 'stay on topic.' Since this pipeline is positioned as the richer, id8r-driven path, the most strategically important scripts are the ones LEAST protected against fabrication and slop. A storyboard 'story_moment' that Claude inferred (not grounded in real footage) becomes a beat with no REALITY_RULE check, then gets written as fact.
**Fix:** Import and prepend REALITY_RULE + SLOP_RULE into all three storyboard-pipeline prompts, exactly as the legacy engines do. For /beat/write specifically, add the [BEAT NEEDED: ...] convention so uncovered beats are flagged rather than invented.

### [HIGH] Three overlapping voice blocks injected into the same prompt can conflict and bloat context
**Dimension:** improvement | **Location:** src/routes/writr.js generate handler (id8rBlock from buildWritrPromptContext) + each engine's buildPrompt (voiceCalBlock + voiceSummary)
**Problem:** A single generate call injects voice guidance THREE times: (1) loadVoiceCalibrationBlock() — the 190-transcript master profile, labeled 'highest priority'; (2) buildVoiceSummary() — either creator-profile.voice defaults OR selected voice-library profiles with weights; and (3) the soul_profiles section inside buildWritrPromptContext() (id8rBlock) — voice_summary, signature_phrases, what_not_to_write pulled from creator-profile.json again. These are three different distillations of the same voice, each with their own 'signature phrases' and 'never says' lists that can diverge after any profile edit. The calibration block alone is ~15 phrases + 8 never-does + 6 examples; stacking the soul block and voice summary on top wastes tokens and gives Claude contradictory priority signals ('highest priority' vs weighted profiles vs soul guidelines).
**Fix:** Establish a single voice authority. When voice-library profiles are explicitly selected, suppress the calibration block (user override). Otherwise use calibration as the sole voice source and drop the soul_profiles voice fields from buildWritrPromptContext (keep only non-voice soul data like role). Deduplicate signature_phrases/never lists at assembly time.

### [HIGH] Storyboard pipeline ignores TikTok intelligence, voice calibration, VectΩr, VisualΩr, and short-form constraints that the generate path injects
**Dimension:** inter-tool | **Location:** src/routes/writr.js — /storyboard, /beat/write, /assemble (vs the enrichment chain in /generate ~lines building id8rBlock)
**Problem:** The generate handler enriches id8rBlock with: VectΩr strategic brief, VisualΩr visual-intelligence injection, short-form word constraints, and AnalΩzr content_intelligence; and each engine adds loadTikTokIntelligenceBlock() (clip-planting directive) + loadVoiceCalibrationBlock(). The storyboard pipeline's /storyboard, /beat/write, and /assemble handlers call buildWritrPromptContext() directly and add NONE of these. So a creator who uses the (recommended, id8r-gated) storyboard flow loses: clip-seed planting for ClipsΩr, the 190-transcript voice calibration, the active strategic direction, visual opening-frame rules, and short-form length enforcement. project.format==='short' is never checked in /beat/write — it uses a hardcoded totalWords=200 only as a word-target heuristic, not the strict constraint block.
**Fix:** Extract the id8rBlock enrichment (VectΩr + VisualΩr + short-form + AnalΩzr + TikTok + voice calibration) into one shared buildFullWritrContext(projectId, {format}) helper and call it from BOTH the generate path and all storyboard-pipeline prompts. This is the single highest-leverage fix for consistency.

### [MEDIUM] hook_variations are generated then effectively discarded — upstream Id8Ωr hooks also unused at decision point
**Dimension:** improvement | **Location:** src/routes/writr.js generate complete event (hook_variations); writr.html renderScript/buildScriptHTML (no hook selector)
**Problem:** Every generate engine produces hook_variations (3 options: direct/curiosity/result-first) and they're saved to writr_scripts.hook_variations and emitted in the 'complete' event. But the rendered script just uses whatever opening the model wrote into 'script'; the three hook variants are never surfaced as a choosable A/B in the UI render path shown (renderScript/buildScriptHTML have no hook-picker). Meanwhile Id8Ωr already supplies packageData.hooks and a chosen hook. So the system spends tokens generating hooks at three layers (Id8Ωr package, id8rBlock 'Opening hook', engine hook_variations) and the creator never picks one. Hooks are the single highest-leverage element for a 725k-TikTok creator and they're the least surfaced.
**Fix:** Surface hook_variations as a one-click swap above the script (replace beat-1 opening on click) and seed them from Id8Ωr's chosen hook + package hooks so the creator chooses once. This reduces revisions because the most-revised element (the hook) becomes a pick, not a rewrite.

### [MEDIUM] Iterate engine drops nearly all upstream context — revisions can drift off-strategy and out of voice
**Dimension:** improvement | **Location:** src/writr/iterate.js buildPrompt (params: currentScript, feedback, iterationCount, config, profile, voiceProfiles only)
**Problem:** iterateScript()/buildPrompt in iterate.js inject ONLY voiceSummary + voiceCalBlock + story_structure + brand. It does NOT receive id8rBlock (concept, talking points, guardrails/what-not-to-do), VectΩr direction, VisualΩr rules, season context, or footage. So once the creator starts revising, Claude loses the project's guardrails and strategic brief. A revision like 'make the hook punchier' can reintroduce a banned angle (what_not_to_do) or drift from the locked VectΩr direction because that context is simply absent. This is also why scripts need more revision rounds: each round forgets why the script was the way it was.
**Fix:** Pass id8rBlock (at minimum: concept, talking_points, guardrails) and the VectΩr/short-form constraints into iterateScript, mirroring generate. The route already builds id8rBlock for generate — refactor so /iterate reuses the same context builder.

### [MEDIUM] shoot_first/hybrid send footage transcripts but ignore VaultΩr frame-analysis (visual_description) — the richest signal AssemblΩr already uses
**Dimension:** inter-tool | **Location:** src/writr/shoot-first.js summariseTranscripts(); src/routes/writr.js vault_first clip summary builder
**Problem:** summariseTranscripts() and the vault_first clip summary use only f.transcript, f.shot_type, f.original_filename, f.duration_seconds, f.subject/topic. But VaultΩr's frame-analysis queue populates visual_description / peak-energy and b-roll-anchor signals that AssemblΩr explicitly injects into its beat mapping (per CLAUDE.md: '⚡ peak energy zone, b-roll anchors'). WritΩr — which decides the STORY from footage in shoot_first/vault_first — never sees those visual signals. So the story-finder works from words-only while the downstream selects engine works from words+vision. The anchor_moment WritΩr picks may not be the visually strongest moment.
**Fix:** Include footage visual_description (and any peak-energy flag) in the per-clip block sent to shoot_first/hybrid/vault_first prompts so WritΩr's anchor_moment and beat coverage align with what VaultΩr/AssemblΩr can actually see.

### [MEDIUM] Format variants (bullets/hybrid) are a second + third Claude call on every generate — cost and latency with low payoff
**Dimension:** improvement | **Location:** src/routes/writr.js generateFormatVariants() — called unconditionally after every generate
**Problem:** After the primary script, generateFormatVariants() fires TWO more full Claude calls (bullets + hybrid format) in parallel on EVERY generate, before the creator has even decided to keep the draft. For a creator who iterates several times before approving, that's 2 wasted calls per discarded draft. The variants are pure reformatting of text the creator hasn't approved. This adds latency to the critical 'see my draft' moment and burns tokens on drafts that get thrown away.
**Fix:** Generate only the 'full' script on generate. Lazily produce bullets/hybrid on demand when the creator clicks that tab (or only after approval, for TeleprΩmpter). The tab UI already supports a loading state (setTabState 'loading'), so this is a small change with a large cost/latency win.

### [LOW] Four near-identical id8rBlock fallback chains duplicated across route handlers
**Dimension:** simplification | **Location:** src/routes/writr.js — duplicated fallback blocks in /generate, /storyboard, /beat/write
**Problem:** The 'build id8rBlock from project-context.json, else from project.id8r_data, else from config.script/what_happened, else from project DB record' fallback ladder is copy-pasted in /generate, /storyboard, and /beat/write (and partially in buildWritrPromptContext). Each copy has slightly different field coverage (e.g. /storyboard pulls pkg.hooks but /generate's inline fallback doesn't), so they drift. This is ~60 lines duplicated 3x and is the root cause of finding writr-004's inconsistency.
**Fix:** Extract a single getProjectContextString(projectId, project, config) that encapsulates the full fallback ladder, and call it everywhere. Fold the id8rBlock enrichment (writr-004) into the same function.

### [MEDIUM] Room 'approve from room' uses a brittle longest-message-containing-BEAT heuristic to extract the script
**Dimension:** bug | **Location:** writr.html extractScriptFromRoom(); src/routes/writr.js POST /:project_id/room/approve (stores script_text verbatim, no beat validation)
**Problem:** extractScriptFromRoom() picks the script to approve by: longest user message containing 'BEAT', else longest assistant message containing 'BEAT', else just the longest message in the whole conversation. This can approve a chat ABOUT the script (a long critique that mentions 'BEAT') as if it were the script itself, silently locking garbage as the approved draft that then flows to TeleprΩmpter/AssemblΩr/MailΩr/PostΩr. Against the Prime Directive, this can lose the real creative state without the creator realizing the wrong text was locked.
**Fix:** Require the Room to emit an explicit fenced SCRIPT block (or have the creator select the message to approve) rather than guessing by length. At minimum, validate the extracted text has multiple [● BEAT ...] markers before allowing room/approve, and show the creator exactly what will be locked.

### [LOW] Modes are not equally useful: script_first and hybrid are weaker than shoot_first/storyboard and add choice overhead
**Dimension:** improvement | **Location:** src/routes/writr.js generate switch (script_first / hybrid / vault_first branches)
**Problem:** Assessed per-mode: shoot_first (story archaeology from footage) and the storyboard pipeline are the strongest, most differentiated, on-brand modes for a reality creator. paste_in (verbatim + beat-map) is clearly useful and cheap. But script_first (creator already wrote it -> Claude rewrites/maps) overlaps heavily with paste_in, and hybrid's 3-call concept+footage reconciliation rarely beats just running shoot_first with the concept pasted into 'what happened.' vault_first is an undocumented near-duplicate of shoot_first. So of 6 generate modes, ~3 are redundant — each redundant mode is a decision the creator must make at the entry screen with little upside.
**Fix:** Consolidate: merge vault_first into shoot_first (auto-include vault clips when present), and fold script_first into paste_in with a 'tidy this up' toggle. Keep shoot_first, paste_in, storyboard, iterate as the real verbs. Fewer modes = fewer entry-screen decisions, directly serving the Secondary Directive.

### [LOW] No 'why this script looks like this' summary surfaced — creators revise blind, increasing revision count
**Dimension:** improvement | **Location:** writr.html renderScript / generate complete handler (story_found and anchor_moment exist but aren't surfaced as a rationale panel)
**Problem:** The generate complete event returns story_found, anchor_moment, missing_beats, coverage info, but the most decision-reducing artifact — a short 'here's the story I found and the 3 calls I made (hook angle, anchor, what's missing)' — isn't presented as a persistent rationale the creator reads before reacting. Without seeing the model's reasoning, the creator reacts to surface wording and fires vague revisions ('make it punchier'), which is the costliest kind of iterate. Showing the rationale lets the creator correct the premise once instead of revising prose repeatedly.
**Fix:** Render a compact, dismissible 'Story decisions' card from story_found + anchor_moment + missing_beats above the script. This front-loads the high-leverage correction (premise) and reduces low-value prose-revision rounds.

### [HIGH] Post-Mortem brief never injected into WritΩr (known gap, confirmed)
**Dimension:** inter-tool | **Location:** src/routes/writr.js (generate route, ~VectΩr brief injection block); src/utils/project-context-builder.js
**Problem:** Post-Mortem produces a structured learning brief stored via db.insertPostMortemBrief / db.getActivePostMortemBrief with fields root_cause, adjustments, avoid (src/db.js:6148-6173). This is the explicit feedback loop that should make the next script learn from the last video's real performance. WritΩr never reads it. The generate route (src/routes/writr.js) injects VectΩr's getActiveBrief() (a DIFFERENT brief: vector/focus/constraints/avoid at src/db.js:6089), VisualΩr, and MirrΩr calibration — but never getActivePostMortemBrief(). project-context-builder.js (which assembles project-context.json for WritΩr) has zero post-mortem references. Result: the analytics→ideation learning loop is broken at the script stage. Listed as known issue #5 in CLAUDE.md; confirmed still open.
**Fix:** In the generate route's brief-injection section (right after the VectΩr getActiveBrief block), add a parallel block: const pm = require('../db').getActivePostMortemBrief(); if present, append a '## LAST VIDEO POST-MORTEM (learn from real performance)' block with pm.root_cause, pm.adjustments, pm.avoid, scoped with the same 'shape tone/angle but never override the creator's stated concept' guard used for VectΩr. Mirror the same injection into buildRoomSystemPrompt() so the Room creative-director chat also sees it.

### [HIGH] Bullets/hybrid format variant can be approved and flow downstream as the script
**Dimension:** bug | **Location:** public/writr.html:1527-1535 (onApprove); src/db.js:4029 (approveWritrScript); src/db.js:3991 (getApprovedWritrScript)
**Problem:** generate inserts three separate writr_scripts rows sharing one session_id with mode full/bullets/hybrid (src/routes/writr.js). The frontend switchTab(mode) sets currentScript = currentScripts[mode] (public/writr.html ~switchTab), and onApprove() POSTs script_id: currentScript.id (public/writr.html:1533). approveWritrScript(projectId, scriptId) approves exactly that row with no mode guard (src/db.js:4029) and upserts ws.generated_script into the scripts table for SelectsΩr. getApprovedWritrScript selects approved=1 with no mode filter (src/db.js:3991). So if the creator is viewing the Bullets or Hybrid tab when they click Approve, the bullet-point version becomes the approved/active script. Every downstream consumer that reads getApprovedWritrScript — EditΩr/AssemblΩr beat alignment, MailΩr blog/email, PostΩr captions, BrΩllr, teleprompter — then receives 3-5 word memory triggers instead of prose. Silent data-integrity failure with no recovery prompt (violates Prime Directive).
**Fix:** Always approve the canonical full-mode sibling, not the active tab. In onApprove(), resolve the 'full' row id (currentScripts.full?.id) instead of currentScript.id; or in approveWritrScript, if the target row.mode !== 'full', look up the same-session_id full row and approve that instead. Bullets/hybrid are presentation views of the same script and should never be the source of truth downstream.

### [MEDIUM] Storyboard/beat-write path bypasses ALL upstream intelligence injections
**Dimension:** inter-tool | **Location:** src/routes/writr.js (storyboard, /beat/write, /assemble handlers vs the /generate handler)
**Problem:** The generate route layers VectΩr brief, VisualΩr, MirrΩr calibration, TikTok intelligence, ClipsΩr patterns, season context, voice calibration and short-form constraints into id8rBlock. The storyboard pipeline (POST /:project_id/storyboard, /beat/write, /assemble) builds its prompts from buildWritrPromptContext + raw id8r_data/config fallbacks only — it does NOT inject VectΩr, VisualΩr, MirrΩr, Post-Mortem, TikTok, or ClipsΩr signals, and the per-beat write prompt uses a thin hand-rolled voiceBlock rather than loadVoiceCalibrationBlock(). A creator who uses the storyboard route (the richer Id8Ωr-driven path) gets materially less strategic context than one using quick generate. Inconsistent inter-tool feeds depending on which button is pressed.
**Fix:** Extract the brief-injection logic (VectΩr + VisualΩr + Post-Mortem + voice calibration) from /generate into a shared buildIntelligenceBlock(projectId, project) helper and call it in storyboard, /beat/write, and /assemble prompt construction so all generation paths see the same upstream signals.

### [MEDIUM] shoot_first footage_id / anchor_moment links are not persisted for EditΩr
**Dimension:** inter-tool | **Location:** src/routes/writr.js (generate: commonData/beat_map_json persistence); src/editor/assemblr.js (selects engine)
**Problem:** shoot_first and vault_first ask Claude to map real moments to beats with a footage_id per beat and identify an anchor_moment with footage_id (src/writr/shoot-first.js JSON schema). This is the bridge from VaultΩr footage to script beats that EditΩr/AssemblΩr would use to pre-align selects. The generate route saves result.beat_map into beat_map_json but does not separately persist anchor_moment or surface the per-beat footage_id mapping in a form EditΩr reads — AssemblΩr re-derives selects from beat_map_json + visual_description signals rather than honoring WritΩr's footage_id assignments. The footage→beat linkage WritΩr computed is effectively discarded between tools.
**Fix:** Confirm beat_map_json retains the footage_id and real_moment fields end-to-end (they may be stripped), and have AssemblΩr seed its beat-to-clip alignment from WritΩr's footage_id assignments as a prior before its own visual matching. Persist anchor_moment to the project/selects record so EditΩr can prioritize the anchor scene.

### [LOW] No write-back from WritΩr to PipΩr beat map when beats are flagged [BEAT NEEDED]
**Dimension:** inter-tool | **Location:** src/routes/writr.js (missing_beats persisted to writr_scripts only); src/pipr/beat-tracker.js (config not updated)
**Problem:** WritΩr frequently returns missing_beats / [BEAT NEEDED] flags and (in shoot_first) coverage_description guidance — concrete signals that the PipΩr beat structure or the shoot plan needs adjustment. These are saved on the script row (missing_beats) and shown in the editor, but nothing flows back to update PipΩr's beat config or DirectΩr's shot list / ShootDay coverage cards. The creator must manually re-translate gaps into a re-shoot plan. The loop from script-discovered gaps back to the production plan is one-directional.
**Fix:** On generate/iterate completion, optionally write missing_beats + coverage_description into project-config.json (e.g. config.coverage_gaps) so PipΩr, DirectΩr, and ShootDay can surface 'beats needing real footage' as actionable shot-list items rather than leaving them buried in the script row.

### [HIGH] Two parallel script-generation paths forked by '— or —' with no guidance
**Dimension:** simplification | **Location:** public/writr.html:511-541 (storyboardPipelineGroup / storyboardDivider / quickScriptLabel); showStoryboardPipeline() ~2838; onStoryboardAction() / onGenerate()
**Problem:** When a project carries Id8Ωr data (the normal pipeline case), writr.html shows BOTH the multi-step Storyboard pipeline (Build Storyboard -> Write All Beats -> Assemble, 3 buttons + a step bar + per-beat 'Write This Beat' buttons) AND, separated by a literal '— or —' divider plus a 'QUICK SCRIPT' label, the single-shot Generate button. Both ultimately write a writr_scripts row and set active_script_id. The creator must first decide WHICH machine to use before they can decide anything else. Nothing on screen explains the tradeoff (storyboard = more control/more clicks; quick = one button). This is the single largest decision-count violation in WritΩr: it adds a meta-decision ('which generator?') on top of the work. Per the Secondary Directive this should be redesigned so there is one default 'just write the script' action, with storyboard as a progressive-disclosure 'take more control' option only surfaced after a draft exists or on explicit request.
**Fix:** Make the single Generate button the primary, always-default 'just write the script' path. Demote the storyboard pipeline to a secondary 'Build it beat-by-beat instead' affordance that is collapsed by default and only expands on click. Remove the symmetric '— or —' fork so the creator is never asked to choose a generator before they have a draft. Storyboard becomes a power-user refinement, not a co-equal entry.

### [MEDIUM] Five generation modes are mostly auto-detected — but paste_in and vault_first add latent decision surface
**Dimension:** simplification | **Location:** public/writr.html showInputArea():1166-1219, togglePasteInMode():1224-1248; src/routes/writr.js /generate ep==='vault_first' branch
**Problem:** The audit premise ('are 5 modes too many') resolves favorably for the 3 core modes: script_first / shoot_first / hybrid are AUTO-SELECTED from PipΩr's entry_point (showInputArea reads currentEntryPoint = project.entry_point; the creator never picks them). That is correct decision-reduction. However two of the five are decisions the creator must actively make: (a) paste_in is a manual toggle ('Import a Script Instead') that overrides the detected mode, and (b) vault_first exists in the route (/generate handles 'vault_first' by pulling all project clips) but is collapsed into the shoot_first input UI (showInputArea treats shoot_first and vault_first identically) — so the backend supports a mode the frontend gives no clean way to choose, creating dead/ambiguous surface. Net: the modes themselves are not the problem; the problem is they aren't presented as one coherent 'where is your raw material?' question.
**Fix:** Keep the 3 auto-detected modes invisible (good). Reframe paste_in not as a mode toggle but as a first-class input affordance ('I already wrote it — just map the beats'). Either wire vault_first to an explicit, labeled trigger or remove the unreachable branch so there is no phantom mode. Goal: the creator answers one implicit question (what do you have?) and never names a 'mode'.

### [HIGH] No single 'script done -> ready to shoot' completion action; approval is decoupled from format choice and teleprompter handoff
**Dimension:** improvement | **Location:** src/routes/writr.js POST /:project_id/approve (sets active_script_id + syncs); public/writr.html three-tab switchTab()/renderScript() and approveBtn handling
**Problem:** Jason's stated need is: the script must be DONE before he picks up the camera. After generation, WritΩr produces three format variants (full / bullets / hybrid) as tabs, then requires a separate Approve step (POST /:project_id/approve) to set writr_complete and sync to SelectsΩr/Teleprompter. So the creator must: (1) read the draft, (2) optionally iterate, (3) choose which of 3 formats is canonical, (4) click Approve. But approve always locks the 'full'/active mode regardless of which tab the creator was reading — there is no 'approve THIS format' coupling, and nothing tells the creator that approval is what unlocks the Teleprompter. The completion thread is implicit. This adds decisions (which format? did I approve? is it on my phone?) at the exact moment the directive says the work should already be done.
**Fix:** Collapse approval into one decisive 'Lock & Send to Teleprompter' action that (a) marks writr_complete, (b) records which format the creator actually chose as the teleprompter default, and (c) confirms the handoff ('On your phone now'). Make format a property of the locked script, not a separate tab the creator must mentally reconcile with approval.

### [MEDIUM] Format variants (bullets/hybrid) are generated eagerly for every script but only one is ever used downstream
**Dimension:** inter-tool | **Location:** src/routes/writr.js generateFormatVariants() + the three insertWritrScript calls in /generate; downstream all read full mode
**Problem:** Every /generate call fires two extra Claude calls (buildBulletsPrompt + buildHybridFormatPrompt via generateFormatVariants) and writes THREE writr_scripts rows (full/bullets/hybrid) sharing a session_id. Downstream consumers (teleprompter.js, assemblr.js, mailor.js, postor.js, brollr.js) all read getApprovedWritrScript / active_script — i.e. the FULL mode. The bullets/hybrid rows are presentation-only teleprompter formats. This means 2 extra paid model calls and 2 extra DB rows per generation for formats the creator may never view, and it forces a 3-tab decision onto the creator. From a decision-reduction lens, the system is pre-computing options the creator didn't ask for.
**Fix:** Generate format variants lazily — only when the creator switches to that tab or chooses that format at lock time. Default to showing 'full' and treat bullets/hybrid as on-demand reformats of the approved script. Removes 2 Claude calls per generation and removes a 3-way decision from the happy path.

### [MEDIUM] Manual post-WritΩr steps the system could automate: transcript loading, brief prefill confirmation, and beat-coverage gaps
**Dimension:** improvement | **Location:** public/writr.html onLoadTranscripts():1254-1278; /generate emits gaps_to_capture/missing_beats; applyRoomToRevision() room->revise copy step
**Problem:** What the creator does manually around WritΩr that the system arguably should handle: (1) In shoot_first the creator must click 'Load Footage Transcripts' (onLoadTranscripts) to pull VaultΩr clips into the input box — but /generate already calls db.getAllFootage internally, so the manual load is a redundant decision/step that only matters for the textarea preview. (2) After a shoot_first/hybrid draft, missing_beats / [BEAT NEEDED] flags are surfaced but the creator must manually carry those gaps to ShootDay/DirectΩr — there is no auto-handoff of 'here is what you still need to capture' even though gaps_to_capture is computed and emitted. (3) The Room conversation and the iterate loop are separate surfaces requiring the creator to copy a REVISION line into the revise box (applyRoomToRevision) rather than the Room directly producing a new draft.
**Fix:** (1) Auto-load transcripts when shoot_first project opens (footage is already in DB) and drop the manual button, or make it a passive preview not a gate. (2) Pipe missing_beats/gaps_to_capture automatically into the DirectΩr/ShootDay shot list so the creator never re-enters them. (3) Let the Room 'Use as Revision' button trigger the iterate run directly instead of staging text the creator must then submit.

### [LOW] Voice selector adds an optional decision (primary/secondary/blend slider) on the main generate surface
**Dimension:** simplification | **Location:** public/writr.html getVoiceParams()/renderVoiceLibrary()/onVoiceChange(); buildVoiceProfiles() in src/routes/writr.js
**Problem:** The Voice Library exposes a primary voice dropdown, a secondary voice dropdown, and a 0-100 blend slider (voicePrimary/voiceSecondary/voiceBlend, getVoiceParams). For a solo creator whose entire WritΩr is calibrated on his own 190-transcript voice profile (loadVoiceCalibrationBlock, injected unconditionally), the default single-voice case needs zero of these controls. The blend slider in particular is a fine-grained decision that only matters for multi-creator (Cari) productions, which are the exception. Presenting it inline on every generate makes the common case carry the cost of the rare case.
**Fix:** Hide the voice selector entirely unless the project has collaborators (db.getProjectCollaborators length > 1) or the creator explicitly opens a 'voices' disclosure. Default silently to the calibrated creator voice so the solo path has zero voice decisions.
