/**
 * OperatΩr Route — src/routes/operator.js
 * Master pipeline overview: Queue / Ready to Publish / Archive
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

const CORE_PLATFORMS = ['tiktok', 'youtube', 'instagram', 'facebook', 'lemon8'];

// GET /api/operator — full dashboard data in one shot
router.get('/', (req, res) => {
  try {
    const projects = db.getAllProjects();

    // For each project, get posted platforms
    const projectsWithPosts = projects.map(p => {
      const posts = db.getPostsByProject(p.id);
      const postedPlatforms = new Set(
        posts.filter(post => post.status === 'posted').map(post => post.platform)
      );
      return { ...p, posted_platforms: [...postedPlatforms], posts };
    });

    const queue   = [];
    const ready   = [];
    const archive = [];

    for (const p of projectsWithPosts) {
      if (!p.gate_c_approved) {
        queue.push(p);
      } else {
        const allPosted = CORE_PLATFORMS.every(pl => p.posted_platforms.includes(pl));
        if (allPosted) {
          archive.push(p);
        } else {
          ready.push(p);
        }
      }
    }

    // Sort queue by stage priority
    const STAGE_ORDER = { M2: 0, M3: 1, 'M3-captions': 2, M4: 3, 'M4-emails': 4, M5: 5 };
    queue.sort((a, b) => (STAGE_ORDER[a.stage_status] ?? 99) - (STAGE_ORDER[b.stage_status] ?? 99));

    res.json({ queue, ready, archive, core_platforms: CORE_PLATFORMS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/operator/mark-posted
// Body: { project_id, platform } — marks a platform as posted (creates/updates post record)
router.post('/mark-posted', (req, res) => {
  try {
    const { project_id, platform } = req.body;
    if (!project_id || !platform) {
      return res.status(400).json({ error: 'project_id and platform required' });
    }

    // Check if a post already exists for this project+platform
    const posts = db.getPostsByProject(Number(project_id));
    const existing = posts.find(p => p.platform === platform && p.status === 'posted');

    if (!existing) {
      db.savePost({
        project_id: Number(project_id),
        platform,
        status: 'posted',
        posted_at: new Date().toISOString()
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/operator/unmark-posted
// Body: { project_id, platform } — removes posted status for a platform
router.post('/unmark-posted', (req, res) => {
  try {
    const { project_id, platform } = req.body;
    if (!project_id || !platform) {
      return res.status(400).json({ error: 'project_id and platform required' });
    }

    const posts = db.getPostsByProject(Number(project_id));
    const existing = posts.find(p => p.platform === platform && p.status === 'posted');

    if (existing) {
      db.deletePost(existing.id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
