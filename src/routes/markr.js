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

// ─────────────────────────────────────────────────────────────────
// DMCA notice generator
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/markr/generate-dmca/:reportId
 * Streams a Claude-generated DMCA notice based on the report evidence.
 * Uses SSE (text/event-stream) — client reads with fetch + ReadableStream.
 *
 * Query param: ?platform=youtube|tiktok|instagram|facebook|generic
 */
router.post('/generate-dmca/:reportId', async (req, res) => {
  const reportId = parseInt(req.params.reportId, 10);
  const platform = req.query.platform || req.body?.platform || 'generic';

  let report;
  try {
    report = db.getGuardReport(reportId);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!report) return res.status(404).json({ error: 'Report not found' });

  // Load creator profile for ownership fields
  const { loadProfile } = require('../utils/profile-validator');
  let creatorName  = '7 Kin Homestead';
  let creatorEmail = '7kinmedia@gmail.com';
  try {
    const { profile } = loadProfile();
    creatorName  = profile.creator?.name  || creatorName;
    creatorEmail = profile.creator?.email || creatorEmail;
  } catch (_) {}

  // Build evidence summary
  let evidenceSummary = '';
  if (report.match_confidence) {
    const pct = Math.round(report.match_confidence * 100);
    evidenceSummary += `Detection confidence: ${pct}%.\n`;
  }
  if (report.match_type) {
    evidenceSummary += `Detection method: ${report.match_type}.\n`;
  }
  if (report.matched_video_title) {
    evidenceSummary += `Matched original video: "${report.matched_video_title}".\n`;
  }

  // Platform-specific filing instructions
  const platformInstructions = {
    youtube:   'The infringing content should be reported via youtube.com/copyright_complaint_form. Reference the Video ID and use the "It uses my copyrighted content" option.',
    instagram: 'File via Meta\'s Rights Manager at business.facebook.com/creatorstudio or via the in-app "Report" > "Intellectual property" > "Copyright" flow on the specific post.',
    facebook:  'File via Meta\'s Rights Manager at business.facebook.com/creatorstudio or via facebook.com/help/contact/1408150095888978.',
    tiktok:    'Submit via tiktok.com/legal/report/copyright or through the in-app "Report" > "Intellectual property infringement" option on the specific video.',
    generic:   'Send this notice to the platform\'s designated DMCA agent. Most platforms have a copyright/legal contact listed in their Terms of Service.',
  };

  const filingNote = platformInstructions[platform] || platformInstructions.generic;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `You are drafting a formal DMCA takedown notice on behalf of a content creator. Write a complete, professional, legally-formatted DMCA notice.

CREATOR INFORMATION:
- Name / Channel: ${creatorName}
- Contact email: ${creatorEmail}
- Platform where original content was published: YouTube (@7KinHomestead), TikTok (@7.kin.jason), Instagram (@7.kin.jason)

INFRINGING CONTENT:
- Platform: ${platform}
- URL / Reference: ${report.submitted_url || report.claim_reference || 'See attached evidence'}
- Report type: ${report.report_type || 'direct_repost'}

ORIGINAL WORK:
- Title: ${report.matched_video_title || 'Original video content by ' + creatorName}
- Published by: ${creatorName}
- Evidence: ${evidenceSummary || 'Visual and audio fingerprint match confirmed by automated detection system.'}

PLATFORM FILING NOTE:
${filingNote}

Write the complete DMCA notice with these sections:
1. Identification of the copyrighted work
2. Identification of the infringing material (URL/location)
3. Contact information for the complainant
4. Statement of good faith belief
5. Statement of accuracy under penalty of perjury
6. Electronic signature block

Use formal legal language. Include the date: ${today}. Make it ready to copy and submit directly. Do not include any preamble or explanation — just the notice itself.`;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendSse = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

    const stream = await anthropic.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }],
    });

    sendSse('start', { report_id: reportId, platform });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        sendSse('token', { text: chunk.delta.text });
      }
    }

    const final = await stream.finalMessage();
    const fullText = final.content?.[0]?.text || '';
    sendSse('done', { full_text: fullText });

  } catch (err) {
    log.error({ err, reportId }, '[markr/generate-dmca] Claude error');
    sendSse('error', { message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
