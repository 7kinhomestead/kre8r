# Kre8Ωr

**An AI-native content production OS for solo creators.**

Kre8Ωr eliminates the administrative layer between having an idea and that idea reaching an audience. It connects every stage of the content pipeline — from initial ideation through post-production and distribution — using a single shared database, Claude AI, and local tools you already run.

Built for [7 Kin Homestead](https://www.tiktok.com/@7kinhomestead) (725k TikTok, 54k YouTube). Built with Claude Code. No prior coding experience required to run it.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | `node --version` to check |
| ffmpeg + ffprobe | any recent | Required for VaultΩr video processing |
| Python | 3.10+ | Required for Whisper transcription and DaVinci scripts |
| DaVinci Resolve Studio | 20+ | Required for DaVinci integration only |
| PM2 | latest | `npm install -g pm2` — recommended for production |

### Install ffmpeg (Windows)

```bash
winget install Gyan.FFmpeg
```

Verify: `ffmpeg -version` and `ffprobe -version`

### Install Whisper

```bash
pip install openai-whisper
```

---

## Installation

```bash
git clone https://github.com/7kinhomestead/kre8r.git
cd kre8r
npm install
```

> **Note:** This repository is private. Request access before cloning.

---

## Environment Variables

Create a `.env` file in the project root with these variables:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...     # Required — all Claude AI features
SUNO_API_KEY=your-key-here             # Optional — ComposΩr auto music generation
PORT=3000                               # Optional, defaults to 3000
CLAUDE_MODEL=claude-sonnet-4-6         # Optional, defaults to this value
KAJABI_CLIENT_ID=your-client-id        # Optional — Kajabi API access (AudiencΩr, MailΩr)
KAJABI_CLIENT_SECRET=your-secret       # Optional — Kajabi API access (AudiencΩr, MailΩr)
```

**`ANTHROPIC_API_KEY` is the only required key.** Without it, nothing that touches Claude will work. Get one at [console.anthropic.com](https://console.anthropic.com).

**`SUNO_API_KEY` is optional.** Without it, ComposΩr runs in Prompt Mode — Claude still writes optimized Suno prompts, but audio isn't generated automatically. You copy the prompt and paste it into [suno.com](https://suno.com) yourself.

---

## Configure Your Instance

Edit `creator-profile.json` at the project root. At minimum, update the `vault` section to point at your footage folders:

```json
{
  "vault": {
    "footage_root":    "D:/Footage",
    "intake_folder":   "D:/Footage/intake",
    "organized_folder": "D:/Footage/organized"
  }
}
```

Everything else in `creator-profile.json` — voice profile, community tiers, content angles, platform handles — is read by the AI tools at runtime. Update it to match your brand.

---

## Running Locally

### Development (auto-restart on file changes)

```bash
npm run dev
```

### Production (PM2 — keeps server alive, auto-starts on boot)

```bash
pm2 start server.js --name kre8r
pm2 save
```

Open: [http://localhost:3000](http://localhost:3000)

### Useful PM2 commands

```bash
pm2 status              # check if kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # restart after pulling new code
pm2 stop kre8r          # stop the server
```

---

## The Pipeline

```
PRE-PRODUCTION
  Id8Ωr      → Ideation: conversation, research, mind map, vision brief
  PipΩr      → Project creation and pipeline setup
  WritΩr     → Script writing with voice profile
  DirectΩr   → Production planning and shoot management
  ShootDay   → Day-of checklist and shot tracking
  TeleprΩmpter → 3-device live teleprompter (display + control + voice cue)

PRODUCTION
  Blackmagic camera → .braw files → intake folder

POST-PRODUCTION
  VaultΩr    → Footage ingestion, classification, proxy workflow, DaVinci handoff
  CutΩr      → Whisper transcription, Claude cut identification, clip extraction
  ReviewΩr   → Rough cut approval UI
  EditΩr     → Selects builder, B-roll bridge, DaVinci selects timeline
  ComposΩr   → Scene analysis, music prompt generation, Suno integration

DISTRIBUTION
  GateΩr     → Community gating and access control
  PackageΩr  → Platform-specific packaging (YouTube, TikTok, Shorts, Reels)
  CaptionΩr  → AI caption generation
  MailΩr     → Kajabi email drafting by community tier
  AudiencΩr  → Kajabi contact and tag management
```

All stages share a single SQLite database. No copy-paste between tools.

---

## Module Reference

### Pre-Production

**Id8Ωr** — Ideation engine. Three modes: Conversation (freeform brainstorming with Claude), Research (sequential web research across YouTube trends, platform data, and your VaultΩr archive), and Full Concept (runs both then generates a mind map, content package, and Vision Brief that hands off directly into the pipeline).

**WritΩr** — Script writing tool. Reads your voice profile from `creator-profile.json` and writes in your actual voice. Includes a Voice Library of analyzed video samples to keep output on-brand.

**TeleprΩmpter** — Live 3-device teleprompter system. One device runs the display, a second is the speed/scroll controller, a third handles voice cues. Devices connect via a 4-digit session code — no accounts, no setup.

### Post-Production

**VaultΩr** — The footage database. Watches your intake folder for new files, runs ffprobe for metadata, generates thumbnails, classifies shot type (talking head, B-roll, etc.), and stores everything by path — originals never move. Includes a DaVinci panel for project linking and proxy export.

**CutΩr** — Transcribes footage with Whisper, sends the transcript to Claude to identify the best selects, and extracts clips. Output is a set of candidate clips ready for the edit.

**EditΩr** — Assembles approved selects into a structured timeline, bridges B-roll, and creates a DaVinci Resolve selects timeline via the Python scripting API.

**ComposΩr** — Analyzes each scene type in the timeline and generates Suno music prompts matched to the mood and pacing. With a Suno API key, generates audio automatically. Without one, outputs ready-to-paste prompts.

### Distribution

**PackageΩr** — Takes a finished video and packages it for each platform: YouTube (full length), TikTok/Reels/Shorts (reformatted), with platform-appropriate titles and descriptions.

**CaptionΩr** — Generates captions from the transcript, formatted and timed for each platform.

**MailΩr** — Drafts community emails for each ROCK RICH tier (Greenhouse, Garden, Founding 50) using tier-specific voice and strategy defined in `creator-profile.json`.

**GateΩr** — Manages Kajabi community access, tags, and gating logic.

**AudiencΩr** — Contact and tag management for the Kajabi community. View contacts, filter by tag, and manage broadcast lists.

---

## Project Structure

```
server.js              — Express server, mounts all routes
src/
  db.js                — SQLite database, all migrations
  routes/              — API route handlers (one file per module)
  vault/               — VaultΩr intake, watcher, organizer
  editor/              — EditΩr selects engine, B-roll bridge
  composor/            — ComposΩr scene analyzer, Suno client
scripts/
  davinci/             — Python scripts for DaVinci Resolve integration
public/                — All frontend HTML files (one per module)
database/              — SQLite DB file and schema
docs/                  — System Bible, workflow docs, setup guides
creator-profile.json   — Your instance config (voice, community, platforms)
```

---

## Tech Stack

- **Runtime:** Node.js 18+, Express.js
- **Database:** SQLite via sql.js (pure WASM, no native compilation)
- **AI:** Anthropic Claude API (`claude-sonnet-4-6`)
- **Video:** ffmpeg + ffprobe (metadata, thumbnails, clip extraction)
- **Transcription:** OpenAI Whisper (local Python)
- **DaVinci:** Python scripting API via Resolve 20 Studio
- **Music:** Suno API or Prompt Mode
- **Frontend:** Vanilla HTML/CSS/JS, dark theme, teal accents
- **Process:** PM2

---

## Database Notes

Kre8Ωr uses **sql.js** — SQLite compiled to WebAssembly, running entirely in the Node.js process. The database is loaded into memory on start and persisted to disk on every write.

**Important:** Never edit the `.db` file directly with an external SQLite tool while the server is running. All reads and writes must go through the live server API. Direct edits will be overwritten on the next server write.

A migration to better-sqlite3 is planned before commercialization to add WAL journaling and safe concurrent writes.

---

## DaVinci Integration (Windows only)

DaVinci Resolve Studio must be open and running before any DaVinci API calls are made. The integration uses the Python scripting API on port 9237.

Python path is configured in `SETUP.md`. If you're on a different machine, update the Python executable path referenced in `scripts/davinci/`.

---

## License

Private. Built for 7 Kin Homestead.
