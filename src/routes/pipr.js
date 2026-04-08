/**
 * PipΩr Route — src/routes/pipr.js
 *
 * POST /api/pipr/create              — create project + config
 * GET  /api/pipr/beats-preview       — returns beat map for a structure (no project needed)
 * GET  /api/pipr/:project_id         — full project config
 * PATCH /api/pipr/:project_id        — update config fields
 * GET  /api/pipr/:project_id/beats   — beat map with coverage
 * POST /api/pipr/:project_id/beats/update — re-run beat coverage from selects
 * GET  /api/pipr/report              — beat coverage for ALL projects
 * POST /api/pipr/mine                — run config miner
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const db              = require('../db');
const { buildBeatMap, getBeats } = require('../pipr/beats');
const { readConfig, writeConfig, updateBeatCoverage } = require('../pipr/beat-tracker');
const { minePatterns } = require('../pipr/config-miner');
const vault           = require('../utils/project-vault');
const { addPiprContext } = require('../utils/project-context-builder');

const router = express.Router();

const PROJECTS_DIR = path.join(__dirname, '..', '..', 'database', 'projects');

// ─────────────────────────────────────────────
// HELPER: build project-config.json from form data
// ─────────────────────────────────────────────

function buildConfig(projectId, body) {
  const {
    title, high_concept, content_type, story_structure, setup_depth, entry_point,
    emotional_palette, musical_theme, script, what_happened,
    estimated_duration_minutes, beat_overrides = {}
  } = body;

  let beats = buildBeatMap(story_structure, estimated_duration_minutes || null);

  // Apply any deep-mode overrides
  if (Object.keys(beat_overrides).length > 0) {
    beats = beats.map(beat => {
      const override = beat_overrides[beat.index];
      if (!override) return beat;
      return {
        ...beat,
        name:       override.name       ?? beat.name,
        target_pct: override.target_pct ?? beat.target_pct
      };
    });
  }

  const now = new Date().toISOString();
  return {
    project_id:                   projectId,
    title:                        title || 'Untitled',
    high_concept:                 high_concept || null,
    content_type:                 content_type || null,
    story_structure:              story_structure || 'free_form',
    setup_depth:                  setup_depth || 'standard',
    entry_point:                  entry_point || 'hybrid',
    emotional_palette:            emotional_palette || null,
    musical_theme:                musical_theme || null,
    script:                       script || null,
    what_happened:                what_happened || null,
    beats,
    estimated_duration_minutes:   parseInt(estimated_duration_minutes) || null,
    created_at:                   now,
    updated_at:                   now
  };
}

// ─────────────────────────────────────────────
// GET /api/pipr/collaborators
// Returns primary creator + all collaborator soul files for "Who's in this video?"
// ─────────────────────────────────────────────

router.get('/collaborators', (req, res) => {
  try {
    const rootPath = path.join(__dirname, '..', '..');
    const primary  = (() => {
      try {
        const profilePath = process.env.CREATOR_PROFILE_PATH || path.join(rootPath, 'creator-profile.json');
        const p = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        return [{
          slug:    'primary',
          name:    p.creator?.name || 'Creator',
          role:    'Primary Creator',
          badge:   { letter: (p.creator?.name || 'C')[0].toUpperCase(), color: 'teal' },
          primary: true
        }];
      } catch (_) { return []; }
    })();

    const collaborators = fs.readdirSync(rootPath)
      .filter(f => /^creator-profile-.+\.json$/.test(f))
      .map(f => {
        const slug = f.replace('creator-profile-', '').replace('.json', '');
        try {
          const p = JSON.parse(fs.readFileSync(path.join(rootPath, f), 'utf8'));
          return {
            slug,
            name:    p.creator?.name  || slug,
            role:    p.creator?.role  || 'Collaborator',
            badge:   p.badge          || { letter: slug[0].toUpperCase(), color: 'amber' },
            primary: false
          };
        } catch (_) {
          return { slug, name: slug, role: 'Collaborator',
                   badge: { letter: slug[0].toUpperCase(), color: 'amber' }, primary: false };
        }
      });

    res.json({ ok: true, creators: [...primary, ...collaborators] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/pipr/create
// ─────────────────────────────────────────────

router.post('/create', (req, res) => {
  try {
    const { title, high_concept, content_type, story_structure, setup_depth,
            entry_point, emotional_palette, musical_theme, script, what_happened,
            estimated_duration_minutes } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ ok: false, error: 'title is required' });
    }

    // Create project in DB
    const project = db.createProject(
      title.trim(),
      high_concept || null,
      null, // youtube_url
      null  // youtube_video_id
    );
    const projectId = project.id;

    // Update project with PipΩr fields
    db.updateProjectPipr(projectId, {
      high_concept:                high_concept || null,
      content_type:                content_type || null,
      story_structure:             story_structure || 'free_form',
      setup_depth:                 setup_depth || 'standard',
      entry_point:                 entry_point || 'hybrid',
      estimated_duration_minutes:  parseInt(estimated_duration_minutes) || null,
      pipr_complete:               1
    });

    // Save collaborators if provided
    if (req.body.collaborators && Array.isArray(req.body.collaborators)) {
      db.updateProjectCollaborators(projectId, req.body.collaborators);
    }

    // Generate and write project-config.json
    const config = buildConfig(projectId, req.body);
    writeConfig(projectId, config);
    try { vault.backupVault(projectId); } catch (_) {}

    // Add PipΩr stage to project-context.json
    try {
      addPiprContext(projectId, {
        story_structure: config.story_structure,
        beats:           config.beats,
        target_duration: config.estimated_duration_minutes,
        setup_depth:     config.setup_depth,
        entry_point:     config.entry_point,
      });
    } catch (ctxErr) {
      console.warn('[pipr/create] context build failed (non-fatal):', ctxErr.message);
    }

    // ── Create shoot folder on camera SSD ────────────────────────────────────
    // Automatically create H:\[ProjectTitle]\ (or first configured camera_ssd_path)
    // so the folder name is guaranteed to match the DB exactly — no typos.
    let shootFolder = null;
    try {
      const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH
        || path.join(__dirname, '..', '..', 'creator-profile.json');
      const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
      const cameraRoot = profile?.vault?.camera_ssd_paths?.[0];
      if (cameraRoot) {
        // Sanitize title: strip Windows-illegal chars, collapse spaces to underscores
        const safeName = title.trim()
          .replace(/[<>:"/\\|?*]/g, '')
          .replace(/\s+/g, '_')
          .slice(0, 60);
        // Build path and normalise to forward-slashes for cross-tool consistency
        shootFolder = (cameraRoot.replace(/\\/g, '/').replace(/\/$/, '') + '/' + safeName);
        fs.mkdirSync(shootFolder.replace(/\//g, path.sep), { recursive: true });
        db.updateProjectPipr(projectId, { shoot_folder: shootFolder });
        console.log(`[PipΩr] Shoot folder created: ${shootFolder}`);
      }
    } catch (folderErr) {
      // Non-fatal — H:\ may not be plugged in right now. Creator can create later.
      console.warn('[PipΩr] Could not create shoot folder (non-fatal):', folderErr.message);
    }

    res.json({ ok: true, project_id: projectId, config, shoot_folder: shootFolder });
  } catch (err) {
    console.error('[pipr] create error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/pipr/beats-preview?structure=save_the_cat
// Returns beat template without creating a project
// ─────────────────────────────────────────────

router.get('/beats-preview', (req, res) => {
  const structure = req.query.structure || 'save_the_cat';
  const duration  = parseInt(req.query.duration_minutes) || null;
  const beats     = buildBeatMap(structure, duration);
  res.json({ ok: true, structure, beats });
});

// ─────────────────────────────────────────────
// GET /api/pipr/report — all projects beat coverage
// ─────────────────────────────────────────────

router.get('/report', (req, res) => {
  try {
    const projects = db.getKre8rProjects();
    const report = projects.map(p => {
      const config = readConfig(p.id);
      if (!config || !config.beats || config.beats.length === 0) {
        return {
          project_id:    p.id,
          title:         p.title,
          pipr_complete: !!p.pipr_complete,
          story_structure: config?.story_structure || null,
          beats_total:   0,
          beats_covered: 0,
          coverage_pct:  0,
          missing:       [],
          out_of_sequence: [],
          needs_attention: !p.pipr_complete
        };
      }
      const covered       = config.beats.filter(b => b.covered);
      const missing       = config.beats.filter(b => !b.covered).map(b => b.name);
      const outOfSeq      = config.beats.filter(b => b.out_of_sequence).map(b => b.name);
      const criticalMissing = config.beats
        .filter(b => !b.covered && ['All Is Lost', 'Break into Three', 'CTA', 'Hook'].includes(b.name))
        .map(b => b.name);

      return {
        project_id:       p.id,
        title:            p.title,
        pipr_complete:    !!p.pipr_complete,
        story_structure:  config.story_structure,
        beats_total:      config.beats.length,
        beats_covered:    covered.length,
        coverage_pct:     config.beats.length > 0 ? Math.round((covered.length / config.beats.length) * 100) : 0,
        missing,
        out_of_sequence:  outOfSeq,
        critical_missing: criticalMissing,
        needs_attention:  !p.pipr_complete || criticalMissing.length > 0 || outOfSeq.length > 0
      };
    });

    const attention_count = report.filter(r => r.needs_attention).length;
    res.json({ ok: true, projects: report, attention_count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/pipr/mine
// ─────────────────────────────────────────────

router.post('/mine', (req, res) => {
  try {
    const result = minePatterns();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/pipr/:project_id
// ─────────────────────────────────────────────

router.get('/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const config = readConfig(projectId);
  res.json({ ok: true, project, config });
});

// ─────────────────────────────────────────────
// PATCH /api/pipr/:project_id
// ─────────────────────────────────────────────

router.patch('/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  try {
    const config = readConfig(projectId) || {};
    Object.assign(config, req.body, { project_id: projectId });
    writeConfig(projectId, config);
    try { vault.backupVault(projectId); } catch (_) {}

    // Sync allowed fields to DB
    const dbFields = {};
    const allowed  = ['high_concept','content_type','story_structure','setup_depth',
                      'entry_point','estimated_duration_minutes','pipr_complete'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) dbFields[k] = req.body[k];
    }
    if (Object.keys(dbFields).length) db.updateProjectPipr(projectId, dbFields);

    // Update collaborators if provided
    if (req.body.collaborators && Array.isArray(req.body.collaborators)) {
      db.updateProjectCollaborators(projectId, req.body.collaborators);
    }

    // Update project-context.json with latest PipΩr state
    try {
      addPiprContext(projectId, {
        story_structure: config.story_structure,
        beats:           config.beats,
        target_duration: config.estimated_duration_minutes,
        setup_depth:     config.setup_depth,
        entry_point:     config.entry_point,
      });
    } catch (ctxErr) {
      console.warn('[pipr/patch] context build failed (non-fatal):', ctxErr.message);
    }

    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/pipr/:project_id/beats
// ─────────────────────────────────────────────

router.get('/:project_id/beats', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const config = readConfig(projectId);
  if (!config) return res.status(404).json({ error: 'No project config found. Run PipΩr setup first.' });

  res.json({ ok: true, beats: config.beats || [], story_structure: config.story_structure });
});

// ─────────────────────────────────────────────
// POST /api/pipr/:project_id/beats/update
// ─────────────────────────────────────────────

router.post('/:project_id/beats/update', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  try {
    const result = updateBeatCoverage(projectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
