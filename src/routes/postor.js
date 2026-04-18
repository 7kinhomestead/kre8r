/**
 * PostΩr Route — src/routes/postor.js
 *
 * Platform OAuth + video posting to YouTube, Instagram, Facebook.
 * TikTok stub (coming soon).
 *
 * GET  /api/postor/connections              — list connected platforms
 * GET  /api/postor/auth/youtube             — start YouTube OAuth
 * GET  /api/postor/auth/youtube/callback    — YouTube OAuth callback
 * GET  /api/postor/auth/meta                — start Meta (IG + FB) OAuth
 * GET  /api/postor/auth/meta/callback       — Meta OAuth callback
 * POST /api/postor/auth/meta/select-page    — store selected FB page + IG account
 * DELETE /api/postor/connections/:platform  — disconnect platform
 * GET  /api/postor/vault-videos             — completed-video footage for picker
 * POST /api/postor/post                     — post to platforms (SSE job)
 * GET  /api/postor/status/:job_id           — SSE progress stream
 * GET  /api/postor/history                  — recent posts
 */

'use strict';

const express        = require('express');
const crypto         = require('crypto');
const path           = require('path');
const { EventEmitter } = require('events');

const db               = require('../db');
const youtube          = require('../postor/youtube');
const ytAnalytics      = require('../postor/youtube-analytics');
const meta             = require('../postor/meta');
const tiktok           = require('../postor/tiktok');
const { attachSseStream } = require('../utils/sse');

const router = express.Router();

// ─── In-memory SSE job store ──────────────────────────────────────────────────

const jobs = new Map();

function createJob() {
  const id      = crypto.randomUUID();
  const emitter = new EventEmitter();
  const job     = { id, status: 'running', events: [], emitter, result: null, error: null };
  jobs.set(id, job);
  return job;
}

function pushEvent(job, data) {
  job.events.push(data);
  job.emitter.emit('event', data);
}

function finishJob(job, result) {
  job.status = 'done';
  job.result = result;
  const ev = { stage: 'done', result };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function failJob(job, error) {
  job.status = 'error';
  job.error  = error;
  const ev = { stage: 'error', error };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

// ─── Connections List ─────────────────────────────────────────────────────────

router.get('/connections', (req, res) => {
  const rows  = db.getAllPostorConnections();
  const byPlatform = Object.fromEntries(rows.map(r => [r.platform, {
    connected:    true,
    account_id:   r.account_id,
    account_name: r.account_name,
    extra_data:   r.extra_data ? tryParse(r.extra_data) : null,
    connected_at: r.connected_at,
    updated_at:   r.updated_at,
  }]));

  // Fill in missing platforms with connected: false
  const platforms = ['youtube', 'instagram', 'facebook', 'tiktok'];
  const result = {};
  for (const p of platforms) {
    result[p] = byPlatform[p] || { connected: false };
  }

  // TikTok is always "coming soon"
  result.tiktok = { connected: false, coming_soon: true, reason: tiktok.COMING_SOON_REASON };

  // Surface which Meta pages are available (if connected)
  if (byPlatform.meta_pages) {
    result._meta_pages = byPlatform.meta_pages;
  }

  res.json(result);
});

function tryParse(str) {
  try { return JSON.parse(str); } catch (_) { return str; }
}

// ─── YouTube OAuth ────────────────────────────────────────────────────────────

router.get('/auth/youtube', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({
      error:   'YouTube credentials not configured',
      details: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file, then restart the server.',
    });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.postor_yt_state = state;

  try {
    const authUrl = youtube.getAuthUrl(req, state);
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect('/postor.html?error=' + encodeURIComponent('YouTube auth denied: ' + error));
  }
  if (!code || state !== req.session.postor_yt_state) {
    return res.redirect('/postor.html?error=' + encodeURIComponent('Invalid OAuth state — try connecting again'));
  }
  delete req.session.postor_yt_state;

  try {
    const tokens = await youtube.exchangeCode(code, req);
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    const accessToken = tokens.access_token;
    const channel     = await youtube.getChannelInfo(accessToken);

    db.upsertPostorConnection('youtube', {
      access_token:     accessToken,
      refresh_token:    tokens.refresh_token || null,
      token_expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      account_id:       channel?.id                          || null,
      account_name:     channel?.snippet?.title              || 'YouTube Channel',
    });

    console.log('[postor] YouTube connected:', channel?.snippet?.title);
    res.redirect('/postor.html?connected=youtube');
  } catch (err) {
    console.error('[postor] YouTube callback error:', err);
    res.redirect('/postor.html?error=' + encodeURIComponent('YouTube connection failed: ' + err.message));
  }
});

// ─── Meta OAuth (Instagram + Facebook) ───────────────────────────────────────

router.get('/auth/meta', (req, res) => {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(400).json({
      error:   'Meta credentials not configured',
      details: 'Add META_APP_ID and META_APP_SECRET to your .env file, then restart the server.',
    });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.postor_meta_state = state;

  try {
    const authUrl = meta.getAuthUrl(req, state);
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/auth/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect('/postor.html?error=' + encodeURIComponent('Meta auth denied: ' + error));
  }
  if (!code || state !== req.session.postor_meta_state) {
    return res.redirect('/postor.html?error=' + encodeURIComponent('Invalid OAuth state — try connecting again'));
  }
  delete req.session.postor_meta_state;

  try {
    // Exchange code for short-lived token
    const shortTokenData = await meta.exchangeCode(code, req);
    if (shortTokenData.error) throw new Error(shortTokenData.error_description || shortTokenData.error);

    // Upgrade to 60-day long-lived token
    const longTokenData = await meta.getLongLivedToken(shortTokenData.access_token);
    if (longTokenData.error) throw new Error(longTokenData.error_description || longTokenData.error);

    const userToken = longTokenData.access_token;

    // Get all managed pages + their Instagram accounts
    const pages = await meta.getPages(userToken);
    console.log('[postor] Meta pages found:', pages.map(p => `${p.name} (IG: ${p.ig_user_id || 'none'})`));

    if (pages.length === 0) {
      return res.redirect('/postor.html?error=' + encodeURIComponent(
        'No Facebook Pages found. You need at least one Facebook Page to use this integration.'
      ));
    }

    // Store all pages so user can choose
    db.upsertPostorConnection('meta_pages', {
      access_token: userToken,
      account_id:   'meta',
      account_name: 'Meta',
      extra_data:   JSON.stringify(pages),
    });

    if (pages.length === 1) {
      // Auto-select the only page
      await selectPage(pages[0]);
      res.redirect('/postor.html?connected=meta');
    } else {
      // Multiple pages — redirect to page selector
      res.redirect('/postor.html?meta_setup=select_page');
    }
  } catch (err) {
    console.error('[postor] Meta callback error:', err);
    res.redirect('/postor.html?error=' + encodeURIComponent('Meta connection failed: ' + err.message));
  }
});

// Helper: persist a selected page as the active Facebook + Instagram connection
async function selectPage(page) {
  // Facebook
  db.upsertPostorConnection('facebook', {
    access_token: page.access_token,
    account_id:   page.id,
    account_name: page.name,
  });

  // Instagram (if linked)
  if (page.ig_user_id) {
    db.upsertPostorConnection('instagram', {
      access_token: page.access_token, // page token works for IG publishing
      account_id:   page.ig_user_id,
      account_name: page.ig_username || 'Instagram Account',
    });
  }

  console.log(`[postor] Meta page selected: ${page.name} (FB: ${page.id}, IG: ${page.ig_user_id || 'none'})`);
}

// POST /api/postor/auth/meta/select-page
// Body: { page_id }
router.post('/auth/meta/select-page', async (req, res) => {
  const { page_id } = req.body || {};
  if (!page_id) return res.status(400).json({ error: 'page_id required' });

  const metaConn = db.getPostorConnection('meta_pages');
  if (!metaConn) return res.status(404).json({ error: 'Meta not connected — start OAuth first' });

  const pages = tryParse(metaConn.extra_data) || [];
  const page  = pages.find(p => p.id === String(page_id));
  if (!page) return res.status(404).json({ error: 'Page not found in your Meta account' });

  try {
    await selectPage(page);
    res.json({ ok: true, page_name: page.name, ig_user_id: page.ig_user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/postor/auth/meta/pages — return list of available pages for picker
router.get('/auth/meta/pages', (req, res) => {
  const metaConn = db.getPostorConnection('meta_pages');
  if (!metaConn) return res.json({ pages: [] });
  const pages = tryParse(metaConn.extra_data) || [];
  res.json({ pages });
});

// ─── Manual Token (dev mode — bypasses OAuth redirect URI requirement) ────────

/**
 * POST /api/postor/auth/meta/manual-token
 * Body: { user_access_token: string }
 * Uses a token from Graph API Explorer to discover pages + store connection.
 * For development use when localhost redirect URIs won't save in Meta portal.
 */
router.post('/auth/meta/manual-token', async (req, res) => {
  const { user_access_token } = req.body || {};
  if (!user_access_token) return res.status(400).json({ error: 'user_access_token required' });

  try {
    // Exchange for long-lived token
    const longTokenData = await meta.getLongLivedToken(user_access_token);
    if (longTokenData.error) throw new Error(longTokenData.error_description || longTokenData.error);
    const longToken = longTokenData.access_token || user_access_token;

    // Get pages
    const pages = await meta.getPages(longToken);
    if (!pages.length) return res.status(400).json({ error: 'No Facebook Pages found for this account' });

    // Store user token + page list
    db.upsertPostorConnection('meta_pages', {
      access_token:  longToken,
      refresh_token: null,
      account_id:    pages[0]?.id    || null,
      account_name:  pages[0]?.name  || 'Meta',
      extra_data:    JSON.stringify(pages),
    });

    // Auto-select first page
    const firstPage = pages[0];
    db.upsertPostorConnection('facebook', {
      access_token:  firstPage.access_token,
      refresh_token: null,
      account_id:    firstPage.id,
      account_name:  firstPage.name,
    });

    if (firstPage.ig_user_id) {
      db.upsertPostorConnection('instagram', {
        access_token:  firstPage.access_token,
        refresh_token: null,
        account_id:    firstPage.ig_user_id,
        account_name:  firstPage.ig_username || firstPage.name,
      });
    }

    res.json({
      ok: true,
      pages: pages.map(p => ({ id: p.id, name: p.name, ig: p.ig_username || null })),
      selected: firstPage.name,
    });
  } catch (err) {
    console.error('[postor] manual-token error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Link Instagram from stored Page token ───────────────────────────────────

/**
 * POST /api/postor/auth/meta/link-instagram
 * Uses the stored Facebook page token to look up the linked Instagram
 * Business account and store it as the instagram connection.
 * No new token needed from the user.
 */
router.post('/auth/meta/link-instagram', async (req, res) => {
  const fbConn = db.getPostorConnection('facebook');
  if (!fbConn) return res.status(400).json({ error: 'Facebook not connected — run manual-token first' });

  const pageId    = fbConn.account_id;
  const pageToken = fbConn.access_token;

  try {
    const url  = `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id,username,name}&access_token=${pageToken}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) throw new Error(data.error.message);

    const ig = data.instagram_business_account;
    if (!ig) return res.status(404).json({ error: 'No Instagram Business account linked to this Facebook Page. Make sure your Instagram is a Business/Creator account and connected to the 7 Kin Homestead Facebook Page.' });

    db.upsertPostorConnection('instagram', {
      access_token:  pageToken,
      refresh_token: null,
      account_id:    ig.id,
      account_name:  ig.username || ig.name || 'Instagram',
    });

    res.json({ ok: true, ig_user_id: ig.id, ig_username: ig.username });
  } catch (err) {
    console.error('[postor] link-instagram error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Instagram Debug — tries every IG field with the stored page token ────────

router.get('/auth/meta/debug-instagram', async (req, res) => {
  const fbConn = db.getPostorConnection('facebook');
  if (!fbConn) return res.status(400).json({ error: 'Facebook not connected' });

  const pageId    = fbConn.account_id;
  const pageToken = fbConn.access_token;

  const results = {};

  const fields = [
    'instagram_business_account{id,username,name}',
    'connected_instagram_account{id,username,name}',
    'instagram_accounts{id,username}',
  ];

  for (const field of fields) {
    try {
      const url  = `https://graph.facebook.com/v21.0/${pageId}?fields=${field}&access_token=${pageToken}`;
      const resp = await fetch(url);
      results[field] = await resp.json();
    } catch (err) {
      results[field] = { fetch_error: err.message };
    }
  }

  // Also try with the long-lived USER token (meta_pages) — different permission set
  const userConn = db.getPostorConnection('meta_pages');
  if (userConn) {
    const userToken = userConn.access_token;
    try {
      const url  = `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id,username,name}&access_token=${userToken}`;
      const resp = await fetch(url);
      results._user_token_ig = await resp.json();
    } catch (err) {
      results._user_token_ig = { fetch_error: err.message };
    }

    // Check what scopes the user token actually has
    try {
      const permUrl  = `https://graph.facebook.com/v21.0/me/permissions?access_token=${userToken}`;
      const permResp = await fetch(permUrl);
      results._user_token_permissions = await permResp.json();
    } catch (err) {
      results._user_token_permissions = { fetch_error: err.message };
    }
  }

  res.json({ page_id: pageId, results });
});

// ─── Hardcode Instagram ID (last-resort dev bypass) ──────────────────────────

/**
 * POST /api/postor/auth/meta/set-instagram-id
 * Body: { ig_user_id, ig_username }
 * Stores the Instagram Business Account ID using the already-connected
 * Facebook Page token.  Use when Graph API Explorer won't surface the IG actor.
 */
router.post('/auth/meta/set-instagram-id', (req, res) => {
  const { ig_user_id, ig_username } = req.body || {};
  if (!ig_user_id) return res.status(400).json({ error: 'ig_user_id required' });

  const fbConn = db.getPostorConnection('facebook');
  if (!fbConn) return res.status(400).json({ error: 'Facebook not connected — need page token for publishing' });

  db.upsertPostorConnection('instagram', {
    access_token:  fbConn.access_token,
    refresh_token: null,
    account_id:    String(ig_user_id),
    account_name:  ig_username || 'Instagram',
  });

  console.log(`[postor] Instagram ID manually set: @${ig_username} (${ig_user_id})`);
  res.json({ ok: true, ig_user_id, ig_username });
});

// ─── Manual Instagram Token (dev mode) ───────────────────────────────────────

/**
 * POST /api/postor/auth/meta/manual-instagram-token
 * Body: { instagram_access_token: string }
 *
 * Use when Graph API Explorer has the Instagram Business Account selected
 * in the top-left actor dropdown.  Calling /me with that token returns the
 * IG account's own id + username — no instagram_content_publish scope required
 * for the /me read.  The token is stored for later publishing calls.
 */
router.post('/auth/meta/manual-instagram-token', async (req, res) => {
  const { instagram_access_token } = req.body || {};
  if (!instagram_access_token) return res.status(400).json({ error: 'instagram_access_token required' });

  try {
    // Use graph.instagram.com unversioned — new Instagram API tokens don't use v21.0 path
    const url  = `https://graph.instagram.com/me?fields=id&access_token=${instagram_access_token}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) return res.status(400).json({ error: data.error.message });
    if (!data.id)   return res.status(400).json({ error: 'Token did not return an Instagram user id — make sure Instagram is selected in Graph API Explorer' });

    db.upsertPostorConnection('instagram', {
      access_token:  instagram_access_token,
      refresh_token: null,
      account_id:    data.id,
      account_name:  '7.kin.jason',
      extra_data:    JSON.stringify(data),
    });

    console.log(`[postor] Instagram manually linked: (${data.id})`);
    res.json({ ok: true, ig_user_id: data.id, ig_username: '7.kin.jason' });
  } catch (err) {
    console.error('[postor] manual-instagram-token error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Disconnect ───────────────────────────────────────────────────────────────

router.delete('/connections/:platform', (req, res) => {
  const { platform } = req.params;
  const allowed = ['youtube', 'instagram', 'facebook', 'meta_pages'];
  if (!allowed.includes(platform)) {
    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  }
  db.deletePostorConnection(platform);
  if (platform === 'facebook') db.deletePostorConnection('instagram'); // always paired
  res.json({ ok: true, platform });
});

// ─── Vault Video Picker ───────────────────────────────────────────────────────

router.get('/vault-videos', (req, res) => {
  const footage = db.getAllFootage({ shot_type: 'completed-video' });
  const videos  = footage.map(f => ({
    id:          f.id,
    filename:    path.basename(f.organized_path || f.file_path || ''),
    file_path:   f.organized_path || f.file_path || '',
    duration:    f.duration,
    resolution:  f.resolution,
    recorded_at: f.creation_timestamp,
    project_id:  f.project_id,
    description: f.description || null,
  }));
  res.json({ videos });
});

// ─── Project Prefill ─────────────────────────────────────────────────────────

/**
 * GET /api/postor/project/:id/prefill
 * Returns pipeline data for a project: selected package title + YouTube description,
 * per-platform captions (instagram, facebook), and creator tags from profile.
 * Used by the PostΩr form to auto-populate fields when a project video is picked.
 */
router.get('/project/:id/prefill', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

  try {
    const pkg      = db.getSelectedPackage(projectId);
    const captions = db.getCaptions(projectId);

    // Group captions by platform — join multiple clips with blank line
    const captionMap = {};
    for (const row of captions) {
      const p = (row.platform || '').toLowerCase();
      captionMap[p] = captionMap[p]
        ? captionMap[p] + '\n\n' + row.caption_text
        : row.caption_text;
    }

    res.json({
      title:              pkg?.title              || null,
      youtube_description: pkg?.youtube_description || null,
      captions: {
        youtube:   captionMap.youtube   || null,
        instagram: captionMap.instagram || null,
        facebook:  captionMap.facebook  || null,
        tiktok:    captionMap.tiktok    || null,
      },
    });
  } catch (err) {
    console.error('[postor] prefill error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST to Platforms (SSE Job) ──────────────────────────────────────────────

/**
 * POST /api/postor/post
 * Body: {
 *   video_path:    string  (absolute path to video file)
 *   project_id?:  number
 *   platforms:    string[] e.g. ['youtube', 'instagram', 'facebook']
 *   title:        string
 *   description:  string
 *   // YouTube-specific
 *   yt_tags?:          string[]
 *   yt_category_id?:   number
 *   yt_privacy?:       'public'|'unlisted'|'private'
 *   yt_scheduled_at?:  ISO datetime string
 *   // Instagram-specific
 *   ig_caption?:       string  (defaults to description)
 *   // Facebook-specific
 *   fb_description?:   string  (defaults to description)
 * }
 */
router.post('/post', (req, res) => {
  const {
    video_path, project_id, platforms,
    title, description,
    yt_tags, yt_category_id, yt_privacy, yt_scheduled_at,
    ig_caption, fb_description,
  } = req.body || {};

  if (!video_path)              return res.status(400).json({ error: 'video_path is required' });
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: 'platforms array required (e.g. ["youtube", "instagram"])' });
  }

  const job = createJob();
  res.json({ job_id: job.id });

  (async () => {
    const results = {};

    for (const platform of platforms) {
      if (platform === 'tiktok') {
        // Coming soon — skip gracefully
        pushEvent(job, { stage: 'skip', platform: 'tiktok', reason: 'TikTok integration coming soon' });
        continue;
      }

      // Create a pending post record
      const postRowId = db.createPostorPost({
        project_id:  project_id || null,
        platform,
        status:      'posting',
        video_path,
        title,
        description: platform === 'instagram' ? (ig_caption || description) : description,
        scheduled_at: platform === 'youtube' ? yt_scheduled_at : null,
      });

      pushEvent(job, { stage: 'platform_start', platform });

      try {
        let result;

        if (platform === 'youtube') {
          result = await youtube.uploadVideo({
            videoPath:     video_path,
            title,
            description,
            tags:          yt_tags,
            categoryId:    yt_category_id,
            privacyStatus: yt_privacy || 'public',
            scheduledAt:   yt_scheduled_at,
            onProgress:    (p) => pushEvent(job, p),
          });
        } else if (platform === 'instagram') {
          result = await meta.publishInstagramReel({
            videoPath: video_path,
            caption:   ig_caption || description || '',
            onProgress: (p) => pushEvent(job, p),
          });
        } else if (platform === 'facebook') {
          result = await meta.publishFacebookVideo({
            videoPath:   video_path,
            title,
            description: fb_description || description || '',
            onProgress:  (p) => pushEvent(job, p),
          });
        } else {
          throw new Error(`Unknown platform: ${platform}`);
        }

        db.updatePostorPost(postRowId, {
          status:   'posted',
          post_url: result.post_url || null,
          post_id:  result.post_id  || null,
          posted_at: new Date().toISOString(),
        });

        results[platform] = { ok: true, ...result };
        pushEvent(job, { stage: 'platform_done', platform, ...result });

        // Bridge: create a posts table row so MirrΩr sees this video immediately
        if (platform === 'youtube' && result.post_url) {
          try {
            db.savePost({
              project_id: project_id || null,
              platform:   'youtube',
              url:        result.post_url,
              title,
              posted_at:  new Date().toISOString(),
            });
          } catch (_) {} // non-fatal if post already exists
        }
      } catch (err) {
        console.error(`[postor] ${platform} post failed:`, err);
        db.updatePostorPost(postRowId, { status: 'failed', error: err.message });
        results[platform] = { ok: false, error: err.message };
        pushEvent(job, { stage: 'platform_error', platform, error: err.message });
      }
    }

    finishJob(job, { ok: true, results });
  })();
});

// ─── SSE Status Stream ────────────────────────────────────────────────────────

router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  attachSseStream(job, req, res);
});

// ─── BULK QUEUE POST (SSE Job) ───────────────────────────────────────────────
// POST /api/postor/post-queue
// Body: {
//   platforms:   string[]   — applies to all videos
//   shared:      { description, yt_privacy, yt_category_id, yt_tags, ig_caption, fb_description }
//   queue:       Array<{ video_path, title, description?, scheduled_at?, ig_caption?, fb_description? }>
// }

router.post('/post-queue', (req, res) => {
  const { platforms, shared = {}, queue } = req.body || {};

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: 'platforms array required' });
  }
  if (!Array.isArray(queue) || queue.length === 0) {
    return res.status(400).json({ error: 'queue array required' });
  }
  for (const [i, item] of queue.entries()) {
    if (!item.video_path) return res.status(400).json({ error: `queue[${i}] missing video_path` });
    if (!item.title)      return res.status(400).json({ error: `queue[${i}] missing title` });
  }

  const job = createJob();
  res.json({ job_id: job.id, total: queue.length });

  (async () => {
    const results = [];

    for (const [idx, item] of queue.entries()) {
      const { video_path, title, description, scheduled_at, ig_caption, fb_description, project_id } = item;

      pushEvent(job, {
        stage:       'queue_item_start',
        index:       idx,
        total:       queue.length,
        title,
        video_path,
      });

      const itemResults = {};

      for (const platform of platforms) {
        if (platform === 'tiktok') {
          pushEvent(job, { stage: 'skip', platform: 'tiktok', index: idx });
          continue;
        }

        const postRowId = db.createPostorPost({
          project_id:  project_id || null,
          platform,
          status:      'posting',
          video_path,
          title,
          description: description || shared.description || null,
          scheduled_at: platform === 'youtube' ? (scheduled_at || null) : null,
        });

        pushEvent(job, { stage: 'platform_start', platform, index: idx });

        try {
          let result;

          if (platform === 'youtube') {
            result = await youtube.uploadVideo({
              videoPath:     video_path,
              title,
              description:   description || shared.description || '',
              tags:          shared.yt_tags,
              categoryId:    shared.yt_category_id,
              privacyStatus: shared.yt_privacy || 'public',
              scheduledAt:   scheduled_at || null,
              onProgress:    (p) => pushEvent(job, { ...p, index: idx }),
            });
          } else if (platform === 'instagram') {
            result = await meta.publishInstagramReel({
              videoPath:  video_path,
              caption:    ig_caption || shared.ig_caption || description || shared.description || '',
              onProgress: (p) => pushEvent(job, { ...p, index: idx }),
            });
          } else if (platform === 'facebook') {
            result = await meta.publishFacebookVideo({
              videoPath:   video_path,
              title,
              description: fb_description || shared.fb_description || description || shared.description || '',
              onProgress:  (p) => pushEvent(job, { ...p, index: idx }),
            });
          }

          db.updatePostorPost(postRowId, {
            status:    'posted',
            post_url:  result.post_url || null,
            post_id:   result.post_id  || null,
            posted_at: new Date().toISOString(),
          });

          // Bridge to MirrΩr posts table
          if (platform === 'youtube' && result.post_url) {
            try {
              db.savePost({
                project_id: project_id || null,
                platform:   'youtube',
                url:        result.post_url,
                title,
                posted_at:  new Date().toISOString(),
              });
            } catch (_) {}
          }

          itemResults[platform] = { ok: true, ...result };
          pushEvent(job, { stage: 'platform_done', platform, index: idx, ...result });

        } catch (err) {
          console.error(`[postor/queue] ${platform} item ${idx} failed:`, err);
          db.updatePostorPost(postRowId, { status: 'failed', error: err.message });
          itemResults[platform] = { ok: false, error: err.message };
          pushEvent(job, { stage: 'platform_error', platform, index: idx, error: err.message });
        }
      }

      results.push({ index: idx, title, results: itemResults });
      pushEvent(job, { stage: 'queue_item_done', index: idx, total: queue.length, results: itemResults });
    }

    finishJob(job, { ok: true, total: queue.length, results });
  })();
});

// ─── YouTube Analytics Sync (SSE Job) ────────────────────────────────────────
// POST /api/postor/sync-analytics
// Pulls per-video metrics + monthly revenue from YouTube Analytics API v2
// and upserts into the analytics table (MirrΩr reads this directly).

router.post('/sync-analytics', (req, res) => {
  const conn = db.getPostorConnection('youtube');
  if (!conn) return res.status(400).json({ error: 'YouTube not connected — connect it in PostΩr first' });

  const job = createJob();
  res.json({ job_id: job.id });

  (async () => {
    try {
      const result = await ytAnalytics.syncYouTubeAnalytics(
        (p) => pushEvent(job, { stage: 'analytics', ...p })
      );
      finishJob(job, result);
    } catch (err) {
      console.error('[postor/sync-analytics] failed:', err);
      failJob(job, err.message);
    }
  })();
});

// GET /api/postor/analytics-status — last sync time + revenue summary
router.get('/analytics-status', (req, res) => {
  const conn = db.getPostorConnection('youtube');
  if (!conn) return res.json({ connected: false });

  const revenue = db.getMonthlyRevenue();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const thisMonth    = revenue.find(r => r.month === currentMonth);
  const lastMonth    = revenue.find(r => r.month < currentMonth);

  res.json({
    connected:           true,
    account_name:        conn.account_name,
    revenue_this_month:  thisMonth?.revenue_usd  || 0,
    revenue_last_month:  lastMonth?.revenue_usd  || 0,
    revenue_history:     revenue.slice(0, 12),
  });
});

// POST /api/postor/revenue/manual — manually enter monthly ad revenue
router.post('/revenue/manual', (req, res) => {
  const { month, revenue, platform = 'youtube' } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be YYYY-MM format' });
  }
  const amount = parseFloat(revenue);
  if (isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: 'revenue must be a non-negative number' });
  }
  try {
    db.upsertMonthlyRevenue(month, platform, amount);
    const history = db.getMonthlyRevenue();
    res.json({ ok: true, month, revenue: amount, platform, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Premiere Videos — projects available for Video Premiere email in MailΩr ──
// Returns all active kre8r-created projects (newest first) so the user can pick
// any video and supply the YouTube URL directly in the MailΩr UI — no pre-linking
// in MirrΩr required. Also includes any already-linked youtube_video_id so the
// URL field auto-fills if it was previously linked.

router.get('/premiere-videos', (req, res) => {
  try {
    const rawDb = db.getRawDb();
    const projects = rawDb
      ? rawDb.prepare(`
          SELECT p.id, p.title, p.topic, p.content_type,
                 p.youtube_video_id, p.youtube_url, p.published_at, p.created_at,
                 p.source, p.high_concept
          FROM projects p
          WHERE p.status != 'archived'
            AND p.source IN ('kre8r', 'youtube_import')
          ORDER BY COALESCE(p.published_at, p.created_at) DESC
          LIMIT 100
        `).all()
      : [];

    const videos = projects.map(pr => ({
      project_id:   pr.id,
      title:        pr.title || 'Untitled',
      youtube_id:   pr.youtube_video_id || null,
      youtube_url:  pr.youtube_url || (pr.youtube_video_id
        ? `https://www.youtube.com/watch?v=${pr.youtube_video_id}` : null),
      posted_at:    pr.published_at || pr.created_at,
      topic:        pr.topic || '',
      hook:         pr.high_concept || '',
      content_type: pr.content_type || 'long',
      source:       pr.source,
    }));

    res.json({ videos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Post History ─────────────────────────────────────────────────────────────

router.get('/history', (req, res) => {
  const { project_id, platform, limit } = req.query;
  const posts = db.getPostorPosts({
    project_id: project_id ? parseInt(project_id, 10) : undefined,
    platform:   platform   || undefined,
    limit:      limit      ? parseInt(limit, 10) : 50,
  });
  res.json({ posts });
});

module.exports = router;
