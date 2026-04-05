# Kre8Ωr Wish List
Features to build when the core system is solid.

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
