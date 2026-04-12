/**
 * Releases — src/routes/releases.js
 *
 * Handles desktop app update distribution.
 * Files are saved to public/downloads/ and served as static assets.
 *
 * POST /api/releases/upload   — upload installer + latest.yml (operator secret)
 * GET  /api/releases/latest   — returns current version info (public)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const log     = require('../utils/logger');

const DOWNLOADS_DIR = path.join(__dirname, '../../public/downloads');

// Ensure downloads dir exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Multer: save directly to public/downloads with original filename
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOWNLOADS_DIR),
  filename:    (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// ── Operator auth ──────────────────────────────────────────────────────────────
function requireUploadSecret(req, res, next) {
  const secret       = process.env.RELEASE_UPLOAD_SECRET || process.env.OPERATOR_SECRET;
  const providedKey  = req.headers['x-upload-secret'] || req.query.secret;
  if (secret && providedKey !== secret) {
    return res.status(403).json({ error: 'Upload secret required' });
  }
  next();
}

// ── POST /api/releases/upload ──────────────────────────────────────────────────
// Accepts: installer (.exe / .dmg), latest.yml, blockmap file
// curl example:
//   node scripts/deploy-update.js
router.post('/upload',
  requireUploadSecret,
  upload.fields([
    { name: 'installer', maxCount: 1 },
    { name: 'yml',       maxCount: 1 },
    { name: 'blockmap',  maxCount: 1 },
  ]),
  (req, res) => {
    const files = req.files || {};
    const saved = [];

    if (files.installer) saved.push(files.installer[0].originalname);
    if (files.yml)       saved.push(files.yml[0].originalname);
    if (files.blockmap)  saved.push(files.blockmap[0].originalname);

    if (!saved.length) {
      return res.status(400).json({ error: 'No files received' });
    }

    log.info({ module: 'releases', files: saved }, 'Release uploaded');
    res.json({ ok: true, files: saved });
  }
);

// ── GET /api/releases/latest ───────────────────────────────────────────────────
// Returns parsed latest.yml for the download page to display version info.
router.get('/latest', (req, res) => {
  const ymlPath = path.join(DOWNLOADS_DIR, 'latest.yml');
  if (!fs.existsSync(ymlPath)) {
    return res.json({ available: false });
  }
  try {
    const raw     = fs.readFileSync(ymlPath, 'utf8');
    const version = (raw.match(/^version:\s*(.+)$/m) || [])[1]?.trim() || 'unknown';
    const date    = (raw.match(/^releaseDate:\s*(.+)$/m) || [])[1]?.trim() || null;
    res.json({
      available:   true,
      version,
      releaseDate: date,
      // Always use the proxy download endpoint — avoids Unicode/space URL issues
      downloadUrl: '/api/releases/download',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/releases/download ─────────────────────────────────────────────────
// Streams the installer file — sidesteps Unicode/space filename URL problems.
router.get('/download', (req, res) => {
  const files = fs.readdirSync(DOWNLOADS_DIR);
  const exe   = files.find(f => f.endsWith('.exe') && !f.endsWith('.blockmap'));
  if (!exe) {
    return res.status(404).json({ error: 'No installer available' });
  }
  const filePath = path.join(DOWNLOADS_DIR, exe);
  res.setHeader('Content-Disposition', `attachment; filename="Kre8r-Setup.exe"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(filePath);
});

module.exports = router;
