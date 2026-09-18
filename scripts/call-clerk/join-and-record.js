#!/usr/bin/env node
'use strict';
/**
 * join-and-record.js — THE CALL CLERK, part one: sit in the room.
 *
 * The Rock Rich round table happens on Jitsi every Thursday at 4pm Pacific. Nobody
 * records it, so it evaporates: what Jason promised out loud on the call is gone by
 * Friday, and the Garden members who could not make it get nothing back.
 *
 * This is the clerk that sits in the corner. It joins the room as a silent,
 * camera-off, real-microphone-free participant named "Rock Rich Community
 * (recording)", tells OBS to record the window, watches the room empty out, and
 * stops. post-call.js does the listening afterwards.
 *
 *   node scripts/call-clerk/join-and-record.js                 # auto: ask the house
 *   node scripts/call-clerk/join-and-record.js --event 41      # one named call
 *   node scripts/call-clerk/join-and-record.js --room https://meet.jit.si/x --cap-min 1
 *
 *   --event <id>     record this occurrence, whatever the clock says
 *   --room <url>     a raw room, no house involved (rehearsal)
 *   --slug <name>    filename slug when --room is used
 *   --cap-min N      hard cap in minutes, overrides duration+45
 *   --min-rec-min N  refuse to stop on an empty room before this many minutes (10)
 *   --within N       auto: how far ahead to look for a call, hours (1)
 *   --lead-min N     auto: how early to walk in, minutes (2)
 *   --no-obs         join and watch, record nothing (plumbing test)
 *   --keep-open      leave the browser up at the end (debugging)
 *
 * WHY MKV: OBS can never finish an mp4 it was killed in the middle of — the moov
 * atom is written last. mkv survives a power cut with everything up to the cut. So
 * we record mkv and remux to mp4 only once the recording has actually stopped, and
 * the mkv is kept until the mp4 proves itself in ffprobe. Prime directive: never
 * lose the thing that cannot be re-shot.
 *
 * WHY WE NEVER SEND AUDIO: Chrome is launched with a FAKE capture device fed from a
 * silent wav, so even if every mute in Jitsi failed, the only thing this machine
 * could put into the room is silence. The room's audio comes back to us the other
 * way, through OBS's desktop-audio capture.
 *
 * env (kre8r/.env): HARVEST_API_URL, INTERNAL_API_KEY, OBS_WS_PASSWORD,
 *                   OBS_WS_PORT, OBS_PATH, CALLS_DIR
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn, execFile } = require('child_process');

const { OBSWebSocket } = require('obs-websocket-js');
const {
  args, flag, opt, log, CALLS_DIR, sleep, slugify, ffmpegPath, ffprobePath,
  harvestGet, isoLocalDate,
} = require('./lib');

// ── knobs ───────────────────────────────────────────────────────────────────────
const EVENT_ID    = opt('event', null);
const RAW_ROOM    = opt('room', null);
const RAW_SLUG    = opt('slug', 'rehearsal');
const CAP_MIN     = Number(opt('cap-min', 0)) || 0;
const WITHIN_H    = Number(opt('within', 1)) || 1;
const LEAD_MIN    = Number(opt('lead-min', 2)) || 2;
const NO_OBS      = flag('no-obs');
const KEEP_OPEN   = flag('keep-open');

const OBS_PATH    = process.env.OBS_PATH || 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';
const OBS_PORT    = Number(process.env.OBS_WS_PORT || 4455);
const OBS_PASS    = process.env.OBS_WS_PASSWORD || '';

const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'rr-call-clerk');
const SCENE_COLL  = 'Call Clerk';
const SCENE_NAME  = 'Call';
const WINDOW_SRC  = 'Call Window';
const AUDIO_SRC   = 'Call Desktop Audio';

// "Starts within 20 minutes" is the whole contract with the scheduler: the task
// fires at 15:50 every day and this is what makes six of those seven runs a no-op.
const JOIN_WINDOW_MS = 20 * 60 * 1000;
const POLL_MS        = 30 * 1000;
const EMPTY_STRIKES  = 3;
const HARD_CAP_PAD_M = 45;

// ── which call ──────────────────────────────────────────────────────────────────

/**
 * Decide what we are recording, or that we are not.
 * @returns {Promise<object|null>} null = nothing to do, exit 0 quietly.
 */
async function resolveCall() {
  if (RAW_ROOM) {
    return {
      id: null,
      title: `Rehearsal ${RAW_SLUG}`,
      slug: RAW_SLUG,
      join_url: RAW_ROOM,
      starts_at: new Date().toISOString(),
      duration_min: CAP_MIN || 60,
      min_tier: null,
      rehearsal: true,
    };
  }

  // A 404 here means the house does not have this door yet — the bridge half of the
  // Call Clerk ships on its own schedule and Fable deploys it. That is a "not today",
  // not a failure: the scheduled task runs every morning and must not spend the weeks
  // in between writing stack traces into the log.
  let res;
  try {
    res = await harvestGet(`/api/bridge/events/next?within=${EVENT_ID ? 72 : WITHIN_H}`);
  } catch (err) {
    if (/HTTP 404/.test(err.message)) {
      log.info('the house has no /api/bridge/events/next yet — standing down until it is deployed');
      return null;
    }
    throw err;
  }
  const ev = res && res.event;
  if (!ev) { log.info('no call on the books — nothing to do'); return null; }

  if (EVENT_ID && String(ev.id) !== String(EVENT_ID)) {
    log.warn({ asked: EVENT_ID, got: ev.id }, 'the next call is not the one asked for');
    return null;
  }
  if (!ev.join_url) { log.error({ event: ev.id }, 'that call has no room to walk into'); return null; }

  // starts_at is UTC in 'YYYY-MM-DD HH:MM:SS' shape — give it the Z it is missing
  // or every clock on this side reads it as Pacific and the clerk shows up an hour late.
  const startsMs = Date.parse(ev.starts_at.replace(' ', 'T') + (/[Zz+]/.test(ev.starts_at) ? '' : 'Z'));
  const until = startsMs - Date.now();

  if (!EVENT_ID && ev.status !== 'live' && until > JOIN_WINDOW_MS) {
    log.info(
      { event: ev.id, title: ev.title, starts_at: ev.starts_at, minutes_away: Math.round(until / 60000) },
      'next call is further out than the join window — standing down'
    );
    return null;
  }

  return { ...ev, startsMs, rehearsal: false };
}

// ── the silent microphone ───────────────────────────────────────────────────────

/**
 * A ten-second silent 48k mono WAV, written once into the profile dir. Chrome is
 * pointed at this instead of a real device, so the clerk physically cannot put a
 * sound into the room — belt to Jitsi's braces.
 */
function ensureSilenceWav() {
  const file = path.join(PROFILE_DIR, 'silence.wav');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const rate = 48000, seconds = 10, bytes = rate * seconds * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);    // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  fs.writeFileSync(file, Buffer.concat([header, Buffer.alloc(bytes)]));
  return file;
}

// ── the room ────────────────────────────────────────────────────────────────────

function roomUrl(base) {
  const cfg = [
    'config.prejoinConfig.enabled=false',
    'config.startWithAudioMuted=true',
    'config.startWithVideoMuted=true',
    'config.disableDeepLinking=true',
    'config.disableInviteFunctions=true',
    `userInfo.displayName=${encodeURIComponent('"Rock Rich Community (recording)"')}`,
  ].join('&');
  return `${String(base).split('#')[0]}#${cfg}`;
}

async function openRoom(url) {
  const { chromium } = require('playwright');
  const silence = ensureSilenceWav();

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    permissions: ['microphone', 'camera'],
    args: [
      '--use-fake-ui-for-media-stream',      // never ask for mic/camera
      '--use-fake-device-for-media-stream',  // never open the real ones
      `--use-file-for-fake-audio-capture=${silence}`,
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1280,860',
      '--window-position=40,40',
      '--disable-features=Translate,MediaRouter',
    ],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // The conference object appears a beat after the document does.
  await page.waitForFunction(
    () => !!(window.APP && window.APP.conference),
    { timeout: 90000 }
  ).catch(() => log.warn('APP.conference never appeared — falling back to tile counting'));

  await sleep(5000);
  await forceMute(page);
  log.info({ title: await page.title().catch(() => '?') }, 'in the room');
  return { context, page };
}

/**
 * Belt AND braces: Jitsi is asked to mute itself every way it has ever exposed.
 * Failures are swallowed on purpose — a version that does not have one of these
 * still has the fake silent device underneath.
 */
async function forceMute(page) {
  await page.evaluate(() => {
    const tries = [
      () => window.APP.conference.muteAudio(true),
      () => window.APP.conference.muteVideo(true),
      () => window.APP.conference.localAudio && window.APP.conference.localAudio.mute(),
      () => window.APP.conference.localVideo && window.APP.conference.localVideo.mute(),
    ];
    for (const t of tries) { try { t(); } catch (_) {} }
  }).catch(() => {});
}

/**
 * Is the room actually OPEN, or are we standing outside it?
 *
 * On public meet.jit.si the first person through the door has to be signed in — a
 * room nobody has opened yet holds everyone else on a "waiting for a moderator"
 * screen. That is not a fault and it is not the clerk's business to solve: Jason
 * opens the room from his phone before the call. The clerk is a guest, so it waits
 * at the door and goes home if nobody ever opens it.
 *
 * @returns {Promise<{waiting: boolean, joined: boolean}>}
 */
async function roomState(page) {
  try {
    return await page.evaluate(() => {
      const txt = (document.body.innerText || '').toLowerCase();
      const waiting =
        /waiting for (a |an |the )?(moderator|host)/.test(txt) ||
        /waiting for (the )?host to start/.test(txt) ||
        /asking to join/.test(txt) ||
        !!document.querySelector('[data-testid="lobby.joiningMessage"]');
      let joined = false;
      try {
        const c = window.APP && window.APP.conference;
        joined = !!(c && (typeof c.isJoined === 'function' ? c.isJoined() : c._room));
      } catch (_) {}
      return { waiting, joined };
    });
  } catch (_) {
    return { waiting: false, joined: false };
  }
}

/**
 * Stand at the door for up to fifteen minutes.
 *
 * NEVER clicks anything — not the log-in button, not "wait for moderator". Signing
 * this machine into an account is not a thing a recording clerk gets to decide, and
 * a stray click on a login wall is how a bot ends up holding credentials. It reads
 * the screen and waits, and that is all.
 *
 * @returns {Promise<boolean>} false = nobody ever opened the room
 */
async function waitForRoomToOpen(page, maxMin = 15) {
  const first = await roomState(page);
  if (!first.waiting) return true;

  log.info({ max_min: maxMin }, 'the room is not open yet — waiting at the door for the host');
  const deadline = Date.now() + maxMin * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(30 * 1000);
    const s = await roomState(page);
    if (!s.waiting) { log.info('the room opened — going in'); await sleep(4000); await forceMute(page); return true; }
    log.debug({ minutes_left: Math.round((deadline - Date.now()) / 60000) }, 'still waiting at the door');
  }
  return false;
}

/**
 * How many people are in the room, us included.
 * membersCount is the honest number when it is there; tiles are the fallback for a
 * Jitsi build that has moved the furniture again.
 * @returns {Promise<number>} -1 when the page cannot be read at all
 */
async function participantCount(page) {
  try {
    return await page.evaluate(() => {
      try {
        const c = window.APP && window.APP.conference;
        if (c && typeof c.membersCount === 'number' && c.membersCount > 0) return c.membersCount;
        if (c && typeof c.listMembers === 'function') return c.listMembers().length + 1;
      } catch (_) {}
      const tiles = document.querySelectorAll(
        '.videocontainer, [id^="participant_"], .filmstrip__videos .participant'
      );
      return tiles.length || 1;
    });
  } catch (err) {
    return -1;
  }
}

// ── OBS ─────────────────────────────────────────────────────────────────────────

function obsRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], (err, stdout) => {
      resolve(!err && /obs64\.exe/i.test(stdout || ''));
    });
  });
}

/** Start OBS minimised, once, only if it is not already up. Never kills it (see below). */
async function launchObsIfDown() {
  if (await obsRunning()) return false;
  log.info('OBS is not up — starting it minimised');
  // ONCE, and only once. OBS is never launched twice and is never killed: a
  // force-kill leaves it convinced it crashed, and the next launch stops dead on
  // a "Run in Safe Mode?" dialog that no script can answer — which is exactly
  // how the third rehearsal ended. --disable-shutdown-check is the flag that
  // keeps that dialog off the screen if it ever does go down hard.
  spawn(OBS_PATH, ['--minimize-to-tray', '--disable-updater', '--disable-shutdown-check'], {
    cwd: path.dirname(OBS_PATH),      // OBS refuses to start from anywhere else
    detached: true,
    stdio: 'ignore',
  }).unref();
  return true;
}

/**
 * The websocket answers BEFORE OBS has finished waking up, and every request in
 * that window fails with "OBS is not ready to perform the request". That is how
 * the first real Round Table (Sep 17 2026) lost its first 25 minutes: connected at
 * +4 s, asked for a scene, got "not ready", clocked out. So after connecting we
 * ask OBS a harmless question until it answers, up to two patient minutes.
 */
async function waitObsReady(obs) {
  for (let i = 0; i < 120; i++) {
    try { await obs.call('GetRecordStatus'); return; }
    catch (err) {
      if (!/not ready/i.test(err && err.message || '')) throw err;
      if (i === 0) log.info('OBS is still waking up — waiting for it');
      await sleep(1000);
    }
  }
  throw new Error('OBS answered the socket but never became ready');
}

async function connectObs() {
  const obs = new OBSWebSocket();
  const url = `ws://127.0.0.1:${OBS_PORT}`;
  // Five patient minutes. If OBS put a dialog on screen, Jason may be walking past
  // it — waiting is always right, relaunching never is.
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      await obs.connect(url, OBS_PASS || undefined);
      await waitObsReady(obs);
      return obs;
    } catch (err) {
      if (attempt === 0) await launchObsIfDown();
      await sleep(2000);
    }
  }
  throw new Error(`could not reach obs-websocket on ${url} — is the server enabled in OBS?`);
}

/** Swallow "already exists" (601) and friends; anything else is real. */
async function tryCall(obs, req, payload, what) {
  try { return await obs.call(req, payload); }
  catch (err) {
    const code = err && err.code;
    if (code === 601 || code === 600 || /already exist/i.test(err.message || '')) return null;
    log.warn({ req, code, err: err.message }, `obs: ${what} did not take`);
    return null;
  }
}

/**
 * Build (or find) the Call Clerk scene: the Chrome window plus whatever is coming
 * out of the speakers. Idempotent — after the first call this is all no-ops.
 */
async function ensureScene(obs, pageTitle) {
  const colls = await obs.call('GetSceneCollectionList');
  if (!colls.sceneCollections.includes(SCENE_COLL)) {
    await tryCall(obs, 'CreateSceneCollection', { sceneCollectionName: SCENE_COLL }, 'create collection');
    await sleep(3000);                    // OBS reloads everything on a collection switch
  } else if (colls.currentSceneCollectionName !== SCENE_COLL) {
    await obs.call('SetCurrentSceneCollection', { sceneCollectionName: SCENE_COLL });
    await sleep(3000);
  }

  await tryCall(obs, 'CreateScene', { sceneName: SCENE_NAME }, 'create scene');
  await obs.call('SetCurrentProgramScene', { sceneName: SCENE_NAME });

  // ── the window ────────────────────────────────────────────────────────────────
  const inputs = (await obs.call('GetInputList')).inputs || [];
  const haveWindow = inputs.some(i => i.inputName === WINDOW_SRC);
  if (!haveWindow) {
    await tryCall(obs, 'CreateInput', {
      sceneName: SCENE_NAME,
      inputName: WINDOW_SRC,
      inputKind: 'window_capture',
      inputSettings: { method: 2, cursor: false, client_area: true },  // 2 = Windows Graphics Capture
    }, 'create window capture');
  }
  await pointAtChrome(obs, pageTitle);

  // ── the sound ─────────────────────────────────────────────────────────────────
  // OBS mixes the PROFILE's global Desktop Audio into every recording, so a second
  // wasapi_output_capture of the same device would double the room. Only add one if
  // nothing is already listening to the speakers.
  const hasOutput = inputs.some(i => i.inputKind === 'wasapi_output_capture');
  if (!hasOutput) {
    await tryCall(obs, 'CreateInput', {
      sceneName: SCENE_NAME,
      inputName: AUDIO_SRC,
      inputKind: 'wasapi_output_capture',
      inputSettings: { device_id: 'default' },
    }, 'create desktop audio');
  }

  // Jason's room microphone is not part of this call and must never land in the
  // recording — the clerk is capturing what came OUT of the speakers.
  for (const i of inputs) {
    if (i.inputKind === 'wasapi_input_capture') {
      await tryCall(obs, 'SetInputMute', { inputName: i.inputName, inputMuted: true }, 'mute mic');
    }
  }
}

/** OBS's window strings escape '#' then ':' — see obs window-helpers encode_dstr. */
const obsEscape = (s) => String(s).replace(/#/g, '#22').replace(/:/g, '#3A');

/**
 * Tell the window-capture source which window to grab.
 *
 * The string is BUILT from the live page title rather than picked out of OBS's own
 * window list, and that is the whole lesson of the second rehearsal: the source
 * persists in the scene collection between runs, and OBS's property list comes back
 * holding LAST week's window. Matching against it silently re-aimed the capture at
 * a Chrome window that no longer existed and recorded sixty seconds of pure black —
 * a recording that looks fine in ffprobe (right duration, both streams) and is
 * worthless. Nothing about a black frame announces itself, so nothing here trusts a
 * cached list, and verifyCapture() looks at an actual frame before we commit.
 *
 * priority 0 = match on the title. A Chrome window's class is shared with every
 * other Chrome window on the machine and the executable is shared with all of them,
 * so falling back to either could point this at Jason's own browsing. Black is a
 * bad outcome; recording the wrong window is a worse one.
 */
async function pointAtChrome(obs, pageTitle) {
  const full = `${pageTitle} - Google Chrome`;
  const windowString = `${obsEscape(full)}:Chrome_WidgetWin_1:chrome.exe`;

  await obs.call('SetInputSettings', {
    inputName: WINDOW_SRC,
    inputSettings: { window: windowString, method: 2, priority: 0, cursor: false, client_area: true },
  });
  log.info({ window: full }, 'obs: aimed at the room');

  // Fill the canvas with it, whatever the canvas happens to be.
  try {
    const sceneItemId = (await obs.call('GetSceneItemId', { sceneName: SCENE_NAME, sourceName: WINDOW_SRC })).sceneItemId;
    await obs.call('SetSceneItemTransform', {
      sceneName: SCENE_NAME, sceneItemId,
      sceneItemTransform: { boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1920, boundsHeight: 1080, positionX: 0, positionY: 0 },
    });
  } catch (_) {}
}

/**
 * Look at one real frame before recording an hour of nothing.
 *
 * A window capture that has lost its window is not an error anywhere — OBS keeps
 * compositing, the encoder keeps running, ffprobe sees a healthy file. The only
 * thing that says so is the picture. So we take a small screenshot of the source
 * and ask whether anything in it varies; a frame where every channel is flat is
 * either black or a blank panel, and neither is the call.
 *
 * @returns {Promise<boolean>} false = the capture is blank (or unreadable)
 */
async function verifyCapture(obs) {
  let shot;
  try {
    shot = await obs.call('GetSourceScreenshot', {
      sourceName: WINDOW_SRC, imageFormat: 'png', imageWidth: 320, imageHeight: 200,
    });
  } catch (err) {
    log.warn({ err: err.message }, 'obs: could not screenshot the source — recording blind');
    return true;                       // do not refuse to record over a missing feature
  }
  try {
    const sharp = require('sharp');
    const b64 = String(shot.imageData || '').replace(/^data:image\/\w+;base64,/, '');
    const stats = await sharp(Buffer.from(b64, 'base64')).stats();
    const spread = Math.max(...stats.channels.map(c => c.max - c.min));
    log.info({ spread }, 'obs: looked at a frame');
    return spread > 12;                // a real page has text on it; black has nothing
  } catch (err) {
    log.warn({ err: err.message }, 'obs: could not read the frame — recording blind');
    return true;
  }
}

/**
 * Aim the recorder: mkv, into CALLS_DIR, under a name we chose.
 *
 * Every one of these settings is written to the PROFILE and only reliably read at
 * OBS's next launch — a running instance keeps serving the values it booted with.
 * So this is best-effort by design: it makes the next launch right, and finalize()
 * cleans up whatever this launch actually did. StopRecord's outputPath is truth,
 * never the settings we just wrote.
 */
async function armRecording(obs, baseName) {
  fs.mkdirSync(CALLS_DIR, { recursive: true });

  // FORWARD SLASHES, and this is not cosmetic. OBS stores these in an ini whose
  // writer treats a backslash as an escape character and does not double it on the
  // way out, so 'H:\edit-staging\CALLS' is written to basic.ini as
  // 'H:edit-stagingCALLS' — a path that does not exist, which OBS silently ignores
  // in favour of its default C:\Users\…\Videos. Nothing reports this; the setting
  // reads back correctly over the websocket for the rest of the session and only
  // the NEXT launch shows the damage. Windows takes forward slashes everywhere.
  const dir = CALLS_DIR.replace(/\\/g, '/');

  await tryCall(obs, 'SetRecordDirectory', { recordDirectory: dir }, 'set record dir');
  await tryCall(obs, 'SetProfileParameter',
    { parameterCategory: 'Output', parameterName: 'FilenameFormatting', parameterValue: baseName }, 'set filename');
  // Simple and Advanced output modes keep both of these under different keys and we
  // do not know which mode this profile is in, so both are set.
  for (const cat of ['SimpleOutput', 'AdvOut']) {
    await tryCall(obs, 'SetProfileParameter',
      { parameterCategory: cat, parameterName: 'RecFormat2', parameterValue: 'mkv' }, 'set mkv');
  }
  // This profile turned out to be Advanced → Custom FFmpeg Output (AdvOut/RecType
  // 'FFmpeg'), where the path and the container come from an entirely different pair
  // of keys — which is why the first rehearsal landed an mp4 in C:\Users\…\Videos
  // with every "correct" setting in place. All three destinations are set, so it
  // does not matter which mode the profile is in today or next month.
  for (const [cat, name] of [['AdvOut', 'RecFilePath'], ['SimpleOutput', 'FilePath'], ['AdvOut', 'FFFilePath']]) {
    await tryCall(obs, 'SetProfileParameter',
      { parameterCategory: cat, parameterName: name, parameterValue: dir }, 'set file path');
  }
  await tryCall(obs, 'SetProfileParameter',
    { parameterCategory: 'AdvOut', parameterName: 'FFExtension', parameterValue: 'mkv' }, 'set ffmpeg mkv');

  try {
    const live = (await obs.call('GetRecordDirectory')).recordDirectory;
    if (path.resolve(live) !== path.resolve(CALLS_DIR)) {
      log.warn({ obs_says: live, we_want: CALLS_DIR },
        'this OBS instance is still recording elsewhere — the file will be moved after StopRecord');
    }
  } catch (_) {}
}

// ── remux ───────────────────────────────────────────────────────────────────────

function run(bin, argv) {
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${path.basename(bin)}: ${(stderr || err.message).slice(0, 400)}`));
      resolve({ stdout, stderr });
    });
  });
}

async function probe(file) {
  const { stdout } = await run(ffprobePath(), [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const j = JSON.parse(stdout);
  return {
    duration_s: Math.round(Number(j.format && j.format.duration) || 0),
    video: (j.streams || []).filter(s => s.codec_type === 'video').length,
    audio: (j.streams || []).filter(s => s.codec_type === 'audio').length,
    size: Number(j.format && j.format.size) || 0,
  };
}

/**
 * Move a file onto H: if OBS put it somewhere else. rename() is instant inside a
 * volume and throws EXDEV across one, so the copy is the fallback rather than the
 * default — and the source is only unlinked once the copy is on disk.
 */
function relocate(file, dir, base) {
  const ext = path.extname(file);
  let want = path.join(dir, base + ext);
  if (path.resolve(file) === path.resolve(want)) return file;
  fs.mkdirSync(dir, { recursive: true });

  // Two calls with the same title on the same day would land on the same name, and
  // on Windows rename() onto an existing file throws rather than overwriting. Never
  // overwrite a recording to make room for another one — take the next number.
  for (let n = 2; fs.existsSync(want); n++) want = path.join(dir, `${base}-${n}${ext}`);

  try { fs.renameSync(file, want); }
  catch (_) { fs.copyFileSync(file, want); fs.unlinkSync(file); }
  log.info({ from: file, to: want }, 'moved the recording where it belongs');
  return want;
}

/**
 * Take whatever OBS actually produced and end up with a verified mp4 in CALLS_DIR.
 *
 * Two things refuse to be assumed here, both learned the hard way on the first
 * rehearsal: OBS ignores a record directory set over the websocket until its NEXT
 * launch (the profile ini takes it immediately, the running instance does not), and
 * the same is true of the container. So the file can land anywhere, in either
 * format, and this copes with all four combinations rather than guessing.
 *
 * mkv is remuxed and KEPT — it is the crash-proof master and nothing here deletes
 * it. An mp4 straight out of OBS is verified and used as-is.
 */
async function finalize(outputPath, base) {
  const landed = relocate(outputPath, CALLS_DIR, base);

  if (/\.mp4$/i.test(landed)) {
    const info = await probe(landed);
    if (!info.video || !info.audio || !info.duration_s) {
      throw new Error(`OBS wrote a bad mp4 (video=${info.video} audio=${info.audio} ${info.duration_s}s) at ${landed}`);
    }
    return { mkv: null, mp4: landed, ...info };
  }

  const mp4 = landed.replace(/\.mkv$/i, '.mp4');
  await run(ffmpegPath(), ['-y', '-i', landed, '-c', 'copy', '-movflags', '+faststart', mp4]);
  const info = await probe(mp4);
  if (!info.video || !info.audio || !info.duration_s) {
    throw new Error(`remux produced a bad mp4 (video=${info.video} audio=${info.audio} ${info.duration_s}s) — mkv kept at ${landed}`);
  }
  return { mkv: landed, mp4, ...info };
}

// ── main ────────────────────────────────────────────────────────────────────────

(async () => {
  const call = await resolveCall();
  if (!call) process.exit(0);

  const startsMs = call.startsMs || Date.parse(call.starts_at);
  const lead = startsMs - Date.now() - LEAD_MIN * 60 * 1000;
  if (lead > 0) {
    log.info({ minutes: Math.round(lead / 60000), title: call.title }, 'waiting to walk in');
    // Wake OBS NOW, while we wait, so it has the whole lead to finish starting
    // instead of the four seconds it got on Sep 17.
    if (!NO_OBS) await launchObsIfDown();
    await sleep(lead);
  }

  const date = isoLocalDate(new Date(Number.isFinite(startsMs) ? startsMs : Date.now()));
  const base = `${date}-${slugify(call.title || call.slug || 'call')}`;
  const capMin = CAP_MIN || (Number(call.duration_min || 60) + HARD_CAP_PAD_M);
  const minRecMs = Math.min(Number(opt('min-rec-min', 10)) || 10, capMin) * 60 * 1000;

  log.info({ event: call.id, title: call.title, base, cap_min: capMin }, 'CALL CLERK — clocking in');

  const { context, page } = await openRoom(roomUrl(call.join_url));

  // Nothing is armed and nothing is recorded until we are actually inside.
  if (!await waitForRoomToOpen(page, Number(opt('door-min', 15)) || 15)) {
    log.warn('nobody ever opened the room — going home with nothing, which is the right answer');
    await context.close().catch(() => {});
    fs.writeFileSync(path.join(CALLS_DIR, `${base}.json`), JSON.stringify({
      event_id: call.id, title: call.title, rehearsal: !!call.rehearsal,
      starts_at: call.starts_at, started_recording: null, stopped: new Date().toISOString(),
      reason: 'room_never_opened', mkv: null, mp4: null, duration_s: null,
      join_url: call.join_url, notes_written: true,   // there is nothing to write up
    }, null, 2));
    process.exit(0);
  }

  let obs = null, recStartedMs = null, reason = 'unknown';
  try {
    if (!NO_OBS) {
      obs = await connectObs();
      const pageTitle = await page.title().catch(() => 'Jitsi Meet');
      await ensureScene(obs, pageTitle);
      await armRecording(obs, base);

      // Look before recording. If the window capture came up blank, bring the
      // browser to the front (a minimised window has nothing to capture) and aim
      // again. If it is STILL blank we record anyway — an hour of black beats
      // refusing to record the only take of a live call — but the log says so in
      // capital letters so post-call knows to expect audio only.
      if (!await verifyCapture(obs)) {
        log.warn('capture came up blank — fronting the browser and re-aiming');
        await page.bringToFront().catch(() => {});
        await sleep(2000);
        await pointAtChrome(obs, await page.title().catch(() => pageTitle));
        await sleep(2000);
        if (!await verifyCapture(obs)) {
          log.error('THE WINDOW CAPTURE IS BLANK — recording anyway, but expect audio over black');
        } else {
          log.info('capture recovered');
        }
      }

      await obs.call('StartRecord');
      recStartedMs = Date.now();
      log.info('recording');
    } else {
      recStartedMs = Date.now();
      log.warn('--no-obs: watching the room, recording nothing');
    }

    // ── the watch ─────────────────────────────────────────────────────────────
    const hardStopMs = recStartedMs + capMin * 60 * 1000;
    let strikes = 0;
    for (;;) {
      await sleep(POLL_MS);
      const n = await participantCount(page);
      const recMs = Date.now() - recStartedMs;

      if (n <= 1 && n >= 0) strikes++;
      else if (n > 1) strikes = 0;

      if (n < 0) {
        log.error('the room page stopped answering — stopping');
        reason = 'page_lost';
        break;
      }
      if (strikes >= EMPTY_STRIKES && recMs >= minRecMs) {
        log.info({ minutes: Math.round(recMs / 60000) }, 'room is empty — stopping');
        reason = 'room_empty';
        break;
      }
      if (Date.now() >= hardStopMs) {
        log.info({ cap_min: capMin }, 'hard cap reached — stopping');
        reason = 'hard_cap';
        break;
      }
      log.debug({ in_room: n, strikes, minutes: Math.round(recMs / 60000) }, 'watching');
    }
  } catch (err) {
    reason = 'error';
    log.error({ err: err.message }, 'the watch broke');
  }

  // ── stop, and leave something behind either way ───────────────────────────────
  const stoppedIso = new Date().toISOString();
  let raw = null, mkv = null, mp4 = null, info = {};
  try {
    if (obs) {
      const out = await obs.call('StopRecord').catch(e => { log.error({ err: e.message }, 'StopRecord failed'); return null; });
      raw = (out && out.outputPath) || null;   // OBS's own answer is the only truth
      await sleep(3000);                       // let it finish writing the file
      await obs.disconnect().catch(() => {});
    }
  } catch (err) { log.error({ err: err.message }, 'stopping OBS'); }

  if (!KEEP_OPEN) { await context.close().catch(() => {}); }

  if (raw && fs.existsSync(raw)) {
    try {
      const r = await finalize(raw, base);
      mkv = r.mkv; mp4 = r.mp4; info = r;
      log.info({ mp4, mkv, duration_s: r.duration_s, video: r.video, audio: r.audio }, 'mp4 verified');
    } catch (err) {
      mkv = /\.mkv$/i.test(raw) ? raw : null;
      log.error({ err: err.message, raw }, 'could not finish the file — the recording itself is still on disk');
    }
  } else if (obs) {
    log.error({ raw }, 'OBS reported no output file');
  }

  const sidecar = {
    event_id: call.id,
    title: call.title,
    rehearsal: !!call.rehearsal,
    starts_at: call.starts_at,
    started_recording: new Date(recStartedMs || Date.now()).toISOString(),
    stopped: stoppedIso,
    reason,
    mkv,
    mp4,
    duration_s: info.duration_s || null,
    join_url: call.join_url,
    notes_written: false,
  };
  const sidecarPath = path.join(CALLS_DIR, `${base}.json`);
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
  log.info({ sidecar: sidecarPath, reason }, 'CALL CLERK — clocking out');

  process.exit(mp4 || NO_OBS ? 0 : 1);
})().catch((err) => {
  log.error({ err: err.message, stack: err.stack }, 'call clerk died');
  process.exit(1);
});
