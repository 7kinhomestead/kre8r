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

let started = false;

async function processItem(item) {
  console.log(`[postor/queue] Firing queued post #${item.id} — ${item.title || item.video_path}`);
  db.updatePostorQueueItem(item.id, { status: 'posting' });

  const platforms = tryParse(item.platforms) || [];
  const ytTags    = tryParse(item.yt_tags)   || [];
  const results   = {};

  for (const platform of platforms) {
    try {
      if (platform === 'instagram') {
        const r = await meta.publishInstagramReel({
          videoPath: item.video_path,
          caption:   item.ig_caption || item.description || '',
        });
        results.instagram = r;

      } else if (platform === 'facebook') {
        const r = await meta.publishFacebookVideo({
          videoPath:   item.video_path,
          title:       item.title       || '',
          description: item.fb_description || item.description || '',
        });
        results.facebook = r;

      } else if (platform === 'youtube') {
        // YouTube requires OAuth refresh — use the existing yt module
        const yt = require('./youtube');
        const r  = await yt.uploadVideo({
          videoPath:   item.video_path,
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
    const items = db.getPendingQueueItems();
    for (const item of items) {
      await processItem(item).catch(err =>
        console.error(`[postor/queue] Unhandled error on item #${item.id}:`, err.message)
      );
    }
  };

  // Run immediately on start, then every 60 seconds
  run();
  setInterval(run, 60_000);
  console.log('[postor/queue] Queue processor started (60s interval)');
}

module.exports = { start };
