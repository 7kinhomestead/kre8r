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

const fs           = require('fs');
const path         = require('path');
const db           = require('../db');
const { createVideoTunnel } = require('./video-tunnel');

const META_DIALOG_URL  = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_URL   = 'https://graph.facebook.com/v21.0/oauth/access_token';
const GRAPH            = 'https://graph.facebook.com/v21.0';
const GRAPH_VIDEO      = 'https://graph-video.facebook.com/v21.0';
const GRAPH_IG         = 'https://graph.instagram.com';  // new Instagram API (instagram_business_content_publish)

const SCOPES = [
  // instagram_content_publish — requires "Manage and publish content" use case in Meta app
  // Removed from OAuth scope until use case is added; Instagram connection handled separately
  // 'instagram_content_publish',
  'pages_manage_posts',        // create/edit/delete Page posts
  'pages_read_engagement',     // read Page content + follower data
  'pages_show_list',           // list Pages the user manages
  // publish_video — requires use case; Facebook video upload uses page token directly
  // 'publish_video',
].join(',');

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getCallbackUrl(req) {
  const host = req.get('host') || 'localhost:3000';
  // Trust X-Forwarded-Proto set by nginx — req.protocol is always 'http'
  // behind a reverse proxy unless Express trust proxy is configured.
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}/api/postor/auth/meta/callback`;
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
 * Publish a Reel to Instagram using the new Instagram API (graph.instagram.com).
 * The new API requires a publicly accessible video_url — Instagram pulls the file
 * itself. We serve it via a temporary secure tunnel (isolated port, one-time token).
 *
 * Steps:
 *  1. Open video tunnel → get one-time public URL
 *  2. Create media container with video_url → get creation_id
 *  3. Poll creation_id for FINISHED status (tunnel stays open so IG can download)
 *  4. Close tunnel
 *  5. Publish via media_publish
 */
async function publishInstagramReel({ videoPath, caption, onProgress }) {
  const conn = db.getPostorConnection('instagram');
  if (!conn) throw new Error('Instagram not connected');

  const igUserId    = conn.account_id;
  const accessToken = conn.access_token;

  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);

  // Step 1 — Open secure video tunnel
  onProgress?.({ stage: 'instagram', step: 'initiating', pct: 2 });
  const { url: videoUrl, cleanup } = await createVideoTunnel(videoPath);
  console.log(`[postor/meta] Video available for Instagram at: ${videoUrl}`);

  let creationId;
  try {
    // Step 2 — Create media container with public video_url
    onProgress?.({ stage: 'instagram', step: 'uploading', pct: 10 });
    const initRes = await fetch(`${GRAPH_IG}/${igUserId}/media`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        media_type:    'REELS',
        video_url:     videoUrl,
        caption:       caption || '',
        share_to_feed: true,
        access_token:  accessToken,
      }),
    });

    const initData = await initRes.json();
    if (initData.error) throw new Error(`Instagram init failed: ${initData.error.message}`);
    creationId = initData.id;

    // Step 3 — Poll for processing completion
    // Tunnel stays open so Instagram can download the video during IN_PROGRESS
    onProgress?.({ stage: 'instagram', step: 'processing', pct: 20 });
    let status     = 'IN_PROGRESS';
    let attempts   = 0;
    const maxAttempts = 36; // 3 minutes max (36 × 5s)

    while (status !== 'FINISHED' && status !== 'ERROR' && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes  = await fetch(`${GRAPH_IG}/${creationId}?fields=status_code,status,error_message&access_token=${accessToken}`);
      const pollData = await pollRes.json();
      status = pollData.status_code;
      const detail = pollData.error_message ? ` — ${pollData.error_message}` : '';
      console.log(`[postor/meta] IG processing: ${status}${detail}`);
      attempts++;
      onProgress?.({ stage: 'instagram', step: 'processing', pct: Math.min(88, 20 + attempts * 2) });
    }

    if (status === 'ERROR')    throw new Error(`Instagram video processing failed — check Electron log for status details`);
    if (status !== 'FINISHED') throw new Error('Instagram processing timed out (3 min limit) — video may still publish');

  } finally {
    await cleanup(); // Always close tunnel — Instagram has the video by now
  }

  // Step 4 — Publish
  onProgress?.({ stage: 'instagram', step: 'publishing', pct: 95 });
  const pubRes  = await fetch(`${GRAPH_IG}/${igUserId}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const pubData = await pubRes.json();
  if (pubData.error) throw new Error(`Instagram publish failed: ${pubData.error.message}`);

  // Fetch permalink
  let postUrl = `https://www.instagram.com/p/${pubData.id}/`;
  try {
    const mediaRes  = await fetch(`${GRAPH_IG}/${pubData.id}?fields=permalink&access_token=${accessToken}`);
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
