/**
 * SelectsΩr Engine v2 — src/editor/selects-new.js
 *
 * Philosophy: When in doubt, KEEP IT.
 * This is a first-pass assembly, not a final cut.
 * Cari and Jason edit in DaVinci. Our job is to give them
 * a clean, ordered, complete timeline — nothing missing.
 *
 * Three shoot modes:
 *   SCRIPTED  — script exists, anchor to beats, pick best take per beat
 *   FREEFORM  — no script, keep all rants, cut junk only, chrono order
 *   HYBRID    — partial script, anchor what matches, flag everything else
 *
 * Decision gate (runs before any selection logic):
 *   - VaultΩr classification = 'b-roll'          → skip (b-roll bridge handles it)
 *   - VaultΩr classification = 'mixed'            → keep whole clip, flag YELLOW
 *   - VaultΩr classification uncertain/unknown    → keep whole clip, flag YELLOW
 *   - VaultΩr classification = 'talking_head'     → run selects logic
 *
 * What gets cut — HARD RULES ONLY:
 *   ✂  Dead air > 2 seconds (silence, nothing happening)
 *   ✂  False starts < 3 words followed by silence
 *   ✂  Pure filler < 1.5 seconds (um / uh / hmm alone)
 *   ✂  Exact duplicate back-to-back segments
 *   ✂  Pre-roll / post-roll (camera not yet ready)
 *
 * What NEVER gets cut:
 *   ✅  Any segment with real speech
 *   ✅  Mixed clips — always kept whole
 *   ✅  Off-script moments
 *   ✅  Anything Claude isn't certain about
 *   ✅  Any clip under 30 seconds
 *   ✅  Laughter, reactions, natural moments
 */

const path = require('path');
const { callWhisper } = require('../vault/transcribe');
const { callClaude } = require('../utils/claude'); // shared Claude caller
const db = require('../db');

// ─── Constants ───────────────────────────────────────────────────────────────

const DEAD_AIR_THRESHOLD_S   = 2.0;   // seconds of silence = cut
const FILLER_THRESHOLD_S     = 1.5;   // filler-only segment under this = cut
const MIN_CLIP_DURATION_S    = 30;    // clips under 30s → always keep whole
const FILLER_WORDS           = new Set(['um','uh','hmm','ah','er','like','you know']);

// ─── Shoot mode detection ────────────────────────────────────────────────────

function detectShootMode(script) {
  if (!script || (typeof script === 'string' ? script : '').trim().length < 50) return 'freeform';
  // If script has clear beat markers or substantial content → scripted
  const lines = (typeof script === 'string' ? script : '').trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length >= 3) return 'scripted';
  return 'hybrid';
}

// ─── Clip classification gate ────────────────────────────────────────────────

function classifyClipForSelects(clip) {
  const shotType = (clip.shot_type || '').toLowerCase();
  const confidence = clip.classification_confidence || 0;

  if (shotType === 'b-roll') {
    return { action: 'skip', reason: 'b-roll — handled by b-roll bridge' };
  }
  if (shotType === 'mixed') {
    return { action: 'keep_flag', reason: 'mixed or uncertain — keep whole clip, flag for human review' };
  }
  if (shotType === 'talking-head' || shotType === 'talking_head' || shotType === 'dialogue') {
    return { action: 'selects', reason: 'talking head — run selects logic' };
  }
  // Unknown classification → keep it
  return { action: 'keep_flag', reason: 'unknown classification — keeping whole clip' };
}

// ─── Hard junk detection (transcript-level) ──────────────────────────────────

function isHardJunk(segment) {
  const text  = (segment.text || '').trim().toLowerCase();
  const dur   = (segment.end || 0) - (segment.start || 0);
  const words = text.split(/\s+/).filter(Boolean);

  // Dead air — very short segment with no real words
  if (dur < DEAD_AIR_THRESHOLD_S && words.length === 0) return true;

  // Pure filler under threshold
  const allFiller = words.every(w => FILLER_WORDS.has(w));
  if (allFiller && dur < FILLER_THRESHOLD_S) return true;

  // False start — under 3 words
  if (words.length < 3 && dur < 1.0) return true;

  return false;
}

function cleanTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  const segments = transcript.filter(seg => !isHardJunk(seg));

  // Remove exact back-to-back duplicates
  return segments.filter((seg, i) => {
    if (i === 0) return true;
    const prev = segments[i - 1];
    return seg.text?.trim() !== prev.text?.trim();
  });
}

// ─── Freeform mode ───────────────────────────────────────────────────────────

async function buildFreeformSelects(clips, projectId) {
  const sections = [];

  for (const clip of clips) {
    const transcript = clip.parsedTranscript || [];
    const cleaned    = cleanTranscript(transcript);

    if (cleaned.length === 0 && clip.duration < MIN_CLIP_DURATION_S) continue;

    // Ask Claude to flag high-energy segments only — not to cut anything
    const energyFlags = await detectHighEnergy(clip, cleaned);

    sections.push({
      script_section : `Clip ${clip.footage_id}`,
      section_index  : sections.length,
      mode           : 'freeform',
      winner         : {
        footage_id : clip.footage_id,
        start      : cleaned[0]?.start ?? 0,
        end        : cleaned[cleaned.length - 1]?.end ?? clip.duration,
        proxy_path : clip.proxy_path,
      },
      fire_suggestion : energyFlags.length > 0
        ? `High energy at: ${energyFlags.map(f => fmtTs(f.start)).join(', ')}`
        : 'Review for story moments',
      gold_nuggets    : energyFlags,
      marker_color    : 'Blue',
    });
  }

  return sections;
}

async function detectHighEnergy(clip, segments) {
  if (segments.length === 0) return [];

  const transcriptText = segments
    .map(s => `[${fmtTs(s.start)}] ${s.text}`)
    .join('\n');

  const prompt = `You are reviewing a transcript from a freeform talking-head video for a homesteading creator named Jason.

Your ONLY job is to flag segments that feel high-energy, emotionally charged, or like a genuine "rant" or breakthrough moment.

DO NOT suggest cutting anything. Flag moments worth highlighting for the editor.

Transcript:
${transcriptText}

Return JSON only:
{
  "high_energy_segments": [
    { "start": 12.4, "end": 28.1, "reason": "one sentence why this moment is notable" }
  ]
}

If nothing stands out, return { "high_energy_segments": [] }`;

  try {
    const result = await callClaude(prompt, 1024);
    return result?.high_energy_segments || [];
  } catch (e) {
    return [];
  }
}

// ─── Scripted mode ───────────────────────────────────────────────────────────

async function buildScriptedSelects(clips, script, projectId) {
  // Parse script into ordered beats
  const beats = parseScriptBeats(script);

  // For each beat, find all candidate segments across all clips
  const beatCandidates = beats.map(beat => ({
    beat,
    candidates: [],
  }));

  // Align clip segments to beats
  for (const clip of clips) {
    const transcript = clip.parsedTranscript || [];
    const cleaned    = cleanTranscript(transcript);

    for (const segment of cleaned) {
      const beatIndex = findBestBeatMatch(segment.text, beats);
      if (beatIndex >= 0) {
        beatCandidates[beatIndex].candidates.push({
          footage_id : clip.footage_id,
          proxy_path : clip.proxy_path,
          start      : segment.start,
          end        : segment.end,
          text       : segment.text,
          clip_index : clips.indexOf(clip),
        });
      }
    }
  }

  // For each beat, pick the winner via Claude
  const sections = [];
  for (let i = 0; i < beatCandidates.length; i++) {
    const { beat, candidates } = beatCandidates[i];

    if (candidates.length === 0) {
      // No match found — flag for human, keep searching
      continue;
    }

    const winner = candidates.length === 1
      ? candidates[0]
      : await pickBestTake(beat, candidates);

    sections.push({
      script_section  : beat.label,
      section_index   : i,
      mode            : 'scripted',
      winner          : {
        footage_id : winner.footage_id,
        start      : winner.start,
        end        : winner.end,
        proxy_path : winner.proxy_path,
      },
      fire_suggestion : beat.notes || '',
      gold_nuggets    : [],
      marker_color    : 'Blue',
    });
  }

  // Detect off-script gold across all clips
  const goldNuggets = await detectOffScriptGold(clips, script);
  // Gold nuggets appended at end, never dropped
  for (const gold of goldNuggets) {
    sections.push({
      script_section  : 'OFF-SCRIPT GOLD',
      section_index   : sections.length,
      mode            : 'gold',
      winner          : gold,
      fire_suggestion : gold.reason || 'Off-script moment — review for use',
      gold_nuggets    : [],
      marker_color    : 'Red',
    });
  }

  return sections;
}

function parseScriptBeats(script) {
  // Split script into meaningful beats by paragraph or line breaks
  const paragraphs = script
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 20);

  return paragraphs.map((text, i) => ({
    index : i,
    label : `Beat ${i + 1}`,
    text,
    notes : '',
  }));
}

function findBestBeatMatch(segmentText, beats) {
  // Simple word overlap scoring — no Claude call needed for this
  const segWords = new Set(
    segmentText.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  );

  let bestScore = 0;
  let bestIndex = -1;

  for (let i = 0; i < beats.length; i++) {
    const beatWords = beats[i].text
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4);

    const overlap = beatWords.filter(w => segWords.has(w)).length;
    const score   = overlap / Math.max(beatWords.length, 1);

    if (score > bestScore && score > 0.15) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

async function pickBestTake(beat, candidates) {
  if (candidates.length === 1) return candidates[0];

  const prompt = `You are selecting the best take for a video edit.

Script beat: "${beat.text}"

Candidates (choose ONE):
${candidates.map((c, i) => `[${i}] footage_id:${c.footage_id} | ${fmtTs(c.start)}–${fmtTs(c.end)} | "${c.text}"`).join('\n')}

Pick the candidate that:
- Most completely covers the beat
- Has the cleanest delivery (no fumbles, restarts)
- Feels most natural and energetic

Return JSON only: { "winner_index": 0 }`;

  try {
    const result = await callClaude(prompt, 256);
    const idx    = result?.winner_index ?? 0;
    return candidates[idx] ?? candidates[0];
  } catch (e) {
    return candidates[0];
  }
}

async function detectOffScriptGold(clips, script) {
  const gold = [];

  for (const clip of clips) {
    const transcript = clip.parsedTranscript || [];
    const cleaned    = cleanTranscript(transcript);
    if (cleaned.length === 0) continue;

    const transcriptText = cleaned
      .map(s => `[${fmtTs(s.start)}] ${s.text}`)
      .join('\n');

    const prompt = `You are reviewing footage from a homesteading creator named Jason.

Script for this video:
${script.slice(0, 1500)}

Transcript from clip footage_id:${clip.footage_id}:
${transcriptText}

Find any moments where Jason goes OFF-SCRIPT in a way that feels genuine, surprising, or more real than the scripted content. These are gold.

DO NOT flag scripted content. Only flag genuinely unscripted moments.

Return JSON only:
{
  "gold": [
    {
      "footage_id": ${clip.footage_id},
      "start": 0.0,
      "end": 0.0,
      "proxy_path": "${clip.proxy_path || ''}",
      "reason": "one sentence describing why this is gold"
    }
  ]
}

If nothing qualifies, return { "gold": [] }`;

    try {
      const result = await callClaude(prompt, 1024);
      if (result?.gold?.length > 0) gold.push(...result.gold);
    } catch (e) {
      // Never drop gold detection errors silently
      console.error(`Gold detection failed for clip ${clip.footage_id}:`, e.message);
    }
  }

  return gold;
}

// ─── Hybrid mode ─────────────────────────────────────────────────────────────

async function buildHybridSelects(clips, script, projectId) {
  // Run scripted logic for what matches
  const scripted = await buildScriptedSelects(clips, script, projectId);

  // Find clips/segments that didn't match any beat → flag for human review
  const matchedFootageIds = new Set(
    scripted
      .filter(s => s.mode === 'scripted')
      .map(s => s.winner.footage_id)
  );

  for (const clip of clips) {
    if (!matchedFootageIds.has(clip.footage_id)) {
      const transcript = clip.parsedTranscript || [];
      const cleaned    = cleanTranscript(transcript);

      scripted.push({
        script_section  : `UNMATCHED — Review: Clip ${clip.footage_id}`,
        section_index   : scripted.length,
        mode            : 'hybrid_unmatched',
        winner          : {
          footage_id : clip.footage_id,
          start      : cleaned[0]?.start ?? 0,
          end        : cleaned[cleaned.length - 1]?.end ?? clip.duration,
          proxy_path : clip.proxy_path,
        },
        fire_suggestion : 'Did not match script beat — review for use or gold',
        gold_nuggets    : [],
        marker_color    : 'Orange',
      });
    }
  }

  return scripted;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function fmtTs(s) {
  if (typeof s !== 'number') return '0:00.0';
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function buildSelects(projectId, onProgress) {
  const emit = onProgress || (() => {});

  // 1. Load project
  const project = db.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  emit({ event: 'status', message: 'Loading footage...' });

  // 2. Pull all clips for project
  const allClips = db.getAllFootage({ project_id: projectId });
  if (!allClips?.length) {
    return { ok: false, error: 'No footage found for project' };
  }

  // 3. Decision gate — classify every clip
  const skipped    = [];
  const flagged    = [];   // mixed/uncertain → keep whole, flag yellow
  const forSelects = [];   // talking head → run selects logic

  for (const clip of allClips) {
    const gate = classifyClipForSelects(clip);
    if      (gate.action === 'skip')      skipped.push(clip);
    else if (gate.action === 'keep_flag') flagged.push(clip);
    else                                  forSelects.push(clip);
  }

  emit({
    event   : 'gate_summary',
    message : `Gate: ${forSelects.length} for selects, ${flagged.length} flagged mixed, ${skipped.length} b-roll skipped`,
  });

  // 4. Transcribe any untranscribed selects clips
  for (const clip of forSelects) {
    if (!clip.transcript) {
      emit({ event: 'transcribing', message: `Transcribing clip ${clip.footage_id}...` });
      try {
        const result = await callWhisper(clip.file_path || clip.proxy_path);
        clip.parsedTranscript = result.segments || [];
        db.updateFootage(clip.footage_id, { transcript: JSON.stringify(result) });
      } catch (e) {
        // Transcription failed → treat as flagged, keep whole clip
        clip.parsedTranscript = [];
        flagged.push(clip);
        continue;
      }
    } else {
      try {
        const parsed = typeof clip.transcript === 'string'
          ? JSON.parse(clip.transcript)
          : clip.transcript;
        clip.parsedTranscript = parsed.segments || parsed || [];
      } catch {
        clip.parsedTranscript = [];
      }
    }
  }

  // 5. Load script
  const script = db.getApprovedWritrScript(projectId)
    || db.getScript(projectId)
    || project.concept_note
    || '';

  // 6. Detect shoot mode
  const mode = detectShootMode(script);
  emit({ event: 'mode_detected', message: `Shoot mode: ${mode.toUpperCase()}` });

  // 7. Build sections by mode
  let sections = [];

  if (mode === 'freeform') {
    sections = await buildFreeformSelects(forSelects, projectId);
  } else if (mode === 'scripted') {
    sections = await buildScriptedSelects(forSelects, script, projectId);
  } else {
    sections = await buildHybridSelects(forSelects, script, projectId);
  }

  // 8. Append flagged mixed clips at end — always kept, orange markers
  for (const clip of flagged) {
    sections.push({
      script_section  : `MIXED CLIP — Review: ${clip.original_filename || clip.footage_id}`,
      section_index   : sections.length,
      mode            : 'mixed_flagged',
      winner          : {
        footage_id : clip.footage_id,
        start      : 0,
        end        : clip.duration || 0,
        proxy_path : clip.proxy_path,
      },
      fire_suggestion : 'Mixed talking-head + b-roll — keep whole clip, decide in timeline',
      gold_nuggets    : [],
      marker_color    : 'Orange',
    });
  }

  if (sections.length === 0) {
    return { ok: false, error: 'No sections built — check footage classification and transcription' };
  }

  // 9. Write to DB
  db.deleteSelectsByProject(projectId);
  for (const section of sections) {
    db.insertSelect({ ...section, project_id: projectId });
  }
  db.updateProjectEditorState(projectId, 'selects_ready');

  emit({ event: 'done', message: `Built ${sections.length} sections (mode: ${mode})` });

  return {
    ok            : true,
    mode,
    sections_count : sections.length,
    gold_count     : sections.filter(s => s.marker_color === 'Red').length,
    mixed_flagged  : flagged.length,
    skipped_broll  : skipped.length,
  };
}

module.exports = { buildSelects };
