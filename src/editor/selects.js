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

const ANTHROPIC_VERSION    = '2023-06-01';
const MODEL                = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const CHUNK_SIZE           = 2;     // max clips per Claude call
const MAX_WORDS_PER_CHUNK  = 3000;  // max transcript words per chunk

console.log(`[SelectsΩr] Module loaded — CHUNK_SIZE=${CHUNK_SIZE}, MAX_WORDS_PER_CHUNK=${MAX_WORDS_PER_CHUNK}`);

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

function countWords(text) {
  return text ? text.trim().split(/\s+/).length : 0;
}

// Whisper segments that carry zero editorial information when they appear alone
const PURE_FILLER = new Set([
  'um', 'umm', 'uh', 'uhh', 'hm', 'hmm', 'mm', 'mmm',
  'ah', 'ahh', 'oh', 'ohh', 'mhm', 'uh-huh', 'uhhuh', 'er', 'err'
]);

function isFiller(text) {
  const words = text.trim().toLowerCase()
    .replace(/[.,!?…\-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Drop segments with fewer than 4 words (too short to carry editorial value)
  if (words.length < 4) return true;
  return words.every(w => PURE_FILLER.has(w));
}

/**
 * Split text into sentences on ". ", "? ", "! " boundaries.
 * Returns array of non-empty strings.
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
}

/**
 * Summarize a single Whisper segment to its most important content:
 * - Drop segments under 4 words (isFiller returns true) — returns null
 * - If ≤50 words: keep as-is
 * - If >50 words: compress to first sentence + last sentence
 * Timestamps are always preserved from the original segment.
 */
function summarizeSegment(seg) {
  const text = (seg.text || '').trim();
  if (!text || isFiller(text)) return null;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 50) return seg;

  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    // Single run-on sentence: keep first 25 words + last 5 words
    const words = text.split(/\s+/);
    return { ...seg, text: words.slice(0, 25).join(' ') + ' […] ' + words.slice(-5).join(' ') };
  }
  return {
    ...seg,
    text: sentences[0] + ' […] ' + sentences[sentences.length - 1]
  };
}

/**
 * Summarize all segments in a transcript, dropping filler and compressing
 * long segments to first+last sentence. Preserves every timestamp so Claude
 * can still make precise in/out point decisions.
 *
 * Plain-text fallback (no segments): keep first 2 + last 2 sentences.
 */
function summarizeTranscript(transcript) {
  if (!transcript) return null;

  if (transcript.segments && transcript.segments.length > 0) {
    const summarized = transcript.segments
      .map(summarizeSegment)
      .filter(Boolean);
    return { ...transcript, segments: summarized };
  }

  // Plain-text fallback
  const sentences = splitSentences(transcript.text || '').filter(s => !isFiller(s));
  if (sentences.length <= 4) {
    return { ...transcript, text: sentences.join(' ') };
  }
  return {
    ...transcript,
    text: [...sentences.slice(0, 2), '[…]', ...sentences.slice(-2)].join(' ')
  };
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

/**
 * Prompt for a single chunk (subset of clips). Tells Claude it is looking at
 * chunk N of M so it knows the section list may be incomplete.
 */
function buildChunkPrompt({ clips, script, concept, projectTitle, chunkIndex, totalChunks }) {

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

  return `You are SelectsΩr, the editing intelligence for 7 Kin Homestead — a homesteading and off-grid living channel with 725K TikTok followers.

## PROJECT: ${projectTitle || 'Unnamed Project'}
## ANALYSIS CHUNK ${chunkIndex + 1} of ${totalChunks}

This is a partial analysis. You are seeing ${clips.length} clip(s) from a larger set. Identify ALL script sections visible in these clips — sections may repeat across chunks and will be merged later.

${scriptSection}
## FOOTAGE CLIPS (${clips.length} in this chunk)

${clipsText}

## YOUR TASK

1. **MAP TO SCRIPT SECTIONS** — Using the script/outline, identify each section covered by these clips.
2. **ASSIGN TAKES** — For each section, list which clips contain a take (by footage_id).
3. **PICK WINNERS** — For each section, pick the best take. Note start/end timestamps.
4. **GOLD NUGGETS** — Flag off-script moments worth keeping (gold_nugget: true).
5. **FIRE SUGGESTIONS** — Add specific editing notes per section.

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
      "selected_takes": [3],
      "winner_footage_id": 3,
      "gold_nugget": false,
      "fire_suggestion": "Start on the word 'actually'",
      "davinci_timeline_position": 0
    }
  ],
  "overall_notes": "brief notes on this chunk's footage quality"
}

section_index must be sequential from 0 within this chunk only — indices will be reassigned during merge.`;
}

/**
 * Prompt for the final merge step. Receives all sections from all chunks
 * (without transcripts) and asks Claude to deduplicate, unify, and produce
 * the final ordered section list.
 */
function buildMergePrompt({ allSections, projectTitle, script, concept }) {

  const scriptSection = script?.approved_version
    ? `## APPROVED SCRIPT\n${script.approved_version}\n`
    : script?.full_script
      ? `## FULL SCRIPT (not yet approved)\n${script.full_script}\n`
      : script?.outline
        ? `## SCRIPT OUTLINE\n${script.outline}\n`
        : concept
          ? `## CONCEPT NOTE\n${concept}\n`
          : '';

  // Serialize sections without transcript data (they're already stripped)
  const sectionsText = allSections.map((s, i) =>
    JSON.stringify({
      script_section:    s.script_section,
      takes:             (s.takes || []).map(t => ({ footage_id: t.footage_id, filename: t.filename, start: t.start, end: t.end })),
      selected_takes:    s.selected_takes,
      winner_footage_id: s.winner_footage_id,
      gold_nugget:       s.gold_nugget,
      fire_suggestion:   s.fire_suggestion
    }, null, 2)
  ).join(',\n');

  return `You are SelectsΩr, the editing intelligence for 7 Kin Homestead.

## PROJECT: ${projectTitle || 'Unnamed Project'}
## MERGE TASK

Multiple chunks of footage have been analyzed. Below are ALL sections identified across all chunks. Many sections will be duplicates (the same script section found in multiple clips across chunks).

${scriptSection}
## ALL RAW SECTIONS (${allSections.length} total, may include duplicates)

[
${sectionsText}
]

## YOUR TASK

1. **DEDUPLICATE** — Merge sections with the same or very similar script_section labels into a single entry.
2. **COMBINE TAKES** — For merged sections, include ALL takes from all duplicate entries in the takes array.
3. **PICK BEST WINNER** — Across all takes for a merged section, select the single best winner_footage_id.
4. **ORDER** — Arrange final sections in script order (matching the script/outline above). Assign sequential section_index starting from 0.
5. **GOLD NUGGETS + FIRE SUGGESTIONS** — Keep the best fire_suggestion; set gold_nugget: true if any duplicate had it true.
6. **OVERALL NOTES** — Write one paragraph assessing the full footage set.

## OUTPUT FORMAT

Return ONLY a valid JSON object — no markdown, no explanation, no code fences:

{
  "sections": [
    {
      "script_section": "Intro — hook",
      "section_index": 0,
      "takes": [
        { "footage_id": 3, "filename": "A001.mp4", "start": 0.0, "end": 18.5, "transcript_excerpt": "" }
      ],
      "selected_takes": [3, 7],
      "winner_footage_id": 3,
      "gold_nugget": false,
      "fire_suggestion": "Start on the word 'actually'",
      "davinci_timeline_position": 0
    }
  ],
  "overall_notes": "one paragraph — final assessment"
}`;
}

// ─────────────────────────────────────────────
// CALL CLAUDE
// ─────────────────────────────────────────────

/**
 * Walk the sections array in a potentially-truncated JSON string and return
 * the index of the last character that closes a complete section object.
 * Returns -1 if no complete object was found.
 */
function findLastCompleteSection(cleaned) {
  const arrayMatch = cleaned.match(/"sections"\s*:\s*\[/);
  if (!arrayMatch) return -1;

  const arrayOpenIdx = cleaned.indexOf('[', arrayMatch.index);
  let depth = 0;
  let inStr = false;
  let esc   = false;
  let lastCompleteEnd = -1;

  for (let i = arrayOpenIdx + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc)              { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true;  continue; }
    if (ch === '"')       { inStr = !inStr;  continue; }
    if (inStr)            continue;
    if (ch === '{')       depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) lastCompleteEnd = i;
    }
    if (depth < 0) break;  // exited the array
  }

  return lastCompleteEnd;
}

/**
 * If direct JSON.parse fails, try to recover the last complete section object
 * from a response that was cut off mid-stream.
 */
function repairJSON(cleaned) {
  const lastEnd = findLastCompleteSection(cleaned);
  if (lastEnd === -1) return null;

  const outerOpen = cleaned.indexOf('{');
  if (outerOpen === -1) return null;

  // Rebuild: keep everything up to the last complete section, close the array,
  // add a placeholder overall_notes, close the outer object.
  const repaired =
    cleaned.slice(outerOpen, lastEnd + 1) +
    '\n  ],' +
    '"overall_notes":"[Note: Claude response was truncated — some sections may be missing. ' +
    'Consider reducing transcript size or re-running.]"\n}';

  try {
    return JSON.parse(repaired);
  } catch (_) {
    return null;
  }
}

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
      max_tokens: 8192,
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
    // Attempt graceful repair before giving up
    const repaired = repairJSON(cleaned);
    if (repaired) return repaired;

    throw new Error(
      `Claude returned malformed JSON: ${parseErr.message}. ` +
      `First 300 chars: ${cleaned.slice(0, 300)}`
    );
  }
}

/**
 * Analyze a single chunk of clips. Returns { sections[], overall_notes }.
 */
async function analyzeChunk({ clips, script, concept, projectTitle, chunkIndex, totalChunks }) {
  const prompt = buildChunkPrompt({ clips, script, concept, projectTitle, chunkIndex, totalChunks });
  const result = await callClaude(prompt);
  if (!result.sections || !Array.isArray(result.sections)) {
    throw new Error(`Chunk ${chunkIndex + 1} returned unexpected structure — missing sections array`);
  }
  return result;
}

/**
 * Final merge call: takes all sections from all chunks (no transcripts), asks
 * Claude to deduplicate and produce the final ordered section list.
 */
async function mergeChunkedSections(allSections, projectTitle, script, concept) {
  const prompt = buildMergePrompt({ allSections, projectTitle, script, concept });
  const result = await callClaude(prompt);
  if (!result.sections || !Array.isArray(result.sections)) {
    throw new Error('Merge call returned unexpected structure — missing sections array');
  }
  return result;
}

// ─────────────────────────────────────────────
// ANALYZE TRANSCRIPTS — chunked entry point
// ─────────────────────────────────────────────

/**
 * analyzeTranscripts(clips, context, emit)
 *
 * Summarizes, chunks, calls Claude per chunk, then merges.
 * All SSE events go through emit(). No inline logic in buildSelects.
 *
 * @param {Array}    clips    — array of clip objects with .transcript
 * @param {Object}   context  — { script, concept, projectTitle }
 * @param {Function} emit     — onProgress callback
 * @returns {{ sections[], overall_notes }}
 */
async function analyzeTranscripts(clips, context, emit) {
  const { script, concept, projectTitle } = context;

  // Step 1: summarize each clip transcript
  const summarized = clips.map(clip => ({
    ...clip,
    transcript: summarizeTranscript(clip.transcript)
  }));

  // Step 2: split into chunks of CHUNK_SIZE, also respecting MAX_WORDS_PER_CHUNK
  const chunks       = [];
  let   current      = [];
  let   currentWords = 0;

  for (const clip of summarized) {
    const w             = countWords(transcriptToText(clip.transcript));
    const exceedsSize   = current.length >= CHUNK_SIZE;
    const exceedsWords  = current.length > 0 && (currentWords + w) > MAX_WORDS_PER_CHUNK;

    if (exceedsSize || exceedsWords) {
      chunks.push(current);
      current      = [];
      currentWords = 0;
    }

    current.push(clip);
    currentWords += w;
  }
  if (current.length > 0) chunks.push(current);

  // Log chunk plan to terminal
  console.log(`[SelectsΩr] analyzeTranscripts: ${clips.length} clips → ${chunks.length} chunk(s)`);
  chunks.forEach((ch, i) => {
    const w = ch.reduce((s, c) => s + countWords(transcriptToText(c.transcript)), 0);
    console.log(`[SelectsΩr]   chunk ${i + 1}: ${ch.length} clip(s), ${w} words`);
  });

  emit({
    stage:        'chunks_planned',
    total_chunks: chunks.length,
    total_clips:  clips.length,
    message:      `${clips.length} clip(s) split into ${chunks.length} chunk(s)`
  });

  // Step 3: analyze each chunk
  const allSections = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk      = chunks[i];
    const clipCount  = chunk.length;
    const wordCount  = chunk.reduce((s, c) => s + countWords(transcriptToText(c.transcript)), 0);
    const clipOffset = chunks.slice(0, i).reduce((s, ch) => s + ch.length, 0);
    const label      = clipCount === 1
      ? `clip ${clipOffset + 1}`
      : `clips ${clipOffset + 1}–${clipOffset + clipCount}`;

    console.log(`[SelectsΩr] → chunk ${i + 1}/${chunks.length} (${label}, ${wordCount} words)`);
    emit({
      stage:     'analyzing_chunk',
      current:   i + 1,
      total:     chunks.length,
      clip_count: clipCount,
      word_count: wordCount,
      message:   `Analyzing chunk ${i + 1} of ${chunks.length} (${label}, ${wordCount} words)...`
    });

    const result = await analyzeChunk({
      clips:       chunk,
      script,
      concept,
      projectTitle,
      chunkIndex:  i,
      totalChunks: chunks.length
    });

    console.log(`[SelectsΩr] ✓ chunk ${i + 1} → ${result.sections.length} section(s)`);
    emit({
      stage:    'chunk_done',
      current:  i + 1,
      total:    chunks.length,
      sections: result.sections.length,
      message:  `Chunk ${i + 1} of ${chunks.length} complete — ${result.sections.length} section(s)`
    });

    allSections.push(...result.sections);
  }

  // Step 4: merge if multiple chunks
  if (chunks.length > 1) {
    console.log(`[SelectsΩr] Merging ${allSections.length} raw sections from ${chunks.length} chunks`);
    emit({
      stage:          'merging',
      total_sections: allSections.length,
      message:        `Merging sections from ${chunks.length} chunks...`
    });

    const merged = await mergeChunkedSections(allSections, projectTitle, script, concept);

    console.log(`[SelectsΩr] ✓ merge done — ${merged.sections.length} final section(s)`);
    emit({
      stage:    'merge_done',
      sections: merged.sections.length,
      message:  `Merge complete — ${merged.sections.length} final section(s)`
    });

    return merged;
  }

  return { sections: allSections, overall_notes: null };
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
  // Prefer WritΩr-approved script if one exists — it has full beat mapping
  // and is the creator's locked intent for this video.
  // Fall back to the legacy scripts table entry, then concept note.

  let script  = db.getScript(projectId);
  const writrScript = db.getApprovedWritrScript(projectId);
  if (writrScript?.generated_script) {
    // WritΩr-approved scripts sync their text into the scripts table via
    // approveWritrScript(), so getScript() already returns it. But if for
    // any reason the sync didn't run, use the writr_scripts row directly.
    if (!script?.approved_version) {
      script = {
        approved_version: writrScript.generated_script,
        full_script:      writrScript.generated_script,
        outline:          writrScript.generated_outline || null
      };
      console.log(`[SelectsΩr] Using WritΩr-approved script (writr_scripts id=${writrScript.id})`);
    }
  }
  const concept = project.concept_note || project.logline || null;

  // ── 4. ASK CLAUDE (CHUNKED) ───────────────────────────────────────────────

  const transcribedClips = clips.filter(c => c.transcript);

  const analysis = await analyzeTranscripts(
    transcribedClips,
    { script, concept, projectTitle: project.title },
    (ev) => onProgress?.(ev)
  );

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
