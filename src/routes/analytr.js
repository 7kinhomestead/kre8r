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
const multer  = require('multer');
const router  = express.Router();
const db      = require('../db');

// ─── Multer: memory storage for thumbnail uploads ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max per image
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are accepted.'));
  },
});

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

    const avgViews  = health.avg_views || 0;
    const bestVideo = health.best_video;

    const videoList = videos.map(v =>
      `- "${v.title}": ${v.total_views ? Number(v.total_views).toLocaleString() : 0} views, ${v.total_likes ? Number(v.total_likes).toLocaleString() : 0} likes, ${v.total_comments ? Number(v.total_comments).toLocaleString() : 0} comments`
    ).join('\n');

    const prompt = `You are a supportive creative director coaching Jason at 7 Kin Homestead — 725k TikTok, 54k YouTube, 80k Lemon8. His brand is straight-talking, warm, funny, never corporate. Sharp-tongued neighbor talking over a fence. His content angles: financial (real cost breakdowns), system (opt out and win), rockrich (doing a lot with a little), howto, mistakes, lifestyle, viral.

Here are his ${videos.length} most recent YouTube videos with performance data:
${videoList}

His channel average is ${Number(avgViews).toLocaleString()} views per video.
His best performing video is ${bestVideo ? `"${bestVideo.title}" with ${Number(bestVideo.views).toLocaleString()} views` : 'not yet determined'}.
Total all-time views: ${Number(health.total_views).toLocaleString()}.

Give him:
1. 3 specific things working well based on his actual data — reference real video titles
2. 3 specific things to improve — specific and actionable, not generic
3. His #1 focus for this week — one concrete thing he should do or make
4. 2-3 trending topics his audience would love based on his content themes
5. One encouraging note about his channel trajectory — warm, direct, no fluff, in his voice
6. On-camera performance feedback — based on the engagement patterns, comment counts, and video topics, give Jason genuine constructive feedback on his on-camera performance. Consider:
   - Are high-comment videos ones where he's more personal/vulnerable?
   - Do tutorial-style videos perform differently than story-driven ones?
   - What does the data suggest about his energy, pacing, or delivery?
   - What's one specific on-camera habit to work on?
   Be a great director — honest, specific, kind but not soft. The goal is measurable improvement not comfort. Think: "Your best friend who happens to be Martin Scorsese."

Be specific, use his actual video titles, be encouraging not brutal.

Respond in exactly this JSON structure (no markdown, no commentary, just JSON):
{
  "working_well": ["point 1", "point 2", "point 3"],
  "improve": ["point 1", "point 2", "point 3"],
  "focus_this_week": "One specific, concrete, actionable thing Jason should do or make this week.",
  "trending_topics": ["topic 1", "topic 2", "topic 3"],
  "coaching_note": "2-3 sentences. Warm, direct, in Jason's tone.",
  "performance": "3-4 sentences of genuine on-camera performance coaching. Specific, director-level, actionable."
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
// No OAuth needed — public channel data only via YOUTUBE_API_KEY + forHandle.

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

    // Handle from env — no @ prefix (YouTube forHandle param doesn't need it)
    const channelHandle = process.env.YOUTUBE_CHANNEL_HANDLE || '7kinhomestead';

    const { default: fetch } = await import('node-fetch');

    // ── Step 1: Resolve uploads playlist ID via forHandle ───────────────────
    send({ type: 'status', message: `Fetching channel info for @${channelHandle}...` });

    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(channelHandle)}&key=${apiKey}`;
    const chanRes    = await fetch(channelUrl);
    const chanData   = await chanRes.json();

    if (!chanRes.ok) {
      throw new Error(chanData?.error?.message || `YouTube channels API error ${chanRes.status}`);
    }

    const channel = chanData.items?.[0];
    if (!channel) {
      throw new Error(`Channel not found for handle "@${channelHandle}". Check YOUTUBE_CHANNEL_HANDLE in .env.`);
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
            title:        item.snippet.title       || 'Untitled',
            description:  item.snippet.description || '',
            publishedAt:  item.snippet.publishedAt || null,
            thumbnailUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
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
        // Prefer snippet fields from this call (more reliable than playlistItems)
        if (item.snippet) {
          videoMeta[item.id].title        = item.snippet.title       || videoMeta[item.id].title;
          videoMeta[item.id].description  = item.snippet.description || videoMeta[item.id].description;
          videoMeta[item.id].publishedAt  = item.snippet.publishedAt || videoMeta[item.id].publishedAt;
          videoMeta[item.id].thumbnailUrl = item.snippet.thumbnails?.medium?.url
            || item.snippet.thumbnails?.default?.url
            || videoMeta[item.id].thumbnailUrl
            || null;
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
              project_id:    existing.id,
              platform:      'youtube',
              url:           `https://www.youtube.com/watch?v=${videoId}`,
              content:       meta.title,
              status:        'posted',
              posted_at:     meta.publishedAt || new Date().toISOString(),
              thumbnail_url: meta.thumbnailUrl || null,
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

        // Create project (mark as youtube_import so it stays out of production tool dropdowns)
        const project = db.createProject(meta.title, desc, ytUrl, videoId);
        db.setProjectSource(project.id, 'youtube_import');

        // Create YouTube post record
        const postId = db.savePost({
          project_id:    project.id,
          platform:      'youtube',
          url:           ytUrl,
          content:       meta.title,
          status:        'posted',
          posted_at:     meta.publishedAt || new Date().toISOString(),
          thumbnail_url: meta.thumbnailUrl || null,
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

// ─── Thumbnail A/B Tester ─────────────────────────────────────────────────────
// POST /api/analytr/thumbnail-ab
// Accepts: multipart form with thumbnailA + thumbnailB image files
//          + optional fields: project_id, context

router.post('/thumbnail-ab', upload.fields([
  { name: 'thumbnailA', maxCount: 1 },
  { name: 'thumbnailB', maxCount: 1 },
]), async (req, res) => {
  try {
    const fileA = req.files?.thumbnailA?.[0];
    const fileB = req.files?.thumbnailB?.[0];

    if (!fileA || !fileB) {
      return res.status(400).json({ error: 'Both thumbnailA and thumbnailB are required.' });
    }

    const b64A     = fileA.buffer.toString('base64');
    const b64B     = fileB.buffer.toString('base64');
    const mimeA    = fileA.mimetype || 'image/jpeg';
    const mimeB    = fileB.mimetype || 'image/jpeg';
    const context  = (req.body.context || '').trim();
    const contextLine = context ? `\nCreator context: ${context}` : '';

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const { default: fetch } = await import('node-fetch');

    const prompt = `You are a YouTube thumbnail expert specializing in homesteading and off-grid content for 7 Kin Homestead (Jason Rutland — 725k TikTok, 54k YouTube). Jason's best-performing thumbnails follow this formula:
- Authentic emotion on Jason's face (surprise, pride, exasperation, delight)
- Bold readable numbers or short text (3-5 words max)
- Natural outdoor / homestead backgrounds
- High contrast, warm tones
- Feels real, not polished — the anti-stock-photo${contextLine}

You are comparing Thumbnail A vs Thumbnail B.

Score EACH thumbnail on these 5 dimensions (0–10 each):
1. emotional_hook — Does the facial expression / image provoke immediate emotion?
2. text_readability — Is the text bold, legible, and fast to read at thumbnail size?
3. visual_clarity — Is the composition clean and uncluttered?
4. click_worthiness — Would a casual scroller stop and click THIS?
5. brand_fit — Does it feel like 7 Kin Homestead — authentic, real, not corporate?

Respond in EXACTLY this JSON structure (no markdown, no commentary, just JSON):
{
  "thumbnailA": {
    "emotional_hook": 8,
    "text_readability": 7,
    "visual_clarity": 9,
    "click_worthiness": 8,
    "brand_fit": 9,
    "total": 41,
    "strengths": "One sentence on what's working.",
    "weaknesses": "One sentence on what to fix."
  },
  "thumbnailB": {
    "emotional_hook": 6,
    "text_readability": 8,
    "visual_clarity": 7,
    "click_worthiness": 7,
    "brand_fit": 6,
    "total": 34,
    "strengths": "One sentence on what's working.",
    "weaknesses": "One sentence on what to fix."
  },
  "winner": "A",
  "reasoning": "2-3 sentences explaining the decision. Specific, director-level, no fluff.",
  "improvement": "One specific change to make the losing thumbnail competitive."
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method : 'POST',
      headers: {
        'Content-Type'      : 'application/json',
        'x-api-key'         : apiKey,
        'anthropic-version' : '2023-06-01',
      },
      body: JSON.stringify({
        model      : process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens : 1024,
        messages   : [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeA, data: b64A },
            },
            {
              type: 'text',
              text: 'This is Thumbnail A.',
            },
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeB, data: b64B },
            },
            {
              type: 'text',
              text: 'This is Thumbnail B.\n\n' + prompt,
            },
          ],
        }],
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
      return res.status(500).json({ error: 'Claude returned unexpected format. Try again.' });
    }

    // Ensure totals are calculated correctly
    const dims = ['emotional_hook', 'text_readability', 'visual_clarity', 'click_worthiness', 'brand_fit'];
    for (const key of ['thumbnailA', 'thumbnailB']) {
      parsed[key].total = dims.reduce((s, d) => s + (Number(parsed[key][d]) || 0), 0);
    }
    if (!parsed.winner) {
      parsed.winner = parsed.thumbnailA.total >= parsed.thumbnailB.total ? 'A' : 'B';
    }

    res.json(parsed);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Content DNA: Graph data (cluster analysis) ───────────────────────────────
// GET /api/analytr/content-dna/graph
// Returns nodes with cluster assignments for the D3 constellation graph.
// Fetches all projects with youtube_video_id, clusters by title via Claude,
// caches result in kv_store as 'channel_dna_clusters'.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

router.get('/content-dna/graph', async (req, res) => {
  console.log('[content-dna/graph] Hit — refresh:', !!req.query.refresh);
  try {
    // Return cached result if fresh (< 24 h) and no ?refresh=1
    if (!req.query.refresh) {
      const cached = db.getKv('channel_dna_clusters');
      if (cached) {
        const age = cached.cached_at ? Date.now() - new Date(cached.cached_at).getTime() : Infinity;
        if (age < CACHE_TTL_MS) {
          console.log('[content-dna/graph] Serving from cache (age: ' + Math.round(age / 60000) + ' min)');
          return res.json(cached);
        }
        console.log('[content-dna/graph] Cache stale — regenerating');
      } else {
        console.log('[content-dna/graph] No cache found — generating');
      }
    }

    // Get all youtube projects with analytics
    const allProjects = db.getAllProjects();
    const ytProjects  = allProjects.filter(p => p.youtube_video_id);

    if (ytProjects.length === 0) {
      return res.json({ nodes: [], clusters: [], error: 'no_videos' });
    }

    // Attach analytics to ALL projects (used for the full node list in the graph)
    const allNodes = ytProjects.map(p => {
      const analytics = db.getAnalyticsByProject(p.id);
      const views    = analytics.find(m => m.metric_name === 'views')?.metric_value         || 0;
      const likes    = analytics.find(m => m.metric_name === 'likes')?.metric_value         || 0;
      const comments = analytics.find(m => m.metric_name === 'comment_count')?.metric_value || 0;
      return {
        id:          p.id,
        title:       p.title,
        views:       Number(views),
        likes:       Number(likes),
        comments:    Number(comments),
        youtube_url: p.youtube_url || (p.youtube_video_id ? `https://www.youtube.com/watch?v=${p.youtube_video_id}` : null),
      };
    });

    // Send only top 50 by view count to Claude for clustering — fast + token-safe
    const top50 = [...allNodes].sort((a, b) => b.views - a.views).slice(0, 50);
    console.log(`[content-dna/graph] Sending top ${top50.length} of ${allNodes.length} videos to Claude for clustering`);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const { default: fetch } = await import('node-fetch');

    const top10 = top50.slice(0, 10);
    const top10Lines = top10
      .map((n, i) => `#${i + 1} — ${n.title} | ${n.views.toLocaleString()} views`)
      .join('\n');

    const videoLines = top50
      .map(n => `${n.title} | ${n.views.toLocaleString()} views | ${n.likes} likes | ${n.comments} comments`)
      .join('\n');

    const clusterPrompt = `You are analyzing the YouTube channel of an off-grid homesteading creator to identify their highest-performing content clusters and the hidden connections between them.

TOP 10 VIDEOS BY VIEW COUNT — these are the proven winners. Cluster names must reflect what these videos are about:
${top10Lines}

RULE: Name each cluster after what the HIGH-PERFORMING videos in that cluster are actually about — not by keyword pattern-matching across all titles. A cluster called "Financial Escape" earns that name because the #1 video with 421k views is about affording off-grid living, not because several titles contain the word "financial". The top video in a cluster defines the cluster's identity.

Now group all ${top50.length} videos below into 5-8 clusters using that principle. Each cluster should represent a distinct audience need that has proven traction. Use names that are specific, evocative, and 2-4 words.

All videos (title | views | likes | comments):
${videoLines}

After assigning clusters, also identify 15-25 cross-cluster connections — pairs of videos from DIFFERENT clusters that share a strong thematic link. Focus on non-obvious, meaningful connections (e.g. a "how to buy land" video connecting to a "starting from nothing" video because both address the same fear). Skip obvious connections.

Return ONLY valid JSON, no markdown, no commentary:
{
  "clusters": [
    {
      "id": 1,
      "name": "Financial Escape",
      "color": "teal",
      "top_video": "exact title of the highest-view video in this cluster",
      "videos": ["exact video title 1", "exact video title 2"]
    }
  ],
  "edges": [
    { "source": "exact video title 1", "target": "exact video title 2", "reason": "both address starting from zero with no money" }
  ]
}

Available colors (use each at most twice): teal, amber, coral, purple, green, blue, orange, rose`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages:   [{ role: 'user', content: clusterPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      throw new Error(`Claude API error ${claudeRes.status}: ${err?.error?.message || ''}`);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch (parseErr) {
      console.error('[content-dna/graph] JSON parse failed:', parseErr.message);
      console.error('[content-dna/graph] Raw response (first 500):', rawText.slice(0, 500));
      return res.status(500).json({ error: 'Claude returned unexpected format', raw: rawText.slice(0, 200) });
    }

    // Map cluster assignments back to nodes by title lookup
    const clusterMap = {};
    for (const cluster of parsed.clusters || []) {
      for (const title of cluster.videos || []) {
        clusterMap[title.toLowerCase().trim()] = cluster;
      }
    }

    const COLORS = {
      teal: '#3ecfb2', amber: '#f0b942', coral: '#e05c5c',
      purple: '#a78bfa', green: '#5cba8a', blue: '#5b9cf6',
      orange: '#f0834a', rose: '#f06b9e',
    };

    // Tag ALL nodes — videos not in top 50 inherit the fallback cluster
    const fallbackCluster = parsed.clusters?.[0] || { id: 0, name: 'Other', color: 'teal' };
    const taggedNodes = allNodes.map(n => {
      const cluster = clusterMap[n.title.toLowerCase().trim()] || fallbackCluster;
      return {
        ...n,
        cluster_id:    cluster.id,
        cluster_name:  cluster.name,
        cluster_color: cluster.color,
        cluster_hex:   COLORS[cluster.color] || COLORS.teal,
      };
    });

    const result = {
      nodes:     taggedNodes,
      clusters:  parsed.clusters || [],
      edges:     parsed.edges    || [],
      cached_at: new Date().toISOString(),
      total:     allNodes.length,
      clustered: top50.length,
    };

    console.log(`[content-dna/graph] Done — ${taggedNodes.length} nodes tagged across ${result.clusters.length} clusters`);

    // Cache result
    db.setKv('channel_dna_clusters', result);

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Content DNA: Niche + Audience generation (SSE) ──────────────────────────
// POST /api/analytr/content-dna
// Reads cluster data, builds comprehensive prompt, streams Claude analysis.

router.post('/content-dna', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    // Load cluster data from cache or error
    const clusterData = db.getKv('channel_dna_clusters');
    if (!clusterData || !clusterData.nodes?.length) {
      send({ type: 'error', message: 'No cluster data found. Load the Constellation graph first to analyze your content.' });
      res.end(); return;
    }

    const { nodes, clusters } = clusterData;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send({ type: 'error', message: 'ANTHROPIC_API_KEY not set' }); res.end(); return; }

    send({ type: 'status', message: `Analyzing ${nodes.length} videos across ${clusters.length} content clusters...` });

    // Build cluster summaries
    const totalViews = nodes.reduce((s, n) => s + n.views, 0);
    const avgViews   = nodes.length ? Math.round(totalViews / nodes.length) : 0;
    const top10      = [...nodes].sort((a, b) => b.views - a.views).slice(0, 10);

    const clusterSummaries = clusters.map(cluster => {
      const clusterNodes = nodes.filter(n => n.cluster_id === cluster.id);
      const cViews       = clusterNodes.reduce((s, n) => s + n.views, 0);
      const cAvg         = clusterNodes.length ? Math.round(cViews / clusterNodes.length) : 0;
      const topNode      = clusterNodes.sort((a, b) => b.views - a.views)[0];
      return `CLUSTER: ${cluster.name}
Videos: ${clusterNodes.map(n => `"${n.title}"`).join(', ')}
Avg views: ${cAvg.toLocaleString()}
Top performer: "${topNode?.title || 'N/A'}" (${(topNode?.views || 0).toLocaleString()} views)`;
    }).join('\n\n');

    const dnaPrompt = `You are analyzing a YouTube creator's complete content library to define their actual niche and ideal audience avatar.

Channel: 7 Kin Homestead (@7kinhomestead)
Total videos: ${nodes.length}
Total views: ${totalViews.toLocaleString()}
Channel average: ${avgViews.toLocaleString()} views per video

Content clusters identified:
${clusterSummaries}

Top 10 performing videos:
${top10.map(v => `"${v.title}": ${v.views.toLocaleString()} views, ${v.comments} comments`).join('\n')}

Based on this complete picture of their content and what actually performs, generate:

1. NICHE_DEFINITION: One powerful paragraph (4-6 sentences) defining their actual niche. Not what they think their niche is — what the DATA says their niche is. Be specific and insightful. Reference actual content patterns.

2. CONTENT_PILLARS: 5-7 short phrases that describe their core content themes. Each 2-5 words. e.g. ["Financial Escape", "Proof It's Possible", "Real Numbers Only"]

3. AUDIENCE_PROFILE:
   - who_they_are: demographic description (2-3 sentences)
   - what_they_believe: array of 3-4 core beliefs this audience holds
   - what_they_fear: array of 3-4 specific fears
   - why_they_watch: 2-3 sentences on the real reason they watch this creator
   - content_that_converts: array of 4-5 specific content patterns that drive action for this audience

Return ONLY valid JSON matching this exact schema, no markdown, no commentary:
{
  "niche_definition": "...",
  "content_pillars": ["...", "..."],
  "audience_profile": {
    "who_they_are": "...",
    "what_they_believe": ["...", "..."],
    "what_they_fear": ["...", "..."],
    "why_they_watch": "...",
    "content_that_converts": ["...", "..."]
  }
}`;

    const { default: fetch } = await import('node-fetch');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages:   [{ role: 'user', content: dnaPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      throw new Error(`Claude API error ${claudeRes.status}: ${err?.error?.message || ''}`);
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { send({ type: 'error', message: 'Claude returned unexpected format. Try again.' }); res.end(); return; }

    // Cache profile
    db.setKv('channel_dna_profile', parsed);

    send({ type: 'result', data: parsed });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── PATCH creator-profile audience ──────────────────────────────────────────
// PATCH /api/creator-profile/audience
// Updates the audience_profile section in creator-profile.json.

router.patch('/creator-profile-audience', async (req, res) => {
  try {
    const fs   = require('fs');
    const path = require('path');
    const profilePath = path.join(__dirname, '..', '..', 'creator-profile.json');

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const { audience_profile } = req.body;

    if (!audience_profile) {
      return res.status(400).json({ error: 'audience_profile is required' });
    }

    profile.audience_profile = audience_profile;
    profile._audience_updated_at = new Date().toISOString();

    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');

    res.json({ ok: true, updated_at: profile._audience_updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Secrets: hidden pattern analysis (SSE) ──────────────────────────
// POST /api/analytr/content-secrets
// Reads cluster + edge data from kv_store, finds non-obvious patterns via Claude.

router.post('/content-secrets', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const clusterData = db.getKv('channel_dna_clusters');
    if (!clusterData || !clusterData.nodes?.length) {
      send({ type: 'error', message: 'No cluster data found. Load the Constellation graph first.' });
      res.end(); return;
    }

    const { nodes, clusters, edges } = clusterData;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send({ type: 'error', message: 'ANTHROPIC_API_KEY not set' }); res.end(); return; }

    send({ type: 'status', message: `Scanning ${nodes.length} videos across ${clusters.length} clusters for hidden patterns...` });

    const totalViews = nodes.reduce((s, n) => s + n.views, 0);
    const avgViews   = nodes.length ? Math.round(totalViews / nodes.length) : 0;
    const top20      = [...nodes].sort((a, b) => b.views - a.views).slice(0, 20);

    const clustersJson = JSON.stringify(clusters.map(c => {
      const cn = nodes.filter(n => n.cluster_id === c.id);
      return {
        name:        c.name,
        video_count: cn.length,
        avg_views:   Math.round(cn.reduce((s, n) => s + n.views, 0) / (cn.length || 1)),
        top_video:   c.top_video || cn.sort((a, b) => b.views - a.views)[0]?.title || '',
      };
    }), null, 2);

    const edgesJson = JSON.stringify(
      (edges || []).slice(0, 20).map(e => ({ source: e.source, target: e.target, reason: e.reason })),
      null, 2
    );

    const top20Lines = top20.map(v => `"${v.title}": ${v.views.toLocaleString()} views`).join('\n');

    const secretsPrompt = `You are analyzing a YouTube creator's complete content universe.
You have access to their video clusters, cross-cluster connections, and performance data.

Clusters:
${clustersJson}

Cross-cluster connections Claude identified:
${edgesJson}

Top 20 performers:
${top20Lines}

Channel average: ${avgViews.toLocaleString()} views

Find 5-7 non-obvious insights that a human creator would never notice from inside their own work. Think like an anthropologist studying an artifact, not a YouTube coach giving generic advice.

Examples of the kind of insight we want:
- "Your financial content and your failure/mistake content are secretly the same video — both give your audience permission to try something scary. That's why they cross-perform."
- "You have never made a video that combines solar + financial angle even though those are your two strongest clusters. That video doesn't exist yet and it should."
- "Your audience engagement peaks on videos where the title contains a negative number or admits failure. They trust you more when you're losing."

Return ONLY a valid JSON array, no markdown, no commentary:
[
  {
    "title": "short punchy name for this insight",
    "insight": "2-3 sentence explanation",
    "implication": "one specific action to take based on this",
    "type": "pattern|gap|opportunity|warning"
  }
]`;

    const { default: fetch } = await import('node-fetch');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages:   [{ role: 'user', content: secretsPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      throw new Error(`Claude API error ${claudeRes.status}: ${err?.error?.message || ''}`);
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { send({ type: 'error', message: 'Claude returned unexpected format. Try again.' }); res.end(); return; }

    db.setKv('channel_dna_secrets', parsed);
    send({ type: 'result', data: parsed });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

module.exports = router;
