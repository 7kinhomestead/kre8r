'use strict';

/**
 * GuardΩr — Public Fan-Facing Routes
 *
 * ALL routes here are PUBLIC — no session auth required.
 * Whitelisted in server.js auth middleware.
 *
 * GET  /api/guard/:slug/info       — creator branding + community counter
 * POST /api/guard/:slug/submit     — fan report submission (URL + optional file)
 * GET  /api/guard/:slug/counter    — live counter for community widget
 *
 * The slug maps to the creator instance.
 * For now: single-tenant — slug must match the local creator-profile.json.
 * Future: multi-tenant DB lookup by tenant_slug.
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const crypto  = require('crypto');

const db  = require('../db');
const log = require('../utils/logger');
const { loadProfile } = require('../utils/profile-validator');

// ─────────────────────────────────────────────────────────────────
// Upload config — guard submissions go to uploads/guard/
// ─────────────────────────────────────────────────────────────────

const GUARD_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'guard');
fs.mkdirSync(GUARD_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, GUARD_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.bin';
    const name = `report-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only images and video files are accepted'));
  },
});

// ─────────────────────────────────────────────────────────────────
// Slug resolution — maps URL slug → creator profile
// ─────────────────────────────────────────────────────────────────

/**
 * Derive the guard slug from a creator profile.
 * Priority: profile.guard_slug → instance stripped of hyphens → tiktok handle
 */
function getGuardSlug(profile) {
  if (profile.guard_slug) return profile.guard_slug;
  if (profile.instance)   return profile.instance.replace(/-/g, '');
  const ttHandle = profile.platforms?.tiktok?.handle;
  if (ttHandle) return ttHandle.replace('@', '');
  return 'unknown';
}

function resolveCreator(slug) {
  try {
    const profile = loadProfile();
    const mySlug  = getGuardSlug(profile);
    if (slug !== mySlug) return null;
    return { profile, slug: mySlug };
  } catch (e) {
    log.error({ e }, '[guard] Failed to load creator profile');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/guard/:slug/info
// ─────────────────────────────────────────────────────────────────

router.get('/:slug/info', (req, res) => {
  const creator = resolveCreator(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Creator not found' });

  const { profile } = creator;
  const stats = db.getGuardReportStats() || {};

  // Community counter: confirmed + filed + resolved violations
  const violations = (stats.confirmed || 0) + (stats.filed || 0) + (stats.resolved || 0);
  const reports    = stats.total || 0;

  res.json({
    ok: true,
    slug:         creator.slug,
    creator_name: profile.creator?.name    || 'The Creator',
    brand:        profile.creator?.brand   || '7 Kin Homestead',
    tagline:      profile.creator?.tagline || '',
    niche:        profile.creator?.niche   || '',
    platforms:    Object.keys(profile.platforms || {}),
    community: {
      violations,
      reports,
    },
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/guard/:slug/counter
// ─────────────────────────────────────────────────────────────────

router.get('/:slug/counter', (req, res) => {
  const creator = resolveCreator(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Creator not found' });

  const stats = db.getGuardReportStats() || {};
  const violations = (stats.confirmed || 0) + (stats.filed || 0) + (stats.resolved || 0);
  res.json({ ok: true, violations, total_reports: stats.total || 0 });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/guard/:slug/submit
// ─────────────────────────────────────────────────────────────────

router.post('/:slug/submit', upload.single('file'), async (req, res) => {
  const creator = resolveCreator(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Creator not found' });

  const { submitted_url, submitter_note, platform, report_type } = req.body;
  const uploadedFile = req.file;

  // Must have at least a URL or a file
  if (!submitted_url && !uploadedFile) {
    return res.status(400).json({ error: 'Please provide a URL or upload a file' });
  }

  let detection = null;

  // Run detection on uploaded file if present
  if (uploadedFile) {
    try {
      const { detectInVideo } = require('../markr/detect');
      detection = await detectInVideo(uploadedFile.path, { runWatermark: true });
    } catch (err) {
      log.warn({ err, file: uploadedFile.path }, '[guard/submit] Detection failed — logging report without result');
      detection = { verdict: 'error', overall_confidence: 0, match_type: 'none', error: err.message };
    }
  }

  const verdict    = detection?.verdict || 'none';
  const confidence = detection?.overall_confidence || 0;
  const matchType  = detection?.match_type || null;
  const evidenceJson = detection ? JSON.stringify(detection) : null;

  // Insert guard report
  // Legitimate use types — these auto-populate the inbox with a yellow flag
  // so Jason can dismiss them in one click without reviewing the evidence
  const LEGIT_TYPES = ['stitch_duet', 'reaction', 'licensed'];
  const isLikelyLegit = LEGIT_TYPES.includes(report_type) ? 1 : 0;

  const result = db.insertGuardReport({
    submitted_url:       submitted_url    || null,
    submitted_file_path: uploadedFile?.path || null,
    submitter_note:      submitter_note   || null,
    platform:            platform         || null,
    report_type:         report_type      || 'direct_repost',
    match_type:          matchType,
    match_confidence:    confidence,
    matched_footage_id:  detection?.matched_footage_id  || null,
    matched_video_title: detection?.matched_video_title || null,
    evidence_json:       evidenceJson,
  });

  const reportId = result.lastInsertRowid;
  log.info({ reportId, verdict, confidence }, '[guard/submit] Report created');

  // Format response for the fan UI
  res.json({
    ok:                  true,
    report_id:           reportId,
    verdict,
    confidence,
    match_type:          matchType,
    report_type:         report_type || 'direct_repost',
    is_likely_legitimate: isLikelyLegit === 1,
    matched_video_title: detection?.matched_video_title || null,
    evidence:            detection?.evidence || null,
  });
});

module.exports = router;
