// FUTURE: NotebookLM integration — after research phase, package results into
// NotebookLM-compatible format + Gamma slide deck. Creator listens to a podcast
// AND watches slides about their own video topic before filming. Forces synthesis.

/**
 * Id8Ωr Route — src/routes/id8r.js
 *
 * POST /api/id8r/start          — start session, return session_id + first question
 * POST /api/id8r/respond        — user message → next question or RESEARCH_READY signal
 * POST /api/id8r/concepts       — fast pass: 3 concept directions (no web search)
 * POST /api/id8r/choose         — creator picks a concept or types a blend
 * POST /api/id8r/research       — SSE stream, 3 research passes on chosen concept
 * POST /api/id8r/package        — generate 3 titles, 3 thumbnails, 3 hooks
 * POST /api/id8r/brief          — generate full Vision Brief
 * POST /api/id8r/send-pipeline  — create project in DB, return redirect URL
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const path    = require('path');
const db      = require('../db');
const { getCreatorContext } = require('../utils/creator-context');
const vault   = require('../utils/project-vault');
const { addId8rContext } = require('../utils/project-context-builder');


// ─── Session Expired Response ──────────────────────────────────────────────────
const SESSION_EXPIRED = {
  error   : 'SESSION_EXPIRED',
  message : 'Your session expired — the server was restarted. Click Start Over to begin a new session.',
};

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
// Built at request-time so creator-profile.json changes are picked up live.

function buildSystemPrompts() {
  const { brand, creatorName, followerSummary, niche } = getCreatorContext();
  const identity = `${brand} (${followerSummary})`;
  return {
    shape_it: `You are Id8Ωr, a creative collaborator for ${creatorName}, a ${niche} content creator at ${identity}. ${creatorName} has a raw idea and needs help shaping it into a compelling video concept. Your job is to ask smart, targeted questions that help find the best angle, hook, and packaging for the idea. Ask no more than 2-3 questions at a time. Be direct, warm, and genuinely curious. Never suggest ideas yet — just understand what they're working with. When you have enough, say RESEARCH_READY.`,

    find_it: `You are Id8Ωr, a creative collaborator for ${creatorName}, a ${niche} content creator at ${identity}. ${creatorName} needs a video idea. Ask about: what's been on their mind lately, what the audience has been asking, what they know better than anyone else, and what they've been avoiding making. Ask no more than 2-3 questions at a time. When you have a strong enough seed to work with, say RESEARCH_READY.`,

    deep_dive: `You are Id8Ωr, a creative collaborator for ${creatorName}, a ${niche} content creator at ${identity}. ${creatorName} has a topic but needs depth. Ask what they already know about it, what they're unsure about, and what specific claim or insight they want to be able to make confidently on camera. Ask no more than 2-3 questions at a time. When you understand the knowledge gap, say RESEARCH_READY.`,

    vault_first: `You are Id8Ωr, a creative collaborator for ${creatorName}, a ${niche} content creator at ${identity}. ${creatorName} has footage already shot and needs help finding the story in it. Your job is to ask targeted questions that reveal the narrative — what happened, what moments surprised them, what felt real vs. planned, what went wrong, what the emotional core is, and what they couldn't have scripted. Ask no more than 2-3 questions at a time. The footage drives the story, not the plan. When you understand what they captured and why it matters, say RESEARCH_READY.`,
  };
}

// Initialized lazily — rebuilt per-request at route level so creator-profile.json changes are live
// and so the module can load without a profile present (fresh install / Electron first-run)
let SYSTEM_PROMPTS = null;

// ─── Claude API Helper ─────────────────────────────────────────────────────────

const RETRYABLE_STATUSES = new Set([429, 529]);
const RETRYABLE_CODES    = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);
const BACKOFF_DELAYS     = [2000, 4000, 8000, 16000];

// onRetry(attempt, delayMs, reason) — optional; SSE callers pass send() wrapper
async function callClaude(systemPrompt, messages, maxTokens = 512, tools = null, _sessionId = null, onRetry = null) {
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

  let lastErr;

  for (let attempt = 0; attempt <= BACKOFF_DELAYS.length; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method  : 'POST',
        headers : {
          'Content-Type'      : 'application/json',
          'x-api-key'         : apiKey,
          'anthropic-version' : '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (RETRYABLE_STATUSES.has(response.status)) {
        const delay = BACKOFF_DELAYS[attempt];
        const err   = await response.json().catch(() => ({}));
        lastErr     = new Error(err?.error?.message || `Claude API ${response.status}`);
        if (delay === undefined) throw lastErr;
        const reason = response.status === 429 ? 'rate limited' : 'overloaded';
        console.warn(`[id8r] Claude ${reason} — retry ${attempt + 1} in ${delay / 1000}s`);
        if (typeof onRetry === 'function') onRetry(attempt + 1, delay, reason);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Claude API ${response.status}`);
      }

      const data = await response.json();

      // ── Token tracking ──────────────────────────────────────
      try {
        const usage  = data.usage || {};
        const input  = usage.input_tokens  || 0;
        const output = usage.output_tokens || 0;
        const cost   = (input * 0.000003) + (output * 0.000015);
        db.logTokenUsage({ tool: 'id8r', session_id: _sessionId, input_tokens: input, output_tokens: output, estimated_cost: cost });
      } catch (_) { /* non-fatal */ }

      return data;

    } catch (err) {
      if (RETRYABLE_CODES.has(err.code)) {
        const delay = BACKOFF_DELAYS[attempt];
        if (delay === undefined) throw err;
        console.warn(`[id8r] network error ${err.code} — retry ${attempt + 1} in ${delay / 1000}s`);
        if (typeof onRetry === 'function') onRetry(attempt + 1, delay, `network error`);
        await new Promise(r => setTimeout(r, delay));
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Claude API: all retries exhausted');
}

async function callClaudeText(systemPrompt, messages, maxTokens = 512, sessionId = null, onRetry = null) {
  const data = await callClaude(systemPrompt, messages, maxTokens, null, sessionId, onRetry);
  return data.content[0].text.trim();
}

async function callClaudeJSON(systemPrompt, messages, maxTokens = 1024, sessionId = null, onRetry = null) {
  const raw = await callClaudeText(systemPrompt, messages, maxTokens, sessionId, onRetry);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    throw new Error(`Claude returned malformed JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

// ─── Message Window Helper ─────────────────────────────────────────────────────

function getRecentMessages(messages, maxExchanges = 6) {
  const seed    = messages.slice(0, 2);
  const recent  = messages.slice(2);
  const windowed = recent.slice(-(maxExchanges * 2));
  return [...seed, ...windowed];
}

// ─── POST /api/id8r/start ──────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  try {
    const { mode, season_context } = req.body;
    // Rebuild prompts fresh on each session start so creator-profile.json changes are live
    SYSTEM_PROMPTS = buildSystemPrompts();

    let systemPrompt;
    if (mode === 'episodic') {
      const { creatorName, niche } = getCreatorContext();
      systemPrompt = `You are Id8Ωr, the series engine for ${creatorName}, a ${niche} creator. You generate episode concepts for ongoing shows — ideas that advance the season arc AND stand alone for new viewers.

${season_context || '(No season context provided)'}

Your job: Ask 1-2 targeted questions to sharpen the episode angle before generating concepts. Focus on: what real thing happened this week on the homestead that could anchor the episode, what the creator is most fired up to film right now, and what would make THIS episode feel different from the last. When you have enough to work with, say RESEARCH_READY.`;
    } else {
      if (!mode || !SYSTEM_PROMPTS[mode]) {
        return res.status(400).json({ error: 'mode is required: shape_it | find_it | deep_dive | episodic' });
      }
      systemPrompt = SYSTEM_PROMPTS[mode];
    }

    const sessionId = crypto.randomBytes(8).toString('hex');

    const firstMessage = await callClaudeText(
      systemPrompt,
      [{ role: 'user', content: "Let's get started." }],
      256,
      sessionId
    );

    sessions.set(sessionId, {
      mode,
      systemPrompt,
      messages: [
        { role: 'user',      content: "Let's get started." },
        { role: 'assistant', content: firstMessage },
      ],
      concepts        : null,
      chosenConcept   : null,
      researchResults : null,
      researchSummary : null,
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
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    session.messages.push({ role: 'user', content: message });

    const reply = await callClaudeText(
      session.systemPrompt,
      getRecentMessages(session.messages),
      512,
      session_id
    );

    session.messages.push({ role: 'assistant', content: reply });

    const researchReady = reply.includes('RESEARCH_READY');
    res.json({ message: reply, research_ready: researchReady });
  } catch (e) {
    console.error('[id8r/respond]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/concepts ──────────────────────────────────────────────────
// Fast pass — no web search, low tokens, immediate

router.post('/concepts', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    const { brand, creatorName, followerSummary, niche } = getCreatorContext();

    const conversationText = getRecentMessages(session.messages)
      .map(m => `${m.role === 'user' ? creatorName : 'Id8r'}: ${m.content}`)
      .join('\n');

    const { contentAnglesText: anglesText } = getCreatorContext();

    // Read fresh creator-profile for dynamic content_intelligence (may have been updated by AnalΩzr)
    let intelligenceBlock = '';
    try {
      const { loadProfile } = require('../utils/creator-context');
      const cp = loadProfile();
      const ci   = cp.content_intelligence;
      if (ci && Array.isArray(ci.insights) && ci.insights.length) {
        const top3 = ci.insights.slice(0, 3);
        intelligenceBlock = `\n\nCONTENT INTELLIGENCE FROM ANALYΩZR (patterns Claude found in all ${creatorName}'s videos):\n`
          + top3.map((ins, i) =>
              (i + 1) + '. [' + ((ins.type || 'insight').toUpperCase()) + '] '
              + (ins.title || '') + ': ' + (ins.insight || '')
            ).join('\n')
          + '\nUse these patterns to make concept 3 especially sharp — lean into what\'s already proven to work or exploit an identified gap.';
      }
    } catch (_) {}

    // ClipsΩr pattern library — real clips the creator approved, with reasoning
    let clipsrBlock = '';
    try {
      const _db = require('../db');
      const stored = _db.getKv('clipsr_content_patterns');
      if (stored) {
        const patterns = JSON.parse(stored);
        const recent = (patterns.entries || []).slice(0, 4);
        if (recent.length) {
          clipsrBlock = `\n\nPROVEN CLIP MOMENTS (approved by creator — these structures resonate with this audience):\n`
            + recent.map((e, i) =>
                `${i + 1}. Hook: "${e.hook}" — ${e.why_it_works.slice(0, 180)}...`
              ).join('\n')
            + '\nWhen generating concepts, build toward moments like these — emotional-to-practical pivots, specific dollar amounts, relatable specificity that lands viscerally.';
        }
      }
    } catch (_) {}

    // MirrΩr calibration — what angles actually performed vs what was expected
    let mirrrBlock = '';
    try {
      const _db = require('../db');
      const evals = _db.getRecentEvaluations(2);
      if (evals.length) {
        const lines = evals.map(r => {
          try {
            const ev = JSON.parse(r.evaluation);
            const ups   = (ev.recommendation_accuracy || []).filter(a => a.weight_adjustment === 'UP').map(a => a.recommendation);
            const downs = (ev.recommendation_accuracy || []).filter(a => a.weight_adjustment === 'DOWN').map(a => a.recommendation);
            return [
              `${r.month}/${r.year} (score ${ev.overall_accuracy_score}/10): ${ev.one_line}`,
              ups.length   ? `  ↑ What overperformed: ${ups.join(', ')}` : '',
              downs.length ? `  ↓ What underperformed: ${downs.join(', ')}` : '',
              ev.calibration_notes ? `  Note: ${ev.calibration_notes.slice(0, 200)}` : '',
            ].filter(Boolean).join('\n');
          } catch { return null; }
        }).filter(Boolean);
        if (lines.length) {
          mirrrBlock = `\n\nMIRRΩR CALIBRATION (what has actually worked vs missed — use to weight concept angles):\n`
            + lines.join('\n\n')
            + '\nBias concepts toward angles that are trending UP in MirrΩr data. Treat DOWN-weighted angles with extra scrutiny — they need a fresh angle to earn their place.';
        }
      }
    } catch (_) {}

    const result = await callClaudeJSON(
      `You are Id8Ωr, a creative strategist for ${brand} (${followerSummary}, ${niche} content). Based on the conversation below, generate exactly 3 concept directions for the next video.

RULES:
- Concepts 1 and 2 MUST use angles from the provided list below. Pick the 2 best fits for what was described.
- Concept 3 MUST be a novel angle you invent — something NOT on the list. A fresh frame, an unexpected lens, a creative repackage of the topic that doesn't fit any existing category.
- Each concept must be meaningfully different — different audience hook, different emotional entry point.
- Be specific to what was discussed, not generic. Match the creator's real voice: straight-talking, funny, real numbers, never corporate.

CONTENT ANGLES:
${anglesText}${intelligenceBlock}${clipsrBlock}${mirrrBlock}

Return ONLY valid JSON in this exact shape:
{
  "concepts": [
    {
      "id": 1,
      "angle": "Label from the angles list",
      "headline": "one punchy sentence — the video in a nutshell",
      "why": "one sentence — why this works for this audience specifically",
      "hook": "the first 1-2 sentences of the video, in the creator's voice",
      "is_novel": false
    },
    {
      "id": 2,
      "angle": "Label from the angles list",
      "headline": "one punchy sentence — the video in a nutshell",
      "why": "one sentence — why this works for this audience specifically",
      "hook": "the first 1-2 sentences of the video, in the creator's voice",
      "is_novel": false
    },
    {
      "id": 3,
      "angle": "Your invented angle name",
      "headline": "one punchy sentence — the video in a nutshell",
      "why": "one sentence — why this novel frame works for this audience specifically",
      "hook": "the first 1-2 sentences of the video, in the creator's voice",
      "is_novel": true
    }
  ]
}`,
      [{
        role: 'user',
        content: `Conversation:\n${conversationText}\n\nGenerate 3 concept directions: 2 from the angles list, 1 novel angle you invent.`,
      }],
      1000,
      session_id
    );

    session.concepts = result.concepts || [];
    res.json(result);
  } catch (e) {
    console.error('[id8r/concepts]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/choose ────────────────────────────────────────────────────
// Creator picks concept 1/2/3 or types a free-text blend

router.post('/choose', async (req, res) => {
  try {
    const { session_id, choice } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    const choiceNum = parseInt(choice);
    if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= 3) {
      const concepts = session.concepts || [];
      session.chosenConcept = concepts[choiceNum - 1] || {
        id: choiceNum, angle: 'Custom', headline: String(choice), why: '', hook: '',
      };
    } else {
      // Free-text blend
      session.chosenConcept = {
        id: 0, angle: 'Custom Direction', headline: String(choice), why: 'Creator-defined direction', hook: '',
      };
    }

    res.json({ ok: true, chosen: session.chosenConcept });
  } catch (e) {
    console.error('[id8r/choose]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── SSE wait with keepalive pings ────────────────────────────────────────────
// Sends SSE comment pings every 5s during the wait to prevent nginx/proxy from
// closing the connection due to silence (proxy_read_timeout). Without this,
// the Phase 1→Phase 2 wait would silently kill the stream on proxied deployments.
function sseWait(res, ms) {
  return new Promise(resolve => {
    const pingInterval = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 5000);
    setTimeout(() => {
      clearInterval(pingInterval);
      resolve();
    }, ms);
  });
}

// ─── POST /api/id8r/research ───────────────────────────────────────────────────
// SSE stream — 3 focused research passes on the chosen concept

router.post('/research', async (req, res) => {
  const { session_id } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    try { res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (_) {}
  };

  // Global keepalive — pings every 8s for the entire duration of the research stream.
  // Prevents nginx proxy_read_timeout from closing the SSE connection during long
  // API calls (Phase 1 web search can take 15-20s of silence without this).
  // SSE comment lines (': ping') are ignored by EventSource — no client-side handling needed.
  const globalPing = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 8000);

  const cleanup = () => clearInterval(globalPing);

  try {
    if (!session_id) {
      send({ stage: 'error', error: 'session_id is required' });
      cleanup();
      return res.end();
    }

    const session = sessions.get(session_id);
    if (!session) {
      send({ stage: 'error', error: 'SESSION_EXPIRED', message: SESSION_EXPIRED.message });
      cleanup();
      return res.end();
    }

    const onRetry = (attempt, delayMs, reason) => send({
      stage:   'retrying',
      message: `Claude is ${reason} — retrying in ${Math.round(delayMs / 1000)}s… (attempt ${attempt} of ${BACKOFF_DELAYS.length})`,
    });

    const { brand: _brand, creatorName: _cn, followerSummary: _fs, niche: _niche } = getCreatorContext();

    // Focused research on chosen concept
    const chosen         = session.chosenConcept;
    const chosenAngle    = chosen ? chosen.angle    : '';
    const chosenHeadline = chosen ? chosen.headline : '';
    const chosenWhy      = chosen ? (chosen.why || '') : '';

    // Compact brief — just what research needs, not the full conversation.
    // Avoids oversized prompts that trigger rate limiting on web_search.
    const recentUserLines = session.messages
      .filter(m => m.role === 'user')
      .slice(-2)
      .map(m => m.content)
      .join(' | ');
    const conceptBrief = chosen
      ? `Concept: "${chosenHeadline}" | Angle: ${chosenAngle} | Why it works: ${chosenWhy} | Context: ${recentUserLines}`
      : recentUserLines;

    send({ stage: 'start', message: 'Starting research phase...' });

    const results = {};

    // ── Phase 1: YouTube Research ─────────────────────────────────
    // max_uses: 2 — enough to find the landscape, not enough to blow the rate limit.
    // max_tokens: 2000 — web_search_20260209 uses server_tool_use + code_execution
    // blocks internally which consume output tokens; 1200 still hits max_tokens.
    const phase1Label = chosenAngle ? `YouTube Research — ${chosenAngle}` : 'YouTube Research';
    send({ stage: 'phase_start', phase: 1, label: phase1Label });
    try {
      const data = await callClaude(
        `You are a YouTube research analyst for ${_brand}, a ${_niche} channel with ${_fs}. Find the top performing YouTube content for the specific concept below. Return 4-5 video titles + channels only. Then: what angle most of them take, and the ONE content gap this creator could own.`,
        [{
          role: 'user',
          content: `${conceptBrief}\n\nSearch YouTube. Return 4-5 examples (title + channel), the dominant approach, and the biggest gap.`,
        }],
        2000,
        [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }],
        session_id,
        onRetry
      );
      // Extract only Claude's written text — web_search_tool_result blocks contain
      // encrypted search payloads (not human-readable); server_tool_use blocks are
      // internal scaffolding. Claude's text synthesis is the useful content.
      const fullText = (data.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .filter(Boolean)
        .join('\n\n');
      results.youtube = fullText || 'No YouTube results found.';
    } catch (e) {
      console.error('[id8r/research] Phase 1 error:', e.message);
      results.youtube = `Error: ${e.message}`;
    }
    send({ stage: 'phase_result', phase: 1, label: phase1Label, data: results.youtube });
    // Checkpoint: phase 1 done — survives server restart
    try {
      db.setCheckpoint(session_id, 'id8r', {
        phase: 1, chosenConcept: session.chosenConcept || null,
        phase1: results.youtube, phase2: null, phase3: null,
      });
    } catch (_) {}
    send({ stage: 'phase_wait', phase: 1, duration: 30, message: 'Reviewing findings...' });
    await sseWait(res, 30000);

    // ── Phase 2: Data & Facts ─────────────────────────────────────
    // max_uses: 1 — one focused search is enough for stats/data; reduces rate limit
    // pressure after Phase 1's 2 searches.
    // max_tokens: 2000 — the web_search tool burns tokens on internal code_execution
    // retry loops. 1200 still hits max_tokens before Claude finishes writing results.
    const phase2Label = chosenAngle ? `Data & Facts — ${chosenAngle}` : 'Data & Facts';
    send({ stage: 'phase_start', phase: 2, label: phase2Label });
    try {
      const data = await callClaude(
        `You are a research analyst for ${_brand}, a ${_niche} content creator. Find 3-5 statistics, studies, or data points that directly support the concept below. Numbers and facts only — the kind that make an audience lean in. Be specific.`,
        [{
          role: 'user',
          content: `${conceptBrief}\n\nSearch for 3-5 concrete stats or data points that strengthen this specific angle. Numbers, sources, recency.`,
        }],
        2000,
        [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
        session_id,
        onRetry
      );
      // Extract only Claude's text synthesis — same reasoning as Phase 1.
      const textOnly = (data.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .filter(Boolean)
        .join('\n\n');

      // Separately collect search result URLs for citation extraction (no encrypted blobs)
      const searchUrls = (data.content || [])
        .filter(block => block.type === 'web_search_tool_result')
        .flatMap(block => (block.content || []).map(r => `${r.title || ''}: ${r.url || ''}`))
        .filter(Boolean)
        .join('\n');

      results.data = textOnly || 'No data results found.';
      console.log(`[id8r/research] Phase 2 stop_reason=${data.stop_reason} text_blocks=${(data.content||[]).filter(b=>b.type==='text').length}`);

      // Extract credible citations from search results for downstream blog/content use
      if (textOnly) {
        try {
          const citationInput = [textOnly.slice(0, 2000), searchUrls.slice(0, 500)].filter(Boolean).join('\n\nSearch URLs found:\n');
          const citationRaw = await callClaudeText(
            'You are a citation extractor. Return JSON only — no preamble.',
            [{
              role: 'user',
              content: `From the research text below, extract 3–5 of the most credible and citable sources — government data, academic studies, reputable news outlets, industry reports. Prefer sources with actual statistics or findings that support the argument.\n\nResearch:\n${citationInput}\n\nReturn JSON array only:\n[\n  { "title": "Source name / article title", "url": "https://...", "key_stat": "The specific fact or stat that makes this useful", "credibility": "why this source is credible" }\n]`,
            }],
            600,
            session_id,
            onRetry
          );
          try {
            const parsed = JSON.parse(citationRaw.replace(/```json|```/g, '').trim());
            session.citations = Array.isArray(parsed) ? parsed : [];
          } catch { session.citations = []; }
        } catch (e) {
          session.citations = [];
        }
      } else {
        session.citations = [];
      }
    } catch (e) {
      console.error('[id8r/research] Phase 2 error:', e.message);
      results.data = `Error: ${e.message}`;
      session.citations = [];
    }
    send({ stage: 'phase_result', phase: 2, label: phase2Label, data: results.data });
    // Checkpoint: phase 2 done
    try {
      db.setCheckpoint(session_id, 'id8r', {
        phase: 2, chosenConcept: session.chosenConcept || null,
        phase1: results.youtube, phase2: results.data, phase3: null,
      });
    } catch (_) {}
    send({ stage: 'phase_wait', phase: 2, duration: 30, message: 'Reviewing findings...' });
    await sseWait(res, 30000);

    // ── Phase 3: VaultΩr cross-reference ─────────────────────────
    const phase3Label = 'VaultΩr — have you covered this before?';
    send({ stage: 'phase_start', phase: 3, label: phase3Label });
    try {
      const { default: fetch } = await import('node-fetch');
      const vaultRes = await fetch('http://localhost:3000/api/vault/footage');
      if (!vaultRes.ok) {
        results.vault = 'VaultΩr not available.';
      } else {
        const footage  = await vaultRes.json();
        const items    = Array.isArray(footage) ? footage : (footage.footage || []);
        const completed = items.filter(f => f.status === 'completed' || f.classification);
        if (completed.length === 0) {
          results.vault = 'No classified footage in VaultΩr yet.';
        } else {
          const topicKeywords = conversationText.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          const related = completed.filter(f => {
            const text = `${f.title || ''} ${f.classification || ''} ${f.topic || ''}`.toLowerCase();
            return topicKeywords.some(k => text.includes(k));
          });
          results.vault = related.length === 0
            ? `VaultΩr has ${completed.length} completed clips — none closely match this topic. Fresh territory.`
            : `VaultΩr found ${related.length} related clip(s): ${related.slice(0, 5).map(f => f.title || f.filename).join(', ')}`;
        }
      }
    } catch (e) {
      results.vault = `VaultΩr check failed: ${e.message}`;
    }
    send({ stage: 'phase_result', phase: 3, label: phase3Label, data: results.vault });
    // Checkpoint: all 3 phases done — full research in DB
    try {
      db.setCheckpoint(session_id, 'id8r', {
        phase: 3, chosenConcept: session.chosenConcept || null,
        phase1: results.youtube, phase2: results.data, phase3: results.vault,
      });
    } catch (_) {}
    // Phase 3 is a local VaultΩr check — no web searches, no delay needed.

    // ── Phase 4: Summarization ────────────────────────────────────
    send({ stage: 'phase_start', phase: 4, label: 'Summarizing...' });

    session.researchResults = results;

    try {
      session.researchSummary = await callClaudeText(
        'You are a research summarizer. Be concise. Return plain text bullet points only, no markdown headers.',
        [{
          role: 'user',
          content: `Summarize these research results into bullet points under 400 words:\n\nYouTube: ${results.youtube.slice(0, 2000)}\n\nData: ${results.data.slice(0, 2000)}\n\nVault: ${results.vault.slice(0, 500)}`,
        }],
        600,
        session_id,
        onRetry
      );
    } catch (e) {
      console.error('[id8r] summarization failed:', e.message);
      session.researchSummary = `YouTube: ${results.youtube.slice(0, 300)}\n\nData: ${results.data.slice(0, 300)}\n\nVault: ${results.vault.slice(0, 200)}`;
    }

    // Save raw research to session vault (no project_id yet — saved again at send-pipeline)
    session._researchVaultData = {
      savedAt:         new Date().toISOString(),
      chosenConcept:   session.chosenConcept || null,
      researchResults: session.researchResults || results,
      researchSummary: session.researchSummary || null,
    };

    send({ stage: 'done', message: 'Research complete.' });
    cleanup();
    res.end();
  } catch (e) {
    console.error('[id8r/research]', e);
    send({ stage: 'error', error: e.message });
    cleanup();
    res.end();
  }
});

// ─── POST /api/id8r/package ────────────────────────────────────────────────────

router.post('/package', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    const { brand: pkgBrand, creatorName: pkgCn, followerSummary: pkgFs, niche: pkgNiche, voiceSummary: pkgVoice, profile: pkgProfile } = getCreatorContext();
    const voiceTraits = pkgProfile?.voice?.traits?.join('. ') || pkgVoice;

    const conversationText = getRecentMessages(session.messages)
      .map(m => `${m.role === 'user' ? pkgCn : 'Id8r'}: ${m.content}`)
      .join('\n');

    const researchSummary = session.researchSummary || 'No research data.';
    const chosen          = session.chosenConcept;
    const chosenContext   = chosen
      ? `\n\nChosen direction: "${chosen.headline}" (${chosen.angle})`
      : '';

    const result = await callClaudeJSON(
      `You are a YouTube packaging expert for ${pkgBrand} (${pkgNiche}, ${pkgFs}). Generate packaging options based on the conversation and research.

The creator's voice: ${voiceTraits}

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
}`,
      [{
        role: 'user',
        content: `Conversation:\n${conversationText}${chosenContext}\n\nResearch:\n${researchSummary}\n\nGenerate 3 titles, 3 thumbnails, 3 hooks.`,
      }],
      1024,
      session_id
    );

    session.packageData = result;
    session._packageVaultData = { savedAt: new Date().toISOString(), packageData: result };
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
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    const { brand: briefBrand, creatorName: briefCn } = getCreatorContext();

    const conversationText = getRecentMessages(session.messages)
      .map(m => `${m.role === 'user' ? briefCn : 'Id8r'}: ${m.content}`)
      .join('\n');

    const researchSummary = session.researchSummary || 'No research data.';

    const result = await callClaudeJSON(
      `You are Id8Ωr, a creative strategist for ${briefBrand}. Generate a complete Vision Brief for this video concept.

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
}`,
      [{
        role: 'user',
        content: `Conversation:\n${conversationText}\n\nResearch:\n${researchSummary}\n\nSelected Title: ${selected_title || 'TBD'}\nSelected Thumbnail: ${JSON.stringify(selected_thumbnail) || 'TBD'}\nSelected Hook: ${JSON.stringify(selected_hook) || 'TBD'}\n\nGenerate the complete Vision Brief JSON.`,
      }],
      4096,
      session_id
    );

    session.briefData = result;
    session._briefVaultData = { savedAt: new Date().toISOString(), briefData: result };
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

    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = sessions.get(session_id);
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    if (!session.briefData) return res.status(400).json({ error: 'No brief generated yet — run /brief first' });

    const brief = session.briefData;
    const pb    = brief.pipeline_brief || {};

    const title = pb.title || brief.elevator_pitch || 'Untitled Id8Ωr Project';
    const topic = [pb.high_concept, pb.content_angle, pb.concept_note].filter(Boolean).join(' | ');

    const project = db.createProject(title, topic, null, null);

    // Write brief fields to DB so PipΩr and WritΩr can pre-populate
    db.updateProjectPipr(project.id, {
      entry_point:  pb.entry_point  || 'script_first',
      content_type: pb.content_angle || '',
      high_concept: pb.high_concept  || '',
    });

    // Persist full Id8Ωr research session so WritΩr can inject creative context into prompts
    db.updateProjectId8r(project.id, {
      chosenConcept:   session.chosenConcept   || null,
      researchSummary: session.researchSummary  || null,
      packageData:     session.packageData      || null,
      briefData:       session.briefData        || null,
      citations:       session.citations        || [],
    });

    // Build project-context.json — single source of truth for the pipeline
    try {
      addId8rContext(project.id, {
        chosenConcept:   session.chosenConcept   || null,
        researchSummary: session.researchSummary  || null,
        packageData:     session.packageData      || null,
        briefData:       session.briefData        || null,
        citations:       session.citations        || [],
        collaborators:   session.collaborators    || null,
      });
    } catch (ctxErr) {
      console.warn('[id8r/send-pipeline] context build failed (non-fatal):', ctxErr.message);
    }

    // ── Vault: save all Id8Ωr session data now that we have a project_id ─────
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      if (session._researchVaultData) {
        vault.saveVaultData(project.id, 'id8r/research.json', session._researchVaultData);
      }
      if (session._packageVaultData) {
        vault.saveVaultData(project.id, 'id8r/packages.json', session._packageVaultData);
      }
      if (session._briefVaultData) {
        vault.saveVaultData(project.id, 'id8r/brief.json', session._briefVaultData);
      }

      // Full conversation log
      const conversationLog = (session.messages || [])
        .map(m => `[${m.role.toUpperCase()}]\n${m.content}`)
        .join('\n\n---\n\n');
      vault.saveVaultData(project.id, 'id8r/conversation.txt', conversationLog);

      // VAULT-README — human-readable summary of what's in the vault
      const brief = session.briefData || {};
      const pb    = brief.pipeline_brief || {};
      const chosen = session.chosenConcept;
      const readme = [
        `VAULT-README — Project ${project.id}: ${title}`,
        `Created: ${new Date().toISOString()}`,
        '',
        '═══ ID8ΩR SESSION ═══════════════════════════════',
        chosen ? `Chosen concept: ${chosen.headline} (${chosen.angle})` : '',
        chosen ? `Why this angle: ${chosen.why || ''}` : '',
        '',
        brief.elevator_pitch ? `Elevator pitch: ${brief.elevator_pitch}` : '',
        brief.audience_insight ? `Audience insight: ${brief.audience_insight}` : '',
        '',
        pb.title ? `Title: ${pb.title}` : '',
        pb.high_concept ? `High concept: ${pb.high_concept}` : '',
        pb.story_structure ? `Story structure: ${pb.story_structure}` : '',
        pb.content_angle ? `Content angle: ${pb.content_angle}` : '',
        pb.concept_note ? `\nProduction notes: ${pb.concept_note}` : '',
        '',
        session.researchSummary ? `═══ RESEARCH SUMMARY ════════════════════════════\n${session.researchSummary}` : '',
        '',
        '═══ VAULT FILES ═════════════════════════════════',
        'id8r/research.json      — raw research data (YouTube, data, vault phases)',
        'id8r/packages.json      — title/thumbnail/hook options',
        'id8r/brief.json         — full Vision Brief',
        'id8r/conversation.txt   — full Id8Ωr conversation log',
        'writr/                  — script iterations (added when WritΩr runs)',
        'config-history/         — PipΩr config snapshots (added on every save)',
      ].filter(l => l !== undefined).join('\n');

      vault.saveVaultData(project.id, 'VAULT-README.txt', readme);
    } catch (vaultErr) {
      console.warn('[id8r/send-pipeline] vault save failed (non-fatal):', vaultErr.message);
    }

    const dest = destination || 'pipr';
    const redirectUrl = dest === 'writr'
      ? `/writr.html?project_id=${project.id}`
      : `/pipr.html?load_project=${project.id}`;

    // Clean up checkpoint now that the project is saved to DB
    try { db.deleteCheckpoint(session_id); } catch (_) {}

    res.json({ ok: true, project_id: project.id, redirect_url: redirectUrl });
  } catch (e) {
    console.error('[id8r/send-pipeline]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/id8r/checkpoint/:sessionId ──────────────────────────────────────

router.get('/checkpoint/:sessionId', (req, res) => {
  try {
    const cp = db.getCheckpoint(req.params.sessionId);
    if (!cp) return res.json({ found: false });
    res.json({ found: true, tool: cp.tool, data: cp.data, updated_at: cp.updated_at });
  } catch (e) {
    console.error('[id8r/checkpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/merge ──────────────────────────────────────────────────────
// Generate merge concepts from two existing projects without a conversation

router.post('/merge', async (req, res) => {
  try {
    const { project_id_a, project_id_b } = req.body;
    if (!project_id_a || !project_id_b) {
      return res.status(400).json({ error: 'project_id_a and project_id_b are required' });
    }

    const projA = db.getProject(parseInt(project_id_a, 10));
    const projB = db.getProject(parseInt(project_id_b, 10));
    if (!projA || !projB) return res.status(404).json({ error: 'One or both projects not found' });

    const { brand, creatorName, followerSummary, niche } = getCreatorContext();
    const { contentAnglesText: anglesText } = getCreatorContext();

    // Build context strings for each project
    function projectSummary(p) {
      let s = `Title: ${p.title || 'Untitled'}`;
      if (p.high_concept) s += `\nHigh concept: ${p.high_concept}`;
      if (p.id8r_data) {
        try {
          const d = JSON.parse(p.id8r_data);
          if (d.briefData?.elevator_pitch) s += `\nPitch: ${d.briefData.elevator_pitch}`;
          if (d.briefData?.story_angle)    s += `\nStory angle: ${d.briefData.story_angle}`;
          if (d.researchSummary)           s += `\nResearch: ${d.researchSummary.slice(0, 400)}`;
        } catch (_) {}
      }
      return s;
    }

    const sessionId    = crypto.randomBytes(8).toString('hex');
    SYSTEM_PROMPTS = buildSystemPrompts();
    const systemPrompt = SYSTEM_PROMPTS.shape_it; // merge sessions continue as shape_it

    const mergePrompt = `You are Id8Ωr, a creative strategist for ${brand} (${followerSummary}, ${niche} content). Two existing projects are being merged. Find the stronger story that lives at their intersection.

PROJECT A:
${projectSummary(projA)}

PROJECT B:
${projectSummary(projB)}

CONTENT ANGLES AVAILABLE:
${anglesText}

Generate exactly 3 concept directions that combine, contrast, or synthesize these two projects into one stronger video concept. Each should feel genuinely different.

RULES:
- Concept 3 MUST be a novel angle you invent — something NOT on the angles list.
- Each concept must have a clear POV on why merging these two projects creates something better than either alone.
- Match the creator's voice: straight-talking, funny, real numbers, never corporate.

Return ONLY valid JSON:
{
  "concepts": [
    {
      "id": 1,
      "angle": "Label from the angles list",
      "headline": "one punchy sentence — the merged video in a nutshell",
      "why": "why this combination works for this audience specifically",
      "hook": "the first 1-2 sentences of the video, in the creator's voice",
      "is_novel": false
    },
    {
      "id": 2,
      "angle": "Label from the angles list",
      "headline": "...",
      "why": "...",
      "hook": "...",
      "is_novel": false
    },
    {
      "id": 3,
      "angle": "Your invented angle name",
      "headline": "...",
      "why": "...",
      "hook": "...",
      "is_novel": true
    }
  ]
}`;

    const result = await callClaudeJSON(
      mergePrompt,
      [{ role: 'user', content: `Merge these two projects into 3 concept directions.` }],
      1200,
      sessionId
    );

    const concepts = result.concepts || [];

    // Seed a real session so the rest of the flow (research → package → brief) works normally
    const firstMessage = `I've found 3 ways to merge "${projA.title}" and "${projB.title}" into something stronger. Pick one to go deep on.`;
    sessions.set(sessionId, {
      mode          : 'merge',
      systemPrompt,
      messages      : [
        { role: 'user',      content: `Merge projects: "${projA.title}" and "${projB.title}"` },
        { role: 'assistant', content: firstMessage },
      ],
      concepts,
      chosenConcept   : null,
      researchResults : null,
      researchSummary : null,
      packageData     : null,
      briefData       : null,
      sourceProjects  : [parseInt(project_id_a, 10), parseInt(project_id_b, 10)],
      createdAt       : Date.now(),
    });

    res.json({ ok: true, session_id: sessionId, concepts });
  } catch (e) {
    console.error('[id8r/merge]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /rescue-session ─────────────────────────────────────────────────────
// Emergency endpoint: creates a project from sessionStorage data when the
// in-memory session is dead (API credits ran out, app restart, etc.)
// Accepts: { title, chosenConcept, concepts, chatHtml, sessionId }
router.post('/rescue-session', (req, res) => {
  try {
    const { title, chosenConcept, concepts, chatHtml, sessionId } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const chosen = typeof chosenConcept === 'string' ? JSON.parse(chosenConcept) : chosenConcept;
    const allConcepts = typeof concepts === 'string' ? JSON.parse(concepts) : (concepts || []);

    const topic = chosen?.why || chosen?.angle || null;
    const project = db.createProject(title.trim(), topic, null, null);

    db.updateProjectPipr(project.id, {
      high_concept: chosen?.headline || title.trim(),
      content_type: chosen?.angle   || null,
    });

    db.updateProjectId8r(project.id, {
      chosenConcept:   chosen  || null,
      researchSummary: null,   // was mid-research when session died
      packageData:     null,
      briefData:       {
        rescued:      true,
        rescued_at:   new Date().toISOString(),
        original_session_id: sessionId || null,
        all_concepts:        allConcepts,
        chosen_concept:      chosen || null,
        chat_html:           chatHtml || null,
        note: 'Session rescued from sessionStorage after API interruption. Research and package not yet generated.',
      },
    });

    console.log(`[id8r/rescue-session] Rescued project ${project.id}: "${title.trim()}"`);
    res.json({ ok: true, project_id: project.id, title: title.trim() });
  } catch (err) {
    console.error('[id8r/rescue-session]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
