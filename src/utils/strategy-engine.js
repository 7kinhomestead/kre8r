/**
 * NorthΩr Strategy Engine — src/utils/strategy-engine.js
 *
 * The brain of NorthΩr. Pure engine — no creator-specific data hardcoded.
 * All creator data loaded from creator-profile.json via creator-context.js.
 * All DB calls go through db.js helpers.
 *
 * SINE RESISTENTIA
 */

const path = require('path');
const fs   = require('fs');
const db   = require('../db');
const { getCreatorContext, loadProfile } = require('./creator-context');
const { callClaude } = require('./claude');

const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH
  || path.join(__dirname, '../../creator-profile.json');

// ─── Default thresholds ────────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = {
  no_publish_warning:    7,
  no_publish_alert:      14,
  no_email_warning:      10,
  pipeline_empty_warning: 0,
  stalled_project_days:  7,
  episode_overdue_days:  3,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth() {
  return String(new Date().getMonth() + 1).padStart(2, '0');
}

function currentYear() {
  return new Date().getFullYear();
}

function getThresholdsFromSoul() {
  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    return { ...DEFAULT_THRESHOLDS, ...(profile.northr_thresholds || {}) };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

// ─── checkAllThresholds ────────────────────────────────────────────────────────
// Evaluates all creator health metrics, writes new alerts to DB (deduped by type),
// and returns the alerts that were triggered this run.

async function checkAllThresholds() {
  const thresholds = getThresholdsFromSoul();
  const stats      = db.getPublishingStats(30);
  const pipeline   = db.getPipelineHealth();
  const triggered  = [];

  // ── 1. Publishing gap ──────────────────────────────────────────────────────
  if (stats.days_since_last_publish >= thresholds.no_publish_alert) {
    triggered.push({
      type:         'no_publish',
      severity:     'critical',
      title:        `${stats.days_since_last_publish} days since your last video`,
      message:      `Algorithm momentum drops after 7 days. Your audience is waiting. What's the blocker?`,
      action_url:   '/id8r.html',
      action_label: 'Start something now →',
    });
  } else if (stats.days_since_last_publish >= thresholds.no_publish_warning) {
    triggered.push({
      type:         'no_publish_warning',
      severity:     'warning',
      title:        `${stats.days_since_last_publish} days since your last video`,
      message:      `You're in the warning zone. Don't let this stretch to ${thresholds.no_publish_alert} days.`,
      action_url:   '/id8r.html',
      action_label: 'Start something now →',
    });
  }

  // ── 2. Pipeline empty ──────────────────────────────────────────────────────
  if (pipeline.in_pre_production <= thresholds.pipeline_empty_warning) {
    triggered.push({
      type:         'pipeline_empty',
      severity:     'warning',
      title:        'Nothing in pre-production',
      message:      'You have 0 projects in Id8Ωr or PipΩr. Nothing in the pipeline means nothing to publish in 2 weeks.',
      action_url:   '/id8r.html',
      action_label: 'Start a new idea →',
    });
  }

  // ── 3. Stalled projects ────────────────────────────────────────────────────
  for (const project of pipeline.stalled) {
    triggered.push({
      type:         `stalled_${project.id}`,
      severity:     'warning',
      title:        `"${project.title}" stalled for ${project.days_stalled} days`,
      message:      `Sitting in ${project.stage_name} since ${project.stalled_since}. What's the blocker?`,
      action_url:   `/${project.stage_url}?project_id=${project.id}`,
      action_label: `Open in ${project.stage_name} →`,
    });
  }

  // ── 4. Email list cold ─────────────────────────────────────────────────────
  if (stats.days_since_last_email >= thresholds.no_email_warning) {
    triggered.push({
      type:         'email_cold',
      severity:     'warning',
      title:        `Your list hasn't heard from you in ${stats.days_since_last_email} days`,
      message:      'Open rates drop after 2 weeks of silence. Send something today — even a short update.',
      action_url:   '/mailor.html',
      action_label: 'Write an email →',
    });
  }

  // ── 5. Monthly goals off track ─────────────────────────────────────────────
  const goals = db.getGoal(currentMonth(), currentYear());
  if (goals && goals.target_videos > 0) {
    const now            = new Date();
    const daysIntoMonth  = now.getDate();
    const daysInMonth    = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expectedPct    = daysIntoMonth / daysInMonth;
    const actualPct      = stats.videos_this_month / goals.target_videos;
    if (actualPct < expectedPct - 0.2) {
      const daysLeft = daysInMonth - daysIntoMonth;
      triggered.push({
        type:         'goals_off_track',
        severity:     'warning',
        title:        'Behind on monthly video goal',
        message:      `You planned ${goals.target_videos} videos this month. Made ${stats.videos_this_month} with ${daysLeft} days left.`,
        action_url:   '/id8r.html',
        action_label: 'Start catching up →',
      });
    }
  }

  // ── Write new alerts (dedup by type — skip if undismissed alert of same type exists) ──
  const newAlerts = [];
  for (const alert of triggered) {
    const existing = db.getAlertByType(alert.type);
    if (!existing || existing.dismissed) {
      const saved = db.createAlert(alert);
      newAlerts.push(saved);
    }
  }

  return newAlerts;
}

// ─── generateMonthlyStrategy ───────────────────────────────────────────────────

async function generateMonthlyStrategy(month, year) {
  const { creatorName, niche, followerSummary, contentAnglesText, profile } = getCreatorContext();
  const pipelineData    = db.getPipelineHealth();
  const publishingStats = db.getPublishingStats(90);
  const shows           = db.getAllShows ? db.getAllShows() : [];
  const goals           = db.getGoal(month, year);

  // Load ClipsΩr content patterns — what's actually resonated with this audience
  let clipsrPatterns = null;
  try {
    const stored = db.getKv('clipsr_content_patterns');
    if (stored) clipsrPatterns = JSON.parse(stored);
  } catch (_) {}

  // Load MirrΩr self-evaluations — calibrate strategy based on what was actually accurate
  let pastEvaluations = [];
  try {
    pastEvaluations = db.getRecentEvaluations(3);
  } catch (_) {}

  const prompt = buildStrategyPrompt({
    creatorName, niche, followerSummary, contentAnglesText, profile,
    pipelineData, publishingStats, shows, goals, month, year, clipsrPatterns,
    pastEvaluations,
  });

  // callClaude in src/utils/claude.js already strips fences and parses JSON
  let strategy;
  try {
    strategy = await callClaude(prompt, 2500);
  } catch (e) {
    strategy = { parse_error: true, error_message: e.message };
  }

  db.createStrategyReport({
    month,
    year,
    content:       JSON.stringify(strategy),
    data_snapshot: JSON.stringify({ pipelineData, publishingStats }),
  });

  return strategy;
}

function buildStrategyPrompt({ creatorName, niche, followerSummary, contentAnglesText, profile, pipelineData, publishingStats, shows, goals, month, year, clipsrPatterns, pastEvaluations }) {
  const publishing = profile?.publishing || {};
  const cadence    = publishing.cadence || 'weekly';

  const showsBlock = shows.length
    ? shows.map(s => `- "${s.name}": Season ${s.season || 1}, ${s.completed_episodes || 0}/${s.target_episodes || 10} episodes`).join('\n')
    : '(No active shows)';

  const goalsBlock = goals
    ? `Target: ${goals.target_videos} videos, ${goals.target_emails} emails, ${goals.target_episodes} episodes`
    : '(No goals set for this month)';

  const monthName = new Date(year, parseInt(month) - 1, 1).toLocaleString('default', { month: 'long' });

  return `You are a creative strategy advisor for ${creatorName}, a ${niche} creator (${followerSummary}).

Generate a data-driven monthly content strategy for ${monthName} ${year}. Be specific, direct, and grounded in the actual numbers. No generic advice.

CREATOR CONTEXT:
Publishing cadence goal: ${cadence}
Content angles available:
${contentAnglesText || '(not configured)'}

PIPELINE STATUS:
- In pre-production: ${pipelineData.in_pre_production} projects
- In production: ${pipelineData.in_production} projects
- In post: ${pipelineData.in_post} projects
- In distribution: ${pipelineData.in_distribution} projects
- Stalled projects: ${pipelineData.stalled.length}

PUBLISHING HISTORY:
- Days since last publish: ${publishingStats.days_since_last_publish === 999 ? 'Unknown' : publishingStats.days_since_last_publish}
- Videos published this month: ${publishingStats.videos_this_month}
- Videos published last month: ${publishingStats.videos_last_month}
- Days since last email: ${publishingStats.days_since_last_email === 999 ? 'Unknown' : publishingStats.days_since_last_email}

ACTIVE SHOWS:
${showsBlock}

THIS MONTH'S GOALS:
${goalsBlock}
${(() => {
  if (!clipsrPatterns?.entries?.length) return '';
  const recent = clipsrPatterns.entries.slice(0, 4);
  return `
WHAT HAS ACTUALLY WORKED (from approved viral clips — real audience resonance data):
${recent.map((e, i) => `${i + 1}. "${e.hook}" — ${e.why_it_works.slice(0, 200)}...`).join('\n')}
Use this to ground strategy recommendations in proven patterns, not theory. Recommend content that builds on these structures.`;
})()}
${(() => {
  if (!pastEvaluations?.length) return '';
  const lines = pastEvaluations.map(r => {
    try {
      const ev = JSON.parse(r.evaluation);
      const adjLines = (ev.recommendation_accuracy || [])
        .filter(a => a.weight_adjustment && a.weight_adjustment !== 'NEUTRAL')
        .map(a => `    • ${a.recommendation}: weight ${a.weight_adjustment} — ${a.reason}`)
        .join('\n');
      return [
        `${r.month}/${r.year} — Score ${ev.overall_accuracy_score}/10 — ${ev.one_line}`,
        ev.calibration_notes ? `  Calibration: ${ev.calibration_notes}` : '',
        adjLines ? `  Weight adjustments:\n${adjLines}` : ''
      ].filter(Boolean).join('\n');
    } catch { return `${r.month}/${r.year}: (evaluation data unavailable)`; }
  }).join('\n\n');
  return `
MIRR Ωr SELF-EVALUATION — PAST STRATEGY ACCURACY (use to calibrate this month's recommendations):
${lines}
IMPORTANT: Weight your recommendations based on this evidence. What worked → double down. What missed → reduce or cut. This is the system learning from its own track record.`;
})()}
Generate a complete strategy. Return ONLY valid JSON — no markdown, no extra text:
{
  "top_priority": "The single most important content move to make first this month — be specific about topic/format",
  "why_this_mix": "2-3 sentences explaining the strategic logic based on the actual data above",
  "recommended_mix": [
    { "type": "content type (e.g. Rock Rich Episode, financial breakdown, how-to)", "count": 2, "reason": "data-driven reason specific to their situation" }
  ],
  "weekly_schedule": [
    { "week": 1, "focus": "what to make and why this week" },
    { "week": 2, "focus": "what to make and why this week" },
    { "week": 3, "focus": "what to make and why this week" },
    { "week": 4, "focus": "what to make and why this week" }
  ],
  "avoid_this_month": "What NOT to make and exactly why — be specific",
  "episode_plan": "Show episode recommendations if shows are active, or null",
  "goal_recommendation": { "videos": 4, "emails": 2, "social_posts": 16, "episodes": 1 },
  "momentum_risk": "What's the biggest risk to publishing consistency this month and how to prevent it"
}`;
}

module.exports = { checkAllThresholds, generateMonthlyStrategy, currentMonth, currentYear };
