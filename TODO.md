# Kre8Ωr — Next Session TODO

---

## ⚡ HIGH PRIORITY — Electron AppData DB Auto-Backup

In `electron/main.js`, after the server starts and the ready poll resolves, add a 5-minute interval that copies the live AppData DB to the project folder. Survives power outages and AppData corruption.

```js
setInterval(() => {
  try {
    fs.copyFileSync(
      path.join(app.getPath('userData'), 'kre8r.db'),
      path.join(__dirname, '../database/kre8r-electron-backup.db')
    );
  } catch (err) {
    console.warn('[Electron] DB backup failed:', err.message);
  }
}, 300_000); // every 5 minutes
```

Add `database/kre8r-electron-backup.db` to `.gitignore` and the electron-builder `files` exclusion list (same as `kre8r.db`).

---

## Task 1 — Live test Content DNA niche + audience panels

The constellation graph is confirmed working (263 nodes, real view counts, 7 clusters). The two SSE panels below it have not been tested end-to-end.

**Steps:**
1. Open `http://localhost:3000/analytr.html` → scroll to Content DNA section
2. Confirm constellation renders with node sizing (biggest node = "How Do You Afford Off Grid Living?" at 421k views)
3. Click **"Generate Content DNA"** → watch SSE stream in niche + audience panels
4. If panels stay blank: check browser console for errors, check `POST /api/analytr/content-dna` in network tab
5. Click **"Save to My Soul →"** → confirm `creator-profile.json` updates with audience data:
   ```
   curl http://localhost:3000/api/analytr/creator-profile-audience
   ```
6. Fix any bugs found

---

## Task 2 — Deploy to DigitalOcean

All session-15 changes are on master but haven't been deployed.

```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

Also install reportlab if not already done (required for crew brief PDF route):
```bash
pip install reportlab
```

Verify after deploy: `https://kre8r.app/analytr.html` loads constellation graph.

---

## Task 3 — AnalΩzr: add `contentDetails.duration` to YouTube sync for format classification

The WISHLIST entry is written. This is the first implementation step — store video format at sync time so the constellation can badge and filter correctly.

**Steps:**
1. In `src/routes/analytr.js`, find the YouTube API call that fetches video stats
2. Add `contentDetails` to the `part` param: `part=snippet,statistics,contentDetails`
3. Parse `contentDetails.duration` (ISO 8601) at sync time:
   - `P0D` or `PT0S` → `live`
   - `≤ PT60S` OR title contains `#shorts` → `short_form`
   - Everything else → `long_form`
4. Store as `video_format` in `analytics_metrics` or add column to projects table
5. Pass `video_format` in graph nodes so the constellation JS can render badges (📹 / ⚡ / 🔴) and dim live nodes

---

## Carry-forward (still valid)

### Add 2 sections to Production Runbook DOCX
File: `C:/Users/18054/kre8r/Kre8r-Production-Runbook.docx`
Rebuild via: `node C:/Users/18054/AppData/Local/Temp/outputs/build-runbook.js`
Add SECTION A (File Paths) and SECTION B (DaVinci Pipeline) — full content in TODO.md archive below.

### Fix VaultΩr ingest for project 18
7 proxy `.mp4` files in `D:/kre8r/intake` unprocessed. See archived Task 1 below for steps.

### Fix `davinci.js` → `runScript()` Python detection
`runScript()` hardcodes `spawn('python', ...)` — fails where binary is `py` or `python3`.
Add `detectPython()` pattern (already in `editor.js` and `composor.js`).

### TeleprΩmpter 3-device live test
1. Start display on laptop → Load Script → Start → note 4-digit session code
2. Phone 1 (Control): `http://{ip}:3000/teleprompter.html?mode=control&session=XXXX`
3. Phone 2 (Voice): `http://{ip}:3000/teleprompter.html?mode=voice&session=XXXX`

### Id8Ωr — Remove debug log
`console.log('[mindmap] messages chars...')` in `/mindmap` handler — remove once flow confirmed stable.

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

## ARCHIVE — Tasks from previous sessions

### Add 2 sections to Production Runbook DOCX (logged Session 15)

File: `C:/Users/18054/kre8r/Kre8r-Production-Runbook.docx`
Rebuild via: `node C:/Users/18054/AppData/Local/Temp/outputs/build-runbook.js`

Add these two sections, formatted consistently with the rest (dark phase headers, data flow bars, tip/warning boxes):

### SECTION A: FILE PATHS & WHERE EVERYTHING LIVES

| Item | Location |
|---|---|
| Footage Intake | `D:\kre8r\intake\` |
| Proxy Files | `D:\kre8r\proxy\` |
| Music Files | `[kre8r]\public\music\{project_id}\` |
| Project Configs | `[kre8r]\project-configs\{project_id}\project-config.json` |
| Beat Maps | Same as project configs — filesystem not DB |
| Crew Brief PDFs | Generated on demand, downloaded to browser |
| Id8Ωr Research | DB — `projects.id8r_data` (JSON blob) — NOT a file |
| WritΩr Scripts | DB — `writr_scripts` table |
| Selects | DB — `selects` table |
| Captions | DB — `captions` table |
| Email sequences | DB — `emails` table |
| YouTube thumbnails | DB — `posts` table (URLs) |
| Database location | `[kre8r]\kre8r.db` |
| Suno music prompts | DB — `composor_tracks.suno_prompt` |

**IMPORTANT NOTE on Id8Ωr Research:**
The research phase (websites visited, insights found, links collected) currently lives ONLY in the browser session during the Id8Ωr conversation. The final synthesized data (chosen concept, research summary, package data, vision brief) gets saved to the DB when you click Send to PipΩr. The raw research links and individual website data are NOT currently saved anywhere permanently — this is a known gap to fix in a future session.

### SECTION B: THE DAVINCI PIPELINE — HOW IT WORKS

DaVinci Resolve integration happens at two points:

**Trigger 1 — BRAW Proxy Generation (VaultΩr)**
- When: Automatically when a .BRAW file is detected in `D:\kre8r\intake`
- How: VaultΩr calls a DaVinci Python script via the Resolve API
- What it does:
  1. Opens DaVinci Resolve (must be running)
  2. Imports the BRAW file into the media pool
  3. Generates a proxy file at reduced resolution
  4. Saves proxy to `D:\kre8r\proxy\`
  5. VaultΩr links the proxy back to the original BRAW record in DB
- Requirements: DaVinci Resolve must be OPEN and running before dropping footage
- If it fails: Check DaVinci is open, check proxy path exists, check Python API is enabled in DaVinci preferences

**Trigger 2 — Audio Timeline Push (ComposΩr)**
- When: You click 'Push to DaVinci' in ComposΩr after selecting one track per scene
- How: ComposΩr calls a DaVinci Python script via the Resolve API
- What it does:
  1. Opens or connects to current DaVinci project
  2. Creates a new timeline called '04_AUDIO'
  3. Places each selected music track at its scene's approximate start position
  4. Sets audio level to -6dB on the music track
  5. You then edit around this audio timeline in DaVinci manually
- Requirements: DaVinci must be OPEN with your project loaded
- If it fails: Make sure your DaVinci project is open, not just Resolve itself

**What Kre8Ωr does NOT do in DaVinci (yet):**
- Does not create video timelines automatically
- Does not place footage clips on timeline
- Does not export or render
- Does not apply color grades
- The editing itself is still done manually in DaVinci

**Intended future state:** SelectsΩr will eventually generate a DaVinci XML/EDL file that auto-assembles a rough cut from the approved selects. That feature is on the wishlist but not yet built.

---

## Before Next Deploy — Run on DigitalOcean server

```bash
pip install reportlab
```

Required for `GET /api/shootday/crew-brief/:project_id` (crew-brief.py) — exits with code 2 if reportlab missing.

---

## ✅ COMPLETED — Full pre-pipeline run (Id8Ωr → PipΩr → WritΩr)
Ran perfectly end-to-end. Id8Ωr concept card, brief block pre-fill, all handoffs confirmed working.

## ✅ COMPLETED — AutomatΩr → Kajabi broadcast live test
Ran perfectly. 4,300 emails sent. Playwright automation fully proven in production.

---

## Task 1 — Fix VaultΩr ingest for project 18

7 proxy `.mp4` files are sitting in `D:/kre8r/intake` unprocessed. Ingest needs investigation — something in the intake/watcher flow is not picking them up correctly.

**Steps:**
1. Check server logs for VaultΩr watcher errors: `pm2 logs kre8r --lines 100`
2. Open VaultΩr → Ingest Folder → point at `D:/kre8r/intake` → run ingest manually
3. Confirm clips have `proxy_path` set after ingest:
   ```
   curl 'http://localhost:3000/api/vault/footage?project_id=18' | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{const r=JSON.parse(Buffer.concat(d));r.forEach(c=>console.log(c.id, c.proxy_path));})"
   ```
4. If watcher isn't picking up files — debug `src/vault/watcher.js` intake logic
5. Once proxy_path is set → open EditΩr → select project 18 → run selects

---

## Task 2 — Deploy to DigitalOcean + install reportlab

```bash
pip install reportlab
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

Crew brief PDF route exits with code 2 if reportlab missing on the server.

---

## Task 3 — Archive duplicate projects 21 and 22

Projects 21 and 22 are duplicate tankless water heater projects superseded by project 23 (Propane Water Heater — full id8r_data confirmed).

**Steps:**
1. Open PipΩr → settings gear on project 21 → Archive
2. Open PipΩr → settings gear on project 22 → Archive
3. Confirm only project 23 shows in active project lists across all tools

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
