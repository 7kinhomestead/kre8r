# Kre8Ωr — Next Session TODO

---

## Task 1 — End-to-end PipΩr wizard test

PipΩr was just built and has never been run against real input.

1. Restart server — confirm terminal shows all 7 PipΩr DB migration lines on first run:
   ```
   [DB] Migration: added projects.setup_depth
   [DB] Migration: added projects.entry_point
   ... (7 total)
   ```
2. Open `http://localhost:3000/pipr.html`
3. Walk through all 5 wizard screens for a real upcoming video
4. Confirm redirect to `/?project=id` with PipΩr ✓ badge on the card
5. Confirm `database/projects/[id]/project-config.json` was written
6. Confirm beat coverage bar shows 0/N beats on the dashboard card
7. Test the alert bar — it should fire if any project has critical missing beats

---

## Task 2 — End-to-end SelectsΩr test with chunking live

SelectsΩr chunked analysis has never been successfully run against real footage.
First real test to confirm the full pipeline works:

1. Restart server — confirm terminal shows:
   `[SelectsΩr] Module loaded — CHUNK_SIZE=2, MAX_WORDS_PER_CHUNK=3000`
2. Open EditΩr, select a project with 3+ talking-head clips already transcribed.
3. Click **Build Selects** — watch terminal for:
   ```
   [SelectsΩr] analyzeTranscripts: N clips → M chunk(s)
   [SelectsΩr]   chunk 1: 2 clip(s), XXXX words
   [SelectsΩr] → chunk 1/M (clips 1–2, XXXX words)
   [SelectsΩr] ✓ chunk 1 → N section(s)
   ...
   [SelectsΩr] Merging N raw sections from M chunks
   [SelectsΩr] ✓ merge done — N final section(s)
   ```
4. Confirm browser log panel shows all chunk progress events.
5. Confirm section cards render correctly in EditΩr after completion.
6. After selects are built, run POST `/api/pipr/:project_id/beats/update` to map
   selects → beats and see coverage appear on the dashboard card.

---

## Task 3 — DaVinci build-selects beat marker live test

After selects are built for a real project:

1. Click **Build Timeline** in EditΩr for a project that has a project-config.json
2. Confirm terminal output:
   ```
   [pipr] Adding N beat markers (save_the_cat)
   [pipr] N beat markers placed
   ```
3. Open DaVinci — confirm colored beat markers appear at correct positions:
   - Green = covered beats (if any selects already mapped)
   - Cyan = uncovered beats
   - Red = Hook and CTA if not yet covered (critical)
4. Verify Purple summary marker at frame 0 shows beat count in note

---
