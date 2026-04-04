/**
 * ComposΩr Route — src/routes/composor.js
 *
 * POST /api/composor/analyze/:project_id   — scene analysis via Claude
 * POST /api/composor/generate/:project_id  — write prompts + call Suno API (SSE job)
 * GET  /api/composor/status/:job_id        — SSE progress stream
 * GET  /api/composor/tracks/:project_id    — all tracks grouped by scene
 * POST /api/composor/select/:track_id      — mark track selected
 * DELETE /api/composor/tracks/:project_id  — clear all tracks + reset state
 * POST /api/composor/import-to-davinci/:project_id — place selected tracks in DaVinci
 * GET  /api/composor/check                 — Suno API key status + credits
 */

'use strict';

const express          = require('express');
const { EventEmitter } = require('events');
const crypto           = require('crypto');
const { spawn }        = require('child_process');
const path             = require('path');
const fs               = require('fs');
const multer           = require('multer');

const { analyzeScenes }                        = require('../composor/scene-analyzer');
const { writePrompts }                         = require('../composor/prompt-writer');
const { generateTrack, isSunoConfigured, checkCredits, sceneSlug } = require('../composor/suno-client');
const db = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// IN-MEMORY JOB STORE
// ─────────────────────────────────────────────

const jobs = new Map();

function createJob() {
  const id      = crypto.randomUUID();
  const emitter = new EventEmitter();
  const job     = { id, status: 'running', events: [], emitter, result: null, error: null };
  jobs.set(id, job);
  return job;
}

function pushEvent(job, data) {
  job.events.push(data);
  job.emitter.emit('event', data);
}

function finishJob(job, result) {
  job.status = 'done';
  job.result = result;
  const ev = { stage: 'done', result };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function failJob(job, error) {
  job.status = 'error';
  job.error  = error;
  const ev = { stage: 'error', error };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function sseStream(job, req, res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  for (const ev of job.events) send(ev);
  if (job.status !== 'running') { res.end(); return; }

  const onEvent = (d) => send(d);
  const onDone  = () => res.end();
  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
}

// ─────────────────────────────────────────────
// GET /api/composor/check
// ─────────────────────────────────────────────

router.get('/check', async (req, res) => {
  const configured = isSunoConfigured();
  if (!configured) {
    return res.json({ suno_configured: false, message: 'SUNO_API_KEY not set in .env' });
  }
  const credits = await checkCredits();
  res.json({ suno_configured: true, ...credits });
});

// ─────────────────────────────────────────────
// POST /api/composor/analyze/:project_id
// Synchronous — returns scenes directly (fast)
// ─────────────────────────────────────────────

router.post('/analyze/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  try {
    const scenes = await analyzeScenes(projectId);

    return res.json({
      ok:         true,
      project_id: projectId,
      scenes,
      scene_count: scenes.length
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/composor/generate/:project_id
// Full pipeline: analyze → write prompts → Suno (SSE job)
// Body: { scenes? } — if scenes provided, skip re-analysis
// ─────────────────────────────────────────────

router.post('/generate/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const passedScenes = req.body?.scenes || null;

  const job = createJob();
  res.json({ job_id: job.id, project_id: projectId });

  (async () => {
    try {
      db.updateProjectComposorState(projectId, 'generating');

      // ── Step 1: Scene analysis ────────────────────────────────────────────
      let scenes = passedScenes;
      if (!scenes) {
        pushEvent(job, { stage: 'analyzing_scenes' });
        scenes = await analyzeScenes(
          projectId,
          (p) => pushEvent(job, { stage: 'scene_analysis', ...p })
        );
        pushEvent(job, { stage: 'scenes_identified', count: scenes.length });
      } else {
        pushEvent(job, { stage: 'scenes_provided', count: scenes.length });
      }

      // ── Step 2: Write Suno prompts ────────────────────────────────────────
      pushEvent(job, { stage: 'writing_prompts', scenes: scenes.length });
      const promptResults = await writePrompts(
        scenes,
        (p) => pushEvent(job, { stage: 'prompt_progress', ...p })
      );
      pushEvent(job, { stage: 'prompts_written', count: promptResults.length });

      // ── Step 3: Save prompt-only tracks to DB (so UI shows them immediately)
      db.deleteComposorTracksByProject(projectId);
      const trackIdMap = {};  // key: `${scene_index}_${generation_index}` → db id

      for (const pt of promptResults) {
        const id = db.insertComposorTrack({
          project_id:       projectId,
          scene_label:      pt.scene_label,
          scene_index:      pt.scene_index,
          scene_type:       pt.scene_type,
          duration_seconds: pt.duration_seconds,
          suno_prompt:      pt.suno_prompt ? pt.suno_prompt.substring(0, 200) : null,
          generation_index: pt.generation_index,
          selected:         false
        });
        trackIdMap[`${pt.scene_index}_${pt.generation_index}`] = id;
      }

      pushEvent(job, { stage: 'tracks_saved_to_db', count: promptResults.length });

      // ── Step 4: Suno generation (or skip if no API key) ───────────────────
      const sunoEnabled = isSunoConfigured();
      pushEvent(job, { stage: 'suno_start', enabled: sunoEnabled });

      let generatedCount = 0;
      let skippedCount   = 0;

      for (const pt of promptResults) {
        if (!pt.suno_prompt) { skippedCount++; continue; }

        const trackDbId = trackIdMap[`${pt.scene_index}_${pt.generation_index}`];

        if (!sunoEnabled) {
          pushEvent(job, {
            stage:            'suno_skipped',
            scene_label:      pt.scene_label,
            generation_index: pt.generation_index,
            reason:           'no_api_key'
          });
          skippedCount++;
          continue;
        }

        pushEvent(job, {
          stage:            'suno_generating',
          scene_label:      pt.scene_label,
          generation_index: pt.generation_index
        });

        const result = await generateTrack({
          sunoPrompt:       pt.suno_prompt,
          projectId,
          sceneLabel:       pt.scene_label,
          generationIndex:  pt.generation_index,
          onProgress:       (p) => pushEvent(job, p)
        });

        if (result.ok) {
          db.updateComposorTrack(trackDbId, {
            suno_job_id:     result.suno_job_id,
            suno_track_url:  result.suno_track_url,
            suno_track_path: result.suno_track_path,
            public_path:     result.public_path || null
          });
          generatedCount++;

          pushEvent(job, {
            stage:            'track_ready',
            scene_label:      pt.scene_label,
            generation_index: pt.generation_index,
            public_path:      result.public_path
          });
        } else {
          pushEvent(job, {
            stage:            'track_failed',
            scene_label:      pt.scene_label,
            generation_index: pt.generation_index,
            reason:           result.reason,
            error:            result.error
          });
          skippedCount++;
        }
      }

      // ── Step 5: Update state ──────────────────────────────────────────────
      db.updateProjectComposorState(projectId, 'awaiting_selection');

      finishJob(job, {
        project_id:      projectId,
        scenes:          scenes.length,
        tracks_written:  promptResults.length,
        tracks_generated: generatedCount,
        tracks_skipped:  skippedCount,
        suno_enabled:    sunoEnabled
      });

    } catch (err) {
      db.updateProjectComposorState(projectId, 'pending');
      failJob(job, err.message);
    }
  })();
});

// ─────────────────────────────────────────────
// GET /api/composor/status/:job_id — SSE
// ─────────────────────────────────────────────

router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// GET /api/composor/tracks/:project_id
// Returns tracks grouped by scene
// ─────────────────────────────────────────────

router.get('/tracks/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const tracks = db.getComposorTracksByProject(projectId);

  // Group by scene_index
  const sceneMap = {};
  for (const t of tracks) {
    if (!sceneMap[t.scene_index]) {
      sceneMap[t.scene_index] = {
        scene_index:     t.scene_index,
        scene_label:     t.scene_label,
        scene_type:      t.scene_type,
        duration_seconds: t.duration_seconds,
        tracks:          []
      };
    }
    sceneMap[t.scene_index].tracks.push(t);
  }

  const scenes = Object.values(sceneMap).sort((a, b) => a.scene_index - b.scene_index);

  res.json({
    project_id:      projectId,
    project_title:   project.title,
    composor_state:  project.composor_state || null,
    suno_configured: isSunoConfigured(),
    scenes,
    total_tracks:    tracks.length,
    selected_count:  tracks.filter(t => t.selected).length
  });
});

// ─────────────────────────────────────────────
// POST /api/composor/select/:track_id
// ─────────────────────────────────────────────

router.post('/select/:track_id', (req, res) => {
  const trackId = parseInt(req.params.track_id, 10);
  if (!trackId) return res.status(400).json({ error: 'Invalid track_id' });

  try {
    db.selectComposorTrack(trackId);

    // Check if all scenes now have a selection — if so, advance state
    const track  = db.getComposorTracksByProject(0).find(() => true); // get any track for project_id
    // Re-fetch the track directly via project
    const tracks = db.getComposorTracksByProject(
      db.getComposorTracksByProject(0)[0]?.project_id ?? 0
    );

    res.json({ ok: true, track_id: trackId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Better select endpoint — get project_id from track context
router.post('/select', (req, res) => {
  const { track_id, project_id } = req.body;
  const trackId   = parseInt(track_id, 10);
  const projectId = parseInt(project_id, 10);

  if (!trackId) return res.status(400).json({ error: 'track_id required' });

  db.selectComposorTrack(trackId);

  if (projectId) {
    // Check if all scenes have a selection
    const tracks  = db.getComposorTracksByProject(projectId);
    const scenes  = [...new Set(tracks.map(t => t.scene_index))];
    const allDone = scenes.every(si => tracks.some(t => t.scene_index === si && t.selected));

    if (allDone && scenes.length > 0) {
      db.updateProjectComposorState(projectId, 'complete');
    }
  }

  res.json({ ok: true, track_id: trackId });
});

// ─────────────────────────────────────────────
// DELETE /api/composor/tracks/:project_id
// ─────────────────────────────────────────────

router.delete('/tracks/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  db.deleteComposorTracksByProject(projectId);
  db.updateProjectComposorState(projectId, null);

  res.json({ ok: true, project_id: projectId });
});

// ─────────────────────────────────────────────
// POST /api/composor/import-to-davinci/:project_id
// Spawns scripts/davinci/place-music.py (SSE job)
// ─────────────────────────────────────────────

const PYTHON_CANDIDATES = process.env.PYTHON_PATH
  ? [process.env.PYTHON_PATH]
  : ['py', 'python3', 'python'];

let _pythonBin = null;

async function detectPython() {
  if (_pythonBin !== null) return _pythonBin || null;
  for (const bin of PYTHON_CANDIDATES) {
    const found = await new Promise(resolve => {
      const p = spawn(bin, ['--version'], { windowsHide: true, timeout: 5_000 });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    });
    if (found) { _pythonBin = bin; return bin; }
  }
  _pythonBin = '';
  return null;
}

router.post('/import-to-davinci/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const job = createJob();
  res.json({ job_id: job.id, project_id: projectId });

  (async () => {
    try {
      const binary = await detectPython();
      if (!binary) return failJob(job, `Python not found. Tried: ${PYTHON_CANDIDATES.join(', ')}`);

      const tracks  = db.getComposorTracksByProject(projectId);
      const selected = tracks.filter(t => t.selected && t.suno_track_path);

      if (selected.length === 0) {
        return failJob(job, 'No selected tracks with downloaded audio found. Select tracks and ensure they are downloaded first.');
      }

      const davinciName  = project.davinci_project_name || project.title;
      const scriptPath   = path.join(__dirname, '..', '..', 'scripts', 'davinci', 'place-music.py');

      // Pull CTA timestamp from cuts table for the Fairlight marker
      const cuts     = db.getCutsByProject(projectId);
      const ctaCut   = cuts.find(c => c.cut_type === 'CTA');
      const ctaTs    = ctaCut ? parseFloat(ctaCut.start_timestamp) : null;

      pushEvent(job, { stage: 'davinci_start', tracks: selected.length });

      const proc = spawn(binary, [
        scriptPath,
        '--project_id',       String(projectId),
        '--project_name',     davinciName,
        '--tracks_json',      JSON.stringify(selected),
        '--fps',              String(project.fps || 24),
        ...(ctaTs != null ? ['--cta_timestamp', String(ctaTs)] : [])
      ], { windowsHide: true, timeout: 120_000 });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => {
        const line = d.toString().trim();
        stderr += line;
        if (line) pushEvent(job, { stage: 'davinci_log', line });
      });

      proc.on('error', err => failJob(job, `Python spawn failed: ${err.message}`));

      proc.on('close', code => {
        if (code !== 0) {
          return failJob(job, `place-music.py exited ${code}: ${stderr.slice(-400)}`);
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.ok) {
            db.updateProjectComposorState(projectId, 'complete');
          }
          finishJob(job, result);
        } catch (_) {
          failJob(job, `Parse failed. stdout: ${stdout.slice(0, 300)}`);
        }
      });

    } catch (err) {
      failJob(job, err.message);
    }
  })();
});

// ─────────────────────────────────────────────
// POST /api/composor/upload/:project_id
// Accepts an MP3 upload for a specific scene,
// saves it to public/music/<project_id>/<scene_slug>/,
// inserts a track row marked selected, advances state.
//
// Body (multipart/form-data):
//   file       — the MP3 file
//   scene_label — the scene this track belongs to
//   scene_index — integer scene index
// ─────────────────────────────────────────────

// multer storage: dynamically routed to the right music folder
const uploadStorage = multer.diskStorage({
  destination(req, file, cb) {
    const projectId  = parseInt(req.params.project_id, 10);
    const sceneLabel = req.body?.scene_label || 'scene';
    const dir = path.join(
      __dirname, '..', '..', 'public', 'music',
      String(projectId),
      sceneSlug(sceneLabel)
    );
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    // uploaded_<timestamp>_<original> — keeps the original name visible
    const ts   = Date.now();
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `uploaded_${ts}_${safe}`);
  }
});

const uploadMiddleware = multer({
  storage:  uploadStorage,
  limits:   { fileSize: 50 * 1024 * 1024 },  // 50 MB max
  fileFilter(_req, file, cb) {
    const ok = /\.(mp3|mp4|m4a|wav|ogg|aac)$/i.test(file.originalname)
             || file.mimetype.startsWith('audio/');
    cb(ok ? null : new Error('Only audio files are accepted'), ok);
  }
});

router.post('/upload/:project_id', uploadMiddleware.single('file'), (req, res) => {
  const projectId  = parseInt(req.params.project_id, 10);
  if (!projectId)  return res.status(400).json({ error: 'Invalid project_id' });
  if (!req.file)   return res.status(400).json({ error: 'No file received' });

  const project = db.getProject(projectId);
  if (!project)    return res.status(404).json({ error: `Project ${projectId} not found` });

  const sceneLabel = (req.body?.scene_label || 'Uploaded Scene').trim();
  const sceneIndex = parseInt(req.body?.scene_index ?? 0, 10);

  // Public URL for browser playback
  const slug       = sceneSlug(sceneLabel);
  const filename   = req.file.filename;
  const publicPath = `/music/${projectId}/${slug}/${filename}`;
  const absPath    = req.file.path;

  // Insert a new track row and immediately mark it selected
  const existingTracks = db.getComposorTracksByProject(projectId);

  // Determine the next generation_index for this scene
  const sceneTracks    = existingTracks.filter(t => t.scene_index === sceneIndex);
  const nextGenIndex   = sceneTracks.length + 1;

  const trackId = db.insertComposorTrack({
    project_id:       projectId,
    scene_label:      sceneLabel,
    scene_index:      sceneIndex,
    scene_type:       'buildup',
    duration_seconds: null,
    suno_prompt:      null,
    generation_index: nextGenIndex,
    selected:         false
  });

  // Store the path and mark selected (selectComposorTrack handles unselecting peers)
  db.updateComposorTrack(trackId, {
    suno_track_path: absPath,
    suno_track_url:  publicPath,
    public_path:     publicPath     // web-accessible path for the HTML5 audio player
  });
  db.selectComposorTrack(trackId);

  // Advance project state if all scenes now have a selection
  const allTracks = db.getComposorTracksByProject(projectId);
  const sceneIdxs = [...new Set(allTracks.map(t => t.scene_index))];
  const allDone   = sceneIdxs.length > 0
    && sceneIdxs.every(si => allTracks.some(t => t.scene_index === si && t.selected));

  if (allDone) {
    db.updateProjectComposorState(projectId, 'complete');
  }

  res.json({
    ok:          true,
    track_id:    trackId,
    public_path: publicPath,
    scene_label: sceneLabel,
    scene_index: sceneIndex,
    all_done:    allDone
  });
});

module.exports = router;
