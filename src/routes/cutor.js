/**
 * CutΩr Route — src/routes/cutor.js
 *
 * Wires together transcription (Whisper), cut identification (Claude),
 * and clip extraction (ffmpeg) behind a job-based SSE system.
 *
 * POST /api/cutor/start           — kick off transcription + analysis
 * GET  /api/cutor/status/:job_id  — SSE progress stream
 * GET  /api/cutor/cuts/:project_id — all identified cuts with reasoning
 * POST /api/cutor/approve/:cut_id — approve a cut for extraction
 * POST /api/cutor/extract/:project_id — extract all approved cuts
 */

'use strict';

const express   = require('express');
const { EventEmitter } = require('events');
const crypto    = require('crypto');

const { transcribeFile, checkWhisper, detectPython, resetWhisperCache } = require('../vault/transcribe');
const { identifyCuts }   = require('../vault/cutor');
const { extractProject } = require('../vault/extractor');
const { checkFfmpeg }    = require('../vault/intake');
const { startSseResponse, attachSseStream } = require('../utils/sse');
const db = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// IN-MEMORY JOB STORE
// job = { id, status, events[], emitter, result }
// ─────────────────────────────────────────────

const jobs = new Map();

function createJob() {
  const id = crypto.randomUUID();
  const emitter = new EventEmitter();
  const job = { id, status: 'running', events: [], emitter, result: null, error: null };
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
  const doneEvent = { stage: 'done', result };
  job.events.push(doneEvent);
  job.emitter.emit('event', doneEvent);
  job.emitter.emit('done');
}

function failJob(job, error) {
  job.status = 'error';
  job.error = error;
  const errEvent = { stage: 'error', error };
  job.events.push(errEvent);
  job.emitter.emit('event', errEvent);
  job.emitter.emit('done');
}

// ─────────────────────────────────────────────
// GET /api/cutor/check — health check for dependencies
// Returns: { ffmpeg, whisper, whisper_binary, whisper_version }
// ─────────────────────────────────────────────

router.get('/check', async (req, res) => {
  try {
    const [ffmpegOk, whisperInfo] = await Promise.all([
      checkFfmpeg(),
      checkWhisper()
    ]);
    res.json({
      ffmpeg:          ffmpegOk,
      whisper:         whisperInfo.whisper,
      whisper_binary:  whisperInfo.whisper_binary,
      whisper_version: whisperInfo.whisper_version
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/cutor/install-whisper
// SSE stream — installs openai-whisper via pip into the detected Python env.
// Events: { type:'python_check' } → { type:'line', text } → { type:'done', ok, error? }
// ─────────────────────────────────────────────

router.post('/install-whisper', async (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 10 * 60 * 1000 }); // 10 min for slow connections

  // 1. Find Python
  send({ type: 'status', text: 'Detecting Python…' });
  const pythonBin = await detectPython();

  if (!pythonBin) {
    send({ type: 'done', ok: false, error: 'no_python',
           text: 'Python not found. Install Python first, then come back.' });
    return end();
  }

  send({ type: 'status', text: `Python found (${pythonBin}). Starting install…` });

  // 2. Run: <python> -m pip install --upgrade openai-whisper
  //    Using -m pip ensures we're installing into the exact Python we found.
  const { spawn } = require('child_process');
  const child = spawn(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'openai-whisper'], {
    windowsHide: true
  });

  const handleData = (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (t) send({ type: 'line', text: t });
    }
  };

  child.stdout.on('data', handleData);
  child.stderr.on('data', handleData);

  child.on('error', (err) => {
    send({ type: 'done', ok: false, error: err.message });
    end();
  });

  child.on('close', (code) => {
    if (code === 0) {
      resetWhisperCache();   // clear stale "not found" so next /check re-probes
      send({ type: 'done', ok: true, text: 'Whisper installed successfully.' });
    } else {
      send({ type: 'done', ok: false, error: `pip exited with code ${code}` });
    }
    end();
  });
});

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// GET /api/cutor/models
// Returns available Whisper models with sizes + current active model.
// ─────────────────────────────────────────────

const WHISPER_MODELS = [
  { id: 'tiny',     label: 'Tiny',     size_mb: 75,   note: 'Fast, decent accuracy. Good for demos.' },
  { id: 'tiny.en',  label: 'Tiny.en',  size_mb: 75,   note: 'English-only tiny. Slightly better accuracy than tiny.' },
  { id: 'base',     label: 'Base',     size_mb: 142,  note: 'Good balance of speed and accuracy.' },
  { id: 'base.en',  label: 'Base.en',  size_mb: 142,  note: 'English-only base.' },
  { id: 'small',    label: 'Small',    size_mb: 466,  note: 'Better accuracy, slower.' },
  { id: 'medium',   label: 'Medium',   size_mb: 1500, note: 'Recommended for outdoor/noisy production audio.' },
  { id: 'medium.en',label: 'Medium.en',size_mb: 1500, note: 'English-only medium. Slightly faster.' },
  { id: 'large',    label: 'Large',    size_mb: 2900, note: 'Best accuracy. Slow, needs good GPU.' },
];

router.get('/models', (req, res) => {
  const current = process.env.WHISPER_MODEL || 'medium';
  const modelsDir = process.env.WHISPER_MODELS_DIR || null;

  // Check which models are already downloaded (present on disk)
  const downloaded = new Set();
  if (modelsDir) {
    try {
      const files = require('fs').readdirSync(modelsDir);
      for (const f of files) {
        const m = f.replace(/\.pt$/, '').replace(/^whisper-/, '');
        downloaded.add(m);
      }
    } catch (_) {}
  }

  res.json({
    current,
    models_dir: modelsDir,
    models: WHISPER_MODELS.map(m => ({
      ...m,
      active:     m.id === current,
      downloaded: modelsDir ? downloaded.has(m.id) : null, // null = unknown (no models dir)
    }))
  });
});

// ─────────────────────────────────────────────
// POST /api/cutor/start
// Body: { project_id, footage_id? }
// Returns: { job_id }
// ─────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const { project_id, footage_id = null } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const project = db.getProject(project_id);
  if (!project) return res.status(404).json({ error: `Project ${project_id} not found` });

  // Determine which footage to use
  let targetFootage = null;
  if (footage_id) {
    targetFootage = db.getFootageById(footage_id);
    if (!targetFootage) return res.status(404).json({ error: `Footage ${footage_id} not found` });
  } else {
    const all = db.getAllFootage({ project_id });
    if (!all || all.length === 0) {
      return res.status(400).json({ error: 'No footage found for this project. Ingest a video in VaultΩr first.' });
    }
    targetFootage = all[0];
  }

  const job = createJob();
  res.json({ job_id: job.id, footage_id: targetFootage.id });

  // Run async pipeline — do not await
  (async () => {
    try {
      // ── Step 1: Transcribe ──────────────────
      pushEvent(job, { stage: 'transcribing', footage_id: targetFootage.id, file: targetFootage.original_filename });

      const txResult = await transcribeFile(targetFootage.file_path, {
        footageId:  targetFootage.id,
        onProgress: (p) => pushEvent(job, { stage: 'transcribe_progress', ...p })
      });

      if (!txResult.ok) {
        return failJob(job, `Transcription failed: ${txResult.error}`);
      }

      pushEvent(job, {
        stage:    'transcribed',
        skipped:  txResult.skipped || false,
        segments: txResult.segments?.length || 0,
        duration: txResult.duration
      });

      // ── Step 2: Identify cuts ───────────────
      pushEvent(job, { stage: 'analyzing', project_id });

      const cutResult = await identifyCuts(project_id, {
        footageId:  targetFootage.id,
        onProgress: (p) => pushEvent(job, { stage: 'cutor_progress', ...p })
      });

      if (!cutResult.ok) {
        return failJob(job, `Cut analysis failed: ${cutResult.error}`);
      }

      pushEvent(job, {
        stage:            'analyzed',
        social_clips:     cutResult.social_clips.length,
        retention_cuts:   cutResult.retention_cuts.length,
        cta:              !!cutResult.cta,
        off_script_gold:  cutResult.off_script_gold?.length || 0,
        overall_notes:    cutResult.overall_notes
      });

      finishJob(job, {
        project_id,
        footage_id:      targetFootage.id,
        social_clips:    cutResult.social_clips,
        retention_cuts:  cutResult.retention_cuts,
        cta:             cutResult.cta,
        overall_notes:   cutResult.overall_notes,
        cuts:            cutResult.db_cuts
      });

    } catch (err) {
      failJob(job, err.message);
    }
  })();
});

// ─────────────────────────────────────────────
// GET /api/cutor/status/:job_id  — SSE
// ─────────────────────────────────────────────

router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  attachSseStream(job, req, res);
});

// ─────────────────────────────────────────────
// GET /api/cutor/cuts/:project_id
// Returns all cuts (social, retention, CTA) with reasoning
// ─────────────────────────────────────────────

router.get('/cuts/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const cuts = db.getCutsByProject(projectId);

  const social         = cuts.filter(c => c.cut_type === 'social').sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const retention      = cuts.filter(c => c.cut_type === 'retention');
  const cta            = cuts.find(c => c.cut_type === 'CTA') || null;
  const off_script_gold = cuts.filter(c => c.cut_type === 'off_script_gold');

  res.json({
    project_id: projectId,
    project_title: project.title,
    social,
    retention,
    cta,
    off_script_gold,
    total: cuts.length
  });
});

// ─────────────────────────────────────────────
// POST /api/cutor/approve/:cut_id
// Body: { approved: true|false }
// ─────────────────────────────────────────────

router.post('/approve/:cut_id', (req, res) => {
  const cutId   = parseInt(req.params.cut_id, 10);
  const approved = req.body.approved !== false; // default true

  const cut = db.getCutById(cutId);
  if (!cut) return res.status(404).json({ error: `Cut ${cutId} not found` });

  db.approveCut(cutId, approved);

  res.json({ ok: true, cut_id: cutId, approved });
});

// ─────────────────────────────────────────────
// POST /api/cutor/off-script-gold/:id/approve
// Mark gold moment for rough cut (same as social approve)
// ─────────────────────────────────────────────

router.post('/off-script-gold/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cut = db.getCutById(id);
  if (!cut || cut.cut_type !== 'off_script_gold') {
    return res.status(404).json({ error: 'Off-script gold moment not found' });
  }
  db.approveCut(id, true);
  res.json({ ok: true, id, action: 'approved' });
});

// ─────────────────────────────────────────────
// POST /api/cutor/off-script-gold/:id/save-later
// Save to the off-script gold library for future use
// ─────────────────────────────────────────────

router.post('/off-script-gold/:id/save-later', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cut = db.getCutById(id);
  if (!cut || cut.cut_type !== 'off_script_gold') {
    return res.status(404).json({ error: 'Off-script gold moment not found' });
  }
  db.saveOffScriptGoldForLater(id);
  res.json({ ok: true, id, action: 'saved_for_later' });
});

// ─────────────────────────────────────────────
// POST /api/cutor/extract/:project_id
// Body: { force?: boolean }
// Returns extraction summary + SSE job_id
// ─────────────────────────────────────────────

router.post('/extract/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  const { force = false } = req.body || {};

  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const job = createJob();
  res.json({ job_id: job.id });

  (async () => {
    try {
      pushEvent(job, { stage: 'extracting_start', project_id: projectId });

      const result = await extractProject(projectId, {
        force,
        onProgress: (p) => pushEvent(job, { stage: 'extract_progress', ...p })
      });

      if (!result.ok) {
        return failJob(job, result.message || 'Extraction failed');
      }

      finishJob(job, {
        project_id: projectId,
        extracted:  result.extracted,
        skipped:    result.skipped,
        errors:     result.errors,
        cuts:       result.cuts
      });

    } catch (err) {
      failJob(job, err.message);
    }
  })();
});

module.exports = router;
