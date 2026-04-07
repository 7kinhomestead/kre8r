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

  const { onRetry } = options;
  const { default: fetch } = await import('node-fetch');

  let lastError;

  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method  : 'POST',
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
      });

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

  const { onRetry } = options;
  const { default: fetch } = await import('node-fetch');

  let lastError;

  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try {
      const body = { model: MODEL, max_tokens: maxTokens, messages };
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

module.exports = { callClaude, callClaudeMessages, repairJSON };
