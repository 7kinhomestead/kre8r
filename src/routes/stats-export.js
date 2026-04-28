'use strict';
/**
 * Stats Export — src/routes/stats-export.js
 *
 * Internal API for the OrgΩr bridge. Requires X-Internal-Key header.
 * Returns a structured snapshot of all current Kre8r business metrics.
 *
 * GET /api/stats-export
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const logger  = require('../utils/logger');

const ML_BASE = 'https://connect.mailerlite.com/api';

// ML v2 returns open_rate/click_rate as {float, string} objects OR plain numbers
function unwrapRate(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.float != null ? Math.round(v.float * 10000) / 100 : null;
  return typeof v === 'number' ? Math.round(v * 10000) / 100 : null;
}

async function fetchMlStats() {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(`${ML_BASE}/campaigns?limit=25`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Only sent campaigns have real stats
    const campaigns = (data.data || [])
      .filter(c => c.status === 'sent')
      .sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at));
    if (!campaigns.length) return null;
    const latest   = campaigns[0];
    const avgOpen  = campaigns.reduce((s, c) => s + (unwrapRate(c.open_rate)  || 0), 0) / campaigns.length;
    const avgClick = campaigns.reduce((s, c) => s + (unwrapRate(c.click_rate) || 0), 0) / campaigns.length;
    return {
      latest_open_rate:  unwrapRate(latest.open_rate),
      latest_click_rate: unwrapRate(latest.click_rate),
      latest_sent_at:    latest.sent_at || null,
      avg_open_rate:     Math.round(avgOpen  * 10) / 10,
      avg_click_rate:    Math.round(avgClick * 10) / 10,
      campaigns_sampled: campaigns.length,
    };
  } catch (e) {
    return null;
  }
}

router.get('/', async (req, res) => {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const stats = {};
    const raw   = db.getRawDb();

    // ── Pipeline health ──────────────────────────────────────────────
    try {
      const p = db.getPipelineHealth();
      stats.pipeline_pre_production  = p.in_pre_production ?? 0;
      stats.pipeline_in_production   = p.in_production     ?? 0;
      stats.pipeline_in_post         = p.in_post           ?? 0;
      stats.pipeline_in_distribution = p.in_distribution   ?? 0;
      stats.pipeline_stalled         = Array.isArray(p.stalled) ? p.stalled.length : (p.stalled ?? 0);
    } catch (_) {}

    // ── Publishing stats (last 30 days) ──────────────────────────────
    try {
      const pub = db.getPublishingStats(30);
      stats.days_since_last_publish      = pub.days_since_last_publish ?? null;
      stats.videos_published_this_month  = pub.videos_this_month       ?? 0;
      stats.videos_published_last_month  = pub.videos_last_month       ?? 0;
      stats.total_videos_published       = pub.total_posts             ?? 0;
      stats.days_since_last_email        = pub.days_since_last_email   ?? null;
    } catch (_) {}

    // ── Footage vault ────────────────────────────────────────────────
    try {
      const vault = raw.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN shot_type IN ('talking_head','talking-head') THEN 1 ELSE 0 END) AS talking_head,
          SUM(CASE WHEN shot_type = 'b-roll'          THEN 1 ELSE 0 END) AS broll,
          SUM(CASE WHEN shot_type = 'completed-video' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN shot_type = 'action'          THEN 1 ELSE 0 END) AS action_clips
        FROM footage
        WHERE quality_flag IS NULL OR quality_flag != 'unusable'
      `).get();
      stats.vault_clips_total  = vault?.total        ?? 0;
      stats.vault_talking_head = vault?.talking_head ?? 0;
      stats.vault_broll        = vault?.broll        ?? 0;
      stats.vault_completed    = vault?.completed    ?? 0;
      stats.vault_action       = vault?.action_clips ?? 0;
    } catch (_) {}

    // ── Projects ─────────────────────────────────────────────────────
    try {
      const proj = raw.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
          SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) AS active
        FROM projects
      `).get();
      stats.projects_total     = proj?.total     ?? 0;
      stats.projects_published = proj?.published ?? 0;
      stats.projects_active    = proj?.active    ?? 0;
    } catch (_) {}

    // ── Ideas (SeedΩr) ───────────────────────────────────────────────
    try {
      const ideas = raw.prepare(`SELECT COUNT(*) AS total FROM ideas`).get();
      stats.ideas_total = ideas?.total ?? 0;
    } catch (_) {}

    // ── Viral / approved clips ───────────────────────────────────────
    try {
      const clips = raw.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved
        FROM viral_clips
      `).get();
      stats.viral_clips_total    = clips?.total    ?? 0;
      stats.viral_clips_approved = clips?.approved ?? 0;
    } catch (_) {}

    // ── MarkΩr — copyright marks ─────────────────────────────────────
    try {
      const marks = raw.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('filed','active','won') THEN 1 ELSE 0 END) AS active
        FROM marks
      `).get();
      stats.copyright_marks_total  = marks?.total  ?? 0;
      stats.copyright_marks_active = marks?.active ?? 0;
    } catch (_) {}

    // ── VectΩr — active strategic brief ─────────────────────────────
    try {
      const brief = raw.prepare(`
        SELECT direction, locked_at FROM strategic_briefs
        WHERE is_active = 1 ORDER BY locked_at DESC LIMIT 1
      `).get();
      stats.strategic_brief_active    = brief ? 1 : 0;
      stats.strategic_brief_direction = brief?.direction ?? null;
    } catch (_) {}

    // ── MailerLite — live API call ────────────────────────────────────
    try {
      const ml = await fetchMlStats();
      if (ml) {
        stats.email_latest_open_rate  = ml.latest_open_rate;
        stats.email_latest_click_rate = ml.latest_click_rate;
        stats.email_latest_sent_at    = ml.latest_sent_at;
        stats.email_avg_open_rate     = ml.avg_open_rate;
        stats.email_avg_click_rate    = ml.avg_click_rate;
        stats.email_campaigns_sampled = ml.campaigns_sampled;
      }
    } catch (_) {}

    res.json({
      source:     'kre8r',
      version:    '1.0',
      synced_at:  new Date().toISOString(),
      stat_count: Object.keys(stats).length,
      stats,
    });

  } catch (err) {
    logger.error({ err }, 'stats-export failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
