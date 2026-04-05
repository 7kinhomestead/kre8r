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
 *   Roles:
 *     'display'  — creates or joins as synced display (first = session owner)
 *     'control'  — remote controller; sends commands, receives state
 *
 *   Session structure:
 *     displays:  Set<ws>  — all display devices (any can receive commands)
 *     controls:  Set<ws>  — all control devices
 *     state:     { speed, paused, position }
 *     title:     project name
 *     projectId: number | null
 */

'use strict';

const express   = require('express');
const os        = require('os');
const WebSocket = require('ws');
const db        = require('../db');

const router = express.Router();

// ─────────────────────────────────────────────
// NETWORK HELPERS
// ─────────────────────────────────────────────

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }
  // Prefer RFC-1918 private ranges (WiFi/LAN) over VPN/virtual adapters
  const privateIp = candidates.find(ip =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')      ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
  return privateIp || candidates[0] || null;
}

// ─────────────────────────────────────────────
// HTTP ROUTES
// ─────────────────────────────────────────────

// GET /api/teleprompter/scripts
router.get('/scripts', (req, res) => {
  const projects = db.getKre8rProjects();
  const result   = [];

  for (const p of projects) {
    if (!p.writr_complete) continue;
    const script = db.getApprovedWritrScript(p.id);
    if (!script) continue;

    const preview = (script.generated_script || '')
      .replace(/\*{1,2}PRODUCTION NOTES:?\*{0,2}[\s\S]*$/im, '')
      .replace(/\[●[^\]]*\]/g, '')
      .replace(/\[BEAT NEEDED:[^\]]*\]/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/🎤\s*/gu, '')
      .replace(/\(b-roll:[^)]*\)/gi, '')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^-{2,}$/.test(l) && !/^\(/.test(l) && !/^\[/.test(l) && !/^\*/.test(l))
      .slice(0, 4)
      .join('\n');

    result.push({
      project_id:   p.id,
      project_name: p.title || p.name || 'Untitled',
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
    project_name: project.title || project.name || 'Untitled',
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
// Map<sessionCode, { displays, controls, state, title, projectId }>
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

function broadcastToAll(sess, data, except = null) {
  for (const ws of sess.displays) { if (ws !== except) safeSend(ws, data); }
  for (const ws of sess.controls) { if (ws !== except) safeSend(ws, data); }
}

function broadcastToControls(sess, data) {
  for (const ws of sess.controls) safeSend(ws, data);
}

function broadcastToDisplays(sess, data) {
  for (const ws of sess.displays) safeSend(ws, data);
}

function getCount(sess) {
  return { displays: sess.displays.size, controls: sess.controls.size };
}

// ─────────────────────────────────────────────
// WEBSOCKET SERVER FACTORY
// Called from server.js with the HTTP server instance
// ─────────────────────────────────────────────

function createTeleprompterWS(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws/teleprompter' });

  wss.on('connection', (ws) => {
    let myCode = null;
    let myRole = null;  // 'display' | 'control'

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }

      // ── REGISTER ──────────────────────────────────────────────
      if (msg.type === 'register') {
        const role      = msg.role;
        const code      = msg.session;
        const isDisplay = role === 'display';
        const isControl = role === 'control';

        if (isDisplay) {
          // Determine session: join existing if code provided, else create new
          const joining    = code && code.length === 4 && sessions.has(code);
          const sessionCode = joining ? code : (code && code.length === 4 ? code : generateCode());

          if (!sessions.has(sessionCode)) {
            sessions.set(sessionCode, {
              displays:       new Set(),
              controls:       new Set(),
              state:          { speed: 3, paused: true, position: 0 },
              operatorPaused: false,
              title:          null,
              projectId:      null
            });
          }

          const sess = sessions.get(sessionCode);
          if (msg.title)     sess.title     = msg.title;
          if (msg.projectId) sess.projectId = msg.projectId;

          sess.displays.add(ws);
          myCode = sessionCode;
          myRole = 'display';

          const count = getCount(sess);

          safeSend(ws, {
            type:      'registered',
            session:   sessionCode,
            state:     sess.state,
            title:     sess.title,
            projectId: sess.projectId,
            count
          });

          // Notify all other peers
          broadcastToAll(sess, { type: 'count_update', count }, ws);

        } else if (isControl) {
          if (!code || !sessions.has(code)) {
            safeSend(ws, { type: 'error', message: 'Session not found. Check the 4-digit code on the prompter screen.' });
            return;
          }

          const sess = sessions.get(code);
          sess.controls.add(ws);
          myCode = code;
          myRole = 'control';

          const count = getCount(sess);

          safeSend(ws, {
            type:           'registered',
            session:        code,
            state:          sess.state,
            operatorPaused: sess.operatorPaused,
            title:          sess.title,
            projectId:      sess.projectId,
            count
          });

          // Notify all other peers
          broadcastToAll(sess, { type: 'count_update', count }, ws);
        }
        return;
      }

      if (!myCode || !sessions.has(myCode)) return;
      const sess = sessions.get(myCode);

      // ── CONTROL → ALL DISPLAYS: relay commands ─────────────────
      if (msg.type === 'command' && myRole === 'control') {
        broadcastToDisplays(sess, msg);
        // Mirror state
        if (msg.action === 'speed')        sess.state.speed    = msg.value;
        if (msg.action === 'pause')        { sess.state.paused = true;  if (msg.source === 'operator') sess.operatorPaused = true; }
        if (msg.action === 'play')         { sess.state.paused = false; if (msg.source === 'operator') sess.operatorPaused = false; }
        if (msg.action === 'toggle_pause') {
          sess.state.paused = !sess.state.paused;
          if (msg.source === 'operator') sess.operatorPaused = sess.state.paused;
        }
        if (msg.action === 'restart')   sess.state.position = 0;
        if (msg.action === 'seek_pct')  sess.state.position = msg.value;
        // Echo updated state + operatorPaused to all controls
        broadcastToControls(sess, { type: 'state', ...sess.state, operatorPaused: sess.operatorPaused, title: sess.title });
      }

      // ── DISPLAY → CONTROLS + OTHER DISPLAYS: state sync ────────
      if (msg.type === 'state' && myRole === 'display') {
        if (msg.state) Object.assign(sess.state, msg.state);
        if (msg.title) sess.title = msg.title;
        const stateMsg = { type: 'state', ...sess.state, operatorPaused: sess.operatorPaused, title: sess.title };
        broadcastToControls(sess, stateMsg);
        // Relay to secondary displays for position sync
        for (const disp of sess.displays) {
          if (disp !== ws) safeSend(disp, stateMsg);
        }
      }
    });

    ws.on('close', () => {
      if (!myCode || !sessions.has(myCode)) return;
      const sess = sessions.get(myCode);

      if (myRole === 'display') {
        sess.displays.delete(ws);
      } else if (myRole === 'control') {
        sess.controls.delete(ws);
      }

      const count = getCount(sess);
      broadcastToAll(sess, { type: 'count_update', count });

      // Clean up empty sessions after 2 minutes
      if (sess.displays.size === 0 && sess.controls.size === 0) {
        setTimeout(() => {
          const s = sessions.get(myCode);
          if (s && s.displays.size === 0 && s.controls.size === 0) {
            sessions.delete(myCode);
          }
        }, 120_000);
      }
    });

    ws.on('error', () => {});
  });

  console.log('[TeleprΩmpter] WebSocket ready at /ws/teleprompter');
}

module.exports = { router, createTeleprompterWS };
