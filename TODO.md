# Kre8Ωr — Active TODO
# Full specs and archived tasks → TODO-ARCHIVE.md

---

## NEXT 3 TASKS (Session 57)

### 1. Bridge End-to-End Test + DigitalOcean Deploy
- Restart Kre8r Electron app (picks up INTERNAL_API_KEY + stats-export route)
- OrgΩr board → 🔗 KRE8R → SYNC NOW → confirm snapshot + available keys appear
- Map stats to divisions (e.g. videos_published_this_month → Production division)
- Verify stat badges appear on division headers
- Deploy Kre8r to DigitalOcean (media kit fixes + bridge both undeployed):
  `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r pm2 restart kre8r`

### 2. Claude "Posted Employee" Chat per Job Card — OrgΩr
Each job card gets a 🤖 ASK button → chat modal pre-loaded with:
- Job context: title, purpose, VFP, policies
- Kre8r stats mapped to that division (from bridge snapshot)
- System prompt: "You are the posted employee for [title]. VFP: [vfp]. Stats: [stats]."
No new tables needed. Uses existing claude-assist route pattern.

### 3. OrgΩr + KinOS Auth (Security — Before Team Access)
OrgΩr and KinOS are both unprotected. Brooklynn + Cari access requires auth first.
- Copy Kre8r's auth pattern: express-session + better-sqlite3 store, bcrypt, /login page
- OrgΩr: seed owner from ORGBOARD_OWNER_PW env var. Viewer = read-only, Owner = full.
- KinOS (kinos.life): currently open to the internet — security vulnerability, fix first.

---

## ACTIVE BACKLOG

### Media Kit — Press Email
press@7kinhomestead.com needs to exist before kit goes public.
Simplest: forward from press@7kinhomestead.com → 7kinmedia@gmail.com via Zoho (free tier).

### MirrΩr: Last Synced Indicator + Sync Now Button
- Store last_synced_at in kv_store after each MirrΩr sync
- NorthΩr: "YouTube data last synced: X days ago" + 🔄 Sync Now button
- Amber warning if > 7 days stale

### Desktop-Only Feature Gates (before beta launch)
Detect via `window.__KRE8R_ELECTRON`. Add "🖥️ Desktop App Only" badges on:
PostΩr upload, VaultΩr watcher, EditΩr proxy playback, DaVinci, Whisper, TeleprΩmpter QR codes.

### TikTok Analytics Module (after TikTok app approval ~April 28-30)
Separate from MirrΩr. Own DB tables (tiktok_videos, tiktok_metrics).
Short-form calibration context feeds WritΩr SHORT FORM only — never mixed with YouTube.
ConstellΩr: platform selector [YouTube] [TikTok] [All Ideas] view.

### VaultΩr Full-Text Tag Search
Tag cloud chip filter ✅ live. Remaining: text input → filter across all tag values in real time.

### Cari Editor Role
New role between owner/viewer in Kre8r auth. Read + upload, no admin/delete.
Needs OrgΩr auth built first (same session).

---

## KNOWN ISSUES

| Issue | Status |
|-------|--------|
| TeleprΩmpter: no back button from display screen | Open |
| AudiencΩr tag filter (Kajabi 500 on filtered requests) | Low priority |
| TikTok posting app in review (~April 28-30) | Waiting on Apple |
| OrgΩr PM2 process lost after machine restart | Fix: re-register with pm2 start |

---

## INFRASTRUCTURE NOTES

- Kre8r: port 3000 (Electron desktop + kre8r.app on DO)
- KinOS: port 3001 (kinos.life — family OS, currently no auth)
- OrgΩr: port 3002 (local only, no auth yet)
- Deploy: `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r`
- OrgΩr PM2: `node %APPDATA%\npm\node_modules\pm2\bin\pm2 start server.js --name orgboard` (run from C:\Users\18054\orgboard)

---

## BEFORE BETA LAUNCH CHECKLIST
- [ ] OrgΩr auth
- [ ] KinOS auth
- [ ] Desktop-only feature gates
- [ ] Remove API key field from public/setup.html (operator pays)
- [ ] MirrΩr last-synced indicator
- [ ] press@7kinhomestead.com email forward
