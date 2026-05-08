/**
 * AssemblΩr Engine — src/editor/assemblr.js
 *
 * Builds a rough-cut assembly from talking-head footage using the project's
 * PipΩr beat map and Whisper transcripts.
 *
 * Core approach:
 *   1. Sort all talking-head clips by creation_timestamp (chronological)
 *   2. Transcribe each clip (using proxy_path when available)
 *   3. Claude (Call 1, per clip): tag every segment to the beat it covers
 *      — finds ALL occurrences of every beat including retakes
 *   4. Collect all tagged takes per beat across all clips, each with its
 *      transcript segments attached
 *   5. Claude (Call 2, per beat): smart assembly — given all takes and the
 *      WritΩr script, return the best ordered segment list using as few cuts
 *      as possible. Preference order: full take → paragraph → sentence.
 *      A sentence is the absolute minimum unit.
 *   6. Apply handles: 2s lead-in / 3s tail on the beat as a whole,
 *      0.3s cut handles at interior segment joins
 *   7. Store selected_takes as an ordered array (multiple segments per beat)
 *   8. build-selects.py places each segment on the timeline in order
 *
 * Freeform fallback (no beat map): chronological dump with energy flagging.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const { transcribeFile }        = require('../vault/transcribe');
const { callClaude, callClaudeMessages } = require('../utils/claude');
const { getCreatorContext }     = require('../utils/creator-context');
const { readConfig }            = require('../pipr/beat-tracker');
const db = require('../db');

// ─────────────────────────────────────────────
// ASSEMBLY-SPECIFIC CLAUDE CALLER
// callClaude parses JSON directly — if Claude writes analysis text before
// the JSON (or uses M:SS timestamps which break JSON number parsing),
// we need a smarter extractor for Call 2.
// ─────────────────────────────────────────────

/** Convert M:SS.s or M:SS format string to decimal seconds */
function mssToSeconds(str) {
  const m = String(str).match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
}

/**
 * Fix M:SS timestamps inside a JSON string by converting them to decimal seconds.
 * Handles both quoted ("8:41.3") and unquoted (8:41.3) forms.
 */
function fixTimestampsInJson(jsonStr) {
  // Unquoted M:SS (e.g. "start_ts": 8:41.3) — replace with decimal
  jsonStr = jsonStr.replace(/("start_ts"|"end_ts")\s*:\s*(\d+:\d+(?:\.\d+)?)/g, (_, key, ts) => {
    const dec = mssToSeconds(ts);
    return dec !== null ? `${key}: ${dec}` : `${key}: 0`;
  });
  // Quoted M:SS (e.g. "start_ts": "8:41.3") — replace with unquoted decimal
  jsonStr = jsonStr.replace(/("start_ts"|"end_ts")\s*:\s*"(\d+:\d+(?:\.\d+)?)"/g, (_, key, ts) => {
    const dec = mssToSeconds(ts);
    return dec !== null ? `${key}: ${dec}` : `${key}: 0`;
  });
  return jsonStr;
}

/**
 * Extract the first complete JSON object from a raw string that may contain
 * leading analysis text or markdown fences. Then fix timestamps.
 */
function extractAssemblyJson(raw) {
  // Strip markdown fences
  let cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Find first '{' — Claude sometimes writes analysis before the JSON
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  cleaned = cleaned.slice(start);

  // Fix any M:SS timestamps before parsing
  cleaned = fixTimestampsInJson(cleaned);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try finding the last complete closing brace
    let depth = 0, lastClose = -1, inStr = false, esc = false;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (esc)       { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"')  { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) lastClose = i; }
    }
    if (lastClose > 0) {
      try { return JSON.parse(cleaned.slice(0, lastClose + 1)); } catch (_) {}
    }
    throw new Error(`Malformed JSON after timestamp fix: ${e.message}. First 300: ${cleaned.slice(0, 300)}`);
  }
}

// Opus model for Call 2 — editorial judgment is creative, not mechanical.
// Override via CLAUDE_ASSEMBLY_MODEL env var (fall back to Sonnet if not set).
const ASSEMBLY_MODEL = process.env.CLAUDE_ASSEMBLY_MODEL
  || process.env.CLAUDE_MODEL
  || 'claude-sonnet-4-6';

/**
 * Call Claude for assembly (Call 2).
 * Uses Opus (or override) for editorial judgment — picking the best takes
 * from short 1-3 sentence clips requires creative understanding of flow.
 * System prompt enforces JSON-only output. extractAssemblyJson handles preamble.
 */
async function callClaudeAssembly(prompt, beatName, emit) {
  const system = 'You are a video editor assembling the best version of a talking-head beat from multiple short takes. Output ONLY a single valid JSON object — no explanation, no markdown, no analysis text before or after. Your entire response must be parseable by JSON.parse().';
  const rawText = await callClaudeMessages(
    system,
    [{ role: 'user', content: prompt }],
    4096,
    { model: ASSEMBLY_MODEL, tool: 'assemblr-call2' }
  );
  try {
    return extractAssemblyJson(rawText);
  } catch (e) {
    throw new Error(`Claude returned malformed JSON: ${e.message}. First 300 chars: ${rawText.slice(0, 300)}`);
  }
}

// Handles added at beat start/end (seconds)
const LEAD_IN_S    = 2.0;
const TAIL_S       = 3.0;
const CUT_HANDLE_S = 0.3;

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function fmtTs(s) {
  if (typeof s !== 'number' || isNaN(s)) return '0:00';
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Get the best file path to pass to Whisper — proxy beats BRAW */
function getTranscribablePath(clip) {
  if (clip.proxy_path && fs.existsSync(clip.proxy_path.replace(/\//g, path.sep))) {
    return clip.proxy_path.replace(/\//g, path.sep);
  }
  const fp = (clip.file_path || '').replace(/\//g, path.sep);
  if (fp && fs.existsSync(fp)) return fp;
  return null;
}

/** Parse stored transcript JSON → segments array */
function parseStoredTranscript(clip) {
  if (!clip.transcript) return null;
  try {
    const parsed = typeof clip.transcript === 'string'
      ? JSON.parse(clip.transcript)
      : clip.transcript;
    const segs = parsed.segments || parsed || [];
    return Array.isArray(segs) ? segs : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────
// CALL 1 — BEAT TAGGING PER CLIP
// Sends one clip's transcript + beat map to Claude.
// Returns every occurrence of every beat in that clip,
// including retakes, with quality ratings.
// Each occurrence also carries its transcript segments
// so Call 2 can read the actual spoken words.
// ─────────────────────────────────────────────

async function mapBeatsInClip(clip, segments, beats, creatorCtx, emit, writrBeatMap, writrScriptText) {
  if (!segments || segments.length === 0) return { beat_coverage: [], gold_moments: [] };

  // For very long transcripts, sample to stay under context limits
  const MAX_SEGMENTS = 300;
  const segsToSend = segments.length > MAX_SEGMENTS
    ? segments.filter((_, i) => i % Math.ceil(segments.length / MAX_SEGMENTS) === 0)
    : segments;

  if (segments.length > MAX_SEGMENTS && typeof emit === 'function') {
    emit({ event: 'status', message: `Long clip (${segments.length} segments) — sampling ${segsToSend.length} for beat tagging` });
  }

  // Use decimal seconds — NOT M:SS format — so Claude returns decimal seconds back.
  // M:SS in the output causes JSON parse failures or incorrect timestamp coercion.
  const transcriptText = segsToSend
    .map(s => `[${s.start.toFixed(2)}s] ${s.text.trim()}`)
    .join('\n');

  // Build per-beat script context from WritΩr
  const beatScriptMap = {};
  if (writrBeatMap && Array.isArray(writrBeatMap)) {
    for (const bm of writrBeatMap) {
      const key = bm.beat_index ?? bm.beat_name;
      beatScriptMap[key] = bm.real_moment || bm.coverage_description || null;
    }
  }

  const enrichedBeatList = beats.map((b, i) => {
    const scriptNote = beatScriptMap[i] || beatScriptMap[b.name] || null;
    const lines = [`Beat ${i + 1} (index ${i}) — "${b.name}": ${b.emotional_function || ''}`];
    if (scriptNote) lines.push(`  → Scripted: "${scriptNote}"`);
    return lines.join('\n');
  }).join('\n\n');

  const scriptContext = writrScriptText
    ? `\n\nFULL SCRIPT (for reference):\n${writrScriptText.slice(0, 3000)}${writrScriptText.length > 3000 ? '\n[...continues...]' : ''}`
    : '';

  const clipDuration = (segsToSend[segsToSend.length - 1]?.end ?? 0).toFixed(1);

  const prompt = `You are tagging a video clip for ${creatorCtx.creatorName || creatorCtx.brand} (${creatorCtx.niche} creator).

Jason films in long takes with multiple retakes — the SAME beat may appear multiple times in one clip.

STORY BEATS:
${enrichedBeatList}${scriptContext}

TRANSCRIPT (${clipDuration}s clip):
${transcriptText}

YOUR TASK:
1. For EACH beat, find EVERY section of transcript where Jason covers that beat — include ALL retakes.
2. Quality: "strong" = confident full delivery, "clean" = good delivery, "fumbled" = restarts/stumbles, "partial" = incomplete.
3. Flag any off-script spontaneous moments as gold_moments.
4. Every beat_index 0 to ${beats.length - 1} must appear — use editorial judgment for loose coverage.

beat_index is 0-based. Timestamps are decimal seconds matching the [M:SS.s] format in the transcript.

Return ONLY valid JSON:
{
  "beat_coverage": [
    {
      "beat_index": 0,
      "beat_name": "string",
      "occurrences": [
        {
          "start": 0.0,
          "end": 0.0,
          "quality": "strong | clean | fumbled | partial",
          "note": "one sentence — why this section covers this beat"
        }
      ]
    }
  ],
  "gold_moments": [
    {
      "start": 0.0,
      "end": 0.0,
      "reason": "one sentence — what makes this genuinely special"
    }
  ]
}`;

  try {
    if (typeof emit === 'function') {
      emit({ event: 'status', message: `[AssemblΩr] Tagging ${segsToSend.length} segments (clip ${clip.original_filename || clip.id})…` });
    }
    const result = await callClaude(prompt, 8192);
    if (typeof emit === 'function') {
      const beatHits = (result.beat_coverage || []).map(bc =>
        `"${bc.beat_name || bc.beat_index}":${(bc.occurrences || []).length}`
      ).join(', ');
      emit({ event: 'status', message: `[Tag] beats: [${beatHits || 'NONE'}] gold: ${(result.gold_moments || []).length}` });
    }
    return result;
  } catch (e) {
    const msg = `Beat tagging failed for ${clip.original_filename || clip.id}: ${e.message}`;
    console.warn(`[AssemblΩr] ${msg}`);
    if (typeof emit === 'function') emit({ event: 'warning', message: msg });
    return { beat_coverage: [], gold_moments: [] };
  }
}

// ─────────────────────────────────────────────
// CALL 2 — SMART ASSEMBLY PER BEAT
// Given all takes for a beat (each with transcript segments),
// Claude builds the best ordered segment list using as few
// cuts as possible.
//
// Priority order Claude follows:
//   1. Full take   — one clean run covers the whole beat
//   2. Paragraph   — longer contiguous runs (no sentence splitting)
//   3. Sentence    — individual sentences, last resort only
//   Never: sub-sentence cuts
// ─────────────────────────────────────────────

async function assembleBeat(beat, allTakes, writrBeatScript, creatorCtx, emit) {
  if (allTakes.length === 0) return [];

  // Sort chronologically — last take is usually best
  const sorted = [...allTakes].sort((a, b) => {
    if (a.clip_created_at !== b.clip_created_at) {
      return new Date(a.clip_created_at) - new Date(b.clip_created_at);
    }
    return a.start - b.start;
  });

  // Single clean take — no call needed, use it whole
  if (sorted.length === 1 && sorted[0].quality !== 'fumbled') {
    const t = sorted[0];
    emit({ event: 'status', message: `Beat "${beat.name}": one clean take — using whole (no cuts)` });
    return [{ footage_id: t.footage_id, start_ts: t.start, end_ts: t.end, level: 'full_take', note: 'only take' }];
  }

  // If NO takes have transcript segments, Claude has nothing to work with —
  // skip Call 2 entirely and use the best take's occurrence timestamps directly.
  const anySegments = sorted.some(t => (t.segments || []).length > 0);
  if (!anySegments) {
    emit({ event: 'status', message: `Beat "${beat.name}": no transcript segments — using best take directly (no Call 2)` });
    const best = sorted.slice().reverse().find(t => t.quality === 'strong' || t.quality === 'clean') || sorted[sorted.length - 1];
    const result = [{ footage_id: best.footage_id, start_ts: best.start, end_ts: best.end, level: 'full_take', note: 'no segments — used best take' }];
    result.assembly_note = 'No transcript segments — used best available take';
    return result;
  }

  // Build text block per take including its transcript.
  // IMPORTANT: use decimal seconds in the transcript (not M:SS) so Claude
  // returns decimal seconds back — M:SS in the output breaks JSON parsing.
  const takesText = sorted.map((take, i) => {
    const segsText = (take.segments || [])
      .map(s => `  [${s.start.toFixed(2)}s–${s.end.toFixed(2)}s] ${s.text.trim()}`)
      .join('\n');
    const range = `${take.start.toFixed(2)}s–${take.end.toFixed(2)}s`;
    return `=== Take ${i + 1} (footage_id: ${take.footage_id}, quality: ${take.quality || 'clean'}, range: ${range}) ===\n${segsText || '  (no transcript segments)'}`;
  }).join('\n\n');

  const scriptSection = writrBeatScript
    ? `\nSCRIPT FOR THIS BEAT:\n${writrBeatScript}\n`
    : '';

  const prompt = `You are a video editor assembling the best version of beat "${beat.name}" (${beat.emotional_function || ''}) for ${creatorCtx.creatorName || 'the creator'}.
${scriptSection}
CONTEXT: Jason records the FULL VIDEO multiple times in one long session. Each "take" below is one complete recording of this beat — typically 1-4 minutes of continuous delivery. Takes are listed in chronological order (earlier start_ts = filmed earlier in the session). Later takes are usually more relaxed and natural.

ALL TAKES — chronological (range shows where this beat occurs in the source clip):
${takesText}

ASSEMBLY RULES — follow in strict priority order:
1. FULL_TAKE (strongly preferred) — Pick the single best take and use it whole. ONE entry in the assembly. This is the right answer in most cases.
2. SENTENCE — Only if the best take has a specific problem (fumbled opener, stumbled line): use that take for most of the beat, then swap ONLY the specific bad sentence for the same sentence from another take. Maximum 2 takes total. Keep cuts to a minimum.

CRITICAL: Do NOT mix sentences freely across multiple takes. Do NOT produce more than 4 assembly entries for a single beat. The goal is a clean single-take delivery, not a Frankenstein edit.

- Last take is usually the best — most relaxed, natural delivery. Start there.
- Fumbled takes: skip entirely unless they contain a line not delivered in any other take.
- Gold moments (quality:"gold"): always include — genuine spontaneous moment, use its full range.
- The timestamps in the "range:" header are the start/end of this beat occurrence in the source clip. Use them as-is for full_take entries.

CRITICAL TIMESTAMP RULE:
- start_ts and end_ts MUST be plain decimal numbers in seconds (e.g. 125.4, 30.0).
- For a full_take entry, copy the range timestamps exactly. NEVER use M:SS format.

Return ONLY the JSON object below — no explanation, no analysis, no markdown:
{
  "assembly": [
    {
      "footage_id": 42,
      "start_ts": 30.5,
      "end_ts": 120.0,
      "level": "full_take | sentence",
      "note": "one sentence — what this covers and why chosen"
    }
  ],
  "assembly_note": "one sentence describing the editorial strategy (e.g. 'Used take 3 — cleanest delivery, natural energy throughout')"
}`;

  try {
    emit({ event: 'status', message: `Beat "${beat.name}": assembling from ${sorted.length} take(s)…` });
    const result = await callClaudeAssembly(prompt, beat.name, emit);
    let assembly = result.assembly || [];
    const note = result.assembly_note || '';

    // If Claude returned empty assembly, fall back to best take
    if (assembly.length === 0) {
      emit({ event: 'warning', message: `Beat "${beat.name}": Claude returned empty assembly — using best take` });
      const best = sorted.slice().reverse().find(t => t.quality !== 'fumbled') || sorted[sorted.length - 1];
      assembly = [{ footage_id: best.footage_id, start_ts: best.start, end_ts: best.end, level: 'full_take', note: 'empty assembly — used best take' }];
    }

    emit({ event: 'status', message: `Beat "${beat.name}": ${assembly.length} segment(s) — ${note}` });
    assembly.assembly_note = note;
    return assembly;
  } catch (e) {
    emit({ event: 'warning', message: `Assembly failed for "${beat.name}": ${e.message} — falling back to last non-fumbled take` });
    const fallback = sorted.slice().reverse().find(t => t.quality !== 'fumbled') || sorted[sorted.length - 1];
    const result = [{
      footage_id: fallback.footage_id,
      start_ts:   fallback.start,
      end_ts:     fallback.end,
      level:      'fallback',
      note:       'Claude assembly failed — using last clean take',
    }];
    result.assembly_note = 'Assembly failed — fallback to last clean take';
    return result;
  }
}

// ─────────────────────────────────────────────
// HANDLE APPLICATION
// First segment: 2s lead-in
// Last segment:  3s tail
// Interior cuts: 0.3s on each side (editor room to trim)
// All clamped to clip bounds
// ─────────────────────────────────────────────

function applyHandlesToAssembly(assembly, allTakes) {
  // Build lookup: footage_id → { clip_duration, proxy_path, start, end }
  // Also keep the raw take timestamps so we can fall back when Claude omits them.
  const lookup = {};
  for (const t of allTakes) {
    if (!lookup[t.footage_id]) {
      lookup[t.footage_id] = {
        clip_duration: t.clip_duration || 0,
        proxy_path:    t.proxy_path    || '',
        take_start:    t.start         || 0,
        take_end:      t.end           || 0,
      };
    }
  }

  const result = [];
  for (let i = 0; i < assembly.length; i++) {
    const seg     = assembly[i];
    const isFirst = i === 0;
    const isLast  = i === assembly.length - 1;
    const info    = lookup[seg.footage_id] || {};
    const dur     = info.clip_duration || 0;

    // Claude uses start_ts/end_ts. Accept start/end as aliases.
    // Fall back to the take's own occurrence timestamps if both are missing/NaN.
    let rawStart = seg.start_ts ?? seg.start;
    let rawEnd   = seg.end_ts   ?? seg.end;

    if (typeof rawStart !== 'number' || isNaN(rawStart) || rawStart < 0) rawStart = info.take_start;
    if (typeof rawEnd   !== 'number' || isNaN(rawEnd)   || rawEnd   < 0) rawEnd   = info.take_end;

    // Skip segments where timestamps are still invalid after fallback
    if (typeof rawStart !== 'number' || typeof rawEnd !== 'number' || rawEnd <= rawStart) {
      console.warn(`[AssemblΩr] Skipping segment footage_id=${seg.footage_id}: invalid timestamps (${rawStart}→${rawEnd})`);
      continue;
    }

    const leadIn = isFirst ? LEAD_IN_S    : CUT_HANDLE_S;
    const tail   = isLast  ? TAIL_S       : CUT_HANDLE_S;

    const start  = clamp(rawStart - leadIn, 0, rawStart);
    const end    = clamp(rawEnd   + tail,   rawEnd, dur > 0 ? dur : rawEnd + tail);

    result.push({
      footage_id: seg.footage_id,
      proxy_path: info.proxy_path,
      start,
      end,
      level:      seg.level || 'segment',
      note:       seg.note  || '',
    });
  }
  return result;
}

// ─────────────────────────────────────────────
// FREEFORM MODE
// No beat map — chronological assembly
// ─────────────────────────────────────────────

async function buildFreeformAssembly(clips, projectId, emit) {
  emit({ event: 'status', message: 'Freeform mode — no beat map found. Building chronological assembly.' });

  const sections = [];

  for (const clip of clips) {
    const duration = clip.duration || 0;

    sections.push({
      project_id:               projectId,
      script_section:           `Clip ${clip.id} — ${clip.original_filename || ''}`.trim(),
      section_index:            sections.length,
      takes:                    [{ footage_id: clip.id, start: 0, end: duration, proxy_path: clip.proxy_path || clip.file_path }],
      selected_takes:           [{ footage_id: clip.id, start: 0, end: duration, proxy_path: clip.proxy_path || clip.file_path, level: 'full_take' }],
      winner_footage_id:        clip.id,
      gold_nugget:              0,
      fire_suggestion:          'Review for energy moments',
      davinci_timeline_position: sections.length,
      mode:                     'freeform',
    });
  }

  return sections;
}

// ─────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────

async function buildAssembly(projectId, onProgress) {
  const emit = onProgress || (() => {});

  // ── 1. Load project + beat map ───────────────────────────────────────────
  const project = db.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  emit({ event: 'status', message: `Loading project: "${project.title}"` });

  const piprConfig = readConfig(projectId);
  const beats      = piprConfig?.beats || [];
  const hasBeatMap = beats.length > 0;

  emit({ event: 'status', message: hasBeatMap
    ? `Beat map loaded: ${beats.length} beats (${piprConfig.story_structure || 'custom'})`
    : `No beat map found — will use freeform assembly`
  });

  // ── 2. Load footage, sorted chronologically ──────────────────────────────
  const allClips    = db.getAllFootage({ project_id: projectId });
  const talkingHead = allClips
    .filter(c => {
      const st = (c.shot_type || '').toLowerCase().replace('_', '-');
      return st === 'talking-head' || st === 'dialogue';
    })
    .sort((a, b) => {
      const ta = a.creation_timestamp || a.ingested_at || '';
      const tb = b.creation_timestamp || b.ingested_at || '';
      return ta.localeCompare(tb);
    });

  if (talkingHead.length === 0) {
    return { ok: false, error: 'No talking-head clips found for this project. Check VaultΩr classification.' };
  }

  emit({ event: 'status', message: `Found ${talkingHead.length} talking-head clip(s)` });

  // ── 3. Transcribe each clip ──────────────────────────────────────────────
  const transcribed = [];
  for (const clip of talkingHead) {
    const filePath = getTranscribablePath(clip);

    if (!filePath) {
      emit({ event: 'warning', message: `Clip ${clip.id} (${clip.original_filename}): no decodable file — skipped` });
      continue;
    }

    let segments = parseStoredTranscript(clip);

    if (!segments) {
      emit({ event: 'transcribing', message: `Transcribing: ${clip.original_filename || clip.id}` });
      try {
        const result = await transcribeFile(filePath, { footageId: clip.id, onProgress: (p) => {
          if (p.stage === 'whisper_progress')       emit({ event: 'transcribe_progress', message: p.line });
          if (p.stage === 'whisper_model_download') emit({ event: 'transcribe_progress', message: `⬇️ ${p.message}` });
          if (p.stage === 'whisper_start')          emit({ event: 'transcribe_progress', message: `🎙️ Whisper started (${p.model})` });
          if (p.stage === 'resolve_attempt')        emit({ event: 'transcribe_progress', message: `🎬 ${p.message}` });
          if (p.stage === 'resolve_progress')       emit({ event: 'transcribe_progress', message: p.line });
          if (p.stage === 'resolve_success')        emit({ event: 'transcribe_progress', message: `✅ Resolve transcription complete (${p.segments} segments)` });
          if (p.stage === 'resolve_fallback')       emit({ event: 'transcribe_progress', message: `⚠️ ${p.message}` });
        }});
        if (result.ok) {
          segments = result.segments || [];
          db.updateFootage(clip.id, { transcript: JSON.stringify({ segments }) });
          emit({ event: 'transcribed', message: `${clip.original_filename}: ${segments.length} segments, ${fmtTs(result.duration)}` });
        } else {
          emit({ event: 'warning', message: `Transcription failed for ${clip.original_filename}: ${result.error}` });
          segments = [];
        }
      } catch (e) {
        emit({ event: 'warning', message: `Transcription error for ${clip.id}: ${e.message}` });
        segments = [];
      }
    } else {
      emit({ event: 'status', message: `Transcript cached: ${clip.original_filename || clip.id} (${segments.length} segments)` });
    }

    transcribed.push({ ...clip, segments });
  }

  if (transcribed.length === 0) {
    return { ok: false, error: 'No clips could be transcribed. Check proxy_path and Whisper installation.' };
  }

  // ── 4. Freeform fallback ─────────────────────────────────────────────────
  if (!hasBeatMap) {
    const sections = await buildFreeformAssembly(transcribed, projectId, emit);
    return finalise(sections, projectId, 'freeform', emit);
  }

  // ── 5. Load WritΩr script ────────────────────────────────────────────────
  let writrBeatMap    = null;
  let writrScriptText = null;

  try {
    const writrScript = db.getApprovedWritrScript(projectId);
    if (writrScript) {
      writrBeatMap    = writrScript.beat_map_json   || null;
      writrScriptText = writrScript.generated_script || null;
      emit({ event: 'status', message: `WritΩr script loaded (${writrBeatMap?.length || 0} beats, ${writrScriptText ? Math.round(writrScriptText.length / 100) * 100 : 0} chars)` });
    } else {
      emit({ event: 'status', message: 'No approved WritΩr script — Claude will work from beat names only' });
    }
  } catch (e) {
    emit({ event: 'warning', message: `Could not load WritΩr script: ${e.message}` });
  }

  // ── 6. Call 1 per clip — tag segments to beats ──────────────────────────
  const creatorCtx = getCreatorContext();
  emit({ event: 'status', message: 'Tagging transcript segments to beats (Call 1)…' });

  // beatPool[beatIndex] = array of all takes for that beat, each with .segments
  const beatPool = beats.map(() => []);

  for (const clip of transcribed) {
    if (!clip.segments || clip.segments.length === 0) continue;

    emit({ event: 'mapping', message: `Tagging: ${clip.original_filename || `clip ${clip.id}`}` });

    const result = await mapBeatsInClip(clip, clip.segments, beats, creatorCtx, emit, writrBeatMap, writrScriptText);

    // Build a lookup of beat occurrence windows from THIS clip's Call 1 result.
    // Keys are beat_index → [{start, end}]. Used below to anchor gold moments
    // to the beat whose timestamp range contains them — Claude's own boundaries,
    // not post-hoc heuristics.
    const beatWindows = {}; // beat_index → [{start, end}]
    for (const bc of (result.beat_coverage || [])) {
      const idx = bc.beat_index;
      if (idx < 0 || idx >= beats.length) continue;
      beatWindows[idx] = (beatWindows[idx] || []).concat(
        (bc.occurrences || []).map(o => ({ start: o.start, end: o.end }))
      );

      for (const occ of (bc.occurrences || [])) {
        if (typeof occ.start !== 'number' || typeof occ.end !== 'number') continue;
        if (occ.end - occ.start < 0.5) continue;

        // Attach transcript segments that fall within this occurrence
        // so Call 2 can read the actual words spoken
        const occSegments = clip.segments.filter(s =>
          s.end >= occ.start - 0.5 && s.start <= occ.end + 0.5
        );

        beatPool[idx].push({
          footage_id:      clip.id,
          proxy_path:      clip.proxy_path || clip.file_path,
          clip_duration:   clip.duration || (clip.segments.slice(-1)[0]?.end ?? 0),
          clip_created_at: clip.creation_timestamp || clip.ingested_at || '',
          start:           occ.start,
          end:             occ.end,
          quality:         occ.quality || 'clean',
          note:            occ.note   || '',
          beat_name:       bc.beat_name || beats[idx]?.name || `Beat ${idx + 1}`,
          segments:        occSegments,
        });
      }
    }

    // ── Assign gold moments using Call 1's own beat windows ──────────────
    // Gold moments are anchored to the beat whose occurrence range contains
    // them — not a post-hoc proximity guess across the whole pool.
    // Pass 1: overlap with a beat window in this clip.
    // Pass 2: nearest beat window by timestamp (fallback, same-clip only).
    for (const gm of (result.gold_moments || [])) {
      if (typeof gm.start !== 'number' || typeof gm.end !== 'number') continue;

      let bestBeatIdx = -1;
      let bestOverlap = -1;

      // Pass 1 — overlap with Claude's beat occurrence windows
      for (const [idxStr, windows] of Object.entries(beatWindows)) {
        const idx = parseInt(idxStr, 10);
        for (const w of windows) {
          const overlap = Math.min(gm.end, w.end) - Math.max(gm.start, w.start);
          if (overlap > bestOverlap) { bestOverlap = overlap; bestBeatIdx = idx; }
        }
      }

      // Pass 2 — nearest window by timestamp (no overlap but windows exist)
      if (bestOverlap < 0 && Object.keys(beatWindows).length > 0) {
        let minDist = Infinity;
        for (const [idxStr, windows] of Object.entries(beatWindows)) {
          const idx = parseInt(idxStr, 10);
          for (const w of windows) {
            const dist = Math.min(
              Math.abs(gm.start - w.start),
              Math.abs(gm.start - w.end),
              Math.abs(gm.end   - w.start),
              Math.abs(gm.end   - w.end)
            );
            if (dist < minDist) { minDist = dist; bestBeatIdx = idx; }
          }
        }
        // Still no beat windows at all — skip (can't attribute safely)
        if (minDist === Infinity) {
          emit({ event: 'status', message: `Gold moment skipped — no beat windows to anchor to (${gm.reason?.slice(0, 60) || ''})` });
          continue;
        }
      }

      if (bestBeatIdx < 0) continue; // safety — no beats at all

      // Add gold moment as a take in the winning beat with quality:'gold'
      beatPool[bestBeatIdx].push({
        footage_id:      clip.id,
        proxy_path:      clip.proxy_path || clip.file_path,
        clip_duration:   clip.duration || 0,
        clip_created_at: '',
        start:           gm.start,
        end:             gm.end,
        quality:         'gold',
        note:            gm.reason || 'Off-script gold moment',
        beat_name:       beats[bestBeatIdx]?.name || `Beat ${bestBeatIdx + 1}`,
        segments:        [],
      });
      emit({ event: 'status', message: `Gold → beat "${beats[bestBeatIdx]?.name}" (${gm.reason?.slice(0, 60) || ''})` });
    }
  }

  // ── 7. Diagnostic — log what Call 1 found per beat ──────────────────────
  for (let i = 0; i < beats.length; i++) {
    const takes = beatPool[i];
    if (takes.length === 0) continue;
    const summary = takes.map((t, n) =>
      `take${n + 1}: ${fmtTs(t.start)}–${fmtTs(t.end)} [${t.quality}]`
    ).join(', ');
    emit({ event: 'status', message: `[Call1] Beat "${beats[i].name}": ${summary}` });
  }

  // ── 9. Call 2 — Smart assembly per beat (Opus) ──────────────────────────
  // For each beat: give Claude all takes + the WritΩr script section.
  // Claude picks the best sequence using as few cuts as possible.
  // Takes are short (1-3 sentences each) — Claude sequences them like building blocks.
  emit({ event: 'status', message: `Assembling beats with AI (${ASSEMBLY_MODEL})…` });

  const sections     = [];
  const missingBeats = [];

  // Build per-beat WritΩr script lookup
  const beatScriptLookup = {};
  if (writrBeatMap && Array.isArray(writrBeatMap)) {
    for (const bm of writrBeatMap) {
      const key = bm.beat_index ?? bm.beat_name;
      beatScriptLookup[key] = bm.real_moment || bm.coverage_description || null;
    }
  }

  for (let i = 0; i < beats.length; i++) {
    const beat     = beats[i];
    const allTakes = beatPool[i];

    if (allTakes.length === 0) {
      missingBeats.push(beat.name);
      emit({ event: 'warning', message: `Beat ${i + 1} "${beat.name}": no footage found` });
      continue;
    }

    emit({ event: 'beat_assembling', beat: beat.name, takes: allTakes.length });

    // Per-beat WritΩr script text
    const writrBeatScript = beatScriptLookup[i] || beatScriptLookup[beat.name] || null;

    // Call 2 — Claude assembles best sequence from short takes
    let assembly = [];
    let assemblyNote = '';
    try {
      const raw = await assembleBeat(beat, allTakes, writrBeatScript, creatorCtx, emit);
      // assembleBeat returns an array with assembly_note attached as a property
      assembly = Array.isArray(raw) ? raw : [];
      assemblyNote = raw.assembly_note || '';
    } catch (e) {
      emit({ event: 'warning', message: `Call 2 failed for "${beat.name}": ${e.message} — using best clean take` });
      // Fallback: last non-fumbled take, full block
      const sorted = [...allTakes].sort((a, b) => new Date(a.clip_created_at) - new Date(b.clip_created_at));
      const fallback = sorted.slice().reverse().find(t => t.quality !== 'fumbled') || sorted[sorted.length - 1];
      assembly = [{ footage_id: fallback.footage_id, start_ts: fallback.start, end_ts: fallback.end, level: 'fallback', note: 'Call 2 failed — last clean take' }];
      assemblyNote = 'Assembly failed — fallback to last clean take';
    }

    // Apply handles to the assembly segments, then sort chronologically.
    // All takes live in a single long clip — later takes are at higher timestamps.
    // Sorting by start ensures the DaVinci timeline always moves forward through
    // the source clip (no backward jumps from e.g. 45:48 back to 3:53).
    const withHandles = applyHandlesToAssembly(assembly, allTakes)
      .sort((a, b) => a.start - b.start);

    // Build takes list for display (all tagged takes, sorted chronologically)
    const sortedTakes = [...allTakes].sort((a, b) => {
      if (a.clip_created_at !== b.clip_created_at) return new Date(a.clip_created_at) - new Date(b.clip_created_at);
      return a.start - b.start;
    });

    const qualitySummary = sortedTakes.map((t, n) => `take${n + 1}:${t.quality}`).join(' ');
    const hasGold = sortedTakes.some(t => t.quality === 'gold');

    sections.push({
      project_id:               projectId,
      script_section:           `Beat ${i + 1} — ${beat.name}`,
      section_index:            i,
      // All tagged takes (building blocks) — for approval UI display
      takes:                    sortedTakes.map(t => ({
        footage_id:  t.footage_id,
        proxy_path:  t.proxy_path,
        start:       t.start,
        end:         t.end,
        quality:     t.quality,
        note:        t.note,
        beat_name:   t.beat_name,
        segments:    (t.segments || []).slice(0, 10), // first 10 segments for UI preview
      })),
      // Claude's proposed sequence (what actually goes on the timeline)
      selected_takes:           withHandles,
      winner_footage_id:        withHandles[0]?.footage_id || sortedTakes[0]?.footage_id || null,
      gold_nugget:              hasGold ? 1 : 0,
      fire_suggestion:          `${sortedTakes.length} take(s) — ${qualitySummary}. ${beat.emotional_function || ''}`,
      assembly_note:            assemblyNote,
      assembly_mode:            'ai_assembled',
      davinci_timeline_position: sections.length,
    });

    emit({ event: 'beat_mapped', beat: beat.name, takes: sortedTakes.length, segments: withHandles.length });
  }

  if (sections.length === 0) {
    return { ok: false, error: 'No sections built — transcription may have failed or clips may not match the beat map.' };
  }

  return finalise(sections, projectId, 'scripted', emit, missingBeats);
}

// ─────────────────────────────────────────────
// FINALISE — write to DB and return summary
// ─────────────────────────────────────────────

function finalise(sections, projectId, mode, emit, missingBeats = []) {
  db.deleteSelectsByProject(projectId);
  for (const section of sections) {
    db.insertSelect(section);
  }
  db.updateProjectEditorState(projectId, 'assembly_ready');

  const goldCount = sections.filter(s => s.gold_nugget).length;
  const beatCount = sections.filter(s => !s.gold_nugget).length;

  emit({
    event:   'done',
    message: `Assembly complete — ${beatCount} beat(s), ${goldCount} gold moment(s), ${missingBeats.length} missing`,
  });

  if (missingBeats.length > 0) {
    emit({ event: 'missing_beats', beats: missingBeats,
      message: `Missing from footage: ${missingBeats.join(', ')}` });
  }

  return {
    ok:             true,
    mode,
    sections_count: sections.length,
    beat_count:     beatCount,
    gold_count:     goldCount,
    missing_beats:  missingBeats,
  };
}

module.exports = { buildAssembly };
