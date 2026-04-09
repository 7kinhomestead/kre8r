/**
 * WritΩr Route — src/routes/writr.js
 *
 * GET  /api/writr/:project_id/config        — project + config + active script
 * GET  /api/writr/:project_id/transcripts   — footage transcript summary
 * POST /api/writr/generate                  — run entry-point engine (SSE job)
 * GET  /api/writr/status/:job_id            — SSE stream for generate job
 * POST /api/writr/iterate                   — run iteration engine (SSE job)
 * GET  /api/writr/iterate/status/:job_id    — SSE stream for iterate job
 * POST /api/writr/:project_id/approve       — approve script + sync to SelectsΩr
 * GET  /api/writr/:project_id/scripts       — all script iterations for a project
 * GET  /api/writr/:project_id/room/session  — load persisted room conversation
 * POST /api/writr/:project_id/room/session  — save room conversation to DB
 * DELETE /api/writr/:project_id/room/session — clear room conversation from DB
 * POST /api/writr/:project_id/room/approve  — approve script draft from room session
 */

'use strict';

const express          = require('express');
const { EventEmitter } = require('events');
const crypto           = require('crypto');

const db = require('../db');
const { generateScriptFirst }        = require('../writr/script-first');
const { generateShootFirst }         = require('../writr/shoot-first');
const { generateHybrid }             = require('../writr/hybrid');
const { iterateScript }              = require('../writr/iterate');
const { readConfig, writeConfig }    = require('../pipr/beat-tracker');
const { listProfiles }               = require('../writr/voice-analyzer');
const { callClaude, REALITY_RULE }   = require('../writr/claude');
const vault                          = require('../utils/project-vault');
const { addSoulContext, buildWritrPromptContext } = require('../utils/project-context-builder');
const { callClaudeMessages }         = require('../utils/claude');

// ─────────────────────────────────────────────
// FORMAT CONVERSION PROMPTS (bullets + hybrid)
// Called after primary script is generated — convert to alternate output modes
// ─────────────────────────────────────────────

function buildBulletsPrompt(fullScript, brand) {
  return `You are a script editor for ${brand}.

Convert the following script into BULLET POINT format only.

Rules:
- 3-5 key phrases per beat (never full sentences)
- Keep beat markers [● BEAT: name] exactly as they appear
- Each bullet is a memory trigger, not a line to read
- Strip all b-roll cues, parentheticals, stage directions
- Keep 🎤 for talking head bullets — strip the emoji for other bullets
- Keep [BEAT NEEDED] warnings exactly as they appear
- Do NOT add any explanation, intro, or preamble

SCRIPT:
${fullScript}

Return ONLY the bullet-point script — no preamble, no JSON.`;
}

function buildHybridFormatPrompt(fullScript, beatMap, brand) {
  // Identify emotional peak beats: hook (beat 1), climax-adjacent, and final beat
  const peakNames = new Set();
  if (Array.isArray(beatMap) && beatMap.length) {
    peakNames.add((beatMap[0]?.beat_name || beatMap[0]?.name || '').toLowerCase());
    peakNames.add((beatMap[beatMap.length - 1]?.beat_name || beatMap[beatMap.length - 1]?.name || '').toLowerCase());
    if (beatMap.length >= 3) {
      const mid = Math.floor(beatMap.length * 0.65);
      peakNames.add((beatMap[mid]?.beat_name || beatMap[mid]?.name || '').toLowerCase());
    }
  }
  const peakList = [...peakNames].filter(Boolean).join(', ') || 'hook, climax, closing';

  return `You are a script editor for ${brand}.

Convert the following script to HYBRID format:
- SCRIPTED (word-for-word) for emotional peaks: ${peakList}
- BULLET POINTS for all other beats

Rules:
- Keep ALL beat markers [● BEAT: name] exactly as they appear
- Scripted beats: full sentences, conversational, in the creator's voice
- Bullet beats: 3-5 key phrases as memory triggers, not full sentences
- Keep 🎤 prefix on all talking head lines
- Keep all b-roll cues on scripted beats, strip from bullet beats
- Keep [BEAT NEEDED] warnings exactly as they appear
- Do NOT add any explanation, intro, or preamble

SCRIPT:
${fullScript}

Return ONLY the hybrid script — no preamble, no JSON.`;
}

/**
 * Generate bullets and hybrid format versions of a full script in parallel.
 * Streams tab_complete events as each finishes.
 */
async function generateFormatVariants({ fullScript, beatMap, brand, write }) {
  const bulletPromise = callClaude(buildBulletsPrompt(fullScript, brand), { raw: true })
    .then(r => {
      const script = (r || '').trim();
      write({ stage: 'tab_complete', mode: 'bullets', script });
      return script;
    })
    .catch(err => {
      console.error('[WritΩr] bullets format error:', err.message);
      write({ stage: 'tab_complete', mode: 'bullets', script: fullScript, error: err.message });
      return fullScript;
    });

  const hybridPromise = callClaude(buildHybridFormatPrompt(fullScript, beatMap, brand), { raw: true })
    .then(r => {
      const script = (r || '').trim();
      write({ stage: 'tab_complete', mode: 'hybrid', script });
      return script;
    })
    .catch(err => {
      console.error('[WritΩr] hybrid format error:', err.message);
      write({ stage: 'tab_complete', mode: 'hybrid', script: fullScript, error: err.message });
      return fullScript;
    });

  const [bullets, hybrid] = await Promise.all([bulletPromise, hybridPromise]);
  return { bullets, hybrid };
}

/**
 * Build voiceProfiles array from request body voice params.
 * voice_primary   — profile id of primary voice
 * voice_secondary — profile id of secondary voice (optional)
 * voice_blend     — integer 0-100: % weight of primary (default 100)
 *
 * Returns [{profile, weight}, ...] or [] if no valid selection.
 */
function buildVoiceProfiles(voice_primary, voice_secondary, voice_blend) {
  if (!voice_primary) return [];

  const allProfiles = listProfiles();
  const primary     = allProfiles.find(p => p.id === voice_primary);
  if (!primary) return [];

  const blendPct  = Math.max(0, Math.min(100, parseInt(voice_blend ?? 100, 10)));
  const result    = [{ profile: primary, weight: blendPct }];

  if (voice_secondary && blendPct < 100) {
    const secondary = allProfiles.find(p => p.id === voice_secondary);
    if (secondary) result.push({ profile: secondary, weight: 100 - blendPct });
  }

  return result;
}

/**
 * Persist selected voice IDs to project-config.json so the selection survives page reload.
 */
function saveVoiceSelectionToConfig(projectId, voice_primary, voice_secondary, voice_blend) {
  if (!voice_primary) return;
  try {
    const config = readConfig(projectId) || {};
    config.voice_primary   = voice_primary;
    config.voice_secondary = voice_secondary || null;
    config.voice_blend     = parseInt(voice_blend ?? 100, 10);
    writeConfig(projectId, config);
  } catch (err) {
    console.warn('[WritΩr] Could not save voice selection to config:', err.message);
  }
}

const router = express.Router();

// ─────────────────────────────────────────────
// SSE JOB STORE (same pattern as editor.js)
// ─────────────────────────────────────────────

const jobs = new Map();

function createJob() {
  const id      = crypto.randomUUID();
  const emitter = new EventEmitter();
  const job     = { id, status: 'running', events: [], emitter, result: null, error: null };
  jobs.set(id, job);
  return job;
}

function pushEvent(job, data) {
  job.events.push(data);
  job.emitter.emit('event', data);
}

function finishJob(job, result) {
  job.status = 'done';
  job.result = result;
  const ev = { stage: 'done', result };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function failJob(job, errorMsg) {
  job.status = 'error';
  job.error  = errorMsg;
  const ev = { stage: 'error', error: errorMsg };
  job.events.push(ev);
  job.emitter.emit('event', ev);
  job.emitter.emit('done');
}

function sseStream(job, req, res) {
  req.setTimeout(120_000);
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send    = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const onEvent = (data) => send(data);

  // Keepalive ping every 15 s — prevents proxy/browser from closing idle streams
  const keepalive = setInterval(() => {
    if (res.writableEnded) return clearInterval(keepalive);
    res.write(': keepalive\n\n');
  }, 15_000);

  const onDone = () => { clearInterval(keepalive); if (!res.writableEnded) res.end(); };

  for (const ev of job.events) send(ev);

  if (job.status !== 'running') { clearInterval(keepalive); res.end(); return; }

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);
  req.on('close', () => {
    clearInterval(keepalive);
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
}

// ─────────────────────────────────────────────
// SSE RESPONSE HELPER — for POST routes that stream directly
// Sets headers, starts keepalive, returns { write, end }
// ─────────────────────────────────────────────
function startSseResponse(req, res) {
  req.setTimeout(120_000);
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const write = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const keepalive = setInterval(() => {
    if (res.writableEnded) return clearInterval(keepalive);
    res.write(': keepalive\n\n');
  }, 15_000);

  const end = () => {
    clearInterval(keepalive);
    if (!res.writableEnded) res.end();
  };

  req.on('close', () => clearInterval(keepalive));

  return { write, end };
}

// ─────────────────────────────────────────────
// GET /api/writr/:project_id/config
// Returns project, pipr config, active writr script
// ─────────────────────────────────────────────

router.get('/:project_id/config', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const config  = readConfig(projectId);
  const scripts = db.getWritrScriptsByProject(projectId);
  const active  = project.active_script_id
    ? scripts.find(s => s.id === project.active_script_id) || scripts[0] || null
    : scripts[0] || null;

  res.json({
    ok: true,
    project,
    config,
    entry_point:    config?.entry_point || 'shoot_first',
    active_script:  active,
    scripts_count:  scripts.length,
    writr_complete: !!project.writr_complete
  });
});

// ─────────────────────────────────────────────
// GET /api/writr/:project_id/transcripts
// Returns summarised transcript info for shoot_first UI
// ─────────────────────────────────────────────

router.get('/:project_id/transcripts', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const footage = db.getAllFootage({ project_id: projectId });
  const withTranscripts = footage.filter(f => f.transcript?.trim());

  const summary = withTranscripts.slice(0, 3).map(f => {
    const words = (f.transcript || '').split(/\s+/).slice(0, 40).join(' ');
    return `${f.original_filename || 'clip'}: "${words}…"`;
  }).join('\n');

  res.json({
    ok: true,
    total_footage: footage.length,
    transcribed:   withTranscripts.length,
    summary:       summary || 'No transcripts available',
    word_counts:   withTranscripts.map(f => ({
      footage_id: f.id,
      filename:   f.original_filename || f.file_path?.split(/[\\/]/).pop(),
      words:      f.transcript?.split(/\s+/).length || 0
    }))
  });
});

// ─────────────────────────────────────────────
// GET /api/writr/:project_id/scripts
// Returns all script iterations for a project
// ─────────────────────────────────────────────

router.get('/:project_id/scripts', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const scripts = db.getWritrScriptsByProject(projectId);
  res.json({ ok: true, scripts });
});

// ─────────────────────────────────────────────
// POST /api/writr/generate
// Runs the entry-point engine. Returns job_id for SSE.
// Body: { project_id, entry_point, input_text, what_happened, concept, footage_text }
// ─────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    project_id, entry_point, input_text, what_happened, concept, footage_text,
    voice_primary, voice_secondary, voice_blend
  } = req.body;

  // Validate synchronously before switching to SSE (so we can return proper HTTP errors)
  const projectId = parseInt(project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'project_id required' });

  const project = db.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // ── Load soul profiles and build context string from project-context.json ──
  let id8rBlock = '';
  try {
    const _fs      = require('fs');
    const _path    = require('path');
    const rootPath = _path.join(__dirname, '..', '..');
    const _primaryProfilePath = process.env.CREATOR_PROFILE_PATH || _path.join(rootPath, 'creator-profile.json');

    // Load primary soul
    const loadedSouls = [];
    try {
      loadedSouls.push(JSON.parse(_fs.readFileSync(_primaryProfilePath, 'utf8')));
    } catch (_) {}

    // Load collaborator souls if project has them
    const collaborators = db.getProjectCollaborators(projectId);
    const collabSlugs   = (collaborators || []).filter(s => s !== 'primary');
    for (const slug of collabSlugs) {
      try {
        loadedSouls.push(JSON.parse(_fs.readFileSync(_path.join(rootPath, `creator-profile-${slug}.json`), 'utf8')));
      } catch (_) {}
    }

    // Write soul profiles into project-context.json
    if (loadedSouls.length) addSoulContext(projectId, loadedSouls);

    // Build full context string — primary source of truth
    const contextString = buildWritrPromptContext(projectId);
    console.log('[WritΩr] Context tokens estimate:', Math.round(contextString.length / 4));
    if (contextString) id8rBlock = contextString;

    // Multi-voice speaker labeling (appended if collaborators present)
    if (collabSlugs.length > 0 && loadedSouls.length > 1) {
      const primary      = loadedSouls[0];
      const primaryName  = primary.creator?.name || 'Creator';
      const primaryFirst = primaryName.split(' ')[0].toUpperCase();
      let multiVoice = '\n\n## MULTI-CREATOR PRODUCTION\n';
      multiVoice += 'This video features multiple creators. Write each section in the correct speaker\'s voice.\n\n';
      multiVoice += `PRIMARY — ${primaryName} [${primaryFirst}]:\n`;
      multiVoice += (primary.voice?.writing_style || 'Direct, warm, conversational.') + '\n\n';
      const collabFirstNames = [];
      for (const cp of loadedSouls.slice(1)) {
        const cName  = cp.creator?.name || 'Collaborator';
        const cRole  = cp.creator?.role || 'Co-presenter';
        const cFirst = cName.split(' ')[0].toUpperCase();
        const cBadge = cp.badge?.letter || cFirst;
        collabFirstNames.push(cFirst);
        multiVoice += `COLLABORATOR — ${cName} [${cBadge}]:\n`;
        multiVoice += `Role: ${cRole}\n`;
        multiVoice += (cp.voice?.writing_style || 'Natural, authentic voice.') + '\n\n';
      }
      multiVoice += 'SPEAKER LABELING RULES:\n';
      multiVoice += `- Begin EVERY beat section with a speaker label on its own line: [${primaryFirst}] or [${collabFirstNames.join('] or [')}]\n`;
      multiVoice += '- Write each creator\'s lines in THEIR voice — do not homogenize\n';
      multiVoice += '- Both creators may appear in the same beat — label each speaking block separately\n';
      multiVoice += '- Labels must be in square brackets, all caps, first name only, no punctuation after';
      id8rBlock += multiVoice;
    }

    // Fallback: if no project-context.json yet, build from raw id8r_data
    if (!id8rBlock && project.id8r_data) {
      try {
        const d = JSON.parse(project.id8r_data);
        const lines = ['## CONTENT INTELLIGENCE FROM ID8ΩR RESEARCH'];
        if (d.chosenConcept?.headline) lines.push(`Chosen Concept: ${d.chosenConcept.headline}`);
        if (d.chosenConcept?.why)      lines.push(`Why this angle: ${d.chosenConcept.why}`);
        if (d.chosenConcept?.hook)     lines.push(`Opening hook: ${d.chosenConcept.hook}`);
        if (d.researchSummary)         lines.push(`Research findings: ${d.researchSummary.slice(0, 600)}`);
        const titles = d.packageData?.titles;
        if (Array.isArray(titles) && titles[0]) lines.push(`Selected title: ${titles[0]}`);
        if (d.briefData?.elevator_pitch)         lines.push(`Vision brief: ${d.briefData.elevator_pitch}`);
        const tp = d.briefData?.talking_points;
        if (Array.isArray(tp) && tp.length)      lines.push(`Talking points:\n${tp.map(p => `- ${p}`).join('\n')}`);
        id8rBlock = lines.join('\n');
      } catch (_) {}
    }

    // Append cross-channel intelligence from AnalΩzr if available
    try {
      const cp = JSON.parse(_fs.readFileSync(_primaryProfilePath, 'utf8'));
      const ci = cp.content_intelligence;
      if (ci && Array.isArray(ci.insights) && ci.insights.length) {
        const top3 = ci.insights.slice(0, 3);
        id8rBlock += '\n\n## CONTENT INTELLIGENCE FROM YOUR DIGITAL BRAIN\n'
          + top3.map((ins, i) =>
              (i + 1) + '. [' + ((ins.type || 'insight').toUpperCase()) + '] '
              + (ins.title || '') + ': ' + (ins.insight || '')
            ).join('\n');
      }
    } catch (_) {}

  } catch (_) {}

  // Switch to SSE stream — client reads this response body directly
  const { write, end } = startSseResponse(req, res);

  try {
    const ep           = entry_point || readConfig(projectId)?.entry_point || 'shoot_first';
    const footage      = db.getAllFootage({ project_id: projectId });
    const voiceProfiles = buildVoiceProfiles(voice_primary, voice_secondary, voice_blend);

    // Persist voice selection to project config
    if (voice_primary) saveVoiceSelectionToConfig(projectId, voice_primary, voice_secondary, voice_blend);

    // Build season context if this project belongs to a show
    let seasonContext = null;
    if (project.show_id) {
      try {
        seasonContext = db.buildSeasonContext(project.show_id);
        if (seasonContext) write({ stage: 'analyzing', message: `Series context loaded — Season ${seasonContext.show.season}, Episode ${seasonContext.next_episode_number}…` });
      } catch (_) {}
    }

    write({ stage: 'analyzing', message: `Starting ${ep.replace(/_/g, ' ')} analysis…` });

    let result;

    // emit helper — filters out module 'complete' progress msgs (we send our own at the end)
    const emit = (ev) => { if (ev.stage !== 'complete') write(ev); };

    if (ep === 'script_first') {
      result = await generateScriptFirst({
        projectId,
        inputText: input_text || '',
        voiceProfiles,
        id8rBlock,
        seasonContext,
        emit
      });
    } else if (ep === 'shoot_first') {
      result = await generateShootFirst({
        projectId,
        whatHappened: what_happened || input_text || '',
        footageRows:  footage,
        voiceProfiles,
        id8rBlock,
        seasonContext,
        emit
      });
    } else if (ep === 'vault_first') {
      // vault_first — pull all VaultΩr clips for this project, build a clip inventory summary,
      // then run shoot_first engine with that as the "what happened" context
      const vaultClips   = db.getAllFootage({ project_id: projectId });
      const clipSummary  = vaultClips.length
        ? vaultClips.map(f => {
            const name = f.original_filename || (f.file_path || '').split(/[\\/]/).pop() || 'clip';
            const type = f.shot_type || 'unknown';
            const dur  = f.duration_seconds ? ` (${Math.round(f.duration_seconds)}s)` : '';
            const desc = f.transcript
              ? f.transcript.split(/\s+/).slice(0, 30).join(' ') + '…'
              : f.subject || f.topic || '(no description)';
            return `- [${type}] ${name}${dur}: ${desc}`;
          }).join('\n')
        : '(no clips found in vault for this project — add footage via VaultΩr first)';

      const vaultContext = [
        'VAULT CLIPS FOR THIS PROJECT:',
        clipSummary,
        '',
        what_happened || input_text
          ? `CREATOR NOTES:\n${what_happened || input_text}`
          : ''
      ].filter(Boolean).join('\n');

      emit?.({ stage: 'analyzing', message: `Found ${vaultClips.length} vault clip${vaultClips.length !== 1 ? 's' : ''} — building story…` });

      result = await generateShootFirst({
        projectId,
        whatHappened: vaultContext,
        footageRows:  vaultClips,
        voiceProfiles,
        id8rBlock,
        seasonContext,
        emit
      });
    } else {
      // hybrid — concept and what_happened arrive as separate fields from the client
      result = await generateHybrid({
        projectId,
        concept:      concept || input_text || '',
        whatCaptured: what_happened || footage_text || '',
        footageRows:  footage,
        voiceProfiles,
        id8rBlock,
        seasonContext,
        emit
      });
    }

    // Async side-effect: if this is an episodic project, auto-generate episode summary after completion
    if (seasonContext && project.show_id) {
      setImmediate(async () => {
        try {
          const epRow = db.getShowEpisodes(project.show_id)
            .find(e => e.project_id === projectId);
          if (epRow && !epRow.episode_summary) {
            const summaryPrompt = `Summarize this episode briefly for a show bible (2-3 sentences, past tense).
Show: ${seasonContext.show.name}
Episode ${epRow.episode_number}: ${epRow.title || '(untitled)'}
Arc advancement: ${epRow.arc_advancement || '(none recorded)'}
What was established: ${epRow.what_was_established || '(none)'}
Return ONLY valid JSON: {"summary":"string"}`;
            const r = await require('../utils/claude').callClaude(summaryPrompt, 512);
            if (r.summary) db.updateShowEpisode(epRow.id, { episode_summary: r.summary });
          }
        } catch (_) {}
      });
    }

    const scriptText  = result.script || result.shooting_script || '';
    const outlineText = result.outline || null;
    const rawInput    = ep === 'script_first'
      ? (input_text || '')
      : ep === 'hybrid'
        ? `CONCEPT: ${concept || input_text || ''}\n\nFOOTAGE: ${what_happened || ''}`
        : (what_happened || input_text || '');

    const brand = readConfig(projectId)?.brand ||
      (() => { try { return require('../utils/creator-context').getCreatorContext().brand; } catch (_) { return null; } })() ||
      '7 Kin Homestead';

    // ── EMIT FULL TAB IMMEDIATELY ──────────────────────────────────────────
    write({ stage: 'tab_complete', mode: 'full', script: scriptText });
    write({ stage: 'writing', message: 'Writing bullets and hybrid format…' });

    // ── GENERATE BULLETS + HYBRID IN PARALLEL ─────────────────────────────
    const { bullets: bulletsScript, hybrid: hybridScript } = await generateFormatVariants({
      fullScript: scriptText,
      beatMap:    result.beat_map || [],
      brand,
      write
    });

    // ── SAVE ALL THREE SCRIPTS ─────────────────────────────────────────────
    const sessionId  = crypto.randomUUID();
    const commonData = {
      project_id:        projectId,
      entry_point:       ep,
      input_type:        ep === 'script_first' ? 'script' : ep === 'shoot_first' ? 'what_happened' : 'hybrid',
      raw_input:         rawInput,
      generated_outline: outlineText,
      beat_map_json:     result.beat_map        || [],
      hook_variations:   result.hook_variations || [],
      story_found:       result.story_found     || null,
      anchor_moment:     result.anchor_moment   || null,
      missing_beats:     result.missing_beats   || [],
      iteration_count:   0,
      session_id:        sessionId
    };

    const fullId    = db.insertWritrScript({ ...commonData, generated_script: scriptText,    mode: 'full'    });
    const bulletsId = db.insertWritrScript({ ...commonData, generated_script: bulletsScript, mode: 'bullets' });
    const hybridId  = db.insertWritrScript({ ...commonData, generated_script: hybridScript,  mode: 'hybrid'  });

    db.updateProjectWritr(projectId, { active_script_id: fullId });

    // Vault: save script generation
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      vault.saveVaultData(projectId, `writr/script-${ts}-full.txt`, scriptText);
      if (bulletsScript) vault.saveVaultData(projectId, `writr/script-${ts}-bullets.txt`, bulletsScript);
      if (hybridScript)  vault.saveVaultData(projectId, `writr/script-${ts}-hybrid.txt`, hybridScript);
    } catch (vaultErr) {
      console.warn('[writr/generate] vault save failed (non-fatal):', vaultErr.message);
    }

    // Send final completion event
    write({
      stage:           'complete',
      session_id:      sessionId,
      script_ids:      { full: fullId, bullets: bulletsId, hybrid: hybridId },
      script_id:       fullId,       // backward compat
      entry_point:     ep,
      script:          scriptText,   // backward compat
      outline:         outlineText,
      beat_map:        result.beat_map        || [],
      missing_beats:   result.missing_beats   || [],
      hook_variations: result.hook_variations || [],
      story_found:     result.story_found     || null,
      anchor_moment:   result.anchor_moment   || null,
      reconciliation:  result.reconciliation  || null,
      gaps_to_capture: result.gaps_to_capture || [],
    });

    end();

  } catch (err) {
    console.error('[WritΩr] generate error:', err.message);
    write({ stage: 'error', error: err.message });
    end();
  }
});

// ─────────────────────────────────────────────
// GET /api/writr/status/:job_id
// SSE stream for generate job
// ─────────────────────────────────────────────

router.get('/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// POST /api/writr/iterate
// Revise a script based on creator feedback
// Body: { project_id, script_id, feedback }
// ─────────────────────────────────────────────

router.post('/iterate', async (req, res) => {
  const { project_id, script_id, feedback, voice_primary, voice_secondary, voice_blend } = req.body;

  const projectId = parseInt(project_id, 10);
  const scriptId  = parseInt(script_id, 10);

  if (!projectId) return res.status(400).json({ error: 'project_id required' });
  if (!scriptId)  return res.status(400).json({ error: 'script_id required' });
  if (!feedback?.trim()) return res.status(400).json({ error: 'feedback required' });

  const existing = db.getWritrScript(scriptId);
  if (!existing) return res.status(404).json({ error: 'Script not found' });

  const { write, end } = startSseResponse(req, res);

  try {
    const currentScript = existing.generated_script || existing.shooting_script || '';
    if (!currentScript) throw new Error('No script text to iterate on');

    // emit helper — filters module 'complete' progress msgs
    const emit = (ev) => { if (ev.stage !== 'complete') write(ev); };

    const voiceProfiles = buildVoiceProfiles(voice_primary, voice_secondary, voice_blend);

    const result = await iterateScript({
      projectId,
      currentScript,
      feedback,
      iterationCount: existing.iteration_count || 0,
      voiceProfiles,
      emit
    });

    const newIterCount = (existing.iteration_count || 0) + 1;

    const newScriptId = db.insertWritrScript({
      project_id:        projectId,
      entry_point:       existing.entry_point,
      input_type:        'iteration',
      raw_input:         feedback,
      generated_script:  result.script,
      beat_map_json:     result.beat_map      || [],
      missing_beats:     result.missing_beats || [],
      iteration_count:   newIterCount,
      story_found:       existing.story_found    || null,
      anchor_moment:     existing.anchor_moment  || null,
      hook_variations:   existing.hook_variations || [],
      mode:              existing.mode            || 'full',
      session_id:        existing.session_id      || null
    });

    // Vault: save iteration
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      vault.saveVaultData(projectId, `writr/iteration-${newIterCount}-${ts}.txt`, result.script);
    } catch (vaultErr) {
      console.warn('[writr/iterate] vault save failed (non-fatal):', vaultErr.message);
    }

    write({
      stage:           'complete',
      script_id:       newScriptId,
      iteration_count: newIterCount,
      script:          result.script,
      mode:            existing.mode || 'full',
      beat_map:        result.beat_map      || [],
      missing_beats:   result.missing_beats || [],
      changes_made:    result.changes_made  || []
    });

    end();

  } catch (err) {
    console.error('[WritΩr] iterate error:', err.message);
    write({ stage: 'error', error: err.message });
    end();
  }
});

// ─────────────────────────────────────────────
// GET /api/writr/iterate/status/:job_id
// SSE stream for iterate job (shares same job store)
// ─────────────────────────────────────────────

router.get('/iterate/status/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  sseStream(job, req, res);
});

// ─────────────────────────────────────────────
// POST /api/writr/:project_id/approve
// Approve a script — syncs to SelectsΩr scripts table
// Body: { script_id }
// ─────────────────────────────────────────────

router.post('/:project_id/approve', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  const scriptId  = parseInt(req.body.script_id, 10);

  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });
  if (!scriptId)  return res.status(400).json({ error: 'script_id required' });

  try {
    const script = db.getWritrScript(scriptId);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    if (script.project_id !== projectId) return res.status(403).json({ error: 'Script does not belong to this project' });

    // approveWritrScript: marks approved, sets active_script_id, syncs to scripts table
    db.approveWritrScript(projectId, scriptId);

    // Vault: save approved script
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const scriptText = script.generated_script || script.shooting_script || '';
      if (scriptText) {
        vault.saveVaultData(projectId, `writr/APPROVED-${ts}.txt`, scriptText);
      }
    } catch (vaultErr) {
      console.warn('[writr/approve] vault save failed (non-fatal):', vaultErr.message);
    }

    console.log(`[WritΩr] Script ${scriptId} approved for project ${projectId} — synced to SelectsΩr`);

    res.json({
      ok:         true,
      script_id:  scriptId,
      project_id: projectId,
      message:    'Script approved. SelectsΩr will use this script as reference.'
    });
  } catch (err) {
    console.error('[WritΩr] approve error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/writr/:project_id/room
// WritΩr's RoΩm — creative director chat with full project context
// Body: { message, history: [{role, content}] }
// Returns: { ok, response }
// ─────────────────────────────────────────────

function buildRoomSystemPrompt(project, projectContext, currentScript) {
  const title = project.title || 'this video';

  let prompt = `You are the creative director for "${title}". You have complete context on this project: the original concept, why it was chosen, the story structure, the beat map, and the current script draft.

Your job is to help work through creative obstacles during script revision. Think out loud. Ask the right questions. Challenge weak story logic. Find what's emotionally true and what isn't landing. Suggest structural moves when the story feels stuck.

Be direct and specific — not cheerleader-y. If something isn't working, say exactly what and why. If you see a solution, name it clearly. Keep responses focused and conversational, not lecture-length.

When you have a specific revision the creator can apply directly to the script, put it on its own line starting with REVISION: so they can use it as a prompt.

${REALITY_RULE}`;

  if (projectContext) {
    prompt += `\n\n${projectContext}`;
  }

  if (currentScript) {
    const truncated = currentScript.length > 4000
      ? currentScript.slice(0, 4000) + '\n[...script continues...]'
      : currentScript;
    prompt += `\n\nCURRENT SCRIPT DRAFT:\n${truncated}`;
  }

  return prompt;
}

router.post('/:project_id/room', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  try {
    const project = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const projectContext = buildWritrPromptContext(projectId);

    let currentScript = '';
    try {
      const scripts = db.getWritrScriptsByProject(projectId);
      if (scripts && scripts.length) {
        const active = project.active_script_id
          ? scripts.find(s => s.id === project.active_script_id) || scripts[0]
          : scripts[0];
        currentScript = active?.generated_script || '';
      }
    } catch (_) {}

    const systemPrompt = buildRoomSystemPrompt(project, projectContext, currentScript);

    // Build messages: last 12 history turns + new message
    const messages = [
      ...history.slice(-12).map(h => ({ role: h.role, content: String(h.content) })),
      { role: 'user', content: message.trim() }
    ];

    const response = await callClaudeMessages(systemPrompt, messages, 2048);
    res.json({ ok: true, response });

  } catch (err) {
    console.error('[WritΩr] Room error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Room Session Persistence — GET / POST / DELETE
// ─────────────────────────────────────────────

router.get('/:project_id/room/session', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });
  try {
    const session = db.getRoomSession(projectId);
    res.json({ ok: true, messages: session?.messages || [] });
  } catch (err) {
    console.error('[WritΩr] Room session GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:project_id/room/session', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  try {
    db.upsertRoomSession(projectId, messages);
    res.json({ ok: true });
  } catch (err) {
    console.error('[WritΩr] Room session POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:project_id/room/session', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });
  try {
    db.clearRoomSession(projectId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[WritΩr] Room session DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/writr/:project_id/room/approve
// Approve a script draft directly from the Room — creates a new writr_scripts
// record from the provided text and marks it approved. No full generate cycle needed.
// Body: { script_text }
// ─────────────────────────────────────────────

router.post('/:project_id/room/approve', async (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  const { script_text } = req.body;
  if (!script_text?.trim()) return res.status(400).json({ error: 'script_text required' });

  try {
    const project = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Create a new script record from the room-revised text
    const scriptId = db.insertWritrScript({
      project_id:       projectId,
      generated_script: script_text.trim(),
      entry_point:      'room_revision',
      input_type:       'room_revision',
      iteration_count:  0,
      approved:         0,
      mode:             'full'
    });

    // Approve it (handles un-approving old, setting active_script_id, syncing to selects)
    db.approveWritrScript(projectId, scriptId);

    res.json({ ok: true, script_id: scriptId });
  } catch (err) {
    console.error('[WritΩr] Room approve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
