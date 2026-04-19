'use strict';

/**
 * MarkΩr — API Routes
 *
 * POST /api/markr/fingerprint-vault   — batch fingerprint all unfingerprinited vault footage
 * GET  /api/markr/fingerprint-vault   — SSE progress stream for the batch job
 * POST /api/markr/fingerprint/:id     — fingerprint a single footage item
 * POST /api/markr/check               — detection endpoint (accepts file path)
 * GET  /api/markr/watermarks          — watermark registry
 * GET  /api/markr/watermarks/stats    — count stats
 * GET  /api/markr/reports             — guard reports inbox
 * GET  /api/markr/reports/:id         — single report
 * PATCH /api/markr/reports/:id        — update report status / claim info
 * GET  /api/markr/stats               — overall MarkΩr stats (dashboard)
 */

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');

const db          = require('../db');
const { attachSseStream, startSseResponse } = require('../utils/sse');
const { fingerprintVideo, fingerprintAudio } = require('../markr/fingerprint');
const { watermarkVideo } = require('../markr/watermark');
const { detectInVideo }  = require('../markr/detect');
const log = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────
// Batch fingerprint vault
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/markr/fingerprint-vault
 * Starts a batch job to fingerprint all un-fingerprinted vault footage.
 * Returns SSE stream with progress events.
 */
router.post('/fingerprint-vault', async (req, res) => {
  const { type = 'visual' } = req.body; // 'visual' | 'audio' | 'both'

  // Start SSE stream
  const { send, end } = startSseResponse(res);

  setImmediate(async () => {
    try {
      const footage = db.getUnfingerprintedFootage();
      if (!footage.length) {
        send('done', { message: 'All vault footage already fingerprinted.', count: 0 });
        end();
        return;
      }

      send('start', { total: footage.length, type });

      let ok = 0, failed = 0;

      for (let i = 0; i < footage.length; i++) {
        const item = footage[i];
        const videoPath = item.proxy_path || item.file_path;

        if (!videoPath || !fs.existsSync(videoPath)) {
          send('skip', { index: i, total: footage.length, filename: item.filename, reason: 'file not found' });
          continue;
        }

        send('progress', {
          index: i,
          total: footage.length,
          filename: item.filename || path.basename(videoPath),
          status: 'processing',
        });

        try {
          if (type === 'visual' || type === 'both') {
            await fingerprintVideo(videoPath, item.id);
          }
          if (type === 'audio' || type === 'both') {
            await fingerprintAudio(videoPath, item.id);
          }
          ok++;
          send('progress', {
            index: i,
            total: footage.length,
            filename: item.filename || path.basename(videoPath),
            status: 'done',
          });
        } catch (err) {
          failed++;
          log.error({ err, videoPath }, '[markr/fingerprint-vault] Failed to fingerprint');
          send('progress', {
            index: i,
            total: footage.length,
            filename: item.filename || path.basename(videoPath),
            status: 'error',
            error: err.message,
          });
        }
      }

      send('done', { total: footage.length, ok, failed });
    } catch (err) {
      log.error({ err }, '[markr/fingerprint-vault] Batch job error');
      send('error', { message: err.message });
    } finally {
      end();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Fingerprint a single footage item
// ─────────────────────────────────────────────────────────────────

router.post('/fingerprint/:id', async (req, res) => {
  try {
    const footageId = parseInt(req.params.id, 10);
    const footage = db.getFootageById(footageId);
    if (!footage) return res.status(404).json({ error: 'Footage not found' });

    const videoPath = footage.proxy_path || footage.file_path;
    if (!videoPath || !fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Video file not found on disk' });
    }

    const [visual, audio] = await Promise.all([
      fingerprintVideo(videoPath, footageId),
      fingerprintAudio(videoPath, footageId),
    ]);

    res.json({
      ok: true,
      footage_id: footageId,
      visual_frames: visual.frameCount,
      visual_skipped: visual.skipped || false,
      audio_skipped: audio.skipped || false,
    });
  } catch (err) {
    log.error({ err }, '[markr] Single fingerprint error');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Detection endpoint
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/markr/check
 * Body: { video_path: string }  (absolute path to video to check)
 *
 * Runs all detection layers and returns the result.
 * Used internally by GuardΩr submission handler.
 */
router.post('/check', async (req, res) => {
  try {
    const { video_path } = req.body;
    if (!video_path) return res.status(400).json({ error: 'video_path required' });
    if (!fs.existsSync(video_path)) return res.status(400).json({ error: 'File not found on disk' });

    const result = await detectInVideo(video_path, { runWatermark: true });
    res.json({ ok: true, result });
  } catch (err) {
    log.error({ err }, '[markr/check] Detection error');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Watermark registry
// ─────────────────────────────────────────────────────────────────

router.get('/watermarks', (req, res) => {
  try {
    const watermarks = db.getAllWatermarks();
    res.json({ ok: true, watermarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/watermarks/stats', (req, res) => {
  try {
    const stats = db.getWatermarkStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Guard reports inbox
// ─────────────────────────────────────────────────────────────────

router.get('/reports', (req, res) => {
  try {
    const { status } = req.query;
    const reports = db.getAllGuardReports({ status });
    res.json({ ok: true, reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/:id', (req, res) => {
  try {
    const report = db.getGuardReport(parseInt(req.params.id, 10));
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/reports/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, claim_platform, claim_reference } = req.body;
    db.updateGuardReport(id, { status, claim_platform, claim_reference });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Overall stats dashboard
// ─────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const watermarkStats  = db.getWatermarkStats()  || {};
    const videoFpStats    = db.getVideoFingerprintStats() || {};
    const audioFpStats    = db.getAudioFingerprintStats() || {};
    const reportStats     = db.getGuardReportStats() || {};

    res.json({
      ok: true,
      watermarks: {
        total:          watermarkStats.total         || 0,
        unique_videos:  watermarkStats.unique_videos || 0,
        last_embedded:  watermarkStats.last_embedded || null,
      },
      fingerprints: {
        videos_visual:  videoFpStats.videos_fingerprinted || 0,
        frames_total:   videoFpStats.total_frames         || 0,
        videos_audio:   audioFpStats.videos_fingerprinted || 0,
        audio_duration: audioFpStats.total_duration_s     || 0,
      },
      reports: {
        total:     reportStats.total     || 0,
        pending:   reportStats.pending   || 0,
        confirmed: reportStats.confirmed || 0,
        filed:     reportStats.filed     || 0,
        resolved:  reportStats.resolved  || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// Watermark a single video (on-demand)
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/markr/watermark
 * Body: { video_path, footage_id?, channel? }
 *
 * Embeds watermark and returns the output path.
 * SSE for progress.
 */
router.post('/watermark', async (req, res) => {
  const { video_path, footage_id, channel = 'original' } = req.body;
  if (!video_path) return res.status(400).json({ error: 'video_path required' });
  if (!fs.existsSync(video_path)) return res.status(400).json({ error: 'File not found' });

  const { send, end } = startSseResponse(res);

  setImmediate(async () => {
    try {
      send('start', { video_path });
      const result = await watermarkVideo(video_path, {
        footageId: footage_id || null,
        channel,
      }, {
        onProgress: p => send('progress', p),
      });
      send('done', {
        watermark_id:     result.watermarkId,
        watermarked_path: result.watermarkedPath,
        seed:             result.seed,
        watermark_code:   result.watermarkCode,
      });
    } catch (err) {
      log.error({ err }, '[markr/watermark] Embed error');
      send('error', { message: err.message });
    } finally {
      end();
    }
  });
});

module.exports = router;
