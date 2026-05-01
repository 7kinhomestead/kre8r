/**
 * WritΩr — Script First entry point
 * src/writr/script-first.js
 *
 * The creator has a script or outline they've already written (or partially written).
 * WritΩr maps it to the chosen beat structure, identifies gaps, and produces a
 * beat-mapped full draft that stays in their voice.
 *
 * REALITY RULE: Every script element must be something the creator can authentically
 * say or show. Missing beats are flagged — never invented.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callClaude, REALITY_RULE, SLOP_RULE, loadTikTokIntelligenceBlock } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');
const PROJECTS_DIR         = path.join(__dirname, '..', '..', 'database', 'projects');

function loadCreatorProfile() {
  try {
    return JSON.parse(fs.readFileSync(CREATOR_PROFILE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadProjectConfig(projectId) {
  const p = path.join(PROJECTS_DIR, String(projectId), 'project-config.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

const { buildVoiceSummaryFromProfiles } = require('./voice-analyzer');

function buildVoiceSummary(profile, voiceProfiles) {
  return buildVoiceSummaryFromProfiles(profile, voiceProfiles);
}

function beatMapToText(beats) {
  if (!beats || !beats.length) return '(no beat map — free form)';
  return beats.map(b =>
    `  Beat ${b.index}: ${b.name} (target: ${b.target_pct}% into video)\n` +
    `    Purpose: ${b.emotional_function}\n` +
    `    Reality Q: ${b.reality_note}`
  ).join('\n');
}

function buildSeasonBlock(seasonContext) {
  if (!seasonContext) return '';
  const { show, episodes, seeds_unresolved, arc_position, next_episode_number, current_episode } = seasonContext;
  const lines = [
    `## SERIES CONTEXT — ${show.name}`,
    `Season ${show.season || 1}, Episode ${next_episode_number} of ${show.target_episodes}`,
    `Arc Position: ${arc_position}`,
    show.central_question ? `Central Question: ${show.central_question}` : null,
  ].filter(Boolean);
  if (episodes.length) {
    lines.push('\nWHAT HAS BEEN ESTABLISHED:');
    episodes.forEach(e => { if (e.what_was_established) lines.push(`• Ep${e.episode_number}: ${e.what_was_established}`); });
  }
  if (seeds_unresolved.length) {
    lines.push('\nSEEDS TO WATER THIS EPISODE:');
    seeds_unresolved.forEach(s => lines.push(`• ${s}`));
  }
  if (current_episode?.arc_advancement) lines.push(`\nThis episode advances the arc by: ${current_episode.arc_advancement}`);
  return lines.join('\n');
}


function buildPrompt({ inputText, config, profile, voiceProfiles, id8rBlock, seasonContext }) {
  const voiceSummary     = buildVoiceSummary(profile, voiceProfiles);
  const beatMapText      = beatMapToText(config?.beats);
  const structure        = config?.story_structure || 'free_form';
  const contentType      = config?.content_type || 'unknown';
  const highConcept      = config?.high_concept || '(not set)';
  const durationMins     = config?.estimated_duration_minutes || '(not set)';
  const brand            = profile?.creator?.brand || '7 Kin Homestead';
  const mission          = profile?.creator?.mission || '';
  const seasonBlock      = buildSeasonBlock(seasonContext);
  const tikTokBlock      = loadTikTokIntelligenceBlock();

  return `You are WritΩr — a script development assistant for ${brand}, a homesteading and
off-grid living creator. Your job is to develop authentic, beat-mapped scripts from
real content the creator provides.

${REALITY_RULE}

${SLOP_RULE}

## CREATOR VOICE
${voiceSummary}
${tikTokBlock}
## PROJECT CONFIG
Brand: ${brand}
Mission: ${mission}
Content type: ${contentType}
Story structure: ${structure}
High concept: ${highConcept}
Estimated duration: ${durationMins} minutes
${id8rBlock ? '\n' + id8rBlock + '\n' : ''}${seasonBlock ? '\n' + seasonBlock + '\n' : ''}
## BEAT MAP (${structure})
${beatMapText}

## CREATOR'S SCRIPT / OUTLINE
${inputText}

## YOUR TASK
1. MAP this content to the beat map above. For each beat, identify which part of what
   the creator wrote serves that beat (quote exact phrases or sections).

2. IDENTIFY MISSING BEATS — beats that have no content in the current draft. Flag each
   as "BEAT NEEDED" with a specific question the creator can answer from real experience.

3. WRITE A BEAT-MAPPED OUTLINE — one paragraph per beat showing where each section lands.

4. WRITE A FULL SCRIPT DRAFT that:
   - Stays completely in the creator's voice (use the voice traits above)
   - Works through ALL beats in order
   - Marks each beat clearly: [● BEAT NAME]
   - For missing beats: [BEAT NEEDED: beat_name — "Specific authentic question/prompt"]
   - Uses only content from what was provided plus natural transitions
   - Keeps talking head sections feeling like real speech, not polished TV
   - Includes b-roll direction in parentheses: (b-roll: what to show here)
   - Targets ${durationMins} minutes of spoken content

5. GENERATE 3 HOOK VARIATIONS for the opening (10-15 seconds each):
   - Hook A: Direct/problem-led
   - Hook B: Curiosity/question-led
   - Hook C: Result-first (show the end result, then explain how)

Return ONLY valid JSON — no markdown, no preamble:
{
  "beat_map": [
    {
      "beat_name": string,
      "beat_index": number,
      "covered": boolean,
      "content_excerpt": string or null,
      "needs_coverage": boolean,
      "coverage_prompt": string or null
    }
  ],
  "missing_beats": [string],
  "outline": string,
  "script": string,
  "hook_variations": [string, string, string]
}`;
}

/**
 * Generate a beat-mapped script from an existing script or outline.
 *
 * @param {object} opts
 * @param {number}   opts.projectId
 * @param {string}   opts.inputText  — script/outline the creator provided
 * @param {Function} [opts.emit]     — SSE progress callback
 * @returns {{ beat_map, missing_beats, outline, script, hook_variations }}
 */
async function generateScriptFirst({ projectId, inputText, voiceProfiles, id8rBlock, seasonContext, emit }) {
  emit?.({ stage: 'analyzing', message: 'Reading project config and creator profile…' });

  const config  = loadProjectConfig(projectId);
  const profile = loadCreatorProfile();

  if (!inputText?.trim()) throw new Error('No script or outline provided');

  emit?.({ stage: 'beat_mapping', message: `Mapping content to ${config?.story_structure || 'beat'} structure…` });

  const prompt = buildPrompt({ inputText, config, profile, voiceProfiles, id8rBlock, seasonContext });

  emit?.({ stage: 'writing', message: 'Writing beat-mapped script draft…' });

  const result = await callClaude(prompt);

  // Validate structure
  if (!result.script) throw new Error('Claude did not return a script field');
  if (!Array.isArray(result.beat_map)) result.beat_map = [];
  if (!Array.isArray(result.missing_beats)) result.missing_beats = [];
  if (!Array.isArray(result.hook_variations)) result.hook_variations = [];

  emit?.({ stage: 'complete', message: `Script mapped — ${result.missing_beats.length} beats need coverage` });

  return result;
}

module.exports = { generateScriptFirst };
