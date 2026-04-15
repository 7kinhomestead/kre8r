/**
 * PostΩr — YouTube Platform Module
 * Handles Google OAuth2 + YouTube Data API v3 video upload
 *
 * Env vars required:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *
 * Register these redirect URIs in Google Cloud Console:
 *   http://localhost:3000/api/postor/auth/youtube/callback
 *   https://kre8r.app/api/postor/auth/youtube/callback   (if using hosted)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_API_BASE      = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD_URL    = 'https://www.googleapis.com/upload/youtube/v3/videos';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

// ─── Auth URL ────────────────────────────────────────────────────────────────

function getCallbackUrl(req) {
  const host = req.get('host') || 'localhost:3000';
  return `${req.protocol}://${host}/api/postor/auth/youtube/callback`;
}

function getAuthUrl(req, state) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not set in your .env file');
  }
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  getCallbackUrl(req),
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCode(code, req) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  getCallbackUrl(req),
      grant_type:    'authorization_code',
    }),
  });
  return res.json();
}

async function refreshToken(connection) {
  if (!connection.refresh_token) throw new Error('No refresh token — reconnect YouTube');
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      refresh_token: connection.refresh_token,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  db.upsertPostorConnection('youtube', {
    access_token:     data.access_token,
    refresh_token:    connection.refresh_token,
    token_expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    account_id:       connection.account_id,
    account_name:     connection.account_name,
  });
  return data.access_token;
}

async function getValidToken() {
  const conn = db.getPostorConnection('youtube');
  if (!conn) throw new Error('YouTube not connected');
  // Refresh if expiring within 5 minutes
  if (conn.token_expires_at && conn.token_expires_at < Date.now() + 5 * 60 * 1000) {
    return refreshToken(conn);
  }
  return conn.access_token;
}

// ─── Account Info ─────────────────────────────────────────────────────────────

async function getChannelInfo(accessToken) {
  const res = await fetch(
    `${YT_API_BASE}/channels?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data.items?.[0] || null;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a video to YouTube using the resumable upload protocol.
 * @param {object} opts
 * @param {string} opts.videoPath       - Absolute path to the video file
 * @param {string} opts.title           - Video title
 * @param {string} [opts.description]   - Video description
 * @param {string[]} [opts.tags]        - Tag array
 * @param {number} [opts.categoryId]    - YouTube category ID (default 22 = People & Blogs)
 * @param {string} [opts.privacyStatus] - 'public' | 'unlisted' | 'private' (default 'public')
 * @param {string} [opts.scheduledAt]   - ISO datetime string for scheduled publish
 * @param {function} [opts.onProgress]  - Progress callback { stage, step, pct }
 */
async function uploadVideo({ videoPath, title, description, tags, categoryId, privacyStatus, scheduledAt, onProgress }) {
  const accessToken = await getValidToken();

  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  const fileSize = fs.statSync(videoPath).size;

  const isScheduled = !!(scheduledAt && new Date(scheduledAt) > new Date());

  const metadata = {
    snippet: {
      title:       title || 'Untitled',
      description: description || '',
      tags:        Array.isArray(tags) ? tags : (tags ? [tags] : []),
      categoryId:  String(categoryId || 22),
    },
    status: {
      privacyStatus:           isScheduled ? 'private' : (privacyStatus || 'public'),
      selfDeclaredMadeForKids: false,
      ...(isScheduled ? { publishAt: new Date(scheduledAt).toISOString() } : {}),
    },
  };

  // Step 1 — Initiate resumable upload session
  onProgress?.({ stage: 'youtube', step: 'initiating', pct: 2 });
  const initRes = await fetch(
    `${YT_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    {
      method:  'POST',
      headers: {
        Authorization:             `Bearer ${accessToken}`,
        'Content-Type':            'application/json',
        'X-Upload-Content-Type':   'video/*',
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`YouTube upload initiation failed (${initRes.status}): ${err.slice(0, 300)}`);
  }

  const uploadUri = initRes.headers.get('location');
  if (!uploadUri) throw new Error('YouTube did not return an upload URI');

  // Step 2 — Upload the video file
  onProgress?.({ stage: 'youtube', step: 'uploading', pct: 5 });
  console.log(`[postor/youtube] Uploading ${Math.round(fileSize / 1024 / 1024)}MB → YouTube`);

  const fileBuffer = fs.readFileSync(videoPath);

  const uploadRes = await fetch(uploadUri, {
    method:  'PUT',
    headers: {
      'Content-Type':   'video/*',
      'Content-Length': String(fileSize),
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`YouTube upload failed (${uploadRes.status}): ${err.slice(0, 300)}`);
  }

  const result = await uploadRes.json();
  onProgress?.({ stage: 'youtube', step: 'done', pct: 100 });

  const videoId  = result.id;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return { ok: true, post_id: videoId, post_url: videoUrl, scheduled: isScheduled, result };
}

module.exports = { getAuthUrl, exchangeCode, getChannelInfo, getValidToken, uploadVideo };
