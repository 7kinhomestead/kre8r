/**
 * src/utils/tenant-context.js
 *
 * AsyncLocalStorage-based tenant context.
 * Lets db.js transparently serve the right tenant's DB without
 * passing anything through route function signatures.
 *
 * Usage (in middleware):
 *   tenantContext.run({ db: tenantDb, profile: tenantProfile, slug }, next);
 *
 * Usage (in db.js _get/_all/_run):
 *   const activeDb = tenantContext.getDb();
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const _storage = new AsyncLocalStorage();

/**
 * Run `fn` with a tenant context active.
 * @param {{ db, profile, slug }} ctx
 * @param {Function} fn  — typically Express `next`
 */
function run(ctx, fn) {
  return _storage.run(ctx, fn);
}

/** Returns the active tenant context, or null if on Jason's root instance. */
function getContext() {
  return _storage.getStore() || null;
}

/** Returns the active tenant DB, or null (caller falls back to singleton). */
function getDb() {
  const ctx = getContext();
  return ctx?.db || null;
}

/** Returns the active tenant profile object, or null. */
function getProfile() {
  const ctx = getContext();
  return ctx?.profile || null;
}

/** Returns the active tenant slug, or null. */
function getSlug() {
  const ctx = getContext();
  return ctx?.slug || null;
}

module.exports = { run, getContext, getDb, getProfile, getSlug };
