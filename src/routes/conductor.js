'use strict';

/**
 * ConductΩr — Business Cockpit
 *
 * GET  /api/conductor/dashboard    — the One Screen data (cylinders + firing score + recommendation)
 * GET  /api/conductor/cylinders    — just the 5 cylinders (lightweight refresh)
 * POST /api/conductor/goal/:id     — set conductor_goal on a project
 * POST /api/conductor/goal/suggest — AI-suggest goal for a project
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { callClaude } = require('../utils/claude');
const { getCreatorContext } = require('../utils/creator-context');
const { computeAllCylinders, suggestContentGoal, THRESHOLDS } = require('../utils/cylinder-health');
const { syncYouTubeHistory } = require('../utils/youtube-sync');

// Cache the dashboard result for 6 hours (recommendation engine is expensive)
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000;

// ── GET /api/conductor/dashboard ─────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const now = Date.now();

    if (!forceRefresh && _cache && (now - _cacheAt) < CACHE_TTL) {
      return res.json({ ...(_cache), cached: true, cacheAge: Math.round((now - _cacheAt) / 60000) + 'm' });
    }

    // Compute cylinder health (deterministic, fast)
    const health = computeAllCylinders();

    // Generate recommendation (AI, single call)
    const recommendation = await generateRecommendation(health);

    const result = {
      firingScore:       health.firingScore,
      hasRed:            health.hasRed,
      cylinders:         health.cylinders,
      recommendation,
      lastPublished:     health.recentProjects[0] || null,
      recentGoalMix:     summarizeGoalMix(health.recentProjects),
      computedAt:        health.computedAt,
      cached:            false,
    };

    _cache   = result;
    _cacheAt = now;

    res.json(result);
  } catch (err) {
    console.error('[conductor]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/conductor/cylinders (lightweight, no AI) ────────────────────────
router.get('/cylinders', (req, res) => {
  try {
    const health = computeAllCylinders();
    res.json({
      firingScore: health.firingScore,
      cylinders:   health.cylinders,
      hasRed:      health.hasRed,
      computedAt:  health.computedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/conductor/goal/:project_id ─────────────────────────────────────
router.post('/goal/:project_id', (req, res) => {
  try {
    const projectId = parseInt(req.params.project_id, 10);
    const { goal } = req.body;
    const valid = ['REACH', 'AUTHORITY', 'CONVERT', 'SERVE', 'RETAIN'];
    if (!valid.includes(goal)) return res.status(400).json({ error: `goal must be one of: ${valid.join(', ')}` });

    db.getRawDb().prepare(
      'UPDATE projects SET conductor_goal = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(goal, projectId);

    _cache = null; // invalidate cache on any goal change

    res.json({ ok: true, project_id: projectId, conductor_goal: goal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/conductor/goal/suggest ─────────────────────────────────────────
router.post('/goal/suggest', async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const project = db.getProject(parseInt(project_id, 10));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const suggestion = await suggestContentGoal(project);
    res.json({ ok: true, suggestion, project_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/conductor/affiliate-links/:project_id ───────────────────────────
// Returns all active affiliate links with ?vid=<project_id> pre-tagged
// Use these URLs in video descriptions for ConductΩr attribution
router.get('/affiliate-links/:project_id', (req, res) => {
  try {
    const projectId = parseInt(req.params.project_id, 10);
    const rawDb = db.getRawDb();
    const links = rawDb.prepare(
      `SELECT al.partner_key, al.link_key, al.title, al.destination_url, ap.name AS partner_name
       FROM affiliate_links al
       JOIN affiliate_partners ap ON al.partner_key = ap.partner_key
       WHERE al.active = 1
       ORDER BY ap.name, al.title`
    ).all();

    const base = req.protocol + '://' + req.get('host');
    const tagged = links.map(l => ({
      ...l,
      tracked_url: `${base}/r/${l.partner_key}/${l.link_key}?vid=${projectId}`,
    }));

    res.json({ project_id: projectId, links: tagged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/conductor/videos — paginated video source (youtube_videos table) ──
router.get('/videos', (req, res) => {
  try {
    const rawDb = db.getRawDb();
    const page   = Math.max(1, parseInt(req.query.page || 1));
    const limit  = Math.min(50, parseInt(req.query.limit || 20));
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'unclassified'; // unclassified | all | classified

    const whereClause = filter === 'unclassified'
      ? 'WHERE (conductor_goal IS NULL OR conductor_goal = \'SKIP\')'
      : filter === 'classified' ? 'WHERE conductor_goal IS NOT NULL AND conductor_goal != \'SKIP\''
      : '';

    const total = rawDb.prepare(`SELECT COUNT(*) as n FROM youtube_videos ${whereClause}`).get()?.n || 0;
    const totalAll = rawDb.prepare('SELECT COUNT(*) as n FROM youtube_videos').get()?.n || 0;
    const totalUnclassified = rawDb.prepare('SELECT COUNT(*) as n FROM youtube_videos WHERE conductor_goal IS NULL OR conductor_goal = \'SKIP\'').get()?.n || 0;

    const videos = rawDb.prepare(
      `SELECT video_id, title, published_at, conductor_goal, conductor_goal_ai,
              privacy_status, view_count, like_count, duration_seconds, project_id
       FROM youtube_videos ${whereClause} ORDER BY published_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);

    res.json({ videos, total, page, limit, pages: Math.ceil(total / limit), totalAll, totalUnclassified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/conductor/sync-youtube — full YouTube history sync (SSE stream) ──
// GET because EventSource only supports GET requests
router.get('/sync-youtube', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (msg) => { try { res.write(`data: ${JSON.stringify({ message: msg })}\n\n`); } catch(_) {} };
  syncYouTubeHistory(send)
    .then((result) => { res.write(`data: ${JSON.stringify({ done: true, result })}\n\n`); res.end(); })
    .catch((err)   => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });
});

// ── POST /api/conductor/goal/video/suggest — MUST be before /:video_id route ──
router.post('/goal/video/suggest', async (req, res) => {
  try {
    const rawDb = db.getRawDb();
    const video = rawDb.prepare('SELECT * FROM youtube_videos WHERE video_id = ?').get(req.body.video_id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    let extraContext = '';
    if (video.project_id) {
      try {
        const proj = db.getProject(video.project_id);
        if (proj?.id8r_data) {
          const id8r = JSON.parse(proj.id8r_data);
          if (id8r?.chosenConcept?.angle) extraContext = `\nChosen angle: ${id8r.chosenConcept.angle}`;
        }
      } catch (_) {}
    }
    const suggestion = await suggestContentGoal({ title: video.title, topic: video.description?.slice(0, 300) + extraContext });
    if (suggestion) rawDb.prepare('UPDATE youtube_videos SET conductor_goal_ai = ? WHERE video_id = ?').run(suggestion, req.body.video_id);
    res.json({ ok: true, suggestion, video_id: req.body.video_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/conductor/suggest-all — batch classify all unclassified videos (SSE) ──
router.get('/suggest-all', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch(_) {} };

  try {
    const rawDb = db.getRawDb();
    const force = req.query.force === '1';

    // force=1 clears all classifications first (use after re-sync with better data)
    if (force) {
      rawDb.prepare(`UPDATE youtube_videos SET conductor_goal = NULL, conductor_goal_ai = NULL`).run();
      send({ message: `Force mode: cleared all existing classifications, starting fresh…` });
    }

    const unclassified = rawDb.prepare(
      `SELECT video_id, title, description, project_id, view_count
       FROM youtube_videos WHERE conductor_goal IS NULL OR conductor_goal = 'SKIP'
       ORDER BY published_at DESC`
    ).all();

    send({ message: `Starting batch classification of ${unclassified.length} videos…`, total: unclassified.length });

    let classified = 0, skipped = 0, errors = 0;

    for (const video of unclassified) {
      if (res.writableEnded) break;

      try {
        let extraContext = '';
        if (video.project_id) {
          try {
            const proj = db.getProject(video.project_id);
            if (proj?.id8r_data) {
              const id8r = JSON.parse(proj.id8r_data);
              if (id8r?.chosenConcept?.angle) extraContext = ` Angle: ${id8r.chosenConcept.angle}`;
            }
          } catch (_) {}
        }

        // Call Claude directly here — bypass suggestContentGoal's silent catch
        let suggestion = null;
        try {
          const { callClaudeMessages } = require('../utils/claude');
          const system = `You classify YouTube videos for a homesteading creator (7 Kin Homestead — off-grid living, financial freedom, DIY, community building).
GOALS:
- REACH: Broad appeal, viral, top-of-funnel. Dramatic reveals, big numbers, survival/lifestyle. Brings NEW viewers.
- AUTHORITY: Deep expertise, credibility. System explanations, philosophy, long-form guides. Builds trust.
- CONVERT: Purchase intent. Product reviews, how-tos with gear/affiliate recommendations. Drives sales.
- SERVE: Community value. Updates for existing audience, member stories, "I built this for you" content.
- RETAIN: Loyalty content. Founding member previews, long-term journey updates for paid community.
Return ONLY one word: REACH, AUTHORITY, CONVERT, SERVE, or RETAIN`;

          const desc = (video.description || '').slice(0, 400);
          const userMsg = `Title: ${video.title}\n${desc ? 'Description: ' + desc : ''}`;
          const raw = await callClaudeMessages(system, [{ role: 'user', content: userMsg }], 20);
          const word = (raw || '').trim().toUpperCase().split(/[\s\n]/)[0];
          const valid = ['REACH', 'AUTHORITY', 'CONVERT', 'SERVE', 'RETAIN'];
          suggestion = valid.includes(word) ? word : null;
          if (!suggestion) send({ classified, skipped, errors, total: unclassified.length, debug: `"${video.title}" got: "${raw?.slice(0,50)}"` });
        } catch (claudeErr) {
          send({ classified, skipped, errors, total: unclassified.length, debug: `Claude error: ${claudeErr.message}` });
        }

        if (suggestion) {
          rawDb.prepare('UPDATE youtube_videos SET conductor_goal = ?, conductor_goal_ai = ? WHERE video_id = ?')
            .run(suggestion, suggestion, video.video_id);
          classified++;
          send({ classified, skipped, errors, total: unclassified.length, last: { video_id: video.video_id, title: video.title, goal: suggestion } });
        } else {
          rawDb.prepare('UPDATE youtube_videos SET conductor_goal = ? WHERE video_id = ?').run('SKIP', video.video_id);
          skipped++;
          send({ classified, skipped, errors, total: unclassified.length, last: { video_id: video.video_id, title: video.title, goal: 'SKIP' } });
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 150));

      } catch (err) {
        errors++;
        send({ classified, skipped, errors, total: unclassified.length, error_title: video.title });
      }
    }

    _cache = null;
    send({ done: true, classified, skipped, errors, total: unclassified.length });
    res.end();
  } catch (err) {
    send({ error: err.message });
    res.end();
  }
});

// ── POST /api/conductor/goal/video/:video_id — set goal (AFTER suggest route) ─
router.post('/goal/video/:video_id', (req, res) => {
  try {
    const { goal } = req.body;
    const valid = ['REACH', 'AUTHORITY', 'CONVERT', 'SERVE', 'RETAIN'];
    if (!valid.includes(goal)) return res.status(400).json({ error: `goal must be one of: ${valid.join(', ')}` });
    db.getRawDb().prepare('UPDATE youtube_videos SET conductor_goal = ? WHERE video_id = ?').run(goal, req.params.video_id);
    _cache = null;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/conductor/projects (falls back to youtube_videos or pipeline projects) ─
router.get('/projects', (req, res) => {
  try {
    const rawDb = db.getRawDb();
    // Use youtube_videos if synced, otherwise fall back to pipeline projects
    const ytCount = rawDb.prepare('SELECT COUNT(*) as n FROM youtube_videos').get()?.n || 0;
    if (ytCount > 0) {
      const videos = rawDb.prepare(
        `SELECT video_id as id, title, published_at, conductor_goal, 'youtube' as source
         FROM youtube_videos WHERE conductor_goal IS NULL ORDER BY published_at DESC LIMIT 30`
      ).all();
      return res.json({ projects: videos, source: 'youtube_videos', synced: ytCount });
    }
    // Pre-sync fallback: Kre8r pipeline projects only
    const projects = rawDb.prepare(
      `SELECT p.id, p.title, p.published_at, p.conductor_goal, p.source
       FROM projects p
       WHERE (p.status IS NULL OR p.status != 'archived')
         AND (p.id8r_data IS NOT NULL OR p.pipr_complete = 1)
         AND p.title IS NOT NULL AND p.title != '' AND p.title != '1'
       ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT 30`
    ).all();
    res.json({ projects, source: 'projects', synced: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Recommendation engine ─────────────────────────────────────────────────────
async function generateRecommendation(health) {
  try {
    const { brand, followerSummary, niche } = getCreatorContext();

    // Get VectΩr locked brief
    let vectrBrief = null;
    try {
      const active = db.getActiveBrief?.();
      if (active?.brief_json) vectrBrief = active.brief_json;
    } catch (_) {}

    // Get most recent Post-Mortem learnings
    let postMortemTip = null;
    try {
      const pm = db.getActivePostMortemBrief?.();
      if (pm?.adjustments) postMortemTip = pm.adjustments;
    } catch (_) {}

    // Build deterministic flags for the prompt
    const flags = [];
    for (const c of health.cylinders) {
      if (c.color === 'red')   flags.push(`⚠️ RED: ${c.cylinder} — ${c.status}`);
      if (c.color === 'amber') flags.push(`🟡 AMBER: ${c.cylinder} — ${c.status}`);
    }

    // Check fatigue on CONVERT
    const convertCyl = health.cylinders.find(c => c.cylinder === 'CONVERT');
    if (convertCyl?.details?.fatigue_risk) {
      flags.push(`⚠️ FATIGUE RISK: Too many CONVERT videos in a row — audience needs a "give" next`);
    }

    const systemPrompt = `You are the ConductΩr recommendation engine for ${brand}, a ${niche} creator with multiple income streams.

Your job: recommend exactly ONE content goal for the creator's next video. Write the reason like a smart business advisor who understands the creator economy — not generic, not cheerleading. Specific, direct, connected to real income.

INCOME STREAMS AND LAG TIMES:
- REACH: Grows subscribers → ad revenue + brand deal eligibility. Takes 60-90 days to affect income.
- AUTHORITY: Builds niche credibility → brand deals + book/course sales. Takes 60-90 days.
- CONVERT: Product reviews, how-tos with affiliate links → commissions. Fastest: income moves in 1-15 days.
- SERVE: Warms Greenhouse members → Garden tier ($19/mo) conversions. Takes 14-45 days.
- RETAIN: Keeps Garden/F50 engaged → renewals + word-of-mouth. Takes 30-60 days.

IMPORTANT: Even when cylinders are all healthy, your reason should explain the FORWARD-LOOKING income logic — what income stream this video will feed and when the creator will feel it. Don't just say "all cylinders in range." Tell them WHY this goal is the smart next move for their specific business situation.

CURRENT CYLINDER HEALTH:
${health.cylinders.map(c => `${c.color === 'red' ? '🔴' : c.color === 'amber' ? '🟡' : '🟢'} ${c.cylinder}: ${c.status}`).join('\n')}

FIRING SCORE: ${health.firingScore}/100

DETERMINISTIC FLAGS (these are counted facts, not guesses):
${flags.length ? flags.join('\n') : '✅ No critical flags — all cylinders in acceptable range'}

LAST 10 VIDEOS (goal mix):
${health.recentProjects.slice(0, 10).map((p, i) => `${i+1}. ${p.conductor_goal || '(unclassified)'} — "${p.title}"`).join('\n')}

${vectrBrief ? `LOCKED STRATEGIC DIRECTION (VectΩr): ${JSON.stringify(vectrBrief)}` : ''}
${postMortemTip ? `LAST POST-MORTEM LEARNING: ${postMortemTip}` : ''}

OUTPUT FORMAT — respond with ONLY valid JSON, no preamble:
{
  "goal": "REACH|AUTHORITY|CONVERT|SERVE|RETAIN",
  "angle": "one content angle from: financial, system, rockrich, howto, mistakes, lifestyle, viral",
  "headline": "Make a [GOAL] video",
  "reason": "2-3 sentences explaining exactly why this is the priority RIGHT NOW, referencing the specific flag or trend",
  "post_mortem_tip": "one sentence from Post-Mortem learnings if relevant, otherwise null",
  "vectr_alignment": "one sentence on how this fits or doesn't fit the locked direction, or null",
  "urgency": "high|medium|low",
  "alt_goal": "second best option"
}`;

    const result = await callClaude(
      systemPrompt,
      [{ role: 'user', content: 'What should I make next to keep all cylinders firing?' }],
      400
    );

    const raw = (result?.content?.[0]?.text || '').trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    // Fallback: deterministic recommendation without AI
    const priorityCyl = health.priorityCylinder;
    const goalAngles = {
      REACH: 'lifestyle', AUTHORITY: 'system', CONVERT: 'howto',
      SERVE: 'rockrich', RETAIN: 'rockrich'
    };
    return {
      goal:       priorityCyl?.cylinder || 'SERVE',
      angle:      goalAngles[priorityCyl?.cylinder || 'SERVE'],
      headline:   `Make a ${priorityCyl?.cylinder || 'SERVE'} video`,
      reason:     priorityCyl?.status || 'All cylinders are in range — continue your current mix.',
      urgency:    priorityCyl?.color === 'red' ? 'high' : 'medium',
      alt_goal:   'REACH',
      error:      err.message,
    };
  }
}

function summarizeGoalMix(projects) {
  const counts = { REACH: 0, AUTHORITY: 0, CONVERT: 0, SERVE: 0, RETAIN: 0, unclassified: 0 };
  const last10 = projects.slice(0, 10);
  for (const p of last10) {
    const g = p.conductor_goal;
    if (g && counts[g] !== undefined) counts[g]++;
    else counts.unclassified++;
  }
  return { counts, total: last10.length };
}

module.exports = router;
