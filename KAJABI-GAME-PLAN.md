# KAJABI-GAME-PLAN.md — Session Seed

> **Purpose of this doc:** Hand off the "Kajabi / Rock Rich, played as a game" initiative to a fresh
> session. This was scoped in a parallel session (kre8r-land tools/links work) that is staying focused
> on the land website. **Open the questions below WITHOUT assuming answers** — several are explicitly
> unknown and must be investigated or asked, not guessed.
>
> **Where to run:** the **main `kre8r` repo** (this one) — the community-sync pipeline, the NorthΩr /
> MissionΩr dashboard, the transcript corpus, and the `INTERNAL_API_KEY` all live here. The land repo
> (`kre8r-land`) is a *different* session's lane; don't touch it.
>
> **First read:** `CLAUDE.md` (esp. the "Kajabi MCP" section) and `BRIDGE-DESIGN-SPEC.md` for the
> game/ship philosophy this builds on. Treat the Kajabi facts in CLAUDE.md (Site/Community IDs, member
> counts, tier tag IDs) as **as-of-Session-80 — re-verify before relying on them.**

---

## The frame (read this first — it's the whole point)

Jason is **pot-committed** to Kajabi for the Rock Rich community. Migrating off it is off the table —
"we're too far in, like the poker table." So the move is not *escape* Kajabi, it's *win* Kajabi.

The unlock: **a system with freedoms, barriers, purposes, and opposition is a game, and winning is a
function of optimizing those factors.** Look at Kajabi that way and the strategy writes itself —
**bolt your own code onto Kajabi's freedoms exactly where its barriers blind you.**

| | Kajabi as a game |
|---|---|
| **Freedoms** | Custom HTML/JS slots in lessons & pages · a Public API · sequences / DMs / posts / challenges / tags · the **194-transcript corpus Jason already owns** |
| **Barriers** | **No granular module/lesson completion reporting** · no native "first post" / "first lesson" trigger · `search_contacts` broken in MCP beta · `create_post`/`create_announcement` silent-success bug · MCP is interactive-only (no cron) |
| **Purpose (win condition)** | Members actually **finish** courses · lurkers **activate** · Jason can finally **see** it happening (today he can't) |
| **Opposition** | The score-25 wall (~1,332 of ~1,366 members joined and never engaged) · Kajabi's reporting blindness · course content that isn't packaged into courses yet |

Winning = optimization across those. Everything below serves that.

---

## The three pillars

### Pillar 1 — Course generation from the transcript corpus
Jason owns ~194 video transcripts. Do an **AI pass over the corpus** that proposes course structures:
*"these 12 videos, in this order, are a coherent course — here are the modules and the lessons within
each."* Semantic clustering by theme + pedagogical sequencing (foundational → advanced). This is a
**content factory**, not a Kajabi limitation — genuinely strong Claude work.
- Output: structured course proposals (course → modules → ordered lessons, each mapped to a transcript/video).
- Then build them in Kajabi (manually, or via the Public API **if** it supports course creation — unknown, see Q5).
- Consider a small fan-out (one agent per topic cluster) if the corpus is large.

### Pillar 2 — Completion-reporting beacon (the sharp one)
**Problem:** Kajabi reports nothing granular about who completed which module/lesson. Jason didn't even
know people were taking the courses.
**Solution:** Kajabi lets you drop **custom HTML/JS into lessons.** Embed a tiny **beacon** that fires
on lesson-view / video-end / "mark complete" and POSTs `{member, course, module, lesson, event, ts}`
to a **kre8r endpoint**, which logs it and surfaces it in **NorthΩr / MissionΩr.**
- **This is the exact pattern already built for blog click-tracking** (see `kre8r-land/src/routes/track.js`
  for the shape — a public POST endpoint + a DB table + a beacon snippet). Port that idea into kre8r.
- **THE GATING UNKNOWN → see Q3.** If Kajabi's custom code can read the logged-in member's identity,
  you get **per-member** completion. If not, you're limited to anonymous/aggregate. **Test this before
  building anything else** — it determines whether Pillars 2 and 3 are even possible as designed.

### Pillar 3 — Course gamification
**Depends entirely on Pillar 2** — you cannot gamify what you cannot measure. Once completions report,
XP / badges / a progress path / streaks / challenges become real and tied to actual behavior.
- **There is ALREADY a gamification layer in Kajabi** that Jason hand-built: he took an existing **Liquid
  shell** and modified it inside a **Claude.ai chat window** (before he knew Claude Code existed),
  copy-pasting blocks one at a time until it worked. **Find it, audit it, understand what it does and
  where it's embedded before designing the next version** (see Q2). Build on it; don't blindly replace it.

---

## Technical landscape (what you're working with)

- **Kajabi MCP** (Claude Desktop, interactive only): Site ID `2148808568`, Community ID `972809`
  (Rock Rich) — *re-verify*. Max 3 toolsets active, they evict every ~2–3 calls. Can **read**
  members/posts/comments/challenges/contacts/tags/analytics/emails; can **write** `create_post`,
  `send_dm`, tag/untag contacts, build sequences + emails. **Gotchas:** `create_post`/`create_announcement`
  return failure even on success (never retry — check Kajabi admin); `search_contacts` filters are broken.
- **Kajabi Public API** (server-side, can run unattended): the right tool for the **beacon endpoint** and
  for any automated reads/writes. MCP can't run on a cron — the API can.
- **Community sync pipeline** (already built, in this repo): `POST /api/community/sync` with the
  `x-internal-key` header → warm-lead detection, tier corrections, score-movers. Dashboard surfaces in
  **NorthΩr / MissionΩr.** `INTERNAL_API_KEY` is in this repo's `.env`.
- **Tiers** (as-of-last-session, re-verify): Founding 50 (~33), Garden (~36), Greenhouse (~1,357).
  Lurker wall: ~1,332/1,366 at progress_score 25.
- **Transcript corpus candidates:** `kre8r/data/voice-calibration.json` (~190, powers WritΩr voice
  calibration) **and** `kre8r-land/data/transcripts.json` (powers the fence RAG). **Which one is the
  course-usable corpus is unknown — see Q1.**

---

## OPEN QUESTIONS — investigate or ask Jason. **Do NOT assume answers.**

> Jason was explicit: name these clearly so a future session doesn't quietly assume its way past them.

- **Q1 — The corpus.** Which file is the real ~194-transcript course corpus —
  `kre8r/data/voice-calibration.json` or `kre8r-land/data/transcripts.json` (or another)? And does it
  carry the metadata course-gen needs — **video titles, YouTube IDs, durations, dates, topic tags** — or
  just raw text? *(Jason: "I think one of them does but I don't know which." → investigate both, report back.)*

- **Q2 — The existing gamification layer.** Where does Jason's hand-built **Liquid gamification shell**
  live in Kajabi, what does it currently do, and how is it wired? *(Built via copy-paste in a Claude.ai
  chat — there's no clean source file; it must be recovered from the Kajabi admin / theme code.)* Audit
  before redesigning.

- **Q3 — Member identity in custom code (THE gating question).** Can Kajabi's custom HTML/JS (or Liquid)
  inside a lesson read the **logged-in member's identity** (e.g. Liquid `{{ member.email }}` / `member.id`,
  or a JS global on the page)? **This decides whether per-member completion tracking is possible at all.**
  Test it first; everything in Pillars 2 & 3 hinges on the answer.

- **Q4 — What "winning a course" means.** Jason's gamification vision, concretely: badges? XP/points? a
  visible progress path/map? streaks? challenges? completion tiers? *(Jason to define — do not invent the
  mechanics.)*

- **Q5 — Public API surface.** Does the Kajabi Public API expose **course/lesson structure** and **any**
  completion data (even coarse), and can it **create** courses/modules/lessons? Determines how much of
  Pillar 1's output can be pushed in programmatically vs. built by hand.

- **Q6 — The completion signal.** How are lessons delivered (which video host/player), and can custom JS
  detect **video-end**, or do we rely on a **"mark complete"** click and/or **lesson-page-view** as the
  progress proxy?

- **Q7 — Identity mapping.** Once a beacon fires with a Kajabi member identity, how does it join to the
  existing community DB in this repo (email as the key?) so completions land on the right member in NorthΩr?

---

## Suggested first moves (sequence matters)
1. **Answer Q3 first** (member identity in custom code) — it gates the build. Stand up a throwaway test
   lesson with a custom-HTML block that tries to echo member email/id to a test endpoint.
2. **Answer Q2** — recover and audit the existing Liquid gamification layer from Kajabi admin.
3. **Answer Q1** — locate the course-usable transcript corpus and confirm its metadata.
4. Then build in order: **beacon endpoint + DB + NorthΩr panel** (Pillar 2) → **gamification on top of real
   data** (Pillar 3) → **course-gen pass over the corpus** (Pillar 1, can run in parallel — it has no
   dependency on the beacon).

---

## Out of scope for this initiative
The lurker-activation / nurture-sequence work and the broader community-sync mechanics are their own
threads (see CLAUDE.md "Community Game Strategy"). This doc is specifically **courses + completion
visibility + gamification**, framed as a game. The land website / tools / links page work is a separate
live session in the `kre8r-land` repo — leave it alone.
