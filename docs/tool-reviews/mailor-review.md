# MailΩr (M4) — Architectural Review
*Opus audit.*

## Synthesis
Both critical claims confirmed against source: `sendViaMailerlite` sends `version.body`/`version.subject` from `lastBroadcast` (the original AI output, never the edited textarea), and the broadcast path calls `db.saveEmails(pid, { broadcast })` which matches no branch in saveEmails while the function leads with an unconditional DELETE.

# MailΩr Review — Synthesis

## Top 3 by creator impact

**1. (mailor-1, CRITICAL) The email that ships is NOT the email the creator reviewed.**
`sendViaMailerlite()` sends `version.body` / `version.subject` straight from `lastBroadcast` — the raw AI output — while every edit the creator makes lives only in the `.email-body-textarea` (wired to copy buttons, never to send). Inserted links, body edits, and subject changes are all silently discarded at send time, to up to 1,366 community members. The blog path (`publishBlogPost`) already reads from the live DOM correctly; the email send does not. This is a direct Prime Directive violation: reviewed state is lost with no warning. **Confirmed in source (mailor.html:1253, 1275-1276).**

**2. (mailor-2, HIGH) Generating a broadcast silently deletes the project's Day 0/3/7 sequence and saves nothing.**
`db.saveEmails(pid, { broadcast })` (mailor.js:472) hits a payload shape `saveEmails` doesn't recognize (it only reads day0/3/7), so it inserts zero rows — but the function's first statement is an unconditional `DELETE FROM emails WHERE project_id = ?`. So the broadcast is never persisted, and any prior tier sequence for that project is destroyed as a side effect. A timeout mid-generation leaves the creator with nothing recoverable. Second Prime Directive violation. **Confirmed in source (mailor.js:471-473).**

**3. (mailor-3, HIGH) Sends land in MailerLite drafts with no reason given.**
When MailerLite rejects a schedule call — most commonly an unverified sender (and from_email defaults to `creator.email`, which may not be a verified sender) — `mailerlite.js` silently downgrades to draft and shows a generic amber toast. No preflight sender-verification check exists, and the real error is swallowed. The creator believes they published; the email is stuck, undiagnosed, in drafts.

## Verdict

**No — MailΩr does not reliably turn a video publish into an email + blog in under 10 minutes today.**

The *generation* speed is fine (and parallelizing the four content calls per mailor-5 would roughly halve it). The problem is correctness and trust at the two moments that matter most:

- **What you edit is not what gets sent** (mailor-1) — so any review step is theater, and a careful creator can't trust the send.
- **Generating a broadcast can destroy an existing sequence and persist nothing** (mailor-2) — so the work isn't durable.
- **Sends silently fail into drafts with no explanation** (mailor-3) — so even a clean send may not actually go out.

A creator *can* hit "under 10 minutes" only if they skip editing entirely, accept the raw AI subject/body, have a pre-verified sender, and never touch a project that has a sequence. That is not a workflow that "reduces decisions" or "never breaks the creative thread" — it requires the creator to know and avoid three landmines.

**Bottom line:** the pipeline shape is right and the under-10-minute target is achievable, but it is currently blocked by two Prime-Directive-level data-loss bugs (mailor-1, mailor-2) plus a silent-failure diagnosis gap (mailor-3). Fix those three and MailΩr meets the goal; until then it still requires significant manual work — specifically, the creator must copy/paste the edited body out manually to send what they actually reviewed, which defeats the entire native-send value proposition.

**Fix order:** mailor-1 → mailor-2 → mailor-3, then mailor-5 (parallelize) and mailor-4 (broadcast-tab auto-seed) for the speed/decision-reduction win. mailor-7 (dead Kajabi affordance) and mailor-6 (bypassed shared Claude caller) are hygiene, not blockers.

## Findings (8 total)
### [CRITICAL] MailerLite send ignores user's edited email body and inserted links
**bug** | public/mailor.html:1253-1280 (sendViaMailerlite) vs 1846-1876 (bodyTA / Insert Link)
renderBroadcastResults() puts the generated body into an editable .email-body-textarea and provides an Insert Link tool that mutates that textarea. But sendViaMailerlite() reads `const version = lastBroadcast.version_a/b` and sends `version.body` (mailor.html:1253, 1276) — the ORIGINAL unedited AI output. Every edit the creator makes in the textarea, and every link they insert with the Insert Link tool, is silently discarded when the email actually goes out via MailerLite. The textarea value (bodyTA.value) is only wired to the copy buttons, never to the send. This is a Prime Directive violation: the creator loses their edited state with no warning, and what gets emailed to up to 1,366 community members is not what they reviewed on screen. Subject-line edits are also lost (the subject box is a static div, not even editable).
**Fix:** sendViaMailerlite must read the live DOM, not lastBroadcast. Make the chosen version's textarea the source of truth: when mlPickedVersion is 'a'/'b', grab that card's .email-body-textarea.value for html_body. Also make the subject editable (contenteditable or input) and read it live. Mirror the pattern already used correctly in publishBlogPost(), which reads bc-blog-body.innerHTML from the DOM.

### [HIGH] Broadcast save wipes prior sequence emails and saves nothing
**bug** | src/routes/mailor.js:471-473; src/db.js:2713-2714
On the broadcast path, mailor.js:472 calls db.saveEmails(pid, { broadcast: response.broadcast }). But saveEmails (db.js:2713) only reads emailData.day0/day3/day7 and writes those rows. A { broadcast } shape matches none of them — so it inserts zero rows. However, the very first line of saveEmails unconditionally runs `DELETE FROM emails WHERE project_id = ?` (db.js:2714). Net effect: generating a broadcast for a project silently DELETES any previously generated Day 0/3/7 tier sequence for that project and stores nothing in its place. The A/B broadcast pair is never actually persisted despite the code appearing to save it.
**Fix:** Either give saveEmails a dedicated branch for the broadcast shape (store version_a/version_b as their own rows or a broadcast JSON column) or stop calling saveEmails with { broadcast } and persist broadcasts via a separate insert that does not DELETE the sequence rows. At minimum, do not run the unconditional DELETE when the payload contains no day0/3/7 keys.

### [HIGH] No sender-email verification check — silent 'in drafts' failures
**improvement** | src/routes/mailerlite.js:303-307, 347-378
MailerLite refuses to schedule/send a campaign whose from-address is not a verified sender domain; the API returns an error on the schedule call. mailerlite.js:347-378 catches that error and silently downgrades to scheduleStatus='draft' (in_drafts:true). The creator sees an amber 'in MailerLite drafts' toast but is given no reason — the most common real cause (unverified sender, or sender email defaulting to creator.email which may not be a verified MailerLite sender) is invisible. There is also no preflight /status check that the configured from_email is a verified sender. For a creator whose email list is a key owned-audience asset, a send that quietly lands in drafts is a thread-break with no diagnosis.
**Fix:** Add a sender verification preflight: call MailerLite's GET /api/sender-identities (or equivalent) on /status and surface whether from_email is verified. When a schedule call fails, capture and return the actual MailerLite error message in draft_message instead of a generic string, so the UI can tell the creator 'sender not verified' vs 'time in past' etc.

### [MEDIUM] Broadcast tab does not auto-pull from the approved package — only the sequence tab does
**workflow-order** | public/mailor.html:1105-1126 (loadProjectContext)
loadProjectContext() (mailor.html:1105-1126) populates ONLY sequence-tab fields (seq-video-title, seq-video-url, seq-package-title). The broadcast tab's bc-prompt textarea stays empty, so when a creator opens MailΩr from a finished project they must hand-type what the email is about. The package title, hook, script, and approved ClipsΩr hooks ARE injected server-side via project_id, but nothing on the broadcast UI reflects that, and the headline prompt — the one field that most shapes output — gets no seed. This adds a decision/typing step (Secondary Directive: reduce decisions) and makes 'reduce email creation to minutes' depend on the creator re-summarizing content the system already has.
**Fix:** When a project is loaded, pre-fill bc-prompt with a starter line built from the selected package (title + hook) and show a small 'pulled from: <package title>' chip so the creator sees what context the AI already has. Leave it editable. Optionally pre-select the segment based on goal.

### [MEDIUM] Four content types generated sequentially with no streaming — multi-minute blocking call
**improvement** | src/routes/mailor.js:360-475; public/mailor.html generateBroadcast
broadcast runs gen_email (8192 tok), gen_blog (up to 10000 tok deep-dive), gen_community (2500 tok), gen_fb_post (1500 tok) as four sequential awaits (mailor.js:362-469). With all boxes checked + deep dive, that is four serial Claude calls, the longest of which alone can take 60-90s, behind a single POST with no SSE. The UI shows a static 'WRITING…' with no per-item progress (mailor.html generateBroadcast). Against the 'reduce to minutes' goal this is the main latency sink, and a timeout/network blip loses ALL outputs at once with nothing persisted (compounded by finding mailor-2). SequenceΩr already uses SSE streaming per email — broadcast does not.
**Fix:** Run the four independent generations with Promise.allSettled so they execute in parallel (they share no state), or stream each as it completes via SSE (reuse src/utils/sse.js, as SequenceΩr does) so the creator sees the email first while the blog finishes. Parallelizing alone roughly halves wall-clock time.

### [MEDIUM] MailΩr bypasses the shared Claude caller, hardcoding model and re-implementing JSON repair
**inter-tool** | src/routes/mailor.js:32-143
CLAUDE.md mandates src/utils/claude.js for all Claude calls ('never inline fetch'). mailor.js instead defines its own callClaude and callClaudeRaw with inline node-fetch (lines 32-143), hardcoding model default 'claude-sonnet-4-6' and re-implementing the jsonrepair fallback that the shared caller already centralizes. This means MailΩr does not pick up shared improvements (model routing, retry/backoff, token accounting, prompt caching) and drifts from the rest of the pipeline. Notably mailerlite.js:600 DOES use the shared { callClaude } from utils for premiere-email, so the inconsistency is even within the same feature area.
**Fix:** Replace the local callClaude/callClaudeRaw with src/utils/claude.js (it already exposes a raw/text mode for the blog case per the premiere-email usage). Pass explicit maxTokens as the convention requires. Removes ~110 lines and aligns MailΩr with the rest of the pipeline.

### [MEDIUM] Kajabi 'Send via Kajabi' button is dead end — backend is a 501 stub but UI implies it works
**bug** | src/routes/mailor.js:600-611; public/mailor.html:1128-1141 and 1878+
checkKajabiStatus() shows 'Kajabi connected — direct send ready' whenever KAJABI_API_KEY is present (mailor.html:1134-1136), and each A/B card renders a '⚡ Send via Kajabi' button. But POST /api/mailor/kajabi/send returns 501 'not yet implemented' even when the key exists (mailor.js:600-611). Worse, the card's Kajabi button does not call that endpoint at all — it checks /api/playwright/status and opens automator.html (mailor.html:1878+), an entirely different path than the status indicator advertises. The creator is told direct Kajabi send is ready when no such send exists. This is a confusing, broken affordance around a thread the community strategy depends on.
**Fix:** Either implement the Kajabi send or make the UI honest: when the key exists but send is unimplemented, label it 'copy/paste only' and have the button do the AutomatΩr handoff explicitly rather than implying native direct send. Align the status text with what the button actually does.

### [LOW] Unused socialLinksHtml and dead 'all'-group resolution branch
**simplification** | src/routes/mailor.js:274; src/routes/mailerlite.js:294-298
In broadcast, getSocialLinksBlock() destructures html: socialLinksHtml (mailor.js:274) but socialLinksHtml is never used — only the plaintext block is injected. Minor dead binding. Separately, in /send the group resolution loop only runs when !group_ids.includes('all') and otherwise leaves mlGroupIds empty to mean 'whole account' — fine, but there is no validation that a non-'all' selection resolved to at least one real ID, so a stale/missing tier mapping silently falls through to sending to nobody (campaign created with empty groups). Low severity but worth a guard given the bulk-sync resets group IDs.
**Fix:** Drop the unused socialLinksHtml binding. In /send, if group_ids excludes 'all' but mlGroupIds ends up empty, return a 400 ('selected tier groups not found in profile — run groups/sync') instead of creating a campaign targeting no one.
