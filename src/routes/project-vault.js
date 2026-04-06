'use strict';

/**
 * Project Vault routes — /api/project-vault
 * Vault viewer: list files, read individual files, download
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const { getVaultPath, listVaultFiles, getVaultData } = require('../utils/project-vault');

// GET /api/project-vault/:id/files — list all vault files for a project
router.get('/:id/files', (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    const files = listVaultFiles(projectId);
    res.json({ project_id: projectId, files, total: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/project-vault/:id/file?path=id8r/research.json — read a single file
router.get('/:id/file', (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });

    // Security: no path traversal
    const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absPath = getVaultPath(projectId, normalized);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

    const raw = fs.readFileSync(absPath, 'utf8');
    const ext = path.extname(absPath).toLowerCase();

    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(absPath)}"`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(raw);
    }

    if (ext === '.json') {
      try { return res.json(JSON.parse(raw)); } catch (_) {}
    }
    res.type('text/plain').send(raw);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
