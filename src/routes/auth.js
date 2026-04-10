/**
 * Kre8Ωr — src/routes/auth.js
 * Session-based login / logout.
 * POST /auth/login  → validate credentials → set session
 * POST /auth/logout → destroy session
 * GET  /auth/me     → return current user info (for UI checks)
 * GET  /auth/users  → list users (owner only)
 * POST /auth/users  → create user (owner only)
 * DELETE /auth/users/:id → delete user (owner only)
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');

const router = express.Router();

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = db.getUserByUsername(username.trim());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)  return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.role     = user.role;

    res.json({ ok: true, username: user.username, role: user.role });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('kre8r.sid');
    res.json({ ok: true });
  });
});

// GET /auth/me — who am I right now
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ username: req.session.username, role: req.session.role });
});

// ── User management (owner only) ──────────────────────────────────────────────

function ownerOnly(req, res, next) {
  if (req.session?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

// GET /auth/users
router.get('/users', ownerOnly, (req, res) => {
  try {
    res.json(db.getAllUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/users — create a new user
router.post('/users', ownerOnly, async (req, res) => {
  const { username, password, role = 'viewer' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['owner', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = db.createUser(username.trim(), hash, role);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /auth/users/:id — remove a user (can't delete yourself)
router.delete('/users/:id', ownerOnly, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    db.deleteUser(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/users/:id/password — change a user's password (owner only)
router.post('/users/:id/password', ownerOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.updateUserPassword(id, hash);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
