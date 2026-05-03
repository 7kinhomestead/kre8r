/**
 * NorthΩr Routes — src/routes/northr.js
 *
 * GET  /api/northr/alerts              — get all active (undismissed) alerts
 * POST /api/northr/alerts/:id/read     — mark alert read
 * POST /api/northr/alerts/:id/dismiss  — dismiss alert
 * POST /api/northr/check               — manually trigger threshold check
 * GET  /api/northr/strategy/latest     — get latest strategy report
 * POST /api/northr/strategy/generate   — generate monthly strategy (SSE)
 * GET  /api/northr/dashboard           — aggregate: alerts + pipeline + stats + goals
 * POST /api/northr/goals               — upsert monthly goals
 * GET  /api/northr/goals/current       — get current month goals
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { checkAllThresholds, generateMonthlyStrategy, currentMonth, currentYear } = require('../utils/strategy-engine');

const ML_BASE = 'https://connect.mailerlite.com/api';

// ML v2 returns open_rate/click_rate as {float, string} objects OR plain numbers
// Unwrap to a clean percentage float (e.g. 22.45, not 0.2245)
function unwrapRate(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.float != null ? Math.round(v.float * 10000) / 100 : null;
  return typeof v === 'number' ? Math.round(v * 10000) / 100 : null;
}

async function fetchMlAutomationStats() {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) return [];
  try {
    const { default: fetch } = await import('node-fetch');
    const res  = await fetch(`${ML_BASE}/automations?limit=25`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) return [];
    return (data.data || []).map(a => ({
      id:          a.id,
      name:        a.name,
      enabled:     a.enabled,
      sent:        a.stats?.sent ?? 0,
      open_rate:   unwrapRate(a.stats?.open_rate),
      click_rate:  unwrapRate(a.stats?.click_rate),
      click_to_open: unwrapRate(a.stats?.click_to_open_rate),
      unsubscribe_rate: unwrapRate(a.stats?.unsubscribe_rate),
      completed:   a.stats?.completed_subscribers_count ?? 0,
      in_queue:    a.stats?.subscribers_in_queue_count ?? 0,
    }));
  } catch (e) {
    console.error('[northr] fetchMlAutomationStats error:', e.message);
    return [];
  }
}

async function fetchMlCampaignStats(limit = 5) {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) return [];
  try {
    const { default: fetch } = await import('node-fetch');
    // Fetch more than limit so we can filter to sent-only and still have enough
    const url = `${ML_BASE}/campaigns?limit=25`;
    const res  = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) {
      console.error('[northr] ML campaign fetch failed:', res.status, text.slice(0, 200));
      return [];
    }
    const campaigns = data.data || [];
    // Only sent campaigns have real stats — filter drafts/scheduled out
    const sent = campaigns.filter(c => c.status === 'sent');
    sent.sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at));
    return sent.slice(0, limit).map(c => ({
      id:         c.id,
      subject:    c.emails?.[0]?.subject || c.name || '—',
      status:     c.status,
      sent_at:    c.sent_at || c.created_at,
      open_rate:        unwrapRate(c.stats?.open_rate),
      click_rate:       unwrapRate(c.stats?.click_rate),
      unsubscribe_rate: unwrapRate(c.stats?.unsubscribe_rate),
      click_to_open:    unwrapRate(c.stats?.click_to_open_rate),
      total_sent:       c.total_recipients ?? c.stats?.sent ?? null,
    }));
  } catch (e) {
    console.error('[northr] fetchMlCampaignStats error:', e.message);
    return [];
  }
}

// ─── GET /alerts ───────────────────────────────────────────────────────────────
router.get('/alerts', (req, res) => {
  try {
    const alerts = db.getAllAlerts();
    const unread = alerts.filter(a => !a.read).length;
    res.json({ alerts, unread_count: unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /alerts/:id/read ─────────────────────────────────────────────────────
router.post('/alerts/:id/read', (req, res) => {
  try {
    db.markAlertRead(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /alerts/:id/dismiss ─────────────────────────────────────────────────
router.post('/alerts/:id/dismiss', (req, res) => {
  try {
    db.dismissAlert(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /check — manually trigger threshold check ───────────────────────────
router.post('/check', async (req, res) => {
  try {
    const newAlerts = await checkAllThresholds();
    res.json({ ok: true, new_alerts: newAlerts.length, alerts: newAlerts });
  } catch (err) {
    console.error('[northr/check]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /strategy/latest ─────────────────────────────────────────────────────
router.get('/strategy/latest', (req, res) => {
  try {
    const { month, year } = req.query;
    const report = db.getLatestReport(
      month || currentMonth(),
      year  ? parseInt(year, 10) : currentYear()
    );
    if (!report) return res.json({ report: null });
    let parsed = null;
    try { parsed = JSON.parse(report.content); } catch { parsed = report.content; }
    res.json({ report: { ...report, content: parsed } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /strategy/generate — SSE stream ────────────────────────────────────
router.post('/strategy/generate', async (req, res) => {
  const { month = currentMonth(), year = currentYear() } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    send('status', { message: 'Gathering your data…' });
    await new Promise(r => setTimeout(r, 300));

    send('status', { message: 'Building strategy with Claude…' });
    const strategy = await generateMonthlyStrategy(month, parseInt(year, 10));

    send('complete', { strategy, month, year });
    res.end();
  } catch (err) {
    console.error('[northr/strategy/generate]', err);
    send('error', { message: err.message });
    res.end();
  }
});

// ─── GET /dashboard ───────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const alerts        = db.getAllAlerts();
    const unread_count  = alerts.filter(a => !a.read).length;
    const pipeline      = db.getPipelineHealth();
    const stats         = db.getPublishingStats(30);
    const goals         = db.getGoal(currentMonth(), currentYear());
    const latest_report = db.getLatestReport(currentMonth(), currentYear());
    const [email_stats, automation_stats] = await Promise.all([
      fetchMlCampaignStats(5),
      fetchMlAutomationStats(),
    ]);

    // Override days_since_last_email from live ML campaign data when available
    // — the DB only knows about emails sent through MailΩr, not direct ML sends
    const latestMlSent = email_stats[0]?.sent_at ? new Date(email_stats[0].sent_at) : null;
    if (latestMlSent) {
      const mlDays = Math.floor((Date.now() - latestMlSent.getTime()) / 86400000);
      if (mlDays < (stats.days_since_last_email ?? 999)) {
        stats.days_since_last_email = mlDays;
      }
    }

    let report_content = null;
    if (latest_report?.content) {
      try { report_content = JSON.parse(latest_report.content); } catch { report_content = null; }
    }

    // Build publish calendar (last 91 days)
    const rawDb = db.getRawDb ? db.getRawDb() : null;
    const publishedDates = rawDb
      ? rawDb.prepare(`
          SELECT DATE(published_at) as date, title
          FROM projects
          WHERE status = 'published'
            AND published_at IS NOT NULL
            AND published_at >= DATE('now', '-91 days')
          ORDER BY published_at DESC
        `).all()
      : [];

    res.json({
      alerts,
      unread_count,
      pipeline,
      stats,
      goals,
      email_stats,
      automation_stats,
      published_dates: publishedDates,
      report: report_content ? { ...latest_report, content: report_content } : null,
    });
  } catch (err) {
    console.error('[northr/dashboard]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /goals — upsert monthly goals ──────────────────────────────────────
router.post('/goals', (req, res) => {
  try {
    const { month = currentMonth(), year = currentYear(), ...rest } = req.body;
    const goal = db.createGoal({ month, year: parseInt(year, 10), ...rest });
    res.json({ ok: true, goal });
  } catch (err) {
    console.error('[northr/goals]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /goals/current ───────────────────────────────────────────────────────
router.get('/goals/current', (req, res) => {
  try {
    const goal = db.getGoal(currentMonth(), currentYear());
    res.json({ goal: goal || null, month: currentMonth(), year: currentYear() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /recent-projects — native projects for "mark published" UI ───────────
router.get('/recent-projects', (req, res) => {
  try {
    const projects = db.getKre8rProjects().filter(p => p.status !== 'archived').slice(0, 30);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /projects/:id/mark-published ────────────────────────────────────────
router.post('/projects/:id/mark-published', (req, res) => {
  try {
    const id          = parseInt(req.params.id, 10);
    const { published_at } = req.body;
    db.markProjectPublished(id, published_at || null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[northr/mark-published]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /growth-plan — back-engineer a 3-month trajectory plan (SSE) ────────
// Body: { targets: { yt_subscribers, avg_views_per_video, videos_per_month, monthly_revenue } }
// Reads current state from DB, asks Claude to bridge the gap with month-by-month milestones.

router.post('/growth-plan', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const { targets = {} } = req.body;

    send('status', { message: 'Reading your current state…' });

    const { callClaude }    = require('../utils/claude');
    const { getCreatorContext } = require('../utils/creator-context');

    const { creatorName, brand, niche, followerSummary, contentAnglesText, profile } = getCreatorContext();
    const health     = db.getGlobalChannelHealth();
    const stats      = db.getPublishingStats(90);
    const pipeline   = db.getPipelineHealth();
    const evals      = db.getRecentEvaluations(3);
    const structPerf = db.getStructurePerformance();
    const activeBrief = db.getActiveBrief ? db.getActiveBrief() : null;

    // Active VectΩr brief — the locked strategic direction
    const vectorBlock = activeBrief?.brief_json
      ? (() => {
          const b = activeBrief.brief_json;
          const lines = [
            b.vector    ? `Vector: ${b.vector}`       : '',
            b.focus     ? `Focus: ${b.focus}`          : '',
            b.constraints ? `Constraints: ${Array.isArray(b.constraints) ? b.constraints.join(', ') : b.constraints}` : '',
            b.locked_date ? `Locked: ${b.locked_date}` : '',
          ].filter(Boolean);
          return lines.length ? lines.join('\n') : null;
        })()
      : null;

    // Full eval context — one_line + calibration + weight adjustments
    const evalBlock = evals.length
      ? evals.map(e => {
          try {
            const ev = JSON.parse(e.evaluation);
            const weights = (ev.recommendation_accuracy || [])
              .filter(r => r.weight_adjustment && r.weight_adjustment !== 'NEUTRAL')
              .map(r => `    • ${r.recommendation}: weight ${r.weight_adjustment} — ${r.reason}`)
              .join('\n');
            return [
              `${e.month}/${e.year} — Score ${ev.overall_accuracy_score}/10 — ${ev.one_line}`,
              ev.calibration_notes ? `  Calibration: ${ev.calibration_notes}` : '',
              weights ? `  Weight adjustments:\n${weights}` : '',
            ].filter(Boolean).join('\n');
          } catch { return null; }
        }).filter(Boolean).join('\n\n')
      : null;

    // Full structure breakdown
    const structBlock = structPerf.length
      ? structPerf.map(s =>
          `- ${s.story_structure}: avg ${Number(s.avg_views).toLocaleString()} views (${s.video_count} videos, best: ${Number(s.max_views || 0).toLocaleString()})`
        ).join('\n')
      : null;

    // Publishing cadence from profile
    const cadence = profile?.publishing?.cadence || 'weekly';

    // YouTube-specific health
    const ytHealth = health?.youtube || health;

    send('status', { message: 'Back-engineering your 3-month trajectory…' });

    const prompt = `You are NorthΩr, the strategic growth engine for ${creatorName} at ${brand} — a ${niche} creator.

CRITICAL: All string values in the JSON output must be human-readable prose only. Never embed raw data objects, JSON fragments, or variable names into text fields.

## LOCKED VectΩr STRATEGIC BRIEF (this is the approved strategic direction — the trajectory plan must align with it)

${vectorBlock || '(No VectΩr brief locked yet — infer from data below)'}

## CURRENT STATE (live data)

- Channel: ${followerSummary}
- YouTube avg views per video (all-time): ${Math.round(ytHealth.avg_views || 0).toLocaleString()}
- YouTube total views: ${Number(ytHealth.total_views || 0).toLocaleString()}
- Best video: ${ytHealth.best_video ? `"${ytHealth.best_video.title}" — ${Number(ytHealth.best_video.views).toLocaleString()} views` : 'unknown'}
- Publishing cadence goal: ${cadence}
- Days since last publish: ${stats.days_since_last_publish === 999 ? 'unknown' : stats.days_since_last_publish}
- Videos published last 90 days: ${stats.videos_last_month + stats.videos_this_month}
- Pipeline: ${pipeline.in_pre_production} in pre-production, ${pipeline.in_production} in production, ${pipeline.in_post} in post

## STORY STRUCTURE PERFORMANCE (from actual YouTube data — this is the evidence base)

${structBlock || '(No structure data yet)'}

## MirrΩr SELF-EVALUATION — WHAT THE STRATEGY GOT RIGHT AND WRONG

${evalBlock || '(No evaluations yet — this is the first trajectory plan)'}

## 3-MONTH TARGETS

${Object.keys(targets).length > 0
  ? Object.entries(targets).map(([k, v]) => `- ${k}: ${v}`).join('\n')
  : '(No specific targets set — infer ambitious but realistic targets based on current trajectory and industry benchmarks for a channel at this stage)'
}

## YOUR TASK

The trajectory plan must:
1. ALIGN WITH THE LOCKED VectΩr BRIEF above — don't contradict the approved direction
2. BUILD ON MirrΩr's calibration — weight adjustments from evaluations must shape each month's recommendations
3. Reference actual numbers from CURRENT STATE — no generic advice
4. Be realistic for a solo creator (Jason) with a camera partner (Cari), outdoor shoots only, no studio
5. Close the gap through content STRATEGY, not just "post more"
6. Use the content angles: ${contentAnglesText.split('\n').slice(0,3).join(', ')}

Return ONLY valid JSON. All text fields must be prose, never raw data:

{
  "targets_inferred": {
    "yt_subscribers_in_3_months": 0,
    "avg_views_per_video_in_3_months": 0,
    "videos_per_month": 0,
    "monthly_revenue_goal": "(if specified, else null)"
  },
  "gap_analysis": "2-3 sentences: what specifically needs to change to hit these targets. Be direct about whether targets are realistic.",
  "non_negotiables": ["The 2-3 things that absolutely must happen every month regardless"],
  "month_1": {
    "theme": "One word or phrase that captures the month's strategic focus",
    "target_videos": 0,
    "target_avg_views": 0,
    "key_actions": ["3-4 specific actions this month"],
    "milestone": "What hitting the month-1 numbers unlocks for month 2",
    "early_warning": "What to watch for that signals this month is off track"
  },
  "month_2": {
    "theme": "",
    "target_videos": 0,
    "target_avg_views": 0,
    "key_actions": [],
    "milestone": "",
    "early_warning": ""
  },
  "month_3": {
    "theme": "",
    "target_videos": 0,
    "target_avg_views": 0,
    "key_actions": [],
    "milestone": "",
    "early_warning": ""
  },
  "highest_leverage_move": "The single thing that, if done right in month 1, makes the rest of the plan much easier",
  "biggest_risk": "The most likely reason this plan fails and how to prevent it",
  "structure_recommendation": "Based on story structure performance data, which PipΩr structure should dominate this quarter and why"
}`;

    const plan = await callClaude(prompt, 4000);

    if (!plan || plan.parse_error) {
      send('error', { message: 'Could not parse growth plan. Try again.' });
      res.end();
      return;
    }

    // Cache it
    db.setKv('growth_plan', JSON.stringify({ plan, generated_at: new Date().toISOString(), targets }));

    send('complete', { plan });
    res.end();

  } catch (err) {
    console.error('[northr/growth-plan]', err);
    send('error', { message: err.message });
    res.end();
  }
});

// ─── GET /growth-plan — return cached plan ────────────────────────────────────
router.get('/growth-plan', (req, res) => {
  try {
    const cached = db.getKv('growth_plan');
    if (!cached) return res.json({ plan: null });
    const { plan, generated_at, targets } = JSON.parse(cached);
    res.json({ plan, generated_at, targets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
