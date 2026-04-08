# Kre8Ωr Session Log — 2026-04-08 (Session 24 — Claude Retry Feedback + Id8Ωr Phase Checkpoints)

## What Was Built — Session 24

---

### Feature 1: Claude API Retry Wrapper — generate.js

**Problem:** `src/routes/generate.js` had a local `callClaude` with zero retry logic.
A single 429 or network blip would crash PackageΩr, CaptionΩr, or MailΩr with no recovery.

**Fix:**
- Removed the 29-line local `callClaude` in `generate.js`
- Added `const { callClaudeMessages } = require('../utils/claude')` — shared util already has
  full exponential backoff on 429, 529, ECONNRESET, ETIMEDOUT
- Thin wrapper keeps all three call sites identical: `callClaude(system, user, tokens)`
- These routes are regular JSON (not SSE), so silent retry is the right behavior

**Files:** `src/routes/generate.js`

---

### Feature 2: Id8Ωr Phase Checkpoints — crash-safe research state

**Problem:** Id8Ωr research takes 6+ minutes (3 phases × 120s waits). A server restart
mid-research wipes everything — creator loses YouTube research, data phase, vault check.

**Solution:** Checkpoint after every phase_result. Recovery banner on next page load.

**`src/db.js`:**
- New table: `session_checkpoints (session_id PK, tool, data JSON, updated_at INTEGER)`
- `setCheckpoint(sessionId, tool, data)` — upsert via ON CONFLICT
- `getCheckpoint(sessionId)` — returns parsed data or null
- `deleteCheckpoint(sessionId)` — called on successful send-pipeline
- All three exported

**`src/routes/id8r.js`:**
- After each `send({ stage: 'phase_result', phase: N })`: `db.setCheckpoint(session_id, 'id8r', { phase: N, chosenConcept, phase1, phase2, phase3 })`
- After successful send-pipeline: `db.deleteCheckpoint(session_id)`
- New endpoint: `GET /api/id8r/checkpoint/:sessionId` — returns `{ found, tool, data, updated_at }`

**`public/id8r.html`:**
- `onResearchEvent`: handles `ev.stage === 'retrying'` — shows fixed-position toast:
  "Claude is busy — retrying in Xs… (attempt N)" with auto-fade after retry delay
- On load: async `checkForCheckpoint()` — queries `/api/id8r/checkpoint/:id`,
  shows recovery banner with phase summary + age ("saved 12m ago")
- "Show saved research" button: rebuilds research feed cards from checkpoint data,
  marks `researchComplete = true` + enables Continue button if all 3 phases present
- Dismiss button: closes banner, checkpoint stays in DB for next load

---

## What Was Built — Session 23

---

### VaultΩr Semantic Subject Tagging — Complete

**Problem:** 24 clips ingested overnight via Proxy Generator Lite. Without subject tags,
talking-head footage is hard to search or locate meaningfully.

**Philosophy:** Claude Vision already runs at ingest. We just weren't saving the topics it
sees. Adding subjects costs zero extra API calls on new footage, and existing clips can be
backfilled via re-classify (thumbnails already on disk — no re-ingest needed).

**`src/db.js`:**
- Migration: `ALTER TABLE footage ADD COLUMN subjects TEXT` (JSON array, idempotent)
- `insertFootage`: added `subjects` to column list and VALUES
- `updateFootage`: added `subjects` to allowed fields list

**`src/vault/intake.js`:**
- `getVisionPrompt()`: added `subjects` array to Vision JSON spec —
  "3-8 specific searchable tags: 'goat' not 'animal', 'raised garden bed' not 'garden'"
- `insertFootage` call: stores `JSON.stringify(classification.subjects)` on new ingest
- `processProxyUpdate` updateFootage call: stores subjects when proxy links to BRAW
- `reclassifyById` updateFootage call: stores subjects on individual reclassify

**`src/vault/search.js`:**
- Added `subjects TEXT` column to SCHEMA_CONTEXT so Claude generates correct WHERE clauses
- Updated LIKE rules: searches subjects alongside description
- Updated example: "chickens or goats" now searches both columns

**`src/routes/vault.js`:**
- Added `POST /api/vault/reclassify-subjects` SSE endpoint
- Finds all footage where `subjects IS NULL` but `thumbnail_path` exists
- Calls `reclassifyById` on each — no file touching, uses existing thumbnails
- Streams `start / tagging / tagged / done / error` events

**`public/vault.html`:**
- "⟳ Tag Subjects" button in FOOTAGE LIBRARY section header
- Live progress counter ("Tagging 3 / 24…") via SSE ReadableStream
- On done: reloads footage grid so subject pills appear immediately
- Subject pills render on every card (up to 5 tags, small gray chips)
- Folder path input now pre-fills from `/api/vault/watcher` on load (no more hardcoded path)
- `prefillWatcherPath()` called at DOMContentLoaded

---

### creator-profile.json JSON Parse Fix

**Problem:** User set `intake_folder` to `D:\1 .braw watch folder` but `\1` is an
invalid JSON escape sequence. Server silently fell back to old `D:/kre8r/intake` path.
Server also had a stale node process holding port 3000 across PM2 restarts.

**Fix:**
- Corrected `D:\1 .braw watch folder` → `D:\\1 .braw watch folder` in creator-profile.json
- Killed stale PID via PowerShell `Stop-Process -Force`
- Restarted PM2 — watcher now confirms `D:\1 .braw watch folder`

---

### DaVinci Proxy Generator Lite Workflow — Confirmed Working

- Proxy Generator watches `D:\1 .braw watch folder` (source BRAW location)
- Generates `.mov` proxies with same base name as original
- VaultΩr watcher has `depth: 5` — picks up proxies in DaVinci subfolders automatically
- `findBrawByBasename()` links proxies back to BRAW records by filename stem
- Result: 24/24 proxies ingested overnight with zero intervention ✓

---

## Next Session — Priority Order

### 1. Soul Builder Onboarding Wizard (`/setup.html`)
Full UI wizard that writes creator-profile.json through plain-English steps.
No JSON, no typed paths — native folder pickers (Electron), OAuth buttons,
dropdowns for camera type. Each step has a "why this matters" explanation.
Steps: Who are you → Voice → Footage folders → Camera type → Platform connections
→ Community tiers → Done (writes profile, starts watcher, shows dashboard).

### 2. Pipeline Tour
Interactive overlay walkthrough — 8 stops following the creative thread from
idea to posted. Triggered on first login, re-triggerable via "?" in nav.
Written the way you'd explain it to Cari. Plain English throughout.

### 3. Deploy to DigitalOcean (subjects + watcher path fix)
```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

### 4. AssemblΩr end-to-end test with today's Cari/Jason dialogue footage
First real in-pipeline shoot. SCRIPTED mode, alternating beats.
Watch beat_mapped SSE events closely — first multi-person assembly.

### 5. MirrΩr Content Universe rebuild + NorthΩr first strategy run
(UI tasks — user does these)

---

## Session Notes

- This session was context-summarized once mid-session
- Restart count on PM2 is high (60+) due to the stale process crash loop — not a sign
  of instability, just accumulated from the port conflict troubleshooting
- TODO.md needs update next session (Soul Builder + Tour added as top priorities)
