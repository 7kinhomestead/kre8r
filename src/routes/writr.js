/**
 * WritΩr Route — src/routes/writr.js
 *
 * GET  /api/writr/:project_id/config        — project + config + active script
 * GET  /api/writr/:project_id/transcripts   — footage transcript summary
 * POST /api/writr/generate                  — run entry-point engine (SSE job)
 * GET  /api/writr/status/:job_id            — SSE stream for generate job
 * POST /api/writr/iterate                   — run iteration engine (SSE job)
 * GET  /api/writr/iterate/status/:job_id    — SSE stream for iterate job
 * POST /api/writr/:project_id/approve       — approve script + sync to SelectsΩr
 * GET  /api/writr/:project_id/scripts       — all script iterations for a project
 */

'use strict';

const express          = require('express');
const { EventEmitter } = require('events');
const crypto           = require('crypto');

const db = require('../db');
const { generateScriptFirst }        = require('../writr/script-first');
const { generateShootFirst }         = require('../writr/shoot-first');
const { generateHybrid }             = require('../writr/hybrid');
const { iterateScript }              = require('../writr/iterate');
const { readConfig }                 = require('../pipr/beat-tracker');

const router = express.Router();

// ─────────────────────────────────────────────
// SSE JOB STORE (same pattern as editor.js)
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

function failJob(job, errorMsg) {
  job.status = 'error';
  job.error  = errorMsg;
  const ev = { stage: 'error', error: errorMsg };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function sseStream(job, req, res) {
  req.setTimeout(120_000);
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send    = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const onEvent = (data) => send(data);

  // Keepalive ping every 15 s — prevents proxy/browser from closing idle streams
  const keepalive = setInterval(() => {
    if (res.writableEnded) return clearInterval(keepalive);
    res.write(': keepalive\n\n');
  }, 15_000);

  const onDone = () => { clearInterval(keepalive); if (!res.writableEnded) res.end(); };

  for (const ev of job.events) send(ev);

  if (job.status !== 'running') { clearInterval(keepalive); res.end(); return; }

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    clearInterval(keepalive);
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
}

// ─────────────────────────────────────────────
// SSE RESPONSE HELPER — for POST routes that stream directly
// Sets headers, starts keepalive, returns { write, end }
// ─────────────────────────────────────────────
function startSseResponse(req, res) {
  req.setTimeout(120_000);
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const write = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const keepalive = setInterval(() => {
    if (res.writableEnded) return clearInterval(keepalive);
    res.write(': keepalive\n\n');
  }, 15_000);

  const end = () => {
    clearInterval(keepalive);
    if (!res.writableEnded) res.end();
  };

  req.on('close', () => clearInterval(keepalive));

  return { write, end };
}

// ─────────────────────────────────────────────
// GET /api/writr/:project_id/config
// Returns project, pipr config, active writr script
// ─────────────────────────────────────────────

router.get('/:project_id/config', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const config  = readConfig(projectId);
  const scripts = db.getWritrScriptsByProject(projectId);
  const active  = project.active_script_id
    ? scripts.find(s => s.id === project.active_script_id) || scripts[0] || null
    : scripts[0] || null;

  res.json({
    ok: true,
    project,
    config,
    entry_point:    config?.entry_point || 'shoot_first',
    active_script:  active,
    scripts_count:  scripts.length,
    writr_complete: !!project.writr_complete
  });
});

// ─────────────────────────────────────────────
// GET /api/writr/:project_id/transcripts
// Returns summarised transcript info for shoot_first UI
// ─────────────────────────────────────────────

router.get('/:project_id/transcripts', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const footage = db.getAllFootage({ project_id: projectId });
  const withTranscripts = footage.filter(f => f.transcript?.trim());

  const summary = withTranscripts.slice(0, 3).map(f => {
    const words = (f.transcript || '').split(/\s+/).slice(0, 40).join(' ');
    return `${f.original_filename || 'clip'}: "${words}…"`;
  }).join('\n');

  res.json({
    ok: true,
    total_footage: footage.length,
    transcribed:   withTranscripts.length,
    summary:       summary || 'No transcripts available',
    word_counts:   withTranscripts.map(f => ({
      footage_id: f.id,
      filename:   f.original_filename || f.file_path?.split(/[\\/]/).pop(),
      words:      f.transcript?.split(/\s+/).length || 0
    }))
  });
});

// ─────────────────────────────────────────────
// GET /api/writr/:project_id/scripts
// Returns all script iterations for a project
// ─────────────────────────────────────────────

router.get('/:project_id/scripts', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const scripts = db.getWritrScriptsByProject(projectId);
  res.json({ ok: true, scripts });
});

// ─────────────────────────────────────────────
// POST /api/writr/generate
// Runs the entry-point engine. Returns job_id for SSE.
// Body: { project_id, entry_point, input_text, what_happened, concept, footage_text }
// ─────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { project_id, entry_point, input_text, what_happened, concept, footage_text } = req.body;

  // Validate synchronously before switching to SSE (so we can return proper HTTP errors)
  const projectId = parseInt(project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'project_id required' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Switch to SSE stream — client reads this response body directly
  const { write, end } = startSseResponse(req, res);

  try {
    const ep      = entry_point || readConfig(projectId)?.entry_point || 'shoot_first';
    const footage = db.getAllFootage({ project_id: projectId });

    write({ stage: 'analyzing', message: `Starting ${ep.replace(/_/g, ' ')} analysis…` });

    let result;

    // emit helper — filters out module 'complete' progress msgs (we send our own at the end)
    const emit = (ev) => { if (ev.stage !== 'complete') write(ev); };

    if (ep === 'script_first') {
      result = await generateScriptFirst({
        projectId,
        inputText: input_text || '',
        emit
      });
    } else if (ep === 'shoot_first') {
      result = await generateShootFirst({
        projectId,
        whatHappened: what_happened || input_text || '',
        footageRows:  footage,
        emit
      });
    } else {
      // hybrid — concept and what_happened arrive as separate fields from the client
      result = await generateHybrid({
        projectId,
        concept:      concept || input_text || '',
        whatCaptured: what_happened || footage_text || '',
        footageRows:  footage,
        emit
      });
    }

    const scriptText  = result.script || result.shooting_script || '';
    const outlineText = result.outline || null;
    const rawInput    = ep === 'script_first'
      ? (input_text || '')
      : ep === 'hybrid'
        ? `CONCEPT: ${concept || input_text || ''}\n\nFOOTAGE: ${what_happened || ''}`
        : (what_happened || input_text || '');

    const scriptId = db.insertWritrScript({
      project_id:        projectId,
      entry_point:       ep,
      input_type:        ep === 'script_first' ? 'script' : ep === 'shoot_first' ? 'what_happened' : 'hybrid',
      raw_input:         rawInput,
      generated_outline: outlineText,
      generated_script:  scriptText,
      beat_map_json:     result.beat_map        || [],
      hook_variations:   result.hook_variations || [],
      story_found:       result.story_found     || null,
      anchor_moment:     result.anchor_moment   || null,
      missing_beats:     result.missing_beats   || [],
      iteration_count:   0
    });

    db.updateProjectWritr(projectId, { active_script_id: scriptId });

    // Send final completion event with all result data at top level
    write({
      stage:           'complete',
      script_id:       scriptId,
      entry_point:     ep,
      script:          scriptText,
      outline:         outlineText,
      beat_map:        result.beat_map        || [],
      missing_beats:   result.missing_beats   || [],
      hook_variations: result.hook_variations || [],
      story_found:     result.story_found     || null,
      anchor_moment:   result.anchor_moment   || null,
      reconciliation:  result.reconciliation  || null,
      gaps_to_capture: result.gaps_to_capture || [],
    });

    end();

  } catch (err) {
    console.error('[WritΩr] generate error:', err.message);
    write({ stage: 'error', error: err.message });
    end();
  }
});

// ─────────────────────────────────────────────
// GET /api/writr/status/:job_id
// SSE stream for generate job
// ─────────────────────────────────────────────

router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// POST /api/writr/iterate
// Revise a script based on creator feedback
// Body: { project_id, script_id, feedback }
// ─────────────────────────────────────────────

router.post('/iterate', async (req, res) => {
  const { project_id, script_id, feedback } = req.body;

  const projectId = parseInt(project_id, 10);
  const scriptId  = parseInt(script_id, 10);

  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  if (!scriptId)  return res.status(400).json({ error: 'script_id required' });
  if (!feedback?.trim()) return res.status(400).json({ error: 'feedback required' });

  const existing = db.getWritrScript(scriptId);
  if (!existing) return res.status(404).json({ error: 'Script not found' });

  const { write, end } = startSseResponse(req, res);

  try {
    const currentScript = existing.generated_script || existing.shooting_script || '';
    if (!currentScript) throw new Error('No script text to iterate on');

    // emit helper — filters module 'complete' progress msgs
    const emit = (ev) => { if (ev.stage !== 'complete') write(ev); };

    const result = await iterateScript({
      projectId,
      currentScript,
      feedback,
      iterationCount: existing.iteration_count || 0,
      emit
    });

    const newIterCount = (existing.iteration_count || 0) + 1;

    const newScriptId = db.insertWritrScript({
      project_id:        projectId,
      entry_point:       existing.entry_point,
      input_type:        'iteration',
      raw_input:         feedback,
      generated_script:  result.script,
      beat_map_json:     result.beat_map      || [],
      missing_beats:     result.missing_beats || [],
      iteration_count:   newIterCount,
      story_found:       existing.story_found    || null,
      anchor_moment:     existing.anchor_moment  || null,
      hook_variations:   existing.hook_variations || []
    });

    write({
      stage:           'complete',
      script_id:       newScriptId,
      iteration_count: newIterCount,
      script:          result.script,
      beat_map:        result.beat_map      || [],
      missing_beats:   result.missing_beats || [],
      changes_made:    result.changes_made  || []
    });

    end();

  } catch (err) {
    console.error('[WritΩr] iterate error:', err.message);
    write({ stage: 'error', error: err.message });
    end();
  }
});

// ─────────────────────────────────────────────
// GET /api/writr/iterate/status/:job_id
// SSE stream for iterate job (shares same job store)
// ─────────────────────────────────────────────

router.get('/iterate/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// POST /api/writr/:project_id/approve
// Approve a script — syncs to SelectsΩr scripts table
// Body: { script_id }
// ─────────────────────────────────────────────

router.post('/:project_id/approve', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  const scriptId  = parseInt(req.body.script_id, 10);

  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });
  if (!scriptId)  return res.status(400).json({ error: 'script_id required' });

  try {
    const script = db.getWritrScript(scriptId);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    if (script.project_id !== projectId) return res.status(403).json({ error: 'Script does not belong to this project' });

    // approveWritrScript: marks approved, sets active_script_id, syncs to scripts table
    db.approveWritrScript(projectId, scriptId);

    console.log(`[WritΩr] Script ${scriptId} approved for project ${projectId} — synced to SelectsΩr`);

    res.json({
      ok:         true,
      script_id:  scriptId,
      project_id: projectId,
      message:    'Script approved. SelectsΩr will use this script as reference.'
    });
  } catch (err) {
    console.error('[WritΩr] approve error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
