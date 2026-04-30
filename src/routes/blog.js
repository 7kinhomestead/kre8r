/**
 * Blog routes — /api/blog
 *
 * Public (no auth):
 *   GET  /api/blog/posts            — published posts for 7kinhomestead.land
 *   GET  /api/blog/posts/:slug      — single post by slug
 *
 * Authenticated (kre8r.app session required):
 *   GET  /api/blog/admin/posts      — all posts including drafts
 *   POST /api/blog/posts            — save post from MailΩr
 *   PATCH /api/blog/posts/:id       — update title/body/metadata
 *   POST /api/blog/posts/:id/publish
 *   POST /api/blog/posts/:id/unpublish
 *   DELETE /api/blog/posts/:id
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const logger  = require('../utils/logger');

// ─── CORS for 7kinhomestead.land ─────────────────────────────────────────────
// Public GET endpoints need to be reachable cross-origin from kre8r-land.
const ALLOWED_ORIGINS = [
  'https://7kinhomestead.land',
  'http://7kinhomestead.land',
  'http://localhost:3002',   // kre8r-land local dev
];

function setCors(res, req) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

// Preflight
router.options('/posts',      (req, res) => { setCors(res, req); res.sendStatus(204); });
router.options('/posts/:slug', (req, res) => { setCors(res, req); res.sendStatus(204); });

// ─── PUBLIC: all published posts ─────────────────────────────────────────────
router.get('/posts', (req, res) => {
  try {
    setCors(res, req);
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const angle  = req.query.angle || null;

    let posts = db.getAllBlogPosts({ status: 'published', limit, offset });

    // Client-side angle filter support
    if (angle) {
      posts = posts.filter(p => p.content_angle === angle);
    }

    // Never send body in the list view — saves bandwidth, kre8r-land only needs it on post page
    const index = posts.map(({ body: _body, ...p }) => p);

    res.json({ ok: true, posts: index, total: index.length });
  } catch (err) {
    logger.error({ err }, '[blog] GET /posts failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── PUBLIC: single post by slug ─────────────────────────────────────────────
router.get('/posts/:slug', (req, res) => {
  try {
    setCors(res, req);
    const post = db.getBlogPostBySlug(req.params.slug);
    if (!post || post.status !== 'published') {
      return res.status(404).json({ ok: false, error: 'Post not found' });
    }
    res.json({ ok: true, post });
  } catch (err) {
    logger.error({ err }, '[blog] GET /posts/:slug failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Everything below requires an active kre8r session ─────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ ok: false, error: 'Not authenticated' });
}

// ─── ADMIN: all posts (drafts + published) ───────────────────────────────────
router.get('/admin/posts', requireAuth, (req, res) => {
  try {
    const posts = db.getAllBlogPosts();
    // Strip body from list view here too
    res.json({ ok: true, posts: posts.map(({ body: _b, ...p }) => p) });
  } catch (err) {
    logger.error({ err }, '[blog] GET /admin/posts failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── SAVE post from MailΩr ───────────────────────────────────────────────────
router.post('/posts', requireAuth, (req, res) => {
  try {
    const { project_id, title, body, content_angle, is_deep_dive, youtube_url, publish } = req.body;

    if (!title || !body) {
      return res.status(400).json({ ok: false, error: 'title and body required' });
    }

    const status = publish ? 'published' : 'draft';
    const post   = db.insertBlogPost({ project_id, title, body, content_angle, is_deep_dive, youtube_url, status });

    logger.info({ id: post.id, slug: post.slug, status }, '[blog] post saved');
    res.json({ ok: true, post });
  } catch (err) {
    logger.error({ err }, '[blog] POST /posts failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────
router.patch('/posts/:id', requireAuth, (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const post = db.updateBlogPost(id, req.body);
    if (!post) return res.status(404).json({ ok: false, error: 'Post not found' });
    res.json({ ok: true, post });
  } catch (err) {
    logger.error({ err }, '[blog] PATCH /posts/:id failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── PUBLISH ─────────────────────────────────────────────────────────────────
router.post('/posts/:id/publish', requireAuth, (req, res) => {
  try {
    const post = db.publishBlogPost(parseInt(req.params.id));
    logger.info({ id: post.id, slug: post.slug }, '[blog] post published');
    res.json({ ok: true, post });
  } catch (err) {
    logger.error({ err }, '[blog] publish failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── UNPUBLISH ────────────────────────────────────────────────────────────────
router.post('/posts/:id/unpublish', requireAuth, (req, res) => {
  try {
    const post = db.unpublishBlogPost(parseInt(req.params.id));
    res.json({ ok: true, post });
  } catch (err) {
    logger.error({ err }, '[blog] unpublish failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── DELETE ──────────────────────────────────────────────────────────────────
router.delete('/posts/:id', requireAuth, (req, res) => {
  try {
    db.deleteBlogPost(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, '[blog] delete failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
