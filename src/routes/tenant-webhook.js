/**
 * Tenant-scoped webhook receiver — src/routes/tenant-webhook.js
 *
 * Mounted at /api/tenant/:slug/webhook
 * Each tenant gets their own isolated webhook URL:
 *   kre8r.app/api/tenant/7kin/webhook/kajabi
 *   kre8r.app/api/tenant/othercreator/webhook/kajabi
 *
 * Routes:
 *   POST /api/tenant/:slug/webhook/kajabi   — Kajabi events (member/purchase)
 *   GET  /api/tenant/:slug/webhook/config   — Show this tenant's webhook URL + status
 */

'use strict';

const express = require('express');
const router  = express.Router({ mergeParams: true }); // gives access to :slug
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const log     = require('../utils/logger');

const ML_BASE = 'https://connect.mailerlite.com/api';

// ── Resolve tenant from slug ───────────────────────────────────────────────────
function resolveTenant(req, res, next) {
  const tenant = db.getTenantBySlug(req.params.slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  req.tenant = tenant;
  next();
}

// ── Load tenant's creator profile ─────────────────────────────────────────────
function loadTenantProfile(tenant) {
  const TENANTS_ROOT = process.env.TENANTS_DIR || path.join(__dirname, '../../tenants');
  const profilePath  = path.join(TENANTS_ROOT, tenant.tenant_slug, 'creator-profile.json');
  if (!fs.existsSync(profilePath)) return null;
  try { return JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch (_) { return null; }
}

// ── Mailerlite caller using tenant's API key ───────────────────────────────────
async function mlForTenant(tenant, method, endpoint, body = null) {
  const profile = loadTenantProfile(tenant);
  const apiKey  = profile?.integrations?.mailerlite_api_key
               || process.env.MAILERLITE_API_KEY; // fallback for single-tenant installs

  if (!apiKey) throw new Error('No Mailerlite API key for this tenant');

  const { default: fetch } = await import('node-fetch');
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${ML_BASE}${endpoint}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
  if (!res.ok) throw new Error(data?.message || `Mailerlite ${res.status}`);
  return data;
}

// ── Resolve Mailerlite group ID from event context ────────────────────────────
function resolveGroupId(tenant, profile, eventType, payload) {
  const groups = profile?.integrations?.mailerlite_groups || {};

  if (eventType === 'member.created') return groups.greenhouse;

  if (eventType === 'purchase.created' || eventType === 'offer.purchase') {
    const title = (payload?.product?.title || payload?.offer?.title || '').toLowerCase();
    if (title.includes('founding') || title.includes('297')) return groups.founding50;
    if (title.includes('garden')   || title.includes('19'))  return groups.garden;
    return groups.greenhouse;
  }

  return null;
}

// ── POST /api/tenant/:slug/webhook/kajabi ─────────────────────────────────────
// PUBLIC — no auth, always return 200 (Kajabi retries on non-200)
router.post('/kajabi', resolveTenant, async (req, res) => {
  // Always ACK immediately
  res.status(200).json({ received: true });

  const { tenant } = req;
  const event   = req.body;
  const type    = event?.type || event?.event || 'unknown';
  const email   = event?.member?.email || event?.contact?.email || event?.email;
  const name    = event?.member?.name  || event?.contact?.name  || event?.name || '';

  log.info({ module: 'tenant-webhook', tenant: tenant.tenant_slug, type, email }, 'Kajabi event received');

  // Log to kv_store (last 20 per tenant)
  try {
    const logKey = `kajabi_webhook_log_${tenant.tenant_slug}`;
    const existing = db.getKv(logKey);
    const events   = existing ? JSON.parse(existing) : [];
    events.unshift({ type, email, name, received_at: new Date().toISOString() });
    db.setKv(logKey, JSON.stringify(events.slice(0, 20)));
  } catch (_) {}

  if (!email) return; // can't do anything without an email
  if (type === 'member.removed') return; // log only — don't remove from ML

  try {
    const profile = loadTenantProfile(tenant);
    const groupId = resolveGroupId(tenant, profile, type, event);

    // Step 1: upsert subscriber
    const subPayload = { email };
    if (name) subPayload.fields = { name };
    const result = await mlForTenant(tenant, 'POST', '/subscribers', subPayload);
    const subId  = result?.data?.id;

    // Step 2: assign to group if resolved
    if (groupId && subId) {
      await mlForTenant(tenant, 'POST', `/subscribers/${subId}/groups`, { groups: [groupId] });
    }

    log.info({ module: 'tenant-webhook', tenant: tenant.tenant_slug, email, groupId }, 'Subscriber synced to Mailerlite');
  } catch (err) {
    log.error({ module: 'tenant-webhook', tenant: tenant.tenant_slug, email, err }, 'Mailerlite sync failed');
  }
});

// ── GET /api/tenant/:slug/webhook/config ──────────────────────────────────────
// Session-auth — lets the tenant see their webhook URL and recent events
router.get('/config', resolveTenant, (req, res) => {
  const { tenant } = req;
  const host       = req.headers['x-forwarded-host'] || req.headers.host || 'kre8r.app';
  const protocol   = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const webhookUrl = `${protocol}://${host}/api/tenant/${tenant.tenant_slug}/webhook/kajabi`;

  let recentEvents = [];
  try {
    const logKey = `kajabi_webhook_log_${tenant.tenant_slug}`;
    const raw    = db.getKv(logKey);
    if (raw) recentEvents = JSON.parse(raw);
  } catch (_) {}

  const profile = loadTenantProfile(tenant);
  const groups  = profile?.integrations?.mailerlite_groups || {};

  res.json({
    webhook_url:   webhookUrl,
    groups_synced: Object.keys(groups).length > 0,
    recent_events: recentEvents,
  });
});

module.exports = router;
