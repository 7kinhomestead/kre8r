/**
 * Projects routes — /api/projects
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/projects — all active projects
router.get('/', (req, res) => {
  try {
    const projects = db.getPipelineSummary();
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
