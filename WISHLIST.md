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
