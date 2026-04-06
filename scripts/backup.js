/**
 * Kre8Ωr — Database Backup
 * Copies database/kre8r.db to database/backups/kre8r-YYYY-MM-DD.db
 * Keeps the last 7 daily backups, removes older ones.
 *
 * Run manually:  node scripts/backup.js
 * Run via PM2:   pm2 start ecosystem.config.js (kre8r-backup cron at 3am daily)
 * Run via cron:  0 3 * * * cd /home/kre8r/kre8r && node scripts/backup.js
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

// In Electron mode the live db is in AppData — fall back to local for PM2/cron runs.
const DB_PATH    = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'kre8r.db');
const BACKUP_DIR = path.join(__dirname, '..', 'database', 'backups');

// ─── Ensure backup dir exists ───────────────────────────────
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`[BACKUP] Created backup directory: ${BACKUP_DIR}`);
}

// ─── Check source DB exists ─────────────────────────────────
if (!fs.existsSync(DB_PATH)) {
  console.error(`[BACKUP] ERROR: Database not found at ${DB_PATH}`);
  process.exit(1);
}

// ─── Hot backup via better-sqlite3 (WAL-safe, works while server is running) ──
const date       = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
const backupPath = path.join(BACKUP_DIR, `kre8r-${date}.db`);

async function runBackup() {
  // ─── Hot backup ──────────────────────────────────────────
  try {
    const db = new Database(DB_PATH, { readonly: true });
    await db.backup(backupPath);
    db.close();
    const sizeMB = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
    console.log(`[BACKUP] ✓ Backed up to ${backupPath} (${sizeMB} MB)`);
  } catch (err) {
    console.error(`[BACKUP] ERROR copying database: ${err.message}`);
    process.exit(1);
  }

  // ─── Rotate: keep only last 7 backups ───────────────────
  try {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^kre8r-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort(); // lexicographic sort = chronological for YYYY-MM-DD

    while (backups.length > 7) {
      const oldest = backups.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, oldest));
      console.log(`[BACKUP] Removed old backup: ${oldest}`);
    }

    console.log(`[BACKUP] ${backups.length} backup(s) retained.`);
  } catch (err) {
    console.error(`[BACKUP] ERROR during rotation: ${err.message}`);
  }
}

runBackup();
