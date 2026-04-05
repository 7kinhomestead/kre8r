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

// ─── YouTube Channel Import (SSE) ────────────────────────────────────────────
// Imports ALL videos from the channel into Kre8Ωr as projects.
// Auth priority: OAuth access_token → YOUTUBE_CHANNEL_ID env → forHandle search

router.post('/youtube-import-channel', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      send({ type: 'error', message: 'YOUTUBE_API_KEY not set in .env.' });
      res.end(); return;
    }

    const { default: fetch } = await import('node-fetch');

    // ── Step 1: Get uploads playlist ID ─────────────────────────────────────
    send({ type: 'status', message: 'Fetching channel info...' });

    let channelUrl;
    const oauthToken     = process.env.YOUTUBE_ACCESS_TOKEN;
    const channelIdEnv   = process.env.YOUTUBE_CHANNEL_ID;
    const channelHandle  = '@7kinhomestead'; // from creator-profile.json

    if (oauthToken) {
      channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true&key=${apiKey}`;
    } else if (channelIdEnv) {
      channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(channelIdEnv)}&key=${apiKey}`;
    } else {
      channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(channelHandle)}&key=${apiKey}`;
    }

    const chanHeaders = oauthToken
      ? { Authorization: `Bearer ${oauthToken}` }
      : {};

    const chanRes  = await fetch(channelUrl, { headers: chanHeaders });
    const chanData = await chanRes.json();

    if (!chanRes.ok) {
      throw new Error(chanData?.error?.message || `YouTube channels API error ${chanRes.status}`);
    }

    const channel = chanData.items?.[0];
    if (!channel) {
      throw new Error(`Channel not found. Set YOUTUBE_CHANNEL_ID in .env or check the handle "${channelHandle}".`);
    }

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      throw new Error('Could not find uploads playlist for this channel.');
    }

    send({ type: 'status', message: `Found uploads playlist. Fetching video list...` });

    // ── Step 2: Paginate through all playlist items ──────────────────────────
    const allVideoIds = [];
    const videoMeta   = {}; // videoId → { title, description, publishedAt }
    let pageToken     = null;

    do {
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const listUrl   = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50${pageParam}&key=${apiKey}`;
      const listRes   = await fetch(listUrl);
      const listData  = await listRes.json();

      if (!listRes.ok) {
        throw new Error(listData?.error?.message || `PlaylistItems API error ${listRes.status}`);
      }

      for (const item of listData.items || []) {
        const vid = item.snippet?.resourceId?.videoId;
        if (vid) {
          allVideoIds.push(vid);
          videoMeta[vid] = {
            title:       item.snippet.title       || 'Untitled',
            description: item.snippet.description || '',
            publishedAt: item.snippet.publishedAt || null,
          };
        }
      }

      pageToken = listData.nextPageToken || null;
      send({ type: 'progress', message: `Found ${allVideoIds.length} videos so far...` });

      if (pageToken) await new Promise(r => setTimeout(r, 200));
    } while (pageToken);

    send({ type: 'status', message: `${allVideoIds.length} total videos found. Fetching stats...` });

    // ── Step 3: Fetch stats in batches of 50 ────────────────────────────────
    const allStats = {}; // videoId → statistics
    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch  = allVideoIds.slice(i, i + 50);
      const ids    = batch.join(',');
      const statUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${encodeURIComponent(ids)}&key=${apiKey}`;
      const statRes = await fetch(statUrl);
      const statData = await statRes.json();

      if (!statRes.ok) {
        send({ type: 'warn', message: `Stats batch error: ${statData?.error?.message || statRes.status}` });
        continue;
      }

      for (const item of statData.items || []) {
        allStats[item.id] = item.statistics;
        // Prefer snippet title/description from this call (more reliable)
        if (item.snippet) {
          videoMeta[item.id].title       = item.snippet.title       || videoMeta[item.id].title;
          videoMeta[item.id].description = item.snippet.description || videoMeta[item.id].description;
          videoMeta[item.id].publishedAt = item.snippet.publishedAt || videoMeta[item.id].publishedAt;
        }
      }

      await new Promise(r => setTimeout(r, 200));
    }

    // ── Step 4: Import each video as a project ───────────────────────────────
    let imported = 0, skipped = 0, failed = 0;

    // Build a set of existing youtube_video_ids for fast lookup
    const existingProjects  = db.getAllProjects();
    const existingVideoIds  = new Set(
      existingProjects.map(p => p.youtube_video_id).filter(Boolean)
    );

    for (let i = 0; i < allVideoIds.length; i++) {
      const videoId = allVideoIds[i];
      const meta    = videoMeta[videoId] || {};
      const stats   = allStats[videoId]  || {};

      send({
        type: 'progress',
        message: `Importing ${i + 1}/${allVideoIds.length}: "${meta.title}"`,
      });

      // Skip if already linked to a project
      if (existingVideoIds.has(videoId)) {
        // Still sync stats for the existing project
        const existing = existingProjects.find(p => p.youtube_video_id === videoId);
        if (existing && stats.viewCount) {
          const posts  = db.getPostsByProject(existing.id);
          let ytPost   = posts.find(p => p.platform === 'youtube');
          if (!ytPost) {
            const postId = db.savePost({
              project_id: existing.id,
              platform:   'youtube',
              url:        `https://www.youtube.com/watch?v=${videoId}`,
              content:    meta.title,
              status:     'posted',
              posted_at:  meta.publishedAt || new Date().toISOString(),
            });
            ytPost = { id: postId };
          }
          db.upsertMetric(ytPost.id, existing.id, 'youtube', 'views',         parseInt(stats.viewCount)    || 0);
          db.upsertMetric(ytPost.id, existing.id, 'youtube', 'likes',         parseInt(stats.likeCount)    || 0);
          db.upsertMetric(ytPost.id, existing.id, 'youtube', 'comment_count', parseInt(stats.commentCount) || 0);
        }
        skipped++;
        continue;
      }

      try {
        const ytUrl   = `https://www.youtube.com/watch?v=${videoId}`;
        const desc    = meta.description ? meta.description.substring(0, 500) : null;

        // Create project
        const project = db.createProject(meta.title, desc, ytUrl, videoId);

        // Create YouTube post record
        const postId = db.savePost({
          project_id: project.id,
          platform:   'youtube',
          url:        ytUrl,
          content:    meta.title,
          status:     'posted',
          posted_at:  meta.publishedAt || new Date().toISOString(),
        });

        // Save metrics
        if (stats.viewCount !== undefined) {
          db.upsertMetric(postId, project.id, 'youtube', 'views',         parseInt(stats.viewCount)    || 0);
          db.upsertMetric(postId, project.id, 'youtube', 'likes',         parseInt(stats.likeCount)    || 0);
          db.upsertMetric(postId, project.id, 'youtube', 'comment_count', parseInt(stats.commentCount) || 0);
        }

        existingVideoIds.add(videoId);
        imported++;

      } catch (err) {
        send({ type: 'warn', message: `✗ "${meta.title}" — ${err.message}` });
        failed++;
      }
    }

    send({
      type: 'done',
      message: `Import complete — ${imported} imported, ${skipped} already existed, ${failed} failed.`,
      imported,
      skipped,
      failed,
      total: allVideoIds.length,
    });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

module.exports = router;
