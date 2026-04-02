/**
 * KajabiΩr — src/routes/kajabi.js
 * Kajabi Public API integration
 *
 * Auth: OAuth2 client_credentials, token cached in memory, auto-refreshed
 *
 * GET  /api/kajabi/status          — connection check
 * GET  /api/kajabi/contacts        — list contacts with optional tag/tier filter
 * GET  /api/kajabi/tags            — list all contact tags
 * POST /api/kajabi/tag             — add tag to a contact or segment
 * DEL  /api/kajabi/tag             — remove tag from contact
 * GET  /api/kajabi/offers          — list Rock Rich offers/tiers
 * POST /api/kajabi/grant           — grant offer to contact
 * DEL  /api/kajabi/revoke          — revoke offer from contact
 * POST /api/kajabi/broadcast-tag   — add tag to all contacts in a segment (triggers automation)
 */

const express = require('express');
const router  = express.Router();

const KAJABI_API  = 'https://api.kajabi.com/v1';
const TOKEN_URL   = 'https://api.kajabi.com/v1/oauth/token';

// ─── Token cache ─────────────────────────────────────────────────────────────

let _token     = null;
let _tokenExp  = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;

  const { default: fetch } = await import('node-fetch');
  const res = await fetch(TOKEN_URL, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body    : new URLSearchParams({
      grant_type    : 'client_credentials',
      client_id     : process.env.KAJABI_CLIENT_ID,
      client_secret : process.env.KAJABI_CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`Kajabi auth failed: ${res.status}`);
  const data  = await res.json();
  _token      = data.access_token;
  _tokenExp   = Date.now() + (data.expires_in * 1000);
  return _token;
}

async function kajabi(method, path, body) {
  const { default: fetch } = await import('node-fetch');
  const token = await getToken();
  const opts  = {
    method,
    headers: {
      'Authorization' : `Bearer ${token}`,
      'Content-Type'  : 'application/json',
      'Accept'        : 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  console.log('[kajabi] →', method, path);
  const res  = await fetch(`${KAJABI_API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[kajabi] API error:', res.status, JSON.stringify(data));
    throw new Error(data?.error || data?.message || `Kajabi API ${res.status}: ${path}`);
  }
  return data;
}

// ─── GET /api/kajabi/status ───────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  const hasKeys = !!(process.env.KAJABI_CLIENT_ID && process.env.KAJABI_CLIENT_SECRET);
  if (!hasKeys) return res.json({ connected: false, reason: 'Missing API credentials' });
  try {
    const me = await kajabi('GET', '/me');
    res.json({ connected: true, site: me?.data?.attributes?.name || 'Connected' });
  } catch (e) {
    res.json({ connected: false, reason: e.message });
  }
});

// ─── GET /api/kajabi/contacts ─────────────────────────────────────────────────

router.get('/contacts', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    console.log('[kajabi/contacts] fetching page', page);
    const data = await kajabi('GET', `/contacts`);
    res.json(data);
  } catch (e) {
    console.error('[kajabi/contacts]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kajabi/tags ─────────────────────────────────────────────────────

router.get('/tags', async (req, res) => {
  try {
    const data = await kajabi('GET', '/contact_tags');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kajabi/tag ─────────────────────────────────────────────────────
// Add a tag to a single contact

router.post('/tag', async (req, res) => {
  try {
    const { contact_id, tag_id } = req.body;
    if (!contact_id || !tag_id) return res.status(400).json({ error: 'contact_id and tag_id required' });
    const data = await kajabi('POST', `/contacts/${contact_id}/tags`, { tag_id });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/kajabi/tag ───────────────────────────────────────────────────

router.delete('/tag', async (req, res) => {
  try {
    const { contact_id, tag_id } = req.body;
    if (!contact_id || !tag_id) return res.status(400).json({ error: 'contact_id and tag_id required' });
    await kajabi('DELETE', `/contacts/${contact_id}/tags/${tag_id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/kajabi/offers ───────────────────────────────────────────────────

router.get('/offers', async (req, res) => {
  try {
    const data = await kajabi('GET', '/offers');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kajabi/grant ───────────────────────────────────────────────────

router.post('/grant', async (req, res) => {
  try {
    const { contact_id, offer_id } = req.body;
    if (!contact_id || !offer_id) return res.status(400).json({ error: 'contact_id and offer_id required' });
    const data = await kajabi('POST', `/contacts/${contact_id}/offers`, { offer_id });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/kajabi/revoke ────────────────────────────────────────────────

router.delete('/revoke', async (req, res) => {
  try {
    const { contact_id, offer_id } = req.body;
    if (!contact_id || !offer_id) return res.status(400).json({ error: 'contact_id and offer_id required' });
    await kajabi('DELETE', `/contacts/${contact_id}/offers/${offer_id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kajabi/broadcast-tag ──────────────────────────────────────────
// Add a tag to ALL contacts in a segment — triggers Kajabi automations
// This is the power move — one tag fires your whole email sequence

router.post('/broadcast-tag', async (req, res) => {
  try {
    const { tag_id, filter_tag_id, label } = req.body;
    if (!tag_id) return res.status(400).json({ error: 'tag_id required' });

    // Stream SSE for progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    // Paginate through contacts
    let page    = 1;
    let total   = 0;
    let tagged  = 0;
    let hasMore = true;

    send({ stage: 'start', message: `Tagging contacts${label ? ` for: ${label}` : ''}...` });

    while (hasMore) {
      const path = filter_tag_id
        ? `/contacts?filter[tag]=${filter_tag_id}&page=${page}`
        : `/contacts?page=${page}`;

      const data     = await kajabi('GET', path);
      const contacts = data?.data || [];
      const meta     = data?.meta || {};

      if (contacts.length === 0) { hasMore = false; break; }

      total += contacts.length;

      for (const contact of contacts) {
        try {
          await kajabi('POST', `/contacts/${contact.id}/tags`, { tag_id });
          tagged++;
        } catch (_) { /* skip failed contacts */ }
      }

      send({ stage: 'progress', tagged, total, page });

      // Check if more pages
      hasMore = meta.next_page != null;
      page++;
    }

    send({ stage: 'done', tagged, total, message: `Tagged ${tagged} of ${total} contacts` });
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ stage: 'error', error: e.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
