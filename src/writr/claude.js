/**
 * WritΩr Claude API helper — src/writr/claude.js
 *
 * Shared Claude call function for all WritΩr entry points.
 * max_tokens is higher here (16384) because full scripts can be long.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

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
  } catch (parseErr) {
    // Fallback 1: try to extract "script" field directly — handles truncated iterate responses
    // where beat_map / changes_made overflow but the script value itself is complete.
    // Matches: "script": "...full string..." — stops at the next top-level key or end of object
    const scriptMatch = cleaned.match(/"script"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);
    if (scriptMatch) {
      let script = '';
      try { script = JSON.parse('"' + scriptMatch[1] + '"'); } catch (_) { script = scriptMatch[1]; }
      if (script) {
        return {
          script,
          beat_map:     [],
          missing_beats: [],
          changes_made: ['[response truncated — script recovered]'],
        };
      }
    }
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

// SLOP_RULE — single source of truth lives in src/utils/claude.js
const { SLOP_RULE } = require('../utils/claude');

// ── TikTok audience intelligence — shared across all WritΩr modes ─────────────
// Loads the last-saved TikTok pattern analysis from kv_store.
// Returns a formatted block to inject into any WritΩr prompt, or '' if no data.

function loadTikTokIntelligenceBlock() {
  try {
    const db     = require('../db');
    const stored = db.getKv('tiktok_content_patterns');
    if (!stored) return '';
    const p = JSON.parse(stored);
    if (!p) return '';
    const works = (p.what_works || []).slice(0, 3).map(w => `- ${w}`).join('\n');
    return `
## TIKTOK CLIP INTELLIGENCE (from real audience performance data)
This creator's short-form audience responds to these proven emotional triggers:
${works}
Audience psychology: ${p.audience_psychology || ''}
Content direction: ${p.content_direction || ''}

CLIP-PLANTING DIRECTIVE: Deliberately plant 1–2 self-contained moments (30–90s) in this script that could be extracted as standalone TikTok clips. Mark each with:
[● CLIP SEED: brief reason this moment is extractable and which pattern it hits]
These markers guide ClipsΩr when analyzing the finished video. Place them at high-energy or high-contrast points — NOT the opening or closing.
`;
  } catch (_) {
    return '';
  }
}

// ── Voice Calibration block — injected into every WritΩr prompt ──────────────
// Loads the master voice profile produced by scripts/voice-calibration.js.
// Returns a formatted injection block, or '' if calibration hasn't been run yet.

function loadVoiceCalibrationBlock() {
  try {
    const db     = require('../db');
    const stored = db.getKv('voice_calibration');
    let vc = null;

    if (stored) {
      vc = JSON.parse(stored);
    } else {
      // Fallback: read from JSON file (e.g. first run before kv_store is populated)
      const calPath = path.join(__dirname, '..', '..', 'data', 'voice-calibration.json');
      if (fs.existsSync(calPath)) {
        vc = JSON.parse(fs.readFileSync(calPath, 'utf8'));
        // Backfill kv_store so next call is faster
        try { db.setKv('voice_calibration', JSON.stringify(vc)); } catch (_) {}
      }
    }

    if (!vc) return '';

    const lines = ['## VOICE CALIBRATION (sourced from 190 real video transcripts — highest priority)'];

    if (vc.voice_summary) {
      lines.push(`\n${vc.voice_summary}`);
    }

    if (vc.the_fence_post_rule) {
      lines.push(`\nTHE VIBE: ${vc.the_fence_post_rule}`);
    }

    if (vc.sentence_rhythm) {
      lines.push(`\nSENTENCE RHYTHM: ${vc.sentence_rhythm}`);
    }

    if (vc.vocabulary_level) {
      lines.push(`\nVOCABULARY: ${vc.vocabulary_level}`);
    }

    const phrases = (vc.signature_phrases || []).slice(0, 15);
    if (phrases.length) {
      lines.push(`\nSIGNATURE PHRASES (use these — they're real):\n${phrases.map(p => `- "${p}"`).join('\n')}`);
    }

    if (vc.the_tangent_move) {
      lines.push(`\nTHE TANGENT MOVE (these are his most authentic moments): ${vc.the_tangent_move}`);
    }

    if (vc.number_rules) {
      lines.push(`\nNUMBER RULES: ${vc.number_rules}`);
    }

    if (vc.cari_and_family_references) {
      lines.push(`\nFAMILY REFERENCES: ${vc.cari_and_family_references}`);
    }

    const neverDoes = (vc.what_jason_never_does || []).slice(0, 8);
    if (neverDoes.length) {
      lines.push(`\nJASON NEVER DOES THESE (derived from his actual 190 videos):\n${neverDoes.map(x => `- ${x}`).join('\n')}`);
    }

    // Few-shot examples — most useful for grounding the voice
    const examples = vc.few_shot_examples || {};
    const general  = (examples.general || []).slice(0, 6);
    if (general.length) {
      lines.push(`\nQUINTESSENTIAL JASON SENTENCES (write like this):\n${general.map(s => `• ${s}`).join('\n')}`);
    }

    return '\n' + lines.join('\n') + '\n';
  } catch (_) {
    return '';
  }
}

// ── Audience Target Block — injected into every WritΩr prompt and Id8Ωr ──────
// Reads audience_profile + niche_block from creator-profile.json.
// Renders THE TARGET: who they are, beliefs, four fears, governing question, title formula.
// Frame this as the target, not trivia — every script answers the governing question.

function loadAudienceTargetBlock() {
  try {
    const { loadProfile } = require('../utils/profile-validator');
    const result = loadProfile();
    if (!result.ok) return '';
    const ap = result.profile?.audience_profile;
    const nb = result.profile?.niche_block;
    if (!ap && !nb) return '';

    const lines = ['## THE TARGET — every script answers this or it doesn\'t ship'];

    if (nb?.governing_question) {
      lines.push(`\nGOVERNING QUESTION: "${nb.governing_question}"`);
      lines.push('This is the real ask beneath every video. If the script does not answer it, the audience feels nothing.');
    }

    if (ap?.who_they_are) {
      lines.push(`\nWHO THEY ARE: ${ap.who_they_are}`);
    }

    const beliefs = ap?.what_they_believe || [];
    if (beliefs.length) {
      lines.push(`\nWHAT THEY ALREADY BELIEVE (meet them here, don\'t argue with it):\n${beliefs.map(b => `- ${b}`).join('\n')}`);
    }

    const fears = ap?.what_they_fear || [];
    if (fears.length) {
      lines.push(`\nTHEIR FOUR FEARS (name one of these in the hook and the script earns trust):\n${fears.map((f, i) => `${i + 1}. ${f}`).join('\n')}`);
    }

    const converts = ap?.content_that_converts || [];
    if (converts.length) {
      lines.push(`\nCONTENT THAT CONVERTS:\n${converts.map(c => `- ${c}`).join('\n')}`);
    }

    if (nb?.title_formula) {
      lines.push(`\nTITLE FORMULA: ${nb.title_formula}`);
    }

    if (nb?.clusters?.length) {
      const sorted = [...nb.clusters].sort((a, b) => b.avg_views - a.avg_views);
      lines.push(`\nPERFORMANCE MAP (highest-performing clusters first):\n${sorted.map(c => `- ${c.name}: ~${Number(c.avg_views).toLocaleString()} avg views`).join('\n')}`);
    }

    // Channel DNA secrets — top patterns from real video performance data
    try {
      const db      = require('../db');
      const raw     = db.getKv('channel_dna_secrets');
      const secrets = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      if (Array.isArray(secrets) && secrets.length) {
        // Prefer pattern + warning types (most actionable for writing), then fill with others
        const priority = secrets.filter(s => s.type === 'pattern' || s.type === 'warning');
        const rest     = secrets.filter(s => s.type !== 'pattern' && s.type !== 'warning');
        const top      = [...priority, ...rest].slice(0, 3);
        lines.push(`\nCHANNEL DNA (from real video performance — apply these, don't ignore them):\n${top.map(s =>
          `• ${s.title}: ${s.implication || s.insight}`
        ).join('\n')}`);
      }
    } catch (_) {}

    return '\n' + lines.join('\n') + '\n';
  } catch (_) {
    return '';
  }
}

module.exports = { callClaude, REALITY_RULE, SLOP_RULE, loadTikTokIntelligenceBlock, loadVoiceCalibrationBlock, loadAudienceTargetBlock };
