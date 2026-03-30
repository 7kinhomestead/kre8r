/**
 * TeleprΩmpter — Route + WebSocket server
 * src/routes/teleprompter.js
 *
 * HTTP API:
 *   GET /api/teleprompter/scripts        — projects with approved scripts
 *   GET /api/teleprompter/script/:id     — approved script text for a project
 *   GET /api/teleprompter/network-info   — local IP for QR code generation
 *
 * WebSocket: ws://[host]/ws/teleprompter
 *   - Display registers → gets 4-digit session code
 *   - Control connects with session code → receives commands relayed to display
 */

'use strict';

const express = require('express');
const os      = require('os');
const WebSocket = require('ws');
const db      = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// NETWORK HELPERS
// ─────────────────────────────────────────────

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// HTTP ROUTES
// ─────────────────────────────────────────────

// GET /api/teleprompter/scripts
// Returns all projects that have an approved WritΩr script
router.get('/scripts', (req, res) => {
  const projects = db.getAllProjects();
  const result   = [];

  for (const p of projects) {
    if (!p.writr_complete) continue;
    const script = db.getApprovedWritrScript(p.id);
    if (!script) continue;

    // Quick clean preview — strip beat markers and production cues
    const preview = (script.generated_script || '')
      .replace(/\*{1,2}PRODUCTION NOTES:?\*{0,2}[\s\S]*$/im, '')
      .replace(/\[●[^\]]*\]/g, '')
      .replace(/\[BEAT NEEDED:[^\]]*\]/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/🎤\s*/gu, '')
      .replace(/\(b-roll:[^)]*\)/gi, '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^-{2,}$/.test(l))
      .slice(0, 4)
      .join('\n');

    result.push({
      project_id:   p.id,
      project_name: p.name || 'Untitled',
      script_id:    script.id,
      preview,
      approved_at:  script.approved_at
    });
  }

  res.json({ ok: true, scripts: result });
});

// GET /api/teleprompter/script/:project_id
router.get('/script/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const script = db.getApprovedWritrScript(projectId);
  if (!script) return res.status(404).json({ error: 'No approved script for this project' });

  res.json({
    ok:           true,
    project_id:   projectId,
    project_name: project.name || 'Untitled',
    script_id:    script.id,
    script_text:  script.generated_script || '',
    beat_map:     script.beat_map_json    || []
  });
});

// GET /api/teleprompter/network-info
router.get('/network-info', (req, res) => {
  const ip   = getLocalIP();
  const port = process.env.PORT || 3000;
  res.json({ ok: true, ip, port });
});

// ─────────────────────────────────────────────
// WEBSOCKET SESSION STORE
// Map<sessionCode, { display, control, state }>
// ─────────────────────────────────────────────

const sessions = new Map();

function generateCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); }
  while (sessions.has(code));
  return code;
}

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─────────────────────────────────────────────
// WEBSOCKET SERVER FACTORY
// Called from server.js with the HTTP server instance
// ─────────────────────────────────────────────

function createTeleprompterWS(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws/teleprompter' });

  wss.on('connection', (ws) => {
    let myCode = null;
    let myRole = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }

      // ── REGISTER ──────────────────────────────────────────────
      if (msg.type === 'register') {
        const role   = msg.role;    // 'display' | 'control'
        const code   = msg.session; // provided session code or null

        if (role === 'display') {
          const sessionCode = code && code.length === 4 ? code : generateCode();

          if (!sessions.has(sessionCode)) {
            sessions.set(sessionCode, {
              display: null, control: null,
              state: { speed: 3, paused: true, position: 0 }
            });
          }

          const sess = sessions.get(sessionCode);
          // Disconnect old display if still open
          if (sess.display && sess.display.readyState === WebSocket.OPEN) sess.display.close();

          sess.display = ws;
          myCode = sessionCode;
          myRole = 'display';

          safeSend(ws, { type: 'registered', session: sessionCode, state: sess.state });

          // Notify each other if control already connected
          if (sess.control && sess.control.readyState === WebSocket.OPEN) {
            safeSend(sess.control, { type: 'peer_connected', role: 'display' });
            safeSend(ws,          { type: 'peer_connected', role: 'control' });
          }

        } else if (role === 'control') {
          if (!code || !sessions.has(code)) {
            safeSend(ws, { type: 'error', message: 'Session not found. Check the 4-digit code on the prompter screen.' });
            return;
          }

          const sess = sessions.get(code);
          if (sess.control && sess.control.readyState === WebSocket.OPEN) sess.control.close();

          sess.control = ws;
          myCode = code;
          myRole = 'control';

          safeSend(ws, { type: 'registered', session: code, state: sess.state });

          // Cross-notify
          if (sess.display && sess.display.readyState === WebSocket.OPEN) {
            safeSend(sess.display, { type: 'peer_connected', role: 'control' });
            safeSend(ws,          { type: 'peer_connected', role: 'display' });
          }
        }
        return;
      }

      if (!myCode || !sessions.has(myCode)) return;
      const sess = sessions.get(myCode);

      // ── CONTROL → DISPLAY: relay commands ──────────────────────
      if (msg.type === 'command' && myRole === 'control') {
        safeSend(sess.display, msg);
        // Mirror state in session
        if (msg.action === 'speed')        sess.state.speed  = msg.value;
        if (msg.action === 'pause')        sess.state.paused = true;
        if (msg.action === 'play')         sess.state.paused = false;
        if (msg.action === 'toggle_pause') sess.state.paused = !sess.state.paused;
      }

      // ── DISPLAY → CONTROL: state updates ───────────────────────
      if (msg.type === 'state' && myRole === 'display') {
        if (msg.state) Object.assign(sess.state, msg.state);
        safeSend(sess.control, { type: 'state', ...sess.state });
      }
    });

    ws.on('close', () => {
      if (!myCode || !sessions.has(myCode)) return;
      const sess = sessions.get(myCode);

      if (myRole === 'display') {
        sess.display = null;
        safeSend(sess.control, { type: 'peer_disconnected', role: 'display' });
        // Clean up orphaned sessions after 2 minutes
        if (!sess.control || sess.control.readyState !== WebSocket.OPEN) {
          setTimeout(() => { if (!sess.display) sessions.delete(myCode); }, 120_000);
        }
      } else if (myRole === 'control') {
        sess.control = null;
        safeSend(sess.display, { type: 'peer_disconnected', role: 'control' });
      }
    });

    ws.on('error', () => { /* suppress unhandled ws errors */ });
  });

  console.log('[TeleprΩmpter] WebSocket ready at /ws/teleprompter');
}

module.exports = { router, createTeleprompterWS };
