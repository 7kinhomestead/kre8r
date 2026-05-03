# Kre8Ωr — Active TODO
# Full specs and archived tasks → TODO-ARCHIVE.md

---

## NEXT TASKS (Session 71)

### 1. Check Apr 30 blog post YouTube embeds
- View "Why Hard Work Feels Different" and "The Life You Have Isn't the Only One"
  at 7kinhomestead.land/blog — confirm Error 153 is gone (kre8r-land iframe fix is live)
- If still 153ing, kre8r-land deploy may not have included the latest blog-post.html change

### 2. Blog body editor — verify working
- Hard refresh MailΩr (Ctrl+Shift+R) to clear cached JS
- Open Manage Posts → click ✏ on any post → confirm body loads in textarea
- If still empty: check Network tab for body-live request and response

### 3. Restart local Electron app to pick up voice calibration profile
- `data/voice-calibration.json` is written — Electron needs restart to load it into kv_store
- After restart: generate a WritΩr script and confirm calibration block appears in output

### 4. Load Rock Rich email sequences into MailerLite
- Welcome sequence (6 emails) + upgrade sequence written in Session 70
- Create automation in MailerLite, paste emails in order

### 5. HarvestΩr → kre8r.app bridge: verify member-check endpoint is live
- Deploy kre8r.app with Session 69 kajabi.js + server.js changes
- Test from harvestomr dev server: `POST https://kre8r.app/api/kajabi/member-check`
  with `{ email: "test@example.com" }` + `X-Internal-Key` header
- Confirm returns `{ active: false, reason: 'not_found' }` (expected for unknown email)
- Confirm a real Rock Rich member email returns correct tier

### 6. kre8r-land Production DB Backup Cron
- Wire daily backup on 7kinhomestead droplet — same pattern as kre8r.app (3am, 14-day rolling)
- sqlite3 CLI not installed — use node + better-sqlite3 backup script
- Script: `/home/landapp/kre8r-land/scripts/backup-db.js`
- Cron: `0 3 * * * node /home/landapp/kre8r-land/scripts/backup-db.js >> /home/landapp/logs/backup.log 2>&1`
- Confirm `/home/landapp/backups/` exists first

---

## NEXT TASKS (Session 63)

### ~~1. Replace kre8r-land Tool Page Links with Tracked /r/ URLs~~ ✅ Done Session 64
- db.js migration seeds 27 affiliate_links (all tool + gear page items) with show_on_gear=1
- water.html: IBC Tote + Big Berkey → https://kre8r.app/r/amazon/{key} (both render views)
- solar.html: LiTime 100Ah/200Ah + SunGold panels → /r/ tracked URLs
- lifestyle.html: Pressure Canner, Chest Freezer, Meyer Hatchery, Baker Creek → /r/ tracked URLs
- gear.html: All 20 fallback items updated to /r/ URLs; live API already returns proper hrefs

### 2. Land Finder Tool — TBD (discuss with Jason)

### 3. Cari Electron Setup (when Cari is home)
- Install Kre8Ωr Setup .exe on Cari's laptop
- Add `INTERNAL_API_KEY=d6d13be62e9ff637e09cde86cf506201b85413a4a63f8ff0338ac5fed0efc7a2` to her `.env`
  (AppData\Roaming\kre8r\.env — Electron creates this folder on first run)
- Walk her through 📥 Pull from Live → edit → 📤 Push to Live workflow
- Once confirmed working: she stops editing directly on kre8r.app for anything beyond gear
- Safe to extend sync to other tables (projects etc.) only AFTER this is confirmed

### 4. KinOS Auth Activation (when Cari is home)
- Set `KINOS_ADMIN_PW` + `SESSION_SECRET` in kinos/.env on the live server
- `pm2 restart kinos`
- Login as Jason → go to `/manage-passwords` → set passwords for all family members
- Set Karen last (she gets the 10-year cookie, logs in once, never again)

### 4. Kre8r Publish Schedule → KinOS Family Calendar Bridge
- When a project reaches `distribution` stage in PipΩr, POST to KinOS `/api/calendar/events`
  or similar — so YouTube publish date shows on the family calendar
- Requires: KinOS calendar event endpoint + Kre8r bridge call on stage change

### 5. Deploy KinOS + OrgΩr to Shared DigitalOcean Droplet
- Spin up $12/mo shared droplet for KinOS + OrgΩr
- Nginx config: kinos.life → port 3001, orgr.yourdomain.com → port 3002
- PM2 ecosystem file for both apps
- Set `ORGR_URL` + `ORGR_DEFAULT_ORG_ID` in Kre8r `.env` to activate commission bridge

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

### Testimonials Section (need 3–4 total)
- 1 strong one saved → `TESTIMONIALS.md` (Founding 50, solar tool, April 2026)
- Collect 2–3 more from community, then build testimonials section on:
  kre8r-land tool pages, gear page, Rock Rich landing page
- Tag each one with what it speaks to (solar tool, community, novice-friendly, etc.)

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
| ~~VaultΩr loop fix not live until Kre8r restarts~~ | ✅ Confirmed fixed + live Session 63 |
| ~~AffiliateΩr partner add + links loading broken~~ | ✅ Fixed (db.prepare export) Session 63 |

---

## INFRASTRUCTURE NOTES

- Kre8r: port 3000 (Electron desktop + kre8r.app on DO)
- KinOS: port 3001 (kinos.life — auth built Session 61, not yet activated on live server)
- OrgΩr: port 3002 (local only — auth built Session 61, activate with ORGR_ADMIN_PW)
- Deploy: `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r`
- OrgΩr PM2: `node %APPDATA%\npm\node_modules\pm2\bin\pm2 start server.js --name orgboard` (run from C:\Users\18054\orgboard)

---

## BEFORE BETA LAUNCH CHECKLIST
- [x] OrgΩr auth — built Session 61, needs ORGR_ADMIN_PW to activate
- [x] KinOS auth — built Session 61, needs passwords set when Cari is home
- [ ] Desktop-only feature gates
- [ ] Remove API key field from public/setup.html (operator pays)
- [ ] MirrΩr last-synced indicator
- [ ] press@7kinhomestead.com email forward
