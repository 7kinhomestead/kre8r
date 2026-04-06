/**
 * Kre8Ωr Desktop — electron/main.js
 * Electron entry point. Spins up the Express server as a child process,
 * shows a splash screen while it boots, then loads the app in a BrowserWindow.
 */

'use strict';

const { app, BrowserWindow, shell, protocol, ipcMain } = require('electron');
const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');
const http   = require('http');

let mainWindow;
let splashWindow;
let serverProcess;
const PORT = 3000;

// ─── Register kre8r:// protocol for OAuth callbacks ──────────────────────────
protocol.registerSchemesAsPrivileged([{
  scheme:     'kre8r',
  privileges: { secure: true, standard: true },
}]);

// ─── Start Express server as child process ───────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, '../server.js');

    // ── First-run setup ───────────────────────────────────────────────────────
    const userData = app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });

    // DB: if no kre8r.db in AppData, seed from the schema-only template that
    // ships with the app. Users get the right schema with zero data.
    const dbDest      = path.join(userData, 'kre8r.db');
    const dbTemplate  = path.join(__dirname, '../database/kre8r-template.db');
    if (!fs.existsSync(dbDest)) {
      if (fs.existsSync(dbTemplate)) {
        fs.copyFileSync(dbTemplate, dbDest);
        console.log('[Electron] Seeded fresh database from template →', dbDest);
      } else {
        // Template missing — server will create schema from scratch via migrations
        console.warn('[Electron] kre8r-template.db not found; server will initialise schema');
      }
    }

    // Creator profile: if no profile in AppData, this is a fresh install.
    // Do NOT auto-copy Jason's profile — new users must run Soul BuildΩr.
    // (Dev exception: if running from the repo and no profile exists, copy it
    //  so local development still works without completing the wizard.)
    const profileDest = path.join(userData, 'creator-profile.json');
    const profileSrc  = path.join(__dirname, '../creator-profile.json');
    const isDev       = !app.isPackaged;
    if (!fs.existsSync(profileDest) && isDev && fs.existsSync(profileSrc)) {
      fs.copyFileSync(profileSrc, profileDest);
      console.log('[Electron] Dev mode: copied creator-profile.json →', profileDest);
    }

    // Spawn server with system Node.js (not Electron's bundled node)
    // so native modules compiled for system Node (better-sqlite3, etc.) load correctly.
    const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
    serverProcess = spawn(nodeBin, [serverPath], {
      env: {
        ...process.env,
        PORT:                String(PORT),
        NODE_ENV:            'production',
        ELECTRON:            'true',
        // DB and creator profile live in the user's AppData / Application Support
        DB_PATH:             path.join(app.getPath('userData'), 'kre8r.db'),
        CREATOR_PROFILE_PATH: path.join(app.getPath('userData'), 'creator-profile.json'),
      },
      stdio: 'pipe',
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      if (msg.includes('ready') || msg.includes('listening') || msg.includes('KRE8ΩR')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString().trim());
    });

    serverProcess.on('exit', (code) => {
      console.log('[Server] exited with code', code);
    });

    // Poll health endpoint — resolves as soon as server responds
    const poll = setInterval(() => {
      http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(poll);
          resolve();
        }
      }).on('error', () => { /* still starting */ });
    }, 500);
  });
}

// ─── Splash screen (shown while server boots) ────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width:        480,
    height:       320,
    frame:        false,
    transparent:  true,
    alwaysOnTop:  true,
    resizable:    false,
    webPreferences: { nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

// ─── Main application window ─────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:     1440,
    height:    900,
    minWidth:  1024,
    minHeight: 768,
    // macOS: traffic lights inside the frame; Windows: default chrome
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '../public/images/kre8r-icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external URLs in the system browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Boot sequence ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();
  await startServer();
  createMainWindow();

  // macOS: re-create window when dock icon clicked with no windows open
  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

// ─── kre8r:// OAuth protocol handler ─────────────────────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('oauth-callback', url);
  }
});
