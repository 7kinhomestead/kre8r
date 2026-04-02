# Kre8Ωr Session Log — 2026-04-02 (Session 14 — Id8Ωr Research Phase Overhaul)

## What Was Built — Session 14

---

### Id8Ωr — Bug Fixes & Rate Limit Architecture (`src/routes/id8r.js`, `public/id8r.html`)

#### Bug Fixes
- **Double-fire on mode select** — `querySelectorAll('[data-mode]')` was attaching click listeners to both `.mode-card` divs AND the `.mode-btn` buttons inside them, triggering two `/start` calls per click. Fixed by scoping selector to `.mode-card[data-mode]` only — button clicks bubble up to the card once.
- **`anthropic-beta` header** — confirmed correct value `'web-search-2025-03-05'` was in place from previous session.

#### Research Phase — Complete Rewrite
**Root cause:** 3 parallel Claude web_search calls (each up to 2048 tokens output) + summarization all fired within the same rate-limit window (30k input tokens/min), causing cascade failures on mindmap/package/brief.

**Backend changes (`src/routes/id8r.js`):**
- Research passes changed from `Promise.allSettled` parallel → fully sequential
- Added `getRecentMessages(messages, maxExchanges=6)` helper — windows conversation to seed + last 12 messages for all Claude calls
- YouTube and Data `max_tokens` reduced 2048 → 1024
- `/start` handler `max_tokens` reduced 512 → 256
- Research phase restructured into 4 explicit phases with SSE events:
  - `phase_start` → `phase_result` → `phase_wait {duration:65}` → 65s server-side `setTimeout` → next phase
  - Phase 1: YouTube (Claude web_search)
  - Phase 2: Data & Facts (Claude web_search)
  - Phase 3: VaultΩr cross-reference (local DB, no Claude)
  - Phase 4: Summarization (Claude, no wait after)
- Summarization wrapped in proper try/catch — fallback only fires on actual error
- Summarization input sliced: YouTube/Data at 2000 chars, Vault at 500
- `/mindmap`, `/package`, `/brief` all use `session.researchSummary` (condensed) not raw `session.researchResults`
- `/mindmap` adds `session.mindmapCache` — subsequent calls return cached result instantly
- `conversationText` in all downstream routes uses `getRecentMessages()` window

**Frontend changes (`public/id8r.html`):**
- Static 3-card research grid replaced with a live `#research-feed` — cards append dynamically as events arrive
- `phase_result` renders a phase card per type:
  - YouTube: extracts title lines as visual cards + truncated text
  - Data: extracts bullet points as `<ul>` + truncated text
  - Vault: clip name cards or plain status text
- `phase_wait` renders a countdown card with:
  - Large ticking countdown number (65 → 0)
  - Rotating musing quote (10 MUSINGS array, rotates every 10s with fade transition)
  - Progress bar depleting in sync with countdown
  - "Skip wait →" button — clears countdown visually, server wait continues naturally
- Delegated `click` handler on `#research-feed` handles all show-more/show-less toggles for dynamically created content

---

### Debug Logging Added & Left In
- `[mindmap] messages chars / summary chars / total chars` — console.log before Claude call in `/mindmap`
- Intentionally left for ongoing token monitoring

---

## Server State — End of Session 14
- PM2: online, pid 20468, uptime ~26min, 0 restarts since last manual restart
- All changes saved, no uncommitted issues
- Id8Ωr full flow tested: mode select → conversation → research phases → mind map

---

# Kre8Ωr Session Log — 2026-03-31 (Session 13 — Deployment + Upload Feature)

## What Was Built — Session 13

---

### Pre-Deploy UI Fixes (3 pages)

#### EditΩr — Footage Guard (`public/editor.html`)
- Added `projectsMap` to store full project objects on load
- `onProjectChange()` now checks `footage_count === 0` before enabling Build Selects
- If no footage assigned: Build Selects button disabled, amber notice shown inline:
  *"No footage assigned to this project yet. Go to VaultΩr and assign footage first."*
- Guard div injected once and toggled on project change — no DOM bloat

#### M2 PackageΩr — Empty State (`public/m2-package-generator.html`)
- `renderCutorPanel()` previously returned silently when `clips.length === 0`
- Now shows the CutΩr panel with count "0 APPROVED CLIPS" and message:
  *"Run CutΩr first to identify your strongest moments — packages will be built around those clips."*

#### ComposΩr — Prompt Mode UX (`public/composor.html`)
- Replaced amber warning energy with teal "active feature" framing
- `.suno-fallback` CSS changed from amber → teal (background, border, text color)
- Added `.prompt-mode-banner` CSS block + `#promptModeBanner` HTML element
- `checkSunoKey()` now toggles the banner: shows teal panel when `!sunoOk`:
  *"PROMPT MODE ACTIVE — Claude will write your Suno prompts. Paste them at suno.com/create."*
- Status pill changed from `⚠ No Suno Key` → `● Prompt Mode` (teal, not amber)
- Per-track fallback text: `"📋 Copy prompt → paste at suno.com/create → upload audio above"`

---

### Project 19 Archived
- Called `PATCH /api/projects/19/archive` to remove test project "1" from dashboard

---

### db.js — approveWritrScript Fix (`src/db.js`)
- `approveWritrScript()` now un-approves any previously approved script for the same project before marking the new one approved
- Prevents multiple `approved = 1` rows per project which caused stale script bugs in TeleprΩmpter

---

### Voice Profile — Owner Financed Land (`creator-profile.json`)
- Added full voice analysis entry for "Owner Financed Land.mp4"
- Captures rapid-fire sentence rhythm, embedded humor pattern, directness=8, formality=2
- Available for WritΩr weighted profile blending

---

### Git — Branches Aligned
- `feat/editor` and `master` pushed to GitHub
- Discovered `main` (GitHub default branch) was stale at an older commit
- `master` merged into `main` and force-synced — all branches now at same tip
- `master` is the working branch; every push now goes to both `master` and `main`

---

### DigitalOcean Deployment Scripts (`deploy/`)

#### `deploy/digitalocean-setup.sh`
Full fresh-droplet setup script for Ubuntu 22.04 LTS. Steps:
1. `apt-get update` + system packages (ffmpeg, nginx, certbot, python3-pip, ufw)
2. Node.js 20 via NodeSource
3. openai-whisper via pip3
4. PM2 global install
5. `kre8r` user creation
6. Git clone from `github.com/7kinhomestead/kre8r`
7. `npm install --production`
8. `.env` creation with `ANTHROPIC_API_KEY` placeholder
9. PM2 start + save + systemd startup hook
10. nginx reverse proxy: port 80 → 3000, WebSocket upgrade headers, `proxy_buffering off` for SSE, 500MB upload limit
11. Basic auth: username `demo` / password `kre8r2024` via `apache2-utils` + `.htpasswd`
12. UFW firewall: SSH + Nginx Full only

Run on fresh droplet:
```
curl -fsSL https://raw.githubusercontent.com/7kinhomestead/kre8r/main/deploy/digitalocean-setup.sh | bash
```

#### `deploy/deploy.sh`
One-liner redeploy script for future code pushes:
```bash
bash /home/kre8r/kre8r/deploy/deploy.sh
# git pull → npm install → pm2 restart
```

---

### VaultΩr — Direct Device Upload (`src/routes/vault.js` + `public/vault.html`)

#### Backend — `POST /api/vault/upload`
- New multer disk-storage instance: saves to `./uploads/` (override via `UPLOAD_DIR` env var)
- `uploads/` directory auto-created on server start if missing
- Accepts: mp4, mov, mts, avi, mkv, braw, r3d, ari — up to 10GB
- Filenames: `{timestamp}_{original_name}` to prevent collisions
- Runs `ingestFile()` (same path as folder ingest) for full classification pipeline
- Streams SSE: `uploaded` → `ingesting` → Vision classification events → `done`
- Deletes uploaded file from disk if intake fails (no orphaned files)

#### Frontend — "Upload from Device" section (`public/vault.html`)
- New `<!-- Upload from Device -->` section between Ingest Folder and DaVinci Projects panels
- Drag-and-drop zone with `dragover` / `dragleave` / `drop` handlers
- Hidden `<input type="file" accept="video/*">` fills the entire zone for tap-to-select (mobile-friendly)
- XHR upload (not fetch) for byte-level `progress` events
- Progress bar: 0–60% = upload bytes, 60–100% = intake classification
- SSE chunks parsed from `xhr.responseText` as they arrive (chunked streaming)
- Multi-file queue: files uploaded and ingested sequentially
- `fmtBytes()` helper formats transfer progress as KB / MB / GB
- Upload project select wired into `loadProjects()` targets array — auto-populated
- New CSS: `.upload-drop-zone`, `.upload-drop-zone.drag-over`, `.upload-progress-bar-*`, `.upload-log`, `.upload-bytes`
- Mobile-responsive: reduced padding at `max-width: 600px`

---

## Files Changed This Session

| File | Change |
|------|--------|
| `public/editor.html` | footage_count guard, projectsMap |
| `public/m2-package-generator.html` | empty state when no cuts |
| `public/composor.html` | Prompt Mode banner, teal fallback styling |
| `public/vault.html` | Upload from Device section + JS + CSS |
| `src/routes/vault.js` | POST /api/vault/upload endpoint |
| `src/db.js` | approveWritrScript un-approves previous |
| `creator-profile.json` | Owner Financed Land voice sample |
| `deploy/digitalocean-setup.sh` | Full DigitalOcean setup script |
| `deploy/deploy.sh` | Redeploy script |
| `SESSION-LOG.md` | This file |
| `TODO.md` | Updated next 3 tasks |

---

## Commits This Session

```
a0f2063  feat: VaultΩr direct device upload with live progress
386ae9e  Add DigitalOcean deployment scripts
760f1f4  Pre-deployment: all fixes, audit complete, ready for kre8r.app
5aa2ab7  Merge feat/editor → master
```

---

## Server State
- Local: PM2 running `kre8r` on port 3000
- GitHub: `main` and `master` both at `a0f2063` (in sync)
- Deploy script: live at `https://raw.githubusercontent.com/7kinhomestead/kre8r/main/deploy/digitalocean-setup.sh`
