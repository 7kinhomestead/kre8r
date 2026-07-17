# PipΩr — Architectural Review
*Opus multi-agent audit.*

## Synthesis
I'll synthesize the PipΩr review. Let me deduplicate and organize the findings.

# PipΩr Review — Synthesis

## Verdict: Does PipΩr serve its role as the bridge between concept and script?

**Partially — and the bridge is structurally cracked at both ends.** PipΩr's *design* is the right bridge: it takes an Id8Ωr brief, picks a story structure, builds a percentage-keyed beat map "you can shoot to," and hands beats forward to WritΩr and AssemblΩr. But three classes of defects undermine the role:

1. **The beat map silently vanishes for the highest-value content.** `rock_rich` — Jason's flagship, the first/most-promoted card — produces an empty server-side beat map. The creator confirms 7 beats on screen, the system saves zero. This is a Prime Directive violation on the exact data the tool exists to produce.
2. **The bridge leaks upstream intelligence.** Id8Ωr already recommends a structure, content_type, and angle; PipΩr reads almost none of it, dropping the creator onto a 23-card wall they must re-decide blind (Secondary Directive violation).
3. **The bridge corrupts state on the way to WritΩr/AssemblΩr.** Off-by-one override keying, coverage-wiping PATCHes, double-stringified beat maps, and a force-matching coverage heuristic all silently mis-attribute or destroy the beat data downstream tools depend on.

The bridge stands, but a creator using `rock_rich`, editing structure, or trusting the coverage dashboard will lose or corrupt creative state without knowing it. **It serves the role only on the happy path with a small subset of structures; the load-bearing flows are broken.** Fixing the four critical/high items below restores the bridge.

---

## Top 3 by Creator Impact

1. **`rock_rich` produces an empty beat map (PIPR-1/3 cluster, CRITICAL).** Jason's flagship format, most-promoted card, saves nothing. He shoots to a map the system threw away, and WritΩr/AssemblΩr get `beats:[]`. Highest-value content, total silent loss, no recovery path.
2. **Edit-structure wipes all footage coverage while the UI promises it's preserved (PIPR-2, CRITICAL).** The "CHANGE STRUCTURE" flow destroys every footage-to-beat mapping and the subtitle actively *lies* ("coverage data is preserved"). Prime Directive violation plus broken trust.
3. **Id8Ωr's structure recommendation is generated then discarded (PIPR-01/PIPR-2 cluster, HIGH).** The research was done, the model picked the shape, and the creator is forced to re-decide against 23 cards with no marker. The single biggest "adds a decision" violation — and the suggestion engine that *would* fix it is dead for all long-form content anyway.

---

## Deduplicated Findings (critical → high → medium → low)

The 35 raw findings collapse to **23 unique issues** (heavy overlap on rock_rich, Save-the-Cat target_pct, the coverage heuristic, and edit-structure).

### CRITICAL

**C1. `rock_rich` structure produces an empty beat map server-side**
*(merges PIPR-3 "rock_rich card", PIPR-1 "rock_rich empty map")*
`src/pipr/beats.js` `getBeats()` switch (~lines 185–212) has no `rock_rich` case and no `ROCK_RICH` const; falls through to `default: return []`. Client shows 7 beats from `public/pipr.html` `BEAT_TEMPLATES.rock_rich` (~lines 1235–1243), creator confirms, server persists `beats:[]`.
**Fix:** Add `ROCK_RICH` const (copy 7 beats from pipr.html), add `case 'rock_rich'` to `getBeats()`, export it. Canonical fix: have client fetch `GET /api/pipr/beats-preview` instead of duplicating templates (see M-simplify below).

**C2. beat_overrides applied with off-by-one key — deep-mode edits corrupt the wrong beat**
*(PIPR-1 first list)*
`src/routes/pipr.js` `buildConfig`: `const override = beat_overrides[beat.index]` uses 1-based template `beat.index`; `public/pipr.html` lines 1459–1471 (`updateBeatOverride`) keys by 0-based array `i`. Every deep-mode edit shifts by one beat; last beat's edit dropped.
**Fix:** Agree on key base — use 0-based array position in `buildConfig` (`beats.map((beat, i) => { const override = beat_overrides[i] })`) in both create and PATCH paths.

**C3. Edit-structure PATCH wipes all beat coverage; UI claims it's preserved**
*(PIPR-2 first list)*
`public/pipr.html` `saveEditedStructure()` rebuilds beats via `getClientBeats()` (all `covered:false`, no `coverage_footage_ids`) and PATCHes them; `src/routes/pipr.js` PATCH handler does `Object.assign(config, req.body)`, replacing the populated beats array. Subtitle reads "coverage data is preserved" — false.
**Fix:** Re-run `updateBeatCoverage(projectId)` server-side after structure change, OR snapshot old beats to `config.beats_prev` before overwrite. At minimum correct the UI copy. (Related to C2's keying fix and H-patch-whitelist.)

### HIGH

**H1. Id8Ωr's `story_structure` recommendation is generated then thrown away**
*(PIPR-01 "recommendation thrown away" + PIPR-2 "dead suggestion banner" — same root: upstream structure intel unused)*
Id8Ωr brief prompt asks Claude for `story_structure` (`src/routes/id8r.js:1156,1291`); `pipeline_brief.story_structure` exists. PipΩr never reads it. Separately, `showStructureSuggestion()` keys `STRUCTURE_MAP` (`public/pipr.html:1132–1156`) off genre-style keys, but Id8Ωr writes `content_type = pb.content_type || 'long_form'` (`id8r.js:1216`) — a FORMAT value, so only `short_form` ever matches; the banner is dead for all long-form.
**Fix:** In `checkLoadProject`, read `briefData.pipeline_brief.story_structure`, map to a `beats.js` key (hook-problem-solution→vsl_arc, before-after→before_after_bridge, tutorial→tutorial_with_stakes, rant→short_hot_take, investigation→documentary_arc, day-in-life→episode_arc) and call `selectStructure()` / surface in `struct-suggest-banner`. Drive `STRUCTURE_MAP` off the genre/angle field, not format-only `content_type`; add a format fallback.

**H2. updateBeatCoverage can regress `pipr_complete` from 1 → 0**
*(PIPR-3 first list)*
`src/pipr/beat-tracker.js:158–162` writes `pipr_complete: covered.length > 0 ? 1 : 0`. A re-run with zero matches flips a finished project back to un-planned; drives `needs_attention`/gating. Conflates "creator finished planning" with "footage currently covers beats."
**Fix:** Never write 0 here — only raise to 1 (`covered.length>0 || free_form`), or drop this write and track coverage separately.

**H3. Room-revision path double-stringifies `beat_map_json`, breaking AssemblΩr**
*(PIPR-02 third list)*
`src/routes/writr.js:1135–1157` pre-stringifies `beatMapJson`; `db.insertWritrScript` (`db.js:3972`) stringifies again. `_parseWritrScript` parses once → yields a STRING; AssemblΩr (`assemblr.js:219,816`) gates on `Array.isArray(writrBeatMap)` → false → every room-revision script silently loses its beat map in AssemblΩr.
**Fix:** Stop pre-stringifying in writr.js (assign raw array at 1135; already-parsed array at 1147–1149); let `insertWritrScript` do the single stringify.

**H4. 23 structures presented as a flat manual pick**
*(PIPR-2 fourth list — simplification; depends on H1)*
Screen 2 (`public/pipr.html` lines 452–695) shows 23 cards undifferentiated; suggestion engine only fires when optional `content_type` is set (defaults blank, no validation).
**Fix:** Lead screen 2 with the single suggested structure (pre-selected) + "Browse all" collapse; infer from high_concept/Id8Ωr brief when content_type blank. Reduce "choose 1 of 23" to "confirm or change 1." (Same fix surface as H1.)

**H5. Screen 3 forces emotional_palette + musical_theme decisions that never feed the beat map**
*(PIPR-3 fourth list — simplification)*
`public/pipr.html` screen-3 (lines 774–824): two mandatory-looking dropdowns (17 + 13 options) not consumed by `buildBeatMap` or WritΩr; only used downstream in ComposΩr.
**Fix:** Remove from PipΩr critical path or move to ComposΩr.

**H6. `rock_rich` UI suggestion + `beat_scripts` mismatch after structure change**
*(PIPR-4 first list — beat_scripts keyed by old index)*
`src/routes/writr.js:1465` stores `beat_scripts` by beat index; `/report` reads `beatScripts[i]` positionally against current beats. After edit-structure (C3) the beats array changes length but `beat_scripts` keys aren't remapped/cleared → scripts mis-attributed or orphaned.
**Fix:** On `story_structure` change in PATCH handler, clear (with backup) or remap `beat_scripts` by beat name.

*(Note: PIPR-01 "EPISODE_ARC TDZ" downgraded — the finding itself concludes it's a non-bug at request time; tracked as the code-smell in M-simplify, not a standalone high.)*

### MEDIUM

**M1. Coverage matching force-assigns every select to nearest beat (false coverage)**
*(merges PIPR-5 first list, PIPR-07 second list, PIPR-05 third list "short-form beats")*
`src/pipr/beat-tracker.js` `matchSectionToBeat` (lines 61–84) returns `bestPctIdx` unconditionally (never -1); caller treats any index ≥0 as covered (line ~124). Keyword guard `w.length>3` filters short beat names (Hook/CTA/Payoff/Go), collapsing short-form to pct-proximity. Inflates `coverage_pct`, hides missing critical beats, and noisily trips `out_of_sequence` — the load-bearing AssemblΩr handoff signal, wrong in both directions.
**Fix:** Return -1 when keyword score low AND pct distance > ~15–20%. Prefer a deterministic join: persist AssemblΩr's assigned `beat_index` onto the `selects` row and trust it; only fall back to keyword/pct for legacy rows. Lower/special-case the length guard for short beat names.

**M2. `readConfig` title-match fallback writes config to the wrong project ID**
*(PIPR-6 first list)*
`src/pipr/beat-tracker.js` `readConfig` (lines 22–39): on ID miss, scans all configs, matches `cfg.title === project.title`, then `writeConfig(projectId, cfg)`. Titles aren't unique → one project's beat map/script copied onto another's ID path.
**Fix:** Require `cfg.project_id === projectId` before trusting/caching, or remove the title-fallback write entirely.

**M3. PATCH `/api/pipr/:id` writes any client field into config — no whitelist on file write**
*(PIPR-7 first list; mechanism behind C3)*
PATCH does `Object.assign(config, req.body, {project_id})` then `writeConfig` — no validation; a stray `beats`/`beat_scripts` key clobbers the canonical config.
**Fix:** Whitelist config fields before `writeConfig`; reject unknown/undefined keys; guard against replacing a non-empty beats array with an empty one unless structure changed.

**M4. AssemblΩr coverage never auto-flows back to PipΩr**
*(PIPR-04 third list)*
AssemblΩr's `finalise()` doesn't call `updateBeatCoverage`; PipΩr beat coverage + `/report` stay stale until a manual `POST /beats/update`.
**Fix:** Call `updateBeatCoverage(projectId)` at end of `finalise()` (try/catch, non-fatal).

**M5. Marker/storyboard `beat_map_json` use field names AssemblΩr doesn't consume**
*(PIPR-03 third list)*
AssemblΩr (`assemblr.js:221–222`) reads `bm.beat_index ?? bm.beat_name` and `bm.real_moment || bm.coverage_description`. Marker path (`writr.js:1135–1139`) emits `{index, beat_name, story_moment}`; storyboard (`writr.js:1526–1530`) emits `{name,...,story_moment}` — no `beat_index`, no `real_moment`. Even after H3, per-beat scripted context stays null.
**Fix:** Standardize the contract: producers emit `{beat_index:0-based, beat_name, real_moment}`; map `story_moment→real_moment`. Document canonical shape in db.js next to the `writr_scripts` schema.

**M6. Id8Ωr `content_type`/`content_angle` not surfaced into the wizard form**
*(PIPR-8 first list)*
`checkLoadProject` reads concept/brief but ignores `pipeline_brief.content_type`/`content_angle` for `f-content-type` prefill; creator re-picks, risking a long structure on short_form content (wrong format flag).
**Fix:** Pre-fill `f-content-type` from `pb.content_type`, carry `pb.content_angle` into high_concept_angles, default structure/setup_depth from content_type.

**M7. Beat map ignores Id8Ωr talking_points / story_angle / guardrails**
*(PIPR-04 second list — improvement)*
`buildBeatMap` (`beats.js:216–228`) copies static templates; ignores `talking_points`, `what_not_to_do`, etc. already in id8r_data. Generic reality_note prompts on every project.
**Fix:** Seed each beat's notes from talking_points (heuristic distribution or one cheap Claude call); inject `what_not_to_do` as guardrails.

**M8. Beats not seeded into `shoot_takes` on project create**
*(PIPR-05 second list — improvement)*
`POST /create` creates folders but not `shoot_takes` rows; creator finishes PipΩr with an empty shot checklist.
**Fix:** Insert one `shoot_takes` row per beat in `/create` after `writeConfig`; rely on unique `(project_id, beat_index)` index for idempotency.

**M9. Structure performance badges are global/concept-blind**
*(PIPR-06 second list — improvement)*
`loadStructurePerformance()` shows global avg-views, not tied to this concept's angle/genre.
**Fix:** Segment `getStructurePerformance()` by angle/genre; highlight best for the loaded concept; promote into the suggestion banner (compounds H1).

**M10. `/report` critical-missing beat names hardcoded, miss most structures**
*(PIPR-07 second list)*
`criticalMissing` filter only matches `['All Is Lost','Break into Three','CTA','Hook']` (save_the_cat + vsl_arc only); 13+ other structures never trip `needs_attention` on a missing climax/CTA.
**Fix:** Add `critical:true` to climax/CTA beats in `beats.js` templates; derive `critical_missing` from `beat.critical`.

**M11. Edit-structure rebuilds beats from client templates — third source of truth**
*(PIPR-6 fourth list)*
`saveEditedStructure()` uses `getClientBeats()` and PATCHes directly, bypassing server `buildBeatMap` → re-introduces rock_rich populated-here-but-empty-via-create inconsistency; `target_seconds` never computed on this path.
**Fix:** Edit-structure PATCH sends only `{story_structure}`; server rebuilds via `buildBeatMap`. Eliminate `getClientBeats` as a beat source.

### LOW

**L1. Save-the-Cat 'Set-Up' out-of-sequence (target_pct:1 after Theme Stated:5) + duplicate pcts**
*(merges PIPR-10 & PIPR-9 first list, PIPR-09 second list, PIPR-5 fourth list — all the same template defect)*
`src/pipr/beats.js` line 6: Set-Up `target_pct:1` follows Theme Stated `:5`; also duplicate pairs (All Is Lost/Dark Night 75, Break into Three/Finale 80, B Story/Fun and Games 30). Non-monotonic ordering breaks proximity matching, `out_of_sequence` (phantom needs_attention), and bar heights (1% sliver). Mirror in `pipr.html` line 1221.
**Fix:** Make `target_pct` monotonically non-decreasing (Set-Up ~7); nudge duplicate pcts apart; update both beats.js and the pipr.html mirror; audit other templates.

**L2. `buildBeatMap` drops emotional_function/reality_note — WritΩr loses beat descriptions**
*(PIPR-9 first list)*
`src/utils/project-context-builder.js` `buildWritrPromptContext` line 121 renders `- ${b.name}: ${b.description||''}` but beats carry `emotional_function`/`reality_note`, not `description`. WritΩr gets bare names + ": ".
**Fix:** Render `- ${b.name}: ${b.emotional_function || b.reality_note || ''}` (optionally `target_pct`).

**L3. Duration captured as string bucket, coerced with parseInt → target_seconds dropped/wrong**
*(PIPR-7 fourth list)*
`f-duration` values ('under-5','5-15',...) hit `parseInt` → NaN/null or misleading lower bound; `buildBeatMap` `totalSecs` null/wrong, so per-beat `target_seconds` (the "shoot-to" precision) silently never computed.
**Fix:** Map buckets to representative integers (under-5→3, 5-15→10, 15-30→22, 30-60→45, over-60→75) or use numeric input.

**L4. PipΩr never suggests a duration despite having historical data**
*(PIPR-10 second list — improvement)*
`config-miner.js` `avg_duration_by_type` computed but unused by PipΩr UI; creator guesses `f-duration`.
**Fix:** Pre-fill `f-duration` from `avg_duration_by_type` as an editable default.

**L5. Stale screen-4 copy claims beat maps only exist for 3 structures**
*(PIPR-4 fourth list)*
`public/pipr.html` line 837: "Beat maps only show for Save the Cat, Story Circle, and VSL Arc" — false; 20+ structures now render.
**Fix:** Replace with accurate copy or remove the list.

**L6. `updateProjectPipr` whitelist omits `high_concept_angles`/`research_bundle_json`**
*(PIPR-06 third list)*
`db.js:3934–3937` allowed list lacks `high_concept_angles`; survives only because Id8Ωr writes via raw SQL. Latent if PipΩr ever edits angles.
**Fix:** Add to allowed list if PipΩr should own it, else document as Id8Ωr-write-only.

**M-simplify (medium/structural). Beat templates duplicated server (beats.js) vs client (pipr.html BEAT_TEMPLATES)**
*(PIPR-08 second list; also the EPISODE_ARC TDZ smell PIPR-01 third list, and root cause of C1, M11)*
Full templates exist twice; edit-structure persists the client copy (client authoritative in one flow, server in another). `GET /api/pipr/beats-preview` already returns server templates. Also `EPISODE_ARC` const declared (beats.js ~230) after `getBeats()` (~185) uses it — works at request time but is a TDZ footgun; reorder above `getBeats()`.
**Fix:** Client fetches templates from `/api/pipr/beats-preview` (single source of truth) — eliminates C1's divergence class, M11's third source, and the rock_rich-in-one-list-not-other bug. Move `EPISODE_ARC` const above `getBeats()`.

---

## Theme summary
- **Single-source-of-truth divergence** (server beats.js vs client BEAT_TEMPLATES) is the root cause behind C1, M11, M-simplify — fixing it via `beats-preview` is the highest-leverage structural change.
- **State-loss cluster** (C2, C3, H2, H6, M2, M3) all violate the Prime Directive: off-by-one, coverage wipe, completeness regression, script mis-attribution, cross-project contamination, unvalidated writes.
- **Discarded upstream intelligence** (H1, H4, M6, M7, M9) all violate the Secondary Directive: Id8Ωr already decided structure/type/angle/talking-points; PipΩr re-asks.
- **Coverage signal integrity** (M1, M4, M5, M10, H3) — the AssemblΩr handoff that makes the beat map "load-bearing" is the most systemically fragile area.

Relevant files: `C:\Users\18054\kre8r\src\pipr\beats.js`, `C:\Users\18054\kre8r\src\pipr\beat-tracker.js`, `C:\Users\18054\kre8r\src\routes\pipr.js`, `C:\Users\18054\kre8r\public\pipr.html`, `C:\Users\18054\kre8r\src\routes\writr.js`, `C:\Users\18054\kre8r\src\editor\assemblr.js`, `C:\Users\18054\kre8r\src\utils\project-context-builder.js`, `C:\Users\18054\kre8r\src\db.js`, `C:\Users\18054\kre8r\src\routes\id8r.js`, `C:\Users\18054\kre8r\src\pipr\config-miner.js`.

## Full Findings (34 total)
### [CRITICAL] beat_overrides applied with wrong key (off-by-one) — deep-mode edits corrupt the WRONG beat
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\routes\pipr.js (buildConfig: const override = beat_overrides[beat.index]) vs C:\Users\18054\kre8r\public\pipr.html lines 1459-1471 (updateBeatOverride keyed by 0-based i)
**Problem:** In deep setup mode the creator can rename beats and change target_pct. The frontend stores these edits in form.beat_overrides keyed by the 0-based array index i (public/pipr.html line 1459-1471: updateBeatOverride(i,...) and form.beat_overrides[idx]=...). The server's buildConfig applies them via beat_overrides[beat.index] where beat.index comes from the template and is 1-BASED (every template in beats.js starts at index:1). So an edit the creator makes to the first beat (stored at key 0) is never found by the server (it looks for key 1), and the edit stored at key 1 (the creator's edit to beat #2) gets applied to beat #1. Result: every deep-mode beat edit is silently shifted by one beat, and the last beat's edit is dropped entirely. The creator's hand-authored beat names/percentages land on the wrong beats — a corrupted beat map that then flows into WritΩr and AssemblΩr.
**Fix:** Make the two sides agree on key base. Simplest: in buildConfig use the 0-based array position instead of beat.index — beats = beats.map((beat, i) => { const override = beat_overrides[i]; ... }). Alternatively change the frontend to key by idx = i+1. Pick one and use it in both create and the edit-structure PATCH path.

### [CRITICAL] Edit-structure PATCH wipes all beat coverage despite UI promising it is preserved
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\public\pipr.html (saveEditedStructure + subEl 'coverage data is preserved') and C:\Users\18054\kre8r\src\routes\pipr.js PATCH handler (Object.assign(config, req.body, ...))
**Problem:** The 'CHANGE STRUCTURE' mode (pipr.html checkEditStructureMode) sets the screen-2 subtitle to 'Your beat map will be rebuilt — coverage data is preserved.' But saveEditedStructure() rebuilds beats client-side with getClientBeats(), which returns every beat with covered:false, needs_coverage:true, and NO coverage_footage_ids. It PATCHes { story_structure, beats, setup_depth } to /api/pipr/:id. The PATCH handler does Object.assign(config, req.body), so the incoming fresh (uncovered) beats array completely replaces the existing beats array that held b.covered / b.coverage_footage_ids / b.out_of_sequence populated by updateBeatCoverage. All footage-to-beat coverage mapping is silently destroyed. This directly violates the Prime Directive (never lose creative state) and the UI actively lies about it. Note a structure CHANGE legitimately invalidates old beat positions, but the data is dropped with no backup and no recovery path.
**Fix:** Either (a) carry coverage forward by re-running updateBeatCoverage(projectId) server-side after a structure change so selects re-map to the new beats, or (b) before overwriting, snapshot the old beats into config.beats_prev (and vault.backupVault already runs — confirm it captures the pre-change config). At minimum, correct the UI copy so it does not claim coverage is preserved when it is wiped.

### [HIGH] updateBeatCoverage can regress pipr_complete from 1 back to 0
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beat-tracker.js line 158-162 (updateProjectPipr pipr_complete: ... covered.length > 0 ? 1 : 0)
**Problem:** beat-tracker.js updateBeatCoverage writes db.updateProjectPipr(projectId, { pipr_complete: story_structure === 'free_form' ? 1 : (covered.length > 0 ? 1 : 0) }). If a re-run of coverage finds zero matched selects (e.g. selects were cleared/re-imported in EditΩr, or footage not yet matched), it flips pipr_complete back to 0 for a project the creator already completed in PipΩr. pipr_complete drives 'needs_attention' in /report and pipeline gating elsewhere, so a finished project suddenly shows as un-planned. pipr_complete should reflect 'the creator finished planning', not 'footage currently covers beats' — those are different concepts conflated here.
**Fix:** Never set pipr_complete to 0 here. Only ever raise it (or drop this DB write entirely and track coverage separately). e.g. only call updateProjectPipr({pipr_complete:1}) when covered.length>0 or free_form, and never write 0.

### [HIGH] beat_scripts keyed by old beat index become mismatched after a structure change
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\routes\pipr.js /report effCovered logic + C:\Users\18054\kre8r\public\pipr.html saveEditedStructure (does not clear/remap config.beat_scripts on structure change)
**Problem:** WritΩr stores per-beat scripts in config.beat_scripts keyed by beat index (writr.js line 1465: config.beat_scripts[beatIndex]=...). report.js coverage logic reads beatScripts[i] positionally against the CURRENT beats array (config.beat_scripts || {}; effCovered = beats.map((b,i)=> ...beatScripts[i]...)). After an edit-structure change (PIPR-2) the beats array is replaced with a different-length structure but beat_scripts keys are NOT remapped or cleared. A script the creator wrote for beat 5 of save_the_cat (15 beats) now incorrectly marks beat 5 of, say, short_pas (3 beats) as covered, or is silently orphaned. The creator's written beat scripts are mis-attributed or invisible.
**Fix:** When story_structure changes, clear config.beat_scripts (with a backup) or remap by beat name. Do this in the PATCH handler when req.body.story_structure differs from the stored one.

### [MEDIUM] matchSectionToBeat proximity fallback marks beats covered even when nothing truly matches
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beat-tracker.js matchSectionToBeat (returns bestPctIdx unconditionally) + updateBeatCoverage line 124 (if beatIdx >= 0)
**Problem:** updateBeatCoverage maps each select to a beat via matchSectionToBeat. When keyword score < 2, the function falls through to nearest-target_pct and ALWAYS returns a beat index (bestPctIdx, never -1). The caller treats any returned index >= 0 as 'beat.covered = true'. So every select forcibly marks its nearest beat as covered regardless of relevance, inflating coverage_pct and hiding genuinely missing beats (including critical ones like 'All Is Lost', 'CTA', 'Hook' that /report specifically watches). The comment in the route says beatIdx>=0 implies a real match, but the function never returns -1, so the 'no match' branch is dead and false-positive coverage is guaranteed.
**Fix:** Return -1 from matchSectionToBeat when both keyword score is low AND pct distance exceeds a threshold (e.g. > 15-20%), so selects that don't plausibly belong to any beat don't fake coverage. Or weight pct match into a confidence and only mark covered above a floor.

### [MEDIUM] readConfig title-match fallback writes config to the wrong project ID, cross-contaminating projects
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beat-tracker.js readConfig lines 22-39 (title match + writeConfig(projectId, cfg))
**Problem:** readConfig, when the direct ID path misses, scans ALL project-config.json files and matches on cfg.title === project.title, then calls writeConfig(projectId, cfg) to 'cache' it under the requested ID. Project titles are not unique (db.createProject does not enforce uniqueness, and a creator can easily have two projects named the same / 'Untitled'). A title collision causes one project's entire beat map, script, and config to be copied onto a DIFFERENT project's ID path — silently overwriting or fabricating that project's creative state. This is a state-corruption path masquerading as a convenience cache.
**Fix:** Do not write the matched config to the requested ID path on a title-only match (titles aren't unique). At minimum require an exact project_id match inside the candidate config (cfg.project_id === projectId) before trusting/caching it, or remove the title-fallback write entirely and just return the read-only match.

### [MEDIUM] PATCH /api/pipr/:id allows arbitrary body fields to overwrite config including beats — no whitelist on the file write
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\routes\pipr.js PATCH /:project_id (Object.assign(config, req.body, ...); writeConfig)
**Problem:** The PATCH handler does Object.assign(config, req.body, { project_id }) then writeConfig — it writes EVERY field the client sends straight into project-config.json. Only the DB sync has an 'allowed' whitelist; the file itself has none. A malformed/partial client request (or a future caller sending e.g. beats:undefined, or a stray field) can clobber beats, script, beat_scripts, or coverage in the canonical config file with no validation. Combined with PIPR-2 this is the mechanism by which coverage is lost; more generally it means any caller can corrupt the beat map by including a 'beats' key.
**Fix:** Whitelist the config fields the PATCH may set (mirror the DB allowed list plus beats/beat_scripts when explicitly intended), and reject/ignore unknown or undefined keys before writeConfig. Guard against replacing a non-empty beats array with an empty/uncovered one unless the structure actually changed.

### [MEDIUM] Id8Ωr pipeline_brief fields (entry_point, content_type, content_angle) not surfaced into the PipΩr beat-map wizard form
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\public\pipr.html checkLoadProject (consumes concept/brief but ignores pipeline_brief.content_type / content_angle for form prefill) vs C:\Users\18054\kre8r\src\routes\id8r.js send-pipeline
**Problem:** Per the connections summary, Id8Ωr writes pb.entry_point, pb.content_type, pb.content_angle into projects + id8r_data. PipΩr's checkLoadProject (?load_project) reads id8r_data and populates title/high_concept and the brief textarea, and reads p.entry_point to auto-advance. But it never reads briefData.pipeline_brief to pre-select content_type (f-content-type) or to choose story_structure based on content_type (short_form vs long_form). So the format/structure decision Id8Ωr already made is dropped, and the creator must re-pick it — and if they pick a long structure for short_form content, the format flag derived from the 'short_' prefix in /create will be wrong. This both loses Id8Ωr intelligence and adds a decision the brief was meant to remove (Secondary Directive).
**Fix:** In checkLoadProject, read briefData.pipeline_brief and pre-fill f-content-type from pb.content_type, and optionally pre-select a default story_structure / setup_depth based on content_type. Carry pb.content_angle into the form so it persists to high_concept_angles.

### [LOW] buildBeatMap drops emotional_function / reality_note from the persisted beats — WritΩr context loses beat descriptions
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\utils\project-context-builder.js buildWritrPromptContext line 121 (b.description) vs beat objects which carry emotional_function/reality_note
**Problem:** buildBeatMap spreads the template (so emotional_function/reality_note are present in config.beats), but buildWritrPromptContext renders beats as `- ${b.name}: ${b.description || ''}` — it reads b.description, which no beat object ever has (templates use emotional_function/reality_note). So the Beat map injected into the WritΩr prompt is just bare names with a trailing ': ', stripping the rich emotional_function guidance that is the whole point of the structural beat map. The intelligence exists in the file but is silently not passed to Claude.
**Fix:** Render `- ${b.name}: ${b.emotional_function || b.reality_note || ''}` (and optionally include target_pct) so WritΩr receives the beat's intent.

### [LOW] Save-the-Cat / several templates have out-of-order target_pct that breaks proximity matching and bar visualization
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beats.js SAVE_THE_CAT (index 3 target_pct:1; duplicate 75/80/30 pairs)
**Problem:** In SAVE_THE_CAT, beat index 3 'Set-Up' has target_pct:1 while index 2 'Theme Stated' is target_pct:5 — Set-Up appears AFTER Theme Stated in the array but at a lower percent. Several templates also have duplicate target_pct (e.g. All Is Lost and Dark Night both 75, Break into Three and Finale both 80, B Story and Fun and Games both 30). matchSectionToBeat's pct-proximity fallback (PIPR-5) and the report's out_of_sequence detection rely on monotonically increasing target_pct; non-monotonic/duplicate values make proximity matching ambiguous (ties resolve to first-seen) and make the frontend bar heights misleading (Set-Up renders as a 1% sliver). Not a crash, but it skews coverage attribution and the visual beat map.
**Fix:** Audit target_pct values so they are monotonically non-decreasing with array order; give 'Set-Up' a value between Theme Stated (5) and Catalyst (10), and nudge duplicate-pct beats apart so proximity matching and out_of_sequence logic are deterministic.

### [HIGH] Id8Ωr's story_structure recommendation is generated then thrown away
**Dimension:** inter-tool | **Location:** src/routes/pipr.js (no read of pb.story_structure); src/routes/id8r.js:1156,1291; public/pipr.html selectStructure()
**Problem:** Id8Ωr's brief prompt explicitly asks Claude for a story_structure recommendation (id8r.js line 1156: 'hook-problem-solution | before-after | day-in-life | tutorial | rant | investigation') and the CONNECTIONS doc confirms pb.story_structure is part of pipeline_brief. PipΩr never reads it. The creator did the research, the model picked a shape, and then PipΩr drops them on a wall of 22 structure cards with no pre-selection and no 'Id8Ωr recommends this' marker. This is the single biggest 'adds a decision' violation: the upstream tool already decided, but the creator must re-decide blind. The decision was made and discarded.
**Fix:** On Id8Ωr load (checkLoadProject), map pb.story_structure to the closest beats.js structure key and call selectStructure() on it, OR surface it in the existing struct-suggest-banner as 'Id8Ωr recommended: <structure>'. Build a string->structure_key map (hook-problem-solution->vsl_arc, before-after->before_after_bridge, tutorial->tutorial_with_stakes, rant->short_hot_take, investigation->documentary_arc, day-in-life->episode_arc). This converts a cold 22-card decision into a confirm-or-override.

### [HIGH] Smart structure suggestion banner is dead for all long-form content
**Dimension:** bug | **Location:** public/pipr.html:1132-1156 (STRUCTURE_MAP, showStructureSuggestion); src/routes/id8r.js:1216
**Problem:** showStructureSuggestion() keys STRUCTURE_MAP off form.content_type with genre keys: rock_rich_episode, educational, vsl, documentary, day_in_the_life, transformation, adventure, emotional_personal, launch, short_form. But Id8Ωr writes content_type = pb.content_type || 'long_form' (id8r.js:1216) — a FORMAT value (short_form/long_form/series), never a genre. So STRUCTURE_MAP['long_form'] and STRUCTURE_MAP['series'] are undefined; only 'short_form' ever matches. For every long-form project the headline 'reduce a decision' feature silently never fires. The creator never sees a suggestion and assumes the feature doesn't exist.
**Fix:** Drive the suggestion from the genre/angle field that actually carries content meaning (high_concept_angles / chosen.angle), not from content_type which is format-only. Or have Id8Ωr emit a separate genre field into id8r_data and key the map off that. Add a fallback so an unmatched content_type still suggests based on format (short -> short_hook_tension_payoff, long -> documentary_arc/save_the_cat).

### [HIGH] rock_rich structure card produces an empty beat map (no template exists)
**Dimension:** bug | **Location:** src/pipr/beats.js:185-212 (getBeats switch, no rock_rich case); public/pipr.html:453,1133,1137
**Problem:** The UI offers a 'rock_rich' structure card (pipr.html:453) and STRUCTURE_MAP suggests it for rock_rich_episode and day_in_the_life content. But beats.js getBeats() has no 'rock_rich' case — it falls through to default and returns []. buildBeatMap returns an empty array, writeConfig stores zero beats, and AssemblΩr/WritΩr get no beat map to work against. The Rock Rich format is Jason's flagship content angle (per CLAUDE.md: 'Gold Rush meets How the Universe Works'), and choosing its dedicated card silently yields no structure. This is a creative-state failure on the highest-value content type.
**Fix:** Add a ROCK_RICH beat template to beats.js and wire it into getBeats() and BEAT_TEMPLATES in pipr.html. The episode_arc template (Cold Open / Episode Promise / Standalone Story / Arc Advancement / Character Moment / The Seed) is close to the documented Rock Rich shape and could be the base. Until added, remove or remap the rock_rich card so it can never produce an empty map.

### [MEDIUM] Beat map ignores Id8Ωr talking_points / story_angle / guardrails when seeding beats
**Dimension:** improvement | **Location:** src/pipr/beats.js:216-228 (buildBeatMap); src/routes/pipr.js buildConfig()
**Problem:** PipΩr has rich upstream intelligence available (briefData.talking_points, story_angle, audience_insight, what_not_to_do, concept_note — all already in id8r_data and project-context.json). buildBeatMap uses NONE of it. It copies a static template verbatim. The beat cards show generic reality_note prompts ('What does life look like at the start?') identical for every project, when Id8Ωr already produced project-specific talking points that could be distributed across beats. The creator re-derives, in their head, the mapping from brief to beats that the system could pre-fill. This makes beat maps better AND removes a decision.
**Fix:** After buildBeatMap, run a lightweight pass (template-match or one Claude call via src/utils/claude.js) that seeds each beat's notes field from Id8Ωr talking_points by position/keyword, and injects what_not_to_do as a guardrail on relevant beats. Even a non-AI heuristic (distribute N talking points across N beats proportionally) would make the beat map project-specific instead of generic.

### [MEDIUM] Beats are created in PipΩr but shoot_takes (DirectΩr/ShootDay) are not seeded from them
**Dimension:** inter-tool | **Location:** src/routes/pipr.js POST /create (creates folders, not shoot_takes); src/db.js shoot_takes table; downstream src/routes/shootday.js
**Problem:** The beat map is explicitly 'what Jason shoots to' (system context). The shoot_takes table is keyed by (project_id, beat_index, beat_name) and is the on-set checklist. PipΩr is where beats are born and is also where the shoot folder is auto-created — yet it does NOT populate shoot_takes from the beat map. shoot_takes is only written later by writr/shootday. This means the creator finishes PipΩr with a beat map but an empty shot checklist; a manual or downstream step must regenerate from beats. PipΩr already does the analogous filesystem automation (shoot_folder, intake folders), so the shot-list seeding is a natural, missing automation in the same code path.
**Fix:** In POST /create, after writeConfig, insert one shoot_takes row per beat (beat_index, beat_name, status 'needed') so ShootDay/TeleprΩmpter open with the shot list already built from the beat map. Guard with the existing unique index on (project_id, beat_index) for idempotency.

### [MEDIUM] Structure performance badges show raw avg views, not which structure suits THIS concept
**Dimension:** improvement | **Location:** public/pipr.html loadStructurePerformance(); src/routes/pipr.js GET /structure-performance; db.getStructurePerformance()
**Problem:** loadStructurePerformance() decorates cards with avg-views badges — good signal, but it is global and concept-blind. It tells the creator 'documentary_arc averages 40k' regardless of whether the current project is a tutorial. Combined with PIPR-01/02, the creator gets popularity data but no guidance tying it to their actual brief. The richest available decision-reducer — 'your investigation concepts using documentary_arc averaged 3x your tutorials' — is not computed even though structure_performance and content_type/angle data both exist.
**Fix:** Segment getStructurePerformance() by content angle/genre, and when an Id8Ωr concept is loaded, highlight the best-performing structure for that genre rather than globally. Promote that into the suggestion banner so the recommendation is evidence-backed and concept-specific.

### [MEDIUM] Beat coverage matching uses fragile keyword/proximity heuristic that mislabels coverage
**Dimension:** bug | **Location:** src/pipr/beat-tracker.js:61-84 (matchSectionToBeat), 118-145 (assignment + out-of-sequence)
**Problem:** matchSectionToBeat (beat-tracker.js:61) matches selects to beats by counting shared words >3 chars (threshold >=2) then falls back to nearest target_pct. Every section gets force-assigned to its nearest-pct beat even with zero keyword overlap, so a beat can be marked 'covered' by an unrelated section. Conversely the out-of-sequence detector flags a beat the moment ANY later section maps to a lower beat index — extremely noisy with the pct fallback. This drives /report's needs_attention and critical_missing flags, so the coverage dashboard the creator trusts can be wrong in both directions (false 'covered', false 'out of sequence'). For the AssemblΩr handoff this is the load-bearing signal.
**Fix:** Require a minimum keyword OR semantic match before marking covered; do not auto-assign via pct fallback (leave unmatched sections unassigned rather than forcing coverage). For richer projects, reuse WritΩr's beat_map_json (which already maps script sections to beats authoritatively) instead of re-deriving the mapping here.

### [MEDIUM] Beat templates are duplicated between server (beats.js) and client (pipr.html BEAT_TEMPLATES)
**Dimension:** simplification | **Location:** src/pipr/beats.js (BEAT_TEMPLATES source of truth); public/pipr.html BEAT_TEMPLATES + getClientBeats + saveEditedStructure
**Problem:** The full beat-template definitions exist twice: server-side in src/pipr/beats.js and client-side as BEAT_TEMPLATES in pipr.html (used by getClientBeats, loadBeatMap, saveEditedStructure, structure-beat-preview). getClientBeats builds beats client-side and saveEditedStructure PATCHes them to the server. Any template edit (e.g. fixing rock_rich, adjusting target_pct) must be made in two places or the client and server beat maps diverge silently — and the edit-structure path persists the CLIENT copy, so the client is authoritative in one flow and the server in another. There is even a /api/pipr/beats-preview endpoint that returns server templates, which the client could use instead of duplicating.
**Fix:** Make the client fetch templates from GET /api/pipr/beats-preview?structure=... (already exists) instead of carrying a copy. Or expose all templates via one endpoint at page load. Eliminates the two-source drift and the bug class where rock_rich exists in one list but not the other.

### [LOW] Save-the-Cat template has out-of-order target_pct values (Theme Stated 5% before Set-Up 1%)
**Dimension:** bug | **Location:** src/pipr/beats.js:5-6 (Theme Stated 5 vs Set-Up 1)
**Problem:** In SAVE_THE_CAT, beat index 2 'Theme Stated' is target_pct:5 but the following beat index 3 'Set-Up' is target_pct:1 — earlier in the timeline than the beat before it. This non-monotonic ordering propagates into target_seconds (buildBeatMap multiplies pct by duration) and directly breaks the proximity logic in matchSectionToBeat and the out_of_sequence detector, since the template itself is 'out of sequence' before any footage is matched. The visual beat-bar heights in the UI (barHeight = max(6,pct)) will also misrepresent position.
**Fix:** Correct the target_pct values to be monotonically non-decreasing (Set-Up likely ~3-8% sitting between Theme Stated and Catalyst). Audit the other templates for the same non-monotonic issue while there.

### [LOW] estimated_duration_minutes drives target_seconds but PipΩr never suggests a duration
**Dimension:** improvement | **Location:** public/pipr.html f-duration input; src/pipr/config-miner.js avg_duration_by_type (computed but unused by PipΩr UI)
**Problem:** buildBeatMap computes target_seconds per beat from estimated_duration_minutes, which feeds WritΩr's target-duration prompt and the shooting plan. But duration is a free-text input the creator must guess, even though the system already has avg_duration_by_type from config-miner and structure performance data. Asking the creator to invent a number when the system can default it from historical patterns adds a decision the Secondary Directive says to remove.
**Fix:** Pre-fill f-duration from config-miner's avg_duration_by_type for the chosen content_type/format (or from structure performance), shown as an editable default ('Most of your tutorials run ~8 min'). Turns a blank guess into a confirm.

### [HIGH] EPISODE_ARC referenced in getBeats() before its const declaration (TDZ)
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beats.js:201 (use) vs :230 (declaration)
**Problem:** In src/pipr/beats.js, getBeats() at line 201 returns EPISODE_ARC for case 'episode_arc', but EPISODE_ARC is declared with `const` at line 230 — AFTER getBeats() (line 185) and AFTER buildBeatMap() (line 216). `const` bindings are in the temporal dead zone until their declaration line executes at module load. Because getBeats is a function (not called at load), the module loads fine, but the FIRST time any project picks story_structure='episode_arc' and PipΩr calls buildBeatMap('episode_arc',...) -> getBeats('episode_arc'), it throws `ReferenceError: Cannot access 'EPISODE_ARC' before initialization`. Wait — actually the const IS initialized by the time any request runs (module finished loading), so at request time EPISODE_ARC is defined. The real latent risk: this works only because all calls are deferred to request time. It is fragile and reads as a bug. Confirm: episode_arc is exported in module.exports (line 244) and listed in getBeats switch (line 201), so it is a live, selectable structure. The const-after-use ordering is a code smell that will break the instant any module-load-time code path calls getBeats('episode_arc').
**Fix:** Move the EPISODE_ARC const block (lines 230-237) ABOVE getBeats() (line 185), alongside the other structure constants. Pure reordering, no logic change. Removes the TDZ footgun and matches the convention of every other structure constant being declared before getBeats.

### [HIGH] Room-revision path double-stringifies beat_map_json, breaking AssemblΩr's Array.isArray check
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\src\routes\writr.js:1135-1157 (produces string) + C:\Users\18054\kre8r\src\db.js:3972 (stringifies again)
**Problem:** writr.js:1135 builds beatMapJson via JSON.stringify(...) -> it is already a STRING. writr.js:1147-1149 fallback also assigns a STRING. That string is passed to db.insertWritrScript({ beat_map_json: beatMapJson }) at line 1157. But insertWritrScript (db.js:3972) unconditionally calls `JSON.stringify(data.beat_map_json)` on it — double-encoding the string into a JSON-string-of-a-string. On read, _parseWritrScript (db.js:4014) JSON.parse's it ONCE, yielding a STRING (not an array). AssemblΩr (assemblr.js:219, 816) gates the entire WritΩr beat-context injection on `writrBeatMap && Array.isArray(writrBeatMap)` — which is FALSE for a string. Result: every room-revision-approved script silently loses its WritΩr beat map in AssemblΩr; Call-1 falls back to 'beat names only' with no scripted per-beat context. This is a silent inter-tool data-loss break (violates Prime Directive). All OTHER insert paths (writr.js:562, 705, 1534; paste-in.js) correctly pass an ARRAY/object and stringify once — only this room-revision path is broken.
**Fix:** Stop pre-stringifying in writr.js. At line 1135 assign the raw array (beatMapJson = markerMatches.map(...)) and at line 1147-1149 assign the already-parsed array (prior.beat_map_json is an array after _parseWritrScript). Let insertWritrScript do the single JSON.stringify. Then beat_map_json round-trips as an array and AssemblΩr's Array.isArray check passes.

### [MEDIUM] Marker-derived beat_map_json uses different field names than AssemblΩr consumes
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\src\routes\writr.js:1135-1139 and :1526-1530 (producers) vs C:\Users\18054\kre8r\src\editor\assemblr.js:221-222 (consumer)
**Problem:** AssemblΩr's mapBeatsInClip (assemblr.js:221-222) reads each WritΩr beat as `bm.beat_index ?? bm.beat_name` for the key and `bm.real_moment || bm.coverage_description` for the scripted note. The 'good' paste-in path (paste-in.js:47,91) emits {beat_name, beat_index, covered, real_moment} — matching. But the room-revision marker path (writr.js:1135-1139) emits {index, beat_name, story_moment} — NO beat_index, NO real_moment. So even after PIPR-02 is fixed, beatScriptMap keys off the beat_name STRING (not numeric index) and the value is always null (story_moment is ignored). The storyboard path (writr.js:1526-1530) emits {name, beat_name, emotional_function, target_pct, story_moment} — also no beat_index/real_moment, same problem. AssemblΩr's per-beat scripted-context injection is therefore dead for these two producers: enrichedBeatList (assemblr.js:226-231) never attaches a scriptNote.
**Fix:** Standardize the beat_map_json contract. Have the marker and storyboard producers emit beat_index (numeric, 0-based to match assemblr's beats[i] index) and map story_moment -> real_moment. Alternatively, teach assemblr.js:222 to also read `bm.story_moment` and assemblr.js:221 to also accept `bm.index` (1-based, subtract 1). Document the canonical writr_scripts.beat_map_json element shape ({beat_index:0-based, beat_name, real_moment}) in a comment in db.js next to the writr_scripts schema so all producers conform.

### [MEDIUM] AssemblΩr coverage results never flow back to PipΩr beat tracker automatically
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\src\editor\assemblr.js (finalise — no updateBeatCoverage call) -> C:\Users\18054\kre8r\src\pipr\beat-tracker.js:90 (updateBeatCoverage only triggered by POST /beats/update)
**Problem:** The coverage feedback loop IS wired correctly field-wise: AssemblΩr writes `selects` rows (script_section, winner_footage_id — db.js:265/269), and PipΩr's updateBeatCoverage (beat-tracker.js:96-133) reads them via db.getSelectsByProject and re-stamps beats[].covered + coverage_footage_ids back into project-config.json. BUT this only runs when someone POSTs /api/pipr/:id/beats/update. AssemblΩr's finalise() does NOT call updateBeatCoverage on completion. So after an assembly run, PipΩr's beat coverage (and the /report endpoint's beats_covered/missing/coverage_pct) is STALE until manually refreshed. The /report endpoint partially compensates by treating a written script as coverage (beat_scripts / hasFullScript at route lines), but footage-level coverage from AssemblΩr is invisible to PipΩr until the manual pull. For a 'reduce decisions' product this is a hidden manual step.
**Fix:** Call updateBeatCoverage(projectId) at the end of AssemblΩr's finalise() (wrapped in try/catch, non-fatal) so PipΩr beat coverage auto-syncs the moment selects are written. This closes the loop without a manual step and keeps the /report dashboard truthful.

### [MEDIUM] matchSectionToBeat keyword matcher cannot align AssemblΩr selects to short-form / abstract beats
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\src\pipr\beat-tracker.js:61-84 (matchSectionToBeat) consuming AssemblΩr-written selects.script_section
**Problem:** PipΩr's updateBeatCoverage maps each select back to a beat via matchSectionToBeat (beat-tracker.js:61-84): it needs >=2 keyword overlaps (words length>3) between the select's script_section label and the beat name+reality_note+emotional_function, else it falls back to pure target_pct proximity. Beat names like 'Hook', 'Payoff', 'CTA', 'Go', 'You', 'Need', 'Take', 'Find' (story_circle / short-form / vsl) are 2-4 chars — filtered out by the `w.length > 3` guard — so keyword matching almost never fires for short-form structures, collapsing everything to pct-proximity. With short-form beats clustered (target_pct 0/5/42/83) and AssemblΩr emitting select labels that are AI-generated section names, the pct fallback will frequently mis-assign coverage. This silently corrupts which beat shows as covered/missing/out_of_sequence in PipΩr's report.
**Fix:** Prefer a deterministic join when available: AssemblΩr already knows the beat_index it assigned each section to (it builds beatPool by index). Persist that beat_index onto the selects row and have updateBeatCoverage trust selects.section_index/beat_index when present, only falling back to matchSectionToBeat for legacy rows. At minimum, lower the keyword length guard or special-case short beat names so 'Hook'/'CTA'/'Payoff' can match.

### [LOW] PipΩr writes high_concept_angles/research_bundle_json but updateProjectPipr guard rejects them
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\src\db.js:3934-3937 (updateProjectPipr allowed list) vs projects.high_concept_angles column
**Problem:** Id8Ωr stamps high_concept_angles via raw SQL (per CONNECTIONS summary) and the projects table has columns high_concept_angles and research_bundle_json (db.js bootstrap lines). But db.updateProjectPipr's allowed-field whitelist (db.js:3934-3937) is: setup_depth, entry_point, story_structure, content_type, high_concept, estimated_duration_minutes, pipr_complete, shoot_folder, folder_path, archive_state, archived_at, format. It does NOT include high_concept_angles. So if PipΩr's PATCH ever tries to sync high_concept_angles to the DB via updateProjectPipr, it is silently dropped (no error). PipΩr's /patch allowed list (route) likewise omits it. The angle data only survives because Id8Ωr wrote it via raw SQL; PipΩr cannot update/correct it through its normal write path. Minor today (PipΩr doesn't currently try), but a latent inter-tool gap if PipΩr ever needs to edit angles.
**Fix:** If PipΩr is intended to own/edit high_concept_angles, add it (and research_bundle_json if applicable) to the updateProjectPipr allowed array and to the PATCH route's allowed list. Otherwise document that high_concept_angles is Id8Ωr-write-only so no one expects PipΩr PATCH to persist it.

### [LOW] PipΩr /report critical-missing beat names are hardcoded and miss most structures
**Dimension:** improvement | **Location:** C:\Users\18054\kre8r\src\routes\pipr.js (/report criticalMissing filter)
**Problem:** The /report endpoint flags critical_missing only for beat names in ['All Is Lost','Break into Three','CTA','Hook'] (route, criticalMissing filter). These names exist only in save_the_cat and vsl_arc. None of the 13 other structures (story_circle 'Change', confession_arc 'The Uncomfortable Truth', short_* 'Payoff', episode_arc 'The Seed', etc.) have a critical beat defined, so needs_attention never triggers on a missing climax/CTA for those structures. The dashboard under-reports risk for the majority of structures.
**Fix:** Mark critical beats declaratively in the beat templates (e.g. add `critical:true` to the climax/CTA beat of each structure in beats.js) and have /report derive critical_missing from beat.critical instead of a hardcoded name list. This makes critical-beat detection work uniformly across all 22 structures.

### [CRITICAL] rock_rich structure produces an EMPTY beat map server-side (silent loss)
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beats.js (getBeats switch, lines 185-212; no ROCK_RICH const) vs client C:\Users\18054\kre8r\public\pipr.html BEAT_TEMPLATES.rock_rich (lines 1235-1243)
**Problem:** 'rock_rich' is the most-promoted structure for Jason: it is the first structure card, the suggested match for both content_type 'rock_rich_episode' AND 'day_in_the_life', and named after his flagship series. The client renders a 7-beat preview from BEAT_TEMPLATES.rock_rich, so the creator sees and confirms 7 beats. But src/pipr/beats.js getBeats() has NO case 'rock_rich' and no ROCK_RICH constant — grep confirms zero matches. So server-side buildBeatMap('rock_rich') falls through to default:return [] and writeConfig persists beats:[]. WritΩr's readConfig().beats is empty, AssemblΩr gets no structural beats, and the coverage report shows beats_total:0. The creator confirmed a beat map on screen 4 and the system saved nothing. Direct Prime Directive violation — creative state (the beat map he's about to shoot to) is lost silently with no recovery path. 'episode_arc' works server-side only because EPISODE_ARC is hoisted, but rock_rich has no constant at all.
**Fix:** Add the ROCK_RICH constant (copy the 7 beats verbatim from pipr.html lines 1236-1242) to src/pipr/beats.js, add case 'rock_rich': return ROCK_RICH; to getBeats(), and export it. This is the single source-of-truth divergence: the canonical fix is to have the client fetch /api/pipr/beats-preview instead of maintaining a duplicate BEAT_TEMPLATES object, so server and client can never disagree again.

### [HIGH] 23 structures presented as a flat manual pick — the suggestion engine is gated behind optional content_type
**Dimension:** simplification | **Location:** C:\Users\18054\kre8r\public\pipr.html — structure-grid (lines 452-695), showStructureSuggestion (1145-1157), STRUCTURE_MAP (1132-1143)
**Problem:** Screen 2 shows 16 long-form + 7 short-form structure cards (23 total) as an undifferentiated wall the creator must scan and choose from. A smart-suggestion banner exists (showStructureSuggestion + STRUCTURE_MAP) that pre-picks the right structure, but it ONLY fires when form.content_type is set — and content_type is an optional dropdown on screen 1 (defaults to blank, no validation requires it). So the default path is: skip content type -> arrive at 23 cards with no guidance -> forced to evaluate all of them. This is the biggest 'forced decision that should be automatic' in the tool. The system already knows the answer (STRUCTURE_MAP maps content_type and Id8Ωr already sends content_type/content_angle) but only uses it opportunistically.
**Fix:** Make the suggestion the default surface: lead screen 2 with the single suggested structure (large, pre-selected) plus a 'Browse all structures' collapse for the rest. Derive the suggestion from content_type when present, and when content_type is blank infer it from high_concept/Id8Ωr brief via a cheap Claude call or keyword map rather than dumping 23 cards. Reduce the cold-start decision from 'choose 1 of 23' to 'confirm or change 1'.

### [HIGH] Screen 3 forces emotional_palette + musical_theme decisions that never feed the beat map
**Dimension:** simplification | **Location:** C:\Users\18054\kre8r\public\pipr.html screen-3 shared fields (lines 774-824); collectFormData (palette/theme); buildConfig writes them but no downstream beat/script consumer
**Problem:** Screen 3 (Content) forces two dropdown decisions — Emotional Palette (17 options + custom) and Musical Theme (13 options + custom) — before the creator can reach the beat map. These fields are not consumed by buildBeatMap, are not read by WritΩr's prompt builders (CONNECTIONS shows WritΩr reads beats/story_structure/high_concept/content_type/duration/entry_point/voice_*, not palette/theme), and are not used until ComposΩr much later in post. Per the Secondary Directive (every feature reduces decisions), asking for scoring/music mood at project-setup is two decisions added at the wrong stage to produce a 'beat map you can shoot to.' They add friction to the critical path with zero contribution to the output.
**Fix:** Remove emotional_palette and musical_theme from the PipΩr critical path. Either drop them entirely from screen 3 or move them to ComposΩr where they are actually used. The minimum viable screen 3 is one content textarea (script / what-happened / hybrid) — and even that should be pre-filled and skippable when arriving from Id8Ωr (it already is, but the two dropdowns remain mandatory-looking).

### [MEDIUM] Stale on-screen copy claims beat maps only exist for 3 structures
**Dimension:** improvement | **Location:** C:\Users\18054\kre8r\public\pipr.html line 837 (div.note-teal in screen-4)
**Problem:** Screen 4's permanent teal note reads: 'Beat maps only show for Save the Cat, Story Circle, and VSL Arc. Free Form skips this screen.' This is false — 20+ structures now have beat templates and render on screen 4. The copy predates the structure expansion. A creator reading it will distrust the beat map they're seeing for any of the other 18 structures, or assume their Rock Rich / Documentary / Hot Take beats are not 'real.' Erodes confidence in the exact moment the tool is asking for confirmation.
**Fix:** Replace with accurate copy, e.g. 'Each beat is a target percentage of your runtime — a guide for what to shoot, not a cage. Free Form skips this screen.' Or remove the structure-name list entirely.

### [MEDIUM] Save the Cat 'Set-Up' beat is out of chronological sequence (target_pct:1 after Theme Stated at 5)
**Dimension:** bug | **Location:** C:\Users\18054\kre8r\src\pipr\beats.js line 6 (Set-Up target_pct:1) and mirror in pipr.html line 1221
**Problem:** In SAVE_THE_CAT (beats.js line 6) beat 3 'Set-Up' has target_pct:1, while beat 2 'Theme Stated' has target_pct:5. The beats are ordered by index but the target percentages go 0,5,1,10... — beat 3's position (1%) is earlier than beat 2's (5%). The coverage engine flags out_of_sequence in the /report endpoint (config.beats.filter(b => b.out_of_sequence)) and screen-4 logic uses target_pct for bar heights and sequencing. Every Save the Cat project will either render a visually inconsistent beat bar or trip needs_attention:true via out_of_sequence in the project report, creating phantom 'this project needs attention' noise on the dashboard for a structurally-correct project.
**Fix:** Set 'Set-Up' target_pct to a value between Theme Stated (5) and Catalyst (10), e.g. 7, or fold Set-Up into the 1-10% window with target_pct:3 and bump Theme Stated. Update both beats.js and the pipr.html BEAT_TEMPLATES mirror. This is almost certainly a typo (1 instead of intended ~7).

### [MEDIUM] Edit-structure mode rebuilds beats from client templates, re-introducing the rock_rich empty-map bug and bypassing server overrides
**Dimension:** inter-tool | **Location:** C:\Users\18054\kre8r\public\pipr.html saveEditedStructure() and getClientBeats(); vs src/routes/pipr.js buildConfig->buildBeatMap
**Problem:** saveEditedStructure() (pipr.html) builds beats client-side via getClientBeats(form.story_structure) and PATCHes them directly into project-config.json, rather than letting the server's buildBeatMap run. This means: (a) if the creator changes structure to rock_rich here, getClientBeats returns the 7 client beats and PATCH persists them — so the SAME structure produces a populated map via edit-structure but an EMPTY map via /create (PIPR-1), an inconsistency that will confuse debugging; (b) duration-based target_seconds (computed only in server buildBeatMap) are never added on this path; (c) it duplicates beat-construction logic in a third place (create path, edit path, client templates). Three sources of truth for 'what are this structure's beats.'
**Fix:** Have edit-structure PATCH send only { story_structure } and let the server rebuild beats via buildBeatMap (the PATCH handler already calls writeConfig and addPiprContext; add a server-side beat rebuild when story_structure changes). Eliminate getClientBeats as a beat source — the client should display server-returned beats, never author them.

### [LOW] Duration captured as a string bucket then coerced with parseInt, silently dropping target_seconds
**Dimension:** simplification | **Location:** C:\Users\18054\kre8r\public\pipr.html f-duration options (lines 384-391); buildConfig parseInt (src/routes/pipr.js); beats.js buildBeatMap totalSecs (line 218)
**Problem:** Screen 1 'Estimated Duration' is a select with string values ('under-5','5-15','15-30','30-60','over-60'). buildConfig and updateProjectPipr do parseInt(estimated_duration_minutes) on these — 'under-5' parseInt is NaN, '5-15' parseInt is 5, etc. So estimated_duration_minutes is stored as null or a misleading lower-bound, and buildBeatMap's totalSecs (used to compute per-beat target_seconds) is null for 'under-5'/'over-60' and wrong for ranges. The creator picks a duration; the beat map's second-level targets — the thing that makes it 'a beat map you can shoot to' — are silently never computed or are based on the wrong number.
**Fix:** Either store a representative integer minute per bucket (under-5->3, 5-15->10, 15-30->22, 30-60->45, over-60->75) so target_seconds is always computable, or change the field to a numeric input. Don't ask for duration and then throw the answer away.
