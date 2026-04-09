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

const fs              = require('fs');
const db                  = require('../db');
const { transcribeFile }  = require('../vault/transcribe');
const { analyzeForClips } = require('../vault/clipsr');
const { runScript }       = require('./davinci');

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
        // Prefer in-DB text, fall back to reading the JSON file from disk
        if (footage.transcript) {
          try { transcript = JSON.parse(footage.transcript); } catch (_) {
            // Plain text stored — wrap in minimal structure
            transcript = { text: footage.transcript, segments: [{ start: 0, end: footage.duration || 0, text: footage.transcript }] };
          }
        } else if (footage.transcript_path && fs.existsSync(footage.transcript_path)) {
          try {
            transcript = JSON.parse(fs.readFileSync(footage.transcript_path, 'utf8'));
            // Also backfill the text column so future runs skip the file read
            if (transcript.text && footage.id) {
              db.updateFootage(footage.id, { transcript: transcript.text });
            }
          } catch (_) {}
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

// ─────────────────────────────────────────────
// POST /api/clipsr/send-to-davinci
// Body: { footage_id, project_name? }
// Gets approved clips for a footage item, creates a Resolve project
// with one 9:16 vertical timeline per clip (in/out pre-set).
// Creator applies Smart Reframe per clip in Resolve (~5s each).
// ─────────────────────────────────────────────
router.post('/send-to-davinci', async (req, res) => {
  const { footage_id, project_name } = req.body;
  if (!footage_id) return res.status(400).json({ error: 'footage_id required' });

  try {
    const footage = db.getFootageById(parseInt(footage_id, 10));
    if (!footage) return res.status(404).json({ error: 'Footage not found' });

    // Get approved clips — fall back to all candidates if none approved yet
    let clips = db.getViralClipsByFootage(parseInt(footage_id, 10))
      .filter(c => c.status === 'approved');

    if (!clips.length) {
      return res.status(400).json({
        error: 'No approved clips found. Approve at least one clip in ClipsΩr first.'
      });
    }

    // Resolve source path — prefer proxy_path if original is BRAW
    const sourcePath = footage.proxy_path || footage.file_path;
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return res.status(400).json({
        error: `Source file not found: ${sourcePath}. Make sure the video file is accessible.`
      });
    }

    // Detect frame rate from footage metadata (stored as "1920x1080" etc — fps separate)
    // Default to 29.97; footage table doesn't store fps directly so we approximate
    const fps = 29.97;

    const clipsPayload = clips.map(c => ({
      rank:      c.rank,
      start:     c.start_time,
      end:       c.end_time,
      hook:      c.hook      || '',
      caption:   c.caption   || '',
      clip_type: c.clip_type || 'social',
    }));

    const resolvedProjectName = project_name
      || (footage.original_filename || 'SocialClips').replace(/\.[^.]+$/, '');

    const result = await runScript('create-social-clips.py', [
      '--project_name', resolvedProjectName,
      '--source_path',  sourcePath,
      '--clips_json',   JSON.stringify(clipsPayload),
      '--fps',          String(fps),
    ], 120_000); // 2 min timeout

    res.json(result);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
