/**
 * VaultΩr API routes — /api/vault
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../db');
const { ingestFolder, ingestFile, checkFfmpeg } = require('../vault/intake');
const { startWatcher, stopWatcher, getWatcherStatus } = require('../vault/watcher');
const { organizeFile, organizeAll } = require('../vault/organizer');

// multer — in-memory, we only need the path sent in the JSON body
// (actual folder intake uses the File System Access API on the client side)
const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────────
// GET /api/vault/status — ffmpeg check + stats
// ─────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const ffmpegOk = await checkFfmpeg();
    const stats    = db.getFootageStats();
    res.json({ ffmpeg: ffmpegOk, ...stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/ingest — ingest a folder
// Body: { folder_path, project_id? }
// ─────────────────────────────────────────────
router.post('/ingest', async (req, res) => {
  const { folder_path, project_id } = req.body;
  if (!folder_path) return res.status(400).json({ error: 'folder_path is required' });

  // Stream progress events via Server-Sent Events if client asks,
  // otherwise run and return JSON summary.
  const useSSE = req.headers.accept === 'text/event-stream';

  if (useSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const summary = await ingestFolder(folder_path, {
      projectId: project_id ? parseInt(project_id) : null,
      onProgress: send
    });

    send({ stage: 'done', summary });
    res.end();
  } else {
    const summary = await ingestFolder(folder_path, {
      projectId: project_id ? parseInt(project_id) : null
    });
    res.json(summary);
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/footage — list footage
// Query: shot_type, quality_flag, project_id, q (search)
// ─────────────────────────────────────────────
router.get('/footage', async (req, res) => {
  try {
    const { shot_type, quality_flag, project_id, q } = req.query;

    let footage;
    if (q && q.trim()) {
      // Natural language search via Claude → WHERE clause
      footage = await searchFootage(q.trim());
    } else {
      footage = db.getAllFootage({
        shot_type:    shot_type    || null,
        quality_flag: quality_flag || null,
        project_id:   project_id  ? parseInt(project_id) : null
      });
    }

    res.json(footage);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/footage/:id — single clip
// Includes last_modified from file system (best-effort)
// ─────────────────────────────────────────────
router.get('/footage/:id', (req, res) => {
  try {
    const record = db.getFootageById(parseInt(req.params.id));
    if (!record) return res.status(404).json({ error: 'Not found' });
    try {
      const stat = fs.statSync(record.file_path);
      record.last_modified = stat.mtime.toISOString();
    } catch (e) {
      record.last_modified = null;
    }
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/vault/footage/:id — update fields
// ─────────────────────────────────────────────
router.patch('/footage/:id', (req, res) => {
  try {
    db.updateFootage(parseInt(req.params.id), req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/search — natural language search
// Body: { q }
// ─────────────────────────────────────────────
router.post('/search', async (req, res) => {
  const { q } = req.body;
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const footage = await searchFootage(q);
    res.json(footage);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/organize — organize all unorganized footage
// Body: { project_id? }
// Supports SSE when Accept: text/event-stream
// ─────────────────────────────────────────────
router.post('/organize', async (req, res) => {
  const { project_id } = req.body || {};
  const useSSE = req.headers.accept === 'text/event-stream';

  if (useSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const summary = await organizeAll({
      projectId:  project_id ? parseInt(project_id) : null,
      onProgress: send
    });

    send({ stage: 'done', summary });
    res.end();
  } else {
    try {
      const summary = await organizeAll({
        projectId: project_id ? parseInt(project_id) : null
      });
      res.json(summary);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/footage/:id/organize — organize one clip
// ─────────────────────────────────────────────
router.post('/footage/:id/organize', async (req, res) => {
  try {
    const result = await organizeFile(parseInt(req.params.id));
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/distribution — all distribution records (bulk load)
// ─────────────────────────────────────────────
router.get('/distribution', (req, res) => {
  try {
    res.json(db.getAllDistribution());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/footage/:id/distribution
// ─────────────────────────────────────────────
router.get('/footage/:id/distribution', (req, res) => {
  try {
    res.json(db.getDistributionByFootage(parseInt(req.params.id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/footage/:id/distribution — mark as posted
// Body: { platform, posted_at?, post_url?, notes? }
// ─────────────────────────────────────────────
router.post('/footage/:id/distribution', (req, res) => {
  try {
    const footage_id = parseInt(req.params.id);
    const { platform, posted_at, post_url, notes } = req.body;
    if (!platform) return res.status(400).json({ error: 'platform is required' });
    const VALID = ['tiktok', 'youtube', 'facebook', 'instagram', 'lemon8', 'other'];
    if (!VALID.includes(platform)) return res.status(400).json({ error: `Invalid platform: ${platform}` });
    db.upsertDistribution({ footage_id, platform, posted_at: posted_at || new Date().toISOString(), post_url, posted_manually: 1, notes });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/vault/footage/:id/distribution/:platform
// ─────────────────────────────────────────────
router.delete('/footage/:id/distribution/:platform', (req, res) => {
  try {
    db.deleteDistribution(parseInt(req.params.id), req.params.platform);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/watcher — watcher status
// ─────────────────────────────────────────────
router.get('/watcher', (req, res) => {
  res.json(getWatcherStatus());
});

// ─────────────────────────────────────────────
// POST /api/vault/watcher/start — start watcher
// Body: { folder_path? }
// ─────────────────────────────────────────────
router.post('/watcher/start', (req, res) => {
  const result = startWatcher(req.body?.folder_path || null);
  res.json(result);
});

// ─────────────────────────────────────────────
// POST /api/vault/watcher/stop — stop watcher
// ─────────────────────────────────────────────
router.post('/watcher/stop', async (req, res) => {
  const result = await stopWatcher();
  res.json(result);
});

// ─────────────────────────────────────────────
// INTERNAL: natural language → SQL → results
// ─────────────────────────────────────────────
async function searchFootage(query) {
  // Lazy-require search module (built in Step 6)
  const { buildWhereClause } = require('../vault/search');
  const whereClause = await buildWhereClause(query);
  return db.searchFootageByWhere(whereClause);
}

module.exports = router;
