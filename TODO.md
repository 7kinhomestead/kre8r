# Kre8Ωr — Next Session TODO

---

## Task 1 — Restart server and test full pipeline

Two new modules (PipΩr + WritΩr) were added while the server was running.
The server MUST be restarted before testing either.

```
Ctrl+C  (stop current server)
node server.js
```

Confirm on startup:
```
[DB] Migration: added projects.writr_complete
[DB] Migration: added projects.active_script_id
  PipΩr  → http://localhost:3000/pipr.html
  WritΩr → http://localhost:3000/writr.html
```

---

## Task 2 — End-to-end PipΩr + WritΩr test

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

## Task 3 — End-to-end SelectsΩr test with approved WritΩr script

After approving a WritΩr script for a project that has footage:

1. Open editor.html for that project
2. Click Build Selects — watch terminal for:
   `[SelectsΩr] Using WritΩr-approved script (writr_scripts id=N)`
3. Confirm selects build correctly using the approved script as reference
4. Beat coverage from SelectsΩr should map back to the WritΩr beat map

---

## Task 4 — DaVinci build-selects with audio (pending restart)

For project 10 (The Garden VSL):
1. After server restart, open EditΩr for project 10
2. Click Build Selects Timeline — should create 02_SELECTS_v2
3. Confirm audio is present in DaVinci timeline
4. Confirm colored beat markers appear (if project has a project-config.json)

---
