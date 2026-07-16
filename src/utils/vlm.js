/**
 * The Farmhand adapter — src/utils/vlm.js
 *
 * Local vision-model caller beside src/utils/claude.js. Talks to llama-server's
 * OpenAI-compatible endpoint. Everything learned in the July 2026 benchmark nights
 * is baked in:
 *   - retry-on-empty budget ladder (Qwen3 thinking-mode eats budgets → empty content)
 *   - /no_think appended to prompts
 *   - two tiers: 'triage' (1.3B, runs beside Resolve) and 'quality' (8B, needs the card)
 *   - VLM_BASE_URL env makes local / laptop / cloud endpoints interchangeable
 *   - VRAM-checked server lifecycle: knows when Resolve owns the card
 *
 * describeFrames(framesJpegBase64, prompt, opts) → { text, retries } (text '' = gave up)
 */

const { spawn, execFile } = require('child_process');
const logger = require('./logger');

const BASE_URL   = process.env.VLM_BASE_URL   || 'http://127.0.0.1:8080';
// Models live on C: NVMe (moved off the T7 Jul 16 2026 so the T7 can shuttle)
const SERVER_EXE = process.env.VLM_SERVER_EXE || 'C:\\ai-models\\llama\\llama-server.exe';
const MODELS_DIR = process.env.VLM_MODELS_DIR || 'C:\\ai-models';

// Budget ladder for retry-on-empty (thinking-leak mitigation, ~96-98% hit rate)
const BUDGET_LADDER = [500, 1000];

const TIERS = {
  triage: {
    model      : `${MODELS_DIR}\\MiniCPM-V-4_6-Q4_K_M.gguf`,
    mmproj     : `${MODELS_DIR}\\mmproj-4_6-f16.gguf`,
    modelName  : 'minicpm-v-4.6-q4',
    vramNeedMb : 2500,   // fits beside an open Resolve session
  },
  quality: {
    model      : `${MODELS_DIR}\\MiniCPM-V-4_5-Q4_K_M.gguf`,
    mmproj     : `${MODELS_DIR}\\mmproj-4_5-f16.gguf`,
    modelName  : 'minicpm-v-4.5-q4',
    vramNeedMb : 6500,   // wants the card to itself
  },
};

let serverChild = null;
let serverTier  = null;

async function isUp() {
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(`${BASE_URL}/health`, { timeout: 3000 });
    return r.ok;
  } catch (_) {
    return false;
  }
}

/** Free VRAM in MB via nvidia-smi, or null if unknowable. */
function freeVramMb() {
  return new Promise(resolve => {
    execFile('nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const [used, total] = stdout.trim().split('\n')[0].split(',').map(s => parseInt(s, 10));
          resolve(total - used);
        } catch (_) { resolve(null); }
      });
  });
}

/**
 * Ensure a llama-server is running for the requested tier.
 * Returns { ok, tier, reason }. If VRAM is too tight for 'quality', falls back
 * to 'triage' automatically (never silently fails to CPU — the torch lesson).
 */
async function ensureServer(tier = 'triage') {
  if (await isUp()) {
    return { ok: true, tier: serverTier || 'external', reason: 'already up' };
  }
  let want = TIERS[tier] ? tier : 'triage';
  const free = await freeVramMb();
  if (free !== null && free < TIERS[want].vramNeedMb) {
    if (want === 'quality' && free >= TIERS.triage.vramNeedMb) {
      logger.warn({ free, wanted: want }, '[vlm] VRAM tight — falling back to triage tier');
      want = 'triage';
    } else {
      return { ok: false, tier: null, reason: `insufficient VRAM (${free}MB free)` };
    }
  }
  const cfg = TIERS[want];
  logger.info({ tier: want, model: cfg.model }, '[vlm] starting llama-server');
  serverChild = spawn(SERVER_EXE, [
    '-m', cfg.model, '--mmproj', cfg.mmproj,
    '-ngl', '99', '--port', new URL(BASE_URL).port || '8080',
    '-c', '8192', '--jinja',
    // Kill Qwen3 thinking at the template level — instruction-heavy prompts
    // otherwise burn the whole token budget "reasoning" and return empty
    // content (finish_reason: length). Verified fix Jul 15 2026.
    '--chat-template-kwargs', '{"enable_thinking":false}',
  ], { stdio: 'ignore', detached: false });
  serverChild.on('exit', code => {
    logger.info({ code }, '[vlm] llama-server exited');
    serverChild = null;
    serverTier  = null;
  });
  serverTier = want;

  // wait for health (model load: ~10s triage, ~40s quality)
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await isUp()) return { ok: true, tier: want, reason: 'started' };
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, tier: null, reason: 'server did not become healthy in 120s' };
}

function stopServer() {
  if (serverChild) {
    try { serverChild.kill(); } catch (_) {}
    serverChild = null;
    serverTier  = null;
    return true;
  }
  return false;
}

function currentTier() {
  return serverTier;
}

/**
 * describeFrames(frames, prompt, opts)
 *   frames : array of base64 JPEG strings (no data: prefix needed — added here)
 *   prompt : instruction text (/no_think appended automatically)
 *   opts   : { tier } — recorded in the result, not enforced here
 * Returns { text, retries, model } — text === '' means all budgets exhausted.
 */
async function describeFrames(frames, prompt, opts = {}) {
  const { default: fetch } = await import('node-fetch');
  const content = frames.map(b64 => ({
    type: 'image_url',
    image_url: { url: b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}` },
  }));
  content.push({ type: 'text', text: `${prompt} /no_think` });

  let retries = 0;
  for (const budget of BUDGET_LADDER) {
    try {
      const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({
          model: 'local', temperature: 0.2, max_tokens: budget,
          messages: [{ role: 'user', content }],
        }),
        timeout : 300000,
      });
      if (!r.ok) throw new Error(`vlm http ${r.status}`);
      const data = await r.json();
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (text) {
        return { text, retries, model: TIERS[serverTier]?.modelName || opts.tier || 'external' };
      }
      retries++;
    } catch (err) {
      logger.warn({ err: err.message, budget }, '[vlm] describe attempt failed');
      retries++;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return { text: '', retries, model: TIERS[serverTier]?.modelName || 'unknown' };
}

/**
 * askText(prompt, opts) — text-only call to the local model (no images).
 * Same retry-on-empty ladder. Returns { text, retries }.
 */
async function askText(prompt, opts = {}) {
  const { default: fetch } = await import('node-fetch');
  let retries = 0;
  for (const budget of (opts.budgets || BUDGET_LADDER)) {
    try {
      const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({
          model: 'local', temperature: 0.2, max_tokens: budget,
          messages: [{ role: 'user', content: `${prompt} /no_think` }],
        }),
        timeout : 120000,
      });
      if (!r.ok) throw new Error(`vlm http ${r.status}`);
      const data = await r.json();
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (text) return { text, retries };
      retries++;
    } catch (err) {
      logger.warn({ err: err.message, budget }, '[vlm] askText attempt failed');
      retries++;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return { text: '', retries };
}

module.exports = { describeFrames, askText, ensureServer, stopServer, isUp, currentTier, freeVramMb, TIERS };
