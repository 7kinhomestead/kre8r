/**
 * PostΩr — TikTok Platform Module
 *
 * Implements TikTok Login Kit (OAuth 2.0 + PKCE) and
 * Content Posting API (FILE_UPLOAD method).
 *
 * Env vars required:
 *   TIKTOK_CLIENT_KEY
 *   TIKTOK_CLIENT_SECRET
 *
 * Redirect URI registered in TikTok Developer Portal (Web tab):
 *   https://kre8r.app/api/postor/auth/tiktok/callback
 *   http://localhost:3000/api/postor/auth/tiktok/callback  (local dev)
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const db     = require('../db');

const TIKTOK_AUTH_URL   = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL  = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_API_BASE   = 'https://open.tiktokapis.com/v2';

const SCOPES = 'user.info.basic,video.publish,video.upload';

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generatePkce() {
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── Auth URL ────────────────────────────────────────────────────────────────

function getCallbackUrl(req) {
  const host = req.get('host') || 'localhost:3000';
  return `${req.protocol}://${host}/api/postor/auth/tiktok/callback`;
}

function getAuthUrl(req, state, codeChallenge) {
  if (!process.env.TIKTOK_CLIENT_KEY) {
    throw new Error('TIKTOK_CLIENT_KEY is not set in your .env file');
  }
  const params = new URLSearchParams({
    client_key:            process.env.TIKTOK_CLIENT_KEY,
    redirect_uri:          getCallbackUrl(req),
    response_type:         'code',
    scope:                 SCOPES,
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${TIKTOK_AUTH_URL}?${params}`;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCode(code, codeVerifier, req) {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  getCallbackUrl(req),
      code_verifier: codeVerifier,
    }),
  });
  return res.json();
}

async function refreshAccessToken(connection) {
  if (!connection.refresh_token) throw new Error('No refresh token — reconnect TikTok');
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: connection.refresh_token,
    }),
  });
  return res.json();
}

async function getValidToken() {
  const conn = db.getPostorConnection('tiktok');
  if (!conn) throw new Error('TikTok not connected — go to PostΩr and connect your account');

  const now = Date.now();
  if (conn.token_expires_at && now >= conn.token_expires_at - 60_000) {
    // Token expired or about to — refresh it
    const refreshed = await refreshAccessToken(conn);
    if (refreshed.error) throw new Error(`TikTok token refresh failed: ${refreshed.error_description || refreshed.error}`);
    const newExpiry = refreshed.expires_in ? now + refreshed.expires_in * 1000 : null;
    db.upsertPostorConnection('tiktok', {
      access_token:     refreshed.access_token,
      refresh_token:    refreshed.refresh_token || conn.refresh_token,
      token_expires_at: newExpiry,
      account_id:       conn.account_id,
      account_name:     conn.account_name,
    });
    return refreshed.access_token;
  }

  return conn.access_token;
}

// ─── Creator Info ─────────────────────────────────────────────────────────────
// Returns the creator's allowed privacy levels and interaction settings.
// Call this before showing the post form so the UI can populate the privacy dropdown.

async function getCreatorInfo() {
  const token = await getValidToken();
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/creator_info/query/`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json; charset=UTF-8',
    },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (data.error?.code && data.error.code !== 'ok') {
    throw new Error(`TikTok creator info error: ${data.error.message || data.error.code}`);
  }
  return data.data;
}

// ─── Video Upload ─────────────────────────────────────────────────────────────

/**
 * Upload a video to TikTok using the Content Posting API.
 *
 * @param {object} opts
 * @param {string}   opts.videoPath          — absolute path to .mp4 file
 * @param {string}   opts.title              — post caption / title
 * @param {string}   [opts.privacyLevel]     — PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR | SELF_ONLY
 * @param {boolean}  [opts.disableDuet]
 * @param {boolean}  [opts.disableComment]
 * @param {boolean}  [opts.disableStitch]
 * @param {boolean}  [opts.brandContentToggle]   — paid partnership / sponsored content
 * @param {boolean}  [opts.brandOrganicToggle]   — organic brand content
 * @param {Function} [opts.onProgress]       — callback({ stage, message })
 */
async function uploadVideo({
  videoPath,
  title,
  privacyLevel       = 'PUBLIC_TO_EVERYONE',
  disableDuet        = false,
  disableComment     = false,
  disableStitch      = false,
  brandContentToggle = false,
  brandOrganicToggle = false,
  onProgress         = () => {},
}) {
  const token = await getValidToken();

  // ── 1. Stat the file ────────────────────────────────────────────────────────
  const stat      = fs.statSync(videoPath);
  const videoSize = stat.size;

  // TikTok recommends chunk size between 5MB and 64MB.
  // For files ≤ 64MB we send as a single chunk; larger files use 64MB chunks.
  const CHUNK_SIZE      = 64 * 1024 * 1024; // 64 MB
  const totalChunkCount = Math.ceil(videoSize / CHUNK_SIZE);

  onProgress({ stage: 'tiktok_init', platform: 'tiktok', message: `Initialising upload (${(videoSize / 1024 / 1024).toFixed(1)} MB, ${totalChunkCount} chunk${totalChunkCount > 1 ? 's' : ''})` });

  // ── 2. Init the post ─────────────────────────────────────────────────────────
  const initRes = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title:                    title.slice(0, 2200), // TikTok caption limit
        privacy_level:            privacyLevel,
        disable_duet:             disableDuet,
        disable_comment:          disableComment,
        disable_stitch:           disableStitch,
        brand_content_toggle:     brandContentToggle,
        brand_organic_toggle:     brandOrganicToggle,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source:            'FILE_UPLOAD',
        video_size:        videoSize,
        chunk_size:        Math.min(CHUNK_SIZE, videoSize),
        total_chunk_count: totalChunkCount,
      },
    }),
  });

  const initData = await initRes.json();
  if (initData.error?.code && initData.error.code !== 'ok') {
    throw new Error(`TikTok init failed: ${initData.error.message || initData.error.code}`);
  }

  const { publish_id, upload_url } = initData.data;
  onProgress({ stage: 'tiktok_upload', platform: 'tiktok', message: 'Uploading video…', publish_id });

  // ── 3. Upload chunks ─────────────────────────────────────────────────────────
  const fd = fs.openSync(videoPath, 'r');
  try {
    for (let i = 0; i < totalChunkCount; i++) {
      const start     = i * CHUNK_SIZE;
      const end       = Math.min(start + CHUNK_SIZE, videoSize) - 1;
      const chunkLen  = end - start + 1;
      const buf       = Buffer.alloc(chunkLen);
      fs.readSync(fd, buf, 0, chunkLen, start);

      const uploadRes = await fetch(upload_url, {
        method:  'PUT',
        headers: {
          'Content-Type':   'video/mp4',
          'Content-Range':  `bytes ${start}-${end}/${videoSize}`,
          'Content-Length': String(chunkLen),
        },
        body: buf,
        // duplex required for Node 18+ fetch with body
        duplex: 'half',
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => '');
        throw new Error(`TikTok chunk ${i + 1} upload failed (${uploadRes.status}): ${text}`);
      }

      const pct = Math.round(((i + 1) / totalChunkCount) * 100);
      onProgress({ stage: 'tiktok_uploading', platform: 'tiktok', message: `Uploading… ${pct}%`, percent: pct });
    }
  } finally {
    fs.closeSync(fd);
  }

  // ── 4. Poll publish status ───────────────────────────────────────────────────
  onProgress({ stage: 'tiktok_processing', platform: 'tiktok', message: 'Upload complete — TikTok is processing…' });

  const maxAttempts = 30;
  const pollInterval = 5000; // 5s

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollInterval));

    const statusRes = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id }),
    });
    const statusData = await statusRes.json();

    if (statusData.error?.code && statusData.error.code !== 'ok') {
      throw new Error(`TikTok status check failed: ${statusData.error.message || statusData.error.code}`);
    }

    const { status, share_url, fail_reason } = statusData.data || {};

    if (status === 'PUBLISH_COMPLETE') {
      onProgress({ stage: 'tiktok_done', platform: 'tiktok', message: 'Published to TikTok ✓', share_url });
      return {
        post_id:  publish_id,
        post_url: share_url || null,
      };
    }

    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${fail_reason || 'unknown reason'}`);
    }

    // PROCESSING_UPLOAD or PROCESSING_DOWNLOAD — keep polling
    onProgress({ stage: 'tiktok_processing', platform: 'tiktok', message: `TikTok processing… (${status})` });
  }

  throw new Error('TikTok publish timed out — check TikTok directly for status');
}

// ─── User Info (for displaying connected account) ─────────────────────────────

async function getUserInfo(accessToken) {
  const res = await fetch(
    `${TIKTOK_API_BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );
  const data = await res.json();
  return data?.data?.user || null;
}

// ─── Module exports ───────────────────────────────────────────────────────────

module.exports = {
  isAvailable:      () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
  generatePkce,
  getAuthUrl,
  exchangeCode,
  getCreatorInfo,
  uploadVideo,
  getUserInfo,
  // Keep this for any code still reading it — remove once routes are fully updated
  COMING_SOON_REASON: null,
};
