# Kre8Ωr

AI-native content production OS for solo creators. Takes a creator from raw idea to published video to performance intelligence through a single pipeline.

Built with Node.js/Express, SQLite, Claude API, and vanilla HTML/CSS/JS frontend.

---

## Prerequisites

| Dependency | Required | Notes |
|---|---|---|
| Node.js 18+ | Required | |
| ffmpeg + ffprobe | Required | VaultΩr video metadata and thumbnails |
| Python 3.x | Optional | Whisper transcription and DaVinci integration |
| DaVinci Resolve Studio | Optional | BRAW proxy export and timeline creation |
| PM2 | Optional | Production process management |

---

## Quick Start

```bash
git clone [repo]
cd kre8r
npm install
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY at minimum
node server.js
# Open http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Required | — | Claude API key. Get from console.anthropic.com |
| `PORT` | Optional | 3000 | Server port |
| `YOUTUBE_API_KEY` | Optional | — | YouTube Data API v3. Used by MirrΩr for channel import |
| `YOUTUBE_CHANNEL_HANDLE` | Optional | — | Your @handle for MirrΩr auto-import |
| `YOUTUBE_CLIENT_ID` | Optional | — | OAuth2 client ID for YouTube auth |
| `YOUTUBE_CLIENT_SECRET` | Optional | — | OAuth2 client secret |
| `YOUTUBE_REDIRECT_URI` | Optional | `http://localhost:3000/auth/youtube/callback` | OAuth2 callback |
| `SUNO_API_KEY` | Optional | — | Suno music API for ComposΩr. Falls back to prompt mode |
| `ALERT_EMAIL` | Optional | — | Email for blocker bug report alerts (beta system) |
| `KAJABI_CLIENT_ID` | Optional | — | Kajabi OAuth2 for AudiencΩr integration |
| `KAJABI_CLIENT_SECRET` | Optional | — | Kajabi OAuth2 secret |

---

## Project Structure

```
server.js             — Express server, mounts all routes
src/db.js             — SQLite database (sql.js), all migrations
src/routes/           — API route handlers (one file per module)
src/vault/            — VaultΩr intake, watcher, search
src/editor/           — SelectsΩr v2 engine
src/composor/         — ComposΩr scene analyzer, Suno client
src/writr/            — WritΩr script generation, voice analyzer
src/utils/claude.js   — Shared Claude API caller (used everywhere)
scripts/davinci/      — Python scripts for DaVinci Resolve
public/               — All HTML pages (one per tool)
public/js/nav.js      — Shared nav component
database/             — SQLite .db file (gitignored)
creator-profile.json  — Creator soul config (voice, platforms, paths)
```

---

## The Pipeline

- **PLAN:** Soul BuildΩr → Id8Ωr → PipΩr
- **MAKE:** WritΩr → DirectΩr → ShootDay → TeleprΩmpter → VaultΩr → EditΩr → ReviewΩr → ComposΩr
- **DISTRIBUTE:** GateΩr → PackageΩr → CaptionΩr → MailΩr
- **INTELLIGENCE:** MirrΩr

---

## Creator Profile

`creator-profile.json` is the "soul" of the instance — voice profiles, content angles, platform data, vault paths. Copy the example and customize.

The Engine (pipeline code) never has creator-specific data hardcoded. It all flows through this file. This is the foundation for multi-tenancy.

---

## Production Deploy (DigitalOcean)

```bash
# PM2 ecosystem
pm2 start ecosystem.config.js

# Manual deploy
cd /home/kre8r/kre8r
sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production
sudo -u kre8r pm2 restart kre8r
```

---

## Known Technical Debt

- **Database:** Uses `sql.js` (in-memory SQLite, persisted to disk on write). Migration to `better-sqlite3` is planned before commercialization. Concurrent writes on the same server instance can cause race conditions. Single-creator local use is fine. Do not edit the `.db` file directly with `sqlite3` CLI while the server is running — direct edits go to an isolated in-memory copy and are lost on the next server write.
- **Tests:** No automated tests yet. Critical paths are manually tested.
- **Windows paths:** Some Windows-centric paths remain in Python scripts. Being migrated to env vars and `creator-profile.json`.
- **Multi-tenancy:** Single-creator instance. Multi-tenancy is architecturally planned (via the `creator-profile.json` pattern) but not yet implemented.
- **DaVinci integration:** Windows-only. The DaVinci Resolve Python scripting API does not run on macOS or Linux.

---

## License

Proprietary — © 2026 Kre8Ωr / Jason Rutland. All rights reserved.
