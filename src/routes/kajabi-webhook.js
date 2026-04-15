/**
 * Kajabi → Mailerlite Webhook Receiver — src/routes/kajabi-webhook.js
 *
 * Receives Kajabi member/purchase events and syncs them to the correct
 * Mailerlite group based on the community tier.
 *
 * POST /api/kajabi-webhook/receive  — PUBLIC — Kajabi calls this
 * POST /api/kajabi-webhook/test     — auth-protected dry run
 * GET  /api/kajabi-webhook/config   — auth-protected config + recent log
 */

const express              = require('express');
const router               = express.Router();
const fs                   = require('fs');
const path                 = require('path');
const log                  = require('../utils/logger');
const { callClaude }       = require('../utils/claude');

const ML_BASE = 'https://connect.mailerlite.com/api';

// ── Profile helpers ────────────────────────────────────────────────────────────

function getProfilePath() {
  return process.env.CREATOR_PROFILE_PATH
    || path.join(__dirname, '../../creator-profile.json');
}

function loadProfile() {
  return JSON.parse(fs.readFileSync(getProfilePath(), 'utf8'));
}

function getGroupIds() {
  try {
    const profile = loadProfile();
    return profile?.integrations?.mailerlite_groups || {};
  } catch (_) {
    return {};
  }
}

// ── Mailerlite API caller ──────────────────────────────────────────────────────

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
    log.error({ module: 'kajabi-webhook', status: res.status, path: path_, body: data }, msg);
    throw new Error(msg);
  }
  return data;
}

// ── Webhook event log (kv_store) ───────────────────────────────────────────────

const LOG_KEY   = 'kajabi_webhook_log';
const LOG_LIMIT = 20;

function readEventLog() {
  try {
    const db = require('../db');
    return db.getKv(LOG_KEY) || [];
  } catch (_) {
    return [];
  }
}

function appendEventLog(entry) {
  try {
    const db  = require('../db');
    const log_ = readEventLog();
    log_.unshift(entry);               // newest first
    if (log_.length > LOG_LIMIT) log_.length = LOG_LIMIT;
    db.setKv(LOG_KEY, log_);
  } catch (err) {
    log.warn({ module: 'kajabi-webhook', err }, 'Could not write to webhook event log');
  }
}

// ── Tier resolver ──────────────────────────────────────────────────────────────
// Tries tag-based detection first (from webhook payload tags array),
// falls back to offer title matching.
//
// Kajabi sends tag IDs in some webhook payloads under data.member.tags or data.tags.
// Tag IDs from live Kajabi data:
const TIER_TAG_IDS = {
  '2150101640': 'founding50',  // Founding 50 - Member
  '2150101641': 'garden',      // Garden - Member
  '2150101628': 'greenhouse',  // Greenhouse - Member
};

function resolveGroupKey(offerTitle, tagIds = []) {
  // Tag-based detection (most reliable)
  const tierPriority = { founding50: 3, garden: 2, greenhouse: 1 };
  let bestTier = null;
  for (const id of tagIds) {
    const tier = TIER_TAG_IDS[String(id)];
    if (tier && (!bestTier || tierPriority[tier] > tierPriority[bestTier])) {
      bestTier = tier;
    }
  }
  if (bestTier) return bestTier;

  // Fall back to offer title matching
  if (!offerTitle) return 'greenhouse';
  const t = offerTitle.toLowerCase();
  if (t.includes('founding') || t.includes('297') || t.includes('founding 50')) return 'founding50';
  if (t.includes('garden') || t.includes('19')) return 'garden';
  return 'greenhouse';
}

// ── Core processing logic ──────────────────────────────────────────────────────
// Returns { email, first_name, last_name, groupKey, groupId, action, notes }
// action: 'add' | 'skip'

function parsePayload(payload) {
  const event      = payload?.event || payload?.type || '';
  const memberData = payload?.data?.member || payload?.member || {};
  const offerData  = payload?.data?.offer  || payload?.offer  || {};

  const email      = memberData.email || payload?.data?.email || payload?.email || '';
  const first_name = memberData.first_name || payload?.data?.first_name || '';
  const last_name  = memberData.last_name  || payload?.data?.last_name  || '';
  const offerTitle = offerData.title || offerData.name || '';

  const notes = [];

  if (!email) {
    return { email: '', first_name, last_name, groupKey: null, groupId: null, action: 'skip', notes: ['No email in payload'] };
  }

  const eventLower = event.toLowerCase();

  // Member removal/cancellation — keep in Mailerlite, just log
  if (
    eventLower.includes('removed') ||
    eventLower.includes('cancelled') ||
    eventLower.includes('canceled') ||
    eventLower.includes('refund')
  ) {
    return { email, first_name, last_name, groupKey: null, groupId: null, action: 'skip', event, notes: ['Member removed/cancelled — keeping in Mailerlite'] };
  }

  // Any add/join/purchase event
  let groupKey;
  if (
    eventLower.includes('purchase') ||
    eventLower.includes('offer')
  ) {
    groupKey = resolveGroupKey(offerTitle);
    notes.push(`Offer: "${offerTitle}" → ${groupKey}`);
  } else {
    // member.created and anything else → Greenhouse default
    groupKey = 'greenhouse';
    notes.push(`Event: ${event} → default greenhouse`);
  }

  const groupIds = getGroupIds();
  const groupId  = groupIds[groupKey] || null;

  if (!groupId) {
    notes.push(`Group ID for "${groupKey}" not configured in creator-profile.json`);
  }

  return { email, first_name, last_name, groupKey, groupId, action: 'add', event, notes };
}

// ── Add subscriber to Mailerlite group ────────────────────────────────────────

async function addToMailerlite(email, first_name, last_name, groupId) {
  const body = {
    email,
    fields: {},
  };
  if (first_name) body.fields.name = [first_name, last_name].filter(Boolean).join(' ');
  if (groupId)    body.groups = [groupId];

  await ml('POST', '/subscribers', body);
}

// ── Fire welcome email for new subscriber ─────────────────────────────────────
// Sends a transactional email (to one person, not a campaign) using the
// welcome email template stored in kv_store for that tier.
// groupKey: 'greenhouse' | 'garden' | 'founding50'

async function fireWelcomeEmail(email, firstName, groupKey) {
  const db = require('../db');

  const stored = db.getKv(`welcome_email_${groupKey}`);
  if (!stored) return { fired: false, reason: 'No welcome email configured for this tier' };

  let template;
  try { template = JSON.parse(stored); } catch (_) { return { fired: false, reason: 'Malformed template' }; }
  if (!template.subject || !template.body) return { fired: false, reason: 'Template missing subject or body' };

  const profile   = loadProfile();
  const fromEmail = profile?.creator?.email;
  const fromName  = profile?.creator?.brand || profile?.creator?.name || 'Jason';

  if (!fromEmail) return { fired: false, reason: 'creator.email not set in creator-profile.json' };

  // Personalise — replace {{first_name}} with real name
  const greeting  = firstName || 'there';
  const subject   = template.subject.replace(/\{\{first_name\}\}/gi, greeting);
  const html      = template.body.replace(/\{\{first_name\}\}/gi, greeting);

  await ml('POST', '/transactional/emails', {
    from:    { email: fromEmail, name: fromName },
    to:      [{ email }],
    subject,
    html,
    reply_to: fromEmail,
  });

  log.info({ module: 'kajabi-webhook', email, groupKey }, 'Welcome email fired');
  return { fired: true };
}

// ── POST /receive — PUBLIC ─────────────────────────────────────────────────────

router.post('/receive', async (req, res) => {
  // Always return 200 immediately — Kajabi retries on any non-200
  res.status(200).json({ ok: true });

  try {
    const payload  = req.body;
    const received = new Date().toISOString();

    log.info({ module: 'kajabi-webhook', event: payload?.event }, 'Webhook received');

    const parsed = parsePayload(payload);

    const logEntry = {
      ts:        received,
      event:     parsed.event || payload?.event || 'unknown',
      email:     parsed.email || '(no email)',
      groupKey:  parsed.groupKey,
      action:    parsed.action,
      notes:     parsed.notes,
    };

    if (parsed.action === 'skip' || !parsed.email) {
      log.info({ module: 'kajabi-webhook', ...logEntry }, 'Webhook skipped');
      appendEventLog(logEntry);
      return;
    }

    if (!parsed.groupId) {
      log.warn({ module: 'kajabi-webhook', groupKey: parsed.groupKey }, 'Group ID not configured — subscriber not added to Mailerlite');
      logEntry.notes = [...(logEntry.notes || []), 'Group ID not configured — skipped Mailerlite call'];
      appendEventLog(logEntry);
      return;
    }

    if (!process.env.MAILERLITE_API_KEY) {
      log.warn({ module: 'kajabi-webhook' }, 'MAILERLITE_API_KEY not set — subscriber not synced');
      logEntry.notes = [...(logEntry.notes || []), 'MAILERLITE_API_KEY not set'];
      appendEventLog(logEntry);
      return;
    }

    await addToMailerlite(parsed.email, parsed.first_name, parsed.last_name, parsed.groupId);

    logEntry.synced = true;
    log.info({ module: 'kajabi-webhook', email: parsed.email, groupKey: parsed.groupKey }, 'Subscriber synced to Mailerlite');

    // Fire welcome email — non-blocking, log result but don't throw
    try {
      const welcome = await fireWelcomeEmail(parsed.email, parsed.first_name, parsed.groupKey);
      logEntry.welcome_email = welcome;
      if (welcome.fired) {
        log.info({ module: 'kajabi-webhook', email: parsed.email, groupKey: parsed.groupKey }, 'Welcome email fired');
      } else {
        log.info({ module: 'kajabi-webhook', reason: welcome.reason }, 'Welcome email skipped');
      }
    } catch (wErr) {
      log.warn({ module: 'kajabi-webhook', err: wErr }, 'Welcome email failed — subscriber still synced');
      logEntry.welcome_email = { fired: false, reason: wErr.message };
    }

    appendEventLog(logEntry);

  } catch (err) {
    log.error({ module: 'kajabi-webhook', err }, 'Error processing webhook');
    // Don't re-throw — response already sent 200
  }
});

// ── POST /test — AUTH-PROTECTED dry run ────────────────────────────────────────

router.post('/test', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = req.body;
    const parsed  = parsePayload(payload);

    const groupIds    = getGroupIds();
    const groupsOk    = Object.keys(groupIds).length >= 3;
    const mlConfigured = !!process.env.MAILERLITE_API_KEY;

    res.json({
      ok:             true,
      dry_run:        true,
      email:          parsed.email,
      first_name:     parsed.first_name,
      last_name:      parsed.last_name,
      event:          parsed.event || payload?.event || 'unknown',
      action:         parsed.action,
      groupKey:       parsed.groupKey,
      groupId:        parsed.groupId,
      notes:          parsed.notes,
      groups_configured: groupsOk,
      mailerlite_configured: mlConfigured,
      would_sync:     parsed.action === 'add' && !!parsed.email && !!parsed.groupId && mlConfigured,
    });
  } catch (err) {
    log.error({ module: 'kajabi-webhook', err }, 'Test endpoint error');
    res.status(500).json({ error: err.message });
  }
});

// ── GET /config — AUTH-PROTECTED ──────────────────────────────────────────────

router.get('/config', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const groupIds     = getGroupIds();
    const groupsOk     = Object.keys(groupIds).length >= 3;
    const recentEvents = readEventLog();

    // Try to detect the public-facing base URL
    const host        = req.headers['x-forwarded-host'] || req.headers.host || 'kre8r.app';
    const protocol    = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const webhookUrl  = `${protocol}://${host}/api/kajabi-webhook/receive`;

    res.json({
      webhook_url:          webhookUrl,
      events_to_subscribe:  ['member.created', 'purchase.created', 'offer.purchase', 'member.removed'],
      groups_configured:    groupsOk,
      mailerlite_configured: !!process.env.MAILERLITE_API_KEY,
      group_ids:            groupIds,
      recent_events:        recentEvents,
    });
  } catch (err) {
    log.error({ module: 'kajabi-webhook', err }, 'Config endpoint error');
    res.status(500).json({ error: err.message });
  }
});

// ── Welcome email template management ─────────────────────────────────────────
// POST /api/kajabi-webhook/welcome-email/test       — test-fire to an email  ← must be first (before :tier param)
// GET  /api/kajabi-webhook/welcome-email/:tier      — get stored template
// POST /api/kajabi-webhook/welcome-email/:tier      — save template { subject, body }
// POST /api/kajabi-webhook/welcome-email/:tier/generate — Claude generates from profile

const VALID_TIERS = ['greenhouse', 'garden', 'founding50'];

router.post('/welcome-email/test', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { tier, email, first_name } = req.body || {};
  if (!tier || !email) return res.status(400).json({ error: 'tier and email required' });
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  try {
    const result = await fireWelcomeEmail(email, first_name || 'Friend', tier);
    if (result.fired) {
      res.json({ ok: true, message: `Test welcome email sent to ${email}` });
    } else {
      res.status(400).json({ ok: false, reason: result.reason });
    }
  } catch (err) {
    log.error({ module: 'kajabi-webhook', err }, 'Test welcome email error');
    res.status(500).json({ error: err.message });
  }
});

router.get('/welcome-email/:tier', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { tier } = req.params;
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  try {
    const db     = require('../db');
    const stored = db.getKv(`welcome_email_${tier}`);
    if (!stored) return res.json({ tier, configured: false });

    let template;
    try { template = JSON.parse(stored); } catch (_) { return res.json({ tier, configured: false }); }

    res.json({ tier, configured: true, subject: template.subject, body: template.body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/welcome-email/:tier', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { tier } = req.params;
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  const { subject, body } = req.body || {};
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

  try {
    const db = require('../db');
    db.setKv(`welcome_email_${tier}`, JSON.stringify({ subject, body }));
    log.info({ module: 'kajabi-webhook', tier }, 'Welcome email template saved');
    res.json({ ok: true, tier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/welcome-email/:tier/generate', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { tier } = req.params;
  if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  try {
    const profile    = loadProfile();

    const tierNames = { greenhouse: 'The Greenhouse (free)', garden: 'The Garden ($19/mo)', founding50: 'The Founding 50 ($297 one-time)' };
    const creatorName  = profile?.creator?.name || 'Jason';
    const brandName    = profile?.creator?.brand || '7 Kin Homestead';
    const communityName = profile?.community?.name || 'ROCK RICH';
    const voice        = profile?.creator?.voice_summary || 'Straight-talking, warm, funny, never corporate.';

    const prompt = `You are writing a welcome email for ${creatorName} from ${brandName}.

Community: ${communityName}
New member tier: ${tierNames[tier]}
Creator voice: ${voice}

Write a short, personal welcome email for someone who just joined ${tierNames[tier]}.
- Subject line: punchy, warm, matches the creator's voice
- Body: 3-5 short paragraphs, conversational, excited but not corporate
- Include {{first_name}} placeholder once at the start
- DO NOT use emojis
- Tier context:
  - greenhouse: free tier, they're just exploring, welcome them in, low pressure
  - garden: paying member, make them feel the investment was smart, hint at what's coming
  - founding50: inner circle, they're one of 50, make them feel like they just got access to something rare

Return ONLY valid JSON in this exact shape:
{
  "subject": "...",
  "body": "<p>...</p><p>...</p>"
}`;

    const parsed  = await callClaude(prompt, 1024);
    if (!parsed?.subject || !parsed?.body) throw new Error('Claude response missing subject or body');

    res.json({ ok: true, tier, subject: parsed.subject, body: parsed.body });
  } catch (err) {
    log.error({ module: 'kajabi-webhook', err }, 'Welcome email generate error');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
