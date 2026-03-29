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

## VaultΩr Storage Architecture

**Originals never move.** VaultΩr is a database layer over your existing folder
structure — it records paths to files, extracts metadata, and generates thumbnails.
It does not copy, move, rename, or delete any footage file at any point.

### How it works

- **Ingest** reads each file in place, runs ffprobe for metadata, generates a
  thumbnail into `public/thumbnails/`, and writes a record to the database.
  The `file_path` column stores the absolute path to the original file.
- **Organize** computes a logical reference name following the naming convention
  (`YYYY-MM-DD_description-slug_shottype_NNN.ext`) and writes it to the
  `organized_path` column as a display string only. No file is created.
- **Thumbnails** are the only files VaultΩr writes — small JPEGs in `public/thumbnails/`.

### Folder config

Set all three paths in `creator-profile.json` under the `vault` key:

```json
{
  "vault": {
    "footage_root":    "D:/Footage",
    "intake_folder":   "D:/Footage/intake",
    "organized_folder": "D:/Footage/organized"
  }
}
```

| Key | Purpose |
|-----|---------|
| `footage_root` | Root of your footage library (typically an external drive). Point the watcher at subfolders of this. |
| `intake_folder` | The folder the watcher monitors for new drops. Files placed here are auto-ingested. |
| `organized_folder` | Logical root used to build `organized_path` reference strings in the DB. No files are written here. |

### External drive workflow

1. Point `footage_root` and `intake_folder` at your external drive:
   ```json
   "footage_root":  "E:/7KinFootage",
   "intake_folder": "E:/7KinFootage/intake"
   ```
2. Drop footage onto the drive — the watcher picks it up automatically.
3. Ingest reads and classifies in place. The original stays on the drive.
4. If the drive is disconnected, the DB retains all metadata and thumbnails.
   Re-connect the drive and paths resolve again immediately.
