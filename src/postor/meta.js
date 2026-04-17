/**
 * PostΩr — Meta Platform Module (Instagram + Facebook Pages)
 * Handles Meta OAuth2, Instagram Content Publishing API (Reels),
 * and Facebook Pages video upload.
 *
 * Env vars required:
 *   META_APP_ID
 *   META_APP_SECRET
 *
 * Register these redirect URIs in Meta App Dashboard > Facebook Login > Settings:
 *   http://localhost:3000/api/postor/auth/meta/callback
 *   https://kre8r.app/api/postor/auth/meta/callback   (if using hosted)
 *
 * Required permissions (request in App Dashboard):
 *   instagram_basic, instagram_content_publish,
 *   pages_manage_posts, pages_read_engagement, pages_show_list, publish_video
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const META_DIALOG_URL  = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_URL   = 'https://graph.facebook.com/v21.0/oauth/access_token';
const GRAPH            = 'https://graph.facebook.com/v21.0';
const GRAPH_VIDEO      = 'https://graph-video.facebook.com/v21.0';

const SCOPES = [
  // instagram_basic deprecated May 2024 — removed
  'instagram_content_publish', // publish Reels via Page-linked Instagram account
  'pages_manage_posts',        // create/edit/delete Page posts
  'pages_read_engagement',     // read Page content + follower data
  'pages_show_list',           // list Pages the user manages
  'publish_video',             // upload video to Facebook Page
].join(',');

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getCallbackUrl(req) {
  const host = req.get('host') || 'localhost:3000';
  return `${req.protocol}://${host}/api/postor/auth/meta/callback`;
}

function getAuthUrl(req, state) {
  if (!process.env.META_APP_ID) {
    throw new Error('META_APP_ID is not set in your .env file');
  }
  const params = new URLSearchParams({
    client_id:     process.env.META_APP_ID,
    redirect_uri:  getCallbackUrl(req),
    scope:         SCOPES,
    response_type: 'code',
    state,
  });
  return `${META_DIALOG_URL}?${params}`;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────

async function exchangeCode(code, req) {
  const url = `${META_TOKEN_URL}?${new URLSearchParams({
    client_id:     process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri:  getCallbackUrl(req),
    code,
  })}`;
  const res = await fetch(url);
  return res.json();
}

// Exchange short-lived user token for a 60-day long-lived token
async function getLongLivedToken(shortToken) {
  const url = `${GRAPH}/oauth/access_token?${new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         process.env.META_APP_ID,
    client_secret:     process.env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  })}`;
  const res = await fetch(url);
  return res.json();
}

// ─── Page Discovery ───────────────────────────────────────────────────────────

/**
 * Returns all Facebook Pages the user manages + their linked Instagram accounts.
 * @returns {Array<{ id, name, access_token, ig_user_id, ig_username }>}
 */
async function getPages(userToken) {
  const url = `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userToken}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Meta pages fetch failed: ${data.error.message}`);

  return (data.data || []).map(page => ({
    id:          page.id,
    name:        page.name,
    access_token: page.access_token,
    ig_user_id:  page.instagram_business_account?.id   || null,
    ig_username: page.instagram_business_account?.username || null,
  }));
}

// ─── Instagram Reels Publish ──────────────────────────────────────────────────

/**
 * Publish a Reel to Instagram using the resumable upload flow (local files).
 * Steps:
 *  1. Initialize upload session → get creation_id + upload URI
 *  2. POST raw video to upload URI
 *  3. Poll creation_id for FINISHED status
 *  4. Publish via media_publish
 */
async function publishInstagramReel({ videoPath, caption, onProgress }) {
  const conn = db.getPostorConnection('instagram');
  if (!conn) throw new Error('Instagram not connected');

  const igUserId    = conn.account_id;
  const accessToken = conn.access_token;

  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  const fileSize = fs.statSync(videoPath).size;

  // Step 1 — Initialize resumable upload session
  onProgress?.({ stage: 'instagram', step: 'initiating', pct: 2 });

  const initUrl = `${GRAPH}/${igUserId}/media`;
  const initRes = await fetch(initUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      upload_type:   'resumable',
      media_type:    'REELS',
      caption:       caption || '',
      share_to_feed: true,
      access_token:  accessToken,
    }),
  });

  const initData = await initRes.json();
  if (initData.error) throw new Error(`Instagram init failed: ${initData.error.message}`);

  const creationId = initData.id;
  const uploadUri  = initData.uri;
  if (!uploadUri) throw new Error('Instagram did not return an upload URI — check permissions');

  // Step 2 — Upload raw video bytes
  onProgress?.({ stage: 'instagram', step: 'uploading', pct: 5 });
  console.log(`[postor/meta] Uploading ${Math.round(fileSize / 1024 / 1024)}MB → Instagram`);

  const fileBuffer = fs.readFileSync(videoPath);

  const uploadRes = await fetch(uploadUri, {
    method:  'POST',
    headers: {
      Authorization:  `OAuth ${accessToken}`,
      'file_size':    String(fileSize),
      'offset':       '0',
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || uploadData.error) {
    throw new Error(`Instagram upload failed: ${JSON.stringify(uploadData).slice(0, 300)}`);
  }

  // Step 3 — Poll for processing completion
  onProgress?.({ stage: 'instagram', step: 'processing', pct: 70 });
  let status   = 'IN_PROGRESS';
  let attempts = 0;
  const maxAttempts = 36; // 3 minutes max (36 × 5s)

  while (status !== 'FINISHED' && status !== 'ERROR' && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes  = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${accessToken}`);
    const pollData = await pollRes.json();
    status = pollData.status_code;
    attempts++;
    onProgress?.({ stage: 'instagram', step: 'processing', pct: Math.min(90, 70 + attempts) });
  }

  if (status === 'ERROR')    throw new Error('Instagram video processing failed on their servers');
  if (status !== 'FINISHED') throw new Error('Instagram processing timed out (3 min limit) — video may still publish');

  // Step 4 — Publish
  onProgress?.({ stage: 'instagram', step: 'publishing', pct: 95 });
  const pubRes  = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const pubData = await pubRes.json();
  if (pubData.error) throw new Error(`Instagram publish failed: ${pubData.error.message}`);

  // Fetch permalink
  let postUrl = `https://www.instagram.com/p/${pubData.id}/`;
  try {
    const mediaRes  = await fetch(`${GRAPH}/${pubData.id}?fields=permalink&access_token=${accessToken}`);
    const mediaData = await mediaRes.json();
    if (mediaData.permalink) postUrl = mediaData.permalink;
  } catch (_) {}

  onProgress?.({ stage: 'instagram', step: 'done', pct: 100 });
  return { ok: true, post_id: pubData.id, post_url: postUrl };
}

// ─── Facebook Pages Video Publish ────────────────────────────────────────────

/**
 * Upload a video to a Facebook Page using multipart upload.
 */
async function publishFacebookVideo({ videoPath, title, description, onProgress }) {
  const conn = db.getPostorConnection('facebook');
  if (!conn) throw new Error('Facebook not connected');

  const pageId    = conn.account_id;
  const pageToken = conn.access_token;

  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);

  onProgress?.({ stage: 'facebook', step: 'uploading', pct: 5 });
  console.log(`[postor/meta] Uploading to Facebook Page ${pageId}`);

  const fileBuffer = fs.readFileSync(videoPath);
  const fileName   = path.basename(videoPath);
  const fileSize   = fileBuffer.length;

  // Build multipart/form-data body manually (Node 18 FormData doesn't stream)
  const boundary = `----KRE8RPOST${Date.now()}`;
  const CRLF     = '\r\n';

  function fieldPart(name, value) {
    return (
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
      `${value}${CRLF}`
    );
  }

  const preamble = Buffer.from(
    fieldPart('title',        title        || '') +
    fieldPart('description',  description  || '') +
    fieldPart('access_token', pageToken) +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="source"; filename="${fileName}"${CRLF}` +
    `Content-Type: video/mp4${CRLF}${CRLF}`
  );
  const epilogue = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body     = Buffer.concat([preamble, fileBuffer, epilogue]);

  const uploadRes = await fetch(`${GRAPH_VIDEO}/${pageId}/videos`, {
    method:  'POST',
    headers: {
      'Content-Type':   `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  const uploadData = await uploadRes.json();
  if (uploadData.error) throw new Error(`Facebook upload failed: ${uploadData.error.message}`);

  onProgress?.({ stage: 'facebook', step: 'done', pct: 100 });

  const postUrl = `https://www.facebook.com/${pageId}/videos/${uploadData.id}`;
  return { ok: true, post_id: uploadData.id, post_url: postUrl };
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  getLongLivedToken,
  getPages,
  publishInstagramReel,
  publishFacebookVideo,
};
