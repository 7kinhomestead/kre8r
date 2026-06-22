# The Mysteries of Off-Grid Solar — Kajabi IDs
*(public name; intermediate-level. Detective/whodunit theme. Poster art → upload as thumbnail in admin.)*

Site ID: `2148808568`
Course (product) ID: **`2149490461`**
Admin: https://app.kajabi.com/admin/products/2149490461/edit
Status: shell created 2026-06-22, all content in **DRAFT**, **no offer attached** (not purchasable yet).

Use these lesson IDs with `update_course_content` (pass `id` to update) to pour body content
from `COURSE-SOLAR-DRAFTS.md` once the draft is locked. Source clips: `D:\kajabi-course\Intermediate-Off-Grid-Solar\` (see `_UPLOAD-GUIDE.txt`).

| Draft | Lesson | Module ID | Lesson ID |
|-------|--------|-----------|-----------|
| **M1** | Module 1 — Design YOUR System | `2160281244` | — |
| 1.1 | The tool that does it right | | `2198298693` |
| 1.2 | Run the numbers yourself | | `2198298694` |
| 1.3 | The shape of your system (and why 48V) | | `2198298695` |
| **M2** | Module 2 — Every Part, Explained (the BOM) | `2160281245` | — |
| 2.1 | What's actually in the box | | `2198298696` |
| 2.2 | The four big boxes | | `2198298697` |
| 2.3 | The seatbelts | | `2198298698` |
| **M3** | Module 3 — Buy It Right | `2160281246` | — |
| 3.1 | The spec sheet is a magic trick | | `2198298699` |
| 3.2 | The inverter traps | | `2198298700` |
| 3.3 | The trap that fries gear / where I bought | | `2198298701` |
| **M4** | Module 4 — Build It: Mount & Set | `2160281247` | — |
| 4.1 | Racking: build the bones | | `2198298702` |
| 4.2 | Set the panels & set the gear | | `2198298703` |
| 4.3 | Set the battery bank | | `2198298704` |
| **M5** | Module 5 — Wire It Safe 🏅 | `2160281248` | — |
| 5.1 | Read this first | | `2198298705` |
| 5.2 | Safety FIRST: bonding & grounding | | `2198298706` |
| 5.3 | Size the wire & overcurrent | | `2198298707` |
| 5.4 | The final DC connections | | `2198298708` |
| **M6** | Module 6 — Smaller Rigs | `2160281249` | — |
| 6.1 | RV & van power | | `2198298709` |
| 6.2 | The solar generator (and the trap) | | `2198298710` |
| 6.3 | Which rig is right for you | | `2198298711` |
| **M7** | Module 7 — Turn It On, Troubleshoot & Grow | `2160281250` | — |
| 7.1 | Commissioning checklist | | `2198298712` |
| 7.2 | How to think when it breaks | | `2198298713` |
| 7.3 | The Fault-Code Field Reference | | `2198298714` |
| 7.4 | STOP signs, upkeep, growing | | `2198298715` |

## Build status
- ✅ Shell: 7 modules / 23 lessons (detective case-file titles)
- ✅ **Lesson bodies poured** (all 23) from COURSE-SOLAR-DRAFTS.md — scaffolding stripped, diagrams referenced by hosted URL
- ✅ Diagrams hosted: 17 SVGs in `kre8r-land/public/solar-diagrams/` → render at `https://7kinhomestead.land/solar-diagrams/*.svg` **once the land box deploys** (committed kre8r-land fd38712; until deploy they 404 in Kajabi)
- ✅ Landing page: `/solar-course` (noir poster hero) — committed, not yet deployed
- ⏳ Gold theme: zip handed to Jason to import + assign (manual)
- ⏳ Thumbnail: poster set by Jason ✅
- ⏳ Videos: 15 staged in `D:\kajabi-course\` — upload per lesson in Kajabi admin (MCP can't upload media)
- ⏳ Garden offer attach — needs Jason's go (commercial)
- ⏳ Publish lessons (publishing_option: 'published') once content + video confirmed

## Re-pour note
To re-sync after red-pen edits to COURSE-SOLAR-DRAFTS.md: re-run the cleaning script
(parses `### Lesson N.N` headers, strips ‹SOURCE›/[VERIFY]/diagram-build/research-ref/watch-note
lines, rewrites `solar-diagrams/x.svg` → hosted URL) and update_course_content by lesson ID.
