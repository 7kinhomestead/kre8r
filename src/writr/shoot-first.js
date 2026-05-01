/**
 * WritΩr — Shoot First entry point
 * src/writr/shoot-first.js
 *
 * The most powerful WritΩr entry point. The creator has footage but no script.
 * WritΩr finds the story that EXISTS in what was actually captured.
 *
 * REALITY RULE: WritΩr finds real stories in real footage. It never invents moments.
 * If a beat needs coverage that doesn't exist in the footage, it flags it as
 * "needs authentic coverage" with specific guidance on what to capture.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callClaude, REALITY_RULE, SLOP_RULE, loadTikTokIntelligenceBlock } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');
const PROJECTS_DIR         = path.join(__dirname, '..', '..', 'database', 'projects');

// Max transcript words to send — keep Claude focused on story, not overwhelmed
const MAX_TRANSCRIPT_WORDS = 6000;

function loadCreatorProfile() {
  try { return JSON.parse(fs.readFileSync(CREATOR_PROFILE_PATH, 'utf8')); } catch (_) { return null; }
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

/**
 * Summarise footage transcripts into a digestible block for Claude.
 * Keeps footage_ids so Claude can reference them in beat assignments.
 */
function summariseTranscripts(footageRows) {
  if (!footageRows || !footageRows.length) return null;

  const clips = footageRows
    .filter(f => f.transcript && f.transcript.trim())
    .map(f => {
      const words = f.transcript.split(/\s+/);
      // Truncate very long transcripts
      const text = words.length > 300
        ? words.slice(0, 150).join(' ') + ' … ' + words.slice(-50).join(' ')
        : f.transcript;
      return `[footage_id:${f.id}] ${f.original_filename || f.file_path?.split(/[\\/]/).pop() || 'clip'} (${f.shot_type || 'unknown'}):\n${text.trim()}`;
    });

  if (!clips.length) return null;

  // Trim total to MAX_TRANSCRIPT_WORDS
  let combined = clips.join('\n\n---\n\n');
  const words  = combined.split(/\s+/);
  if (words.length > MAX_TRANSCRIPT_WORDS) {
    combined = words.slice(0, MAX_TRANSCRIPT_WORDS).join(' ') + '\n\n[... transcripts truncated for length ...]';
  }

  return combined;
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
    episodes.forEach(e => {
      if (e.what_was_established) lines.push(`• Ep${e.episode_number}: ${e.what_was_established}`);
    });
  }
  if (seeds_unresolved.length) {
    lines.push('\nSEEDS TO RESOLVE OR WATER THIS EPISODE:');
    seeds_unresolved.forEach(s => lines.push(`• ${s}`));
  }
  if (current_episode?.arc_advancement) {
    lines.push(`\nThis episode advances the arc by: ${current_episode.arc_advancement}`);
  }
  return lines.join('\n');
}

function buildPrompt({ whatHappened, transcriptBlock, config, profile, voiceProfiles, id8rBlock, seasonContext }) {
  const voiceSummary  = buildVoiceSummary(profile, voiceProfiles);
  const beatMapText   = beatMapToText(config?.beats);
  const structure     = config?.story_structure || 'free_form';
  const contentType   = config?.content_type || 'unknown';
  const highConcept   = config?.high_concept || '(not set)';
  const durationMins  = config?.estimated_duration_minutes || '(not set)';
  const brand         = profile?.creator?.brand || '7 Kin Homestead';
  const mission       = profile?.creator?.mission || '';

  const transcriptSection = transcriptBlock
    ? `## FOOTAGE TRANSCRIPTS\n${transcriptBlock}`
    : '## FOOTAGE TRANSCRIPTS\n(No transcripts available — work from the creator\'s description only)';

  const seasonBlock  = buildSeasonBlock(seasonContext);
  const tikTokBlock  = loadTikTokIntelligenceBlock();

  return `You are WritΩr — a story finder and script developer for ${brand}, a homesteading
and off-grid living reality content creator.

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

## WHAT THE CREATOR SAYS HAPPENED
${whatHappened || '(Creator did not provide a description — work from transcripts only)'}

${transcriptSection}

## YOUR TASK
You are a story archaeologist. Your job is to find the ${structure} story that ALREADY
EXISTS in what actually happened and what was captured on camera.

1. FIND THE STORY — Write one clear paragraph: what is the ${structure} story that exists
   here? Who is the protagonist? What do they want? What's in their way? How does it
   resolve? Work only from what was described and captured — never invent.

2. MAP REAL MOMENTS TO BEATS — For each beat in the beat map:
   - Find the real moment from the description or footage that fills it
   - If footage exists, cite the footage_id
   - If no real moment exists: flag as NEEDS_COVERAGE with specific guidance on
     what authentic moment to capture to fill this beat
   - Write a talking head prompt — the exact thing the creator can say to camera
     that is TRUE and authentic. Not scripted lines — genuine prompts that will
     unlock real responses.

3. IDENTIFY THE ANCHOR MOMENT — the single most powerful real moment in the footage
   or description. The scene that makes the whole story worth telling.

4. WRITE THE SHOOTING SCRIPT — a practical document the creator uses to:
   - Know which footage covers which beats
   - Know exactly what to say to camera for each beat (talking head prompts)
   - Know what additional coverage to capture
   Format: one section per beat with [● BEAT NAME], then the talking head prompt
   in quotes, then (b-roll: what to show), then coverage notes if needed.

5. MISSING BEATS — list any beats with no real coverage available.

Return ONLY valid JSON — no markdown, no preamble:
{
  "story_found": string,
  "beat_map": [
    {
      "beat_name": string,
      "beat_index": number,
      "covered": boolean,
      "real_moment": string or null,
      "footage_id": number or null,
      "talking_head_prompt": string,
      "needs_coverage": boolean,
      "coverage_description": string or null
    }
  ],
  "anchor_moment": {
    "footage_id": number or null,
    "description": string,
    "why_it_anchors": string
  },
  "missing_beats": [string],
  "shooting_script": string,
  "hook_variations": [string, string, string]
}`;
}

/**
 * Find the story in footage and generate a shooting script.
 *
 * @param {object} opts
 * @param {number}     opts.projectId
 * @param {string}     opts.whatHappened    — creator's description of what was filmed
 * @param {object[]}   opts.footageRows     — footage records with .transcript fields
 * @param {Function}   [opts.emit]          — SSE progress callback
 */
async function generateShootFirst({ projectId, whatHappened, footageRows, voiceProfiles, id8rBlock, seasonContext, emit }) {
  emit?.({ stage: 'analyzing', message: 'Reading project config and footage transcripts…' });

  const config  = loadProjectConfig(projectId);
  const profile = loadCreatorProfile();

  const transcriptBlock = summariseTranscripts(footageRows || []);
  const transcriptCount = (footageRows || []).filter(f => f.transcript?.trim()).length;

  emit?.({
    stage: 'beat_mapping',
    message: `Finding story in ${transcriptCount} transcribed clip${transcriptCount !== 1 ? 's' : ''}…`
  });

  const prompt = buildPrompt({ whatHappened, transcriptBlock, config, profile, voiceProfiles, id8rBlock, seasonContext });

  emit?.({ stage: 'writing', message: 'Writing shooting script and talking head prompts…' });

  const result = await callClaude(prompt);

  // Validate structure
  if (!result.shooting_script) throw new Error('Claude did not return a shooting_script field');
  if (!Array.isArray(result.beat_map)) result.beat_map = [];
  if (!Array.isArray(result.missing_beats)) result.missing_beats = [];
  if (!Array.isArray(result.hook_variations)) result.hook_variations = [];

  const needsCoverage = result.beat_map.filter(b => b.needs_coverage).length;
  emit?.({
    stage: 'complete',
    message: `Story found — ${needsCoverage} beat${needsCoverage !== 1 ? 's' : ''} need authentic coverage`
  });

  return result;
}

module.exports = { generateShootFirst };
