#!/usr/bin/env node
/**
 * Kre8Ωr — Create User (console bootstrap script)
 *
 * Usage:
 *   node scripts/create-user.js <username> <password> [role]
 *
 * Roles: owner | viewer  (default: viewer)
 *
 * Examples:
 *   node scripts/create-user.js cari mypassword viewer
 *   node scripts/create-user.js admin secretpass owner
 *
 * Run this on the server via SSH when you can't access the web UI yet.
 * Safe to run while the server is stopped — writes directly to the DB file.
 * DO NOT run while the live server is holding a write lock unless you're certain.
 */

'use strict';

const path    = require('path');
const bcrypt  = require('bcryptjs');
const Database = require('better-sqlite3');

const [,, username, password, role = 'viewer'] = process.argv;

if (!username || !password) {
  console.error('Usage: node scripts/create-user.js <username> <password> [role]');
  console.error('Roles: owner | viewer  (default: viewer)');
  process.exit(1);
}

const validRoles = ['owner', 'viewer', 'creator'];
if (!validRoles.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}`);
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'kre8r.db');

if (!require('fs').existsSync(DB_PATH)) {
  console.error(`DB not found at: ${DB_PATH}`);
  console.error('Make sure the server has run at least once to initialize the schema.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Check if user already exists
const existing = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(username.toLowerCase());
if (existing) {
  console.error(`User "${username}" already exists (id=${existing.id}, role=${existing.role})`);
  console.error('To update their password, use the admin panel or run with a different username.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
  .run(username.toLowerCase(), hash, role);

console.log(`✓ Created user: ${username.toLowerCase()} (id=${result.lastInsertRowid}, role=${role})`);
console.log('They can now log in at /login');
