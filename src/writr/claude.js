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

/**
 * AI Slop Blacklist — injected into every WritΩr prompt alongside REALITY_RULE.
 * These are the phrases that make audiences instantly recognize AI-written scripts
 * and tune out. Jason's audience is sharp. One of these kills credibility.
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
- "At its core" / "At the end of the day"
- "Utilize" (say "use") / "Facilitate" / "Leverage" as a verb
- "Furthermore" / "Moreover" (in spoken dialogue — sounds like an essay)
- "This allows us to" / "This enables"
- "So let's get into it" / "Let's get started"
- "Today we're going to be talking about"

BANNED STRUCTURES:
- Rhetorical "It's not X, it's Y" contrast sentences — the commenter who said this was right, it's the #1 AI tell
- Opening with "In this video I will..." — Jason never announces, he just goes
- Ending with a bulleted "Key takeaways" summary — that's a blog post, not Jason
- Transitions that sound like essay paragraphs ("Furthermore, this demonstrates...")
- Any sentence that sounds like it came from a PowerPoint slide

WRITE LIKE JASON ACTUALLY TALKS:
Jason interrupts himself. He goes on tangents. He says "dude" and "man" and "honestly."
He references specific real things — the actual price, the actual date, Cari's actual name.
He does not summarize. He does not transition smoothly. He just says the next real thing.
If a line sounds like it could appear in anyone else's video — rewrite it.`;

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

module.exports = { callClaude, REALITY_RULE, SLOP_RULE, loadTikTokIntelligenceBlock };
