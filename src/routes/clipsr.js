/**
 * ClipsΩr Route — src/routes/clipsr.js
 *
 * GET  /api/clipsr/footage              — list completed videos from VaultΩr
 * GET  /api/clipsr/:footage_id/clips    — get saved clips for a footage item
 * POST /api/clipsr/analyze              — SSE job: transcribe + analyze
 * GET  /api/clipsr/status/:job_id       — SSE stream
 * PUT  /api/clipsr/clips/:clip_id       — update clip (caption, status, etc)
 */

'use strict';

const express      = require('express');
const router       = express.Router();
const EventEmitter = require('events');
const crypto       = require('crypto');

const db                  = require('../db');
const { transcribeFile }  = require('../vault/transcribe');
const { analyzeForClips } = require('../vault/clipsr');

function uuid() { return crypto.randomUUID(); }

// ── In-memory job store ──────────────────────────────────
const jobs = new Map();

function createJob() {
  const job = { id: uuid(), status: 'running', events: [], result: null, error: null, emitter: new EventEmitter() };
  jobs.set(job.id, job);
  return job;
}
function pushEvent(job, data) {
  job.events.push(data);
  job.emitter.emit('event', data);
}
function finishJob(job, result) {
  job.status = 'done';
  job.result = result;
  job.emitter.emit('event', { stage: 'done', ...result });
  job.emitter.emit('done');
}
function failJob(job, error) {
  job.status = 'error';
  job.error = error;
  const ev = { stage: 'error', error };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

// ─────────────────────────────────────────────
// GET /api/clipsr/footage
// List completed-video footage available for clip analysis
// ─────────────────────────────────────────────
router.get('/footage', (req, res) => {
  try {
    const all = db.getAllFootage({ shot_type: 'completed-video' });
    // Return key fields only
    const footage = (all || []).map(f => ({
      id:             f.id,
      filename:       f.original_filename,
      file_path:      f.file_path,
      duration:       f.duration,
      thumbnail_path: f.thumbnail_path,
      quality_flag:   f.quality_flag,
      has_transcript: !!(f.transcript || f.transcript_path),
      clip_count:     0, // filled by client from /clips if needed
      ingested_at:    f.ingested_at,
      description:    f.description
    }));
    res.json({ ok: true, footage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/clipsr/:footage_id/clips
// ─────────────────────────────────────────────
router.get('/:footage_id/clips', (req, res) => {
  const footageId = parseInt(req.params.footage_id, 10);
  if (!footageId) return res.status(400).json({ error: 'Invalid footage_id' });
  try {
    const clips = db.getViralClipsByFootage(footageId);
    res.json({ ok: true, clips });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/clipsr/analyze
// Body: { footage_id, force_retranscribe }
// Kicks off SSE job: transcribe (if needed) → analyze → save clips
// ─────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { footage_id, force_retranscribe = false } = req.body;
  if (!footage_id) return res.status(400).json({ error: 'footage_id required' });

  const footage = db.getFootageById(parseInt(footage_id, 10));
  if (!footage) return res.status(404).json({ error: 'Footage not found' });

  const job = createJob();
  res.json({ ok: true, job_id: job.id, footage_id: footage.id });

  (async () => {
    try {
      // Step 1: Transcribe (skip if already done unless forced)
      let transcript;
      const existing = footage.transcript || footage.transcript_path;

      if (existing && !force_retranscribe) {
        pushEvent(job, { stage: 'transcribe_skipped', message: 'Using existing transcript' });
        // Load from stored text or path
        if (footage.transcript) {
          try { transcript = JSON.parse(footage.transcript); } catch (_) {
            transcript = { segments: [{ start: 0, end: footage.duration || 0, text: footage.transcript }], text: footage.transcript };
          }
        }
      }

      if (!transcript) {
        pushEvent(job, { stage: 'transcribing', message: `Transcribing ${footage.original_filename}...` });
        const txResult = await transcribeFile(footage.file_path, {
          footageId: footage.id,
          onProgress: (p) => pushEvent(job, { stage: 'transcribe_progress', ...p })
        });
        if (!txResult.ok) return failJob(job, `Transcription failed: ${txResult.error}`);
        transcript = txResult;
        pushEvent(job, { stage: 'transcribed', segments: txResult.segments?.length || 0, duration: txResult.duration });
      }

      // Step 2: Analyze for clips
      pushEvent(job, { stage: 'analyzing', message: 'Finding the best clip moments...' });

      const result = await analyzeForClips({
        transcript,
        footageMeta: {
          filename:  footage.original_filename,
          duration:  footage.duration,
          shot_type: footage.shot_type
        },
        onProgress: (p) => pushEvent(job, p)
      });

      if (!result.ok) return failJob(job, result.error);

      // Step 3: Save clips to DB (clear old ones first)
      db.deleteViralClipsByFootage(footage.id);
      const savedClips = [];
      for (const clip of result.clips) {
        const id = db.insertViralClip({
          footage_id:   footage.id,
          rank:         clip.rank || 1,
          start_time:   clip.start,
          end_time:     clip.end,
          duration:     clip.duration || (clip.end - clip.start),
          hook:         clip.hook || '',
          caption:      clip.caption || '',
          hashtags:     clip.hashtags || '',
          platform_fit: clip.platform_fit || {},
          why_it_works: clip.why_it_works || '',
          clip_type:    clip.clip_type || 'social',
          status:       'candidate'
        });
        savedClips.push({ id, ...clip });
      }

      finishJob(job, {
        footage_id:         footage.id,
        clips:              savedClips,
        overall_assessment: result.overall_assessment,
        clip_count:         savedClips.length
      });

    } catch (err) {
      failJob(job, err.message);
    }
  })();
});

// ─────────────────────────────────────────────
// GET /api/clipsr/status/:job_id — SSE
// ─────────────────────────────────────────────
router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  for (const ev of job.events) send(ev);
  if (job.status !== 'running') { res.end(); return; }

  const onEvent = (data) => send(data);
  const onDone  = () => res.end();
  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
});

// ─────────────────────────────────────────────
// PUT /api/clipsr/clips/:clip_id
// Update a clip's caption, hook, status, etc.
// ─────────────────────────────────────────────
router.put('/clips/:clip_id', (req, res) => {
  const id = parseInt(req.params.clip_id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid clip_id' });
  try {
    db.updateViralClip(id, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
