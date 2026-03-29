# Kre8Ωr — Next Session TODO

## Task 1 — End-to-end smoke test (Phase 1 + Phase 2)

Run a complete real-world test of both phases before building Phase 3.

**Phase 1 — pipeline gate flow:**
1. `npm start` → confirm `[DB] SQLite database ready` + `VaultΩr Watching:` in console
2. M2: enter a YouTube URL + topic → Generate → confirm 5 packages appear
3. M2: select a package → confirm green "Gate A approved" toast
4. M1: load dashboard → confirm project is in **Gate B** section
5. M3: open with `?project_id=X` → generate captions → Copy All for Gate B → green toast
6. M1: refresh → project in **Gate C** section
7. M4: generate emails → Copy All for Gate C → green toast
8. M1: auto-reloads → project shows as complete

**Phase 2 — VaultΩr:**
1. Install ffmpeg: `winget install Gyan.FFmpeg` (if not yet installed)
2. Drop 2-3 video files into `C:/Users/18054/Videos/intake` → confirm auto-ingest fires
3. Open `http://localhost:3000/vault.html` → confirm thumbnails + classifications appear
4. Test natural language search: "hero b-roll" → confirm filtered results
5. Click a clip → edit quality flag → Save → confirm PATCH persists on reload
6. Click "Organize file" on one clip → confirm file copied to organized folder with
   correct `YYYY-MM-DD_slug_shottype_NNN.ext` naming

---

## Task 2 — Build M5 AnalytΩr (`public/m5-analytics.html`)

Phase 3, first module. Per-project performance tracking across all platforms.

**Schema audit first** — read `posts` and `analytics` tables in `database/schema.sql`.
Verify columns cover: platform, post date, views/likes/comments/shares at 24h/7d/30d,
link clicks, ROCK RICH signups (manual), creator notes. Add missing columns.

**`src/db.js` additions:**
- `savePost(projectId, platform, postedAt, url)` → inserts into posts
- `updateAnalytics(postId, metrics)` → upserts into analytics
- `getAnalyticsByProject(projectId)` → all posts + analytics for a project
- `getAggregateAnalytics()` → best angle + best platform across all projects

**`src/routes/projects.js` additions:**
- `POST /:id/posts` — log a new post
- `PUT /:id/posts/:postId/analytics` — update metrics
- `GET /:id/analytics` — get all analytics for a project

**UI** (`public/m5-analytics.html`): same dark design system. Project picker via
`?project_id=X`. Per-platform entry cards with post date, URL, 24h/7d/30d metric
inputs. Summary card: best-performing angle across all projects.

---

## Task 3 — Build OperatΩr dashboard (`public/operator.html`)

Master pipeline view. One screen showing the health of every project simultaneously.

**Three-column layout:**

**Left — Queue** (not yet at Gate C):
- Projects by stage: M2 → M3 → M4
- Card: title, current stage, days since created, blocking gate
- Quick-jump links to the correct tool for each project

**Center — Ready to Publish** (Gate C approved, not yet posted):
- Platform checklist per project: TikTok / YouTube / Instagram / Facebook / Lemon8
- "Mark Posted" checkboxes → write to `posts` table
- Links to M5 analytics per project

**Right — Archive** (all platforms posted):
- Completed projects with post dates
- M5 analytics summary per project (top metric)

**Nav:** add OperatΩr to all tool navbars (M1–M5 + VaultΩr + index).
Update `public/index.html` grid to show all seven tools.
