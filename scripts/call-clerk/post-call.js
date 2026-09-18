#!/usr/bin/env node
'use strict';
/**
 * post-call.js — THE CALL CLERK, part two: listen, and write it down.
 *
 * join-and-record.js sat in the room. This is the part that does the remembering:
 * whisperx puts ears on the mp4, Claude reads the transcript for the things that
 * were actually SAID OUT LOUD — what Jason promised, what somebody asked for, what
 * got decided — and those land in three places:
 *
 *   H:\edit-staging\CALLS\<date>-notes.md      the readable page, for Jason
 *   H:\edit-staging\CALLS\<date>-actions.json  the structured extraction
 *   C:\Users\18054\kinos\call-actions.json     the OPEN items, appended
 *
 * That last file is the point of the whole machine. The Morning Foreman reads it at
 * 7am and puts the top two open promises on the day card, so a thing Jason said on
 * a Thursday call cannot quietly evaporate by Monday. Nothing here ever marks an
 * item done — Jason tells Ledger, and Ledger flips it.
 *
 * It also cuts TEASERS. Claude picks 3-6 self-contained moments and ffmpeg copies
 * each one out to clips\, so Jason has a tray of shorts to choose from. Their job is
 * to show a Greenhouse member what the room is worth and send them at the Garden
 * upgrade — the live call is the thing being sold, so the teaser gives the flavour
 * and stops.
 *
 *   node scripts/call-clerk/post-call.js                     # newest un-noted call
 *   node scripts/call-clerk/post-call.js --mp4 <path>
 *   node scripts/call-clerk/post-call.js --transcript <json> --date 2026-09-11
 *
 *   --mp4 <path>        the recording to work on
 *   --transcript <p>    skip whisperx, use this whisperx json (or a .txt)
 *   --date <YYYY-MM-DD> name the outputs for this day (default: from the file)
 *   --event <id>        attach to this event (default: from the sidecar)
 *   --no-upload         do not push to Cloudflare Stream / attach the replay
 *   --no-clips          extract the clip list but cut nothing
 *   --force             re-run over notes that already exist
 *
 * DRY_RUN=1 in kre8r/.env is the master switch on the one step that touches the
 * outside world (the Stream upload + the replay attach). Notes, actions and clips
 * always run — they are Jason's own desk.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const {
  flag, opt, log, CALLS_DIR, CLIPS_DIR, sleep, slugify,
  ffmpegPath, ffprobePath, harvestPost, HARVEST_URL,
  humanDuration, timecode, isoLocalDate,
} = require('./lib');

// BEFORE claude.js is loaded, and the order matters. The shared caller logs token
// usage through src/db, and a background script that reaches for the live .db while
// the server holds the WAL lock is the one thing this house never does. With no
// DB_PATH it also silently falls back to the repo's stale dev database. So the clerk
// is given its own file beside the recordings: the accounting still happens, and
// nothing here ever opens AppData\Roaming\kre8r\kre8r.db.
if (!process.env.DB_PATH) {
  try { fs.mkdirSync(CALLS_DIR, { recursive: true }); } catch (_) {}
  process.env.DB_PATH = path.join(CALLS_DIR, 'call-clerk.db');
}
const { callClaude, repairJSON } = require('../../src/utils/claude');

const KINOS_ACTIONS = process.env.CALL_ACTIONS_PATH || 'C:\\Users\\18054\\kinos\\call-actions.json';
const DRY_RUN   = String(process.env.DRY_RUN || '').trim() === '1';
const NO_UPLOAD = flag('no-upload') || DRY_RUN;
const NO_CLIPS  = flag('no-clips');
const FORCE     = flag('force');

const WHISPER_MODEL = process.env.CALL_WHISPER_MODEL || 'large-v3';
const MIN_FREE_VRAM_MB = 4096;

const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || '').trim();
const CF_API_TOKEN  = (process.env.CF_API_TOKEN || process.env.CF_STREAM_TOKEN || '').trim();
const DIRECT_MAX = 200 * 1024 * 1024;
const CHUNK      = 50 * 1024 * 1024;

// ── little runners ──────────────────────────────────────────────────────────────

function run(bin, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { maxBuffer: 1 << 26, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${path.basename(bin)}: ${(stderr || err.message).toString().slice(0, 500)}`));
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function probe(file) {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout);
  return {
    duration_s: Math.round(Number(j.format && j.format.duration) || 0),
    size: Number(j.format && j.format.size) || 0,
    video: (j.streams || []).filter(s => s.codec_type === 'video').length,
    audio: (j.streams || []).filter(s => s.codec_type === 'audio').length,
  };
}

// ── pick the call ───────────────────────────────────────────────────────────────

/**
 * Newest sidecar that has an mp4 and has not been written up yet. The sidecar is
 * the ledger: notes_written is what stops a re-run from doing the whole hour twice.
 */
function newestUnnoted() {
  if (!fs.existsSync(CALLS_DIR)) return null;
  const cands = fs.readdirSync(CALLS_DIR)
    .filter(f => f.endsWith('.json') && !/-actions\.json$|-clips\.json$/.test(f))
    .map(f => path.join(CALLS_DIR, f))
    .map((p) => { try { return { p, j: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (_) { return null; } })
    .filter(x => x && x.j && x.j.mp4 && (FORCE || !x.j.notes_written))
    .filter(x => fs.existsSync(x.j.mp4))
    .sort((a, b) => String(b.j.started_recording || '').localeCompare(String(a.j.started_recording || '')));
  return cands[0] || null;
}

function sidecarFor(mp4) {
  const guess = mp4.replace(/\.(mp4|mkv)$/i, '.json');
  if (fs.existsSync(guess)) {
    try { return { p: guess, j: JSON.parse(fs.readFileSync(guess, 'utf8')) }; } catch (_) {}
  }
  return null;
}

// ── ears ────────────────────────────────────────────────────────────────────────

/**
 * The 3070 Ti is the same card that renders episodes and runs the vision model, so
 * the clerk asks before it takes it. Solar-aware compute rule, small version: if
 * something else is holding the VRAM, wait rather than OOM both jobs.
 */
async function waitForVram(maxWaitMin = 90) {
  const deadline = Date.now() + maxWaitMin * 60 * 1000;
  for (;;) {
    let free = null;
    try {
      const { stdout } = await run('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits']);
      free = Number(String(stdout).trim().split('\n')[0]);
    } catch (_) {
      log.warn('no nvidia-smi — running whisperx anyway');
      return;
    }
    if (Number.isFinite(free) && free >= MIN_FREE_VRAM_MB) { log.info({ free_mb: free }, 'GPU is free'); return; }
    if (Date.now() > deadline) { log.warn({ free_mb: free }, 'gave up waiting for the GPU — running anyway'); return; }
    log.info({ free_mb: free, need_mb: MIN_FREE_VRAM_MB }, 'GPU busy — waiting 5 min');
    await sleep(5 * 60 * 1000);
  }
}

/** whisperx → <dir>/<base>.json. Returns the json path. */
async function transcribe(mp4) {
  const dir  = path.dirname(mp4);
  const base = path.basename(mp4, path.extname(mp4));

  // The sidecar owns <base>.json, so ears go into their own folder and are moved
  // out under a name that cannot collide with it.
  const earsDir = path.join(dir, 'transcripts');
  const earsOut = path.join(earsDir, `${base}.json`);
  if (fs.existsSync(earsOut) && !FORCE) { log.info({ earsOut }, 'transcript already on disk'); return earsOut; }

  fs.mkdirSync(earsDir, { recursive: true });
  await waitForVram();
  log.info({ mp4, model: WHISPER_MODEL }, 'whisperx — listening');

  await new Promise((resolve, reject) => {
    // No shell: Node resolves whisperx.exe off PATH on its own, and a shell would
    // concatenate these arguments instead of passing them — one space in a path and
    // the filename splits in two.
    const p = spawn('whisperx', [
      mp4, '--model', WHISPER_MODEL, '--compute_type', 'int8',
      '--language', 'en', '--output_dir', earsDir, '--output_format', 'json',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    p.stdout.on('data', d => { tail = (tail + d).slice(-2000); });
    p.stderr.on('data', d => { tail = (tail + d).slice(-2000); });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`whisperx exit ${code}: ${tail.slice(-500)}`)));
    p.on('error', reject);
  });

  if (!fs.existsSync(earsOut)) throw new Error(`whisperx wrote nothing at ${earsOut}`);
  log.info({ earsOut }, 'transcript written');
  return earsOut;
}

/** whisperx json (or plain txt) → [{ start, end, text }] */
function readSegments(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(raw);
    const segs = Array.isArray(j.segments) ? j.segments : [];
    return segs
      .map(s => ({ start: Math.round(Number(s.start) || 0), end: Math.round(Number(s.end) || 0), text: String(s.text || '').trim() }))
      .filter(s => s.text);
  }
  // A hand-written .txt rehearsal transcript: "[123] words" or "0:12 words", or
  // just lines — anything without a stamp gets a rolling one so the shape holds.
  const out = [];
  let t = 0;
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^\[?(?:(\d+):)?(\d+):(\d{2})\]?\s+(.*)$/) || s.match(/^\[(\d+)\]\s+(.*)$/);
    if (m && m.length === 5) {
      t = (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
      out.push({ start: t, end: t + 5, text: m[4] });
    } else if (m) {
      t = Number(m[1]);
      out.push({ start: t, end: t + 5, text: m[2] });
    } else {
      out.push({ start: t, end: t + 5, text: s });
      t += 5;
    }
  }
  return out;
}

// ── the reading ─────────────────────────────────────────────────────────────────

const MAX_TRANSCRIPT_CHARS = 120000;

function buildPrompt(segments, meta) {
  let body = '';
  let truncated = false;
  for (const s of segments) {
    const line = `[${s.start}] ${s.text}\n`;
    if (body.length + line.length > MAX_TRANSCRIPT_CHARS) { truncated = true; break; }
    body += line;
  }

  return `You are reading the transcript of a live community call so that nothing said out loud gets lost.

THE CALL
  Title: ${meta.title || 'Rock Rich call'}
  Date: ${meta.date}
  Length: ${humanDuration(meta.duration_s)}
  Host: Jason Rutland (7 Kin Homestead / Rock Rich). His partner Cari is sometimes on camera.
  Audience: Rock Rich members — Greenhouse (free), Garden ($19/mo), Founding 50 ($297 once).

THE TRANSCRIPT
Each line is "[seconds] words". The number is the second that line starts at.${truncated ? '\n(NOTE: the transcript was too long and is cut off partway. Work with what is here.)' : ''}

${body}
END OF TRANSCRIPT

YOUR JOB
Return ONE JSON object and nothing else — no prose before it, no code fence, no commentary after it:

{
  "promises":       [{ "who": "Jason", "to": "<name said on the call, or \\"the room\\">", "what": "<what he committed to, one plain sentence>", "quote": "<his actual words, verbatim, under 30 words>", "t_s": <seconds>, "confidence": "high"|"medium"|"low" }],
  "requests":       [{ "from": "<who asked, or \\"someone\\">", "what": "<what they asked for>", "quote": "<verbatim, under 30 words>", "t_s": <seconds>, "confidence": "high"|"medium"|"low" }],
  "decisions":      [{ "what": "<what was settled>", "quote": "<verbatim>", "t_s": <seconds>, "confidence": "high"|"medium"|"low" }],
  "open_questions": [{ "from": "<who>", "what": "<the question nobody answered>", "t_s": <seconds> }],
  "highlights":     [{ "what": "<a moment worth remembering>", "t_s": <seconds> }],
  "clips":          [{ "title": "<short name>", "t_start_s": <seconds>, "t_end_s": <seconds>, "why": "<why this works as a standalone teaser>", "hook_line": "<the first line of on-screen text or caption, in Jason's voice>" }],
  "summary": "<three or four sentences: what this call was about and what came out of it>"
}

RULES — these matter more than being thorough:
1. ONLY things actually said. If it is not in the transcript, it does not exist. Never infer a promise from a topic being discussed.
2. NEVER INVENT A NAME. If you cannot tell who spoke, write "someone" (requests) or "the room" (who a promise was made to). A wrong name is worse than no name.
3. Speaker attribution comes from context. This is Jason's call and he does most of the talking, so a first-person commitment ("I'll get that up", "I'm going to send you") is Jason's unless the surrounding lines clearly say otherwise. When the surrounding lines do NOT make it clear, still record it but set confidence "low".
4. A PROMISE is a commitment to do a specific thing ("I'll post the spreadsheet", "I'll get you that link"). Not an opinion, not a plan out loud, not "we should probably". If it has no finish line, it is not a promise.
5. A REQUEST is somebody asking Jason (or the room) for something he has not yet agreed to.
6. Quotes are VERBATIM from the transcript, trimmed, never cleaned up or paraphrased.
7. t_s is the [seconds] number of the line it came from.
8. CLIPS: 3 to 6 self-contained moments that would work as a short vertical teaser for people who are NOT in the paid room — a tip that stands alone, a short story, a strong answer to a good question. Each must be between 30 and 120 seconds long, must start and end on a complete thought, and must make sense with zero setup. Their job is to show a free member what the room is worth so they upgrade for the live call — so a clip gives the flavour and stops, it never has to resolve everything. Do not pick anything that names a member's private business or a number Jason would not say publicly.
9. If a category has nothing in it, return an empty array. An empty array is a correct answer. Do not pad.`;
}

async function extract(segments, meta) {
  const prompt = buildPrompt(segments, meta);
  const model = process.env.CALL_CLERK_MODEL || undefined;   // undefined = the house default in claude.js
  log.info({ segments: segments.length, model: model || 'house default' }, 'Claude — reading the transcript');

  const raw = await callClaude(prompt, 4000, { tool: 'call-clerk', model, timeoutMs: 300000 });
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (_) { parsed = repairJSON(cleaned); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Claude did not return usable JSON');

  const arr = (k) => Array.isArray(parsed[k]) ? parsed[k] : [];
  return {
    promises: arr('promises'),
    requests: arr('requests'),
    decisions: arr('decisions'),
    open_questions: arr('open_questions'),
    highlights: arr('highlights'),
    clips: arr('clips'),
    summary: String(parsed.summary || '').trim(),
  };
}

// ── what gets written ───────────────────────────────────────────────────────────

function notesMarkdown(x, meta) {
  const L = [];
  const line = (item, extra = '') =>
    `- **${timecode(item.t_s)}** — ${item.what || ''}${extra}${item.confidence && item.confidence !== 'high' ? `  _(${item.confidence} confidence)_` : ''}` +
    (item.quote ? `\n  > ${String(item.quote).replace(/\s+/g, ' ').trim()}` : '');

  L.push(`# ${meta.title || 'Rock Rich call'} — ${meta.date}`);
  L.push('');
  L.push(`${humanDuration(meta.duration_s)}${meta.event_id ? ` · event ${meta.event_id}` : ''}${meta.mp4 ? ` · \`${path.basename(meta.mp4)}\`` : ''}`);
  L.push('');
  if (x.summary) { L.push(x.summary); L.push(''); }

  L.push('## 🤝 What Jason promised');
  L.push(x.promises.length
    ? x.promises.map(p => line(p, p.to ? `  _(to ${p.to})_` : '')).join('\n')
    : '_Nothing this week. That is a clean sheet, not a miss._');
  L.push('');

  L.push('## 🙋 What people asked for');
  L.push(x.requests.length
    ? x.requests.map(r => line({ ...r, what: `${r.what}${r.from ? ` — ${r.from}` : ''}` })).join('\n')
    : '_Nobody asked for anything._');
  L.push('');

  L.push('## ⚖️ Decided');
  L.push(x.decisions.length ? x.decisions.map(d => line(d)).join('\n') : '_Nothing settled._');
  L.push('');

  if (x.open_questions.length) {
    L.push('## ❓ Left hanging');
    L.push(x.open_questions.map(q => `- **${timecode(q.t_s)}** — ${q.what}${q.from ? ` _(${q.from})_` : ''}`).join('\n'));
    L.push('');
  }

  if (x.highlights.length) {
    L.push('## ✨ Moments');
    L.push(x.highlights.map(h => `- **${timecode(h.t_s)}** — ${h.what}`).join('\n'));
    L.push('');
  }

  L.push('## ✂️ Teasers to cut');
  L.push('');
  L.push('A teaser is not the call. Its job is to show a Greenhouse member what the room is worth — a tip, a story, a straight answer — and then stop, so the next move is the Garden upgrade and being in the room live. Give the flavour, never the whole meal.');
  L.push('');
  if (x.clips.length) {
    for (const c of x.clips) {
      const dur = Math.round((Number(c.t_end_s) || 0) - (Number(c.t_start_s) || 0));
      L.push(`- **${c.title}** — ${timecode(c.t_start_s)}→${timecode(c.t_end_s)} (${dur}s)`);
      if (c.hook_line) L.push(`  - hook: "${c.hook_line}"`);
      if (c.why) L.push(`  - why: ${c.why}`);
      if (c.file) L.push(`  - \`${c.file}\``);
      else if (c.cut_error) L.push(`  - ⚠ not cut: ${c.cut_error}`);
    }
  } else {
    L.push('_No clean standalone moments in this one._');
  }
  L.push('');
  L.push('---');
  L.push(`_Written by the Call Clerk. Open promises went to \`${KINOS_ACTIONS}\` — the Morning Foreman reads them at 7am. Tell Ledger when one is done._`);
  return L.join('\n') + '\n';
}

/**
 * Append the open items to the file the Morning Foreman reads.
 * Never marks anything done and never removes anything: Jason's word is the only
 * thing that closes one of these. Dedupe is on what+date so a --force re-run does
 * not stack the same promise twice.
 */
function appendActions(x, meta) {
  let existing = [];
  try {
    if (fs.existsSync(KINOS_ACTIONS)) {
      const j = JSON.parse(fs.readFileSync(KINOS_ACTIONS, 'utf8'));
      existing = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
    }
  } catch (err) {
    log.error({ err: err.message }, 'call-actions.json would not parse — writing a fresh one beside it');
    try { fs.copyFileSync(KINOS_ACTIONS, `${KINOS_ACTIONS}.broken-${Date.now()}`); } catch (_) {}
    existing = [];
  }

  const key = (it) => `${String(it.what || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${it.date}`;
  const seen = new Set(existing.map(key));

  const fresh = [];
  const add = (kind, it, who, to) => {
    const row = {
      id: `${meta.date}-${kind}-${slugify(it.what).slice(0, 28)}-${fresh.length + 1}`,
      date: meta.date,
      event: meta.title || 'Rock Rich call',
      event_id: meta.event_id || null,
      kind,
      who,
      to: to || null,
      what: String(it.what || '').trim(),
      quote: it.quote ? String(it.quote).trim() : null,
      confidence: it.confidence || 'medium',
      status: 'open',
      source_t_s: Number(it.t_s) || 0,
    };
    if (!row.what || seen.has(key(row))) return;
    seen.add(key(row));
    fresh.push(row);
  };

  for (const p of x.promises) add('promise', p, p.who || 'Jason', p.to || 'the room');
  for (const r of x.requests) add('request', r, r.from || 'someone', 'Jason');

  if (!fresh.length) { log.info('nothing new for the day card'); return { added: 0, total: existing.length }; }

  const all = existing.concat(fresh);
  fs.mkdirSync(path.dirname(KINOS_ACTIONS), { recursive: true });
  const tmp = `${KINOS_ACTIONS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, KINOS_ACTIONS);     // never leave a half-written ledger
  log.info({ added: fresh.length, total: all.length, file: KINOS_ACTIONS }, 'open items handed to the Morning Foreman');
  return { added: fresh.length, total: all.length };
}

// ── the teasers ─────────────────────────────────────────────────────────────────

/**
 * Stream copy, so a 90-second cut costs a second and the picture is untouched. The
 * cut lands on the nearest keyframe before the asked-for start, which is exactly
 * right for a tray of candidates Jason is going to top-and-tail in the edit anyway.
 */
async function cutClips(clips, mp4, meta) {
  if (!clips.length) return;
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  const total = meta.duration_s || 0;

  let n = 0;
  for (const c of clips) {
    n++;
    const start = Math.max(0, Math.floor(Number(c.t_start_s) || 0));
    let end = Math.ceil(Number(c.t_end_s) || 0);
    if (!(end > start)) { c.cut_error = 'no usable in/out'; continue; }
    if (total && end > total) end = total;
    let dur = end - start;
    if (dur < 10) { c.cut_error = `too short (${dur}s)`; continue; }
    if (dur > 180) dur = 180;                      // a teaser is never three minutes

    const file = path.join(CLIPS_DIR, `${meta.date}-${n}-${slugify(c.title)}.mp4`);
    try {
      await run(ffmpegPath(), [
        '-y', '-ss', String(start), '-i', mp4, '-t', String(dur),
        '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', file,
      ]);
      const info = await probe(file);
      if (!info.duration_s) throw new Error('ffmpeg wrote an empty clip');
      c.file = file;
      c.cut_duration_s = info.duration_s;
      log.info({ clip: path.basename(file), seconds: info.duration_s }, 'teaser cut');
    } catch (err) {
      c.cut_error = err.message.slice(0, 200);
      log.error({ clip: c.title, err: c.cut_error }, 'teaser would not cut');
    }
  }
}

// ── Cloudflare Stream ───────────────────────────────────────────────────────────
// Lifted from harvestomr/scripts/stream-upload.js and kept here on purpose: the two
// repos deploy to different machines and must not import across the gap.

const cfBase = () => `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;
const cfAuth = () => ({ Authorization: `Bearer ${CF_API_TOKEN}` });
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

async function cfJson(res, what) {
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok || (body && body.success === false)) {
    const errs = body && Array.isArray(body.errors) ? body.errors.map(e => `${e.code || ''} ${e.message || ''}`.trim()).join('; ') : '';
    throw new Error(`${what}: HTTP ${res.status}${errs ? ` — ${errs}` : ''}`);
  }
  return body;
}

async function uploadDirect(file, name) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  form.append('requireSignedURLs', 'false');
  form.append('meta', JSON.stringify({ name }));
  const body = await cfJson(await fetch(cfBase(), { method: 'POST', headers: cfAuth(), body: form }), 'stream direct upload');
  const uid = body && body.result && body.result.uid;
  if (!uid) throw new Error('stream direct upload: no uid came back');
  return uid;
}

async function uploadTus(file, size, name) {
  const create = await fetch(cfBase(), {
    method: 'POST',
    headers: {
      ...cfAuth(),
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(size),
      'Upload-Metadata': [`name ${b64(name)}`, `requiresignedurls ${b64('false')}`].join(','),
    },
  });
  if (create.status !== 201) {
    throw new Error(`tus create: HTTP ${create.status} — ${(await create.text().catch(() => '')).slice(0, 300)}`);
  }
  const location = create.headers.get('location');
  let uid = create.headers.get('stream-media-id');
  if (!location) throw new Error('tus create: no Location header');

  let offset = 0;
  while (offset < size) {
    const end = Math.min(offset + CHUNK, size);
    const chunk = Buffer.alloc(end - offset);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, chunk, 0, chunk.length, offset); } finally { fs.closeSync(fd); }

    const res = await fetch(location, {
      method: 'PATCH',
      headers: {
        ...cfAuth(),
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(chunk.length),
      },
      body: chunk,
    });
    if (res.status !== 204 && res.status !== 200) {
      throw new Error(`tus patch at ${offset}: HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 300)}`);
    }
    uid = res.headers.get('stream-media-id') || uid;
    const next = Number(res.headers.get('upload-offset'));
    offset = Number.isFinite(next) && next > offset ? next : end;
    log.info({ pct: Math.round((offset / size) * 100) }, 'uploading the replay');
  }

  if (!uid) {
    const m = String(location).match(/([0-9a-f]{32})/i);
    uid = m ? m[1].toLowerCase() : null;
  }
  if (!uid) throw new Error('tus upload finished without a uid');
  return uid;
}

async function publishReplay(mp4, meta) {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    log.warn('no CF_ACCOUNT_ID / CF_API_TOKEN in kre8r/.env — the replay stays on this disk');
    return null;
  }
  const size = fs.statSync(mp4).size;
  const name = `${meta.title || 'Rock Rich call'} — ${meta.date}`;
  log.info({ size_mb: Math.round(size / 1e6), mode: size > DIRECT_MAX ? 'tus' : 'direct' }, 'Cloudflare Stream');
  const uid = size > DIRECT_MAX ? await uploadTus(mp4, size, name) : await uploadDirect(mp4, name);
  log.info({ uid }, 'replay is on Stream');

  if (meta.event_id) {
    await harvestPost(`/api/bridge/events/${meta.event_id}/recording`, {
      stream_uid: uid,
      note: `Recorded by the Call Clerk · ${humanDuration(meta.duration_s)}`,
    });
    log.info({ event: meta.event_id, url: `${HARVEST_URL}/event/${meta.event_id}` }, 'replay attached to the call');
  } else {
    log.warn('no event id on the sidecar — uploaded, but nothing to hang it on');
  }
  return uid;
}

// ── main ────────────────────────────────────────────────────────────────────────

(async () => {
  let mp4 = opt('mp4', null);
  let side = null;

  if (mp4) side = sidecarFor(mp4);
  else {
    side = newestUnnoted();
    if (!side) { log.info('no recording waiting to be written up'); process.exit(0); }
    mp4 = side.j.mp4;
  }
  if (!fs.existsSync(mp4)) throw new Error(`no such recording: ${mp4}`);

  const info = await probe(mp4);
  const date = opt('date', null)
    || (side && side.j.starts_at ? isoLocalDate(new Date(side.j.starts_at)) : null)
    || (path.basename(mp4).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]
    || isoLocalDate(new Date());

  const meta = {
    date,
    title: (side && side.j.title) || path.basename(mp4, path.extname(mp4)),
    event_id: opt('event', null) || (side && side.j.event_id) || null,
    duration_s: info.duration_s,
    mp4,
    rehearsal: !!(side && side.j.rehearsal),
  };
  log.info({ ...meta, dry_run: DRY_RUN }, 'POST-CALL — starting');

  // (a) ears
  const transcript = opt('transcript', null) || await transcribe(mp4);
  const segments = readSegments(transcript);
  log.info({ segments: segments.length }, 'transcript read');
  if (!segments.length) log.warn('the transcript is empty — Claude will correctly return empty arrays');

  // (b) the reading
  const x = await extract(segments, meta);
  log.info({
    promises: x.promises.length, requests: x.requests.length, decisions: x.decisions.length,
    open_questions: x.open_questions.length, clips: x.clips.length,
  }, 'extraction');

  // (c) the teasers, cut before the notes so the notes can name the files
  if (!NO_CLIPS) await cutClips(x.clips, mp4, meta);
  else log.info('--no-clips: nothing cut');

  // (d) the page, the json, the clips list
  const notesPath   = path.join(CALLS_DIR, `${date}-notes.md`);
  const actionsPath = path.join(CALLS_DIR, `${date}-actions.json`);
  const clipsPath   = path.join(CALLS_DIR, `${date}-clips.json`);
  fs.writeFileSync(notesPath, notesMarkdown(x, meta));
  fs.writeFileSync(actionsPath, JSON.stringify({ ...meta, transcript, extracted_at: new Date().toISOString(), ...x }, null, 2));
  fs.writeFileSync(clipsPath, JSON.stringify({
    date, event_id: meta.event_id, source: mp4,
    teaser_job: 'Show a Greenhouse member what the room is worth, then stop — the next move is the Garden upgrade and being in the room live.',
    clips: x.clips,
  }, null, 2));
  log.info({ notesPath, actionsPath, clipsPath }, 'written');

  // (e) the day card's share
  const ledger = appendActions(x, meta);

  // (f) the replay
  let uid = null;
  if (NO_UPLOAD) {
    log.warn({ dry_run: DRY_RUN }, 'not uploading (--no-upload or DRY_RUN=1) — the replay stays on this disk');
  } else if (meta.rehearsal) {
    log.warn('this was a rehearsal — not uploading it anywhere');
  } else {
    try { uid = await publishReplay(mp4, meta); }
    catch (err) { log.error({ err: err.message }, 'the replay did not go up — the mp4 and the notes are safe on disk'); }
  }

  if (side) {
    side.j.notes_written = true;
    side.j.notes = notesPath;
    side.j.actions = actionsPath;
    side.j.clips = clipsPath;
    side.j.clip_files = x.clips.filter(c => c.file).map(c => c.file);
    side.j.stream_uid = uid;
    fs.writeFileSync(side.p, JSON.stringify(side.j, null, 2));
  }

  log.info({
    notes: notesPath, open_items_added: ledger.added, clips_cut: x.clips.filter(c => c.file).length, stream_uid: uid,
  }, 'POST-CALL — done');
})().catch((err) => {
  log.error({ err: err.message, stack: err.stack }, 'post-call died');
  process.exit(1);
});
