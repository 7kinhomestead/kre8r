/**
 * AnalΩzr Route — src/routes/analytr.js
 *
 * GET  /api/analytr/channel-health        — all-time channel stats
 * GET  /api/analytr/videos                — last 10 projects with analytics
 * POST /api/analytr/coach                 — SSE: Claude coaching report
 * POST /api/analytr/youtube-sync          — SSE: sync YouTube stats via API
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ─── Channel Health ───────────────────────────────────────────────────────────

router.get('/channel-health', (req, res) => {
  try {
    const health = db.getGlobalChannelHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Last N Videos with Analytics ────────────────────────────────────────────

router.get('/videos', (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 10, 50);
    const videos = db.getRecentProjectsWithAnalytics(limit);
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Claude Coaching Report (SSE) ─────────────────────────────────────────────

router.post('/coach', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const videos = db.getRecentProjectsWithAnalytics(10);
    const health = db.getGlobalChannelHealth();

    if (videos.length === 0) {
      send({ type: 'error', message: 'No video data yet. Add analytics data for your videos first.' });
      res.end();
      return;
    }

    send({ type: 'status', message: 'Analyzing your last ' + videos.length + ' videos...' });

    const videoList = videos.map((v, i) => {
      const views    = v.total_views     ? `${Number(v.total_views).toLocaleString()} views` : 'no view data';
      const cr       = v.avg_completion_rate ? `${Math.round(v.avg_completion_rate * 100)}% completion` : '';
      const comments = v.total_comments  ? `${v.total_comments} comments` : '';
      const platforms = v.platforms || 'unknown platform';
      const stats    = [views, cr, comments].filter(Boolean).join(', ');
      return `${i + 1}. "${v.title}" (${platforms}) — ${stats || 'no stats yet'}`;
    }).join('\n');

    const prompt = `You are a supportive creative director coaching a homesteading content creator. Jason runs 7 Kin Homestead — 725k TikTok, 54k YouTube, 80k Lemon8. His brand is straight-talking, warm, funny, never corporate. Sharp-tongued neighbor talking over a fence. His content angles: financial (real cost breakdowns), system (opt out and win), rockrich (doing a lot with a little), howto, mistakes, lifestyle, viral.

Analyze his last ${videos.length} videos and give specific, constructive, encouraging feedback. Focus on patterns not individual failures. Always end with one specific actionable thing to do this week. Reference actual video titles and data.

Channel overview:
- Total all-time views: ${Number(health.total_views).toLocaleString()}
- Average views per video: ${Number(health.avg_views).toLocaleString()}
- Best video: ${health.best_video ? `"${health.best_video.title}" (${Number(health.best_video.views).toLocaleString()} views)` : 'no data'}
- Top content topic: ${health.top_topic || 'varied'}

Last ${videos.length} videos:
${videoList}

Respond in exactly this JSON structure:
{
  "working_well": ["specific point 1", "specific point 2", "specific point 3"],
  "improve": ["specific point 1", "specific point 2", "specific point 3"],
  "focus_this_week": "One specific, concrete, actionable thing Jason should do or make this week.",
  "trending_topics": ["topic 1", "topic 2", "topic 3"],
  "coaching_note": "A 2-3 sentence encouraging closing note in Jason's tone — warm, direct, no fluff."
}`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const { default: fetch } = await import('node-fetch');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method : 'POST',
      headers: {
        'Content-Type'      : 'application/json',
        'x-api-key'         : apiKey,
        'anthropic-version' : '2023-06-01',
      },
      body: JSON.stringify({
        model      : process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens : 2048,
        messages   : [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Claude API error ${response.status}: ${err?.error?.message || ''}`);
    }

    const data = await response.json();
    const raw  = data.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send({ type: 'error', message: 'Claude returned unexpected format. Try again.' });
      res.end();
      return;
    }

    send({ type: 'report', data: parsed });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── YouTube Sync (SSE) ───────────────────────────────────────────────────────

router.post('/youtube-sync', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      send({ type: 'error', message: 'YOUTUBE_API_KEY not set in .env. Add your YouTube Data API v3 key to enable sync.' });
      res.end();
      return;
    }

    const projects = db.getAllProjects();
    const withYT   = projects.filter(p => p.youtube_video_id);

    if (withYT.length === 0) {
      send({ type: 'error', message: 'No projects have a YouTube video ID set. Edit a project in PipΩr to add the YouTube URL.' });
      res.end();
      return;
    }

    send({ type: 'status', message: `Found ${withYT.length} project(s) with YouTube IDs. Syncing...` });

    const { default: fetch } = await import('node-fetch');
    let synced = 0, failed = 0;

    for (const project of withYT) {
      try {
        send({ type: 'progress', message: `Fetching stats for "${project.title}"...` });

        const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${encodeURIComponent(project.youtube_video_id)}&key=${apiKey}`;
        const ytRes  = await fetch(ytUrl);

        if (!ytRes.ok) {
          const err = await ytRes.json().catch(() => ({}));
          throw new Error(err?.error?.message || `HTTP ${ytRes.status}`);
        }

        const ytData = await ytRes.json();
        const item   = ytData.items?.[0];

        if (!item) {
          send({ type: 'warn', message: `"${project.title}" — video not found on YouTube (ID: ${project.youtube_video_id})` });
          failed++;
          continue;
        }

        const stats = item.statistics;

        // Find or create a YouTube post record for this project
        const posts = db.getPostsByProject(project.id);
        let ytPost  = posts.find(p => p.platform === 'youtube');

        if (!ytPost) {
          const ytUrl2 = `https://www.youtube.com/watch?v=${project.youtube_video_id}`;
          const postId = db.savePost({
            project_id: project.id,
            platform:   'youtube',
            url:        ytUrl2,
            content:    project.title,
            status:     'posted',
            posted_at:  item.snippet?.publishedAt || new Date().toISOString(),
          });
          ytPost = { id: postId };
        }

        // Upsert metrics
        const metricsMap = {
          views:         parseInt(stats.viewCount)    || 0,
          likes:         parseInt(stats.likeCount)    || 0,
          comment_count: parseInt(stats.commentCount) || 0,
        };

        for (const [name, value] of Object.entries(metricsMap)) {
          db.upsertMetric(ytPost.id, project.id, 'youtube', name, value);
        }

        send({
          type: 'synced',
          message: `✓ "${project.title}" — ${Number(metricsMap.views).toLocaleString()} views, ${metricsMap.likes} likes, ${metricsMap.comment_count} comments`,
          project_id: project.id,
          metrics: metricsMap,
        });

        synced++;

        // Avoid hammering the API
        await new Promise(r => setTimeout(r, 300));

      } catch (err) {
        send({ type: 'warn', message: `✗ "${project.title}" — ${err.message}` });
        failed++;
      }
    }

    send({
      type: 'done',
      message: `Sync complete. ${synced} updated, ${failed} failed.`,
      synced,
      failed,
      synced_at: new Date().toISOString(),
    });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

module.exports = router;
