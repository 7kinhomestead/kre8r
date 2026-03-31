/**
 * ShootDay / DirectΩr Route — src/routes/shootday.js
 *
 * GET  /api/shootday/package/:project_id   — generate self-contained offline HTML
 * GET  /api/shootday/:project_id/beats     — beat list merged with take data
 * GET  /api/shootday/:project_id/script    — approved script (clean text)
 * GET  /api/shootday/:project_id/takes     — all takes for project
 * POST /api/shootday/:project_id/take      — upsert a take (status + note)
 * POST /api/shootday/:project_id/reset     — clear all takes for fresh session
 * GET  /api/shootday/:project_id/summary   — coverage summary for director mirror view
 */

'use strict';

const express = require('express');
const path    = require('path');
const os      = require('os');

const db                = require('../db');
const { readConfig }    = require('../pipr/beat-tracker');

const router = express.Router();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

/** Merge pipr beats + writr beat_map + take records into unified beat list */
function buildBeatList(projectId) {
  const project  = db.getProject(projectId);
  if (!project) return null;

  // Source 1: approved WritΩr script beat map (most detailed)
  const script   = db.getApprovedWritrScript(projectId);
  const writrBeats = script?.beat_map_json || script?.beat_map || null;

  // Source 2: PipΩr config beats
  const config   = readConfig(projectId);
  const piprBeats = config?.beats || [];

  // Use WritΩr beats if available and non-empty, else PipΩr
  let beats = (writrBeats && writrBeats.length > 0) ? writrBeats : piprBeats;

  // Source 3: take records from shoot_takes
  const takes    = db.getShootTakes(projectId);
  const takeMap  = {};
  for (const t of takes) takeMap[t.beat_index] = t;

  // Merge take data onto each beat
  beats = beats.map((b, i) => {
    const idx = b.index != null ? b.index : (i + 1);
    const take = takeMap[idx] || null;
    return {
      index:              idx,
      name:               b.name || b.beat_name || `Beat ${idx}`,
      emotional_function: b.emotional_function || '',
      reality_note:       b.reality_note || b.notes || '',
      talking_head_prompt: b.talking_head_prompt || null,
      target_pct:         b.target_pct || null,
      target_seconds:     b.target_seconds || null,
      shot_type:          b.shot_type || (b.talking_head_prompt ? 'talking_head' : 'broll'),
      // take state
      status:             take?.status     || 'needed',
      take_number:        take?.take_number || 0,
      note:               take?.note        || null,
    };
  });

  return { project, beats, script_approved: !!script, config };
}

/** Strip script to clean readable text only (no beat labels, no production notes) */
function cleanScriptText(script) {
  if (!script) return '';
  const raw = script.generated_script || script.full_script || '';
  if (!raw) return '';
  // Remove beat labels [BEAT NAME], stage directions in brackets
  return raw
    .replace(/\[SAY TO CAMERA\]:\s*/gi, '')
    .replace(/\[NEED TO CAPTURE\]:[^\n]*/gi, '')
    .replace(/\[B-ROLL[^\]]*\]:\s*/gi, '')
    .replace(/^\[.*?\]\s*$/gm, '')
    .replace(/^---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Shot type label */
function shotTypeLabel(beat) {
  if (beat.talking_head_prompt) return 'Talking Head';
  if (beat.shot_type === 'talking_head') return 'Talking Head';
  if (beat.shot_type === 'action') return 'Action';
  return 'B-Roll';
}

/** Priority based on position in structure */
function beatPriority(beat, total) {
  const pct = beat.index / total;
  if (pct <= 0.2 || pct >= 0.85) return 'hero';
  if (beat.emotional_function?.toLowerCase().includes('catalyst') ||
      beat.emotional_function?.toLowerCase().includes('climax') ||
      beat.emotional_function?.toLowerCase().includes('hook')) return 'hero';
  return 'required';
}

// ─────────────────────────────────────────────
// GET /api/shootday/package/:project_id
// Generate a self-contained offline HTML file
// MUST be before /:project_id routes
// ─────────────────────────────────────────────

router.get('/package/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const data = buildBeatList(projectId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { project, beats, script } = data;
  const approvedScript = db.getApprovedWritrScript(projectId);
  const cleanScript    = cleanScriptText(approvedScript);
  const date           = new Date().toISOString().slice(0, 10);
  const safeName       = (project.title || 'project').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const filename       = `shootday_${safeName}_${date}.html`;

  const beatsJSON  = JSON.stringify(beats);
  const scriptJSON = JSON.stringify(cleanScript);
  const projJSON   = JSON.stringify({ id: project.id, title: project.title, date });

  const html = generateOfflineHTML({ project, beats, beatsJSON, scriptJSON, projJSON, date });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
});

// ─────────────────────────────────────────────
// GET /api/shootday/:project_id/beats
// ─────────────────────────────────────────────

router.get('/:project_id/beats', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const data = buildBeatList(projectId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { beats, project, script_approved, config } = data;
  const covered   = beats.filter(b => b.status === 'good').length;

  res.json({
    ok: true,
    project_id:     projectId,
    project_title:  project.title,
    story_structure: config?.story_structure || null,
    script_approved,
    beats,
    coverage: { covered, total: beats.length, pct: beats.length ? Math.round(covered / beats.length * 100) : 0 }
  });
});

// ─────────────────────────────────────────────
// GET /api/shootday/:project_id/script
// ─────────────────────────────────────────────

router.get('/:project_id/script', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const script = db.getApprovedWritrScript(projectId);
  if (!script) return res.json({ ok: true, script: null, beats: [] });

  const config = readConfig(projectId);
  const beats  = script.beat_map_json || script.beat_map || config?.beats || [];

  res.json({
    ok:            true,
    script_id:     script.id,
    raw:           script.generated_script || '',
    clean:         cleanScriptText(script),
    beats:         beats,
    story_structure: config?.story_structure || null
  });
});

// ─────────────────────────────────────────────
// GET /api/shootday/:project_id/takes
// ─────────────────────────────────────────────

router.get('/:project_id/takes', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const takes = db.getShootTakes(projectId);
  res.json({ ok: true, takes });
});

// ─────────────────────────────────────────────
// POST /api/shootday/:project_id/take
// Body: { beat_index, beat_name, status, note }
// ─────────────────────────────────────────────

router.post('/:project_id/take', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const { beat_index, beat_name, status, note } = req.body;
  if (beat_index == null) return res.status(400).json({ error: 'beat_index required' });
  if (!['needed', 'good', 'skip'].includes(status)) {
    return res.status(400).json({ error: 'status must be needed|good|skip' });
  }

  const take = db.upsertShootTake(projectId, parseInt(beat_index), beat_name || '', status, note || null);

  // Build updated coverage
  const beats  = buildBeatList(projectId)?.beats || [];
  const covered = beats.filter(b => b.status === 'good').length;

  res.json({
    ok: true,
    take,
    coverage: { covered, total: beats.length, pct: beats.length ? Math.round(covered / beats.length * 100) : 0 }
  });
});

// ─────────────────────────────────────────────
// POST /api/shootday/:project_id/reset
// Clear all takes for a fresh session
// ─────────────────────────────────────────────

router.post('/:project_id/reset', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  db.resetShootTakes(projectId);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
// GET /api/shootday/:project_id/summary
// Coverage summary for director mirror view
// ─────────────────────────────────────────────

router.get('/:project_id/summary', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const data = buildBeatList(projectId);
  if (!data) return res.status(404).json({ error: 'Project not found' });

  const { beats, project } = data;
  const covered  = beats.filter(b => b.status === 'good');
  const skipped  = beats.filter(b => b.status === 'skip');
  const needed   = beats.filter(b => b.status === 'needed');

  res.json({
    ok:            true,
    project_title: project.title,
    coverage: {
      covered:  covered.length,
      skipped:  skipped.length,
      needed:   needed.length,
      total:    beats.length,
      pct:      beats.length ? Math.round(covered.length / beats.length * 100) : 0
    },
    beats: beats.map(b => ({
      index:  b.index,
      name:   b.name,
      status: b.status,
      takes:  b.take_number,
      note:   b.note
    }))
  });
});

// ─────────────────────────────────────────────
// OFFLINE HTML GENERATOR
// Produces a completely self-contained single file
// with all data baked in, zero external dependencies
// ─────────────────────────────────────────────

function generateOfflineHTML({ project, beats, beatsJSON, scriptJSON, projJSON, date }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>ShootDay — ${project.title || 'Session'}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
html,body{height:100%;overscroll-behavior:none;}
body{background:#0D0D1A;color:#E8EBE6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;overflow:hidden;}
:root{--teal:#00C9A7;--amber:#F0B942;--green:#4ADE80;--red:#F87171;--bg:#0D0D1A;--card:#161B2E;--border:#2A3040;--dim:#7A8090;}

/* ── LAYOUT ── */
#app{display:flex;flex-direction:column;height:100vh;height:100dvh;}
#view-area{flex:1;overflow-y:auto;overflow-x:hidden;padding-bottom:80px;-webkit-overflow-scrolling:touch;}

/* ── TAB BAR ── */
#tab-bar{display:flex;position:fixed;bottom:0;left:0;right:0;background:#0D0D1A;border-top:1px solid #2A3040;z-index:100;padding-bottom:env(safe-area-inset-bottom);}
.tab-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:10px 4px;background:none;border:none;color:#7A8090;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;min-height:56px;transition:color 0.15s;}
.tab-btn.active{color:var(--teal);}
.tab-icon{font-size:20px;line-height:1;}

/* ── HEADER ── */
.view-header{padding:16px 16px 12px;border-bottom:1px solid #2A3040;position:sticky;top:0;background:#0D0D1A;z-index:50;}
.view-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--dim);margin-bottom:4px;}
.project-name{font-size:20px;font-weight:700;color:#E8EBE6;line-height:1.2;}

/* ── COVERAGE METER ── */
.coverage-wrap{padding:12px 16px;background:#0D0D1A;border-bottom:1px solid #2A3040;}
.coverage-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.coverage-text{font-size:14px;font-weight:700;color:#E8EBE6;}
.coverage-pct{font-size:14px;font-weight:700;}
.coverage-bar{height:6px;background:#2A3040;border-radius:3px;overflow:hidden;}
.coverage-fill{height:100%;border-radius:3px;transition:width 0.4s ease;}
.pct-green .coverage-fill{background:var(--green);}
.pct-amber .coverage-fill{background:var(--amber);}
.pct-red   .coverage-fill{background:var(--red);}
.pct-green .coverage-pct{color:var(--green);}
.pct-amber .coverage-pct{color:var(--amber);}
.pct-red   .coverage-pct{color:var(--red);}

/* ── SHOT CARDS ── */
.shots-list{padding:12px 12px 16px;}
.shot-card{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-bottom:10px;overflow:hidden;position:relative;transition:transform 0.15s,box-shadow 0.15s;touch-action:pan-y;}
.shot-card.status-good{border-color:rgba(74,222,128,0.4);background:rgba(74,222,128,0.05);}
.shot-card.status-skip{border-color:rgba(122,128,144,0.3);opacity:0.65;}
.shot-card-inner{padding:16px;}
.shot-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;}
.shot-beat-num{font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:0.8px;}
.shot-status-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:3px 9px;border-radius:20px;flex-shrink:0;}
.badge-needed{background:rgba(122,128,144,0.15);color:var(--dim);}
.badge-good{background:rgba(74,222,128,0.15);color:var(--green);}
.badge-skip{background:rgba(122,128,144,0.1);color:var(--dim);}
.shot-name{font-size:18px;font-weight:700;color:#E8EBE6;line-height:1.2;margin-bottom:6px;}
.shot-reality{font-size:14px;color:#A8B0C0;line-height:1.5;}
.shot-th{margin-top:10px;padding:10px 12px;background:rgba(0,201,167,0.08);border-left:3px solid var(--teal);border-radius:0 8px 8px 0;}
.shot-th-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--teal);margin-bottom:3px;}
.shot-th-text{font-size:14px;color:#C8D0D8;line-height:1.4;font-style:italic;}
.shot-footer{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid #2A3040;}
.take-count{font-size:13px;color:var(--dim);}
.shot-actions{display:flex;gap:8px;}
.shot-btn{min-width:56px;height:40px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.12s;padding:0 14px;}
.btn-good{background:rgba(74,222,128,0.15);color:var(--green);border:1px solid rgba(74,222,128,0.3);}
.btn-good:active{background:rgba(74,222,128,0.3);}
.btn-skip{background:rgba(122,128,144,0.1);color:var(--dim);border:1px solid rgba(122,128,144,0.2);}
.btn-skip:active{background:rgba(122,128,144,0.2);}
.btn-undo{background:rgba(240,185,66,0.1);color:var(--amber);border:1px solid rgba(240,185,66,0.25);}
.btn-undo:active{background:rgba(240,185,66,0.2);}

/* Shot expand */
.shot-expanded{display:none;padding:12px 16px 16px;border-top:1px solid #2A3040;}
.shot-card.expanded .shot-expanded{display:block;}
.note-area{width:100%;background:#0D0D1A;border:1px solid #2A3040;border-radius:8px;color:#E8EBE6;font-family:inherit;font-size:15px;padding:10px 12px;resize:none;margin-top:8px;}
.note-area:focus{outline:none;border-color:var(--teal);}
.save-note-btn{margin-top:8px;padding:10px 20px;background:var(--teal);color:#0D0D1A;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;width:100%;}

/* ── SCRIPT VIEW ── */
.script-toggle{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #2A3040;}
.script-toggle-btn{flex:1;padding:10px;border-radius:10px;border:1px solid #2A3040;background:none;color:var(--dim);font-size:13px;font-weight:700;cursor:pointer;transition:all 0.12s;}
.script-toggle-btn.active{background:rgba(0,201,167,0.12);border-color:rgba(0,201,167,0.3);color:var(--teal);}
.beats-list{padding:12px;}
.beat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:8px;}
.beat-card.covered{border-color:rgba(74,222,128,0.3);}
.beat-card-num{font-size:10px;font-weight:700;text-transform:uppercase;color:var(--dim);letter-spacing:0.8px;margin-bottom:4px;}
.beat-card-name{font-size:17px;font-weight:700;margin-bottom:4px;}
.beat-card-func{font-size:13px;color:var(--dim);margin-bottom:8px;}
.beat-card-th{font-size:14px;color:var(--teal);font-style:italic;line-height:1.5;}
.beat-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;}
.dot-good{background:var(--green);}
.dot-needed{background:#2A3040;}
.clean-script{padding:20px 16px;font-size:17px;line-height:1.8;color:#D0D8E0;white-space:pre-wrap;word-wrap:break-word;}

/* ── REVIEW VIEW ── */
.review-list{padding:12px;}
.review-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:8px;}
.review-card.status-good{border-color:rgba(74,222,128,0.3);}
.review-card.status-skip{opacity:0.6;}
.review-beat{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);letter-spacing:0.8px;}
.review-name{font-size:16px;font-weight:700;margin:3px 0 6px;}
.review-meta{display:flex;gap:12px;font-size:13px;color:var(--dim);}
.review-note{margin-top:8px;font-size:13px;color:#A8B0C0;font-style:italic;}
.all-covered{text-align:center;padding:32px 16px;color:var(--green);}
.all-covered-icon{font-size:48px;margin-bottom:12px;}
.all-covered-title{font-size:20px;font-weight:700;margin-bottom:6px;}
.all-covered-sub{font-size:14px;color:var(--dim);}
.still-needed{padding:16px;background:rgba(240,185,66,0.06);border:1px solid rgba(240,185,66,0.2);border-radius:12px;margin:12px;}
.still-needed-title{font-size:13px;font-weight:700;color:var(--amber);margin-bottom:8px;}
.still-needed-item{font-size:14px;color:#C8D0D8;padding:4px 0;}

/* ── SWIPE FEEDBACK ── */
.swipe-hint{position:absolute;top:50%;transform:translateY(-50%);font-size:22px;font-weight:900;pointer-events:none;opacity:0;transition:opacity 0.1s;z-index:10;}
.swipe-hint-good{right:16px;color:var(--green);}
.swipe-hint-skip{left:16px;color:var(--dim);}

/* ── SETTINGS PANEL ── */
#settings-panel{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(13,13,26,0.95);z-index:200;display:none;overflow-y:auto;}
#settings-panel.open{display:block;}
.settings-header{display:flex;align-items:center;justify-content:space-between;padding:20px 16px 16px;border-bottom:1px solid #2A3040;}
.settings-title{font-size:20px;font-weight:700;}
.settings-close{background:none;border:none;color:var(--dim);font-size:24px;cursor:pointer;padding:4px;line-height:1;}
.settings-body{padding:16px;}
.settings-group{margin-bottom:24px;}
.settings-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin-bottom:12px;}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(42,48,64,0.5);}
.toggle-info{flex:1;}
.toggle-name{font-size:16px;font-weight:600;margin-bottom:2px;}
.toggle-desc{font-size:13px;color:var(--dim);}
.toggle-switch{position:relative;width:48px;height:26px;flex-shrink:0;margin-left:16px;}
.toggle-switch input{opacity:0;width:0;height:0;}
.toggle-slider{position:absolute;inset:0;background:#2A3040;border-radius:13px;cursor:pointer;transition:background 0.2s;}
.toggle-slider:before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;background:white;border-radius:50%;transition:transform 0.2s;}
.toggle-switch input:checked + .toggle-slider{background:var(--teal);}
.toggle-switch input:checked + .toggle-slider:before{transform:translateX(22px);}
.date-badge{font-size:12px;color:var(--dim);text-align:center;padding:16px;}
</style>
</head>
<body>
<div id="app">

  <!-- VIEW AREA -->
  <div id="view-area">

    <!-- SHOTS VIEW -->
    <div id="view-shots" class="view">
      <div class="view-header">
        <div class="view-title">ShootDay · Offline</div>
        <div class="project-name" id="hdr-title"></div>
      </div>
      <div class="coverage-wrap" id="coverage-wrap"></div>
      <div class="shots-list" id="shots-list"></div>
    </div>

    <!-- SCRIPT VIEW -->
    <div id="view-script" class="view" style="display:none">
      <div class="view-header">
        <div class="view-title">Script</div>
        <div class="project-name" id="hdr-title-s"></div>
      </div>
      <div class="script-toggle">
        <button class="script-toggle-btn active" id="btn-beats-view" onclick="setScriptMode('beats')">Story Beats</button>
        <button class="script-toggle-btn" id="btn-clean-view" onclick="setScriptMode('clean')">Clean Script</button>
      </div>
      <div id="beats-view" class="beats-list"></div>
      <div id="clean-view" class="clean-script" style="display:none"></div>
    </div>

    <!-- REVIEW VIEW -->
    <div id="view-review" class="view" style="display:none">
      <div class="view-header">
        <div class="view-title">Review</div>
        <div class="project-name" id="hdr-title-r"></div>
      </div>
      <div id="review-content"></div>
    </div>

  </div><!-- /view-area -->

  <!-- TAB BAR -->
  <div id="tab-bar">
    <button class="tab-btn active" id="tab-shots" onclick="switchTab('shots')">
      <span class="tab-icon">🎬</span>Shots
    </button>
    <button class="tab-btn" id="tab-script" onclick="switchTab('script')">
      <span class="tab-icon">📄</span>Script
    </button>
    <button class="tab-btn" id="tab-review" onclick="switchTab('review')">
      <span class="tab-icon">✅</span>Review
    </button>
    <button class="tab-btn" onclick="openSettings()">
      <span class="tab-icon">⚙️</span>Settings
    </button>
  </div>

</div><!-- /app -->

<!-- SETTINGS PANEL -->
<div id="settings-panel">
  <div class="settings-header">
    <div class="settings-title">Settings</div>
    <button class="settings-close" onclick="closeSettings()">✕</button>
  </div>
  <div class="settings-body">
    <div class="settings-group">
      <div class="settings-label">Features</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-name">Shot Tracker</div>
          <div class="toggle-desc">Swipe to mark good / skip</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="tog-tracker" checked onchange="applyToggles()"><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-name">Take Counter</div>
          <div class="toggle-desc">Count takes per beat</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="tog-takes" checked onchange="applyToggles()"><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-name">Notes</div>
          <div class="toggle-desc">Add notes to each shot</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="tog-notes" checked onchange="applyToggles()"><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-name">Script View</div>
          <div class="toggle-desc">Show script tab</div>
        </div>
        <label class="toggle-switch"><input type="checkbox" id="tog-script" checked onchange="applyToggles()"><span class="toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-label">Session</div>
      <button onclick="resetAllTakes()" style="width:100%;padding:14px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.25);border-radius:10px;color:#F87171;font-size:15px;font-weight:700;cursor:pointer;">🔄 Reset All Takes</button>
    </div>
  </div>
  <div class="date-badge">Offline package · ${date}</div>
</div>

<script>
'use strict';
// ── BAKED-IN DATA ──
const PROJECT = ${projJSON};
const BEATS   = ${beatsJSON};
const SCRIPT  = ${scriptJSON};

// ── STORAGE ──
const STORE_KEY = 'sd_' + PROJECT.id;
function loadTakes() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}
function saveTakes(takes) {
  localStorage.setItem(STORE_KEY, JSON.stringify(takes));
}
let takes = loadTakes();

function getTake(idx) {
  return takes[idx] || { status: 'needed', count: 0, note: '' };
}
function setTake(idx, status, note) {
  const t = getTake(idx);
  const newCount = status === 'needed' ? 0 : (t.count + 1);
  takes[idx] = { status, count: newCount, note: note != null ? note : t.note };
  saveTakes(takes);
}

// ── TOGGLES ──
const prefs = JSON.parse(localStorage.getItem('sd_prefs') || '{"tracker":true,"takes":true,"notes":true,"script":true}');
function savePrefs() { localStorage.setItem('sd_prefs', JSON.stringify(prefs)); }

function applyToggles() {
  prefs.tracker = document.getElementById('tog-tracker').checked;
  prefs.takes   = document.getElementById('tog-takes').checked;
  prefs.notes   = document.getElementById('tog-notes').checked;
  prefs.script  = document.getElementById('tog-script').checked;
  savePrefs();
  document.getElementById('tab-script').style.display = prefs.script ? '' : 'none';
  renderShots();
  renderReview();
}

// ── TABS ──
let currentTab = 'shots';
function switchTab(tab) {
  currentTab = tab;
  ['shots','script','review'].forEach(t => {
    document.getElementById('view-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('tab-' + t)?.classList.toggle('active', t === tab);
  });
  if (tab === 'script') renderScript();
  if (tab === 'review') renderReview();
}

// ── COVERAGE ──
function getCoverage() {
  const covered = BEATS.filter(b => (getTake(b.index).status === 'good')).length;
  const total   = BEATS.length;
  return { covered, total, pct: total ? Math.round(covered / total * 100) : 0 };
}

function renderCoverage() {
  const { covered, total, pct } = getCoverage();
  const cls = pct >= 75 ? 'pct-green' : pct >= 40 ? 'pct-amber' : 'pct-red';
  document.getElementById('coverage-wrap').className = 'coverage-wrap ' + cls;
  document.getElementById('coverage-wrap').innerHTML = \`
    <div class="coverage-label">
      <div class="coverage-text">\${covered} / \${total} beats covered</div>
      <div class="coverage-pct">\${pct}%</div>
    </div>
    <div class="coverage-bar"><div class="coverage-fill" style="width:\${pct}%"></div></div>
  \`;
}

// ── SHOTS ──
function renderShots() {
  const list = document.getElementById('shots-list');
  list.innerHTML = BEATS.map(b => renderShotCard(b)).join('');
  renderCoverage();
  if (prefs.tracker) attachSwipeHandlers();
}

function renderShotCard(b) {
  const take    = getTake(b.index);
  const status  = take.status;
  const count   = take.count;
  const badges  = { needed: 'badge-needed', good: 'badge-good', skip: 'badge-skip' };
  const labels  = { needed: 'NEEDED', good: '✓ GOOD', skip: 'SKIP' };
  const thHTML  = b.talking_head_prompt
    ? \`<div class="shot-th"><div class="shot-th-label">🎤 Say to camera</div><div class="shot-th-text">\${esc(b.talking_head_prompt)}</div></div>\`
    : '';
  const noteHTML = prefs.notes
    ? \`<div class="shot-expanded" id="exp-\${b.index}">
        <div style="font-size:13px;color:var(--dim);margin-bottom:6px;">Note</div>
        <textarea class="note-area" id="note-\${b.index}" rows="2" placeholder="Add a note...">\${esc(take.note || '')}</textarea>
        <button class="save-note-btn" onclick="saveNote(\${b.index})">Save Note</button>
       </div>\`
    : '';
  const takesHTML = prefs.takes ? \`<span class="take-count">Take \${count}</span>\` : '';
  const actionsHTML = prefs.tracker ? \`
    \${status !== 'good' ? \`<button class="shot-btn btn-good" onclick="markBeat(\${b.index},'good',event)">✓ Good</button>\` : ''}
    \${status !== 'skip' && status !== 'good' ? \`<button class="shot-btn btn-skip" onclick="markBeat(\${b.index},'skip',event)">Skip</button>\` : ''}
    \${status !== 'needed' ? \`<button class="shot-btn btn-undo" onclick="markBeat(\${b.index},'needed',event)">Undo</button>\` : ''}
  \` : '';
  return \`
    <div class="shot-card status-\${status}" id="card-\${b.index}" onclick="toggleExpand(\${b.index},event)">
      <span class="swipe-hint swipe-hint-good">✓</span>
      <span class="swipe-hint swipe-hint-skip">↷</span>
      <div class="shot-card-inner">
        <div class="shot-header">
          <div class="shot-beat-num">Beat \${b.index}</div>
          <div class="shot-status-badge \${badges[status]}">\${labels[status]}</div>
        </div>
        <div class="shot-name">\${esc(b.name)}</div>
        \${b.reality_note ? \`<div class="shot-reality">\${esc(b.reality_note)}</div>\` : ''}
        \${thHTML}
        <div class="shot-footer">
          \${takesHTML}
          <div class="shot-actions">\${actionsHTML}</div>
        </div>
      </div>
      \${noteHTML}
    </div>\`;
}

function markBeat(idx, status, e) {
  if (e) e.stopPropagation();
  setTake(idx, status, null);
  renderShots();
  if (currentTab === 'review') renderReview();
  // Haptic
  if (navigator.vibrate) navigator.vibrate(status === 'good' ? [30] : [15]);
}

function toggleExpand(idx, e) {
  if (e && e.target.tagName === 'BUTTON') return;
  if (e && e.target.tagName === 'TEXTAREA') return;
  const card = document.getElementById('card-' + idx);
  if (card) card.classList.toggle('expanded');
}

function saveNote(idx) {
  const val = document.getElementById('note-' + idx)?.value || '';
  const t = getTake(idx);
  takes[idx] = { ...t, note: val };
  saveTakes(takes);
  const card = document.getElementById('card-' + idx);
  if (card) card.classList.remove('expanded');
}

// ── SWIPE GESTURES ──
function attachSwipeHandlers() {
  document.querySelectorAll('.shot-card').forEach(card => {
    let startX = 0, startY = 0, dx = 0;
    const idx = parseInt(card.id.replace('card-',''));
    const hintGood = card.querySelector('.swipe-hint-good');
    const hintSkip = card.querySelector('.swipe-hint-skip');

    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
    }, { passive: true });

    card.addEventListener('touchmove', e => {
      dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (Math.abs(dx) < dy * 0.7) return; // mostly vertical = scroll
      const pct = Math.min(Math.abs(dx) / 80, 1);
      card.style.transform = \`translateX(\${dx * 0.4}px)\`;
      if (hintGood) hintGood.style.opacity = dx > 20 ? pct.toString() : '0';
      if (hintSkip) hintSkip.style.opacity = dx < -20 ? pct.toString() : '0';
    }, { passive: true });

    card.addEventListener('touchend', () => {
      card.style.transform = '';
      if (hintGood) hintGood.style.opacity = '0';
      if (hintSkip) hintSkip.style.opacity = '0';
      if (dx > 70) markBeat(idx, 'good', null);
      else if (dx < -70) markBeat(idx, 'skip', null);
    });
  });
}

// ── SCRIPT ──
let scriptMode = 'beats';
function setScriptMode(mode) {
  scriptMode = mode;
  document.getElementById('beats-view').style.display = mode === 'beats' ? 'block' : 'none';
  document.getElementById('clean-view').style.display = mode === 'clean' ? 'block' : 'none';
  document.getElementById('btn-beats-view').classList.toggle('active', mode === 'beats');
  document.getElementById('btn-clean-view').classList.toggle('active', mode === 'clean');
}

function renderScript() {
  // Beats view
  const beatsHtml = BEATS.map(b => {
    const take = getTake(b.index);
    const covered = take.status === 'good';
    return \`<div class="beat-card \${covered ? 'covered' : ''}">
      <div class="beat-card-num"><span class="beat-status-dot \${covered ? 'dot-good' : 'dot-needed'}"></span>Beat \${b.index}</div>
      <div class="beat-card-name">\${esc(b.name)}</div>
      \${b.emotional_function ? \`<div class="beat-card-func">\${esc(b.emotional_function)}</div>\` : ''}
      \${b.talking_head_prompt ? \`<div class="beat-card-th">"\${esc(b.talking_head_prompt)}"</div>\` : ''}
    </div>\`;
  }).join('');
  document.getElementById('beats-view').innerHTML = beatsHtml;
  document.getElementById('clean-view').textContent = SCRIPT || '(No approved script)';
}

// ── REVIEW ──
function renderReview() {
  const el = document.getElementById('review-content');
  const hasAny = BEATS.some(b => getTake(b.index).status !== 'needed');
  const needed  = BEATS.filter(b => getTake(b.index).status === 'needed');
  const done    = BEATS.filter(b => getTake(b.index).status !== 'needed');

  if (!hasAny) {
    el.innerHTML = \`<div class="all-covered"><div class="all-covered-icon">📋</div><div class="all-covered-title">No takes recorded yet</div><div class="all-covered-sub">Go to Shots tab to start marking beats.</div></div>\`;
    return;
  }

  let html = '<div class="review-list">';
  done.forEach(b => {
    const take = getTake(b.index);
    html += \`<div class="review-card status-\${take.status}">
      <div class="review-beat">Beat \${b.index}</div>
      <div class="review-name">\${esc(b.name)}</div>
      <div class="review-meta">
        <span>\${take.status === 'good' ? '✓ Good' : '↷ Skipped'}</span>
        \${prefs.takes ? \`<span>Take \${take.count}</span>\` : ''}
      </div>
      \${take.note ? \`<div class="review-note">"\${esc(take.note)}"</div>\` : ''}
    </div>\`;
  });
  html += '</div>';

  if (needed.length === 0) {
    html += \`<div class="all-covered"><div class="all-covered-icon">🎉</div><div class="all-covered-title">All Shots Covered</div><div class="all-covered-sub">Every beat marked. Great shoot.</div></div>\`;
  } else {
    html += \`<div class="still-needed"><div class="still-needed-title">Still needed (\${needed.length})</div>\`;
    needed.forEach(b => { html += \`<div class="still-needed-item">· Beat \${b.index} — \${esc(b.name)}</div>\`; });
    html += '</div>';
  }
  el.innerHTML = html;
}

// ── SETTINGS ──
function openSettings() { document.getElementById('settings-panel').classList.add('open'); }
function closeSettings() { document.getElementById('settings-panel').classList.remove('open'); }
function resetAllTakes() {
  if (!confirm('Reset all take data for this session?')) return;
  takes = {};
  saveTakes(takes);
  renderShots();
  renderReview();
  closeSettings();
}

// ── UTILITY ──
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── INIT ──
(function init() {
  // Restore prefs
  document.getElementById('tog-tracker').checked = prefs.tracker !== false;
  document.getElementById('tog-takes').checked   = prefs.takes   !== false;
  document.getElementById('tog-notes').checked   = prefs.notes   !== false;
  document.getElementById('tog-script').checked  = prefs.script  !== false;

  const title = PROJECT.title || 'ShootDay';
  document.getElementById('hdr-title').textContent   = title;
  document.getElementById('hdr-title-s').textContent = title;
  document.getElementById('hdr-title-r').textContent = title;
  document.getElementById('tab-script').style.display = prefs.script !== false ? '' : 'none';

  renderShots();
})();
</script>
</body>
</html>`;
}

module.exports = router;
