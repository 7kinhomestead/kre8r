/**
 * Shared Claude API caller — src/utils/claude.js
 *
 * callClaude(prompt, maxTokens, options)
 *   options.onRetry(attempt, delayMs, reason) — called before each retry wait
 *     SSE callers: pass (attempt, delay, reason) => send({ type:'retry', ... })
 *     Non-SSE callers: omit, retries happen silently
 */

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Statuses that are worth retrying — server-side congestion, not caller error
const RETRYABLE_STATUSES = new Set([429, 529]);
// Network error codes worth retrying
const RETRYABLE_CODES    = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT']);
// Backoff delays in ms for attempts 1, 2, 3, 4
const BACKOFF             = [2000, 4000, 8000, 16000];

function findLastCompleteSection(cleaned) {
  let depth     = 0;
  let lastClose = -1;
  let inString  = false;
  let escape    = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape)      { escape = false; continue; }
    if (ch === '\\') { escape = true;  continue; }
    if (ch === '"')  { inString = !inString; continue; }
    if (inString)    continue;
    if (ch === '{')  depth++;
    if (ch === '}')  { depth--; if (depth === 0) lastClose = i; }
  }
  return lastClose;
}

function repairJSON(cleaned) {
  try { return JSON.parse(cleaned); } catch (_) {}

  const arrStart = cleaned.indexOf('[');
  if (arrStart === -1) return null;

  const lastClose = findLastCompleteSection(cleaned.slice(arrStart));
  if (lastClose === -1) return null;

  const partial = cleaned.slice(arrStart, arrStart + lastClose + 1);
  try {
    const sections = JSON.parse(partial + ']');
    return { sections, overall_notes: '[truncated — JSON repaired]' };
  } catch (_) { return null; }
}

async function callClaude(prompt, maxTokens = 8192, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { onRetry, tool = 'unknown', session_id = null } = options;
  const { default: fetch } = await import('node-fetch');

  let lastError;

  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const ac = new AbortController();
      const timeoutMs = options.timeoutMs || 180000; // default 3 min; callers can override
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method  : 'POST',
        signal  : ac.signal,
        headers : {
          'Content-Type'      : 'application/json',
          'x-api-key'         : apiKey,
          'anthropic-version' : ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model      : MODEL,
          max_tokens : maxTokens,
          messages   : [{ role: 'user', content: prompt }],
        }),
      }).finally(() => clearTimeout(timer));

      // Retryable HTTP status
      if (RETRYABLE_STATUSES.has(response.status)) {
        const delay = BACKOFF[attempt];
        if (delay === undefined) {
          // Exhausted all retries
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.error?.message || `Claude API error ${response.status} — all retries exhausted`);
        }
        const reason = response.status === 429 ? 'rate limited' : 'overloaded';
        console.warn(`[claude] ${reason} (attempt ${attempt + 1}/${BACKOFF.length + 1}) — retrying in ${delay / 1000}s`);
        if (typeof onRetry === 'function') onRetry(attempt + 1, delay, reason);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Non-retryable HTTP error
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Claude API error ${response.status}`);
      }

      // Success — parse and return
      const data    = await response.json();
      // Log token usage — never let this break the response
      try {
        const inputTok  = data.usage?.input_tokens  || 0;
        const outputTok = data.usage?.output_tokens || 0;
        const cost = (inputTok * 0.000003) + (outputTok * 0.000015);
        require('../db').logTokenUsage({ tool, session_id, input_tokens: inputTok, output_tokens: outputTok, estimated_cost: cost });
      } catch (_) {}
      const raw     = data.content[0].text.trim();
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i,       '')
        .trim();

      try {
        return JSON.parse(cleaned);
      } catch (parseErr) {
        const repaired = repairJSON(cleaned);
        if (repaired) return repaired;
        throw new Error(
          `Claude returned malformed JSON: ${parseErr.message}. ` +
          `First 300 chars: ${cleaned.slice(0, 300)}`
        );
      }

    } catch (err) {
      // Retryable network error
      if (RETRYABLE_CODES.has(err.code)) {
        const delay = BACKOFF[attempt];
        if (delay === undefined) throw err;
        console.warn(`[claude] network error ${err.code} (attempt ${attempt + 1}/${BACKOFF.length + 1}) — retrying in ${delay / 1000}s`);
        if (typeof onRetry === 'function') onRetry(attempt + 1, delay, `network error (${err.code})`);
        await new Promise(r => setTimeout(r, delay));
        lastError = err;
        continue;
      }
      // Non-retryable — throw immediately
      throw err;
    }
  }

  throw lastError || new Error('Claude API call failed after all retries');
}

/**
 * callClaudeMessages(system, messages, maxTokens, options)
 *
 * Multi-turn version of callClaude. Takes a system prompt and a messages array
 * [{role:'user'|'assistant', content:'...'}]. Returns raw text (no JSON parsing).
 * Uses the same retry/backoff logic as callClaude.
 *
 * Used by WritΩr's RoΩm and any other multi-turn chat feature.
 */
async function callClaudeMessages(system, messages, maxTokens = 2048, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { onRetry, tool = 'unknown', session_id = null } = options;
  const { default: fetch } = await import('node-fetch');

  let lastError;

  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const body = { model: MODEL, max_tokens: maxTokens, messages };
      if (system) body.system = system;

      const ac2 = new AbortController();
      const timeoutMs2 = options.timeoutMs || 180000; // default 3 min; callers can override
      const timer2 = setTimeout(() => ac2.abort(), timeoutMs2);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method  : 'POST',
        signal  : ac2.signal,
        headers : {
          'Content-Type'      : 'application/json',
          'x-api-key'         : apiKey,
          'anthropic-version' : ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      }).finally(() => clearTimeout(timer2));

      if (RETRYABLE_STATUSES.has(response.status)) {
        const delay = BACKOFF[attempt];
        if (delay === undefined) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.error?.message || `Claude API error ${response.status} — all retries exhausted`);
        }
        const reason = response.status === 429 ? 'rate limited' : 'overloaded';
        console.warn(`[claude] ${reason} (attempt ${attempt + 1}/${BACKOFF.length + 1}) — retrying in ${delay / 1000}s`);
        if (typeof onRetry === 'function') onRetry(attempt + 1, delay, reason);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Claude API error ${response.status}`);
      }

      const data = await response.json();
      // Log token usage — never let this break the response
      try {
        const inputTok  = data.usage?.input_tokens  || 0;
        const outputTok = data.usage?.output_tokens || 0;
        const cost = (inputTok * 0.000003) + (outputTok * 0.000015);
        require('../db').logTokenUsage({ tool, session_id, input_tokens: inputTok, output_tokens: outputTok, estimated_cost: cost });
      } catch (_) {}
      return data.content[0].text.trim();

    } catch (err) {
      if (RETRYABLE_CODES.has(err.code)) {
        const delay = BACKOFF[attempt];
        if (delay === undefined) throw err;
        console.warn(`[claude] network error ${err.code} (attempt ${attempt + 1}/${BACKOFF.length + 1}) — retrying in ${delay / 1000}s`);
        if (typeof onRetry === 'function') onRetry(attempt + 1, delay, `network error (${err.code})`);
        await new Promise(r => setTimeout(r, delay));
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Claude API call failed after all retries');
}

/**
 * callClaudeStream(system, messages, maxTokens, onToken, options)
 *
 * Streaming version — calls Anthropic with stream:true, fires onToken(text)
 * for each text delta as it arrives. Returns the full assembled text when done.
 * Used by The Fence and any other SSE-streaming feature.
 */
async function callClaudeStream(system, messages, maxTokens = 512, onToken, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { tool = 'fence', session_id = null } = options;
  const { default: fetch } = await import('node-fetch');

  const body = { model: MODEL, max_tokens: maxTokens, stream: true, messages };
  if (system) body.system = system;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method  : 'POST',
    headers : {
      'Content-Type'      : 'application/json',
      'x-api-key'         : apiKey,
      'anthropic-version' : ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude stream error ${response.status}`);
  }

  let inputTokens  = 0;
  let outputTokens = 0;
  let fullText     = '';
  let buffer       = '';

  const stream = response.body;
  stream.setEncoding('utf8');

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'message_start') {
            inputTokens = ev.message?.usage?.input_tokens || 0;
          }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            const text = ev.delta.text;
            fullText += text;
            if (typeof onToken === 'function') onToken(text);
          }
          if (ev.type === 'message_delta') {
            outputTokens = ev.usage?.output_tokens || 0;
          }
        } catch (_) {}
      }
    });
    stream.on('end',   resolve);
    stream.on('error', reject);
  });

  // Log usage — never let this crash
  try {
    const cost = (inputTokens * 0.000003) + (outputTokens * 0.000015);
    require('../db').logTokenUsage({ tool, session_id, input_tokens: inputTokens, output_tokens: outputTokens, estimated_cost: cost });
  } catch (_) {}

  return fullText;
}

/**
 * SLOP_RULE — inject into any Claude prompt that generates audience-facing written content.
 * Emails, blog posts, captions, community posts, hooks — anything a human reads or hears.
 * Same list as WritΩr's SLOP_RULE. Single source of truth here, imported everywhere else.
 */
const SLOP_RULE = `VOICE AUTHENTICITY RULE — NEVER USE THESE PHRASES OR STRUCTURES:

BANNED PHRASES (AI tells — audiences clock these instantly):
- "It's not X, it's Y" construction (e.g. "It's not a tiny house, it's a lifestyle")
- "Let's dive in" / "Let's dive deep" / "Deep dive"
- "At the end of the day"
- "Game changer" / "This changes everything"
- "In today's world" / "In a world where"
- "Here's the thing..." (as an opener)
- "The truth is..."
- "What if I told you..."
- "Let's unpack that" / "Let's break this down"
- "Whether you're a beginner or an expert"
- "Without further ado"
- "Stay tuned" / "Don't forget to hit the bell"
- "Spoiler alert"
- "That's where [X] comes in"
- "But here's the kicker"
- "It begs the question"
- "Needless to say"
- "First and foremost" / "Last but not least"
- "That being said" / "With that being said" / "Having said that"
- "It's worth noting that" / "It's important to note"
- "It goes without saying"
- "Moving forward" / "Going forward"
- "Take it to the next level"
- "Now more than ever"
- "Simply put" / "In other words" / "Long story short"
- "When all is said and done"
- "As we can see" / "As you can see"
- "In conclusion" / "To summarize" / "In summary"
- "Studies show" or "Experts say" without a real specific source
- "The science is clear"
- "Here's what you need to know"
- "So, what does this mean for you?"
- "At its core"
- "Utilize" (say "use") / "Facilitate" / "Leverage" as a verb
- "Furthermore" / "Moreover" (in spoken or written content — sounds like an essay)
- "This allows us to" / "This enables"
- "So let's get into it" / "Let's get started"
- "Today we're going to be talking about"

BANNED STRUCTURES:
- "It's not X, it's Y" contrast sentences — the #1 AI tell, ban it completely
- Opening with "In this video I will..." / "In this post I will..." — just start
- Ending with a bulleted "Key takeaways" summary — that's a textbook, not Jason
- Transitions that sound like essay paragraphs ("Furthermore, this demonstrates...")
- Any sentence that sounds like it could appear in anyone else's content — rewrite it

WRITE LIKE THE BRAND ACTUALLY TALKS:
Straight-talking, warm, funny, never corporate. Real numbers. Real names. Real moments.
Tangents are fine. Interrupting the thought is fine. Sounding polished is not fine.
If a line sounds like it was written by a committee — it was. Cut it.`;

module.exports = { callClaude, callClaudeMessages, callClaudeStream, repairJSON, SLOP_RULE };
