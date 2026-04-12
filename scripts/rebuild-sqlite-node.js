/**
 * rebuild-sqlite-node.js
 * Ensures better-sqlite3 is built for system Node (for npm start / npm run dev).
 * Uses a stamp file — instant if already correct.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const PKG_DIR = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
const BINARY  = path.join(PKG_DIR, 'build', 'Release', 'better_sqlite3.node');
const STAMP   = path.join(__dirname, '.sqlite-mode');
const TARGET  = 'node';

const current = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf8').trim() : '';
if (current === TARGET && fs.existsSync(BINARY)) {
  console.log('[rebuild-sqlite] Already built for Node — skipping.');
  process.exit(0);
}

console.log(`[rebuild-sqlite] Stamp is "${current}", need "${TARGET}" — rebuilding.`);

try {
  execSync('npm rebuild better-sqlite3', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  fs.writeFileSync(STAMP, TARGET, 'utf8');
  console.log('[rebuild-sqlite] Done — binary ready for Node.');
} catch (err) {
  console.error('[rebuild-sqlite] rebuild failed:', err.message);
  process.exit(1);
}
