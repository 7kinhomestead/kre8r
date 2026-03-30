# Kre8Ωr — Next Session TODO

---

## Task 1 — End-to-end WritΩr hybrid test with a 12+ beat project

The 3-call split was written but not live-tested. Verify it works end-to-end:

1. `pm2 status` — confirm kre8r is running (or `pm2 restart kre8r` after code pull)
2. Open writr.html → select a project that has a beat map with 12+ beats
3. Fill in Concept and What Was Captured → click Reconcile & Write
4. Watch the SSE log panel — you should see all three progress messages:
   - `Call 1 — Reconciling plan vs. reality…`
   - `Call 2a/3 — Writing beats 1-8…`
   - `Call 2b/3 — Writing beats 9-N…`
5. Confirm the final script has ALL beats — no truncation at Beat 12
6. Confirm the seam between Part A and Part B is clean (no duplicate beat header,
   no repeated content, no abrupt cut-off)
7. Test a project with ≤8 beats — confirm only 2 progress messages appear
   (Call 1 + `Call 2/2 — Writing unified script…`)
8. Check server logs: `pm2 logs kre8r` — no errors thrown

---

## Task 2 — Create the GitHub PR (gh CLI not available)

The `feat/editor` branch is pushed with 11 commits but the PR was never created
because `gh` is not installed on this machine.

Options:
1. Install GitHub CLI: https://cli.github.com → `winget install GitHub.cli`
   Then: `gh auth login` → `gh pr create --title "feat: ..." --body "..."`
2. Or open this URL in browser and paste the pre-written description:
   https://github.com/7kinhomestead/kre8r/compare/main...feat/editor

PR title: `feat: PipΩr, WritΩr, Nav overhaul, SSE fixes, PM2 autostart`

Include in body:
- PipΩr creative contract system
- WritΩr 3-entry-point script generation (script-first / shoot-first / hybrid)
- Hybrid 3-call split (beat reconciliation + script A + script B)
- Complete UI navigation overhaul (shared nav.js, all 11 pages + 7 placeholders)
- WritΩr SSE 4-bug fix
- PM2 Windows autostart
- Dashboard 3-zone redesign

---

## Task 3 — End-to-end SelectsΩr test with an approved WritΩr script

After Task 1 produces a clean script, approve it and verify the SelectsΩr handoff:

1. In writr.html, click Approve Script on the completed draft
2. Confirm redirect to editor.html (or navigate there manually)
3. Open EditΩr for that project → click Build Selects
4. Watch terminal: `pm2 logs kre8r` — look for:
   `[SelectsΩr] Using WritΩr-approved script (writr_scripts id=N)`
5. Confirm selects build correctly using the approved script as reference
6. Beat coverage from SelectsΩr should map back to the WritΩr beat map

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```
