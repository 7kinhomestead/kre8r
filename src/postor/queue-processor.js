'use strict';

/**
 * PostΩr Queue Processor
 *
 * Runs every 60 seconds. Picks up pending postor_queue items whose
 * scheduled_at <= now, fires them through the same posting logic as
 * the immediate-post route, and marks them posted or failed.
 *
 * Started from server.js after DB init.
 */

const db   = require('../db');
const meta = require('./meta');
const path = require('path');
const fs   = require('fs');

// ── MarkΩr: watermark before upload ───────────────────────────────────────
// If the video hasn't been watermarked yet, embed watermark and use the
// watermarked copy for the upload. Falls back to original if embed fails.
async function maybeWatermark(item) {
  if (!item.video_path || !fs.existsSync(item.video_path)) return item.video_path;

  // Check if already watermarked
  const existing = db.getWatermarkByPath(item.video_path);
  if (existing && existing.watermarked_path && fs.existsSync(existing.watermarked_path)) {
    console.log(`[postor/queue] Using existing watermark for item #${item.id}`);
    return existing.watermarked_path;
  }

  try {
    const { watermarkVideo } = require('../markr/watermark');
    const result = await watermarkVideo(item.video_path, {
      channel: (item.platforms && JSON.parse(item.platforms || '[]')[0]) || 'original',
    }, {
      outputDir: path.dirname(item.video_path),
    });
    console.log(`[postor/queue] Watermarked item #${item.id} → ${result.watermarkedPath}`);
    return result.watermarkedPath;
  } catch (err) {
    console.warn(`[postor/queue] Watermark failed for item #${item.id} (continuing without): ${err.message}`);
    return item.video_path; // fallback to original
  }
}

let started = false;

async function processItem(item) {
  console.log(`[postor/queue] Firing queued post #${item.id} — ${item.title || item.video_path}`);
  db.updatePostorQueueItem(item.id, { status: 'posting' });

  const platforms = tryParse(item.platforms) || [];
  const ytTags    = tryParse(item.yt_tags)   || [];
  const results   = {};

  // ── MarkΩr: embed watermark before upload (video posts only) ──────────────
  const hasVideoUpload = platforms.some(p => ['instagram', 'facebook', 'youtube', 'tiktok'].includes(p));
  let videoPath = item.video_path;
  if (hasVideoUpload && videoPath) {
    videoPath = await maybeWatermark(item).catch(err => {
      console.warn(`[postor/queue] maybeWatermark threw for item #${item.id}: ${err.message}`);
      return item.video_path;
    });
  }

  for (const platform of platforms) {
    try {
      if (platform === 'instagram') {
        const r = await meta.publishInstagramReel({
          videoPath: videoPath,
          caption:   item.ig_caption || item.description || '',
        });
        results.instagram = r;

      } else if (platform === 'facebook') {
        const r = await meta.publishFacebookVideo({
          videoPath:   videoPath,
          title:       item.title       || '',
          description: item.fb_description || item.description || '',
        });
        results.facebook = r;

      } else if (platform === 'youtube') {
        // YouTube requires OAuth refresh — use the existing yt module
        const yt = require('./youtube');
        const r  = await yt.uploadVideo({
          videoPath:   videoPath,
          title:       item.title       || '',
          description: item.description || '',
          privacy:     item.yt_privacy  || 'public',
          tags:        ytTags,
          categoryId:  item.yt_category_id || 22,
          scheduledAt: item.yt_scheduled_at || null,
        });
        results.youtube = r;

      } else if (platform === 'facebook_post') {
        const r = await meta.publishFacebookPost({
          caption:   item.ig_caption || item.description || '',
          imagePath: item.image_path || null,
        });
        results.facebook_post = r;

      } else if (platform === 'tiktok') {
        const tt = require('./tiktok');
        const r  = await tt.uploadVideo({
          videoPath:          videoPath,
          title:              item.title || item.description || '',
          privacyLevel:       item.tt_privacy        || 'PUBLIC_TO_EVERYONE',
          disableDuet:        !!item.tt_disable_duet,
          disableComment:     !!item.tt_disable_comment,
          disableStitch:      !!item.tt_disable_stitch,
          brandContentToggle: !!item.tt_brand_content,
          brandOrganicToggle: !!item.tt_brand_organic,
        });
        results.tiktok = r;
      }

    } catch (err) {
      console.error(`[postor/queue] ${platform} failed for item #${item.id}:`, err.message);
      results[platform] = { ok: false, error: err.message };
    }
  }

  const allOk  = Object.values(results).every(r => r.ok);
  const anyOk  = Object.values(results).some(r => r.ok);
  const status = allOk ? 'posted' : anyOk ? 'partial' : 'failed';

  db.updatePostorQueueItem(item.id, {
    status,
    result: JSON.stringify(results),
    error:  allOk ? null : Object.entries(results)
      .filter(([, r]) => !r.ok)
      .map(([p, r]) => `${p}: ${r.error}`)
      .join('; '),
  });

  console.log(`[postor/queue] Item #${item.id} → ${status}`);
}

function tryParse(val) {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

function start() {
  if (started) return;
  started = true;

  const run = async () => {
    let items;
    try {
      items = db.getPendingQueueItems();
    } catch (err) {
      console.error('[postor/queue] DB not ready yet:', err.message);
      return;
    }
    for (const item of items) {
      await processItem(item).catch(err =>
        console.error(`[postor/queue] Unhandled error on item #${item.id}:`, err.message)
      );
    }
  };

  // Delay first run 2s to ensure DB is fully initialized, then every 60 seconds
  setTimeout(() => run().catch(err => console.error('[postor/queue] Initial run error:', err.message)), 2000);
  setInterval(() => run().catch(err => console.error('[postor/queue] Run error:', err.message)), 60_000);
  console.log('[postor/queue] Queue processor started (60s interval)');
}

module.exports = { start };
