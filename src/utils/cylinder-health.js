'use strict';

/**
 * ConductΩr — Cylinder Health Calculator
 *
 * Computes the health (green/amber/red) of each of the 5 business cylinders.
 * All calculations are deterministic — no AI, no guessing.
 * The AI layer (recommendation engine) receives these as facts, not as things to infer.
 *
 * The Five Cylinders:
 *   REACH     — top-of-funnel growth (subs, views, brand deal eligibility)
 *   AUTHORITY — niche credibility (retention, CTR, brand deal moat, book)
 *   CONVERT   — purchase intent (affiliate clicks, book, product sales)
 *   SERVE     — community warming (Greenhouse → Garden intake)
 *   RETAIN    — community retention (Garden/F50 health, membership mentions)
 *
 * Each cylinder returns: { color: 'green'|'amber'|'red', score: 0-100, status: string, details: {} }
 */

const db = require('../db');

// ── Thresholds — calibrated for 1 video/week publishing cadence ──────────────
// At 1 video/week with target mix (3 REACH, 2 AUTH, 2 CONVERT, 2 SERVE, 1 RETAIN per 10):
//   - REACH:     1 every ~3-4 weeks  → 25d is NORMAL, amber 6wk, red 10wk
//   - AUTHORITY: 1 every ~5 weeks    → 32d is NORMAL, amber 8wk, red 12wk
//   - CONVERT:   1 every ~5 weeks    → amber 8wk, red 12wk
//   - SERVE:     video-count gap     → amber 7 videos, red 10 videos
//   - RETAIN:    mention gap         → amber 15 videos, red 25 videos
const THRESHOLDS = {
  reach: {
    subGrowthPctAmber:  -0.02,
    subGrowthPctRed:    -0.05,
    daysWithoutRed:     70,   // 10 weeks without any REACH = red
    daysWithoutAmber:   42,   // 6 weeks = amber
    targetPer10:        3,
  },
  authority: {
    ctrDropAmber:       -0.10,
    ctrDropRed:         -0.20,
    retentionDropAmber: -0.08,
    retentionDropRed:   -0.15,
    daysWithoutRed:     84,   // 12 weeks without authority = red
    daysWithoutAmber:   56,   // 8 weeks = amber
    targetPer10:        2,
  },
  convert: {
    daysWithoutRed:     84,   // 12 weeks without affiliate/convert content = red
    daysWithoutAmber:   56,   // 8 weeks = amber
    clickDropPctAmber:  -0.20,
    clickDropPctRed:    -0.40,
    targetPer10:        2,
  },
  serve: {
    videosWithoutRed:   10,   // 10 videos without serving community = red (~10 weeks)
    videosWithoutAmber: 7,    // 7 videos = amber (~7 weeks)
    gardenIntakeDaysRed:   28,
    gardenIntakeDaysAmber: 14,
    targetPer10:        2,
  },
  retain: {
    membershipMentionGapAmber: 15,  // 15 videos without community mention = amber (~15 weeks)
    membershipMentionGapRed:   25,  // 25 videos = red
    gardenChurnPctAmber: 0.05,
    gardenChurnPctRed:   0.10,
    targetPer10:         1,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function getRecentProjects(limit = 15) {
  try {
    const rawDb = db.getRawDb();

    // Prefer youtube_videos — has classifications for full 200+ video history
    const ytCount = rawDb.prepare(
      `SELECT COUNT(*) as n FROM youtube_videos WHERE conductor_goal IS NOT NULL AND conductor_goal != 'SKIP'`
    ).get()?.n || 0;

    if (ytCount > 0) {
      return rawDb.prepare(
        `SELECT video_id as id, title, conductor_goal, published_at,
                view_count, privacy_status, project_id
         FROM youtube_videos
         WHERE conductor_goal IS NOT NULL AND conductor_goal != 'SKIP'
           AND published_at IS NOT NULL
         ORDER BY published_at DESC LIMIT ?`
      ).all(limit);
    }

    // Fallback: pipeline projects only (pre-YouTube sync)
    return rawDb.prepare(
      `SELECT id, title, conductor_goal, published_at, content_type, high_concept
       FROM projects
       WHERE (status IS NULL OR status != 'archived')
         AND (id8r_data IS NOT NULL OR pipr_complete = 1)
         AND title IS NOT NULL AND title != '' AND title != '1'
       ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?`
    ).all(limit);
  } catch (_) { return []; }
}

function getPublishHistory(goalType, days = 90) {
  try {
    const rawDb = db.getRawDb();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return rawDb.prepare(
      `SELECT video_id as id, title, published_at FROM youtube_videos
       WHERE conductor_goal = ? AND published_at >= ?
       ORDER BY published_at DESC`
    ).all(goalType, since);
  } catch (_) { return []; }
}

function videosSinceGoal(goalType, recentProjects) {
  // Count published videos since the last one with this goal
  let count = 0;
  for (const p of recentProjects) {
    if (p.conductor_goal === goalType) return count;
    count++;
  }
  return count; // never published this goal type
}

function getCommunityIntake(days = 14) {
  try {
    const rawDb = db.getRawDb();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return rawDb.prepare(
      `SELECT COUNT(*) as n FROM community_events
       WHERE event_type = 'tier_upgraded' AND created_at >= ?`
    ).get(since)?.n || 0;
  } catch (_) { return 0; }
}

function getAffiliateTrend() {
  try {
    const rawDb = db.getRawDb();
    const thisWeek  = rawDb.prepare(`SELECT COUNT(*) as n FROM affiliate_clicks WHERE clicked_at >= datetime('now','-7 days')`).get()?.n || 0;
    const lastWeek  = rawDb.prepare(`SELECT COUNT(*) as n FROM affiliate_clicks WHERE clicked_at >= datetime('now','-14 days') AND clicked_at < datetime('now','-7 days')`).get()?.n || 0;
    return { thisWeek, lastWeek, change: lastWeek > 0 ? (thisWeek - lastWeek) / lastWeek : null };
  } catch (_) { return { thisWeek: 0, lastWeek: 0, change: null }; }
}

function getMembershipMentionGap(recentProjects) {
  // Count how many recent videos lack community mention in title or description
  // Uses youtube_videos.description (reliable) not writr_scripts (only recent Kre8r projects)
  try {
    const rawDb = db.getRawDb();
    const keywords = ['rock rich', 'rockrich', 'community', 'garden tier', 'founding 50', 'greenhouse', 'join us', 'join the'];
    let gap = 0;
    for (const p of recentProjects) {
      // For youtube_videos rows (have video_id), check title+description directly
      const videoId = p.id; // id is actually video_id for YT rows (aliased in getRecentProjects)
      const yt = rawDb.prepare('SELECT title, description FROM youtube_videos WHERE video_id = ? LIMIT 1').get(videoId);
      const text = ((yt?.title || p.title || '') + ' ' + (yt?.description || '')).toLowerCase();
      if (keywords.some(k => text.includes(k))) return gap;
      gap++;
    }
    return gap;
  } catch (_) { return 0; }
}

function getGardenChurnRate() {
  try {
    const rawDb = db.getRawDb();
    const gardenCount = rawDb.prepare(`SELECT COUNT(*) as n FROM community_members WHERE tier = 'garden'`).get()?.n || 1;
    // Approximate churn: members who were garden last month but aren't now
    // For now, use a proxy: look for tier_downgraded events (when we add them) or just return null
    return null; // Phase 2 — requires tier downgrade tracking
  } catch (_) { return null; }
}

// ── The Five Cylinder Calculators ─────────────────────────────────────────────

function reachCylinder(recentProjects, ytHealth) {
  const t = THRESHOLDS.reach;
  const details = {};

  // Check if ANY projects have been classified yet
  const anyClassified = recentProjects.some(p => p.conductor_goal);

  // Supply signal: days since last REACH video
  const lastReach = recentProjects.find(p => p.conductor_goal === 'REACH');
  const daysSinceReach = lastReach ? daysSince(lastReach.published_at) : (anyClassified ? 999 : -1);
  details.daysSinceReach = daysSinceReach;
  details.needsClassification = !anyClassified;

  // Supply mix: REACH count in last 10
  const last10 = recentProjects.slice(0, 10);
  const reachCount = last10.filter(p => p.conductor_goal === 'REACH').length;
  details.reachIn10 = reachCount;
  details.targetIn10 = t.targetPer10;

  // Outcome: subscriber growth (from MirrΩr)
  const subGrowthPct = ytHealth?.subscriber_growth_pct || null;
  details.subGrowthPct = subGrowthPct;

  // Scoring
  let color = 'green';
  const reasons = [];

  // If no videos classified yet — show amber "needs setup", not red "crisis"
  if (!anyClassified) {
    return { cylinder: 'REACH', color: 'amber', score: 50,
      status: 'Classify your videos to track', details: { ...details, needsClassification: true } };
  }

  if (daysSinceReach >= t.daysWithoutRed) { color = 'red'; reasons.push(`${daysSinceReach}d since last REACH video`); }
  else if (daysSinceReach >= t.daysWithoutAmber && color !== 'red') { color = 'amber'; reasons.push(`${daysSinceReach}d since last REACH video`); }

  if (subGrowthPct !== null && subGrowthPct <= t.subGrowthPctRed) { color = 'red'; reasons.push('Subs declining'); }
  else if (subGrowthPct !== null && subGrowthPct <= t.subGrowthPctAmber && color !== 'red') { color = 'amber'; reasons.push('Sub growth slowing'); }

  if (reachCount < t.targetPer10 - 1 && color === 'green') { color = 'amber'; reasons.push(`Only ${reachCount}/${t.targetPer10} REACH in last 10`); }

  const score = color === 'green' ? 90 : color === 'amber' ? 55 : 20;
  const status = reasons.length ? reasons[0] : (subGrowthPct !== null ? `subs ${subGrowthPct > 0 ? '+' : ''}${Math.round(subGrowthPct * 100)}%` : 'tracking');

  return { cylinder: 'REACH', color, score, status, details };
}

function authorityCylinder(recentProjects, ytHealth) {
  const t = THRESHOLDS.authority;
  const details = {};
  const anyClassified = recentProjects.some(p => p.conductor_goal);

  const lastAuth = recentProjects.find(p => p.conductor_goal === 'AUTHORITY');
  const daysSinceAuth = lastAuth ? daysSince(lastAuth.published_at) : (anyClassified ? 999 : -1);
  details.daysSinceAuthority = daysSinceAuth;

  const last10 = recentProjects.slice(0, 10);
  const authCount = last10.filter(p => p.conductor_goal === 'AUTHORITY').length;
  details.authorityIn10 = authCount;

  // CTR and retention from YouTube health
  const ctrBaseline = ytHealth?.avg_ctr || null;
  const retBaseline = ytHealth?.avg_view_duration_pct || null;
  details.ctrBaseline = ctrBaseline;

  let color = 'green';
  const reasons = [];

  if (!anyClassified) {
    return { cylinder: 'AUTHORITY', color: 'amber', score: 50,
      status: 'Classify your videos to track', details: { ...details, needsClassification: true } };
  }

  if (daysSinceAuth >= t.daysWithoutRed) { color = 'red'; reasons.push(`${daysSinceAuth}d since AUTHORITY video`); }
  else if (daysSinceAuth >= t.daysWithoutAmber && color !== 'red') { color = 'amber'; reasons.push(`${daysSinceAuth}d since AUTHORITY video`); }

  if (authCount < t.targetPer10 - 1 && color === 'green') { color = 'amber'; reasons.push(`Only ${authCount}/${t.targetPer10} AUTHORITY in last 10`); }

  const score = color === 'green' ? 88 : color === 'amber' ? 52 : 18;
  const status = reasons.length ? reasons[0] : 'niche steady';

  return { cylinder: 'AUTHORITY', color, score, status, details };
}

function convertCylinder(recentProjects) {
  const t = THRESHOLDS.convert;
  const details = {};
  const anyClassified = recentProjects.some(p => p.conductor_goal);

  const lastConvert = recentProjects.find(p => p.conductor_goal === 'CONVERT');
  const daysSinceConvert = lastConvert ? daysSince(lastConvert.published_at) : (anyClassified ? 999 : -1);
  details.daysSinceConvert = daysSinceConvert;

  const last10 = recentProjects.slice(0, 10);
  const convertCount = last10.filter(p => p.conductor_goal === 'CONVERT').length;
  details.convertIn10 = convertCount;

  const affiliateTrend = getAffiliateTrend();
  details.affiliateClicksThisWeek = affiliateTrend.thisWeek;
  details.affiliateClicksLastWeek = affiliateTrend.lastWeek;
  details.affiliateChange = affiliateTrend.change;

  let color = 'green';
  const reasons = [];

  if (!anyClassified) {
    return { cylinder: 'CONVERT', color: 'amber', score: 50, status: `${affiliateTrend.thisWeek} affiliate clicks`, details: { ...details, needsClassification: true } };
  }

  if (daysSinceConvert >= t.daysWithoutRed) { color = 'red'; reasons.push(`${daysSinceConvert}d since CONVERT video`); }
  else if (daysSinceConvert >= t.daysWithoutAmber && color !== 'red') { color = 'amber'; reasons.push(`${daysSinceConvert} days since CONVERT video`); }

  if (affiliateTrend.change !== null && affiliateTrend.change <= t.clickDropPctRed) {
    color = 'red'; reasons.push(`Affiliate clicks down ${Math.round(Math.abs(affiliateTrend.change) * 100)}% this week`);
  } else if (affiliateTrend.change !== null && affiliateTrend.change <= t.clickDropPctAmber && color !== 'red') {
    color = 'amber'; reasons.push(`Affiliate clicks slowing`);
  }

  if (convertCount > 3 && color === 'green') {
    // Too many CONVERT videos — audience fatigue risk
    reasons.push(`${convertCount}/10 CONVERT — audience may need a give`);
    // Don't change color — just flag for recommendation engine
    details.fatigue_risk = true;
  }

  const score = color === 'green' ? 85 : color === 'amber' ? 50 : 15;
  const status = reasons.length ? reasons[0] : `${affiliateTrend.thisWeek} clicks this week`;

  return { cylinder: 'CONVERT', color, score, status, details };
}

function serveCylinder(recentProjects) {
  const t = THRESHOLDS.serve;
  const details = {};
  const anyClassified = recentProjects.some(p => p.conductor_goal);

  // The critical check: videos since last SERVE
  const vidsSinceServe = videosSinceGoal('SERVE', recentProjects);
  details.videosSinceServe = vidsSinceServe;

  const last10 = recentProjects.slice(0, 10);
  const serveCount = last10.filter(p => p.conductor_goal === 'SERVE').length;
  details.serveIn10 = serveCount;

  // Community intake: Garden tier upgrades in last 14 days
  const gardenIntake14d = getCommunityIntake(14);
  const gardenIntake7d  = getCommunityIntake(7);
  details.gardenIntake14d = gardenIntake14d;
  details.gardenIntake7d  = gardenIntake7d;

  // Days since last Garden intake
  try {
    const rawDb = db.getRawDb();
    const lastUpgrade = rawDb.prepare(
      `SELECT created_at FROM community_events WHERE event_type = 'tier_upgraded' ORDER BY created_at DESC LIMIT 1`
    ).get();
    details.daysSinceLastGardenIntake = lastUpgrade ? daysSince(lastUpgrade.created_at) : 999;
  } catch (_) { details.daysSinceLastGardenIntake = null; }

  let color = 'green';
  const reasons = [];

  // No classifications yet — show setup state, not crisis
  if (!anyClassified) {
    const intakeStatus = details.gardenIntake14d > 0
      ? `${details.gardenIntake14d} Garden upgrades (14d)`
      : details.daysSinceLastGardenIntake === 999 ? 'No tier data yet' : `No intake in ${details.daysSinceLastGardenIntake}d`;
    return { cylinder: 'SERVE', color: 'amber', score: 50,
      status: intakeStatus, details: { ...details, needsClassification: true } };
  }

  // Hard rule: 5+ videos without serving = RED (this is the ConductΩr's signature alert)
  if (vidsSinceServe >= t.videosWithoutRed) {
    color = 'red';
    reasons.push(`${vidsSinceServe} videos since you last served your community`);
  } else if (vidsSinceServe >= t.videosWithoutAmber && color !== 'red') {
    color = 'amber';
    reasons.push(`${vidsSinceServe} videos since last SERVE — watch this`);
  }

  // Only trigger Garden intake alerts if we have real tier_upgraded data (not the 999 sentinel)
  if (details.daysSinceLastGardenIntake !== 999 && details.daysSinceLastGardenIntake !== null) {
    if (details.daysSinceLastGardenIntake >= t.gardenIntakeDaysRed && color !== 'red') {
      color = 'red'; reasons.push(`No Garden intake in ${details.daysSinceLastGardenIntake} days`);
    } else if (details.daysSinceLastGardenIntake >= t.gardenIntakeDaysAmber && color === 'green') {
      color = 'amber'; reasons.push(`Garden intake slowing`);
    }
  }

  const score = color === 'green' ? 87 : color === 'amber' ? 48 : 12;
  const status = reasons.length ? reasons[0] : `${gardenIntake14d} Garden upgrades (14d)`;

  return { cylinder: 'SERVE', color, score, status, details };
}

function retainCylinder(recentProjects) {
  const t = THRESHOLDS.retain;
  const details = {};

  // Membership mention gap
  const mentionGap = getMembershipMentionGap(recentProjects);
  details.membershipMentionGap = mentionGap;

  // Community tier counts
  try {
    const rawDb = db.getRawDb();
    const gardenCount   = rawDb.prepare(`SELECT COUNT(*) as n FROM community_members WHERE tier = 'garden'`).get()?.n || 0;
    const f50Count      = rawDb.prepare(`SELECT COUNT(*) as n FROM community_members WHERE tier = 'founding50'`).get()?.n || 0;
    const greenhouseCount = rawDb.prepare(`SELECT COUNT(*) as n FROM community_members WHERE tier = 'greenhouse'`).get()?.n || 0;
    details.gardenCount     = gardenCount;
    details.f50Count        = f50Count;
    details.greenhouseCount = greenhouseCount;
  } catch (_) {}

  // F50 engagement proxy: members with recent activity
  try {
    const rawDb = db.getRawDb();
    const f50Active = rawDb.prepare(
      `SELECT COUNT(*) as n FROM community_members
       WHERE tier = 'founding50' AND last_active_at >= datetime('now','-30 days')`
    ).get()?.n || 0;
    details.f50ActiveLast30d = f50Active;
  } catch (_) {}

  const last10 = recentProjects.slice(0, 10);
  const retainCount = last10.filter(p => p.conductor_goal === 'RETAIN').length;
  details.retainIn10 = retainCount;

  let color = 'green';
  const reasons = [];

  if (mentionGap >= t.membershipMentionGapRed) {
    color = 'red'; reasons.push(`No community mention in ${mentionGap} videos — retention risk`);
  } else if (mentionGap >= t.membershipMentionGapAmber && color !== 'red') {
    color = 'amber'; reasons.push(`${mentionGap} videos without a community mention`);
  }

  const score = color === 'green' ? 82 : color === 'amber' ? 55 : 22;
  const status = reasons.length ? reasons[0] : `Garden: ${details.gardenCount || 0} · F50: ${details.f50Count || 0}`;

  return { cylinder: 'RETAIN', color, score, status, details };
}

// ── Master: compute all 5 cylinders ──────────────────────────────────────────
function computeAllCylinders() {
  const recentProjects = getRecentProjects(30); // 30 videos = ~7 weeks at 4/week

  // YouTube health from MirrΩr kv_store
  let ytHealth = null;
  try {
    const rawStats = db.getKv('yt_channel_stats');
    ytHealth = rawStats || null;
  } catch (_) {}

  const cylinders = [
    reachCylinder(recentProjects, ytHealth),
    authorityCylinder(recentProjects, ytHealth),
    convertCylinder(recentProjects),
    serveCylinder(recentProjects),
    retainCylinder(recentProjects),
  ];

  // Firing Score: weighted average with penalty for any RED
  const weights = { REACH: 20, AUTHORITY: 20, CONVERT: 20, SERVE: 25, RETAIN: 15 };
  let weightedScore = 0;
  let hasRed = false;
  for (const c of cylinders) {
    weightedScore += (c.score * (weights[c.cylinder] / 100));
    if (c.color === 'red') hasRed = true;
  }
  const firingScore = Math.round(hasRed ? Math.min(weightedScore, 65) : weightedScore);

  // Priority cylinder for recommendation (most urgent first)
  const redCylinders   = cylinders.filter(c => c.color === 'red');
  const amberCylinders = cylinders.filter(c => c.color === 'amber');
  const priorityCylinder = redCylinders[0] || amberCylinders[0] || null;

  return {
    cylinders,
    firingScore,
    priorityCylinder,
    hasRed,
    recentProjects: recentProjects.slice(0, 10),
    ytHealth,
    computedAt: new Date().toISOString(),
  };
}

// ── Content goal suggestion (AI-assisted, 1 call) ─────────────────────────────
async function suggestContentGoal(project) {
  try {
    // callClaudeMessages(system, messages, maxTokens) — correct signature
    const { callClaudeMessages } = require('./claude');

    const system = `You classify YouTube videos for a homesteading creator (7 Kin Homestead — off-grid living, financial freedom, DIY, community building).

GOALS:
- REACH: Broad appeal, viral potential, top-of-funnel growth. Dramatic transformations, big number reveals, survival/lifestyle stories. Brings in NEW viewers.
- AUTHORITY: Deep expertise, credibility building. System explanations, "how it works", philosophy, long-form guides. Builds trust for brand deals and book sales.
- CONVERT: Purchase intent. Product reviews, how-to with specific product recommendations, gear guides, affiliate content. Drives clicks and sales.
- SERVE: Community value. Thank-you videos, community updates, "I built this for you", member stories, inside looks. Warms free members toward paid tiers.
- RETAIN: Retention and loyalty. Premium/exclusive content, founding member previews, long-term journey updates. Keeps paid members engaged.

Return ONLY one word from: REACH, AUTHORITY, CONVERT, SERVE, RETAIN
If you truly cannot determine the goal from the title, return: SKIP`;

    // Use title + first 400 chars of description for much better accuracy than title alone
    // The description hook usually reveals the real purpose (affiliate link? community CTA? expert guide?)
    const descSnippet = (project.topic || project.description || '').slice(0, 400);
    const userMsg = `Title: ${project.title || 'Untitled'}
${descSnippet ? `\nDescription/hook: ${descSnippet}` : ''}
${project.view_count ? `\nViews: ${project.view_count.toLocaleString()}` : ''}`;

    const result = await callClaudeMessages(system, [{ role: 'user', content: userMsg }], 15);
    const goal = (result || '').trim().toUpperCase().split(/\s/)[0]; // take first word only
    const valid = ['REACH', 'AUTHORITY', 'CONVERT', 'SERVE', 'RETAIN'];
    return valid.includes(goal) ? goal : null; // null → SKIP in the batch handler
  } catch (err) {
    console.error('[suggestContentGoal]', err.message);
    return null;
  }
}

module.exports = { computeAllCylinders, suggestContentGoal, videosSinceGoal, THRESHOLDS };
