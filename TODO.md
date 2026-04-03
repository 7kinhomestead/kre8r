# Kre8Ωr — Next Session TODO

---

## Task 1 — Ingest the 7 waiting proxy files and run CutΩr on project 18

7 proxy `.mp4` files are sitting in `D:/kre8r/intake` unprocessed. VaultΩr's watcher is running but they haven't been ingested yet.

**Steps:**
1. Open VaultΩr → Ingest Folder → point at `D:/kre8r/intake` → run ingest
2. Confirm clips 587 and 588 now have `proxy_path` set:
   ```
   curl 'http://localhost:3000/api/vault/footage?project_id=18' | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const r=JSON.parse(Buffer.concat(d));r.forEach(c=>console.log(c.id, c.proxy_path));})"
   ```
3. Open CutΩr → select project 18 → run selects
4. Confirm transcription completes (Whisper reads proxy `.mp4`) and selects are identified

---

## Task 2 — Build `cutor.html` and add CutΩr to the nav

`cutor.html` does not exist — the nav link was added and then reverted this session. The route `src/routes/cutor.js` may already exist. Build the frontend page.

**Steps:**
1. Check if `src/routes/cutor.js` exists and what endpoints it exposes
2. Build `public/cutor.html` — project selector, transcribe button, SSE progress feed, selects results display
3. Add CutΩr back to nav: in `public/js/nav.js` Post dropdown, insert between VaultΩr and EditΩr:
   `{ label: 'CutΩr', href: '/cutor.html' }`
4. Test full flow: select project → transcribe → review selects

---

## Task 3 — Charlie meeting prep: Opus architecture review

Run `OPUS_REVIEW.md` through Claude Opus and get the full architecture + commercial viability review before Saturday.

**Steps:**
1. In a new Claude conversation, paste the full contents of `OPUS_REVIEW.md`, `CLAUDE.md`, and `creator-profile.json`
2. Ask Opus to answer all 5 evaluation sections in depth
3. Save the response to `OPUS_REVIEW_RESPONSE.md` in the project root
4. Review findings — identify any critical architectural changes to make before showing Charlie

---

## Carry-forward (still valid)

### Fix `davinci.js` → `runScript()` Python detection
- **Problem:** `runScript()` hardcodes `spawn('python', ...)` — fails on systems where the binary is `py` or `python3`
- **Fix:** Add `PYTHON_CANDIDATES` + `detectPython()` pattern (already in `editor.js` and `composor.js`)

### TeleprΩmpter 3-device live test
1. Start display on laptop → Load Script → Start
2. Note 4-digit session code
3. Phone 1 (Control): `http://{ip}:3000/teleprompter.html?mode=control&session=XXXX`
4. Phone 2 (Voice): `http://{ip}:3000/teleprompter.html?mode=voice&session=XXXX`

### Id8Ωr — Remove debug log
- `console.log('[mindmap] messages chars...')` in `/mindmap` handler — remove once flow confirmed stable

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```

## Redeploy (after pushing new code)

```
bash /home/kre8r/kre8r/deploy/deploy.sh
```

---
