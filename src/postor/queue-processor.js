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
          privacyStatus: item.yt_privacy || 'public', // PB3 fix: was 'privacy:', uploadVideo expects 'privacyStatus'
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

  // ── Publish fan-out: close 3 dead loops when a video fully ships ──────────
  // 1. idea.status → 'produced'  (constellation shows output, no duplicate ideation invite)
  // 2. Post-Mortem seeded         (learning loop trigger — creator fills it in after the video)
  if (allOk) {
    try {
      firePublishFanOut(item);
    } catch (fanOutErr) {
      console.warn('[postor/queue] publish fan-out failed (non-fatal):', fanOutErr.message);
    }
  }
}

function tryParse(val) {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

// ── Publish fan-out ────────────────────────────────────────────────────────
// Fires when a queued item posts successfully to all platforms.
// Closes three dead feedback loops:
//   1. idea.status = 'produced'  — originating seed reflects real output
//   2. Post-Mortem seeded         — blank brief created so creator has somewhere to reflect
//   3. (BroadcastChannel already fired from postor.html for Mission Control cutscene)
function firePublishFanOut(item) {
  // Derive project from the video_path → footage.project_id
  const rawDb = db.getRawDb();
  let projectId = null;

  try {
    const fp = item.video_path;
    const fwd  = fp.replace(/\\/g, '/');
    const back = fp.replace(/\//g, '\\');
    const footage = rawDb.prepare(
      `SELECT project_id FROM footage WHERE
         file_path = ? OR proxy_path = ? OR
         file_path = ? OR proxy_path = ? OR
         file_path = ? OR proxy_path = ?
       LIMIT 1`
    ).get(fp, fp, fwd, fwd, back, back);
    if (footage?.project_id) projectId = footage.project_id;
  } catch (_) {}

  if (!projectId) {
    console.log('[postor/fanout] No project_id found for video_path — skipping fan-out');
    return;
  }

  const project = db.getProject(projectId);
  if (!project) return;

  // 1. Mark the originating SeedΩr idea as 'produced'
  try {
    const id8r = tryParse(project.id8r_data);
    const ideaId = id8r?.ideaId || id8r?.fromIdeaVault && id8r?.ideaId;
    if (ideaId) {
      rawDb.prepare(
        `UPDATE ideas SET status = 'produced', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(ideaId);
      console.log(`[postor/fanout] Idea #${ideaId} → produced`);
    }
  } catch (e) {
    console.warn('[postor/fanout] idea update failed:', e.message);
  }

  // 2. Seed a blank Post-Mortem brief (status: 'seeded') so the creator has somewhere to reflect
  // The brief is empty — creator fills it in via the Post-Mortem panel after watching performance
  try {
    const existing = rawDb.prepare(
      `SELECT id FROM post_mortem_briefs WHERE project_id = ? AND status IN ('active','seeded') LIMIT 1`
    ).get(projectId);
    if (!existing) {
      rawDb.prepare(
        `INSERT INTO post_mortem_briefs (project_id, video_title, root_cause, adjustments, avoid, status)
         VALUES (?, ?, '', '', '', 'seeded')`
      ).run(projectId, project.title || 'Untitled');
      console.log(`[postor/fanout] Post-Mortem seeded for project #${projectId}`);
    }
  } catch (e) {
    console.warn('[postor/fanout] Post-Mortem seed failed:', e.message);
  }
}

function start() {
  if (started) return;
  started = true;

  // PB4 fix: recover items stuck in 'posting' from a previous crash/restart
  try {
    db.getRawDb().prepare("UPDATE postor_queue SET status='pending' WHERE status='posting'").run();
  } catch (_) {}

  let running = false; // PB1 fix: overlap guard — known issue #2

  const run = async () => {
    // PB1 fix: prevent concurrent runs — a slow upload (IG 3min, TikTok 2.5min) would
    // otherwise cause the next 60s tick to start a second run() and double-fire posts
    if (running) return;
    running = true;
    try {
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
    } finally {
      running = false;
    }
  };

  // Delay first run 2s to ensure DB is fully initialized, then every 60 seconds
  setTimeout(() => run().catch(err => console.error('[postor/queue] Initial run error:', err.message)), 2000);
  setInterval(() => run().catch(err => console.error('[postor/queue] Run error:', err.message)), 60_000);
  console.log('[postor/queue] Queue processor started (60s interval)');
}

module.exports = { start };
