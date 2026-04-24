# Kre8Ωr — Active TODO
# Full specs and archived tasks → TODO-ARCHIVE.md

---

## NEXT 3 TASKS (Session 60)

### 1. Deploy Kajabi Homepage v11
- Open `C:\Users\18054\Desktop\7KH Brand Artwork\7KH Web Tools\website code 7 Kin Homestead\7kh homepage\7kin-homepage_v11.html`
- Copy full file content → paste into Kajabi custom code block (replaces v10)
- Test: tool preview strip hover-expand, community video plays on hover, member badge shows 500+
- If live Kajabi member count needed: remove `MEMBER_COUNT_OVERRIDE` from kre8r-land `.env` + `pm2 restart kre8r-land --update-env`

### 2. 7 Kin Trusted Partners Infrastructure — kre8r-land
Wire OnlineLandHub RSS feed + build full trusted partners system:
- `trusted_partners` table: name, site_url, rss_feed_url, affiliate_param, commission_rate, logo_url, status
- Aggregator auto-appends affiliate param to listing URLs at ingest (per-source)
- `/api/land/partners` route — returns active partners list
- "7 Kin Trusted" badge on matching listings in the land finder
- Need from Jason: OnlineLandHub RSS feed URL + their affiliate param format

### 3. OrgΩr Bridge End-to-End Test + DigitalOcean Deploy
- Restart Kre8r Electron app (picks up INTERNAL_API_KEY + stats-export route)
- OrgΩr board → 🔗 KRE8R → SYNC NOW → confirm snapshot + available keys appear
- Map stats to divisions (e.g. videos_published_this_month → Production division)
- Deploy Kre8r to DigitalOcean:
  `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r pm2 restart kre8r`

---

## ACTIVE BACKLOG

### 7 Kin Trusted Partners Infrastructure — kre8r-land
Three confirmed partners: **BillyLand**, **LandLimited**, **OnlineLandHub** (RSS + referral commission).
- `trusted_partners` table: name, site_url, rss_feed_url, affiliate_param, commission_rate, logo_url, description, status
- Aggregator auto-appends affiliate param to every listing URL at ingest (per-source, stored in partners table)
- `/api/land/partners` route — returns active partners list
- **"7 Kin Trusted" display** on land finder page: vetted source badges on listings + a partner section showing logos/descriptions
- OnlineLandHub RSS feed: wire into `src/aggregator/sources.js` once feed URL confirmed
- Future: partner dashboard showing referral click counts (UTM tracking via redirect endpoint)

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
