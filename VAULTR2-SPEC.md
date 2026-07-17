# VaultΩr 2.0 — The Editor That Can See
*Spec drafted Jul 14 2026 by Fable from an adversarially-verified deep research pass
(103 agents, 22 confirmed / 3 refuted claims). Companion to EDITR-OVERHAUL-PLAN.md —
this replaces that plan's Phase 3 (per-take visual context) with a local, $0-marginal-cost
architecture, and extends it toward the "paid editor" role in the Rock Rich plan.*

## The Vision (why this exists)
The channel's growth bottleneck is editing throughput, and editing's bottleneck is that
no machine in the pipeline can *see*. Today's vault vision = ~3 sampled thumbnails per
clip through the Claude API — an hour-long clip classified from three coin-flips. Fix
seeing, and the rest follows: accurate bins, semantic footage search, per-take context
for AssemblΩr, and eventually a teachable assistant editor. Jason: "If a model could see,
I could teach it to edit." That is the roadmap. A human editor gets hired later for taste
review and optics, not haystack labor.

## What the research verified (July 2026 state of the art)

**The winning v1 stack — all pieces confirmed against primary sources:**
| Layer | Component | Verified facts |
|---|---|---|
| Shot detection | **PySceneDetect v0.7** (May 2026, breaking release, Py 3.10+) | 5 detectors; AdaptiveDetector = default for handheld/outdoor; emit TIMECODE LISTS, don't physically split (default split re-encodes; --copy is keyframe-bound) |
| Frame sampling | **n=5 equidistant frames per shot**, ranked by Laplacian-variance sharpness (+ LAB luminance) | Production precedent: ~600k hrs processed (arXiv 2506.00667). Weights 0.7/0.3 are a starting config, not gospel (paper self-contradicts) |
| Vision model | **MiniCPM-V 4.5-int4** (8B: Qwen3-8B + SigLIP2-400M) | 3D-Resampler: 6 frames → 64 tokens; int4 ≈ 5–6GB weights (estimate — the 3GB/2GB claims were REFUTED); full dense-video mode needs ~28GB → v2 |
| Fast-triage tier | **MiniCPM-V 4.6** (1.3B, May 11 2026) | Phone-scale, far under 8GB, 128-frame video support — bulk first-pass classifier |
| Serving | **llama.cpp llama-server** (Windows-native) | mtmd accepts image/audio/VIDEO (FFmpeg subprocess, PR #24269); OpenAI-compatible /chat/completions — near drop-in for the existing Claude call (request-shape adapter only) |
| Embeddings/search | **SigLIP-class embeddings → sqlite-vec** | Pure-C SQLite ext, npm w/ Windows vec0.dll (pin version — pre-v1), vec0 virtual tables, KNN via `MATCH ? ORDER BY distance LIMIT k`, brute-force fine at our scale |
| Escape hatch | Claude API (existing) for hero-clip deep analysis | Gemini native-video pricing question produced ZERO surviving claims — unanswered, re-research when needed |

**v2 (justifies a 24–32GB GPU):** MiniCPM-V 4.5 full 128-frame dense mode ·
Qwen2.5-VL 32B · Molmo2 8B (Ai2, video temporal+point grounding, beat Gemini 3 Pro on
video pointing) · LongVU-7B (hour-long video in 8k context @ ~2 tokens/frame — the
architectural answer to our exact problem, but no llama.cpp path; engineering, not config)
· vLLM continuous batching under WSL2 (its defaults are datacenter-sized; not an 8GB tool).

**Honesty ledger:** no verified throughput numbers exist for a 3070 Ti — the "2TB overnight"
math MUST be benchmarked empirically (P0 below). Qwen3-VL / NVIDIA VILA/NVILA/Cosmos /
InternVideo produced no surviving claims — absence ≠ inferiority; recheck at build time.
This field moves monthly.

## Architecture (v1, current hardware)

```
ingest (unchanged)
  └─ Whisper transcription (unchanged — already flowing)
  └─ NEW SHOT LAYER
       PySceneDetect v0.7 AdaptiveDetector → shots table
         (footage_id, shot_idx, start_tc, end_tc)
       ffmpeg: 5 equidistant frames/shot → rank by sharpness → keep top 2-3
       llama-server (MiniCPM-V 4.6 triage → 4.5-int4 where triage is unsure)
         → per-shot description + tags → shot_analysis table
       SigLIP embedding per shot keyframe → sqlite-vec vec0 table
  └─ clip-level summary = synthesized FROM its shots (replaces 3-thumbnail guess)
```

**What each module gains:**
- **VaultΩr:** accurate shot_type/bins at the root; the long-standing "semantic search
  across the vault" TODO ships as `search("excavator stuck in sand")` → timecoded shots
- **AssemblΩr:** Call 2 finally gets per-take visual evidence (overhaul plan's #4 fixed)
- **EditΩr/story binning:** bins built from per-shot truth, not per-hour guesses
- **The teachable editor (P4):** Jason's bin-review corrections + radio-cut picks become
  few-shot examples in the shot-analysis prompts — the model learns HIS taxonomy. Taste
  stays human; the haystack learns to sort itself.

## Phase plan
- **P0 — BENCHMARK ✅ RAN Jul 14 2026 (MiniCPM-V 4.6 Q4_K_M, llama.cpp b10012, RTX 3070 Ti,
  Resolve OPEN):** inference **2.6s/segment → ~1,370 segs/hour GPU-side**, peak VRAM 6.8GB
  (coexists with an active edit session). Descriptions accurate when produced ("man handling
  a trailer covered with a black tarp", "U-Haul being loaded by a forklift", "man near a
  metal gate on a dirt trail" — all correct). FINDINGS THAT SHAPE P1/P2:
  (a) **Qwen3 thinking-mode eats the token budget → empty content.** --reasoning-budget 0
      did NOT disable it on this template; /no_think in-prompt partially works (~45% still
      empty) → adapter needs retry-on-empty + a bigger ceiling + template work. Quality
      tier (4.5-int4, ~5.8GB) still to bench with Resolve closed.
      ✅ **DEFINITIVE FIX (Jul 15):** `--chat-template-kwargs '{"enable_thinking":false}'`
      on llama-server kills thinking at the template level — verified: reasoning=0,
      finish_reason=stop, 68-token answers. Instruction-heavy prompts (people roster)
      had made it CATASTROPHIC (100% empty) before the flag. Baked into vlm.js spawn
      args; retry ladder retained as backstop. /no_think in prompts now redundant.
  (b) **Decode/detect is the real bottleneck, not the AI:** end-to-end 70 segs/hr because
      AdaptiveDetector decodes 4K on CPU at ~0.6x realtime (325s for a 3.5-min 4K clip) —
      but BMD PROXIES detect in 3-4s. Production rule: ALWAYS detect/sample on proxies;
      CPU sat at 29% → run 3-4 clips in parallel; NVDEC hardware decode = future 10x.
  (c) OpenCV misreads BMD .mov durations — use ffprobe (already bundled).
  Backlog math at these numbers: S2 (~2,000 segments) ≈ 90 min of GPU time once decode
  runs on proxies. The 8GB card is VIABLE for the triage tier TODAY; GPU upgrade question
  now hinges only on the 8B-quality tier + dense-video mode.
- **P1 — Shot layer:** PySceneDetect service + shots table + frame sampler (all local,
  CPU-bound, can run now regardless of P0 outcome).
- **P2 — VLM swap:** llama-server adapter beside src/utils/claude.js (same interface,
  local endpoint); triage-then-escalate policy; re-analyze S2 footage first.
- **P3 — Embeddings + search:** sqlite-vec table + /api/vault/search endpoint + UI.
- **P4 — Teach the editor:** corrections-as-training-signal loop; AssemblΩr per-take
  context injection; measure bin accuracy vs Jason's ground truth from bin-review.

## Rules that carry over
- All DB writes through the live server API (CLAUDE.md law) — sqlite-vec loads inside
  the server process, not external tools.
- Engine vs Soul: shot-analysis prompts read taxonomy/angles from creator-profile.json.
- Read-back validation on every write (the near-$920 lesson — CORRECTION per Jason Jul 14:
  the missing-column/silent-discard bug was real, but $920 was the PROJECTED full-vault
  cost, caught by Jason's cost-vigilance BEFORE the spend. The overhaul doc overstates it
  as actual spend. Doctrine stands; tuition ≈ $0 thanks to the human in the loop.)
- Pattern-mine StoryToolkitAI (github.com/octimot/StoryToolkitAI, stalled Feb 2025 but
  closest prior art): frame-embedding search UX, LLM selection→EDL flow, Resolve bridge.

## DOMAIN ANSWERS → DESIGN DECISIONS (Jason, Jul 14 evening — load-bearing)

1. **THE SLOT IS ALGORITHMIC.** Jason's shooting style makes b-roll slots deterministic:
   (a) jump-cut coverage — detect hard cuts between visually-similar talking-head frames
   (embedding similarity across a cut = jump cut = slot); (b) **the 20-second rule — nothing
   holds on screen >20s without a change**, and a "change" may be just a tight punch-in.
   B-rollΩr slot detector = scan the cut for jump-cuts + >20s static holds → emit slots,
   each offering: top-5 vault picks OR "punch-in here" (zoom is a valid fill). No taste
   model needed for WHERE — only for WHICH. Slots also skew CHRONOLOGICAL (b-roll often
   follows shoot order alongside the narration).
   **1b. THE DUAL-CHANNEL GRAMMAR (his highest-retention pattern — "Dave Ramsey" class):**
   b-roll isn't decoration, it's a SECOND LESSON. Two modes beyond noun-illustration:
   (a) VO-conversion — the talking head is him DOING something; the b-roll shows the
   actual functions of that thing and the talk becomes VO over the doing;
   (b) parallel-process — the b-roll walks through the steps of something deliberately
   UNRELATED to the words: audience hears the message while learning a skill by watching.
   Design consequence: B-rollΩr must offer **ARCS, not just shots** — multi-segment
   sequences of one continuous work session (the shot ledger's consecutive 60s windows of
   a task, e.g. the dump-sorting run, ARE the arc supply). A slot fill can be "the next
   4 minutes ride this process sequence," not "insert one clip."
2. **Taste schema = the "why?" box.** Optional one-line freeform "why?" on every select/
   re-bin/cut decision in review UIs. Never mandatory (Secondary Directive — adds zero
   forced decisions). Freeform is fine; an LLM distills patterns from accumulated whys.
3. **MusΩr = music SPOTTING, not music making.** Jason keeps Suno generation (it's fun —
   protected) and final feeling-placement (last pass, his). He pre-generates CUE BUCKETS
   by feeling (work-banger / tension-stomp / ghost / golden-hour / rowdy-anthem...).
   The module: read the locked cut (WhisperX transcript + scene transitions + position in
   story format) → cue sheet: "at 14:20 scene turn → bucket: ghost, enter under line X,
   out on cut Y." Timing conventions are researchable (music-at-25%-of-runtime patterns).
   Montage mode inverts: music first, cut to beat markers (already his practice).
4. **Audience taste loop: first-5-seconds is the signal he trusts** (60s cliff rarely
   moves; avg view duration = the honest metric). Build = post-mortem generator: align
   the published video's retention curve against ITS OWN shot ledger + transcript →
   "viewers left at 4:32 = start of second explainer." MirrΩr has the sync; needs the
   per-video retention-curve pull + the alignment report. Post-mortems + niche docs feed it.
   **4b. BACK-CATALOG SHOT-LOG PASS (Jason was already planning this):** run the published
   videos + Completed Video Projects trees through the same shot ledger. Double payoff:
   (a) much of his b-roll is REUSED from past completed videos — the back catalog IS the
   b-roll library, currently unsearchable; (b) published-video ledgers are the alignment
   substrate for the retention post-mortems. Published MP4s need no proxies — cheap pass.
   ⚠ Creator-Rewards guardrail: reused b-roll inside NEW edits is fine; never repost
   whole existing content to TikTok.
5. **Dailies/production hub = a PWA like HQ** (notification + FEEDBACK: "plan was X, life
   happened, reshuffle tomorrow") — merges ShootDay + DirectΩr + beat-map coverage +
   missed-shot detection. Bigger build; roadmap after P4. Working name: ProducΩr.
6. **Packaging assist: GO.** His best thumbnails match the auto-surfaceable profile
   (sharp, expressive, high-contrast). Add thumbnail-candidate surfacing to the shot
   layer (cheap: already scoring sharpness; add face/expression + contrast score, top-10
   per episode).
7. **SACRED GROUND (the fence):** storytelling and beat ORDER are Jason's. Design
   consequence: **AssemblΩr delivers SCENES — per-beat mini-timelines/compound clips —
   never one welded episode.** He arranges order, changes structure (EP1 beat order will
   change), surfaces the story in the last 5-10%. The machine assembles bricks, never
   the building. Multicam is RISING (Rock Rich eps) → waveform auto-sync grouping moves
   up the priority list.

## THE PEOPLE ROSTER (Jason's ask, Jul 15 — identity conditioning)
Half of every description was wardrobe ("bearded man in plaid shirt and black cap").
Fix shipped same-day at prompt level: KNOWN PEOPLE block (Jason / Cari / 'one of the
kids'), names replace appearance, clothing mentioned ONLY when branded/logo'd (that
detail feeds sponsor-exposure reports and footage dating — keep it), unknown people
stay generic, genre-restating banned. Tokens freed → spent on ACTION + tools +
environment. **Durable design: the roster is SOUL** — creator-profile.json gains a
`people` field (name + role + reference image path); V2+ upgrade = few-shot reference
images per request (MiniCPM is multi-image) so identification is visual, not inferred
from "bearded man" — that's what makes guests/crew never get misnamed.

## THE EDIT GRAMMAR PROFILE (Jason's insight, Jul 15 — promote into V4/V5)
Detected segment boundaries in PUBLISHED videos ≈ Jason's actual cut points — the
back-catalog ledgers are a recording of his editing decisions, not just his footage.
Distill per-creator: **cut-length distribution by video position** (hook vs body vs
close) · **alternation grammar** (TH-hold time before cutaway, b-roll run length,
dual-channel deployment) · **ending signature** (structure of the last 60s across
~100 videos — "how Jason finishes") · **hook anatomy** (first 5s contents — his most
trusted retention signal). Customers: (1) AssemblΩr rough cuts that FEEL like his
(rhythm, not just content); (2) generalizes the planned Rock Rich format-profile
pipeline to the whole catalog; (3) V4 loop: grammar × retention curves = evidence
about which of his instincts actually retain. Storage: the profile is SOUL —
creator-profile.json beside the voice profiles (how he cuts = how he talks).
Caveat: detector recovers CUTS, not dissolves/speed-ramps; treat as the skeleton.

## CORPUS DIVIDENDS (parking lot, Jul 15 — uses the corpus enables for free later)
1. **SOUL EXTRACTION:** derive creator-profile.json from a back catalog — voice from
   transcripts, style from shot ledgers, angles from topic clusters, taste from
   kept-vs-cut. THE multi-tenant onboarding ("drop your videos, receive your soul");
   also the path to Cari's profile for Rock Rich Shows.
2. **FAMILY MEMORY PALACE:** the corpus is accidentally a searchable dated family
   record — kids/land/seasons by meaning. Auto-assembled birthday reels. The living
   successor to the sentimental archive. Costs nothing extra, compounds forever.
3. **SPONSOR EXPOSURE REPORTS:** ledger reads brands off boxes/shirts → "your product:
   14 shots, 6 videos, 11 min screen time, timecodes attached." Contract-closing
   leverage for the solar-sponsor pipeline; an asking MACHINE, not an ask.
4. **KNOWLEDGE MINING:** "my best explanation of X, ever" as a query → book drafting,
   course scripts, Fence Post emails become retrieval not writing.
5. **THE LAND'S TIME MACHINE:** dated descriptions → same-angle then/now pulls
   (finale transformation shots), regen/grant documentation, insurance/dispute
   records. Security-cam Mp4Record archive (D:\sd-archive-*) plugs in.
6. **LICENSABLE B-ROLL LIBRARY:** searchable rights-clean off-grid stock footage as
   an optional future revenue engine ("monetize independence").

## PARKING LOT (Jason, late Jul 14)
- **Strip automatic color-space adjustments — CONFIRMED: the Proxy Generator bakes a
  transform into proxies**, and certain input formats trigger "the neon bug" (wild
  oversaturated colors — classic HDR/HLG-interpreted-as-rec709 gamma mismatch, likely
  the phone's HDR clips). Fix path: audit Proxy Generator output settings; for offending
  formats, generate proxies ourselves via ffmpeg with explicit colorspace flags
  (-color_primaries/-color_trc/-colorspace passthrough). Grade-last doctrine: nothing
  in the pipeline "helps" with color; footage arrives at the grade untouched.
- **Remotion integration (MCP-side, not kre8r engine):** programmatic React-rendered
  video for course/educational/tool content — animated explainers, UI walkthroughs,
  data-driven graphics straight from the tools' own JSON (a /feed plan or solar sizing
  rendered as animated video, course diagrams that update when the tool updates).
  Feeds the Kajabi course layer + systems-course explainer reels. NOTE: the vidIQ MCP
  literally sprouted a `motion_graphics` tool today — evaluate both routes.

## THE BUILD LADDER V1.5→V5 (locked Jul 15 with Jason — "90% of what I always wanted")
*Jul 15 additions to the evidence base: NVDEC detection proxies PROVEN (shotlog2 —
GPU decode + 640p proxy + detect; 3 parallel workers); WhisperX on CUDA = 29x realtime
(torch cu128; the pip CPU-wheel trap is documented); retry-on-empty ladder hit 27/27
non-empty on the 4.5 quality tier; triage tier confirmed running beside an open Resolve.
The scratchpad engines work. The ladder is about making them CIVILIZED — in the engine,
surviving restarts, zero-decision to operate.*

**V1.5 — INTO THE ENGINE (port the proven stack into kre8r proper)**
- `shots` + `shot_analysis` tables (src/db.js migration); all writes via server API
- Detection service: NVDEC detection-proxy → AdaptiveDetector → segments; 3 parallel
  workers; wired to VaultΩr ingest + a backfill queue for existing vault rows
- `src/utils/vlm.js` — the Farmhand adapter beside claude.js: VLM_BASE_URL env
  (local/laptop/cloud interchangeable), retry-on-empty budget ladder, /no_think,
  tier-aware (4.6 triage vs 4.5 quality), llama-server lifecycle manager
  (VRAM-checked spawn/stop — knows when Resolve owns the card)
- WhisperX replaces whisper CLI in the transcription chain; word-level JSON stored
- VaultΩr UI: per-clip shot ledger + plain-text search over descriptions (semantic in V2)
- Bin-review corrections importer (Jason's clicks → vault updates)
- **THE CLASSIFIER SWAP (Jason, Jul 15 — early in the cycle, explicitly):** retire the
  3-thumbnails→Claude flow (`reclassifyById` / `/api/vault/reclassify-missing`) as the
  default. New path: footage WITH a shot ledger derives shot_type/quality/description/
  subjects from its own `footage_shots` + analysis (local synthesis — $0/clip); the
  6k-clip back-catalog chews through via the shot-worker backfill instead of API tokens.
  Claude Vision stays ONLY as the escape hatch: no-ledger footage + hero-clip deep reads.

**V2 — ASK THE FOOTAGE (search + B-rollΩr's brain)**
- sqlite-vec embeddings + `/api/vault/search` + search UI ("excavator stuck in sand")
- B-rollΩr segment-search upgrade: slot detector (jump-cuts + the 20-second law,
  punch-in as valid fill) + **ARC offers** (dual-channel grammar — VO-conversion and
  parallel-process sequences, not single shots)
- Two-step flow enforced: clean radio cut → bounce → fresh WhisperX → placements

**V3 — THE STORY CREW (bricks + bones as product)**
- Story-bones marker harvest as a one-button kre8r↔Resolve bridge (M-key → labeled doc)
- Scene-brick timeline builder: act-map manifest in → verified V1 timelines out
  (the ep1-rebuild flow, productized; AppendToTimeline + read-back doctrine)
- Dossiers: transcript × shot-log interleaved per walk-talk (the scrub accompaniment)
- Full-coverage PTC question generator: acts + gaps in → to-lens card deck out
  (the process-before-write law, mechanized)

**V4 — THE LOOP (analytics feeds the machine)**
- Retention post-mortems: MirrΩr curve × the published video's OWN shot ledger →
  "viewers left at 4:32 = start of second explainer"
- Packaging assist: thumbnail candidates from the shot layer (sharpness+face+contrast)
- Platform intelligence → ClipsΩr hunting orders (e.g. FB's owner-financing winner
  tells the clipper which vein to mine in the never-clipped land videos)

**V4.5 — THE CORPUS BRIDGE (Cyber Jason gets the library, added Jul 15)**
The pipeline's transcripts are the complete word-timecoded record of everything Jason
has said on camera. Bridge: semantic index (same nomic+sqlite-vec stack) over
**PUBLISHED-ONLY** transcript segments → shipped to the land box as vectors (footage
never travels) → Cyber Jason retrieves Jason's REAL words + deep-links video+timestamp
("Jason walks through this at 4:32 of the EG4 video"). Unlocks: CJ+ answers-with-
receipts, member library search by meaning, course-matching, Id8Ωr coverage-gap
reports ("never covered X on camera"). Compounds automatically with every publish.
⛔ HARD GUARDRAIL: public/member-facing retrieval reaches a WHITELIST of published
sources only — never raw vault (kids, aerials past boundary, location, unaired plans,
raw interviews). Whitelist by construction, not blacklist by exception.

**V5 — THE CREW EXPANDS**
- MusΩr: cue-sheet spotting against locked cuts (Suno + final placement stay Jason's)
- ProducΩr: the dailies/feedback PWA (ShootDay+DirectΩr merge, "life happened" reshuffle)
- Multicam waveform auto-sync grouping (Rock Rich eps are increasingly 2-cam)
- The teachable editor: why-boxes + bin corrections + radio-cut picks as few-shot
  taste signal — the model learns HIS taxonomy; taste stays human

**Laws that bind every rung:** proxies-first detection · grade-last (no color transforms
anywhere) · Engine vs Soul (taxonomy from creator-profile.json) · DB writes through the
live API · bricks, never buildings · zero added decisions (Secondary Directive).

## Open questions (from verification)
1. Measured 3070 Ti throughput + true peak VRAM w/ 5-frame batches (→ P0)
2. Gemini video ingestion cost/limits (cloud hatch) — fully unanswered, re-research
3. Qwen3-VL / NVILA / InternVideo3 GGUF availability — recheck before P2
4. Embedding source: reuse the VLM's SigLIP2 tower (free, loaded) vs dedicated encoder
