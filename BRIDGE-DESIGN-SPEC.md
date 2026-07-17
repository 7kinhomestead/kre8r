I'm going to write this spec. The data inventory, baseline, and research are all in the brief — this is a design synthesis task, not a code exploration task. Let me deliver the complete spec directly.

---

# KRE8Ωr MISSION CONTROL — THE BRIDGE
### A complete design specification for the 26th-century creator command center

---

## SECTION 1: THE DESIGN PHILOSOPHY

**The one governing idea: The interface is a living vessel that the Captain commands, not a dashboard he reads.**

A dashboard reports. A bridge *responds*. The difference is the entire product.

When Jason sits down at Mission Control, he is not "checking his metrics." He is taking the conn of a ship that has been flying all night without him — the watcher ingesting footage, the queues grinding frames, Grex tracking every dollar, the community breathing and shifting. The ship kept its watch. Now the Captain is aboard, and the bridge wakes to him. That is the emotional contract: **the ship was working while you slept, and it is glad you're back.**

This produces three design laws that override everything else:

**Law 1 — Calm at rest, expressive under load.** When all is nominal, the bridge is *quiet*. Dark voids, slow ambient drift, instruments glowing at 60%, one heartbeat of motion. The creator's nervous system should down-regulate when nothing needs him. The instant something matters — a failed post, a warm lead going cold, a bucket below floor, runway under three months — the bridge *spends its entire motion budget* on that one thing. Alarm is precious because silence is the default. A bridge that always flashes is a bridge nobody watches.

**Law 2 — Shape and color before number.** The human eye scans geometry and hue in 200ms; it reads digits in 1.5 seconds. Every instrument must communicate its *state* through fill-level, arc, ring tension, and color temperature *before* the Captain reads a single number. Runway is a fuel gauge draining toward red — he knows he's in trouble before he reads "2.1 months." A glance assesses the whole ship; a look interrogates one system. This is the F1 wheel, the glass cockpit, the naval watch-officer view.

**Law 3 — Never lose the creative thread; never break it without a recovery path.** This is the Prime Directive of the entire OS, rendered in glass and light. The bridge must *never* show a dead number where data is missing — a blank dial reads "offline," not "zero." Every alert carries its own escape hatch: the failed post has a RETRY beam, the cold lead has a DM-ready hail, the stalled project has a one-tap jump back into the pipeline. The bridge never strands the Captain. It always shows him the way back to the helm.

**What it feels like to use it:** It feels like *being trusted with something powerful that trusts you back.* The ship is competent — it ran all night. It is deferential — it waits for your order. It is honest — it will tell you, calmly and exactly, when something is wrong, and it will already have the fix staged. You are not managing software. You are commanding a crew of AIs through a wall of living glass, and when you give the order, the order is *executed.* A solo creator with five kids and 700 square feet should be able to sit down for ninety seconds, take the conn, read the entire state of his empire in one sweep of the eye, fire three decisions, and walk away knowing the ship has it.

**The contract, in one line, to hang on every wall:**

> *The ship kept the watch. Now the Captain is aboard. Calm at rest, total under load — and never, ever lose the thread.*

---

## SECTION 2: THE INSTRUMENT CLUSTER ARCHITECTURE

The current 5-panel grid is a *dashboard* — five equal rectangles reading five APIs. We are building a *bridge*: a center of gravity, flanking instrument banks, ambient telemetry on the edges, and a tactical table at the heart.

### The governing metaphor: the Center T and the Tactical Table

Glass cockpits put the four life-or-death instruments in a "T" at the center of the visual field; peripheral vision watches the edges. We adopt this. The **center of the screen is the Tactical Table** — a holographic galaxy-map surface, the ship's situational core. The sides are **vertical instrument banks** (real bridge consoles run vertical). The top is **command + alert**. The bottom is **engineering telemetry**. Comm windows are holograms that rise *over* the table without ever covering the side banks.

### Full 1920×1080 layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  COMMAND BAR — 52px                                                                    │
│  KRE8Ωr ☿ MISSION CONTROL   ◷ STARDATE 79443.2 / 14:22:07   [⊙ STATUS] BRIEFING  HAIL ▾│
├──────────────────────────────────────────────────────────────────────────────────────┤
│  ALERT DECK — 88px (collapses to a 12px hairline "ALL SYSTEMS NOMINAL" pulse when 0)   │
│  [▲ CRITICAL — diagonal scanner sweep · own motion budget]  [▲ WATCH — amber]          │
├──────────┬──────────────────────────────────────────────────────────────┬─────────────┤
│          │                                                                │             │
│  PORT    │                                                                │  STARBOARD  │
│  BANK    │                  THE  TACTICAL  TABLE                          │  BANK       │
│  280px   │                  (galaxy map · ~1160px wide)                   │  280px      │
│          │                                                                │             │
│ ┌──────┐ │     ·  ✦   ·       the living center of the ship       ✦   ·   │ ┌─────────┐ │
│ │ CONN │ │        ·                                            ·          │ │ SCIENCE │ │
│ │ ▢▢▢▢ │ │   ·         ╭────────────────────────────────╮      ✦  ·      │ │  ▢▢▢▢   │ │
│ │ pipe │ │       ✦     │   PROJECTS as star systems     │   ·            │ │ audience│ │
│ │ line │ │   ·         │   moving PRE→PROD→POST→DIST     │        ✦       │ │ youtube │ │
│ └──────┘ │             │   along helm trajectory lanes  │    ·           │ └─────────┘ │
│          │     ·  ✦    │                                │                │             │
│ ┌──────┐ │             │   brand-deal vessels inbound   │   ✦       ·    │ ┌─────────┐ │
│ │ OPS  │ │        ·    │   on 2D sensor sweep           │                │ │ TACTICAL│ │
│ │ ▢▢▢▢ │ │   ✦         │                                │     ·      ✦   │ │  ▢▢▢▢   │ │
│ │ orgr │ │             ╰────────────────────────────────╯                │ │community│ │
│ │ grex │ │     ·              ◉ SHIP SILHOUETTE                  ✦        │ │ shield  │ │
│ └──────┘ │          ✦      (visible only when all nominal)   ·            │ └─────────┘ │
│          │   ·                                                       ·    │             │
│ ┌──────┐ │        ·   ✦                                    ✦              │ ┌─────────┐ │
│ │ CREW │ │              the negative space IS the instrument:            │ │  COMMS  │ │
│ │ ◉◉◉  │ │     ·        empty = calm = nominal                    ·  ✦   │ │  ▢▢▢▢   │ │
│ │holos │ │                                                                │ │ family  │ │
│ └──────┘ │                                                                │ └─────────┘ │
├──────────┴──────────────────────────────────────────────────────────────┴─────────────┤
│  ENGINEERING RIBBON — 60px                                                             │
│  ⊹ FRAME ▁▃▅▂ · ⊹ TX ▁▁▂▁ · ⊹ POSTΩr ▂▁▃▁ · ⊹ BACKUP ▁▂▁ · ⊹ WATCHER ▃▅▃▅ · AI$ ◔ 12.40│
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### The five zones, by proportion and role

**Zone 1 — Command Bar (top, 52px, full width).** Ship identity, the live stardate clock, the global status pip (sonar-ping when nominal), and the three command verbs: **BRIEFING** (Number One's morning report), **HAIL ▾** (open a crew comm channel — dropdown of all holographic crew), and the quick-create cluster (+IDEA / SCRIPT / POST). This bar never changes position. Muscle-memory anchor.

**Zone 2 — Alert Deck (top, 88px → 12px).** The single most important architectural decision in the whole bridge: **this zone breathes.** At zero alerts it collapses to a 12px hairline reading "ALL SYSTEMS NOMINAL" with one slow teal pulse, *donating its vertical space to the Tactical Table.* The calmer the ship, the bigger the galaxy. When alerts fire, it expands to 88px and shows up to two cards — CRITICAL (red, owns the diagonal scanner sweep and the full motion budget) and WATCH (amber). Every card carries its recovery action inline. This is progressive disclosure by threat level made physical: *the UI grows toward the danger.*

**Zone 3 — Port & Starboard Instrument Banks (sides, 280px each, vertical stacks).** Real bridge consoles are vertical columns, not horizontal cards. Each bank holds station modules stacked top-to-bottom. **Port = production/ops side** (CONN content pipeline, OPS business, CREW holograms). **Starboard = audience/world side** (SCIENCE audience, TACTICAL community, COMMS family). The split is semantic and learnable: *what I make* on the left, *who I serve* on the right. Each module is a self-contained instrument cluster (Section 3). Fixed spatial memory — Jason's eyes will go to runway the way a pilot's go to airspeed.

**Zone 4 — The Tactical Table (center, ~1160px wide, the ship's heart).** This is the radical departure. The center of the screen is **not a panel** — it is the situational core, a holographic galaxy map (the Three.js universe, Section 6) on which the *actual state of the operation is plotted spatially*:

- **Active projects are star systems** drifting left-to-right along four trajectory lanes: PRE-PRODUCTION → PRODUCTION → POST → DISTRIBUTION. A project's position *is* its pipeline stage. A stalled project's star dims and develops a slow red corona. Click a star → it expands into a project detail card overlay (beats remaining, coverage confidence, gate timestamps, viral clip candidates).
- **Brand-deal receivables are inbound vessels** on a 2D sensor sweep at the table's lower-right — contacts approaching from deep space, distance = days-until-due, blip color = status (pending/invoiced/overdue=red and pulsing). Overdue deals are vessels that have crossed the perimeter.
- **The ship silhouette** sits at the table's heart, **visible only when everything is nominal** — the ultimate calm-state reward. As soon as any system goes amber, the ship fades and the relevant data surfaces in its place. The Captain learns: *I can see my ship = I'm flying clean.*
- **Negative space is the primary instrument.** Per the research: no more than 40% of the table is ever occupied. Emptiness reads as health. A crowded galaxy reads as a busy, possibly troubled, operation — instantly, pre-verbally.

**Zone 5 — Engineering Ribbon (bottom, 60px, full width).** Ambient telemetry, peripheral vision only. The five system waveforms (frame analysis, transcription, PostΩr, backup, watcher) plus a new **AI spend meter** (token_usage rolled up as a quarter-ring "fuel burn" gauge). This is Elite Dangerous cockpit telemetry — never demands a foveal look, always building situational awareness. Watcher heartbeat as an EKG; if it flatlines, the line goes red and still.

### How comm windows overlay without obscuring

Holographic crew (Section 5) rise as **edge-anchored comm windows over the Tactical Table only** — never over the side banks. A hailed crew member materializes in the lower-third of the center, the galaxy dims 15% behind them (focus cue), and the side instruments stay fully lit and readable. The Captain can talk to Grex about runway *while still watching the runway gauge on the port bank.* The comm is additive, never modal. This is the Star Trek viewscreen: the bridge keeps flying while the channel is open.

---

## SECTION 3: PANEL-BY-PANEL INSTRUMENT SPEC

Each station below is specified as a four-layer instrument: **PRIMARY** (the one big readout, no interaction), **SECONDARY** (3–5 supporting instruments on the card), **TERTIARY** (hover/click reveals), **AMBIENT** (background telemetry). Color discipline is absolute: teal/cyan = science & nominal, amber = watch, red = critical, violet = finance, green-soft = family, orange = engineering.

---

### ⊿ CONN — CONTENT PIPELINE (Port bank, top)
*Station color `#14b8a6` teal. The helm. "Where is everything in the river of production?"*

**PRIMARY INSTRUMENT — "Days Since Last Video" as a draining countdown ring.**
A single radial ring, conic-gradient fill, with the day count as a Bebas Neue numeral at center. The ring *fills toward red* as days accumulate past Jason's cadence target (publish_gap threshold ~9 days). 0–4 days: teal arc, calm. 5–8: amber. 9+: red, ring nearly full, slow pulse. The shape says "you're overdue" before the number does. Twin reticle arcs (cw/ccw) orbit it — the existing rotating reticle, kept, it's perfect.

**SECONDARY INSTRUMENTS (4):**
1. **Pipeline funnel** — four stacked horizontal fill-bars (PRE / PROD / POST / DIST) with live counts. Bar width = project count in that lane. Mirrors the Tactical Table's trajectory lanes — same data, two views.
2. **Script-readiness pips** — a row of dots, one per active project, teal-filled if `writr_complete=1`, hollow if not. "How many of my active projects actually have an approved script?" answered in one glance.
3. **Stall indicator** — the oldest stalled project's title + days-in-stage, amber, only appears when something is stalled (contextual visibility — invisible at health).
4. **Top-3 active project chips** — title + stage code (M0.1–M5), tap to jump to that project.

**TERTIARY (click the ring):** expands a drill-down over the Tactical Table: per-project **gate timeline** (gate_a/b/c_approved_at — how long it sat at each gate), **unshot beats** count (shoot_takes status='needed'), **coverage_confidence** and **critique_note** from AssemblΩr, **DaVinci timeline state**, and **ShowΩr arc position** if the project belongs to a serialized show (episode N of season, central_question_status).

**AMBIENT:** Each project's star on the Tactical Table is this station's true home. The funnel here is the abstract; the galaxy is the concrete. Off-script-gold count from the vault flickers as a tiny gold sparkle in the corner when new gold lands.

---

### ⊿ OPS — BUSINESS / FINANCE (Port bank, middle) — *the richest station*
*Station color `#8b5cf6` violet. Engineering & treasury. Grex's domain. Data from OrgΩr port 3002.*

**PRIMARY INSTRUMENT — RUNWAY as a fuel gauge arc.**
The single most important number Jason owns. A 270° arc gauge, the needle resting on `runway_months`. The arc is zoned: **red 0–0.5, amber 0.5–1.5, teal 1.5–3, bright-teal 3+**. The needle's resting position in a colored zone tells him survival status pre-verbally — this is literally a fuel gauge, the most legible instrument humans have built. Center of the arc: net_worth as the Bebas Neue hero (liquid + crypto − debt).

**SECONDARY INSTRUMENTS (5):**
1. **Weekly income oscilloscope** — `weekly_gi` (13 weeks) rendered as a live oscilloscope waveform, not a sparkline. Higher income = taller, faster trace. A good week spikes the scope. This is the ship's pulse — income is the heartbeat, shown as one.
2. **Bucket floor shield-bars** — five thin vertical bars (tax_vault, runway, fixed_expenses, owner_draw, production), each a fill-level of `available` vs `target_balance`. Any bucket `below_floor` flashes its bar amber-red. Sacred buckets (tax_vault) get a small lock glyph.
3. **Crypto lateral bars** — a horizontal stack of coin tickers with value bars, each labeled (BTC/ETH/etc from crypto holdings), total_crypto as the cap. Live-revalue dot pulses teal when prices are fresh, dims when stale.
4. **Tax vault status** — a small "shield charge" ring showing taxes_accumulated vs estimated_quarterly, with days_to_due as a countdown. Turns amber inside 14 days of a quarterly due date.
5. **Grex alert line + GREX hail button** — Grex's one-line status, color = grex_alert level, button opens his comm channel.

**TERTIARY (click runway gauge):** full **90-day cashflow forecast** drill-down from /api/predictions/cashflow — the timeline of income/expense events with balance_after at each, critical/caution alert markers, and the **debt payoff projections** (creditor, months_left, payoff_date, monthly_freed when each debt clears). A second tab: **platform revenue trends** (6-month per-platform bars, trend arrows) and **receivables pipeline** (which doubles as the inbound-vessel sensor on the Tactical Table).

**AMBIENT:** The income oscilloscope's idle hum sets the bridge's baseline "alive" frequency. Brand-deal receivables appear as inbound vessels on the central sensor sweep — OPS owns those contacts.

---

### ⊿ CREW — HOLOGRAPHIC CREW (Port bank, bottom)
*A new station. The roster of AI crew, each a hailable hologram. See Section 5.*

**PRIMARY:** A row of crew sigils (Number One, Grex, Dale, + future crew), each a small circular portrait-ring. Ring color = that crew member's domain. A crew member with something to say has a *pulsing ring* (contextual entrance) — "Grex wants a word" = his violet ring pulses. Tap to hail → hologram rises over the Tactical Table.

**SECONDARY:** "Last brief: 06:00" timestamp; a **CREW BRIEFING** button that triggers the simultaneous all-station report (Section 5).

**AMBIENT:** When idle, crew rings glow at 40%. The whole point: the crew is *present but waiting* — deferential, the contract from Section 1.

---

### ⊿ SCIENCE — AUDIENCE / ANALYTICS (Starboard bank, top)
*Station color `#06b6d4` cyan. Sensors & long-range scan. "How is the work landing?"*

**PRIMARY INSTRUMENT — YouTube subscriber count as a sensor-return numeral** with a *living* sparkline (not the current static polyline — this one animates a sweep on refresh). Bebas Neue hero, cyan glow.

**SECONDARY INSTRUMENTS (5):**
1. **Cross-platform reach ring** — a multi-band ring, one band per platform (YT/FB/IG), band length = recent reach. Currently Mission Control shows *zero* per-platform metrics — this surfaces the `analytics` table's views/reach/shares across all synced videos for the first time.
2. **MailerLite gauge** — subscriber count + open-rate as a small arc (open rate as fill %).
3. **Best-video beacon** — the channel's best performer (avg_views / total_views), a single bright contact.
4. **Shorts vs Longform cadence split** — a two-tone bar from `posts.format`, showing publish-mix balance.
5. **Monthly revenue trace** — `monthly_revenue` as a small bar trend (YT monetization, currently unsurfaced anywhere).

**TERTIARY (click subs):** drill-down to **per-video analytics** (views/likes/comments/avg_watch_time/saves per post per platform), **TikTok content patterns** (the Claude-analyzed patterns sitting unused in kv_store), **content-angle distribution** (financial/system/rockrich proportions from posts.angle), and **MirrΩr self-evaluation scores** (strategy_reports.evaluation accuracy/calibration).

**AMBIENT:** A slow long-range sensor sweep across the table's upper edge — Science is always scanning. New analytics sync = a brief sensor return ping.

---

### ⊿ TACTICAL — COMMUNITY (Starboard bank, middle)
*Station color `#f0a020` amber. Shields & boarding parties. ROCK RICH. "Is the community alive and converting?"*

**PRIMARY INSTRUMENT — COMMUNITY HEALTH as a shield-strength ring.**
A segmented shield ring (think deflector charge) whose total charge = engaged/active members vs total. Three nested arcs for the three tiers: outer = Greenhouse 🌱 (free), middle = Garden 🌿 ($19), inner = Founding 50 🏆 ($297). Each arc's fill = member count vs capacity. The shield *weakens* (dims) as the lurker ratio climbs — 1,332 of 1,366 at score 25 is a *low shield*, shown honestly.

**SECONDARY INSTRUMENTS (5):**
1. **Warm leads hero** — the count of Greenhouse members showing upgrade signals, amber Bebas Neue with the teal glow (the existing warm-leads-hero animation, kept). These are *boarding opportunities.*
2. **Starting Line challenge rail** — 20-segment progress bar by elapsed days (challenge runs to June 12 2026), kept from current build.
3. **Lurker count** (≤25 score) and **score-mover velocity** — members who graduated ≤25→>25 in last 30 days (lurker_graduation rate from member_history). Movement = the community waking up.
4. **DMs ready** — count of warm_leads with dm_status='draft' awaiting approval — a contextual hail-ready indicator.
5. **Tier conversion rate** — (garden+f50)/total trending from snapshots.

**TERTIARY (click shield):** **community activity feed** (community_events: new_member / first_post / score_moved), the **warm-lead detail** with signals_json ("posted_in_community, multiple_posts, active_commenter") and the **dm_draft** with an APPROVE-and-send action inline (recovery path: a cold lead is one tap from a warm hail), and **membership growth trend** from snapshots.

**AMBIENT:** New community events ping as small contacts entering the table's amber sector. A first_post event = a bright friendly blip — someone just came aboard.

---

### ⊿ COMMS — FAMILY COMMAND (Starboard bank, bottom)
*Station color `#86efac` green-soft. Life support & ship's company. KinOS, port 3001. "Is the home running?"*

**PRIMARY INSTRUMENT — today's family timeline** as a horizontal "watch schedule" strip: stardate line + up to 3 events (time + text). The number that matters here isn't a metric — it's *what's happening today.* If a scheduling conflict exists, the strip glows red.

**SECONDARY INSTRUMENTS (5):**
1. **Cellar status** — out-of-stock + low-stock counts as a small supply gauge (from KinOS inventory). Homestead life support. Currently buried in /cellar.html — surfaced here for the first time.
2. **Overdue tasks chip** + **conflict chip** + **low-stock chip** (the existing chip row, kept).
3. **Redemption queue badge** — kids waiting for reward approval (KinOS redemptions pending) — a contextual indicator that pings the Captain when a child is waiting.
4. **Honey-do alert** — if Jason personally has honey_do items (the pink-banner data), shown as a small personal-tasking light.
5. **Family points / lucky-day** — a tiny standings glyph + a 1.5x bolt when it's a Lucky Day.

**TERTIARY (click timeline):** the **near-a-store HerderΩ card** (if GPS active: "0.4mi from Tractor Supply — 3 items to grab" via /api/herder/check), **price-trend alerts** ("chicken feed up 22% since March" — content gold + budget signal), and the **weekly cost summary** (tracked spend from list_items est_price).

**AMBIENT:** Life-support breathing — a very slow green pulse at the bottom of the starboard bank. If a conflict or out-of-stock-critical fires, this is the one family signal allowed to grab motion budget.

---

### ⊿ ENGINEERING — SYSTEM HEALTH (bottom ribbon, full width)
*Station color `#fb923c` orange. The ship's machinery. Ambient only — never demands attention.*

**PRIMARY:** No single hero — Engineering is *pure ambient telemetry* by design (Elite Dangerous principle). The "primary" is the *collective stillness* of the waveforms. Five calm traces = a healthy ship.

**SECONDARY INSTRUMENTS (6):**
1–5. **Five system waveforms** — Frame Analysis (violet), Transcription, PostΩr, Backup, Watcher — each an animated trace whose amplitude = queue depth/activity. Idle = flat calm line; busy = active waveform. (frame_queue_pending, tx_queue_pending, postor_pending, backup_age_hours, watcher_active.)
6. **AI FUEL BURN** — *new* — a quarter-ring "fuel" gauge rolling up `token_usage.estimated_cost` for the month, broken down by tool on hover. The ship literally burns AI fuel; show the burn. First-ever AI cost visibility in Mission Control.

**TERTIARY (click any waveform):** **background_jobs history** (youtube-sync, meta-sync, frame-analysis batch — running/done/failed), **vault health score** (% of footage with visual_analyzed_at), **watcher last-heartbeat age in minutes** (not just the current boolean), and **PostΩr failed-queue** with per-post RETRY beams.

**AMBIENT:** This entire ribbon *is* the ambient layer. Watcher waveform as a heartbeat is the single most important "ship is alive" signal on the bridge — flatline = the ship stopped breathing, and that flatline is allowed to turn the ribbon red and pull the eye.

---

### NEW STATION SUGGESTED BY THE DATA: ⊿ COMMERCE (a fold-out of OPS)
The inventory is rich enough to justify a dedicated commerce readout, surfaced as an OPS tertiary or its own slim module: **affiliate clicks this week** (by partner, from affiliate_clicks), **commissions received** (affiliate_commissions, currently surfaced *nowhere*), **gear-page inventory by category**, and the **land-site fence-tool questions** (last 200, from the 7kinhomestead.land bridge) — a direct signal of audience intent. This is revenue the Captain currently can't see; a bridge should see all incoming resources.

---

## SECTION 4: THE SKINS SYSTEM ARCHITECTURE
*The commercial engine. The reason Kre8Ωr becomes a platform, not a tool.*

### The core principle: the engine owns layout, the skin owns soul

This is the Fortnite/Roblox decoupling applied with discipline. **A skin never touches DOM structure or layout geometry — only presentation tokens, particle scenes, animation curves, sound hooks, and crew personas.** The Tactical Table is always center; runway is always a gauge; the watcher is always a heartbeat. A skin changes *what the bridge is made of*, never *where the instruments are.* This is what keeps skins safe, swappable, and impossible to break the UI with.

### File format: the `.k8skin` bundle

A skin is a folder (zipped as `.k8skin`) with a manifest and assets:

```
starfleet-command.k8skin/
├── skin.json            ← manifest + token bundle (the heart)
├── particles.js         ← optional Three.js scene module (default export)
├── sounds/              ← comm chime, alert klaxon, ambient hum, channel-close static
├── crew/                ← character clip manifests + persona prompt overrides
│   └── number-one.json
├── textures/            ← bg grids, nebula gradients, frame brackets
└── preview.webp         ← marketplace thumbnail
```

**skin.json structure:**
```json
{
  "meta": {
    "id": "starfleet-command",
    "name": "Starfleet Command",
    "author": "kre8r-official",
    "era": "SNW / Discovery bridge",
    "version": "1.0.0",
    "tier": "creator",
    "price_usd": 12
  },
  "tokens": {
    "mc-bg": "#060c0e", "mc-panel": "#0d1e20", "mc-line": "#1a2e32",
    "mc-teal": "#14b8a6", "mc-cyan": "#06b6d4", "mc-amber": "#f0a020",
    "mc-red": "#ef4444", "mc-violet": "#8b5cf6", "mc-green-soft": "#86efac",
    "font-hud": "'Orbitron', monospace",
    "font-head": "'Bebas Neue', sans-serif",
    "font-data": "'Exo 2', sans-serif",
    "panel-radius": "4px",
    "glow-primary": "0 0 12px rgba(20,184,166,0.6)",
    "motion-pulse-duration": "4s",
    "instrument-style": "arc"
  },
  "station_callsigns": {
    "conn": "CONN", "ops": "OPS", "tactical": "TACTICAL",
    "science": "SCIENCE", "comms": "COMMS", "eng": "ENG"
  },
  "particles": { "module": "particles.js", "preset": "deep-starfield" },
  "sounds": {
    "comm_open": "sounds/chime.mp3",
    "comm_close": "sounds/static.mp3",
    "alert_critical": "sounds/klaxon.mp3",
    "ambient_hum": "sounds/bridge-hum.mp3"
  },
  "crew": {
    "first_officer": { "manifest": "crew/number-one.json" }
  }
}
```

### The injection mechanism (plug-and-play)

1. **Token application:** On skin load, a `SkinManager` validates the manifest against a required-token schema (every token in the base set must resolve, via the skin or a hardcoded fallback chain `var(--mc-teal, #14b8a6)`). It writes all tokens to `:root` as CSS custom properties under a `[data-skin="<id>"]` attribute selector. Swap = `document.documentElement.dataset.skin = 'lcars-classic'` — one line, instant, no reload.
2. **Particle swap:** The base Three.js loop calls `skin.particles.init(scene, dataFeed)` — the skin's module owns the universe (Section 6), but receives the *same live data feed*, so a skin can never break the data binding.
3. **Sound hooks:** `SkinManager` registers the skin's audio against named events (`comm.open`, `alert.critical`). No skin = silent fallback.
4. **Crew personas:** The skin's crew manifest overrides character clips *and* the persona system prompt — so "Number One" can become a Vulcan, a Ferengi, a film-noir detective. The *function* (morning brief) is engine-owned; the *voice* is skin-owned.

**Robustness laws (from the research):** tokens-not-values (a skin can set `--mc-teal`, never `margin`); fallback chains everywhere; load-time validation with silent rejection → default skin; total isolation from DOM. A malformed skin *cannot* break the bridge — worst case, it fails validation and the default loads.

### Skin tiers

- **Foundation (free, ships with product):** "Starfleet Command" (the default, teal SNW bridge). Everyone gets a beautiful bridge.
- **Creator skins (premium, $8–$20, kre8r-official):** professionally designed, full particle + sound + crew persona swaps. The Fortnite battle-pass tier.
- **Community marketplace (rev-share):** designers build `.k8skin` bundles, submit through a validator, list for sale. Kre8Ωr takes a platform cut. This is the long-tail engine — the same dynamic that makes Fortnite skins a billion-dollar business, pointed at creators who want their command center to feel like *theirs.*

### Marketplace + install UX

**For the designer:** a `k8skin` CLI/web validator that lints the manifest, checks required tokens, previews the particle scene, and packages the bundle. Submit → automated validation → human review for the marketplace → list with the `preview.webp` and a live demo bridge.

**For the Captain:** a **"Refit Bay"** screen (itself skinned). A wall of preview bridges, each a live miniature running real data. Hover = the mini-bridge animates. Click **APPLY** → a 600ms "system refit" transition: the current bridge powers down (instruments dim sequentially), a static burst, the new skin powers up (instruments engage in sequence, Section 2's panel-engagement animation reused). It *feels* like re-commissioning the ship. Owned skins live in a hangar; the store is one tab over.

### Five example skins

1. **STARFLEET COMMAND** *(free / default)* — SNW/Discovery bridge. Teal & cyan, Orbitron HUD, deep starfield, arc instruments, Number One as a Riker-archetype first officer. Calm, layered, holographic. The baseline beauty.

2. **LCARS CLASSIC** *(creator, $10)* — 1987 TNG. Flat high-contrast color blocks, the iconic orange/mauve/lavender palette, swoopy pill-bars, that unmistakable Antonio font feel. No starfield — a flat black void. Instrument style flips from `arc` to `block`. Nostalgia tier. Computer voice says "Working."

3. **NOSTROMO / RETRO-INDUSTRIAL** *(creator, $14)* — Alien's lo-fi cassette-futurism. Green CRT phosphor, scanlines baked in, monospace everything, amber warning text, a slow whirring ambient hum, MOTHER as the ship's computer crew persona. The bridge feels *worn and lived-in.* Particle scene = drifting dust, not stars.

4. **OMEGA DIRECTIVE / BLACK-OPS** *(premium, $20)* — Discovery's Section 31. Near-black, blood-red and gunmetal, sharp angular brackets, minimal glow, klaxon-heavy sound design, a clipped tactical-AI crew persona. High-density, high-tension. For when the Captain wants the bridge to feel like a warship. Crew speaks in mission-terse.

5. **HEARTH / HOMESTEAD-WARM** *(creator, $12)* — the *anti*-starship, and possibly the most important for Jason's actual brand. Warm amber lantern-light, wood-grain textures, a fireside-ember particle system instead of stars, soft organic curves, a folksy warm crew persona ("the foreman"). Proves the skin system isn't locked to sci-fi — the *engine* is a command center; the *soul* can be a homestead kitchen at dawn. This is the skin that shows the marketplace's range.

---

## SECTION 5: THE HOLOGRAPHIC CREW SYSTEM

### How a comm window opens (technical)

Higgsfield outputs MP4 loops, so the comm window is a **video-element overlay**, singleton, edge-anchored over the Tactical Table's lower-third — never WebGL (3–5x cost, unjustified). One `CommManager` class owns open/close, clip sequencing, and choreography. Route modules and station taps fire `CommManager.hail('grex', 'greeting')`.

```html
<div class="comm-window" data-crew="grex">
  <video autoplay loop muted playsinline></video>   <!-- src swaps idle↔speaking -->
  <div class="comm-frame"></div>                      <!-- glow + corner brackets -->
  <div class="comm-label">GREX · CHIEF FINANCIAL OFFICER</div>
</div>
```

Idle loop plays; when the crew "speaks" (SSE response streams), swap `src` to the speaking clip, listen for `ended`, return to idle. Each crew member's clips live in a manifest: `{ "crew":"grex", "clips":{ "idle":"...", "greeting":"...", "alert":"...", "sign_off":"..." } }`.

### What a hologram looks like

- **Edge fade:** `mask-image: radial-gradient(ellipse 80% 90% at 50% 50%, black 60%, transparent 100%)` — the character vignettes into the bridge, no hard rectangular crop.
- **Holographic tint + scanlines:** a `::before` overlay with a repeating 2px cyan scanline gradient at low opacity + a subtle blue color-grade via `filter`.
- **Transmission flicker:** `@keyframes hologram-flicker` firing every 8–15s (opacity dips to 0.85/0.9 for one frame) — authentic transmission instability without constant motion cost.
- **Corner brackets:** `::before`/`::after` pseudo-elements drawing teal L-brackets — the "screen within a screen" frame.

### Entrance / exit choreography (this is the whole feel)

- **Entrance:** scale 0.9→1.0 + opacity 0→1 over 300ms, with a **1-frame white static-burst at 5% opacity** on frame one (the channel-acquiring flash). Comm chime plays. Tactical Table dims 15%.
- **Exit:** reverse, ending in a horizontal `scaleX` collapse to a 1px line (the classic "channel closed" squash), 50ms, then gone. Static hiss plays. Table returns to full brightness.

### Character roster

**Exists now:**
- **NUMBER ONE** — *First Officer.* Riker-archetype. Domain: the whole ship. Gives the morning **BRIEFING** (aggregates everything via /api/mission/number-one, Claude SSE, TTS playback). The Captain's right hand.
- **GREX** — *Chief Financial Officer.* Ferengi-coded, Rules of Acquisition. Domain: OPS/treasury (OrgΩr). Sharp, money-obsessed, weirdly loyal. Hailed from the OPS station.
- **DALE McGILLICUTTY** — *Executive Division Assistant (Job 64).* Domain: org operations, task routing, approvals (action cards with APPROVE/REJECT).

**Should be added:**
- **SCIENCE OFFICER (audience/analytics)** — cool, precise, sensor-focused. Reports on reach, retention, what's landing. Vulcan-adjacent calm. Domain: SCIENCE station.
- **TACTICAL OFFICER (community)** — warm but strategic, watches the shields. Domain: ROCK RICH community, warm leads, conversion. "We have boarding opportunities, Captain."
- **SHIP'S COUNSELOR / COMMS (family)** — KinOS domain. Gentle, attentive to the home and the kids. The one who reminds the Captain that life support is the family.
- **ENGINEER (system health)** — gruff, Scotty-coded. "The queues are holdin', Captain, but I cannae promise the watcher past Thursday." Domain: ENGINEERING ribbon.

Each crew member's persona is **skin-swappable** (Section 4) — the *role* is fixed (CFO, Science Officer), the *character* changes with the skin.

### The Crew Briefing concept

**CREW BRIEFING** button (in the CREW station) triggers a **simultaneous all-station report.** Each crew member's comm window opens in sequence around the Tactical Table edges (not all at once — a 400ms stagger, like a bridge roll-call), each delivering a one-line station status from their domain's live data:

- Number One: overall posture + the single most important order.
- Grex: "Runway holds at 2.1 months, Captain. One brand-deal vessel inbound, due in 9 days."
- Science: "Subscribers up 1.2k this week. The Shorts are out-pacing longform 3 to 1."
- Tactical: "Shields steady. 4 boarding opportunities flagged — DMs drafted and awaiting your word."
- Counselor: "Two events on the family schedule today. The cellar's running low on feed."
- Engineer: "All systems holdin'. Backup's 47 minutes old. Watcher's breathin' fine."

Delivered as a choreographed sequence — the Captain hears his whole ship report in 30 seconds. This is the *flagship moment* of the entire product. It is the thing Jason will show people.

### Audio design

- **Comm open:** a soft two-tone Starfleet hail chime.
- **Comm close:** a brief static hiss + the squash.
- **Speaking:** subtle holographic carrier hum under the voice (TTS via ElevenLabs/Edge, already built).
- **Critical alert:** a restrained klaxon — *once*, not looping (alarm is precious).
- All audio is **skin-hooked** — LCARS chirps, Nostromo whirs, Hearth wooden knocks. Default-silent if a skin omits a sound.
- **ElevenLabs Sound Effects API** — ElevenLabs can generate custom sound effects from text descriptions (not just TTS). Comm chime, static burst, iris shutter click, LCARS panel chirp, alert klaxon, ambient bridge hum — all generatable with a text prompt. Same API key as Number One's voice. Wire into the skins sound hook system when Session C builds SkinManager. Endpoint: `POST https://api.elevenlabs.io/v1/sound-generation` with `{ text: "soft two-tone starfleet comm chime", duration_seconds: 1.5 }`.

---

## SECTION 6: THE THREE.JS UNIVERSE — THE LIVING BACKGROUND

The current starfield (400 stars, 40 sensor contacts, constellation lines) is beautiful but *static and disconnected from the data.* We make it **the ship's true situational display** — the galaxy reacts to the real state of the operation.

### Principle: the universe breathes with the ship's health

The particle system is **data-reactive ambient telemetry**, not decoration. A glance at the *texture of space itself* tells the Captain the ship's mood before he reads a single instrument.

**1. Star density / speed / color react to system health.**
- **Activity → density.** More active work on the ship = more stars. Busy queues, active renders, live syncs each spawn drifting particles. A working ship has a *richer* sky. An idle ship has a sparse, calm field.
- **Speed → urgency.** Baseline drift is meditative (0.0003–0.0009/frame, kept). When a critical alert fires, the *entire field accelerates slightly* and shifts toward the alert's color temperature — the ship goes to a higher alert footing, and you *feel* it in your peripheral vision before you read the card.
- **Color → state.** Nominal = the current cool blue/teal palette. Watch condition = stars warm toward amber. Critical = a red shift creeps in from the screen edges.

**2. Nebula zones — colored regions for data states.**
Soft volumetric gradient clouds (additive blending, `mix-blend-mode: screen`) drift in the deep background, each tinted to a domain:
- A **violet nebula** swells near the OPS side when finances need attention (bucket below floor, runway dropping).
- An **amber nebula** glows on the community side when warm leads are waiting.
- A **green nebula** breathes on the family side when life-support items are critical.
The Captain reads the *weather of his operation* — "the violet's getting thick on the left" — before any number.

**3. The ship silhouette (the calm reward).**
A subtle wireframe ship hull rests at the Tactical Table's heart, **visible only when every system is nominal.** It's the single most powerful calm-state signal: *if I can see my ship, I'm flying clean.* The moment anything goes amber, the silhouette dissolves and the troubled data surfaces in its place. Jason will *want* to see his ship — that desire is the gamified pull toward a healthy operation.

**4. The sensor sweep that reveals hidden layers.**
The existing 8s `sensor-sweep` line becomes interactive: as it passes across the Tactical Table, it **momentarily illuminates data layers normally hidden** — for the half-second the sweep crosses a project star, that star reveals its label and stage; as it crosses the inbound-vessel sector, the brand-deal contacts flare with their due-dates. The sweep is the ship's radar painting the galaxy, surfacing detail in waves so the resting state stays calm and uncluttered.

**5. The brand-deal sensor + project trajectory (data made spatial).**
The 40 sensor contacts are repurposed from decoration to **real contacts**: project stars on their PRE→DIST trajectory lanes, and brand-deal receivables as inbound vessels (distance = days-to-due). Constellation lines connect related contacts — a project star links to the brand-deal vessel funding it. The galaxy *is* the operation, plotted.

**Performance discipline (kept from current):** pixel ratio capped at 2, antialias off, constellation rebuilt with DynamicDrawUsage, one motion budget. At idle, the universe is *slow* — the reactivity only spends energy when the data demands it.

---

## SECTION 7: IMPLEMENTATION ROADMAP

Each session is self-contained, shippable, and feels like Christmas. Build order front-loads the richest data (Business + Community) so the payoff is immediate.

**SESSION A — Layout restructure + instrument-cluster foundation.**
Rebuild the grid from 5-panel to the bridge architecture: Command Bar, breathing Alert Deck, Port/Starboard vertical banks, the central **Tactical Table** container (empty galaxy at first), Engineering ribbon. Migrate all existing `/api/mission/snapshot` bindings into the new zones. Establish the four-layer instrument component pattern (PRIMARY/SECONDARY/TERTIARY/AMBIENT) as a reusable structure. Ship it: same data, new bones. *Christmas: the bridge has a center now.*

**SESSION B — Panel-by-panel instrument redesign (OPS + TACTICAL first).**
Build the runway fuel-gauge arc, the income oscilloscope, bucket shield-bars, crypto lateral bars, tax shield (wire the unwired OrgΩr endpoints: crypto/net-worth, receivables, predictions, obligations, debts). Then the community shield-strength ring, warm-leads boarding indicators, lurker-graduation velocity. Add tertiary drill-downs. *Christmas: finance and community feel like real instruments.* Follow with CONN, SCIENCE, COMMS, ENGINEERING in a second pass (including the new AI fuel-burn gauge and the COMMERCE fold-out).

**SESSION C — Skins system architecture + first alternate skin.**
Build `SkinManager`: token validation, `[data-skin]` injection, fallback chains, the `.k8skin` format, particle-module swap interface, sound hooks, crew-persona override. Refactor every hardcoded value in Sessions A/B to tokens. Ship the default "Starfleet Command" as a formal skin + build **LCARS Classic** as proof the engine/soul split works. Build the **Refit Bay** screen with the power-down/power-up transition. *Christmas: the bridge can change its soul.*

**SESSION D — Holographic comm windows.**
Build `CommManager`: singleton video overlay, edge-fade mask, scanline/flicker shader-in-CSS, entrance static-burst, exit squash, comm chime/static audio. Wire Number One, Grex, Dale to it (replacing the current drawer channels with holograms over the Tactical Table). Clip manifests + idle/speaking swap. *Christmas: the crew has faces now.*

**SESSION E — Living Three.js universe.**
Make the particle system data-reactive: activity→density, alert→speed/color, nebula zones per domain, the ship silhouette calm-reward, the interactive sensor sweep revealing layers, projects-as-stars on trajectory lanes, brand-deals-as-vessels. *Christmas: the galaxy is alive and it knows how the ship is doing.*

**SESSION F — Full crew roster + personas + Crew Briefing.**
Add Science Officer, Tactical Officer, Ship's Counselor, Engineer (Higgsfield clips + persona prompts + domain data wiring). Build the choreographed **CREW BRIEFING** all-station roll-call. Make personas skin-swappable. *Christmas: the whole crew reports, in sequence, and it's the demo that sells the platform.*

**(Bonus Session G — Marketplace.)** The `k8skin` validator/packager, the store tab in the Refit Bay, rev-share plumbing. The commercial unlock.

---

## SECTION 8: THE DESIGN MANIFESTO

**KRE8Ωr is a bridge, not a dashboard.**

We build command centers for creators who run empires alone. Every screen we make obeys one law: *calm at rest, total under load.* The interface is quiet when nothing needs the Captain and instantly, completely expressive when something does. Silence is the default so that alarm means something. We never spend motion on decoration; we spend it only on what matters, right now.

State lives in shape and color; detail lives in text; motion lives in change. The eye must assess the whole operation in one sweep before it reads a single number — a draining gauge, a weakening shield, a thickening nebula. We design for the glance first and the look second. A blank instrument reads as *offline*, never as zero; we never lie with a dead dial.

We honor the Prime Directive in glass: never lose the creative thread, never break it without a path back. Every alert carries its own escape hatch. The ship never strands the Captain.

The engine owns the layout; the soul is swappable. A creator's command center should feel like *theirs* — their era, their crew, their light. We decouple what a thing *does* from what a thing *is*, so the function stays unbreakable while the soul stays free.

And above all: the ship keeps the watch while the Captain sleeps, and wakes glad he's back. We are not building software a person uses. We are building a vessel a person commands — competent, deferential, honest, alive. Make them feel like the captain of a starship. That is the work. Honor it.

---

The complete spec is above, delivered inline as my response. No files written, per instructions. It covers all eight sections: the governing philosophy (the bridge-not-dashboard contract), the full 1920×1080 instrument-cluster architecture centered on the Tactical Table, four-layer instrument specs for all six stations plus two new ones (CREW, COMMERCE), the `.k8skin` skins system with five named example skins, the holographic crew system with the flagship Crew Briefing roll-call, the data-reactive Three.js living universe, a seven-session implementation roadmap, and the printable manifesto. Every major item in the kre8r / OrgΩr / KinOS data inventory is mapped to a place on the bridge, with special attention to currently-unsurfaced data (crypto net-worth, receivables as inbound vessels, AI token spend as fuel burn, affiliate commissions, community event feed, cellar status, price trends).