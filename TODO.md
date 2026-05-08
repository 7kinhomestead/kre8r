# Kre8Ωr — Active TODO
# Full specs and archived tasks → TODO-ARCHIVE.md

---

## NEXT TASKS (Session 71)

### ~~1. Check Apr 30 blog post YouTube embeds~~ ✅ Done Session 71
### ~~2. Blog body editor — verify working~~ ✅ Done Session 71
### ~~3. Restart Electron / voice calibration~~ ✅ Done Session 71
### ~~4. Load Rock Rich email sequences into MailerLite~~ ✅ Done — firing all day
### ~~5. HarvestΩr bridge verify~~ ✅ Live — one member got in with no help, did the thing

---

## COMPLETED THIS SESSION (Session 76) ✅
- ~~AssemblΩr Phase 1: VaultΩr auto-transcription queue~~ ✅ `transcribe-queue.js` + watcher wiring
- ~~AssemblΩr Phase 2: AI assembly re-enabled (Call 2), short-takes prompt, gold merger~~ ✅
- ~~AssemblΩr Phase 3: Two-panel approval UI (Proposed Sequence + All Takes), inline player~~ ✅
- ~~AssemblΩr Phase 4: EditΩr Room persistent chat + BrollΩr context injection~~ ✅
- ~~AssemblΩr Phase 5: DaVinci Output~~ ✅ Already done — build-selects.py handles selected_takes subclips
- ~~Whisper model re-download bug~~ ✅ Fixed with --download-root cache pin

---

## NEXT TASKS (Session 77)

### 1. Edit loneliness video in EditΩr → ReviewΩr → ClipsΩr
- Vault has all AI b-roll clips ingested from D:\kre8r\intake
- Script already written — load project in EditΩr, run SelectsΩr
- Cut talking-head against AI b-roll package
- ReviewΩr approval → ClipsΩr for short-form cut → CaptionΩr → PostΩr

### 2. BrollΩr — Save to Vault download helper
- CDN URLs expire (Higgsfield ~7-30 days) — local copy is the only safe long-term storage
- Add "⬇ Download to Intake" button on each video result that pipes the URL through
  the server to D:\kre8r\intake so VaultΩr auto-ingests it (no manual browser download)
- Route: `POST /api/brollr/download-to-vault` — streams remote URL → local file → triggers watcher

### 3. BrollΩr — Speak endpoint (lip sync)
- Wire `/v1/speak/higgsfield` — takes input_image + input_audio (WAV only) + prompt
- UI: upload audio clip + select character image → generate talking-head video
- Unlocks "talking to younger self" concept: generate younger-Jason image → record VO → lip sync
- SDK: `client.generate('/v1/speak/higgsfield', { input_image, input_audio, prompt, quality, duration })`

---

## NEXT TASKS (Session 75)

### ~~1. TikTok Re-submission~~ ✅ Done Session 74
- Fixed: /tos and /privacy routes live (express.static extensions: ['html'])
- Fixed: ToS + PP links added to login page and landing page footer
- Fixed: Homepage URL changed to kre8r.app/landing (not login page)
- Test account created (tiktok-reviewer / RockRich2026!) and submitted to reviewer
- Resubmitted — awaiting TikTok review (est. a few days)

### 2. ClipsΩr → DaVinci freeze-frame (PAUSED — resume when ready)
- No-overlap prompt rule + post-processing dedup applied — not yet verified
- Root pattern: clips with overlapping frame ranges from same source cause DaVinci cache collision
- If still freezing: try SetInPoint/SetOutPoint on MediaPoolItem instead of explicit frames
- Nuclear option: revert clip-markers.py to marker approach (full source + colored markers,
  creator blades manually) — originally described in file header, avoids all AppendToTimeline issues

### 3. Performance Velocity Alerts — NorthΩr
- MirrΩr sync runs on schedule; compare latest metrics to previous snapshot
- Alert thresholds: CTR spike (+2% in 24h), views velocity (2x baseline in 8h), comment surge
- NorthΩr dashboard: amber/red banner when a video is spiking

### 5. Auto Short-Clip ID from Timeline Transcript
- After timeline transcript is saved, Claude scans full text for high-tension moments
- Scores each segment: hook potential, curiosity gap, standalone shareability
- Pre-populates ClipsΩr with suggested clip ranges (start/end timestamps)
- Creator confirms or skips — no hunting through the video manually

### 6. Analytics → Angle Weighting in Id8Ωr
- MirrΩr data: calculate avg views/CTR/retention per content angle
- Inject performance weights into Id8Ωr system prompt: "system angle is currently outperforming by 3x"
- SeedΩr constellation: color intensity reflects angle performance, not just angle type

### 7. Gemini 2.5 Pro — Id8Ωr Research Phase (Claude orchestrates Gemini)
- Add GEMINI_API_KEY to .env (Google AI Studio — free tier during preview)
- Claude generates research queries → Gemini fetches with Google Search grounding → Claude synthesizes
- Toggle: if no GEMINI_API_KEY, fall back to current Claude research (graceful degradation)
- Test protocol: same topic through both pipelines, blind score hook quality, let videos decide

## COMPLETED THIS SESSION (Session 73) ✅
- ~~StudioΩr — YouTube Studio Intelligence Bridge~~ ✅ Live. Brief persists in DB indefinitely.
- ~~Comment Intelligence → SeedΩr~~ ✅ Live. 💬 From Comments button in SeedΩr toolbar.
- ~~Studio Intel brief expiry~~ ✅ No hard expiry. Timestamp shown. Amber at 30 days.
- ~~CleanΩr driver scan~~ ✅ PowerShell -File fix. Jason updated AMD + Realtek drivers.

---

## NEXT TASKS (Session 72)

### 1. Trusted Partner Badge — OLH Listings (kre8r-land)
- Add "7 Kin Trusted Partner" badge to OnlineLandHub listings on the land finder page
- Same badge style as BillyLand treatment
- Badge should be visually distinct — signals vetted/trusted source to visitors
- Wire per-source so each partner (BillyLand, LandLimited, OLH) gets its own badge

### 2. Partner Contract — Mock Up + Send
- Draft partnership contract for trusted land partners (BillyLand, LandLimited, OLH)
- Cover: referral commission rate, affiliate param requirements, data usage, term
- Send to partners for review/signing

### 3. MirrΩr — Full Video Reanalysis Sync
- Run the sync that reanalyzes all YouTube videos with updated calibration context
- Not done yet — back-burnered during Session 70/71 work
- Will feed updated retention/hook data back into Id8Ωr + WritΩr recommendations

### 4. kre8r-land Production DB Backup Cron
- Wire daily backup on 7kinhomestead droplet — same pattern as kre8r.app (3am, 14-day rolling)
- sqlite3 CLI not installed — use node + better-sqlite3 backup script
- Script: `/home/landapp/kre8r-land/scripts/backup-db.js`
- Cron: `0 3 * * * node /home/landapp/kre8r-land/scripts/backup-db.js >> /home/landapp/logs/backup.log 2>&1`

### 5. TikTok App Approval (waiting)
- Still in review as of May 3, 2026
- Check status — once approved, wire TikTok Analytics module (TikTΩkr)

### 6. Cari Electron Setup — back-burnered
- Not needed now given recent workflow wins. Revisit if she needs direct pipeline access.

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
| TikTok posting app in review | Waiting on Apple |
| OrgΩr PM2 process lost after machine restart | Fix: re-register with pm2 start |
| ~~VaultΩr loop fix not live until Kre8r restarts~~ | ✅ Confirmed fixed + live Session 63 |
| ~~AffiliateΩr partner add + links loading broken~~ | ✅ Fixed (db.prepare export) Session 63 |

---

## INFRASTRUCTURE NOTES

- Kre8r: port 3000 (Electron desktop + kre8r.app on DO)
- KinOS: port 3001 (kinos.life — ✅ auth activated, hub site live)
- OrgΩr: port 3002 (local only — activate with ORGR_ADMIN_PW when needed)
- Deploy: `cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master && sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r`
- OrgΩr PM2: `node %APPDATA%\npm\node_modules\pm2\bin\pm2 start server.js --name orgboard` (run from C:\Users\18054\orgboard)

---

## BETA LAUNCH — INTENTIONALLY BACK-BURNERED
Jason is keeping Kre8Ωr private for now. Having a superpower and not leveling the
playing field. Revisit when/if the calculus changes. Checklist preserved below for reference.
- [x] OrgΩr auth
- [x] KinOS auth + hub site live
- [ ] Desktop-only feature gates
- [ ] Remove API key field from public/setup.html (operator pays)
- [ ] MirrΩr last-synced indicator
- [ ] press@7kinhomestead.com email forward
