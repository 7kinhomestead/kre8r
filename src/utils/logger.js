'use strict';
/**
 * logger.js
 * Structured logging for Kre8Ωr.
 *
 * Dev: pretty-printed to console.
 * Production / Electron: JSON to rotating log file in userData/logs/
 *
 * Usage:
 *   const log = require('./src/utils/logger');
 *   log.info({ module: 'vault' }, 'Watcher started');
 *   log.error({ err, module: 'claude' }, 'API call failed');
 */

const pino = require('pino');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Determine log directory ────────────────────────────────────────────────
// Priority: LOG_DIR env var → Electron userData/logs → project logs/ dir
function resolveLogDir() {
  if (process.env.LOG_DIR) return process.env.LOG_DIR;

  // Electron sets ELECTRON=true and DB_PATH points into userData — derive from there
  if (process.env.ELECTRON === 'true') {
    const userDataDir = path.dirname(process.env.DB_PATH || path.join(os.homedir(), '.kre8r', 'kre8r.db'));
    return path.join(userDataDir, 'logs');
  }

  // Dev/PM2 — write next to the project root
  return path.join(path.dirname(path.dirname(__dirname)), 'logs');
}

const LOG_DIR = resolveLogDir();

// Ensure log directory exists (sync — happens at boot)
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}

const LOG_FILE = path.join(LOG_DIR, 'kre8r.log');

// ── Keep last 7 days worth of logs ────────────────────────────────────────
// Simple size-based guard: if file > 10 MB, rotate (rename → kre8r.log.1)
function maybeRotate() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 10 * 1024 * 1024) {
      const rotated = `${LOG_FILE}.${Date.now()}`;
      fs.renameSync(LOG_FILE, rotated);
      // Keep only the last 3 rotated files
      const old = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('kre8r.log.'))
        .map(f => path.join(LOG_DIR, f))
        .sort();
      while (old.length > 3) {
        try { fs.unlinkSync(old.shift()); } catch (_) {}
      }
    }
  } catch (_) { /* file doesn't exist yet — fine */ }
}

maybeRotate();

// ── Build pino instance ────────────────────────────────────────────────────
// Always write JSON to file (for diagnostics / crash recovery).
// In dev, also pretty-print to stdout.
const isDev = process.env.NODE_ENV !== 'production' && process.env.ELECTRON !== 'true';

const fileDest = pino.destination({ dest: LOG_FILE, sync: false });

let logger;

if (isDev) {
  // Multi-stream: JSON → file, pretty → stdout
  const streams = pino.multistream([
    { stream: fileDest },
    {
      stream: require('pino-pretty')({
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss',
      })
    }
  ]);
  logger = pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    streams
  );
} else {
  // JSON to file only in production / Electron
  logger = pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    fileDest
  );
}

// ── Diagnostic snapshot ────────────────────────────────────────────────────
// Read last N lines from the log file (for the "Copy Diagnostic Info" feature).
logger.getRecentLines = function getRecentLines(n = 100) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n');
    return lines.slice(-n).join('\n');
  } catch (_) {
    return '';
  }
};

logger.logFilePath = LOG_FILE;

module.exports = logger;
