# Kre8Ωr — Next Session TODO

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
