/**
 * WritΩr — Hybrid entry point
 * src/writr/hybrid.js
 *
 * Split into up to three Claude calls to prevent token-limit truncation:
 *   Call 1  — Beat reconciliation (returns beat_map JSON, ~4k output tokens)
 *   Call 2a — Script writing, beats 1-8 (plain text, separate token budget)
 *   Call 2b — Script writing, beats 9-end (plain text, only when beat count > 8)
 *
 * JSON repair strategy:
 *   Call 1 uses raw:true so we receive the full (possibly-truncated) text,
 *   then we parse + repair ourselves with access to the entire response.
 *
 * REALITY RULE: Never invent content. Missing beats are flagged, not fabricated.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { callClaude, REALITY_RULE, SLOP_RULE, loadTikTokIntelligenceBlock } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');
const PROJECTS_DIR         = path.join(__dirname, '..', '..', 'database', 'projects');
const MAX_TRANSCRIPT_WORDS = 4000; // tighter budget — each call needs input headroom
const MAX_TOKENS_RECONCILE = 8192;
const MAX_TOKENS_SCRIPT    = 8192;

// ─────────────────────────────────────────────
// LOADERS
// ─────────────────────────────────────────────

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
      // More aggressive per-clip trimming to stay under budget
      const text  = words.length > 150
        ? words.slice(0, 80).join(' ') + ' … ' + words.slice(-25).join(' ')
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

// ─────────────────────────────────────────────
// JSON REPAIR — salvages truncated reconciliation responses
// ─────────────────────────────────────────────

/**
 * Walk a named JSON array in a string and return the end-index of the last
 * complete object (closing '}') found in that array. Returns -1 if none found.
 */
function findLastCompleteItem(text, fieldName) {
  const re = new RegExp(`"${fieldName}"\\s*:\\s*\\[`);
  const m  = text.match(re);
  if (!m) return -1;

  const arrayStart = text.indexOf('[', m.index);
  let depth = 0, inStr = false, escaped = false, lastEnd = -1;

  for (let i = arrayStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (escaped)               { escaped = false; continue; }
    if (ch === '\\' && inStr)  { escaped = true;  continue; }
    if (ch === '"')            { inStr = !inStr;   continue; }
    if (inStr)                 continue;
    if (ch === '{')            depth++;
    if (ch === '}') { depth--; if (depth === 0) lastEnd = i; }
    if (depth < 0)             break; // exited the array
  }

  return lastEnd;
}

/**
 * Strip markdown fences, find the outermost JSON object, attempt to parse.
 * Returns [cleaned, parsed] where parsed may be null.
 */
function cleanAndParse(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return [cleaned, JSON.parse(cleaned)];
  } catch (_) {
    return [cleaned, null];
  }
}

/**
 * Repair a truncated reconciliation JSON response.
 *
 * Strategy:
 *   1. Try to recover complete reconciliation items (the primary array)
 *   2. Derive a beat_map from the recovered reconciliation items
 *   3. Fill remaining fields with safe defaults + truncation notes
 */
function repairReconcileJSON(raw) {
  const [cleaned] = cleanAndParse(raw); // already tried parse above — this is the fallback

  const outerOpen = cleaned.indexOf('{');
  if (outerOpen === -1) return null;

  // Try beat_map array first (may exist if truncation happened later)
  const lastBeatEnd = findLastCompleteItem(cleaned, 'beat_map');
  if (lastBeatEnd !== -1) {
    const partial =
      cleaned.slice(outerOpen, lastBeatEnd + 1) +
      '\n],' +
      '"missing_beats":["[truncated — re-run for full list]"],' +
      '"gaps_to_capture":[],' +
      '"hook_variations":["[truncated — re-run for hook variations]"]' +
      '\n}';
    try { return JSON.parse(partial); } catch (_) { /* fall through */ }
  }

  // beat_map not reached — try to recover from reconciliation array
  const lastRecEnd = findLastCompleteItem(cleaned, 'reconciliation');
  if (lastRecEnd === -1) return null;

  // Extract the recovered reconciliation items
  const recSlice = cleaned.slice(outerOpen, lastRecEnd + 1) + '\n]';
  let recItems = [];
  try {
    // Build a minimal valid object to parse just the reconciliation array
    const tmp = JSON.parse(recSlice.replace(/^\{/, '{"reconciliation":[') + '}');
    recItems = tmp.reconciliation || [];
  } catch (_) {
    // Best effort — extract as many items as we found
  }

  // Derive beat_map from recovered reconciliation items
  const derivedBeatMap = recItems.map(r => ({
    beat_name:            r.beat_name,
    beat_index:           r.beat_index,
    covered:              r.winner !== 'needs_coverage',
    real_moment:          r.footage_coverage || r.plan_coverage || null,
    footage_id:           r.footage_id || null,
    talking_head_prompt:  r.talking_head_prompt || null,
    needs_coverage:       r.needs_coverage || (r.winner === 'needs_coverage'),
    coverage_description: r.footage_coverage || r.plan_coverage || null
  }));

  const missingNames = recItems
    .filter(r => r.needs_coverage || r.winner === 'needs_coverage')
    .map(r => r.beat_name);

  return {
    reconciliation:  recItems,
    beat_map:        derivedBeatMap,
    missing_beats:   missingNames.length > 0 ? missingNames : ['[truncated — re-run for full list]'],
    gaps_to_capture: [],
    hook_variations: ['[truncated — re-run for hook variations]']
  };
}

// ─────────────────────────────────────────────
// PROMPT 1 — BEAT RECONCILIATION ONLY (no script)
// ─────────────────────────────────────────────

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

function buildReconcilePrompt({ concept, whatCaptured, transcriptBlock, config, profile, voiceProfiles, id8rBlock, seasonContext }) {
  const voiceSummary = buildVoiceSummary(profile, voiceProfiles);
  const beatMapText  = beatMapToText(config?.beats);
  const structure    = config?.story_structure || 'free_form';
  const contentType  = config?.content_type    || 'unknown';
  const highConcept  = config?.high_concept    || '(not set)';
  const brand        = profile?.creator?.brand || '7 Kin Homestead';
  const seasonBlock  = buildSeasonBlock(seasonContext);
  const tikTokBlock  = loadTikTokIntelligenceBlock();

  const transcriptSection = transcriptBlock
    ? `## FOOTAGE TRANSCRIPTS\n${transcriptBlock}`
    : '## FOOTAGE TRANSCRIPTS\n(No transcripts available)';

  return `You are WritΩr — a script developer for ${brand}.

${REALITY_RULE}

${SLOP_RULE}

## CREATOR VOICE
${voiceSummary}
${tikTokBlock}
## PROJECT CONFIG
Content type: ${contentType}
Story structure: ${structure}
High concept: ${highConcept}
${id8rBlock ? '\n' + id8rBlock + '\n' : ''}${seasonBlock ? '\n' + seasonBlock + '\n' : ''}
## BEAT MAP (${structure})
${beatMapText}

## WHAT THE CREATOR PLANNED (CONCEPT / OUTLINE)
${concept || '(No concept provided)'}

## WHAT WAS ACTUALLY CAPTURED / WHAT HAPPENED
${whatCaptured || '(No description provided)'}

${transcriptSection}

## TASK — BEAT RECONCILIATION ANALYSIS ONLY
Do NOT write the script — that is a separate step.

For each beat: identify what real content (planned, footage, or talking head) fills it.
For gaps: write a specific talking head prompt the creator can record to camera.

KEEP RESPONSES CONCISE — one sentence per field where possible. This is analysis, not prose.

Return ONLY valid JSON (no markdown fences):
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
  "gaps_to_capture": [string],
  "hook_variations": [string, string, string]
}`;
}

// ─────────────────────────────────────────────
// PROMPT 2A — SCRIPT BEATS 1-8
// PROMPT 2B — SCRIPT BEATS 9-END
// Split to avoid output token limits on long beat maps
// ─────────────────────────────────────────────

const SCRIPT_SPLIT_AT = 8; // beats 1-8 in Part A, 9+ in Part B

/** Format a subset of beat_map items into the compact summary block */
function formatBeatSummary(beats) {
  return beats.map(b => {
    const lines = [`[Beat ${b.beat_index}: ${b.beat_name}] ${b.covered ? '✓' : '✗ NEEDS COVERAGE'}`];
    if (b.coverage_description || b.real_moment) {
      lines.push(`  Content: ${b.coverage_description || b.real_moment}`);
    }
    if (b.footage_id)          lines.push(`  Footage ID: ${b.footage_id}`);
    if (b.talking_head_prompt) lines.push(`  Talking head: ${b.talking_head_prompt}`);
    return lines.join('\n');
  }).join('\n');
}

function buildScriptPromptA({ reconcileResult, concept, whatCaptured, config, profile, voiceProfiles }) {
  const voiceSummary = buildVoiceSummary(profile, voiceProfiles);
  const structure    = config?.story_structure || 'free_form';
  const contentType  = config?.content_type    || 'unknown';
  const brand        = profile?.creator?.brand || '7 Kin Homestead';

  const beatMap    = reconcileResult.beat_map || [];
  const beatsA     = beatMap.slice(0, SCRIPT_SPLIT_AT);
  const beatsB     = beatMap.slice(SCRIPT_SPLIT_AT);
  const beatSummaryA = formatBeatSummary(beatsA);

  const upcomingNames = beatsB.map(b => `Beat ${b.beat_index}: ${b.beat_name}`).join(', ');
  const missingBeats  = (reconcileResult.missing_beats || []).join(', ') || 'none';
  const gaps          = (reconcileResult.gaps_to_capture || []).map((g, i) => `${i + 1}. ${g}`).join('\n') || 'none';

  const continuationNote = beatsB.length > 0
    ? `\nIMPORTANT: Stop cleanly after Beat ${beatsA[beatsA.length - 1]?.beat_index ?? SCRIPT_SPLIT_AT}. ` +
      `Do NOT write a conclusion or sign-off — the script continues in Part B with: ${upcomingNames}.`
    : '';

  return `You are WritΩr — a script developer for ${brand}.

${REALITY_RULE}

${SLOP_RULE}

## CREATOR VOICE
${voiceSummary}

## PROJECT
Content type: ${contentType}
Story structure: ${structure}

## BEATS TO WRITE NOW (Part A — Beats 1-${beatsA.length})
${beatSummaryA}

Missing beats: ${missingBeats}
Gaps to capture: ${gaps}

## ORIGINAL CONCEPT
${concept || '(No concept provided)'}

## WHAT WAS CAPTURED
${whatCaptured || '(No description provided)'}

## TASK — WRITE BEATS 1-${beatsA.length} OF THE SCRIPT
${continuationNote}

Rules:
- Open with the strongest real hook from what was captured
- Use [● BEAT: name] to start each beat section
- Prefix talking head lines with 🎤
- B-roll cues in parentheses: (b-roll: description)
- For uncovered beats: [BEAT NEEDED: name — specific real moment to capture]
- Stay entirely in the creator's authentic voice

Return ONLY the script text — no JSON, no preamble, no explanation.
Start directly with the first beat/hook.`;
}

function buildScriptPromptB({ reconcileResult, concept, whatCaptured, config, profile, voiceProfiles, partAScript }) {
  const voiceSummary = buildVoiceSummary(profile, voiceProfiles);
  const structure    = config?.story_structure || 'free_form';
  const contentType  = config?.content_type    || 'unknown';
  const brand        = profile?.creator?.brand || '7 Kin Homestead';

  const beatMap      = reconcileResult.beat_map || [];
  const beatsB       = beatMap.slice(SCRIPT_SPLIT_AT);
  const beatSummaryB = formatBeatSummary(beatsB);

  const missingBeats = (reconcileResult.missing_beats || []).join(', ') || 'none';
  const gaps         = (reconcileResult.gaps_to_capture || []).map((g, i) => `${i + 1}. ${g}`).join('\n') || 'none';

  // Trim Part A to last ~300 words for context — avoids blowing the input budget
  const partAWords   = (partAScript || '').split(/\s+/);
  const partAContext = partAWords.length > 300
    ? '…\n' + partAWords.slice(-300).join(' ')
    : partAScript;

  return `You are WritΩr — a script developer for ${brand}.

${REALITY_RULE}

${SLOP_RULE}

## CREATOR VOICE
${voiceSummary}

## PROJECT
Content type: ${contentType}
Story structure: ${structure}

## BEATS TO WRITE NOW (Part B — Beats ${beatsB[0]?.beat_index ?? SCRIPT_SPLIT_AT + 1}-${beatsB[beatsB.length - 1]?.beat_index ?? '?'})
${beatSummaryB}

Missing beats: ${missingBeats}
Gaps to capture: ${gaps}

## ORIGINAL CONCEPT
${concept || '(No concept provided)'}

## WHAT WAS CAPTURED
${whatCaptured || '(No description provided)'}

## PART A (already written — for continuity context only, do NOT rewrite)
${partAContext}

## TASK — CONTINUE THE SCRIPT FROM BEAT ${beatsB[0]?.beat_index ?? SCRIPT_SPLIT_AT + 1} TO END

Pick up exactly where Part A ended. Write only the remaining beats.
Include the strong call-to-action / sign-off at the end.

Rules:
- Use [● BEAT: name] to start each beat section
- Prefix talking head lines with 🎤
- B-roll cues in parentheses: (b-roll: description)
- For uncovered beats: [BEAT NEEDED: name — specific real moment to capture]
- Stay entirely in the creator's authentic voice

Return ONLY the script continuation — no JSON, no preamble, no explanation.
Do NOT repeat any content from Part A.`;
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────

/**
 * Reconcile a planned concept with captured footage and generate a unified script.
 *
 * @param {object}   opts
 * @param {number}   opts.projectId
 * @param {string}   opts.concept        — creator's planned concept/outline
 * @param {string}   opts.whatCaptured   — description of what was filmed
 * @param {object[]} opts.footageRows    — footage records with .transcript
 * @param {Function} [opts.emit]         — SSE progress callback
 */
async function generateHybrid({ projectId, concept, whatCaptured, footageRows, voiceProfiles, id8rBlock, seasonContext, emit }) {
  emit?.({ stage: 'analyzing', message: 'Loading project config and transcripts…' });

  const config  = loadProjectConfig(projectId);
  const profile = loadCreatorProfile();

  const transcriptBlock = summariseTranscripts(footageRows || []);

  // ── CALL 1: BEAT RECONCILIATION ──────────────────────────────────────────
  emit?.({ stage: 'beat_mapping', message: 'Call 1 — Reconciling plan vs. reality…' });

  const reconcilePrompt = buildReconcilePrompt({
    concept, whatCaptured, transcriptBlock, config, profile, voiceProfiles, id8rBlock, seasonContext
  });

  // Use raw:true so we get the full response text for repair if JSON is truncated
  const rawReconcile = await callClaude(reconcilePrompt, {
    maxTokens: MAX_TOKENS_RECONCILE,
    raw:       true
  });

  let reconcileResult;
  const [, parsed] = cleanAndParse(rawReconcile);

  if (parsed) {
    reconcileResult = parsed;
    console.log('[WritΩr hybrid] Call 1 parsed cleanly');
  } else {
    console.warn('[WritΩr hybrid] Call 1 JSON truncated — attempting repair…');
    const repaired = repairReconcileJSON(rawReconcile);
    if (repaired) {
      console.warn(`[WritΩr hybrid] Repaired — recovered ${repaired.beat_map?.length || 0} beats`);
      reconcileResult = repaired;
    } else {
      throw new Error(
        `Beat reconciliation failed — response was not parseable JSON. ` +
        `First 300 chars: ${rawReconcile.slice(0, 300)}`
      );
    }
  }

  // Normalise all fields
  if (!Array.isArray(reconcileResult.beat_map))       reconcileResult.beat_map = [];
  if (!Array.isArray(reconcileResult.missing_beats))  reconcileResult.missing_beats = [];
  if (!Array.isArray(reconcileResult.gaps_to_capture))reconcileResult.gaps_to_capture = [];
  if (!Array.isArray(reconcileResult.hook_variations))reconcileResult.hook_variations = [];
  if (!Array.isArray(reconcileResult.reconciliation)) reconcileResult.reconciliation = [];

  const coveredCount = reconcileResult.beat_map.filter(b => b.covered).length;
  const totalBeats   = reconcileResult.beat_map.length;

  emit?.({
    stage:   'beat_mapping',
    message: `Beat map ready — ${coveredCount}/${totalBeats} beats covered`
  });

  // ── CALL 2A: SCRIPT — BEATS 1-8 ─────────────────────────────────────────
  const totalBeatsInMap = reconcileResult.beat_map.length;
  const hasPartB        = totalBeatsInMap > SCRIPT_SPLIT_AT;

  emit?.({
    stage:   'writing',
    message: hasPartB
      ? `Call 2a/3 — Writing beats 1-${SCRIPT_SPLIT_AT}…`
      : 'Call 2/2 — Writing unified script…'
  });

  const scriptPromptA = buildScriptPromptA({
    reconcileResult, concept, whatCaptured, config, profile, voiceProfiles
  });

  const scriptPartA = await callClaude(scriptPromptA, {
    maxTokens: MAX_TOKENS_SCRIPT,
    raw:       true
  });

  if (!scriptPartA?.trim()) {
    throw new Error('Script writing (Part A) returned empty response');
  }

  let scriptText;

  if (!hasPartB) {
    // Fewer than 9 beats — Part A is the whole script
    scriptText = scriptPartA;
  } else {
    // ── CALL 2B: SCRIPT — BEATS 9-END ──────────────────────────────────────
    // Keepalive ping — SSE connection stays alive between calls
    emit?.({
      stage:   'writing',
      message: `Call 2b/3 — Writing beats ${SCRIPT_SPLIT_AT + 1}-${totalBeatsInMap}…`
    });

    const scriptPromptB = buildScriptPromptB({
      reconcileResult, concept, whatCaptured, config, profile, voiceProfiles,
      partAScript: scriptPartA
    });

    const scriptPartB = await callClaude(scriptPromptB, {
      maxTokens: MAX_TOKENS_SCRIPT,
      raw:       true
    });

    if (!scriptPartB?.trim()) {
      throw new Error('Script writing (Part B) returned empty response');
    }

    // Join with a single blank line — no duplicate beat headers
    scriptText = scriptPartA.trimEnd() + '\n\n' + scriptPartB.trimStart();
  }

  const gapCount = reconcileResult.gaps_to_capture.length;
  emit?.({
    stage:   'complete',
    message: `Script ready — ${coveredCount}/${totalBeats} beats covered, ${gapCount} gap${gapCount !== 1 ? 's' : ''} to capture`
  });

  return {
    reconciliation:  reconcileResult.reconciliation,
    beat_map:        reconcileResult.beat_map,
    missing_beats:   reconcileResult.missing_beats,
    gaps_to_capture: reconcileResult.gaps_to_capture,
    hook_variations: reconcileResult.hook_variations,
    script:          scriptText,
  };
}

module.exports = { generateHybrid };
