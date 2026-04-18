'use strict';

/**
 * video-tunnel.js — Temporary secure file host for Instagram/Facebook uploads
 *
 * Spins up a minimal HTTP server on a random local port and tunnels ONLY
 * that port via ngrok (port 443, firewall-safe). The main Kre8r server
 * (port 3000) is never exposed. Only one file at one one-time token URL
 * is accessible.
 *
 * Requires: NGROK_AUTHTOKEN in .env
 *
 * Usage:
 *   const { createVideoTunnel, createFileTunnel } = require('./video-tunnel');
 *   const { url, cleanup } = await createVideoTunnel('/path/to/video.mp4');
 *   const { url, cleanup } = await createFileTunnel('/path/to/image.jpg');
 *   // url = 'https://xxxx.ngrok-free.app/abc123...'
 *   // pass url to Instagram/Facebook, then call cleanup() when done
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Content-type map for common media extensions
const MIME_TYPES = {
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.avi':  'video/x-msvideo',
  '.webm': 'video/webm',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

/**
 * Generic file tunnel — detects content-type from extension.
 * Works for both video (Instagram Reels) and images (Facebook photos).
 */
async function createFileTunnel(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  if (!process.env.NGROK_AUTHTOKEN) throw new Error('NGROK_AUTHTOKEN not set in .env');

  const ngrok       = require('@ngrok/ngrok');
  const token       = crypto.randomBytes(20).toString('hex');
  const fileName    = path.basename(filePath);
  const fileSize    = fs.statSync(filePath).size;
  const ext         = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const server = http.createServer((req, res) => {
    if (req.url !== `/${token}`) {
      res.writeHead(404).end('Not found');
      return;
    }
    console.log(`[postor/tunnel] Downloading ${fileName} (${Math.round(fileSize / 1024 / 1024)}MB)…`);
    res.writeHead(200, {
      'Content-Type':        contentType,
      'Content-Length':      String(fileSize),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control':       'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  const port = server.address().port;

  const listener = await ngrok.forward({
    addr:      port,
    authtoken: process.env.NGROK_AUTHTOKEN,
  });

  const publicUrl = `${listener.url()}/${token}`;
  console.log(`[postor/tunnel] Secure tunnel open (ngrok) on port ${port} — ${contentType}`);

  const cleanup = async () => {
    try { await ngrok.disconnect(listener.url()); } catch (_) {}
    try { server.close(); } catch (_) {}
    console.log('[postor/tunnel] Tunnel closed');
  };

  return { url: publicUrl, cleanup };
}

/** Convenience alias — createVideoTunnel keeps backward compat */
const createVideoTunnel = createFileTunnel;

module.exports = { createVideoTunnel, createFileTunnel };
