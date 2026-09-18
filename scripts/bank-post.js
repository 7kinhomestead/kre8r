#!/usr/bin/env node
'use strict';

/**
 * bank-post.js — Kre8Ωr's own Facebook/Instagram publisher for the TT-BANK.
 *
 * WHY THIS EXISTS
 * ---------------
 * Rella's connector cannot set auto-publish. Every item it creates is born dark
 * (auto_publish=false, status APPROVED) and the slot passes without firing —
 * that is the nine-dark-days story in BANK-LEDGER.md. This runner cuts Rella
 * out of the daily TT-BANK loop entirely: it reads the schedule, hosts the file,
 * and publishes straight through the Meta Graph API. Nothing is born dark.
 *
 * HOW IT PUBLISHES
 * ----------------
 * Three transports, because Meta does not offer one:
 *   FB Reel  (≤90s)  binary upload — the bytes go straight to rupload.
 *                    NOTHING is ever put on a public host. (Meta's Reels
 *                    fetcher is blocked by the Cloudflare in front of the land
 *                    box — see publishFacebookReel. Sending bytes sidesteps it
 *                    and is the safer design regardless.)
 *   FB video (>90s)  clipdrop — /videos fetches the file from a random folder
 *                    on the land box, which is torn down the moment Meta has it.
 *   Instagram        clipdrop — the container API only accepts a video_url.
 * Whatever is parked on clipdrop is deleted in a `finally`, so a crash mid-post
 * still takes the file down.
 *
 * THE LAWS IT OBEYS (BANK-LEDGER.md / TT-BANK README)
 *   - ≤90s → FB REEL (video_reels API). >90s → FB VIDEO POST (/videos).
 *     The Reels API hard-caps 90s and over-length cards fail SILENTLY (B4
 *     batch, Aug 13). The duration gate here is measured, not trusted: the
 *     record's own fb_type is cross-checked and the measured duration wins.
 *   - Captions verbatim from the record. `caption` → FB, `caption_ig` → IG.
 *     Nothing is rewritten, trimmed, or decorated at post time.
 *   - Slots: FB natives 12:00 PT · IG 15:00 PT (schedule.fb / schedule.ig).
 *   - ⛔ NEVER TikTok. TT-BANK clips are never reposted there. There is no
 *     TikTok code path in this file and there must never be one.
 *
 * IDEMPOTENT BY DESIGN
 * --------------------
 * Every publish writes `posted: { fb: {...}, ig: {...} }` back into the record
 * before anything else happens. A re-run — a retried task, a double trigger, a
 * hand invocation — reads that first and skips. Re-running is always safe.
 *
 * USAGE
 *   node scripts/bank-post.js --platform fb            # today's FB slot
 *   node scripts/bank-post.js --platform ig            # today's IG slot
 *   node scripts/bank-post.js --date 2026-09-19 --dry-run
 *   node scripts/bank-post.js --platform fb --id TT051 --dry-run
 *
 * FLAGS
 *   --platform fb|ig|both   default: both
 *   --date YYYY-MM-DD       Pacific date to run. default: today in PT
 *   --id TTnnn              override the date lookup with an explicit record
 *   --dry-run               everything except the publish call — including the
 *                           real clipdrop upload and a real HEAD of the URL —
 *                           then tears the folder down again
 *   --keep-drop             leave the clipdrop folder up (debugging only)
 *
 * LOG   H:\edit-staging\TT-BANK\logs\bank-post.log
 */

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(REPO, '.env') });

// node:sqlite is flagged experimental and prints a banner on every run. This is a
// scheduled task whose log is read by a human — keep that one line out of it.
const _emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return _emitWarning.call(process, warning, ...rest);
};

// ── Paths ────────────────────────────────────────────────────────────────────
// TT_BANK_DIR exists so the runner can be exercised against a copy of the bank
// without touching the live control surface. Unset in normal operation.
const BANK_DIR  = process.env.TT_BANK_DIR || 'H:/edit-staging/TT-BANK';
const BANK_JSON = path.join(BANK_DIR, 'tt-bank.json');
const READY_DIR = path.join(BANK_DIR, 'ready');
const LOG_DIR   = path.join(BANK_DIR, 'logs');
const LOG_FILE  = path.join(LOG_DIR, 'bank-post.log');
const LOCK_FILE = path.join(LOG_DIR, 'bank-post.lock');

// ── Graph ────────────────────────────────────────────────────────────────────
const GRAPH       = 'https://graph.facebook.com/v21.0';
const GRAPH_VIDEO = 'https://graph-video.facebook.com/v21.0';
const RUPLOAD     = 'https://rupload.facebook.com/video-upload/v21.0';
const GRAPH_IG    = 'https://graph.instagram.com/v21.0';

// ── Hosting (the ledger's clipdrop route) ────────────────────────────────────
const LAND_HOST    = 'land';                                   // ssh alias, landapp@64.23.158.236
const LAND_PUBLIC  = 'kre8r-land/public';                      // relative to landapp's home
const LAND_BASEURL = 'https://7kinhomestead.land';

// The Reels API hard cap. Over-length cards fail SILENTLY — see the B4 lesson.
const FB_REEL_MAX_SECONDS = 90;

// ── Logger (pino → file + pretty stdout) ─────────────────────────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
const pino = require('pino');
const log = pino(
  { level: process.env.LOG_LEVEL || 'info', base: { pid: process.pid }, timestamp: pino.stdTimeFunctions.isoTime },
  pino.multistream([
    { stream: pino.destination({ dest: LOG_FILE, sync: true, append: true }) },
    // SYS: = local clock. The schedule is written in Pacific and read by a human
    // in Pacific; a UTC console stamp is how you misread a slot.
    // colorize only for a real terminal: under the scheduled task stdout is a
    // file, and ANSI escapes make the shift log unreadable.
    { stream: require('pino-pretty')({ colorize: Boolean(process.stdout.isTTY), ignore: 'pid,hostname', translateTime: 'SYS:HH:MM:ss' }) },
  ])
);

// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { platform: 'both', date: null, id: null, dryRun: false, keepDrop: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run')       a.dryRun = true;
    else if (t === '--keep-drop') a.keepDrop = true;
    else if (t === '--platform') a.platform = String(argv[++i] || '').toLowerCase();
    else if (t.startsWith('--platform=')) a.platform = t.split('=')[1].toLowerCase();
    else if (t === '--date')     a.date = argv[++i];
    else if (t.startsWith('--date=')) a.date = t.split('=')[1];
    else if (t === '--id')       a.id = argv[++i];
    else if (t.startsWith('--id=')) a.id = t.split('=')[1];
    else if (t === '--help' || t === '-h') { printUsage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${t}`);
  }
  if (!['fb', 'ig', 'both'].includes(a.platform)) throw new Error(`--platform must be fb, ig or both (got "${a.platform}")`);
  if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new Error(`--date must be YYYY-MM-DD (got "${a.date}")`);
  return a;
}

function printUsage() {
  process.stdout.write(
    'Usage: node scripts/bank-post.js [--platform fb|ig|both] [--date YYYY-MM-DD] [--id TTnnn] [--dry-run] [--keep-drop]\n'
  );
}

/** Today's date in Pacific — the schedule is written in PT, so the lookup must be too. */
function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// ── Single-instance lock ─────────────────────────────────────────────────────
// Two runners would fight over the same tt-bank.json write and could double-post
// the same clip. Stale locks (dead pid, or older than the longest plausible run)
// are stolen rather than left to wedge the daily task forever.
const LOCK_STALE_MS = 45 * 60 * 1000;

function acquireLock(meta) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...meta }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch (_) {}
      const ageMs = held?.at ? Date.now() - Date.parse(held.at) : Infinity;
      const alive = held?.pid ? pidAlive(held.pid) : false;
      if (!alive || ageMs > LOCK_STALE_MS) {
        log.warn({ held, ageMs, alive }, 'stealing stale bank-post lock');
        try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
        continue;
      }
      log.warn({ held }, 'another bank-post run holds the lock — exiting without posting');
      return false;
    }
  }
  return false;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} }

// ── Bank I/O ─────────────────────────────────────────────────────────────────
function readBank() {
  const raw = fs.readFileSync(BANK_JSON, 'utf8');
  const bank = JSON.parse(raw);
  if (!Array.isArray(bank)) throw new Error('tt-bank.json is not an array');
  return bank;
}

/**
 * Re-read, patch one record by id, write atomically. Never holds the whole file
 * in memory across a network call — a crash mid-upload can't leave a truncated
 * control surface, and anything another process changed meanwhile survives.
 */
function patchRecord(id, patch) {
  const bank = readBank();
  const rec = bank.find(r => r.id === id);
  if (!rec) throw new Error(`Record ${id} vanished from tt-bank.json`);
  Object.assign(rec, patch);
  const tmp = BANK_JSON + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bank, null, 2));
  fs.renameSync(tmp, BANK_JSON);
  return rec;
}

function markPosted(id, platform, entry) {
  const current = readBank().find(r => r.id === id);
  patchRecord(id, { posted: { ...(current?.posted || {}), [platform]: entry } });
  log.info({ id, platform, entry }, 'posted recorded in tt-bank.json');
}

function findRecord(bank, { id, date }) {
  if (id) {
    const rec = bank.find(r => r.id === id);
    if (!rec) throw new Error(`No record with id ${id}`);
    return rec;
  }
  const hits = bank.filter(r => r.schedule && r.schedule.date === date);
  if (hits.length === 0) return null;
  if (hits.length > 1) throw new Error(`${hits.length} records scheduled for ${date}: ${hits.map(r => r.id).join(', ')} — the schedule is one clip per day`);
  return hits[0];
}

function resolveFile(rec) {
  const candidates = [rec.out_path, path.join(READY_DIR, rec.filename || '')].filter(Boolean);
  for (const c of candidates) {
    const p = c.replace(/\\/g, '/');
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`File not found for ${rec.id}. Tried: ${candidates.join(' | ')}`);
}

// ── Duration gate ────────────────────────────────────────────────────────────
/**
 * The ONE decision that fails silently if you get it wrong. ffprobe is the
 * source of truth; the record's fb_type is only a cross-check, and a
 * disagreement is logged loudly rather than quietly obeyed.
 */
function measureDuration(file, rec) {
  let measured = null;
  try {
    const ffprobe = process.env.FFPROBE_PATH || require('ffprobe-static').path;
    const out = execFileSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ], { encoding: 'utf8' });
    measured = parseFloat(out.trim());
  } catch (err) {
    log.warn({ err: err.message }, 'ffprobe failed — falling back to the recorded duration');
  }
  const duration = Number.isFinite(measured) ? measured : Number(rec.duration);
  if (!Number.isFinite(duration)) throw new Error(`Cannot determine duration for ${rec.id}`);

  const kind = duration <= FB_REEL_MAX_SECONDS ? 'reel' : 'video';
  if (rec.fb_type && rec.fb_type !== kind) {
    log.warn({ id: rec.id, recorded: rec.fb_type, measured: duration, using: kind },
      'fb_type in the record disagrees with the measured duration — the measurement wins (Reels cap fails silently)');
  }
  return { duration, kind, measuredByFfprobe: Number.isFinite(measured) };
}

// ── clipdrop hosting ─────────────────────────────────────────────────────────
function ssh(cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', LAND_HOST, cmd], { encoding: 'utf8' });
}

/** Park the file on the land box under a random folder. Returns { url, folder, cleanup }. */
function hostOnClipdrop(file) {
  const folder = `clipdrop-${crypto.randomBytes(6).toString('hex')}`;
  const name = path.basename(file);
  const remoteDir = `~/${LAND_PUBLIC}/${folder}`;

  ssh(`mkdir -p ${remoteDir}`);
  log.info({ folder }, 'clipdrop folder created');

  try {
    execFileSync('scp', ['-q', '-o', 'BatchMode=yes', file, `${LAND_HOST}:${remoteDir}/${name}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    try { ssh(`rm -rf ${remoteDir}`); } catch (_) {}
    throw new Error(`scp to the land box failed: ${err.message}`);
  }

  const url = `${LAND_BASEURL}/${folder}/${encodeURIComponent(name)}`;
  log.info({ url }, 'clipdrop upload complete');

  let torn = false;
  const cleanup = () => {
    if (torn) return;
    torn = true;
    try {
      ssh(`rm -rf ${remoteDir}`);
      log.info({ folder }, 'clipdrop folder deleted');
    } catch (err) {
      // Loud: a file left on a public host is the one failure mode worth shouting about.
      log.error({ folder, err: err.message }, 'CLIPDROP CLEANUP FAILED — delete this folder by hand: ssh land "rm -rf ~/' + LAND_PUBLIC + '/' + folder + '"');
    }
  };
  return { url, folder, cleanup };
}

/** Meta will refuse anything it cannot fetch — prove the URL first, and prove it is video. */
async function headCheck(url, expectedBytes) {
  const res = await fetch(url, { method: 'HEAD' });
  const type = res.headers.get('content-type');
  const len = Number(res.headers.get('content-length'));
  const out = { status: res.status, content_type: type, content_length: len };
  if (!res.ok) throw new Error(`HEAD ${url} → ${res.status}`);
  if (!/^video\/mp4/i.test(type || '')) throw new Error(`HEAD ${url} → content-type "${type}", expected video/mp4`);
  if (expectedBytes && len && len !== expectedBytes) {
    throw new Error(`HEAD ${url} → ${len} bytes, expected ${expectedBytes} — upload is incomplete`);
  }
  log.info(out, 'HEAD check passed');
  return out;
}

// ── Graph helpers ────────────────────────────────────────────────────────────
async function graph(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { _raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function graphError(label, r) {
  const msg = r.json?.error?.message || r.json?._raw || JSON.stringify(r.json);
  return new Error(`${label} → HTTP ${r.status}: ${msg}`);
}

// ── Connections ──────────────────────────────────────────────────────────────
/**
 * THE DATABASE RULE, honoured exactly.
 *
 * This task fires at noon whether or not the Electron app happens to be up, so
 * it cannot depend on the server being there — and the server's
 * /api/postor/connections route deliberately does not return tokens anyway.
 * So the tokens are read straight from the Electron DB, but **READ-ONLY**:
 *   - opened with readonly: true, so no write can reach the file
 *   - query_only pragma as a second belt
 *   - no schema, no migration, no write path anywhere in this file
 * Read-only readers are exactly what WAL mode is built for; the corruption rule
 * in CLAUDE.md is about WRITING to the .db behind a running server. Nothing here
 * writes. The only file this script ever writes is tt-bank.json.
 *
 * node:sqlite is used rather than better-sqlite3 on purpose: better-sqlite3 is a
 * native module compiled against one specific Node ABI, and a scheduled task
 * must not break the next time Node is upgraded on this box (it is broken right
 * now — the installed binary wants NODE_MODULE_VERSION 145, node here is 137).
 */
function dbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const appData = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'kre8r', 'kre8r.db');
}

let _connCache = null;
function readConnections() {
  if (_connCache) return _connCache;
  const file = dbPath();
  if (!fs.existsSync(file)) throw new Error(`Kre8r database not found at ${file} — set DB_PATH`);

  let rows;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA query_only = 1');
    rows = db.prepare('SELECT platform, access_token, account_id, account_name, token_expires_at FROM platform_connections').all();
    db.close();
  } catch (err) {
    // Older Node without node:sqlite — fall back to the project's own driver.
    log.warn({ err: err.message }, 'node:sqlite unavailable — falling back to better-sqlite3 (read-only)');
    const Database = require('better-sqlite3');
    const db = new Database(file, { readonly: true, fileMustExist: true });
    rows = db.prepare('SELECT platform, access_token, account_id, account_name, token_expires_at FROM platform_connections').all();
    db.close();
  }

  _connCache = Object.fromEntries(rows.map(r => [r.platform, r]));
  return _connCache;
}

function getConnection(platform) {
  const conn = readConnections()[platform];
  if (!conn) throw new Error(`${platform} is not connected in platform_connections — connect it in the Kre8r PostΩr UI`);
  if (!conn.access_token || !conn.account_id) throw new Error(`${platform} connection is missing a token or account id — reconnect it in PostΩr`);
  return conn;
}

/** Cheap liveness probe so an expired token fails before anything is uploaded anywhere. */
async function assertTokenLive(platform, conn) {
  const url = platform === 'facebook'
    ? `${GRAPH}/${conn.account_id}?fields=id,name&access_token=${encodeURIComponent(conn.access_token)}`
    : `${GRAPH_IG}/${conn.account_id}?fields=id,username&access_token=${encodeURIComponent(conn.access_token)}`;
  const r = await graph(url);
  if (!r.ok || r.json.error) throw graphError(`${platform} token check`, r);
  log.info({ platform, account: r.json }, 'token is live');
  return r.json;
}

// ── Facebook: Reel (≤90s) ────────────────────────────────────────────────────
/**
 * Three phases: start (get a video_id + upload_url) → rupload takes the bytes →
 * finish publishes it.
 *
 * ⚠ MEASURED SEP 18 2026 — THE REELS UPLOADER CANNOT FETCH FROM THE LAND BOX.
 * rupload supports a `file_url` header (Meta fetches the file itself), and that
 * is what the clipdrop route was built for. Against
 * https://7kinhomestead.land/clipdrop-…/x.mp4 it returns, every time:
 *     422 {"debug_info":{"retriable":false,"type":"FileUrlProcessingError",
 *          "message":"Unable to fetch media from URL, got status code: 403 Forbidden"}}
 * The origin is innocent — the same URL serves 200/206 to curl with any user
 * agent, including facebookexternalhit, and /{page}/videos?file_url= fetched
 * that very URL successfully minutes earlier. Cloudflare sits in front of
 * 7kinhomestead.land and blocks the rupload fetcher specifically.
 *
 * So Reels send the BYTES, not a URL: offset/file_size headers with the file as
 * the body. Verified working (`{"success":true}`). This is strictly better than
 * the hosted route anyway — a Reel never touches a public host at all, so there
 * is no window in which the clip is downloadable by anyone.
 */
async function publishFacebookReel({ pageId, pageToken, file, caption }) {
  const start = await graph(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: pageToken }),
  });
  if (!start.ok || start.json.error) throw graphError('FB reel start', start);
  const videoId = start.json.video_id;
  // Use the upload_url the start phase hands back — Meta versions it itself
  // (it currently answers v26.0) and hardcoding a version drifts.
  const uploadUrl = start.json.upload_url || `${RUPLOAD}/${videoId}`;
  log.info({ videoId, uploadUrl }, 'FB reel upload session opened');

  const bytes = fs.readFileSync(file);
  const up = await graph(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${pageToken}`,
      offset: '0',
      file_size: String(bytes.length),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  if (!up.ok || up.json.error || up.json.debug_info) throw graphError('FB reel rupload', up);
  log.info({ videoId, bytes: bytes.length, response: up.json }, 'FB reel media transferred (binary, no public host)');

  const finish = await graph(
    `${GRAPH}/${pageId}/video_reels?${new URLSearchParams({
      access_token: pageToken,
      video_id: videoId,
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      description: caption,
    })}`,
    { method: 'POST' }
  );
  if (!finish.ok || finish.json.error) throw graphError('FB reel finish', finish);
  log.info({ videoId, response: finish.json }, 'FB reel published');

  const status = await pollFacebookVideoStatus(videoId, pageToken);
  return { id: videoId, post_id: finish.json.post_id || null, finish: finish.json, status };
}

async function pollFacebookVideoStatus(videoId, pageToken, maxAttempts = 20) {
  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    const r = await graph(`${GRAPH}/${videoId}?fields=status,permalink_url&access_token=${encodeURIComponent(pageToken)}`);
    last = r.json;
    const s = r.json?.status?.video_status;
    log.info({ videoId, video_status: s, attempt: i + 1 }, 'FB video status');
    if (s === 'ready' || s === 'error') break;
    await new Promise(res => setTimeout(res, 5000));
  }
  return last;
}

// ── Facebook: video post (>90s) ──────────────────────────────────────────────
/**
 * `published` is a parameter here, which is what makes a safe live test
 * possible: published=false creates a real unpublished page video that can be
 * inspected and deleted without anything ever appearing on the page.
 */
async function publishFacebookVideo({ pageId, pageToken, videoUrl, caption, title, published = true }) {
  const params = new URLSearchParams({
    access_token: pageToken,
    file_url: videoUrl,
    description: caption,
    published: String(published),
  });
  if (title) params.set('title', title);

  const r = await graph(`${GRAPH_VIDEO}/${pageId}/videos`, { method: 'POST', body: params });
  if (!r.ok || r.json.error) throw graphError('FB video post', r);
  const videoId = r.json.id;
  log.info({ videoId, published }, 'FB video post created');

  const status = await pollFacebookVideoStatus(videoId, pageToken);
  return { id: videoId, post_id: r.json.post_id || null, status };
}

/**
 * The way back. Nothing in a normal run calls this — it exists so a post that
 * went out wrong can be pulled without hunting through Meta Business Suite:
 *
 *   const bp = require('./scripts/bank-post.js');
 *   await bp.deleteFacebookVideo('<posted.fb.id from tt-bank.json>', '<page token>');
 *
 * Verified Sep 18 2026 against the unpublished test video: {"success":true}.
 */
async function deleteFacebookVideo(videoId, pageToken) {
  const r = await graph(`${GRAPH}/${videoId}?access_token=${encodeURIComponent(pageToken)}`, { method: 'DELETE' });
  log.info({ videoId, status: r.status, response: r.json }, 'FB video delete');
  return r.json;
}

// ── Instagram: Reel ──────────────────────────────────────────────────────────
/**
 * Container → poll → publish. IG's own limits move; if it refuses a REELS
 * container on duration grounds the clip is retried as a plain VIDEO and the
 * fallback is recorded in the posted entry rather than hidden.
 */
async function createInstagramContainer({ igUserId, igToken, videoUrl, caption, mediaType = 'REELS' }) {
  // ⚠ UNVERIFIED LINK (Sep 18 2026): the IG token was expired when this was
  // built, so the one thing that could not be tested is whether IG's fetcher can
  // read a clipdrop URL. FB's /videos fetcher can; FB's Reels fetcher is blocked
  // by Cloudflare with a 403. If the first real IG run fails with a fetch/403
  // error, that is this same Cloudflare block — the fix is a Cloudflare WAF skip
  // rule for /clipdrop-* (or serving clipdrop from an unproxied host), NOT a
  // change to this code.
  const r = await graph(`${GRAPH_IG}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: mediaType,
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: igToken,
    }),
  });
  if (!r.ok || r.json.error) throw graphError(`IG ${mediaType} container`, r);
  log.info({ creation_id: r.json.id, mediaType }, 'IG container created');
  return r.json.id;
}

async function pollInstagramContainer(creationId, igToken, maxAttempts = 60) {
  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    const r = await graph(`${GRAPH_IG}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(igToken)}`);
    last = r.json;
    const s = r.json?.status_code;
    log.info({ creationId, status_code: s, detail: r.json?.status, attempt: i + 1 }, 'IG container status');
    if (s === 'FINISHED') return last;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`IG container ${creationId} → ${s}: ${r.json?.status || ''}`);
    await new Promise(res => setTimeout(res, 5000));
  }
  throw new Error(`IG container ${creationId} never reached FINISHED (${maxAttempts * 5}s)`);
}

async function publishInstagramReel({ igUserId, igToken, videoUrl, caption }) {
  let mediaType = 'REELS';
  let creationId;
  try {
    creationId = await createInstagramContainer({ igUserId, igToken, videoUrl, caption, mediaType });
  } catch (err) {
    // Only a duration refusal earns the fallback — anything else is a real failure.
    if (!/duration|too long|length/i.test(err.message)) throw err;
    log.warn({ err: err.message }, 'IG refused the Reel on duration — retrying as a VIDEO post');
    mediaType = 'VIDEO';
    creationId = await createInstagramContainer({ igUserId, igToken, videoUrl, caption, mediaType });
  }

  await pollInstagramContainer(creationId, igToken);

  const pub = await graph(`${GRAPH_IG}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: igToken }),
  });
  if (!pub.ok || pub.json.error) throw graphError('IG media_publish', pub);

  let permalink = null;
  const perm = await graph(`${GRAPH_IG}/${pub.json.id}?fields=permalink&access_token=${encodeURIComponent(igToken)}`);
  if (perm.ok && perm.json.permalink) permalink = perm.json.permalink;

  log.info({ id: pub.json.id, mediaType, permalink }, 'IG published');
  return { id: pub.json.id, media_type: mediaType, permalink, creation_id: creationId };
}

// ── Per-platform run ─────────────────────────────────────────────────────────
async function runPlatform({ platform, rec, file, gate, dryRun, keepDrop }) {
  const already = rec.posted?.[platform];
  if (already?.id) {
    log.info({ id: rec.id, platform, posted: already }, 'already posted — skipping (idempotent)');
    return { platform, skipped: 'already-posted', entry: already };
  }

  const slot = rec.schedule?.[platform];
  const caption = platform === 'fb' ? rec.caption : (rec.caption_ig || rec.caption);
  if (!caption) throw new Error(`${rec.id} has no caption for ${platform}`);

  const conn = getConnection(platform === 'fb' ? 'facebook' : 'instagram');
  await assertTokenLive(platform === 'fb' ? 'facebook' : 'instagram', conn);

  const bytes = fs.statSync(file).size;

  // Who needs a public URL and who does not. A FB Reel sends bytes directly, so
  // it never touches a public host. Everything else needs Meta to fetch the file.
  const needsHosting = !(platform === 'fb' && gate.kind === 'reel');

  log.info({
    id: rec.id, platform, file: path.basename(file), bytes,
    duration: gate.duration, kind: gate.kind, slot: slot?.local_time,
    caption_chars: caption.length, transport: needsHosting ? 'clipdrop url' : 'direct binary upload',
  }, dryRun ? 'DRY RUN — will not publish' : 'publishing');

  const drop = needsHosting ? hostOnClipdrop(file) : null;
  try {
    const head = drop ? await headCheck(drop.url, bytes) : null;

    if (dryRun) {
      const plan = platform === 'fb'
        ? (gate.kind === 'reel'
          ? {
            endpoint: `POST ${GRAPH}/${conn.account_id}/video_reels  upload_phase=start`,
            then: 'POST {upload_url} with Authorization/offset/file_size headers and the file as the body',
            finish: 'POST /video_reels  upload_phase=finish  video_state=PUBLISHED',
            description_chars: caption.length, bytes,
          }
          : { endpoint: `POST ${GRAPH_VIDEO}/${conn.account_id}/videos`, params: { file_url: drop.url, description: `<${caption.length} chars>`, title: rec.slug, published: 'true' } })
        : { endpoint: `POST ${GRAPH_IG}/${conn.account_id}/media`, params: { media_type: 'REELS', video_url: drop.url, caption: `<${caption.length} chars>`, share_to_feed: true } };
      log.info({ platform, plan, head }, 'DRY RUN — publish call built, not sent');
      return { platform, dryRun: true, url: drop?.url || null, head, plan };
    }

    let result;
    if (platform === 'fb') {
      result = gate.kind === 'reel'
        ? await publishFacebookReel({ pageId: conn.account_id, pageToken: conn.access_token, file, caption })
        : await publishFacebookVideo({ pageId: conn.account_id, pageToken: conn.access_token, videoUrl: drop.url, caption, title: rec.slug });
    } else {
      result = await publishInstagramReel({ igUserId: conn.account_id, igToken: conn.access_token, videoUrl: drop.url, caption });
    }

    const entry = {
      id: result.id,
      at: new Date().toISOString(),
      kind: platform === 'fb' ? gate.kind : (result.media_type === 'VIDEO' ? 'video-fallback' : 'reel'),
      post_id: result.post_id || null,
      permalink: result.permalink || null,
      slot: slot?.local_time || null,
      by: 'bank-post.js',
    };
    markPosted(rec.id, platform, entry);
    return { platform, entry, result };
  } finally {
    if (!drop) { /* nothing was ever hosted */ }
    else if (keepDrop) log.warn({ folder: drop.folder }, '--keep-drop: clipdrop folder left up ON A PUBLIC HOST — delete it when done');
    else drop.cleanup();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date || pacificToday();
  const platforms = args.platform === 'both' ? ['fb', 'ig'] : [args.platform];

  log.info({ date, platforms, dryRun: args.dryRun, id: args.id }, 'bank-post start');

  if (!acquireLock({ date, platforms })) return;

  let exitCode = 0;
  try {
    const bank = readBank();
    const rec = findRecord(bank, { id: args.id, date });
    if (!rec) {
      log.info({ date }, 'nothing scheduled for this date — nothing to do');
      return;
    }
    if (rec.status && rec.status !== 'staged') {
      log.warn({ id: rec.id, status: rec.status }, 'record is not staged — refusing to post');
      return;
    }

    const file = resolveFile(rec);
    const gate = measureDuration(file, rec);
    log.info({ id: rec.id, day: rec.schedule?.day, file: path.basename(file), ...gate }, 'record selected');

    for (const platform of platforms) {
      try {
        await runPlatform({ platform, rec, file, gate, dryRun: args.dryRun, keepDrop: args.keepDrop });
      } catch (err) {
        exitCode = 1;
        log.error({ id: rec.id, platform, err: err.message }, `${platform} FAILED`);
      }
    }
  } catch (err) {
    exitCode = 1;
    log.error({ err: err.message, stack: err.stack }, 'bank-post failed');
  } finally {
    releaseLock();
    log.info({ exitCode }, 'bank-post end');
  }
  // exitCode, never process.exit(): process.exit() tears the loop down while
  // pino's pretty transform is still closing, and libuv aborts with
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" — which looks like
  // a crash in the task history even on a clean run.
  process.exitCode = exitCode;
}

// Only run the shift when invoked as a command. Required as a module (for the
// recovery hatch above, or a REPL) it just hands over the functions.
if (require.main === module) main();

module.exports = {
  deleteFacebookVideo,
  getConnection,
  readBank,
  measureDuration,
  hostOnClipdrop,
  headCheck,
  pacificToday,
};
