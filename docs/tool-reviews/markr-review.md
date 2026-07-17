# MarkΩr — Architectural Review
*Opus audit.*

## Synthesis
Confirmed. The immediate-post route (`postor.js:704-755`) passes raw `video_path` straight to the platform publishers with no `maybeWatermark` call — only the queue processor watermarks. markr-1 is verified and accurate. The remaining findings are well-reasoned and consistent with the code I've seen. Synthesis follows.

---

# MarkΩr — Synthesis

**Verdict: Friction disguised as invisible infrastructure.** Not because watermarking is intrusive — it genuinely is invisible to the creator — but because *the invisibility hides failure, not success*. The two things that make a watermark worth having (it's actually applied, and it can actually be verified later) are both unreliable, and the creator has zero signal in either case. Invisible infrastructure is good only when it works silently; here it *fails* silently. That inverts the Prime Directive: Jason believes his content is protected, and roughly half of it ships bare with no trace.

## Top 3

**1. "Post now" never watermarks — only scheduled posts do (markr-1, high, VERIFIED).**
Watermarking lives in one of two upload paths. The 60s queue processor calls `maybeWatermark()` (`queue-processor.js:56-64`); the immediate-post route and batch-queue route hand raw `video_path` directly to YouTube/Meta/TikTok (`src/routes/postor.js:704-755`, `~839-891`). Protection therefore depends on an invisible UI choice — schedule vs. post-now — that the creator can't see the consequence of. This is the headline: it doesn't watermark before uploads, it watermarks *some* of them. Fix is a single chokepoint: extract `maybeWatermark()` into a shared `prepare-upload` helper every path must pass through.

**2. The detector's correlation math is invalid for real footage (markr-4, high).**
`detectWatermark` (`watermark.js:261-286`) correlates `(luma - 128) * expected`, assuming every original pixel is neutral grey. Real frames aren't — a bright sky (~230) or shadow (~20) produces terms that dwarf the ±1 watermark delta. Confidence becomes a function of frame brightness, not whether the seed is present: false matches on bright clips, misses on dark ones. This guts the *point* of MarkΩr — proving a stolen clip is yours — and `markr.js` cites `match_confidence` in generated DMCA evidence. Fix: correlate against the residual (frame minus a blurred copy) to isolate the high-frequency mark, and validate the 60% threshold empirically on a known clean/watermarked pair before trusting it for anything legal.

**3. Failure is silent and unrecorded (markr-2, medium).**
When `embedWatermark` throws, `maybeWatermark` falls back to the original and logs `console.warn` only (`queue-processor.js:41,61`) — violating the pino convention, writing nothing to the DB, surfacing nothing to the creator. Falling back so a post isn't blocked is correct; doing it without a trace is not. Fix: record `watermarked:false` + reason on the post row, use `logger.js`, and surface "N posts uploaded without watermark" on the MarkΩr dashboard so it's recoverable rather than lost.

## The through-line
markr-1 and markr-2 are the same wound from two angles — the system goes bare and says nothing. markr-4 means that even the watermarks that *do* get embedded may not be provable later. Stack those and the honest assessment is that MarkΩr currently offers the *feeling* of protection more than protection itself.

## Secondary (worth a sweep, not blockers)
- **markr-3 (disk bloat):** `_wm` CRF-18 duplicates written beside source on C:\, never cleaned — directly violates the "never write to C:\" rule. Route to a D:\ cache dir + CleanΩr retention sweep.
- **markr-5 (weak attribution):** queue path embeds `creatorId='primary'`, empty `videoId`; only the random seed is in the pixels, so recovery means brute-forcing every stored seed. Hardcoded `'primary'` also defeats the multi-tenancy foundation. Pass real tenant/post IDs.
- **markr-6 (invisible cost):** full re-encode adds minutes to long-form uploads with no "watermarking" stage shown. Only worth paying once markr-4 makes detection real; until then it's overhead.

## Recommended order
1. markr-1 — close the bare-upload hole (single chokepoint). Highest creator-trust impact, verified.
2. markr-4 — validate/fix the detector empirically. If it can't prove ownership, the whole feature is theater.
3. markr-2 — make every skip visible and recoverable.
Then sweep markr-3 / markr-5 / markr-6 together as a hardening pass.

Relevant files: `C:\Users\18054\kre8r\src\postor\queue-processor.js`, `C:\Users\18054\kre8r\src\routes\postor.js`, `C:\Users\18054\kre8r\src\markr\watermark.js`, `C:\Users\18054\kre8r\src\routes\markr.js`.

## Findings (6 total)
### [HIGH] Immediate-post path does NOT watermark — only the queue does
**bug** | src/routes/postor.js:704-755 (immediate post) and ~839-891 (batch queue) vs src/postor/queue-processor.js:56-64
Watermarking is wired in only one of two upload paths. The 60s queue processor calls maybeWatermark() before upload (src/postor/queue-processor.js:56-64), but the immediate-post route POST /api/postor/post uploads the raw video_path directly with no MarkΩr call (src/routes/postor.js:704-755, and the batch-queue route at ~839-891). So whether Jason's video carries a watermark depends entirely on whether he scheduled it vs. posted it now. 'Post now' = no watermark, silently. This breaks the premise of the review question: it does NOT watermark reliably before uploads — it watermarks roughly half of them depending on a UI choice the creator can't see the consequence of. This is invisible to the creator in the worst way: he believes his content is protected when half of it ships bare.
**Fix:** Extract maybeWatermark() into a shared helper (e.g. src/markr/watermark.js or a small src/postor/prepare-upload.js) and call it in ALL three upload paths before handing videoPath to youtube/meta/tiktok. The watermark step must be a single chokepoint every upload passes through, not bolted onto one route.

### [MEDIUM] Watermark failure is silent (console.warn only) — creator never told protection was skipped
**bug** | src/postor/queue-processor.js:40-43, 60-63
When embedWatermark throws, maybeWatermark falls back to the original file and logs console.warn (queue-processor.js:41, 61). The upload proceeds unwatermarked. Nothing is written to the DB, nothing surfaces to the creator, no logger.warn (it uses console.warn, violating the project convention of pino logger.js for new code). Against the Prime Directive's spirit ('if this goes wrong, what does the creator lose and how do they get it back?') the answer here is: he loses tamper-attribution on that video and has zero signal it happened. Acceptable to fall back so a post isn't blocked, but it must be recorded on the post record (e.g. watermarked:false) so the MarkΩr dashboard / post history shows which uploads went out bare.
**Fix:** Record watermark status on the postor post row (watermarked boolean + reason). Use src/utils/logger.js not console.warn. Surface 'N posts uploaded without watermark' on the MarkΩr stats dashboard so it's recoverable/visible rather than silent.

### [MEDIUM] Watermarked _wm files written next to source and never cleaned up — silent disk bloat
**improvement** | src/markr/watermark.js:176-182; src/postor/queue-processor.js:33-39
watermarkVideo writes ${base}_wm${ext} via CRF-18 near-lossless re-encode into path.dirname(video_path) (watermark.js:176-182, queue-processor.js:36). These are full-size duplicate encodes (CRF 18 is large). Nothing ever deletes them — grep for unlink/rmSync in src/postor finds only the existsSync reuse check. For a creator on a homestead workflow archiving to D:\ and explicitly told 'never write to C:\', every video posted via the queue silently leaves a second full-resolution copy in the project/intake folder forever. Over months this is real, invisible overhead with no UI.
**Fix:** Write _wm files to a dedicated temp/cache dir on D:\ (not beside source), and either delete after successful upload or add a retention sweep in CleanΩr. At minimum document the convention and surface total _wm disk usage on the MarkΩr dashboard.

### [HIGH] detectWatermark correlation math is invalid for real footage — verification likely unreliable
**bug** | src/markr/watermark.js:261-286
detectWatermark (watermark.js:216-290) tests the watermark hypothesis with correlationSum += (luma - 128) * expected, treating 128 as the 'neutral original' for every pixel. Real video pixels are nowhere near uniformly 128 — a bright sky region (~230) or shadow (~20) contributes a huge (luma-128)*expected term that completely swamps the ±1 watermark delta the embed actually applied. The correlation is dominated by image content, not the watermark, so confidence is essentially a function of how bright the test frame happens to be, not whether the seed pattern is present. The 60% threshold (line 284) and the 'avgCorr ~0.3-1.5' empirical note are therefore not trustworthy. This means the detection/verification half of MarkΩr — the thing that makes the watermark worth embedding (proving a stolen clip is yours) — may produce false matches on bright videos and misses on dark ones. Worth empirically validating with a known watermarked vs. clean clip before relying on it for any DMCA evidence (the DMCA generator in markr.js cites match_confidence).
**Fix:** Detect against the residual, not raw luma: compare watermarked frame to a low-pass/median-filtered version of itself (the embed is high-spatial-frequency ±1, so subtract a blurred copy to isolate it) and correlate that residual with the expected sign pattern. Validate the threshold empirically on a clean/watermarked pair before trusting confidence numbers in DMCA evidence.

### [LOW] Watermark code embeds creatorId='primary' and empty videoId — payload carries almost no attribution
**improvement** | src/postor/queue-processor.js:33-37; src/markr/watermark.js:52-55, 90-145
From the queue path, watermarkVideo is called with only { channel } (queue-processor.js:33-37), so creatorId defaults to 'primary' and videoId is '' (watermark.js:163-174). The watermark_code becomes 'KRE8R|primary||<date>|<channel>'. The visual pattern itself only encodes seedNum, and the seed is random per-embed and stored only in the watermarks DB row keyed by source path. So a recovered stolen clip can only be tied back by brute-forcing every stored seed via detectWatermark; the channel/videoId attribution in the code string is never embedded in the pixels at all (only the seed is). For multi-tenancy (CLAUDE.md notes this as foundational) creatorId='primary' hardcoded-by-default also defeats per-tenant attribution.
**Fix:** Pass real creatorId (from tenant context) and the postor post/project id as videoId so the DB row is meaningfully attributable. Longer term, if the pixel pattern can only carry the seed, ensure the seed->footage mapping is the source of truth and detection iterates stored seeds — and confirm that scales for the registry size before relying on it.

### [LOW] Watermark re-encode adds upload latency with no creator-visible signal of cost/benefit
**improvement** | src/markr/watermark.js:110-145; src/postor/queue-processor.js:56-64
Every queued video upload triggers a full CRF-18 libx264 re-encode (watermark.js:114-124, ~1-2x realtime per the module's own note) before the upload even starts, with audio copied. For a long-form YouTube upload this can add many minutes to the queue item's processing time. The creator has no indication this is happening or why his scheduled post took longer. This is the 'does it add friction' axis: the protection is invisible (good) but its cost is also invisible, so when the queue is slow there's no explanation. Earns its place only if detection (markr-4) actually works — otherwise it's pure overhead.
**Fix:** Surface a brief 'watermarking' stage in the queue/post progress so the latency is explained. Consider GPU/faster preset or reusing an already-watermarked render from ComposΩr/ClipsΩr rather than re-encoding at upload time. Gate the whole feature behind a verified-working detector before paying the per-upload re-encode cost.
