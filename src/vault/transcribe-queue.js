/**
 * VaultΩr Auto-Transcription Queue — src/vault/transcribe-queue.js
 *
 * Background queue that automatically transcribes talking-head clips.
 * Triggered by the VaultΩr watcher when a proxy is classified as talking-head.
 * Also accepts manual enqueue from the vault route.
 *
 * Design:
 *   - One job at a time (Whisper is CPU/GPU bound, concurrency hurts not helps)
 *   - Jobs persist in memory only — server restart clears the queue (DB is the record)
 *   - SSE broadcast to any connected /api/vault/transcribe-queue/stream clients
 *   - Jobs that already have a transcript are rejected immediately (idempotent)
 *
 * Job shape:
 *   { id, footage_id, file_path, label, status, queued_at, started_at?, completed_at?, error? }
 *   status: 'pending' | 'processing' | 'done' | 'error'
 */

'use strict';

const EventEmitter = require('events');
const path         = require('path');
const db           = require('../db');
const { transcribeFile, TRANSCRIPTS_DIR } = require('./transcribe');
const logger       = require('../utils/logger');

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

let jobCounter = 0;

/** @type {Map<string, object>} jobId → job */
const jobs = new Map();

/** @type {string[]} ordered list of pending jobIds */
const pending = [];

let processing = false;  // true while a Whisper job is running

// Connected SSE response objects
/** @type {Set<import('express').Response>} */
const sseClients = new Set();

// ─────────────────────────────────────────────
// SSE BROADCAST
// ─────────────────────────────────────────────

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    if (!res.writableEnded) {
      res.write(payload);
    } else {
      sseClients.delete(res);
    }
  }
}

// ─────────────────────────────────────────────
// QUEUE STATUS
// ─────────────────────────────────────────────

function getQueueStatus() {
  const allJobs = Array.from(jobs.values()).sort((a, b) => a.queued_at - b.queued_at);
  return {
    processing,
    pending_count:  pending.length,
    total_jobs:     allJobs.length,
    active_job:     allJobs.find(j => j.status === 'processing') || null,
    recent:         allJobs.slice(-10).reverse()   // last 10 in reverse-chrono
  };
}

// ─────────────────────────────────────────────
// ENQUEUE
// Adds a footage item to the transcription queue.
// Skips if: already has transcript_path in DB, or already in queue.
// Returns { ok, job_id, reason? }
// ─────────────────────────────────────────────

function enqueue(footageId, filePath, label = null) {
  if (!footageId || !filePath) return { ok: false, reason: 'missing footage_id or file_path' };

  // Check DB — already transcribed?
  try {
    const record = db.getFootageById(footageId);
    if (record?.transcript_path) {
      return { ok: false, reason: 'already transcribed' };
    }
    // Use proxy_path if available (proxy is decodable by Whisper, raw BRAW is not)
    const transcribePath = record?.proxy_path || filePath;
    if (!transcribePath) return { ok: false, reason: 'no decodable file available' };
    filePath = transcribePath;
  } catch (e) {
    logger.warn({ err: e, footageId }, '[TranscribeQueue] DB check failed');
  }

  // Already in queue?
  for (const [, job] of jobs) {
    if (job.footage_id === footageId && (job.status === 'pending' || job.status === 'processing')) {
      return { ok: false, reason: 'already in queue', job_id: job.id };
    }
  }

  const jobId = `txq_${++jobCounter}_${footageId}`;
  const job = {
    id:           jobId,
    footage_id:   footageId,
    file_path:    filePath,
    label:        label || path.basename(filePath),
    status:       'pending',
    queued_at:    Date.now(),
    started_at:   null,
    completed_at: null,
    error:        null,
    progress:     []
  };
  jobs.set(jobId, job);
  pending.push(jobId);

  logger.info({ footageId, filePath: path.basename(filePath) }, '[TranscribeQueue] Enqueued');
  broadcast({ type: 'enqueued', job: _safeJob(job), queue: getQueueStatus() });

  // Kick off the processor (no-op if already running)
  setImmediate(processNext);

  return { ok: true, job_id: jobId };
}

// ─────────────────────────────────────────────
// PROCESS LOOP
// ─────────────────────────────────────────────

async function processNext() {
  if (processing || pending.length === 0) return;

  const jobId = pending.shift();
  const job   = jobs.get(jobId);
  if (!job) { processNext(); return; }   // stale ref

  processing = true;
  job.status     = 'processing';
  job.started_at = Date.now();
  job.progress   = [];

  logger.info({ jobId, footage_id: job.footage_id }, '[TranscribeQueue] Starting');
  broadcast({ type: 'started', job: _safeJob(job), queue: getQueueStatus() });

  try {
    const result = await transcribeFile(job.file_path, {
      footageId:  job.footage_id,
      onProgress: (evt) => {
        job.progress.push(evt);
        broadcast({ type: 'progress', job_id: jobId, footage_id: job.footage_id, event: evt });
      }
    });

    if (result.ok) {
      job.status       = 'done';
      job.completed_at = Date.now();
      job.segments     = result.segments?.length || 0;
      job.duration     = result.duration || null;
      logger.info({ jobId, footage_id: job.footage_id, segments: job.segments }, '[TranscribeQueue] Done');
      broadcast({ type: 'done', job: _safeJob(job), queue: getQueueStatus() });
    } else {
      job.status       = 'error';
      job.error        = result.error;
      job.completed_at = Date.now();
      logger.warn({ jobId, footage_id: job.footage_id, error: result.error }, '[TranscribeQueue] Failed');
      broadcast({ type: 'error', job: _safeJob(job), queue: getQueueStatus() });
    }
  } catch (err) {
    job.status       = 'error';
    job.error        = err.message;
    job.completed_at = Date.now();
    logger.error({ jobId, err }, '[TranscribeQueue] Unexpected error');
    broadcast({ type: 'error', job: _safeJob(job), queue: getQueueStatus() });
  } finally {
    processing = false;
    // Process next job after a short breath
    setTimeout(processNext, 500);
  }
}

// ─────────────────────────────────────────────
// SSE CONNECT / DISCONNECT
// ─────────────────────────────────────────────

function connectSse(res) {
  sseClients.add(res);
  // Send current status immediately on connect
  res.write(`data: ${JSON.stringify({ type: 'status', queue: getQueueStatus() })}\n\n`);

  res.on('close', () => {
    sseClients.delete(res);
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

// Strip the progress array from broadcast to keep payloads small
function _safeJob(job) {
  const { progress: _p, ...rest } = job;
  return rest;
}

module.exports = {
  enqueue,
  getQueueStatus,
  connectSse,
};
