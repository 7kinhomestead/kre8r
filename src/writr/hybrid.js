/**
 * WritΩr — Hybrid entry point
 * src/writr/hybrid.js
 *
 * The creator had a concept (script_first) AND has footage (shoot_first).
 * Hybrid reconciles what was planned with what was actually captured.
 *
 * Key questions hybrid answers:
 * - Where does the footage match the concept?
 * - Where does the footage diverge (and is the divergence actually better)?
 * - What bridges are needed to connect planned concept to real footage?
 * - What needs to be captured to complete the story?
 *
 * REALITY RULE: Bridges and connections must be real — the creator says them to camera.
 * WritΩr never invents events to connect the concept to the footage.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callClaude, REALITY_RULE } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');
const PROJECTS_DIR         = path.join(__dirname, '..', '..', 'database', 'projects');
const MAX_TRANSCRIPT_WORDS = 5000;

function loadCreatorProfile() {
  try { return JSON.parse(fs.readFileSync(CREATOR_PROFILE_PATH, 'utf8')); } catch (_) { return null; }
}

function loadProjectConfig(projectId) {
  const p = path.join(PROJECTS_DIR, String(projectId), 'project-config.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function buildVoiceSummary(profile) {
  if (!profile?.voice) return 'Straight-talking, warm, funny, never corporate.';
  return [
    `Summary: ${profile.voice.summary}`,
    `Traits: ${(profile.voice.traits || []).join('; ')}`,
    `Never: ${(profile.voice.never || []).join('; ')}`
  ].join('\n');
}

function beatMapToText(beats) {
  if (!beats || !beats.length) return '(no beat map — free form)';
  return beats.map(b =>
    `  Beat ${b.index}: ${b.name} (target: ${b.target_pct}%)\n` +
    `    Purpose: ${b.emotional_function}`
  ).join('\n');
}

function summariseTranscripts(footageRows) {
  if (!footageRows?.length) return null;
  const clips = footageRows
    .filter(f => f.transcript?.trim())
    .map(f => {
      const words = f.transcript.split(/\s+/);
      const text  = words.length > 250
        ? words.slice(0, 125).join(' ') + ' … ' + words.slice(-40).join(' ')
        : f.transcript;
      return `[footage_id:${f.id}] ${f.original_filename || 'clip'}: ${text.trim()}`;
    });
  if (!clips.length) return null;
  let combined = clips.join('\n\n');
  const words  = combined.split(/\s+/);
  if (words.length > MAX_TRANSCRIPT_WORDS) {
    combined = words.slice(0, MAX_TRANSCRIPT_WORDS).join(' ') + '\n[... truncated ...]';
  }
  return combined;
}

function buildPrompt({ concept, whatCaptured, transcriptBlock, config, profile }) {
  const voiceSummary  = buildVoiceSummary(profile);
  const beatMapText   = beatMapToText(config?.beats);
  const structure     = config?.story_structure || 'free_form';
  const contentType   = config?.content_type || 'unknown';
  const highConcept   = config?.high_concept || '(not set)';
  const durationMins  = config?.estimated_duration_minutes || '(not set)';
  const brand         = profile?.creator?.brand || '7 Kin Homestead';

  const transcriptSection = transcriptBlock
    ? `## FOOTAGE TRANSCRIPTS\n${transcriptBlock}`
    : '## FOOTAGE TRANSCRIPTS\n(No transcripts available)';

  return `You are WritΩr — a script developer for ${brand}, a homesteading and off-grid
reality content creator.

${REALITY_RULE}

## CREATOR VOICE
${voiceSummary}

## PROJECT CONFIG
Content type: ${contentType}
Story structure: ${structure}
High concept: ${highConcept}
Estimated duration: ${durationMins} minutes

## BEAT MAP (${structure})
${beatMapText}

## WHAT THE CREATOR PLANNED (CONCEPT / OUTLINE)
${concept || '(No concept provided)'}

## WHAT WAS ACTUALLY CAPTURED / WHAT HAPPENED
${whatCaptured || '(No description provided)'}

${transcriptSection}

## YOUR TASK — RECONCILE PLAN WITH REALITY

You are reconciling what the creator INTENDED to make with what they ACTUALLY have.
Sometimes the footage is better than the plan. Sometimes it diverges. Your job is to
find the best version of this story that is COMPLETELY SUPPORTABLE BY REAL MATERIAL.

1. RECONCILIATION ANALYSIS — For each beat:
   - Does the planned content fill it?
   - Does the captured footage fill it?
   - If both exist, which is stronger?
   - Where does the footage IMPROVE on the plan (real > planned)?
   - Where does the footage MISS the plan (gap exists)?

2. UNIFIED BEAT MAP — Map real content (footage or authentic talking head) to each beat.
   For gaps: write a talking head prompt the creator can record. Never invent events.

3. WRITE THE UNIFIED SCRIPT — a single script that:
   - Opens with the strongest real hook from what was captured
   - Works through all beats using the best available real content
   - Uses talking head sections (clearly marked with 🎤) to bridge footage
   - Flags any remaining gaps: [BEAT NEEDED: name — what real moment to capture]
   - Marks b-roll opportunities: (b-roll: what to show)
   - Stays in the creator's authentic voice

4. GAPS TO CAPTURE — practical list: "To complete this story, record these talking
   head responses:" with specific prompts for each gap.

Return ONLY valid JSON:
{
  "reconciliation": [
    {
      "beat_name": string,
      "beat_index": number,
      "plan_coverage": string or null,
      "footage_coverage": string or null,
      "footage_id": number or null,
      "winner": "plan" | "footage" | "talking_head" | "needs_coverage",
      "talking_head_prompt": string or null,
      "needs_coverage": boolean
    }
  ],
  "beat_map": [
    {
      "beat_name": string,
      "beat_index": number,
      "covered": boolean,
      "real_moment": string or null,
      "footage_id": number or null,
      "talking_head_prompt": string or null,
      "needs_coverage": boolean,
      "coverage_description": string or null
    }
  ],
  "missing_beats": [string],
  "script": string,
  "gaps_to_capture": [string],
  "hook_variations": [string, string, string]
}`;
}

/**
 * Reconcile a planned concept with captured footage and generate a unified script.
 *
 * @param {object} opts
 * @param {number}   opts.projectId
 * @param {string}   opts.concept        — creator's planned concept/outline
 * @param {string}   opts.whatCaptured   — description of what was filmed
 * @param {object[]} opts.footageRows    — footage records with .transcript
 * @param {Function} [opts.emit]         — SSE progress callback
 */
async function generateHybrid({ projectId, concept, whatCaptured, footageRows, emit }) {
  emit?.({ stage: 'analyzing', message: 'Comparing planned concept with captured footage…' });

  const config  = loadProjectConfig(projectId);
  const profile = loadCreatorProfile();

  const transcriptBlock = summariseTranscripts(footageRows || []);

  emit?.({ stage: 'beat_mapping', message: 'Reconciling plan vs reality on beat map…' });

  const prompt = buildPrompt({ concept, whatCaptured, transcriptBlock, config, profile });

  emit?.({ stage: 'writing', message: 'Writing unified script…' });

  const result = await callClaude(prompt);

  if (!result.script) throw new Error('Claude did not return a script field');
  if (!Array.isArray(result.beat_map)) result.beat_map = [];
  if (!Array.isArray(result.missing_beats)) result.missing_beats = [];
  if (!Array.isArray(result.hook_variations)) result.hook_variations = [];
  if (!Array.isArray(result.gaps_to_capture)) result.gaps_to_capture = [];

  const gapCount = (result.gaps_to_capture || []).length;
  emit?.({
    stage: 'complete',
    message: `Unified script ready — ${gapCount} gap${gapCount !== 1 ? 's' : ''} to capture`
  });

  return result;
}

module.exports = { generateHybrid };
