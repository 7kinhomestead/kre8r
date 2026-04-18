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
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { getCreatorContext } = require('../utils/creator-context');
const { callClaude }        = require('../utils/claude');

// ─── Video format helpers ──────────────────────────────────────────────────────

function classifyFormat(isoDuration) {
  if (!isoDuration) return 'longform';
  const m = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 'longform';
  const total = (parseInt(m[1] || 0)) * 3600 + (parseInt(m[2] || 0)) * 60 + (parseInt(m[3] || 0));
  if (total === 0)   return 'live';
  if (total < 60)    return 'short';
  if (total < 180)   return 'micro';
  if (total < 600)   return 'standard';
  return 'longform';
}

function parseDurationSeconds(isoDuration) {
  if (!isoDuration) return null;
  const m = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || 0)) * 3600 + (parseInt(m[2] || 0)) * 60 + (parseInt(m[3] || 0));
}

// Deterministically identifies live stream / junk titles that never go to Claude.
function isLiveStream(title) {
  if (!title) return false;
  const t     = title.toLowerCase().trim();
  const brand = (getCreatorContext().brand || '').toLowerCase();
  if (t === brand)                          return true;
  if (t.includes('is live'))               return true;
  if (t.includes('livestream'))            return true;
  if (t.includes('live stream'))           return true;
  if (brand && t.startsWith(brand + ' is')) return true;
  return false;
}

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
    const allVideos   = db.getRecentProjectsWithAnalytics(30);
    const fmtMapCoach = db.getYouTubeFormats();
    // Filter to longform + standard; fall back to all if none classified yet
    const longformVids = allVideos.filter(v => {
      const f = fmtMapCoach[v.id]?.format;
      return !f || f === 'longform' || f === 'standard';
    });
    const videos = (longformVids.length > 0 ? longformVids : allVideos).slice(0, 10);
    const health = db.getGlobalChannelHealth();
    const shortsFiltered = longformVids.length > 0 && allVideos.length > longformVids.length;

    if (videos.length === 0) {
      send({ type: 'error', message: 'No video data yet. Add analytics data for your videos first.' });
      res.end();
      return;
    }

    send({ type: 'status', message: 'Analyzing your last ' + videos.length + ' long-form videos...' });

    const avgViews  = health.avg_views || 0;
    const bestVideo = health.best_video;

    const videoList = videos.map(v =>
      `- "${v.title}": ${v.total_views ? Number(v.total_views).toLocaleString() : 0} views, ${v.total_likes ? Number(v.total_likes).toLocaleString() : 0} likes, ${v.total_comments ? Number(v.total_comments).toLocaleString() : 0} comments`
    ).join('\n');

    const { brand: mCoachBrand, creatorName: mCoachCn, followerSummary: mCoachFs, voiceSummary: mCoachVoice, contentAnglesText: mCoachAngles } = getCreatorContext();

    const prompt = `You are a supportive creative director coaching ${mCoachCn} at ${mCoachBrand} — ${mCoachFs}. Voice: ${mCoachVoice}. Content angles: ${mCoachAngles.replace(/\n/g, ', ')}.

${shortsFiltered ? `NOTE: Analysis based on ${videos.length} long-form videos (Shorts excluded from averages).\n\n` : ''}Here are the ${videos.length} most recent YouTube videos with performance data:
${videoList}

Channel average is ${Number(avgViews).toLocaleString()} views per video.
Best performing video is ${bestVideo ? `"${bestVideo.title}" with ${Number(bestVideo.views).toLocaleString()} views` : 'not yet determined'}.
Total all-time views: ${Number(health.total_views).toLocaleString()}.

Give ${mCoachCn}:
1. 3 specific things working well based on actual data — reference real video titles
2. 3 specific things to improve — specific and actionable, not generic
3. #1 focus for this week — one concrete thing to do or make
4. 2-3 trending topics the audience would love based on content themes
5. One encouraging note about the channel trajectory — warm, direct, no fluff, in the creator's voice
6. On-camera performance feedback — based on engagement patterns, comment counts, and video topics, give genuine constructive feedback. Consider:
   - Are high-comment videos ones where the creator is more personal/vulnerable?
   - Do tutorial-style videos perform differently than story-driven ones?
   - What does the data suggest about energy, pacing, or delivery?
   - What's one specific on-camera habit to work on?
   Be a great director — honest, specific, kind but not soft.

Be specific, use actual video titles, be encouraging not brutal.

Respond in exactly this JSON structure (no markdown, no commentary, just JSON):
{
  "working_well": ["point 1", "point 2", "point 3"],
  "improve": ["point 1", "point 2", "point 3"],
  "focus_this_week": "One specific, concrete, actionable thing to do or make this week.",
  "trending_topics": ["topic 1", "topic 2", "topic 3"],
  "coaching_note": "2-3 sentences. Warm, direct, in the creator's tone.",
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

// ─── TikTok Pattern Analysis (SSE) ───────────────────────────────────────────
// Reads all non-#onthisday TikTok posts, asks Claude to surface what actually
// works in original content, and stores the result in kv_store for NorthΩr.

router.post('/tiktok-patterns', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const posts = db.getTikTokPostsForAnalysis();

    if (posts.length < 2) {
      send({ type: 'error', message: 'Not enough original TikTok content yet. Import a TikTok CSV first.' });
      res.end();
      return;
    }

    send({ type: 'status', message: `Analyzing ${posts.length} original TikTok video${posts.length !== 1 ? 's' : ''}…` });

    const { creatorName, brand, followerSummary, voiceSummary } = getCreatorContext();

    // Build a compact data block for Claude
    const postLines = posts.map((p, i) => {
      const caption = (p.content || '').slice(0, 180).replace(/\s+/g, ' ').trim();
      const shares  = p.shares > 0 ? `, ${Number(p.shares).toLocaleString()} shares` : '';
      return `${i + 1}. "${caption}" — ${Number(p.views).toLocaleString()} views, ${Number(p.likes).toLocaleString()} likes, ${Number(p.comments).toLocaleString()} comments${shares}`;
    }).join('\n');

    const totalViews = posts.reduce((s, p) => s + (p.views || 0), 0);
    const avgViews   = Math.round(totalViews / posts.length);
    const topVideo   = posts[0];

    const prompt = `You are analyzing the TikTok content library of ${creatorName} at ${brand} — ${followerSummary}.

This is ALL their ORIGINAL TikTok content (reposts/on-this-day content already excluded). You are looking at what actually gets traction in their original work.

ORIGINAL TIKTOK CONTENT (${posts.length} videos, sorted by views):
${postLines}

Channel average: ${Number(avgViews).toLocaleString()} views per original video
Best performer: "${(topVideo.content || '').slice(0, 100)}" with ${Number(topVideo.views).toLocaleString()} views

Analyze what patterns make the high-performing videos work versus the lower-performers. Focus on:
- Topic/angle patterns (what subjects resonate vs what doesn't)
- Title/caption structure that drives clicks (emotional hook, question, controversy, identity)
- Audience psychology (what feeling does the content trigger — aspiration, anger, curiosity, relief?)
- What the data tells us about the TikTok audience specifically vs their YouTube audience

Be specific. Reference actual video captions. Don't recommend generic creator tips.

Return ONLY valid JSON — no markdown, no commentary:
{
  "video_count": ${posts.length},
  "avg_views": ${avgViews},
  "top_patterns": ["pattern with evidence from titles", "pattern 2", "pattern 3"],
  "what_works": ["specific thing working with example title", "thing 2 with example"],
  "what_doesnt": ["specific thing underperforming with evidence"],
  "audience_psychology": "1-2 sentences on what emotional/identity trigger drives TikTok engagement for this creator specifically",
  "content_direction": "2-3 sentences: given this data, what original TikTok content should this creator make going forward? Be specific about angle, not just topic.",
  "analyzed_at": "${new Date().toISOString()}"
}`;

    const raw = await callClaude(prompt, 1500);

    // callClaude already strips fences — try to parse as JSON
    let patterns;
    try {
      patterns = typeof raw === 'object' ? raw : JSON.parse(raw);
    } catch {
      send({ type: 'error', message: 'Claude returned unexpected format. Try again.' });
      res.end();
      return;
    }

    // Persist to kv_store so NorthΩr can use it
    try { db.setKv('tiktok_content_patterns', JSON.stringify(patterns)); } catch (_) {}

    send({ type: 'patterns', data: patterns });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── TikTok Pattern Analysis — get stored result ─────────────────────────────
router.get('/tiktok-patterns', (req, res) => {
  try {
    const stored = db.getKv('tiktok_content_patterns');
    if (!stored) return res.json({ patterns: null });
    let patterns = null;
    try { patterns = JSON.parse(stored); } catch (_) {}
    res.json({ patterns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── YouTube Sync — background job runner ────────────────────────────────────
// Runs detached from any HTTP connection. Writes progress to background_jobs table.
// Client connects to /jobs/:id/stream to watch progress.

async function runYoutubeSyncJob(jobId) {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) { db.failJob(jobId, 'YOUTUBE_API_KEY not set in .env'); return; }

    const projects = db.getAllProjects();
    const withYT   = projects.filter(p => p.youtube_video_id);
    if (withYT.length === 0) { db.failJob(jobId, 'No projects with YouTube IDs found'); return; }

    const { default: fetch } = await import('node-fetch');
    const total = withYT.length;
    let synced = 0, failed = 0;

    // Backfill: classify format for posts that don't have it yet
    const formatMap   = db.getYouTubeFormats();
    const needsFormat = withYT.filter(p => !formatMap[p.id]?.format);
    if (needsFormat.length > 0) {
      const fmtIds = needsFormat.map(p => p.youtube_video_id);
      for (let i = 0; i < fmtIds.length; i += 50) {
        const batch    = fmtIds.slice(i, i + 50);
        const batchUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(batch.join(','))}&key=${apiKey}`;
        const batchRes = await fetch(batchUrl);
        if (batchRes.ok) {
          const batchData = await batchRes.json();
          for (const item of batchData.items || []) {
            const p   = needsFormat.find(x => x.youtube_video_id === item.id);
            if (!p) continue;
            const iso = item.contentDetails?.duration || null;
            const posts  = db.getPostsByProject(p.id);
            const ytPost = posts.find(x => x.platform === 'youtube');
            if (ytPost) db.updatePostFormat(ytPost.id, classifyFormat(iso), parseDurationSeconds(iso));
          }
        }
        if (i + 50 < fmtIds.length) await new Promise(r => setTimeout(r, 200));
      }
    }

    for (let i = 0; i < total; i++) {
      const project = withYT[i];
      db.updateJobProgress(jobId, { progress: i, total, ok: synced, errors: failed });
      try {
        const ytUrl  = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${encodeURIComponent(project.youtube_video_id)}&key=${apiKey}`;
        const ytRes  = await fetch(ytUrl);
        if (!ytRes.ok) { const e = await ytRes.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${ytRes.status}`); }
        const ytData = await ytRes.json();
        const item   = ytData.items?.[0];
        if (!item) { failed++; continue; }

        const posts   = db.getPostsByProject(project.id);
        let   ytPost  = posts.find(p => p.platform === 'youtube');
        const durIso  = item.contentDetails?.duration || null;
        const durFmt  = classifyFormat(durIso);
        const durSecs = parseDurationSeconds(durIso);

        if (!ytPost) {
          const postId = db.savePost({ project_id: project.id, platform: 'youtube',
            url: `https://www.youtube.com/watch?v=${project.youtube_video_id}`,
            content: project.title, status: 'posted',
            posted_at: item.snippet?.publishedAt || new Date().toISOString(),
            format: durFmt, duration_seconds: durSecs });
          ytPost = { id: postId };
        } else if (!ytPost.format && durFmt) {
          db.updatePostFormat(ytPost.id, durFmt, durSecs);
        }

        const metricsMap = {
          views:         parseInt(item.statistics.viewCount)    || 0,
          likes:         parseInt(item.statistics.likeCount)    || 0,
          comment_count: parseInt(item.statistics.commentCount) || 0,
        };
        for (const [name, value] of Object.entries(metricsMap)) {
          db.upsertMetric(ytPost.id, project.id, 'youtube', name, value);
        }
        synced++;
      } catch (err) {
        console.error(`[youtube-sync job ${jobId}] "${project.title}":`, err.message);
        failed++;
      }
      db.updateJobProgress(jobId, { progress: i + 1, total, ok: synced, errors: failed });
      await new Promise(r => setTimeout(r, 300)); // gentle API pacing
    }

    const syncedAt = new Date().toISOString();
    db.setKv('mirrr_last_sync', syncedAt);
    db.finishJob(jobId, { ok: synced, errors: failed, total, result: { synced_at: syncedAt } });
  } catch (err) {
    console.error(`[youtube-sync job ${jobId}] fatal:`, err.message);
    db.failJob(jobId, err.message);
  }
}

// ─── POST /api/mirrr/youtube-sync ────────────────────────────────────────────
// Starts a background sync job. Returns { job_id } immediately.
// If already running, returns the existing job (no duplicate).

router.post('/youtube-sync', (req, res) => {
  try {
    const existing = db.getActiveJobByType('youtube-sync');
    if (existing) return res.json({ job_id: existing.id, resumed: true });
    const job = db.createJob('youtube-sync');
    runYoutubeSyncJob(job.id); // fire and forget
    res.json({ job_id: job.id, resumed: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Meta Sync — background job runner ───────────────────────────────────────
// Pulls insights for all published FB/IG posts from the Meta Graph API and
// stores them in the analytics table (same schema as YouTube metrics).
//
// Facebook video: /{video_id}/video_insights → views, avg_watch_time, reactions
// Facebook post:  /{post_id}/insights        → reach, engaged_users, reactions
// Instagram Reel: /{media_id}/insights       → views, reach, likes, comment_count,
//                                              shares, saves
//
// Requires instagram_manage_insights permission for IG. If missing, the job
// continues (Facebook still syncs), sets meta_ig_insights_missing KV flag,
// and reports the gap in the result.

async function runMetaSyncJob(jobId) {
  try {
    const { default: fetch } = await import('node-fetch');

    const fbConn        = db.getPostorConnection('facebook');
    const igInsightsToken = db.getKv('ig_insights_token'); // Facebook-Login token with instagram_manage_insights

    if (!fbConn && !igInsightsToken) {
      db.failJob(jobId, 'No Meta platforms connected — connect Facebook in PostΩr and/or add an Instagram Insights token in MirrΩr');
      return;
    }

    const posts = db.getMetaSyncablePosts();
    if (posts.length === 0) {
      db.finishJob(jobId, { ok: 0, errors: 0, total: 0, result: { synced_at: new Date().toISOString(), message: 'No published Meta posts found yet' } });
      return;
    }

    const GRAPH  = 'https://graph.facebook.com/v21.0';
    const total  = posts.length;
    let synced = 0, failed = 0, igPermError = false;

    for (let i = 0; i < total; i++) {
      const post = posts[i];
      db.updateJobProgress(jobId, { progress: i, total, ok: synced, errors: failed });
      try {
        const analyticsRowId = db.bridgeMetaPost(post);
        const projectId      = post.project_id || null;

        if (post.platform === 'facebook') {
          // ── Facebook video insights ───────────────────────────────────────
          // postor_posts.post_id for facebook = video object ID from
          // POST /{pageId}/videos. Use video_insights edge (video objects only).
          // If the video has no views yet the API may return empty data — that's
          // fine, we just skip it rather than counting it as an error.
          if (!fbConn) { failed++; continue; }
          const url  = `${GRAPH}/${post.post_id}/video_insights?metric=total_video_views,total_video_avg_time_watched,total_video_reactions_by_type_total&access_token=${fbConn.access_token}`;
          const res  = await fetch(url);
          const data = await res.json();
          // Gracefully skip if no insights yet (video too new / no views)
          if (data.error) {
            const msg = data.error.message || '';
            if (data.error.code === 100 || msg.includes('nonexisting field') || msg.includes('does not exist')) {
              synced++; // treat as "synced with zero data" — not a failure
              continue;
            }
            throw new Error(`FB video insights: ${msg}`);
          }

          const FB_VIDEO_MAP = {
            total_video_views:                  'views',
            total_video_avg_time_watched:        'avg_watch_time',
            total_video_reactions_by_type_total: 'reactions',
          };
          for (const metric of (data.data || [])) {
            const name = FB_VIDEO_MAP[metric.name];
            if (!name) continue;
            const raw    = metric.values?.[0]?.value ?? metric.value;
            if (raw == null) continue;
            const numVal = typeof raw === 'object'
              ? Object.values(raw).reduce((a, b) => a + (Number(b) || 0), 0)
              : Number(raw);
            db.upsertMetric(analyticsRowId, projectId, 'facebook', name, numVal);
          }
          synced++;

        } else if (post.platform === 'facebook_post') {
          // ── Facebook feed/image post insights ────────────────────────────
          if (!fbConn) { failed++; continue; }
          const url  = `${GRAPH}/${post.post_id}/insights?metric=post_impressions_unique,post_engaged_users,post_reactions_by_type_total&period=lifetime&access_token=${fbConn.access_token}`;
          const res  = await fetch(url);
          const data = await res.json();
          if (data.error) throw new Error(`FB post insights: ${data.error.message}`);

          const FB_POST_MAP = {
            post_impressions_unique:      'reach',
            post_engaged_users:           'engaged_users',
            post_reactions_by_type_total: 'reactions',
          };
          for (const metric of (data.data || [])) {
            const name = FB_POST_MAP[metric.name];
            if (!name) continue;
            const raw    = metric.values?.[0]?.value ?? metric.value;
            if (raw == null) continue;
            const numVal = typeof raw === 'object'
              ? Object.values(raw).reduce((a, b) => a + (Number(b) || 0), 0)
              : Number(raw);
            db.upsertMetric(analyticsRowId, projectId, 'facebook_post', name, numVal);
          }
          synced++;

        } else if (post.platform === 'instagram') {
          // ── Instagram Reels insights ──────────────────────────────────────
          // Uses the Facebook-Login token (ig_insights_token KV) which has
          // instagram_manage_insights. Endpoint is graph.facebook.com — the
          // Instagram Business Login token (graph.instagram.com) does NOT
          // support the insights API per Meta's own dashboard notice.
          if (!igInsightsToken) {
            igPermError = true;
            failed++;
            continue;
          }
          // graph.instagram.com (same API space as publishing) — the media IDs
          // from the new Instagram Platform are NOT visible to graph.facebook.com.
          const url  = `https://graph.instagram.com/${post.post_id}/insights?metric=plays,reach,likes,comments,shares,saved&period=lifetime&access_token=${igInsightsToken}`;
          const res  = await fetch(url);
          const data = await res.json();

          if (data.error) {
            if (data.error.type === 'OAuthException' || data.error.code === 10 || data.error.code === 200) {
              igPermError = true;
              db.setKv('meta_ig_insights_missing', '1');
              failed++;
              continue;
            }
            throw new Error(`IG insights: ${data.error.message}`);
          }

          const IG_MAP = {
            plays:    'views',
            reach:    'reach',
            likes:    'likes',
            comments: 'comment_count',
            shares:   'shares',
            saved:    'saves',
          };
          for (const metric of (data.data || [])) {
            const name   = IG_MAP[metric.name];
            const raw    = metric.values?.[0]?.value ?? metric.value;
            if (!name || raw == null) continue;
            db.upsertMetric(analyticsRowId, projectId, 'instagram', name, Number(raw));
          }
          // Clear stale perm-error flag if we got real data
          db.setKv('meta_ig_insights_missing', '0');
          synced++;
        }
      } catch (err) {
        const label = post.title || post.description || post.post_id;
        console.error(`[meta-sync job ${jobId}] "${label}":`, err.message);
        failed++;
      }
      db.updateJobProgress(jobId, { progress: i + 1, total, ok: synced, errors: failed });
      await new Promise(r => setTimeout(r, 300)); // gentle API pacing
    }

    const syncedAt = new Date().toISOString();
    db.setKv('meta_last_sync', syncedAt);
    db.finishJob(jobId, {
      ok: synced, errors: failed, total,
      result: { synced_at: syncedAt, ig_perm_error: igPermError },
    });
  } catch (err) {
    console.error(`[meta-sync job ${jobId}] fatal:`, err.message);
    db.failJob(jobId, err.message);
  }
}

// ─── POST /api/mirrr/meta-sync ───────────────────────────────────────────────
router.post('/meta-sync', (req, res) => {
  try {
    const existing = db.getActiveJobByType('meta-sync');
    if (existing) return res.json({ job_id: existing.id, resumed: true });
    const job = db.createJob('meta-sync');
    runMetaSyncJob(job.id); // fire and forget
    res.json({ job_id: job.id, resumed: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/mirrr/meta-status ──────────────────────────────────────────────
router.get('/meta-status', (req, res) => {
  try {
    const fbConn          = db.getPostorConnection('facebook');
    const igConn          = db.getPostorConnection('instagram');
    const lastSync        = db.getKv('meta_last_sync');
    const igPerm          = db.getKv('meta_ig_insights_missing');
    const igInsightsToken = db.getKv('ig_insights_token');
    const posts           = db.getMetaSyncablePosts();
    res.json({
      last_sync:              lastSync || null,
      fb_connected:           !!(fbConn?.access_token),
      ig_connected:           !!(igConn?.access_token),
      ig_insights_token_set:  !!igInsightsToken,
      ig_insights_missing:    !igInsightsToken || igPerm === '1',
      syncable_post_count:    posts.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/mirrr/ig-insights-token ───────────────────────────────────────
// Stores the Facebook-Login access token (with instagram_manage_insights scope)
// used exclusively for reading Instagram Reels analytics.
// Body: { token: string }
router.post('/ig-insights-token', (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      return res.status(400).json({ error: 'token required' });
    }
    db.setKv('ig_insights_token', token.trim());
    db.setKv('meta_ig_insights_missing', '0'); // clear the warning flag
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/mirrr/ig-insights-token ─────────────────────────────────────
router.delete('/ig-insights-token', (req, res) => {
  try {
    db.setKv('ig_insights_token', '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/mirrr/meta-debug ───────────────────────────────────────────────
// Hits the Graph API for the first syncable Meta post and returns the raw
// response so we can see exactly what the API is saying.
router.get('/meta-debug', async (req, res) => {
  try {
    const { default: fetch } = await import('node-fetch');
    const GRAPH           = 'https://graph.facebook.com/v21.0';
    const igInsightsToken = db.getKv('ig_insights_token');
    const fbConn          = db.getPostorConnection('facebook');
    const posts           = db.getMetaSyncablePosts();

    const results = [];
    for (const post of posts.slice(0, 3)) {
      let url, token;
      if (post.platform === 'instagram') {
        token = igInsightsToken;
        url   = `https://graph.instagram.com/${post.post_id}/insights?metric=plays,reach,likes,comments,shares,saved&period=lifetime&access_token=${token || 'NOT_SET'}`;
      } else if (post.platform === 'facebook') {
        token = fbConn?.access_token;
        url   = `${GRAPH}/${post.post_id}/insights?metric=post_impressions_unique,post_video_views,post_engaged_users&period=lifetime&access_token=${token || 'NOT_SET'}`;
      } else {
        token = fbConn?.access_token;
        url   = `${GRAPH}/${post.post_id}/insights?metric=post_impressions_unique,post_engaged_users&period=lifetime&access_token=${token || 'NOT_SET'}`;
      }
      const r    = await fetch(url);
      const data = await r.json();
      results.push({
        platform: post.platform,
        post_id:  post.post_id,
        title:    post.title || post.description || '(no title)',
        posted_at: post.posted_at,
        has_token: !!token,
        status:   r.status,
        response: data,
      });
    }
    res.json({ posts_checked: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/mirrr/jobs/active/:type ────────────────────────────────────────
router.get('/jobs/active/:type', (req, res) => {
  try {
    res.json(db.getActiveJobByType(req.params.type) || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/mirrr/jobs/:id ──────────────────────────────────────────────────
router.get('/jobs/:id', (req, res) => {
  try {
    const job = db.getJob(parseInt(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/mirrr/jobs/:id/stream ──────────────────────────────────────────
// Reconnectable SSE stream for any MirrΩr background job.

router.get('/jobs/:id/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const jobId = parseInt(req.params.id);
  const send  = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  const poll = setInterval(async () => {
    try {
      const job = db.getJob(jobId);
      if (!job) { clearInterval(poll); send({ type: 'error', message: 'Job not found' }); res.end(); return; }
      if (job.status === 'running' || job.status === 'pending') {
        send({ type: 'progress', progress: job.progress, total: job.total, ok: job.ok, errors: job.errors,
               message: `Syncing… ${job.progress} / ${job.total} (${job.ok} updated, ${job.errors} failed)` });
      } else if (job.status === 'done') {
        clearInterval(poll);
        const result = job.result || {};
        send({ type: 'done', synced: job.ok, failed: job.errors, synced_at: result.synced_at,
               message: `Sync complete. ${job.ok} updated, ${job.errors} failed.` });
        res.end();
      } else if (job.status === 'error') {
        clearInterval(poll);
        send({ type: 'error', message: job.error });
        res.end();
      }
    } catch (e) { clearInterval(poll); send({ type: 'error', message: e.message }); res.end(); }
  }, 1500);

  req.on('close', () => clearInterval(poll));
});

// ─── GET /api/mirrr/cached-results ───────────────────────────────────────────
// Returns whatever DNA analysis + secrets results are already in kv_store.
// Used by the frontend on load to auto-display without re-running analysis.

router.get('/cached-results', (req, res) => {
  try {
    const profile  = db.getKv('channel_dna_profile');
    const secrets  = db.getKv('channel_dna_secrets');
    const lastSync = db.getKv('mirrr_last_sync');
    res.json({
      has_profile:  !!profile,
      has_secrets:  !!secrets,
      profile:      profile  || null,
      secrets:      secrets  || null,
      last_sync:    lastSync || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Import Status ────────────────────────────────────────────────────────────
// GET /api/analytr/import-status
// Returns whether the channel has already been bulk-imported.

router.get('/import-status', (req, res) => {
  try {
    const count = db.countImportedProjects();
    res.json({ imported_count: count, is_imported: count > 20 });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // Guard: block re-import if channel already imported (bypass with force:true)
    const forceResync    = req.body?.force === true;
    const importedCount  = db.countImportedProjects();
    if (importedCount > 20 && !forceResync) {
      send({
        type:    'error',
        reason:  'already_imported',
        count:   importedCount,
        message: `Channel already imported (${importedCount} videos). Use Sync YouTube Data to update stats, or Force Resync to prune unlisted videos.`,
      });
      res.end(); return;
    }
    if (forceResync) {
      send({ type: 'status', message: `Force resync — re-importing channel and archiving any unlisted/private videos…` });
    }

    // Handle from env or creator-profile.json — no @ prefix (YouTube forHandle param doesn't need it)
    const channelHandle = process.env.YOUTUBE_CHANNEL_HANDLE || getCreatorContext().youtubeHandle;

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

    // ── Step 3: Fetch stats + contentDetails in batches of 50 ───────────────
    const allStats     = {}; // videoId → statistics
    const allDurations = {}; // videoId → { isoDuration, seconds, format }
    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch    = allVideoIds.slice(i, i + 50);
      const ids      = batch.join(',');
      const statUrl  = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${encodeURIComponent(ids)}&key=${apiKey}`;
      const statRes  = await fetch(statUrl);
      const statData = await statRes.json();

      if (!statRes.ok) {
        send({ type: 'warn', message: `Stats batch error: ${statData?.error?.message || statRes.status}` });
        continue;
      }

      for (const item of statData.items || []) {
        allStats[item.id] = item.statistics;
        // Parse duration for format classification
        const iso  = item.contentDetails?.duration || null;
        allDurations[item.id] = {
          isoDuration: iso,
          seconds:     parseDurationSeconds(iso),
          format:      classifyFormat(iso),
        };
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
          const durInfo = allDurations[videoId] || {};
          if (!ytPost) {
            const postId = db.savePost({
              project_id:      existing.id,
              platform:        'youtube',
              url:             `https://www.youtube.com/watch?v=${videoId}`,
              content:         meta.title,
              status:          'posted',
              posted_at:       meta.publishedAt || new Date().toISOString(),
              thumbnail_url:   meta.thumbnailUrl || null,
              format:          durInfo.format   || null,
              duration_seconds: durInfo.seconds  || null,
            });
            ytPost = { id: postId };
          } else if (!ytPost.format && durInfo.format) {
            // Backfill format on existing post
            db.updatePostFormat(ytPost.id, durInfo.format, durInfo.seconds || null);
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
        const durInfo = allDurations[videoId] || {};

        // Create project (mark as youtube_import so it stays out of production tool dropdowns)
        const project = db.createProject(meta.title, desc, ytUrl, videoId);
        db.setProjectSource(project.id, 'youtube_import');

        // Create YouTube post record (with format classification)
        const postId = db.savePost({
          project_id:      project.id,
          platform:        'youtube',
          url:             ytUrl,
          content:         meta.title,
          status:          'posted',
          posted_at:       meta.publishedAt || new Date().toISOString(),
          thumbnail_url:   meta.thumbnailUrl || null,
          format:          durInfo.format   || null,
          duration_seconds: durInfo.seconds  || null,
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

    // ── Prune step: archive youtube_import projects no longer on the channel ──
    let pruned = 0;
    if (forceResync) {
      const currentIds  = new Set(allVideoIds);
      const allImported = db.getAllProjects().filter(p => p.source === 'youtube_import' && p.youtube_video_id);
      const toArchive   = allImported.filter(p => !currentIds.has(p.youtube_video_id));
      if (toArchive.length > 0) {
        db.bulkArchiveProjects(toArchive.map(p => p.id));
        pruned = toArchive.length;
        send({ type: 'status', message: `Pruned ${pruned} unlisted/private video${pruned !== 1 ? 's' : ''} from your channel data.` });
        // Invalidate DNA cache so Content Universe + Secrets rebuild without archived videos
        db.setKv('channel_dna_clusters', null);
        db.setKv('channel_dna_secrets',  null);
        db.setKv('channel_dna_secrets_video_count', 0);
        send({ type: 'status', message: `Content Universe cache cleared — open MirrΩr to rebuild.` });
      }
    }

    send({
      type: 'done',
      message: `Import complete — ${imported} imported, ${skipped} already existed, ${failed} failed${pruned > 0 ? `, ${pruned} pruned` : ''}.`,
      imported,
      skipped,
      failed,
      pruned,
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

    const { brand: mThumbBrand, followerSummary: mThumbFs, niche: mThumbNiche } = getCreatorContext();

    const prompt = `You are a YouTube thumbnail expert specializing in ${mThumbNiche} content for ${mThumbBrand} (${mThumbFs}). Best-performing thumbnails follow this formula:
- Authentic emotion on the creator's face (surprise, pride, exasperation, delight)
- Bold readable numbers or short text (3-5 words max)
- Natural outdoor backgrounds
- High contrast, warm tones
- Feels real, not polished — the anti-stock-photo${contextLine}

You are comparing Thumbnail A vs Thumbnail B.

Score EACH thumbnail on these 5 dimensions (0–10 each):
1. emotional_hook — Does the facial expression / image provoke immediate emotion?
2. text_readability — Is the text bold, legible, and fast to read at thumbnail size?
3. visual_clarity — Is the composition clean and uncluttered?
4. click_worthiness — Would a casual scroller stop and click THIS?
5. brand_fit — Does it feel like ${mThumbBrand} — authentic, real, not corporate?

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
  console.log('[mirrr/content-dna/graph] Hit — refresh:', !!req.query.refresh);
  try {
    // Return cached result if fresh (< 24 h) and no ?refresh=1
    if (!req.query.refresh) {
      const cached = db.getKv('channel_dna_clusters');
      if (cached) {
        const age = cached.cached_at ? Date.now() - new Date(cached.cached_at).getTime() : Infinity;
        if (age < CACHE_TTL_MS) {
          console.log('[mirrr/content-dna/graph] Serving from cache (age: ' + Math.round(age / 60000) + ' min)');
          return res.json(cached);
        }
        console.log('[mirrr/content-dna/graph] Cache stale — regenerating');
      } else {
        console.log('[mirrr/content-dna/graph] No cache found — generating');
      }
    }

    // Get all youtube projects with analytics — exclude archived (pruned/unlisted)
    const allProjects = db.getAllProjects();
    const ytProjects  = allProjects.filter(p => p.youtube_video_id && p.status !== 'archived');

    if (ytProjects.length === 0) {
      return res.json({ nodes: [], clusters: [], error: 'no_videos' });
    }

    // Get format map for all projects (one query, no N+1)
    const fmtMap = db.getYouTubeFormats(); // { projectId: {format, duration_seconds} }

    // Attach analytics + format to ALL projects
    const allNodes = ytProjects.map(p => {
      const analytics = db.getAnalyticsByProject(p.id);
      const views    = analytics.find(m => m.metric_name === 'views')?.metric_value         || 0;
      const likes    = analytics.find(m => m.metric_name === 'likes')?.metric_value         || 0;
      const comments = analytics.find(m => m.metric_name === 'comment_count')?.metric_value || 0;
      const fmt      = fmtMap[p.id]?.format || 'longform'; // default longform if unclassified
      return {
        id:               p.id,
        title:            p.title,
        views:            Number(views),
        likes:            Number(likes),
        comments:         Number(comments),
        format:           fmt,
        duration_seconds: fmtMap[p.id]?.duration_seconds || null,
        youtube_url:      p.youtube_url || (p.youtube_video_id ? `https://www.youtube.com/watch?v=${p.youtube_video_id}` : null),
      };
    });

    // For Claude clustering: longform + standard only (Shorts skew the topic analysis)
    const longformNodes = allNodes.filter(n => n.format === 'longform' || n.format === 'standard');

    // Send only top 50 longform/standard by view count to Claude — fast + token-safe
    const top50 = [...longformNodes].sort((a, b) => b.views - a.views).slice(0, 50);
    console.log(`[mirrr/content-dna/graph] Sending top ${top50.length} of ${allNodes.length} videos to Claude for clustering`);

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
      console.error('[mirrr/content-dna/graph] JSON parse failed:', parseErr.message);
      console.error('[mirrr/content-dna/graph] Raw response (first 500):', rawText.slice(0, 500));
      return res.status(500).json({ error: 'Claude returned unexpected format', raw: rawText.slice(0, 200) });
    }

    const COLORS = {
      teal: '#3ecfb2', amber: '#f0b942', coral: '#e05c5c',
      purple: '#a78bfa', green: '#5cba8a', blue: '#5b9cf6',
      orange: '#f0834a', rose: '#f06b9e',
    };

    // ── Live stream cluster (deterministic, never sent to Claude) ────────────
    const LIVE_CLUSTER = { id: 999, name: 'Live Streams', color: 'rose', top_video: '', videos: [] };

    // ── Build initial clusterMap from first-pass top-50 results ─────────────
    const clusterMap = {};
    for (const cluster of parsed.clusters || []) {
      for (const title of cluster.videos || []) {
        clusterMap[title.toLowerCase().trim()] = cluster;
      }
    }

    const fallbackCluster = parsed.clusters?.[0] || { id: 0, name: 'Other', color: 'teal' };

    // Nodes that need second-pass classification:
    //   • NOT in the top-50 already clustered by Claude
    //   • NOT a live stream (those are pre-classified deterministically)
    const top50Ids         = new Set(top50.map(n => n.id));
    const remainingNonLive = allNodes.filter(n => !top50Ids.has(n.id) && !isLiveStream(n.title));
    const hasLiveVideos    = allNodes.some(n => isLiveStream(n.title));

    // ── Second pass: Claude classifies every remaining video ─────────────────
    if (remainingNonLive.length > 0) {
      console.log(`[mirrr/content-dna/graph] Second pass: classifying ${remainingNonLive.length} remaining videos`);

      const clusterDefs = (parsed.clusters || [])
        .map(c => `CLUSTER ${c.id} — ${c.name}: exemplified by "${(c.videos || []).slice(0, 3).join('", "')}"`)
        .join('\n');

      const BATCH_SIZE = 80;
      for (let i = 0; i < remainingNonLive.length; i += BATCH_SIZE) {
        const batch      = remainingNonLive.slice(i, i + BATCH_SIZE);
        const titleLines = batch.map((v, idx) => `${idx + 1}. ${v.title}`).join('\n');

        const classifyPrompt =
`Here are ${(parsed.clusters || []).length} content clusters with their defining characteristics:
${clusterDefs}

Classify each of these video titles into the single best cluster.
Be strict — if a video is clearly a build series episode, put it in the build cluster not financial.
If a title starts with a number like "Part 10:" it's almost certainly a series episode.
Live streams (title contains "is live" or "livestream") → always classify as cluster 999.

Titles to classify:
${titleLines}

Return ONLY a JSON object mapping list number to cluster id, no markdown, no commentary:
{ "1": cluster_id, "2": cluster_id, ... }`;

        try {
          const classRes = await fetch('https://api.anthropic.com/v1/messages', {
            method:  'POST',
            headers: {
              'Content-Type':      'application/json',
              'x-api-key':         apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
              max_tokens: 1024,
              messages:   [{ role: 'user', content: classifyPrompt }],
            }),
          });

          if (!classRes.ok) {
            console.warn(`[mirrr/content-dna/graph] Classify batch ${i} API error ${classRes.status} — falling back`);
          } else {
            const classData = await classRes.json();
            const classRaw  = classData.content[0].text.trim()
              .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

            let classResult = {};
            try { classResult = JSON.parse(classRaw); }
            catch { console.warn(`[mirrr/content-dna/graph] Classify batch ${i} JSON parse failed`); }

            for (const [numStr, clusterId] of Object.entries(classResult)) {
              const idx = parseInt(numStr) - 1;
              if (isNaN(idx) || idx < 0 || idx >= batch.length) continue;
              const found = (parsed.clusters || []).find(c => c.id === Number(clusterId));
              clusterMap[batch[idx].title.toLowerCase().trim()] = found || fallbackCluster;
            }
          }
        } catch (batchErr) {
          console.warn(`[mirrr/content-dna/graph] Classify batch ${i} threw:`, batchErr.message);
        }

        if (i + BATCH_SIZE < remainingNonLive.length) await new Promise(r => setTimeout(r, 300));
      }

      console.log(`[mirrr/content-dna/graph] Second pass done — clusterMap now has ${Object.keys(clusterMap).length} entries`);
    }

    // ── Tag ALL nodes with final assignments ──────────────────────────────────
    const taggedNodes = allNodes.map(n => {
      // Live streams: deterministic, never touched by Claude
      if (isLiveStream(n.title)) {
        return {
          ...n,
          cluster_id:            LIVE_CLUSTER.id,
          cluster_name:          LIVE_CLUSTER.name,
          cluster_color:         LIVE_CLUSTER.color,
          cluster_hex:           COLORS.rose,
          classification_method: 'live',
        };
      }
      const key     = n.title.toLowerCase().trim();
      const cluster = clusterMap[key] || fallbackCluster;
      const method  = clusterMap[key]
        ? (top50Ids.has(n.id) ? 'claude_top50' : 'claude_classified')
        : 'fallback';
      return {
        ...n,
        cluster_id:            cluster.id,
        cluster_name:          cluster.name,
        cluster_color:         cluster.color,
        cluster_hex:           COLORS[cluster.color] || COLORS.teal,
        classification_method: method,
      };
    });

    // Add live stream cluster to list if any live videos exist
    const finalClusters = hasLiveVideos
      ? [...(parsed.clusters || []), { ...LIVE_CLUSTER, video_count: allNodes.filter(n => isLiveStream(n.title)).length }]
      : (parsed.clusters || []);

    const longformTaggedCount  = taggedNodes.filter(n => n.format === 'longform' || n.format === 'standard').length;
    const shortsCount          = taggedNodes.filter(n => n.format === 'short').length;
    const claudeClassifiedCount = taggedNodes.filter(n => n.classification_method === 'claude_classified').length;
    const fallbackCount         = taggedNodes.filter(n => n.classification_method === 'fallback').length;
    const liveCount             = taggedNodes.filter(n => n.classification_method === 'live').length;

    console.log(`[mirrr/content-dna/graph] Done — ${taggedNodes.length} nodes across ${finalClusters.length} clusters`);
    console.log(`[mirrr/content-dna/graph] Methods — top50: ${top50.length}, claude_classified: ${claudeClassifiedCount}, live: ${liveCount}, fallback: ${fallbackCount}`);

    const result = {
      nodes:          taggedNodes,
      clusters:       finalClusters,
      edges:          parsed.edges    || [],
      cached_at:      new Date().toISOString(),
      total:          allNodes.length,
      longform_count: longformTaggedCount,
      shorts_count:   shortsCount,
      clustered:      top50.length + claudeClassifiedCount,
    };

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

    const { brand: mDnaBrand, tiktokHandle: mDnaHandle } = getCreatorContext();

    const dnaPrompt = `You are analyzing a YouTube creator's complete content library to define their actual niche and ideal audience avatar.

Channel: ${mDnaBrand} (${mDnaHandle})
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

    // Use longform + standard only for analysis (Shorts skew patterns)
    const longformNodes  = nodes.filter(n => n.format !== 'short' && n.format !== 'live' && n.format !== 'micro');
    const longformCount  = longformNodes.length;

    // Refresh gate — locked unless longform count grew by 10+ or force=true
    const forceOverride  = req.body?.force === true;
    const cachedSecrets  = db.getKv('channel_dna_secrets');
    const lastCount      = db.getKv('channel_dna_secrets_video_count') || 0;
    if (!forceOverride && cachedSecrets && longformCount < lastCount + 10) {
      const remaining = (lastCount + 10) - longformCount;
      send({ type: 'locked', data: cachedSecrets, remaining, longform_count: longformCount, last_count: lastCount });
      res.end(); return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send({ type: 'error', message: 'ANTHROPIC_API_KEY not set' }); res.end(); return; }

    const statusMsg = lastCount === 0
      ? `Scanning your content universe for the first time (${longformCount} long-form videos)...`
      : longformCount >= lastCount + 10
        ? `\u2705 You've published ${longformCount - lastCount} new long-form videos — finding fresh patterns...`
        : `Force-refreshing insights across ${longformCount} long-form videos...`;
    send({ type: 'status', message: statusMsg });

    const totalViews = longformNodes.reduce((s, n) => s + n.views, 0);
    const avgViews   = longformCount ? Math.round(totalViews / longformCount) : 0;
    const top20      = [...longformNodes].sort((a, b) => b.views - a.views).slice(0, 20);

    const clustersJson = JSON.stringify(clusters.map(c => {
      const cn = longformNodes.filter(n => n.cluster_id === c.id);
      if (!cn.length) return null;
      return {
        name:        c.name,
        video_count: cn.length,
        avg_views:   Math.round(cn.reduce((s, n) => s + n.views, 0) / cn.length),
        top_video:   c.top_video || cn.sort((a, b) => b.views - a.views)[0]?.title || '',
      };
    }).filter(Boolean), null, 2);

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
    db.setKv('channel_dna_secrets_video_count', longformCount);
    send({ type: 'result', data: parsed });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── Save Secrets to Soul ─────────────────────────────────────────────────────
// PATCH /api/analytr/save-secrets-to-soul
// Writes top insights to creator-profile.json content_intelligence block.

router.patch('/save-secrets-to-soul', (req, res) => {
  try {
    const secrets = db.getKv('channel_dna_secrets');
    if (!secrets || !secrets.length) {
      return res.status(404).json({ error: 'No secrets found. Run Discover Secrets first.' });
    }

    const clusterData    = db.getKv('channel_dna_clusters');
    const allNodes       = clusterData?.nodes || [];
    const longformCount  = allNodes.filter(n => n.format !== 'short' && n.format !== 'live' && n.format !== 'micro').length || allNodes.length;

    const profilePath = path.join(__dirname, '../../creator-profile.json');
    const profile     = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    profile.content_intelligence = {
      insights:                    secrets.slice(0, 7),
      generated_at:                new Date().toISOString(),
      video_count:                 longformCount,
      next_update_at_video_count:  longformCount + 10,
    };

    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
    res.json({ ok: true, saved: secrets.length, next_update_at: longformCount + 10 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/mirrr/evaluate-strategy ───────────────────────────────────────
// Takes a past month's strategy, compares recommendations vs actual YouTube
// performance, asks Claude to evaluate, stores calibrated results.
// Body: { month: "03", year: 2026 }   (defaults to last month if omitted)

router.post('/evaluate-strategy', async (req, res) => {
  const now       = new Date();
  // Default: evaluate last month
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const lastYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  let evalMonth = String(req.body?.month || lastMonth).padStart(2, '0');
  let evalYear  = parseInt(req.body?.year  || lastYear, 10);

  try {
    // ── 1. Get the strategy report for that month ─────────────────────────────
    let report = db.getLatestReport(evalMonth, evalYear);
    // Fallback: if no report for the exact month, use the most recent available
    if (!report) {
      report = db.getLatestReport();
      if (!report) {
        return res.status(404).json({ error: `No strategy reports found. Generate a strategy in NorthΩr first.` });
      }
      // Update evalMonth/evalYear to match the report we found
      evalMonth = report.month;
      evalYear  = parseInt(report.year, 10);
    }

    let strategyContent;
    try { strategyContent = JSON.parse(report.content); }
    catch { strategyContent = report.content; }

    // ── 2. Get videos actually published in that month ───────────────────────
    const videos = db.getVideosByMonth(evalMonth, evalYear);
    const monthName = new Date(evalYear, parseInt(evalMonth) - 1, 1)
      .toLocaleString('default', { month: 'long' });

    // ── 3. Get past evaluations for context ──────────────────────────────────
    const pastEvals = db.getRecentEvaluations(2);

    // ── 3b. Get all-time structure performance for PipΩr calibration ─────────
    const structurePerf = db.getStructurePerformance();

    // ── 4. Build the evaluation prompt ──────────────────────────────────────
    const { creatorName, brand } = getCreatorContext();

    const videoBlock = videos.length > 0
      ? videos.map(v => `- "${v.title}": ${Number(v.views).toLocaleString()} views, ${Number(v.likes).toLocaleString()} likes, ${Number(v.comments).toLocaleString()} comments${v.angle ? ` [angle: ${v.angle}]` : ''}`).join('\n')
      : '(No YouTube performance data found for this period — YouTube sync may not have run yet)';

    const structureBlock = structurePerf.length > 0
      ? '\n\n## ALL-TIME STORY STRUCTURE PERFORMANCE (across all kre8r videos)\n'
        + structurePerf.map(s =>
            `- ${s.story_structure}: ${s.video_count} video${s.video_count !== 1 ? 's' : ''} · avg ${Number(s.avg_views).toLocaleString()} views · best: ${Number(s.max_views).toLocaleString()} views`
          ).join('\n')
        + '\nInclude structure_performance in your evaluation JSON — which structures are outperforming others? Should PipΩr weight recommendations toward specific structures?'
      : '';

    const strategyBlock = typeof strategyContent === 'object'
      ? [
          strategyContent.top_priority ? `TOP PRIORITY: ${strategyContent.top_priority}` : '',
          strategyContent.why_this_mix ? `STRATEGIC LOGIC: ${strategyContent.why_this_mix}` : '',
          Array.isArray(strategyContent.recommended_mix)
            ? `RECOMMENDED MIX:\n${strategyContent.recommended_mix.map(m => `  - ${m.count}x ${m.type}: ${m.reason}`).join('\n')}`
            : '',
          strategyContent.avoid_this_month ? `AVOID: ${strategyContent.avoid_this_month}` : '',
        ].filter(Boolean).join('\n\n')
      : String(strategyContent || '(strategy not parsed)');

    const pastEvalBlock = pastEvals.length > 0
      ? '\n\nPAST EVALUATIONS FOR CALIBRATION:\n' + pastEvals.map(e => {
          try {
            const ev = JSON.parse(e.evaluation);
            return `- ${e.month}/${e.year}: Score ${ev.overall_accuracy_score}/10 — ${ev.one_line}`;
          } catch { return `- ${e.month}/${e.year}: (parse error)`; }
        }).join('\n')
      : '';

    const prompt = `You are MirrΩr, a self-correcting strategy evaluator for ${creatorName} at ${brand}.

Your job: evaluate how accurate last month's strategy was, so future strategies can be better calibrated. Be honest and specific. This is the system learning from evidence, not a feel-good recap.

## ${monthName.toUpperCase()} ${evalYear} — WHAT WAS RECOMMENDED

${strategyBlock}

## WHAT ACTUALLY HAPPENED (YouTube performance data)

${videoBlock}
${structureBlock}
${pastEvalBlock}

## YOUR TASK

Evaluate the strategy's accuracy against actual results. Did the recommendations reflect what actually worked? Were the angles called correctly? Which story structures are outperforming others? What should be weighted differently going forward?

Return ONLY valid JSON — no markdown, no code fences, no explanation:

{
  "month": "${evalMonth}",
  "year": ${evalYear},
  "videos_published_count": ${videos.length},
  "total_views_this_month": ${videos.reduce((sum, v) => sum + (Number(v.views) || 0), 0)},
  "avg_views_per_video": ${videos.length > 0 ? Math.round(videos.reduce((sum, v) => sum + (Number(v.views) || 0), 0) / videos.length) : 0},
  "recommendation_accuracy": [
    {
      "recommendation": "what was recommended",
      "followed": true,
      "result": "what happened — with actual view numbers where available",
      "weight_adjustment": "UP | DOWN | NEUTRAL",
      "reason": "why this should be weighted differently"
    }
  ],
  "structure_performance": [
    {
      "structure": "save_the_cat",
      "verdict": "top | strong | neutral | underperforming",
      "avg_views": 45000,
      "video_count": 3,
      "pipr_recommendation": "One sentence — should PipΩr recommend this structure more, less, or for specific content types?"
    }
  ],
  "overall_accuracy_score": 7,
  "what_worked": "One paragraph — what the strategy got right",
  "what_missed": "One paragraph — where the strategy was wrong or incomplete",
  "calibration_notes": "One paragraph — specific instructions for how to weight future recommendations differently based on this evidence",
  "one_line": "Terse summary — score/10 and most important insight (e.g. '7/10 — financial angle delivered 2x avg views; lifestyle recommendation ignored')"
}`;

    // ── 5. Ask Claude ────────────────────────────────────────────────────────
    let evaluation;
    try {
      evaluation = await callClaude(prompt, 2048);
    } catch (err) {
      return res.status(500).json({ error: `Claude API error: ${err.message}` });
    }

    if (!evaluation || typeof evaluation !== 'object') {
      return res.status(500).json({ error: 'Claude returned unexpected format', raw: String(evaluation).slice(0, 200) });
    }

    // ── 6. Store evaluation back on the strategy report ──────────────────────
    db.saveStrategyEvaluation(report.id, evaluation);

    // Also cache in kv_store for quick access from NorthΩr / strategy prompts
    const cacheKey = `strategy_eval_${evalYear}_${evalMonth}`;
    db.setKv(cacheKey, JSON.stringify(evaluation));

    res.json({ ok: true, report_id: report.id, evaluation });

  } catch (err) {
    console.error('[mirrr/evaluate-strategy]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/mirrr/evaluations ──────────────────────────────────────────────
// Returns the N most recent strategy evaluations (for NorthΩr display)

router.get('/evaluations', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 6, 12);
    const rows  = db.getRecentEvaluations(limit);
    const evals = rows.map(r => {
      let ev = null;
      try { ev = JSON.parse(r.evaluation); } catch { ev = null; }
      return { report_id: r.id, month: r.month, year: r.year, evaluated_at: r.evaluated_at, evaluation: ev };
    });
    res.json({ evaluations: evals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /viral-clips/project/:id — approved viral clips for a project ────────
// Used by CaptionΩr and any downstream tool to auto-load creator-approved clips.
router.get('/viral-clips/project/:id', (req, res) => {
  try {
    const clips = db.getApprovedViralClipsByProject(parseInt(req.params.id));
    res.json({ ok: true, clips });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /viral-clips/recent — most recently approved clips ───────────────────
// Fallback for CaptionΩr when footage isn't linked to a project.
// Returns up to 20 most recently approved clips across all footage.
router.get('/viral-clips/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const clips = db.getRecentApprovedClips(limit);
    res.json({ ok: true, clips });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /niche — channel niche definition for universe label ─────────────────
router.get('/niche', (req, res) => {
  try {
    const cached = db.getKv('channel_dna_profile');
    if (!cached) return res.json({ niche_definition: null, content_pillars: [] });
    res.json({
      niche_definition: cached.niche_definition || null,
      content_pillars:  cached.content_pillars  || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
