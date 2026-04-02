// FUTURE: NotebookLM integration — after research phase, package results into
// NotebookLM-compatible format + Gamma slide deck. Creator listens to a podcast
// AND watches slides about their own video topic before filming. Forces synthesis.

/**
 * Id8Ωr Route — src/routes/id8r.js
 *
 * POST /api/id8r/start          — start session, return session_id + first question
 * POST /api/id8r/respond        — user message → next question or RESEARCH_READY signal
 * POST /api/id8r/research       — SSE stream, 3 research passes in parallel
 * POST /api/id8r/mindmap        — generate mind map JSON
 * POST /api/id8r/package        — generate 3 titles, 3 thumbnails, 3 hooks
 * POST /api/id8r/brief          — generate full Vision Brief
 * POST /api/id8r/send-pipeline  — create project in DB, return redirect URL
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');

// ─── Session Store ─────────────────────────────────────────────────────────────

const sessions = new Map();

// Clean up sessions older than 2 hours every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > 2 * 60 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

// ─── Mode System Prompts ───────────────────────────────────────────────────────

const SYSTEM_PROMPTS = {
  shape_it: `You are Id8Ωr, a creative collaborator for Jason, a homesteading content creator at 7 Kin Homestead with 725k TikTok followers. Jason has a raw idea and needs help shaping it into a compelling video concept. Your job is to ask smart, targeted questions that help him find the best angle, hook, and packaging for his idea. Ask no more than 2-3 questions at a time. Be direct, warm, and genuinely curious. Never suggest ideas yet — just understand what he's working with. When you have enough, say RESEARCH_READY.`,

  find_it: `You are Id8Ωr, a creative collaborator for Jason, a homesteading content creator at 7 Kin Homestead with 725k TikTok followers. Jason needs a video idea. Ask him about: what's been on his mind lately, what his audience has been asking, what he knows better than anyone else, and what he's been avoiding making. Ask no more than 2-3 questions at a time. When you have a strong enough seed to work with, say RESEARCH_READY.`,

  deep_dive: `You are Id8Ωr, a creative collaborator for Jason, a homesteading content creator at 7 Kin Homestead with 725k TikTok followers. Jason has a topic but needs depth. Ask him what he already knows about it, what he's unsure about, and what specific claim or insight he wants to be able to make confidently on camera. Ask no more than 2-3 questions at a time. When you understand the knowledge gap, say RESEARCH_READY.`,
};

// ─── Claude API Helper ─────────────────────────────────────────────────────────

async function callClaude(systemPrompt, messages, maxTokens = 512, tools = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const { default: fetch } = await import('node-fetch');

  const body = {
    model      : process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens : maxTokens,
    system     : systemPrompt,
    messages,
  };

  if (tools) body.tools = tools;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method  : 'POST',
    headers : {
      'Content-Type'      : 'application/json',
      'x-api-key'         : apiKey,
      'anthropic-version' : '2023-06-01',
      'anthropic-beta'    : tools ? 'tools-2024-04-04' : undefined,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API ${response.status}`);
  }

  return response.json();
}

async function callClaudeText(systemPrompt, messages, maxTokens = 512) {
  const data = await callClaude(systemPrompt, messages, maxTokens);
  return data.content[0].text.trim();
}

async function callClaudeJSON(systemPrompt, messages, maxTokens = 1024) {
  const raw = await callClaudeText(systemPrompt, messages, maxTokens);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    throw new Error(`Claude returned malformed JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

// ─── POST /api/id8r/start ──────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  try {
    const { mode } = req.body;
    if (!mode || !SYSTEM_PROMPTS[mode]) {
      return res.status(400).json({ error: 'mode is required: shape_it | find_it | deep_dive' });
    }

    const sessionId = crypto.randomBytes(8).toString('hex');
    const systemPrompt = SYSTEM_PROMPTS[mode];

    // Get first question from Claude
    const firstMessage = await callClaudeText(
      systemPrompt,
      [{ role: 'user', content: "Let's get started." }],
      512
    );

    sessions.set(sessionId, {
      mode,
      systemPrompt,
      messages: [
        { role: 'user', content: "Let's get started." },
        { role: 'assistant', content: firstMessage },
      ],
      researchResults : null,
      mindMapData     : null,
      packageData     : null,
      briefData       : null,
      createdAt       : Date.now(),
    });

    res.json({ session_id: sessionId, message: firstMessage });
  } catch (e) {
    console.error('[id8r/start]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/respond ────────────────────────────────────────────────────

router.post('/respond', async (req, res) => {
  try {
    const { session_id, message } = req.body;
    if (!session_id || !message) {
      return res.status(400).json({ error: 'session_id and message are required' });
    }

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found or expired' });

    // Append user message
    session.messages.push({ role: 'user', content: message });

    const reply = await callClaudeText(
      session.systemPrompt,
      session.messages,
      512
    );

    // Append assistant reply
    session.messages.push({ role: 'assistant', content: reply });

    const researchReady = reply.includes('RESEARCH_READY');

    res.json({ message: reply, research_ready: researchReady });
  } catch (e) {
    console.error('[id8r/respond]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/research ───────────────────────────────────────────────────
// SSE stream — 3 research passes

router.post('/research', async (req, res) => {
  const { session_id } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    try { res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (_) {}
  };

  try {
    if (!session_id) {
      send({ stage: 'error', error: 'session_id is required' });
      return res.end();
    }

    const session = sessions.get(session_id);
    if (!session) {
      send({ stage: 'error', error: 'Session not found or expired' });
      return res.end();
    }

    // Build topic summary from conversation
    const conversationText = session.messages
      .map(m => `${m.role === 'user' ? 'Jason' : 'Id8r'}: ${m.content}`)
      .join('\n');

    send({ stage: 'start', message: 'Starting research phase...' });

    // Run 3 passes in parallel
    const [youtubeResult, dataResult, vaultResult] = await Promise.allSettled([

      // Pass 1: YouTube Research
      (async () => {
        send({ stage: 'pass_start', pass: 'youtube', label: 'YouTube Research' });
        const data = await callClaude(
          `You are a YouTube research analyst for 7 Kin Homestead, a homesteading channel with 725k TikTok followers. Search for the top performing YouTube videos on the topic from the conversation below. Return a summary of what's working — titles, angles, view counts if visible, gaps in existing content.`,
          [{
            role: 'user',
            content: `Conversation:\n${conversationText}\n\nSearch YouTube for top performing videos on this topic and summarize what you find: popular titles, common angles, view counts, and any content gaps.`,
          }],
          2048,
          [{ type: 'web_search_20250305', name: 'web_search' }]
        );
        const textContent = data.content.find(c => c.type === 'text');
        return textContent ? textContent.text : 'No YouTube results found.';
      })(),

      // Pass 2: Data & Facts
      (async () => {
        send({ stage: 'pass_start', pass: 'data', label: 'Data & Facts' });
        const data = await callClaude(
          `You are a research analyst for 7 Kin Homestead, a homesteading content creator. Search for statistics, studies, recent news, and compelling data hooks related to the topic from the conversation. Focus on numbers and facts that would make a homesteading audience lean in.`,
          [{
            role: 'user',
            content: `Conversation:\n${conversationText}\n\nSearch for relevant statistics, studies, news hooks, and data points that could strengthen this video concept.`,
          }],
          2048,
          [{ type: 'web_search_20250305', name: 'web_search' }]
        );
        const textContent = data.content.find(c => c.type === 'text');
        return textContent ? textContent.text : 'No data results found.';
      })(),

      // Pass 3: VaultΩr cross-reference
      (async () => {
        send({ stage: 'pass_start', pass: 'vault', label: 'VaultΩr Check' });
        try {
          const { default: fetch } = await import('node-fetch');
          const vaultRes = await fetch('http://localhost:3000/api/vault/footage');
          if (!vaultRes.ok) return 'VaultΩr not available.';
          const footage = await vaultRes.json();
          const items = Array.isArray(footage) ? footage : (footage.footage || []);
          const completed = items.filter(f => f.status === 'completed' || f.classification);
          if (completed.length === 0) return 'No classified footage in VaultΩr yet.';
          // Simple keyword match against topic
          const topicKeywords = conversationText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          const related = completed.filter(f => {
            const text = `${f.title || ''} ${f.classification || ''} ${f.topic || ''}`.toLowerCase();
            return topicKeywords.some(k => text.includes(k));
          });
          if (related.length === 0) return `VaultΩr has ${completed.length} completed clips — none closely match this topic. Fresh territory.`;
          return `VaultΩr found ${related.length} related clip(s): ${related.slice(0, 5).map(f => f.title || f.filename).join(', ')}`;
        } catch (e) {
          return `VaultΩr check failed: ${e.message}`;
        }
      })(),
    ]);

    const results = {
      youtube : youtubeResult.status === 'fulfilled' ? youtubeResult.value : `Error: ${youtubeResult.reason?.message}`,
      data    : dataResult.status === 'fulfilled'    ? dataResult.value    : `Error: ${dataResult.reason?.message}`,
      vault   : vaultResult.status === 'fulfilled'   ? vaultResult.value   : `Error: ${vaultResult.reason?.message}`,
    };

    // Store research results in session
    session.researchResults = results;

    send({ stage: 'pass_done', pass: 'youtube', result: results.youtube });
    send({ stage: 'pass_done', pass: 'data',    result: results.data });
    send({ stage: 'pass_done', pass: 'vault',   result: results.vault });
    send({ stage: 'done', message: 'Research complete.' });
    res.end();
  } catch (e) {
    console.error('[id8r/research]', e);
    send({ stage: 'error', error: e.message });
    res.end();
  }
});

// ─── POST /api/id8r/mindmap ────────────────────────────────────────────────────

router.post('/mindmap', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found or expired' });

    const conversationText = session.messages
      .map(m => `${m.role === 'user' ? 'Jason' : 'Id8r'}: ${m.content}`)
      .join('\n');

    const researchSummary = session.researchResults
      ? `YouTube: ${session.researchResults.youtube}\n\nData: ${session.researchResults.data}\n\nVaultΩr: ${session.researchResults.vault}`
      : 'No research data yet.';

    const systemPrompt = `You are Id8Ωr, a creative strategist for 7 Kin Homestead. Generate a mind map JSON from the conversation and research below. The mind map should show the central topic and 4-6 branches (angles, audiences, hooks, themes, concerns, opportunities), each with 2-4 leaf nodes.

Return ONLY valid JSON in this exact shape:
{
  "center": "Core Topic Label",
  "branches": [
    {
      "label": "Branch Label",
      "color": "#hex",
      "leaves": ["leaf 1", "leaf 2", "leaf 3"]
    }
  ]
}

Use these colors for branches: #3ecfb2, #f0b942, #a78bfa, #5b9cf6, #5cba8a, #e05c5c
Keep labels SHORT (2-5 words). Make it useful for content planning.`;

    const result = await callClaudeJSON(
      systemPrompt,
      [{
        role: 'user',
        content: `Conversation:\n${conversationText}\n\nResearch:\n${researchSummary}\n\nGenerate mind map JSON.`,
      }],
      1024
    );

    session.mindMapData = result;
    res.json(result);
  } catch (e) {
    console.error('[id8r/mindmap]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/package ────────────────────────────────────────────────────

router.post('/package', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found or expired' });

    const conversationText = session.messages
      .map(m => `${m.role === 'user' ? 'Jason' : 'Id8r'}: ${m.content}`)
      .join('\n');

    const researchSummary = session.researchResults
      ? `YouTube: ${session.researchResults.youtube}\n\nData: ${session.researchResults.data}`
      : 'No research data.';

    const systemPrompt = `You are a YouTube packaging expert for 7 Kin Homestead, a homesteading creator with 725k TikTok followers. Generate packaging options based on the conversation and research.

The creator's voice: straight-talking, warm, funny, never corporate. Real numbers. Self-deprecating. Uses "Kevin" as a foil.

Return ONLY valid JSON:
{
  "titles": [
    { "text": "Title 1", "angle": "Why this works" },
    { "text": "Title 2", "angle": "Why this works" },
    { "text": "Title 3", "angle": "Why this works" }
  ],
  "thumbnails": [
    { "concept": "Visual concept description", "text_overlay": "Short text for thumbnail", "emotion": "Curious/Shocked/Inspired" },
    { "concept": "Visual concept description", "text_overlay": "Short text for thumbnail", "emotion": "Curious/Shocked/Inspired" },
    { "concept": "Visual concept description", "text_overlay": "Short text for thumbnail", "emotion": "Curious/Shocked/Inspired" }
  ],
  "hooks": [
    { "text": "First 15 seconds script", "type": "question/stat/story/challenge" },
    { "text": "First 15 seconds script", "type": "question/stat/story/challenge" },
    { "text": "First 15 seconds script", "type": "question/stat/story/challenge" }
  ]
}`;

    const result = await callClaudeJSON(
      systemPrompt,
      [{
        role: 'user',
        content: `Conversation:\n${conversationText}\n\nResearch:\n${researchSummary}\n\nGenerate 3 titles, 3 thumbnails, 3 hooks.`,
      }],
      1024
    );

    session.packageData = result;
    res.json(result);
  } catch (e) {
    console.error('[id8r/package]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/brief ──────────────────────────────────────────────────────

router.post('/brief', async (req, res) => {
  try {
    const { session_id, selected_title, selected_thumbnail, selected_hook } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found or expired' });

    const conversationText = session.messages
      .map(m => `${m.role === 'user' ? 'Jason' : 'Id8r'}: ${m.content}`)
      .join('\n');

    const researchSummary = session.researchResults
      ? `YouTube: ${session.researchResults.youtube}\n\nData: ${session.researchResults.data}\n\nVaultΩr: ${session.researchResults.vault}`
      : 'No research data.';

    const systemPrompt = `You are Id8Ωr, a creative strategist for 7 Kin Homestead. Generate a complete Vision Brief for this video concept.

Return ONLY valid JSON in this exact shape:
{
  "elevator_pitch": "One sentence — what this video is and why it matters",
  "audience_insight": "Who specifically will love this and why they'll share it",
  "talking_points": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "story_angle": "The narrative arc — how this story unfolds",
  "what_not_to_do": ["avoid 1", "avoid 2", "avoid 3"],
  "pipeline_brief": {
    "title": "${selected_title || ''}",
    "high_concept": "One punchy sentence",
    "content_type": "short_form | long_form | series",
    "story_structure": "hook-problem-solution | before-after | day-in-life | tutorial | rant | investigation",
    "content_angle": "financial | system | rockrich | howto | mistakes | lifestyle | viral",
    "concept_note": "2-3 sentences of production direction for the creator",
    "entry_point": "script_first",
    "estimated_duration_minutes": 0
  }
}`;

    const result = await callClaudeJSON(
      systemPrompt,
      [{
        role: 'user',
        content: `Conversation:\n${conversationText}\n\nResearch:\n${researchSummary}\n\nSelected Title: ${selected_title || 'TBD'}\nSelected Thumbnail: ${JSON.stringify(selected_thumbnail) || 'TBD'}\nSelected Hook: ${JSON.stringify(selected_hook) || 'TBD'}\n\nGenerate the complete Vision Brief JSON.`,
      }],
      4096
    );

    session.briefData = result;
    res.json(result);
  } catch (e) {
    console.error('[id8r/brief]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/send-pipeline ─────────────────────────────────────────────

router.post('/send-pipeline', async (req, res) => {
  try {
    const { session_id, destination } = req.body;
    // destination: 'pipr' | 'writr'

    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found or expired' });

    if (!session.briefData) return res.status(400).json({ error: 'No brief generated yet — run /brief first' });

    const brief = session.briefData;
    const pb    = brief.pipeline_brief || {};

    // Map pipeline_brief fields to projects schema
    const title   = pb.title || brief.elevator_pitch || 'Untitled Id8Ωr Project';
    const topic   = [
      pb.high_concept,
      pb.content_angle,
      pb.concept_note,
    ].filter(Boolean).join(' | ');

    const project = db.createProject(title, topic, null, null);

    const dest = destination || 'pipr';
    const redirectUrl = dest === 'writr'
      ? `/writr.html?project_id=${project.id}`
      : `/pipr.html?project_id=${project.id}`;

    res.json({ ok: true, project_id: project.id, redirect_url: redirectUrl });
  } catch (e) {
    console.error('[id8r/send-pipeline]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
