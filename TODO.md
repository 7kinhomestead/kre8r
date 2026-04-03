# Kre8Ωr — Next Session TODO

---

## Task 1 — Test AutomatΩr dry-run → confirm → live send end to end

Broadcast flow is wired. First real test with a live email.

**Steps:**
1. Open Chrome with `--remote-debugging-port=9222`
2. Log into Kajabi manually
3. Open AutomatΩr → Connect Chrome
4. Generate a broadcast in MailΩr → Send via Kajabi
5. Run dry-run → verify screenshot shows correct Kajabi preview page
6. Confirm → verify email lands in Kajabi drafts or sends
7. If Step 8 (TinyMCE body) fails: inspect the iframe — check if `tinymce.activeEditor` is accessible from the top frame or needs `page.frame()` inside the iframe context

---

## Task 2 — AutomatΩr Step 8: handle TinyMCE inside iframe if top-frame access fails

If `window.tinymce` is not accessible from the top frame (Kajabi may sandbox the editor):
- Use `page.frame({ url: /tinymce/ })` or `page.frames()` to find the editor iframe
- Then `frame.evaluate(() => document.body.innerHTML = body)` or inject via postMessage
- Also confirm subject field selector — may need `input[name="email_broadcast[subject]"]` confirmed live

---

## Task 3 — Ingest 7 waiting proxy files and run selects on project 18

7 proxy `.mp4` files are sitting in `D:/kre8r/intake` unprocessed.

**Steps:**
1. Open VaultΩr → Ingest Folder → point at `D:/kre8r/intake` → run ingest
2. Confirm clips 587 and 588 now have `proxy_path` set
3. Open EditΩr → select project 18 → run selects
4. Confirm transcription completes and selects are identified

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

## Technical Debt

**Engine vs Soul audit** — Systematic pass through all route handlers finding hardcoded creator data that should read from `creator-profile.json`. `generate.js` email route is a known offender. Est: 3–4 hours.

**better-sqlite3 migration** — Replace sql.js before commercialization. Crash recovery risk, not just scale. If the server dies between a write and the next `persist()` call, that write is lost. Nearly a drop-in replacement. Est: 4–6 hours.

---

## ARCHIVE — Completed Task 1 (Session 16)

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

## Technical Debt

**Engine vs Soul audit** — Systematic pass through all route handlers finding hardcoded creator data that should read from `creator-profile.json`. `generate.js` email route is a known offender. Est: 3–4 hours.

**better-sqlite3 migration** — Replace sql.js before commercialization. Crash recovery risk, not just scale. If the server dies between a write and the next `persist()` call, that write is lost. Nearly a drop-in replacement. Est: 4–6 hours.

---
