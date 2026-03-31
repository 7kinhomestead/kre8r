# Kre8Ωr — Next Session TODO

---

## Task 1 — Live test TeleprΩmpter voice sync with real mic

The Web Audio API rebuild has not been live-tested. Test it end-to-end:

1. Open `http://localhost:3000/teleprompter.html` in Chrome
2. Load any approved script → Start Teleprompter
3. Click **🎤 Voice** button — browser should prompt for mic permission
4. Confirm:
   - `[Voice Sync] Active — audio running` appears in DevTools console
   - Mic indicator (top-left) shows **LISTENING**
   - Debug overlay appears: `🎤 ████░░░░ vol 28 · speed 3.2×`
5. Speak any line from the script — scroll should advance while you talk
6. Stop speaking — scroll should pause after ~450ms
7. Adjust Threshold slider: slide left for sensitive (quiet voice triggers), right for loud-only
8. If scroll doesn't start: open DevTools → console → check `[Voice Sync]` logs for vol reading
   - If vol stays at 0, check `analyserNode` is connected
   - If vol is low (2-5), slide Threshold slider left
9. Test multi-device: open `http://[IP]:3000/teleprompter.html?session=XXXX` on phone
   - Confirm join choice screen appears (not remote control directly)
   - Tap Display → confirm script loads and scroll syncs with main screen

---

## Task 2 — End-to-end WritΩr hybrid test with a 12+ beat project

The 3-call split was written but not live-tested. Verify it works:

1. `pm2 status` — confirm kre8r is online
2. Open writr.html → select a project with 12+ beats in the beat map
3. Fill Concept + What Was Captured → click Reconcile & Write
4. Watch SSE log panel — confirm all three progress messages:
   - `Call 1 — Reconciling plan vs. reality…`
   - `Call 2a/3 — Writing beats 1-8…`
   - `Call 2b/3 — Writing beats 9-N…`
5. Confirm final script has ALL beats — no cutoff at Beat 12
6. Confirm seam between Part A and Part B is clean (no repeated content, no abrupt cut)
7. Also test a ≤8 beat project — should only show 2 progress messages (no Part B call)

---

## Task 3 — Create the GitHub PR

The `feat/editor` branch has all session 9-10 work. PR was never created (no `gh` CLI).

Option A — Install GitHub CLI:
```
winget install GitHub.cli
gh auth login
gh pr create --title "feat: TeleprΩmpter, WritΩr split, multi-device, voice sync" --body "..."
```

Option B — Browser:
Open: https://github.com/7kinhomestead/kre8r/compare/main...feat/editor

PR description should cover:
- TeleprΩmpter full build (display, remote, multi-device, QR, voice sync)
- WritΩr 3-call hybrid split for 12+ beat projects
- Multi-device join choice screen (Display vs Control)
- Voice sync: Web Audio API volume detection replacing SpeechRecognition
- Nav overhaul (shared nav.js), PM2 autostart, dashboard redesign

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```
