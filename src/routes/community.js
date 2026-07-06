'use strict';
/**
 * Community Intelligence — AudiencΩr (Session 81)
 * Receives weekly MCP snapshots from Claude Desktop and serves community health data.
 *
 * POST /api/community/sync        — Claude pushes member snapshot (INTERNAL_API_KEY)
 * GET  /api/community/health      — dashboard summary
 * GET  /api/community/warm-leads  — warm leads list
 * PATCH /api/community/warm-leads/:id — update DM status/outcome
 * GET  /api/community/events      — recent event log
 * GET  /api/community/movers      — score delta since last snapshot
 * POST /api/community/events      — log a manual event (INTERNAL_API_KEY)
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const logger  = require('../utils/logger');

const INTERNAL_KEY = process.env.INTERNAL_API_KEY;

function requireInternal(req, res, next) {
  const key = req.headers['x-internal-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!INTERNAL_KEY || key !== INTERNAL_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────────────────────────────────────────
// POST /api/community/sync
// Receives full member list from Claude Desktop MCP session.
// Body: { members: [...], metrics: {...}, snapshot_date: 'YYYY-MM-DD' }
// ─────────────────────────────────────────────
router.post('/sync', requireInternal, (req, res) => {
  try {
    const { members = [], metrics = {}, snapshot_date,
            founding50_ids = [], garden_ids = [] } = req.body;
    const date = snapshot_date || new Date().toISOString().slice(0, 10);

    if (!members.length) {
      return res.status(400).json({ error: 'members array is required' });
    }

    // Build tier lookup sets from the explicit tier lists Claude passes
    const founding50Set = new Set(founding50_ids);
    const gardenSet     = new Set(garden_ids);

    let upserted = 0;
    let new_members = 0;
    let score_ups = 0;
    let tier_corrections = 0;
    const events = [];

    for (const m of members) {
      // Apply tier overrides — founding50 wins over garden wins over greenhouse
      if (founding50Set.has(m.id)) {
        if (m.tier !== 'founding50') tier_corrections++;
        m.tier = 'founding50';
      } else if (gardenSet.has(m.id)) {
        if (m.tier !== 'garden') tier_corrections++;
        m.tier = 'garden';
      }
      const existing = db.getCommunityMember(m.id);

      // AUD-1 fix: detect first-time post by DELTA — not just new members
      // Previously only fired for brand-new members (!existing), but after the first sync
      // every member becomes 'existing' forever, so this never fired again
      // The fix: also fire when an existing member's post count moves from 0 to >0
      const isFirstPost = m.posts_count > 0 && (
        !existing ||
        (existing.posts_count === 0 && m.posts_count > 0)  // ← the delta pattern (mirrors score_moved below)
      );
      if (isFirstPost) {
        events.push({ event_type: 'first_post', member_id: m.id,
          kajabi_user_id: m.kajabi_user_id, member_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
          metadata: { posts_count: m.posts_count } });
      }

      // Detect new member
      if (!existing) {
        new_members++;
        events.push({ event_type: 'new_member', member_id: m.id,
          kajabi_user_id: m.kajabi_user_id, member_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
          metadata: { tier: m.tier, joined_at: m.joined_at } });
      }

      // Detect score improvement (lurker graduation)
      if (existing && m.progress_score > existing.progress_score && existing.progress_score <= 25) {
        score_ups++;
        events.push({ event_type: 'score_moved', member_id: m.id,
          kajabi_user_id: m.kajabi_user_id, member_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
          metadata: { from: existing.progress_score, to: m.progress_score } });
      }

      // ConductΩr: detect tier upgrades (Greenhouse → Garden → Founding50)
      // Powers the SERVE and RETAIN cylinder health
      const tierRank = { greenhouse: 0, garden: 1, founding50: 2 };
      if (existing && (tierRank[m.tier] || 0) > (tierRank[existing.tier] || 0)) {
        events.push({ event_type: 'tier_upgraded', member_id: m.id,
          kajabi_user_id: m.kajabi_user_id, member_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
          metadata: { from: existing.tier, to: m.tier } });
      }

      db.upsertCommunityMember(m);
      upserted++;
    }

    // Store per-member history snapshot
    for (const m of members) {
      db.insertCommunityMemberHistory({
        member_id: m.id, kajabi_user_id: m.kajabi_user_id, snapshot_date: date,
        progress_score: m.progress_score || 0, posts_count: m.posts_count || 0,
        comments_count: m.comments_count || 0, last_active_at: m.last_active_at || null,
        tags_json: m.tags_json || null,
      });
    }

    // Log events
    for (const e of events) db.insertCommunityEvent(e);

    // Compute aggregate counts from synced members
    const counts = db.getCommunityMemberCount();

    // Upsert community snapshot
    db.upsertCommunitySnapshot({
      snapshot_date: date,
      total_members:    counts.total,
      greenhouse_count: counts.greenhouse,
      garden_count:     counts.garden,
      founding50_count: counts.founding50,
      new_members_7d:   metrics.new_members_7d || new_members,
      active_users_7d:  metrics.active_users_7d || 0,
      challenge_completions: metrics.challenge_completions || 0,
      lurker_count:     counts.lurkers,
      engaged_count:    counts.engaged,
      fully_onboarded:  counts.fully_onboarded,
    });

    // Auto-detect warm leads: Greenhouse only (free tier). Garden + Founding 50
    // are already paying. Two buckets (see MissionΩr design plan):
    //   ACTIVE warm — score 50-100, posted in the last 30d, joined >= 14d ago, and
    //     clears >= 2 REAL signals. "posted_in_community" is recorded for context
    //     but no longer COUNTS toward the threshold: this loop only reaches a member
    //     with posts_30d > 0, so that signal was always true and silently halved the
    //     bar (any one other signal made a lead). Now it takes two real ones.
    //   QUIET warm — score >= 75 and engaged (recent comments) but has NEVER posted:
    //     the fully-onboarded lurker who's warm but silent. The prime nurture target,
    //     invisible to the active bucket because it requires a post.
    const warmCandidates = db.getAllCommunityMembers({ tier: 'greenhouse', min_score: 50, max_score: 100 });
    let new_leads = 0;
    for (const c of warmCandidates) {
      const joinedMs = c.joined_at ? new Date(c.joined_at).getTime() : 0;
      const ageMs = joinedMs ? Date.now() - joinedMs : 0;
      const oldEnough = ageMs >= 14 * 24 * 60 * 60 * 1000;

      // Real signals — posting-at-all excluded (always true in the active branch).
      const strong = [];
      if (c.posts_count >= 2)     strong.push('multiple_posts');
      if (c.comments_30d >= 3)    strong.push('active_commenter');
      if (c.progress_score >= 75) strong.push('high_onboarding_progress');

      if (c.posts_30d && oldEnough && strong.length >= 2) {
        // ACTIVE warm — keep posted_in_community in the recorded signals as context.
        const signals = ['posted_in_community', ...strong];
        db.upsertWarmLead({
          member_id: c.id, kajabi_user_id: c.kajabi_user_id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          email: c.email, signals,
        });
        new_leads++;
      } else if (!c.posts_count && c.progress_score >= 75 && c.comments_30d >= 1) {
        // QUIET warm — never posted, but onboarded AND commenting recently.
        // No 14-day gate: catching the silent-but-engaged early is the whole point.
        db.upsertWarmLead({
          member_id: c.id, kajabi_user_id: c.kajabi_user_id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          email: c.email, signals: ['quiet_warm', 'high_onboarding_progress'],
        });
        new_leads++;
      }
    }

    logger.info({ upserted, new_members, score_ups, new_leads, events: events.length },
      '[Community] Sync complete');

    res.json({
      ok: true, upserted, new_members, score_ups,
      tier_corrections, new_leads, events: events.length,
      counts, snapshot_date: date,
    });
  } catch (e) {
    logger.error({ err: e }, '[Community] Sync failed');
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/community/health
// ─────────────────────────────────────────────
router.get('/health', (req, res) => {
  try {
    res.json(db.getCommunityHealth());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/community/warm-leads
// ─────────────────────────────────────────────
router.get('/warm-leads', (req, res) => {
  try {
    const { status } = req.query;
    res.json(db.getWarmLeads(status ? { status } : {}));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/community/warm-leads/:id
// Body: { dm_draft?, dm_status?, outcome?, outcome_at? }
// ─────────────────────────────────────────────
router.patch('/warm-leads/:id', (req, res) => {
  try {
    db.updateWarmLead(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/community/events
// ─────────────────────────────────────────────
router.get('/events', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    res.json(db.getRecentCommunityEvents(limit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/community/movers
// Members whose score changed between last two snapshots
// ─────────────────────────────────────────────
router.get('/movers', (req, res) => {
  try {
    res.json(db.detectScoreMovers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/community/members
// Paginated member list with optional filters
// ─────────────────────────────────────────────
router.get('/members', (req, res) => {
  try {
    const { tier, min_score, max_score, limit = 100, offset = 0 } = req.query;
    const members = db.getAllCommunityMembers({
      tier: tier || undefined,
      min_score: min_score != null ? parseInt(min_score) : undefined,
      max_score: max_score != null ? parseInt(max_score) : undefined,
      limit: parseInt(limit), offset: parseInt(offset),
    });
    const counts = db.getCommunityMemberCount();
    res.json({ members, counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/community/events
// Log a manual event (e.g. challenge completion, tier upgrade)
// ─────────────────────────────────────────────
router.post('/events', requireInternal, (req, res) => {
  try {
    const { event_type, member_id, kajabi_user_id, member_name, metadata } = req.body;
    if (!event_type) return res.status(400).json({ error: 'event_type required' });
    db.insertCommunityEvent({ event_type, member_id, kajabi_user_id, member_name, metadata });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/community/tier-correct
// Accept arrays of emails for each paid tier, update community_members by email match.
// Body: { founding50_emails: [...], garden_emails: [...] }
router.post('/tier-correct', requireInternal, (req, res) => {
  try {
    const { founding50_emails = [], garden_emails = [] } = req.body;

    const f50Set = new Set(founding50_emails.map(e => e.toLowerCase().trim()));
    // Garden-only = garden emails not in founding50 (F50 already includes garden)
    const gardenOnly = garden_emails.filter(e => !f50Set.has(e.toLowerCase().trim()));

    let f50Updated = 0, gardenUpdated = 0;

    const updateByEmail = db.prepare('UPDATE community_members SET tier=? WHERE lower(trim(email))=?');

    for (const email of f50Set) {
      const r = updateByEmail.run('founding50', email);
      if (r.changes) f50Updated++;
    }
    for (const email of gardenOnly) {
      const r = updateByEmail.run('garden', email.toLowerCase().trim());
      if (r.changes) gardenUpdated++;
    }

    // Also remove founding50/garden members from warm_leads (they're already paying)
    const removeFromLeads = db.prepare(
      `DELETE FROM warm_leads WHERE member_id IN (
        SELECT id FROM community_members WHERE tier IN ('founding50','garden')
      )`
    );
    const removed = removeFromLeads.run();

    const counts = db.prepare('SELECT tier, COUNT(*) as n FROM community_members GROUP BY tier').all();

    res.json({
      ok: true,
      founding50_updated: f50Updated,
      garden_updated: gardenUpdated,
      warm_leads_removed: removed.changes,
      tier_counts: counts
    });
  } catch (e) {
    logger.error({ err: e }, '[Community] tier-correct failed');
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
