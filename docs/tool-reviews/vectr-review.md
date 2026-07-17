# VectΩr — Architectural Review
*Opus audit.*

## Synthesis
All three top claims verified against source:
- `getActiveBrief()` (db.js 6105): `WHERE status='active' ORDER BY locked_at DESC` — no age filter. vectr-1 confirmed.
- writr.js 468: only appends `(Locked ${date})` with no discount instruction; line 469 tells Claude to let it "shape" generation. vectr-1 confirmed.
- server.js 1087: `now.getHours()` / `now.getDay()` against a `// 14:00 UTC` comment — local-time bug, and the same pattern repeats at 1107 (`scheduleMorningSync`, also commented UTC). vectr-2 confirmed.

Synthesis follows.

---

# VectΩr Synthesis

**Verdict: Yes — strategic direction genuinely shapes content decisions. The loop is wired and live, not aspirational. But it's an *open* loop that never expires its own output and never grades itself, so its grip on production strengthens with age instead of fading — the opposite of what's safe.**

The mechanism is real and verified in source: a locked vector's `{vector, focus, constraints, avoid}` is injected as a `## STRATEGIC DIRECTION` block into **every** WritΩr script (writr.js 460-471) and **every** Id8Ωr concept pass (id8r.js 479), with explicit instruction to "shape script tone, angle emphasis, and story entry point." This is not a dashboard Jason glances at — it is upstream of what gets written. So the review question ("is the direction actually shaping decisions?") answers itself: **yes, more than Jason probably realizes.** Which is exactly why the failure modes below matter.

## Top 3

**1. Stale vectors never expire and steer with full force forever (vectr-1, high).**
`getActiveBrief()` returns the newest `status='active'` brief with no age filter (db.js 6105). The injected block hands Claude the lock date but zero instruction to discount it (writr.js 468-469). A 3-week-old vector — justified by sync data that has since moved on — drives this morning's script as hard as a vector locked an hour ago. This is the cleanest violation of the Secondary Directive in the tool: a fresh brief *reduces* a decision; a stale one *makes a decision for Jason that he never re-confirmed.* And the Sunday auto-draft, the intended freshness nudge, produces a pre-read banner — it does **not** flag the old brief as stale or force a re-lock. **Cheapest fix: in the injected block, compute days-since-lock and append "this direction is N days old, weight it lightly" past ~14 days.** Highest-leverage single change.

**2. The loop has no closure — vectors are never scored against what they produced (vectr-4, medium, but strategically the most important).**
Each week the advisor argues from a fresh snapshot and locks a new direction with **zero feedback on whether the last direction moved the numbers.** `getAllStrategicBriefs()` exists (brief history is stored) but nothing correlates a brief's `locked_at` window with the performance of videos published under it. Post-Mortem is per-project, not per-vector. This is precisely the "data Jason looks at but doesn't learn from" failure the review question targets — the tool changes behavior based on a snapshot, never on results. **Fix: attribute videos published between the active brief's lock date and now, compare to channel baseline, inject a "LAST VECTOR SCORECARD" block into the advisor + auto-draft prompts.** This is what turns VectΩr from a recommender into a strategy that learns.

**3. Advisor and lock modal speak different languages — Claude never drafts the fields it's meant to co-author (vectr-3, medium).**
The chat prompt says "you help draft the Strategic Brief" but never tells Claude the brief's actual shape; the lock modal is four blank free-text boxes Jason fills by hand (northr.html 2178-2200). So at the exact moment the tool should reduce a decision, Jason has to mentally compress a multi-turn debate into four fields himself — and the locked brief can silently diverge from what was actually argued. Since these four fields are *the payload that steers all of production*, transcription drift here propagates into every downstream script. **Fix: teach the prompt the schema, have it emit a draft, prefill the modal so Jason edits rather than authors.**

(Honorable mention: vectr-2, the `getHours()`-vs-UTC cron bug, is a real verified defect repeated in `scheduleMorningSync` — but it degrades *timing of delivery*, not the strategy itself, so it ranks below the three above.)

## The through-line
All three top issues share one root cause: **VectΩr treats a locked vector as a fact rather than a time-bounded, falsifiable hypothesis.** A hypothesis has an expiry (vectr-1), gets tested against outcomes (vectr-4), and is stated precisely enough to test (vectr-3). Fix those three and the answer to the review question upgrades from "yes, it shapes content — possibly too bluntly and on stale data" to "yes, it shapes content with direction that ages out and proves itself." The wiring is already the hard part, and it's done.

**Relevant files:** `src\routes\vectr.js`, `src\routes\writr.js` (458-472), `src\routes\id8r.js` (477-490), `src\db.js` (6104 `getActiveBrief`, 6117 `getAllStrategicBriefs`), `public\northr.html` (lock modal 2178-2200, banner ~3550-3585), `server.js` (1076-1110 cron).

## Findings (6 total)
### [HIGH] Locked vector never expires — stale strategy silently biases WritΩr/Id8Ωr indefinitely
**workflow-order** | src/routes/writr.js:458-472, src/routes/id8r.js:477-490, src/db.js:6104 (getActiveBrief — no age filter)
The injection is real and well-wired: confirmLockBrief() in northr.html (lines 3550-3585) captures {vector, focus, constraints, avoid}, POST /api/vectr/brief persists it via insertStrategicBrief() (db.js 6089), and BOTH id8r.js (line 480) and writr.js (line 461) call getActiveBrief() and inject a '## STRATEGIC DIRECTION (locked in last VectΩr session)' block into every generation. The loop is NOT theoretical — a locked vector genuinely changes what Jason creates next. BUT there is no staleness/expiry. A brief stays status='active' forever until the next lock supersedes it. Jason is told non-filming days = analytics+strategy, but if he skips VectΩr for 3 weeks, a 3-week-old vector keeps steering every script and concept with equal force. The injected text only appends '(Locked <date>)' — Claude is given the date but no instruction to discount age. This violates the Secondary Directive subtly: the brief reduces decisions only while fresh; when stale it makes a decision FOR Jason that he didn't re-confirm, and the data that justified it (sync cache) has moved on. The weekly auto-draft (Sunday cron) is the intended freshness nudge, but it produces a pre-read banner — it does NOT supersede or flag the old brief as stale, and nothing forces re-lock.
**Fix:** Add a staleness signal. Cheapest: in the injected vBlock, compute days since locked_date and append guidance when >14 days, e.g. 'This direction is N days old and may be stale — weight it lightly and prefer the creator's current concept.' Better: surface a 'vector is N days old' badge on the active-brief-banner in NorthΩr and have the Sunday auto-draft set a stale flag the banner reads. Optionally auto-expire briefs older than a configurable window (status='expired') so getActiveBrief() returns null rather than steering on stale data.

### [MEDIUM] Sunday auto-run fires at server local time, not the documented 14:00 UTC
**bug** | server.js:1087 (now.getHours()), comment line 1080
scheduleVectrAutoRun() (server.js 1076-1103) compares now.getHours() === 14 with the comment '14:00 UTC = 10am ET'. getHours() returns LOCAL time, not UTC. On Jason's Windows machine (US Eastern), this fires at 14:00 local (2pm ET / 18:00 UTC), four hours later than the documented/intended 10am ET — and on the DigitalOcean deploy (likely UTC) it fires at a different wall-clock time than on the desktop. The pre-read may not be waiting when Jason opens NorthΩr in the morning, undercutting the 'fresh brief waiting' design intent. The identical bug pattern likely exists in scheduleMorningSync() just below (TARGET_HOUR=12 also commented as UTC).
**Fix:** Use now.getUTCHours() and now.getUTCDay() to honor the UTC comment, or explicitly convert to the creator's timezone. Same fix for scheduleMorningSync() at line 1107+.

### [MEDIUM] VectΩr chat advisor and the lock modal use disconnected schemas — Claude never drafts the {vector,focus,constraints,avoid} fields it's supposed to help write
**inter-tool** | src/routes/vectr.js:330,318-354 (system prompt) vs public/northr.html:2178-2200 (lock modal)
The chat system prompt (vectr.js 330) says 'Session ends when Jason decides to lock a Strategic Brief — you help draft it', but the prompt never tells Claude the brief's actual shape (vector/focus/constraints/avoid). The lock modal (northr.html 2180-2200) is four blank free-text inputs Jason fills manually. So the advisor cannot pre-fill or even reference the fields it's meant to co-author; Jason must mentally compress a multi-turn debate into four boxes himself. This adds a decision/transcription burden at the exact moment the tool should be reducing it (Secondary Directive), and risks the locked brief diverging from what was actually debated.
**Fix:** Teach the chat prompt the brief schema and have it emit a draft on request (e.g. a 'LOCK:' line or JSON block with vector/focus/constraints/avoid). Then prefill the lock modal from the last assistant turn so Jason edits rather than authors from scratch.

### [MEDIUM] Strategy loop has no closure — locked vectors are never scored against the outcomes they produced
**improvement** | src/routes/vectr.js:558-561 (prev brief passed as context but never evaluated), db.js:6117 getAllStrategicBriefs
The loop is open: VectΩr reads YouTube/email/community data, locks a vector, and biases creation. But nothing ever asks 'did the last vector work?' getAllStrategicBriefs() exists (brief history) yet no module correlates a brief's locked_date window with the performance of videos made under it. Post-Mortem (separate table post_mortem_briefs) is per-project, not per-vector. So Jason gets a strategic recommendation each week with zero feedback on whether prior recommendations moved the numbers — which is precisely the 'data he looks at but doesn't learn from' failure mode the review question targets. The advisor's yield/pushback mechanic argues from current data but is blind to its own track record.
**Fix:** In /sync or /weekly-auto, attribute videos published between the active brief's locked_date and now, summarize their avg performance vs channel baseline, and inject a 'LAST VECTOR SCORECARD' block into the chat + auto-draft prompts so the advisor (and Jason) sees whether the prior direction paid off before setting the next one. This closes the loop and makes the tool change behavior based on results, not just snapshot data.

### [LOW] weekly-auto duplicates /sync logic and omits youtube best_video/recent recency guard — drift risk
**bug** | src/routes/vectr.js:494-533 (duplicate of 32-115)
The sync logic in /weekly-auto (vectr.js 494-533) is a near-verbatim copy of POST /sync (32-115). They have already drifted slightly (the auto version drops the 'no open data'/'no click data' wording and the best_video block formatting differs). Two copies of platform-sync mean future MirrΩr/MailerLite field changes must be made twice; one will be forgotten, silently degrading either the interactive read or the Sunday pre-read. Both also pull only getRecentProjectsWithAnalytics(10) with no date window, so 'this week's read' may reference month-old videos as 'recent'.
**Fix:** Extract a single buildVectrSync() helper in vectr.js (or db.js) and call it from both /sync and /weekly-auto. While refactoring, consider filtering recent videos to a real recency window so the 'weekly' framing is accurate.

### [LOW] No fail-safe if Kajabi/MailerLite/YouTube all return empty — advisor can confidently strategize on zero data
**improvement** | src/routes/vectr.js:174-207 (platformBlock build), 348-352 (prompt demands real numbers)
Every data pull in /sync and /chat is wrapped in try/catch that logs warn and continues (vectr.js 60,86,105). If all three fail (expired tokens, offline), syncCache.data exists but platformBlock is nearly empty, yet the chat advisor's system prompt still instructs it to 'Reference specific video titles and real numbers when making arguments.' Claude will then either hallucinate numbers or argue confidently from nothing — and Jason locks a vector off it. Given the Prime Directive (recovery path) and that this steers real production, an empty-data state should be visible.
**Fix:** Detect when the sync cache is empty/stale (e.g. no youtube.video_count) and either show a 'data unavailable — strategize with caution' notice in the panel or inject a system-prompt line telling Claude to flag that it's operating without fresh numbers rather than inventing them.
