/**
 * WritΩr — Iteration Engine
 * src/writr/iterate.js
 *
 * Conversational script refinement. After the first draft, the creator gives feedback
 * in plain English and gets a revised draft back.
 *
 * Examples:
 *   "Make the catalyst hit harder"
 *   "The hook isn't punchy enough"
 *   "Move the B story earlier"
 *   "Dark Night needs more vulnerability"
 *   "The offer section sounds too salesy"
 *   "Cut the fun and games — it's too long"
 *
 * REALITY RULE: Revisions stay within the bounds of what actually happened.
 * WritΩr never invents new moments to fix a beat — it refines how real moments
 * are written, reordered, or presented.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callClaude, REALITY_RULE } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');
const PROJECTS_DIR         = path.join(__dirname, '..', '..', 'database', 'projects');

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

function buildPrompt({ currentScript, feedback, iterationCount, config, profile }) {
  const voiceSummary = buildVoiceSummary(profile);
  const structure    = config?.story_structure || 'free_form';
  const brand        = profile?.creator?.brand || '7 Kin Homestead';
  const draftLabel   = `Draft ${iterationCount}`;

  return `You are WritΩr — a script revision assistant for ${brand}.

${REALITY_RULE}

## CREATOR VOICE
${voiceSummary}

## STORY STRUCTURE: ${structure}

## CURRENT SCRIPT (${draftLabel})
${currentScript}

## CREATOR FEEDBACK
"${feedback}"

## YOUR TASK
Apply the creator's feedback to produce a revised script (Draft ${iterationCount + 1}).

Rules for revision:
1. Change ONLY what the feedback asks for — don't rewrite unrelated sections
2. Stay in the creator's voice (see voice traits above)
3. Keep all beat markers ([● BEAT NAME]) in place — never remove beat structure
4. If the feedback asks to "make X harder/more/better" — find the real moment
   already in the script and present it more powerfully, don't invent new content
5. If the feedback asks to cut something — cut it cleanly
6. If the feedback asks to move something — move it, check surrounding beats still flow
7. [BEAT NEEDED] placeholders stay unless the creator explicitly resolved them
8. Never invent new story events to satisfy the feedback

Return ONLY valid JSON:
{
  "changes_made": [string],
  "script": string,
  "beat_map": [
    {
      "beat_name": string,
      "beat_index": number,
      "covered": boolean,
      "needs_coverage": boolean
    }
  ],
  "missing_beats": [string]
}`;
}

/**
 * Generate a revised script based on creator feedback.
 *
 * @param {object} opts
 * @param {number}   opts.projectId
 * @param {string}   opts.currentScript   — the script being revised
 * @param {string}   opts.feedback        — creator's plain-English feedback
 * @param {number}   opts.iterationCount  — current iteration count (0-based)
 * @param {Function} [opts.emit]          — SSE progress callback
 */
async function iterateScript({ projectId, currentScript, feedback, iterationCount, emit }) {
  if (!feedback?.trim()) throw new Error('No feedback provided');
  if (!currentScript?.trim()) throw new Error('No current script to revise');

  emit?.({ stage: 'analyzing', message: `Applying feedback to Draft ${iterationCount}…` });

  const config  = loadProjectConfig(projectId);
  const profile = loadCreatorProfile();

  const prompt = buildPrompt({ currentScript, feedback, iterationCount, config, profile });

  emit?.({ stage: 'writing', message: 'Rewriting…' });

  const result = await callClaude(prompt);

  if (!result.script) throw new Error('Claude did not return a revised script');
  if (!Array.isArray(result.beat_map)) result.beat_map = [];
  if (!Array.isArray(result.missing_beats)) result.missing_beats = [];
  if (!Array.isArray(result.changes_made)) result.changes_made = [];

  emit?.({
    stage: 'complete',
    message: `Draft ${iterationCount + 1} ready — ${result.changes_made.length} change${result.changes_made.length !== 1 ? 's' : ''} applied`
  });

  return result;
}

module.exports = { iterateScript };
