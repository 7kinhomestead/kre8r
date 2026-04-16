/**
 * src/routes/onboarding.js
 *
 * Handles the beta creator onboarding flow.
 *
 * GET  /api/onboarding/verify?token=xxx   → verify invite token, return slug + partial profile
 * POST /api/onboarding/save               → save completed soul config + create user account
 */

'use strict';

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db');

const {
  verifyInviteToken,
  completeOnboarding,
  loadTenantProfile,
  getTenantDb,
} = require('../utils/tenant-db-cache');

const tenantContext = require('../utils/tenant-context');

// ─────────────────────────────────────────────
// VERIFY TOKEN
// ─────────────────────────────────────────────
router.get('/verify', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });

    const slug = verifyInviteToken(token);
    if (!slug) return res.status(404).json({ error: 'Invalid or expired invite token' });

    const profile = loadTenantProfile(slug);
    if (!profile) return res.status(404).json({ error: 'Tenant not found' });

    if (profile.onboarding_complete) {
      return res.status(400).json({ error: 'This invite has already been used. Contact Jason to get a new one.' });
    }

    res.json({
      ok:           true,
      slug,
      display_name: profile.name || profile.brand || slug,
      email:        profile.email || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SAVE COMPLETED ONBOARDING
// ─────────────────────────────────────────────
router.post('/save', async (req, res) => {
  try {
    const {
      token,
      name,
      brand,
      email,
      platforms,
      content_angles,
      voice_profile,
      community,
      anthropic_api_key,
      mailerlite_api_key,
      password,
    } = req.body;

    if (!token)    return res.status(400).json({ error: 'token required' });
    if (!password) return res.status(400).json({ error: 'password required' });
    if (!name)     return res.status(400).json({ error: 'name required' });

    const slug = verifyInviteToken(token);
    if (!slug) return res.status(404).json({ error: 'Invalid or expired invite token' });

    const existing = loadTenantProfile(slug);
    if (!existing) return res.status(404).json({ error: 'Tenant not found' });

    if (existing.onboarding_complete) {
      return res.status(400).json({ error: 'Onboarding already completed' });
    }

    // ── 1. Build updated soul profile ────────────────────────────────────────
    const profileUpdate = {
      name:            name.trim(),
      brand:           (brand || name).trim(),
      email:           (email || existing.email || '').trim(),
      platforms:       platforms  || existing.platforms,
      content_angles:  content_angles || [],
      voice_profile:   voice_profile || '',
      community:       community || existing.community,
      anthropic_api_key: anthropic_api_key || '',
      integrations: {
        ...(existing.integrations || {}),
        mailerlite_api_key: mailerlite_api_key || '',
      },
    };

    // ── 2. Create user account in the tenant's DB ─────────────────────────────
    const tenantDb = getTenantDb(slug);
    if (!tenantDb) return res.status(500).json({ error: 'Tenant DB not available' });

    const password_hash = await bcrypt.hash(password, 12);
    const username      = (email || name).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);

    // Run the user creation inside the tenant's DB context
    tenantContext.run({ db: tenantDb, profile: profileUpdate, slug }, () => {
      try {
        // Check if a user already exists
        const existingUser = db.getUserByUsername(username);
        if (!existingUser) {
          db.createUser({ username, password_hash, role: 'owner' });
        }
      } catch (userErr) {
        // Non-fatal — user might already exist from a previous partial attempt
        console.warn(`[Onboarding] User create warning for ${slug}:`, userErr.message);
      }
    });

    // ── 3. Mark onboarding complete + clear token ─────────────────────────────
    completeOnboarding(slug, profileUpdate);

    // ── 4. Auto-login: set session ────────────────────────────────────────────
    // Run getUserByUsername in tenant context to get the correct user id
    let userId   = null;
    let userRole = 'owner';
    tenantContext.run({ db: tenantDb, profile: profileUpdate, slug }, () => {
      const user = db.getUserByUsername(username);
      if (user) { userId = user.id; userRole = user.role; }
    });

    if (userId) {
      req.session.userId   = userId;
      req.session.username = username;
      req.session.role     = userRole;
      await new Promise((resolve, reject) =>
        req.session.save(err => err ? reject(err) : resolve())
      );
    }

    res.json({
      ok:       true,
      slug,
      username,
      redirect: '/',
    });
  } catch (err) {
    console.error('[Onboarding] save error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
