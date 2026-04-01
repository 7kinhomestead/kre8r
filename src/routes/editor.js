/**
 * EditΩr Route — src/routes/editor.js
 *
 * POST /api/editor/selects/build/:project_id   — run SelectsΩr engine (SSE job)
 * GET  /api/editor/selects/status/:job_id       — SSE progress stream
 * GET  /api/editor/selects/:project_id          — get selects data for a project
 * DELETE /api/editor/selects/:project_id        — clear selects + reset editor state
 *
 * POST /api/editor/davinci/build/:project_id    — build 02_SELECTS timeline in Resolve (SSE job)
 *
 * GET  /api/editor/broll/:project_id            — get b-roll suggestions + candidates
 * POST /api/editor/broll/import/:project_id     — import assigned b-roll into Resolve (SSE job)
 * GET  /api/editor/broll/status/:job_id         — SSE progress stream for b-roll import
 */

'use strict';

const express          = require('express');
const { EventEmitter } = require('events');
const crypto           = require('crypto');
const { spawn }        = require('child_process');
const path             = require('path');

const { buildSelects }        = require('../editor/selects-new');
const { getBrollSuggestions, importBroll } = require('../editor/broll-bridge');
const db = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// IN-MEMORY JOB STORE (same pattern as cutor.js)
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

  const onEvent = (data) => send(data);
  const onDone  = () => res.end();

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
}

// ─────────────────────────────────────────────
// SELECTS — BUILD
// POST /api/editor/selects/build/:project_id
// ─────────────────────────────────────────────

router.post('/selects/build/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const job = createJob();
  res.json({ job_id: job.id, project_id: projectId });

  (async () => {
    try {
      const result = await buildSelects(
        projectId,
        (p) => pushEvent(job, p)
      );

      if (!result.ok) return failJob(job, result.error);
      finishJob(job, result);
    } catch (err) {
      failJob(job, err.message);
    }
  })();
});

// ─────────────────────────────────────────────
// SELECTS — STATUS (SSE)
// GET /api/editor/selects/status/:job_id
// ─────────────────────────────────────────────

router.get('/selects/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// SELECTS — GET
// GET /api/editor/selects/:project_id
// ─────────────────────────────────────────────

router.get('/selects/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const sections     = db.getSelectsByProject(projectId);
  const goldNuggets  = sections.filter(s => s.gold_nugget);
  const fireSections = sections.filter(s => s.fire_suggestion);

  res.json({
    project_id:     projectId,
    project_title:  project.title,
    editor_state:   project.editor_state || null,
    sections,
    gold_nuggets:   goldNuggets.length,
    fire_sections:  fireSections.length,
    total:          sections.length
  });
});

// ─────────────────────────────────────────────
// SELECTS — DELETE
// DELETE /api/editor/selects/:project_id
// ─────────────────────────────────────────────

router.delete('/selects/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  db.deleteSelectsByProject(projectId);
  db.updateProjectEditorState(projectId, null);

  res.json({ ok: true, project_id: projectId });
});

// ─────────────────────────────────────────────
// DAVINCI — BUILD SELECTS TIMELINE
// POST /api/editor/davinci/build/:project_id
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

router.post('/davinci/build/:project_id', (req, res) => {
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

      const sections = db.getSelectsByProject(projectId);
      if (sections.length === 0) {
        return failJob(job, 'No selects found for this project. Run Build Selects first.');
      }

      // Build footage_paths_json: { footage_id → file_path }
      const allFootage    = db.getAllFootage({ project_id: projectId });
      const footagePaths  = Object.fromEntries(
        allFootage.map(f => [f.id, f.organized_path || f.file_path || ''])
      );

      // Find DaVinci project name — read from projects table
      // (davinci_timelines has no resolve_project_name column)
      const davinciName = project.davinci_project_name || project.title;
      const fps         = project.fps || 24;  // projects table has no fps column — defaults to 24

      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'davinci', 'build-selects.py');

      pushEvent(job, { stage: 'davinci_start', sections: sections.length });

      const proc = spawn(binary, [
        scriptPath,
        '--project_id',       String(projectId),
        '--project_name',     davinciName,
        '--selects_json',     JSON.stringify(sections),
        '--footage_paths_json', JSON.stringify(footagePaths),
        '--fps',              String(fps)
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
          return failJob(job, `build-selects.py exited ${code}: ${stderr.slice(-400)}`);
        }
        try {
          const result = JSON.parse(stdout.trim());
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
// BROLL — GET SUGGESTIONS
// GET /api/editor/broll/:project_id
// ─────────────────────────────────────────────

router.get('/broll/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const data = getBrollSuggestions(projectId);
  res.json({ project_id: projectId, project_title: project.title, ...data });
});

// ─────────────────────────────────────────────
// BROLL — IMPORT (SSE job)
// POST /api/editor/broll/import/:project_id
// Body: { assignments: [{ section_id, footage_id }] }
// ─────────────────────────────────────────────

router.post('/broll/import/:project_id', (req, res) => {
  const projectId   = parseInt(req.params.project_id, 10);
  const assignments = req.body?.assignments;

  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: 'assignments array required' });
  }

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} not found` });

  const job = createJob();
  res.json({ job_id: job.id, project_id: projectId });

  (async () => {
    try {
      const result = await importBroll(
        projectId,
        assignments,
        (p) => pushEvent(job, p)
      );
      if (!result.ok) return failJob(job, result.error);
      finishJob(job, result);
    } catch (err) {
      failJob(job, err.message);
    }
  })();
});

// ─────────────────────────────────────────────
// BROLL — IMPORT STATUS (SSE)
// GET /api/editor/broll/status/:job_id
// ─────────────────────────────────────────────

router.get('/broll/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

module.exports = router;
