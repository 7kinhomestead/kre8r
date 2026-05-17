'use strict';

/**
 * Post-Mortem Route — src/routes/postmortem.js
 *
 * Two-way Opus conversation for diagnosing why a video underperformed.
 * Lives as a slide-out panel in NorthΩr.
 *
 * GET  /api/postmortem/videos                  — video list with analytics for picker
 * GET  /api/postmortem/transcript/:project_id  — actual transcript (vault first, yt-dlp fallback)
 * GET  /api/postmortem/session/:project_id     — load persisted conversation
 * POST /api/postmortem/session/:project_id     — save conversation
 * DELETE /api/postmortem/session/:project_id   — clear conversation
 * POST /api/postmortem/chat/:project_id        — SSE streaming Opus chat
 * GET  /api/postmortem/brief/active            — get active post-mortem brief
 * POST /api/postmortem/brief/:project_id       — lock a post-mortem brief
 */

const express   = require('express');
const router    = express.Router();
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { spawn } = require('child_process');

const db                   = require('../db');
const logger               = require('../utils/logger');
const { startSseResponse } = require('../utils/sse');
const { callClaudeStream, callClaudeMessages } = require('../utils/claude');
const { getCreatorContext } = require('../utils/creator-context');

const YTDLP_PATH = process.env.YTDLP_PATH   || 'yt-dlp';
const OPUS_MODEL = process.env.VISUALR_MODEL || 'claude-opus-4-5';

// ─── GET /api/postmortem/videos ───────────────────────────────────────────────

router.get('/videos', (req, res) => {
  try {
    const videos = db.getPostMortemVideoList();
    const health = db.getGlobalChannelHealth();
    // getGlobalChannelHealth returns avg_views at top level (YouTube) + by_platform nested
    const avgViews = health?.avg_views || health?.by_platform?.youtube?.avg_views || 0;
    res.json({ videos, channel_avg_views: avgViews });
  } catch (err) {
    logger.error({ module: 'postmortem', err: err.message }, 'videos failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/postmortem/transcript/:project_id ───────────────────────────────

router.get('/transcript/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  try {
    // 1. Try vault — completed-video footage with transcript inline
    const footage = db.getFootageByProject(projectId) || [];
    const completed = footage.find(f =>
      (f.shot_type === 'completed-video' || f.shot_type === 'completed_video') && f.transcript
    );
    if (completed?.transcript) {
      return res.json({ transcript: completed.transcript, source: 'vault' });
    }

    // 2. Try yt-dlp auto-captions
    const project = db.getProject(projectId);
    const ytUrl   = project?.youtube_url
      || (project?.youtube_video_id ? `https://www.youtube.com/watch?v=${project.youtube_video_id}` : null);
    if (!ytUrl) {
      return res.json({ transcript: null, source: 'none' });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kre8r-pm-'));
    try {
      const transcript = await fetchYtTranscript(ytUrl, tmpDir);
      return res.json({ transcript, source: transcript ? 'youtube_captions' : 'none' });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

  } catch (err) {
    logger.error({ module: 'postmortem', err: err.message }, 'transcript fetch failed');
    res.json({ transcript: null, source: 'error', error: err.message });
  }
});

function fetchYtTranscript(youtubeUrl, tmpDir) {
  return new Promise((resolve) => {
    const proc = spawn(YTDLP_PATH, [
      '--write-auto-subs',
      '--sub-lang', 'en',
      '--skip-download',
      '--sub-format', 'vtt',
      '-o', path.join(tmpDir, '%(id)s'),
      youtubeUrl,
    ], { windowsHide: true, timeout: 60 * 1000,
         env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });

    proc.on('close', () => {
      try {
        const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vtt'));
        if (!files.length) { resolve(null); return; }
        const raw = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
        resolve(parseVtt(raw) || null);
      } catch (_) { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}

function parseVtt(vttText) {
  const lines = vttText.split('\n');
  const textLines = [];
  let prev = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === 'WEBVTT') continue;
    if (/^\d{2}:\d{2}/.test(t) || t.includes('-->')) continue;
    const stripped = t.replace(/<[^>]+>/g, '').trim();
    if (stripped && stripped !== prev) { textLines.push(stripped); prev = stripped; }
  }
  return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Session persistence ──────────────────────────────────────────────────────

router.get('/session/:project_id', (req, res) => {
  try {
    const raw = db.getKv(`postmortem_session_${req.params.project_id}`);
    res.json({ messages: raw ? JSON.parse(raw) : [] });
  } catch (_) { res.json({ messages: [] }); }
});

router.post('/session/:project_id', (req, res) => {
  try {
    db.setKv(`postmortem_session_${req.params.project_id}`, JSON.stringify(req.body.messages || []));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/session/:project_id', (req, res) => {
  try {
    db.setKv(`postmortem_session_${req.params.project_id}`, null);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/postmortem/brief/active ─────────────────────────────────────────
// Declared BEFORE /:project_id to avoid route collision

router.get('/brief/active', (req, res) => {
  try {
    res.json({ brief: db.getActivePostMortemBrief() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/postmortem/brief/active ──────────────────────────────────────

router.delete('/brief/active', (req, res) => {
  try {
    db.clearActivePostMortemBrief();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/postmortem/brief/:project_id ───────────────────────────────────

router.post('/brief/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  const { conversation = [], video_title = '' } = req.body;
  const { creatorName } = getCreatorContext();

  try {
    const convText = conversation.map(m =>
      `${m.role === 'user' ? creatorName : 'Claude'}: ${m.content}`
    ).join('\n\n');

    // If the conversation is long, keep the END (where the real diagnosis lives),
    // not the start (where wrong first impressions live). Show first 1500 chars for
    // context, then the final ~8000 chars where the conclusion was reached.
    let convSlice;
    const LIMIT = 10000;
    if (convText.length <= LIMIT) {
      convSlice = convText;
    } else {
      const head = convText.slice(0, 1500);
      const tail = convText.slice(-(LIMIT - 1500));
      convSlice = `${head}\n\n[...conversation continues...]\n\n${tail}`;
    }

    const briefPrompt = `Based on this post-mortem conversation about "${video_title}", generate a structured brief.

IMPORTANT: The conversation may start with an initial read of the data that gets revised through dialogue. Base the brief on the FINAL diagnosis reached at the END of the conversation, not the first impression at the start.

CONVERSATION:
${convSlice}

Return ONLY this JSON — no markdown:
{
  "root_cause": "One sentence: the real reason this video underperformed",
  "adjustments": [
    "Specific actionable change #1",
    "Specific actionable change #2",
    "Specific actionable change #3"
  ],
  "avoid": "One specific pattern to stop using based on this analysis"
}`;

    const raw     = await callClaudeMessages(null, [{ role: 'user', content: briefPrompt }], 1024, { tool: 'postmortem-brief', model: OPUS_MODEL });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (_) { parsed = { root_cause: cleaned.slice(0, 200), adjustments: [], avoid: '' }; }

    const brief = db.insertPostMortemBrief({
      project_id:  projectId,
      video_title,
      root_cause:  parsed.root_cause  || '',
      adjustments: parsed.adjustments || [],
      avoid:       parsed.avoid       || '',
    });

    res.json({ ok: true, brief });
  } catch (err) {
    logger.error({ module: 'postmortem', err: err.message }, 'brief lock failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/postmortem/chat/:project_id (SSE) ──────────────────────────────

router.post('/chat/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  const { message, history = [], video_data = {}, transcript, channel_avg = 0 } = req.body;

  const { send, end } = startSseResponse(res);
  const { creatorName, brand } = getCreatorContext();

  try {
    const views    = Number(video_data.views || 0);
    const avgViews = Number(channel_avg || 0);
    const pctDiff  = avgViews > 0 ? Math.round(((views - avgViews) / avgViews) * 100) : null;
    const pctLabel = pctDiff !== null
      ? `${Math.abs(pctDiff)}% ${pctDiff < 0 ? 'BELOW' : 'above'} channel average`
      : 'channel average unknown';

    const completion = video_data.completion_rate
      ? `\n- Completion rate: ${Number(video_data.completion_rate).toFixed(1)}%`
      : '';

    const publishedLabel = video_data.published_at
      ? new Date(video_data.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'Unknown';

    // ── VisualΩr — check if this video was analyzed ──────────────────────────
    let visualBlock = '';
    try {
      const visResultsRaw = db.getKv('visual_intelligence_video_results');
      if (visResultsRaw) {
        const visResults = JSON.parse(visResultsRaw);
        const titleSnippet = (video_data.title || '').toLowerCase().slice(0, 25);
        const match = visResults.find(v => v.title && v.title.toLowerCase().includes(titleSnippet));
        if (match?.summary) {
          const s = match.summary;
          visualBlock = `
VISUAL ANALYSIS (VisualΩr — ${match.frame_count || '?'} frames analyzed):
- Face presence: ${Math.round((s.face_presence_pct || 0) * 100)}% | Opening face: ${Math.round((s.opening_face_pct || 0) * 100)}%
- Outdoor: ${Math.round((s.avg_outdoor_score || 0) * 100)}% | Green/nature: ${Math.round((s.avg_green_score || 0) * 100)}%
- Strong retention frames: ${Math.round((s.strong_retention_pct || 0) * 100)}% | Weak: ${Math.round((s.weak_retention_pct || 0) * 100)}%
- Opening scene: "${s.opening_scene || 'unknown'}"
- Scene variety: ${(s.scene_types || []).join(', ')}
- Performance tier: ${match.performance_tier || 'untagged'}`;
        }
      }
    } catch (_) {}

    const transcriptBlock = transcript
      ? `\nACTUAL TRANSCRIPT (what was said — not the script):\n${transcript.slice(0, 4000)}${transcript.length > 4000 ? '\n[...continues...]' : ''}`
      : '\nTRANSCRIPT: Not available. Ask Jason to describe the content and how it was delivered.';

    const systemPrompt = `You are conducting a post-mortem on an underperforming video for ${creatorName} at ${brand}.

Your job: find the real reason this video fell flat when strategy and data suggested it should work. Not to make Jason feel better — to find the specific failure point so the next video doesn't repeat it.

FAILURE TAXONOMY — work through these:
1. Hook failure — first 30 seconds lost them before the video could deliver
2. Thumbnail/title mismatch — promised something the video didn't deliver
3. Topic-audience mismatch — right topic, wrong angle for this specific audience
4. Distribution failure — algorithm didn't serve it (timing, category, posting circumstances)
5. Production failure — visual or audio quality broke trust early
6. Pacing failure — right content, wrong structure

HOW TO CONDUCT THIS:
- Open with your honest read of the numbers — what do they tell you without interpretation?
- Ask one focused question per turn to surface what you can't see in the data
- Challenge explanations that don't match the data — if Jason says "topic was wrong" but retention was 60%, that's not the issue
- When you have a clear diagnosis, state it directly and defend it
- Suggest locking a brief when the diagnosis is solid

RULES:
- Never say "great question" or any filler
- Short, direct responses — editor to editor
- Reference specific data when arguing
- Say when you don't have enough information to diagnose yet

VIDEO: "${video_data.title || 'Unknown'}"
PUBLISHED: ${publishedLabel}

PERFORMANCE DATA:
- Views: ${views.toLocaleString()} (channel avg: ${Math.round(avgViews).toLocaleString()} — ${pctLabel})${completion}
${transcriptBlock}
${visualBlock}`;

    const isOpening    = message === 'BEGIN_POSTMORTEM';
    const userMessage  = isOpening
      ? `Open the post-mortem on "${video_data.title}". Lead with your honest read of the data.`
      : message;

    const messages = [
      ...history.slice(-20).map(h => ({ role: h.role, content: String(h.content) })),
      { role: 'user', content: userMessage },
    ];

    let fullText = '';
    await callClaudeStream(
      systemPrompt,
      messages,
      2048,
      (token) => { fullText += token; send({ token }); },
      { tool: 'postmortem-chat', session_id: String(projectId), model: OPUS_MODEL }
    );

    send({ done: true, full_text: fullText });
    end();

  } catch (err) {
    logger.error({ module: 'postmortem', err: err.message }, 'chat failed');
    send({ error: err.message });
    end();
  }
});

module.exports = router;
