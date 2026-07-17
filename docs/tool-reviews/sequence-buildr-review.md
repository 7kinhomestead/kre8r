# SequenceBuildr — Architectural Review
*Opus audit.*

## Synthesis
Confirmed: community.js has no sequence/nurture/push linkage (the 8 hits were "mailerlite"-unrelated). All claims verified. Here is the synthesis.

---

# SequenceBuildr (SequenceΩr) — Review Synthesis

Verified every finding against `src/routes/sequence-builder.js` and `src/routes/community.js`. All six are real; the code matches the descriptions exactly.

## Top 3 (ranked by Prime/Secondary Directive impact)

**1. SB-1 — Failed `/write` strands the sequence in `status='writing'` forever (HIGH).**
The `/write` catch block (line 440–442) does *only* `log.error(...)`. It never resets status, never emits an `{type:'error'}` SSE event, never calls `done()`. Contrast the `/plan` handler (lines 317–325) which does all three. Any mid-loop `callClaude` failure (timeout, rate-limit, bad JSON) leaves the DB row permanently "writing" with a truncated stream and no retry button. **This is the cleanest Prime Directive violation in the tool** — broken creative thread, zero recovery path. Fix is to mirror `/plan`'s catch: send error event, set status to `write_failed` (or back to `approved` so the Write button returns), and `res.end()`.

**2. SB-2 — No push/export path; finished emails are clipboard-only (HIGH).**
The tool authors voice-matched email bodies but the only exits are `sqCopyEmail` (clipboard, HTML-stripped) and per-email Revise. There is no `POST /:id/push` despite MailΩr's `/api/mailerlite/send` already creating draft campaigns. **This is the "does it earn its place" verdict** — it saves the *writing* but not the *wiring*, reintroducing the exact admin layer the project exists to delete (Prime Directive context, Secondary Directive). Add a "Push to MailerLite drafts" action reusing the existing caller, or at minimum a "Copy whole sequence" button.

**3. SB-3 — Zero linkage to the Rock Rich community game / lurker-nurture strategy (MEDIUM).**
Verified: `community.js` contains no `nurture`/`sequence`/`push` references, and `buildStrategistSystem` takes `audience` as a free-text string only. The `convert`/`reengage` goal types map exactly onto the 1,332 progress_score-25 lurkers, but no community cohort data (tier breakdown, lurker count) is fed into the strategist prompt. This is the strategic gap: SequenceBuildr is the obvious *engine* for the documented lurker-nurture play but isn't wired to it. Fix Engine/Soul-clean by *sourcing* community snapshot data into the prompt, not hardcoding.

*(Runner-up SB-4 is closely tied to SB-1: non-JSON Claude output silently persists an empty-body email and reports "done" — it should throw into SB-1's fixed error path. SB-6, one corrupted `plan` row 500s the whole list and hides every sequence, is a small, high-value defensive fix.)*

## Verdict: Does it serve the community strategy?

**Conditionally yes — but not as shipped.** The tool is the *right engine* for the documented lurker-nurture sequence and the free→paid (Greenhouse→Garden→Founding 50) conversion play; goal types `convert`, `reengage`, and `nurture` map directly onto the community game. But three gaps stop it from serving that strategy today:

- It can't deliver (SB-2): no push to MailerLite/Kajabi means every nurture email is hand-pasted — the strategy stalls at the wiring.
- It isn't aware of the community (SB-3): no lurker cohort or tier data reaches the strategist, so the "audience" is a guess.
- It can silently fail mid-write (SB-1/SB-4): a nurture sequence the creator believes is queued may be half-written or blank with no signal.

**Close SB-2 and SB-3 and it becomes the backbone of the lurker-nurture engine; close SB-1/SB-4 first so it can be trusted to run unattended on a weekly cadence.** Until then it's a strong drafting assistant that doesn't yet plug into the strategy loop. Also flag SB-5: two overlapping sequence systems in `mailor.html` (legacy `/api/mailor/sequence` vs SequenceΩr) force the creator to choose — pick one and retire the other before this drifts.

## Findings (6 total)
### [HIGH] Failed /write leaves sequence permanently stuck in 'writing' status with no recovery
**bug** | src/routes/sequence-builder.js — POST /:id/write catch block (only `log.error(...)`, compare to /plan which sends a {type:'error'} SSE event and ends the response)
POST /api/sequences/:id/write sets status='writing', then loops calling Claude per email. If any callClaude call throws mid-loop (timeout, rate-limit exhaustion, bad JSON), the catch block only does log.error — it never resets status, never sends an SSE {type:'error'} event, and never re-ends the response cleanly. The DB row stays status='writing' forever. On next GET the sequence looks like it's perpetually writing with no button to retry and no error shown. This is a direct Prime Directive violation: the creative thread is broken (partial/zero emails) with no recovery path. The frontend write handler also only catches network-level errors; a server-side mid-stream failure after headers are flushed surfaces as a silently truncated stream.
**Fix:** In the /write catch: send({type:'error', error: err.message}) if the stream is open, set status back to a recoverable state (e.g. 'approved' so the Write button reappears, or a distinct 'write_failed'), and call done()/res.end(). Mirror the error handling already present in the /plan handler. Frontend should render a retry affordance when status is write_failed.

### [HIGH] No push/export path — written emails are copy-paste only, despite MailerLite API already wired in MailΩr
**inter-tool** | public/mailor.html sqRenderEmails/sqCopyEmail (clipboard-only); no POST /api/sequences/:id/push in src/routes/sequence-builder.js; contrast /api/mailerlite/send already in mailor.js
SequenceBuildr produces finished, voice-matched email bodies but the only output action is sqCopyEmail (clipboard, strips HTML) and the per-email Revise. There is no endpoint or UI to push a sequence into MailerLite as drafts or into a Kajabi sequence — even though mailor.js already integrates MailerLite (/api/mailerlite/send creates campaigns as drafts) and the Kajabi webhook welcome-email flow exists. The creator must manually re-key/paste every email into the platform, which reintroduces exactly the admin layer the project exists to eliminate. This is the core 'does it earn its place' gap: it saves the writing but not the wiring.
**Fix:** Add a per-sequence 'Push to MailerLite drafts' action that creates each email as a draft campaign (reuse the existing MailerLite caller), or at minimum export the whole sequence as one structured payload. Even a 'Copy whole sequence' button (like the older copyAllSequence for /api/mailor/sequence) would cut the per-email paste overhead.

### [MEDIUM] Zero linkage to the Rock Rich community game / lurker-nurture strategy
**workflow-order** | src/routes/sequence-builder.js buildStrategistSystem (audience is a plain string); src/routes/community.js (no sequence/nurture hook)
CLAUDE.md defines the community strategy as: tag lurkers `lurker-nurture` → drive them into a nurture sequence → weekly MCP delta check. SequenceBuildr is the obvious engine for authoring that nurture sequence, but there is no connection: community.js (the sync/warm-lead detector) contains no reference to 'sequence' or 'nurture', and SequenceBuildr has no awareness of community segments (Greenhouse/Garden/Founding 50, progress_score 25 lurkers). The 'convert' and 'reengage' goal types map perfectly to the lurker problem but nothing feeds community data into the strategist prompt or pulls the right audience. So it is useful in principle for the community game but not integrated for it — the strategist is told a free-text 'audience' string only.
**Fix:** Pass community context into the strategist: pull the lurker cohort size / tier breakdown from the community snapshot and inject into buildStrategistSystem and the plan prompt. Optionally let a sequence target a community tag (lurker-nurture) so the audience is concrete. Keep it Engine/Soul-clean by sourcing community data, not hardcoding.

### [MEDIUM] Silent degraded output when Claude returns non-JSON in /write and /revise
**bug** | src/routes/sequence-builder.js — /write (`subject: result?.subject || 'Email N'`, `body: result?.body || ''`) and /revise (`result?.subject || target.subject`)
Both /write and /revise rely on callClaude auto-parsing JSON and then read result?.subject / result?.body with `|| ` fallbacks. If Claude returns prose or malformed JSON (callClaude's repairJSON fails), result is not the expected shape: /write silently writes an email with subject `Email N` and an EMPTY body, persists it to DB, emits {type:'email'}, and reports success/'done'. The creator sees a blank email with no error. /revise falls back to the original email silently, so a revision instruction appears to do nothing. No validation, no error surfaced.
**Fix:** After callClaude, validate result is an object with non-empty subject and body; if not, throw (so /write hits its error path per SB-1) or send a per-email warning event and don't persist an empty body. For /revise, return an explicit error when the model output is unusable rather than silently keeping the old email.

### [LOW] Two overlapping sequence systems in MailΩr create creator confusion and maintenance overhead
**improvement** | public/mailor.html (generateSequence/copyAllSequence ~line 2403 vs SequenceΩr sqState ~line 2641); src/routes/mailor.js vs src/routes/sequence-builder.js
mailor.html ships both the legacy /api/mailor/sequence flow (tier-aware day0/Garden/Founding50 emails, copyAllSequence, 'Send via Kajabi' button) and the newer SequenceBuildr /api/sequences (chat → plan → write → revise). They solve nearly the same job with different mental models and outputs, and neither pushes to a platform end-to-end. Maintaining two email-sequence engines is overhead, and the creator must decide which to use — violating the Secondary Directive (reduce decisions, don't add them).
**Fix:** Decide on one. If SequenceBuildr is the future, fold the legacy flow's strengths (tier targeting, the existing Kajabi/MailerLite send buttons) into it and retire /api/mailor/sequence. Document the choice in SESSION-LOG/DEVNOTES so it doesn't drift back.

### [LOW] GET /api/sequences JSON.parses plan but list query orders by updated_at — fine, but per-row plan parse can throw and 500 the whole list
**bug** | src/routes/sequence-builder.js — GET '/' .map(s => ({ ...s, plan: s.plan ? JSON.parse(s.plan) : null }))
GET / maps every sequence and does `plan: s.plan ? JSON.parse(s.plan) : null` with no try/catch (unlike the single-GET handler which wraps plan parsing in try/catch). One sequence row with a corrupted plan column throws and 500s the entire list endpoint, hiding all other sequences from the sidebar — a thread-loss for every sequence, not just the bad one.
**Fix:** Wrap the per-row plan parse in try/catch returning null on failure (match the defensive parsing already used in GET /:id), so one bad row cannot take down the whole list.
