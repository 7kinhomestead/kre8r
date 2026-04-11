'use strict';
/**
 * profile-validator.js
 * Validates creator-profile.json on load.
 * Returns { ok: true, profile } or { ok: false, errors: [...] }
 *
 * Current schema_version: 1
 * Add migrations below as schema evolves.
 */

const fs   = require('fs');
const path = require('path');

const CURRENT_SCHEMA_VERSION = 1;

// Fields the engine depends on. Missing = hard error.
const REQUIRED = [
  'instance',
  'creator',
  'creator.name',
  'creator.brand',
];

/**
 * Migrate older profiles forward to CURRENT_SCHEMA_VERSION.
 * Each migration mutates the profile object in place and bumps schema_version.
 */
function migrate(profile) {
  const from = profile.schema_version || 0;
  const migrations = [];

  if (from < 1) {
    // v0 → v1: add schema_version field (profile already valid, just stamp it)
    migrations.push('v0→v1: stamped schema_version');
    profile.schema_version = 1;
  }

  return { profile, migrations };
}

/**
 * Get nested value by dot-path e.g. 'creator.name'
 */
function get(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Validate and (if needed) migrate a raw profile object.
 * @param {object} raw - parsed JSON
 * @returns {{ ok: boolean, profile?: object, errors?: string[], warnings?: string[], migrations?: string[] }}
 */
function validateProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['creator-profile.json must be a JSON object'] };
  }

  // Run migrations first so validations run against the migrated shape
  const { profile, migrations } = migrate(raw);

  const errors   = [];
  const warnings = [];

  // Required field checks
  for (const field of REQUIRED) {
    const val = get(profile, field);
    if (val === undefined || val === null || val === '') {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // schema_version sanity check
  if (profile.schema_version > CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Profile schema_version ${profile.schema_version} is newer than this build ` +
      `(supports up to v${CURRENT_SCHEMA_VERSION}). Update Kre8Ωr to use this profile.`
    );
  }

  // Vault path check (non-fatal — Electron app may have different drive letters)
  if (profile.vault && profile.vault.intake_folder) {
    try {
      fs.accessSync(profile.vault.intake_folder, fs.constants.R_OK);
    } catch (_) {
      warnings.push(`Vault intake folder not accessible: "${profile.vault.intake_folder}" — VaultΩr watcher will not start`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, migrations };
  }

  return { ok: true, profile, warnings, migrations };
}

/**
 * Load and validate creator-profile.json from disk.
 * @param {string} [profilePath] - overrides default path
 * @returns {{ ok: boolean, profile?: object, errors?: string[], warnings?: string[], migrations?: string[] }}
 */
function loadProfile(profilePath) {
  const p = profilePath
    || process.env.CREATOR_PROFILE_PATH
    || path.join(path.dirname(path.dirname(__dirname)), 'creator-profile.json');

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, errors: [`creator-profile.json not found at: ${p}`] };
    }
    return { ok: false, errors: [`creator-profile.json parse error: ${err.message}`] };
  }

  return validateProfile(raw);
}

module.exports = { loadProfile, validateProfile, CURRENT_SCHEMA_VERSION };
