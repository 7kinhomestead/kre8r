/**
 * PostΩr — YouTube Analytics Module
 * Pulls per-video and channel-level metrics from YouTube Analytics API v2.
 * Stores into the existing `analytics` table so MirrΩr and NorthΩr read live data.
 *
 * Required OAuth scopes:
 *   yt-analytics.readonly
 *   yt-analytics-monetary.readonly
 *
 * KEY API RULE (dimensions=video "Top Videos" report):
 *   `sort` and `maxResults` are REQUIRED — not optional.
 *   Without them the API returns "The query is not supported."
 *   Max 200 rows per call → need two passes for channels with >200 videos.
 *   Pass 1: top 200 by primary metric (sort=-views / sort=-likes)
 *   Pass 2: remaining video IDs via filters=video==id1,id2,...
 *
 * Metric mapping (YouTube Analytics API → Kre8Ωr metric_name):
 *   views                         → views
 *   estimatedMinutesWatched × 60  → watch_time        (seconds)
 *   averageViewDuration            → avg_watch_time    (seconds)
 *   averageViewPercentage ÷ 100   → completion_rate   (0–1 decimal)
 *   subscribersGained             → followers_gained
 *   likes                         → likes
 *   comments                      → comment_count
 *   shares                        → shares
 */

'use strict';

const db      = require('../db');
const youtube = require('./youtube');

const YT_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const YT_API_BASE  = 'https://www.googleapis.com/youtube/v3';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ─── Step 1: Build full video inventory from YouTube Data API ─────────────────

/**
 * Fetch the channel's full uploads playlist.
 * Returns { videoMap: { videoId → { title, published_at } }, channelId }
 */
async function fetchChannelVideoMap(token) {
  const channelRes  = await fetch(
    `${YT_API_BASE}/channels?part=id,contentDetails&mine=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const channelData = await channelRes.json();

  if (!channelRes.ok || channelData.error) {
    throw new Error(`YouTube channels API error: ${channelData?.error?.message || channelRes.status}`);
  }

  const channelId         = channelData.items?.[0]?.id;
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist for this channel');

  const videoMap   = {};
  let pageToken    = null;
  let pagesFetched = 0;

  do {
    const params = new URLSearchParams({ part: 'snippet', playlistId: uploadsPlaylistId, maxResults: '50' });
    if (pageToken) params.set('pageToken', pageToken);

    const listRes  = await fetch(`${YT_API_BASE}/playlistItems?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();

    if (!listRes.ok || listData.error) {
      throw new Error(`YouTube playlistItems API error: ${listData?.error?.message || listRes.status}`);
    }

    for (const item of (listData.items || [])) {
      const vid = item.snippet?.resourceId?.videoId;
      if (vid) {
        videoMap[vid] = {
          title:        item.snippet?.title       || '',
          published_at: item.snippet?.publishedAt || null,
        };
      }
    }

    pageToken = listData.nextPageToken || null;
    pagesFetched++;
  } while (pageToken && pagesFetched < 50);

  return { videoMap, channelId };
}

// ─── Step 2: Seed posts table ─────────────────────────────────────────────────

/**
 * Ensure every channel video has a project + post row in the DB.
 * Returns postMap: videoId → { post_id, project_id }
 */
function seedPostsAndBuildMap(channelVideoMap) {
  const postMap = {};

  for (const [videoId, info] of Object.entries(channelVideoMap)) {
    const url = videoUrl(videoId);

    let existingPost = db.getPostByUrl(url);

    if (!existingPost) {
      let existingProject = db.getProjectByYouTubeVideoId(videoId);

      if (!existingProject) {
        try {
          const projectId = db.createImportProject({
            title:            info.title || `YouTube video ${videoId}`,
            platform:         'youtube',
            published_at:     info.published_at || null,
            url,
            youtube_video_id: videoId,
          });
          existingProject = { id: projectId };
        } catch (err) {
          console.warn(`[postor/analytics] Could not create project for ${videoId}:`, err.message);
          continue;
        }
      }

      try {
        const postId = db.createImportPost({
          projectId:        existingProject.id,
          platform:         'youtube',
          content:          info.title || '',
          posted_at:        info.published_at || null,
          url,
          platform_post_id: videoId,
        });
        existingPost = { id: postId, project_id: existingProject.id };
      } catch (err) {
        console.warn(`[postor/analytics] Could not create post for ${videoId}:`, err.message);
        continue;
      }
    }

    postMap[videoId] = {
      post_id:    existingPost.id,
      project_id: existingPost.project_id || null,
    };
  }

  return postMap;
}

// ─── Step 3: Analytics API ────────────────────────────────────────────────────

/**
 * Fetch one analytics report (Top Videos) for all channel videos.
 *
 * REQUIRED for dimensions=video: sort + maxResults (≤200).
 * For channels with >200 videos, makes two passes:
 *   Pass 1 — top 200 by primary metric
 *   Pass 2 — remaining video IDs via filters=video==id1,id2,...  (chunked)
 *
 * Returns { data: { videoId → { metricName: value } }, rows, error }
 */
async function fetchVideoReport(token, metrics, channelIds, allVideoIds = []) {
  const primarySort = `-${metrics[0]}`;
  const result      = {};

  // ── Pass 1: top 200 by primary metric ────────────────────────────────────
  const p1 = new URLSearchParams({
    ids:        channelIds,
    dimensions: 'video',
    metrics:    metrics.join(','),
    startDate:  '2020-01-01',
    endDate:    todayStr(),
    sort:       primarySort,
    maxResults: '200',
  });

  let res1, data1;
  try {
    res1  = await fetch(`${YT_ANALYTICS}?${p1}`, { headers: { Authorization: `Bearer ${token}` } });
    data1 = await res1.json();
  } catch (err) {
    return { data: {}, rows: 0, error: `Network error: ${err.message}` };
  }

  if (!res1.ok || data1.error) {
    const msg = data1?.error?.message || `HTTP ${res1.status}`;
    return { data: {}, rows: 0, error: `[${metrics.join(',')}] ${msg}` };
  }

  const colNames = (data1.columnHeaders || []).map(h => h.name);
  for (const row of (data1.rows || [])) {
    const vid   = row[0];
    const entry = {};
    for (let i = 1; i < colNames.length; i++) entry[colNames[i]] = row[i] ?? null;
    result[vid] = entry;
  }

  // ── Pass 2: remaining videos not returned in pass 1 ───────────────────────
  const covered   = new Set(Object.keys(result));
  const remaining = allVideoIds.filter(id => !covered.has(id));

  if (remaining.length > 0) {
    // Chunk into groups of 100 to stay within URL length limits
    const CHUNK = 100;
    for (let i = 0; i < remaining.length; i += CHUNK) {
      const chunk  = remaining.slice(i, i + CHUNK);
      const p2     = new URLSearchParams({
        ids:        channelIds,
        dimensions: 'video',
        metrics:    metrics.join(','),
        startDate:  '2020-01-01',
        endDate:    todayStr(),
        filters:    `video==${chunk.join(',')}`,
        sort:       primarySort,
        maxResults: '200',
      });

      try {
        const res2  = await fetch(`${YT_ANALYTICS}?${p2}`, { headers: { Authorization: `Bearer ${token}` } });
        const data2 = await res2.json();

        if (res2.ok && !data2.error) {
          const cols2 = (data2.columnHeaders || []).map(h => h.name);
          for (const row of (data2.rows || [])) {
            const vid   = row[0];
            const entry = {};
            for (let j = 1; j < cols2.length; j++) entry[cols2[j]] = row[j] ?? null;
            result[vid] = entry;
          }
        }
      } catch (_) {
        // Non-fatal — partial data is better than no data
      }
    }
  }

  return { data: result, rows: Object.keys(result).length, error: null };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Sync analytics for every video on the channel.
 * Auto-creates posts table rows for missing videos.
 * Pulls monthly revenue for NorthΩr.
 *
 * @param {function} onProgress  callback({ stage, message, pct })
 */
async function syncYouTubeAnalytics(onProgress) {
  const token = await youtube.getValidToken();

  // ── 1. Full channel video list ────────────────────────────────────────────
  onProgress?.({ stage: 'analytics', message: 'Fetching channel video list…', pct: 5 });

  const { videoMap: channelVideoMap, channelId } = await fetchChannelVideoMap(token);
  const totalVideos = Object.keys(channelVideoMap).length;

  if (totalVideos === 0) {
    onProgress?.({ stage: 'analytics', message: 'No videos found on this channel.', pct: 100 });
    return { ok: true, channel_id: channelId, videos_found: 0, videos_synced: 0, metrics_written: 0 };
  }

  // Use explicit channel ID — brand accounts fail with channel==MINE
  const analyticsIds = channelId ? `channel==${channelId}` : 'channel==MINE';

  onProgress?.({ stage: 'analytics', message: `Found ${totalVideos} videos (ch: ${channelId}). Seeding database…`, pct: 15 });

  // ── 2. Seed posts table ───────────────────────────────────────────────────
  const postMap    = seedPostsAndBuildMap(channelVideoMap);
  const postMapLen = Object.keys(postMap).length;
  const videoIds   = Object.keys(postMap); // IDs we care about

  onProgress?.({ stage: 'analytics', message: `DB ready: ${postMapLen} videos. Pulling view metrics…`, pct: 28 });

  // ── 3. Analytics — single request with all metrics ───────────────────────
  // sort=-views + maxResults=200 are REQUIRED for dimensions=video.
  // All metrics combined in one call sorted by views (matches the API docs example).
  const resultA = await fetchVideoReport(token, [
    'views',
    'estimatedMinutesWatched',
    'averageViewDuration',
    'averageViewPercentage',
    'subscribersGained',
    'likes',
    'comments',
    'shares',
  ], analyticsIds, videoIds);

  onProgress?.({ stage: 'analytics', message: resultA.error
    ? `⚠ Analytics error: ${resultA.error.slice(0, 100)}`
    : `Analytics: ${resultA.rows} videos. Writing to DB…`, pct: 65 });

  // ── 4. Merge and upsert ───────────────────────────────────────────────────
  const reportA = resultA.data;
  const resultB = { data: {}, rows: 0, error: null }; // merged into A
  const reportB = resultB.data;
  const allAnalyticsVideoIds = new Set(Object.keys(reportA));

  let metricsWritten = 0;
  let videosSynced   = 0;

  for (const videoId of allAnalyticsVideoIds) {
    const entry = postMap[videoId];
    if (!entry) continue;

    const a = reportA[videoId] || {};

    const minsWatched = a['estimatedMinutesWatched'] ?? null;
    const avgViewPct  = a['averageViewPercentage']   ?? null;

    const toUpsert = [
      { name: 'views',            value: a['views']               ?? null },
      { name: 'watch_time',       value: minsWatched != null ? Math.round(minsWatched * 60) : null },
      { name: 'avg_watch_time',   value: a['averageViewDuration'] ?? null },
      { name: 'completion_rate',  value: avgViewPct  != null ? avgViewPct / 100 : null },
      { name: 'followers_gained', value: a['subscribersGained']   ?? null },
      { name: 'likes',            value: a['likes']               ?? null },
      { name: 'comment_count',    value: a['comments']            ?? null },
      { name: 'shares',           value: a['shares']              ?? null },
    ].filter(m => m.value != null);

    for (const metric of toUpsert) {
      db.upsertMetric(entry.post_id, entry.project_id, 'youtube', metric.name, metric.value);
      metricsWritten++;
    }

    if (toUpsert.length > 0) videosSynced++;
  }

  // ── 6. Monthly revenue for NorthΩr ────────────────────────────────────────
  onProgress?.({ stage: 'analytics', message: 'Pulling monthly revenue…', pct: 88 });

  let revenueTotal = 0;
  let revenueError = null;

  try {
    // dimensions=month rejects future dates with a misleading "Date range does not exist" error.
    // System clock is ahead of YouTube's real-world data — probe candidate end dates until one works.
    const candidateEndDates = [
      '2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30',
      '2024-03-31', '2023-12-31', '2023-06-30', '2022-12-31',
    ];

    let revData = null;
    for (const endDate of candidateEndDates) {
      const revParams = new URLSearchParams({
        ids:        analyticsIds,
        dimensions: 'month',
        metrics:    'estimatedRevenue',
        startDate:  '2022-01-01',
        endDate,
      });
      const revRes = await fetch(`${YT_ANALYTICS}?${revParams}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      revData = await revRes.json();
      if (!revData.error) break; // found a valid date range
      console.warn(`[postor/analytics] Revenue endDate ${endDate} rejected: ${revData.error.message}`);
      revData = null;
    }

    if (!revData) {
      revenueError = 'All candidate date ranges rejected — channel may not yet have revenue data';
    } else if (revData.error) {
      revenueError = revData.error.message;
      console.warn('[postor/analytics] Revenue API error:', revenueError);
    } else if (revData.rows) {
      for (const row of revData.rows) {
        const month   = row[0];
        const revenue = row[1];
        if (revenue != null) {
          db.upsertMonthlyRevenue(month, 'youtube', revenue);
          revenueTotal += revenue;
        }
      }
    }
  } catch (err) {
    revenueError = err.message;
    console.warn('[postor/analytics] Monthly revenue pull failed (non-fatal):', err.message);
  }

  onProgress?.({ stage: 'analytics', message: revenueError
    ? `⚠ Revenue pull failed: ${revenueError.slice(0, 100)}`
    : `Revenue: $${revenueTotal.toFixed(2)} pulled`, pct: 95 });

  onProgress?.({ stage: 'analytics', message: `Done! ${videosSynced}/${totalVideos} videos synced, ${metricsWritten} metrics written.`, pct: 100 });

  // Bust MirrΩr DNA cache so it rebuilds with fresh data
  try {
    db.setKv('channel_dna_clusters',            null);
    db.setKv('channel_dna_secrets',             null);
    db.setKv('channel_dna_secrets_video_count', null);
  } catch (_) {}

  return {
    ok:               true,
    channel_id:       channelId || 'MINE',
    videos_found:     totalVideos,
    post_map_size:    postMapLen,
    analytics_a_rows: resultA.rows ?? 0,
    analytics_b_rows: resultB.rows ?? 0,
    analytics_a_err:  resultA.error || null,
    analytics_b_err:  resultB.error || null,
    videos_synced:    videosSynced,
    metrics_written:  metricsWritten,
    revenue_total:    revenueTotal,
    revenue_error:    revenueError,
  };
}

module.exports = { syncYouTubeAnalytics, extractVideoId };
