/**
 * public-dir.js — resolve where server-generated browser assets live.
 *
 * In the packaged desktop app public/ is sealed inside the read-only asar,
 * so anything the server writes for the browser (thumbnails, clips, music,
 * uploads, renders) goes to PUBLIC_WRITE_DIR (userData\public-write) instead.
 * server.js serves that directory ahead of the asar public/ at the same URLs.
 * In dev / on the droplet PUBLIC_WRITE_DIR is unset and this resolves to the
 * repo's own public/ — unchanged behavior.
 */

'use strict';

const path = require('path');

const BASE = process.env.PUBLIC_WRITE_DIR || path.join(__dirname, '..', '..', 'public');

function publicWriteDir(...parts) {
  return path.join(BASE, ...parts);
}

module.exports = { publicWriteDir };
