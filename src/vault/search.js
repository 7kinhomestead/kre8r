/**
 * VaultΩr Search Engine — src/vault/search.js
 *
 * Translates a natural language query into a SQLite WHERE clause using Claude,
 * then executes it against the footage table via db.searchFootageByWhere().
 *
 * The WHERE clause is the only moving part — the SELECT and ORDER BY are
 * fixed in db.js, so there is no path to injection beyond what the sanitizer
 * in db.js already blocks (semicolons, DROP, DELETE, INSERT, UPDATE).
 */

'use strict';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// ─────────────────────────────────────────────
// SCHEMA CONTEXT — sent with every search request
// ─────────────────────────────────────────────

const SCHEMA_CONTEXT = `
You are a SQLite query assistant for a video footage database called VaultΩr.

Table: footage
Columns:
  id               INTEGER  — primary key
  project_id       INTEGER  — nullable, links to a project
  file_path        TEXT     — absolute path to the source file
  original_filename TEXT    — original filename
  shot_type        TEXT     — one of: dialogue, talking-head, b-roll, action, completed-video, unusable, unclassified
  subcategory      TEXT     — one of: wide, medium, close-up, detail (b-roll only; NULL for others)
  description      TEXT     — 1-2 sentence content description from Claude Vision
  subjects         TEXT     — JSON array of specific searchable topics (e.g. '["goat","water tank","kids"]')
  duration         REAL     — clip length in seconds
  resolution       TEXT     — e.g. "3840x2160", "1920x1080"
  codec            TEXT     — e.g. "h264", "hevc", "prores"
  file_size        INTEGER  — bytes
  creation_timestamp TEXT   — ISO 8601 datetime from file metadata
  thumbnail_path   TEXT     — path to thumbnail image
  quality_flag     TEXT     — one of: hero, usable, review, discard
  organized_path   TEXT     — nullable; set after organizing, null if not yet organized
  used_in          TEXT     — JSON array of project_ids
  ingested_at      DATETIME — when the clip was ingested

Your task: translate the user's natural language query into a SQLite WHERE clause fragment.

Rules:
  - Return ONLY the WHERE clause body — no SELECT, no WHERE keyword, no semicolons
  - Use LIKE with % wildcards for text searches on description, original_filename, subjects
  - Use exact equality for shot_type, subcategory, quality_flag (they have fixed vocabularies)
  - Use CAST(duration AS INTEGER) for integer duration comparisons
  - Multiple conditions: use AND / OR with parentheses for clarity
  - If no filter applies, return: 1=1
  - Never use subqueries, DROP, DELETE, INSERT, UPDATE, or semicolons
  - Return plain SQL only — no markdown, no explanation, no code fences

Examples:
  Query: "hero quality b-roll"
  Response: shot_type = 'b-roll' AND quality_flag = 'hero'

  Query: "wide shots of the garden"
  Response: shot_type = 'b-roll' AND subcategory = 'wide' AND description LIKE '%garden%'

  Query: "clips over 30 seconds"
  Response: duration > 30

  Query: "4K footage not yet organized"
  Response: resolution LIKE '%3840%' AND organized_path IS NULL

  Query: "talking head shots flagged for review"
  Response: shot_type = 'talking-head' AND quality_flag = 'review'

  Query: "anything with chickens or goats"
  Response: (description LIKE '%chicken%' OR subjects LIKE '%chicken%') OR (description LIKE '%goat%' OR subjects LIKE '%goat%')

  Query: "short b-roll clips under 10 seconds, hero or usable"
  Response: shot_type = 'b-roll' AND duration < 10 AND quality_flag IN ('hero', 'usable')
`.trim();

// ─────────────────────────────────────────────
// BUILD WHERE CLAUSE
// ─────────────────────────────────────────────

async function buildWhereClause(query) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 256,
      system:     SCHEMA_CONTEXT,
      messages: [{
        role:    'user',
        content: query
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();
  const raw  = data.content[0].text.trim();

  // Strip any accidental markdown fences
  const cleaned = raw
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Basic sanity check — must not be empty
  if (!cleaned) throw new Error('Claude returned an empty WHERE clause');

  return cleaned;
}

module.exports = { buildWhereClause };
