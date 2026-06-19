/**
 * Course Completion Beacon — src/routes/kajabi-track.js  (Pillar 2)
 *
 * Kajabi exposes no per-member lesson/course completion via its API. So we embed a tiny
 * JS beacon in each lesson's custom-code block (see public/kajabi-beacon.js). It reads the
 * logged-in member's identity from window.Kajabi.currentSiteUser (confirmed Jun 17 2026:
 * { id, type:"Member", contactId }) and posts completion events here. Surfaced in NorthΩr.
 *
 * The beacon posts JSON as text/plain so it stays a CORS "simple request" (no preflight) and
 * works with navigator.sendBeacon. App-level express.json() won't touch text/plain, so this
 * route parses it itself.
 *
 * POST /api/kajabi-track          — public, fire-and-forget beacon. Always 204.
 * GET  /api/kajabi-track/admin    — completion analytics (X-Internal-Key required).
 * GET  /api/kajabi-track/health   — quick liveness + total event count (X-Internal-Key required).
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const logger  = require('../utils/logger');

// Allowed event types — anything else is ignored (still 204, never errors the beacon).
const VALID_EVENTS = new Set(['lesson_view', 'mark_complete', 'video_end']);          // lesson completion
const NAV_EVENTS   = new Set(['library_view', 'enter_click', 'bookmark_click']);       // library → community front door

// Classify UA so we can drop crawlers/bots without a heavy parser.
function uaShort(ua) {
  if (!ua) return 'unknown';
  const u = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|headless/.test(u)) return 'bot';
  if (/mobi|android|iphone|ipad|ipod/.test(u)) return 'mobile';
  return 'desktop';
}

const str = (v, n = 200) => (v == null ? null : String(v).slice(0, n));

// ── POST /api/kajabi-track ────────────────────────────────────────────────────
// Parse text/plain (or already-parsed JSON) ourselves, then fire-and-forget.
router.post('/', express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
  res.status(204).end(); // respond immediately — never make the lesson page wait

  try {
    let p = req.body;
    if (typeof p === 'string') { try { p = JSON.parse(p || '{}'); } catch { p = {}; } }
    if (!p || typeof p !== 'object') return;

    const event = str(p.event, 32);
    if (!VALID_EVENTS.has(event) && !NAV_EVENTS.has(event)) return; // ignore unknown/junk events

    const ua     = req.headers['user-agent'] || '';
    const uaType = uaShort(ua);
    if (uaType === 'bot') return; // don't log crawlers

    // Navigation events (front-door funnel) go to member_events, tagged with tier.
    if (NAV_EVENTS.has(event)) {
      db.insertMemberEvent({
        contact_id   : str(p.contact_id, 64),
        site_user_id : str(p.site_user_id, 64),
        member_type  : str(p.member_type, 32),
        surface      : str(p.product_slug, 40) || 'library',
        event,
        tier         : str(p.tier, 24),
        url          : str(p.url, 500),
        ua_short     : uaType,
      });
      return;
    }

    let progress = null;
    if (p.progress != null && !Number.isNaN(Number(p.progress))) {
      progress = Math.max(0, Math.min(100, Math.round(Number(p.progress))));
    }

    db.insertLessonCompletion({
      contact_id   : str(p.contact_id, 64),
      site_user_id : str(p.site_user_id, 64),
      member_type  : str(p.member_type, 32),
      product_slug : str(p.product_slug, 200),
      category_id  : str(p.category_id, 64),
      post_id      : str(p.post_id, 64),
      lesson_title : str(p.lesson_title, 300),
      event,
      progress,
      url          : str(p.url, 500),
      ua_short     : uaType,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'kajabi-track: write failed');
  }
});

// ── Auth guard for the read endpoints ─────────────────────────────────────────
function requireInternal(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// ── GET /api/kajabi-track/admin ───────────────────────────────────────────────
// Per-lesson funnel + per-member rollup + recent events, for NorthΩr / MissionΩr.
router.get('/admin', requireInternal, (req, res) => {
  try {
    const stats  = db.getLessonCompletionStats();
    const recent = db.getRecentLessonCompletions(Number(req.query.limit) || 50);
    res.json({ ...stats, recent });
  } catch (err) {
    logger.error({ err: err.message }, 'kajabi-track/admin: query failed');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/kajabi-track/funnel ──────────────────────────────────────────────
// Library → community front-door funnel (landed → entered → bookmarked), overall + by tier.
router.get('/funnel', requireInternal, (req, res) => {
  try {
    res.json(db.getLibraryFunnel());
  } catch (err) {
    logger.error({ err: err.message }, 'kajabi-track/funnel: query failed');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/kajabi-track/health ──────────────────────────────────────────────
router.get('/health', requireInternal, (req, res) => {
  try {
    const stats = db.getLessonCompletionStats();
    res.json({ ok: true, events: stats.totals?.events || 0, completions: stats.totals?.completions || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
