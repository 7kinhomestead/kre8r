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
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send    = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const onEvent = (data) => send(data);
  const onDone  = () => res.end();

  for (const ev of job.events) send(ev);

  if (job.status !== 'running') { res.end(); return; }

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
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

router.post('/generate', (req, res) => {
  const { project_id, entry_point, input_text, what_happened, concept, footage_text } = req.body;

  const projectId = parseInt(project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'project_id required' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const job = createJob();
  res.json({ ok: true, job_id: job.id });

  (async () => {
    try {
      const ep     = entry_point || readConfig(projectId)?.entry_point || 'shoot_first';
      const footage = db.getAllFootage({ project_id: projectId });

      pushEvent(job, { stage: 'analyzing', message: `Starting ${ep.replace('_', ' ')} analysis…` });

      let result;

      if (ep === 'script_first') {
        result = await generateScriptFirst({
          projectId,
          inputText: input_text || '',
          emit: (ev) => pushEvent(job, ev)
        });
      } else if (ep === 'shoot_first') {
        result = await generateShootFirst({
          projectId,
          whatHappened: what_happened || '',
          footageRows:  footage,
          emit: (ev) => pushEvent(job, ev)
        });
      } else {
        // hybrid
        result = await generateHybrid({
          projectId,
          concept:      concept || input_text || '',
          whatCaptured: what_happened || footage_text || '',
          footageRows:  footage,
          emit: (ev) => pushEvent(job, ev)
        });
      }

      // Determine which script text field to use
      const scriptText    = result.script || result.shooting_script || '';
      const outlineText   = result.outline || null;
      const rawInput      = ep === 'script_first'
        ? (input_text || '')
        : ep === 'hybrid'
          ? `CONCEPT: ${concept || ''}\n\nFOOTAGE: ${what_happened || ''}`
          : (what_happened || '');

      // Save to DB
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

      // Link as active script on the project (not yet approved — just the latest draft)
      db.updateProjectWritr(projectId, { active_script_id: scriptId });

      finishJob(job, {
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
        changes_made:    result.changes_made    || []
      });

    } catch (err) {
      console.error('[WritΩr] generate error:', err.message);
      failJob(job, err.message);
    }
  })();
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

router.post('/iterate', (req, res) => {
  const { project_id, script_id, feedback } = req.body;

  const projectId = parseInt(project_id, 10);
  const scriptId  = parseInt(script_id, 10);

  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  if (!scriptId)  return res.status(400).json({ error: 'script_id required' });
  if (!feedback?.trim()) return res.status(400).json({ error: 'feedback required' });

  const existing = db.getWritrScript(scriptId);
  if (!existing) return res.status(404).json({ error: 'Script not found' });

  const job = createJob();
  res.json({ ok: true, job_id: job.id });

  (async () => {
    try {
      const currentScript = existing.generated_script || existing.shooting_script || '';
      if (!currentScript) throw new Error('No script text to iterate on');

      const result = await iterateScript({
        projectId,
        currentScript,
        feedback,
        iterationCount: existing.iteration_count || 0,
        emit: (ev) => pushEvent(job, ev)
      });

      const newIterCount = (existing.iteration_count || 0) + 1;

      // Save new iteration as a new script row (preserves history)
      const newScriptId = db.insertWritrScript({
        project_id:        projectId,
        entry_point:       existing.entry_point,
        input_type:        'iteration',
        raw_input:         feedback,
        generated_script:  result.script,
        beat_map_json:     result.beat_map      || [],
        missing_beats:     result.missing_beats || [],
        iteration_count:   newIterCount,
        // Carry forward metadata from parent
        story_found:       existing.story_found || null,
        anchor_moment:     existing.anchor_moment || null,
        hook_variations:   existing.hook_variations || []
      });

      finishJob(job, {
        script_id:       newScriptId,
        iteration_count: newIterCount,
        script:          result.script,
        beat_map:        result.beat_map      || [],
        missing_beats:   result.missing_beats || [],
        changes_made:    result.changes_made  || []
      });

    } catch (err) {
      console.error('[WritΩr] iterate error:', err.message);
      failJob(job, err.message);
    }
  })();
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
