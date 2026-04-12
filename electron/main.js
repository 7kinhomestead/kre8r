/**
 * Kre8Ωr Desktop — electron/main.js
 * Electron entry point. Spins up the Express server as a child process,
 * shows a splash screen while it boots, then loads the app in a BrowserWindow.
 */

'use strict';

const { app, BrowserWindow, shell, protocol, ipcMain, Menu, MenuItem, dialog, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

let mainWindow;
let splashWindow;
let serverProcess;
const PORT = 3000;

// ─── Path resolution helper ───────────────────────────────────────────────────
// Server-side files (server.js, src/, public/, database/) are unpacked from
// the asar to allow child_process.spawn to read them as real files on disk.
// In dev: files are at ../../<file> relative to this module.
// In packaged: files are at process.resourcesPath/app.asar.unpacked/<file>.
function getResourcePath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', ...parts);
  }
  return path.join(__dirname, '..', ...parts);
}

// ─── Register kre8r:// protocol for OAuth callbacks ──────────────────────────
protocol.registerSchemesAsPrivileged([{
  scheme:     'kre8r',
  privileges: { secure: true, standard: true },
}]);

// ─── Start Express server as child process ───────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    // server.js lives inside the asar — app.getAppPath() resolves correctly in both
    // dev (returns project root dir) and packaged (returns app.asar virtual path).
    // Electron's asar interception handles all require() calls from inside the asar,
    // including pure-JS deps. Native .node binaries are unpacked separately (asarUnpack).
    const serverPath = path.join(app.getAppPath(), 'server.js');

    // ── First-run setup ───────────────────────────────────────────────────────
    const userData = app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });

    // DB: only copy template on a genuine fresh install (no DB in AppData).
    // NEVER overwrite an existing DB — that would wipe all user data.
    const dbDest     = path.join(userData, 'kre8r.db');
    const dbTemplate = getResourcePath('database', 'kre8r-template.db');
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
    const profileSrc  = getResourcePath('creator-profile.json');
    const isDev       = !app.isPackaged;
    if (!fs.existsSync(profileDest) && isDev && fs.existsSync(profileSrc)) {
      fs.copyFileSync(profileSrc, profileDest);
      console.log('[Electron] Dev mode: copied creator-profile.json →', profileDest);
    }

    // ── Resolve bundled ffmpeg/ffprobe paths for cross-platform use ─────────────
    // ffmpeg-static and ffprobe-static ship pre-built binaries for Win/Mac/Linux.
    // We resolve them here in Electron's process so the server gets explicit paths
    // regardless of what's (or isn't) on the user's system PATH.
    let ffmpegPath  = process.env.FFMPEG_PATH  || '';
    let ffprobePath = process.env.FFPROBE_PATH || '';
    if (!ffmpegPath) {
      try { ffmpegPath  = require('ffmpeg-static');         } catch (_) {}
    }
    if (!ffprobePath) {
      try { ffprobePath = require('ffprobe-static').path;   } catch (_) {}
    }

    // Use utilityProcess.fork() — runs server.js inside Electron's own Node context.
    // This means better-sqlite3 (compiled for Electron) loads without ABI mismatch.
    // No external Node.js binary needed on the user's machine.
    console.log('[Electron] Starting server via utilityProcess.fork:', serverPath);
    serverProcess = utilityProcess.fork(serverPath, [], {
      stdio:       'pipe',
      serviceName: 'kre8r-server',
      env: {
        ...process.env,
        PORT:                String(PORT),
        NODE_ENV:            'production',
        ELECTRON:            'true',
        // DB and creator profile live in the user's AppData / Application Support
        DB_PATH:              path.join(app.getPath('userData'), 'kre8r.db'),
        CREATOR_PROFILE_PATH: path.join(app.getPath('userData'), 'creator-profile.json'),
        // Whisper models stored per-user so they survive app updates
        WHISPER_MODELS_DIR:   path.join(app.getPath('userData'), 'models'),
        LOG_DIR:              path.join(app.getPath('userData'), 'logs'),
        // Bundled binary paths — overrides system PATH for cross-platform reliability
        ...(ffmpegPath  && { FFMPEG_PATH:  ffmpegPath  }),
        ...(ffprobePath && { FFPROBE_PATH: ffprobePath }),
      },
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      if (msg.includes('ready') || msg.includes('listening') || msg.includes('KRE8ΩR')) {
        resolve();
      }
    });

    // Collect stderr for diagnostic dialog on startup failure
    const stderrLines = [];
    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      console.error('[Server Error]', msg);
      stderrLines.push(msg);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[Server] exited — code ${code}`);
      // Auto-restart on unexpected exit (not a deliberate app quit)
      if (!app.isQuitting && code !== 0) {
        console.warn('[Server] Unexpected exit — restarting in 2s…');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript(
            'if (window.__kre8rShowReconnect) window.__kre8rShowReconnect()'
          ).catch(() => {});
        }
        setTimeout(() => startServer().then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.executeJavaScript(
              'if (window.__kre8rHideReconnect) window.__kre8rHideReconnect()'
            ).catch(() => {});
          }
        }), 2000);
      }
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

    // Safety timeout — if server hasn't responded in 15s, show diagnostic dialog
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(poll);
        console.warn('[Electron] Server ready timeout (15s)');
        const errSummary = stderrLines.length
          ? stderrLines.slice(-20).join('\n')
          : '(no stderr output — server may have exited silently)';
        dialog.showErrorBox(
          'Kre8\u03A9r — Server failed to start',
          `The backend server did not respond after 15 seconds.\n\nError output:\n\n${errSummary}\n\nThe app will open but will not function. Check that all dependencies are installed.`
        );
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
    icon: getResourcePath('public', 'images', 'kre8r-icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      spellcheck:       true,
      preload:          path.join(__dirname, 'preload.js'), // always inside asar — Electron can load this directly
    },
  });

  // Load index.html explicitly — avoids any cached redirects from previous sessions
  mainWindow.loadURL(`http://localhost:${PORT}/index.html`);

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
  const dbBackup = getResourcePath('database', 'kre8r-electron-backup.db');
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

  // ── Auto-update check ─────────────────────────────────────────────────────
  // Checks kre8r.app/downloads/latest.yml a few seconds after launch.
  // Shows a native dialog when an update is ready to install.
  if (app.isPackaged) {
    autoUpdater.logger = null; // suppress noisy logs
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      dialog.showMessageBox(mainWindow, {
        type:    'info',
        title:   'Update available',
        message: `Kre8Ωr ${info.version} is available — downloading now.`,
        buttons: ['OK'],
      });
    });

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(mainWindow, {
        type:    'info',
        title:   'Update ready',
        message: 'A new version of Kre8Ωr has downloaded. Restart the app to apply the update.',
        buttons: ['Restart Now', 'Later'],
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    // Check 5 seconds after startup so it doesn't slow first load
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => { /* no internet / server down — silent fail */ });
    }, 5000);
  }
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
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
