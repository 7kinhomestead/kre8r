# Kre8Ωr — Next Session TODO

---

## Task 1 — End-to-end SelectsΩr test with chunking live

SelectsΩr chunked analysis has never been successfully run against real footage.
First real test to confirm the full pipeline works:

1. Restart server — confirm terminal shows:
   `[SelectsΩr] Module loaded — CHUNK_SIZE=2, MAX_WORDS_PER_CHUNK=3000`
2. Open EditΩr, select a project with 3+ talking-head clips already transcribed.
3. Click **Build Selects** — watch terminal for:
   ```
   [SelectsΩr] analyzeTranscripts: N clips → M chunk(s)
   [SelectsΩr]   chunk 1: 2 clip(s), XXXX words
   [SelectsΩr] → chunk 1/M (clips 1–2, XXXX words)
   [SelectsΩr] ✓ chunk 1 → N section(s)
   ...
   [SelectsΩr] Merging N raw sections from M chunks
   [SelectsΩr] ✓ merge done — N final section(s)
   ```
4. Confirm browser log panel shows all chunk progress events.
5. Confirm section cards render correctly in EditΩr after completion.
6. If merge call fails or produces duplicate sections, tune `buildMergePrompt` — the
   deduplication instructions may need tightening for the specific script structure.

---

## Task 2 — Fix ComposΩr `public_path` persistence for Suno-generated tracks

When a Suno API track downloads, `suno-client.js` returns `public_path`
(`/music/<project_id>/<slug>/<file>.mp3`) but the generate pipeline in
`src/routes/composor.js` never saves it — only `suno_track_url` (CDN URL) is stored.
Audio players in the UI only work for uploaded tracks; Suno-generated tracks are silent.

**Part A — DB column:** Add `public_path TEXT` to `composor_tracks` in `src/db.js`:
```sql
ALTER TABLE composor_tracks ADD COLUMN public_path TEXT;
```
Add `'public_path'` to the `updateComposorTrack` allowed-fields whitelist.

**Part B — Populate in route:** In `src/routes/composor.js` after `generateTrack()`:
```js
db.updateComposorTrack(trackDbId, {
  suno_job_id:     result.suno_job_id,
  suno_track_url:  result.suno_track_url,
  suno_track_path: result.suno_track_path,
  public_path:     result.public_path    // ← add this
});
```

**Part C — Client fix:** In `composor.html` `loadTracks`, replace the `/`-prefix heuristic:
```js
public_path: t.public_path || (t.suno_track_url?.startsWith('/') ? t.suno_track_url : null)
```

---

## Task 3 — Fix two silent bugs in broll-bridge.js before first real use

Neither bug crashes the server but both produce wrong behaviour on first real use.

**Bug 1 — Wrong column name for Resolve project name (`src/editor/broll-bridge.js` ~line 85):**
```js
// Wrong — davinci_timelines has no resolve_project_name column:
const davinciName = davinciTimelines?.[0]?.resolve_project_name || project.title;

// Fix:
const davinciName = project.davinci_project_name || project.title;
```

**Bug 2 — `project.fps` doesn't exist:**
```js
// projects table has no fps column — add a comment so it's not confusing:
'--fps', String(project.fps || 24)   // projects table has no fps column — defaults to 24
```

After both fixes, do a live b-roll import test:
1. Open a project with selects built and b-roll tagged in VaultΩr.
2. Click **Import B-Roll** in EditΩr — confirm `04_BROLL` timeline is created in Resolve
   with clips placed at the correct timeline positions.
