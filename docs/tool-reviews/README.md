# Kre8Ωr — Tool Review Archive

Opus-level architectural reviews of each tool in the pipeline.
Each file = one tool, four dimensions: bugs · improvements · inter-tool · simplification.

When all Tier 1 reviews are complete, run the grand synthesis workflow
to produce the full-system assessment.

60 route files. 36 creator-facing tools. This is the map.

---

## Tier 1 — Core Pipeline (touch every video)

| Tool | Route File | Review | Status |
|------|-----------|--------|--------|
| SeedΩr | src/routes/ideas.js | seedr-review.md | ✅ Complete |
| Id8Ωr | src/routes/id8r.js | id8r-review.md | ✅ Complete |
| WritΩr | src/writr/ + src/routes/writr.js | writr-review.md | ✅ Complete |
| VaultΩr | src/routes/vault.js + src/vault/ | vaultr-review.md | ✅ Complete |
| AssemblΩr | src/editor/assemblr.js + src/routes/analytr.js | assemblr-review.md | ✅ Complete |
| PostΩr | src/postor/ + src/routes/postor.js | postor-review.md | ⏳ Queued |

## Tier 2 — Pre-Production

| Tool | Route File | Review | Status |
|------|-----------|--------|--------|
| LabΩr | src/routes/lab.js | labr-review.md | ✅ Complete |
| PipΩr | src/routes/pipr.js | pipr-review.md | ✅ Complete |
| ShootDay | src/routes/shootday.js | shootday-review.md | ✅ Complete |
| TeleprΩmpter | src/routes/teleprompter.js | teleprompter-review.md | ✅ Complete |
| DirectΩr | src/routes/editor.js | directorr-review.md | ✅ Complete |

## Tier 3 — Post-Production

| Tool | Route File | Review | Status |
|------|-----------|--------|--------|
| EditΩr Room | src/routes/editr-room.js | editr-room-review.md | ⏳ Backlog |
| BrollΩr | src/routes/brollr.js | brollr-review.md | ⏳ Backlog |
| AnimΩr | src/routes/animr.js | animr-review.md | ⏳ Backlog |
| ClipsΩr | src/routes/clipsr.js | clipsr-review.md | ⏳ Backlog |
| ComposΩr | src/routes/composor.js | composor-review.md | ⏳ Backlog |
| CutΩr | src/routes/cutor.js | cutor-review.md | ⏳ Backlog |

## Tier 4 — Distribution

| Tool | Route File | Review | Status |
|------|-----------|--------|--------|
| GateΩr | (in projects.js) | gater-review.md | ⏳ Backlog |
| PackageΩr | (in projects.js) | packager-review.md | ⏳ Backlog |
| CaptionΩr | (in postor.js) | captionr-review.md | ⏳ Backlog |
| MailΩr | src/routes/mailor.js + blog.js | mailor-review.md | ⏳ Backlog |
| PostΩr | src/routes/postor.js | postor-review.md | ⏳ Queued (Tier 1) |

## Tier 5 — Analytics & Strategy

| Tool | Route File | Review | Status |
|------|-----------|--------|--------|
| MirrΩr | src/routes/mirrr.js | mirrr-review.md | ⏳ Backlog |
| NorthΩr | src/routes/northr.js | northr-review.md | ⏳ Backlog |
| VectΩr | src/routes/vectr.js | vectr-review.md | ⏳ Backlog |
| Post-Mortem | src/routes/postmortem.js | postmortem-review.md | ⏳ Backlog |
| StudioΩr | src/routes/studio-intel.js | studior-review.md | ⏳ Backlog |
| VisualΩr | src/routes/visualr.js | visualr-review.md | ⏳ Backlog |
| AnalytrΩr | src/routes/analyticr.js | analyticr-review.md | ⏳ Backlog |

## Tier 6 — Infrastructure & Audience

| Tool | Route File | Review | Status |
|------|-----------|--------|--------|
| AudiencΩr | src/routes/community.js | audiencer-review.md | ⏳ Backlog |
| MarkΩr | src/routes/markr.js | markr-review.md | ⏳ Backlog |
| GuardΩr | src/routes/guard.js | guardr-review.md | ⏳ Backlog |
| CleanΩr | src/routes/cleanr.js | cleanr-review.md | ⏳ Backlog |
| AffiliateΩr | src/routes/affiliator.js | affiliator-review.md | ⏳ Backlog |
| SoulBuildrΩr | src/routes/soul-buildr.js | soulbuildr-review.md | ⏳ Backlog |
| Mission Control | src/routes/mission.js | mission-review.md | ⏳ Backlog |
| SyncΩr | src/routes/sync.js | syncr-review.md | ⏳ Backlog |
| SequenceBuildr | src/routes/sequence-builder.js | sequence-buildr-review.md | ⏳ Backlog |

---

## Grand Synthesis
Once Tier 1 is complete, run the grand synthesis workflow.
Full system: 36 tools, 60 route files, one Opus assessment.
Output: docs/tool-reviews/grand-synthesis.md
