/**
 * Suno Client — src/composor/suno-client.js
 *
 * Supports two API providers for Suno music generation:
 *
 *   1. kie.ai    — set KIE_API_KEY  in .env  → https://api.kie.ai/api/v1
 *   2. sunoapi.org — set SUNO_API_KEY in .env → https://api.sunoapi.org/api/v1
 *
 * Priority: KIE_API_KEY > SUNO_API_KEY > fallback (prompt-only / Playwright)
 *
 * Both providers share the same endpoint paths (/generate, /generate/record-info)
 * and Bearer auth. Key differences handled here:
 *
 *   kie.ai      poll response: data.response.sunoData[].audioUrl   (camelCase)
 *   sunoapi.org poll response: data.tracks[].audio_url             (snake_case)
 *
 * Downloads:
 *   MP3s saved to public/music/<project_id>/<scene_slug>/
 *   Filename: <scene_slug>_v<generation_index>.mp3
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const SUNO_MODEL    = 'V5_5';
const POLL_INTERVAL = 15_000;   // 15 seconds between status checks
const POLL_TIMEOUT  = 300_000;  // 5 minutes max wait per track

// ─── Provider config ──────────────────────────────────────────────────────────

function getProvider() {
  if (process.env.KIE_API_KEY) {
    return {
      name:    'kie.ai',
      baseUrl: 'https://api.kie.ai/api/v1',
      apiKey:  process.env.KIE_API_KEY,
    };
  }
  if (process.env.SUNO_API_KEY) {
    return {
      name:    'sunoapi.org',
      baseUrl: 'https://api.sunoapi.org/api/v1',
      apiKey:  process.env.SUNO_API_KEY,
    };
  }
  return null;
}

// ─── CHECK — is any provider configured? ─────────────────────────────────────

function isSunoConfigured() {
  return getProvider() !== null;
}

// ─── SLUG — safe directory name from scene label ──────────────────────────────

function sceneSlug(label) {
  return (label || 'scene')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ─── ENSURE music output directory exists ────────────────────────────────────

function ensureMusicDir(projectId, sceneLabel) {
  const dir = path.join(
    __dirname, '..', '..', 'public', 'music',
    String(projectId),
    sceneSlug(sceneLabel)
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── DOWNLOAD helper — follows redirects ─────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    function doGet(targetUrl) {
      const proto = targetUrl.startsWith('https') ? https : http;
      proto.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
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

// ─── GENERATE — submit prompt to provider ────────────────────────────────────

async function submitGeneration(sunoPrompt) {
  const provider = getProvider();
  const { default: fetch } = await import('node-fetch');

  const body = {
    customMode:   false,
    instrumental: true,
    model:        SUNO_MODEL,
    prompt:       sunoPrompt.slice(0, 500),
    // kie.ai requires callBackUrl to be present (422 without it).
    // We still poll for results — the callback is a bonus notification.
    callBackUrl:  'http://localhost:3000/api/composor/kie-callback',
  };

  console.log(`[suno-client] Submitting to ${provider.name} (${provider.baseUrl})`);

  const response = await fetch(`${provider.baseUrl}/generate`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `${provider.name} API error ${response.status}: ${err?.msg || JSON.stringify(err)}`
    );
  }

  const data = await response.json();

  if (data.code === 402 || data.code === 429) {
    // Throw silently — caller logs once and stamps DB; no repeated noise in pm2 logs
    const err = new Error(`${provider.name} credits exhausted (code ${data.code})`);
    err.noCredits   = true;
    err.creditCode  = data.code;
    throw err;
  }

  if (data.code !== 200 || !data.data?.taskId) {
    console.error(`[suno-client] ✗ ${provider.name} bad response: ${JSON.stringify(data)}`);
    throw new Error(`${provider.name} unexpected response: ${JSON.stringify(data)}`);
  }

  console.log(`[suno-client] Task submitted — taskId: ${data.data.taskId}`);
  return data.data.taskId;
}

// ─── POLL — wait for task to complete ────────────────────────────────────────
// Handles different response shapes per provider:
//   kie.ai      → data.response.sunoData[].audioUrl   (camelCase)
//   sunoapi.org → data.tracks[].audio_url             (snake_case)

async function pollForCompletion(taskId, onProgress) {
  const provider = getProvider();
  const { default: fetch } = await import('node-fetch');
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const response = await fetch(
      `${provider.baseUrl}/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: { 'Authorization': `Bearer ${provider.apiKey}` } }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`${provider.name} poll error ${response.status}: ${err?.msg || ''}`);
    }

    const data     = await response.json();
    const taskData = data.data || data;
    const status   = taskData.status || 'PENDING';

    console.log(`[suno-client] Poll ${provider.name} — status: ${status}`);
    onProgress?.({ stage: 'suno_poll', taskId, status, provider: provider.name });

    // Failed states
    if (['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR', 'FAILED'].includes(status)) {
      throw new Error(`${provider.name} generation failed for task ${taskId} — status: ${status}`);
    }

    // Success — extract tracks from provider-specific response shape
    if (status === 'SUCCESS' || status === 'FIRST_SUCCESS') {
      let tracks = [];

      if (provider.name === 'kie.ai') {
        // kie.ai: data.response.sunoData[].audioUrl (camelCase)
        tracks = taskData.response?.sunoData || [];
        tracks = tracks
          .filter(t => t && (t.audioUrl || t.streamAudioUrl))
          .map(t => ({
            audio_url:        t.audioUrl || t.streamAudioUrl,
            stream_audio_url: t.streamAudioUrl,
            duration:         t.duration || null,
          }));
      } else {
        // sunoapi.org: data.tracks[].audio_url or data.songs[].audio_url (snake_case)
        const raw = Array.isArray(taskData)
          ? taskData
          : (taskData.tracks || taskData.songs || []);
        tracks = raw.filter(t => t && (t.audio_url || t.stream_audio_url));
      }

      if (tracks.length > 0) {
        console.log(`[suno-client] ${provider.name} — ${tracks.length} track(s) ready`);
        return tracks;
      }

      // SUCCESS status but no tracks yet — keep polling (FIRST_SUCCESS case)
      if (status === 'FIRST_SUCCESS') {
        console.log('[suno-client] FIRST_SUCCESS — waiting for all tracks...');
        continue;
      }
    }

    // PENDING / TEXT_SUCCESS / GENERATING — keep polling
  }

  throw new Error(`Suno generation timed out after ${POLL_TIMEOUT / 1000}s for task ${taskId}`);
}

// ─── GENERATE TRACK — full flow for one prompt ───────────────────────────────

async function generateTrack({ sunoPrompt, projectId, sceneLabel, generationIndex, onProgress }) {
  const provider = getProvider();

  if (!provider) {
    return { ok: false, reason: 'no_api_key', suno_prompt: sunoPrompt };
  }

  if (!sunoPrompt) {
    return { ok: false, reason: 'no_prompt' };
  }

  try {
    onProgress?.({
      stage:            'suno_submit',
      provider:         provider.name,
      scene_label:      sceneLabel,
      generation_index: generationIndex,
    });

    const taskId = await submitGeneration(sunoPrompt);

    onProgress?.({ stage: 'suno_submitted', taskId, provider: provider.name, scene_label: sceneLabel });

    const tracks = await pollForCompletion(taskId, onProgress);

    if (!tracks.length) {
      throw new Error('Provider returned no tracks');
    }

    // Take the first track
    const track    = tracks[0];
    const audioUrl = track.audio_url || track.stream_audio_url;
    const duration = track.duration  || null;

    // Download to local disk
    const dir      = ensureMusicDir(projectId, sceneLabel);
    const slug     = sceneSlug(sceneLabel);
    const filename = `${slug}_v${generationIndex}.mp3`;
    const destPath = path.join(dir, filename);

    onProgress?.({ stage: 'suno_downloading', url: audioUrl, dest: filename });

    await downloadFile(audioUrl, destPath);

    const publicPath = `/music/${projectId}/${sceneSlug(sceneLabel)}/${filename}`;

    onProgress?.({ stage: 'suno_downloaded', path: publicPath, provider: provider.name });

    return {
      ok:              true,
      provider:        provider.name,
      suno_job_id:     taskId,
      suno_track_url:  audioUrl,
      suno_track_path: destPath,
      public_path:     publicPath,
      duration,
    };

  } catch (err) {
    if (err.noCredits) {
      // Single-line, no stack — the composor route logs the summary once per queue
      console.log(`[suno-client] no credits (${err.creditCode || '402'}) — returning prompt for manual generation`);
      return { ok: false, reason: 'no_credits', creditCode: err.creditCode, suno_prompt: sunoPrompt, provider: provider?.name };
    }
    console.error(`[suno-client] ✗ generateTrack failed (${provider?.name}): ${err.message}`);
    return { ok: false, reason: 'api_error', error: err.message, provider: provider?.name };
  }
}

// ─── CHECK CREDITS ───────────────────────────────────────────────────────────

async function checkCredits() {
  const provider = getProvider();
  if (!provider) return { ok: false, reason: 'no_api_key' };

  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(`${provider.baseUrl}/get-credits`, {
      headers: { 'Authorization': `Bearer ${provider.apiKey}` }
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const data = await response.json();
    return { ok: true, provider: provider.name, ...data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { generateTrack, isSunoConfigured, checkCredits, sceneSlug, ensureMusicDir };
