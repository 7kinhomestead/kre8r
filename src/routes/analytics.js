/**
 * AnalytΩr Route — src/routes/analytics.js
 * Endpoints for logging posts and tracking platform analytics.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

// ─────────────────────────────────────────────
// POSTS
// ─────────────────────────────────────────────

// GET /api/analytics/posts/:projectId
router.get('/posts/:projectId', (req, res) => {
  try {
    const posts = db.getPostsByProject(Number(req.params.projectId));
    // Attach metrics to each post
    const postsWithMetrics = posts.map(post => {
      const metrics = db.getAnalyticsByPost(post.id);
      const metricsMap = {};
      for (const m of metrics) {
        metricsMap[m.metric_name] = m.metric_value;
      }
      return { ...post, metrics: metricsMap };
    });
    res.json(postsWithMetrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analytics/posts
// Body: { project_id, platform, content, url, angle, media_path, posted_at, post_id, caption_id }
router.post('/posts', (req, res) => {
  try {
    const { project_id, platform, content, url, angle, media_path, posted_at, post_id, caption_id } = req.body;
    if (!project_id || !platform) {
      return res.status(400).json({ error: 'project_id and platform are required' });
    }
    const id = db.savePost({
      project_id: Number(project_id),
      platform,
      content:    content    || null,
      url:        url        || null,
      angle:      angle      || null,
      media_path: media_path || null,
      posted_at:  posted_at  || new Date().toISOString(),
      post_id:    post_id    || null,
      caption_id: caption_id || null,
      status: 'posted'
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/analytics/posts/:id
// Body: any subset of { url, status, content, angle, media_path }
router.patch('/posts/:id', (req, res) => {
  try {
    db.updatePost(Number(req.params.id), req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/analytics/posts/:id
router.delete('/posts/:id', (req, res) => {
  try {
    db.deletePost(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────

// GET /api/analytics/metrics/:postId
router.get('/metrics/:postId', (req, res) => {
  try {
    const metrics = db.getAnalyticsByPost(Number(req.params.postId));
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analytics/metrics
// Body: { post_id, project_id, platform, metrics: { views: 1234, completion_rate: 0.45, ... } }
router.post('/metrics', (req, res) => {
  try {
    const { post_id, project_id, platform, metrics } = req.body;
    if (!post_id || !platform || !metrics || typeof metrics !== 'object') {
      return res.status(400).json({ error: 'post_id, platform, and metrics object are required' });
    }
    for (const [name, value] of Object.entries(metrics)) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        db.upsertMetric(Number(post_id), project_id ? Number(project_id) : null, platform, name, num);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────

// GET /api/analytics/summary/:projectId
router.get('/summary/:projectId', (req, res) => {
  try {
    const summary = db.getAnalyticsSummary(Number(req.params.projectId));
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/project/:projectId — all analytics rows with post context
router.get('/project/:projectId', (req, res) => {
  try {
    const rows = db.getAnalyticsByProject(Number(req.params.projectId));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
