# StudioΩr — Architectural Review
*Opus audit.*

## Synthesis
Confirmed. `studio_intel_queries` is the only persisted key; `checkStudioProgress()` (the oninput handler) never writes responses or instinct to localStorage. SI-1 holds: pasted Studio answers and Jason's instinct are crash-volatile.

Both critical claims verified. Here is the synthesis.

---

# StudioΩr — Synthesis

## Top 3 (by what they cost Jason)

**1. SI-1 — Pasted Studio answers + instinct are never persisted (CRITICAL, Prime Directive violation).**
StudioΩr's whole premise is that Jason hand-runs 9 "Ask Studio" queries inside YouTube Studio and pastes each answer back, plus types his own audience read. That pasted intel is the most expensive, irreplaceable input in the flow — and it lives only in DOM textareas. Verified: northr.html persists *only* `studio_intel_queries`; the `oninput` handler `checkStudioProgress()` saves nothing. Any SSE error, Claude timeout, Electron nav, tab reload, or the app's own 5-min backup restart wipes all 9 answers and the instinct, and `restoreStudioQueries()` re-renders blank. He re-runs everything from scratch. Fix is cheap: debounce-save `responses + instinct` to localStorage on input, repopulate on restore, clear only on reset/successful synth.

**2. SI-2 — Query generation reads a dead kv key (`vectr_active_brief`), so VectΩr context is silently always empty (HIGH).**
Verified: `vectr_active_brief` appears exactly once in all of `src/` — the read at studio-intel.js:57. Nothing ever writes it. The catch block swallows the miss, so the "Ask Studio" queries are *never* steered by the current strategic brief, even though the wiring looks intentional. VectΩr's real brief is at `db.getActiveBrief().brief_json` (the pattern vectr.js:264 already uses). This directly blunts the verdict question — the queries can't bias toward active strategy because they never see it.

**3. SI-3 — Wrong field names feed half-empty channel data into query generation (HIGH).**
The `youtubeContext` block interpolates fields the db helpers don't return: `video_count` (helper returns `total_videos` → renders "unknown"), `best_video.total_views` (helper selects `.views` → renders 0), and `click_through_rate` (no such column in `getRecentProjectsWithAnalytics` → CTR "unknown" for every video). So the freshness/MirrΩr-integration the brief advertises is priming Claude with "unknown" noise. Fix: align to `total_videos`, `best_video.views`, drop CTR or use `avg_completion_rate`.

(SI-4 double-encoding, SI-5 open-loop angles, SI-6 stale-injection are real but lower-stakes — SI-4 currently "works" by luck, SI-5/SI-6 are enhancement/safety.)

---

## Verdict: Does StudioΩr give Jason one insight he couldn't get from YouTube Studio directly?

**Conceptually yes — but two of the three top bugs are actively suppressing that edge, and one violates the Prime Directive.**

The genuine, defensible edge is **synthesis + injection**, not the raw numbers. YouTube Studio answers 9 questions in 9 silos; StudioΩr fuses those 9 answers *plus Jason's own audience instinct* (which Studio has no field for) into one brief, and then — the part that's actually well-built — pipes the "Inject Into Strategy" paragraph into VectΩr and Id8Ωr concept prompts (vectr.js:244-259, id8r.js:493-506). That cross-tool injection is the one thing Studio can never do: it changes what WritΩr/Id8Ωr draft next. So the answer to the literal question is **yes — the fused, instinct-weighted strategic brief that auto-biases idea generation is an insight Studio cannot produce.**

But the qualifier matters:
- **SI-2 means the queries that gather the intel are blind to current strategy** (dead VectΩr key), and **SI-3 means they're seeded with broken channel stats** — so the "smarter than Studio" input layer is degraded at both ends.
- **SI-1 means the unique input (instinct + pasted answers) is one crash away from total loss**, which is the exact failure the Prime Directive forbids.
- **SI-5 means the brief's most concrete output — three specific next-video angles — dead-ends as prose** Jason must retype into Id8Ωr, so the "could only get this here" insight stops short of becoming action.

**Bottom line:** The differentiated insight exists and is real (instinct-fused brief → auto-injected strategy bias). Fix SI-1 first (it's a Prime Directive breach, trivial to fix), then SI-2/SI-3 to make the intel-gathering actually strategy-aware instead of a wired-looking no-op. Until SI-2 is fixed, StudioΩr is delivering a thinner edge over YouTube Studio than its own UI claims.

## Findings (6 total)
### [CRITICAL] Pasted Studio answers + Jason's instinct are never persisted — PRIME DIRECTIVE violation
**bug** | C:\Users\18054\kre8r\public\northr.html:3668 (generateStudioQueries persists only queries), 3698-3700 (textareas have no persistence), 3726-3736 (synthesize reads textareas but never saves them)
The whole point of StudioΩr is that Jason manually runs 9 Ask Studio queries one-by-one inside YouTube Studio and pastes each answer back into a textarea (studio-resp-${q.id}), plus types his own audience instinct (studio-instinct). This is the single most expensive, irreplaceable creative input in the flow. But the frontend only persists the GENERATED QUERIES to localStorage (northr.html:3668), never the pasted responses or the instinct. If synthesis fails (SSE error, Claude timeout), Electron navigates away, the app's 5-min backup restart fires, or the tab reloads, every pasted answer and the instinct are gone — and restoreStudioQueries() re-renders blank textareas. Jason must re-run all 9 queries in YouTube Studio from scratch. The synthesized brief IS saved server-side, but the raw inputs that produced it are lost the moment anything interrupts. This directly violates 'Never lose creative state. Never break the creative thread without a recovery path.'
**Fix:** On every textarea oninput (checkStudioProgress) and on the instinct field, debounce-save responses + instinct + topic_hint into localStorage('studio_intel_responses'). In restoreStudioQueries(), repopulate each studio-resp-${q.id} textarea and the instinct field from that saved blob. Clear it only in resetStudioIntel() and after a successful synthesize 'done' event. This makes the manual Studio-running work crash-safe.

### [HIGH] /queries reads a dead kv key (vectr_active_brief) that is never written — VectΩr context silently always empty
**inter-tool** | C:\Users\18054\kre8r\src\routes\studio-intel.js:57 (reads 'vectr_active_brief'); compare working pattern at src\routes\vectr.js:264 (db.getActiveBrief().brief_json with .vector/.focus)
studio-intel.js:57 reads db.getKv('vectr_active_brief') to inject the active strategic brief into query generation. But grep across the entire src/ tree shows this key is NEVER written anywhere — the only reference is this read. VectΩr's real active brief lives under db.getActiveBrief()/brief_json (which vectr.js:264 itself uses, with fields .vector/.focus). So StudioΩr's briefContext is permanently empty, the catch block swallows it silently, and the generated Ask Studio queries are never actually steered by current strategy. The integration looks wired but is a no-op. This weakens the answer to the key question: the queries can't bias toward the active strategic direction because they never see it.
**Fix:** Replace the getKv('vectr_active_brief') block with db.getActiveBrief() and read brief_json.vector / brief_json.focus / brief_json.priorities, matching the field names VectΩr actually produces. This makes query generation actually strategy-aware.

### [HIGH] Wrong field names against db helpers — channel performance context is partly blank/garbage
**bug** | C:\Users\18054\kre8r\src\routes\studio-intel.js:31-39 (health.video_count, health.best_video.total_views, v.click_through_rate); db helpers at src\db.js:3566-3620 (returns total_videos, best_video.views) and 3623-3645 (no click_through_rate)
The /queries youtubeContext block reads fields that getGlobalChannelHealth() and getRecentProjectsWithAnalytics() do not return: (a) health.video_count — the helper returns total_videos (and per-platform .count), so 'Total videos' always renders 'unknown'; (b) health.best_video.total_views — the best_video query (db.js:3550) selects 'a.metric_value as views', so the field is .views not .total_views, meaning best-video views always render 0; (c) recent[].click_through_rate — getRecentProjectsWithAnalytics selects total_views/avg_completion_rate/total_comments/total_likes but NO click_through_rate column at all, so CTR always renders 'unknown' for every video. So the 'data freshness/integration with MirrΩr' the brief brags about is fed half-empty numbers, which then prime Claude's query generation with 'unknown' noise.
**Fix:** Use health.total_videos, health.best_video.views, and drop the CTR line (or pull avg_completion_rate which the recent helper actually returns). Verify each interpolated field against the helper's return object.

### [MEDIUM] Double JSON-encoding of the brief in kv_store — works only by every consumer double-parsing
**bug** | C:\Users\18054\kre8r\src\routes\studio-intel.js (synthesize: setKv with JSON.stringify; GET/brief: JSON.parse(raw)); consumers vectr.js:249, id8r.js:497,684
synthesize does db.setKv('studio_intel_brief', JSON.stringify(briefData)). But setKv (db.js:4135) itself does JSON.stringify(value), so the brief is stored double-encoded (a JSON string of a JSON string). getKv (db.js:4130) does one JSON.parse, returning the inner string — NOT the object. It only works because GET /brief, the vectr injector (vectr.js:249), and the id8r injectors (id8r.js:497) all then call JSON.parse(siRaw) a second time. This is inconsistent with every other setKv caller in the codebase (which pass raw objects), fragile, and a trap: any future consumer that follows the normal pattern (treat getKv result as the object) will get a string and break. The DELETE path setKv('studio_intel_brief', null) stores 'null' which getKv parses back to null — that one happens to be fine.
**Fix:** Pass the object directly: db.setKv('studio_intel_brief', briefData), then getKv returns the object and remove the redundant JSON.parse in GET /brief and in both injectors. Pick one convention to match the rest of the codebase.

### [MEDIUM] Brief generation is open-loop — it produces 'Next Video Angles' but cannot push them into SeedΩr/Id8Ωr as ideas
**improvement** | C:\Users\18054\kre8r\src\routes\studio-intel.js:165-167 (## Next Video Angles section is free text in the brief); northr.html:3815 (rendered as textContent only)
Answering the key question directly: the brief DOES inject its 'Inject Into Strategy' paragraph into VectΩr and Id8Ωr concept prompts (vectr.js:244-259, id8r.js:493-506) — that part is genuinely actionable and well-built. BUT the brief's most concrete output, the '🎬 Next Video Angles (Top 3)' with hook + rationale, is pure prose in a textContent div. There is no button to send an angle to SeedΩr/Id8Ωr as a seeded idea, no structured extraction. Jason reads three specific video concepts derived from real audience data and then has to manually retype them into Id8Ωr to act. Per the secondary directive (every feature reduces decisions), this leaves the highest-value output as 'data he looks at' rather than something that changes what he creates next. The injection covers the soft 'bias' path but not the hard 'make this video' path.
**Fix:** Have synthesize also return a structured next_angles array (parse from the brief or ask Claude for JSON alongside the prose), render each as a card in northr with a 'Send to Id8Ωr' button that POSTs a seeded concept. Closes the loop from audience signal to drafted idea.

### [LOW] Staleness is shown but never gates injection — a 60-day-old brief silently steers fresh strategy
**improvement** | C:\Users\18054\kre8r\src\routes\vectr.js:250-256 and src\routes\id8r.js:498-503 (ageHours computed but only used for label, never to gate)
loadSavedStudioBrief warns at >=30 days (northr.html:3805), but the downstream injectors (vectr.js, id8r.js) inject the brief regardless of age — they compute ageHours only for a display label, never to suppress. Since the brief 'persists indefinitely' (the UI even advertises this at line 3751) and there is no scheduled refresh, a months-old audience read can keep biasing every WritΩr/Id8Ωr/VectΩr concept long after it's stale, with only a tiny age tag as a tell. For an analytics tool whose entire value is freshness, stale injection quietly undermines the strategy it feeds.
**Fix:** Add an age ceiling (e.g. skip injection or downgrade to a 'stale — verify' note past 45 days) in both injectors, and surface a NorthΩr nudge to re-run StudioΩr when the brief crosses the threshold.
