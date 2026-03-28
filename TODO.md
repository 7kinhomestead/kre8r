# Kre8Ωr — Next Session TODO

## Task 1 — End-to-end pipeline smoke test

Run a real project through the complete M2→M3→M4→M1 pipeline and verify every gate
handoff works before building Phase 2.

**Steps:**
1. `npm start` → confirm server starts clean, `[DB] SQLite database ready` in console
2. M2: enter a YouTube URL + topic, click Generate, confirm 5 packages appear
3. M2: select a package → confirm green "Gate A approved" toast (not amber error)
4. M1: load dashboard → confirm project appears in **Gate B** section (not Gate A)
5. M3: open with `?project_id=X` → confirm package title pre-fills, generate captions
6. M3: click "Copy All for Gate B" → confirm green "Gate B approved" toast
7. M1: refresh → confirm project moves to **Gate C** section
8. M4: open with `?project_id=X` → confirm context loads, generate email sequence
9. M4: click "Copy All for Gate C" → confirm green "Gate C approved" toast
10. M1: auto-reloads → project should disappear from pending gates, appear as "Complete"
    in All Projects list with green status badge

**What to watch for:** Any amber error toast at any step (means a gate write failed).
Check the terminal for server-side errors on any failed step.

---

## Task 2 — Build M5 AnalytΩr (`public/m5-analytics.html`)

Phase 2, first module. Tracks post-publish performance per project, linked back to the
content package selected at Gate A (so you can see which angles perform best over time).

**Schema audit first:**
The `posts` and `analytics` tables exist in `database/schema.sql`. Before writing any
code, read those table definitions and verify the columns cover:
- Platform posted to (tiktok / youtube / instagram / facebook / lemon8)
- Post date (posted_at)
- Views / likes / comments / shares at 24h, 7d, 30d snapshots
- Link clicks / swipe-ups (where applicable)
- ROCK RICH signups attributed (manual entry)
- Creator notes (what worked, what didn't)

Add any missing columns to the schema. Then add to `src/db.js`:
- `savePost(projectId, platform, postedAt, url)` → inserts into posts
- `updateAnalytics(postId, metrics)` → upserts into analytics
- `getAnalyticsByProject(projectId)` → all posts + analytics for one project
- `getAggregateAnalytics()` → summary across all projects (best angle, best platform)

Add to `src/routes/projects.js`:
- `POST /:id/posts` — log a post
- `PUT /:id/posts/:postId/analytics` — update metrics
- `GET /:id/analytics` — get all analytics for a project

**UI** (`public/m5-analytics.html`):
- Same design system (dark, Bebas Neue + DM Sans)
- M5 active in green in shared nav
- Project picker (`?project_id=X` param)
- Per-platform entry cards: post date, URL, 24h/7d/30d metric inputs
- Summary card at the bottom: best-performing angle across all projects

---

## Task 3 — Build OperatΩr dashboard (`public/operator.html`)

Phase 2, master pipeline view. One screen showing the health of every project across
all stages simultaneously.

**Three-column layout:**

**Left — Queue** (not yet at Gate C):
- Projects sorted by stage: M2 → M3 → M4
- Each card: title, current stage, days since created, which gate is blocking
- Quick-jump links to the right tool for each project

**Center — Ready to Publish** (Gate C approved, not yet posted):
- Platform checklist per project: TikTok / YouTube / Instagram / Facebook / Lemon8
- Manual "Mark Posted" checkboxes that write to the `posts` table
- Links to M5 analytics per project

**Right — Archive** (all platforms posted):
- Completed projects with post dates
- M5 analytics summary per project (best metric)

**Nav integration:**
- Add "OperatΩr" link to the shared nav in all five existing tools (M1–M5)
- Update `public/index.html` PipelineΩr home screen to show all six tools in the grid
