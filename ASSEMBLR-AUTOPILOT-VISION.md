# AssemblΩr Autopilot — The "Here's the Story, Here's the Footage" Machine

*Vision doc — drafted premiere night, Jul 23 2026, while Jason was live. The
conversation that seeded it: "I go 'here is what the video is about and here is
the footage' … 'give me the final export of the best possible version of this
story with that footage, color graded, mastered, typography'd, special
effected and complete.' Is that within the realm of developable reality?"*

**Verdict: yes — as a staircase, not a leap. The hard part of an AI editor was
never the editor. It's the judgment, and most of the judgment is already
built.**

---

## The Two Laws That Govern This Build

1. **Automate the haystack, never the taste.** (Locked after the radio-cut
   pipeline gave editing back its joy.) The machine's job is to eliminate
   everything between Jason and the creative decisions — never to make the
   decisions that ARE the show. Where the flip goes relative to the pucker is
   Jason. Finding the flip in 4,000 clips is the machine.
2. **Engine vs Soul.** The autopilot is engine. Everything that makes it cut
   like *Jason* — the grammar profile, the format DNA, the voice — is soul,
   injectable per-creator. Build it once for 7 Kin; it works for any creator
   with a profile.

---

## Why This Is Reachable: The Judgment Stack Already Exists

An autonomous edit loop needs five organs. Inventory of what's already in the
shop:

| Organ | What it does | Status |
|---|---|---|
| **Eyes** | Know what every clip shows | ✅ VaultΩr 2.0 — full-season read, shot logs, embeddings (1,200+ clips, searchable by meaning) |
| **Ears** | Know what every clip says | ✅ WhisperX transcripts, vault-wide (14,000+ segments) |
| **Taste** | Cut like Jason, not like a template | ✅ Edit Grammar profile — measured from his best work (6.9s median cut, rhythm curves). Extend with Rock Rich format profile (planned: analyze 3–4 best episodes) |
| **Hands** | Turn a plan into a timeline + export | ✅ Radio-cut push pipeline (JSON job → timeline), ffmpeg render, Resolve for grade. ⚠️ Currently tied to live Resolve API — the EDITR-OVERHAUL verdict (FCPXML/OTIO) is the fix |
| **Critics** | Score an export without a human watching | ✅ The QC bench: loudness-lint (mix/bed ratios), HookScope (open + flash cadence), GradeScope (clipping, casts, exposure jumps), peak-forensics. Born from real EP0 mastering failures — calibrated on the actual show |

The critics are the moat. Everyone building "AI video editors" has generation;
almost nobody has *verification*. Without a critic, a loop can't converge — it
just produces variations. The QC bench means the loop has a scoreboard.

**Missing organs (the actual build):**

- **The Planner** — story brief + transcripts + shot logs → paper edit (beat
  list with clip IDs and in/out points). SlotΩr is the seed: it already maps
  script beats → shot cards. The planner is SlotΩr grown up.
- **Headless timeline** — OTIO (OpenTimelineIO) or FCPXML as the canonical
  edit document, so the loop can revise a cut without a human or a live
  Resolve session. Already the blessed direction in EDITR-OVERHAUL-PLAN.md.
- **Auto-grade** — season LUT + per-shot exposure/WB normalization (GradeScope
  already *detects* the faults; the grade step corrects toward its own
  checks). Broadcast-safe automatic; *beautiful* stays a human pass at first.
- **Typography/motion** — template library, not freeform: lower thirds,
  location cards, the "text on screen" beats. Render via Resolve Fusion
  templates or an HTML→video renderer. (License note: Remotion is
  source-available, NOT free for companies — vet before adopting. ffmpeg
  drawtext is free but crude.)
- **SFX/music placement** — cue sheet from the beat map (Suno cues by act
  energy, the EP0 method, systematized).

---

## The Loop (the "loops" Jason imagined)

```
brief + footage pool
   ↓
PLAN      paper edit from transcripts + shot logs + grammar profile
   ↓
ASSEMBLE  OTIO timeline → render draft (proxies, fast)
   ↓
JUDGE     critics score it: hook cadence, mix ratios, grade faults,
          pacing vs grammar profile, beat coverage vs brief
   ↓
REVISE    worst-scoring section gets re-planned (different takes,
          different b-roll, tightened cut) — loop until scores plateau
   ↓
FINISH    conform to originals → auto-grade → captions/typography
          → ffmpeg loudnorm master (the EP0 chain, already law)
   ↓
DELIVER   draft export + the project file, open for the human pass
```

Convergence rule: the loop stops when critic scores plateau — "best possible
version" operationally means *no revision the critics can detect improves it*.
Taste beyond the critics' vocabulary is, by definition, the human 20%.

---

## Where OpenCut Fits — EVALUATED Jul 23 (deep research verdict)

License is clean MIT — but the project is **two codebases**: the editor that
actually works is **archived** (frozen May 2026, "legacy" by its own docs),
and the active rewrite is an empty skeleton whose *roadmap* promises exactly
our use case (headless mode, editor API, **MCP server for AI agents**) but
ships none of it yet.

**Verdict: build our own review surface; don't adopt OpenCut now.**

- Its timeline format is clean JSON (tracks → elements with
  startTime/trim in integer ticks, 120,000/sec) — an OTIO→OpenCut converter
  is ~200 lines. The mapping was never the problem.
- The problem is ingestion: media lives as File objects in browser OPFS
  keyed by mediaId (no URLs), projects in a versioned IndexedDB schema (v28)
  with no API contract — loading an AI-generated cut means fork-surgery on
  an abandoned app, and browser-local state violates the Prime Directive
  (creative state belongs in Kre8Ωr's SQLite, not a wipeable IndexedDB).
- Kre8Ωr already owns the hard halves: ffmpeg preview renders, the clip DB,
  ReviewΩr's approve/skip/reorder pattern. A read-only track-of-blocks
  canvas + <video> preview synced to OTIO JSON is a weekend of vanilla JS —
  the ReviewΩr successor grows at home.
- **Validation worth framing:** OpenCut issue #719's stated use case is
  verbatim ours — "an AI assistant generates a JSON describing cuts, user
  imports, previews, tweaks, exports." The industry is converging on the
  pattern; we're just not waiting for their rewrite to ship it.
- **Revisit in 3–6 months** when the rewrite's headless/MCP layer is real.
  Also watch OpenChatCut (github.com/0xsline/OpenChatCut) — local-first AI
  editor with MCP + Remotion rendering, closer to this shape today.

---

## The Staircase (build order — each step ships value alone)

1. **Tier 1 — Shorts autopilot.** Approved long-form + vertical crop +
   caption template + master chain → finished short, zero touches. Story's
   already told; grammar known; stakes low. *Everything needed exists today;
   this is wiring, not research.* Feeds the daily TikTok machine.
2. **Tier 2 — Radio-cut autopilot.** Brief + footage → paper edit + assembled
   radio cut, delivered as a timeline. Jason starts every episode at
   "watchable rough" instead of empty timeline. (SlotΩr + push pipeline +
   planner.)
3. **Tier 3 — Dressed draft.** Tier 2 + b-roll placement from slot detection
   + music cues + auto-grade + captions + master. The "EP5 arrives as a
   watchable draft" world.
4. **Tier 4 — The loop.** Critics wired as revision pressure; the machine
   iterates before showing a human anything. This is the "best possible
   version" ask — and by here it's an optimization pass over working parts,
   not a moonshot.

Ceiling, stated honestly: Tier 4 hands over a draft that would embarrass
nobody. The cut that makes Cari laugh out loud still comes from the human
pass — and that's the design goal, not the compromise.

---

## Strategic Note

This is the unfair-advantage direction (private tooling > SaaS, per the June
strategy call). Nobody else has a season of measured grammar, a memoried
vault, and a QC bench calibrated on their own mastering failures. The data
moat IS the product. Every episode shipped makes the autopilot better; no
competitor can shortcut that with a bigger model.

---

## Director Mode (Jason's addendum, same night)

The interface insight, verbatim intent: *"crush the blacks a bit more for
mood, double the b-roll frequency, run a mist pass with a depth map — like an
actual director."* This is the correct UI paradigm and it's MORE tractable
than full autonomy: each directorial note is a bounded operation with a
verifiable result. Full autonomy is a moonshot; a command vocabulary is a
checklist.

- **"Crush the blacks for mood"** → CDL/lift-gamma adjustment against the
  season LUT; GradeScope verifies nothing clips.
- **"Double the b-roll frequency"** → a planner parameter; re-assemble,
  grammar critic confirms cadence.
- **"Mist pass with a depth map"** → Resolve Studio already ships a Depth Map
  FX (his license has it today); modern monocular depth models cover anything
  it can't. Compositing recipes become named passes.
- Every verb lands in a **command vocabulary** that grows with use — the
  directorial language becomes part of the soul file, like the grammar
  profile.

**Batch-conform jobs (Tier 1.5 — buildable nearly now):** *"Take all of
Cari's PTCs for this ep → grade, mix, master, normalize, export to folder N,
all in one style."* That's a VaultΩr query (person + shot type + episode) ×
the existing finishing chain (auto-grade toward one reference + loudnorm
master) with matched targets so every piece intercuts clean. No planner, no
loop, no research — wiring. It slots between Tier 1 and Tier 2 and is the
single highest-leverage early ship: normalized parts octuple assembly speed
even when a human does the assembling.

**Remotion, corrected:** free for individuals and companies ≤3 people — 7 Kin
qualifies today. React-based programmatic video = the text/infographic organ
(animated stats, cost breakdowns, title cards) driven by episode data. Revisit
the license only if the company ever grows past the threshold.

**The point of all of it:** output multiplication is message multiplication.
The machine exists so the humans can spend their hours on the part only they
can do.

*Next actions: (1) ~~Tier 1.5 batch-conform~~ ✅ SHIPPED Jul 23 —
scripts/assemblr/batch-conform.py (ConformΩr), proven on the 9 EP1 PTC-reshoot
proxies (5.8 dB spread → all within 0.5 dB of −16, verified by re-measure);
(2) ~~OpenCut evaluation~~ ✅ DONE Jul 23 — verdict above: own viewer, OTIO
canonical, revisit their rewrite in 3–6 months; (3) Tier 1 shorts autopilot
spec; (4) home-grown review viewer (OTIO JSON → track-of-blocks canvas +
video preview, state in SQLite); (5) fold into EDITR-OVERHAUL-PLAN.md's OTIO
migration so the two builds share one timeline layer.*
