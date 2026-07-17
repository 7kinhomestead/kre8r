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
const log    = require('../utils/logger');

const TIKTOK_AUTH_URL   = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL  = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_API_BASE   = 'https://open.tiktokapis.com/v2';

// Sandbox mode — set TIKTOK_SANDBOX=true in .env while awaiting Content Posting API approval.
// In sandbox: uses /post/publish/inbox/video/init/ (draft → creator inbox, no approval needed)
// instead of /post/publish/video/init/ (direct publish, requires approved API access).
// Switch back to false once TikTok approves the app.
const SANDBOX = process.env.TIKTOK_SANDBOX === 'true';

// Sandbox uses video.upload only (inbox/draft) — video.publish requires Content Posting API approval.
const SCOPES          = 'user.info.basic,video.publish,video.upload';
const SCOPES_SANDBOX  = 'user.info.basic,video.upload';

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generatePkce() {
  // Verifier: hex string — 64 unreserved chars
  const verifier = crypto.randomBytes(32).toString('hex');
  // TikTok uses hex-encoded SHA256 (non-standard — they ignore RFC 7636 base64url).
  // Ref: developers.tiktok.com/doc/login-kit-desktop
  //   "code_challenge = CryptoJS.SHA256(code_verifier).toString(CryptoJS.enc.Hex)"
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
  log.info({ module: 'tiktok', event: 'pkce_generated', verifier_len: verifier.length, challenge_len: challenge.length }, 'PKCE generated');
  return { verifier, challenge };
}

// ─── Auth URL ────────────────────────────────────────────────────────────────

function getCallbackUrl(req) {
  const host  = req.get('host') || 'localhost:3000';
  const proto = req.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/postor/auth/tiktok/callback`;
}

function getAuthUrl(req, state, codeChallenge) {
  if (!process.env.TIKTOK_CLIENT_KEY) {
    throw new Error('TIKTOK_CLIENT_KEY is not set in your .env file');
  }
  const params = new URLSearchParams({
    client_key:    process.env.TIKTOK_CLIENT_KEY,
    redirect_uri:  getCallbackUrl(req),
    response_type: 'code',
    scope:         SANDBOX ? SCOPES_SANDBOX : SCOPES,
    state,
  });
  // Only include PKCE if a challenge was provided.
  // TikTok makes PKCE optional for server-side flows.
  // Some TikTok app states (unreviewed / pending scope approval) reject
  // the code_challenge even when it's cryptographically correct — so we
  // allow callers to opt out by passing null.
  if (codeChallenge) {
    params.set('code_challenge',        codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${TIKTOK_AUTH_URL}?${params}`;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCode(code, codeVerifier, req) {
  const body = new URLSearchParams({
    client_key:    process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  getCallbackUrl(req),
  });
  // Only include code_verifier if we sent a code_challenge in the auth URL.
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const res = await fetch(TIKTOK_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  log.info({
    module: 'tiktok',
    event: 'token_exchange',
    sandbox: SANDBOX,
    has_access_token: !!data.access_token,
    has_refresh_token: !!data.refresh_token,
    scope: data.scope || null,
    expires_in: data.expires_in || null,
    error: data.error || null,
    error_description: data.error_description || null,
  }, 'TikTok token exchange response');
  return data;
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

  // Sandbox: inbox endpoint (draft → creator inbox, no API approval needed).
  // Production: direct endpoint (publishes immediately, requires approved Content Posting API).
  const initEndpoint = SANDBOX
    ? `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`
    : `${TIKTOK_API_BASE}/post/publish/video/init/`;

  // Sandbox forces SELF_ONLY. Production uses user-selected privacy level.
  // NOTE: unreviewed apps must select SELF_ONLY in the UI until TikTok approves
  // Content Posting API access — TikTok rejects any other privacy level for unaudited apps.
  const effectivePrivacy = SANDBOX ? 'SELF_ONLY' : privacyLevel;

  onProgress({ stage: 'tiktok_init', platform: 'tiktok', message: `Initialising upload${SANDBOX ? ' (sandbox — inbox draft)' : ''} (${(videoSize / 1024 / 1024).toFixed(1)} MB, ${totalChunkCount} chunk${totalChunkCount > 1 ? 's' : ''})` });

  // ── 2. Init the post ─────────────────────────────────────────────────────────
  // The inbox endpoint (/post/publish/inbox/video/init/) accepts ONLY source_info —
  // sending post_info causes a 400. The publish endpoint accepts both.
  const initBody = SANDBOX
    ? {
        source_info: {
          source:            'FILE_UPLOAD',
          video_size:        videoSize,
          chunk_size:        Math.min(CHUNK_SIZE, videoSize),
          total_chunk_count: totalChunkCount,
        },
      }
    : {
        post_info: {
          title:                    (title || '').slice(0, 2200),
          privacy_level:            effectivePrivacy,
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
      };

  log.info({ module: 'tiktok', event: 'init_request', endpoint: initEndpoint, sandbox: SANDBOX, video_size: videoSize, total_chunk_count: totalChunkCount, body_keys: Object.keys(initBody) }, 'TikTok init request');

  const initRes = await fetch(initEndpoint, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json; charset=UTF-8',
    },
    body: JSON.stringify(initBody),
  });

  const initData = await initRes.json();
  log.info({ module: 'tiktok', event: 'init_response', status: initRes.status, data: initData }, 'TikTok init response');
  if (initData.error?.code && initData.error.code !== 'ok') {
    const code = initData.error.code;
    let hint = '';
    if (code === 'scope_not_authorized' || code === 'access_token_invalid' || /scope/i.test(initData.error.message || '')) {
      hint = ' — disconnect + reconnect TikTok in PostΩr to refresh scopes (sandbox needs video.upload)';
    } else if (code === 'invalid_param') {
      hint = ' — check video file format (MP4 H.264) and that path exists on disk';
    } else if (code === 'unaudited_client_can_only_post_to_private_accounts') {
      hint = ' — TikTok account must be set to Private during sandbox/unaudited app phase';
    }
    throw new Error(`TikTok init failed (${code}): ${initData.error.message || code}${hint}`);
  }
  if (!initData.data?.publish_id || !initData.data?.upload_url) {
    throw new Error(`TikTok init returned unexpected structure: ${JSON.stringify(initData)}`);
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
        log.error({ module: 'tiktok', event: 'chunk_failed', chunk: i + 1, status: uploadRes.status, body: text }, 'TikTok chunk upload failed');
        throw new Error(`TikTok chunk ${i + 1} upload failed (${uploadRes.status}): ${text}`);
      }
      log.info({ module: 'tiktok', event: 'chunk_ok', chunk: i + 1, total: totalChunkCount, status: uploadRes.status }, 'TikTok chunk uploaded');

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
    log.info({ module: 'tiktok', event: 'status_poll', attempt: attempt + 1, data: statusData }, 'TikTok status poll');

    if (statusData.error?.code && statusData.error.code !== 'ok') {
      throw new Error(`TikTok status check failed (${statusData.error.code}): ${statusData.error.message || statusData.error.code}`);
    }

    const { status, publicaly_available_post_id, fail_reason } = statusData.data || {};
    const share_url = statusData.data?.share_url || null;

    // Inbox flow terminal state: SEND_TO_USER_INBOX (success — video waiting in creator's inbox)
    // Direct publish terminal state: PUBLISH_COMPLETE
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') {
      const doneMsg = SANDBOX
        ? 'Sent to TikTok inbox as draft ✓ — open TikTok app to publish'
        : 'Published to TikTok ✓';
      onProgress({ stage: 'tiktok_done', platform: 'tiktok', message: doneMsg, share_url });
      return {
        ok:       true, // PB2 fix: queue-processor checks r.ok — was missing, made TikTok always show as failed
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
  isSandbox:        () => SANDBOX,
  generatePkce,
  getAuthUrl,
  exchangeCode,
  getCreatorInfo,
  uploadVideo,
  getUserInfo,
  // Keep this for any code still reading it — remove once routes are fully updated
  COMING_SOON_REASON: null,
};
