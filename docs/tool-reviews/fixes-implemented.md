# Kre8Ωr — Fixes Implemented (Session 91)
*All fixes applied to src/ and public/ as part of the Tier 1 tool audit.*
*Context for grand synthesis review — these issues are RESOLVED.*

---

## SeedΩr (src/routes/ideas.js · src/db.js · public/seedr.html)

### CRITICAL
| ID | Fix | Files |
|----|-----|-------|
| BUG-1 | `source` column added to ideas CREATE TABLE + runMigrations + bootstrapTenantTables | db.js |
| BUG-2 | `cluster` column added to ideas CREATE TABLE + runMigrations + bootstrapTenantTables | db.js |

### HIGH
| ID | Fix | Files |
|----|-----|-------|
| BUG-3 | Status default changed `'vault'` → `'raw'`; backfill migration on server start | db.js |
| BUG-4 | Server-side dedupe on POST /api/ideas (60s window, same title); save button disabled synchronously | ideas.js · seedr.html |
| BUG-5 | integrateNewIdeas dedupes by idea_id and cluster id before merging into constellationData | seedr.html |
| BUG-6 | promote endpoint wrapped in db.transaction() — partial failure no longer orphans a project | ideas.js |

---

## Id8Ωr (src/routes/id8r.js · public/id8r.html)

### CRITICAL
| ID | Fix | Files |
|----|-----|-------|
| C3 | Checkpoint recovery banner reads `researchResults.{youtube,data,vault}` with legacy phaseN fallback | id8r.html |
| C4 | send-pipeline read-merges existing id8r_data when attaching to existing project — never overwrites with nulls | id8r.js |

### HIGH
| ID | Fix | Files |
|----|-----|-------|
| H5 | SSE watchdog: 60s stall detection + silent `done` detection both surface retry affordance | id8r.html |
| H6 | `loadVoiceCalibrationBlock()` injected into /fast-concepts and /concepts system prompts | id8r.js |
| H7 | `getActivePostMortemBrief()` injected into /fast-concepts and /concepts — avoid patterns steer concept generation | id8r.js |
| H8 | phase_result SSE events now include `sources[]` array; UI renders clickable domain list under each phase card | id8r.js · id8r.html |
| H9 | handleIdeaSeed pre-fills notes + cluster + connections; passes idea_id to /fast-concepts | id8r.html |
| H10 | /choose accepts any valid concept index (1–concepts.length), not clamped to 1–3 | id8r.js |

---

## Model Hardcoding (src/routes/*)
| Fix | Files |
|-----|-------|
| mission.js had `claude-sonnet-4-5` hardcoded (old model) — updated to `CLAUDE_MODEL || 'claude-sonnet-4-6'` | mission.js |
| markr.js had `claude-sonnet-4-6` with no env var — wrapped in `CLAUDE_MODEL ||` | markr.js |
| postmortem.js used wrong env var `VISUALR_MODEL` for Opus — corrected to `OPUS_MODEL` | postmortem.js |

---

## Mediums Fixed

### SeedΩr Mediums
| ID | Fix | Files |
|----|-----|-------|
| ST-5 | **Primary duplicate bug**: /api/ideas/bulk was parse-AND-insert; frontend then re-POSTed each idea again. Fixed: /bulk now parse-only (like /from-comments). One write path only. | ideas.js |
| BUG-7 | bulkCreateIdeas null-title crash: /bulk now normalises title before returning (trim, fallback to concept slice, skip if empty) | ideas.js |
| BUG-8 | Silent save failures surfaced: saveBulkIdeas tracks failed count, shows error toast with count if any fail | seedr.html |
| BUG-9 | saveBulkIdeas now awaits loadIdeas() after batch instead of optimistic unshift — avoids shape mismatches | seedr.html |
| BUG-10/SEEDR-09 | Constellation cache reconciled on init: ghost nodes filtered, titles refreshed from live ideas. deleteIdea + saveEdit both call invalidateConstellation() | seedr.html |
| BUG-11 | resetConstellation awaits server response; only clears local state on success; surfaces error on failure | seedr.html |
| SEEDR-04 | Hard delete replaced with soft-delete pattern: deleted_at undo toast (6s) + full soft-delete path | seedr.html · ideas.js · db.js |

### Id8Ωr Mediums
| ID | Fix | Files |
|----|-----|-------|
| M1 | callClaudeText: defensive content extraction — finds first text block, handles tool_use/empty gracefully | id8r.js |
| M2 | callClaudeJSON: balanced JSON extraction fallback before throwing — rescues truncated/prefixed responses | id8r.js |
| M3 | Phase 1 Gemini sources now merged into session.citations (deduped) alongside Phase 2 — no more lost grounding URLs | id8r.js |
| M5 | content_angle no longer written into content_type column; pb.content_type → content_type, pb.content_angle → high_concept_angles | id8r.js |
| M6 | getRecentMessages pins creator's first real user message so founding idea never falls out of rolling window | id8r.js |
| M7 | retrying SSE event now includes delay_ms + attempt so toast shows accurate backoff countdown | id8r.js |
| M9 | Package screen pre-selects AI's top pick for title/thumbnail/hook — Continue enabled immediately; override by clicking | id8r.html |
| M10 | Brief auto-saves to SeedΩr on render — passive "Auto-saved ✓" indicator; manual button still available as fallback | id8r.html |

---

## Not Yet Fixed (carry to next session)
### SeedΩr
- SEEDR-04: Soft delete ✅ implemented (deleted_at, restore endpoint, undo toast)
- SEEDR-06: Quick-add captures title only (no single-idea Claude expand)
- SEEDR-07: Cluster not surfaced in list view
- SEEDR-08: Constellation hard-capped at 20 ideas
- ST-3: idea never reaches status='produced' when project publishes
- LOWs: parseInt NaN guard, JSON regex extraction, duplicate escHtml helpers, bulk-select UI

### Id8Ωr
- M8: Research unconditional/uncached — no skip path for decided creator
- M9: Package forces three single-selects before brief can generate
- M10: Manual Save to Vault (should auto-save)
- M11: send-pipeline triple-writes same payload
- LOWs: merge no checkpoint, rescue redirect param, dead sseWait(), NaN age label, path import, concept grid mismatch

### WritΩr Fixes
| ID | Fix | Files |
|----|-----|-------|
| writr-1/H1 | finishJob(job) ReferenceError in paste-in branch — removed both calls, replaced with end() | writr.js |
| WRITR-IT-2/H2 | onApprove always resolves the full sibling (currentScripts.full) — bullets/hybrid tabs can never be approved as canonical | writr.html |
| writr-2/H3 | _parseWritrScript uses safe() wrapper for all 4 JSON.parse calls — one corrupt row never crashes all script reads | db.js |
| writr-3/H4 | room/approve: validates ≥2 beat markers before approving; extracts beat_map_json from markers; falls back to prior script's beat_map | writr.js |
| WRITR-IT-1/H7 | Post-Mortem brief injected into generate route AND buildRoomSystemPrompt — known issue #5 resolved | writr.js |
| writr-003/H8 | When explicit voice library profiles selected, calibration block suppressed (user override) — resolves triple voice-block conflict | script-first.js |
| writr-5/M1 | Vault .txt crash-recovery save moved BEFORE DB inserts — script always on disk before DB write attempted | writr.js |
| writr-6/M5 | iterate: beat_map falls back to prior beat structure when Claude returns empty; active_script_id updated to new iteration | writr.js |

### VaultΩr Fixes
| ID | Fix | Files |
|----|-----|-------|
| VAULT-001 | **Frame analysis whitelist fix** — `visual_description` and `visual_analyzed_at` added to `updateFootage` allowed list. Every frame analysis ever run was a paid no-op. Now persists. Idempotency cursor works. AssemblΩr/VisualΩr receive real data. | db.js |

## Tier 2 Fixes (Session 92)

### LabΩr
| Fix | Files |
|-----|-------|
| H1: chosenConcept.headline (was reading .title — always undefined) | lab.js |
| H2: VaultΩr footage injected into context (was never called despite claiming to) | lab.js |
| H5: hardcoded creator identity replaced with profile fields | lab.js |
| M1: trailing buffer flushed + guaranteed done event | lab.js |
| M2: abort on client disconnect — no more wasted tokens on abandoned streams | lab.js |

### ShootDay
| Fix | Files |
|-----|-------|
| SD-2/C2: take_number only increments on 'good' — skip no longer inflates count | db.js |
| SD-5/H4: POST /take guards against phantom project_id (returns 404 with stale_project flag) | shootday.js |
| M2: shot_type defaults to 'broll' not 'talking_head' | shootday.js |
| C1: pendingWrites retry queue — failed POSTs retry at top of next fetchBeats cycle | shootday.html |

### PipΩr
| Fix | Files |
|-----|-------|
| PIPR-1/C1: beat_overrides keyed by 0-based index (was 1-based beat.index — every edit landed on wrong beat) | pipr.js |
| PIPR-2: UI copy corrected — no longer claims coverage is preserved on structure change | pipr.html |
| PIPR-3: pipr_complete never regresses to 0 (coverage check no longer un-plans a finished project) | beat-tracker.js, db.js |

### TeleprΩmpter
| Fix | Files |
|-----|-------|
| TP-1/C1: display no longer resets scrollTop=0 on WiFi reconnect — no mid-take jump | teleprompter.html |
| TP-3/Known Issue #7: back button added to remote, join, and voice-device screens | teleprompter.html |

### DirectΩr/EditΩr
| Fix | Files |
|-----|-------|
| ED-1/C1: confirm() before re-running AssemblΩr when manual edits exist — no silent wipe | editor.html |

### Pipeline
- PostΩr not yet reviewed (Tier 2 continuation)
- VaultΩr dedicated session (F2 filters server-side, F4 indexes, F3 bulk ops, F17 layout) — reserved for Jason
