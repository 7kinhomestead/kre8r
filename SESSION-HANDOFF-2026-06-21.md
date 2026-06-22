# Session Handoff → Master Project Session
*Window dates: Jun 20–21 2026 (overnight into Father's Day). Purpose: rundown + file changes + outstanding pre-launch items for the master punch list. Jason is still finishing the solar course in the originating window.*

---

## 1. What this window accomplished

### A. Login outage — FIXED & DEPLOYED (was a live incident)
- **Root cause:** Kajabi's `GET /contacts?filter[email]` started being **ignored** (returned the newest page regardless of email), so `member-check` mapped *every* email to the newest contact → members logged into the wrong account (incl. the `+otest` test account), then `not_found` for everyone else.
- **Fix (kre8r.app `src/routes/kajabi.js`):** member-check now reads an **owned `kajabi_members` table** (email→contact_id+tier) refreshed daily by the existing 8am `runBulkSync`; live Kajabi only as a same-day-joiner fallback. **Login no longer depends on Kajabi being healthy.** Table populated (~1,701 members). Manual rebuild: `POST /api/kajabi/refresh-member-mirror` (internal key).
- **Orchard (harvestomr) auth + cleanup:** adopt-or-create on `kajabi_contact_id`, reactivate sync-mislabeled `removed`. New bridge admin endpoints: `member-inspect`, `member-delete`, `member-reassign`. Dissolved the `+otest` row; reassigned it to Jason Carpenter (founding50, crest+points intact); backfilled contact_ids for Carpenter (2706823840) and Jason Rutland (member #1 → 2706273707).
- **Deployed:** kre8r.app and harvestomr.

### B. "Land On A Shoestring Budget" — Garden course, SHIPPED (pending offer attach)
- 3 deep-research passes (tax auctions, owner-finance safety, regulatory due diligence) → **7 modules / 22 lessons** drafted in Jason's voice (`COURSE-LAND-DRAFTS.md`).
- **Kajabi course id `2149488849`** (evergreen, published) — all 7 modules/22 lessons created via MCP. **Jason uploaded all videos.** Tools linked (Freedom Calculator → `/freedom`).
- **Landing page** `7kinhomestead.land/land-course` (teal, course "Land" hero image, drives to Garden checkout `offers/yogN2TSW`). **Garden page** (`/garden`) updated with the new course.

### C. Reusable course themes + tracking — DONE
- 4 color-variant Kajabi themes in `kre8r/kajabi-themes/` (teal=Land, orange=Rock Rich, gold=Solar, azure=Out of Your Own Way), all on the gamified `7kin-course-template` base.
- **Completion beacon repointed** from a dead ngrok tunnel → the always-on land box `https://7kinhomestead.land/api/kajabi-track`. Jason applied the themes to all courses → **tracking now works for the 1,709 Rock Rich Starting System members.** Beacon proven course→land-box→Orchard-points end-to-end with a real member.

### D. "Intermediate Off-Grid Solar" — Garden course, FULLY DRAFTED (not yet built in Kajabi)
- 4 deep-research passes (design+BOM · spec-sheets/buying · troubleshooting/fault-codes · SunGold+LiTime gear docs) → `SOLAR-COURSE-RESEARCH.md` (cited).
- Locked 7-module blueprint (`SOLAR-COURSE-BLUEPRINT.md`) → **7 modules / 24 lessons** drafted (`COURSE-SOLAR-DRAFTS.md`), incl. 3 written supplements (BOM decoded, spec-sheet guide, fault-code field reference w/ SunGold + LiTime + Victron/MPP/EG4/Growatt).
- **Anchor system = SunGold inverter + 4× LiTime 230Ah @ 48V (~12kWh)** → becoming the mother-in-law's RV. EG4 12k + 35× CW 450W = **Rock Rich S2 advanced (15kW/40kWh)**, kept out. Affiliate: SunGold+LiTime build / Signature Solar+EG4 rest.
- 2 of 18 SVG diagrams built (M1 system-flow + M5 wiring centerpiece — Jason red-penning the grounding in Canva).

---

## 2. Files created / altered this window

**kre8r** (github `7kinhomestead/kre8r`, deploy → kre8r.app):
- `src/routes/kajabi.js` — owned `kajabi_members` mirror + index fallback + `refresh-member-mirror` endpoint
- `src/db.js` — `kajabi_members` table
- `server.js` — exempt `refresh-member-mirror` from session auth
- `GARDEN-COURSES-PLAN.md` — updated (Land done + solar scope)
- **new:** `COURSE-LAND-DRAFTS.md`, `SOLAR-COURSE-RESEARCH.md`, `SOLAR-COURSE-BLUEPRINT.md`, `COURSE-SOLAR-DRAFTS.md`, `SESSION-HANDOFF-2026-06-21.md`
- **new dir:** `kajabi-themes/` (theme source + `THEMES.md` + 4 upload-ready zips + READMEs)
- ⚠️ `course-build.json` — temp build artifact in repo root, safe to delete

**kre8r-land** (github `7kinhomestead/kre8r-land`, deploy → land box as **landapp**):
- **new:** `public/land-course.html` (course landing page)
- `public/garden.html` — added Land course card + meta
- `server.js` — `/land-course` route
- `src/utils/sitemap.js` — `/land-course` in STATIC_PAGES
- (earlier this session: `src/routes/kajabi-track.js` `mirrorLessonPoints`, `public/about.html`)

**harvestomr** (Orchard, github `7kinhomestead/harvestomr`, deploy as root):
- `src/routes/bridge.js` — `member-inspect`, `member-delete`, `member-reassign`
- (earlier: `src/routes/auth.js` adopt/reactivate, `config/points.json` `lesson_complete:10`)

**Memory:** updated `project_garden_courses.md`, `project_kajabi_tier_detection.md`.

---

## 3. OUTSTANDING — for the master pre-launch punch list

**Land course launch (this is the active launch window):**
1. **Attach the Land course (`2149488849`) to offers** — Garden + Founding 50 + Friends & Family — in Kajabi admin. *MCP cannot grant offer access; manual. Course is NOT live to members until this is done.* (Jason said he's doing this now / "adding to access groups.")
2. **Deploy kre8r-land** so the landing page + Garden update go live: `sudo -iu landapp bash -c 'cd /home/landapp/kre8r-land && git pull origin master && pm2 restart kre8r-land'`
3. **Father's Day launch announcement** (community + email) — planned as a **Father's Day drop Sun Jun 21**. Copy not yet written (originating session to draft in Jason's voice with the `/land-course` link on request).
4. **Verify before publish:** billyland.com current terms (clean-title guarantee / no-prepay-penalty / 5% final-payment discount) and the landlimited.com "Matt" recommendation — both in Land Module 4.
5. **Confirm the Land Finder tool link** is wired in Land Lesson 2.3 (Freedom Calculator already linked to `/freedom`).
6. **Member comms:** anyone who hit login errors during the outage (e.g., Sandra Cromwell) must request a **FRESH magic link** — old ones are single-use and were spent.

**Housekeeping / cross-course:**
7. **Delete the stray "Test Module / Test Lesson"** still published in *Understanding Off Grid Solar* (course `2149380229`) before traffic.
8. **Linda (legal AI) reviews:** publish the finalized Land TOS/Privacy to the live page; later, review the Solar Module 5 (wiring/liability) before that course ships.

**Solar course (next, post-Land):**
9. Jason reviews `COURSE-SOLAR-DRAFTS.md` → build the remaining **16 SVG diagrams** (M5 wiring + M1 flow done; Jason red-penning M5 grounding) → Linda reviews M5 → yt-dlp the solar videos → build MCP course + apply the **gold** theme → landing page (gold) → add to Garden offer.

**Jason's own track:** he's about to record the **series of launch videos** for the launch window.
