/**
 * beacon-tunnel.js — opens an ngrok tunnel to the local Kre8Ωr server (port 3000)
 * so the Kajabi completion beacon can reach it from the public web.
 *
 * Uses @ngrok/ngrok (same SDK the app uses for Meta uploads) + NGROK_AUTHTOKEN from .env.
 *
 * Run from the repo root:   node scripts/beacon-tunnel.js
 * Keep the window OPEN — closing it closes the tunnel.
 */

const fs   = require('fs');
const path = require('path');

// Load NGROK_AUTHTOKEN: try dotenv, then fall back to parsing .env directly.
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}
if (!process.env.NGROK_AUTHTOKEN) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const m = env.match(/^\s*NGROK_AUTHTOKEN\s*=\s*(.+)$/m);
    if (m) process.env.NGROK_AUTHTOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  } catch (_) {}
}

const PORT = Number(process.env.PORT) || 3000;
// Optional: a reserved/static ngrok domain (free tier gives you ONE). Set NGROK_DOMAIN in
// .env (e.g. 7kin-beacon.ngrok-free.app) and the tunnel uses the SAME url every restart —
// so you paste the endpoint into Kajabi once and never touch it again. Omit = random url.
const DOMAIN = (process.env.NGROK_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

(async () => {
  if (!process.env.NGROK_AUTHTOKEN) {
    console.error('\n✗ NGROK_AUTHTOKEN not found in .env — cannot open tunnel.\n');
    process.exit(1);
  }
  const ngrok = require('@ngrok/ngrok');
  const opts = { addr: PORT, authtoken: process.env.NGROK_AUTHTOKEN };
  if (DOMAIN) opts.domain = DOMAIN;
  const listener = await ngrok.forward(opts);
  const url = listener.url();

  console.log('\n==================================================');
  console.log('  ✓ TUNNEL UP' + (DOMAIN ? '  (static domain — never changes)' : ''));
  console.log('  ' + url);
  console.log('  → forwarding to http://localhost:' + PORT);
  console.log('');
  console.log('  PASTE THIS into Kajabi (Customize → Kre8r Analytics → Completion Tracking Endpoint):');
  console.log('  ' + url.replace(/\/$/, '') + '/api/kajabi-track');
  if (!DOMAIN) {
    console.log('');
    console.log('  ⚠ This url is RANDOM — it changes every restart. To make it permanent,');
    console.log('    claim your free static domain at https://dashboard.ngrok.com/domains');
    console.log('    then add  NGROK_DOMAIN=your-name.ngrok-free.app  to .env and rerun.');
  }
  console.log('');
  console.log('  Keep this window OPEN (closing it kills the tunnel).');
  console.log('==================================================\n');

  // Keep the process alive.
  process.stdin.resume();
})().catch(err => {
  console.error('\n✗ Tunnel failed:', err.message, '\n');
  process.exit(1);
});
