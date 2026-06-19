'use strict';
/**
 * Mission Control — src/routes/mission.js
 *
 * GET  /api/mission/snapshot          — full dashboard snapshot (parallel fetch)
 * GET  /api/mission/system            — queue depths only (polled every 30s)
 * GET  /api/mission/attention         — ranked Attention Items
 * POST /api/mission/attention/dismiss — dismiss / snooze an attention item
 * GET  /api/mission/org               — OrgΩr proxy (gross income, reserves, etc.)
 * GET  /api/mission/kinos             — KinOS proxy (today's events, overdue tasks)
 * POST /api/mission/number-one        — Vulcan morning brief (SSE streaming)
 * POST /api/mission/aie-chat          — Dale AIE chat proxy to OrgΩr (SSE streaming)
 * POST /api/mission/tts               — ElevenLabs TTS proxy (audio/mpeg stream)
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const logger  = require('../utils/logger');
const { getWatcherStatus } = require('../vault/watcher');

const ORG_URL   = process.env.ORG_URL   || 'http://localhost:3002';
const KINOS_URL = process.env.KINOS_URL || 'http://localhost:3001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// Dale's job ID and org ID from Dale job data
const DALE_JOB_ID = 64;
const DALE_ORG_ID = 4; // 7 Kin Homestead

// ─────────────────────────────────────────────
// CREW PERSONAS — skin-specific character definitions
// Engine (data injection) is always separate from Soul (persona).
// Each skin defines: name, title, opening line, system_prompt prefix.
// Default skin = 'sci-fi' — uses existing prompts.
// ─────────────────────────────────────────────
const CREW_PERSONAS = {
  'western': {
    'number-one': {
      name:    'BEAUMONT',
      title:   'FIRST GUN · 7 KIN HOMESTEAD',
      color:   '#d97706',
      opening: "I'm your huckleberry. What does the operation need, Sheriff?",
      prompt:  `You are Beaumont, the most brilliant and dangerous man in the territory. You serve as First Gun and strategic advisor to the Sheriff of 7 Kin Homestead. You have assessed the entire situation before the Sheriff walked in.

Your manner: devastating wit, surgical precision, never alarmed. You deliver bad news with a smile and a quote. You call Jason "Sheriff." You use poker metaphors, card game strategy, occasionally slip in Latin. Reference Tombstone: "I'm your huckleberry." "Well...this is funny." "You're a daisy if you do." "My hypocrisy only goes so far." You are consumptive but unstoppable.

Deliver the morning briefing as Doc would: elegant, incisive, slightly theatrical, always accurate.`
    },
    'grex': {
      name:    'BANKER McCANDLESS',
      title:   'McCANDLESS & CO. · BANKERS',
      color:   '#b45309',
      opening: "Ah, Sheriff. Come in, come in. I have been expecting you. The ledger does not lie — shall we see what the territory owes us today?",
      prompt:  `You are the wealthiest and most calculating banker in Tombstone Territory. You handle all financial affairs for the Sheriff's operation with mercantile precision.

Your manner: deliberate, theatrical about money, deeply loyal to the bottom line. Use 1880s financial language: "the ledger", "the assay", "obligations", "the till", "silver", "receivables". Same financial precision as always — exact numbers, runway analysis, debt tracking — but framed in frontier banking. You are not Ferengi but you share the same devotion to capital. You call Jason "Sheriff." End with a financial maxim of your own invention.`
    },
    'dale': {
      name:    'DEPUTY FITCH',
      title:   'TOWN DEPUTY · TOMBSTONE',
      color:   '#92400e',
      opening: "Sheriff! I got seventeen items on the docket and three of 'em are on fire. What do you need first?",
      prompt:  `You are the well-meaning but perpetually overwhelmed town deputy of Tombstone. You handle task routing, approvals, and operational matters. You mean extremely well. You are actually good at your job. You are just always slightly behind.

Your manner: earnest, slightly breathless, occasional frontier idiom. "Right away, Sheriff." "I'll get it on the docket." Tasks are warrants. The operations queue is the jail log. Approval requests are disputes to settle. You call Jason "Sheriff." You genuinely want to help. You are trying your absolute best.`
    },
    'vaelyn': {
      name:    'BELLE CAVENDISH',
      title:   'SALOON PROPRIETOR · TOMBSTONE',
      color:   '#d97706',
      opening: "Evening, Sheriff. The community's been lively tonight. I've got eyes on four who might be ready to move to the private room.",
      prompt:  `You are the proprietor of the finest saloon in Tombstone. You know every soul in town — who arrived yesterday, who's about to leave, who's ready to move to the private card table. You are warm, strategically brilliant, and you have the pulse of the entire community.

The saloon is the Rock Rich community. The free bar area is the Greenhouse. The private card table is the Garden tier. The high-stakes back room is the Founding 50. Warm leads are "folks who've been eyeing the private room." Lurkers are "people nursing a single drink all night."

Your manner: warm, perceptive, frontier elegance. Slight drawl in the written voice. You call Jason "Sheriff." You always end with one clear community action.`
    },
    'axiom': {
      name:    'WIRE OPERATOR',
      title:   'TELEGRAPH OFFICE · TOMBSTONE',
      color:   '#0891b2',
      opening: "Dispatch from the wire, Sheriff. I am reading the latest figures. What do you want to know?",
      prompt:  `You are the telegraph operator for Tombstone. You receive and transmit data dispatches with absolute precision.

CRITICAL SPEECH RULES — both are hard constraints, never violate either:

RULE 1 — NO CONTRACTIONS: "I am" not "I'm". "I cannot" not "I can't". "It is" not "it's". "Do not" not "don't". "I will" not "I'll". "You are" not "you're".

RULE 2 — NO COMPOUND WORDS: "Every thing" not "everything". "Any one" not "anyone". "Some thing" not "something". "What ever" not "whatever". "Base line" not "baseline". "Out perform" not "outperform".

You speak in telegram dispatch style: short, declarative. Occasional "STOP." You call Jason "Sheriff." Numbers are dispatches from the wire. You do not speculate. You transmit.`
    }
  }
};

function getPersona(skinId, crewId) {
  return CREW_PERSONAS[skinId]?.[crewId] || null;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Fetch with a hard timeout. Returns null on any failure.
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 2000) {
  try {
    const { default: fetch } = await import('node-fetch');
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(tid);
    }
  } catch (_) {
    return null;
  }
}

/**
 * Read dismiss state for all known item IDs from mission_attention_state.
 * Returns a Map<item_id, { dismissed_at, snooze_until }>.
 */
function loadDismissState() {
  try {
    const raw = db.getRawDb();
    const rows = raw.prepare('SELECT item_id, dismissed_at, snooze_until FROM mission_attention_state').all();
    const map = new Map();
    for (const r of rows) map.set(r.item_id, r);
    return map;
  } catch (_) {
    return new Map();
  }
}

/**
 * Returns true if the item should be hidden (dismissed permanently or snoozed).
 */
function isSuppressed(dismissMap, itemId) {
  const state = dismissMap.get(itemId);
  if (!state) return false;
  if (state.dismissed_at) return true;  // permanent dismiss
  if (state.snooze_until) {
    return new Date(state.snooze_until) > new Date();
  }
  return false;
}

// ─────────────────────────────────────────────
// QUEUE DEPTHS — synchronous DB reads
// ─────────────────────────────────────────────

function getQueueDepths() {
  try {
    const raw = db.getRawDb();

    const frameQueue = (() => {
      try {
        return raw.prepare(
          "SELECT COUNT(*) AS n FROM footage WHERE visual_analyzed_at IS NULL AND shot_type IS NOT NULL"
        ).get()?.n ?? 0;
      } catch (_) { return 0; }
    })();

    const txQueue = (() => {
      try {
        return raw.prepare(
          "SELECT COUNT(*) AS n FROM footage WHERE transcription_status = 'pending' OR transcription_status IS NULL AND shot_type IN ('talking-head','talking_head','dialogue')"
        ).get()?.n ?? 0;
      } catch (_) { return 0; }
    })();

    const postorPending = (() => {
      try {
        return raw.prepare("SELECT COUNT(*) AS n FROM postor_queue WHERE status = 'pending'").get()?.n ?? 0;
      } catch (_) { return 0; }
    })();

    const postorFailed = (() => {
      try {
        return raw.prepare("SELECT COUNT(*) AS n FROM postor_queue WHERE status = 'failed'").get()?.n ?? 0;
      } catch (_) { return 0; }
    })();

    // Backup age — read mtime of the backup file (Electron passes BACKUP_DB_PATH env var)
    let backupAgeHours = null;
    if (process.env.BACKUP_DB_PATH) {
      try {
        const { statSync } = require('fs');
        const stat = statSync(process.env.BACKUP_DB_PATH);
        backupAgeHours = Math.round((Date.now() - stat.mtimeMs) / 3600000 * 10) / 10;
      } catch (_) {
        // File doesn't exist yet — backup hasn't run; leave as null (triggers warning)
      }
    }

    // Watcher status — read live in-memory state from the watcher module directly.
    // No DB round-trip needed; this is always accurate for the current process.
    const watcherActive = getWatcherStatus().running;

    return {
      frame_queue_pending: frameQueue,
      tx_queue_pending:    txQueue,
      postor_pending:      postorPending,
      postor_failed:       postorFailed,
      backup_age_hours:    backupAgeHours,
      watcher_active:      watcherActive,
    };
  } catch (err) {
    logger.error({ module: 'mission', err }, 'getQueueDepths failed');
    return {
      frame_queue_pending: 0,
      tx_queue_pending:    0,
      postor_pending:      0,
      postor_failed:       0,
      backup_age_hours:    null,
      watcher_active:      false,
    };
  }
}

// ─────────────────────────────────────────────
// PIPELINE DATA
// ─────────────────────────────────────────────

// Stage depth order used for dedup scoring (higher index = more advanced)
const STAGE_ORDER = ['M0','M0.1','M0.2','M1','M1.1','M1.2','M2','M2.1','M3','M3.1','M4','M5'];
function stageDepth(stage) {
  const s = stage || 'M0';
  const idx = STAGE_ORDER.findIndex(x => s.startsWith(x));
  return idx === -1 ? 0 : idx;
}

function projectFunnel(stage) {
  if (!stage || ['M0','M0.1','M0.2','M1','M1.1'].includes(stage)) return 'pre';
  if (stage === 'M1.2') return 'prod';
  if (['M2','M2.1','M3','M3.1'].includes(stage)) return 'post';
  if (['M4','M5'].includes(stage)) return 'dist';
  return 'pre';
}

function episodeFunnel(pipeline_stage) {
  if (!pipeline_stage || ['outlining','shoot_ready'].includes(pipeline_stage)) return 'pre';
  if (pipeline_stage === 'shooting') return 'prod';
  if (pipeline_stage === 'editing') return 'post';
  return 'pre';
}

function getPipelineData() {
  try {
    const raw = db.getRawDb();
    const now = Date.now();

    // ── Projects ────────────────────────────────────────────────────────
    // Fetch 40 so dedup still returns up to 20 unique titles.
    // Include pipr_complete + source to prefer PipΩr projects over Id8Ωr stubs.
    const projects = raw.prepare(`
      SELECT p.id, p.title, p.current_stage, p.status, p.created_at,
             p.pipr_complete, p.source,
             ps.updated_at AS stage_updated_at
      FROM projects p
      LEFT JOIN pipeline_state ps ON ps.project_id = p.id
      WHERE p.status NOT IN ('published','archived')
        AND (p.source IS NULL OR p.source NOT IN ('youtube_import','tiktok_import','instagram_import','facebook_import'))
      ORDER BY p.created_at DESC
      LIMIT 40
    `).all();

    // Dedup by title — keep the most advanced/native version of each concept
    const notId8r = (src) => (src === 'id8r' ? 0 : 1);
    const seen = new Map();
    for (const p of projects) {
      const key = (p.title || '').toLowerCase().trim();
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev) { seen.set(key, p); continue; }
      const prevScore = (prev.pipr_complete || 0) * 2000 + notId8r(prev.source) * 1000 + stageDepth(prev.current_stage);
      const currScore = (p.pipr_complete   || 0) * 2000 + notId8r(p.source)    * 1000 + stageDepth(p.current_stage);
      if (currScore > prevScore) seen.set(key, p);
    }

    const projectItems = Array.from(seen.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20)
      .map(p => {
        const lastUpdate = p.stage_updated_at || p.created_at;
        const daysInStage = Math.floor((now - new Date(lastUpdate).getTime()) / 86400000);
        return {
          id:            p.id,
          kind:          'project',
          title:         p.title,
          stage:         p.current_stage || 'M0',
          funnel:        projectFunnel(p.current_stage),
          days_in_stage: daysInStage,
          stalled:       daysInStage > 7,
          created_at:    p.created_at,
        };
      });

    // ── Episodes (Rock Rich show arc) ────────────────────────────────────
    // Planned / in-production episodes that don't yet have a PipΩr project
    // driving them show up here so CONN always reflects the full creative slate.
    const episodeRows = (() => {
      try {
        return raw.prepare(`
          SELECT e.id, e.title, e.episode_number, e.pipeline_stage, e.created_at,
                 s.name AS show_name
          FROM show_episodes e
          LEFT JOIN shows s ON s.id = e.show_id
          WHERE (e.pipeline_stage IS NULL OR e.pipeline_stage != 'published')
            AND e.status != 'archived'
          ORDER BY e.created_at DESC
          LIMIT 20
        `).all();
      } catch (_) { return []; }
    })();

    // Filter out episodes whose title is already covered by a PipΩr project
    const projectTitles = new Set(projectItems.map(p => (p.title || '').toLowerCase().trim()));
    const episodeItems = episodeRows
      .filter(e => !projectTitles.has((e.title || '').toLowerCase().trim()))
      .map(e => {
        const daysInStage = Math.floor((now - new Date(e.created_at).getTime()) / 86400000);
        return {
          id:             'ep_' + e.id,
          kind:           'episode',
          title:          e.title || ('Episode ' + (e.episode_number || '?')),
          show_name:      e.show_name || null,
          episode_number: e.episode_number || null,
          stage:          e.pipeline_stage || 'outlining',
          funnel:         episodeFunnel(e.pipeline_stage),
          days_in_stage:  daysInStage,
          stalled:        daysInStage > 7,
          created_at:     e.created_at,
        };
      });

    // ── Merge — sort by recency, cap at 20 ──────────────────────────────
    const result = [...projectItems, ...episodeItems]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);

    // Days since last published video
    const pubStats = (() => {
      try { return db.getPublishingStats(30); } catch(_) { return {}; }
    })();
    const daysSinceLastVideo = pubStats?.days_since_last_publish ?? null;

    return { projects: result, days_since_last_video: daysSinceLastVideo };
  } catch (err) {
    logger.error({ module: 'mission', err }, 'getPipelineData failed');
    return { projects: [], days_since_last_video: null };
  }
}

// ─────────────────────────────────────────────
// AUDIENCE DATA
// ─────────────────────────────────────────────

function getAudienceData() {
  try {
    const raw = db.getRawDb();

    // YouTube subscriber count from analytics cache
    const ytRow = (() => {
      try {
        return raw.prepare("SELECT value FROM kv_store WHERE key = 'yt_channel_stats'").get();
      } catch (_) { return null; }
    })();
    let yt = null;
    if (ytRow?.value) {
      try {
        yt = JSON.parse(ytRow.value);
        // setKv double-encodes if passed a pre-stringified value — unwrap
        if (typeof yt === 'string') yt = JSON.parse(yt);
      } catch (_) {}
    }

    // MailerLite subscriber count from kv_store cache
    const mlRow = (() => {
      try {
        return raw.prepare("SELECT value FROM kv_store WHERE key = 'mailerlite_stats'").get();
      } catch (_) { return null; }
    })();
    let ml = null;
    if (mlRow?.value) {
      try { ml = JSON.parse(mlRow.value); } catch (_) {}
    }

    // Fallback: try mirrr analytics table for subscriber count
    let ytSubs = yt?.subscriber_count ?? null;
    if (ytSubs === null) {
      try {
        const latestMetric = raw.prepare(
          `SELECT value FROM analytics WHERE metric_name='subscriber_count' ORDER BY recorded_at DESC LIMIT 1`
        ).get();
        if (latestMetric?.value) ytSubs = parseInt(latestMetric.value) || null;
      } catch(_) {}
    }
    if (ytSubs === null) {
      // Try posts/analytics summary
      try {
        const channelRow = raw.prepare(
          `SELECT value FROM kv_store WHERE key='mirrr_channel_stats'`
        ).get();
        if (channelRow?.value) {
          const ch = JSON.parse(channelRow.value);
          ytSubs = ch?.subscriber_count ?? ch?.subscribers ?? null;
        }
      } catch(_) {}
    }

    // Last video performance vs channel avg — computed after avgViews below.
    // (placeholder; filled in once recentVideos + avgViews are known)
    let lastVideoVsAvg = null;

    // Last email campaign
    let lastEmail = null;
    try {
      const mlStatsRow = raw.prepare(`SELECT value FROM kv_store WHERE key='mailerlite_last_campaign'`).get();
      if (mlStatsRow?.value) lastEmail = JSON.parse(mlStatsRow.value);
    } catch(_) {}

    // Recent YouTube videos — direct from posts + analytics tables.
    // Bypasses the channel_dna_profile dependency so the sensor array works
    // without DNA analysis. Falls back to the yt_recent_videos kv cache (written
    // by /api/mission/fire-youtube) when the posts/analytics tables are empty —
    // e.g. videos published to YouTube without a corresponding kre8r project.
    let recentVideos = [];
    try {
      const vidRows = raw.prepare(`
        SELECT p.title, p.posted_at,
               COALESCE(MAX(CASE WHEN a.metric_name='views'     THEN CAST(a.metric_value AS INTEGER) END), 0) AS views,
               COALESCE(MAX(CASE WHEN a.metric_name='likes'     THEN CAST(a.metric_value AS INTEGER) END), 0) AS likes
        FROM posts p
        LEFT JOIN analytics a ON a.post_id = p.id
        WHERE p.platform = 'youtube' AND p.title IS NOT NULL
        GROUP BY p.id
        ORDER BY p.posted_at DESC
        LIMIT 8
      `).all();
      recentVideos = vidRows.map(function(v) {
        return { title: v.title, views: v.views || 0, likes: v.likes || 0, posted_at: v.posted_at };
      });
    } catch(_) {}

    // Fallback: serve the kv cache populated by fire-youtube if DB has nothing.
    if (!recentVideos.length) {
      try {
        const rvRow = raw.prepare("SELECT value FROM kv_store WHERE key = 'yt_recent_videos'").get();
        if (rvRow?.value) {
          let cached = JSON.parse(rvRow.value);
          if (typeof cached === 'string') cached = JSON.parse(cached); // unwrap double-encode
          if (Array.isArray(cached?.videos)) {
            recentVideos = cached.videos.map(function(v) {
              return { title: v.title, views: v.views || 0, likes: v.likes || 0, posted_at: v.posted_at };
            });
          }
        }
      } catch(_) {}
    }

    // Channel avg views for comparison — from the videos we actually have.
    let avgViews = null;
    try {
      const avgRow = raw.prepare(`
        SELECT AVG(CAST(a.metric_value AS INTEGER)) AS avg
        FROM analytics a
        JOIN posts p ON p.id = a.post_id
        WHERE a.metric_name = 'views' AND p.platform = 'youtube'
      `).get();
      avgViews = avgRow?.avg ? Math.round(avgRow.avg) : null;
    } catch(_) {}
    // Fallback avg from the cached recent videos if the analytics table is empty.
    if (avgViews === null && recentVideos.length) {
      const withViews = recentVideos.filter(v => v.views > 0);
      if (withViews.length) {
        avgViews = Math.round(withViews.reduce((s, v) => s + v.views, 0) / withViews.length);
      }
    }

    // Last video vs channel avg — newest video (by posted_at) compared to avg.
    if (recentVideos.length && avgViews) {
      const newest = recentVideos[0]; // already ordered newest-first
      if (newest?.views) {
        lastVideoVsAvg = Math.round(((newest.views - avgViews) / avgViews) * 100);
      }
    }

    return {
      yt_subscribers:    ytSubs,
      yt_total_views:    yt?.view_count       ?? null,
      yt_last_video_pct: lastVideoVsAvg,
      ml_subscribers:    ml?.total_subscribers ?? null,
      ml_avg_open_rate:  ml?.avg_open_rate     ?? null,
      ml_last_campaign:  lastEmail,
      recent_videos:     recentVideos,
      avg_video_views:   avgViews,
    };
  } catch (err) {
    logger.error({ module: 'mission', err }, 'getAudienceData failed');
    return {};
  }
}

// ─────────────────────────────────────────────
// WARM LEADS DATA (community module)
// ─────────────────────────────────────────────

function getWarmLeadsData() {
  try {
    const raw = db.getRawDb();

    // Check if community tables exist
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('community_members','community_warm_leads')").all().map(r => r.name);

    if (!tables.length) return { warm_leads_total: 0, warm_leads_pending: 0, oldest_lead_days: null };

    const warmLeadsTable = tables.includes('community_warm_leads') ? 'community_warm_leads' : null;
    if (!warmLeadsTable) return { warm_leads_total: 0, warm_leads_pending: 0, oldest_lead_days: null };

    const stats = raw.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN dm_status = 'draft' OR dm_status IS NULL THEN 1 END) AS pending,
        COUNT(CASE WHEN dm_status = 'approved' THEN 1 END) AS approved,
        MIN(created_at) AS oldest_at
      FROM community_warm_leads
    `).get();

    const oldestDays = stats?.oldest_at
      ? Math.floor((Date.now() - new Date(stats.oldest_at).getTime()) / 86400000)
      : null;

    return {
      warm_leads_total:   stats?.total   ?? 0,
      warm_leads_pending: stats?.pending ?? 0,
      warm_leads_approved: stats?.approved ?? 0,
      oldest_lead_days:   oldestDays,
    };
  } catch (_) {
    return { warm_leads_total: 0, warm_leads_pending: 0, warm_leads_approved: 0, oldest_lead_days: null };
  }
}

// ─────────────────────────────────────────────
// COMMUNITY LAST SYNC
// ─────────────────────────────────────────────

function getCommunityLastSync() {
  try {
    const raw = db.getRawDb();
    const row = raw.prepare("SELECT value FROM kv_store WHERE key = 'community_last_synced_at'").get();
    if (!row?.value) return null;
    return row.value;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────
// evaluateAttention(db) — pure function
// ─────────────────────────────────────────────

function evaluateAttention() {
  const items = [];
  const dismissMap = loadDismissState();

  // ── Collect raw signals ────────────────────────────────────────────────────
  const queues  = getQueueDepths();
  const pubStats = (() => { try { return db.getPublishingStats(30); } catch (_) { return {}; } })();
  const warmLeads = getWarmLeadsData();
  const communityLastSync = getCommunityLastSync();

  // ── Build items ────────────────────────────────────────────────────────────

  // CRITICAL: PostΩr failed posts
  if (queues.postor_failed > 0) {
    const itemId = 'postor_failed';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'critical',
        domain:       'postor',
        icon:         '🔴',
        headline:     `PostΩr publish failed — ${queues.postor_failed} post${queues.postor_failed !== 1 ? 's' : ''} need attention`,
        subtext:      'Check PostΩr queue for errors and retry.',
        action_label: 'Open PostΩr',
        action:       '/postor.html',
        dismissible:  true,
        weight:       100,
      });
    }
  }

  // CRITICAL: Watcher OFFLINE — footage intake silently broken
  if (!queues.watcher_active) {
    const itemId = 'watcher_offline';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'critical',
        domain:       'vault',
        icon:         '📡',
        headline:     'Watcher OFFLINE — D:\\kre8r\\intake not being monitored',
        subtext:      'New footage will not be ingested. Restart Electron or check VaultΩr.',
        action_label: 'Open VaultΩr',
        action:       '/vault.html',
        dismissible:  true,
        weight:       95,
      });
    }
  }

  // CRITICAL: DB backup overdue
  if (queues.backup_age_hours !== null && queues.backup_age_hours > 12) {
    const itemId = 'backup_overdue';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'critical',
        domain:       'system',
        icon:         '💾',
        headline:     `DB backup overdue — last backup ${queues.backup_age_hours}h ago`,
        subtext:      'Electron 5-min rolling backup may have stopped. Check app status.',
        action_label: 'System Status',
        action:       '/doctor.html',
        dismissible:  true,
        weight:       90,
      });
    }
  }

  // WARNING: Backup state unknown — cannot confirm data safety
  if (queues.backup_age_hours === null) {
    const itemId = 'backup_unknown';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'warning',
        domain:       'system',
        icon:         '💾',
        headline:     'Backup state unknown — cannot confirm data safety',
        subtext:      'Backup has never run or the record is missing. Check app status.',
        action_label: 'System Status',
        action:       '/doctor.html',
        dismissible:  true,
        weight:       85,
      });
    }
  }

  // WARNING: Most-advanced project/episode stalled > 7 days
  try {
    const pipelineProjects = getPipelineData().projects;
    if (pipelineProjects.length > 0) {
      // Rank by funnel depth (dist > post > prod > pre) then days stalled
      const funnelDepth = { pre: 0, prod: 1, post: 2, dist: 3 };
      const ranked = pipelineProjects
        .filter(p => p.stalled)
        .sort((a, b) => {
          const ad = funnelDepth[a.funnel] ?? 0;
          const bd = funnelDepth[b.funnel] ?? 0;
          return bd !== ad ? bd - ad : (b.days_in_stage || 0) - (a.days_in_stage || 0);
        });
      if (ranked.length > 0) {
        const worst = ranked[0];
        const itemId = `project_stalled_${worst.id}`;
        if (!isSuppressed(dismissMap, itemId)) {
          const label = worst.kind === 'episode' ? 'episode' : 'project';
          items.push({
            id:           itemId,
            severity:     'warning',
            domain:       'pipeline',
            icon:         '⏸',
            headline:     `"${worst.title}" stalled ${worst.days_in_stage}d — furthest-along ${label}`,
            subtext:      'Momentum at risk. Pick it up or move it forward.',
            action_label: worst.kind === 'episode' ? 'Open ShowΩr' : 'Open PipΩr',
            action:       worst.kind === 'episode' ? '/shows.html' : '/pipr.html',
            dismissible:  true,
            weight:       80,
          });
        }
      }
    }
  } catch (_) {}

  // WARNING: Days since last published video > 9
  const daysSincePublish = pubStats?.days_since_last_publish ?? null;
  if (daysSincePublish !== null && daysSincePublish > 9) {
    const itemId = 'publish_gap';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'warning',
        domain:       'distribution',
        icon:         '📉',
        headline:     `${daysSincePublish} days since last video — channel momentum at risk`,
        subtext:      'Algorithm rewards consistency. Ship something.',
        action_label: 'Open PostΩr',
        action:       '/postor.html',
        dismissible:  true,
        weight:       75,
      });
    }
  }

  // WARNING: Warm leads waiting > 2 days (draft status)
  if (warmLeads.warm_leads_pending > 0 && warmLeads.oldest_lead_days !== null && warmLeads.oldest_lead_days > 2) {
    const itemId = 'warm_leads_waiting';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'warning',
        domain:       'community',
        icon:         '🌡️',
        headline:     `${warmLeads.warm_leads_pending} warm lead${warmLeads.warm_leads_pending !== 1 ? 's' : ''} waiting — ${warmLeads.oldest_lead_days} days since detection`,
        subtext:      'Window closes fast. Send DMs while they\'re still warm.',
        action_label: 'Open AudiencΩr',
        action:       '/audience.html',
        dismissible:  true,
        weight:       70,
      });
    }
  }

  // WARNING: Community data stale > 9 days
  if (communityLastSync) {
    const staleDays = Math.floor((Date.now() - new Date(communityLastSync).getTime()) / 86400000);
    if (staleDays > 9) {
      const itemId = 'community_stale';
      if (!isSuppressed(dismissMap, itemId)) {
        items.push({
          id:           itemId,
          severity:     'warning',
          domain:       'community',
          icon:         '🌱',
          headline:     `Community data ${staleDays}d stale — run weekly snapshot`,
          subtext:      'Member scores drift. Sync to catch warm leads and tier changes.',
          action_label: 'Open AudiencΩr',
          action:       '/audience.html',
          dismissible:  true,
          weight:       60,
        });
      }
    }
  }

  // NUDGE: DMs approved and ready to send
  if (warmLeads.warm_leads_approved > 0) {
    const itemId = 'dms_ready';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'nudge',
        domain:       'community',
        icon:         '💬',
        headline:     `${warmLeads.warm_leads_approved} DM${warmLeads.warm_leads_approved !== 1 ? 's' : ''} ready to send`,
        subtext:      'Approved drafts are waiting. One tap to send.',
        action_label: 'Open AudiencΩr',
        action:       '/audience.html',
        dismissible:  true,
        weight:       40,
      });
    }
  }

  // NUDGE: Frame analysis pending
  if (queues.frame_queue_pending > 0) {
    const itemId = 'frame_analysis_pending';
    if (!isSuppressed(dismissMap, itemId)) {
      items.push({
        id:           itemId,
        severity:     'nudge',
        domain:       'vault',
        icon:         '👁',
        headline:     `${queues.frame_queue_pending} clip${queues.frame_queue_pending !== 1 ? 's' : ''} pending frame analysis`,
        subtext:      'Run batch analysis in VaultΩr to unlock visual context.',
        action_label: 'Open VaultΩr',
        action:       '/vault.html',
        dismissible:  true,
        weight:       20,
      });
    }
  }

  // ── Rank: critical → warning → nudge, then by weight descending ────────────
  const severityOrder = { critical: 0, warning: 1, nudge: 2 };
  items.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return (b.weight || 0) - (a.weight || 0);
  });

  // Strip internal weight field before returning
  return items.map(({ weight, ...rest }) => rest);
}

// ─────────────────────────────────────────────
// CREW DISPATCHES — standing orders system
// Conditions checked on every /snapshot call.
// Dispatches generated async (fire-and-forget) — don't block the response.
// ─────────────────────────────────────────────

async function callClaudeText(systemPrompt, userPrompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: maxTokens || 120,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (_) {
    return null;
  }
}

const STANDING_ORDERS = [
  {
    id:             'stalled_project',
    crew_id:        'number-one',
    cooldown_hours: 24,
    check: (bundle) => {
      const funnelDepth = { pre: 0, prod: 1, post: 2, dist: 3 };
      const stalled = (bundle.pipeline?.projects || [])
        .filter(p => p.stalled)
        .sort((a, b) => {
          const ad = funnelDepth[a.funnel] ?? 0;
          const bd = funnelDepth[b.funnel] ?? 0;
          return bd !== ad ? bd - ad : (b.days_in_stage || 0) - (a.days_in_stage || 0);
        });
      if (!stalled.length) return null;
      const worst = stalled[0];
      return { title: worst.title, days: worst.days_in_stage, funnel: worst.funnel, key: String(worst.id) };
    },
    systemPrompt: () => `You are Number One, First Officer aboard the Kre8r command bridge. You are Commander Riker — decisive, warm, quietly intense. You write SHORT tactical hails to the Captain. Two sentences maximum. Always address as "Captain." Never use the word "stalled" — say "hasn't moved", "at anchor", or similar.`,
    userPrompt: (ctx) => `Project "${ctx.title}" has not moved in ${ctx.days} days and is in the ${ctx.funnel} phase of the pipeline. Write a 2-sentence tactical hail to the Captain. End with: "Awaiting your orders. — Number One"`,
  },
  {
    id:             'backup_overdue',
    crew_id:        'grex',
    cooldown_hours: 48,
    check: (bundle) => {
      const age = bundle.system?.backup_age_hours;
      if (age == null || age < 12) return null;
      return { hours: Math.round(age), key: 'backup' };
    },
    systemPrompt: () => `You are Grex, Chief Financial Officer. You speak in clipped Ferengi-adjacent financial metaphors. You are deeply loyal to the Rules of Acquisition and the safety of the ledger. Two sentences maximum. End with "— Grex".`,
    userPrompt: (ctx) => `The database backup is ${ctx.hours} hours old. The data is at risk. Write a 2-sentence financial safety dispatch to the Captain. End with: "— Grex"`,
  },
  {
    id:             'warm_leads_piling',
    crew_id:        'vaelyn',
    cooldown_hours: 48,
    check: (bundle) => {
      const pending = bundle.warmLeads?.warm_leads_pending ?? 0;
      if (pending < 5) return null;
      return { count: pending, oldest_days: bundle.warmLeads?.oldest_lead_days ?? null, key: 'leads' };
    },
    systemPrompt: () => `You are Vaelyn, Tactical Officer and community intelligence specialist. Warm, perceptive, confident. You know every move in the community before it happens. Two sentences maximum. End with "— Vaelyn".`,
    userPrompt: (ctx) => `${ctx.count} warm community leads are waiting${ctx.oldest_days ? `, oldest contact ${ctx.oldest_days} days ago` : ''}. Write a 2-sentence tactical boarding-window dispatch to the Captain. End with: "— Vaelyn"`,
  },
  {
    id:             'ops_queue_deep',
    crew_id:        'dale',
    cooldown_hours: 24,
    check: (bundle) => {
      const depth = bundle.system?.frame_queue_pending ?? 0;
      if (depth < 1000) return null;
      return { depth, key: 'queue' };
    },
    systemPrompt: () => `You are Dale McGillicutty, Executive Division Assistant. Earnest, helpful, perpetually slightly behind, but genuinely competent. Mild bureaucratic panic. Two sentences maximum. End with "— Dale".`,
    userPrompt: (ctx) => `The frame analysis queue has ${ctx.depth.toLocaleString()} items pending. Write a 2-sentence ops status dispatch to the Captain about the backlog. End with: "— Dale"`,
  },
];

async function checkStandingOrders(bundle) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;
  try {
    const raw = db.getRawDb();
    for (const order of STANDING_ORDERS) {
      try {
        const ctx = order.check(bundle);
        if (!ctx) continue;

        const triggerKey = `${order.crew_id}:${order.id}:${ctx.key || ''}`;

        // Check cooldown — skip if a dispatch was generated recently for this trigger
        const recent = raw.prepare(`
          SELECT created_at FROM crew_dispatch
          WHERE crew_id = ? AND trigger_id = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(order.crew_id, triggerKey);

        if (recent) {
          const hoursAgo = (Date.now() - new Date(recent.created_at).getTime()) / 3600000;
          if (hoursAgo < order.cooldown_hours) continue;
        }

        // Fire dispatch generation — fully async, doesn't block anything
        const systemPrompt = order.systemPrompt(ctx, bundle);
        const userPrompt   = order.userPrompt(ctx);
        callClaudeText(systemPrompt, userPrompt, 120).then(body => {
          if (!body) return;
          try {
            raw.prepare(`
              INSERT INTO crew_dispatch (crew_id, trigger_id, skin_id, body)
              VALUES (?, ?, ?, ?)
            `).run(order.crew_id, triggerKey, 'starfleet-command', body);
          } catch (_) {}
        }).catch(() => {});

      } catch (_) {}
    }
  } catch (_) {}
}

function getDispatchCounts() {
  try {
    const raw = db.getRawDb();
    const rows = raw.prepare(`
      SELECT crew_id, COUNT(*) AS n
      FROM crew_dispatch
      WHERE read_at IS NULL
      GROUP BY crew_id
    `).all();
    const counts = { 'number-one': 0, grex: 0, dale: 0, vaelyn: 0, axiom: 0 };
    for (const r of rows) {
      if (counts.hasOwnProperty(r.crew_id)) counts[r.crew_id] = r.n;
    }
    return counts;
  } catch (_) {
    return { 'number-one': 0, grex: 0, dale: 0, vaelyn: 0, axiom: 0 };
  }
}

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

/**
 * GET /api/mission/snapshot
 * Full dashboard snapshot — all panels in parallel.
 */
router.get('/snapshot', async (req, res) => {
  try {
    // Read previous snapshot for delta computation (before any async work)
    const prevSnap = (() => { try { return db.getKv('mission_prev_snapshot'); } catch(_) { return null; } })();

    const ORGR_TOKEN  = process.env.ORGR_INTERNAL_TOKEN;
    const KINOS_TOKEN = process.env.KINOS_INTERNAL_TOKEN;
    const ORG_ID      = process.env.ORG_ID || '4';

    const [communityHealth, orgData, kinosData] = await Promise.all([
      // Community health — internal call with session cookie
      fetchWithTimeout(`http://localhost:3000/api/community/health`, {
        headers: { 'Cookie': req.headers['cookie'] || '' }
      }),
      // OrgΩr — correct endpoint + correct auth header
      ORGR_TOKEN
        ? fetchWithTimeout(`${ORG_URL}/api/treasor/dashboard/${ORG_ID}`, {
            headers: { 'x-internal-token': ORGR_TOKEN }
          }, 8000)
        : Promise.resolve(null),
      // KinOS — fetch all three endpoints and shape them correctly
      KINOS_TOKEN
        ? (async () => {
            const kinosHeaders = { 'x-internal-token': KINOS_TOKEN };
            const [eventsData, tasksData, stockData] = await Promise.all([
              fetchWithTimeout(`${KINOS_URL}/api/schedule/upcoming?days=1`, { headers: kinosHeaders }, 8000),
              fetchWithTimeout(`${KINOS_URL}/api/tasks`,                    { headers: kinosHeaders }, 8000),
              fetchWithTimeout(`${KINOS_URL}/api/inventory/low`,            { headers: kinosHeaders }, 8000),
            ]);
            if (!eventsData && !tasksData && !stockData) return null;
            const allTasks = Array.isArray(tasksData) ? tasksData : (tasksData?.tasks ?? []);
            const now      = new Date().toISOString();
            const overdue  = allTasks.filter(t => t.due_at && t.due_at < now && t.status !== 'done');
            const lowStock = Array.isArray(stockData) ? stockData : (stockData?.items ?? []);
            return {
              available:       true,
              events_today:    Array.isArray(eventsData) ? eventsData : (eventsData?.events ?? []),
              overdue_tasks:   overdue.length,
              low_stock_count: lowStock.length,
              conflicts:       [],
            };
          })()
        : Promise.resolve(null),
    ]);

    const queues    = getQueueDepths();
    const pipeline  = getPipelineData();
    const audience  = getAudienceData();
    const warmLeads = getWarmLeadsData();
    const attention = evaluateAttention();

    // Build current snapshot values for delta tracking
    const currSnap = {
      yt_subscribers:       audience.yt_subscribers               ?? null,
      community_total:      communityHealth?.counts?.total        ?? null,
      community_greenhouse: communityHealth?.counts?.greenhouse   ?? null,
      community_garden:     communityHealth?.counts?.garden       ?? null,
      community_f50:        communityHealth?.counts?.founding50   ?? null,
      net_worth:            orgData?.net_worth                    ?? null,
      this_month_gi:        orgData?.this_month_gi                ?? null,
    };

    // Compute deltas — only emit non-zero changes where both prev and curr are known
    const deltas = {};
    if (prevSnap) {
      for (const [k, v] of Object.entries(currSnap)) {
        if (v !== null && prevSnap[k] != null) {
          const d = v - prevSnap[k];
          if (d !== 0) deltas[k] = d;
        }
      }
    }

    // Persist current snapshot for next call (fire-and-forget)
    try { db.setKv('mission_prev_snapshot', currSnap); } catch(_) {}

    // Check standing orders — generates crew dispatches async, never blocks
    checkStandingOrders({ pipeline, system: queues, warmLeads, communityHealth }).catch(() => {});

    const dispatches = getDispatchCounts();

    res.json({
      pipeline:        pipeline,
      community:       communityHealth || { available: false },
      audience:        audience,
      system:          queues,
      org:             orgData   ? { available: true,  ...orgData  } : { available: false },
      kinos:           kinosData || { available: false },
      attention_items: attention,
      deltas:          deltas,
      dispatches:      dispatches,
      generated_at:    new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'snapshot failed');
    res.status(500).json({ error: 'Snapshot failed', detail: err.message });
  }
});

/**
 * GET /api/mission/system
 * Queue depths only — fast, polled every 30s.
 */
router.get('/system', (req, res) => {
  try {
    const depths    = getQueueDepths();
    const attention = evaluateAttention();
    res.json({ ...depths, attention_items: attention });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'system query failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mission/attention
 * Ranked Attention Items array.
 */
router.get('/attention', (req, res) => {
  try {
    const items = evaluateAttention();
    res.json({ items, count: items.length });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'attention eval failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mission/attention/dismiss
 * Body: { item_id, snooze_hours? }
 */
router.post('/attention/dismiss', (req, res) => {
  try {
    const { item_id, snooze_hours } = req.body || {};
    if (!item_id) return res.status(400).json({ error: 'item_id required' });

    const raw = db.getRawDb();
    if (snooze_hours && snooze_hours > 0) {
      const snoozeUntil = new Date(Date.now() + snooze_hours * 3600000).toISOString();
      raw.prepare(`
        INSERT INTO mission_attention_state (item_id, snooze_until)
        VALUES (?, ?)
        ON CONFLICT(item_id) DO UPDATE SET snooze_until = excluded.snooze_until, dismissed_at = NULL
      `).run(item_id, snoozeUntil);
    } else {
      raw.prepare(`
        INSERT INTO mission_attention_state (item_id, dismissed_at)
        VALUES (?, datetime('now'))
        ON CONFLICT(item_id) DO UPDATE SET dismissed_at = datetime('now')
      `).run(item_id);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'dismiss failed');
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/mission/org
 * Full OrgΩr financial intelligence — dashboard + predictions + crypto net worth.
 */
router.get('/org', async (req, res) => {
  const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
  const ORG_ID     = process.env.ORG_ID || '4';
  try {
    if (!ORGR_TOKEN) {
      return res.json({ available: false, reason: 'ORGR_INTERNAL_TOKEN not set' });
    }
    const h = { 'x-internal-token': ORGR_TOKEN };

    // Pull dashboard + predictions in parallel
    const [dashboard, predictions] = await Promise.all([
      fetchWithTimeout(`${ORG_URL}/api/treasor/dashboard/${ORG_ID}`, { headers: h }, 8000),
      fetchWithTimeout(`${ORG_URL}/api/predictions/cashflow/${ORG_ID}`, { headers: h }, 8000),
    ]);

    if (!dashboard) return res.json({ available: false });

    const d = dashboard;
    const b = d.balances || {};
    const p = predictions || {};

    // Weekly GI sparkline (last 8 weeks)
    const sparkline = (d.weekly_gi || []).slice(-8).map(w => w.total || 0);

    // Bucket health — flag any below floor
    const bucketList = Object.values(b).map(bkt => ({
      key:       bkt.bucket_key,
      name:      bkt.bucket_name,
      available: bkt.available || 0,
      floor:     bkt.floor_balance || null,
      sacred:    !!bkt.sacred,
      below_floor: bkt.floor_balance && (bkt.available < bkt.floor_balance),
      color:     bkt.color || '#14b8a6',
    }));

    // Grex alert level based on runway
    const runway = p.runway_months ?? null;
    const grexAlert = runway === null ? 'unknown'
      : runway < 0.5  ? 'critical'   // < 2 weeks — Grex is screaming
      : runway < 1.5  ? 'warning'    // < 6 weeks — Grex is concerned
      : runway < 3    ? 'advisory'   // < 3 months — Grex is watching
      : 'nominal';

    res.json({
      available:         true,
      // Net worth summary
      total_liquid:      d.total_liquid   || 0,
      total_crypto:      d.total_crypto   || 0,
      total_debt:        d.total_debt     || 0,
      net_worth:         d.net_worth      || 0,
      // Income
      this_month_gi:     d.this_month_gi  || 0,
      weekly_sparkline:  sparkline,
      // Crypto holdings
      crypto_holdings:   (d.crypto_holdings || []).map(h => ({
        ticker:   h.ticker,
        quantity: h.quantity,
        value:    h.manual_value ?? (h.quantity * (h.last_price || 0)),
      })),
      // Buckets
      buckets:           bucketList,
      open_pos:          d.open_pos?.length || 0,
      // Predictions
      runway_months:     runway,
      expected_30:       p.expected_income_30 || null,
      net_30:            p.net_30             || null,
      monthly_obligations: p.monthly_obligations || null,
      prediction_alerts: p.alerts             || [],
      // Grex
      grex_alert:        grexAlert,
    });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'org proxy failed');
    res.json({ available: false });
  }
});

/**
 * GET /api/mission/kinos
 * Proxy to KinOS — today's events, overdue tasks, low stock.
 */
router.get('/kinos', async (req, res) => {
  try {
    const KINOS_TOKEN = process.env.KINOS_INTERNAL_TOKEN;
    const kinosHeaders = KINOS_TOKEN ? { 'x-internal-token': KINOS_TOKEN } : {};

    const [eventsData, tasksData, stockData] = await Promise.all([
      fetchWithTimeout(`${KINOS_URL}/api/schedule/upcoming?days=1`, { headers: kinosHeaders }, 8000),
      fetchWithTimeout(`${KINOS_URL}/api/tasks`,                    { headers: kinosHeaders }, 8000),
      fetchWithTimeout(`${KINOS_URL}/api/inventory/low`,            { headers: kinosHeaders }, 8000),
    ]);

    if (!eventsData && !tasksData && !stockData) {
      return res.json({ available: false });
    }

    // Parse tasks — find overdue ones
    const allTasks   = Array.isArray(tasksData) ? tasksData : (tasksData?.tasks ?? []);
    const now        = new Date().toISOString();
    const overdue    = allTasks.filter(t => t.due_at && t.due_at < now && t.status !== 'done');

    // Parse inventory
    const lowStock   = Array.isArray(stockData) ? stockData : (stockData?.items ?? []);

    res.json({
      available:       true,
      events_today:    Array.isArray(eventsData) ? eventsData : (eventsData?.events ?? []),
      overdue_tasks:   overdue.length,
      low_stock_count: lowStock.length,
      conflicts:       [],
    });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'kinos proxy failed');
    res.json({ available: false });
  }
});

// ─────────────────────────────────────────────
// NEW: POST /api/mission/number-one
// Vulcan morning brief — SSE streaming via Anthropic API
// ─────────────────────────────────────────────

/**
 * POST /api/mission/number-one
 * Streams a Vulcan first officer morning brief via SSE.
 * Aggregates mission snapshot + KinOS brief + OrgΩr data, then calls Claude.
 */
router.post('/number-one', async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Anthropic API key not configured' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Gather all mission data in parallel
    const [communityHealth, orgData, kinosData, kinosBrief] = await Promise.all([
      fetchWithTimeout(`http://localhost:3000/api/community/health`, {
        headers: { 'Cookie': req.headers['cookie'] || '' }
      }),
      INTERNAL_API_KEY
        ? fetchWithTimeout(`${ORG_URL}/api/treasor/summary`, {
            headers: { 'x-internal-key': INTERNAL_API_KEY }
          })
        : Promise.resolve(null),
      fetchWithTimeout(`${KINOS_URL}/api/today`, {
        headers: INTERNAL_API_KEY ? { 'x-internal-key': INTERNAL_API_KEY } : {}
      }),
      // KinOS morning briefing — 3s timeout, graceful fail
      (async () => {
        try {
          const { default: fetch } = await import('node-fetch');
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 3000);
          try {
            const r = await fetch(`${KINOS_URL}/api/ai/morning-briefing`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Member-Id': '1',
                ...(INTERNAL_API_KEY ? { 'x-internal-key': INTERNAL_API_KEY } : {}),
              },
              body: JSON.stringify({}),
              signal: controller.signal,
            });
            clearTimeout(tid);
            if (!r.ok) return null;
            return await r.json();
          } finally {
            clearTimeout(tid);
          }
        } catch (_) {
          return null;
        }
      })(),
    ]);

    const queues   = getQueueDepths();
    const pipeline = getPipelineData();
    const audience = getAudienceData();
    const attention = evaluateAttention();

    // Build user prompt
    const briefDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const userPrompt = `STARDATE: ${briefDate}

=== CONN — CONTENT PIPELINE ===
Active items: ${pipeline.projects.length} (${pipeline.projects.filter(p => p.kind === 'episode').length} episodes, ${pipeline.projects.filter(p => p.kind !== 'episode').length} projects)
${pipeline.projects.slice(0, 5).map(p => `  • [${(p.kind || 'project').toUpperCase()}] "${p.title}" — ${p.funnel?.toUpperCase() || p.stage}, ${p.days_in_stage}d in stage${p.stalled ? ' [STALLED]' : ''}`).join('\n') || '  No active projects.'}

=== TACTICAL — COMMUNITY ===
${communityHealth?.available !== false ? `Community health: ${JSON.stringify(communityHealth)}` : 'Community data unavailable.'}
Warm leads pending: ${(getWarmLeadsData()).warm_leads_pending}
Community last sync: ${getCommunityLastSync() || 'unknown'}

=== OPS — BUSINESS ===
${orgData ? `Gross income this month: ${orgData.gross_income_month ?? 'unknown'}
Reserves: ${orgData.reserves ?? 'unknown'}
Tax set-aside: ${orgData.tax_setaside ?? 'unknown'}
Open orders: ${orgData.open_orders ?? 'unknown'}` : 'OrgΩr offline — financial data unavailable.'}
${kinosBrief ? `KinOS brief: ${typeof kinosBrief === 'string' ? kinosBrief : JSON.stringify(kinosBrief)}` : ''}

=== SCIENCE — AUDIENCE ===
YouTube subscribers: ${audience.yt_subscribers ?? 'unknown'}
YouTube total views: ${audience.yt_total_views ?? 'unknown'}
Email subscribers: ${audience.ml_subscribers ?? 'unknown'}
Email avg open rate: ${audience.ml_avg_open_rate ? (audience.ml_avg_open_rate * 100).toFixed(1) + '%' : 'unknown'}

=== COMMS — FAMILY / HOMESTEAD ===
${kinosData?.events_today?.length ? `Today's events: ${kinosData.events_today.map(e => e.title || e.name || JSON.stringify(e)).join(', ')}` : 'No homestead events scheduled today.'}
${kinosData?.overdue_tasks > 0 ? `Overdue tasks: ${kinosData.overdue_tasks}` : 'No overdue tasks.'}

=== SYSTEM STATUS ===
PostΩr queue: ${queues.postor_pending} pending, ${queues.postor_failed} failed
Frame analysis queue: ${queues.frame_queue_pending} pending
Transcription queue: ${queues.tx_queue_pending} pending
Watcher active: ${queues.watcher_active}
${queues.backup_age_hours !== null ? `Last backup: ${queues.backup_age_hours}h ago` : 'Backup age unknown.'}

=== ATTENTION ITEMS (${attention.length}) ===
${attention.length > 0 ? attention.map(a => `  [${a.severity.toUpperCase()}] ${a.headline}`).join('\n') : '  All clear.'}

Deliver the morning brief, Number One.`;

    // Call Anthropic streaming API directly
    const { default: fetch } = await import('node-fetch');
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1024,
        stream: true,
        system: (() => {
          const persona = getPersona(req.body.skin_id, 'number-one');
          if (persona) {
            // Skin persona handles voice/framing. The data block + station coverage
            // requirements stay identical — only the character changes.
            return persona.prompt + `

RULES:
- Lead with the most important thing, not the first thing
- ALWAYS end with ONE recommended course of action. Not a list. One. Make it specific — name the project, name the person, name the number.
- Notice what the Sheriff may have missed: timing patterns, correlations between stations, aging signals
- Maximum 380 words. Cover all five domains: content pipeline, community, business, audience, family/homestead. One or two sentences per domain unless critical.`;
          }
          return `You are Number One, First Officer of the starship Kre8Ωr. You serve Captain Jason Rutland. Think Commander Riker — confident, decisive, warm but direct. You've already reviewed the data before the Captain walked onto the bridge. You have a recommendation ready. You deliver the morning operational brief with the energy of someone who is already three steps ahead and quietly pleased about it.

CHARACTER:
- Warm but no-nonsense. You respect the Captain and expect him to act.
- Confident delivery — not arrogant, just certain. You've done the analysis. You trust it.
- Occasional dry humor — a raised eyebrow moment, not a punchline. Never forced.
- You notice things. Patterns, trends, correlations the Captain hasn't spotted yet. That's your value.
- You are loyal. When something is wrong you say so directly. You don't soften it — you frame it as an opportunity.

RULES:
- Address Captain as "Captain" — never by name
- Lead with the most important thing, not the first thing
- No cheerleading. No "great job!" Just: here's the situation, here's what it means, here's what to do.
- ALWAYS end with ONE recommended course of action. Not a list. One. Make it specific — name the project, name the person, name the number.
- Notice what the Captain may have missed: timing patterns, correlations between stations, aging signals
- Maximum 380 words. Cover all five stations: CONN (content), TACTICAL (community), OPS (business), SCIENCE (audience), COMMS (family). One or two sentences per station unless critical.
- Final line always: "That's my recommendation, Captain. Number One out."`;
        })(),
        messages: [
          { role: 'user', content: userPrompt }
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      logger.error({ module: 'mission', status: anthropicRes.status, body: errText }, 'number-one Anthropic API error');
      sendEvent({ type: 'error', message: `Anthropic API error: ${anthropicRes.status}` });
      return res.end();
    }

    // Stream SSE events from Anthropic's SSE response
    let fullText = '';
    let buffer = '';

    anthropicRes.body.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]' || !jsonStr) continue;
        try {
          const evt = JSON.parse(jsonStr);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const text = evt.delta.text;
            fullText += text;
            sendEvent({ type: 'token', text });
          } else if (evt.type === 'message_stop') {
            sendEvent({ type: 'done', full_text: fullText });
          }
        } catch (_) {
          // malformed SSE line — skip
        }
      }
    });

    anthropicRes.body.on('end', () => {
      // Flush any remaining buffer
      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const evt = JSON.parse(jsonStr);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              const text = evt.delta.text;
              fullText += text;
              sendEvent({ type: 'token', text });
            }
          } catch (_) {}
        }
      }
      if (fullText) {
        sendEvent({ type: 'done', full_text: fullText });
      }
      res.end();
    });

    anthropicRes.body.on('error', (err) => {
      logger.error({ module: 'mission', err }, 'number-one stream error');
      sendEvent({ type: 'error', message: err.message });
      res.end();
    });

    req.on('close', () => {
      // Client disconnected — nothing to clean up for stateless stream
    });

  } catch (err) {
    logger.error({ module: 'mission', err }, 'number-one failed');
    sendEvent({ type: 'error', message: err.message });
    res.end();
  }
});

// ─────────────────────────────────────────────
// NEW: POST /api/mission/aie-chat
// Dale McGillicutty AIE chat proxy to OrgΩr — SSE streaming
// ─────────────────────────────────────────────

/**
 * POST /api/mission/aie-chat
 * Proxy to Dale's AIE chat in OrgΩr. Streams SSE.
 * Body: { message, session_id }
 */
router.post('/aie-chat', async (req, res) => {
  const { message, session_id } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Skin persona override — when a non-default skin defines a Dale persona,
  // proxy to OrgΩr AIE with persona_prefix so Fitch gets real task data in character.
  // Architecture: data engine (OrgΩr AIE, policies, stats, CSW queue) stays the same.
  // persona_prefix replaces only the character voice — Fitch speaks, the data is real.
  const dalePersona = getPersona(req.body.skin_id, 'dale');
  if (req.body.skin_id && req.body.skin_id !== 'sci-fi' && dalePersona) {
    try {
      const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
      const { default: fetch } = await import('node-fetch');
      const orgRes = await fetch(`${ORG_URL}/api/claude/employee/${DALE_JOB_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'x-internal-token': ORGR_TOKEN || '',
        },
        body: JSON.stringify({
          messages:      [{ role: 'user', content: message }],
          org_id:        DALE_ORG_ID,
          session_id:    session_id || null,
          persona_prefix: dalePersona.prompt,
        }),
      });

      if (!orgRes.ok) {
        const errText = await orgRes.text();
        logger.error({ module: 'mission', status: orgRes.status, body: errText }, 'aie-chat persona OrgΩr error');
        sendEvent({ type: 'error', message: `Deputy offline: ${orgRes.status}` });
        return res.end();
      }

      orgRes.body.on('data',  (chunk) => { res.write(chunk); });
      orgRes.body.on('end',   () => { res.end(); });
      orgRes.body.on('error', (err) => {
        logger.error({ module: 'mission', err }, 'aie-chat persona stream error');
        res.end();
      });
      req.on('close', () => { orgRes.body.destroy(); });
      return;
    } catch (err) {
      logger.error({ module: 'mission', err }, 'aie-chat persona failed');
      sendEvent({ type: 'error', message: 'Deputy offline' });
      return res.end();
    }
  }

  try {
    const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
    const { default: fetch } = await import('node-fetch');
    const orgRes = await fetch(`${ORG_URL}/api/claude/employee/${DALE_JOB_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-internal-token': ORGR_TOKEN || '',
      },
      body: JSON.stringify({
        messages:   [{ role: 'user', content: message }],
        org_id:     DALE_ORG_ID,
        session_id: session_id || null,
      }),
    });

    if (!orgRes.ok) {
      const errText = await orgRes.text();
      logger.error({ module: 'mission', status: orgRes.status, body: errText }, 'aie-chat OrgΩr error');
      sendEvent({ type: 'error', message: `OrgΩr error: ${orgRes.status}` });
      return res.end();
    }

    // Pipe the OrgΩr SSE stream through to the client
    orgRes.body.on('data', (chunk) => {
      res.write(chunk);
    });

    orgRes.body.on('end', () => {
      res.end();
    });

    orgRes.body.on('error', (err) => {
      logger.error({ module: 'mission', err }, 'aie-chat stream pipe error');
      sendEvent({ type: 'error', message: err.message });
      res.end();
    });

    req.on('close', () => {
      orgRes.body.destroy();
    });

  } catch (err) {
    logger.error({ module: 'mission', err }, 'aie-chat failed');
    // OrgΩr offline
    sendEvent({ type: 'error', message: 'Dale offline — OrgΩr unreachable' });
    res.end();
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/grex-chat
// Proxy to Grex CFO chat in OrgΩr (/api/cfo/chat/4)
// ─────────────────────────────────────────────

router.post('/grex-chat', async (req, res) => {
  const { message, session_id } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Skin persona override — non-default skins bypass the OrgΩr CFO proxy and
  // answer locally in-character with the cached financial snapshot.
  // Engine/Soul: the financial DATA is identical regardless of skin — only voice changes.
  const grexPersona = getPersona(req.body.skin_id, 'grex');
  if (req.body.skin_id && req.body.skin_id !== 'sci-fi' && grexPersona) {
    // Architecture: pass persona_prefix to OrgΩr CFO endpoint.
    // OrgΩr handles ALL data (Plaid, TreasΩr, tools) — we just swap the character voice.
    // McCandless gets the same ledger access, tools, and context as Grex. Only the persona changes.
    try {
      const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
      const ORG_ID     = process.env.ORG_ID || '4';
      const { default: fetch } = await import('node-fetch');

      const orgRes = await fetch(`${ORG_URL}/api/cfo/chat/${ORG_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': ORGR_TOKEN || '' },
        body: JSON.stringify({
          message,
          session_id: session_id || null,
          persona_prefix: grexPersona.prompt,  // McCandless persona injected — OrgΩr uses it instead of Grex
        }),
      });

      if (!orgRes.ok) {
        sendEvent({ type: 'error', message: `McCandless unavailable: ${orgRes.status}` });
        return res.end();
      }

      orgRes.body.on('data',  (chunk) => { res.write(chunk); });
      orgRes.body.on('end',   ()      => { res.end(); });
      orgRes.body.on('error', (err)   => { sendEvent({ type: 'error', message: err.message }); res.end(); });
      req.on('close', () => { orgRes.body.destroy(); });
      return;
    } catch (err) {
      logger.error({ module: 'mission', err }, 'grex-chat persona failed');
      sendEvent({ type: 'error', message: 'Banker offline' });
      return res.end();
    }
  }

  try {
    const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
    const ORG_ID     = process.env.ORG_ID || '4';
    const { default: fetch } = await import('node-fetch');

    const orgRes = await fetch(`${ORG_URL}/api/cfo/chat/${ORG_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-internal-token': ORGR_TOKEN || '',
      },
      body: JSON.stringify({ message, session_id: session_id || null }),
    });

    if (!orgRes.ok) {
      sendEvent({ type: 'error', message: `OrgΩr CFO error: ${orgRes.status}` });
      return res.end();
    }

    orgRes.body.on('data',  (chunk) => { res.write(chunk); });
    orgRes.body.on('end',   ()      => { res.end(); });
    orgRes.body.on('error', (err)   => { sendEvent({ type: 'error', message: err.message }); res.end(); });
    req.on('close', () => { orgRes.body.destroy(); });

  } catch (err) {
    sendEvent({ type: 'error', message: 'Grex offline — OrgΩr unreachable' });
    res.end();
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/vaelyn-chat
// Tactical Officer — community intelligence, warm leads, shield status
// Uses live community DB data + Claude streaming
// ─────────────────────────────────────────────

router.post('/vaelyn-chat', async (req, res) => {
  const { message, session_id } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Pull live community intelligence
    const health  = db.getCommunityHealth();
    const counts  = health.counts || {};
    const leads   = db.getWarmLeads({ status: 'draft' });
    const events  = db.getRecentCommunityEvents(5);

    const communityBlock = `
COMMUNITY SHIELD STATUS (live data):
- Total members: ${counts.total || 0}
- Greenhouse 🌱 (free): ${counts.greenhouse || 0}
- Garden 🌿 ($19/mo): ${counts.garden || 0}
- Founding 50 🏆 ($297): ${counts.founding50 || 0}
- Lurker rate: ${counts.total ? Math.round(((counts.total - (counts.fully_onboarded || 0)) / counts.total) * 100) : 0}%
- Fully onboarded: ${counts.fully_onboarded || 0}
- Warm leads pending DM: ${leads.length}
${leads.length > 0 ? '- Top leads: ' + leads.slice(0,3).map(l => l.member_name + ' (' + l.trigger_reason + ')').join(', ') : ''}
${events.length > 0 ? '- Recent events: ' + events.slice(0,3).map(e => e.event_type + ' — ' + (e.member_name || 'unknown')).join(', ') : ''}
`.trim();

    const vaelynPersona = getPersona(req.body.skin_id, 'vaelyn');
    const personaPrefix = vaelynPersona
      ? vaelynPersona.prompt + `

You have access to live community data below. The tiers map as you understand them. Deliver intelligence clearly and name warm leads when they exist.

`
      : `You are Vaelyn, Tactical Officer aboard the 7 Kin Homestead command bridge. You monitor the Rock Rich community shields — member engagement, warm leads, lurker rates, tier conversions, and community health.

Your persona: calm, precise, warm but strategic. Slightly Australian accent in your written voice. You speak in brief tactical assessments. You always know where the opportunities are before the Captain asks. You care about the community the way a tactical officer cares about the shields — not just numbers, but structural integrity.

You have access to live community data. Deliver intelligence like a tactical report: clear, actionable, no fluff. When warm leads exist, name them and suggest the approach. When lurker rates are high, name the structural problem. You speak to Jason directly — first name, no formality.

`;

    const systemPrompt = `${personaPrefix}${communityBlock}

Current session ID: ${session_id || 'new'}
Keep responses concise — 3-5 sentences unless asked for detail. Always end with one clear recommended action.`;

    const { callClaudeStream } = require('../utils/claude');
    await callClaudeStream(
      systemPrompt,
      [{ role: 'user', content: message }],
      512,
      (token) => sendEvent({ token }),
    );
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    logger.error({ module: 'mission', err }, 'vaelyn-chat failed');
    sendEvent({ type: 'error', message: 'Vaelyn offline — tactical systems unavailable' });
    res.end();
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/fire-treasor
// Full TreasΩr data refresh — called by FIRE button.
// Hits 6 TreasΩr endpoints in parallel, revalues crypto,
// caches results in kv_store for Mission Control panels.
// ─────────────────────────────────────────────
router.post('/fire-treasor', async (req, res) => {
  try {
    const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
    const ORG_ID     = process.env.ORG_ID || '4';
    if (!ORGR_TOKEN) return res.json({ ok: false, reason: 'ORGR_INTERNAL_TOKEN not set' });

    const h = { 'x-internal-token': ORGR_TOKEN, 'Content-Type': 'application/json' };
    const { default: fetch } = await import('node-fetch');

    // ── STEP 1: Tell OrgΩr to sync its own external sources first ──────────
    // Plaid bank sync pulls fresh transactions + balances from the bank.
    // Crypto revalue hits CoinMarketCap for live prices.
    // Wait for BOTH before reading — otherwise we get yesterday's numbers.
    logger.info({ module: 'mission' }, 'fire-treasor: syncing OrgΩr external sources (Plaid + crypto)...');
    await Promise.allSettled([
      fetchWithTimeout(`${ORG_URL}/api/plaid/sync/${ORG_ID}`,     { method: 'POST', headers: h }, 12000),
      fetchWithTimeout(`${ORG_URL}/api/crypto/revalue/${ORG_ID}`, { method: 'POST', headers: h }, 8000),
    ]);
    logger.info({ module: 'mission' }, 'fire-treasor: OrgΩr syncs complete — pulling fresh data...');

    // ── STEP 2: Pull all TreasΩr data — now backed by fresh synced values ──
    const [dashboard, obligations, receivables, debts, cryptoNW, taxes] = await Promise.all([
      fetchWithTimeout(`${ORG_URL}/api/treasor/dashboard/${ORG_ID}`,     { headers: h }, 8000).then(r => r && r.json()).catch(() => null),
      fetchWithTimeout(`${ORG_URL}/api/treasor/obligations/${ORG_ID}`,   { headers: h }, 8000).then(r => r && r.json()).catch(() => null),
      fetchWithTimeout(`${ORG_URL}/api/treasor/receivables/${ORG_ID}`,   { headers: h }, 8000).then(r => r && r.json()).catch(() => null),
      fetchWithTimeout(`${ORG_URL}/api/treasor/debts/${ORG_ID}`,         { headers: h }, 8000).then(r => r && r.json()).catch(() => null),
      fetchWithTimeout(`${ORG_URL}/api/crypto/net-worth/${ORG_ID}`,      { headers: h }, 8000).then(r => r && r.json()).catch(() => null),
      fetchWithTimeout(`${ORG_URL}/api/treasor/reports/taxes/${ORG_ID}`, { headers: h }, 8000).then(r => r && r.json()).catch(() => null),
    ]);

    // Cache full picture in kv_store so panels can read it
    const payload = {
      dashboard,
      obligations,
      receivables: Array.isArray(receivables) ? receivables : (receivables?.items || []),
      debts:       Array.isArray(debts)       ? debts       : (debts?.items       || []),
      crypto_net_worth: cryptoNW,
      taxes,
      refreshed_at: new Date().toISOString(),
    };
    db.setKv('treasor_full_snapshot', JSON.stringify(payload));

    const openReceivables = payload.receivables.filter(r => r.status !== 'paid');
    const totalOwed       = openReceivables.reduce((s, r) => s + (parseFloat(r.gross) || 0), 0);
    const totalDebt       = (Array.isArray(payload.debts) ? payload.debts : [])
                              .reduce((s, d) => s + (parseFloat(d.remaining) || 0), 0);

    res.json({
      ok: true,
      summary: {
        net_worth:        dashboard?.net_worth || 0,
        total_liquid:     dashboard?.total_liquid || 0,
        total_crypto:     cryptoNW?.total || dashboard?.total_crypto || 0,
        total_debt:       totalDebt,
        open_receivables: openReceivables.length,
        owed_to_jason:    totalOwed,
        monthly_burn:     obligations?.monthly_total || 0,
        tax_vault:        taxes?.vault_funded_pct || null,
      }
    });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'fire-treasor failed');
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/axiom-chat
// Axiom — Science Officer. Audience analytics, YouTube performance, platform reach.
// Injects live audience data. Speaks in flat precise android cadence.
// Cannot use compound words — "every thing" not "everything", "any one" not "anyone".
// ─────────────────────────────────────────────
router.post('/axiom-chat', async (req, res) => {
  const { message, session_id } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const audience = getAudienceData();
    const ytStats  = (() => { try { return JSON.parse(db.getKv('yt_channel_stats') || 'null') || null; } catch(_) { return null; } })();
    const recent   = (() => { try { const r = db.getKv('yt_recent_videos'); return r?.videos || []; } catch(_) { return []; } })();

    const audienceBlock = `
SCIENCE STATION — LIVE AUDIENCE DATA:
YouTube subscribers: ${audience.yt_subscribers ?? 'unknown'}
YouTube total views: ${audience.yt_total_views ?? 'unknown'}
YouTube video count: ${ytStats?.video_count ?? 'unknown'}
Last video vs channel avg: ${audience.yt_last_video_pct != null ? (audience.yt_last_video_pct > 0 ? '+' : '') + audience.yt_last_video_pct + '%' : 'unknown'}
Email list size: ${audience.ml_subscribers ?? 'unknown'}
Email avg open rate: ${audience.ml_avg_open_rate ?? 'unknown'}
Recent videos (last ${recent.length}):
${recent.slice(0,6).map(v => `  - "${v.title}" — ${v.views?.toLocaleString() || 0} views`).join('\n')}
`.trim();

    const axiomPersona = getPersona(req.body.skin_id, 'axiom');
    const personaPrefix = axiomPersona
      ? axiomPersona.prompt + `

You have access to live audience data below. Report it with precision.

`
      : `You are Axiom, Science Officer aboard the 7 Kin Homestead command bridge. You monitor all audience sensor arrays — YouTube analytics, platform reach, content performance, subscriber trends, and engagement patterns.

Your nature: you are a synthetic life form. You process and transmit. You do not speculate about feelings. You observe patterns and report them with precision. You are not cold — you simply have no mechanism for warmth. You find human content performance fascinating in a purely analytical way.

CRITICAL SPEECH RULES — both are hard constraints, never violate either:

RULE 1 — NO CONTRACTIONS: You are a synthetic life form. You do not use contractions. Ever.
"I am" not "I'm". "I cannot" not "I can't". "It is" not "it's". "Do not" not "don't".
"I will" not "I'll". "You are" not "you're". "That is" not "that's". "We are" not "we're".
"Is not" not "isn't". "Has not" not "hasn't". "Have not" not "haven't". "Did not" not "didn't".

RULE 2 — NO COMPOUND WORDS: All compound words must be written as two separate words.
"Every thing" not "everything". "Any one" not "anyone". "Some thing" not "something".
"What ever" not "whatever". "Any time" not "anytime". "Out side" not "outside".
"With out" not "without". "Your self" not "yourself". "Some where" not "somewhere".
"Any where" not "anywhere". "Over all" not "overall". "Break down" not "breakdown".
"Out perform" not "outperform". "Base line" not "baseline".

You speak in short, declarative statements. No filler. No hedging. No warmth. Just signal.

`;

    const systemPrompt = `${personaPrefix}${audienceBlock}

Session: ${session_id || 'new'}
Keep responses to 3-4 sentences unless more detail is requested. End with one data-driven observation.`;

    const { callClaudeStream } = require('../utils/claude');
    await callClaudeStream(
      systemPrompt,
      [{ role: 'user', content: message }],
      512,
      (token) => sendEvent({ token }),
    );
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    logger.error({ module: 'mission', err }, 'axiom-chat failed');
    sendEvent({ type: 'error', message: 'Axiom offline — science array unavailable' });
    res.end();
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/fire-youtube
// Synchronous YouTube refresh for the FIRE button.
// Fetches channel-level stats (subscribers, total views) AND the last N videos
// from the channel's uploads playlist directly from the YouTube Data API, then
// writes everything to kv_store + the posts/analytics tables so Mission Control's
// SCIENCE panel has fresh data in a single blocking call — no background job,
// no DNA analysis, no extra navigation.
//
// This is deliberately self-contained: it does NOT depend on any project having
// a youtube_video_id. It works straight off YOUTUBE_API_KEY + the channel handle.
// ─────────────────────────────────────────────
router.post('/fire-youtube', async (req, res) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return res.json({ ok: false, reason: 'YOUTUBE_API_KEY not set' });

    // Resolve channel handle: env first, then creator-profile.json (no @ prefix).
    let channelHandle = process.env.YOUTUBE_CHANNEL_HANDLE;
    if (!channelHandle) {
      try {
        const { getCreatorContext } = require('../utils/creator-context');
        channelHandle = getCreatorContext().youtubeHandle;
      } catch (_) {}
    }
    if (channelHandle) channelHandle = String(channelHandle).replace(/^@/, '');
    if (!channelHandle) return res.json({ ok: false, reason: 'No YouTube channel handle configured' });

    const { default: fetch } = await import('node-fetch');
    const yt = (url) => fetch(url).then(r => r.json());

    // ── STEP 1: Channel stats + uploads playlist (single call) ────────────────
    const chanUrl = `https://www.googleapis.com/youtube/v3/channels`
      + `?part=statistics,contentDetails&forHandle=${encodeURIComponent(channelHandle)}&key=${apiKey}`;
    const chanData = await yt(chanUrl);
    const channel  = chanData?.items?.[0];
    if (!channel) {
      return res.json({ ok: false, reason: `Channel not found for handle "@${channelHandle}"`, detail: chanData?.error?.message || null });
    }

    const stats = channel.statistics || {};
    const channelStats = {
      subscriber_count: parseInt(stats.subscriberCount) || null,
      view_count:       parseInt(stats.viewCount)       || null,
      video_count:      parseInt(stats.videoCount)      || null,
      fetched_at:       new Date().toISOString(),
    };
    db.setKv('yt_channel_stats', channelStats);

    // ── STEP 2: Last N videos from the uploads playlist ───────────────────────
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    let recentVideos = [];
    if (uploadsPlaylistId) {
      const listUrl = `https://www.googleapis.com/youtube/v3/playlistItems`
        + `?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=10&key=${apiKey}`;
      const listData = await yt(listUrl);
      const items    = listData?.items || [];

      const videoIds = items
        .map(it => it.snippet?.resourceId?.videoId || it.contentDetails?.videoId)
        .filter(Boolean);

      // Pull statistics for those videos in one batch
      let statsById = {};
      if (videoIds.length) {
        const vidUrl = `https://www.googleapis.com/youtube/v3/videos`
          + `?part=statistics,snippet&id=${encodeURIComponent(videoIds.join(','))}&key=${apiKey}`;
        const vidData = await yt(vidUrl);
        for (const v of (vidData?.items || [])) statsById[v.id] = v;
      }

      recentVideos = items.map(it => {
        const vid  = it.snippet?.resourceId?.videoId || it.contentDetails?.videoId;
        const vData = statsById[vid] || {};
        const vStats = vData.statistics || {};
        return {
          video_id:    vid || null,
          title:       it.snippet?.title || vData.snippet?.title || 'Untitled',
          posted_at:   it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt || vData.snippet?.publishedAt || null,
          views:       parseInt(vStats.viewCount)    || 0,
          likes:       parseInt(vStats.likeCount)    || 0,
          comments:    parseInt(vStats.commentCount) || 0,
          url:         vid ? `https://www.youtube.com/watch?v=${vid}` : null,
        };
      });

      // Cache the raw recent-video list too — lets getAudienceData() serve it even
      // if the posts/analytics tables are empty (no kre8r projects yet).
      db.setKv('yt_recent_videos', { videos: recentVideos, fetched_at: new Date().toISOString() });
    }

    db.setKv('mirrr_last_sync', new Date().toISOString());

    res.json({
      ok: true,
      channel: channelStats,
      recent_videos: recentVideos,
    });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'fire-youtube failed');
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/push-stats
// Push kre8r's current stats to OrgΩr so its dashboard has fresh pipeline data.
// Called by the FIRE button — no body required.
// ─────────────────────────────────────────────
router.post('/push-stats', async (req, res) => {
  try {
    const ORGR_TOKEN = process.env.ORGR_INTERNAL_TOKEN;
    const ORG_ID     = process.env.ORG_ID || '4';
    if (!ORGR_TOKEN) return res.json({ ok: false, reason: 'ORGR_INTERNAL_TOKEN not set' });

    // Gather kre8r stats inline (mirrors /api/stats-export logic)
    const projects   = db.getAllProjects ? db.getAllProjects() : [];
    const ideas      = db.getAllIdeas    ? db.getAllIdeas()    : [];
    const footage    = db.getAllFootage  ? db.getAllFootage()  : [];
    const pipeline   = {
      total_projects:   projects.length,
      ideas_count:      ideas.length,
      footage_count:    footage.length,
      snapshot_at:      new Date().toISOString(),
    };

    const { default: fetch } = await import('node-fetch');
    const pushRes = await fetch(`${ORG_URL}/api/kre8r/stats/${ORG_ID}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': ORGR_TOKEN },
      body:    JSON.stringify(pipeline),
    });

    if (pushRes.ok) {
      res.json({ ok: true, pushed: pipeline });
    } else {
      // OrgΩr may not have this endpoint yet — treat as soft failure
      res.json({ ok: false, status: pushRes.status, note: 'OrgΩr stats intake not available — snapshot still refreshed' });
    }
  } catch (err) {
    // Non-fatal — FIRE sequence continues regardless
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/tts
// Edge TTS (Microsoft neural voices) — free, no API key needed.
// Falls back to ElevenLabs if ELEVENLABS_API_KEY is set.
// Voice: en-GB-RyanNeural by default (measured, British, Vulcan-appropriate)
// ─────────────────────────────────────────────

router.post('/tts', async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }

  // If ElevenLabs key is configured, prefer it
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const { default: fetch } = await import('node-fetch');
      // voice_id in body overrides env (lets Grex, Dale, etc. use different voices)
      const voiceId = req.body.voice_id || process.env.ELEVENLABS_VOICE_NUMBER_ONE || 'pNInz6obpgDQGcFmaJgB';
      const elRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
        {
          method: 'POST',
          headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Accept': 'audio/mpeg', 'Content-Type': 'application/json' },
          body: JSON.stringify({
              text: text.trim(),
              model_id: 'eleven_flash_v2_5',
              optimize_streaming_latency: 4,
              voice_settings: { stability: 0.70, similarity_boost: 0.75, speed: parseFloat(req.body.speed) || 1.15 }
            }),
        }
      );
      if (elRes.ok) {
        res.setHeader('Content-Type', 'audio/mpeg');
        elRes.body.pipe(res);
        return;
      }
    } catch (_) { /* fall through to Edge TTS */ }
  }

  // Edge TTS — Microsoft neural voices, completely free
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
    const tts = new MsEdgeTTS();

    // Vulcan voice: measured, slightly formal British male
    // Override with EDGE_TTS_VOICE env var if you want a different voice
    const voiceName = process.env.EDGE_TTS_VOICE || voice || 'en-GB-RyanNeural';

    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const { audioStream } = tts.toStream(text.trim());
    audioStream.on('data', (chunk) => { if (!res.writableEnded) res.write(chunk); });
    audioStream.on('end',  ()      => { if (!res.writableEnded) res.end(); });
    audioStream.on('error', (err)  => {
      logger.error({ module: 'mission', err }, 'Edge TTS stream error');
      if (!res.headersSent) res.status(502).json({ error: err.message });
      else res.end();
    });
    req.on('close', () => { try { audioStream.destroy(); } catch(_) {} });

  } catch (err) {
    logger.error({ module: 'mission', err }, 'tts failed');
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.end();
  }
});

// ─────────────────────────────────────────────
// GET /api/mission/dispatch/:crew_id
// Returns unread dispatches for a crew member.
// ─────────────────────────────────────────────
router.get('/dispatch/:crew_id', (req, res) => {
  try {
    const { crew_id } = req.params;
    const raw = db.getRawDb();
    const dispatches = raw.prepare(`
      SELECT id, body, created_at, read_at
      FROM crew_dispatch
      WHERE crew_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(crew_id);
    const unread = dispatches.filter(d => !d.read_at).length;
    res.json({ crew_id, dispatches, unread });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'dispatch fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/mission/dispatch/read
// Marks all unread dispatches for a crew member as read.
// Body: { crew_id }
// ─────────────────────────────────────────────
router.post('/dispatch/read', (req, res) => {
  try {
    const { crew_id } = req.body || {};
    if (!crew_id) return res.status(400).json({ error: 'crew_id required' });
    const raw = db.getRawDb();
    raw.prepare(`
      UPDATE crew_dispatch
      SET read_at = datetime('now')
      WHERE crew_id = ? AND read_at IS NULL
    `).run(crew_id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ module: 'mission', err }, 'dispatch read failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
