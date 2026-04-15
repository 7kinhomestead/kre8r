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

// ─── GET  /api/kajabi/webhooks ────────────────────────────────────────────────
// List registered Kajabi webhooks

router.get('/webhooks', async (req, res) => {
  try {
    const data = await kajabi('GET', '/webhooks');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kajabi/webhooks/register ───────────────────────────────────────
// Register our webhook endpoint with Kajabi
// Body: { url } — defaults to https://kre8r.app/api/kajabi-webhook/receive

router.post('/webhooks/register', async (req, res) => {
  try {
    const url    = req.body?.url || 'https://kre8r.app/api/kajabi-webhook/receive';
    const events = req.body?.events || [
      'member.created',
      'purchase.created',
      'offer.purchase',
      'member.removed',
    ];
    const data = await kajabi('POST', '/webhooks', { url, events });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/kajabi/bulk-sync-mailerlite ────────────────────────────────────
// Pulls all Kajabi contacts, determines their community tier from offer membership,
// and upserts them into the correct MailerLite groups.
//
// Tier offer IDs (hardcoded from live Kajabi data, also in req.body.offerMap):
//   Greenhouse: 2151041075
//   Garden:     2151041176
//   Founding50: 2151042381, 2151040759
//
// Strategy:
//   1. Pull contacts for Garden + Founding50 offers (offer filter) → tier map
//   2. Pull ALL contacts (paginated) → anyone not in a paid tier = Greenhouse
//   3. Upsert each contact to MailerLite with correct group

const ML_BASE_SYNC = 'https://connect.mailerlite.com/api';

async function mlUpsert(email, name, groupId) {
  const { default: fetch } = await import('node-fetch');
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) throw new Error('MAILERLITE_API_KEY not set');
  const body = { email, fields: {}, groups: [groupId] };
  if (name) body.fields.name = name;
  const res  = await fetch(`${ML_BASE_SYNC}/subscribers`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
  if (!res.ok && res.status !== 422) { // 422 = already exists, fine
    throw new Error(data?.message || `MailerLite ${res.status}`);
  }
  return data;
}

// Tag IDs from live Kajabi data — used for tier detection from inline tag relationships
const KAJABI_TIER_TAGS = {
  '2150101640': 'founding50',  // Founding 50 - Member
  '2150101641': 'garden',      // Garden - Member
  '2150101628': 'greenhouse',  // Greenhouse - Member
};
const TIER_PRIORITY = { founding50: 3, garden: 2, greenhouse: 1 };

function detectTierFromContact(contact) {
  // Tags are inline in relationships.tags.data — no extra API call needed
  const tagRefs = contact?.relationships?.tags?.data || [];
  let best = null;
  for (const ref of tagRefs) {
    const tier = KAJABI_TIER_TAGS[ref.id];
    if (tier && (!best || TIER_PRIORITY[tier] > TIER_PRIORITY[best])) {
      best = tier;
    }
  }
  return best || 'greenhouse'; // default to greenhouse if no tier tag
}

async function kajabiAllContacts() {
  // Kajabi includes tag relationships inline — single pass, no extra calls
  const contacts = [];
  let pageNum = 1;
  let hasMore = true;
  while (hasMore) {
    const path = `/contacts?page[number]=${pageNum}`;
    let data;
    try {
      data = await kajabi('GET', path);
    } catch (e) {
      console.warn('[bulk-sync] Kajabi fetch error:', e.message);
      break;
    }
    const batch = data?.data || [];
    if (!batch.length) break;
    contacts.push(...batch);
    hasMore = !!(data?.links?.next);
    pageNum++;
    // brief pause between pages to be kind to Kajabi
    if (hasMore) await new Promise(r => setTimeout(r, 100));
  }
  return contacts;
}

// ─── Core bulk-sync logic (also called by morning scheduler) ─────────────────

async function runBulkSync({ memberOnly = true } = {}) {
  const fs   = require('fs');
  const path = require('path');
  const profilePath = process.env.CREATOR_PROFILE_PATH
    || path.join(__dirname, '../../creator-profile.json');
  const profile  = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const groupMap = profile?.integrations?.mailerlite_groups || {};

  if (!groupMap.greenhouse || !groupMap.garden || !groupMap.founding50) {
    throw new Error('MailerLite group IDs not configured — run /api/mailerlite/groups/sync first');
  }

  console.log('[bulk-sync] Fetching all Kajabi contacts...');
  const allContacts = await kajabiAllContacts();
  console.log(`[bulk-sync] Got ${allContacts.length} contacts from Kajabi`);

  const contactTier = {};
  for (const c of allContacts) {
    const email = c?.attributes?.email;
    if (!email) continue;
    contactTier[email] = {
      tier: detectTierFromContact(c),
      name: c?.attributes?.name || '',
    };
  }

  const results = { greenhouse: 0, garden: 0, founding50: 0, skipped: 0, errors: 0, error_list: [] };
  const entries = Object.entries(contactTier);

  for (const [email, { tier, name }] of entries) {
    if (memberOnly) {
      const c = allContacts.find(x => x?.attributes?.email === email);
      const tagRefs = c?.relationships?.tags?.data || [];
      const hasMemberTag = tagRefs.some(r => KAJABI_TIER_TAGS[r.id]);
      if (!hasMemberTag) { results.skipped++; continue; }
    }

    const mlGroupId = groupMap[tier];
    if (!mlGroupId) continue;
    try {
      await mlUpsert(email, name, mlGroupId);
      results[tier]++;
    } catch (e) {
      results.errors++;
      results.error_list.push({ email, error: e.message });
      console.warn('[bulk-sync] ML upsert failed:', email, e.message);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  return {
    ok:    true,
    total: entries.length,
    synced: results.greenhouse + results.garden + results.founding50,
    breakdown: { greenhouse: results.greenhouse, garden: results.garden, founding50: results.founding50 },
    errors: results.errors,
    error_list: results.error_list.slice(0, 10),
  };
}

router.post('/bulk-sync-mailerlite', async (req, res) => {
  try {
    const memberOnly = req.body?.memberOnly !== false; // default true
    const result = await runBulkSync({ memberOnly });
    res.json(result);
  } catch (e) {
    console.error('[bulk-sync-mailerlite]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.runBulkSync = runBulkSync;
