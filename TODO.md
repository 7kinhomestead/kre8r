# Kre8Ωr — Next Session TODO

---

## Task 1 — Fix ComposΩr public_path persistence for Suno-generated tracks

When a Suno API track is successfully downloaded, `suno-client.js` returns a
`public_path` (`/music/<project_id>/<slug>/<file>.mp3`) but the generate pipeline
in `src/routes/composor.js` only saves `suno_job_id`, `suno_track_url` (CDN URL),
and `suno_track_path` (local disk path) — the local web-accessible path is never
stored.

In `loadTracks` (`public/composor.html`) we currently derive `public_path` only
when `suno_track_url` starts with `/` — which is only true for uploaded tracks.
Suno-generated tracks have a CDN URL (`https://cdn.suno.com/...`) so audio players
never render for them.

**Fix — two-part:**

**Part A — Store `public_path` in the DB.**
Add `public_path TEXT` column to `composor_tracks` via `runMigrations()` in `src/db.js`:
```sql
ALTER TABLE composor_tracks ADD COLUMN public_path TEXT;
```
Add `'public_path'` to the allowed-fields whitelist in `updateComposorTrack`.

**Part B — Populate it in the generate pipeline.**
In `src/routes/composor.js`, after `generateTrack()` succeeds:
```js
db.updateComposorTrack(trackDbId, {
  suno_job_id:     result.suno_job_id,
  suno_track_url:  result.suno_track_url,
  suno_track_path: result.suno_track_path,
  public_path:     result.public_path       // ← add this
});
```

**Part C — Simplify the client derivation.**
In `loadTracks` (`composor.html`), replace the `/`-prefix heuristic:
```js
public_path: t.public_path || (t.suno_track_url?.startsWith('/') ? t.suno_track_url : null)
```

---

## Task 2 — Fix two bugs in broll-bridge.js before first real use

Both are silent runtime failures that won't crash the server but will produce wrong
behaviour when `importBroll()` is called.

**Bug 1 — wrong column name for Resolve project name:**
`src/editor/broll-bridge.js` line ~85:
```js
const davinciName = davinciTimelines?.[0]?.resolve_project_name || project.title;
```
`davinci_timelines` has no `resolve_project_name` column. Fix:
```js
const davinciName = project.davinci_project_name || project.title;
```

**Bug 2 — `project.fps` doesn't exist:**
```js
'--fps', String(project.fps || 24)
```
The `projects` table has no `fps` column — silently defaults to 24. Fine for now
but add a comment: `// projects table has no fps column — defaults to 24`.

---

## Task 3 — End-to-end ComposΩr test in Prompt Mode

ComposΩr has never been run against a real project. First real test with Suno API
key absent (Prompt Mode):

1. Select a project that has EditΩr selects already built (so `getSelectsByProject`
   returns data for the scene analyzer).
2. Click **Analyze Scenes** — confirm 4–7 scene cards render with emotional direction
   and genre direction filled in.
3. Click **Generate Music** — watch SSE log for:
   - `scene_analysis` events with section labels
   - `writing_prompt` → `prompt_written` × 3 per scene
   - `tracks_saved_to_db` count
   - `suno_skipped` events (one per track — expected in Prompt Mode)
4. Confirm track rows render: 3 variations per scene, each with prompt text,
   "Copy Prompt" button, "Open in Suno →" link, "Select" button.
5. Copy a prompt, open Suno manually, download the MP3.
6. Click **⬆ Upload Track** for that scene — confirm `✓ Uploaded & selected` status
   and the audio player appears.
7. Select all scenes via upload or Select buttons — confirm advance banner appears.
8. Optionally click **Push to DaVinci** if Resolve is open — confirm `04_AUDIO`
   timeline is created with the uploaded MP3.
