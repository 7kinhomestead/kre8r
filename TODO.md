# Kre8Ωr — Next Session TODO

---

## ⚡ Task 0A — Short-Form Pipeline Mode

**Decision made 2026-04-09:**
Short-form should be a first-class content type in Kre8Ωr — not an afterthought. When a creator says "short" at any point, the entire pipeline context should shift to short-form: story structure, script format, shot planning, and distribution. This also makes Kre8Ωr viable for short-form-only creators who would never use the long-form pipeline at all.

---

### Id8Ωr changes
- Detect "short", "reel", "TikTok", "60 seconds", "short-form" in conversation → set `content_type: 'short'` on the session
- Or: add explicit "What are you making?" question early — Long-form video / Short-form (TikTok/Reels/Shorts) / Both
- When `content_type: 'short'`: research phase focuses on scroll-stopping angles, hook formats, viral short patterns — not YouTube long-form performance
- System prompt shifts: "This is a 15–90 second short-form video. Hook must land in 3 seconds. Story resolves in under 90 seconds."
- Vision Brief output adapts: hook becomes the opening 3 seconds, thumbnail concept becomes thumbnail + cover frame, title is the caption hook

### PipΩr changes
- Add a **SHORT FORM** tile alongside Save the Cat / Story Circle / VSL / Freeform
- Short form tile opens sub-selection of short-form structures:
  - **Hook → Tension → Payoff** — universal short arc (problem surfaces → moment of doubt → resolution lands)
  - **Open Loop** — start with a mystery or claim, resolve at the end, viewers watch for the answer
  - **PAS** — Problem / Agitate / Solve — classic persuasion arc for educational shorts
  - **Before → Bridge → After** — transformation story in 60 seconds
  - **5-Point List** — "5 things about X" — listicle format, each point is a beat
  - **Hot Take** — state a counterintuitive opinion, defend it, land a call to reconsider
  - **Tutorial** — do this, then this, then this — pure how-to, no narrative arc
- Beat map generated from short structure: 3–7 beats max, each with duration target (e.g. Hook: 0–3s, Tension: 3–20s, etc.)
- Project flagged as `content_type: 'short'` in DB → carried through entire pipeline

### WritΩr changes
- When `content_type: 'short'`: 
  - Full script mode writes 150–300 words max (60–90 second delivery)
  - No bullets mode — shorts need full scripted delivery for precision
  - Hook beat gets special treatment: written as a single punchy sentence, no wind-up
  - Beat timing shown on each card (e.g. "Beat 1: 0–3s")
  - Voice blend still works — same profiles, just shorter output

### DirectΩr changes (V2.0 context)
- Short-form shot list: 3–8 shots total, each with duration target
- Shot types shift toward singles, close-ups, reaction beats — not coverage
- "One shot per beat" guidance

### VaultΩr / EditΩr changes
- Shoot mode: add SHORTS mode alongside SCRIPTED / HYBRID / FREEFORM
- SHORTS mode: single talking-head take selection + b-roll coverage for each beat
- No multi-take comparison needed — pick the one clean take per beat

### ClipsΩr changes
- If `content_type: 'short'`: the video IS the clip — ClipsΩr role flips
- Instead of extracting clips FROM the video, it validates the video AS a clip
- Checks: hook timing (did the hook land in 3s?), retention arc, CTA presence, loop-ability
- Outputs: clip validation report + caption + hashtags for all platforms

### DB changes
- `projects` table: add `content_type` column ('long' | 'short') — default 'long'
- All tools check `content_type` to adapt their prompts and UI

### Commercial note
Short-form only creators (TikTok, Reels, Shorts) are a huge market. With this change, the pipeline works for:
- Jason (long-form primary, shorts as clips) — current
- Short-form only creator — new
- Hybrid creator (plans both simultaneously) — future

---

## ⚡ Task 0 — ReviewΩr Refocus (rough cut only)

**Decision made 2026-04-09:**
ReviewΩr should be purely a rough cut approval tool. Strip CutΩr analysis (social clips, retention cuts, CTA placement, off-script gold) out of it entirely. ClipsΩr handles all short-form extraction in the correct sequence — having it in ReviewΩr too is redundant and pulls the creator's attention in the wrong direction at the wrong time.

**What ReviewΩr becomes:**
- Load rough cut from EditΩr
- Review each select: approve / skip / reorder
- Extract approved clips via ffmpeg (stream copy)
- One job: does this rough cut work as a long-form video?
- Handoff → ComposΩr

**What gets removed:**
- CutΩr analysis panel ("Run CutΩr" button)
- Social clips section + approve/skip per clip
- Retention cuts section
- CTA placement section
- Off-script gold section
- ClipsΩr advance banner (move to after ComposΩr — it's already wired there now)
- All `/api/cutor/` calls from reviewr.html

**What stays:**
- Project select
- Rough cut selects list (approve / skip / reorder)
- Extract approved clips button (ffmpeg stream copy)
- ComposΩr advance banner (→ score the edit)
- `advance-banner` to PackageΩr (if creator wants to skip ComposΩr)

**DB impact:** `cuts` table rows generated by CutΩr still exist and are used by ClipsΩr downstream — don't drop the table or the `/api/cutor/` route, just remove them from ReviewΩr's UI.

**Purpose doc:** Update `09-reviewr.html` in tool-purpose-docs/ after this change is built.

---

## ⚡ Task 1 — ClipsΩr UI Polish (inline editing)

User caught "Rockridge" instead of "Rock Rich" in clip hooks/captions with no way to fix them in-app.
Add inline editing to ClipsΩr clip cards so the creator can correct hook text, captions, and hashtags
without re-running analysis.

**What to build:**
- Click-to-edit on hook text, why_it_works, caption, and hashtags fields
- Save button per card (or auto-save on blur) → `PATCH /api/mirrr/viral-clips/:id`
- DB: ensure `viral_clips` UPDATE path accepts hook/caption/hashtags/why_it_works fields
- Visual cue: field turns editable (light border + cursor change) on click, reverts to display on save

---

## ⚡ Task 2 — MirrΩr: First Real Evaluation Run

The entire compounding intelligence loop activates here. This is the payoff of Session 25.

**Steps:**
1. Run YouTube sync → confirm video performance data is in DB (views/likes for published videos)
2. Open NorthΩr → click **🪞 Evaluate Last Month**
3. Confirm evaluation card renders: accuracy score (0–10), what worked / what missed, weight badges
4. Confirm calibration flows upstream: open Id8Ωr → run a concept → check that mirrrBlock appears in server logs
5. Open WritΩr → generate a script → confirm MIRRΩR CALIBRATION section is in the prompt context

---

## ⚡ Task 3 — Deploy to DigitalOcean

Push all 5 Session 25 commits to live server at kre8r.app.

```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

**Verify after deploy:**
- `/northr.html` → 3-MONTH TRAJECTORY section visible, Evaluate Last Month button present
- `/pipr.html` → structure cards show live performance badges (or empty state if no data yet)
- `/mirrr.html` → ClipsΩr approved clips section renders on Rock Rich Community Launch project

---

## ⚡ Task 4 — Tool Purpose Docs + Flow Audit

**After the full project test run (Id8Ωr → PipΩr → WritΩr → VaultΩr → EditΩr → ClipsΩr → GateΩr → PackageΩr → CaptionΩr → MailΩr → MirrΩr → NorthΩr) is complete:**

**Step 1: Flow chart**
Draw the complete process loop from Id8Ωr → MirrΩr → back to Id8Ωr showing all branch points.
Identify wild branches — paths that exist in the code or UI but aren't part of the intended loop — flag them for pruning.

**Step 2: Per-tool docs**
One document per tool, stored in `kre8r/tool-purpose-docs/`, numbered so they display in pipeline order.

Each doc covers:
- **Inputs** — what data / files / context it receives and from where
- **What the tool does** — its purpose, and an honest assessment of whether it achieves that purpose
- **Data generated & preserved** — what it writes to the DB, what fields, how it persists across restarts
- **How it changes state** — what is different in the system after the tool runs
- **Valuable Final Product (VFP)** — the one thing the creator holds in their hand when done
- **Handoff** — exactly what it passes to the next tool (data shape, field names, how it flows)

**Naming convention:** `01-id8r.md`, `02-pipr.md`, `03-writr.md`, etc.

---

## PM2 Quick Reference

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```

---

## Technical Debt (Priority Order)

1. **better-sqlite3 migration** — before commercialization. Crash recovery risk.
2. **Engine vs Soul audit** — hardcoded creator data in route handlers.
3. **No automated tests** — no error monitoring, no structured logging.

---

## ✅ DONE THIS SESSION (Session 25 — 2026-04-09)

- MirrΩr self-evaluation system — strategy holds up a mirror to itself
- MirrΩr calibration wired into Id8Ωr (concept angle bias) and WritΩr (script context)
- Story structure performance loop — PipΩr gets live performance badges, NorthΩr gets structure hints
- NorthΩr 3-month growth trajectory — back-engineer a path from here to X in 3 months
- Distribution readiness: ClipsΩr approved clips wired into PackageΩr and MailΩr
- DaVinci audio fix: removed mediaType:1 (was video-only)
- DaVinci end-time buffer: +1.5s after last phoneme so sentences land before the cut
