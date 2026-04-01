/**
 * Kre8Ωr — Voice Library Route
 * src/routes/voice-library.js
 *
 * GET  /api/voice-library/profiles            — list all saved profiles
 * POST /api/voice-library/analyze             — SSE: transcribe + analyze + save
 * GET  /api/voice-library/status/:job_id      — SSE stream for analyze job
 * DELETE /api/voice-library/profiles/:id      — remove a profile
 * PATCH  /api/voice-library/profiles/:id      — rename a profile
 */

'use strict';

const express          = require('express');
const { EventEmitter } = require('events');
const crypto           = require('crypto');

const {
  analyzeVoice,
  listProfiles,
  removeProfileFromLibrary,
  saveProfileToLibrary
} = require('../writr/voice-analyzer');

const router = express.Router();

// ─────────────────────────────────────────────
// SSE JOB STORE
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
  const ev   = { stage: 'done', result };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function failJob(job, errorMsg) {
  job.status = 'error';
  job.error  = errorMsg;
  const ev   = { stage: 'error', error: errorMsg };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function sseStream(job, req, res) {
  req.setTimeout(720_000); // 12 min — Whisper on long videos
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send     = d  => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  const onEvent  = d  => send(d);
  const keepalive = setInterval(() => {
    if (res.writableEnded) return clearInterval(keepalive);
    res.write(': keepalive\n\n');
  }, 15_000);
  const onDone   = () => { clearInterval(keepalive); if (!res.writableEnded) res.end(); };

  for (const ev of job.events) send(ev);
  if (job.status !== 'running') { clearInterval(keepalive); res.end(); return; }

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    clearInterval(keepalive);
    job.emitter.off('event', onEvent);
    job.emitter.off('done',  onDone);
  });
}

// ─────────────────────────────────────────────
// GET /api/voice-library/profiles
// ─────────────────────────────────────────────

router.get('/profiles', (req, res) => {
  res.json({ ok: true, profiles: listProfiles() });
});

// ─────────────────────────────────────────────
// POST /api/voice-library/analyze
// Body: { file_path, name, save }
// Returns: { job_id } — client polls /status/:job_id
// ─────────────────────────────────────────────

router.post('/analyze', (req, res) => {
  const { file_path, name, save = true } = req.body;
  if (!file_path?.trim()) return res.status(400).json({ error: 'file_path required' });

  const job = createJob();
  res.json({ ok: true, job_id: job.id });

  // Run async — client streams via SSE
  setImmediate(async () => {
    try {
      const emit = ev => pushEvent(job, ev);

      const profile = await analyzeVoice({
        filePath: file_path.trim(),
        name:     name?.trim() || null,
        emit,
        save:     save !== false
      });

      finishJob(job, profile);
    } catch (err) {
      console.error('[VoiceLibrary] analyze error:', err.message);
      failJob(job, err.message);
    }
  });
});

// ─────────────────────────────────────────────
// GET /api/voice-library/status/:job_id
// ─────────────────────────────────────────────

router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// DELETE /api/voice-library/profiles/:id
// ─────────────────────────────────────────────

router.delete('/profiles/:id', (req, res) => {
  try {
    removeProfileFromLibrary(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/voice-library/profiles/:id
// Body: { name }
// ─────────────────────────────────────────────

router.patch('/profiles/:id', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const profiles = listProfiles();
  const profile  = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  profile.name = name.trim();
  saveProfileToLibrary(profile);
  res.json({ ok: true, profile });
});

module.exports = router;
