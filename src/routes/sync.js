/**
 * Kre8Ωr Sync API — src/routes/sync.js
 *
 * Enables cross-device sync between a desktop Electron app and this server.
 * Each tenant (creator) authenticates with a Bearer sync_token.
 * Data is isolated per tenant — no cross-contamination possible.
 *
 * POST /api/sync/push    — desktop sends its DB export + profile snapshot
 * GET  /api/sync/pull    — desktop requests latest snapshot from server
 * GET  /api/sync/status  — last sync time, token validity check
 *
 * Webhook routing (tenant-scoped, public — no token needed):
 * POST /api/tenant/:slug/webhook/kajabi  — Kajabi events for this tenant
 */

'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('../db');
const log     = require('../utils/logger');

// ── Data directory helpers ─────────────────────────────────────────────────────
const TENANTS_ROOT = process.env.TENANTS_DIR
  || path.join(__dirname, '../../tenants');

function tenantDir(slug) {
  return path.join(TENANTS_ROOT, slug);
}

function ensureTenantDir(slug) {
  const dir = tenantDir(slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Token auth middleware ──────────────────────────────────────────────────────
function requireSyncToken(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Sync token required' });

  const tenant = db.getTenantByToken(token);
  if (!tenant) return res.status(401).json({ error: 'Invalid or inactive sync token' });

  req.tenant = tenant;
  next();
}

// ── GET /api/sync/status ───────────────────────────────────────────────────────
// Desktop checks if it's connected and when it last synced.
router.get('/status', requireSyncToken, (req, res) => {
  const { tenant } = req;
  res.json({
    ok:            true,
    tenant_slug:   tenant.tenant_slug,
    display_name:  tenant.display_name,
    plan:          tenant.plan,
    last_sync_at:  tenant.last_sync_at || null,
    server_time:   new Date().toISOString(),
  });
});

// ── POST /api/sync/push ────────────────────────────────────────────────────────
// Desktop sends a snapshot of its current state to the server.
// Body: { db_export: {...}, profile: {...}, pushed_at: ISO string }
router.post('/push', requireSyncToken, (req, res) => {
  const { tenant } = req;
  const { db_export, profile, pushed_at } = req.body || {};

  if (!db_export && !profile) {
    return res.status(400).json({ error: 'Nothing to push — send db_export and/or profile' });
  }

  try {
    const dir = ensureTenantDir(tenant.tenant_slug);
    const snapshot = {
      tenant_slug: tenant.tenant_slug,
      pushed_at:   pushed_at || new Date().toISOString(),
      db_export:   db_export || null,
      profile:     profile   || null,
    };

    const snapshotPath = path.join(dir, 'snapshot.json');
    const payloadKb    = Buffer.byteLength(JSON.stringify(snapshot)) / 1024;

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

    db.updateTenantLastSync(tenant.id);
    db.logSync(tenant.id, 'push', payloadKb, 'ok');

    log.info({ module: 'sync', tenant: tenant.tenant_slug, payload_kb: Math.round(payloadKb) }, 'Push received');
    res.json({ ok: true, received_at: new Date().toISOString(), payload_kb: Math.round(payloadKb) });
  } catch (err) {
    db.logSync(tenant.id, 'push', 0, 'error', err.message);
    log.error({ module: 'sync', tenant: tenant.tenant_slug, err }, 'Push failed');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sync/pull ─────────────────────────────────────────────────────────
// Desktop requests the latest snapshot from the server.
router.get('/pull', requireSyncToken, (req, res) => {
  const { tenant } = req;

  try {
    const snapshotPath = path.join(tenantDir(tenant.tenant_slug), 'snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      return res.json({ ok: true, snapshot: null, message: 'No snapshot yet — push first from your primary device.' });
    }

    const snapshot   = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const payloadKb  = Buffer.byteLength(JSON.stringify(snapshot)) / 1024;

    db.logSync(tenant.id, 'pull', payloadKb, 'ok');

    log.info({ module: 'sync', tenant: tenant.tenant_slug, payload_kb: Math.round(payloadKb) }, 'Pull served');
    res.json({ ok: true, snapshot });
  } catch (err) {
    db.logSync(tenant.id, 'pull', 0, 'error', err.message);
    log.error({ module: 'sync', tenant: tenant.tenant_slug, err }, 'Pull failed');
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sync/register ────────────────────────────────────────────────────
// Creates a new tenant. Protected by operator secret.
// In production this becomes the onboarding flow.
router.post('/register', (req, res) => {
  const operatorSecret = process.env.OPERATOR_SECRET;
  const { secret, tenant_slug, display_name, plan = 'solo' } = req.body || {};

  // If OPERATOR_SECRET is set, require it. Otherwise open (dev mode).
  if (operatorSecret && secret !== operatorSecret) {
    return res.status(403).json({ error: 'Invalid operator secret' });
  }

  if (!tenant_slug || !display_name) {
    return res.status(400).json({ error: 'tenant_slug and display_name are required' });
  }

  // Validate slug: lowercase letters, numbers, hyphens only
  if (!/^[a-z0-9-]{2,32}$/.test(tenant_slug)) {
    return res.status(400).json({ error: 'tenant_slug must be 2-32 chars: lowercase letters, numbers, hyphens only' });
  }

  try {
    const existing = db.getTenantBySlug(tenant_slug);
    if (existing) return res.status(409).json({ error: 'That tenant slug is already taken' });

    const sync_token = crypto.randomBytes(32).toString('hex');
    db.createTenant({ tenant_slug, display_name, sync_token, plan });
    ensureTenantDir(tenant_slug);

    log.info({ module: 'sync', tenant: tenant_slug }, 'Tenant registered');
    res.status(201).json({
      ok:           true,
      tenant_slug,
      display_name,
      sync_token,
      sync_url:     `/api/sync`,
      webhook_base: `/api/tenant/${tenant_slug}/webhook`,
      message:      'Save your sync_token — it cannot be recovered if lost.',
    });
  } catch (err) {
    log.error({ module: 'sync', err }, 'Tenant registration failed');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sync/tenants — operator view ─────────────────────────────────────
router.get('/tenants', (req, res) => {
  const operatorSecret = process.env.OPERATOR_SECRET;
  const auth = req.headers['x-operator-secret'] || req.query.secret;
  if (operatorSecret && auth !== operatorSecret) {
    return res.status(403).json({ error: 'Operator access required' });
  }
  try {
    const tenants = db.getAllTenants().map(t => ({
      ...t,
      sync_token: '[redacted]', // never expose tokens in list view
    }));
    res.json({ tenants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sync/token — retrieve token for a tenant (operator only) ─────────
// Allows the operator to recover a token if it was lost from the startup log.
// Protected by OPERATOR_SECRET — never expose without it.
router.get('/token', (req, res) => {
  const operatorSecret = process.env.OPERATOR_SECRET;
  const auth = req.headers['x-operator-secret'] || req.query.secret;
  if (operatorSecret && auth !== operatorSecret) {
    return res.status(403).json({ error: 'Operator access required' });
  }
  try {
    const tenants = db.getAllTenants();
    if (!tenants.length) return res.status(404).json({ error: 'No tenants registered yet' });
    // Return all tenants with real tokens — operator use only
    res.json({ tenants: tenants.map(t => ({
      tenant_slug:  t.tenant_slug,
      display_name: t.display_name,
      sync_token:   t.sync_token,
      plan:         t.plan,
      active:       t.active,
      last_sync_at: t.last_sync_at,
    }))});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
