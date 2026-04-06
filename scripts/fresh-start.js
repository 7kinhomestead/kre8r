/**
 * scripts/fresh-start.js
 * Clean-slate the Kre8Ωr database for production use.
 *
 * What it does:
 *   1. Backs up database/kre8r.db → database/kre8r-backup-before-fresh.db
 *   2. Deletes all youtube_import projects (+ cascade: posts, metrics, packages, etc.)
 *   3. Deletes all "test" projects (title contains "test" case-insensitive, or source = 'test')
 *   4. Clears kv_store (MirrΩr/AnalΩzr cache — rebuilds fresh on next run)
 *   5. Leaves creator-profile.json untouched
 *   6. Leaves creator-profile-cari.json untouched (once built)
 *   7. Leaves all native kre8r projects with real pipeline data intact
 *
 * Usage:
 *   node scripts/fresh-start.js
 *   node scripts/fresh-start.js --dry-run   (preview only, no changes)
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DRY_RUN  = process.argv.includes('--dry-run');
const DB_PATH  = path.join(__dirname, '../database/kre8r.db');
const BACKUP   = path.join(__dirname, '../database/kre8r-backup-before-fresh.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('✗ Database not found:', DB_PATH);
  process.exit(1);
}

// ── Backup first ─────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  fs.copyFileSync(DB_PATH, BACKUP);
  console.log('✓ Backup saved →', BACKUP);
} else {
  console.log('  [DRY RUN] Would back up →', BACKUP);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Helper: log + optionally run ─────────────────────────────────────────────
function run(stmt, params = []) {
  if (DRY_RUN) {
    const info = db.prepare(stmt).bind(...params);
    // Just read the affected rows count in dry-run
    return null;
  }
  return db.prepare(stmt).run(...params);
}

function count(stmt, params = []) {
  return db.prepare(stmt).get(...params);
}

// ── 1. YouTube import projects ────────────────────────────────────────────────
const ytCount = count(`SELECT COUNT(*) as n FROM projects WHERE source = 'youtube_import'`).n;
console.log(`\n▶ YouTube import projects: ${ytCount}`);

if (DRY_RUN) {
  const ytList = db.prepare(`SELECT id, title FROM projects WHERE source = 'youtube_import' LIMIT 20`).all();
  ytList.forEach(p => console.log(`  [DRY RUN] Would delete: [${p.id}] ${p.title}`));
} else {
  // Foreign keys + CASCADE handle child rows (pipeline_state, scripts, shots, packages,
  // captions, emails, posts, analytics, cuts, davinci_timelines)
  const r = db.prepare(`DELETE FROM projects WHERE source = 'youtube_import'`).run();
  console.log(`  ✓ Deleted ${r.changes} youtube_import projects (+ all child rows via CASCADE)`);
}

// ── 2. Test projects ──────────────────────────────────────────────────────────
// Word-boundary "test" match: title starts with "test " OR contains " test " OR equals "test"
// Avoids false positives like "Cutest", "Latest", "Fastest", etc.
const TEST_WHERE = `(
  LOWER(title) = 'test'
  OR LOWER(title) LIKE 'test %'
  OR LOWER(title) LIKE '% test'
  OR LOWER(title) LIKE '% test %'
  OR source = 'test'
)`;
const testCount = count(`SELECT COUNT(*) as n FROM projects WHERE ${TEST_WHERE}`).n;
console.log(`\n▶ Test projects: ${testCount}`);

if (DRY_RUN) {
  const testList = db.prepare(
    `SELECT id, title, source FROM projects WHERE ${TEST_WHERE} LIMIT 20`
  ).all();
  testList.forEach(p => console.log(`  [DRY RUN] Would delete: [${p.id}] ${p.title} (source: ${p.source || 'kre8r'})`));
} else {
  const r = db.prepare(`DELETE FROM projects WHERE ${TEST_WHERE}`).run();
  console.log(`  ✓ Deleted ${r.changes} test projects (+ all child rows via CASCADE)`);
}

// ── 3. kv_store (MirrΩr / AnalΩzr cache) ─────────────────────────────────────
const kvCount = count(`SELECT COUNT(*) as n FROM kv_store`).n;
console.log(`\n▶ kv_store entries: ${kvCount}`);

// Show keys before clearing
const kvKeys = db.prepare(`SELECT key FROM kv_store`).all().map(r => r.key);
if (kvKeys.length) kvKeys.forEach(k => console.log(`  – ${k}`));

if (DRY_RUN) {
  console.log(`  [DRY RUN] Would clear all ${kvCount} kv_store entries`);
} else {
  const r = db.prepare(`DELETE FROM kv_store`).run();
  console.log(`  ✓ Cleared ${r.changes} kv_store entries — MirrΩr will rebuild from scratch`);
}

// ── 4. Show surviving native projects ─────────────────────────────────────────
const survivors = db.prepare(
  `SELECT id, title, status, current_stage, source FROM projects ORDER BY created_at DESC`
).all();

console.log(`\n▶ Surviving projects: ${survivors.length}`);
if (survivors.length === 0) {
  console.log('  (none — database is clean)');
} else {
  survivors.forEach(p => {
    const src = p.source ? ` [${p.source}]` : '';
    console.log(`  ✓ [${p.id}] ${p.title} — ${p.current_stage}${src}`);
  });
}

// ── 5. Confirm profile files untouched ────────────────────────────────────────
const profilePath     = path.join(__dirname, '../creator-profile.json');
const cariProfilePath = path.join(__dirname, '../creator-profile-cari.json');
console.log(`\n▶ Profiles:`);
console.log(`  ${fs.existsSync(profilePath) ? '✓ creator-profile.json — untouched' : '⚠ creator-profile.json — not found'}`);
console.log(`  ${fs.existsSync(cariProfilePath) ? '✓ creator-profile-cari.json — untouched' : '  creator-profile-cari.json — not yet built (expected)'}`);

db.close();

console.log(DRY_RUN
  ? '\n[DRY RUN COMPLETE] — no changes made. Remove --dry-run to execute.\n'
  : '\n✓ Fresh start complete.\n'
);
