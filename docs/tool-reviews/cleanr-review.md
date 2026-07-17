# CleanΩr — Architectural Review
*Opus audit.*

## Synthesis
Synthesis of CleanΩr review.

## Top 3 (most dangerous, fix first)

**1. /move bypasses the scan whitelist (cleanr-2)** — The module's stated safety model is "delete/move only accepts paths that appeared in the last scan," but `isMoveSafe()` deliberately skips `scannedPaths` and validates path *shape* only. Result: a UI bug or crafted request can copy-then-delete ANY path — `D:\kre8r\intake` (raw footage), `creator-profile.json`'s directory, the kre8r project dir. This is the single biggest Prime Directive violation: it can relocate the soul config and raw footage with no whitelist constraint. Fix: require `scannedPaths.has(p)` in `isMoveSafe`, plus a hard deny-list for pipeline-critical roots.

**2. node_modules scan offers the running app's own deps for deletion (cleanr-1)** — `devRoots` includes `C:\Users\18054` scanned to depth 3, so `C:\Users\18054\kre8r\node_modules` (depth 2) always appears as deletable "junk." Selecting it runs `fs.rmSync` recursively on the live app's dependencies — better-sqlite3 native bindings and everything else vanish, server/Electron crash immediately, no recovery for a non-coder beyond a folder they don't know to `npm install`. Fix: exclude any node_modules that is an ancestor of `__dirname`/`process.cwd()`.

**3. Junctions/symlinks followed during recursive delete and copy (cleanr-3)** — `getDirSize()` skips symlinks when measuring, but `/delete`'s `fs.rmSync(recursive)` and `/move`'s hand-rolled `copyDir()` do not. Windows Temp / browser caches legitimately contain junctions; following them deletes or relocates data far outside the intended scope — the blast radius escapes the scanned folder entirely. Fix: `lstat` each entry, refuse to recurse into reparse points, delete the link not the target.

## Verdict: NOT safe in current form. Effective, yes — but not safe.

The tool does real work, but three independent paths each let it destroy or relocate data outside what the user actually selected — and two of them (move-anywhere, delete-own-node_modules) directly endanger the Prime Directive's irreplaceables (soul config, raw footage, the running app). Compounding factors: deletes are permanent with no Recycle Bin (cleanr-6), and recursive deletes don't re-validate children (cleanr-4). Severity stacks: a single mis-click or client bug currently has a credible path to unrecoverable loss.

Safe and effective *after* three changes:
1. Whitelist-gate `/move` + deny-list pipeline roots (`D:\kre8r`, project dir, profile location).
2. Exclude the app's own install tree from the node_modules scan.
3. Refuse to traverse junctions/symlinks in delete and copy.

Strongly recommended alongside: route deletes through the Recycle Bin (cleanr-6), and — before any multi-tenant deploy — gate CleanΩr to the root instance only, since it operates on the host filesystem (cleanr-5, cleanr-8). Until at least the top 3 land, treat CleanΩr as local-only and not safe to expose.

Relevant file: `C:\Users\18054\kre8r\src\routes\cleanr.js`

## Findings (9 total)
### [HIGH] node_modules scan offers kre8r's own running node_modules for deletion
**bug** | C:\Users\18054\kre8r\src\routes\cleanr.js — /scan handler, devRoots = [USERPROFILE, 'C:\Users\18054', ...] + findNodeModules(devRoots, 3)
The node_modules scan walks devRoots including USERPROFILE (C:\Users\18054) and 'C:\Users\18054' with maxDepth=3. C:\Users\18054\kre8r\node_modules sits at depth 2, so it is always listed as deletable 'junk'. If Jason selects it (the UI presents node_modules as a safe cleanup category 're-run npm install to restore'), the delete endpoint will fs.rmSync it recursively while the server is running. That removes better-sqlite3's native bindings and every other dependency of the live app — the Electron app/server crashes immediately and won't restart until npm install is re-run. This directly violates the Prime Directive: deleting the running app's dependencies mid-session loses creative state with no obvious recovery path for a non-coder. The description 're-run npm install' assumes Jason knows to do that and which folder it was.
**Fix:** Exclude the app's own install tree from the node_modules scan. Compute the kre8r project root (path.resolve(__dirname, '..', '..')) and skip any node_modules whose path is under it. More robustly, skip any node_modules that is an ancestor of process.cwd()/__dirname. Also consider lowering the default risk: node_modules deletion of an actively-used project is rarely worth the danger — gate it behind an explicit confirmation or drop the category for the root instance.

### [HIGH] Move endpoint bypasses the scan whitelist that the safety model promises
**bug** | C:\Users\18054\kre8r\src\routes\cleanr.js — isMoveSafe() and POST /move
The file header states the safety model as 'Delete/move only accepts paths that appeared in the last scan.' But /move uses isMoveSafe(), which deliberately does NOT check scannedPaths — it only validates that the path is an absolute Windows path, not under a NEVER_DELETE system dir, not a system extension, >=2 components deep, and exists on disk. That means /move will copy-then-delete (i.e. permanently remove from source) ANY arbitrary path the caller supplies — e.g. D:\kre8r\intake (raw footage), the creator-profile.json's directory, or C:\Users\18054\kre8r\creator-profile.json's parent, none of which were ever scanned. The auth gate limits this to a logged-in user, but a malformed/maliciously-crafted client request or a UI bug can move critical pipeline data off its expected location. The comment 'safe even across server restarts' rationalizes dropping the whitelist, but the whitelist's real purpose is to constrain WHICH paths are eligible, not to survive restarts.
**Fix:** Require scannedPaths.has(p) in isMoveSafe (same as isPathSafe), OR maintain a separate persisted whitelist for move candidates. At minimum, add an explicit deny-list for pipeline-critical roots (D:\kre8r, the kre8r project dir, creator-profile.json location) so a path-shape-only check can never relocate footage or soul config.

### [HIGH] Directory junctions/symlinks are followed during recursive delete and copy
**bug** | C:\Users\18054\kre8r\src\routes\cleanr.js — POST /delete fs.rmSync recursive; POST /move copyDir() and fs.rmSync
getDirSize() correctly skips symlinks when measuring, but the actual destructive operations do not. In /delete, fs.rmSync(p, { recursive: true, force: true }) on a directory that is (or contains) a junction/symlink will traverse it. In /move, the hand-rolled copyDir() uses readdirSync + recursion with no symlink/junction check, then fs.rmSync the source — so a junction inside a scanned temp dir gets its TARGET copied and the source junction removed (and rmSync can delete through the junction into the real target). On Windows, %LOCALAPPDATA%\Temp and Chrome/Edge cache dirs can legitimately contain junctions, and crash-dump/WER paths sometimes do. Following them can delete or relocate data far outside the intended cleanup scope.
**Fix:** Before deleting/copying a directory, lstat each entry and refuse to recurse into entries where stat.isSymbolicLink() is true (delete the link itself, never its target). For the top-level path, lstat p and reject if it is a reparse point/junction. In copyDir, branch on entry.isSymbolicLink() and skip rather than dereference.

### [MEDIUM] Recursive delete of a directory only re-checks the dir root, not its contents
**bug** | C:\Users\18054\kre8r\src\routes\cleanr.js — isPathSafe + POST /delete recursive branch
isPathSafe(p) validates only the directory path p against NEVER_DELETE and the whitelist. /delete then does fs.rmSync(p, {recursive:true}) removing ALL descendants. But scannedPaths only contains the directory paths actually emitted as items (e.g. a Chrome Cache dir, a node_modules dir), not their individual children. The header claims 'Directories are deleted recursively only if the entire dir was scanned' — but nothing enforces that the scanned set equals the dir's true contents. If a category emits a directory item whose subtree has grown or contains something unexpected since scan time (TOCTOU), it is all deleted with no per-child safety check. The NEVER_DELETE_EXTS guard (.exe/.dll/.sys) is also never applied to children of a recursively-deleted directory.
**Fix:** For directory deletes, either (a) only allow recursive delete for a small set of known-safe category roots (temp/cache), or (b) re-walk the directory at delete time and refuse if any child matches NEVER_DELETE_EXTS or sits outside the expected root. Re-validate just before the destructive call to shrink the TOCTOU window.

### [MEDIUM] Scan whitelist is module-global, not per-user/session — cross-request and tenant leakage
**bug** | C:\Users\18054\kre8r\src\routes\cleanr.js — const scannedPaths = new Set() (module scope)
scannedPaths is a single module-level Set shared across all requests and (on multi-tenant subdomains) all tenants. scan clears it globally, so two concurrent users scanning will clobber each other's whitelist; a delete fired by user A can be validated against user B's scan results. On the root instance this is one machine so low impact, but the design is tenant-blind, which matches Known Issue #4 (background/shared state not tenant-aware). It also means a scan by any logged-in user repopulates the only whitelist used by delete, weakening the per-request safety guarantee.
**Fix:** Key the whitelist by session id (or tenant slug + session), e.g. a Map<sessionId, Set<string>> with a TTL, and validate delete against the caller's own scan set. This is also a hard blocker before CleanΩr ships to any multi-tenant instance — it operates on the host filesystem, which a tenant must never be able to touch. Consider gating CleanΩr to the root instance only (skip mounting when tenantContext is active).

### [MEDIUM] Deletes are permanent (no Recycle Bin) — violates Prime Directive recoverability
**improvement** | C:\Users\18054\kre8r\src\routes\cleanr.js — POST /delete (large_files category feeds this)
fs.unlinkSync / fs.rmSync delete straight off disk with no undo. The Prime Directive asks 'if this goes wrong, what does the creator lose and how do they get it back?' For temp/cache that's fine, but the same /delete path also handles Large Files (>50MB in Downloads/Desktop/Documents/Videos/Pictures) — exactly where a creator's exports, raw clips, or thumbnails live. A mis-click permanently destroys a video export with zero recovery. There is no confirmation-of-size, no dry-run, and no Recycle Bin.
**Fix:** Route deletes through the Windows Recycle Bin instead of permanent unlink (e.g. shell SHFileOperation via a tiny PowerShell call, or a maintained 'recycle' npm package). At minimum, for the large_files category, move-to-D: should be the default action and permanent delete should require a separate explicit confirmation.

### [MEDIUM] PowerShell endpoints have no maxBuffer (except /drivers) — large output truncates JSON.parse and 500s
**bug** | C:\Users\18054\kre8r\src\routes\cleanr.js — GET /drives, /processes, /startup execAsync calls
/drives, /processes, and /startup call execAsync(powershell ...) with default maxBuffer (~1MB in older Node, 1MB historically). Win32_StartupCommand and Get-Process Path expansion can exceed this on a loaded machine, causing exec to error with 'maxBuffer exceeded' or producing truncated stdout that fails JSON.parse — the endpoint then 500s. /drivers already learned this lesson (maxBuffer: 8MB). The inconsistency shows the others were not hardened.
**Fix:** Pass { maxBuffer: 8 * 1024 * 1024 } to all three execAsync calls, matching /drivers. Wrap JSON.parse in try/catch returning a clean error rather than letting a parse failure surface as a 500.

### [LOW] Windows-only tool with no platform guard — silently broken on the deployed Linux server
**improvement** | C:\Users\18054\kre8r\src\routes\cleanr.js (entire module) + public/cleanr.html nav link
Every endpoint shells out to powershell and hardcodes C:\Windows\Temp, %LOCALAPPDATA%, etc. The production app runs on a DigitalOcean Linux droplet (per CLAUDE.md deploy notes). On Linux, execAsync('powershell ...') throws ENOENT and scans return empty; the nav still links to cleanr.html. This is dead weight on the hosted instance and a confusing 500 for any non-Jason user who opens it. It earns its place only on Jason's local Electron machine.
**Fix:** Guard the whole router with if (process.platform !== 'win32') return res.status(501).json({ error: 'CleanΩr is Windows-only' }), and hide the nav entry on non-Windows / non-root instances. This keeps it as a local-only infrastructure tool rather than shipping broken endpoints to the cloud.

### [LOW] Scan walks user Downloads/Documents/Videos to depth 4 every run — slow and overlaps real footage
**improvement** | C:\Users\18054\kre8r\src\routes\cleanr.js — findLargeFilesInDirs, getDirSize (synchronous, on request thread)
findLargeFilesInDirs walks Downloads, Desktop, Documents, Videos, Pictures to maxDepth 4 with synchronous fs.statSync on every file, and getDirSize recurses cache dirs to depth 2-4. On a creator's machine the Videos folder can hold thousands of large clips; a synchronous full walk on the event loop blocks the server for the duration of the scan (no worker thread, no async). It also surfaces legitimate footage as 'junk' candidates, increasing the chance of a destructive mistake. Question of earning its place: a full-disk large-file scanner overlaps with VaultΩr's footage DB and adds risk for marginal benefit.
**Fix:** Move the heavy walk off the request thread (worker_threads or fs.promises with yielding), and reconsider whether the Large Files category belongs at all — if kept, exclude D:\kre8r and any path VaultΩr tracks, and label it clearly as 'your files, not junk' so it is never lumped in with cache cleanup.
