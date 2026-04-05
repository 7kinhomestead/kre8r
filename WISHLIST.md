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

## [Future wishes go here]
