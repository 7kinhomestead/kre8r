/**
 * MailΩr Route — src/routes/mailor.js
 *
 * POST /api/mailor/broadcast  — single prompt → A/B emails in blended voice
 * POST /api/mailor/sequence   — full tier sequence (upgraded from generate.js)
 * GET  /api/mailor/kajabi/status — check if Kajabi API key is configured
 * POST /api/mailor/kajabi/send   — send via Kajabi (if key exists)
 */

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { buildVoiceSummaryFromProfiles } = require('../writr/voice-analyzer');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadProfile() {
  const p = path.join(__dirname, '../../creator-profile.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getKajabiKey() {
  return process.env.KAJABI_API_KEY || null;
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 4000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const { default: fetch } = await import('node-fetch');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method  : 'POST',
    headers : {
      'Content-Type'      : 'application/json',
      'x-api-key'         : apiKey,
      'anthropic-version' : '2023-06-01',
    },
    body: JSON.stringify({
      model      : process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens : maxTokens,
      system     : systemPrompt,
      messages   : [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API ${response.status}`);
  }
  const data    = await response.json();
  const raw     = data.content[0].text.trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    throw new Error(`Claude returned malformed JSON. First 300 chars: ${cleaned.slice(0,300)}`);
  }
}

function buildTierContext(profile) {
  const tiers = profile?.community?.tiers || {};
  const lines = ['ROCK RICH COMMUNITY TIERS:'];
  if (tiers.greenhouse) lines.push(`- Greenhouse (Free): ${tiers.greenhouse.description || 'Free members — curious, not yet committed. Goal: convert to Garden.'}`);
  if (tiers.garden)     lines.push(`- Garden ($19/mo): ${tiers.garden.description     || 'Paid members. Reward their commitment. Make them glad they joined.'}`);
  if (tiers.founding)   lines.push(`- Founding 50 ($297 one-time): ${tiers.founding.description || 'Inner circle. Limited spots. Insider tone. Early access energy.'}`);
  return lines.join('\n');
}

function buildVoiceContext(profile, voiceProfiles) {
  // If voice profiles passed in, use blend logic from WritΩr
  if (voiceProfiles && voiceProfiles.length > 0) {
    return buildVoiceSummaryFromProfiles(profile, voiceProfiles);
  }
  // Fall back to profile default voice
  const v = profile?.voice;
  if (!v) return 'Straight-talking, warm, funny, never corporate. Plain text only.';
  return [
    v.summary,
    `Never: ${(v.never || []).join(', ')}`,
    'Plain text only — no markdown, no asterisks, no bullet symbols.',
  ].join('\n');
}

function buildSegmentList(profile) {
  // Core segments + any future ones added to profile
  const base = [
    { id: 'everyone',    label: 'Everyone (full list)' },
    { id: 'greenhouse',  label: 'Greenhouse (free members)' },
    { id: 'garden',      label: 'Garden ($19/mo)' },
    { id: 'founding',    label: 'Founding 50 ($297)' },
  ];
  // Merge any custom segments from profile
  const custom = profile?.email_segments || [];
  return [...base, ...custom];
}

// ─── GET /api/mailor/kajabi/status ────────────────────────────────────────────

router.get('/kajabi/status', (req, res) => {
  const key = getKajabiKey();
  res.json({ connected: !!key });
});

// ─── GET /api/mailor/segments ─────────────────────────────────────────────────

router.get('/segments', (req, res) => {
  try {
    const profile  = loadProfile();
    const segments = buildSegmentList(profile);
    res.json({ segments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/mailor/broadcast ───────────────────────────────────────────────
// Single prompt → A/B email pair in blended voice

router.post('/broadcast', async (req, res) => {
  try {
    const {
      prompt,           // what this email is about
      segment,          // who it's going to
      goal,             // what you want them to do
      voice_primary,    // voice profile name
      voice_secondary,  // optional second voice
      voice_blend,      // 10–90, primary weight
      project_id,       // optional
    } = req.body;

    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const profile = loadProfile();

    // Build voice blend
    const voiceProfiles = [];
    const allProfiles   = profile.voice_profiles || [];

    if (voice_primary) {
      const vp = allProfiles.find(v => v.name === voice_primary);
      if (vp) voiceProfiles.push({ profile: vp, weight: parseInt(voice_blend) || 70 });
    }
    if (voice_secondary) {
      const vs = allProfiles.find(v => v.name === voice_secondary);
      if (vs) voiceProfiles.push({ profile: vs, weight: 100 - (parseInt(voice_blend) || 70) });
    }

    const voiceContext = buildVoiceContext(profile, voiceProfiles);
    const tierContext  = buildTierContext(profile);

    const systemPrompt = `You are the email copywriter for 7 Kin Homestead — a homesteading creator with 725k TikTok, 54k YouTube, and a paid community called ROCK RICH on Kajabi.

${tierContext}

VOICE:
${voiceContext}

RULES:
- Plain text only. No markdown, no asterisks, no bullet symbols.
- Write like a real person sending a personal email, not a newsletter blast.
- Short, punchy subject lines — no clickbait, no ALL CAPS gimmicks.
- Every email has one job. One CTA. Don't pile on.
- A/B means meaningfully different approaches — not just different subject lines. Different angle, different entry point, different emotional hook.`;

    const userPrompt = `Write an A/B broadcast email pair for this situation:

Prompt: ${prompt}
Segment: ${segment || 'everyone'}
Goal: ${goal || 'not specified'}

Return JSON only:
{
  "segment": "${segment || 'everyone'}",
  "version_a": {
    "label": "one word describing this approach",
    "subject": "subject line",
    "body": "full email body"
  },
  "version_b": {
    "label": "one word describing this approach",
    "subject": "subject line",
    "body": "full email body"
  }
}`;

    const result = await callClaude(systemPrompt, userPrompt, 3000);

    // Save to DB if project linked
    if (project_id) {
      db.saveEmails(parseInt(project_id), { broadcast: result });
    }

    res.json({ ok: true, broadcast: result });
  } catch (e) {
    console.error('[mailor/broadcast]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/mailor/sequence ────────────────────────────────────────────────
// Full tier sequence — upgraded from generate.js, now reads from creator-profile.json

router.post('/sequence', async (req, res) => {
  try {
    const {
      project_id,
      video_title,
      package_title,
      content_angle,
      video_url,
      key_moments,
      next_video,
      live_offer,
      community_event,
      email_direction,
      tiers,
      voice_primary,
      voice_secondary,
      voice_blend,
    } = req.body;

    const profile     = loadProfile();
    const activeTiers = tiers || ['greenhouse', 'garden', 'founding'];

    // Build voice blend
    const voiceProfiles = [];
    const allProfiles   = profile.voice_profiles || [];
    if (voice_primary) {
      const vp = allProfiles.find(v => v.name === voice_primary);
      if (vp) voiceProfiles.push({ profile: vp, weight: parseInt(voice_blend) || 70 });
    }
    if (voice_secondary) {
      const vs = allProfiles.find(v => v.name === voice_secondary);
      if (vs) voiceProfiles.push({ profile: vs, weight: 100 - (parseInt(voice_blend) || 70) });
    }

    const voiceContext = buildVoiceContext(profile, voiceProfiles);
    const tierContext  = buildTierContext(profile);

    const angleMap = {
      financial: 'Financial Take — real numbers, cost savings, ROI math',
      system:    'System Is Rigged — opting out of broken systems',
      rockrich:  'Rock Rich Episode — doing a lot with a little',
      howto:     'Practical How-To — step by step, achievable for anyone',
      mistakes:  'Mistakes / What Not To Do — hard-won lessons',
      lifestyle: 'Lifestyle / Day-in-Life — real life on the homestead',
      viral:     'High Curiosity — counterintuitive, scroll-stopping',
    };

    const systemPrompt = `You are the email strategist for 7 Kin Homestead.

${tierContext}

VOICE:
${voiceContext}

EMAIL STRATEGY:
- Day 0 (everyone): Get them to watch the video. Short, warm, personal.
- Day 3 (Greenhouse): Value-add on the topic. Soft nudge toward joining The Garden.
- Day 3 (Garden): Deeper insight or behind-the-scenes. Reward their paid status.
- Day 3 (Founding 50): Insider tone. Personal note style. Something exclusive.
- Day 7 (Greenhouse): Soft pitch. Video as proof. Invitation to join The Garden.
- Day 7 (Garden): Tease next video. Reinforce they're in the right place.
- Day 7 (Founding 50): Full insider. What's coming. What they get first.

Plain text only. No markdown. No asterisks. No symbols.

OUTPUT: valid JSON only, no preamble:
{
  "day0": { "everyone": { "subject": "", "body": "" } },
  "day3": { "greenhouse": { "subject": "", "body": "" }, "garden": { "subject": "", "body": "" }, "founding": { "subject": "", "body": "" } },
  "day7": { "greenhouse": { "subject": "", "body": "" }, "garden": { "subject": "", "body": "" }, "founding": { "subject": "", "body": "" } }
}`;

    let userPrompt = `Generate a full email sequence.\n\n`;
    userPrompt += `Video Title: ${video_title || 'Untitled'}\n`;
    if (package_title)   userPrompt += `Package Title: ${package_title}\n`;
    if (content_angle)   userPrompt += `Angle: ${angleMap[content_angle] || content_angle}\n`;
    if (video_url)       userPrompt += `YouTube URL: ${video_url}\n`;
    if (key_moments)     userPrompt += `Key moments: ${key_moments}\n`;
    if (next_video)      userPrompt += `Next video (Day 7 tease): ${next_video}\n`;
    if (live_offer)      userPrompt += `Live offer: ${live_offer}\n`;
    if (community_event) userPrompt += `Community event: ${community_event}\n`;
    if (email_direction) userPrompt += `Direction: ${email_direction}\n`;
    userPrompt += `Tiers: ${activeTiers.join(', ')}\nJSON only.`;

    const result = await callClaude(systemPrompt, userPrompt, 6000);

    if (project_id) db.saveEmails(parseInt(project_id), result);

    res.json({ project_id: project_id || null, emails: result });
  } catch (e) {
    console.error('[mailor/sequence]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/mailor/kajabi/send ─────────────────────────────────────────────
// Stub — live when KAJABI_API_KEY is set

router.post('/kajabi/send', async (req, res) => {
  const key = getKajabiKey();
  if (!key) {
    return res.status(402).json({
      error     : 'Kajabi not connected',
      action    : 'Add KAJABI_API_KEY to your .env file to enable direct sending',
      connected : false,
    });
  }
  // TODO: implement Kajabi broadcast API call when key is available
  res.status(501).json({ error: 'Kajabi send not yet implemented — key found but API not wired' });
});

module.exports = router;
