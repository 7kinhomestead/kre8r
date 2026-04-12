/**
 * prebuild-sqlite.js
 * Ensures better-sqlite3 has the correct Electron prebuilt binary (NMV 145 / Electron 41).
 * Uses a stamp file so the download only happens when the binary actually needs to change.
 * Safe to run on every `npm run electron` launch — instant if already correct.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ELECTRON_VERSION = '41.1.1';
const ARCH             = 'x64';
const PKG_DIR          = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
const BINARY           = path.join(PKG_DIR, 'build', 'Release', 'better_sqlite3.node');
const STAMP            = path.join(__dirname, '.sqlite-mode');
const TARGET_STAMP     = `electron-${ELECTRON_VERSION}`;

// ── Already correct? ───────────────────────────────────────────────────────────
const currentStamp = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf8').trim() : '';
if (currentStamp === TARGET_STAMP && fs.existsSync(BINARY)) {
  console.log('[prebuild-sqlite] Already built for Electron — skipping.');
  process.exit(0);
}

console.log(`[prebuild-sqlite] Stamp is "${currentStamp}", need "${TARGET_STAMP}" — rebuilding.`);

// ── Install Electron prebuilt ──────────────────────────────────────────────────
const prebuildInstall = path.join(PKG_DIR, 'node_modules', '.bin', 'prebuild-install');
const fallbackBin     = path.join(__dirname, '..', 'node_modules', '.bin', 'prebuild-install');
const bin             = fs.existsSync(prebuildInstall) ? prebuildInstall : fallbackBin;

const cmd = `"${bin}" --runtime electron --target ${ELECTRON_VERSION} --arch ${ARCH}`;
console.log('[prebuild-sqlite] Running:', cmd);

// Backup existing binary so we can restore on failure
const BACKUP = BINARY + '.bak';
if (fs.existsSync(BINARY)) fs.copyFileSync(BINARY, BACKUP);

try {
  execSync(cmd, { cwd: PKG_DIR, stdio: 'inherit' });
  if (!fs.existsSync(BINARY)) throw new Error('Binary not found after install');
  // Write stamp on success
  fs.writeFileSync(STAMP, TARGET_STAMP, 'utf8');
  if (fs.existsSync(BACKUP)) fs.unlinkSync(BACKUP);
  console.log('[prebuild-sqlite] Done — binary ready for Electron', ELECTRON_VERSION);
} catch (err) {
  console.error('[prebuild-sqlite] prebuild-install failed:', err.message);
  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, BINARY);
    fs.unlinkSync(BACKUP);
    console.warn('[prebuild-sqlite] Restored previous binary — proceeding anyway.');
    // Don't update stamp — will retry next launch
  } else {
    process.exit(1);
  }
}
