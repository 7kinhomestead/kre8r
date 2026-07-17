# SyncΩr — Architectural Review
*Opus audit.*

## Synthesis
I have the full review. Let me synthesize the SyncΩr findings into the top 3 and a trust verdict.

---

## SyncΩr Synthesis

**What SyncΩr actually is:** A manual, button-driven push/pull of a single per-tenant `snapshot.json`, carrying only `projects` + `writr_scripts`. Despite the "cross-device sync" framing, it's a one-directional teleprompter-feeding mechanism, not a real sync engine.

### Top 3

**1. Last-writer-wins on a single file = silent creative-state loss (sync-1, critical)**
`POST /push` does `fs.writeFileSync(snapshot.json)` with no versioning, no `.bak`, no `pushed_at` staleness check, no merge. A laptop push of a stale/partial export silently clobbers a richer desktop snapshot on the server, with no recovery path. This is a direct violation of the Prime Directive ("Never lose creative state. Never break the creative thread without a recovery path"). Fix is cheap and high-leverage: copy existing → `snapshot.<timestamp>.json` before overwrite, and reject out-of-order `pushed_at`.

**2. ID-as-identity collides and destroys unrelated local projects (sync-3, high)**
`createProjectFromSnapshot` preserves the source device's autoincrement `id`. Across two independently-incrementing SQLite DBs these IDs collide: in skip mode the real import is silently dropped (counted as "skipped," no error surfaced); in overwrite mode `replaceProjectFromSnapshot` DELETEs the laptop's own unrelated project at that id and replaces it with the desktop's. Identity must be a device-independent `sync_id`/UUID, and overwrite must never DELETE a row whose `sync_id` doesn't match.

**3. Only 2 tables sync — the name oversells the function (sync-2, high)**
Export is `{ projects, writr_scripts }` only; import reconstructs a minimal `pipeline_state` (gate flags + current_stage). Dropped entirely: SeedΩr ideas, Id8Ωr research, DirectΩr shot lists, VaultΩr footage, EditΩr selects/beat briefs, PostΩr queue, MailΩr drafts, analytics. A second machine gets a hollow project — script present, everything else gone. Either honestly relabel it "Teleprompter handoff" or expand the payload. Presenting two tables as full device sync is a trust problem in itself.

*(Honorable mentions: sync-4 plaintext token retrievable via operator endpoint; sync-5 title+stage dedup that both skips updates and spawns duplicates. Both compound the three above.)*

### Verdict: **Not trustworthy as a sync system — trustworthy only as a narrow, one-direction teleprompter handoff.**

The Electron↔kre8r.app sync fails its single most important promise. Because of (1) it can silently lose state, because of (3) it never carried most of the state to begin with, and because of (2) it can actively destroy an unrelated local project on the receiving device. The dedup heuristics (sync-5) mean even the happy path can both skip real updates and create duplicates depending on timing. There is no version history, no conflict detection, and no staleness warning, so a creator has no way to even *notice* loss has occurred, let alone recover.

Right now it is safe **only** for the unidirectional flow it was likely born for: push approved scripts + project shells from the desktop hub to a teleprompter laptop that creates nothing of its own. The moment a second device originates real work, or two pushes race, the design loses data with no recovery path — disqualifying it from the "sync" label until sync-1 (versioned snapshots) and sync-3 (stable `sync_id` identity) are fixed. Those two are the minimum bar to make it trustworthy; sync-2 is what makes it *honest*.

Relevant files:
- `C:\Users\18054\kre8r\src\routes\sync.js` — hub side: push storage, pull, /token
- `C:\Users\18054\kre8r\src\routes\local-sync.js` — client side: export build, import dedup
- `C:\Users\18054\kre8r\src\db.js` — `createProjectFromSnapshot` / `replaceProjectFromSnapshot`
- `C:\Users\18054\kre8r\public\sync.html` — manual push/pull UI

## Findings (7 total)
### [CRITICAL] Snapshot push is last-writer-wins with a single file — silent data loss across devices
**bug** | C:\Users\18054\kre8r\src\routes\sync.js (push handler, fs.writeFileSync of snapshot.json)
The server (src/routes/sync.js POST /push) overwrites a single snapshot.json per tenant with fs.writeFileSync, no versioning, no merge, no conflict detection. If Jason pushes from desktop, then later pushes from the laptop (which only ever pulled a stale/partial snapshot), the laptop's smaller export silently clobbers the desktop's richer snapshot on the server. There is no history, no backup of the previous snapshot, and no pushed_at staleness check. This directly violates the Prime Directive ('Never lose creative state'). The only mitigation is the import side's title+stage dedup, but that does not protect the server snapshot itself — once overwritten, the prior state is gone with no recovery path.
**Fix:** Before overwriting, copy the existing snapshot.json to snapshot.<timestamp>.json (keep last N). Compare incoming pushed_at against stored pushed_at and reject/warn on out-of-order pushes. Better: key snapshots by source device id so a laptop push never overwrites a desktop push. At minimum keep one .bak so a bad overwrite is recoverable.

### [HIGH] Sync only carries projects + writr_scripts — most pipeline state never syncs
**bug** | C:\Users\18054\kre8r\src\routes\local-sync.js (push dbExport build) and src\db.js createProjectFromSnapshot whitelist
local-sync.js push builds db_export = { projects, writr_scripts } only. createProjectFromSnapshot imports a whitelist of project columns plus a minimal pipeline_state row (only gate_a/b/c flags and current_stage). Everything else is dropped: seeds/ideas (SeedΩr), Id8Ωr research, DirectΩr shot lists, VaultΩr footage DB, EditΩr selects/beat briefs, scheduled posts (PostΩr queue), MailΩr drafts, analytics. So 'sync' really means 'copy project shells + approved scripts to the teleprompter laptop,' not cross-device state sync. A creator pulling on a second machine gets a hollow project: the script is there but the footage, selects, shot list and gate context are not. This is a narrow teleprompter-feeding tool wearing the name of a general sync system — it does not earn the 'cross-device sync' framing in the docs/UI.
**Fix:** Either (a) honestly scope and label SyncΩr as 'Teleprompter handoff' (projects+approved scripts only), or (b) expand the export/import to the tables that actually represent creative state. Do not present it as full device sync while only two tables move.

### [HIGH] createProjectFromSnapshot forces original project IDs — collides with locally-created projects
**bug** | C:\Users\18054\kre8r\src\db.js createProjectFromSnapshot / replaceProjectFromSnapshot; import handler in local-sync.js
createProjectFromSnapshot inserts the project with its original id from the source device (the comment says 'preserves the original ID'). On a device that has created its own projects, autoincrement IDs from two devices will collide. import skips an incoming project only if existingIds.has(project.id), so a same-id-but-different-project on the laptop blocks the real import (counted as skipped, no error surfaced to the user), and in overwrite mode replaceProjectFromSnapshot DELETEs the laptop's own project at that id and replaces it with the desktop's — silent destruction of an unrelated local project. ID-as-identity across independently-incrementing SQLite DBs is unsafe.
**Fix:** Use a device-independent identity (e.g. a UUID/sync_id column on projects) for cross-device matching instead of the local autoincrement id. Never DELETE a local row in overwrite mode unless its sync_id matches the incoming sync_id.

### [MEDIUM] Sync token stored in plaintext .env and retrievable in plaintext via operator endpoint
**bug** | C:\Users\18054\kre8r\src\routes\local-sync.js upsertEnv; src\routes\sync.js GET /token and getTenantByToken in db.js
local-sync.js writes SYNC_TOKEN into .env in plaintext (upsertEnv). On the server, sync.js GET /api/sync/token returns every tenant's real sync_token in plaintext to any caller who has OPERATOR_SECRET, and getTenantByToken does a plain equality lookup against an unhashed sync_token column. A leaked token grants full push (overwrite) and pull of a tenant's snapshot. This mirrors known-issue #3 (OAuth tokens plaintext) and is the same class of risk for the sync credential.
**Fix:** Store only a hash of the sync_token server-side and compare hashes; treat the raw token as show-once at registration. Drop or tightly restrict the /token recovery endpoint, or have it rotate-and-return rather than reveal the existing secret.

### [MEDIUM] Import dedup heuristics can both skip real updates and create duplicates
**bug** | C:\Users\18054\kre8r\src\routes\local-sync.js import handler (titleMatch dedup, created_at script dedup)
On a fresh device, import matches incoming projects to local ones by exact title + current_stage. Two distinct projects with the same title (common for a creator iterating 'Garden Update') at the same stage will cause the second to be silently skipped. Conversely, once a project's stage advances on one device, the title+stage key no longer matches, so a re-pull imports it again as a NEW project (duplicate), because the id-based check only catches same-id rows. Script dedup relies on exact created_at string equality, which is brittle across timezone/format differences. Net: the merge can both lose updates and spawn duplicates depending on timing.
**Fix:** Match on a stable sync_id rather than title+stage; for updates, update-in-place by sync_id instead of skip-or-duplicate. Dedup scripts by a content hash or stable id, not created_at string equality.

### [LOW] Sync is fully manual with no staleness/auto-push safety net
**improvement** | C:\Users\18054\kre8r\public\sync.html (manual push/pull buttons); local-sync.js
Push and pull are button-only (sync.html); nothing auto-pushes after a work session and nothing warns that the server snapshot is stale. The Prime Directive asks 'if this goes wrong now, what does the creator lose and how do they get it back' — here, if Jason forgets to push before switching to the laptop, the laptop pulls old state with no indication it is old (pull just shows pushed_at, no 'X hours stale' warning relative to local edits). Combined with last-writer-wins (sync-1), forgetting to push is a realistic path to working off and then overwriting with stale data.
**Fix:** Add a prominent staleness indicator on pull ('snapshot is 3 days old'), and consider an opt-in auto-push on app close/idle from Electron. At minimum, warn before importing a snapshot older than the local last-push time.

### [LOW] Two overlapping sync route files and unclear ownership
**simplification** | C:\Users\18054\kre8r\server.js lines 280 and 645; src/routes/sync.js + src/routes/local-sync.js
There are two modules: src/routes/sync.js (server/operator side: register, push storage, pull, tenants, token) and src/routes/local-sync.js (client side: config, test, push proxy, pull proxy, import). Both are mounted in the same server.js (/api/sync and /api/local-sync), so a single instance plays both roles. This is workable for the operator's own box but blurs the 'this device is a client' vs 'this device is the hub' distinction and makes it easy to point a device's SYNC_SERVER_URL back at itself. The local-sync /status and /test both call the same remote /api/sync/status, duplicating logic.
**Fix:** Document/assert the role of each instance (hub vs client) and guard against SYNC_SERVER_URL pointing at the local instance. Collapse the duplicated status/test paths in local-sync.js.
