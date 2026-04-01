# Kre8Ωr — Next Session TODO

---

## Task 1 — Live test TeleprΩmpter full 3-device setup

All four fixes landed this session but haven't been tested end-to-end on real hardware.

**Test sequence:**
1. Start display on laptop: `http://localhost:3000/teleprompter.html` → Load Script → Start
2. Note the 4-digit session code on screen
3. **Phone 1 (Control/Cari):** `http://192.168.1.143:3000/teleprompter.html?mode=control&session=XXXX`
   - Confirm script text appears and scrolls in sync with display
   - Test ⏪ 10s / slider / 10s ⏩ seek controls
   - Test drag up/down on text → speed changes on display
   - Confirm all text is full white, no fading
4. **Phone 2 (Voice/Jason):** `http://192.168.1.143:3000/teleprompter.html?mode=voice&session=XXXX`
   - Confirm 🎤 icon + volume bar appear
   - Speak → display starts scrolling; pause → display stops
   - Confirm sensitivity slider adjusts threshold
5. Confirm teal reading guide line visible at 38% from top on display
6. Tap any line on paused display → confirm jump to that line

---

## Task 2 — Id8Ωr (Ideation Engine) — Phase 3

First new tool of Phase 3. Generates content ideas from creator voice, trending angles, and past winners.

**Design:**
- Input: niche keywords, recent video titles, optional trending topic
- Output: 5–10 idea cards, each with: Hook, Angle (Financial/Rigged/Rock Rich), Story Structure, B-roll needs
- Ideas saved to DB, promotable to full PipΩr project with one click
- Uses Claude with creator-profile.json for voice + angle filtering

**Files to create:**
- `src/routes/id8r.js` — route + Claude generation
- `public/id8r.html` — idea card UI, promote-to-project button
- DB: `id8r_ideas` table (`project_id nullable`, `hook`, `angle`, `structure`, `created_at`)
- Mount in `server.js`

---

## Task 3 — Create GitHub PR for feat/editor branch

All session 9–12 work is on `feat/editor`. PR still not created.

```
gh pr create \
  --title "feat: TeleprΩmpter overhaul, WritΩr 3-tabs, Voice Library, DirectΩr" \
  --base main --head feat/editor
```

PR covers:
- **TeleprΩmpter:** 3-device setup (display/control/voice), position sync, seek controls, full-white text, reading guide, drag-to-speed, font size calibration, voice device mode
- **WritΩr:** three output tabs (Full/Bullets/Hybrid), parallel generation, session_id grouping, beat coverage colors, PipΩr prefill fix
- **Voice Library:** Whisper → Claude voice analysis, weighted profile blending, SSE job stream
- **DirectΩr:** crew brief data fix, Blob package download, shot type inference
- **ReviewΩr:** auto Voice Library prompt after CutΩr analysis

---

## Carry-forward (from Session 11 — still valid)

### Voice Library end-to-end test
1. Open `http://localhost:3000/writr.html` → Voice Library section
2. Add a real `.mp4` with speech → confirm SSE: `transcribing` → `analyzing` → `saved`
3. Select as Primary voice → write script → confirm voice instructions in prompt

### WritΩr three tabs end-to-end test
1. Generate → confirm all 3 tabs complete and render correctly
2. Beat coverage colors on cards and script sections
3. Navigate away and back → all tabs restore

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```
