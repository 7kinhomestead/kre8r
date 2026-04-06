/**
 * CutΩr Engine — src/vault/cutor.js
 *
 * The cut identification engine. Combines the approved script, word-level
 * transcript, and content angle (from the Gate A package) and asks Claude
 * to identify the best clip moments, retention cuts, and CTA placement.
 *
 * All decisions are written to the cuts table. The creator reviews them
 * in ReviewΩr (Step 5) before ffmpeg extraction runs.
 *
 * Designed to work gracefully without a script — if no approved script
 * exists for the project, Claude reasons from the transcript alone.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const db = require('../db');
const { getCreatorContext } = require('../utils/creator-context');

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ─────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────

function buildPrompt({ transcript, script, contentAngle, packageTitle, footageMeta }) {
  const scriptSection = script
    ? `## APPROVED SCRIPT\n${script}\n`
    : `## SCRIPT\nNo approved script for this project. Reason from the transcript alone.\n`;

  const angleSection = contentAngle
    ? `## CONTENT ANGLE\nPackage: "${packageTitle}"\nAngle: ${contentAngle}\n`
    : `## CONTENT ANGLE\nNot yet set — select the best general clips.\n`;

  const metaSection = footageMeta
    ? `## SOURCE FOOTAGE\nFile: ${footageMeta.filename}\nDuration: ${footageMeta.duration}s | Resolution: ${footageMeta.resolution || 'unknown'} | Shot type: ${footageMeta.shot_type || 'unknown'}\n`
    : '';

  const transcriptText = transcript.segments
    .map(s => `[${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s] ${s.text}`)
    .join('\n');

  const { brand: cutBrand, followerSummary: cutFs, niche: cutNiche } = getCreatorContext();
  return `You are CutΩr, a video editing AI for ${cutBrand} — a ${cutNiche} channel with ${cutFs}. Your job is to identify the best short-form clip moments from a transcript with word-level timestamps.

${angleSection}
${scriptSection}
${metaSection}
## TRANSCRIPT (word-level timestamps available)
${transcriptText}

## YOUR TASK

Identify the following from the transcript above:

1. **3–5 SOCIAL CLIPS** — The best standalone moments for TikTok/Reels/Shorts. Each should:
   - Work without context (hook is built-in or obvious)
   - Be 15–90 seconds ideally
   - Have a clear beginning and end
   - Reflect the content angle if one is set

2. **RETENTION CUTS** — Moments of dead air, filler, or weak energy that should be trimmed. These are within the main content flow, not separate clips.

3. **CTA PLACEMENT** — The single best timestamp to place a call-to-action ("follow for more", "link in bio", etc.). Should feel natural, not forced.

## OUTPUT FORMAT

Return ONLY a valid JSON object — no markdown, no explanation, no code fences:

{
  "social_clips": [
    {
      "rank": 1,
      "start": 12.5,
      "end": 38.2,
      "duration": 25.7,
      "description": "one sentence — what happens in this clip",
      "reasoning": "why this is a strong clip for the content angle",
      "hook": "the first words spoken — what grabs attention"
    }
  ],
  "retention_cuts": [
    {
      "start": 5.1,
      "end": 7.4,
      "description": "dead air before first sentence"
    }
  ],
  "cta": {
    "timestamp": 42.0,
    "reasoning": "natural pause after the key point lands"
  },
  "overall_notes": "one paragraph — overall assessment of this footage for short-form content"
}

Use exact decimal timestamps from the transcript. rank 1 = strongest clip.`;
}

// ─────────────────────────────────────────────
// OFF-SCRIPT GOLD PROMPT
// Only called when an approved script exists.
// ─────────────────────────────────────────────

function buildOffScriptPrompt({ transcript, script, contentAngle, packageTitle }) {
  const scriptSection = `## APPROVED SCRIPT\n${script}\n`;

  const angleSection = contentAngle
    ? `## CONTENT ANGLE\nPackage: "${packageTitle}"\nAngle: ${contentAngle}\n`
    : '';

  const transcriptText = transcript.segments
    .map(s => `[${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s] ${s.text}`)
    .join('\n');

  return `You are CutΩr, analyzing footage for 7 Kin Homestead — a homesteading channel with 725K TikTok followers. Their audience values authenticity, real numbers, and genuine personality over polished delivery.

${angleSection}
${scriptSection}
## TRANSCRIPT (word-level timestamps available)
${transcriptText}

## YOUR TASK

Read this transcript alongside the approved script. Identify every moment where the creator went significantly off-script. For each off-script moment, evaluate: does this have more authentic energy than the scripted version? Is this a story, joke, revelation, or genuine moment that would resonate with the 7 Kin Homestead audience? Flag anything that feels more REAL than the script around it.

High-value signals to detect:
- Unscripted personal stories or anecdotes
- Unexpected humor or genuine laughter
- Moments of visible emotion or authenticity
- Spontaneous demonstrations or discoveries ("oh wait, look at this...")
- Strong opinion statements not in the script
- Real numbers, costs, or specifics mentioned off the cuff
- Self-correction moments that reveal real thinking ("actually no, what I really mean is...")
- Direct audience address that wasn't scripted

Only flag moments with genuine content value. Ignore minor verbal stumbles, filler words, or trivial deviations.

## OUTPUT FORMAT

Return ONLY a valid JSON object — no markdown, no explanation, no code fences:

{
  "off_script_gold": [
    {
      "start_timestamp": 42.1,
      "end_timestamp": 67.3,
      "transcript_excerpt": "the actual words spoken, verbatim",
      "why_it_matters": "one sentence — what makes this moment valuable",
      "suggested_use": "replace_scripted_moment | add_to_rough_cut | best_social_clip | save_for_future_video"
    }
  ]
}

If no off-script moments have genuine value, return: { "off_script_gold": [] }

Use exact decimal timestamps from the transcript.`;
}

// ─────────────────────────────────────────────
// CALL CLAUDE
// ─────────────────────────────────────────────

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();
  const raw  = data.content[0].text.trim();
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(
      `Claude returned malformed JSON: ${parseErr.message}. ` +
      `First 300 chars: ${cleaned.slice(0, 300)}`
    );
  }
}

// ─────────────────────────────────────────────
// WRITE CUTS TO DB
// ─────────────────────────────────────────────

function writeCuts(projectId, footageId, analysis) {
  // Clear any previous CutΩr run for this project
  db.deleteCutsByProject(projectId);

  const ids = { social: [], retention: [], cta: null };

  // Social clips
  for (const clip of analysis.social_clips || []) {
    const duration = parseFloat((clip.end - clip.start).toFixed(3));
    const id = db.insertCut({
      project_id:      projectId,
      footage_id:      footageId,
      start_timestamp: String(clip.start),
      end_timestamp:   String(clip.end),
      duration_seconds: duration,
      cut_type:        'social',
      description:     clip.description,
      reasoning:       clip.reasoning + (clip.hook ? `\n\nHook: "${clip.hook}"` : ''),
      rank:            clip.rank
    });
    ids.social.push(id);
  }

  // Retention cuts
  for (const cut of analysis.retention_cuts || []) {
    const duration = parseFloat((cut.end - cut.start).toFixed(3));
    const id = db.insertCut({
      project_id:      projectId,
      footage_id:      footageId,
      start_timestamp: String(cut.start),
      end_timestamp:   String(cut.end),
      duration_seconds: duration,
      cut_type:        'retention',
      description:     cut.description,
      reasoning:       'Dead air / weak moment — trim from main edit',
      rank:            null
    });
    ids.retention.push(id);
  }

  // CTA
  if (analysis.cta?.timestamp != null) {
    const id = db.insertCut({
      project_id:      projectId,
      footage_id:      footageId,
      start_timestamp: String(analysis.cta.timestamp),
      end_timestamp:   String(analysis.cta.timestamp),
      duration_seconds: 0,
      cut_type:        'CTA',
      description:     'CTA placement point',
      reasoning:       analysis.cta.reasoning,
      rank:            null
    });
    ids.cta = id;
  }

  return ids;
}

// ─────────────────────────────────────────────
// WRITE OFF-SCRIPT GOLD TO DB
// ─────────────────────────────────────────────

function writeOffScriptGold(projectId, footageId, items) {
  const ids = [];
  for (const item of items) {
    const duration = parseFloat((item.end_timestamp - item.start_timestamp).toFixed(3));
    const id = db.insertCut({
      project_id:         projectId,
      footage_id:         footageId,
      start_timestamp:    String(item.start_timestamp),
      end_timestamp:      String(item.end_timestamp),
      duration_seconds:   duration,
      cut_type:           'off_script_gold',
      description:        item.transcript_excerpt
        ? item.transcript_excerpt.slice(0, 120) + (item.transcript_excerpt.length > 120 ? '…' : '')
        : 'Off-script moment',
      reasoning:          item.why_it_matters,
      transcript_excerpt: item.transcript_excerpt,
      why_it_matters:     item.why_it_matters,
      suggested_use:      item.suggested_use,
      rank:               null
    });
    ids.push(id);
  }
  return ids;
}

// ─────────────────────────────────────────────
// MAIN — identifyCuts
// ─────────────────────────────────────────────

async function identifyCuts(projectId, options = {}) {
  const { footageId = null, onProgress = null } = options;

  // ── 1. Load project ──────────────────────────
  const project = db.getProject(projectId);
  if (!project) return { ok: false, error: `Project ${projectId} not found` };

  onProgress?.({ stage: 'loading', step: 'project', title: project.title });

  // ── 2. Load selected package (content angle) ──
  const pkg = db.getSelectedPackage(projectId);
  const contentAngle = pkg
    ? `${pkg.hook}\n\nRationale: ${pkg.rationale}`
    : null;

  onProgress?.({ stage: 'loading', step: 'package', found: !!pkg });

  // ── 3. Load script ────────────────────────────
  const scriptRecord = db.getScript(projectId);
  const script = scriptRecord?.approved_version || scriptRecord?.full_script || null;

  onProgress?.({ stage: 'loading', step: 'script', found: !!script });

  // ── 4. Load transcript ────────────────────────
  let targetFootageId = footageId;
  let transcriptData  = null;
  let footageMeta     = null;

  if (targetFootageId) {
    const rec = db.getFootageById(targetFootageId);
    if (!rec) return { ok: false, error: `Footage ${targetFootageId} not found` };
    if (!rec.transcript_path) return { ok: false, error: `Footage ${targetFootageId} has no transcript — run transcription first` };
    transcriptData = JSON.parse(fs.readFileSync(rec.transcript_path, 'utf8'));
    footageMeta = {
      filename:   rec.original_filename || path.basename(rec.file_path),
      duration:   rec.duration,
      resolution: rec.resolution,
      shot_type:  rec.shot_type
    };
  } else {
    // Find first footage for this project with a transcript
    const allFootage = db.getAllFootage({ project_id: projectId });
    const withTranscript = allFootage.filter(f => f.transcript_path && fs.existsSync(f.transcript_path));
    if (withTranscript.length === 0) {
      return { ok: false, error: `No transcribed footage found for project ${projectId}. Transcribe a clip first.` };
    }
    const rec = withTranscript[0];
    targetFootageId = rec.id;
    transcriptData = JSON.parse(fs.readFileSync(rec.transcript_path, 'utf8'));
    footageMeta = {
      filename:   rec.original_filename || path.basename(rec.file_path),
      duration:   rec.duration,
      resolution: rec.resolution,
      shot_type:  rec.shot_type
    };
  }

  onProgress?.({ stage: 'loading', step: 'transcript', segments: transcriptData.segments?.length });

  // ── 5. Build prompt + call Claude ─────────────
  const prompt = buildPrompt({
    transcript:   transcriptData,
    script,
    contentAngle,
    packageTitle: pkg?.title || null,
    footageMeta
  });

  onProgress?.({ stage: 'analyzing', model: MODEL });

  let analysis;
  try {
    analysis = await callClaude(prompt);
  } catch (e) {
    return { ok: false, error: `Claude analysis failed: ${e.message}` };
  }

  onProgress?.({
    stage: 'identified',
    social_clips:    analysis.social_clips?.length    || 0,
    retention_cuts:  analysis.retention_cuts?.length  || 0,
    cta:             !!analysis.cta
  });

  // ── 6. Off-Script Gold pass (only when script exists) ─────
  let offScriptGold = [];
  if (script) {
    onProgress?.({ stage: 'off_script_analyzing' });
    try {
      const offScriptPrompt = buildOffScriptPrompt({
        transcript:   transcriptData,
        script,
        contentAngle,
        packageTitle: pkg?.title || null
      });
      const offScriptAnalysis = await callClaude(offScriptPrompt);
      offScriptGold = offScriptAnalysis.off_script_gold || [];
    } catch (e) {
      // Non-fatal — log and continue without off-script gold
      console.warn('[CutΩr] Off-script gold pass failed:', e.message);
    }
    onProgress?.({ stage: 'off_script_identified', count: offScriptGold.length });
  }

  // ── 7. Write cuts to DB ──────────────────────
  const cutIds = writeCuts(projectId, targetFootageId, analysis);
  const goldIds = offScriptGold.length
    ? writeOffScriptGold(projectId, targetFootageId, offScriptGold)
    : [];

  onProgress?.({ stage: 'saved', cut_ids: cutIds, gold_ids: goldIds });

  return {
    ok:              true,
    project_id:      projectId,
    footage_id:      targetFootageId,
    social_clips:    analysis.social_clips    || [],
    retention_cuts:  analysis.retention_cuts  || [],
    cta:             analysis.cta             || null,
    overall_notes:   analysis.overall_notes   || '',
    off_script_gold: offScriptGold,
    cut_ids:         cutIds,
    gold_ids:        goldIds,
    db_cuts:         db.getCutsByProject(projectId)
  };
}

module.exports = { identifyCuts };
