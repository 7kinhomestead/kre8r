# Kre8Ωr — Environment Setup

## Prerequisites

### Node.js
Requires Node.js 18+. Already confirmed installed at `C:\Program Files\nodejs`.

### ffmpeg + ffprobe (REQUIRED for VaultΩr)

ffmpeg and ffprobe are required for:
- Extracting video metadata (duration, resolution, codec, creation timestamp)
- Generating thumbnail images from video clips
- Future: clip extraction in CutΩr

**ffmpeg is NOT currently installed on this machine.**

#### Install on Windows (recommended: winget)

```
winget install Gyan.FFmpeg
```

After install, close and reopen your terminal. Verify with:
```
ffmpeg -version
ffprobe -version
```

#### Alternative: manual install

1. Download a full build from https://www.gyan.dev/ffmpeg/builds/ (get the `full_build` zip)
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to your system PATH:
   - Search "Environment Variables" in Start Menu
   - Edit `Path` under System variables
   - Add `C:\ffmpeg\bin`
4. Restart your terminal and verify with `ffmpeg -version`

#### Alternative: Chocolatey

```
choco install ffmpeg
```

#### Alternative: Scoop

```
scoop install ffmpeg
```

---

### What breaks without ffmpeg

VaultΩr's intake pipeline (`src/vault/intake.js`) will fail on any file it tries to process.
The server will still start and all other tools (M1–M4) will work normally. VaultΩr will
surface a clear error message when ffmpeg is missing rather than crashing.

---

## npm Dependencies

All Node.js dependencies install with no native compilation:

```
npm install
```

### Installed packages

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.19.2 | HTTP server |
| sql.js | ^1.14.1 | SQLite (pure WASM, no compilation) |
| dotenv | ^16.4.5 | `.env` file loading |
| cors | ^2.8.5 | Cross-origin headers |
| node-fetch | ^3.3.2 | HTTP requests (Claude API calls) |
| fluent-ffmpeg | ^2.1.3 | Node.js wrapper for ffmpeg/ffprobe |
| chokidar | ^5.0.0 | File system watcher for intake folder |
| multer | ^2.1.1 | Multipart form handling for web upload |

> Note: `sharp` (image processing) was evaluated and excluded — ffmpeg handles
> all thumbnail generation natively with no additional dependency needed.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-api03-...   # Required for M2/M3/M4 generation and VaultΩr Vision
PORT=3000                             # Optional, defaults to 3000
CLAUDE_MODEL=claude-sonnet-4-20250514 # Optional, defaults to this value
```

---

## Running the App

```
npm start        # production
npm run dev      # development (nodemon auto-restart)
```

Open http://localhost:3000

---

## VaultΩr Intake Folder

Set the intake folder in `creator-profile.json` under the `vault` key:

```json
{
  "vault": {
    "intake_folder": "C:/Users/YourName/Videos/intake",
    "organized_folder": "C:/Users/YourName/Videos/organized"
  }
}
```

The watcher monitors `intake_folder` for new video files. Organized copies are
written to `organized_folder`. Original files are never moved or deleted.
