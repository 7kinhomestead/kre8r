# SoulBuildrΩr — Architectural Review
*Opus audit.*

## Synthesis
All claims confirmed against source. Note one correction to finding sb-4: the live `/status` line is actually `created_at || updated_at` (sb-4's inversion claim holds), and there's no backup before the wholesale write (sb-1 confirmed — `fs.writeFileSync(PROFILE_PATH...)` with only `content_intelligence` preserved). Synthesis below.

---

# SoulBuildrΩr — Synthesis

**What it is:** A wizard (`src/routes/soul-buildr.js`) that interviews a creator, calls Claude, and writes `creator-profile.json` — the "Soul" that the entire Engine reads from. Four write paths: `/generate` (wizard), `/primary/import`, `/update-section` (PATCH), `/collaborator/generate`. Plus `/analyze-voice` (Whisper+Claude).

## Top 3 Findings

**1. [CRITICAL — sb-1] `/generate` writes an engine-incompatible schema and obliterates hand-built soul.**
Verified against the live profile. The wizard emits a *different shape* than the engine reads:
- `content_angles` → **array** `[{name,...}]`; engine has a **keyed object** `{financial:{label,description}}` and reads it via `Object.entries` (creator-context.js).
- `voice` → `{tone_descriptors[]}`; engine reads `voice.summary/traits/never` (all present in live file).
- `audience` → engine uses `audience_profile`.

`fs.writeFileSync(PROFILE_PATH, ...)` is wholesale and preserves **only** `content_intelligence`. So running the wizard destroys `strategic_principles` (the VectΩr filter marked "do not optimize away"), all **6 `voice_profiles`**, `audience_profile`, `seasonal_logic`, `community.tiers`, `integrations`, `kajabi`, `northr_thresholds` — none of which the wizard collects. Direct Prime-Directive violation ("never lose creative state"), and unlike `/primary/import`, `/generate` takes **no backup first**. Fix: deep-merge instead of overwrite; emit the keyed-object/`voice.*`/`audience_profile` schema the engine actually reads; back up before write.

**2. [HIGH — sb-3] No validation + missing required fields = a generated profile fails on next load.**
`/generate` never calls `validateProfile()` (REQUIRED: `instance`, `creator.name`, `creator.brand`). The wizard prompt produces `creator.name` but **not** `creator.brand` and **not** `instance` — both confirmed present in the live file, both required, `brand` read by creator-context (falls back to "Unknown Brand"), `instance` load-bearing for tenancy. A freshly-generated profile is invalid the moment the server reloads it. Fix: route all writes through one `writeProfile()` helper that validates + backs up; add `instance`/`creator.brand` to the schema.

**3. [HIGH — sb-2] The voice the wizard captures never reaches WritΩr.**
Three disconnected voice representations with no source of truth: SoulBuildr's `voice.tone_descriptors`, `voice-analyzer.js`'s `voice_profiles[]`, and `data/voice-calibration.json` (the 190-transcript master that WritΩr actually injects as "highest priority"). SoulBuildr's `/generate` voice output is **dead weight for Jason** — the real voice lives in a file the wizard never touches. Fix: pick one source of truth (have analyze-voice refresh `voice-calibration.json`/kv, or explicitly scope SoulBuildr to new-tenant onboarding only and document it).

*(Remaining: sb-4 inverted `last_updated` [confirmed: `created_at || updated_at`, and live file has no `meta` so it returns null], sb-5 shallow-merge corrupts object-shaped sections with no allowlist/backup [confirmed], sb-6 synchronous Whisper blocking, sb-7 duplicated raw fetch bypassing claude.js, sb-8 inconsistent SSE error frames.)*

---

## Verdict: Is the creator profile actually powering the Engine vs Soul separation?

**Partially — and SoulBuildrΩr is the weakest seam in it, not the proof of it.**

The separation is *real on the read side*: the engine consistently sources Soul from `creator-profile.json` via `creator-context.js`, and the live file is a rich, hand-tuned Soul (strategic_principles, 6 voice_profiles, seasonal_logic, community tiers, audience_profile). Downstream modules genuinely don't hardcode Jason — they read the profile. That half of the directive holds.

But SoulBuildrΩr — the tool whose *entire job* is to author the Soul — **does not speak the Engine's schema.** It writes a flat, array-based, validation-skipping shape that the readers can't consume, preserves almost nothing, and takes no backup. So the profile is powering the separation *despite* SoulBuildrΩr, not *through* it. Worse, the most important Soul dimension — voice — is split across three stores, and the wizard's voice output is the one WritΩr ignores. For Jason today this is latent (he hand-built the file and won't run the wizard). But the moment SoulBuildrΩr is used to onboard the first real tenant, it produces a profile that is simultaneously invalid (no `instance`/`brand`), engine-illegible (wrong `content_angles`/`voice` shape), and — if pointed at an existing file — destructive. **The Soul is well-separated; the Soul *authoring tool* is not yet a trustworthy citizen of that separation.** Fixing sb-1/sb-2/sb-3 (single validating+merging `writeProfile()` helper emitting the canonical schema, one voice source of truth) is what would make the Engine/Soul boundary actually multi-tenant-ready rather than single-creator-by-accident.

Key files: `C:\Users\18054\kre8r\src\routes\soul-buildr.js`, `C:\Users\18054\kre8r\creator-profile.json`, `C:\Users\18054\kre8r\src\utils\creator-context.js`, `C:\Users\18054\kre8r\src\utils\profile-validator.js`, `C:\Users\18054\kre8r\src\writr\claude.js`, `C:\Users\18054\kre8r\data\voice-calibration.json`.

## Findings (8 total)
### [CRITICAL] SoulBuildr /generate produces a schema incompatible with the live profile and silently destroys hand-built sections
**bug** | src/routes/soul-buildr.js POST /generate (fs.writeFileSync(PROFILE_PATH...)); contrast creator-profile.json schema + src/utils/creator-context.js getVoiceBlock/getCreatorContext
The live creator-profile.json (the soul that actually powers the engine) uses: voice.summary/traits/never, content_angles as a KEYED OBJECT ({financial:{label,description}}), audience_profile (not audience), plus strategic_principles, voice_profiles[], seasonal_logic, community.tiers, integrations, content_intelligence, northr_thresholds. SoulBuildr POST /generate writes a totally different flat schema: voice.tone_descriptors[], content_angles as an ARRAY, audience.avatar_name, setup{}, publishing{}. It does fs.writeFileSync(PROFILE_PATH, ...) wholesale, only preserving content_intelligence. So if Jason ever runs the wizard, it OBLITERATES strategic_principles (the VectΩr filter, explicitly marked 'do not optimize away'), the 6 hand-tuned voice_profiles, audience_profile, seasonal_logic, community tiers, mailerlite group IDs, and kajabi config — none of which the wizard collects or regenerates. This directly violates the Prime Directive ('never lose creative state'). The downstream readers (creator-context.js getVoiceBlock reads voice.summary/traits/never; getCreatorContext reads content_angles via Object.entries) expect the OBJECT schema, so a wizard-generated profile would also break content-angle rendering (Object.entries over an array yields index keys) and voice blocks (no .summary/.traits).
**Fix:** Two-part: (1) Never wholesale-overwrite. Deep-merge wizard output into the existing profile, preserving strategic_principles, voice_profiles, audience_profile, seasonal_logic, community, integrations, kajabi, northr_thresholds (same pattern already used for content_intelligence). (2) Make the wizard emit the SAME schema the engine reads: content_angles as a keyed object, voice.summary/traits/never, audience_profile. Back up to creator-profile-backup-before-generate.json first (the import path already does this — generate does not).

### [HIGH] SoulBuildr voice output is disconnected from what WritΩr actually uses for voice
**inter-tool** | src/routes/soul-buildr.js POST /generate + /analyze-voice vs src/writr/claude.js loadVoiceCalibrationBlock (reads data/voice-calibration.json) vs src/writr/voice-analyzer.js (writes voice_profiles[])
SoulBuildr's whole pitch is capturing the creator's voice, but WritΩr (the primary voice consumer) does NOT read voice fields from creator-profile.json at all for the heavy lifting. loadVoiceCalibrationBlock() (src/writr/claude.js) reads data/voice-calibration.json (the 190-transcript master) via kv_store, injected as 'highest priority' into all 5 prompt builders. Separately, src/writr/voice-analyzer.js writes voice_profiles[] into creator-profile.json. SoulBuildr writes voice.tone_descriptors/writing_style. That's THREE independent voice representations (voice-calibration.json, voice_profiles[], voice.*) with no single source of truth. SoulBuildr's analyze-voice endpoint runs Whisper+Claude to build a rich voice_profile but its primary /generate path never feeds voice-calibration.json — so the voice work the wizard does for the PRIMARY creator never reaches the writer. For Jason specifically, SoulBuildr's voice output is dead weight: the real voice is in voice-calibration.json built by a different script.
**Fix:** Decide one source of truth for primary-creator voice. Either: (a) have SoulBuildr's analyze-voice path also write/refresh data/voice-calibration.json (and kv 'voice_calibration') so the wizard's voice work actually drives WritΩr, or (b) explicitly scope SoulBuildr to collaborators + onboarding new tenants and document that Jason's voice is owned by voice-calibration.js. Right now it silently does neither.

### [HIGH] /generate writes the file even when downstream-required sections are absent, with no schema validation
**bug** | src/routes/soul-buildr.js POST /generate (no validateProfile call, prompt schema omits 'instance' and 'creator.brand'); src/utils/profile-validator.js REQUIRED
POST /generate parses Claude's raw JSON and immediately fs.writeFileSync to PROFILE_PATH with zero validation. It does not run profile-validator.js validateProfile(), which enforces REQUIRED ['instance','creator','creator.name','creator.brand']. The wizard prompt produces creator.name and creator.channel but NOT creator.brand and NOT instance — both required by the validator and both read by creator-context.js (brand) and tenant logic (instance). So a freshly generated profile would fail validation on next server load / break getCreatorContext brand resolution (falls back to 'Unknown Brand'). The generate path and the import path (POST /primary/import) are also inconsistent: import sets profile.type='primary' and backs up first; generate does neither.
**Fix:** Before writing, run validateProfile() and reject (SSE error) on failure. Add instance (slug from channel/handle) and creator.brand to the generated schema. Reuse the import path's backup step. Consider routing all writes through one writeProfile() helper that validates+backs up.

### [MEDIUM] status endpoint last_updated logic is inverted — shows created_at over updated_at
**bug** | src/routes/soul-buildr.js GET /status: last_updated: profile.meta?.created_at || profile.meta?.updated_at
GET /status returns last_updated: profile.meta?.created_at || profile.meta?.updated_at. created_at is checked FIRST, so once a profile has both, the UI always shows the original creation date and never reflects edits made via PATCH /update-section (which sets meta.updated_at). The label says 'last_updated' but the value is effectively 'created_at'. Also, Jason's live profile has neither meta.created_at nor meta.updated_at (it uses top-level 'created':'2026-03-28'), so status shows last_updated:null for the real creator.
**Fix:** Prefer updated_at: profile.meta?.updated_at || profile.meta?.created_at || profile.created || null.

### [MEDIUM] PATCH /update-section can corrupt object-schema sections by shallow-merging incompatible shapes
**bug** | src/routes/soul-buildr.js PATCH /update-section
PATCH /update-section does profile[section] = {...(profile[section]||{}), ...data}. For content_angles this is dangerous: the live schema is a keyed object of {label,description,emoji}; a shallow spread with partial data silently merges mismatched keys and can leave a half-array/half-object hybrid that Object.entries in creator-context.js renders wrong. There is also no allowlist of sections — any caller can overwrite arbitrary top-level keys including strategic_principles or meta. No backup is taken on this write path either.
**Fix:** Allowlist editable sections; for array/object-shaped sections replace rather than spread (or deep-merge with shape awareness); take a backup before write; never allow patching meta/strategic_principles/instance through this generic endpoint.

### [MEDIUM] analyze-voice runs synchronous Whisper (up to 10 min/clip, 6 clips) inside the request with no SSE heartbeat or cancel
**improvement** | src/routes/soul-buildr.js POST /analyze-voice (execSync ffmpeg + whisper, 6 files x 10min)
POST /analyze-voice uses execSync for ffmpeg (120s) then Whisper (600s) per clip, up to 6 clips — potentially ~60 min blocking the Node event loop region for that request, with the only progress being one SSE line per clip completion. execSync blocks the worker; long Whisper runs with no heartbeat will hit proxy/Electron idle timeouts and the client cannot cancel. This is the heaviest operation in an 'infrastructure' tool that is run rarely, so reliability matters more than speed.
**Fix:** Reuse the existing transcribe-queue infrastructure (src/vault/transcribe-queue.js) instead of inline execSync, or at minimum spawn async + emit periodic SSE heartbeats so the connection survives and the user sees per-clip progress. Cap total clips/duration and surface an estimate.

### [LOW] Two near-duplicate raw Claude fetch blocks bypass the shared claude.js caller mandated by CLAUDE.md
**simplification** | src/routes/soul-buildr.js POST /generate and POST /collaborator/generate (inline node-fetch)
CLAUDE.md: 'src/utils/claude.js for all Claude calls — never inline fetch.' POST /generate and POST /collaborator/generate each hand-roll the same node-fetch call to api.anthropic.com with duplicated headers, model env fallback, fence-stripping, and JSON-recovery logic. analyze-voice already correctly uses callClaude(). The justification comment ('we need full text not JSON parse') is weak since both paths ultimately JSON.parse the result anyway — exactly what callClaude does.
**Fix:** Route both through callClaude(prompt, maxTokens) like analyze-voice does; delete the duplicated fetch/fence-strip/JSON-recovery code. Reduces 3 voice-JSON code paths to one.

### [LOW] No SSE error frame is delivered as a terminal event; client can hang on generate errors
**workflow-order** | src/routes/soul-buildr.js POST /generate catch/finally vs POST /collaborator/generate
In POST /generate the catch writes a {type:'error'} frame then finally res.end(), but unlike collaborator/generate it does not also guarantee the headers/keep-alive contract on early throw before headers flush, and there is no 'done' sentinel distinguishing error-end from success-end consistently across the two generate endpoints. Minor, but the two SSE generators have drifted (different sse() helpers, different error handling), making the wizard's failure UX inconsistent.
**Fix:** Standardize SSE error handling across all four SSE endpoints (shared helper from src/utils/sse.js per CLAUDE.md conventions), always ending with a terminal frame the client can key off.
