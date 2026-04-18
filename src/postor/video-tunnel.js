'use strict';

/**
 * video-tunnel.js — Temporary secure video host for Instagram uploads
 *
 * Spins up a minimal HTTP server on a random local port and tunnels ONLY
 * that port via ngrok (port 443, firewall-safe). The main Kre8r server
 * (port 3000) is never exposed. Only one file at one one-time token URL
 * is accessible.
 *
 * Requires: NGROK_AUTHTOKEN in .env
 *
 * Usage:
 *   const { createVideoTunnel } = require('./video-tunnel');
 *   const { url, cleanup } = await createVideoTunnel('/path/to/video.mp4');
 *   // url = 'https://xxxx.ngrok-free.app/abc123...'
 *   // pass url to Instagram, then call cleanup() when done
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

async function createVideoTunnel(videoPath) {
  if (!fs.existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
  if (!process.env.NGROK_AUTHTOKEN) throw new Error('NGROK_AUTHTOKEN not set in .env');

  const ngrok    = require('@ngrok/ngrok');
  const token    = crypto.randomBytes(20).toString('hex'); // one-time URL token
  const fileName = path.basename(videoPath);
  const fileSize = fs.statSync(videoPath).size;

  // ── Minimal single-file server ────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    // Only respond to exact token path — everything else 404s
    if (req.url !== `/${token}`) {
      res.writeHead(404).end('Not found');
      return;
    }
    console.log(`[postor/tunnel] Instagram is downloading video (${Math.round(fileSize / 1024 / 1024)}MB)…`);
    res.writeHead(200, {
      'Content-Type':        'video/mp4',
      'Content-Length':      String(fileSize),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control':       'no-store',
    });
    fs.createReadStream(videoPath).pipe(res);
  });

  // Listen on any available port (OS assigns)
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  const port = server.address().port;

  // ngrok — connects via HTTPS/443, works through firewalls
  const listener = await ngrok.forward({
    addr:     port,
    authtoken: process.env.NGROK_AUTHTOKEN,
  });

  const publicUrl = `${listener.url()}/${token}`;
  console.log(`[postor/tunnel] Secure video tunnel open (ngrok) on port ${port}`);

  const cleanup = async () => {
    try { await ngrok.disconnect(listener.url()); } catch (_) {}
    try { server.close(); } catch (_) {}
    console.log('[postor/tunnel] Tunnel closed');
  };

  return { url: publicUrl, cleanup };
}

module.exports = { createVideoTunnel };
