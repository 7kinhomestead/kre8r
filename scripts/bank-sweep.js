#!/usr/bin/env node
/**
 * bank-sweep.js — the double-post guard between Rella and the house runner.
 *
 * WHY (Sep 21 2026, late): Rella's payment bounced (PayPal drained the account
 * for a domain renewal). Rella MAY keep firing through its grace window, or it
 * may go dark tonight — nobody can tell from outside. Re-enabling the house
 * runner blind would double-post on every day Rella still works. So this sweep
 * runs a while AFTER each Facebook slot and asks the PAGE, not Rella:
 *   "did anything get published since the slot opened?"
 *   yes → Rella did its job, do nothing.
 *   no  → run scripts/bank-post.js --platform fb (idempotent: it writes
 *          `posted.fb` into the record first and skips on a re-run).
 *
 * The record for the day comes from tt-bank.json (schedule.date == today PT,
 * schedule.fb.utc = the slot). If the slot has not passed yet, or passed less
 * than GRACE_MIN ago, the sweep leaves — the next trigger will look again.
 *
 * FACEBOOK ONLY. Instagram's token in platform_connections expired Jun 16 2026
 * and the runner cannot post there until Meta is reconnected in PostΩr; the
 * sweep refuses --platform ig rather than pretend. TikTok never (bank law).
 *
 *   node scripts/bank-sweep.js [--date YYYY-MM-DD] [--dry-run]
 *   LOG  H:\edit-staging\TT-BANK\logs\bank-sweep.log
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BANK   = 'H:/edit-staging/TT-BANK/tt-bank.json';
const LOGDIR = 'H:/edit-staging/TT-BANK/logs';
const LOG    = path.join(LOGDIR, 'bank-sweep.log');
const GRACE_MIN  = 20;   // wait this long after the slot before judging Rella
const LOOK_BACK  = 30;   // minutes before the slot that still count as "the slot"

const args = { dryRun: false, date: null };
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (t === '--dry-run') args.dryRun = true;
  else if (t === '--date') args.date = process.argv[++i];
  else if (t.startsWith('--date=')) args.date = t.split('=')[1];
  else if (t === '--platform') { const p = process.argv[++i]; if (p !== 'fb') { console.error('bank-sweep covers Facebook only (Instagram token expired; reconnect Meta in PostΩr)'); process.exit(2); } }
}

fs.mkdirSync(LOGDIR, { recursive: true });
const log = (m) => { const line = `${new Date().toISOString()}  [bank-sweep] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

function todayPT() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}

function pageToken() {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.DB_PATH || path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'kre8r', 'kre8r.db');
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA query_only = 1');
  const row = db.prepare(`SELECT access_token, account_id FROM platform_connections WHERE platform = 'facebook'`).get();
  db.close();
  if (!row || !row.access_token || !row.account_id) throw new Error('facebook is not connected in platform_connections');
  return row;
}

async function publishedSince(conn, sinceUnix) {
  const base = 'https://graph.facebook.com/v21.0/' + conn.account_id;
  const q = (p) => fetch(`${base}${p}&access_token=${conn.access_token}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json());
  const found = [];
  const posts = await q(`/published_posts?fields=id,created_time&since=${sinceUnix}&limit=10`);
  if (posts.error) throw new Error('published_posts: ' + posts.error.message);
  for (const p of posts.data || []) found.push({ kind: 'post', id: p.id, at: p.created_time });
  // created_time, never updated_time: Meta bumps updated_time on every reel as
  // views tick over, so ten old reels look "fresh" a minute after the slot and
  // the guard would swear Rella posted when it did not (seen in the Sep 21 dry run).
  const reels = await q(`/video_reels?fields=id,created_time&limit=10`);
  if (reels.error) throw new Error('video_reels: ' + reels.error.message);
  for (const r of reels.data || []) {
    const t = Date.parse(r.created_time) / 1000;
    if (t >= sinceUnix) found.push({ kind: 'reel', id: r.id, at: r.created_time });
  }
  return found;
}

(async () => {
  const date = args.date || todayPT();
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
  const items = Array.isArray(bank) ? bank : (bank.clips || bank.items || Object.values(bank)[0]);
  const rec = items.find(r => r.schedule && r.schedule.date === date && r.schedule.fb && r.schedule.fb.utc);
  if (!rec) { log(`${date}: no FB record scheduled — nothing to sweep`); return; }
  if (rec.posted && rec.posted.fb) { log(`${date} ${rec.id}: house runner already posted (${rec.posted.fb.id || 'ok'}) — done`); return; }

  const slot = Date.parse(rec.schedule.fb.utc) / 1000;
  const now  = Date.now() / 1000;
  if (now < slot + GRACE_MIN * 60) { log(`${date} ${rec.id}: slot ${rec.schedule.fb.local_time} not ${GRACE_MIN} min past yet — leaving`); return; }

  const conn  = pageToken();
  const since = slot - LOOK_BACK * 60;
  const found = await publishedSince(conn, since);
  if (found.length) { log(`${date} ${rec.id}: Rella posted (${found.map(f => f.kind + ' ' + f.at).join(', ')}) — skipping`); return; }

  log(`${date} ${rec.id}: NOTHING on the page since ${new Date(since * 1000).toISOString()} — ${args.dryRun ? 'would run' : 'running'} the house runner`);
  if (args.dryRun) return;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'bank-post.js'), '--platform', 'fb', '--date', date], { stdio: 'inherit' });
  log(`${date} ${rec.id}: bank-post exit ${r.status}`);
  process.exit(r.status || 0);
})().catch((e) => { log(`FATAL ${e.message}`); process.exit(1); });
