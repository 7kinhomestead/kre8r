# Kre8Ωr Desktop App

Turns the Kre8Ωr web app into a native desktop application using Electron.
The Express server runs as a child process; Electron wraps it in a BrowserWindow.

---

## Development (run locally)

```bash
npm run electron
```

This uses `concurrently` to:
1. Start `node server.js` on port 3000
2. Wait for it to be ready (`wait-on`)
3. Open Electron pointed at `http://localhost:3000`

You'll see the splash screen while the server boots, then the full app.

---

## Build installers

### Windows (.exe NSIS installer)
```bash
npm run dist:win
```
Output: `dist/Kre8r Setup 1.0.0.exe`

### macOS (.dmg)
```bash
npm run dist:mac
```
Output: `dist/Kre8r-1.0.0.dmg`

### Both
```bash
npm run dist
```

---

## Icon generation

```bash
npm run generate-icons
```

Converts `public/images/kre8r-icon.svg` → PNG at 512, 256, 128, 64, 32, 16px.
Run this after changing the SVG icon before building a distribution.

---

## File structure

```
electron/
  main.js       — Electron entry point: spawns server, manages windows
  splash.html   — Boot splash screen (shown while Express starts)
  preload.js    — Context bridge: safe API surface exposed to renderer
  README.md     — This file
```

---

## Data paths (Electron mode)

When running as a desktop app, data lives in the OS user directory (not the app bundle):

| OS      | Path |
|---------|------|
| Windows | `%APPDATA%\Kre8r\` |
| macOS   | `~/Library/Application Support/Kre8r/` |

- **Database:** `kre8r.db` (created on first launch)
- **Creator profile:** `creator-profile.json` (copied from repo on first launch if missing)

This means data persists across app updates and is separate from the installed binary.

---

## First run

On first launch, Soul BuildΩr opens automatically if no creator profile exists.
Complete the wizard to personalize the entire system for your instance.

---

## Notes

- The `kre8r://` protocol is registered for OAuth callbacks (Kajabi, etc.)
- External links open in the system browser, not inside Electron
- macOS: title bar uses `hiddenInset` (traffic lights inside the frame)
- Windows: standard chrome title bar
- `pm2` is not used in Electron mode — the server is managed by `main.js`
