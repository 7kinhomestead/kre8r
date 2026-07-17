# CaptionΩr (M3) — Architectural Review
*Opus audit.*

## Synthesis
All claims verified. `/captions-from-vault` ends at :426 with `res.json({ clips: allClips })` — no `project_id` param, no `saveCaptions` call, confirming CAP-2. CAP-4 confirmed: `/captions` only pulls `getApprovedWritrScript` (:267), never `getSelectedPackage` — contrast with M2 packages which server-side pulls cuts (:113), viral clips (:137), script (:154), footage (:164).

The review is accurate. Here is the synthesis.

---

# CaptionΩr (M3) Review — Synthesis

## Verdict on the question
**No — caption quality is neither voice-calibrated nor reliably platform-appropriate, and the default workflow doesn't even persist.** CaptionΩr produces the most *public-facing* copy in the entire pipeline (the literal text 725k TikTok / 54k YT followers read), yet it has the *weakest* voice grounding of any gate stage and zero post-generation platform validation. The infrastructure to fix the biggest gap already exists and simply isn't wired in.

- **Voice-calibrated?** No. WritΩr injects a rich 190-transcript calibration block (signature phrases, fence-post rule, few-shot Jason sentences); M2 injects at least a voiceSummary. M3 hardcodes a single generic line in *both* endpoints — and the two copies have already drifted ("Slips jokes in." present at generate.js:229, absent at :317). Verified.
- **Platform-appropriate?** Partially, and only on a hope. Platform rules exist as English prose in the prompt with no enforcement. Char limits and hashtag ranges are never validated after generation; over-limit captions get copied straight to the platform. Verified.
- **State-safe?** No — and this is the Prime Directive violation. The *default* mode (vault) never saves and dead-ends at Gate B. Verified: `/captions-from-vault` returns `res.json({ clips: allClips })` at :426 with no `saveCaptions` and no `project_id`.

## Top 3 (highest leverage)

**1. CAP-1 — CaptionΩr ignores voice calibration entirely (high).**
The single biggest quality gap. The published copy gets *less* voice context than an internal package draft. The `loadVoiceCalibrationBlock()` helper and the calibration data already exist; CaptionΩr just never calls them. **Fix:** factor `loadVoiceCalibrationBlock` out of the WritΩr-private `src/writr/claude.js` into `src/utils/creator-context.js` and inject it into both caption system prompts, replacing the hardcoded one-liner. This is the highest ROI change in M3 — pure wiring, data already on disk.

**2. CAP-2 — Vault-mode captions are display-only; never saved, never trigger Gate B (high).**
The *default* mode silently produces throwaway output. Generate captions for 5 clips on a non-filming day → "Copy All for Gate B" → amber "No project linked" → dead end, state lost on refresh. Directly violates the Prime Directive (creative state generated then lost) and the Secondary Directive (creator must re-route through manual mode to actually save). **Fix:** accept optional `project_id` in `/captions-from-vault` and call `db.saveCaptions` when present, so Gate B works from either mode. This is the correct fix per the pipeline contract — option (a), not a relabel.

**3. CAP-6 — No per-platform char-limit or hashtag validation (medium, but publish-critical).**
Promoting this above the other mediums because it's the only finding that protects the *output the audience actually sees* against real algorithmic penalties (TikTok truncation, IG hashtag reach), and models routinely ignore soft "under N chars" hints. **Fix:** lightweight post-parse validation — per-platform char ceilings + hashtag-count ranges surfaced as a small amber chip on the offending platform tab ("TikTok 412 chars — over limit"). Cheap, and it removes a manual proofreading decision per platform per clip (Secondary Directive win).

## The unifying root cause
CAP-1, CAP-2, CAP-4, CAP-5, CAP-7 are all the same architectural shortcut: **M3 trusts the client and skips the server-side DB pulls that M2 does.** M2 server-side fetches cuts, viral clips, and the approved script directly (generate.js:112-164). M3 pulls only the WritΩr script (:266-272) and leaves package/angle/persistence to however the tab happened to be opened. Fixing CAP-1 + CAP-2 + CAP-4 together via one shared, project-aware, server-pulling `buildCaptionSystemPrompt(creatorContext)` helper (CAP-7) collapses five findings into one refactor and makes M3 robust regardless of entry point.

## Lower priority
- **CAP-3 (medium):** `sendToPostor()` reads `clipLabel` from `.clip-input-card` DOM that doesn't exist in vault mode → always falls back to `Clip N`, and a mixed manual→vault run can point at a stale card. Read the label from `generatedResults[clipIndex]` instead.
- **CAP-4 (medium):** subsumed by the root-cause refactor above — server-side fetch `db.getSelectedPackage` for the tone anchor when `project_id` is present.
- **CAP-5 (medium):** subsumed by CAP-2's fix — unify on one save path so the mode toggle becomes a mere input-source choice, not two divergent pipelines.
- **CAP-7 (low):** extract the duplicated prompt into one helper (natural home for CAP-1's injection) and swap `console.error` (:291, :428) for pino per CLAUDE.md.

## Relevant files
- `C:/Users/18054/kre8r/src/routes/generate.js` — `/captions` (:208-294), `/captions-from-vault` (:303-431); hardcoded voice at :229 and :317; no package pull; `console.error` at :291, :428
- `C:/Users/18054/kre8r/src/writr/claude.js:145` — `loadVoiceCalibrationBlock()` (the asset to reuse)
- `C:/Users/18054/kre8r/src/utils/creator-context.js` — proposed home for the shared voice block + `buildCaptionSystemPrompt`
- `C:/Users/18054/kre8r/public/m3-caption-generator.html` — `generateFromVault()`, `copyAllForGateB()`, `sendToPostor()`, `setMode()`

## Findings (7 total)
### [HIGH] CaptionΩr ignores voice calibration entirely — the most public-facing copy gets the weakest voice grounding
**bug** | C:/Users/18054/kre8r/src/routes/generate.js:227-237 (and 315-324); helper exists at C:/Users/18054/kre8r/src/writr/claude.js:145
WritΩr injects loadVoiceCalibrationBlock() (src/writr/claude.js:145) into all 5 prompt builders — a rich block built from 190 real transcripts: voice_summary, the_fence_post_rule, sentence_rhythm, 15 signature phrases, the_tangent_move, number_rules, family references, 'what Jason never does', and 6 few-shot 'quintessential Jason sentences'. M2 PackageΩr (generate.js:72-78) injects the lighter voiceSummary + community block via getCreatorContext(). M3 CaptionΩr does NEITHER. Both /captions (generate.js:229) and /captions-from-vault (generate.js:317) hardcode a single generic line: 'Straight-talking, warm, encouraging, genuinely funny. Never corporate. Slips jokes in. Real numbers always.' Captions are the literal published copy that 725k TikTok / 54k YT followers read — yet they receive less voice context than an internal package draft. The voice-calibration data and getVoiceBlock() helper already exist; CaptionΩr just never calls them. This is the single biggest quality gap in the gate pipeline.
**Fix:** Import loadVoiceCalibrationBlock from src/writr/claude.js (or factor it into src/utils/creator-context.js as getVoiceCalibrationBlock so it's not WritΩr-private) and inject it into both caption system prompts, replacing the hardcoded one-liner. At minimum call getVoiceBlock()/voiceSummary from creator-context.js like M2 does. The signature phrases and few-shot examples are exactly what makes captions sound like Jason instead of generic homestead-influencer slop.

### [HIGH] Vault-mode captions are display-only: never saved to DB, never trigger Gate B
**bug** | C:/Users/18054/kre8r/src/routes/generate.js:426 (no save); public/m3-caption-generator.html generateFromVault() + copyAllForGateB()
The default mode on the page (with no project_id) is 'vault' mode. generateFromVault() POSTs to /captions-from-vault, which (generate.js:303-431) does NOT call db.saveCaptions and returns no project_id. The frontend renders results but currentProjectId stays null. So: (1) nothing is persisted to the captions table, (2) copyAllForGateB() hits the `else` branch and toasts 'No project linked — open M3 from M2 to save Gate B', (3) gate_b_approved is never set, so the project can never advance to M4/MailΩr through this path. For a tool framed as the M3 gate stage, the default workflow silently produces throwaway output. This violates the Prime Directive (creative state is generated then lost on refresh) and the Secondary Directive (creator must now re-route through manual mode to actually save).
**Fix:** Either (a) accept an optional project_id in /captions-from-vault and call db.saveCaptions when present, or (b) make the UI clearly label vault mode as 'quick captions, not gate-tracked' and steer project-linked work to manual mode. Given the pipeline contract, (a) is correct: let vault mode attach to the active project and write to the captions table so Gate B works from either mode.

### [MEDIUM] sendToPostor() reads description from .clip-input-card DOM that does not exist in vault mode
**bug** | C:/Users/18054/kre8r/public/m3-caption-generator.html — sendToPostor()
sendToPostor(clipIndex) computes clipLabel via document.querySelectorAll('.clip-input-card')[clipIndex]. Those cards only exist in MANUAL mode (#clips-container). In vault mode the results come from generateFromVault() and there are zero .clip-input-card elements, so originalClip is undefined and clipLabel always falls back to `Clip N` instead of the real filename that's already in generatedResults[clipIndex].description. Worse, if a creator mixes a manual run then a vault run, the index could point at a stale unrelated card. The data is already available in the rendered clip objects (description = filename) — the function reaches into the wrong source.
**Fix:** Read the label from generatedResults[clipIndex] (or the rendered clip object) rather than re-querying .clip-input-card. In vault mode generatedResults entries lack .description on the result object (renderResults gets it from the clips array param) — pass the clip description through consistently so both modes resolve the same way.

### [MEDIUM] M3 does not auto-pull the Gate A selected package or script — relies on caller passing package_title as a string
**inter-tool** | C:/Users/18054/kre8r/src/routes/generate.js:259-272
M2 selects a package and stores it (packages.is_selected=1, db.getSelectedPackage exists). But /captions only uses package_title if the FRONTEND passes it. loadProjectContext() in the HTML does pre-fill package-title from /api/projects/:id/context, so the happy path works — BUT only when M3 is opened with ?project_id. If opened standalone (the default vault flow, or a bookmarked tab), there is no package, no script, no angle. The server endpoint itself never calls db.getSelectedPackage; it trusts the client. Compare M2, which server-side pulls cuts, viral clips, AND the approved WritΩr script directly from the DB. M3 only pulls the WritΩr script (generate.js:266-272) and leaves the package/angle to the client. Result: tone-anchor quality silently depends on how the tab was opened.
**Fix:** When project_id is present, server-side fetch the selected package (db.getSelectedPackage) and use its title + hook + content angle as the tone anchor even if the client omitted them. This makes M3 robust regardless of entry point and matches the auto-pull pattern M2 already follows.

### [MEDIUM] Two competing entry modes with no shared save path create a confusing, friction-heavy gate
**workflow-order** | C:/Users/18054/kre8r/public/m3-caption-generator.html — setMode() / mode switcher; backend split between /captions and /captions-from-vault
The page presents 'From VaultΩr Clips' (default) and 'Manual Entry' as peers, but they behave incompatibly: manual mode is project-aware, saves captions, and drives Gate B; vault mode is project-blind, display-only, and dead-ends at Gate B (see CAP-2). A creator on a non-filming day — the stated pain point — will naturally hit the default vault mode, generate captions for 5 clips, click 'Copy All for Gate B', and get an amber 'No project linked' warning with no obvious recovery. They then have to discover that the OTHER tab is the one that actually advances the pipeline. That's exactly the kind of hidden decision the Secondary Directive says to redesign out.
**Fix:** Unify on one save path: have /captions-from-vault accept project_id and persist like /captions, so BOTH modes advance Gate B. Then the mode toggle is just an input-source choice (transcripts vs typed descriptions), not two divergent pipelines. If a project is active, default to whichever mode has data rather than hardcoding 'vault'.

### [MEDIUM] Caption quality has no per-platform char-limit enforcement or hashtag validation — only prose hints
**improvement** | C:/Users/18054/kre8r/src/routes/generate.js:231-236 (rules); public/m3-caption-generator.html (char-count display only)
Platform rules live only as English in the system prompt ('Under 300 characters', '5-8 hashtags', '150-250 characters'). There is no post-generation validation. The UI shows a char count (caption-char-count) but nothing flags when TikTok blows past 300 or Instagram has 2 hashtags instead of 5-8. For a creator publishing to 5 platforms with real algorithmic penalties (TikTok truncation, IG hashtag reach), silent over/under-limit captions get copied straight to the platform. The model also frequently ignores soft 'under N chars' instructions.
**Fix:** Add lightweight validation after parsing: per-platform char ceilings and hashtag-count ranges, surfaced in the UI as a small amber warning chip on the offending platform tab (e.g. 'TikTok 412 chars — over limit'). Cheap to add, directly protects publish quality, and reduces a manual proofreading decision per platform per clip.

### [LOW] Two near-duplicate caption system prompts drift apart and use console.error instead of pino
**simplification** | C:/Users/18054/kre8r/src/routes/generate.js:231-236 and 319-324; console.error at 291,428
The PLATFORM RULES block and CREATOR VOICE line are copy-pasted between /captions (lines 231-236) and /captions-from-vault (lines 319-324) with subtle differences ('Slips jokes in.' present in one, absent in the other). They will drift. Both endpoints also use console.error (generate.js:291, 428) despite CLAUDE.md mandating src/utils/logger.js (pino) for new code. The PLATFORMS tip strings are then triplicated again in the frontend JS.
**Fix:** Extract a single buildCaptionSystemPrompt(creatorContext) helper (which would also be the natural home for the voice-calibration injection from CAP-1) and reuse it in both endpoints. Swap console.error for logger. Optionally serve the platform tip copy from one shared source to the frontend.
