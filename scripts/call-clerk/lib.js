'use strict';
/**
 * lib.js — the small shared floor under the Call Clerk.
 *
 * Arg parsing, the pino logger that writes beside the recordings, the ffmpeg pair,
 * and the two ways this machine talks to the house. Nothing clever lives here on
 * purpose: both clerk scripts are long enough already.
 */

const fs   = require('fs');
const path = require('path');
const pino = require('pino');

// ── args ────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt  = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] ?? d) : d; };

// ── where the calls live ────────────────────────────────────────────────────────
const CALLS_DIR = process.env.CALLS_DIR || 'H:\\edit-staging\\CALLS';
const CLIPS_DIR = path.join(CALLS_DIR, 'clips');

// ── the log ─────────────────────────────────────────────────────────────────────
// One file beside the recordings, plus the console, so a scheduled run and a hand
// run leave the same trail in the same place. H: is an external drive — if it is
// not mounted we still want the console line rather than a crash at require time.
function buildLogger() {
  const streams = [{ level: 'debug', stream: process.stdout }];
  try {
    fs.mkdirSync(CALLS_DIR, { recursive: true });
    const file = fs.createWriteStream(path.join(CALLS_DIR, 'call-clerk.log'), { flags: 'a' });
    // createWriteStream fails ASYNCHRONOUSLY, so a try/catch around it catches
    // nothing: an unwritable log arrives later as an unhandled 'error' event and
    // takes the whole process down with it. The clerk must never miss a call
    // because it could not open its diary — console-only is a fine day.
    file.on('error', (err) => process.stderr.write(`[call-clerk] log file unavailable: ${err.message}\n`));
    streams.push({ level: 'debug', stream: file });
  } catch (_) { /* console only */ }
  return pino({ level: process.env.LOG_LEVEL || 'debug', base: { mod: 'call-clerk' } }, pino.multistream(streams));
}
const log = buildLogger();

// ── ffmpeg ──────────────────────────────────────────────────────────────────────
// The bundled binaries first (they are pinned and always there); PATH is the
// fallback for a box where node_modules has been pruned.
function ffmpegPath() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return 'ffmpeg';
}
function ffprobePath() {
  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) return process.env.FFPROBE_PATH;
  try { const p = require('ffprobe-static'); const f = p && (p.path || p); if (f && fs.existsSync(f)) return f; } catch (_) {}
  return 'ffprobe';
}

// ── the house ───────────────────────────────────────────────────────────────────
const HARVEST_URL = String(process.env.HARVEST_API_URL || 'https://www.7kinhomestead.com').replace(/\/+$/, '');
const HARVEST_KEY = process.env.HARVEST_INTERNAL_KEY || process.env.INTERNAL_API_KEY || '';

async function harvestFetch(route, init = {}) {
  if (!HARVEST_KEY) throw new Error('no INTERNAL_API_KEY in kre8r/.env — the house will not open the door');
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(`${HARVEST_URL}${route}`, {
    ...init,
    headers: {
      'x-internal-key': HARVEST_KEY,
      'x-actor': 'call-clerk',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) {
    throw new Error(`${route}: HTTP ${res.status}${body && body.error ? ` — ${body.error}` : ''}`);
  }
  return body;
}

const harvestGet  = (route)       => harvestFetch(route);
const harvestPost = (route, body) => harvestFetch(route, { method: 'POST', body: JSON.stringify(body) });

// ── odds and ends ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'call';
}

/** YYYY-MM-DD in LOCAL time — the recording is named for the day Jason had, not UTC's. */
function isoLocalDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 3725 → "1h 2m". For the notes header. */
function humanDuration(s) {
  const secs = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** 95 → "1:35". For a timecode a human can scrub to. */
function timecode(s) {
  const secs = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

module.exports = {
  args, flag, opt, log,
  CALLS_DIR, CLIPS_DIR,
  ffmpegPath, ffprobePath,
  HARVEST_URL, harvestFetch, harvestGet, harvestPost,
  sleep, slugify, isoLocalDate, humanDuration, timecode,
};
