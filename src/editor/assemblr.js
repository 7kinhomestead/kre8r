/**
 * AssemblΩr Engine — src/editor/assemblr.js
 *
 * Builds a rough-cut assembly from talking-head footage using the project's
 * PipΩr beat map and Whisper transcripts. Replaces SelectsΩr v2.
 *
 * Core approach:
 *   1. Sort all talking-head clips by creation_timestamp (chronological)
 *   2. Transcribe each clip (using proxy_path when available)
 *   3. Claude reads each transcript against the beat map and returns
 *      every occurrence of every beat, including retakes
 *   4. Collect all takes of each beat across all clips
 *   5. Last take of each beat = winner (warmup principle)
 *   6. Add 2s lead-in / 3s tail handles, clamped to clip bounds
 *   7. Gold moments (genuinely off-script) flagged separately
 *   8. Write to selects table — compatible with existing DaVinci export
 *
 * Freeform fallback (no beat map): chronological dump with energy flagging.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const { transcribeFile }        = require('../vault/transcribe');
const { callClaude }            = require('../utils/claude');
const { getCreatorContext }     = require('../utils/creator-context');
const { readConfig }            = require('../pipr/beat-tracker');
const db = require('../db');

// Handles added around each selected take (seconds)
const LEAD_IN_S  = 2.0;
const TAIL_S     = 3.0;

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
  // proxy_path is a decodable MP4/MOV; file_path may be a BRAW
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
// BEAT MAPPING VIA CLAUDE
// Sends one clip transcript + full beat map to Claude.
// Returns beat coverage + gold moments for that clip.
// ─────────────────────────────────────────────

async function mapBeatsInClip(clip, segments, beats, creatorCtx) {
  if (!segments || segments.length === 0) return { beat_coverage: [], gold_moments: [] };

  const transcriptText = segments
    .map(s => `[${fmtTs(s.start)}] ${s.text.trim()}`)
    .join('\n');

  const beatList = beats.map((b, i) =>
    `Beat ${i + 1} — "${b.name}": ${b.emotional_function || b.description || ''}`
  ).join('\n');

  const prompt = `You are analyzing a transcript from a ${creatorCtx.niche} video by ${creatorCtx.creatorName || creatorCtx.brand}.

The video follows this beat map:
${beatList}

Here is the transcript from one filming clip (clip ID: ${clip.id || clip.footage_id}):
${transcriptText}

Your job:
1. For each beat in the beat map, identify every place it appears in this transcript.
   - A beat may appear 0, 1, or multiple times (retakes/restarts are common).
   - Use SEMANTIC understanding — the creator may say the same thing in completely different words than the beat description.
   - A strong off-script moment that serves the same emotional purpose as a beat counts as that beat.
2. Flag any moments that feel genuinely spontaneous, surprising, or emotionally real — these are gold even if off-script.

Return ONLY valid JSON (no markdown, no explanation):
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
          "note": "one sentence — why this is/isn't a good take"
        }
      ]
    }
  ],
  "gold_moments": [
    {
      "start": 0.0,
      "end": 0.0,
      "reason": "one sentence — what makes this genuine gold"
    }
  ]
}

If a beat has no occurrences, include it with "occurrences": [].
If there are no gold moments, use "gold_moments": [].`;

  try {
    return await callClaude(prompt, 2048);
  } catch (e) {
    console.warn(`[AssemblΩr] Beat mapping failed for clip ${clip.id || clip.footage_id}: ${e.message}`);
    return { beat_coverage: [], gold_moments: [] };
  }
}

// ─────────────────────────────────────────────
// BEST TAKE SELECTION
// "Last take wins" — the final attempt of a beat is usually the best
// because the creator has warmed up. Claude can override if quality
// is explicitly 'fumbled' on the last take but 'strong' on an earlier one.
// ─────────────────────────────────────────────

function pickBestTake(allTakes) {
  if (allTakes.length === 0) return null;
  if (allTakes.length === 1) return allTakes[0];

  // Sort chronologically (by clip timestamp, then by position within clip)
  const sorted = [...allTakes].sort((a, b) => {
    if (a.clip_created_at !== b.clip_created_at) {
      return new Date(a.clip_created_at) - new Date(b.clip_created_at);
    }
    return a.start - b.start;
  });

  // Last take wins by default
  let winner = sorted[sorted.length - 1];

  // Override: if last is 'fumbled' and there's a 'strong' take earlier, use the strong one
  if (winner.quality === 'fumbled') {
    const strong = sorted.slice().reverse().find(t => t.quality === 'strong');
    if (strong) {
      winner = strong;
      console.log(`[AssemblΩr] Beat override: last take fumbled, using 'strong' take at ${fmtTs(strong.start)}`);
    }
  }

  return winner;
}

// ─────────────────────────────────────────────
// FREEFORM MODE
// No beat map — chronological assembly with energy detection
// ─────────────────────────────────────────────

async function buildFreeformAssembly(clips, projectId, emit) {
  emit({ event: 'status', message: 'Freeform mode — no beat map found. Building chronological assembly.' });

  const sections = [];

  for (const clip of clips) {
    const segments = parseStoredTranscript(clip) || [];
    const duration = clip.duration || 0;

    sections.push({
      project_id:               projectId,
      script_section:           `Clip ${clip.footage_id} — ${clip.original_filename || ''}`.trim(),
      section_index:            sections.length,
      takes:                    [{ footage_id: clip.footage_id, start: 0, end: duration, proxy_path: clip.proxy_path || clip.file_path }],
      selected_takes:           [{ footage_id: clip.footage_id, start: 0, end: duration, proxy_path: clip.proxy_path || clip.file_path }],
      winner_footage_id:        clip.footage_id,
      gold_nugget:              0,
      fire_suggestion:          'Review for energy moments',
      davinci_timeline_position: sections.length,
      mode:                     'freeform',
      marker_color:             'Blue',
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
  const beats = piprConfig?.beats || [];

  const hasBeatMap = beats.length > 0;
  emit({ event: 'status', message: hasBeatMap
    ? `Beat map loaded: ${beats.length} beats (${piprConfig.story_structure || 'custom'})`
    : `No beat map found (project ID: ${projectId}) — will use freeform assembly`
  });

  // ── 2. Load footage, sorted chronologically ──────────────────────────────
  const allClips   = db.getAllFootage({ project_id: projectId });
  const talkingHead = allClips
    .filter(c => {
      const st = (c.shot_type || '').toLowerCase().replace('_', '-');
      return st === 'talking-head' || st === 'dialogue';
    })
    .sort((a, b) => {
      // Sort by creation_timestamp (when filmed), fall back to ingested_at
      const ta = a.creation_timestamp || a.ingested_at || '';
      const tb = b.creation_timestamp || b.ingested_at || '';
      return ta.localeCompare(tb);
    });

  if (talkingHead.length === 0) {
    return { ok: false, error: 'No talking-head clips found for this project. Check VaultΩr classification.' };
  }

  emit({ event: 'status', message: `Found ${talkingHead.length} talking-head clip(s) in chronological order` });

  // ── 3. Transcribe each clip ──────────────────────────────────────────────
  const transcribed = [];
  for (const clip of talkingHead) {
    const filePath = getTranscribablePath(clip);

    if (!filePath) {
      emit({ event: 'warning', message: `Clip ${clip.footage_id} (${clip.original_filename}): no decodable file found — skipped` });
      continue;
    }

    // Check if transcript already in DB
    let segments = parseStoredTranscript(clip);

    if (!segments) {
      emit({ event: 'transcribing', message: `Transcribing: ${clip.original_filename || clip.footage_id}` });
      try {
        const result = await transcribeFile(filePath, { footageId: clip.footage_id, onProgress: (p) => {
          if (p.stage === 'whisper_progress') emit({ event: 'transcribe_progress', message: p.line });
        }});
        if (result.ok) {
          segments = result.segments || [];
          // Store in DB for next time
          db.updateFootage(clip.footage_id, { transcript: JSON.stringify({ segments }) });
          emit({ event: 'transcribed', message: `${clip.original_filename}: ${segments.length} segments, ${fmtTs(result.duration)}` });
        } else {
          emit({ event: 'warning', message: `Transcription failed for ${clip.original_filename}: ${result.error}` });
          segments = [];
        }
      } catch (e) {
        emit({ event: 'warning', message: `Transcription error for ${clip.footage_id}: ${e.message}` });
        segments = [];
      }
    } else {
      emit({ event: 'status', message: `Transcript cached: ${clip.original_filename || clip.footage_id} (${segments.length} segments)` });
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

  // ── 5. Map beats to each clip via Claude ─────────────────────────────────
  const creatorCtx = getCreatorContext();
  emit({ event: 'status', message: 'Mapping beats to transcripts via Claude...' });

  // beatPool[beatIndex] = array of all candidate takes across all clips
  const beatPool = beats.map(() => []);
  const goldPool = [];

  for (const clip of transcribed) {
    if (!clip.segments || clip.segments.length === 0) continue;

    emit({ event: 'mapping', message: `Analysing: ${clip.original_filename || `clip ${clip.footage_id}`}` });

    const result = await mapBeatsInClip(clip, clip.segments, beats, creatorCtx);

    // Collect beat occurrences
    for (const bc of (result.beat_coverage || [])) {
      const idx = bc.beat_index;
      if (idx < 0 || idx >= beats.length) continue;
      for (const occ of (bc.occurrences || [])) {
        if (typeof occ.start !== 'number' || typeof occ.end !== 'number') continue;
        if (occ.end - occ.start < 0.5) continue; // ignore sub-second fragments
        beatPool[idx].push({
          footage_id:       clip.footage_id,
          proxy_path:       clip.proxy_path || clip.file_path,
          clip_duration:    clip.duration || (clip.segments.slice(-1)[0]?.end ?? 0),
          clip_created_at:  clip.creation_timestamp || clip.ingested_at || '',
          start:            occ.start,
          end:              occ.end,
          quality:          occ.quality || 'clean',
          note:             occ.note || '',
          beat_name:        bc.beat_name || beats[idx]?.name || `Beat ${idx + 1}`,
        });
      }
    }

    // Collect gold moments
    for (const gm of (result.gold_moments || [])) {
      if (typeof gm.start !== 'number' || typeof gm.end !== 'number') continue;
      goldPool.push({
        footage_id:  clip.footage_id,
        proxy_path:  clip.proxy_path || clip.file_path,
        clip_duration: clip.duration || 0,
        start:       gm.start,
        end:         gm.end,
        reason:      gm.reason || 'Off-script gold moment',
      });
    }
  }

  // ── 6. Pick best take per beat + build sections ──────────────────────────
  emit({ event: 'status', message: 'Selecting best takes...' });

  const sections = [];
  const missingBeats = [];

  for (let i = 0; i < beats.length; i++) {
    const beat     = beats[i];
    const allTakes = beatPool[i];

    if (allTakes.length === 0) {
      missingBeats.push(beat.name);
      emit({ event: 'warning', message: `Beat ${i + 1} "${beat.name}": no footage found` });
      continue;
    }

    const winner = pickBestTake(allTakes);
    const dur    = winner.clip_duration;

    // Apply handles, clamped to clip bounds
    const inPoint  = clamp(winner.start - LEAD_IN_S, 0, winner.start);
    const outPoint = clamp(winner.end   + TAIL_S,    winner.end, dur > 0 ? dur : winner.end + TAIL_S);

    const allTakesFormatted = allTakes.map(t => ({
      footage_id: t.footage_id,
      proxy_path: t.proxy_path,
      start:      t.start,
      end:        t.end,
      quality:    t.quality,
      note:       t.note,
    }));

    sections.push({
      project_id:               projectId,
      script_section:           `Beat ${i + 1} — ${beat.name}`,
      section_index:            i,
      takes:                    allTakesFormatted,
      selected_takes:           [{ footage_id: winner.footage_id, proxy_path: winner.proxy_path, start: inPoint, end: outPoint }],
      winner_footage_id:        winner.footage_id,
      gold_nugget:              0,
      fire_suggestion:          allTakes.length > 1
        ? `${allTakes.length} takes — using ${winner.quality} take at ${fmtTs(winner.start)}. ${winner.note}`
        : winner.note || beat.emotional_function || '',
      davinci_timeline_position: sections.length,
    });

    emit({ event: 'beat_mapped', beat: beat.name, takes: allTakes.length, winner_quality: winner.quality });
  }

  // ── 7. Append gold moments ───────────────────────────────────────────────
  for (const gm of goldPool) {
    const inPoint  = clamp(gm.start - LEAD_IN_S, 0, gm.start);
    const outPoint = clamp(gm.end   + TAIL_S,    gm.end, gm.clip_duration > 0 ? gm.clip_duration : gm.end + TAIL_S);

    sections.push({
      project_id:               projectId,
      script_section:           '🔴 OFF-SCRIPT GOLD',
      section_index:            sections.length,
      takes:                    [{ footage_id: gm.footage_id, proxy_path: gm.proxy_path, start: gm.start, end: gm.end }],
      selected_takes:           [{ footage_id: gm.footage_id, proxy_path: gm.proxy_path, start: inPoint, end: outPoint }],
      winner_footage_id:        gm.footage_id,
      gold_nugget:              1,
      fire_suggestion:          gm.reason,
      davinci_timeline_position: sections.length,
    });
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

  const goldCount    = sections.filter(s => s.gold_nugget).length;
  const beatCount    = sections.filter(s => !s.gold_nugget).length;

  emit({
    event:   'done',
    message: `Assembly complete — ${beatCount} beat(s) mapped, ${goldCount} gold moment(s), ${missingBeats.length} beat(s) missing`,
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
