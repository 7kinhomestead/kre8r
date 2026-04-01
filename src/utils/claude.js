/**
 * Shared Claude API caller — src/utils/claude.js
 */

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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

async function callClaude(prompt, maxTokens = 8192) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');

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

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

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
}

module.exports = { callClaude, repairJSON };
