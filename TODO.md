# Kre8Ωr — Next Session TODO

---

## Task 1 — Live test Voice Library end-to-end

The Voice Library analyze pipeline hasn't been tested with a real video file.

1. Open `http://localhost:3000/writr.html`
2. Scroll to Voice Library section at bottom
3. Click **+ Add Voice Profile**
4. Drop a real `.mp4` or `.mov` file with speech
5. Confirm SSE progress stream: `transcribing` → `transcribed` → `analyzing` → `saved`
6. Profile card should appear with name, word count, summary
7. Select it as Primary voice — write a script — confirm the voice instructions show in the prompt
8. Test blend: select two profiles, set 70/30 split — confirm weighted summary in prompt

---

## Task 2 — Live test WritΩr three tabs end-to-end

The three-tab parallel generation was built but not live-tested against the real API.

1. Open `http://localhost:3000/writr.html` → select a project
2. Fill Concept + What Was Captured → click Generate
3. Confirm:
   - All three tabs show spinner while generating
   - `[Full Script]` tab completes first and renders immediately
   - `[Bullets]` and `[Hybrid]` tabs complete and switch without re-generating
   - Beat coverage colors show on beat cards and script sections
4. Click `[Bullets]` tab → confirm bullet-point format
5. Click `[Hybrid]` tab → confirm hybrid outline format
6. Click Revise → confirm it iterates on the active tab's content
7. Navigate away and back → confirm active tab and all sibling scripts restore

---

## Task 3 — Id8Ωr (Ideation Engine)

Phase 3 next tool. Generates content ideas from creator voice, trending topics, and past performance.

Design:
- Input: creator niche, recent videos, top performers
- Output: 5-10 hook + concept + story structure combinations
- Each idea includes: Hook, Angle (Financial/Rigged/Rock Rich), Structure, Estimated viral potential
- Ideas saved to DB and can be promoted to a full PipΩr project with one click
- Route: `src/routes/id8r.js` | UI: `public/id8r.html`

---

## Task 4 — DirectΩr live shoot test

DirectΩr was fixed this session but needs a real-world test on a phone:

1. Open `http://localhost:3000/director.html` → select "The Rock Rich Community Launch"
2. Confirm crew brief shows: project title, story_circle, concept, all 8 beats with arrows
3. Confirm all 8 shots show as **Talking Head** (not B-Roll)
4. Click **Generate + Download** → confirm `.html` file downloads (not `.txt`)
5. Open the downloaded file offline in a browser → confirm full ShootDay interface loads
6. Open ShootDay on phone at `http://[local-ip]:3000/shootday.html` → select project
7. Mark 2-3 beats as "good" → confirm coverage bar updates in real time
8. Return to DirectΩr → confirm mirror panel shows updated coverage

---

## Task 5 — Create GitHub PR for feat/editor branch

All session 9–11 work is on `feat/editor`. PR never created.

```
gh pr create \
  --title "feat: TeleprΩmpter, WritΩr 3-tabs, Voice Library, DirectΩr" \
  --body "..."
```

Or browser: https://github.com/7kinhomestead/kre8r/compare/main...feat/editor

PR should cover:
- TeleprΩmpter: multi-device display, remote control, voice sync (Web Audio API)
- WritΩr: three output mode tabs (Full/Bullets/Hybrid), parallel generation, session_id grouping
- WritΩr: visual beat coverage colors (green/red/amber cards + script borders)
- WritΩr: PipΩr prefill fix (concept + footage from active script raw_input)
- Voice Library: Whisper → Claude voice analysis, weighted profile blending, SSE job stream
- DirectΩr: crew brief fix, Blob package download, shot type inference (talking_head default)
- ReviewΩr: auto Voice Library prompt after CutΩr analysis

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```
