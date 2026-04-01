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
const { ingestFolder, ingestFile, checkFfmpeg, reclassifyById } = require('../vault/intake');
const { startWatcher, stopWatcher, getWatcherStatus } = require('../vault/watcher');
const { organizeFile, organizeAll } = require('../vault/organizer');

// multer — in-memory, we only need the path sent in the JSON body
// (actual folder intake uses the File System Access API on the client side)
const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────────
// multer — disk storage for direct video uploads
// Saves to /home/kre8r/kre8r/uploads (cloud) or ./uploads (local)
// ─────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (_req, file, cb) => {
      // Preserve original name but prefix with timestamp to avoid collisions
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max
  fileFilter: (_req, file, cb) => {
    const ALLOWED = new Set(['.mp4', '.mov', '.mts', '.avi', '.mkv', '.braw', '.r3d', '.ari']);
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED.has(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}`));
  }
});

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
// PATCH /api/vault/footage/bulk-assign
// Body: { footage_ids: [1,2,3], project_id: X }
// Must be defined before /:id to avoid param capture
// ─────────────────────────────────────────────
router.patch('/footage/bulk-assign', (req, res) => {
  const { footage_ids, project_id } = req.body;
  if (!footage_ids || !Array.isArray(footage_ids) || footage_ids.length === 0) {
    return res.status(400).json({ error: 'footage_ids array is required' });
  }
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  try {
    for (const id of footage_ids) {
      db.updateFootage(parseInt(id), { project_id: parseInt(project_id) });
    }
    res.json({ ok: true, updated: footage_ids.length });
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
// POST /api/vault/footage/:id/reclassify
// Re-run Claude Vision on an existing clip's thumbnails
// ─────────────────────────────────────────────
router.post('/footage/:id/reclassify', async (req, res) => {
  try {
    const result = await reclassifyById(parseInt(req.params.id));
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/reclassify-missing
// Re-run Vision on all footage where description or quality_flag is null.
// Streams SSE progress when Accept: text/event-stream.
// ─────────────────────────────────────────────
router.post('/reclassify-missing', async (req, res) => {
  const useSSE = req.headers.accept === 'text/event-stream';

  if (useSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  const send = useSSE
    ? (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    : () => {};

  try {
    // Find all footage missing description or quality_flag, skipping BRAW stubs
    // (BRAW stubs have no thumbnails — they need a proxy first)
    const all = db.getAllFootage({});
    const missing = all.filter(f =>
      (!f.description || !f.quality_flag) &&
      f.thumbnail_path !== null &&
      f.codec !== 'BRAW'
    );

    send({ stage: 'discovered', total: missing.length });

    const results = { ok: 0, failed: 0, errors: [] };

    for (let i = 0; i < missing.length; i++) {
      const f = missing[i];
      send({ stage: 'processing', index: i + 1, total: missing.length, file: f.original_filename });
      try {
        const classification = await reclassifyById(f.id);
        results.ok++;
        send({ stage: 'classified', index: i + 1, total: missing.length, file: f.original_filename, classification });
      } catch (e) {
        results.failed++;
        results.errors.push({ id: f.id, file: f.original_filename, error: e.message });
        send({ stage: 'error', file: f.original_filename, error: e.message });
      }
    }

    const summary = { total: missing.length, ...results };
    send({ stage: 'done', summary });

    if (useSSE) {
      res.end();
    } else {
      res.json(summary);
    }
  } catch (e) {
    if (useSSE) {
      res.write(`data: ${JSON.stringify({ stage: 'error', error: e.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: e.message });
    }
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
// POST /api/vault/upload
// Multipart video upload → saves to UPLOAD_DIR → runs intake pipeline
// Streams SSE progress so the client can show a live progress bar.
// Field name: "video"   Optional field: "project_id"
// ─────────────────────────────────────────────
router.post('/upload', (req, res) => {
  // Stream SSE immediately so the client gets progress from byte-one
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  // Run multer then intake pipeline
  videoUpload.single('video')(req, res, async (multerErr) => {
    if (multerErr) {
      send({ stage: 'error', error: multerErr.message });
      return res.end();
    }

    if (!req.file) {
      send({ stage: 'error', error: 'No video file received' });
      return res.end();
    }

    const savedPath  = req.file.path;
    const origName   = req.file.originalname;
    const projectId  = req.body?.project_id ? parseInt(req.body.project_id) : null;

    send({ stage: 'uploaded', file: origName, size: req.file.size, path: savedPath });
    send({ stage: 'ingesting', file: origName });

    try {
      const result = await ingestFile(savedPath, {
        projectId,
        originalFilename: origName,
        onProgress: send
      });

      if (result.ok) {
        send({ stage: 'done', file: origName, footage_id: result.footage_id ?? null });
      } else {
        // Clean up failed upload
        try { fs.unlinkSync(savedPath); } catch (_) {}
        send({ stage: 'error', error: result.error || 'Ingest failed' });
      }
    } catch (e) {
      try { fs.unlinkSync(savedPath); } catch (_) {}
      send({ stage: 'error', error: e.message });
    }

    res.end();
  });
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
