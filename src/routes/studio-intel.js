'use strict';

/**
 * StudioΩr — YouTube Studio Intelligence Bridge
 *
 * Claude generates targeted Ask Studio queries that surface deep audience
 * signals YouTube's internal data knows but the API doesn't expose.
 * Jason runs them in YouTube Studio, pastes results back, adds his own
 * audience instinct, and Claude synthesizes a structured intelligence brief
 * that injects into Id8Ωr research and VectΩr strategy sessions.
 *
 * POST /api/studio-intel/queries    — Claude generates 8-10 Ask Studio queries
 * POST /api/studio-intel/synthesize — Claude synthesizes responses + instinct → brief
 * GET  /api/studio-intel/brief      — return saved brief (for injection downstream)
 * DELETE /api/studio-intel/brief    — clear brief
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { callClaudeMessages, callClaudeStream } = require('../utils/claude');
const { startSseResponse } = require('../utils/sse');
const log = require('../utils/logger');

// ─── POST /api/studio-intel/queries ──────────────────────────────────────────
// Claude generates 8-10 targeted Ask Studio queries based on current context.
// Optional body: { topic_hint: "land rights video" }

router.post('/queries', async (req, res) => {
  try {
    const { topic_hint = '' } = req.body || {};

    // Pull context: recent MirrΩr data + active VectΩr brief
    let youtubeContext = '';
    let briefContext   = '';

    try {
      const health = db.getGlobalChannelHealth();
      const recent = db.getRecentProjectsWithAnalytics(10);
      if (health || recent?.length) {
        youtubeContext = `
CHANNEL PERFORMANCE SNAPSHOT:
- Avg views per video: ${health?.avg_views || 'unknown'}
- Total videos: ${health?.video_count || 'unknown'}
- Best video: ${health?.best_video?.title || 'unknown'} (${health?.best_video?.total_views || 0} views)
Recent videos (last 10):
${(recent || []).slice(0, 10).map(v =>
  `  - "${v.title}" — ${v.total_views || 0} views, ${v.total_comments || 0} comments, CTR: ${v.click_through_rate ? (v.click_through_rate * 100).toFixed(1) + '%' : 'unknown'}`
).join('\n')}
`.trim();
      }
    } catch (e) {
      log.warn({ err: e }, '[studio-intel] could not load MirrΩr context');
    }

    try {
      const brief = db.getKv('vectr_active_brief');
      if (brief) {
        const parsed = JSON.parse(brief);
        briefContext = `
ACTIVE STRATEGIC BRIEF:
Vector: ${parsed.vector || ''}
Direction: ${parsed.direction || ''}
Key priorities: ${(parsed.priorities || []).join(', ')}
`.trim();
      }
    } catch (e) { /* no brief — skip */ }

    const topicLine = topic_hint
      ? `Jason is currently planning a video about: "${topic_hint}"`
      : 'Jason is looking for general audience intelligence to inform upcoming content.';

    const system = `You are a YouTube audience intelligence specialist working with Jason Rutland of 7 Kin Homestead — an off-grid homesteading creator with 54K YouTube subscribers, 725K TikTok, and a paid community called ROCK RICH.

Jason's content angles: financial (real numbers, cost breakdowns), system (the system is rigged, opt out and win), rockrich (doing a lot with a little), howto, mistakes, lifestyle, viral.

His audience: people who feel squeezed by modern life and are drawn to the idea of opting out. They fear financial precarity, government overreach, missing the window to make a change. They're not preppers — they're practical people who want a real alternative.

YouTube Studio's "Ask Studio" AI feature has access to internal YouTube data that is NOT available through the public API — granular retention curves, comment sentiment, audience overlap, search terms that brought people in, session depth (what they watched after your video), demographic breakdowns, and more.

Your job: generate the most strategically valuable Ask Studio queries Jason should run — questions that surface signals he would never think to ask, that reveal what his audience truly fears, wants, and needs next.`;

    const prompt = `${topicLine}

${youtubeContext ? youtubeContext + '\n\n' : ''}${briefContext ? briefContext + '\n\n' : ''}Generate exactly 9 Ask Studio queries for Jason to run in YouTube Studio. These should be:

1. Phrased as natural questions (as if talking to a smart analyst)
2. Targeting data YouTube has internally that Jason can't see in standard analytics
3. Covering: audience fears/emotions, content gaps, retention patterns, what brings NEW viewers, what makes existing fans stay, search behavior, session depth
4. Mix of specific (about particular videos) and broad (channel-wide patterns)
5. At least 2 that connect to the current topic hint if provided

Return a JSON array of exactly 9 objects:
[
  {
    "id": 1,
    "category": "Audience Fears" | "Content Gaps" | "Retention Patterns" | "New Viewer Signals" | "Search Behavior" | "Session Depth" | "Community Signals" | "Format Intelligence",
    "query": "The exact question to paste into Ask Studio",
    "why": "One sentence — why this question surfaces valuable signal Jason can't see elsewhere"
  },
  ...
]`;

    const queries = await callClaudeMessages(system, [{ role: 'user', content: prompt }], 2048, { tool: 'studio-intel' });

    // Parse — callClaudeMessages returns raw text
    let parsed;
    try {
      const cleaned = queries.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: 'Claude returned malformed query list', raw: queries });
    }

    res.json({ ok: true, queries: parsed, topic_hint, generated_at: new Date().toISOString() });
  } catch (err) {
    log.error({ err }, '[studio-intel] query generation failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/studio-intel/synthesize ───────────────────────────────────────
// SSE. Claude synthesizes Ask Studio responses + Jason's instinct → brief.
// Body: { responses: [{id, query, response}], instinct: string, topic_hint: string }

router.post('/synthesize', async (req, res) => {
  const { send, end } = startSseResponse(res);

  try {
    const { responses = [], instinct = '', topic_hint = '' } = req.body || {};

    if (!responses.length) {
      send({ type: 'error', message: 'No responses to synthesize' });
      return res.end();
    }

    // Pull recent MirrΩr context for synthesis grounding
    let youtubeContext = '';
    try {
      const health = db.getGlobalChannelHealth();
      if (health) {
        youtubeContext = `Channel baseline: ${health.avg_views || 0} avg views, ${health.video_count || 0} total videos.`;
      }
    } catch (e) { /* skip */ }

    const system = `You are a YouTube audience intelligence analyst synthesizing data for Jason Rutland of 7 Kin Homestead. Your job is to turn raw Ask Studio data + Jason's gut instinct into a concrete, actionable intelligence brief that will shape his next 4-8 weeks of content.

Jason's audience: practical people drawn to opting out of the modern system. They fear financial precarity, government overreach, missing the window. His top performing angles are "the system is rigged" and financial reality content.

The brief should read like a smart analyst talking to Jason directly — not a corporate report. Specific, direct, no fluff. If the data reveals something surprising or contradicts assumptions, say so clearly.`;

    const filledResponses = responses.filter(r => r.response && r.response.trim().length > 10);
    const skippedCount = responses.length - filledResponses.length;

    const prompt = `Synthesize this YouTube Studio intelligence data into a structured audience brief for Jason.

${topic_hint ? `CURRENT FOCUS: "${topic_hint}"\n` : ''}
${youtubeContext ? youtubeContext + '\n' : ''}

ASK STUDIO QUERY RESULTS (${filledResponses.length} of ${responses.length} answered${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}):

${filledResponses.map((r, i) => `Q${i + 1}: ${r.query}
YOUTUBE SAID: ${r.response}
`).join('\n')}

JASON'S AUDIENCE INSTINCT:
${instinct || '(none provided)'}

---

Write a Studio Intelligence Brief with these sections:

## 🎯 The Signal (2-3 sentences)
What's the single most important thing this data reveals about Jason's audience right now?

## 😨 What They're Actually Afraid Of
The fears, anxieties, and concerns driving engagement — specific, not generic. Pull exact themes from the data.

## 📭 Content Gaps (Top 3)
Questions the audience is asking that Jason hasn't answered yet. Make these specific enough to brief a video idea directly.

## 🔥 What's Working (and Why)
The patterns behind high-retention / high-CTR content. What format, angle, or emotional trigger is landing?

## 📣 Jason's Instinct Check
How does Jason's gut knowledge align with or contradict the data? Where is his instinct an advantage the data can't show?

## 🎬 Next Video Angles (Top 3)
Specific, actionable video concepts that emerge directly from this intelligence. Include: angle, hook concept, why it should perform.

## 💉 Inject Into Strategy
One paragraph formatted for injection into VectΩr and Id8Ωr — a tight summary of audience state that should inform all content decisions for the next 4-6 weeks.`;

    send({ type: 'start' });

    let fullText = '';
    await callClaudeStream(
      system,
      [{ role: 'user', content: prompt }],
      3000,
      (token) => {
        fullText += token;
        send({ type: 'token', text: token });
      },
      { tool: 'studio-intel' }
    );

    // Save brief to kv_store
    const briefData = {
      text:        fullText,
      topic_hint,
      responses:   filledResponses,
      instinct,
      created_at:  new Date().toISOString(),
    };
    db.setKv('studio_intel_brief', JSON.stringify(briefData));

    send({ type: 'done', brief: briefData });
    end();
  } catch (err) {
    log.error({ err }, '[studio-intel] synthesis failed');
    send({ type: 'error', message: err.message });
    end();
  }
});

// ─── GET /api/studio-intel/brief ─────────────────────────────────────────────
// Returns the saved brief for injection into Id8Ωr / VectΩr.

router.get('/brief', (req, res) => {
  try {
    const raw = db.getKv('studio_intel_brief');
    if (!raw) return res.json({ ok: true, brief: null });
    const brief = JSON.parse(raw);
    res.json({ ok: true, brief });
  } catch (err) {
    log.error({ err }, '[studio-intel] brief fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/studio-intel/brief ──────────────────────────────────────────

router.delete('/brief', (req, res) => {
  try {
    db.setKv('studio_intel_brief', null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
