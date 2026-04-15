/**
 * MailerliteΩr — src/routes/mailerlite.js
 *
 * Mailerlite v2 API integration for MailΩr broadcast + AudiencΩr
 *
 * GET  /api/mailerlite/status                — check key + verify against API
 * POST /api/mailerlite/groups/sync           — create/ensure the 3 tier groups exist
 * POST /api/mailerlite/subscribers/import    — bulk import subscribers to a group
 * POST /api/mailerlite/send                  — create campaign + add content + send
 * GET  /api/mailerlite/stats                 — last 10 campaigns with rates
 */

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const log     = require('../utils/logger');

const ML_BASE = 'https://connect.mailerlite.com/api';

// ── Helper: get profile path ───────────────────────────────────────────────────
function getProfilePath() {
  return process.env.CREATOR_PROFILE_PATH
    || path.join(__dirname, '../../creator-profile.json');
}

function loadProfile() {
  const p = getProfilePath();
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveProfile(profile) {
  const p = getProfilePath();
  fs.writeFileSync(p, JSON.stringify(profile, null, 2), 'utf8');
}

// ── Helper: Mailerlite API caller ──────────────────────────────────────────────
async function ml(method, path_, body = null) {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) throw new Error('MAILERLITE_API_KEY not set');

  const { default: fetch } = await import('node-fetch');
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${ML_BASE}${path_}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }

  if (!res.ok) {
    const msg = data?.message || data?.error || `Mailerlite API ${res.status}: ${path_}`;
    log.error({ module: 'mailerlite', status: res.status, path: path_, body: data }, msg);
    throw new Error(msg);
  }
  return data;
}

// ── GET /api/mailerlite/sender ─────────────────────────────────────────────────
// Returns the configured from_name and from_email for campaigns.

router.get('/sender', (req, res) => {
  try {
    // Env vars take priority — immune to profile overwrites
    let fromEmail = process.env.MAILERLITE_FROM_EMAIL || '';
    let fromName  = process.env.MAILERLITE_FROM_NAME  || '';

    // Fall back to profile if env vars not set
    if (!fromEmail || !fromName) {
      try {
        const profile = loadProfile();
        const creator = profile?.creator || {};
        if (!fromEmail) fromEmail = creator.email    || '';
        if (!fromName)  fromName  = creator.from_name || creator.brand || creator.name || '';
      } catch (_) {}
    }

    res.json({ ok: true, from_email: fromEmail, from_name: fromName });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'sender endpoint failed');
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/mailerlite/status ─────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  const hasKey = !!process.env.MAILERLITE_API_KEY;
  if (!hasKey) {
    return res.json({ connected: false, reason: 'MAILERLITE_API_KEY not set' });
  }
  try {
    const data       = await ml('GET', '/groups?limit=25');
    const groups     = (data.data || []).map(g => ({
      id:    g.id,
      name:  g.name,
      total: g.active_count ?? g.total ?? 0,
    }));
    res.json({ connected: true, groupCount: groups.length, groups });
  } catch (e) {
    log.warn({ module: 'mailerlite', err: e }, 'Status check failed');
    res.json({ connected: false, reason: e.message });
  }
});

// ── POST /api/mailerlite/groups/sync ──────────────────────────────────────────
// Creates the 3 community tier groups in Mailerlite if they don't already exist.
// Stores the resulting IDs in creator-profile.json under integrations.mailerlite_groups.

const TIER_GROUPS = [
  { key: 'greenhouse', name: 'Greenhouse 🌱' },
  { key: 'garden',     name: 'Garden 🌿'     },
  { key: 'founding50', name: 'Founding 50 🏆' },
];

router.post('/groups/sync', async (req, res) => {
  try {
    const existing = (await ml('GET', '/groups?limit=100')).data || [];
    const existingByName = {};
    for (const g of existing) existingByName[g.name] = g;

    const results = [];

    for (const tier of TIER_GROUPS) {
      if (existingByName[tier.name]) {
        results.push({ key: tier.key, name: tier.name, id: existingByName[tier.name].id, created: false });
      } else {
        const created = await ml('POST', '/groups', { name: tier.name });
        results.push({ key: tier.key, name: tier.name, id: created.data.id, created: true });
        log.info({ module: 'mailerlite', group: tier.name, id: created.data.id }, 'Mailerlite group created');
      }
    }

    // Persist group IDs to creator-profile.json
    try {
      const profile = loadProfile();
      if (!profile.integrations) profile.integrations = {};
      profile.integrations.mailerlite_groups = {};
      for (const r of results) {
        profile.integrations.mailerlite_groups[r.key] = r.id;
      }
      saveProfile(profile);
      log.info({ module: 'mailerlite' }, 'Mailerlite group IDs saved to creator-profile.json');
    } catch (profErr) {
      log.warn({ module: 'mailerlite', err: profErr }, 'Could not save group IDs to creator-profile.json — IDs returned in response');
    }

    res.json({ ok: true, groups: results });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'groups/sync failed');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/mailerlite/subscribers/import ───────────────────────────────────
// Accepts { subscribers: [{email, name, group}] }
// group: 'greenhouse' | 'garden' | 'founding50' OR a raw Mailerlite group ID

router.post('/subscribers/import', async (req, res) => {
  try {
    const { subscribers } = req.body;
    if (!Array.isArray(subscribers) || subscribers.length === 0) {
      return res.status(400).json({ error: 'subscribers array is required' });
    }

    // Resolve group IDs — support both tier key and raw ML group ID
    let groupIds;
    try {
      const profile = loadProfile();
      groupIds = profile?.integrations?.mailerlite_groups || {};
    } catch (_) {
      groupIds = {};
    }

    const groupKey = (subscribers[0]?.group) || 'greenhouse';
    // If it looks like a raw ML ID (numeric string), use directly; otherwise look up tier key
    const groupId  = /^\d+$/.test(groupKey) ? groupKey : (groupIds[groupKey] || null);

    // Build CSV
    const csvLines = ['email,name'];
    for (const sub of subscribers) {
      const email = (sub.email || '').replace(/"/g, '""');
      const name  = (sub.name  || '').replace(/"/g, '""');
      csvLines.push(`"${email}","${name}"`);
    }
    const csvContent = csvLines.join('\n');

    // POST as multipart/form-data — required by Mailerlite batch import endpoint
    const { default: fetch } = await import('node-fetch');
    const apiKey = process.env.MAILERLITE_API_KEY;
    if (!apiKey) throw new Error('MAILERLITE_API_KEY not set');

    const form = new FormData();
    form.append('file', new Blob([csvContent], { type: 'text/csv' }), 'subscribers.csv');
    form.append('columns[]', 'email');
    form.append('columns[]', 'name');
    if (groupId) form.append('groups[]', groupId);

    const mlRes = await fetch(`${ML_BASE}/subscribers/import`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept':        'application/json',
        // No Content-Type header — let fetch set it with the multipart boundary
      },
      body: form,
    });

    const text = await mlRes.text();
    let mlData;
    try { mlData = text ? JSON.parse(text) : {}; } catch (_) { mlData = {}; }

    if (!mlRes.ok) {
      throw new Error(mlData?.message || mlData?.error || `Mailerlite import failed: ${mlRes.status}`);
    }

    log.info({ module: 'mailerlite', count: subscribers.length, groupId }, 'Batch import submitted');
    res.json({ ok: true, imported: subscribers.length, failed: 0 });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'subscribers/import failed');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/mailerlite/send ──────────────────────────────────────────────────
// Creates a campaign, sets content, sends immediately.
//
// Body: { subject, html_body, group_ids: ['greenhouse'|'garden'|'founding50'|'all'],
//         from_name, from_email }

router.post('/send', async (req, res) => {
  try {
    const {
      subject,
      html_body,
      group_ids = ['all'],
      from_name,
      from_email,
    } = req.body;

    if (!subject)   return res.status(400).json({ error: 'subject is required' });
    if (!html_body) return res.status(400).json({ error: 'html_body is required' });

    // Wrap bare HTML in a minimal email-safe container so it renders consistently
    // across email clients (Outlook, Gmail, Apple Mail, etc.)
    const wrappedHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
      <tr><td style="color:#222222;font-family:Georgia,serif;font-size:16px;line-height:1.7;">
        ${html_body}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    // Resolve sender — env vars take priority (immune to profile overwrites)
    let senderName  = from_name  || process.env.MAILERLITE_FROM_NAME  || '';
    let senderEmail = from_email || process.env.MAILERLITE_FROM_EMAIL || '';

    // Resolve group IDs from creator-profile.json
    let mlGroupIds = [];

    try {
      const profile  = loadProfile();
      const groupMap = profile?.integrations?.mailerlite_groups || {};
      const creator  = profile?.creator || {};

      if (!senderName)  senderName  = creator.from_name || creator.brand || creator.name || '';
      if (!senderEmail) senderEmail = creator.email || '';

      // 'all' = no group filter (sends to every active subscriber in account)
      // Only filter by group when specific tier keys are selected
      if (!group_ids.includes('all')) {
        for (const key of group_ids) {
          if (groupMap[key]) mlGroupIds.push(groupMap[key]);
        }
      }
    } catch (profileErr) {
      log.warn({ module: 'mailerlite', err: profileErr.message }, 'Could not load profile in /send');
    }

    if (!senderEmail) {
      return res.status(400).json({ error: 'Sender email not configured — set MAILERLITE_FROM_EMAIL in .env' });
    }
    if (!senderName) senderName = 'Kre8r';

    // 1. Create campaign — ML v2: no top-level subject; emails[].from (not from_email)
    const campaignBody = {
      name: `${subject} — ${new Date().toISOString().slice(0, 10)}`,
      type: 'regular',
      emails: [{
        subject,
        from_name: senderName,
        from:      senderEmail,
        reply_to:  senderEmail,
        content:   wrappedHtml,
      }],
    };

    if (mlGroupIds.length > 0) {
      campaignBody.groups = mlGroupIds;
    }

    log.info({ module: 'mailerlite', campaignBody: JSON.stringify(campaignBody) }, 'Creating campaign');

    let campaign;
    try {
      campaign = await ml('POST', '/campaigns', campaignBody);
    } catch (createErr) {
      throw new Error(`Campaign create failed: ${createErr.message}`);
    }
    const campaignId = campaign?.data?.id;

    if (!campaignId) {
      throw new Error('Mailerlite did not return a campaign ID — response: ' + JSON.stringify(campaign));
    }

    log.info({ module: 'mailerlite', campaignId, subject }, 'Campaign created');

    // 2. Send immediately — ML v2 uses /schedule with delivery:instant (no /actions/send endpoint)
    try {
      await ml('POST', `/campaigns/${campaignId}/schedule`, { delivery: 'instant' });
    } catch (sendErr) {
      throw new Error(`Campaign send failed (id=${campaignId}): ${sendErr.message}`);
    }

    log.info({ module: 'mailerlite', campaignId }, 'Campaign sent');

    res.json({ ok: true, campaign_id: campaignId, status: 'sent' });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'send failed');
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/mailerlite/groups/:id/subscribers ────────────────────────────────
// Returns paginated subscriber list for a group.
// Query: ?limit=25&page=1

router.get('/groups/:id/subscribers', async (req, res) => {
  try {
    const { id }   = req.params;
    const limit    = Math.min(parseInt(req.query.limit) || 25, 100);
    const page     = parseInt(req.query.page) || 1;

    const data = await ml('GET', `/groups/${id}/subscribers?limit=${limit}&page=${page}&filter[status]=active`);

    const subscribers = (data.data || []).map(s => ({
      id:         s.id,
      email:      s.email,
      name:       s.fields?.name || s.fields?.last_name
                    ? `${s.fields?.name || ''} ${s.fields?.last_name || ''}`.trim()
                    : '',
      status:     s.status,
      created_at: s.created_at,
    }));

    res.json({
      ok:          true,
      subscribers,
      total:       data.meta?.total ?? (data.total ?? 0),
      page:        data.meta?.current_page ?? page,
      last_page:   data.meta?.last_page ?? 1,
    });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'groups/subscribers failed');
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/mailerlite/groups/create ────────────────────────────────────────
// Creates a new Mailerlite group and optionally saves a keyword→id mapping.
// Body: { name, keyword }  (keyword is optional)

router.post('/groups/create', async (req, res) => {
  try {
    const { name, keyword } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Check if already exists
    const existing = (await ml('GET', '/groups?limit=100')).data || [];
    let group = existing.find(g => g.name === name.trim());

    if (!group) {
      const created = await ml('POST', '/groups', { name: name.trim() });
      group = created.data;
      log.info({ module: 'mailerlite', group: group.name, id: group.id }, 'Custom group created');
    }

    // Persist keyword mapping if provided
    if (keyword && keyword.trim()) {
      try {
        const profile = loadProfile();
        if (!profile.integrations) profile.integrations = {};
        if (!profile.integrations.custom_group_mappings) profile.integrations.custom_group_mappings = {};
        profile.integrations.custom_group_mappings[keyword.trim().toLowerCase()] = group.id;
        saveProfile(profile);
        log.info({ module: 'mailerlite', keyword, id: group.id }, 'Custom group mapping saved');
      } catch (profErr) {
        log.warn({ module: 'mailerlite', err: profErr }, 'Could not save mapping to profile');
      }
    }

    res.json({ ok: true, group: { id: group.id, name: group.name }, keyword: keyword || null });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'groups/create failed');
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/mailerlite/mappings ───────────────────────────────────────────────
// Returns the current custom keyword→groupId mappings from creator-profile.json.

router.get('/mappings', (req, res) => {
  try {
    const profile  = loadProfile();
    const mappings = profile?.integrations?.custom_group_mappings || {};
    const groups   = profile?.integrations?.mailerlite_groups || {};
    res.json({ ok: true, mappings, tier_groups: groups });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DELETE /api/mailerlite/mappings/:keyword ──────────────────────────────────
// Removes a custom keyword mapping.

router.delete('/mappings/:keyword', (req, res) => {
  try {
    const key = decodeURIComponent(req.params.keyword);
    const profile = loadProfile();
    if (profile?.integrations?.custom_group_mappings) {
      delete profile.integrations.custom_group_mappings[key];
      saveProfile(profile);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/mailerlite/groups/:id/reset ─────────────────────────────────────
// Nuclear option: delete the group and recreate it with the same name.
// Updates creator-profile.json with the new group ID.
// Use this when a group has been corrupted with bad data.

router.post('/groups/:id/reset', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get the group name before deleting
    const groupData = await ml('GET', `/groups/${id}`);
    const groupName = groupData?.data?.name;
    if (!groupName) return res.status(404).json({ error: 'Group not found' });

    // 2. Delete the group (subscribers are NOT deleted, just ungruped)
    await ml('DELETE', `/groups/${id}`);
    log.info({ module: 'mailerlite', groupId: id, groupName }, 'Group deleted for reset');

    // 3. Recreate with same name
    const created    = await ml('POST', '/groups', { name: groupName });
    const newGroupId = created?.data?.id;
    if (!newGroupId) throw new Error('MailerLite did not return new group ID');
    log.info({ module: 'mailerlite', newGroupId, groupName }, 'Group recreated');

    // 4. Update creator-profile.json if this is a known tier group
    try {
      const profile  = loadProfile();
      const groupMap = profile?.integrations?.mailerlite_groups || {};
      for (const [key, val] of Object.entries(groupMap)) {
        if (val === id) {
          groupMap[key] = newGroupId;
          log.info({ module: 'mailerlite', key, newGroupId }, 'Updated group ID in profile');
        }
      }
      profile.integrations.mailerlite_groups = groupMap;
      saveProfile(profile);
    } catch (profErr) {
      log.warn({ module: 'mailerlite', err: profErr }, 'Could not update profile — update manually');
    }

    res.json({ ok: true, old_id: id, new_id: newGroupId, name: groupName });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'Group reset failed');
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/mailerlite/groups/:id/subscribers/all ─────────────────────────
// Remove ALL subscribers from a group (cleans up bad sync data).
// Does NOT delete the subscribers themselves — just removes group membership.

router.delete('/groups/:id/subscribers/all', async (req, res) => {
  try {
    const { id } = req.params;
    let removed  = 0;
    let hasMore  = true;

    // Always fetch page 1 — list shrinks as we remove, so never increment page
    while (hasMore) {
      const data = await ml('GET', `/groups/${id}/subscribers?limit=100&filter[status]=active`);
      const subs = data.data || [];
      if (!subs.length) { hasMore = false; break; }

      for (const sub of subs) {
        try {
          await ml('DELETE', `/subscribers/${sub.id}/groups/${id}`);
          removed++;
        } catch (_) {}
      }
    }

    log.info({ module: 'mailerlite', groupId: id, removed }, 'Group cleared');
    res.json({ ok: true, group_id: id, removed });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'Group clear failed');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/mailerlite/premiere-email ───────────────────────────────────────
// Generates a video premiere email — mystery/teaser style, drives to YouTube.
// Body: { title, description, post_url, topic, angle, hook, content_type }

router.post('/premiere-email', async (req, res) => {
  try {
    const { title, description, post_url, topic, angle, hook, content_type } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });

    const profile      = loadProfile();
    const creatorName  = profile?.creator?.name || 'Jason';
    const brandName    = profile?.creator?.brand || '7 Kin Homestead';
    const voice        = profile?.creator?.voice_summary || 'Straight-talking, warm, funny, never corporate.';
    const { callClaude } = require('../utils/claude');

    const contextLines = [];
    if (topic)       contextLines.push(`Topic: ${topic}`);
    if (angle)       contextLines.push(`Content angle: ${angle}`);
    if (hook)        contextLines.push(`Hook/opening beat: ${hook}`);
    if (description) contextLines.push(`Video description: ${description.slice(0, 400)}`);
    if (post_url)    contextLines.push(`YouTube URL: ${post_url}`);

    const isShort = content_type === 'short';

    const prompt = `You are writing a video premiere email for ${creatorName} from ${brandName}.

A new ${isShort ? 'short-form video' : 'video'} just went live on YouTube. Your job is to write an email that makes the reader feel like ${creatorName} personally tapped them on the shoulder and said "hey, you need to see this."

Creator voice: ${voice}

Video context:
${contextLines.join('\n')}

RULES:
- Write in first person as ${creatorName} — "I filmed", "I wasn't sure", "this one surprised me"
- Create mystery and personal investment WITHOUT being click-baity or fake
- Do NOT summarise the whole video — tease one tension or unexpected moment
- The email should feel like a real person sent it, not a marketing blast
- 2–4 short paragraphs max. Punchy. No fluff.
- End with a single clear CTA: watch the video (include the URL if provided)
- Subject line: intriguing, personal, 8 words or fewer
- Use {$name} once near the top (this is MailerLite's native merge tag for first name)

Return ONLY valid JSON in this exact shape:
{
  "subject": "...",
  "body": "<p>...</p><p>...</p>"
}`;

    const result = await callClaude(prompt, 1024);
    if (!result?.subject || !result?.body) throw new Error('Claude response missing subject or body');

    res.json({ ok: true, subject: result.subject, body: result.body });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'premiere-email generate failed');
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/mailerlite/stats ──────────────────────────────────────────────────
// Last 10 campaigns with open/click rates.

router.get('/stats', async (req, res) => {
  try {
    const data      = await ml('GET', '/campaigns?limit=10&sort=-created_at');
    const campaigns = (data.data || []).map(c => ({
      id:         c.id,
      subject:    c.emails?.[0]?.subject || c.name || '—',
      status:     c.status,
      sent_at:    c.sent_at,
      open_rate:  c.stats?.open_rate  ?? null,
      click_rate: c.stats?.click_rate ?? null,
      total_sent: c.stats?.sent       ?? null,
    }));
    res.json({ ok: true, campaigns });
  } catch (e) {
    log.error({ module: 'mailerlite', err: e }, 'stats failed');
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
