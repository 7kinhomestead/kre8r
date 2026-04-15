/**
 * Analytics CSV Import — src/routes/analytics-import.js
 *
 * Accepts CSV exports from TikTok, Instagram, Facebook, and YouTube.
 * Normalises each platform's column names → posts + analytics tables.
 * MirrΩr and NorthΩr pick up the data automatically — no other changes needed.
 *
 * POST /api/analytics-import/upload   — parse + import a CSV file
 * GET  /api/analytics-import/summary  — import history / last-imported dates per platform
 */

'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const log     = require('../utils/logger');
const db      = require('../db');

// Use memory storage — CSV files are small
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── CSV parser ────────────────────────────────────────────────────────────────
// RFC 4180 — handles quoted fields, embedded commas/newlines, escaped quotes.
function parseCsv(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) rows.push(current);
  if (rows.length < 2) return [];

  const headers = splitCsvLine(rows[0]).map(h => h.trim().toLowerCase());

  return rows.slice(1).map(row => {
    const vals = splitCsvLine(row);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

function splitCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else field += line[i++];
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseNum(val) {
  if (val === null || val === undefined || val === '' || val === '-' || val === 'N/A') return null;
  const n = parseFloat(String(val).replace(/[,%]/g, '').trim());
  return isNaN(n) ? null : n;
}

function parsePct(val) {
  // "87.3%" → 0.873  /  "0.873" → 0.873  /  "87.3" → 0.873
  if (!val || val === '-' || val === 'N/A') return null;
  const s = String(val).trim();
  const n = parseFloat(s.replace('%', ''));
  if (isNaN(n)) return null;
  return s.includes('%') ? n / 100 : (n > 1 ? n / 100 : n);
}

function parseDurationToSeconds(val) {
  if (!val || val === '-') return null;
  // MM:SS or HH:MM:SS
  const parts = String(val).trim().split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  const n = parseFloat(val);
  return isNaN(n) ? null : Math.round(n);
}

function parseDate(val) {
  if (!val || val === '-') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Find a column value by trying multiple possible header names
function col(row, ...candidates) {
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

// ── Platform parsers ──────────────────────────────────────────────────────────

function parseTikTok(rows) {
  return rows.map(r => {
    // Support both TikTok Studio "Content" export and legacy "Video" export column names
    const url      = col(r, 'video link', 'video url', 'url', 'link');
    const videoId  = col(r, 'video id', 'video_id') || extractTikTokId(url);
    const caption  = col(r, 'video title', 'video caption', 'caption', 'content', 'title');
    // "Post time" = original publish date; "Time" = analytics window date — use Post time
    const posted   = parseDate(col(r, 'post time', 'posted date', 'post date', 'published date', 'date'));
    const duration = parseDurationToSeconds(col(r, 'video duration', 'duration'));

    const metrics = {};
    const views   = parseNum(col(r, 'total views', 'video views', 'views', 'total video views'));
    const likes   = parseNum(col(r, 'total likes', 'like count', 'likes'));
    const comments = parseNum(col(r, 'total comments', 'comment count', 'comments'));
    const shares  = parseNum(col(r, 'total shares', 'share count', 'shares'));
    const saves   = parseNum(col(r, 'favorites count', 'total favorites', 'saves', 'bookmarks'));
    const reach   = parseNum(col(r, 'reach'));
    const followers = parseNum(col(r, 'new followers', 'followers gained'));
    const watchTime = parseNum(col(r, 'total time watched', 'total watch time'));
    const avgWatch  = parseDurationToSeconds(col(r, 'average time watched', 'avg time watched'));
    const finish    = parsePct(col(r, 'watched full video rate', 'completion rate', 'finish rate'));

    if (views     !== null) metrics.views            = views;
    if (likes     !== null) metrics.likes            = likes;
    if (comments  !== null) metrics.comment_count    = comments;
    if (shares    !== null) metrics.shares           = shares;
    if (saves     !== null) metrics.saves            = saves;
    if (reach     !== null) metrics.reach            = reach;
    if (followers !== null) metrics.followers_gained = followers;
    if (watchTime !== null) metrics.watch_time       = watchTime;
    if (avgWatch  !== null) metrics.avg_watch_time   = avgWatch;
    if (finish    !== null) metrics.completion_rate  = finish;

    return { platform: 'tiktok', videoId, url, content: caption, posted_at: posted,
             duration_seconds: duration, metrics };
  }).filter(r => Object.keys(r.metrics).length > 0);
}

function parseInstagram(rows) {
  return rows.map(r => {
    const posted  = parseDate(col(r, 'post date', 'date', 'published', 'post published'));
    const content = col(r, 'post text', 'caption', 'description', 'content');
    const format  = col(r, 'post type', 'type', 'media type') || null;
    const url     = col(r, 'permalink', 'url', 'post url');

    const metrics = {};
    const reach   = parseNum(col(r, 'reach', 'accounts reached'));
    const views   = parseNum(col(r, 'views', 'impressions', 'video views', 'plays'));
    const likes   = parseNum(col(r, 'likes'));
    const comments = parseNum(col(r, 'comments'));
    const shares  = parseNum(col(r, 'shares'));
    const saves   = parseNum(col(r, 'saves', 'bookmarks'));
    const profileVisits = parseNum(col(r, 'profile visits', 'profile activity'));

    if (reach    !== null) metrics.reach          = reach;
    if (views    !== null) metrics.views          = views;
    if (likes    !== null) metrics.likes          = likes;
    if (comments !== null) metrics.comment_count  = comments;
    if (shares   !== null) metrics.shares         = shares;
    if (saves    !== null) metrics.saves          = saves;
    if (profileVisits !== null) metrics.profile_visits = profileVisits;

    return { platform: 'instagram', videoId: null, url, content, posted_at: posted,
             duration_seconds: null, format: normaliseFormat(format), metrics };
  }).filter(r => Object.keys(r.metrics).length > 0);
}

function parseFacebook(rows) {
  return rows.map(r => {
    // Facebook exports have a header row then a blank row then data — handle that upstream
    const url     = col(r, 'post permalink', 'permalink', 'url');
    const content = col(r, 'post message', 'message', 'description', 'content');
    const posted  = parseDate(col(r, 'post published', 'published', 'date', 'post date'));
    const format  = col(r, 'post type', 'type') || null;

    const metrics = {};
    const reach   = parseNum(col(r, 'lifetime post total reach', 'reach', 'total reach'));
    const impressions = parseNum(col(r, 'lifetime post total impressions', 'impressions', 'total impressions'));
    const likes   = parseNum(col(r, 'like', 'likes', 'like count'));
    const comments = parseNum(col(r, 'comment', 'comments', 'comment count'));
    const shares  = parseNum(col(r, 'share', 'shares', 'share count'));
    const engaged = parseNum(col(r, 'lifetime engaged users', 'engaged users'));
    const total   = parseNum(col(r, 'total interactions', 'interactions'));
    const views   = parseNum(col(r, 'video views', 'views'));

    if (reach       !== null) metrics.reach             = reach;
    if (impressions !== null) metrics.impressions       = impressions;
    if (likes       !== null) metrics.likes             = likes;
    if (comments    !== null) metrics.comment_count     = comments;
    if (shares      !== null) metrics.shares            = shares;
    if (engaged     !== null) metrics.engaged_users     = engaged;
    if (total       !== null) metrics.total_interactions = total;
    if (views       !== null) metrics.views             = views;

    return { platform: 'facebook', videoId: null, url, content, posted_at: posted,
             duration_seconds: null, format: normaliseFormat(format), metrics };
  }).filter(r => Object.keys(r.metrics).length > 0);
}

function parseYouTube(rows) {
  return rows.map(r => {
    const title   = col(r, 'video title', 'content', 'title');
    const posted  = parseDate(col(r, 'video publish time', 'publish time', 'published', 'date'));
    const url     = col(r, 'url', 'video url', 'link');
    const videoId = col(r, 'video id') || extractYouTubeId(url);
    const durationRaw = col(r, 'duration', 'video duration');
    const duration = parseDurationToSeconds(durationRaw);

    const metrics = {};
    const views   = parseNum(col(r, 'views', 'view count'));
    // Watch time may be in hours
    const watchHours = parseNum(col(r, 'watch time (hours)', 'watch time', 'watch_time_minutes'));
    const watchTime  = watchHours !== null ? Math.round(watchHours * 3600) : null;
    const avgDur  = parseDurationToSeconds(col(r, 'average view duration', 'avg view duration'));
    const subs    = parseNum(col(r, 'subscribers', 'subscribers gained'));
    const impr    = parseNum(col(r, 'impressions'));
    const ctr     = parsePct(col(r, 'impressions click-through rate (%)', 'ctr', 'click-through rate (%)'));
    const likes   = parseNum(col(r, 'likes'));
    const comments = parseNum(col(r, 'comments'));

    if (views    !== null) metrics.views           = views;
    if (watchTime !== null) metrics.watch_time     = watchTime;
    if (avgDur   !== null) metrics.avg_watch_time  = avgDur;
    if (subs     !== null) metrics.followers_gained = subs;
    if (impr     !== null) metrics.impressions     = impr;
    if (ctr      !== null) metrics.ctr             = ctr;
    if (likes    !== null) metrics.likes           = likes;
    if (comments !== null) metrics.comment_count   = comments;

    return { platform: 'youtube', videoId, url, content: title, posted_at: posted,
             duration_seconds: duration, metrics };
  }).filter(r => Object.keys(r.metrics).length > 0);
}

function normaliseFormat(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('reel') || s.includes('short')) return 'short';
  if (s.includes('video')) return 'standard';
  if (s.includes('carousel') || s.includes('album')) return 'carousel';
  if (s.includes('story') || s.includes('stories')) return 'story';
  if (s.includes('photo') || s.includes('image')) return 'photo';
  return raw;
}

function extractTikTokId(url) {
  if (!url) return null;
  const m = String(url).match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/[?&]v=([^&]+)/) || String(url).match(/youtu\.be\/([^?]+)/);
  return m ? m[1] : null;
}

// ── DB upsert helpers ─────────────────────────────────────────────────────────

function upsertCsvPost(parsed) {
  const { platform, videoId, url, content, posted_at, duration_seconds, format, metrics } = parsed;

  if (!metrics || Object.keys(metrics).length === 0) return null;

  let postId    = null;
  let projectId = null;

  // 1. Try to find an existing post by URL (best dedup key)
  if (url) {
    try {
      const existing = db.getPostByUrl(url);
      if (existing) {
        postId    = existing.id;
        projectId = existing.project_id;
      }
    } catch (_) {}
  }

  // 2. For YouTube: also try matching via youtube_video_id on the projects table
  if (!postId && platform === 'youtube' && videoId) {
    try {
      const proj = db.getProjectByYouTubeVideoId(videoId);
      if (proj) {
        projectId = proj.id;
        const existPost = db.getPostByProjectAndPlatform(proj.id, 'youtube');
        if (existPost) postId = existPost.id;
      }
    } catch (_) {}
  }

  // 3. No existing post → create project first, then post under it
  //    (posts.project_id is NOT NULL, so project must exist first)
  if (!postId) {
    // Create project if we don't have one to attach to
    if (!projectId) {
      try {
        projectId = db.createImportProject({
          title:            content || url || `${platform} video`,
          platform,
          published_at:     posted_at || null,
          url,
          youtube_video_id: platform === 'youtube' ? videoId : null,
        });
      } catch (err) {
        log.warn({ module: 'analytics-import', err }, 'Could not create project');
        return null;
      }
    }

    // Create the post
    try {
      postId = db.createImportPost({
        projectId,
        platform,
        content,
        posted_at,
        url,
        format,
        duration_seconds,
        platform_post_id: videoId || null,
      });
    } catch (err) {
      log.warn({ module: 'analytics-import', err }, 'Could not create post');
      return null;
    }
  }

  if (!postId) return null;

  // 4. Upsert metrics
  let metricsStored = 0;
  for (const [name, value] of Object.entries(metrics)) {
    if (value === null || value === undefined) continue;
    try {
      db.upsertMetric(postId, projectId, platform, name, value);
      metricsStored++;
    } catch (_) {}
  }

  return { postId, projectId, metricsStored };
}

// ── POST /api/analytics-import/upload ─────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const platform = (req.body?.platform || '').toLowerCase();
    const VALID_PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube'];
    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvText = req.file.buffer.toString('utf8');
    const rawRows = parseCsv(csvText);

    if (!rawRows.length) {
      return res.status(400).json({ error: 'CSV appears empty or could not be parsed' });
    }

    // Platform-specific parse
    let parsed;
    if (platform === 'tiktok')    parsed = parseTikTok(rawRows);
    if (platform === 'instagram') parsed = parseInstagram(rawRows);
    if (platform === 'facebook')  parsed = parseFacebook(rawRows);
    if (platform === 'youtube')   parsed = parseYouTube(rawRows);

    if (!parsed.length) {
      return res.status(400).json({
        error: `No importable rows found. Make sure this is a ${platform} analytics export CSV.`,
        sample_headers: Object.keys(rawRows[0] || {}),
      });
    }

    // Import each row
    let imported = 0;
    let skipped  = 0;
    let totalMetrics = 0;

    for (const row of parsed) {
      try {
        const result = upsertCsvPost(row);
        if (result) {
          imported++;
          totalMetrics += result.metricsStored;
        } else {
          skipped++;
        }
      } catch (err) {
        log.warn({ module: 'analytics-import', err }, 'Row import failed');
        skipped++;
      }
    }

    // Record last-import timestamp in kv_store
    try {
      db.setKv(`analytics_import_last_${platform}`, new Date().toISOString());
      db.setKv(`analytics_import_count_${platform}`,
        String((parseInt(db.getKv(`analytics_import_count_${platform}`) || '0') + imported)));
    } catch (_) {}

    log.info({ module: 'analytics-import', platform, imported, skipped, totalMetrics }, 'CSV import complete');
    res.json({ ok: true, platform, rows_parsed: parsed.length, imported, skipped, metrics_stored: totalMetrics });
  } catch (err) {
    log.error({ module: 'analytics-import', err }, 'Upload failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/analytics-import/summary ─────────────────────────────────────────
router.get('/summary', (req, res) => {
  const platforms = ['tiktok', 'instagram', 'facebook', 'youtube'];
  const summary   = {};
  for (const p of platforms) {
    try {
      summary[p] = {
        last_import: db.getKv(`analytics_import_last_${p}`) || null,
        total_rows:  parseInt(db.getKv(`analytics_import_count_${p}`) || '0'),
      };
    } catch (_) {
      summary[p] = { last_import: null, total_rows: 0 };
    }
  }
  res.json({ ok: true, summary });
});

module.exports = router;
