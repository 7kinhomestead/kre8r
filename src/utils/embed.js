/**
 * Embedding adapter — src/utils/embed.js (VaultΩr 2.0 V2)
 *
 * Text embeddings via a tiny CPU llama-server (nomic-embed-text-v1.5, 768-dim).
 * Runs on port 8081 with -ngl 0 — never touches the GPU, so it coexists with
 * the Farmhand, Resolve, and everything else forever.
 *
 * nomic requires task prefixes: 'search_document: ' for stored text,
 * 'search_query: ' for queries. embedText handles that.
 */

const { spawn } = require('child_process');
const logger = require('./logger');

const EMBED_BASE_URL = process.env.EMBED_BASE_URL || 'http://127.0.0.1:8081';
const EMBED_SERVER_EXE = process.env.VLM_SERVER_EXE || 'H:\\ai-models\\llama\\llama-server.exe';
const EMBED_MODEL = process.env.EMBED_MODEL_PATH ||
  'H:\\ai-models\\nomic-embed-text-v1.5.Q8_0.gguf';
const DIMS = 768;

let serverChild = null;

async function isUp() {
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(`${EMBED_BASE_URL}/health`, { timeout: 3000 });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function ensureServer() {
  if (await isUp()) return { ok: true, reason: 'already up' };
  logger.info({ model: EMBED_MODEL }, '[embed] starting embedding server (CPU)');
  serverChild = spawn(EMBED_SERVER_EXE, [
    '-m', EMBED_MODEL, '--embedding',
    '--port', new URL(EMBED_BASE_URL).port || '8081',
    '-ngl', '0', '-c', '2048',
  ], { stdio: 'ignore', detached: false });
  serverChild.on('exit', () => { serverChild = null; });

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await isUp()) return { ok: true, reason: 'started' };
    await new Promise(r => setTimeout(r, 1500));
  }
  return { ok: false, reason: 'embedding server did not become healthy in 60s' };
}

function stopServer() {
  if (serverChild) {
    try { serverChild.kill(); } catch (_) {}
    serverChild = null;
    return true;
  }
  return false;
}

/**
 * embedText(text, kind) → Buffer (float32, 768 dims) ready for sqlite-vec,
 * or null on failure. kind: 'document' (stored text) | 'query' (search input).
 */
async function embedText(text, kind = 'document') {
  const { default: fetch } = await import('node-fetch');
  const prefix = kind === 'query' ? 'search_query: ' : 'search_document: ';
  try {
    const r = await fetch(`${EMBED_BASE_URL}/v1/embeddings`, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ input: prefix + String(text).slice(0, 2000), model: 'local' }),
      timeout : 30000,
    });
    if (!r.ok) throw new Error(`embed http ${r.status}`);
    const data = await r.json();
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== DIMS) {
      throw new Error(`bad embedding shape (${vec ? vec.length : 'none'})`);
    }
    return Buffer.from(new Float32Array(vec).buffer);
  } catch (err) {
    logger.warn({ err: err.message }, '[embed] embedText failed');
    return null;
  }
}

module.exports = { embedText, ensureServer, stopServer, isUp, DIMS };
