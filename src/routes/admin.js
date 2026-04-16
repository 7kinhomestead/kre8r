/**
 * src/routes/admin.js
 *
 * Kre8Ωr operator admin panel — Jason only.
 * Manages beta creator tenants: provision, invite, monitor.
 *
 * GET  /admin                        → admin.html (owner role only)
 * GET  /api/admin/tenants            → list all provisioned tenants
 * POST /api/admin/tenants            → provision new tenant, return invite link
 * GET  /api/admin/tenants/:slug      → single tenant detail + token usage
 * DELETE /api/admin/tenants/:slug    → deactivate tenant (soft)
 * POST /api/admin/tenants/:slug/reinvite → generate fresh invite token
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const db       = require('../db');

const {
  listTenants,
  provisionTenant,
  loadTenantProfile,
  saveTenantProfile,
  tenantDir,
  TENANTS_ROOT,
} = require('../utils/tenant-db-cache');

// ── Owner-only guard ──────────────────────────────────────────────────────────
function requireOwner(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session?.role !== 'owner') return res.status(403).json({ error: 'Owner role required' });
  next();
}

// ─────────────────────────────────────────────
// LIST TENANTS
// ─────────────────────────────────────────────
router.get('/tenants', requireOwner, (req, res) => {
  try {
    const tenants = listTenants();

    // Enrich with token usage from main DB if available
    const enriched = tenants.map(t => {
      try {
        const usage = db.getTokenUsageByTenant ? db.getTokenUsageByTenant(t.slug) : null;
        return { ...t, token_usage: usage };
      } catch (_) {
        return t;
      }
    });

    res.json({ ok: true, tenants: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PROVISION NEW TENANT
// ─────────────────────────────────────────────
router.post('/tenants', requireOwner, (req, res) => {
  try {
    const { slug, display_name, email = '' } = req.body;

    if (!slug || !display_name) {
      return res.status(400).json({ error: 'slug and display_name are required' });
    }

    const { inviteToken, dir } = provisionTenant({ slug, displayName: display_name, email });

    // Derive invite URL from the request origin
    const host    = req.get('host') || 'kre8r.app';
    // Invite link goes to the tenant's own subdomain
    const baseUrl = `https://${slug}.kre8r.app`;
    const inviteUrl = `${baseUrl}/onboarding?token=${inviteToken}`;

    res.json({
      ok: true,
      slug,
      display_name,
      invite_url:   inviteUrl,
      invite_token: inviteToken,
      dir,
      message: `Tenant "${slug}" provisioned. Send them this link: ${inviteUrl}`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SINGLE TENANT DETAIL
// ─────────────────────────────────────────────
router.get('/tenants/:slug', requireOwner, (req, res) => {
  try {
    const { slug } = req.params;
    const profile  = loadTenantProfile(slug);
    if (!profile) return res.status(404).json({ error: 'Tenant not found' });

    const dir     = tenantDir(slug);
    const dbPath  = path.join(dir, 'kre8r.db');
    const dbStats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;

    res.json({
      ok: true,
      slug,
      profile: {
        name:                profile.name,
        brand:               profile.brand,
        email:               profile.email,
        onboarding_complete: profile.onboarding_complete,
        content_angles:      profile.content_angles,
        platforms:           profile.platforms,
        has_api_key:         !!profile.anthropic_api_key,
      },
      db_size_kb:  dbStats ? Math.round(dbStats.size / 1024) : 0,
      modified_at: dbStats?.mtime?.toISOString() || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// REGENERATE INVITE TOKEN
// ─────────────────────────────────────────────
router.post('/tenants/:slug/reinvite', requireOwner, (req, res) => {
  try {
    const { slug }   = req.params;
    const profile    = loadTenantProfile(slug);
    if (!profile) return res.status(404).json({ error: 'Tenant not found' });

    const newToken = crypto.randomBytes(24).toString('hex');
    saveTenantProfile(slug, { ...profile, invite_token: newToken, onboarding_complete: false });

    const inviteUrl = `https://${slug}.kre8r.app/onboarding?token=${newToken}`;
    res.json({ ok: true, invite_url: inviteUrl, invite_token: newToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DEACTIVATE TENANT
// ─────────────────────────────────────────────
router.delete('/tenants/:slug', requireOwner, (req, res) => {
  try {
    const { slug } = req.params;
    const profile  = loadTenantProfile(slug);
    if (!profile) return res.status(404).json({ error: 'Tenant not found' });

    saveTenantProfile(slug, { ...profile, deactivated: true, deactivated_at: new Date().toISOString() });
    res.json({ ok: true, message: `Tenant "${slug}" deactivated. Data preserved.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
