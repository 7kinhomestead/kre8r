/**
 * SelectsΩr Engine — src/editor/selects.js
 *
 * The core intelligence behind EditΩr.
 *
 * Given a project_id it:
 *   1. Pulls all talking-head / dialogue footage for the project
 *   2. Transcribes any clips that haven't been transcribed yet (Whisper)
 *   3. Sends all transcripts + approved script / concept note to Claude
 *      → Claude maps each transcript segment to a SCRIPT SECTION and picks
 *        the best take for each section (winner), plus fire suggestions and
 *        gold nugget collection
 *   4. Writes the result to the selects table in the DB
 *   5. Returns a rich result object for the API layer to stream back
 *
 * Output from Claude:
 * {
 *   sections: [
 *     {
 *       script_section:   string,   // label matching a section of the script / concept
 *       section_index:    number,
 *       takes: [
 *         {
 *           footage_id:   number,
 *           filename:     string,
 *           start:        number,   // seconds into the clip
 *           end:          number,
 *           transcript_excerpt: string
 *         }
 *       ],
 *       selected_takes:   [number], // footage_ids in preferred order
 *       winner_footage_id: number | null,
 *       gold_nugget:      boolean,  // off-script moment worth keeping regardless
 *       fire_suggestion:  string | null,  // "cut the pause at 12s, use the second take"
 *       davinci_timeline_position: number
 *     }
 *   ],
 *   overall_notes: string
 * }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const db                        = require('../db');
const { transcribeFile }        = require('../vault/transcribe');

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function fmtTs(s) {
  if (s == null) return '?';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

function transcriptToText(transcript) {
  if (!transcript) return '[no transcript]';
  if (transcript.segments && transcript.segments.length) {
    return transcript.segments
      .map(seg => `[${fmtTs(seg.start)} → ${fmtTs(seg.end)}] ${seg.text}`)
      .join('\n');
  }
  return transcript.text || '[empty transcript]';
}

// ─────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────

function buildSelectsPrompt({ clips, script, concept, projectTitle }) {

  const scriptSection = script?.approved_version
    ? `## APPROVED SCRIPT\n${script.approved_version}\n`
    : script?.full_script
      ? `## FULL SCRIPT (not yet approved)\n${script.full_script}\n`
      : script?.outline
        ? `## SCRIPT OUTLINE\n${script.outline}\n`
        : concept
          ? `## CONCEPT NOTE\n${concept}\n`
          : `## SCRIPT\nNo script found. Identify natural content sections from the transcripts.\n`;

  const clipsText = clips.map((c, i) => {
    const transcriptText = transcriptToText(c.transcript);
    return [
      `### CLIP ${i + 1} — footage_id: ${c.footage_id}`,
      `File: ${c.filename}`,
      `Shot type: ${c.shot_type || 'unknown'} | Duration: ${c.duration ? c.duration + 's' : 'unknown'}`,
      ``,
      transcriptText
    ].join('\n');
  }).join('\n\n---\n\n');

  return `You are SelectsΩr, the editing intelligence for 7 Kin Homestead — a homesteading and off-grid living channel with 725K TikTok followers. You are analyzing multiple takes of talking-head clips to build a selects timeline for a long-form YouTube video.

## PROJECT: ${projectTitle || 'Unnamed Project'}

${scriptSection}
## FOOTAGE CLIPS (${clips.length} total)

${clipsText}

## YOUR TASK

1. **MAP TO SCRIPT SECTIONS** — Using the script/outline above, identify each distinct section (intro, point 1, story, CTA, etc.). If no script, identify natural content sections from the transcripts themselves.

2. **ASSIGN TAKES** — For each section, list which footage clips contain a take of that section (by footage_id). Multiple clips may cover the same section.

3. **PICK WINNERS** — For each section, select the best take (winner_footage_id). Consider: delivery energy, pacing, completeness, authenticity. Note the start/end timestamps within that clip.

4. **GOLD NUGGETS** — Flag any sections where an off-script moment is better than anything scripted — set gold_nugget: true. These should be prioritized in the final edit.

5. **FIRE SUGGESTIONS** — For each section, optionally add a specific editing note ("use the laugh at 12s as the opener", "cut before the pause at 34s", "b-roll opportunity during the tool explanation").

## OUTPUT FORMAT

Return ONLY a valid JSON object — no markdown, no explanation, no code fences:

{
  "sections": [
    {
      "script_section": "Intro — hook",
      "section_index": 0,
      "takes": [
        {
          "footage_id": 3,
          "filename": "A001_clip.mp4",
          "start": 0.0,
          "end": 18.5,
          "transcript_excerpt": "first few words of this take..."
        }
      ],
      "selected_takes": [3, 7],
      "winner_footage_id": 3,
      "gold_nugget": false,
      "fire_suggestion": "Start on the word 'actually' — the stumble before it kills the energy",
      "davinci_timeline_position": 0
    }
  ],
  "overall_notes": "one paragraph — assessment of these takes for the final cut"
}

Be surgical. If a section has no good take, still include it with winner_footage_id: null and explain in fire_suggestion what to do. section_index must be sequential starting from 0.`;
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
      max_tokens: 4096,
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
// MAIN — buildSelects
// ─────────────────────────────────────────────

async function buildSelects(projectId, onProgress = null) {
  const project = db.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  onProgress?.({ stage: 'start', project: project.title });

  // ── 1. PULL TALKING-HEAD / DIALOGUE FOOTAGE ──────────────────────────────

  const allFootage = db.getAllFootage({ project_id: projectId });
  const talkingHeadClips = allFootage.filter(f =>
    f.shot_type === 'talking-head' || f.shot_type === 'dialogue'
  );

  if (talkingHeadClips.length === 0) {
    return {
      ok: false,
      error: 'No talking-head or dialogue clips found for this project. ' +
             'Tag clips with the correct shot type in VaultΩr first.'
    };
  }

  onProgress?.({ stage: 'footage_found', count: talkingHeadClips.length });

  // ── 2. TRANSCRIBE ANY UNTRANSCRIBED CLIPS ────────────────────────────────

  const clips = [];

  for (const footage of talkingHeadClips) {
    const filename = path.basename(footage.file_path || footage.organized_path || '');
    const filePath = footage.organized_path || footage.file_path;

    // Load existing transcript from DB field first (fastest path)
    let transcript = null;

    if (footage.transcript) {
      try {
        transcript = JSON.parse(footage.transcript);
        onProgress?.({ stage: 'transcript_cached', footage_id: footage.id, file: filename });
      } catch (_) {
        transcript = null;
      }
    }

    // Fall back to transcript file on disk
    if (!transcript && footage.transcript_path && fs.existsSync(footage.transcript_path)) {
      try {
        transcript = JSON.parse(fs.readFileSync(footage.transcript_path, 'utf8'));
        onProgress?.({ stage: 'transcript_loaded', footage_id: footage.id, file: filename });
      } catch (_) {
        transcript = null;
      }
    }

    // Run Whisper if still no transcript
    if (!transcript) {
      if (!filePath || !fs.existsSync(filePath)) {
        onProgress?.({ stage: 'transcript_skipped', footage_id: footage.id, file: filename, reason: 'file not found' });
        clips.push({ footage_id: footage.id, filename, shot_type: footage.shot_type, duration: footage.duration, transcript: null });
        continue;
      }

      onProgress?.({ stage: 'transcribing', footage_id: footage.id, file: filename });

      const result = await transcribeFile(filePath, {
        footageId:  footage.id,
        onProgress: (p) => onProgress?.({ stage: 'whisper', footage_id: footage.id, ...p })
      });

      if (!result.ok) {
        onProgress?.({ stage: 'transcript_failed', footage_id: footage.id, file: filename, error: result.error });
        clips.push({ footage_id: footage.id, filename, shot_type: footage.shot_type, duration: footage.duration, transcript: null });
        continue;
      }

      transcript = {
        language: result.language,
        text:     result.text,
        duration: result.duration,
        segments: result.segments
      };

      // Cache in footage.transcript column for future runs
      db.updateFootage(footage.id, { transcript: JSON.stringify(transcript) });

      onProgress?.({ stage: 'transcribed', footage_id: footage.id, file: filename, segments: transcript.segments?.length });
    }

    clips.push({
      footage_id: footage.id,
      filename,
      shot_type:  footage.shot_type,
      duration:   footage.duration || transcript?.duration,
      transcript
    });
  }

  const transcribedCount = clips.filter(c => c.transcript).length;
  onProgress?.({ stage: 'transcription_complete', total: clips.length, transcribed: transcribedCount });

  if (transcribedCount === 0) {
    return {
      ok: false,
      error: 'No clips could be transcribed. Check that Whisper is installed and files are accessible.'
    };
  }

  // ── 3. PULL SCRIPT / CONCEPT ─────────────────────────────────────────────

  const script  = db.getScript(projectId);
  const concept = project.concept_note || project.logline || null;

  onProgress?.({ stage: 'claude_start', clips: transcribedCount });

  // ── 4. ASK CLAUDE ─────────────────────────────────────────────────────────

  const prompt   = buildSelectsPrompt({ clips, script, concept, projectTitle: project.title });
  const analysis = await callClaude(prompt);

  if (!analysis.sections || !Array.isArray(analysis.sections)) {
    throw new Error('Claude returned unexpected structure — missing sections array');
  }

  onProgress?.({ stage: 'claude_done', sections: analysis.sections.length });

  // ── 5. SAVE TO DB ─────────────────────────────────────────────────────────

  db.deleteSelectsByProject(projectId);

  for (const section of analysis.sections) {
    db.insertSelect({
      project_id:                projectId,
      script_section:            section.script_section            || `Section ${section.section_index}`,
      section_index:             section.section_index             ?? 0,
      takes:                     section.takes                     || [],
      selected_takes:            section.selected_takes            || [],
      winner_footage_id:         section.winner_footage_id         || null,
      gold_nugget:               !!section.gold_nugget,
      fire_suggestion:           section.fire_suggestion           || null,
      davinci_timeline_position: section.davinci_timeline_position ?? section.section_index ?? 0
    });
  }

  db.updateProjectEditorState(projectId, 'selects_ready');

  onProgress?.({ stage: 'saved', sections: analysis.sections.length });

  return {
    ok:            true,
    project_id:    projectId,
    sections:      analysis.sections.length,
    gold_nuggets:  analysis.sections.filter(s => s.gold_nugget).length,
    overall_notes: analysis.overall_notes || null,
    clips_used:    transcribedCount
  };
}

module.exports = { buildSelects };
