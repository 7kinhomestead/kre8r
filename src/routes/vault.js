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

    res.set('Cache-Control', 'no-store');
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
// If shot_type → completed-video and footage is linked to a project,
// auto-propagate: mark project editor_state = picture_lock, advance
// pipeline stage to distribution-ready, and note the completed video.
// ─────────────────────────────────────────────
router.patch('/footage/:id', (req, res) => {
  try {
    const footageId = parseInt(req.params.id);
    db.updateFootage(footageId, req.body);

    // ── Auto-signal: completed-video tagged ──────────────────────────────
    if (req.body.shot_type === 'completed-video') {
      const clip = db.getFootageById(footageId);
      const projectId = clip?.project_id;
      if (projectId) {
        const project = db.getProject(projectId);
        if (project) {
          // Mark editor done — picture lock
          db.updateProjectEditorState(projectId, 'picture_lock');
          // Advance pipeline to distribution stage if not already past it
          const distStages = ['M1','M2','M3','M4','M5'];
          const alreadyInDist = distStages.some(s => (project.current_stage || '').startsWith(s));
          if (!alreadyInDist) {
            db.updateProjectStage(projectId, 'M1');
          }
          console.log(`[VaultΩr] Auto-signal: footage ${footageId} tagged completed-video → project ${projectId} advanced to distribution (picture_lock)`);
        }
      }
    }

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
// BACKGROUND JOB RUNNER — reclassify-subjects
// Runs detached from any HTTP connection so navigating away doesn't kill it.
// ─────────────────────────────────────────────
async function runReclassifySubjectsJob(jobId) {
  try {
    const needsTag = db.getAllFootage().filter(f => !f.subjects && f.thumbnail_path);
    const total = needsTag.length;

    if (total === 0) {
      db.finishJob(jobId, { ok: 0, errors: 0, total: 0 });
      return;
    }

    let ok = 0, errors = 0;
    for (let i = 0; i < total; i++) {
      const f = needsTag[i];
      // Write current clip name into meta so the stream knows what's active
      db.updateJobProgress(jobId, { progress: i, total, ok, errors });
      try {
        await reclassifyById(f.id);
        ok++;
      } catch (e) {
        errors++;
        console.error(`[reclassify-subjects job ${jobId}] clip ${f.id} failed:`, e.message);
        await new Promise(r => setTimeout(r, 5000)); // back off 5s on API error
      }
      db.updateJobProgress(jobId, { progress: i + 1, total, ok, errors });
      await new Promise(r => setTimeout(r, 300)); // 300ms pacing between clips
    }

    db.finishJob(jobId, { ok, errors, total });
  } catch (e) {
    console.error(`[reclassify-subjects job ${jobId}] fatal:`, e.message);
    db.failJob(jobId, e.message);
  }
}

// ─────────────────────────────────────────────
// POST /api/vault/reclassify-subjects
// Starts a background job. Returns { job_id } immediately.
// If a job is already running, returns that job's id instead of starting a new one.
// ─────────────────────────────────────────────
router.post('/reclassify-subjects', (req, res) => {
  try {
    // Don't double-start if one is already running
    const existing = db.getActiveJobByType('reclassify-subjects');
    if (existing) return res.json({ job_id: existing.id, resumed: true });

    const job = db.createJob('reclassify-subjects');
    // Fire and forget — NOT awaited, runs independently of this HTTP request
    runReclassifySubjectsJob(job.id);
    res.json({ job_id: job.id, resumed: false });
  } catch (e) {
    console.error('[vault/reclassify-subjects]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/jobs/:id — current job state (for polling)
// ─────────────────────────────────────────────
router.get('/jobs/:id', (req, res) => {
  try {
    const job = db.getJob(parseInt(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/jobs/active/:type — check for a running job of a given type
// ─────────────────────────────────────────────
router.get('/jobs/active/:type', (req, res) => {
  try {
    const job = db.getActiveJobByType(req.params.type);
    res.json(job || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/vault/jobs/:id/stream — SSE progress stream (reconnectable)
// Client connects here to watch a job live. Can disconnect and reconnect freely.
// Polls DB every 1.5s and emits progress events until the job is done or errored.
// ─────────────────────────────────────────────
router.get('/jobs/:id/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const jobId = parseInt(req.params.id);
  const send  = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  const poll = setInterval(async () => {
    try {
      const job = db.getJob(jobId);
      if (!job) { clearInterval(poll); send({ stage: 'error', error: 'Job not found' }); res.end(); return; }

      if (job.status === 'running' || job.status === 'pending') {
        send({ stage: 'progress', progress: job.progress, total: job.total, ok: job.ok, errors: job.errors });
      } else if (job.status === 'done') {
        clearInterval(poll);
        send({ stage: 'done', ok: job.ok, errors: job.errors, total: job.total });
        res.end();
      } else if (job.status === 'error') {
        clearInterval(poll);
        send({ stage: 'error', error: job.error });
        res.end();
      }
    } catch (e) {
      clearInterval(poll);
      send({ stage: 'error', error: e.message });
      res.end();
    }
  }, 1500);

  req.on('close', () => clearInterval(poll));
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

// ─────────────────────────────────────────────
// GET /api/vault/storage
// Reports disk usage on all configured camera SSD paths.
// ─────────────────────────────────────────────
router.get('/storage', async (req, res) => {
  try {
    const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH
      || path.join(__dirname, '..', '..', 'creator-profile.json');
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    const cameraPaths = profile?.vault?.camera_ssd_paths || [];
    const footageRoot = profile?.vault?.footage_root || null;

    const results = [];
    for (const drivePath of [...cameraPaths, footageRoot].filter(Boolean)) {
      try {
        const stat = await fs.promises.statfs(drivePath.replace(/\//g, path.sep));
        const total     = stat.blocks  * stat.bsize;
        const free      = stat.bfree   * stat.bsize;
        const used      = total - free;
        const usedPct   = total > 0 ? Math.round((used / total) * 100) : 0;
        results.push({ path: drivePath, total, used, free, used_pct: usedPct, ok: true });
      } catch (e) {
        results.push({ path: drivePath, ok: false, error: 'Drive not accessible' });
      }
    }
    res.json({ ok: true, drives: results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/archive/:project_id
// Copies all BRAW source files for a project from camera SSD → footage_root,
// updates braw_source_path in DB, and returns a DaVinci relink report.
// Uses SSE so the client can show per-file progress on large shoots.
// ─────────────────────────────────────────────
router.post('/archive/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id);
  if (isNaN(projectId)) return res.status(400).json({ ok: false, error: 'invalid project_id' });

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH
      || path.join(__dirname, '..', '..', 'creator-profile.json');
    const profile     = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    const footageRoot = profile?.vault?.footage_root;
    if (!footageRoot) {
      emit({ type: 'error', message: 'vault.footage_root not set in creator-profile.json' });
      return res.end();
    }

    const project = db.getProject(projectId);
    if (!project) {
      emit({ type: 'error', message: `Project ${projectId} not found` });
      return res.end();
    }

    // Build destination folder: footage_root/[SafeProjectTitle]/
    const safeName = (project.title || `project_${projectId}`)
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const destFolder = path.join(footageRoot.replace(/\//g, path.sep), safeName);
    fs.mkdirSync(destFolder, { recursive: true });

    emit({ type: 'status', message: `Archiving to ${destFolder}` });

    // Find all footage records that have BRAW source paths for this project
    const allFootage = db.getAllFootage({ project_id: projectId });
    const brawClips  = allFootage.filter(f => f.braw_source_path);

    if (brawClips.length === 0) {
      emit({ type: 'done', message: 'No BRAW source files found for this project — nothing to archive.', relink: [] });
      return res.end();
    }

    emit({ type: 'status', message: `Found ${brawClips.length} BRAW source file(s) to archive` });

    const relinkReport = [];
    let copied = 0;
    let errors  = 0;

    for (const clip of brawClips) {
      const srcPath = clip.braw_source_path.replace(/\//g, path.sep);
      const destPath = path.join(destFolder, path.basename(srcPath));

      // Skip if src doesn't exist (drive not plugged in)
      if (!fs.existsSync(srcPath)) {
        emit({ type: 'warning', file: path.basename(srcPath), message: 'Source file not found — skipped (H:\\ not plugged in?)' });
        errors++;
        continue;
      }

      // Skip if already archived to this exact destination
      if (srcPath.toLowerCase() === destPath.toLowerCase()) {
        emit({ type: 'skipped', file: path.basename(srcPath), message: 'Already at destination' });
        relinkReport.push({ old_path: srcPath, new_path: destPath });
        copied++;
        continue;
      }

      emit({ type: 'copying', file: path.basename(srcPath), dest: destPath });

      try {
        await fs.promises.copyFile(srcPath, destPath);

        // Verify: size must match
        const srcStat  = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.size !== destStat.size) {
          throw new Error(`Size mismatch after copy: ${srcStat.size} → ${destStat.size}`);
        }

        // Update DB — braw_source_path now points to the archive location
        const newPathNorm = destPath.replace(/\\/g, '/');
        db.updateFootage(clip.id, { braw_source_path: newPathNorm });

        relinkReport.push({ old_path: srcPath, new_path: destPath });
        copied++;
        emit({ type: 'copied', file: path.basename(srcPath), verified: true });

      } catch (copyErr) {
        errors++;
        emit({ type: 'error', file: path.basename(srcPath), message: copyErr.message });
      }
    }

    // Mark project as archived in DB
    if (errors === 0) {
      db.updateProjectPipr(projectId, {
        archive_state: 'archived',
        archived_at:   new Date().toISOString()
      });
    } else {
      db.updateProjectPipr(projectId, { archive_state: 'partial' });
    }

    emit({
      type:     'done',
      copied,
      errors,
      dest:     destFolder,
      relink:   relinkReport,
      message:  errors === 0
        ? `✓ ${copied} file(s) archived and verified. Update DaVinci media paths to: ${destFolder}`
        : `⚠ ${copied} copied, ${errors} failed. Re-run archive when H:\\ is available.`
    });

  } catch (err) {
    emit({ type: 'error', message: err.message });
  }

  res.end();
});

// ─────────────────────────────────────────────
// GET /api/vault/duplicates
// Returns groups of footage with identical filenames so the UI can show them.
// Flags BRAW proxy pairs (same filename, different paths — these are expected and
// should not be archived; they're the source + proxy relationship).
// ─────────────────────────────────────────────
router.get('/duplicates', (req, res) => {
  try {
    const allGroups = db.findDuplicateFootage();

    // Annotate each group: is this a BRAW proxy pair or a true accidental duplicate?
    const groups = allGroups.map(g => {
      const isBrawPair = g.clips.length === 2 &&
        g.clips.every(c => (c.original_filename || '').toLowerCase().endsWith('.braw')) &&
        g.clips[0].file_path !== g.clips[1].file_path;

      return { ...g, is_braw_pair: isBrawPair };
    });

    // Separate true dupes from BRAW pairs for summary counts
    const trueDupeGroups = groups.filter(g => !g.is_braw_pair);
    const brawPairGroups = groups.filter(g => g.is_braw_pair);

    res.json({
      groups,
      total_groups:      trueDupeGroups.length,
      total_dupes:       trueDupeGroups.reduce((s, g) => s + g.count - 1, 0),
      braw_pairs:        brawPairGroups.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/footage/bulk-archive
// Body: { ids: [1, 2, 3] }
// Soft-archives footage by setting quality_flag = 'archived'. Non-destructive.
// ─────────────────────────────────────────────
router.post('/footage/bulk-archive', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    db.bulkArchiveFootage(ids.map(Number));
    res.json({ ok: true, archived: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/vault/footage/:id/archive — archive a single clip
// ─────────────────────────────────────────────
router.post('/footage/:id/archive', (req, res) => {
  try {
    db.archiveFootage(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
