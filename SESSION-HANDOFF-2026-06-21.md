# Session Handoff → Master Project Session
*Window dates: Jun 20–21 2026 (overnight into Father's Day). Purpose: rundown + file changes + outstanding pre-launch items for the master punch list. Jason is still finishing the solar course in the originating window.*
*▸ **UPDATED Jun 22 2026** — see the ⭐ section immediately below; the solar course is now fully BUILT, PUBLISHED, and LIVE, and the Garden page was rebuilt.*

---

## ⭐ UPDATE — Jun 22 2026: SOLAR COURSE SHIPPED + GARDEN PAGE REBUILT

Everything in section D below ("Intermediate Off-Grid Solar — fully drafted, not yet built") is now **DONE and LIVE**. Plus a Garden-page redesign and a few fixes. Rundown:

### A. "The Mysteries of Off-Grid Solar" — BUILT, PUBLISHED, LIVE in the Garden ✅
- **Renamed** from "Intermediate Off-Grid Solar" → **"The Mysteries of Off-Grid Solar"** — a whodunit/detective theme (Jason's idea, off a movie-poster he made). Tagline **"Some cases aren't solved. They're designed."**; closer **"Shine a light on the darkness. Case closed."** Light touch: case-file module titles (Open the Case → … → Case Closed), one-line frames; lesson titles + prose kept as-is.
- **Kajabi evergreen course `2149490461`** (site `2148808568`). All IDs + admin links in **`kre8r/SOLAR-COURSE-KAJABI-IDS.md`** (the canonical reference for this course).
- **7 modules / 23 lessons poured** from `COURSE-SOLAR-DRAFTS.md` (scaffolding stripped) + a **Bonus** video lesson (M5) + a **glossary** lesson (M1). **ALL modules + lessons PUBLISHED.**
- **17 SVG diagrams** built + overflow-fixed, hosted at **`7kinhomestead.land/solar-diagrams/*.svg`** (deployed, resolving), embedded in the lessons.
- **Gold theme** imported + assigned by Jason; **poster** set as the course thumbnail. **15 videos** uploaded by Jason (staged `D:\kajabi-course\Intermediate-Off-Grid-Solar\_UPLOAD-GUIDE.txt`; mapping is non-1:1 — several lessons are text-only by design).
- **N-G bond corrected to Jason's REAL rig:** SunGold menu **#63 internal bond** → the panel it feeds is a **floating-neutral SUBPANEL**, not a service panel (NEC 250.30 = separately derived system; 250.142(B) = no load-side N-G bond). Lesson 5.2 + the wiring/grounding diagrams all reflect this, with a "verify YOUR inverter" disclaimer.
- **Offer attached by Jason → the course is LIVE in the Garden.** Both build courses (Land + Solar) are now live.

### B. The Off-Grid Solar Glossary (Cari's idea) ✅
- **Public searchable page** `7kinhomestead.land/solar-glossary` — ~91 terms, plain-English, symbol decoding (e.g. *I = amps*), live search + category filters, **poster header with "Glossary" set low-left in white**. Free/SEO play. Deployed + live.
- **In-course:** a single **"Evidence Locker"** link lesson (`2198302713`) — detective intro + button to the page. *(We tried embedding the full glossary inline but Kajabi's body-size limit forced a 2-lesson split, which over-complicated it → reverted to the clean link lesson.)*

### C. Garden landing page (`/garden`) — REBUILT ✅
- Replaced the top-of-scroll Cyber Jason chat widget with a **homepage-style alternating image/text showcase** (`.spot` pattern): **Solar (gold) · Land (teal) · Out of Your Own Way (azure)** — each with its real course art + theme color.
- **Greenhouse** = a centered **"ALL THE GREENHOUSE STUFF, TOO"** band (no image) to break up the rhythm and de-feature the free tier.
- **Cyber Jason = deliberately downplayed** (anti-AI lean in the homestead audience): a small centered **profile circle + green online dot**, copy reframed as *"the planning brain wired into the Tool Shed"* with a concrete example (Solar Designer → what to buy/skip/over-built) and how the Garden turns every tool into a step-by-step plan. Live chat widget mounts below it.
- Offer copy refreshed everywhere to **3 full courses** (hero, stats "3 Full Courses Inside", "Full Course Library" feature card, Honest Ladder, meta/OG). Old redundant course grid removed.

### D. Fixes
- **`/regen` OG image** — `ground-truth.html` was the ONE tool page with **no Open Graph block** → shared links had no preview card. Added the standard `og:`/`twitter:` set → `og-card.jpg` (matches solar/freedom/water/lifestyle). Deployed. ⚠️ existing shares need a **re-scrape** (FB Sharing Debugger) to refresh the cached empty card.

### ⚠️ Kajabi lesson-body gotchas (hard-won — for any future MCP course work)
- **Markdown tables DON'T render** and raw `<table>` gets stripped in markdown mode → pour any table lesson with **`lesson_body_format:'html'`** (full HTML: `<p>`/`<h2>`/`<table>`). Affected/fixed: glossary, **5.3** wire-sizing, **7.3** fault-code reference.
- **Bodies silently truncate over ~20KB** — `update_course_content` returns "success" but keeps the OLD body. Keep each lesson < ~18KB and **always `get_lesson` to confirm a big body persisted.**

### Files changed this session (all pushed; land deployed through `eb8a8a1`)
- **kre8r:** `COURSE-SOLAR-DRAFTS.md` (final content + detective frames + N-G correction), `solar-diagrams/*.svg` (17, overflow-fixed + bond-corrected), **new** `SOLAR-COURSE-KAJABI-IDS.md`, `SOLAR-COURSE-RESEARCH.md` (Pass 4), memory updates.
- **kre8r-land:** **new** `public/solar-glossary.html`; `public/solar-course.html` (rename + poster hero + glossary card); `public/garden.html` (showcase rebuild + Solar card + 3-course copy); `public/ground-truth.html` (OG tags); `server.js` (`/solar-glossary` route); `src/utils/sitemap.js` (`/solar-course` + `/solar-glossary`); **new** `public/solar-diagrams/*.svg` (17 hosted).

### Still open / nice-to-haves for the launch session
1. **Coordinated Land + Solar launch announcement** still unwritten (community + email). Jason already did a launch post for `/regen` with a screenshot. Offer to draft the courses announcement in his voice with `/solar-course` + `/land-course` links.
2. Optional polish: a **Cyber-Jason-in-a-tool screenshot** for the Garden CJ section (Jason to provide); a **regen-specific OG card** so that link stands out.
3. Re-scrape the **/regen** OG on any already-posted links (FB Sharing Debugger / repost).

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
