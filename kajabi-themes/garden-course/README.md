# Garden Course Theme (7 Kin) — reusable Kajabi course theme

The shared, version-controlled course theme for the Garden tier courses (Land On A Shoestring
Budget, DIY Off-Grid Solar, the retrofits). Built on the Kre8r "7kin-course-template" gamified
Kajabi theme. **This folder is the source of truth — edit here, re-zip, upload.**

## What's in here
- `7kin-course-template/` — the unzipped theme source (edit these files).
- `7kin-course-template-TEAL.zip` — upload-ready archive (also copied to `D:\Downloads\` for convenience).

## The two things that make it "ours" (set Jun 21 2026)
1. **Teal accent — `#00C4B4`** (the Land Finder tool's `--teal`). Drives `--accent`/`--gold` in the
   gamified overlay and Kajabi's `$color-primary` (buttons, links, XP bar, highlights). Set via
   `config/settings_data.json` → `color_primary` + `brand.primary_color`. Completion green stays
   `--green: #22c55e` (matches the Land Finder's own teal+green palette).
2. **Completion beacon → the always-on land box.** `config/settings_data.json` → `track_endpoint` =
   `https://7kinhomestead.land/api/kajabi-track` (was a dead ngrok tunnel). The beacon itself lives
   in `templates/post.liquid` (reads `window.RR_COURSE.trackEndpoint`, fires `lesson_view` /
   `mark_complete` / `video_end` with `contact_id` + `post_id`). On `mark_complete` the land box
   awards Orchard points via the bridge. The schema default (`config/settings_schema.json`) is also
   repointed so fresh installs ship correct.

## Reuse for the next course
1. In Kajabi: **Settings → Themes → Add Theme → Import** `7kin-course-template-TEAL.zip`.
2. Assign the theme to the course (Customize). The accent + beacon come baked in — no per-course
   color or endpoint edits needed.
3. (Only for local beacon testing) override `track_endpoint` in Theme Builder → Kre8r Analytics.

## To re-edit later
Edit files under `7kin-course-template/`, then rebuild the zip (no `zip` binary on this box — use
Python `zipfile`, archiving the `7kin-course-template/` folder so it sits at the zip root).
