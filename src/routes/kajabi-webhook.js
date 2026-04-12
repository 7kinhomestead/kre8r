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

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const log     = require('../utils/logger');

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
// Given an offer title, return the group key: 'greenhouse' | 'garden' | 'founding50'

function resolveGroupKey(offerTitle) {
  if (!offerTitle) return 'greenhouse';
  const t = offerTitle.toLowerCase();
  if (t.includes('founding') || t.includes('297') || t.includes('founding 50')) {
    return 'founding50';
  }
  if (t.includes('garden') || t.includes('19')) {
    return 'garden';
  }
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

module.exports = router;
