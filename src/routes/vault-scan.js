/**
 * vault-scan.js — Drive Operations scanner for VaultΩr
 *
 * Routes:
 *   POST /api/vault/scan/start         — begin scan phase
 *   GET  /api/vault/scan/progress      — SSE stream of scan/ingest progress
 *   GET  /api/vault/scan/report        — return current checkpoint state
 *   POST /api/vault/scan/ingest        — start ingestion phase
 *   POST /api/vault/scan/ingest-braw   — create BRAW stub records
 *   POST /api/vault/scan/delete-junk   — delete files in junk list
 *   POST /api/vault/scan/cancel        — cancel any running operation
 */

'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const db     = require('../db');
const logger = require('../utils/logger');
const { startSseResponse } = require('../utils/sse');
const { ingestFile, probeFile } = require('../vault/intake');

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mxf', '.avi', '.mkv', '.m4v', '.wmv',
  '.flv', '.webm', '.ts', '.mts', '.m2ts'
]);

const BRAW_EXTENSIONS = new Set(['.braw', '.r3d', '.ari']);

const JUNK_DURATION_THRESHOLD = 3;    // seconds
const JUNK_SIZE_THRESHOLD     = 10 * 1024 * 1024; // 10 MB
const SAVE_EVERY_N_FILES      = 100;
const SSE_EMIT_EVERY_N        = 5;

const CHECKPOINT_PATH = path.join(
  __dirname, '..', '..', 'database', 'scan-checkpoint.json'
);

const SKIP_DIRS = new Set([
  'system volume information',
  '$recycle.bin',
  'recycler',
  '$windows.~bt',
  '$windows.~ws'
]);

// ─────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────

let scanAborted  = false;
let sseListeners = [];   // array of send() functions from active SSE connections

// ─────────────────────────────────────────────
// CHECKPOINT HELPERS
// ─────────────────────────────────────────────

function emptyCheckpoint(rootPath = '') {
  return {
    phase: 'idle',
    rootPath,
    startedAt: '',
    stats: {
      dirs_scanned:    0,
      files_found:     0,
      already_in_db:   0,
      to_ingest:       0,
      braw_count:      0,
      junk_count:      0,
      ingested:        0,
      ingested_errors: 0,
      braw_stubbed:    0
    },
    currentPath: '',
    files: { to_ingest: [], braw: [], junk: [] },
    errors: []
  };
}

function saveCheckpoint(cp) {
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2), 'utf8');
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'Failed to save checkpoint');
  }
}

function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    }
  } catch (err) {
    logger.warn({ err, module: 'vault-scan' }, 'Could not read checkpoint — starting fresh');
  }
  return emptyCheckpoint();
}

// ─────────────────────────────────────────────
// SSE BROADCAST
// ─────────────────────────────────────────────

function broadcast(data) {
  for (const send of sseListeners) {
    try { send(data); } catch (_) {}
  }
}

// ─────────────────────────────────────────────
// DIRECTORY WALK
// ─────────────────────────────────────────────

async function walkDir(dirPath, cp, filesSinceLastSave) {
  if (scanAborted) return filesSinceLastSave;

  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    // Permission denied or unreadable — skip silently
    logger.warn({ err, dir: dirPath, module: 'vault-scan' }, 'Cannot read dir — skipping');
    return filesSinceLastSave;
  }

  cp.stats.dirs_scanned++;
  cp.currentPath = dirPath;

  let emitCounter = 0;

  for (const entry of entries) {
    if (scanAborted) break;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const lc = entry.name.toLowerCase();
      if (entry.name.startsWith('.') || SKIP_DIRS.has(lc)) continue;
      filesSinceLastSave = await walkDir(fullPath, cp, filesSinceLastSave);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();

    if (BRAW_EXTENSIONS.has(ext)) {
      // BRAW / RAW camera file — add to braw list
      let size = 0;
      try { size = fs.statSync(fullPath).size; } catch (_) {}
      cp.files.braw.push({ path: fullPath, size, name: entry.name });
      cp.stats.braw_count++;
      cp.stats.files_found++;
      filesSinceLastSave++;
      emitCounter++;
    } else if (VIDEO_EXTENSIONS.has(ext)) {
      // Regular video file
      cp.stats.files_found++;
      filesSinceLastSave++;
      emitCounter++;

      // Already in DB?
      if (db.footageFilePathExists(fullPath)) {
        cp.stats.already_in_db++;
      } else {
        // Probe to check duration / detect junk
        let size = 0;
        try { size = fs.statSync(fullPath).size; } catch (_) {}

        let duration = null;
        let probeOk  = false;

        try {
          const metadata = await probeFile(fullPath);
          const fmt = metadata?.format || {};
          duration = parseFloat(fmt.duration) || null;
          probeOk  = true;
        } catch (_) {
          // ffprobe failed — junk if small
        }

        const isJunk = (!probeOk && size < JUNK_SIZE_THRESHOLD) ||
                       (probeOk && duration !== null && duration < JUNK_DURATION_THRESHOLD);

        if (isJunk) {
          cp.files.junk.push({ path: fullPath, size, name: entry.name, duration });
          cp.stats.junk_count++;
        } else {
          cp.files.to_ingest.push({ path: fullPath, size, duration, name: entry.name });
          cp.stats.to_ingest++;
        }
      }
    }

    // Save checkpoint every N files
    if (filesSinceLastSave >= SAVE_EVERY_N_FILES) {
      saveCheckpoint(cp);
      filesSinceLastSave = 0;
    }

    // Emit SSE every N files or on directory change
    if (emitCounter >= SSE_EMIT_EVERY_N) {
      broadcast({
        type:        'progress',
        phase:       cp.phase,
        stats:       cp.stats,
        currentPath: cp.currentPath
      });
      emitCounter = 0;
    }
  }

  // Emit on directory completion
  broadcast({
    type:        'progress',
    phase:       cp.phase,
    stats:       cp.stats,
    currentPath: cp.currentPath
  });

  return filesSinceLastSave;
}

// ─────────────────────────────────────────────
// SCAN RUNNER (background, non-blocking)
// ─────────────────────────────────────────────

async function runScan(rootPath) {
  const cp = emptyCheckpoint(rootPath);
  cp.phase     = 'scanning';
  cp.startedAt = new Date().toISOString();
  saveCheckpoint(cp);

  broadcast({ type: 'started', phase: 'scanning', rootPath });

  try {
    await walkDir(rootPath, cp, 0);
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'Scan walk error');
    cp.errors.push({ time: new Date().toISOString(), message: err.message });
  }

  if (scanAborted) {
    cp.phase = 'idle';
    broadcast({ type: 'cancelled', phase: 'idle' });
  } else {
    cp.phase = 'complete';
    broadcast({ type: 'complete', phase: 'complete', stats: cp.stats });
  }

  cp.currentPath = '';
  saveCheckpoint(cp);
}

// ─────────────────────────────────────────────
// INGEST RUNNER (background)
// ─────────────────────────────────────────────

async function runIngest(cp) {
  cp.phase = 'ingesting';
  saveCheckpoint(cp);

  const toIngest = [...cp.files.to_ingest];
  const total    = toIngest.length;

  broadcast({ type: 'ingest_started', total, phase: 'ingesting' });

  for (let i = 0; i < toIngest.length; i++) {
    if (scanAborted) break;

    const item = toIngest[i];

    try {
      await ingestFile(item.path, {
        onProgress: (msg) => {
          broadcast({ type: 'ingest_progress', file: item.name, message: msg, i, total });
        }
      });
      cp.stats.ingested++;
      broadcast({ type: 'ingest_file_done', file: item.name, i, total, ok: true });
    } catch (err) {
      cp.stats.ingested_errors++;
      cp.errors.push({ time: new Date().toISOString(), file: item.path, message: err.message });
      logger.warn({ err, file: item.path, module: 'vault-scan' }, 'Ingest error — continuing');
      broadcast({ type: 'ingest_file_done', file: item.name, i, total, ok: false, error: err.message });
    }

    saveCheckpoint(cp);
  }

  if (scanAborted) {
    broadcast({ type: 'cancelled', phase: cp.phase });
  } else {
    cp.phase = 'complete';
    broadcast({ type: 'ingest_complete', stats: cp.stats });
  }

  saveCheckpoint(cp);
}

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// POST /start — begin scan
router.post('/start', async (req, res) => {
  try {
    const { rootPath } = req.body || {};
    if (!rootPath) return res.status(400).json({ error: 'rootPath required' });

    const normalized = path.normalize(rootPath);
    if (!fs.existsSync(normalized)) {
      return res.status(400).json({ error: `Path does not exist: ${normalized}` });
    }

    // Reset abort flag and kick off background scan
    scanAborted = false;
    runScan(normalized).catch(err =>
      logger.error({ err, module: 'vault-scan' }, 'runScan uncaught error')
    );

    res.json({ ok: true, rootPath: normalized });
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'POST /start error');
    res.status(500).json({ error: err.message });
  }
});

// GET /progress — SSE stream
router.get('/progress', (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 60 * 60 * 1000 }); // 1h ceiling

  sseListeners.push(send);

  // Send current state immediately so reconnecting clients catch up
  const cp = loadCheckpoint();
  send({ type: 'snapshot', checkpoint: cp });

  req.on('close', () => {
    sseListeners = sseListeners.filter(s => s !== send);
    end();
  });
});

// GET /report — current checkpoint JSON
router.get('/report', (req, res) => {
  try {
    const cp = loadCheckpoint();
    res.json(cp);
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'GET /report error');
    res.status(500).json({ error: err.message });
  }
});

// POST /ingest — start ingestion phase
router.post('/ingest', async (req, res) => {
  try {
    const cp = loadCheckpoint();

    if (cp.files.to_ingest.length === 0) {
      return res.status(400).json({ error: 'No files queued for ingestion. Run a scan first.' });
    }

    scanAborted = false;
    runIngest(cp).catch(err =>
      logger.error({ err, module: 'vault-scan' }, 'runIngest uncaught error')
    );

    res.json({ ok: true, total: cp.files.to_ingest.length });
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'POST /ingest error');
    res.status(500).json({ error: err.message });
  }
});

// POST /ingest-braw — create BRAW stub records
router.post('/ingest-braw', async (req, res) => {
  try {
    const cp = loadCheckpoint();

    if (cp.files.braw.length === 0) {
      return res.json({ ok: true, stubbed: 0, skipped: 0, message: 'No BRAW files in scan results.' });
    }

    let stubbed = 0;
    let skipped = 0;
    const errors = [];

    for (const item of cp.files.braw) {
      if (db.footageFilePathExists(item.path)) {
        skipped++;
        continue;
      }

      try {
        let size = item.size;
        if (!size) {
          try { size = fs.statSync(item.path).size; } catch (_) { size = 0; }
        }

        db.insertFootage({
          file_path:         item.path,
          original_filename: item.name,
          shot_type:         'b-roll',
          braw_source_path:  item.path,
          is_proxy:          0,
          file_size:         size,
          description:       'BRAW source — proxy not yet generated',
          quality_flag:      'review'
        });

        stubbed++;
        cp.stats.braw_stubbed++;
      } catch (err) {
        errors.push({ file: item.path, error: err.message });
        logger.warn({ err, file: item.path, module: 'vault-scan' }, 'BRAW stub insert error');
      }
    }

    saveCheckpoint(cp);

    res.json({ ok: true, stubbed, skipped, errors });
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'POST /ingest-braw error');
    res.status(500).json({ error: err.message });
  }
});

// POST /delete-junk — delete selected junk files from disk
router.post('/delete-junk', async (req, res) => {
  try {
    const { paths } = req.body || {};
    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'paths array required' });
    }

    const deleted = [];
    const failed  = [];

    for (const filePath of paths) {
      // Safety: must be an absolute path and must exist
      if (!path.isAbsolute(filePath)) {
        failed.push({ path: filePath, error: 'Not an absolute path' });
        continue;
      }
      try {
        fs.unlinkSync(filePath);
        deleted.push(filePath);
        logger.info({ file: filePath, module: 'vault-scan' }, 'Junk file deleted');
      } catch (err) {
        failed.push({ path: filePath, error: err.message });
        logger.warn({ err, file: filePath, module: 'vault-scan' }, 'Could not delete junk file');
      }
    }

    // Update checkpoint to remove deleted files from junk list
    try {
      const cp = loadCheckpoint();
      const deletedSet = new Set(deleted);
      cp.files.junk = cp.files.junk.filter(f => !deletedSet.has(f.path));
      cp.stats.junk_count = cp.files.junk.length;
      saveCheckpoint(cp);
    } catch (_) {}

    res.json({ ok: true, deleted: deleted.length, failed });
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'POST /delete-junk error');
    res.status(500).json({ error: err.message });
  }
});

// POST /cancel — abort current operation
router.post('/cancel', (req, res) => {
  try {
    scanAborted = true;
    broadcast({ type: 'cancelling' });

    // Also update checkpoint phase immediately
    try {
      const cp = loadCheckpoint();
      if (cp.phase !== 'idle' && cp.phase !== 'complete') {
        cp.phase = 'idle';
        saveCheckpoint(cp);
      }
    } catch (_) {}

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, module: 'vault-scan' }, 'POST /cancel error');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
