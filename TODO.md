# Kre8Ωr — Next Session TODO

---

## Task 1 — Fix two bugs in broll-bridge.js before first real use

Both are silent runtime failures that won't crash the server but will produce wrong
behaviour when `importBroll()` is called.

**Bug 1 — wrong column name for Resolve project name:**
`src/editor/broll-bridge.js` line ~85:
```js
const davinciName = davinciTimelines?.[0]?.resolve_project_name || project.title;
```
`davinci_timelines` has no `resolve_project_name` column. The name lives on
`projects.davinci_project_name`. Fix:
```js
const davinciName = project.davinci_project_name || project.title;
```

**Bug 2 — `project.fps` doesn't exist:**
`src/editor/broll-bridge.js` line ~92:
```js
'--fps', String(project.fps || 24)
```
The `projects` table has no `fps` column — this always silently defaults to 24.
That's fine for now (all footage is 24fps) but document it clearly. If multi-fps
support is ever needed, add `fps INTEGER DEFAULT 24` to the `projects` table via
`runMigrations()`.

**Fix both in broll-bridge.js, add a one-line comment on the fps default.**

---

## Task 2 — Update PipelineΩr dashboard (`public/index.html`)

This was on the TODO from Session 3 and was skipped again. The home screen is stale.

**Quick-action cards** — add two missing cards:
```
EditΩr:   film icon,  c-teal,  "Map takes to script sections, push selects to DaVinci"  → editor.html
AnalytΩr: chart icon, c-blue,  "Track performance across platforms"                      → m5-analytics.html
OperatΩr: grid icon,  c-green, "Queue, publish, and archive projects"                    → operator.html
```
`c-blue` and `c-green` classes need to be added to CSS (vars `--blue` and `--green`
already exist). `c-teal` already exists.

**Pipeline project cards** — add action links to each card:
- "EditΩr →" → `editor.html?project_id=X` (show when talking-head footage exists)
- "Analytics →" → `m5-analytics.html?project_id=X` (always shown)

**Server startup banner** (`server.js`) — add EditΩr line:
```
  EditΩr     → http://localhost:3000/editor.html
```

---

## Task 3 — End-to-end EditΩr test with real footage

The EditΩr pipeline has never been run against actual clips. First real test:

1. Open VaultΩr → confirm at least 2-3 clips are tagged `talking-head` for a project
2. Open `http://localhost:3000/editor.html?project_id=X`
3. Click **Build Selects** — watch SSE log for:
   - Whisper running on each clip (`transcribing`, `transcribed` stages)
   - `claude_start` → `claude_done` with section count
   - `saved` confirmation
4. Check section cards rendered correctly — takes listed, winner highlighted
5. Click **Push to DaVinci** — confirm Resolve is open and the `02_SELECTS` timeline
   appears with Blue/Green/Red/Orange markers
6. If Claude sections look wrong, inspect the prompt in `src/editor/selects.js`
   `buildSelectsPrompt()` and adjust the script/concept section logic

**Expected failure modes to watch for:**
- `No talking-head or dialogue clips found` → tag clips in VaultΩr first
- Whisper timeout on long clips → check `WHISPER_MODEL=medium` vs `base` tradeoff
- DaVinci `Could not find Resolve project` → confirm project was created via DaVinci panel in VaultΩr first
- B-roll panel shows "No b-roll footage" → ingest b-roll clips tagged correctly in VaultΩr
