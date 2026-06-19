'use strict';

/**
 * ConductΩr — YouTube Video History Sync
 *
 * Fetches ALL videos from the channel (public + unlisted, skips private).
 * Stores full API data in youtube_videos table.
 * Links to projects table via youtube_video_id where the match exists.
 * Does NOT duplicate MirrΩr — this is for classification/cockpit data.
 */

const https = require('https');
const db    = require('../db');

const API_KEY       = process.env.YOUTUBE_API_KEY;
const CHANNEL_HANDLE = process.env.YOUTUBE_CHANNEL_HANDLE || '7kinhomestead';

function ytGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

async function getUploadsPlaylistId() {
  // Try by handle first, fall back to channel search
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(CHANNEL_HANDLE)}&key=${API_KEY}`;
  const data = await ytGet(url);
  const playlistId = data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (playlistId) return playlistId;
  throw new Error('Could not find uploads playlist for channel @' + CHANNEL_HANDLE);
}

async function getAllVideoIds(uploadsPlaylistId, onProgress) {
  const ids = [];
  let pageToken = null;
  let page = 0;

  do {
    page++;
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&playlistId=${uploadsPlaylistId}&maxResults=50${pageToken ? '&pageToken=' + pageToken : ''}&key=${API_KEY}`;
    const data = await ytGet(url);

    if (data.error) throw new Error('YouTube API error: ' + JSON.stringify(data.error));

    for (const item of (data.items || [])) {
      const videoId = item.contentDetails?.videoId;
      if (videoId) ids.push(videoId);
    }

    pageToken = data.nextPageToken || null;
    onProgress?.(`Fetched page ${page} — ${ids.length} video IDs so far`);

    // Avoid hammering the API
    if (pageToken) await new Promise(r => setTimeout(r, 100));
  } while (pageToken);

  return ids;
}

async function getVideoDetails(videoIds, onProgress) {
  const videos = [];
  const BATCH = 50;

  for (let i = 0; i < videoIds.length; i += BATCH) {
    const batch = videoIds.slice(i, i + BATCH);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status&id=${batch.join(',')}&key=${API_KEY}`;
    const data = await ytGet(url);

    if (data.error) {
      onProgress?.(`⚠ Batch ${Math.floor(i/BATCH)+1} error: ${data.error.message} — skipping`);
      continue;
    }

    for (const item of (data.items || [])) {
      const privacy = item.status?.privacyStatus;
      // Skip private and unlisted entirely — unlisted = livestreams/misses not suitable for strategy
      if (privacy === 'private' || privacy === 'unlisted') continue;

      // Skip Shorts (< 60s) and active/upcoming livestreams
      const durationSecs = parseDuration(item.contentDetails?.duration);
      if (durationSecs !== null && durationSecs < 60) continue;
      const liveStatus = item.snippet?.liveBroadcastContent;
      if (liveStatus === 'live' || liveStatus === 'upcoming') continue;

      videos.push({
        video_id:         item.id,
        title:            item.snippet?.title || '',
        description:      (item.snippet?.description || '').slice(0, 2000),
        published_at:     item.snippet?.publishedAt || null,
        privacy_status:   privacy || 'public',
        duration_seconds: durationSecs,
        view_count:       parseInt(item.statistics?.viewCount || 0),
        like_count:       parseInt(item.statistics?.likeCount || 0),
        comment_count:    parseInt(item.statistics?.commentCount || 0),
        favorite_count:   parseInt(item.statistics?.favoriteCount || 0),
        thumbnail_url:    item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || null,
        tags:             JSON.stringify(item.snippet?.tags || []),
        category_id:      item.snippet?.categoryId || null,
      });
    }

    onProgress?.(`Fetched details ${i + batch.length}/${videoIds.length} videos`);
    await new Promise(r => setTimeout(r, 100));
  }

  return videos;
}

function linkToProjects(videos) {
  // Match youtube_videos to existing projects via youtube_video_id
  const rawDb = db.getRawDb();
  const projectMap = new Map();
  try {
    const projects = rawDb.prepare(
      `SELECT id, youtube_video_id FROM projects WHERE youtube_video_id IS NOT NULL`
    ).all();
    for (const p of projects) projectMap.set(p.youtube_video_id, p.id);
  } catch (_) {}

  return videos.map(v => ({
    ...v,
    project_id: projectMap.get(v.video_id) || null,
  }));
}

function upsertVideos(videos) {
  const rawDb = db.getRawDb();
  const stmt = rawDb.prepare(`
    INSERT INTO youtube_videos
      (video_id, title, description, published_at, privacy_status,
       duration_seconds, view_count, like_count, comment_count, favorite_count,
       thumbnail_url, tags, category_id, project_id, synced_at)
    VALUES
      (@video_id, @title, @description, @published_at, @privacy_status,
       @duration_seconds, @view_count, @like_count, @comment_count, @favorite_count,
       @thumbnail_url, @tags, @category_id, @project_id, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id) DO UPDATE SET
      title            = excluded.title,
      description      = excluded.description,
      privacy_status   = excluded.privacy_status,
      view_count       = excluded.view_count,
      like_count       = excluded.like_count,
      comment_count    = excluded.comment_count,
      favorite_count   = excluded.favorite_count,
      thumbnail_url    = excluded.thumbnail_url,
      tags             = excluded.tags,
      project_id       = COALESCE(excluded.project_id, youtube_videos.project_id),
      synced_at        = CURRENT_TIMESTAMP
  `);

  const upsertMany = rawDb.transaction((vids) => {
    let count = 0;
    for (const v of vids) {
      stmt.run(v);
      count++;
    }
    return count;
  });

  return upsertMany(videos);
}

// ── Main sync function ────────────────────────────────────────────────────────
async function syncYouTubeHistory(onProgress) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY not set in .env');

  onProgress?.('Getting channel uploads playlist…');
  const uploadsPlaylistId = await getUploadsPlaylistId();
  onProgress?.(`Found uploads playlist: ${uploadsPlaylistId}`);

  onProgress?.('Fetching video IDs from channel…');
  const videoIds = await getAllVideoIds(uploadsPlaylistId, onProgress);
  onProgress?.(`Found ${videoIds.length} total video IDs`);

  onProgress?.('Fetching full details (stats, duration, privacy)…');
  const videos = await getVideoDetails(videoIds, onProgress);
  onProgress?.(`Got details for ${videos.length} public/unlisted videos (skipped private)`);

  onProgress?.('Linking to Kre8r projects…');
  const linked = linkToProjects(videos);
  const withProject = linked.filter(v => v.project_id).length;
  onProgress?.(`Linked ${withProject} videos to Kre8r projects`);

  onProgress?.('Saving to database…');
  const saved = upsertVideos(linked);
  onProgress?.(`✓ Saved ${saved} videos to youtube_videos table`);

  // Also clear any previously-synced unlisted/short videos that are now excluded
  try {
    const rawDb = db.getRawDb();
    const pruned = rawDb.prepare(
      `DELETE FROM youtube_videos WHERE privacy_status = 'unlisted' OR duration_seconds < 60`
    ).run().changes;
    if (pruned > 0) onProgress?.(`Pruned ${pruned} unlisted/short videos from previous sync`);
  } catch (_) {}

  return {
    total_fetched:      videoIds.length,
    total_saved:        saved,
    linked_to_projects: withProject,
    public:             linked.length, // all saved are now public long-form only
    note:               'Shorts and unlisted excluded',
  };
}

module.exports = { syncYouTubeHistory };
