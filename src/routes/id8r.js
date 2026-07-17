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

// ─── Session Persistence (crash-safe) ─────────────────────────────────────────
// Sessions are in-memory by default. After every key step, we checkpoint to
// SQLite so a server restart never loses creative work mid-pipeline.

function persistSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const checkpoint = {
    mode            : session.mode,
    systemPrompt    : session.systemPrompt,
    messages        : session.messages || [],
    fastInput       : session.fastInput || null,
    concepts        : session.concepts || null,
    chosenConcept   : session.chosenConcept || null,
    researchResults : session.researchResults || null,
    researchSummary : session.researchSummary || null,
    packageData     : session.packageData || null,
    briefData       : session.briefData || null,
    citations       : session.citations || [],
    collaborators   : session.collaborators || null,
    _researchVaultData : session._researchVaultData || null,
    _packageVaultData  : session._packageVaultData  || null,
    _briefVaultData    : session._briefVaultData    || null,
    createdAt       : session.createdAt || Date.now(),
  };
  try { db.setCheckpoint(sessionId, 'id8r', checkpoint); } catch (_) {}
}

function getOrRestoreSession(sessionId) {
  // Try live memory first
  const live = sessions.get(sessionId);
  if (live) return live;
  // Restore from checkpoint (survives server restart)
  try {
    const cp = db.getCheckpoint(sessionId);
    if (!cp || !cp.data) return null;
    const data = { ...cp.data };

    // Schema migration: mid-research phase checkpoints used {phase1, phase2, phase3}
    // instead of the full persistSession shape {researchResults: {youtube, data, vault}}.
    // Remap so downstream endpoints (/package, /brief, /send-pipeline) can read them.
    if ((data.phase1 !== undefined || data.phase2 !== undefined || data.phase3 !== undefined)
        && !data.researchResults) {
      data.researchResults = {
        youtube : data.phase1 || null,
        data    : data.phase2 || null,
        vault   : data.phase3 || null,
      };
    }

    sessions.set(sessionId, { ...data, restoredFromCheckpoint: true });
    return sessions.get(sessionId);
  } catch (_) {}
  return null;
}

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
  // M1: defensive extraction — content[0] may be tool_use or absent on max_tokens/refusal
  const block = (data.content || []).find(b => b.type === 'text');
  if (!block?.text) throw new Error('Claude returned no text content');
  return block.text.trim();
}

async function callClaudeJSON(systemPrompt, messages, maxTokens = 1024, sessionId = null, onRetry = null) {
  const raw = await callClaudeText(systemPrompt, messages, maxTokens, sessionId, onRetry);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {
    // M2: attempt to extract largest balanced JSON object/array before giving up
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    const candidate = (objMatch?.[0]?.length || 0) >= (arrMatch?.[0]?.length || 0)
      ? objMatch?.[0] : arrMatch?.[0];
    if (candidate) {
      try { return JSON.parse(candidate); } catch (_) {}
    }
    throw new Error(`Claude returned malformed JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

/**
 * callClaudeWithSearchFallback(systemPrompt, fallbackSystem, messages, fallbackMessages, maxTokens, sessionId, onRetry)
 *
 * Tries web_search_20260209 first. If Anthropic can't serve the search request,
 * falls back to Claude's training knowledge automatically.
 * Returns { text, source: 'web'|'training' }
 */
// ─── Gemini API Helper (Google AI Studio — search grounding) ──────────────────
// Used for Phase 1 (YouTube landscape) and Phase 2 (Data & Facts) in /research.
// Gemini with google_search grounding fetches live results; falls back to Claude
// training knowledge if the API key is missing or the call fails.

async function callGemini(prompt, { useSearch = true } = {}) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  const axios = require('axios');
  const body  = { contents: [{ parts: [{ text: prompt }] }] };
  if (useSearch) body.tools = [{ google_search: {} }];

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`,
    body,
    {
      params:  { key: apiKey },
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );

  const candidate = (response.data?.candidates || [])[0] || {};
  const parts     = candidate.content?.parts || [];
  const text      = parts.filter(p => p.text).map(p => p.text).join('\n').trim();

  // Pull cited URLs from grounding metadata
  const chunks  = candidate.groundingMetadata?.groundingChunks || [];
  const sources = chunks.map(c => c.web?.uri).filter(Boolean);

  if (!text) throw new Error('Gemini returned empty response');
  return { text, sources };
}

// Gemini with Claude fallback — same pattern as callClaudeWithSearchFallback
async function callGeminiWithFallback(geminiPrompt, fallbackSystem, fallbackMessages, maxTokens = 1200, sessionId = null, onRetry = null) {
  const hasKey = !!process.env.GOOGLE_AI_API_KEY;
  if (hasKey) {
    try {
      const result = await callGemini(geminiPrompt, { useSearch: true });
      console.log('[id8r] Gemini search succeeded');
      return { text: result.text, sources: result.sources, source: 'gemini' };
    } catch (e) {
      console.warn(`[id8r] Gemini failed (${e.message}) — falling back to Claude training knowledge`);
    }
  } else {
    console.warn('[id8r] GOOGLE_AI_API_KEY not set — using Claude training knowledge');
  }
  const text = await callClaudeText(fallbackSystem, fallbackMessages, maxTokens, sessionId, onRetry);
  return { text, sources: [], source: 'training' };
}

async function callClaudeWithSearchFallback(systemPrompt, fallbackSystem, messages, fallbackMessages, maxTokens = 1200, sessionId = null, onRetry = null) {
  try {
    const data = await callClaude(
      systemPrompt,
      messages,
      2000,
      [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }],
      sessionId,
      onRetry
    );
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .filter(Boolean)
      .join('\n\n');
    if (!text) throw new Error('web search returned no text');
    console.log('[id8r] web search succeeded');
    return { text, source: 'web' };
  } catch (e) {
    console.warn(`[id8r] web search failed (${e.message}) — falling back to training knowledge`);
    const text = await callClaudeText(fallbackSystem, fallbackMessages, maxTokens, sessionId, onRetry);
    return { text, source: 'training' };
  }
}

// ─── Message Window Helper ─────────────────────────────────────────────────────

function getRecentMessages(messages, maxExchanges = 6) {
  const seed    = messages.slice(0, 2); // synthetic "Let's get started." pair
  const rest    = messages.slice(2);
  const windowed = rest.slice(-(maxExchanges * 2));
  // M6: pin the creator's FIRST real user message so it never falls out of the window
  // In long Shape-It sessions, the founding idea (index 2) is otherwise lost to the rolling slice
  const firstReal = rest.find(m => m.role === 'user' && m.content !== "Let's get started.");
  const pinned    = firstReal && !windowed.includes(firstReal) ? [firstReal] : [];
  return [...seed, ...pinned, ...windowed];
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
    persistSession(sessionId);

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

    const session = getOrRestoreSession(session_id);
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

// ─── POST /api/id8r/fast-concepts ────────────────────────────────────────────
// New fast-pass entry point — takes raw input text, skips conversation entirely,
// returns session_id + 5 concepts in ~10 seconds. The new default Id8Ωr flow.

router.post('/fast-concepts', async (req, res) => {
  try {
    const { input, mode = 'shape_it', angle } = req.body;
    if (!input || !input.trim()) return res.status(400).json({ error: 'input is required' });

    SYSTEM_PROMPTS = buildSystemPrompts();

    const { brand, creatorName, followerSummary, niche, contentAnglesText: anglesText } = getCreatorContext();

    // Build a rich system prompt based on mode
    const modeIntent = {
      shape_it    : `${creatorName} has a raw idea and wants 5 concept directions for it.`,
      find_it     : `${creatorName} is looking for a video idea and described what's on their mind.`,
      deep_dive   : `${creatorName} has a topic they want to go deep on.`,
      vault_first : `${creatorName} has footage already shot and needs to find the story in it.`,
      episodic    : `${creatorName} is planning a new episode and described the situation.`,
    };

    // Pull intelligence blocks (same as /concepts)
    let intelligenceBlock = '';
    try {
      const { loadProfile } = require('../utils/creator-context');
      const cp = loadProfile();
      const ci = cp.content_intelligence;
      if (ci && Array.isArray(ci.insights) && ci.insights.length) {
        const top3 = ci.insights.slice(0, 3);
        intelligenceBlock = `\n\nCONTENT INTELLIGENCE (patterns from all ${creatorName}'s videos):\n`
          + top3.map((ins, i) =>
              `${i + 1}. [${(ins.type || 'insight').toUpperCase()}] ${ins.title || ''}: ${ins.insight || ''}`
            ).join('\n')
          + '\nUse these to make at least one concept especially sharp — lean into what\'s proven to work.';
      }
    } catch (_) {}

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
              `${r.month}/${r.year} (score ${ev.overall_accuracy_score}/10)`,
              ups.length   ? `  ↑ Overperformed: ${ups.join(', ')}` : '',
              downs.length ? `  ↓ Underperformed: ${downs.join(', ')}` : '',
            ].filter(Boolean).join('\n');
          } catch { return null; }
        }).filter(Boolean);
        if (lines.length) {
          mirrrBlock = `\n\nMIRRΩR DATA (weight concepts toward ↑ angles):\n${lines.join('\n\n')}`;
        }
      }
    } catch (_) {}

    // ── VectΩr Strategic Brief — inject active direction if one exists ────────
    try {
      const activeBrief = require('../db').getActiveBrief();
      if (activeBrief?.brief_json) {
        const b = activeBrief.brief_json;
        let vBlock = '\n\n## STRATEGIC DIRECTION (locked in last VectΩr session)';
        if (b.vector)      vBlock += `\nVector: ${b.vector}`;
        if (b.focus)       vBlock += `\nFocus: ${b.focus}`;
        if (b.constraints) vBlock += `\nConstraints: ${b.constraints}`;
        if (b.avoid)       vBlock += `\nAvoid: ${b.avoid}`;
        if (b.locked_date) vBlock += `\n(Locked ${b.locked_date})`;
        vBlock += '\nBias concept generation toward this direction unless the creator signals a different intent.';
        mirrrBlock += vBlock;
      }
    } catch (_) {}

    // ── Studio Intel brief injection ──────────────────────────────────────────
    try {
      const siRaw = require('../db').getKv('studio_intel_brief');
      if (siRaw) {
        const si = JSON.parse(siRaw);
        const ageHours = Math.floor((Date.now() - new Date(si.created_at)) / 3600000);
          const injectMatch = si.text?.match(/## 💉 Inject Into Strategy\s*([\s\S]+?)(?=\n## |$)/);
          const injectText = injectMatch ? injectMatch[1].trim() : si.text?.slice(0, 500);
          if (injectText) {
            const ageLabel = ageHours < 48 ? `${ageHours}h ago` : `${Math.floor(ageHours/24)}d ago`;
            mirrrBlock += `\n\n## YOUTUBE STUDIO AUDIENCE INTELLIGENCE (${ageLabel})\n${injectText}\nBias concept angles toward what this audience data reveals.`;
          }
      }
    } catch (_) {}

    // H7: Post-Mortem brief — steer concepts away from diagnosed failure patterns
    try {
      const pm = require('../db').getActivePostMortemBrief();
      if (pm) {
        let pmBlock = '\n\n## LAST POST-MORTEM — DO NOT REPEAT THESE MISTAKES';
        if (pm.root_cause)   pmBlock += `\nRoot cause: ${pm.root_cause}`;
        if (pm.adjustments)  pmBlock += `\nAdjustments: ${pm.adjustments}`;
        if (pm.avoid)        pmBlock += `\nAvoid: ${pm.avoid}`;
        pmBlock += '\nDo not generate concepts that repeat this pattern. If an angle overlaps with "Avoid", only surface it with a materially different execution.';
        mirrrBlock += pmBlock;
      }
    } catch (_) {}

    // H6: Voice calibration + audience target — hooks must be in Jason's real calibrated voice
    let voiceBlock = '';
    try {
      const { loadVoiceCalibrationBlock, loadAudienceTargetBlock } = require('../writr/claude');
      const vcBlock  = loadVoiceCalibrationBlock();
      const audBlock = loadAudienceTargetBlock();
      if (vcBlock)  voiceBlock += `\n\n${vcBlock}`;
      if (audBlock) voiceBlock += `\n\n${audBlock}`;
    } catch (_) {}

    const angleInstruction = angle
      ? `\nThe creator wants to lean toward the "${angle}" angle — at least 2 concepts should use or riff on it.`
      : '';

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.shape_it;

    const result = await callClaudeJSON(
      `You are Id8Ωr, a creative strategist for ${brand} (${followerSummary}, ${niche} content).
${modeIntent[mode] || modeIntent.shape_it}

Generate exactly 5 concept directions. Rules:
- Concepts 1–3: use angles from the list below (pick the best fits for what was described)
- Concepts 4–5: novel angles you invent — creative reframes NOT on the list
- Each concept must feel meaningfully different — different hook, different emotion, different audience entry
- Be specific to what was described. Match the creator's real voice: straight-talking, funny, real numbers, never corporate
- Concept 3 should be the wildcard: the most surprising angle that still makes sense for this audience${angleInstruction}

CONTENT ANGLES:
${anglesText}${intelligenceBlock}${mirrrBlock}${voiceBlock}

Return ONLY valid JSON:
{
  "concepts": [
    {
      "id": 1,
      "angle": "Label from the angles list",
      "headline": "one punchy sentence — the video in a nutshell",
      "why": "one sentence — why this works for this audience specifically",
      "hook": "the first 1-2 sentences of the video, in the creator's voice",
      "is_novel": false
    }
  ]
}`,
      [{
        role: 'user',
        content: `Here's what I'm working with:\n\n${input.trim()}\n\nGenerate 5 concept directions.`,
      }],
      1500
    );

    const concepts = result.concepts || [];

    // Create a real session so the rest of the pipeline (choose → research → package → brief) works
    const sessionId = crypto.randomBytes(8).toString('hex');
    sessions.set(sessionId, {
      mode,
      systemPrompt,
      messages: [
        { role: 'user',      content: input.trim() },
        { role: 'assistant', content: `Here are 5 concept directions based on what you shared.` },
      ],
      fastInput       : input.trim(),
      concepts,
      chosenConcept   : null,
      researchResults : null,
      researchSummary : null,
      packageData     : null,
      briefData       : null,
      createdAt       : Date.now(),
    });
    persistSession(sessionId);

    res.json({ session_id: sessionId, concepts });
  } catch (e) {
    console.error('[id8r/fast-concepts]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/concepts ──────────────────────────────────────────────────
// Fast pass — no web search, low tokens, immediate

router.post('/concepts', async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = getOrRestoreSession(session_id);
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

    // ── Studio Intel brief injection (research phase) ─────────────────────────
    let studioIntelBlock2 = '';
    try {
      const siRaw = require('../db').getKv('studio_intel_brief');
      if (siRaw) {
        const si = JSON.parse(siRaw);
        const ageHours = Math.floor((Date.now() - new Date(si.created_at)) / 3600000);
        const injectMatch = si.text?.match(/## 💉 Inject Into Strategy\s*([\s\S]+?)(?=\n## |$)/);
        const injectText = injectMatch ? injectMatch[1].trim() : si.text?.slice(0, 500);
        if (injectText) {
          const ageLabel = ageHours < 48 ? `${ageHours}h ago` : `${Math.floor(ageHours/24)}d ago`;
          studioIntelBlock2 = `\n\n## YOUTUBE STUDIO AUDIENCE INTELLIGENCE (${ageLabel})\n${injectText}\nBias concepts toward what this audience data reveals.`;
        }
      }
    } catch (_) {}

    // H7: Post-Mortem brief (conversational path)
    let postMortemBlock2 = '';
    try {
      const pm2 = require('../db').getActivePostMortemBrief();
      if (pm2) {
        postMortemBlock2 = '\n\n## LAST POST-MORTEM — DO NOT REPEAT THESE MISTAKES';
        if (pm2.root_cause)  postMortemBlock2 += `\nRoot cause: ${pm2.root_cause}`;
        if (pm2.adjustments) postMortemBlock2 += `\nAdjustments: ${pm2.adjustments}`;
        if (pm2.avoid)       postMortemBlock2 += `\nAvoid: ${pm2.avoid}`;
        postMortemBlock2 += '\nDo not generate concepts that repeat this pattern.';
      }
    } catch (_) {}

    // H6: Voice calibration + audience target (conversational path)
    let voiceBlock2 = '';
    try {
      const { loadVoiceCalibrationBlock, loadAudienceTargetBlock } = require('../writr/claude');
      const vcb  = loadVoiceCalibrationBlock();
      const aub  = loadAudienceTargetBlock();
      if (vcb) voiceBlock2 += `\n\n${vcb}`;
      if (aub) voiceBlock2 += `\n\n${aub}`;
    } catch (_) {}

    const result = await callClaudeJSON(
      `You are Id8Ωr, a creative strategist for ${brand} (${followerSummary}, ${niche} content). Based on the conversation below, generate exactly 3 concept directions for the next video.

RULES:
- Concepts 1 and 2 MUST use angles from the provided list below. Pick the 2 best fits for what was described.
- Concept 3 MUST be a novel angle you invent — something NOT on the list. A fresh frame, an unexpected lens, a creative repackage of the topic that doesn't fit any existing category.
- Each concept must be meaningfully different — different audience hook, different emotional entry point.
- Be specific to what was discussed, not generic. Match the creator's real voice: straight-talking, funny, real numbers, never corporate.

CONTENT ANGLES:
${anglesText}${intelligenceBlock}${clipsrBlock}${mirrrBlock}${studioIntelBlock2}${postMortemBlock2}${voiceBlock2}

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

    const session = getOrRestoreSession(session_id);
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    const choiceNum = parseInt(choice);
    const concepts  = session.concepts || [];
    // H10: accept any valid index — fast-concepts returns 5, conversational returns 3
    // Previously clamped to 1–3, silently discarding cards 4 and 5 as "blends"
    if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= concepts.length) {
      session.chosenConcept = concepts[choiceNum - 1] || {
        id: choiceNum, angle: 'Custom', headline: String(choice), why: '', hook: '',
      };
    } else {
      // Free-text blend
      session.chosenConcept = {
        id: 0, angle: 'Custom Direction', headline: String(choice), why: 'Creator-defined direction', hook: '',
      };
    }

    persistSession(session_id);
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

    const session = getOrRestoreSession(session_id);
    if (!session) {
      send({ stage: 'error', error: 'SESSION_EXPIRED', message: SESSION_EXPIRED.message });
      cleanup();
      return res.end();
    }

    // M7: include delay_ms + attempt so the frontend toast shows accurate backoff info
    const onRetry = (attempt, delayMs, reason) => send({
      stage:    'retrying',
      delay_ms: delayMs,
      attempt:  attempt,
      message:  `Claude is ${reason} — retrying in ${Math.round(delayMs / 1000)}s… (attempt ${attempt} of ${BACKOFF_DELAYS.length})`,
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

    // ── Phase 1: YouTube Landscape (Gemini live search → Claude fallback) ────────
    const phase1Label = chosenAngle ? `YouTube Research — ${chosenAngle}` : 'YouTube Research';
    send({ stage: 'phase_start', phase: 1, label: phase1Label });
    try {
      const p1 = await callGeminiWithFallback(
        // Gemini prompt — tight and search-optimized
        `Research YouTube content landscape for: ${conceptBrief}

Search for: what types of YouTube videos exist on this topic right now, which channels dominate, what angles are oversaturated, and what content gap exists that a homesteading/financial-freedom creator with 725k TikTok and 54k YouTube could own.

Return: 4-5 specific video types performing well (with channel examples if findable), the dominant angle that owns this space, and ONE specific gap this creator could own. Be concrete — real channel names, real approaches.`,
        // Claude fallback system
        `You are a YouTube research analyst for ${_brand}, a ${_niche} channel with ${_fs}. Draw on your training knowledge of YouTube content trends. Name real channels, real video types, and real content gaps.`,
        [{ role: 'user', content: `${conceptBrief}\n\nName 4-5 video types that perform well for this topic (with channel examples). What angle dominates? What ONE gap could this creator own?` }],
        1200, session_id, onRetry
      );
      results.youtube = p1.text;
      results.youtube_source  = p1.source;
      results.youtube_sources = p1.sources || [];
      if (p1.source === 'gemini') send({ stage: 'phase_note', phase: 1, message: '🔍 Live Google search' });
    } catch (e) {
      console.error('[id8r/research] Phase 1 error:', e.message);
      results.youtube = `Research unavailable: ${e.message}`;
      results.youtube_source = 'error';
    }
    send({ stage: 'phase_result', phase: 1, label: phase1Label, data: results.youtube, source: results.youtube_source, sources: results.youtube_sources || [] });
    try {
      db.setCheckpoint(session_id, 'id8r', {
        ...session,
        researchResults: { youtube: results.youtube, data: null, vault: null },
      });
    } catch (_) {}

    // ── Phase 2: Data & Facts (Gemini live search → Claude fallback) ──────────
    const phase2Label = chosenAngle ? `Data & Facts — ${chosenAngle}` : 'Data & Facts';
    send({ stage: 'phase_start', phase: 2, label: phase2Label });
    try {
      const p2 = await callGeminiWithFallback(
        // Gemini prompt
        `Find real statistics, studies, and data points for: ${conceptBrief}

Search for: concrete numbers, named studies, government or credible source data that supports or challenges this video angle. The creator's audience cares about real costs, real outcomes, financial impact, and practical implications for self-reliant/off-grid people.

Return: 3-5 specific statistics with source names. Include publication year where findable. Prioritize numbers that would make someone stop scrolling — surprising, counterintuitive, or financially significant.`,
        // Claude fallback system
        `You are a research analyst for ${_brand}, a ${_niche} content creator. Surface compelling statistics and data points from your training knowledge. Real numbers, named studies, credible sources.`,
        [{ role: 'user', content: `${conceptBrief}\n\nGive 3-5 concrete statistics or research findings that strengthen this angle. Include source names. Make them scroll-stopping.` }],
        1200, session_id, onRetry
      );
      results.data = p2.text;
      results.data_source  = p2.source;
      results.data_sources = p2.sources || [];
      // M3: accumulate citations from ALL grounded phases — Phase 1 sources were dropped before
      const allSources = [...(results.youtube_sources || []), ...(p2.sources || [])];
      const seenUrls   = new Set();
      session.citations = allSources.filter(s => {
        const u = s.uri || s.url || s;
        if (seenUrls.has(u)) return false;
        seenUrls.add(u); return true;
      });
      if (p2.source === 'gemini') send({ stage: 'phase_note', phase: 2, message: '🔍 Live Google search' });
    } catch (e) {
      console.error('[id8r/research] Phase 2 error:', e.message);
      results.data = `Research unavailable: ${e.message}`;
      results.data_source  = 'error';
      session.citations    = [];
    }
    send({ stage: 'phase_result', phase: 2, label: phase2Label, data: results.data, source: results.data_source, sources: results.data_sources || [] });
    try {
      db.setCheckpoint(session_id, 'id8r', {
        ...session,
        researchResults: { youtube: results.youtube, data: results.data, vault: null },
      });
    } catch (_) {}

    // ── Phase 3: VaultΩr cross-reference (DB direct — no HTTP auth issues) ────
    const phase3Label = 'VaultΩr — have you covered this before?';
    send({ stage: 'phase_start', phase: 3, label: phase3Label });
    try {
      const allFootage = db.getAllFootage({ limit: 500 });
      const completed  = (allFootage || []).filter(f =>
        f.shot_type === 'completed-video' || f.classification || f.status === 'completed'
      );

      if (completed.length === 0) {
        results.vault = 'No completed videos in VaultΩr yet — fresh territory.';
      } else {
        // Keyword match against title, tags, description, classification
        const keywords = conceptBrief.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const related  = completed.filter(f => {
          const haystack = [f.title, f.tags, f.description, f.classification, f.topic]
            .filter(Boolean).join(' ').toLowerCase();
          return keywords.some(k => haystack.includes(k));
        });

        if (related.length === 0) {
          results.vault = `VaultΩr has ${completed.length} completed videos — none closely match this topic. Fresh territory.`;
        } else {
          const names = related.slice(0, 5).map(f => f.title || f.filename || `footage_${f.id}`).join(', ');
          results.vault = `VaultΩr found ${related.length} related video(s): ${names}. Review before filming — existing footage may be reusable or need a fresh angle to avoid repeating yourself.`;
        }
      }
    } catch (e) {
      console.error('[id8r/research] Phase 3 error:', e.message);
      results.vault = `VaultΩr check failed: ${e.message}`;
    }
    send({ stage: 'phase_result', phase: 3, label: phase3Label, data: results.vault });
    try {
      db.setCheckpoint(session_id, 'id8r', {
        ...session,
        researchResults: { youtube: results.youtube, data: results.data, vault: results.vault },
      });
    } catch (_) {}

    // ── Phase 4: Summarization ────────────────────────────────────────────────
    send({ stage: 'phase_start', phase: 4, label: 'Synthesizing research...' });

    session.researchResults = results;

    // Build a clean summary input — gracefully handle any phase that errored
    const youtubeText = (results.youtube || '').startsWith('Research unavailable')
      ? '(YouTube research unavailable)'
      : (results.youtube || '').slice(0, 2000);
    const dataText    = (results.data || '').startsWith('Research unavailable')
      ? '(Data research unavailable)'
      : (results.data || '').slice(0, 2000);
    const vaultText   = (results.vault || '').slice(0, 500);

    try {
      session.researchSummary = await callClaudeText(
        `You are a research synthesizer for ${_brand}, a ${_niche} creator. Synthesize these research results into actionable bullet points for a content creator about to make a video. Under 400 words. Plain text bullets only — no markdown headers. Focus on: content gaps to exploit, strongest data points to use on camera, and vault context.`,
        [{
          role: 'user',
          content: `YouTube landscape:\n${youtubeText}\n\nData & facts:\n${dataText}\n\nVaultΩr:\n${vaultText}\n\nConcept: ${conceptBrief}\n\nSynthesize into actionable bullets.`,
        }],
        700, session_id, onRetry
      );
    } catch (e) {
      console.error('[id8r] Phase 4 summarization failed:', e.message);
      // Hard fallback — never leave researchSummary empty
      const bullets = [];
      if (youtubeText && !youtubeText.includes('unavailable')) bullets.push(`YouTube: ${youtubeText.slice(0, 250)}`);
      if (dataText    && !dataText.includes('unavailable'))    bullets.push(`Data: ${dataText.slice(0, 250)}`);
      if (vaultText)  bullets.push(`Vault: ${vaultText.slice(0, 150)}`);
      session.researchSummary = bullets.join('\n\n') || 'Research completed — see individual phase results above.';
    }

    // Save raw research to session vault (no project_id yet — saved again at send-pipeline)
    session._researchVaultData = {
      savedAt:         new Date().toISOString(),
      chosenConcept:   session.chosenConcept || null,
      researchResults: session.researchResults || results,
      researchSummary: session.researchSummary || null,
    };

    persistSession(session_id);
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

    const session = getOrRestoreSession(session_id);
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
    { "text": "Title 1", "angle": "Why this works (1 sentence max)" },
    { "text": "Title 2", "angle": "Why this works (1 sentence max)" },
    { "text": "Title 3", "angle": "Why this works (1 sentence max)" }
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
      2048,
      session_id
    );

    session.packageData = result;
    session._packageVaultData = { savedAt: new Date().toISOString(), packageData: result };
    persistSession(session_id);
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

    const session = getOrRestoreSession(session_id);
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
    persistSession(session_id);
    res.json(result);
  } catch (e) {
    console.error('[id8r/brief]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/id8r/send-pipeline ─────────────────────────────────────────────

// Inline edits from the Vision Brief screen arrive with the send-pipeline call.
// They're written into the SAME briefData fields every downstream consumer
// (WritΩr, project-context.json, vault, id8r_data) already reads — no schema change.
function applyBriefEdits(session, edits) {
  if (!edits || typeof edits !== 'object') return;
  const brief = session.briefData || (session.briefData = {});
  for (const f of ['elevator_pitch', 'audience_insight', 'story_angle']) {
    if (typeof edits[f] === 'string') brief[f] = edits[f];
  }
  for (const f of ['talking_points', 'what_not_to_do']) {
    if (Array.isArray(edits[f])) {
      brief[f] = edits[f].filter(p => typeof p === 'string' && p.trim()).map(p => p.trim());
    }
  }
  if (edits.pipeline_brief && typeof edits.pipeline_brief === 'object') {
    const pb = { ...(brief.pipeline_brief || {}) };
    for (const f of ['title', 'concept_note', 'high_concept']) {
      if (typeof edits.pipeline_brief[f] === 'string') pb[f] = edits.pipeline_brief[f];
    }
    brief.pipeline_brief = pb;
  }
  // Edited hook flows into chosenConcept.hook — the field WritΩr and
  // project-context.json read as the opening hook
  if (typeof edits.selected_hook === 'string' && edits.selected_hook.trim() && session.chosenConcept) {
    session.chosenConcept.hook = edits.selected_hook.trim();
  }
  // Keep the vault copy in sync so id8r/brief.json reflects what was dispatched
  if (session._briefVaultData) {
    session._briefVaultData = { ...session._briefVaultData, briefData: brief, editedAt: new Date().toISOString() };
  }
}

router.post('/send-pipeline', async (req, res) => {
  try {
    const { session_id, destination, project_id: existingProjectId, brief_edits } = req.body;

    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const session = getOrRestoreSession(session_id);
    if (!session) return res.status(404).json(SESSION_EXPIRED);

    if (!session.briefData && !session.packageData) return res.status(400).json({ error: 'No brief generated yet — run /brief first' });

    if (brief_edits) {
      applyBriefEdits(session, brief_edits);
      persistSession(session_id);
    }

    const brief = session.briefData || {};
    const pb    = brief.pipeline_brief || {};

    // If caller passes an existing project_id (e.g. attaching brief to a PipΩr project),
    // update that project instead of creating a new one
    let project;
    if (existingProjectId) {
      project = db.getProject(parseInt(existingProjectId, 10));
      if (!project) return res.status(404).json({ error: 'Project not found' });
    } else {
      const title = pb.title || brief.elevator_pitch || session.chosenConcept?.headline || 'Untitled Id8Ωr Project';
      const topic = [pb.high_concept, pb.content_angle, pb.concept_note].filter(Boolean).join(' | ');
      project = db.createProject(title, topic, null, null);
      // Stamp source='id8r' so Mission Control dedup prefers PipΩr version if one exists
      try { db.setProjectSource(project.id, 'id8r'); } catch (_) {}
    }

    // Write brief fields to DB so PipΩr and WritΩr can pre-populate
    // M5: content_type = format (short_form/long_form/series), NOT the angle
    // content_angle goes into high_concept_angles (projects table already has this column)
    db.updateProjectPipr(project.id, {
      entry_point:  pb.entry_point  || 'script_first',
      content_type: pb.content_type || 'long_form',
      high_concept: pb.high_concept || '',
    });
    if (pb.content_angle) {
      try { db.getRawDb().prepare('UPDATE projects SET high_concept_angles = ? WHERE id = ?').run(pb.content_angle, project.id); } catch (_) {}
    }

    // Persist full Id8Ωr research session so WritΩr can inject creative context into prompts.
    // When attaching to an EXISTING project, merge into existing id8r_data rather than
    // overwriting — prevents a partial session (e.g. packageData only, no brief) from
    // clobbering a previously-saved chosenConcept/researchSummary/briefData.
    const existingId8rData = existingProjectId
      ? (() => { try { const p = db.getProject(parseInt(existingProjectId, 10)); return JSON.parse(p?.id8r_data || '{}'); } catch (_) { return {}; } })()
      : {};
    db.updateProjectId8r(project.id, {
      ...existingId8rData,
      ...(session.chosenConcept   != null && { chosenConcept:   session.chosenConcept }),
      ...(session.researchSummary != null && { researchSummary: session.researchSummary }),
      ...(session.packageData     != null && { packageData:     session.packageData }),
      ...(session.briefData       != null && { briefData:       session.briefData }),
      ...(session.citations?.length       && { citations:       session.citations }),
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
      const projectTitle = project.title || pb.title || brief.elevator_pitch || chosen?.headline || 'Untitled';
      const readme = [
        `VAULT-README — Project ${project.id}: ${projectTitle}`,
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
