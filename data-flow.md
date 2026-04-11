# Kre8Ωr — Data Flow & Module Dependencies

One SQLite database (`kre8r.db`) and one soul config (`creator-profile.json`) connect every module.
This document maps what each module reads, writes, and depends on.

---

## Core Data Sources

### `kre8r.db` — the single source of truth
All pipeline state lives here. Every module reads and writes through `src/db.js`.

| Table | Purpose |
|---|---|
| `projects` | One row per video. Root of everything. `id` is the foreign key for all pipeline data. |
| `pipeline_state` | Current stage + gate approval flags (A/B/C) per project. |
| `scripts` | Outline, full script, approved version, iteration history. One row per project. |
| `shots` | Shot list per project (from DirectΩr). |
| `footage` | Every clip in VaultΩr. Shot type, quality, transcript path, proxy/BRAW relationship. |
| `beats` | Beat map for a project — one row per beat with emotional function, time markers. |
| `cuts` | CutΩr-identified moments (retention/CTA/social). Approved cuts get extracted to disk. |
| `selects` | EditΩr SelectsΩr decisions — which clips to use for each script section. |
| `davinci_timelines` | DaVinci project/timeline state per Kre8r project. |
| `composor_tracks` | ComposΩr Suno prompts and generated track metadata. |
| `writr_scripts` | Extended script data from WritΩr (beyond `scripts` table). |
| `shoot_takes` | ShootDay take records per shot. |
| `viral_clips` | RetentΩr-flagged clip moments. |
| `shows` | Rock Rich Show series definitions. |
| `show_episodes` | Individual episode records per show. |
| `content_goals` | NorthΩr 3-month trajectory targets. |
| `northr_alerts` | Strategy alerts surfaced by NorthΩr. |
| `strategy_reports` | Full NorthΩr strategy report snapshots. |
| `writr_room_sessions` | RoΩm multi-turn chat session history per project. |
| `session_checkpoints` | Id8Ωr research session state (persists across page loads). |
| `kv_store` | Generic key-value for module preferences and cached state. |
| `token_usage` | API call logs (model, tokens in/out, cost). |
| `users` | Auth users (bcrypt passwords, roles: owner/editor/viewer). |

### `creator-profile.json` — the soul config
Loaded at startup via `src/utils/profile-validator.js`. Injected into every AI prompt.
Key sections: `creator` (name, brand, voice), `platforms`, `community`, `vault` (paths),
`audience_profile`, `content_angles`, `voice_examples`.

---

## Module Data Map

### PRE-PRODUCTION

**Id8Ωr** (`/api/id8r`)
- Reads: `creator-profile.json` (angles, voice, community tiers), `session_checkpoints`
- Writes: `session_checkpoints` (research state), `projects` (creates project on package)
- External: Anthropic API (multi-phase web research), web search

**PipΩr** (`/api/pipr`)
- Reads: `projects`, `beats`, `pipeline_state`, `creator-profile.json`
- Writes: `projects` (title, topic, structure), `beats` (beat map), `pipeline_state`
- Downstream: beats feed WritΩr and EditΩr

**WritΩr** (`/api/writr`)
- Reads: `projects`, `beats`, `scripts`, `creator-profile.json` (voice profiles, voice_examples)
- Writes: `scripts` (outline → full_script → approved_version, iteration_history)
- External: Anthropic API (script generation, RoΩm multi-turn chat)
- Note: Voice blend slider controls how much `voice_examples` weight vs. template

**DirectΩr** (`/api/davinci` + `/api/director`)
- Reads: `projects`, `scripts`
- Writes: `shots` (shot list)

**ShootDay** (`/api/shootday`)
- Reads: `projects`, `shots`, `pipeline_state`
- Writes: `shoot_takes`, `shots.captured`

---

### PRODUCTION

Shoot happens offline. BRAW → DaVinci proxy export → `D:\kre8r\intake\` → VaultΩr watcher picks up.

---

### POST-PRODUCTION

**VaultΩr** (`/api/vault`)
- Reads: filesystem (intake folder from `creator-profile.json vault.intake_folder`)
- Writes: `footage` (ingest: path, shot_type via Vision, thumbnail, metadata)
- External: Anthropic Vision (shot classification, description), ffmpeg (thumbnail extraction)
- Watcher: chokidar on intake folder, auto-ingests new files

**EditΩr / SelectsΩr** (`/api/editor`)
- Reads: `footage`, `beats`, `projects`, `scripts`
- Writes: `selects` (clip-to-beat assignments), `footage.transcript_path`
- External: Whisper (transcription per clip), Anthropic API (SelectsΩr decision engine)
- SSE: long-running job; `src/utils/sse.js` heartbeat + 8-min timeout

**CutΩr** (`/api/cutor`)
- Reads: `footage` (transcript), `projects`
- Writes: `cuts` (identified moments), `footage.off_script_gold`
- External: Whisper (transcription), Anthropic API (moment identification), ffmpeg (extraction)
- SSE: Whisper transcription + AI analysis; install-whisper is also SSE

**ComposΩr** (`/api/composor`)
- Reads: `projects`, `selects`, `beats`, `creator-profile.json`
- Writes: `composor_tracks` (Suno prompts, generated audio metadata)
- External: Anthropic API (scene analysis, Suno prompt generation), Suno API (optional)

---

### DISTRIBUTION

**GateΩr / M1** (`/api/projects`)
- Reads: `projects`, `pipeline_state`, `selects`
- Writes: `pipeline_state.gate_a_approved`

**PackageΩr / M2** (`/api/generate`)
- Reads: `projects`, `scripts`, `creator-profile.json`
- Writes: `projects` (adds title/thumbnail/description options)
- External: Anthropic API

**CaptionΩr / M3** (`/api/generate`)
- Reads: `projects`, `scripts`, `creator-profile.json`
- Writes: `projects` (per-platform captions)
- External: Anthropic API

**MailΩr** (`/api/mailor`)
- Reads: `projects`, `scripts`, `creator-profile.json` (voice, community tiers)
- Writes: emails delivered via Playwright (Kajabi copy/paste) — no DB writes
- External: Anthropic API (email generation)

**AudiencΩr** (`/api/kajabi`)
- Reads: Kajabi API (contacts, tags, offers)
- Writes: none (Kajabi reads only; broadcasts are copy/paste)
- External: Kajabi Public API (OAuth2)

---

### STRATEGY

**NorthΩr** (`/api/northr`)
- Reads: `projects`, `pipeline_state`, `content_goals`, `creator-profile.json`
- Writes: `northr_alerts`, `strategy_reports`, `content_goals`
- External: Anthropic API

**SoulBuildΩr** (`/api/soul-buildr`)
- Reads: filesystem (completed-video clips), `footage`
- Writes: `creator-profile.json` (voice profile fields)
- External: Whisper (voice transcription), Anthropic API (voice analysis)

---

## Key Data Dependencies (pipeline order)

```
creator-profile.json  ──┐
                        ↓
Id8Ωr → projects ──→ PipΩr → beats
                              ↓
                         WritΩr → scripts
                              ↓
                         DirectΩr → shots
                              ↓
                    [SHOOT → footage ingest]
                              ↓
                         VaultΩr → footage (classified)
                              ↓
                    EditΩr (beats + footage + scripts) → selects
                              ↓
                    CutΩr (footage) → cuts
                              ↓
                    ComposΩr (selects + beats) → composor_tracks
                              ↓
                    GateΩr → pipeline_state.gate_a
                              ↓
                    PackageΩr + CaptionΩr + MailΩr
```

---

## Shared Infrastructure

| Module | Location | Purpose |
|---|---|---|
| Claude API caller | `src/utils/claude.js` | All AI calls. Retry/backoff. Use everywhere, never inline fetch. |
| Profile validator | `src/utils/profile-validator.js` | Load + validate creator-profile.json at startup. |
| SSE helper | `src/utils/sse.js` | Keepalive (20s) + timeout (8min) for all streaming endpoints. |
| Logger | `src/utils/logger.js` | Pino structured logging → `logs/kre8r.log` always. |
| DB | `src/db.js` | All reads/writes. Never touch .db file directly while server runs. |

---

## External Service Dependencies

| Service | Used by | Required for |
|---|---|---|
| Anthropic API | All AI modules | Generation, classification, analysis |
| Whisper (local) | EditΩr, CutΩr, SoulBuildΩr | Transcription |
| ffmpeg (bundled) | VaultΩr, CutΩr, SoulBuildΩr | Thumbnail extraction, clip extraction, audio processing |
| Kajabi API | AudiencΩr | Contact management |
| Suno API | ComposΩr | Music generation (optional — prompt mode works without it) |
| DaVinci Resolve | EditΩr, DirectΩr | Timeline export (Windows only, optional) |
