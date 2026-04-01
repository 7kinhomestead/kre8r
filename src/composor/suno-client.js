/**
 * Suno Client — src/composor/suno-client.js
 *
 * Wraps the Suno API (via api.sunoapi.org — a Pro account API wrapper
 * for the Suno AI music generation service).
 *
 * API details:
 *   POST https://api.sunoapi.org/api/v1/generate
 *   Authorization: Bearer SUNO_API_KEY
 *   Each call generates 2 tracks. We submit one prompt per call and
 *   take the first result (highest quality pick from the pair).
 *
 * Graceful fallback:
 *   If SUNO_API_KEY is not set, or the API call fails, tracks are stored
 *   as prompt_ready with no audio — the UI shows the prompt with a
 *   "Copy & open Suno" link for manual generation.
 *
 * Downloads:
 *   MP3s saved to public/music/<project_id>/<scene_slug>/
 *   Filename: <scene_slug>_v<generation_index>.mp3
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const SUNO_BASE     = 'https://api.sunoapi.org/api/v1';
const SUNO_MODEL    = 'V5_5';
const POLL_INTERVAL = 15_000;  // 15 seconds between status checks
const POLL_TIMEOUT  = 300_000; // 5 minutes max wait per track

// ─────────────────────────────────────────────
// CHECK — is Suno configured?
// ─────────────────────────────────────────────

function isSunoConfigured() {
  return !!(process.env.SUNO_API_KEY);
}

// ─────────────────────────────────────────────
// SLUG — safe directory name from scene label
// ─────────────────────────────────────────────

function sceneSlug(label) {
  return (label || 'scene')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ─────────────────────────────────────────────
// ENSURE music output directory exists
// ─────────────────────────────────────────────

function ensureMusicDir(projectId, sceneLabel) {
  const dir = path.join(
    __dirname, '..', '..', 'public', 'music',
    String(projectId),
    sceneSlug(sceneLabel)
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────
// DOWNLOAD helper — follows redirects
// ─────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file     = fs.createWriteStream(destPath);

    function doGet(targetUrl) {
      protocol.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          // Follow redirect
          const redirectUrl = res.headers.location;
          const newProto    = redirectUrl.startsWith('https') ? https : http;
          const newFile     = fs.createWriteStream(destPath);
          newProto.get(redirectUrl, (res2) => {
            res2.pipe(newFile);
            newFile.on('finish', () => newFile.close(resolve));
            newFile.on('error', reject);
          }).on('error', reject);
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    doGet(url);
  });
}

// ─────────────────────────────────────────────
// GENERATE — submit prompt to Suno API
// Returns taskId
// ─────────────────────────────────────────────

async function submitGeneration(sunoPrompt) {
  const apiKey = process.env.SUNO_API_KEY;
  const { default: fetch } = await import('node-fetch');

  const body = {
    customMode:   false,
    instrumental: true,
    model:        SUNO_MODEL,
    prompt:       sunoPrompt.slice(0, 500)  // API hard limit in non-custom mode
  };

  const response = await fetch(`${SUNO_BASE}/generate`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `Suno API error ${response.status}: ${err?.msg || JSON.stringify(err)}`
    );
  }

  const data = await response.json();

  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`Suno API unexpected response: ${JSON.stringify(data)}`);
  }

  return data.data.taskId;
}

// ─────────────────────────────────────────────
// POLL — wait for Suno task to complete
// Returns array of track objects (usually 2)
// ─────────────────────────────────────────────

async function pollForCompletion(taskId, onProgress) {
  const apiKey = process.env.SUNO_API_KEY;
  const { default: fetch } = await import('node-fetch');

  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const response = await fetch(
      `${SUNO_BASE}/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Suno poll error ${response.status}: ${err?.msg || ''}`);
    }

    const data = await response.json();

    // API wraps the track array in data.data or similar
    const taskData = data.data || data;
    const status   = taskData.status || (Array.isArray(taskData) ? 'SUCCESS' : 'PENDING');

    onProgress?.({ stage: 'suno_poll', taskId, status });

    if (status === 'SUCCESS' || (Array.isArray(taskData) && taskData.length > 0)) {
      const tracks = Array.isArray(taskData) ? taskData : (taskData.tracks || taskData.songs || [taskData]);
      return tracks.filter(t => t && (t.audio_url || t.stream_audio_url));
    }

    if (status === 'FAILED') {
      throw new Error(`Suno generation failed for task ${taskId}`);
    }
    // PENDING or GENERATING — keep polling
  }

  throw new Error(`Suno generation timed out after ${POLL_TIMEOUT / 1000}s for task ${taskId}`);
}

// ─────────────────────────────────────────────
// GENERATE TRACK — full flow for one prompt
// Returns { taskId, track_url, track_path, duration }
// ─────────────────────────────────────────────

async function generateTrack({ sunoPrompt, projectId, sceneLabel, generationIndex, onProgress }) {
  if (!isSunoConfigured()) {
    return { ok: false, reason: 'no_api_key', suno_prompt: sunoPrompt };
  }

  if (!sunoPrompt) {
    return { ok: false, reason: 'no_prompt' };
  }

  try {
    onProgress?.({ stage: 'suno_submit', scene_label: sceneLabel, generation_index: generationIndex });

    const taskId = await submitGeneration(sunoPrompt);

    onProgress?.({ stage: 'suno_submitted', taskId, scene_label: sceneLabel });

    const tracks = await pollForCompletion(taskId, onProgress);

    if (!tracks.length) {
      throw new Error('Suno returned no tracks');
    }

    // Take the first track (highest quality from the pair)
    const track    = tracks[0];
    const audioUrl = track.audio_url || track.stream_audio_url;
    const duration = track.duration   || null;

    // Download to local disk
    const dir      = ensureMusicDir(projectId, sceneLabel);
    const slug     = sceneSlug(sceneLabel);
    const filename = `${slug}_v${generationIndex}.mp3`;
    const destPath = path.join(dir, filename);

    onProgress?.({ stage: 'suno_downloading', url: audioUrl, dest: filename });

    await downloadFile(audioUrl, destPath);

    // Relative URL for browser playback
    const publicPath = `/music/${projectId}/${sceneSlug(sceneLabel)}/${filename}`;

    onProgress?.({ stage: 'suno_downloaded', path: publicPath });

    return {
      ok:              true,
      suno_job_id:     taskId,
      suno_track_url:  audioUrl,
      suno_track_path: destPath,
      public_path:     publicPath,
      duration
    };

  } catch (err) {
    return { ok: false, reason: 'api_error', error: err.message };
  }
}

// ─────────────────────────────────────────────
// CHECK CREDITS (optional utility)
// ─────────────────────────────────────────────

async function checkCredits() {
  if (!isSunoConfigured()) return { ok: false, reason: 'no_api_key' };

  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(`${SUNO_BASE}/get-credits`, {
      headers: { 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` }
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const data = await response.json();
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { generateTrack, isSunoConfigured, checkCredits, sceneSlug, ensureMusicDir };
