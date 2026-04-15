/**
 * SequenceΩr — src/routes/sequence-builder.js
 *
 * Email nurture & onboarding sequence builder.
 * Strategy chat → plan approval → full sequence write → per-email revision.
 *
 * POST   /api/sequences                        — create new sequence
 * GET    /api/sequences                        — list all sequences
 * GET    /api/sequences/:id                    — get sequence + emails
 * DELETE /api/sequences/:id                    — delete sequence
 * POST   /api/sequences/:id/chat               — send chat message, get Claude response
 * POST   /api/sequences/:id/plan               — generate plan from chat (SSE)
 * PUT    /api/sequences/:id/plan               — save approved plan
 * POST   /api/sequences/:id/write              — write all emails (SSE)
 * POST   /api/sequences/:id/emails/:pos/revise — revise one email
 * PATCH  /api/sequences/:id                    — update name/meta fields
 */

'use strict';

const express      = require('express');
const router       = express.Router();
const db           = require('../db');
const { callClaude, callClaudeMessages } = require('../utils/claude');
const { startSseResponse } = require('../utils/sse');
const log          = require('../utils/logger');
const path         = require('path');
const fs           = require('fs');

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
router.use(requireAuth);

// ── Load creator profile ───────────────────────────────────────────────────────
function loadProfile() {
  const p = process.env.CREATOR_PROFILE_PATH || path.join(__dirname, '../../creator-profile.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return {}; }
}

// ── Load voice profiles from DB ────────────────────────────────────────────────
function loadVoiceProfiles() {
  try {
    const rows = db.getKv('voice_profiles');
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}

function getVoiceProfile(name) {
  if (!name) return null;
  const profiles = loadVoiceProfiles();
  return profiles.find(p => p.name === name) || null;
}

// ── Goal type labels ───────────────────────────────────────────────────────────
const GOAL_LABELS = {
  onboard:    'Onboard new member',
  convert:    'Convert free → paid',
  reengage:   'Re-engage cold subscribers',
  sell:       'Sell a product or offer',
  nurture:    'Nurture long-term relationship',
  custom:     'Custom goal',
};

// ── System prompt builder ──────────────────────────────────────────────────────
function buildStrategistSystem(seq, profile) {
  const creatorName  = profile?.creator?.name  || 'Jason';
  const brandName    = profile?.creator?.brand || '7 Kin Homestead';
  const communityName = profile?.community?.name || 'ROCK RICH';
  const voice        = profile?.creator?.voice_summary || 'Straight-talking, warm, funny, never corporate.';
  const goalLabel    = GOAL_LABELS[seq.goal_type] || seq.goal_type;

  return `You are an expert email strategist working with ${creatorName} from ${brandName}.

Your job is to help plan a ${seq.email_count}-email sequence over ${seq.timeframe_days} days.
Goal: ${goalLabel}${seq.goal_description ? ' — ' + seq.goal_description : ''}
Audience: ${seq.audience || 'subscribers'}
Creator voice: ${voice}
Community: ${communityName}

Your role in this conversation:
- Ask smart strategic questions to understand what this sequence needs to accomplish
- Understand the creator's stories, content, and specific talking points to weave in
- Build a clear picture of the emotional arc across all ${seq.email_count} emails
- Be conversational — this is a planning chat, not an interview
- Ask ONE focused question at a time, not a list of five
- When you have enough to write a solid plan, tell the creator you're ready to generate it

Do NOT write any emails yet. This is the strategy phase only.
Keep responses short and punchy — match the creator's voice: direct, warm, no fluff.`;
}

// ── POST /api/sequences — create ──────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, goal_type, goal_description, audience, email_count, timeframe_days, voice_profile } = req.body || {};

  if (!goal_type) return res.status(400).json({ error: 'goal_type is required' });

  try {
    const seq = db.createEmailSequence({
      name: name || `${GOAL_LABELS[goal_type] || goal_type} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      goal_type,
      goal_description: goal_description || null,
      audience: audience || null,
      email_count: parseInt(email_count) || 5,
      timeframe_days: parseInt(timeframe_days) || 14,
      voice_profile: voice_profile || null,
    });

    // Seed the chat with an opening message from Claude
    const profile = loadProfile();
    const opening = buildOpeningMessage(seq, profile);
    const history = [{ role: 'assistant', content: opening }];
    db.updateEmailSequence(seq.id, { chat_history: JSON.stringify(history) });

    log.info({ module: 'sequence-builder', id: seq.id, goal_type }, 'Sequence created');
    res.json({ ok: true, sequence: { ...seq, chat_history: history } });
  } catch (err) {
    log.error({ module: 'sequence-builder', err }, 'Create sequence failed');
    res.status(500).json({ error: err.message });
  }
});

function buildOpeningMessage(seq, profile) {
  const goalLabel = GOAL_LABELS[seq.goal_type] || seq.goal_type;
  const creatorName = profile?.creator?.name || 'there';

  const openers = {
    onboard:  `Alright, let's map out this ${seq.email_count}-email onboarding sequence. Someone just joined — what's the most important thing they should know, feel, or do by the time they've read all ${seq.email_count} emails?`,
    convert:  `${seq.email_count} emails to move someone from free to paid over ${seq.timeframe_days} days — let's make that count. What's the biggest reason people haven't pulled the trigger yet? What objection are we really fighting?`,
    reengage: `Re-engagement sequences are tricky — you're reaching people who went cold. What do you think happened? Did life get in the way, or did they lose the thread of why they signed up in the first place?`,
    sell:     `${seq.email_count} emails, ${seq.timeframe_days} days, one goal — close the sale. What are we selling and what's the honest reason someone should buy it right now?`,
    nurture:  `Long-term nurture is about showing up with something worth reading. What's the core value you want to deliver across these ${seq.email_count} emails — and is there a story or system you want to teach?`,
    custom:   `Let's build this out. Tell me what you're trying to accomplish with this sequence — and who's on the receiving end of it.`,
  };

  return openers[seq.goal_type] || openers.custom;
}

// ── GET /api/sequences — list ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const seqs = db.getAllEmailSequences().map(s => ({
      ...s,
      chat_history: undefined,
      plan: s.plan ? JSON.parse(s.plan) : null,
    }));
    res.json({ sequences: seqs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sequences/:id — get ──────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const seq = db.getEmailSequence(parseInt(req.params.id));
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    const emails = db.getSequenceEmails(seq.id);
    let chat_history = [];
    let plan = null;
    try { chat_history = JSON.parse(seq.chat_history || '[]'); } catch (_) {}
    try { plan = seq.plan ? JSON.parse(seq.plan) : null; } catch (_) {}

    res.json({ sequence: { ...seq, chat_history, plan }, emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sequences/:id — update meta ────────────────────────────────────
router.patch('/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const seq = db.getEmailSequence(id);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    const allowed = ['name','goal_type','goal_description','audience','email_count','timeframe_days','voice_profile'];
    const fields  = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    db.updateEmailSequence(id, fields);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/sequences/:id ─────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.deleteEmailSequence(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sequences/:id/chat — strategy chat turn ─────────────────────────
router.post('/:id/chat', async (req, res) => {
  const id      = parseInt(req.params.id);
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  try {
    const seq = db.getEmailSequence(id);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    let history = [];
    try { history = JSON.parse(seq.chat_history || '[]'); } catch (_) {}

    const profile = loadProfile();
    const systemPrompt = buildStrategistSystem(seq, profile);

    // Build messages for Claude
    history.push({ role: 'user', content: message.trim() });

    const reply = await callClaudeMessages(
      systemPrompt,
      history.map(m => ({ role: m.role, content: m.content })),
      600
    );

    history.push({ role: 'assistant', content: reply });
    db.updateEmailSequence(id, { chat_history: JSON.stringify(history) });

    res.json({ ok: true, reply, history });
  } catch (err) {
    log.error({ module: 'sequence-builder', err }, 'Chat turn failed');
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sequences/:id/plan — generate plan (SSE) ────────────────────────
router.post('/:id/plan', async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const seq = db.getEmailSequence(id);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    const { send, end: done } = startSseResponse(res);

    send({ type: 'status', message: 'Building your sequence plan…' });

    let history = [];
    try { history = JSON.parse(seq.chat_history || '[]'); } catch (_) {}

    const profile   = loadProfile();
    const voice     = getVoiceProfile(seq.voice_profile);
    const goalLabel = GOAL_LABELS[seq.goal_type] || seq.goal_type;

    const chatSummary = history
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n---\n');

    const prompt = `Based on this strategy conversation, create a detailed plan for a ${seq.email_count}-email sequence.

SEQUENCE BRIEF:
Goal: ${goalLabel}${seq.goal_description ? ' — ' + seq.goal_description : ''}
Audience: ${seq.audience || 'subscribers'}
Emails: ${seq.email_count} emails over ${seq.timeframe_days} days
Creator voice: ${profile?.creator?.voice_summary || 'Straight-talking, warm, funny, never corporate.'}
${voice ? `Voice profile: ${voice.name} — ${voice.description || ''}` : ''}

STRATEGY CONVERSATION NOTES:
${chatSummary || 'No conversation yet — use the goal and context to build a strong plan.'}

Create a plan for exactly ${seq.email_count} emails. Space them appropriately across ${seq.timeframe_days} days (day 0 = first email).

Return ONLY valid JSON array, no markdown:
[
  {
    "position": 1,
    "send_day": 0,
    "title": "Short punchy title for this email",
    "purpose": "What this email needs to accomplish emotionally and strategically",
    "angle": "The specific angle, story, or content hook for this email",
    "cta": "The single call to action (or 'none' if pure value)"
  }
]`;

    send({ type: 'status', message: 'Claude is building the plan…' });

    const raw = await callClaude(prompt, 2048);

    // callClaude auto-parses JSON — handle both array and object responses
    let plan;
    if (Array.isArray(raw)) {
      plan = raw;
    } else if (raw && Array.isArray(raw.emails)) {
      plan = raw.emails;
    } else {
      throw new Error('Claude returned unexpected plan format');
    }

    // Validate and normalise
    plan = plan.slice(0, seq.email_count).map((item, i) => ({
      position: i + 1,
      send_day: item.send_day ?? Math.round((i / Math.max(seq.email_count - 1, 1)) * seq.timeframe_days),
      title:    item.title || `Email ${i + 1}`,
      purpose:  item.purpose || '',
      angle:    item.angle || '',
      cta:      item.cta || 'none',
    }));

    db.updateEmailSequence(id, { plan: JSON.stringify(plan), status: 'planning' });

    send({ type: 'plan', plan });
    done();
  } catch (err) {
    log.error({ module: 'sequence-builder', err }, 'Plan generation failed');
    try {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
    } catch (_) {}
  }
});

// ── PUT /api/sequences/:id/plan — save approved plan ─────────────────────────
router.put('/:id/plan', (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const { plan } = req.body || {};
    if (!Array.isArray(plan)) return res.status(400).json({ error: 'plan must be an array' });

    db.updateEmailSequence(id, { plan: JSON.stringify(plan), status: 'approved' });
    log.info({ module: 'sequence-builder', id }, 'Plan approved');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sequences/:id/write — write all emails (SSE) ───────────────────
router.post('/:id/write', async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const seq = db.getEmailSequence(id);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    let plan = [];
    try { plan = JSON.parse(seq.plan || '[]'); } catch (_) {}
    if (!plan.length) return res.status(400).json({ error: 'No plan — generate and approve a plan first' });

    const { send, end: done } = startSseResponse(res);

    const profile   = loadProfile();
    const voice     = getVoiceProfile(seq.voice_profile);
    const goalLabel = GOAL_LABELS[seq.goal_type] || seq.goal_type;
    const creatorName = profile?.creator?.name || 'Jason';
    const brandName   = profile?.creator?.brand || '7 Kin Homestead';
    const communityName = profile?.community?.name || 'ROCK RICH';

    const voiceContext = voice
      ? `VOICE PROFILE — ${voice.name}:\n${voice.transcript || voice.description || ''}`
      : `Creator voice: ${profile?.creator?.voice_summary || 'Straight-talking, warm, funny, never corporate.'}`;

    // Clear old emails
    db.deleteSequenceEmails(id);
    db.updateEmailSequence(id, { status: 'writing' });

    send({ type: 'status', message: `Writing ${plan.length} emails…` });

    const writtenEmails = [];

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      send({ type: 'progress', current: i + 1, total: plan.length, title: item.title });

      // Build context: what came before
      const priorContext = writtenEmails.length
        ? `\nEMAILS ALREADY WRITTEN IN THIS SEQUENCE:\n` +
          writtenEmails.map(e => `Email ${e.position} (Day ${e.send_day}): Subject: "${e.subject}"\n${e.body.slice(0, 200)}…`).join('\n\n')
        : '';

      const prompt = `You are writing Email ${item.position} of ${plan.length} in a ${goalLabel} sequence for ${creatorName} from ${brandName}.

SEQUENCE CONTEXT:
Goal: ${goalLabel}${seq.goal_description ? ' — ' + seq.goal_description : ''}
Audience: ${seq.audience || 'subscribers'}
Total emails: ${plan.length} over ${seq.timeframe_days} days

THIS EMAIL:
Position: ${item.position} of ${plan.length}
Send day: Day ${item.send_day}
Title/theme: ${item.title}
Purpose: ${item.purpose}
Angle/hook: ${item.angle}
CTA: ${item.cta}

${voiceContext}
${priorContext}

WRITING RULES:
- Use {$name} once near the top as the greeting (MailerLite's native merge tag for first name)
- Write in ${creatorName}'s voice — warm, direct, never corporate, never stiff
- Short paragraphs (2-3 sentences max)
- One clear CTA at the end (match what's specified above)
- HTML format: use <p> tags, no headers, no bullet lists unless the content calls for it
- Length: 150-300 words body (tight and purposeful)
- Subject line: punchy, curiosity-driving, fits the angle

Return ONLY valid JSON:
{
  "subject": "...",
  "body": "<p>Hey {$name},</p><p>...</p>"
}`;

      const result = await callClaude(prompt, 1024);

      const email = {
        position: item.position,
        send_day: item.send_day,
        purpose:  item.purpose,
        subject:  result?.subject || `Email ${item.position}`,
        body:     result?.body    || '',
      };

      db.upsertSequenceEmail(id, item.position, email);
      writtenEmails.push(email);

      send({ type: 'email', email: { ...email, plan_item: item } });
    }

    db.updateEmailSequence(id, { status: 'complete' });
    send({ type: 'done', total: writtenEmails.length });
    done();
  } catch (err) {
    log.error({ module: 'sequence-builder', err }, 'Write emails failed');
  }
});

// ── POST /api/sequences/:id/emails/:pos/revise — revise single email ──────────
router.post('/:id/emails/:pos/revise', async (req, res) => {
  const id  = parseInt(req.params.id);
  const pos = parseInt(req.params.pos);
  const { instruction } = req.body || {};

  if (!instruction?.trim()) return res.status(400).json({ error: 'instruction is required' });

  try {
    const seq    = db.getEmailSequence(id);
    if (!seq) return res.status(404).json({ error: 'Sequence not found' });

    const emails = db.getSequenceEmails(id);
    const target = emails.find(e => e.position === pos);
    if (!target) return res.status(404).json({ error: 'Email not found' });

    let plan = [];
    try { plan = JSON.parse(seq.plan || '[]'); } catch (_) {}
    const planItem = plan.find(p => p.position === pos) || {};

    const profile     = loadProfile();
    const voice       = getVoiceProfile(seq.voice_profile);
    const creatorName = profile?.creator?.name || 'Jason';
    const voiceContext = voice
      ? `VOICE PROFILE — ${voice.name}:\n${voice.transcript || voice.description || ''}`
      : `Creator voice: ${profile?.creator?.voice_summary || 'Straight-talking, warm, funny, never corporate.'}`;

    const prompt = `You are revising Email ${pos} in an email sequence for ${creatorName}.

CURRENT EMAIL:
Subject: ${target.subject}
Body:
${target.body}

REVISION INSTRUCTION:
${instruction.trim()}

EMAIL PURPOSE: ${planItem.purpose || target.purpose || ''}

${voiceContext}

Apply the revision instruction. Keep everything else the same unless the instruction says otherwise.

Return ONLY valid JSON:
{
  "subject": "...",
  "body": "<p>...</p>"
}`;

    const result = await callClaude(prompt, 1024);

    const updated = {
      subject:  result?.subject || target.subject,
      body:     result?.body    || target.body,
      send_day: target.send_day,
      purpose:  target.purpose,
    };

    db.upsertSequenceEmail(id, pos, updated);

    res.json({ ok: true, email: { position: pos, ...updated } });
  } catch (err) {
    log.error({ module: 'sequence-builder', err }, 'Revise email failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
