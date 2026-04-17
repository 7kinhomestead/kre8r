/**
 * src/utils/tenant-db-cache.js
 *
 * Opens, migrates, and caches per-tenant SQLite DB instances.
 * Each beta creator has their own DB at tenants/{slug}/kre8r.db.
 *
 * getTenantDb(slug) → better-sqlite3 instance (cached after first open)
 * loadTenantProfile(slug) → parsed creator-profile.json for that tenant
 * provisionTenant({ slug, displayName }) → creates folder + DB + starter profile
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const SCHEMA_PATH   = path.join(__dirname, '..', '..', 'database', 'schema.sql');
const TENANTS_ROOT  = process.env.TENANTS_DIR || path.join(__dirname, '..', '..', 'tenants');
const TEMPLATE_DB   = path.join(__dirname, '..', '..', 'database', 'kre8r-template.db');

// In-memory cache: slug → { db, profile, loadedAt }
const _cache = new Map();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function tenantDir(slug) {
  return path.join(TENANTS_ROOT, slug);
}

function tenantDbPath(slug) {
  return path.join(tenantDir(slug), 'kre8r.db');
}

function tenantProfilePath(slug) {
  return path.join(tenantDir(slug), 'creator-profile.json');
}

function tenantEnvPath(slug) {
  return path.join(tenantDir(slug), '.env');
}

/** Open, configure, and return a better-sqlite3 instance for a tenant. */
function openTenantDb(slug) {
  const dbPath = tenantDbPath(slug);
  if (!fs.existsSync(dbPath)) return null;

  const tdb = new Database(dbPath);
  tdb.pragma('journal_mode = WAL');
  tdb.pragma('foreign_keys = ON');
  tdb.pragma('synchronous = NORMAL');

  // Apply base schema (14 original tables)
  if (fs.existsSync(SCHEMA_PATH)) {
    try { tdb.exec(fs.readFileSync(SCHEMA_PATH, 'utf8')); } catch (_) {}
  }

  // Apply all migration-added tables and columns so tenant DB is fully up-to-date.
  // bootstrapTenantTables is idempotent — safe to call on every open.
  try {
    const { bootstrapTenantTables } = require('../db');
    bootstrapTenantTables(tdb);
  } catch (e) {
    console.warn('[tenant-db] bootstrapTenantTables failed (non-fatal):', e.message);
  }

  return tdb;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Get (or open + cache) the DB for a tenant slug.
 * Returns null if the tenant directory/db doesn't exist.
 */
function getTenantDb(slug) {
  if (!slug) return null;
  if (_cache.has(slug)) return _cache.get(slug).db;

  const tdb = openTenantDb(slug);
  if (!tdb) return null;

  const profile = loadTenantProfile(slug);
  _cache.set(slug, { db: tdb, profile, loadedAt: Date.now() });
  return tdb;
}

/**
 * Load a tenant's creator-profile.json.
 * Returns null if file doesn't exist.
 */
function loadTenantProfile(slug) {
  const profilePath = tenantProfilePath(slug);
  if (!fs.existsSync(profilePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Save (or update) a tenant's creator-profile.json.
 * Invalidates the in-memory cache entry.
 */
function saveTenantProfile(slug, profile) {
  const profilePath = tenantProfilePath(slug);
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
  // Invalidate cache so next request picks up new profile
  if (_cache.has(slug)) {
    const entry = _cache.get(slug);
    entry.profile = profile;
  }
}

/**
 * List all provisioned tenants (slugs with a kre8r.db file).
 */
function listTenants() {
  if (!fs.existsSync(TENANTS_ROOT)) return [];
  return fs.readdirSync(TENANTS_ROOT)
    .filter(slug => fs.existsSync(tenantDbPath(slug)))
    .map(slug => {
      const profile = loadTenantProfile(slug) || {};
      const stats   = fs.statSync(tenantDbPath(slug));
      return {
        slug,
        display_name:  profile.name || profile.brand || slug,
        brand:         profile.brand || slug,
        db_size_kb:    Math.round(stats.size / 1024),
        modified_at:   stats.mtime.toISOString(),
        profile_complete: !!profile.onboarding_complete,
      };
    });
}

/**
 * Provision a new tenant:
 *   - Creates tenants/{slug}/ directory
 *   - Copies template DB (or creates fresh DB)
 *   - Writes a starter creator-profile.json
 *   - Writes a .env stub
 *   - Returns { slug, inviteToken }
 */
function provisionTenant({ slug, displayName, email = '' }) {
  if (!/^[a-z0-9-]{2,32}$/.test(slug)) {
    throw new Error('Slug must be 2-32 chars, lowercase letters, numbers, hyphens only');
  }

  const dir = tenantDir(slug);
  if (fs.existsSync(dir) && fs.existsSync(tenantDbPath(slug))) {
    throw new Error(`Tenant "${slug}" already exists`);
  }

  fs.mkdirSync(dir, { recursive: true });

  // Copy template DB if it exists, otherwise let openTenantDb create fresh
  if (fs.existsSync(TEMPLATE_DB)) {
    fs.copyFileSync(TEMPLATE_DB, tenantDbPath(slug));
  } else {
    // Create blank DB with schema applied
    const tdb = openTenantDb(slug); // openTenantDb will apply schema
    if (tdb) tdb.close();
  }

  // Generate invite token
  const inviteToken = crypto.randomBytes(24).toString('hex');

  // Starter profile
  const starterProfile = {
    schema_version: 3,
    name:           displayName,
    brand:          displayName,
    email:          email,
    onboarding_complete: false,
    invite_token:   inviteToken,
    purpose:        'Content creator using Kre8Ωr to produce and distribute videos.',
    platforms: { tiktok: '', youtube: '', instagram: '', lemon8: '' },
    content_angles: [],
    voice_profile:  '',
    community:      { platform: '', name: '', tiers: [] },
    integrations:   { mailerlite_api_key: '', kajabi: {} },
    voice_profiles: [],
  };

  fs.writeFileSync(tenantProfilePath(slug), JSON.stringify(starterProfile, null, 2), 'utf8');

  // .env stub
  const envContent = [
    `# Kre8Ωr tenant: ${slug}`,
    `ANTHROPIC_API_KEY=`,
    `MAILERLITE_FROM_EMAIL=`,
    `MAILERLITE_FROM_NAME=${displayName}`,
    `MAILERLITE_API_KEY=`,
  ].join('\n') + '\n';
  fs.writeFileSync(tenantEnvPath(slug), envContent, 'utf8');

  return { slug, inviteToken, dir };
}

/**
 * Verify an invite token against a tenant's profile.
 * Returns the slug if valid, null if not found/expired.
 */
function verifyInviteToken(token) {
  if (!fs.existsSync(TENANTS_ROOT)) return null;
  const slugs = fs.readdirSync(TENANTS_ROOT);
  for (const slug of slugs) {
    const profile = loadTenantProfile(slug);
    if (profile?.invite_token === token) return slug;
  }
  return null;
}

/**
 * Mark onboarding complete and clear the invite token.
 */
function completeOnboarding(slug, profileUpdates) {
  const existing = loadTenantProfile(slug) || {};
  const updated  = {
    ...existing,
    ...profileUpdates,
    onboarding_complete: true,
    invite_token: null, // consumed
  };
  saveTenantProfile(slug, updated);
}

module.exports = {
  getTenantDb,
  loadTenantProfile,
  saveTenantProfile,
  listTenants,
  provisionTenant,
  verifyInviteToken,
  completeOnboarding,
  tenantDir,
  TENANTS_ROOT,
};
