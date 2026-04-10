/**
 * Projects routes — /api/projects
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const db      = require('../db');

// GET /api/projects — all active projects
// Optional ?source=kre8r filter to exclude youtube_import projects from tool dropdowns
router.get('/', (req, res) => {
  try {
    const { source } = req.query;
    const projects = db.getPipelineSummary(source || null);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects — create a new project
router.post('/', (req, res) => {
  try {
    const { title, topic, youtube_url, youtube_video_id } = req.body;
    const project = db.createProject(title, topic, youtube_url, youtube_video_id);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/bulk-archive — must come before /:id routes
router.patch('/bulk-archive', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    const safeIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    db.bulkArchiveProjects(safeIds);
    res.json({ ok: true, archived: safeIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/bulk-delete — must come before /:id routes
router.delete('/bulk-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    const safeIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    // Clean up filesystem config dirs
    safeIds.forEach(id => {
      const configDir = require('path').join(__dirname, '../../database/projects', String(id));
      if (require('fs').existsSync(configDir)) {
        try { require('fs').rmSync(configDir, { recursive: true, force: true }); } catch (_) {}
      }
    });
    db.bulkDeleteProjects(safeIds);
    res.json({ ok: true, deleted: safeIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/archived — must come before /:id to avoid id='archived'
router.get('/archived', (req, res) => {
  try {
    res.json(db.getArchivedProjects());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/meta — update youtube_video_id, youtube_url, topic
router.patch('/:id/meta', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!db.getProject(id)) return res.status(404).json({ error: 'Project not found' });
    const { youtube_url, youtube_video_id, topic } = req.body;
    db.updateProjectMeta(id, { youtube_url, youtube_video_id, topic });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/archive
router.patch('/:id/archive', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!db.getProject(id)) return res.status(404).json({ error: 'Project not found' });
    db.archiveProject(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/complete — mark project done & posted, signals all tools
router.patch('/:id/complete', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!db.getProject(id)) return res.status(404).json({ error: 'Project not found' });
    const { published_at } = req.body || {};
    db.markProjectComplete(id, published_at || null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/:id/unarchive
router.patch('/:id/unarchive', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.unarchiveProject(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id — deletes project + all cascade data + filesystem config
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!db.getProject(id)) return res.status(404).json({ error: 'Project not found' });

    db.deleteProject(id);

    // Clean up database/projects/{id}/ directory (project-config.json etc.)
    const configDir = path.join(__dirname, '../../database/projects', String(id));
    if (fs.existsSync(configDir)) {
      try { fs.rmSync(configDir, { recursive: true, force: true }); }
      catch (fsErr) { console.warn(`[Projects] Could not remove config dir ${id}:`, fsErr.message); }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  try {
    const project = db.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/packages
router.get('/:id/packages', (req, res) => {
  try {
    const packages = db.getPackages(parseInt(req.params.id));
    const selected = packages.find(p => p.is_selected) || null;
    res.json({ packages, selected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/packages/select — Gate A approval
router.post('/:id/packages/select', (req, res) => {
  try {
    const { package_number, note } = req.body;
    db.selectPackage(parseInt(req.params.id), package_number, note);
    const project = db.getProject(parseInt(req.params.id));
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/captions
router.get('/:id/captions', (req, res) => {
  try {
    const captions = db.getCaptions(parseInt(req.params.id));
    res.json(captions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/captions/approve-all — Gate B
router.post('/:id/captions/approve-all', (req, res) => {
  try {
    db.approveAllCaptions(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/emails
router.get('/:id/emails', (req, res) => {
  try {
    const emails = db.getEmails(parseInt(req.params.id));
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/emails/approve-all — Gate C
router.post('/:id/emails/approve-all', (req, res) => {
  try {
    db.approveAllEmails(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/context — selected package + project for M3/M4 context loading
router.get('/:id/context', (req, res) => {
  try {
    const project = db.getProject(parseInt(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const selected = db.getSelectedPackage(parseInt(req.params.id));
    res.json({ project, selected_package: selected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
