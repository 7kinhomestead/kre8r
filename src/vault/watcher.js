/**
 * VaultΩr Folder Watcher — src/vault/watcher.js
 *
 * Uses chokidar to watch the intake_folder defined in creator-profile.json.
 * When a new video file is stable (not still being written), it is automatically
 * passed through the full intake pipeline (ffprobe → thumbnail → Claude Vision → DB).
 *
 * Start: call startWatcher()
 * Stop:  call stopWatcher()
 *
 * Designed to be started once at server boot and run for the life of the process.
 */

'use strict';

const chokidar  = require('chokidar');
const path      = require('path');
const fs        = require('fs');
const { ingestFile } = require('./intake');

const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH || path.join(__dirname, '..', '..', 'creator-profile.json');
const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mov', '.mts', '.avi', '.mkv']);

// How long (ms) a file must be stable (no size change) before we ingest it.
// Prevents reading a file that is still being copied/written.
const STABLE_DELAY_MS = 4000;

let watcher = null;
let watchPath = null;

// ─────────────────────────────────────────────
// STABILITY CHECK
// Polls file size twice. If it hasn't changed, the file is done writing.
// ─────────────────────────────────────────────

function waitForStable(filePath, intervalMs = 1000, maxWaitMs = 60000) {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    let lastSize = -1;

    const check = () => {
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        return reject(new Error(`File disappeared: ${filePath}`));
      }

      if (stat.size === lastSize && stat.size > 0) {
        return resolve(); // stable
      }

      lastSize = stat.size;
      elapsed += intervalMs;

      if (elapsed >= maxWaitMs) {
        return reject(new Error(`File never stabilized after ${maxWaitMs}ms: ${filePath}`));
      }

      setTimeout(check, intervalMs);
    };

    setTimeout(check, intervalMs);
  });
}

// ─────────────────────────────────────────────
// START WATCHER
// ─────────────────────────────────────────────

function startWatcher(overridePath = null) {
  if (watcher) {
    console.log('[VaultΩr Watcher] Already running.');
    return { ok: true, path: watchPath, already_running: true };
  }

  // Resolve intake folder
  let intakePath = overridePath;
  if (!intakePath) {
    try {
      const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
      intakePath = profile?.vault?.intake_folder;
    } catch (e) {
      console.error('[VaultΩr Watcher] Could not read creator-profile.json:', e.message);
      return { ok: false, error: 'Could not read creator-profile.json' };
    }
  }

  if (!intakePath) {
    return { ok: false, error: 'vault.intake_folder not set in creator-profile.json' };
  }

  // Create the folder if it doesn't exist
  try {
    fs.mkdirSync(intakePath, { recursive: true });
  } catch (e) {
    console.error('[VaultΩr Watcher] Could not create intake folder:', e.message);
    return { ok: false, error: `Could not create intake folder: ${e.message}` };
  }

  watchPath = intakePath;

  watcher = chokidar.watch(intakePath, {
    persistent:      true,
    ignoreInitial:   true,   // don't re-ingest files already there at startup
    awaitWriteFinish: {
      stabilityThreshold: STABLE_DELAY_MS,
      pollInterval: 500
    },
    depth: 5           // watch up to 5 levels deep
  });

  watcher.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return; // ignore non-video files

    console.log(`[VaultΩr Watcher] New file detected: ${path.basename(filePath)}`);

    try {
      // awaitWriteFinish handles stability, but we do a redundant check as a safety net
      const result = await ingestFile(filePath);
      if (result.ok) {
        console.log(`[VaultΩr Watcher] ✓ Ingested: ${path.basename(filePath)} (id=${result.id}, type=${result.shot_type || 'unclassified'})`);
      } else {
        console.warn(`[VaultΩr Watcher] ✗ Ingest failed: ${path.basename(filePath)} — ${result.error}`);
      }
    } catch (e) {
      console.error(`[VaultΩr Watcher] Unexpected error for ${path.basename(filePath)}:`, e.message);
    }
  });

  watcher.on('error', (err) => {
    console.error('[VaultΩr Watcher] Watcher error:', err.message);
  });

  watcher.on('ready', () => {
    console.log(`[VaultΩr Watcher] Watching: ${intakePath}`);
  });

  return { ok: true, path: intakePath };
}

// ─────────────────────────────────────────────
// STOP WATCHER
// ─────────────────────────────────────────────

async function stopWatcher() {
  if (!watcher) return { ok: true, message: 'Watcher was not running' };
  await watcher.close();
  watcher = null;
  watchPath = null;
  console.log('[VaultΩr Watcher] Stopped.');
  return { ok: true };
}

// ─────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────

function getWatcherStatus() {
  return {
    running: !!watcher,
    path:    watchPath || null
  };
}

module.exports = { startWatcher, stopWatcher, getWatcherStatus };
