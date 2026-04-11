'use strict';
/**
 * sse.js — shared SSE stream helpers
 *
 * Usage (job-based pattern):
 *   const { attachSseStream } = require('../utils/sse');
 *   attachSseStream(job, req, res);
 *
 * Usage (inline pattern):
 *   const { startSseResponse } = require('../utils/sse');
 *   const { send, end } = startSseResponse(res, { timeoutMs: 5 * 60 * 1000 });
 */

const HEARTBEAT_MS = 20_000;   // SSE keepalive comment every 20 s
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes hard ceiling

/**
 * startSseResponse — sets SSE headers, starts keepalive and optional timeout.
 * Returns { send(data), end() }.
 *
 * @param {import('express').Response} res
 * @param {{ timeoutMs?: number }} [opts]
 */
function startSseResponse(res, opts = {}) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, HEARTBEAT_MS);

  const timeout = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Operation timed out' })}\n\n`);
      cleanup();
    }
  }, timeoutMs);

  function cleanup() {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    if (!res.writableEnded) res.end();
  }

  return {
    send(data) {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end() { cleanup(); }
  };
}

/**
 * attachSseStream — attaches an SSE stream to an existing job object.
 * Job must have: { status, events[], emitter } (same shape as editor.js / writr.js jobs).
 *
 * @param {object} job
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ timeoutMs?: number }} [opts]
 */
function attachSseStream(job, req, res, opts = {}) {
  const { send, end } = startSseResponse(res, opts);

  // Replay buffered events
  for (const ev of job.events) send(ev);

  if (job.status !== 'running') { end(); return; }

  const onEvent = (data) => send(data);
  const onDone  = () => end();

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);

  req.on('close', () => {
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
    // Don't force-end res on client disconnect — job may still be running
  });
}

module.exports = { startSseResponse, attachSseStream, HEARTBEAT_MS, DEFAULT_TIMEOUT_MS };
