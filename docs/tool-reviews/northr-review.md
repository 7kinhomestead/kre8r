# NorthΩr — Architectural Review
*Opus audit.*

## Synthesis
Confirmed. `ecosystem.config.js` registers the cron at line 50 but passes **no `env` block** with `DB_PATH` or `ELECTRON`. So in the Electron deployment the cron writes to `~/.kre8r/kre8r.db` while the live app reads `AppData\Roaming\kre8r\kre8r.db`. northr-1 is a verified silent failure.

---

# NorthΩr Synthesis

**Verdict: SIGNAL.** This review is high-quality and grounded — I independently confirmed all three top findings (and the cron's missing env block) against source. Only one item (northr-7) is a hypothesis that still needs a param-name check; the rest cite real, correct line behavior. Nothing here is noise.

## Top 3 (fix these)

**1. northr-1 — Cron writes alerts to the wrong DB (CRITICAL, confirmed).**
`scripts/northr-check.js:15-21` defaults `DB_PATH` to `~/.kre8r/kre8r.db`. The live Electron app sets `DB_PATH = app.getPath('userData')\kre8r.db` = `AppData\Roaming\kre8r` (`electron/main.js:107`). `ecosystem.config.js:50` registers the cron with **no `env` block**, so PM2 never propagates `DB_PATH`/`ELECTRON`. Result: the 9am watchdog writes alerts into a DB the dashboard never reads — NorthΩr's one core feature fails silently with no recovery path. Violates the prime directive directly.
*Fix:* give the cron the same `env` block as the app in `ecosystem.config.js` (or derive the path from a single shared resolver in `db.js`), and log the resolved `DB_PATH` at startup in both processes so any future mismatch is visible.

**2. northr-2 — "999 days since your last video" critical alert on empty history (HIGH, confirmed).**
`db.js:4821-4823` returns the `999` sentinel when `lastPost?.last_publish` is null. `strategy-engine.js:60` fires `999 >= 14` → a CRITICAL card titled literally "999 days…". The UI maps 999 to a dash, so the stat shows "—" while the alert screams 999 — the contradiction makes NorthΩr look broken on first run. Same path hits `email_cold`.
*Fix:* treat 999 as "unknown" everywhere — skip the no_publish/email_cold alerts when the underlying date is null, or emit a distinct "connect your channel" info alert.

**3. northr-3 — Stalled alerts resurrect daily and never auto-resolve (MEDIUM, confirmed).**
`strategy-engine.js:139-145` re-creates an alert whenever none exists *or the existing one is dismissed*. So a dismissed stalled alert is reborn every single morning until Jason physically moves the project, and nothing clears it when a project advances/publishes/archives. With no cap, old projects flood the dashboard daily → alert fatigue, training him to ignore all alerts (violates the secondary directive).
*Fix:* on dismiss, store `dismissed_until` and suppress re-creation for N days; each run, auto-dismiss any open `stalled_<id>` whose project is no longer in `pipeline.stalled`; cap to top-3 oldest and roll the rest into one summary alert.

## The rest (worth doing, lower priority)
- **northr-5 (HIGH):** Read-heavy dashboard — demote pure-status widgets (email perf, community, copyright, revenue, heatmap) below the fold; every above-fold number should carry a "so what / do this." Real product signal, not a bug.
- **northr-7 (MEDIUM, unverified):** Stalled deep-links use `?project_id=` (`strategy-engine.js:99`) — needs a check that each target page (id8r/editor/shootday/m1-approval) reads that exact param, else the recovery path lands with no project loaded. Only item still requiring verification.
- **northr-6 (MEDIUM):** Strategy/Growth Plan go stale silently — stamp `generated_at`, nudge regeneration, auto-trigger MirrΩr eval at month rollover.
- **northr-8 (LOW):** Dashboard endpoint fetches MailerLite stats the frontend immediately re-fetches — drop one round-trip.
- **northr-4 (LOW):** Duplicate `<div id="kre8r-nav">` at `northr.html:1711` and `:2205` — remove one.
- **northr-9 (LOW):** "Mark as Published" is buried at section 10 but feeds the publish-gap alert at the top — inline a "Log it →" shortcut in the alert card.

Key files: `C:\Users\18054\kre8r\scripts\northr-check.js`, `C:\Users\18054\kre8r\ecosystem.config.js`, `C:\Users\18054\kre8r\src\utils\strategy-engine.js`, `C:\Users\18054\kre8r\src\db.js`, `C:\Users\18054\kre8r\electron\main.js`, `C:\Users\18054\kre8r\public\northr.html`.

## Findings (9 total)
### [CRITICAL] Daily cron check may write alerts to a different DB than the app reads (Electron path mismatch)
**bug** | scripts/northr-check.js:15-21 vs electron/main.js:107-108
scripts/northr-check.js (the 9am PM2 cron that powers the entire alert system) bootstraps the Electron DB path as ~/.kre8r/kre8r.db when process.env.DB_PATH is not already set. But electron/main.js launches the real server with DB_PATH = app.getPath('userData') = AppData\Roaming\kre8r\kre8r.db (which CLAUDE.md confirms is the live DB). If PM2 spawns the cron without DB_PATH exported in its environment, checkAllThresholds() writes alerts into ~/.kre8r/kre8r.db while the running app reads AppData\Roaming\kre8r\kre8r.db. The dashboard then renders 'All clear — you're on course' even though the watchdog actually fired. This is a silent failure of the one feature NorthΩr exists for, and it directly violates the prime directive: the creator loses the early-warning thread with no recovery path or indication anything is wrong.
**Fix:** Make the cron derive its DB path from the exact same source as the server. Either import the shared path resolution from db.js, or in Electron mode default to app.getPath('userData') equivalent (the Roaming path), not ~/.kre8r. Add a startup log line printing the resolved DB_PATH in both the server and the cron so a mismatch is visible. Confirm ecosystem.config.js passes DB_PATH/ELECTRON to the cron process env.

### [HIGH] 'No content ever published' produces a nonsensical '999 days since your last video' critical alert
**bug** | src/utils/strategy-engine.js:60-78 and 105-114; db.js:4821-4823
db.getPublishingStats() returns days_since_last_publish = 999 as a sentinel when there are zero qualifying posts (fresh install, or all posts are *_import sourced and excluded). In checkAllThresholds(), 999 >= no_publish_alert(14) is true, so it fires a CRITICAL alert titled '999 days since your last video' with message 'Algorithm momentum drops after 7 days. Your audience is waiting.' The renderStats() frontend correctly maps 999 to a dash, but the alert path does not — so the dashboard stat shows '—' while the alert card screams a literal 999. Same applies to the email_cold alert (999 >= 10). This makes the very first impression of NorthΩr look broken and erodes trust in every subsequent alert.
**Fix:** Guard the sentinel before raising alerts: skip the no_publish / email_cold alerts (or emit a distinct 'No publish history yet — connect your channel' info alert) when days_since_last_publish === 999 (i.e. lastPost?.last_publish is null). Treat 999 as 'unknown', never as a numeric day count, consistently across both the alert engine and the UI.

### [MEDIUM] Stalled-project alerts never auto-resolve and re-fire forever once dismissed
**bug** | src/utils/strategy-engine.js:93-102, 137-145
Stalled alerts are deduped by type `stalled_${project.id}`. The dedup logic (strategy-engine.js:139-145) only re-creates an alert if none exists OR the existing one is dismissed. So: (a) once Jason dismisses a stalled alert, the next daily run sees existing.dismissed === true and re-creates it — the alert resurrects every single day until he physically moves the project, which is alert fatigue; and (b) there is no logic that clears the alert when the project actually advances or is published, so a stale 'X stalled for N days' card can linger if the project was archived/published between runs. Combined with no cap on stalled alerts, a backlog of old projects floods the dashboard daily, training the creator to ignore all alerts — the opposite of the secondary directive (reduce decisions).
**Fix:** Add a snooze/resolve concept: when dismissed, suppress re-creation for N days (store dismissed_until). On each run, auto-dismiss any open stalled_<id> alert whose project no longer appears in pipeline.stalled (advanced/published/archived). Cap simultaneous stalled alerts (e.g. top 3 oldest) and roll the rest into one summary alert.

### [MEDIUM] Duplicate <div id="kre8r-nav"></div> renders two nav bars / breaks initNav
**bug** | public/northr.html:1711 and 2205
northr.html has two identical nav mount points: line 1711 and line 2205, with initNav() called once on load. initNav populates by id; a duplicate id is invalid HTML and depending on the nav implementation either injects the nav twice (two stacked nav bars) or leaves a stray empty container. This is decorative breakage but signals the page was assembled by concatenation and undermines polish on a tool meant for daily use.
**Fix:** Remove the second <div id="kre8r-nav"></div> (keep the one at the top of <body>). Verify initNav targets a single element.

### [HIGH] NorthΩr is read-heavy: most sections inform but do not change what Jason creates next
**improvement** | public/northr.html (sections 7,9,11,12,13) vs (sections 1,2,4)
Against the key question 'does this change what he creates next', the sections split sharply. ACTIONABLE (changes the next creative decision): Active Alerts (with action_url deep-links into Id8Ωr/MailΩr), This Month's Strategy (top_priority + recommended_mix + avoid_this_month), 3-Month Trajectory (key_actions, highest_leverage_move, structure_recommendation), Stalled Projects. DECORATIVE / look-but-don't-act (no next-step affordance): Email Performance (last 5 campaigns, raw open/click — no recommendation), Rock Rich Community widget (counts only), Copyright Health (GuardΩr counts), Ad Revenue history table, the 91-day heatmap, the Pipeline funnel counts. For a 725k/54k creator on a non-filming analytics day, the danger is exactly this: a wall of numbers he scans and closes. The decorative widgets don't violate prime directive but they dilute the actionable signal and add scanning decisions (secondary directive).
**Fix:** Demote pure-status widgets (email perf, community, copyright, revenue, heatmap) below the fold or behind a collapsed 'Vitals' drawer, and surface only deltas that demand action ('open rate down 8pts vs your 90-day avg → your last 3 subjects were X', 'community lurker score moved 25→50 = unsub risk'). Every number on the primary view should carry a one-line 'so what / do this'. If a widget can't generate a next action, it doesn't belong above the fold.

### [MEDIUM] Strategy and Growth Plan are generate-on-demand and easy to never revisit — no enforced freshness or 'did it work' loop
**improvement** | src/routes/northr.js:140-182, 288-466; public/northr.html renderStrategy/renderGrowthPlan
This Month's Strategy and the 3-Month Trajectory are the genuinely decision-changing parts of NorthΩr, but they are manually generated (button press) and then cached in kv_store/strategy reports with no staleness indicator on the dashboard. MirrΩr self-evaluations exist to close the loop, but evaluation is also manual (evaluateLastMonth button). So the realistic failure mode is: Jason generates a strategy once, it goes stale, the dashboard keeps showing last month's top_priority, and nothing nudges him to regenerate or to evaluate whether last month's strategy actually moved the numbers. That makes the most actionable feature quietly decorative over time.
**Fix:** Stamp every cached strategy/plan with generated_at and show 'Strategy is N days old — regenerate?' when stale (>30d for monthly, month boundary crossed). Auto-trigger a MirrΩr evaluation at month rollover and surface its one_line + score next to the new strategy so each month visibly builds on whether the last one worked. Tie the alert engine into it: if no strategy exists for currentMonth, raise an info alert.

### [MEDIUM] Alert action_url deep-links may use wrong query param, dropping creator into the tool without project context
**inter-tool** | src/utils/strategy-engine.js:99; target pages id8r.html/editor.html/shootday.html/m1-approval-dashboard.html
Stalled-project alerts build action_url as `/${project.stage_url}?project_id=${project.id}` (strategy-engine.js:99). The pipeline stages map to id8r.html / shootday.html / editor.html / m1-approval-dashboard.html. If any of those pages read the project via ?id= rather than ?project_id= (param naming is inconsistent across this codebase — northr's own recent-projects/mark-published flow uses :id), the deep-link lands the creator in the tool with no project loaded, breaking the recovery path the alert promised. This is the inter-tool seam where 'never break the creative thread without a recovery path' is most likely to fail.
**Fix:** Verify each target page's expected query param and standardize on one (?project_id=). Add a fallback in each tool: if the param is present but no project loads, show 'Project N not found — return to NorthΩr' instead of a blank/default state.

### [LOW] dashboard endpoint duplicates MailerLite fetch work the frontend immediately re-fetches
**simplification** | src/routes/northr.js:193-196,226-236; public/northr.html:2242 (loadEmailStats) and 2699-2724
GET /api/northr/dashboard already fetches email_stats via fetchMlCampaignStats(5) and returns it, but loadDashboard() in the frontend then calls loadEmailStats() which hits a separate /api/mailerlite/stats endpoint and re-renders. The dashboard's email_stats payload appears unused by the render path (renderEmailStats is driven by loadEmailStats). That's a redundant MailerLite round-trip on every dashboard load (latency + rate-limit pressure on a third-party API) plus dead data in the response.
**Fix:** Pick one source: either render email performance from the dashboard payload's email_stats and delete the separate loadEmailStats() call, or drop email_stats from the dashboard response. Removing the duplicate fetch also tightens initial load.

### [LOW] 'Mark as Published' lives at the bottom but is the data source everything above depends on
**workflow-order** | public/northr.html section 10 (loadMarkPublished ~2794) relative to alerts/stats at top
The publishing gap stat, the no_publish alerts, the goals progress, the heatmap, and the strategy prompt all derive from publish dates. Yet the 'Mark as Published' UI (the manual mechanism that feeds those dates when a post wasn't pushed through PostΩr) is section 10, buried near the bottom. The natural daily order is reversed: Jason sees a scary '14 days since last video' critical alert at the top, when the real cause may simply be that he published manually and never recorded it. The fix workflow is two screens away from the symptom.
**Fix:** When a no_publish alert fires, inline a 'Published recently? Log it →' shortcut in the alert card that jumps to / scrolls to the Mark-as-Published list. Better: move a compact 'log a publish' affordance up next to the publishing-gap stat so the correction path sits beside the symptom.
