# Kre8Ωr — Next Session TODO

---

## Task 1 — End-to-end PipΩr + WritΩr test

Server is running under PM2. No restart needed unless code changes.

To verify server is up: open http://localhost:3000 or run `pm2 status`

1. Open pipr.html — walk all 5 wizard screens for a real upcoming video
2. Confirm redirect to /?project=N with PipΩr ✓ badge
3. Confirm database/projects/N/project-config.json was written
4. Click WritΩr → on the project card
5. Select the project in writr.html — entry point should auto-populate from config
6. Use the "Find the Story" or "Map the Beats" button
7. Watch SSE progress events in the log panel
8. Confirm beat map panel populates with green/amber/red cards
9. Confirm script appears in Panel 3 with [● BEAT] headers
10. Test one iteration: type feedback → Revise → confirm Draft 2 appears
11. Approve the script → confirm redirect to editor.html

---

## Task 2 — End-to-end SelectsΩr test with approved WritΩr script

After approving a WritΩr script for a project that has footage:

1. Open editor.html for that project
2. Click Build Selects — watch terminal (`pm2 logs kre8r`) for:
   `[SelectsΩr] Using WritΩr-approved script (writr_scripts id=N)`
3. Confirm selects build correctly using the approved script as reference
4. Beat coverage from SelectsΩr should map back to the WritΩr beat map

---

## Task 3 — DaVinci build-selects with audio (project 10)

For project 10 (The Garden VSL):
1. Open EditΩr for project 10
2. Click Build Selects Timeline — should create 02_SELECTS_v2
3. Confirm audio is present in DaVinci timeline
4. Confirm colored beat markers appear (if project has a project-config.json)

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs (replaces watching terminal)
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```
