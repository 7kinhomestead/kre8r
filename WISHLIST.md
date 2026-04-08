# Kre8Ωr Wish List
Features to build when the core system is solid.

---

## 🔍 PRIME DIRECTIVE AUDIT — Full Pipeline Flow-Break Analysis

*The Prime Directive: Never lose creative state. Never break the creative thread without a recovery path.*

*The audit question for every tool: "At what moment does the creator stop thinking about their story and start thinking about the tool?" Those are the breaks. This document maps every one of them.*

---

### PRE-PRODUCTION

#### Id8Ωr
**Flow break: The research conversation disappears at handoff.**
The Id8Ωr conversation is where the creative direction is established — why this angle, what emotional truth the story is chasing, what got rejected and why. When it hands off to PipΩr, the brief data goes but the *reasoning* doesn't. Six hours later in WritΩr, the creator has no way to re-read that thinking. The chosen concept is saved but the dialogue that got there is gone.
- **Fix**: Save the full Id8Ωr chat HTML to the project DB at handoff (partially done in rescue-session). Surface it as a readable "origin story" panel in WritΩr and PipΩr — "here's how this project started."
- **Fix**: Id8Ωr Room — a persistent creative director chat in Id8Ωr itself, before the concept is locked.

**Flow break: Research phase has no checkpoints.**
If the 3-phase research run dies at phase 2, you restart from zero. Already in WISHLIST under Phase Checkpoints — flagging here as a Prime Directive violation.

---

#### PipΩr
**Flow break: No thinking partner for structure decisions.**
Beat map design is one of the hardest creative decisions — which story structure, how many beats, what each one needs to do. Right now you do it alone against a dropdown. If the structure feels wrong, there's no way to think it through with context. No Room equivalent.
- **Fix**: PipΩr's Room — context-aware chat during beat map design. "Why does this story need a Dark Night of the Soul? What's the actual obstacle?" Knows the Id8Ωr brief and the creator profile.

**Flow break: No going back to fix beats once WritΩr has run.**
If WritΩr generates a script and the beat map turns out to be wrong, going back to PipΩr to fix it and re-running WritΩr feels like destroying work. The creator hesitates — do I break the script or live with the wrong structure?
- **Fix**: Beat edit mode that preserves the existing script draft as a reference while the new beat map is being designed. Don't delete — fork.

---

#### WritΩr
**Flow break: No way to search the footage vault from inside WritΩr.**
While writing, the creator thinks: "I need B-roll of the solar panel install for this beat." To find out if that clip exists, they have to leave WritΩr, go to VaultΩr, search manually, note the clip ID, come back. Full context break.
- **Fix**: Vault search panel embedded in WritΩr's Room or as a dedicated side panel. "Do I have footage of X?" answered without leaving the page.

**Flow break: The Room can plan B-roll shots but can't see what footage already exists.**
WritΩr's Room is great for discussing what shots would serve a beat. But it has no access to the VaultΩr — it can't say "you already have a clip of this from March, clip ID 47." The creative director is half-blind.
- **Fix**: When the Room is open in WritΩr, include a summary of relevant vault clips in the context. Let the creator describe what they need and surface matching clips.

**Flow break: Script approval locks revision without warning.**
Addressed in this session — Room's "Use as Revision Prompt" now unlocks approved scripts. But the UX of the lock itself is confusing: there's no indication WHY the revision field is gone.
- **Fix** (done): Unlock via Room. Future: add a subtle "locked — click to unlock" affordance directly on the revision bar so the path is obvious without the Room.

---

### PRODUCTION

#### The BRAW → Proxy → VaultΩr Pipeline
*This is the biggest un-addressed section of the system. The middle of the workflow.*

**Flow break: The BRAW proxy chain is opaque and fragile.**
The creator shoots on Blackmagic, exports proxies from DaVinci, drops them in D:\kre8r\intake. VaultΩr's watcher picks them up. This chain has no status visibility — the creator doesn't know if the watcher is running, if a file failed to process, or if the proxy linked correctly to the BRAW record. A silent failure means footage disappears from the pipeline with no alert.
- **Fix**: VaultΩr intake status panel — live view of watcher state, files in queue, recent successes/failures. Green if healthy, red if anything is stuck.
- **Fix**: Slack/toast notification when an intake file fails processing (not just a server log).

**Flow break: 30-minute proxy timeout is too short for large BRAW files.**
Large BRAW files take longer than 30 minutes to proxy in DaVinci. The job silently times out. The creator doesn't know until they go to EditΩr and find the clip has no proxy.
- **Fix**: Configurable timeout per job, with a progress indicator. Minimum 90 minutes for large files.

**Flow break: No shot coverage awareness during or after a shoot day.**
After a shoot, there's no way to see "did I get everything the beat map needed?" The creator has to mentally cross-reference VaultΩr's clips against PipΩr's beat map. CoverageΩr is planned but not built.
- **Fix**: Build CoverageΩr. Beat-by-beat view: what shots were planned, what clips are in the vault that match, what's still missing. Shows up as a review step between ShootDay and EditΩr.

**Flow break: DaVinci is a black box.**
The DaVinci integration only works when Resolve is running, on Windows, with the right Python path, on port 9237. If any of those conditions fail, the error is buried in a server log. The creator gets a generic failure and has no idea why.
- **Fix**: DaVinci health check endpoint — surface the Python path, Resolve running state, and port availability in a status indicator before any DaVinci operation is attempted.
- **Fix**: If DaVinci isn't running when a DaVinci operation is triggered, show a specific, actionable message: "Open DaVinci Resolve and try again" — not a generic error.

---

### POST-PRODUCTION

#### VaultΩr
**Flow break: No semantic search.**
The creator can browse clips by type (talking-head, b-roll, action) but cannot search by what's IN the clip — subject, topic, what's being said. Finding a specific moment requires scrubbing through clips manually.
- **Fix**: Subject/topic tagging at ingest using the transcript + Claude Vision. Build it as a background job that runs after transcription completes. Index: who's in it, what's happening, key phrases said, location, objects visible.
- **Fix**: Natural language search: "find clips where I talk about the water system" → surfaces matching clips with timestamps.

**Flow break: No way to see vault footage from inside other tools.**
Already called out in WritΩr section. Applies everywhere downstream — EditΩr, WritΩr, ComposΩr. The vault is an island.
- **Fix**: Vault as a shared context panel, embeddable in any tool. Not a new page — a slide-in panel like the Room.

**Flow break: Transcription requires proxy path to be set first.**
If the proxy hasn't been linked yet, transcription can't run. The creator has to manually set the proxy path, then come back and run transcription. Two steps that feel like one, with no explanation of why step one is required.
- **Fix**: Auto-detect proxy via the _proxy.mp4 naming convention on intake. If not found, surface a clear "link proxy first" affordance with instructions — not a silent failure.

---

#### EditΩr (SelectsΩr)
**Flow break: No Room equivalent — no thinking partner during the edit.**
This is the most significant gap in the middle of the workflow. The creator is in EditΩr trying to match clips to beats. A beat has no good talking-head coverage. They need to decide: rewrite the beat, use B-roll only, or shoot again. That's a creative-director-level decision. Right now they make it alone, or they stop, open Claude chat, paste context, and lose their edit state.
- **Fix**: EditΩr's Room — context-aware chat that knows the current beat map, which beats have coverage, which don't, and can search the vault for alternative clips. "Beat 3 has no talking head — here are 4 B-roll clips that could carry it. Want to rewrite the beat to work around it, or flag it for a reshoot?"

**Flow break: Going from EditΩr back to WritΩr breaks the edit state.**
If a beat needs to be rewritten mid-edit, the creator leaves EditΩr. Their clip selections are saved in the DB but the mental state — which clips felt right for which beats, what they were building toward — isn't. They come back and have to reconstruct the context.
- **Fix**: EditΩr's Room should be able to trigger a script revision in-place, keeping EditΩr open. The revised beat refreshes in the beat map without a page change.

**Flow break: Shot type misclassification silently breaks the selection engine.**
If a clip is classified as the wrong shot type (talking-head vs. b-roll vs. action), the selection engine routes it incorrectly. The creator doesn't see an error — they just get a surprising result or a beat that doesn't get covered.
- **Fix**: Shot type override UI on each clip in EditΩr. Let the creator correct a misclassification directly, re-run the selection for that beat only.

**Flow break: No feedback when a beat can't be covered.**
If a beat has no usable footage, SelectsΩr either skips it silently or uses something wrong. The creator doesn't know until they watch the rough cut.
- **Fix**: Beat coverage report before running the full selects pass. "3 beats have no matching footage. Here's what's missing. Proceed anyway?"

---

#### ReviewΩr
**Flow break: Approval doesn't connect to DaVinci.**
ReviewΩr shows a rough cut approval UI, but approving in Kre8Ωr doesn't actually do anything in DaVinci. The creator still has to manually export from DaVinci, find the right timeline, and export to the right spec. The approval is administrative, not operative.
- **Fix**: ReviewΩr approval triggers a DaVinci export job — opens the right timeline in Resolve and queues the render at the approved spec. The creator approves in Kre8Ωr; the export happens automatically.

**Flow break: No notes or revision requests from ReviewΩr back to WritΩr or EditΩr.**
If Cari watches the rough cut and has notes, there's no formal path for those notes to go back into the pipeline. They're texted, spoken, or written on paper.
- **Fix**: ReviewΩr notes field → creates a revision task that appears in WritΩr (for script changes) or EditΩr (for cut changes) with the note attached to the relevant beat.

---

#### ComposΩr
**Flow break: Music prompts don't connect to actual music in the timeline.**
ComposΩr generates Suno prompts based on scene analysis. That's useful, but the output is a prompt — the creator still has to go to Suno, generate music, download it, and manually drop it into DaVinci. The creative thread breaks completely at this handoff.
- **Fix**: Suno integration that goes all the way — generate, download, and inject the audio file directly into the DaVinci timeline at the right timecode.
- **Interim fix**: At minimum, save the generated audio file to the project vault automatically so it's one click to drag into DaVinci.

---

### DISTRIBUTION

*Distribution tools are the most complete section of the system. Fewer Prime Directive violations here. Known issues:*

**Flow break: Kajabi broadcasts require copy/paste.**
The Kajabi API has no broadcast endpoint. Creating a broadcast from MailΩr requires copying the generated content and pasting it into Kajabi manually.
- **Fix**: Playwright automation for Kajabi broadcast creation. Already planned.

**Flow break: AudiencΩr tag filter 500s.**
Filtering contacts by tag in AudiencΩr fails with a Kajabi 500. The creator can't segment their audience without leaving Kre8Ωr.
- **Fix**: Already in known issues. Investigate Kajabi tag filter API behavior — may need to filter client-side from the full contact list.

---

### CROSS-CUTTING GAPS

**The pipeline only goes forward.**
The tools are designed as a one-way pipeline: Id8Ωr → PipΩr → WritΩr → DirectΩr → ShootDay → EditΩr → Distribution. Real creative work goes backwards constantly. A beat map gets revisited after the script reveals a structural problem. A script gets revised after the edit reveals a coverage gap. A concept gets reconsidered after the research shows a better angle.
- **Fix**: Every tool needs a visible, non-destructive path back to the previous stage. Not a hard reset — a "revisit" mode that preserves the current state while the previous stage is reconsidered.

**No project-level "where am I" recovery.**
Coming back to a project after a break means piecing together where you were from the pipeline status dots on the dashboard. There's no "resume from here" affordance that opens the right tool in the right state.
- **Fix**: Project resume button on the dashboard. Reads the pipeline state, opens the correct tool, restores the last known UI state for that tool.

**The Room concept should propagate to every tool.**
WritΩr's Room proved the model: context-aware creative director chat that can take action. The same concept — full project context, thinking partner, actionable output — should exist in Id8Ωr, PipΩr, EditΩr, and ReviewΩr. Each tool's Room knows what that tool knows and can do what that tool can do.

---

## 🧭 NorthΩr — The Creative Strategy Engine ⬅ TOP PRIORITY
*'The ship stays off the rocks, so long as someone yells.'*

**What it is:**
The tool that ties the entire Kre8Ωr suite together into a coherent content business strategy. Not a creative tool — a strategic compass. It reads all the data, sets the course, and yells when you're heading for the rocks.

**Inputs (reads from every tool):**
- **MirrΩr:** channel performance data, audience profile, content DNA, coaching insights, what's working/not working
- **Show/Episodic system:** Rock Rich season arc, episode schedule, what's been made, what's planned
- **Pipeline:** projects in progress, completed, stalled
- **MailΩr/AutomatΩr:** broadcast history, open rates, what emails went out
- **AudiencΩr:** community growth, tier distribution, conversion rates
- **Creator soul:** content angles, publishing cadence, platform handles
- **Calendar:** publish dates, gaps, consistency score

**The Strategy Output — a monthly content plan:**
```
APRIL 2026 — YOUR CONTENT STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT TO MAKE THIS MONTH:
• 3 Rock Rich episodes (episodic arc — Season 1)
• 4 Financial Rebellion videos (your highest performing cluster)
• 2 Permission Structure videos (converts to Rock Rich signups)
• 2 YouTube Shorts (repurposed from long form)

WHAT TO SEND:
• 9 email broadcasts (one per long-form video)
• 36 social captions across platforms
• 3 Rock Rich community posts

WHY THIS MIX:
• Financial Rebellion averages 38k views (4.5x your average)
• Rock Rich episodes drive 82% of community signups
• You haven't posted in the Permission Structure lane in 6 weeks
  — your audience is asking for it in comments

YOUR PUBLISHING SCHEDULE:
Week 1: Rock Rich Ep 4 (Mon) + Financial Rebellion (Thu)
Week 2: Permission Structure (Mon) + Rock Rich Ep 5 (Thu)
Week 3: Financial Rebellion (Mon) + Financial Rebellion (Thu)
Week 4: Rock Rich Ep 6 (Mon) + Permission Structure (Thu)
```

**The Yelling Function (alerts):**
NorthΩr watches the pipeline and fires alerts when:
- 'You haven't published in 9 days — your algorithm momentum is dropping'
- 'Rock Rich Episode 4 has been in WritΩr for 3 weeks — what's the blocker?'
- 'Your Financial Rebellion cluster is running dry — only 1 video in the pipeline'
- 'You promised 3 Rock Rich episodes this month — you've made 1 with 8 days left'
- 'Your email list hasn't heard from you in 2 weeks — open rates will drop'
- 'Your best performing content angle (Permission Structure) has zero videos in pipeline'

**The Course Correction:**
When NorthΩr yells — one click → Id8Ωr opens with the right brief pre-loaded:
*'You need a Financial Rebellion video. Here are 3 concepts based on your current audience data →'*

**The Rock Rich Specific Use Case:**
Jason has a show (Rock Rich) with a season arc. NorthΩr knows:
- The season arc (12 episodes planned)
- What's been made (4 episodes)
- The episodic context (what's been established, what needs to happen next)
- The audience transformation progress (where viewers are in the journey)
- The Rock Rich community growth rate
- Which episodes drove the most signups

It then tells Jason:
*'Episode 5 should address the spouse objection — your comments show 31 people asked about getting their partner on board this month. This is the episode that converts fence-sitters into Greenhouse members.'*

**The Creator Accountability Layer:**
At the start of each month — NorthΩr runs a planning session:
- 'Last month you planned 9 videos. You made 6. Here's what didn't happen and why it matters.'
- 'This month, given your current pipeline and energy, I recommend 7 videos. Here's the plan.'

The creator sets their own goals. NorthΩr holds them to it. Not a boss. A navigator.

**The Commercial Angle:**
Every serious business has a strategy layer. Every serious creator is running a business. No tool exists that does this specifically for creators. NorthΩr is the feature that justifies the price point. A creator without NorthΩr is sailing without a compass.

**Technical Architecture:**
- `public/northr.html` — Strategy dashboard
- `src/routes/northr.js` — Strategy engine
- Reads from: MirrΩr API, projects DB, shows DB, posts/analytics tables, emails table
- Monthly strategy generation via Claude (SSE)
- Alert system: PM2 cron checks daily, fires alerts if thresholds crossed
- Alert delivery: in-app notification badge on nav + optional email
- One-click → Id8Ωr with pre-loaded brief for the recommended content

**Nav placement:** Top of nav — above Pre/Prod/Post/Dist. Not a phase tool — a compass for all phases. Icon: 🧭 Tagline: *'Your creative compass. It yells when you need it.'*

**Build order:**
1. Basic strategy dashboard (reads existing data, generates monthly plan)
2. Alert system (daily checks, threshold alerts)
3. Episodic integration (Rock Rich season awareness)
4. One-click → Id8Ωr brief
5. Monthly accountability report
6. Goal setting and tracking

---

## ShootDay — AI Shot Verification
Real-time shot list verification using Claude Vision during filming.

How it works:
- ShootDay shows the shot list on phone/tablet
- After each take, tap "Analyze Last Take"
- Kre8Ωr grabs the most recently modified file from a watched camera output folder
- Claude Vision analyzes a thumbnail and compares against the shot list requirements
- Returns: "✓ Wide establishing shot confirmed" or "⚠️ Looks like a medium — shot list needs a wide, retake?"
- Shot automatically checks off when verified
- End of shoot day = fully verified coverage report generated automatically

Integration notes:
- Works alongside Blackmagic Camera Control app
- Blackmagic handles camera control
- ShootDay handles shot verification
- Two apps, clear separation of responsibilities
- Builds on existing VaultΩr Claude Vision classification pipeline
- CoverageΩr already does this post-shoot — ShootDay would do it in real time DURING shoot

Why it matters:
- No existing tool does real-time AI shot verification against a generated shot list
- Professional film sets pay thousands for dedicated hardware that does this
- Reduces missed shots, reduces reshoots, reduces post-production surprises

## AnalΩzr — Cross-Platform Intelligence Layer

### Vision
The only tool that connects a creator's full production pipeline to their cross-platform performance data and gives them AI coaching that improves over time.

### Platform APIs to integrate
- YouTube Data API v3 (free, console.cloud.google.com)
- TikTok Content API (free, apply at developers.tiktok.com)
- Meta Graph API (free, apply at developers.facebook.com)
- Lemon8 (Playwright scrape, no public API)

### Cross-Platform Intelligence Features
- Where is attention actually coming from per platform
- Which content travels across platforms vs stays local
- Best day/time by platform based on YOUR data not generic advice
- Comment theme mining across all platforms fed back to Id8Ωr
- Rock Rich conversion funnel — which videos/platforms convert to paid community
- Weekly coaching report — Sunday morning auto-generated
- Threshold alerts — engagement drops, viral spikes

### Coaching Report Output
- Platform snapshot — primary, fastest growing, needs attention
- Content intelligence — best/worst angles, sweet spot duration per platform
- Audience signals — top comment themes, viral triggers, drop-off points
- Rock Rich funnel — best converting video, platform, recommendations
- #1 focus this week — specific actionable with Id8Ωr brief ready to go
- Trending in your niche — web search fed into Id8Ωr

### Technical Architecture
- Nightly PM2 cron sync for all platforms
- Sunday morning auto coaching report generation
- `comment_themes` table for NLP processed insights
- `platform_sync_log` table
- Claude reads all platform data → identifies patterns → feeds Id8Ωr

### Commercialization Note
This cross-platform intelligence layer with AI coaching connected to the production pipeline does not exist anywhere at any price point. Closest competitors: Sprout Social ($249/mo, no AI coaching), Tubics ($49/mo, YouTube only), Metricool ($22/mo, basic). Target price: $200–500/month as part of full Kre8Ωr suite.

### Build Order
1. YouTube Data API
2. TikTok Content API
3. Meta Graph API
4. Lemon8 Playwright
5. Cross-platform pattern engine
6. Weekly coaching report automation
7. Id8Ωr feedback loop

## AnalΩzr — Content Format Discrimination

In the Content DNA constellation and coaching report, discriminate between:
- **Long form horizontal** — YouTube videos >3 min
- **Short form vertical** — TikTok, YouTube Shorts, Reels
- **Live streams** — filter these out of performance averages by default (they skew data)

### How it works
YouTube API already returns `contentDetails.duration` (ISO 8601, e.g. `PT12M34S`) — parse this at sync time to classify each video. Store `format` on the project or analytics record.

### Constellation changes
- Add format badge to each node: 📹 long form, ⚡ short form, 🔴 live
- Live stream nodes visually dimmed (reduced opacity) in the constellation
- Toggle in the DNA panel: "Include live streams" (off by default)

### Coaching report changes
- Live streams excluded from all performance averages by default
- When excluded, a note: "X live streams excluded from averages — toggle to include"
- Long form vs short form shown as separate performance bands — not averaged together

### Implementation notes
- `contentDetails.duration` must be requested in the YouTube API call (add to `part` param)
- ISO 8601 duration parser: `PT0S` = live/premiere, `PT1M` = 1 min, `PT12M34S` = 12:34
- Shorts threshold: duration ≤ 60s OR title contains `#shorts` OR vertical aspect ratio
- Live detection: `duration = 'P0D'` or `liveBroadcastContent = 'none'` with zero duration
- Store as `video_format` enum: `long_form` | `short_form` | `live`

## Nebula View — Stellar Nursery for In-Progress Projects

**V2.0 centerpiece feature.** A companion view to the Constellation that shows projects currently moving through the pipeline as forming stars. The Constellation shows where you've been. The Nebula shows what's being born.

### The core idea
Published videos live in the Constellation as solid, sized stars. In-progress projects live in the Nebula as proto-stars at various stages of formation — visible, named, moving toward ignition.

### Visual stages (pipeline → star formation)
| Pipeline stage | Visual state |
|---|---|
| Id8Ωr complete | Faint gas cloud — low opacity particle cluster, barely visible |
| PipΩr complete | Particles grouping, loose proto-star shape forming |
| WritΩr approved | Glowing core visible, heat building |
| Footage shot (VaultΩr has clips) | Star taking shape, corona visible, gravitational pull |
| Published | Ignition — star leaves Nebula and joins the main Constellation |

### Per-project display
- Current pipeline stage label
- 5-segment progress ring (Id8Ωr / PipΩr / WritΩr / VaultΩr / Published)
- Estimated completion based on typical pipeline time per stage
- Click → opens the project at its current pipeline stage (deep link)

### View toggle
- Single D3 canvas. Toggle button: `✦ Constellation` / `☁ Nebula`
- Animated transition between views — published stars pull back and dim, in-progress clouds emerge, or vice versa
- Both views use the same zoom/pan infrastructure already built

### New user onboarding
- New installations start in Nebula View with an empty canvas
- Message in the center: *"Your creative universe starts here. Begin your first idea in Id8Ωr."*
- First completed Id8Ωr session creates the first gas cloud — the creator's digital brain is born
- This is the moment the system becomes theirs, not a tool they're using

### Why this matters (the meat puppet answer)
This feature permanently answers the question of whether the AI is doing the creative work. Watching YOUR ideas — with YOUR titles, YOUR structure, YOUR voice — form into YOUR stars in a space that belongs only to you makes the answer visceral, not intellectual. The creativity is yours. Kre8Ωr just gives it a home and a map.

### Implementation notes
- Pipeline stage read from `pipeline_state` table (already exists — `gate_a_approved`, beat map complete, script approved, footage in vault)
- Particle system: D3 + canvas overlay or pure SVG `<circle>` elements with low opacity + CSS animation
- Transition: `d3.transition()` with custom interpolators per node type
- Proto-star physics: same forceSimulation as Constellation, but with higher alpha decay and smaller charge so clouds stay loose
- Published event triggers migration animation: proto-star accelerates toward its Constellation position, opacity rises, size settles to view-count-based radius
- Progress ring: SVG `stroke-dasharray` / `stroke-dashoffset` on 5 arc segments, one per pipeline component

## V2.0 — Content Universe 3D Sphere (Three.js)

Replace the 2D D3 constellation with an optional 3D sphere view using Three.js.

### Visual rules
- Videos plotted on surface of a sphere using spherical coordinates
- Altitude above surface = performance above channel average (view count / avg)
- Altitude below surface = underperformers, Shorts, live streams
- Clusters grouped by longitude bands
- Node size = view count
- Node color = cluster color

### Rotation behavior
- Sphere slowly auto-rotates
- Rotation direction biased toward highest-opportunity cluster (high views + low upload frequency)
- Subtly suggests "this is where your attention should go" without explicit instruction
- User can grab and rotate manually — sphere resumes auto-rotation after 3 seconds

### Camera behavior
- Default: full sphere view
- Click cluster label: camera flies to that cluster face
- Click individual node: camera zooms to video, shows stats card
- Double click: fly back to full sphere

### Toggle
- Toggle between 2D constellation and 3D sphere with animated transition
- The sphere IS the digital brain. The rotation IS the recommendation engine.

### Implementation notes
- Built with Three.js r128 (already available in artifact library)
- `THREE.SphereGeometry` for the base sphere (transparent, wireframe or faint)
- `THREE.Points` or instanced meshes for video nodes
- `THREE.OrbitControls` for manual rotation — `autoRotate` flag with 3s resume timer
- Spherical coordinates: `θ` = longitude (cluster band), `φ` = latitude (content type), `r` = base radius + performance altitude offset
- Performance altitude: `(views / channelAvg - 1) * altitudeScale` — clamped to ±altitudeMax
- Camera fly-to: `TWEEN.js` animating `camera.position` + `controls.target` to cluster centroid
- Node click detection: `THREE.Raycaster` on canvas mouseclick
- Stats card: HTML overlay positioned via `camera.project()` → CSS `left/top`
- Shorts/live: plotted at `r - altitudeMax` (below surface), hidden by default (same toggle logic as 2D)
- Cluster longitude bands: evenly divide 2π by cluster count, assign each cluster a `θ` band center
- All node data pulled from existing `channel_dna_clusters` kv_store — no new API needed

## V2.0 — Stellar Classification System for Content Universe Sphere

Replace cluster-color node coloring with astrophysics-accurate stellar classification based on composite video performance score. Color is **performance**, not cluster identity.

### Performance → Kelvin Formula

```js
const stellarScore = (
  (views / channelAvg)              * 0.4 +
  (engagementRate / avgEngagement)  * 0.3 +
  (velocityScore / avgVelocity)     * 0.2 +
  (viralCoefficient / avgViral)     * 0.1
) * 2500; // maps to 0–10,000K range
```

### Spectral Classes

| Class | Color | Kelvin | Meaning |
|-------|-------|--------|---------|
| O | Blue Supergiant | 8000K+ | Viral outlier — 10x+ channel average |
| B | Blue-White Giant | 6000K+ | Major hit — 5–10x average |
| A | White Star | 5000K+ | Strong performer — 2–5x average |
| F | Yellow-White | 4000K+ | Above average — 1–2x |
| G | Yellow / Sun | 3000K+ | At channel average |
| K | Orange | 2000K+ | Below average |
| M | Red Dwarf | 1000K+ | Low performer |
| Brown Dwarf | Dark Brown | 500K+ | Failed experiment — <10% of average |
| Gas Giant | Banded, semi-transparent | <500K | Live stream reposts, not real videos |

### Special Events

**Supernova** — video hits 10x average:
- Explosion particle animation at node position
- Nearby cluster nodes briefly brighten
- Shows traffic flow lines between connected videos in the `edges` graph

**Black Hole formation** — outlier so extreme it gets its own gravitational field:
- Pulls its cluster visually toward it (nearby nodes drift inward)
- Notification: "This outlier may indicate a new channel direction" with one-click Id8Ωr brief button

**New channel seed** — if the Black Hole outlier is thematically distinct from all existing clusters:
- Suggests spinning up a second channel
- One-click creates a new Id8Ωr session seeded with that video's topic

### Node appearance by spectral class

- **O / B class**: bloom glow effect, lens flare, larger corona radius
- **A / F class**: bright white-yellow star, standard corona
- **G class**: standard star appearance, warm yellow
- **M class**: smaller, dimmer, slight red tint, no corona
- **Brown Dwarf**: very small, dark brown, barely visible — radius ~2px
- **Gas Giant**: banded texture, no glow, semi-transparent — rendered as ring rather than sphere

### The core insight

Cluster identity → shown by **orbital position** (longitude band on the sphere)
Performance → shown by **stellar temperature** (color)

A creator can immediately see: *bright blue cluster = winning content territory.*
No coaching text needed — the physics shows the opportunity.

**The Homestead Income example:**
4 videos averaging 74k views = tiny cluster of blue giants.
The visual communicates instantly: tiny cluster, insanely bright.
The sphere is pointing at the gap before any analysis runs.

### Implementation notes
- `stellarScore` computed client-side from `channel_dna_clusters` node data + `channel-health` avg values
- Kelvin → RGB: standard blackbody approximation (`Mitchell Charity` formula or lookup table)
- Bloom: `THREE.UnrealBloomPass` in a `THREE.EffectComposer` pipeline — applied per-node intensity based on K value
- Supernova particle system: `THREE.Points` burst emitter, short-lived (`lifetime ~2s`), triggered on first render if node K > 8000
- Black Hole gravity: custom `alphaTarget` force applied to nearby nodes in the OrbitControls tick loop
- `viralCoefficient`: `(likes + comments * 3) / views` — proxy for share-worthy engagement
- `velocityScore`: views in first 7 days (requires `posted_at` date + total views as proxy if daily breakdown unavailable)
- All classification done at render time — no new API calls, no new DB columns needed

## Beta Feedback System

Closes the loop between beta users and the build — every piece of friction becomes a data point.

### Floating Report Button
- `⚠ Report Issue` button fixed to bottom-right on every page (injected via `nav.js`)
- Always visible, never intrusive — subtle until hovered
- Opens a modal without leaving the current page

### Feedback Modal
Three fields, no friction:
- **What were you trying to do?** — short text
- **What happened instead?** — short text
- **Severity** — radio: 🔴 Blocked / 🟡 Annoying / 🟢 Suggestion

### Auto-captured context (zero effort from user)
- Current page URL
- `project_id` from URL params or current session
- Browser + OS string
- Last 5 API calls (captured via a global fetch interceptor in nav.js)
- Last 10 console errors (captured via `window.onerror` + `console.error` override in nav.js)
- Timestamp

### GitHub Issues Integration
- Posts directly to GitHub Issues API with full JSON context attached as a code block
- Labels auto-applied: `beta`, `bug` (severity 🔴), `ux` (severity 🟡), `feature-request` (severity 🟢)
- Title generated from: `[PAGE] What they tried to do`
- Token stored in `.env` as `GITHUB_TOKEN` — route proxies the call server-side so token never hits the browser

### Optional Screenshot
- "Include screenshot" checkbox in modal
- Uses `html2canvas` to capture the current viewport
- Attached to the GitHub issue as a base64 image in the body

### NPS Prompt
- Shown after a completed pipeline run (WritΩr script approved → transitions to DirectΩr)
- Single question: "How likely are you to recommend Kre8Ωr to another creator?" (0–10 slider)
- Optional: "What's the one thing that would make this a 10?"
- Stored in `feedback` table, shown in admin dashboard

### `/admin.html` Beta Dashboard
Four panels:
- **Active Users** — unique session IDs in the last 7/30 days, pipeline entry points
- **Pipeline Completion Rates** — funnel visualization: Id8Ωr → PipΩr → WritΩr → DirectΩr → VaultΩr → Distribution. Drop-off rates between each stage.
- **Open Issues** — live feed from GitHub Issues API, filtered by beta label. Click to open in GitHub.
- **Satisfaction Scores** — NPS score over time (rolling 7/30 day), verbatim responses, trend line

### Pipeline Completion Rate Tracking
- New `pipeline_handoffs` table: `project_id`, `from_tool`, `to_tool`, `user_session`, `created_at`
- Log entry on every tool handoff (e.g. PipΩr create → WritΩr open, WritΩr approve → DirectΩr open)
- Handoff logged via a lightweight `POST /api/analytics/handoff` endpoint called from each tool's transition point
- Admin dashboard queries this table to compute per-stage conversion rates

### Implementation notes
- `nav.js` already loads on every page — ideal injection point for fetch interceptor, error capture, and floating button
- `html2canvas` loaded lazily only when screenshot checkbox is checked
- `GITHUB_TOKEN` scoped to `issues:write` only on the private repo — no broader permissions needed
- NPS trigger: check `localStorage.lastNpsShown` — show max once per 7 days, only after pipeline completion
- Admin dashboard protected by same basic auth as `kre8r.app` (nginx level) — no new auth layer needed

## ⚡ HIGH PRIORITY — Electron AppData DB Auto-Backup

In `electron/main.js`, after the server ready poll resolves, set a 5-minute interval that copies the live AppData DB to the project folder. Survives power outages and AppData corruption.

```js
setInterval(() => {
  try {
    fs.copyFileSync(
      path.join(app.getPath('userData'), 'kre8r.db'),
      path.join(__dirname, '../database/kre8r-electron-backup.db')
    );
  } catch (err) {
    console.warn('[Electron] DB backup failed:', err.message);
  }
}, 300_000); // every 5 minutes
```

Add `database/kre8r-electron-backup.db` to `.gitignore` and the electron-builder `files` exclusion list.

Why it matters: the AppData DB is the single source of truth in Electron mode. A power outage or filesystem corruption with no backup = total data loss for the user. This is a one-liner that eliminates that risk.

## Session Auto-Save + Crash Recovery

### Auto-Save
Every active SSE session (Id8Ωr conversations, WritΩr generation in progress) auto-saves its current state to the DB every 60 seconds. This means a crash, power loss, or accidental close doesn't wipe in-progress work.

What gets saved:
- **Id8Ωr** — full conversation history, mode, current phase (brainstorm / research / package), any partial research results
- **WritΩr** — script in progress, selected beat map, voice blend setting, any partial Claude output

How it works:
- Each SSE session has a `session_id` (already generated for Id8Ωr)
- A `session_autosave` table stores: `session_id`, `tool`, `state_json`, `updated_at`
- Client sends `POST /api/session/autosave` every 60 seconds with serialized state
- Server upserts into `session_autosave` — one row per session, always the latest

### Crash Detection + Recovery
On app load, each tool checks for an unclean shutdown:
- An "active" session flag is set when a tool starts generating, cleared on clean completion or navigation away
- If the flag is set on load (app was killed mid-session), the tool queries for the last autosave
- A recovery banner appears: *"Looks like something went wrong last time. Restore your last session?"*
- User can restore (loads `state_json` back into the UI) or dismiss (clears the autosave row)

### Implementation notes
- `session_autosave` table: `session_id TEXT PK`, `tool TEXT`, `project_id INT`, `state_json TEXT`, `updated_at INT`
- `localStorage.activeSession` = `{tool, session_id}` — set on start, cleared on finish
- On load: if `localStorage.activeSession` exists, fetch `/api/session/autosave/:session_id` — if row exists, show recovery banner
- Clean completion / navigation away: `DELETE FROM session_autosave WHERE session_id = ?` + clear localStorage flag
- 60s client timer: `setInterval(() => saveState(), 60_000)` — only runs while SSE is open

### Why it matters
A 45-minute Id8Ωr research session or a long WritΩr generation run represents real time invested. One crash erasing that is a trust-destroying experience for beta users. Auto-save + recovery is table stakes for any tool that runs long AI operations.

## ⚡ HIGH PRIORITY — Claude API Retry / Resilience at Every Call Site

**Problem:** When a Claude API call fails (529 overloaded, network blip, timeout), most tools just freeze or surface a generic error. The user has to restart the entire step — which regenerates from scratch and produces *different* output than what was building toward. This destroys creative continuity. A half-built script idea, a research phase mid-flight, a selects pass that was almost done — all gone, replaced with something that diverges from the creative direction already established.

**What's needed:** A shared retry wrapper built into `src/utils/claude.js` that:
- Retries on 529 (overloaded) and 429 (rate limit) with exponential backoff — delays: [2s, 4s, 8s, 16s], max 4 attempts
- Retries on network errors (ECONNRESET, ETIMEDOUT) up to 3 attempts
- Does NOT retry on 400 (bad request) or 401 (auth) — those are real errors, fail immediately
- Logs each retry attempt so the user sees "Claude is busy, retrying in Xs…" instead of silence
- SSE endpoints emit `{ type: 'retry', attempt: N, delay_ms: X, message: 'Claude is busy — retrying in Xs…' }` so the UI shows a non-scary status instead of going dead

**Affected call sites (non-exhaustive):**
- `src/routes/id8r.js` — concept generation, research phases, package generation (partial retry exists on /start only)
- `src/routes/generate.js` — script, captions, email generation
- `src/routes/mirrr.js` — DNA clustering, niche analysis, Secrets discovery, coaching report
- `src/routes/analytr.js` — coaching report, thumbnail A/B
- `src/routes/shows.js` — episode analysis (YouTube comments + insights)
- `src/routes/northr.js` — monthly strategy generation
- `src/editor/selects-new.js` — SelectsΩr clip classification and selection decisions
- `src/vault/intake.js` — footage tagging at ingest
- `src/vault/cutor.js` — CutΩr scene analysis

**Why this is HIGH PRIORITY:** Every Claude call in this system is a creative step, not a data fetch. A failed API call doesn't just cause inconvenience — it breaks the thread of creative momentum. The user was building toward something specific. A retry preserves that. A hard fail destroys it.

---

## ⚡ HIGH PRIORITY — Within-Tool Phase Checkpoints (Save & Spawn Points)

**The problem:**
Right now save points only exist *between* tools — Id8Ωr hands off to PipΩr, PipΩr to WritΩr, etc. But within a tool, intermediate steps live only in sessionStorage and in-memory server sessions. If anything fails mid-tool (API credits, crash, accidental close), the user loses everything back to the start of that tool — not the start of the last *step*.

This is a Prime Directive violation. Forcing a creator to redo 2 hours of emotional creative work because the save point was at the wrong granularity is exactly the kind of decision the system should be eliminating.

**The principle:**
Every time a user completes a meaningful step inside a tool, that state is persisted to the DB immediately. Phase completion = checkpoint. If something fails, the tool reopens to the last completed checkpoint, not the blank start state.

**Id8Ωr checkpoints (example):**
- ✅ Concept entered / conversation complete → save `chosen_concept` to DB
- ✅ Research Phase 1 complete → save partial research to DB
- ✅ Research Phase 2 complete → save to DB
- ✅ Research Phase 3 complete → save to DB
- ✅ Package generated (titles, thumbnails, hooks) → save `packageData` to DB
- ✅ User picks titles/thumbnails/hooks → save selections to DB

**WritΩr checkpoints:**
- Beat map loaded / structure confirmed → save
- Voice profile selected → save
- Each script section generated → save incrementally

**How it works:**
- Each tool queries its project's DB record on load — if a checkpoint exists, offer to resume from it
- "Resume from last checkpoint" banner: *"You were halfway through research. Pick up where you left off?"*
- SSE streams write partial results to DB as each phase completes, not just at the end
- Checkpoint data stored in the existing `id8r_data`, `writr_data`, etc. JSON columns — no new tables needed

**Related:** See "Session Auto-Save + Crash Recovery" above for the 60s autosave approach. Phase checkpoints are the complement — structured saves at meaningful boundaries, not just time-based saves of in-flight state. Both are needed.

**Why it matters:**
A creator doing emotional, story-driven ideation work is building toward a specific creative direction. When that work is lost, you don't just lose time — you lose the *thread*. They either redo it and get something different, or they give up. Either outcome is a product failure.

---

## WritΩr's RoΩm — Creative Director Chat (V2 Vision)

**What it is:**
A full redesign of WritΩr where the script emerges from conversation rather than structured generation. You open WritΩr and land in a chat with a creative director who has read the entire brief, knows the beat map, and has the current script in front of them. The script panel on the right is the living output of the thinking. Generation, revision, and creative direction all happen through a single conversational interface. Beat cards and controls become context the AI uses — not UI you interact with directly.

**V1 (built):** Room as a slide-in side panel within the current WritΩr.
**V2 (this entry):** Room IS WritΩr. The conversation is the primary interface. The script is the output panel.

**Why this is better:**
Good scripts don't get written — they get thought into existence. The current WritΩr model (fill in structure → generate → revise) is backwards. Writers think first, write second. The Room makes thinking the primary act.

---

## AnalΩzr — Playlist Generator
From the Content DNA clusters and niche definition, suggest YouTube playlist structures that organize existing videos into intentional series.

How it works:
- Each Content DNA cluster maps to a suggested playlist name and description
- Top performers from each cluster are auto-ranked by views and pre-selected
- 'Financial Rebellion' playlist auto-populated from Financial Escape cluster top performers
- Creator reviews suggested playlists, reorders or removes videos, then approves
- One-click create playlist via YouTube Data API v3 (`playlists.insert` + `playlistItems.insert`)
- Playlist titles and descriptions written in Jason's voice using creator-profile.json

Why it matters:
- Playlists are the second-biggest driver of YouTube watch time after the algorithm
- The Content DNA graph already has the cluster data — playlist generation is just applying that structure to the YouTube interface
- Zero new analysis needed — it's a distribution layer on top of work already done
