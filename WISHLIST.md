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

## [Future wishes go here]
