# Kre8Ωr — Next Session TODO

---

## ⚡ Task 1 — Deploy to DigitalOcean

All local changes are committed and ready to deploy. Run on the DO server:

```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

Verify after deploy:
- `https://kre8r.app/vault.html` → Archive to D: section visible
- `https://kre8r.app/editor.html` → Page says AssemblΩr
- `https://kre8r.app/mirrr.html` → /debug-views route returns 404 (removed)

---

## ⚡ Task 2 — MirrΩr: Rebuild Content Universe + Save Secrets to Soul

DNA cache was cleared after a force resync/prune. Needs rebuild with clean data.

**Steps:**
1. Open MirrΩr → Content Universe section → click **Refresh / Rebuild**
2. Confirm constellation renders correctly (no live stream nodes)
3. Click **Discover Secrets** → confirm no live repost artifacts
4. Click **Save Insights to My Soul →** → confirm `creator-profile.json` updates

---

## ⚡ Task 3 — NorthΩr: First real strategy run

- Open `/northr.html` → set monthly goals (target videos, emails)
- Click **Generate Strategy** → confirm SSE stream completes and report renders
- Click **Check Alerts** → see if any thresholds are triggered

---

## ⚡ Task 4 — Beta prep: test AssemblΩr end-to-end + TeleprΩmpter

### AssemblΩr — needs real footage test
Run AssemblΩr on a current project with talking-head BRAW proxies ingested.
Expected flow: VaultΩr ingest → proxy_path set → AssemblΩr transcribes → beat map → sections.

### TeleprΩmpter 3-device live test
1. Start display on laptop → Load Script → Start → note 4-digit session code
2. Phone 1 (Control): `http://{ip}:3000/teleprompter.html?mode=control&session=XXXX`
3. Phone 2 (Voice): `http://{ip}:3000/teleprompter.html?mode=voice&session=XXXX`

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```

---

## Technical Debt (Priority Order)

1. **better-sqlite3 migration** — before commercialization. Crash recovery risk.
2. **Engine vs Soul audit** — hardcoded creator data in route handlers.
3. **No automated tests** — no error monitoring, no structured logging.

---

## ✅ DONE THIS SESSION

- AssemblΩr engine (src/editor/assemblr.js) — Claude semantic beat mapping,
  chronological sort, last-take-wins, 2s lead-in / 3s tail, gold moments
- AssemblΩr UI (public/editor.html) — renamed, beat cards, take-swap on click,
  missing beats banner, quality badges (clean/strong/fumbled/ok)
- nav.js: EditΩr → AssemblΩr
- Shoot folder auto-creation in PipΩr create route (H:\[ProjectTitle]\)
- VaultΩr intake: Proxy Generator Lite support (plain MP4 proxy naming)
- proxy_path stored on footage records — fixes BRAW transcription bug in Whisper
- Archive pipeline: POST /api/vault/archive/:project_id SSE + GET /api/vault/storage
- Archive UI in vault.html: storage meters with color thresholds, project selector,
  progress log, DaVinci relink report panel
- Electron DB rolling backup every 5 min (electron/main.js)
- MirrΩr /debug-views endpoint removed (was exposing analytics unauthenticated)
- davinci.js detectPython() — confirmed already implemented correctly
- Id8Ωr debug log — confirmed already removed
