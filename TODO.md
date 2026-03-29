# Kre8Ωr — Next Session TODO

---

## Task 1 — Confirm color space + S-curve in Resolve 20 with real footage

The `create-project.py` script now probes and logs all available `GetSetting` keys to
stderr. The next real test must include proxy footage so the S-curve path actually runs.

**What to do:**
1. Pick a project that has proxy MP4s in VaultΩr (or drop a test MP4 into the intake
   folder and let it ingest)
2. Call `POST /api/davinci/create-project` with that `project_id`
3. Watch the server console for these lines:
   ```
   [probe] GetSetting('colorSpaceInput') = '...'   ← confirms key exists + current value
   [color] colorSpaceInput: SetSetting('colorSpaceInput', '...') OK
   [resolve] colorAdj keys (first 12): [...]        ← shows S-curve key format
   ```
4. If color space still fails: the probe output will show the exact Resolve 20 key names
   to use — update `try_set_color_space()` calls in `create-project.py` with the correct keys
5. If S-curve still fails: the colorAdj key list will show what Resolve 20 exposes —
   add the correct key format as "Format D" in the S-curve section

**Success criteria:** `errors: []` in the JSON response, color management visible in
Resolve Project Settings → Color Management tab.

---

## Task 2 — Update `public/index.html` PipelineΩr dashboard

The home screen was not updated this session. A `--blue` CSS variable was added but
the quick-action cards and project card links were not completed.

**Quick-action cards** — add two missing cards (AnalytΩr, OperatΩr):
```
AnalytΩr:  chart icon (📊), c-blue,   "Track performance across platforms"  → m5-analytics.html
OperatΩr:  grid icon  (🗂️), c-green,  "Queue, publish, and archive projects" → operator.html
```
The `c-blue` class needs to be added to the CSS (the `--blue: #5b9cf6` var already exists).

**Pipeline project cards** — add two action links to each card:
- "Analytics →" linking to `m5-analytics.html?project_id=X` (always shown)
- "OperatΩr →" linking to `operator.html?project_id=X` (shown only when `gate_c_approved`)

**Grid layout** — 8 cards total; keep 4-column grid (2 rows of 4). Confirm it doesn't
overflow at 1280px width.

---

## Task 3 — CutΩr Whisper path hardening + ReviewΩr UX fixes

The CutΩr route uses `python -m whisper` which depends on the user's Python environment.
This needs to be robust before first real use.

**Whisper path detection (`src/routes/cutor.js`):**
- Check `py -m whisper --help` first (Windows Python Launcher), then `python3`, then `python`
- If Whisper not found, return a clear error immediately rather than a spawn that hangs
- Log which Python binary is being used so debugging is easy
- Add a `GET /api/cutor/check` health endpoint: returns ffmpeg status + Whisper status
  (similar to `/api/vault/status`) — ReviewΩr can call this on load and show a warning
  banner if Whisper is missing

**ReviewΩr UI fixes:**
- On load, call `/api/cutor/check` and show a setup warning if ffmpeg or Whisper is
  missing (with install instructions)
- The "Transcribe + Analyze" button should be disabled with a tooltip explaining why
  if the check fails
- Add a "Re-run Analysis" button that clears existing cuts for a project and re-runs
  the full pipeline (currently there is no way to reprocess footage)
- Fix: after extraction, the clip_path links should be clickable `file://` links so the
  user can open the extracted clip directly from the browser

**Robustness:**
- If Whisper times out (>10 min), emit a timeout error event and mark job failed
- If Claude cut analysis returns malformed JSON, show a parse error in the SSE log
  rather than silently failing
