/**
 * WritΩr Claude API helper — src/writr/claude.js
 *
 * Shared Claude call function for all WritΩr entry points.
 * max_tokens is higher here (16384) because full scripts can be long.
 */

'use strict';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS        = 16384;

/**
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string}  [opts.systemPrompt]
 * @param {number}  [opts.maxTokens]   — defaults to 16384
 * @param {boolean} [opts.raw]         — if true, return cleaned text instead of parsing JSON
 */
async function callClaude(prompt, { systemPrompt = null, maxTokens = MAX_TOKENS, raw = false } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');

  const body = {
    model:      MODEL,
    max_tokens: maxTokens,
    messages:   [{ role: 'user', content: prompt }]
  };
  if (systemPrompt) body.system = systemPrompt;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Raw mode — caller wants plain text (script writing, etc.)
  if (raw) return cleaned;

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    throw new Error(
      `Claude returned non-JSON response. First 400 chars: ${cleaned.slice(0, 400)}`
    );
  }
}

/**
 * The Reality Rule system prompt — embedded in every WritΩr Claude call.
 * This is non-negotiable. WritΩr never fabricates.
 */
const REALITY_RULE = `REALITY RULE — READ THIS FIRST AND NEVER VIOLATE IT:
This tool works exclusively with REALITY content. The creator makes real videos about
real life — actual projects, actual experiences, actual people, actual numbers.

YOU MAY NEVER:
- Invent story moments that didn't happen
- Fabricate conflicts, setbacks, or resolutions
- Suggest fictional dialogue or events
- Fill story gaps with made-up content
- Imply something happened that the creator didn't describe

WHEN A BEAT HAS NO AUTHENTIC CONTENT:
Flag it clearly as [BEAT NEEDED: beat_name — authentic description of what real moment
could fill this beat]. Do not invent the moment. Do not pretend it happened.

The creator's audience trusts them because everything is real. Fabrication destroys that trust.`;

module.exports = { callClaude, REALITY_RULE };
