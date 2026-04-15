/**
 * WritΩr — Paste-In / Import Script engine
 * src/writr/paste-in.js
 *
 * The creator pastes a fully written script (written on-platform or off).
 * We NEVER rewrite it. Claude's only job is to:
 *   1. Map each beat to the specific section of the script that covers it
 *   2. Flag any beats with no coverage (creator decides how to handle)
 *
 * The pasted script is stored verbatim as generated_script.
 * beat_map_json is built from Claude's mapping so AssemblΩr can use it.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callClaude } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');
const PROJECTS_DIR         = path.join(__dirname, '..', '..', 'database', 'projects');

function loadProjectConfig(projectId) {
  const p = path.join(PROJECTS_DIR, String(projectId), 'project-config.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function beatMapToText(beats) {
  if (!beats || !beats.length) return '(no beat map — will tag chronologically)';
  return beats.map((b, i) =>
    `  Beat ${i} "${b.name}": ${b.emotional_function || ''}`
  ).join('\n');
}

/**
 * Map beats to a pasted script without rewriting anything.
 * Returns { beat_map_json, missing_beats, hook_variations }
 */
async function mapBeatsToScript(scriptText, config, emit) {
  const beats    = config?.beats || [];
  const beatText = beatMapToText(beats);

  if (beats.length === 0) {
    // No beat map — just store as-is with a single freeform beat entry
    return {
      beat_map_json:   [{ beat_name: 'Full Script', beat_index: 0, covered: true, real_moment: scriptText.slice(0, 200) }],
      missing_beats:   [],
      hook_variations: []
    };
  }

  emit({ stage: 'mapping', message: 'Mapping your script to the beat structure…' });

  const prompt = `You are a script editor. A creator has written their own script. Do NOT rewrite or change any of it.

Your only job: read the script and map each story beat to the exact section of the script that covers it.

BEAT MAP (${config?.story_structure || 'custom'}):
${beatText}

CREATOR'S SCRIPT (use this verbatim — do not alter):
${scriptText}

Return ONLY valid JSON. For each beat, quote the EXACT opening words (first ~10 words) from the script section that covers it.
{
  "beat_map": [
    {
      "beat_name": "string",
      "beat_index": 0,
      "covered": true,
      "real_moment": "exact opening words from the script that start this beat section"
    }
  ],
  "missing_beats": ["beat name if nothing in the script covers it"],
  "hook_variations": ["first sentence of script as written", "alternative opening if obvious from script", ""]
}

beat_index is 0-based. Every beat from 0 to ${beats.length - 1} must appear. If a beat is not covered, set covered=false and real_moment=null.`;

  try {
    const result = await callClaude(prompt, 4096);
    return {
      beat_map_json:   result.beat_map   || [],
      missing_beats:   result.missing_beats || [],
      hook_variations: result.hook_variations || []
    };
  } catch (e) {
    emit({ stage: 'warning', message: `Beat mapping failed: ${e.message} — script stored as-is` });
    return {
      beat_map_json:   beats.map((b, i) => ({ beat_name: b.name, beat_index: i, covered: false, real_moment: null })),
      missing_beats:   beats.map(b => b.name),
      hook_variations: []
    };
  }
}

/**
 * Main entry point called from writr route.
 * emit(event) — SSE progress callback
 * Returns the data object to store in writr_scripts.
 */
async function buildPasteIn(projectId, scriptText, emit) {
  if (!scriptText || !scriptText.trim()) {
    return { ok: false, error: 'No script text provided' };
  }

  const config = loadProjectConfig(projectId);

  const { beat_map_json, missing_beats, hook_variations } = await mapBeatsToScript(scriptText.trim(), config, emit);

  emit({ stage: 'done', message: 'Script imported and beats mapped.' });

  return {
    ok:                true,
    generated_script:  scriptText.trim(),  // verbatim — not touched
    generated_outline: null,
    beat_map_json,
    missing_beats,
    hook_variations,
    story_found:       config?.high_concept || null,
    anchor_moment:     null,
    entry_point:       'paste_in'
  };
}

module.exports = { buildPasteIn };
