/**
 * scripts/deploy-update.js
 *
 * Uploads the latest Electron build to kre8r.app/downloads/
 * so the auto-updater and download page can serve it.
 *
 * Usage:
 *   node scripts/deploy-update.js
 *   node scripts/deploy-update.js --server https://kre8r.app --secret YOUR_SECRET
 *
 * Files uploaded from ./dist/:
 *   - Kre8Ωr Setup *.exe   (the installer)
 *   - latest.yml           (electron-updater manifest)
 *   - *.exe.blockmap       (binary diff for delta updates)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : fallback;
  };

  const SERVER = getArg('--server', 'https://kre8r.app');
  const SECRET = getArg('--secret', process.env.RELEASE_UPLOAD_SECRET || '');
  const DIST   = path.join(__dirname, '..', 'dist');

  if (!fs.existsSync(DIST)) {
    console.error('❌  dist/ folder not found — run npm run dist:win first');
    process.exit(1);
  }

  // Find the files to upload
  const all      = fs.readdirSync(DIST);
  const exe      = all.find(f => f.endsWith('.exe') && !f.endsWith('.blockmap'));
  const yml      = all.find(f => f === 'latest.yml');
  const blockmap = all.find(f => f.endsWith('.exe.blockmap'));

  if (!exe || !yml) {
    console.error('❌  Could not find installer (.exe) or latest.yml in dist/');
    process.exit(1);
  }

  console.log(`\n📦  Deploying to ${SERVER}/downloads/`);
  console.log(`    Installer : ${exe}`);
  console.log(`    Manifest  : ${yml}`);
  if (blockmap) console.log(`    Blockmap  : ${blockmap}`);
  console.log('');

  const { default: fetch } = await import('node-fetch');
  const FormData            = (await import('node-fetch')).FormData || (await import('formdata-node')).FormData;

  // node-fetch v3 doesn't bundle FormData — use global if available, else import
  let FD;
  try { FD = (await import('formdata-node')).FormData; }
  catch (_) { FD = globalThis.FormData; }

  if (!FD) {
    // Fallback: build multipart manually
    await uploadWithBuiltinHttp(SERVER, SECRET, DIST, exe, yml, blockmap);
    return;
  }

  const form = new FD();
  form.append('installer', new Blob([fs.readFileSync(path.join(DIST, exe))]),      exe);
  form.append('yml',       new Blob([fs.readFileSync(path.join(DIST, yml))]),      yml);
  if (blockmap) {
    form.append('blockmap', new Blob([fs.readFileSync(path.join(DIST, blockmap))]), blockmap);
  }

  const headers = {};
  if (SECRET) headers['x-upload-secret'] = SECRET;

  const res = await fetch(`${SERVER}/api/releases/upload`, {
    method: 'POST',
    headers,
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) {
    console.log(`✅  Upload complete — ${data.files?.join(', ')}`);
    console.log(`\n🌐  Download page : ${SERVER}/download`);
    console.log(`🔄  Auto-update   : ${SERVER}/downloads/latest.yml`);
  } else {
    console.error('❌  Upload failed:', data.error || res.status);
    process.exit(1);
  }
}

// Pure-Node fallback — streams files via multipart without external deps
async function uploadWithBuiltinHttp(server, secret, dist, exe, yml, blockmap) {
  const https  = require('https');
  const http   = require('http');
  const url    = new URL(`${server}/api/releases/upload`);
  const bound  = '----Kre8rBoundary' + Date.now().toString(36);

  function filePart(name, filename, data) {
    const header = `--${bound}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    return [Buffer.from(header), data, Buffer.from('\r\n')];
  }

  const parts = [
    ...filePart('installer', exe,      fs.readFileSync(path.join(dist, exe))),
    ...filePart('yml',       yml,      fs.readFileSync(path.join(dist, yml))),
    ...(blockmap ? filePart('blockmap', blockmap, fs.readFileSync(path.join(dist, blockmap))) : []),
    Buffer.from(`--${bound}--\r\n`),
  ];
  const body = Buffer.concat(parts);

  const opts = {
    hostname: url.hostname,
    port:     url.port || (url.protocol === 'https:' ? 443 : 80),
    path:     url.pathname,
    method:   'POST',
    headers: {
      'Content-Type':   `multipart/form-data; boundary=${bound}`,
      'Content-Length': body.length,
      ...(secret ? { 'x-upload-secret': secret } : {}),
    },
  };

  await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch (_) {}
        if (res.statusCode === 200 && data.ok) {
          console.log(`✅  Upload complete — ${data.files?.join(', ')}`);
          console.log(`\n🌐  Download page : ${server}/download`);
        } else {
          console.error('❌  Upload failed:', data.error || res.statusCode);
        }
        resolve();
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1); });
