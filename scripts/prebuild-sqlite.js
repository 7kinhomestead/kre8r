/**
 * prebuild-sqlite.js
 * Installs the correct better-sqlite3 prebuilt binary for Electron 41 (NMV 145).
 * Must run before electron-builder to prevent ABI mismatch in the packaged app.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ELECTRON_VERSION = '41.1.1';
const ARCH = 'x64';
const PKG_DIR = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
const BINARY = path.join(PKG_DIR, 'build', 'Release', 'better_sqlite3.node');

// Delete the existing binary so prebuild-install can replace it
if (fs.existsSync(BINARY)) {
  fs.unlinkSync(BINARY);
  console.log('[prebuild-sqlite] Removed existing binary.');
}

const prebuildInstall = path.join(PKG_DIR, 'node_modules', '.bin', 'prebuild-install');
const fallbackBin = path.join(__dirname, '..', 'node_modules', '.bin', 'prebuild-install');
const bin = fs.existsSync(prebuildInstall) ? prebuildInstall : fallbackBin;

const cmd = `"${bin}" --runtime electron --target ${ELECTRON_VERSION} --arch ${ARCH}`;
console.log('[prebuild-sqlite] Installing Electron prebuilt:', cmd);

try {
  execSync(cmd, { cwd: PKG_DIR, stdio: 'inherit' });
  if (fs.existsSync(BINARY)) {
    console.log('[prebuild-sqlite] Success — binary installed at', BINARY);
  } else {
    console.error('[prebuild-sqlite] ERROR: Binary not found after install.');
    process.exit(1);
  }
} catch (err) {
  console.error('[prebuild-sqlite] prebuild-install failed:', err.message);
  process.exit(1);
}
