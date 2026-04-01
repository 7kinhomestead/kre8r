/**
 * DaVinci Resolve integration routes — /api/davinci
 *
 * All Python scripts in scripts/davinci/ are called via child_process.
 * DaVinci Resolve must be running with scripting API enabled (port 9237).
 * Scripts communicate JSON over stdout; errors on stderr.
 */

'use strict';

const express        = require('express');
const router         = express.Router();
const path           = require('path');
const fs             = require('fs');
const { spawn }      = require('child_process');
const db             = require('../db');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts', 'davinci');

// ─────────────────────────────────────────────
// INTERNAL: call a Python script, return parsed JSON
// ─────────────────────────────────────────────
function runScript(scriptName, args = [], timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const child = spawn('python', [scriptPath, ...args], {
      env: { ...process.env },
      timeout: timeoutMs
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (stderr) console.warn(`[DaVinci/${scriptName}] stderr:`, stderr.trim());
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        reject(new Error(
          `Script ${scriptName} returned non-JSON output. Exit code: ${code}. ` +
          `stdout: ${stdout.slice(0, 200)}. stderr: ${stderr.slice(0, 200)}`
        ));
      }
    });

    child.on('error', (e) => reject(new Error(`Failed to spawn ${scriptName}: ${e.message}`)));
  });
}

// ─────────────────────────────────────────────
// GET /api/davinci/project/:project_id
// Returns full DaVinci project status + timelines
// ─────────────────────────────────────────────
router.get('/project/:project_id', (req, res) => {
  try {
    const status = db.getDavinciProjectStatus(parseInt(req.params.project_id));
    if (!status) return res.status(404).json({ error: 'Project not found' });
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/davinci/projects — all projects with DaVinci integration
// ─────────────────────────────────────────────
router.get('/projects', (req, res) => {
  try {
    const projects = db.getAllProjectsWithDavinci();
    const result   = projects.map(p => ({
      ...p,
      davinci_timelines: db.getDavinciTimelines(p.id)
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/davinci/create-project
// Body: { project_id, braw_folder_path? }
// ─────────────────────────────────────────────
router.post('/create-project', async (req, res) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });

  try {
    const project = db.getProject(parseInt(project_id));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Build footage_json: group proxy MP4s by shot_type for this project
    const footage = db.getAllFootage({ project_id: parseInt(project_id) });
    const footageByType = {};
    for (const f of footage) {
      if (!f.file_path) continue;
      const k = f.shot_type || 'unclassified';
      if (!footageByType[k]) footageByType[k] = [];
      footageByType[k].push(f.file_path);
    }

    const script = db.getScript?.(parseInt(project_id));
    const pkg    = db.getSelectedPackage?.(parseInt(project_id));

    const nameSuffix = req.body.name_suffix ? String(req.body.name_suffix).replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const args = [
      '--project_id',   String(project_id),
      '--project_name', project.title.replace(/\s+/g, '-') + nameSuffix,
      '--footage_json', JSON.stringify(footageByType),
      '--content_angle', project.content_angle || '',
      '--creator_name',  '7 Kin Homestead'
    ];
    if (script?.full_script)   args.push('--script_text', script.full_script.slice(0, 2000));
    if (pkg?.hook)             args.push('--package_hook', pkg.hook);

    const result = await runScript('create-project.py', args, 300_000); // 5min timeout

    if (!result.ok) return res.status(500).json(result);

    // Update DB
    db.updateProjectDavinciState(
      parseInt(project_id),
      'created',
      result.project_name
    );
    db.createDavinciTimeline({
      project_id:     parseInt(project_id),
      timeline_name:  '01_PROXY_GRADE',
      timeline_index: 1,
      state:          'awaiting_creator',
      notes:          `Created ${new Date().toISOString()}`
    });

    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/davinci/export-proxies
// Body: { project_id, braw_folder_path }
// ─────────────────────────────────────────────
router.post('/export-proxies', async (req, res) => {
  const { project_id, braw_folder_path } = req.body;
  if (!project_id)       return res.status(400).json({ error: 'project_id is required' });
  if (!braw_folder_path) return res.status(400).json({ error: 'braw_folder_path is required' });

  try {
    const project = db.getProject(parseInt(project_id));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!project.davinci_project_name) {
      return res.status(400).json({
        error: 'No DaVinci project linked to this project. Run create-project first.'
      });
    }

    // Build shot_type_map: filename → shot_type from VaultΩr BRAW records
    const footage = db.getAllFootage({ project_id: parseInt(project_id) });
    const shotTypeMap = {};
    for (const f of footage) {
      if (f.braw_source_path) {
        shotTypeMap[path.basename(f.braw_source_path)] = f.shot_type || 'b-roll';
      }
    }

    // Proxy output MUST be the vault intake folder so VaultΩr watcher
    // auto-ingests proxies and links them back to their BRAW records.
    // proxy_output_path in the request body is only accepted as an explicit
    // override — log a warning when it's used so it's never silent.
    let intakeFolder = null;
    try {
      const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'creator-profile.json'), 'utf8'));
      intakeFolder = profile?.vault?.intake_folder || null;
    } catch (e) {
      console.warn('[DaVinci] Could not read creator-profile.json:', e.message);
    }

    let proxyOutput;
    if (req.body.proxy_output_path) {
      console.warn(`[DaVinci] WARNING: proxy_output_path override in request: ${req.body.proxy_output_path}`);
      console.warn('[DaVinci] Proxies sent here will NOT be auto-ingested by VaultΩr watcher.');
      proxyOutput = req.body.proxy_output_path;
    } else if (intakeFolder) {
      proxyOutput = intakeFolder;
    } else {
      // Last resort — should never happen if creator-profile.json is present
      proxyOutput = path.join(path.dirname(braw_folder_path), 'proxies');
      console.warn(`[DaVinci] creator-profile.json vault.intake_folder not set — falling back to ${proxyOutput}`);
    }

    console.log(`[DaVinci] Proxy output → ${proxyOutput}`);

    const args = [
      '--project_name',  project.davinci_project_name,
      '--braw_folder',   braw_folder_path,
      '--proxy_output',  proxyOutput,
      '--shot_type_map', JSON.stringify(shotTypeMap)
    ];

    // Update state to proxies_rendering before starting (non-blocking fire)
    try { db.updateProjectDavinciState(parseInt(project_id), 'proxies_rendering'); } catch(e) {}

    const result = await runScript('braw-proxy-export.py', args, 7_200_000); // 2hr timeout

    if (!result.ok) return res.status(500).json(result);

    // Update state to awaiting_creator_grade
    try { db.updateProjectDavinciState(parseInt(project_id), 'awaiting_creator_grade'); } catch(e) {}

    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/davinci/add-timeline
// Body: { project_id, timeline_name }
// ─────────────────────────────────────────────
router.post('/add-timeline', async (req, res) => {
  const { project_id, timeline_name } = req.body;
  if (!project_id)    return res.status(400).json({ error: 'project_id is required' });
  if (!timeline_name) return res.status(400).json({ error: 'timeline_name is required' });

  try {
    const project = db.getProject(parseInt(project_id));
    if (!project)                    return res.status(404).json({ error: 'Project not found' });
    if (!project.davinci_project_name) return res.status(400).json({ error: 'No DaVinci project linked to this project. Run create-project first.' });

    // Build cut/footage payloads for the script
    const footage = db.getAllFootage({ project_id: parseInt(project_id) });
    const footageByType = {};
    for (const f of footage) {
      const k = f.shot_type || 'unclassified';
      if (!footageByType[k]) footageByType[k] = [];
      footageByType[k].push({ path: f.file_path, quality_flag: f.quality_flag, id: f.id });
    }

    const cuts = db.getCutsByProject?.(parseInt(project_id)) || [];

    const args = [
      '--project_name',  project.davinci_project_name,
      '--timeline_name', timeline_name,
      '--footage_json',  JSON.stringify(footageByType),
      '--cuts_json',     JSON.stringify(cuts),
      '--skip_if_exists', 'true'
    ];

    const result = await runScript('add-timeline.py', args, 300_000);

    if (!result.ok && !result.skipped) return res.status(500).json(result);

    if (!result.skipped) {
      // Record in DB
      const timelines = db.getDavinciTimelines(parseInt(project_id));
      db.createDavinciTimeline({
        project_id:     parseInt(project_id),
        timeline_name,
        timeline_index: timelines.length + 1,
        state:          result.state || 'active',
        notes:          `Added ${new Date().toISOString()}`
      });
    }

    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/davinci/update-state
// Body: { project_id, state }
// ─────────────────────────────────────────────
router.post('/update-state', (req, res) => {
  const { project_id, state } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  if (!state)      return res.status(400).json({ error: 'state is required' });
  try {
    db.updateProjectDavinciState(parseInt(project_id), state);
    res.json({ ok: true, project_id, state });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/davinci/grade-approved/:project_id
// Creator signals personal grade is done.
// Triggers 02_SELECTS timeline creation.
// ─────────────────────────────────────────────
router.post('/grade-approved/:project_id', async (req, res) => {
  const projectId = parseInt(req.params.project_id);
  try {
    const project = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Transition state
    db.updateProjectDavinciState(projectId, 'grade_approved');

    // Fire add-timeline for 02_SELECTS (async — respond immediately)
    const footage = db.getAllFootage({ project_id: projectId });
    const footageByType = {};
    for (const f of footage) {
      const k = f.shot_type || 'unclassified';
      if (!footageByType[k]) footageByType[k] = [];
      footageByType[k].push({ path: f.file_path, quality_flag: f.quality_flag, id: f.id });
    }

    const args = [
      '--project_name',  project.davinci_project_name,
      '--timeline_name', '02_SELECTS',
      '--footage_json',  JSON.stringify(footageByType),
      '--skip_if_exists', 'true'
    ];

    // Non-blocking: respond immediately, script runs in background
    runScript('add-timeline.py', args, 300_000).then(result => {
      if (result.ok && !result.skipped) {
        const timelines = db.getDavinciTimelines(projectId);
        db.createDavinciTimeline({
          project_id: projectId, timeline_name: '02_SELECTS',
          timeline_index: timelines.length + 1, state: 'active',
          notes: `Grade approved ${new Date().toISOString()}`
        });
        db.updateProjectDavinciState(projectId, 'rough_cut_ready');
      }
    }).catch(e => console.error('[DaVinci] 02_SELECTS creation failed:', e.message));

    res.json({ ok: true, state: 'grade_approved', message: '02_SELECTS timeline being created in DaVinci' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = { router, runScript };
