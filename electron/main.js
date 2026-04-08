/**
 * Kre8Ωr Desktop — electron/main.js
 * Electron entry point. Spins up the Express server as a child process,
 * shows a splash screen while it boots, then loads the app in a BrowserWindow.
 */

'use strict';

const { app, BrowserWindow, shell, protocol, ipcMain, Menu, MenuItem, dialog } = require('electron');
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

    // DB: only copy template on a genuine fresh install (no DB in AppData).
    // NEVER overwrite an existing DB — that would wipe all user data.
    const dbDest     = path.join(userData, 'kre8r.db');
    const dbTemplate = path.join(__dirname, '../database/kre8r-template.db');
    if (!fs.existsSync(dbDest)) {
      // Fresh install — seed from template if available, otherwise let
      // the server create the schema from scratch via migrations.
      if (fs.existsSync(dbTemplate)) {
        fs.copyFileSync(dbTemplate, dbDest);
        console.log('[Electron] Fresh install — seeded DB from template →', dbDest);
      } else {
        console.warn('[Electron] Fresh install — no template found; server will initialise schema');
      }
    } else {
      // Existing DB — use it as-is. All data is preserved.
      console.log('[Electron] Existing DB found — preserving user data →', dbDest);
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

    // Poll health endpoint every 300ms — resolves as soon as server responds
    let resolved = false;
    const poll = setInterval(() => {
      http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200 && !resolved) {
          resolved = true;
          clearInterval(poll);
          console.log('[Electron] Server ready — loading main window');
          resolve();
        }
      }).on('error', () => { /* server not ready yet, keep polling */ });
    }, 300);

    // Safety timeout — open the window after 15s even if health check never responds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(poll);
        console.warn('[Electron] Server ready timeout (15s) — loading window anyway');
        resolve();
      }
    }, 15000);
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
      spellcheck:       true,
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

  // ── Right-click context menu (spell check + copy/paste) ─────────────────
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    // Spell-check suggestions
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => mainWindow.webContents.replaceMisspelling(suggestion)
      }));
    }
    if (params.misspelledWord) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => mainWindow.webContents.session
          .addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Editable field: full edit menu
    if (params.isEditable) {
      if (params.misspelledWord && menu.items.length === 0)
        menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'undo' }));
      menu.append(new MenuItem({ role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'cut' }));
      menu.append(new MenuItem({ role: 'copy' }));
      menu.append(new MenuItem({ role: 'paste' }));
      menu.append(new MenuItem({ role: 'pasteAndMatchStyle' }));
      menu.append(new MenuItem({ role: 'selectAll' }));
    } else if (params.selectionText) {
      // Read-only selected text: copy only
      menu.append(new MenuItem({ role: 'copy' }));
    }

    if (menu.items.length > 0) menu.popup();
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

  // ── Rolling DB backup every 5 minutes ────────────────────────────────────
  // Guards against AppData corruption and bad shutdowns.
  // Backup lives in the project /database folder (gitignored).
  const dbSrc    = path.join(app.getPath('userData'), 'kre8r.db');
  const dbBackup = path.join(__dirname, '../database/kre8r-electron-backup.db');
  setInterval(() => {
    try {
      if (fs.existsSync(dbSrc)) {
        fs.copyFileSync(dbSrc, dbBackup);
      }
    } catch (err) {
      console.warn('[Electron] DB backup failed (non-fatal):', err.message);
    }
  }, 300_000); // every 5 minutes

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

// ─── Native folder picker — used by Soul BuildΩr setup wizard ────────────────
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose Folder'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ─── kre8r:// OAuth protocol handler ─────────────────────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('oauth-callback', url);
  }
});
