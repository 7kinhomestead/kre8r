'use strict';
/**
 * BrollΩr — AI b-roll generation via Higgsfield AI
 *
 * POST /api/brollr/analyze                — analyze script → moment cards
 * POST /api/brollr/vault-search           — search vault footage for matching clips
 * POST /api/brollr/generate               — SSE: generate b-roll via Higgsfield (or demo mode)
 * POST /api/brollr/speak                  — SSE: ElevenLabs TTS + Higgsfield lip-sync → talking-head video
 * GET  /api/brollr/history                — list all generations (optional ?project_id=X)
 * DELETE /api/brollr/generation/:id       — delete a generation record
 * POST /api/brollr/save-to-vault          — save a generation's result_url into footage table
 * GET  /api/brollr/status                 — demo_mode flag
 * GET  /api/brollr/characters             — list Soul ID characters
 * POST /api/brollr/characters             — SSE: upload photos + train Soul ID ($3/character)
 * PATCH /api/brollr/characters/:id        — update character notes
 * DELETE /api/brollr/characters/:id       — delete a character record
 */

const express              = require('express');
const router               = express.Router();
const multer               = require('multer');
const path                 = require('path');
const fs                   = require('fs');
const { callClaude }       = require('../utils/claude');
const db                   = require('../db');
const logger               = require('../utils/logger');
const { startSseResponse } = require('../utils/sse');

// Multer — store character photos in memory for upload to Higgsfield
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024, files: 25 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG/PNG/WebP images allowed'));
  },
});

// ─────────────────────────────────────────────
// HIGGSFIELD CLIENT
// Credentials = KEY_ID:KEY_SECRET combined string
// ─────────────────────────────────────────────
function getCredentials() {
  const key    = process.env.HIGGSFIELD_API_KEY;
  const secret = process.env.HIGGSFIELD_API_SECRET;
  if (!key) return null;
  return secret ? `${key}:${secret}` : key;
}

function isDemoMode() {
  return !getCredentials();
}

// ─────────────────────────────────────────────
// GET /api/brollr/status
// ─────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ demo_mode: isDemoMode() });
});

// ─────────────────────────────────────────────
// POST /api/brollr/analyze
// Body: { project_id?, script_text? }
// ─────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  try {
    const { project_id, script_text } = req.body || {};

    let scriptText = script_text || '';

    // If project_id given, try to load script from DB
    if (project_id && !scriptText) {
      try {
        const project = db.getProject(parseInt(project_id));
        if (project) {
          // Grab the active script if available
          if (project.active_script_id) {
            const script = db.prepare('SELECT * FROM writr_scripts WHERE id = ?').get(project.active_script_id);
            if (script) {
              scriptText = script.generated_script || script.generated_outline || script.raw_input || '';
            }
          }
          // Fall back to project title + concept
          if (!scriptText) {
            scriptText = [project.title, project.concept, project.high_concept].filter(Boolean).join('\n\n');
          }
        }
      } catch (dbErr) {
        logger.warn({ module: 'brollr', err: dbErr.message }, 'Could not load project for analyze');
      }
    }

    if (!scriptText || scriptText.trim().length < 10) {
      return res.status(400).json({ error: 'script_text or project_id with a script is required' });
    }

    // ── EditΩr Room context injection ──────────────────────────────────────
    // If the editor was working in EditΩr Room, pull the beat map + assembly
    // context so BrollΩr suggestions serve the narrative, not just look cool.
    let editorContext = '';
    if (project_id) {
      try {
        const { readConfig } = require('../pipr/beat-tracker');
        const piprConfig = readConfig(parseInt(project_id));
        const selects    = db.getSelectsByProject(parseInt(project_id));
        const editrKey   = `editr_room_session_${project_id}`;
        const editrSession = db.getKv(editrKey);

        if (piprConfig?.beats?.length > 0) {
          editorContext += '\n\nEDIT CONTEXT (from AssemblΩr):\n';
          for (let i = 0; i < piprConfig.beats.length; i++) {
            const b   = piprConfig.beats[i];
            const sel = selects.find(s => s.section_index === i);
            editorContext += `Beat ${i + 1}: "${b.name}" (${b.emotional_function || ''})`;
            if (sel?.assembly_note) editorContext += ` — editor note: "${sel.assembly_note}"`;
            editorContext += '\n';
          }
        }
        if (editrSession?.messages?.length > 0) {
          const recent = editrSession.messages.slice(-4);
          editorContext += '\nRECENT EDITΩR ROOM CONVERSATION (context for b-roll ideas):\n';
          for (const m of recent) {
            editorContext += `${m.role === 'user' ? 'Creator' : 'Editor'}: ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}\n`;
          }
        }
      } catch (_) {}
    }

    const prompt = `You are BrollΩr, a b-roll planning AI for a homesteading creator (7 Kin Homestead — off-grid, financial freedom, rock-solid resourcefulness).

Analyze this script/content and identify the key moments that need b-roll coverage. For each moment:
- What visual would reinforce or contrast the spoken content?
- What camera motion would work best (options: dolly-in, dolly-out, pan-left, pan-right, crane-up, crane-down, orbit, fpv-drone, handheld, hyperlapse, static)?
- What visual style fits (options: cinematic, documentary, dramatic, golden-hour, moody, handheld-realism)?
- What search terms would find matching footage in a vault of homestead clips?

Return ONLY valid JSON:
{
  "moments": [
    {
      "label": "Short label for this moment",
      "description": "What visual to generate — specific, cinematic, grounded in homestead reality",
      "suggested_camera_motion": "dolly-in",
      "suggested_style": "documentary",
      "vault_search_terms": ["fence", "land", "outdoor"]
    }
  ]
}

Script/content:
${scriptText}${editorContext}`;

    // VisualΩr — inject visual intelligence into b-roll moment analysis
    try {
      const visRaw = require('../db').getKv('visual_intelligence_profile');
      if (visRaw) {
        const vis = JSON.parse(visRaw);
        if (vis?.brollr_style_note || vis?.broll_shot_directives?.length) {
          prompt += '\n\n## VISUAL INTELLIGENCE (from channel performance analysis — let this shape your suggestions)';
          if (vis.brollr_style_note)            prompt += `\n${vis.brollr_style_note}`;
          if (vis.broll_shot_directives?.length) prompt += `\nProven shot types: ${vis.broll_shot_directives.slice(0, 3).join(' | ')}`;
          if (vis.avoid?.length)                prompt += `\nAvoid: ${vis.avoid.slice(0, 2).join(' | ')}`;
        }
      }
    } catch (_) {}

    const result = await callClaude(prompt, 4096, { tool: 'brollr-analyze' });

    const moments = result?.moments || [];
    res.json({ ok: true, moments });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'analyze failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/vault-search
// Body: { terms[], project_id? }
// ─────────────────────────────────────────────
router.post('/vault-search', (req, res) => {
  try {
    const { terms = [], project_id } = req.body || {};

    if (!Array.isArray(terms) || terms.length === 0) {
      return res.json({ clips: [] });
    }

    // Build query words from the terms array
    const queryWords = terms
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);

    // Pull all b-roll/action footage from the vault
    const allFootage = db.getAllFootage();
    const brollFootage = allFootage.filter(f => {
      const t = (f.shot_type || '').toLowerCase();
      return t.startsWith('b_roll') || t.startsWith('b-roll') || t === 'action';
    });

    // Score each clip
    function scoreClip(clip) {
      if (!queryWords.length) return 50;
      let score = 0;
      const subjects = (() => {
        try { return JSON.parse(clip.subjects || '[]'); } catch { return []; }
      })();
      const desc = (clip.description || '').toLowerCase();
      const subjectText = subjects.join(' ').toLowerCase();
      const combined = `${subjectText} ${desc}`;

      for (const word of queryWords) {
        if (word.length < 3) continue;
        if (subjects.some(s => s.toLowerCase().includes(word))) score += 25;
        else if (combined.includes(word)) score += 10;
      }
      return Math.min(score, 100);
    }

    const pid = project_id ? parseInt(project_id) : null;

    const results = brollFootage
      .map(f => ({
        id:           f.id,
        file_path:    f.proxy_path || f.organized_path || f.file_path,
        proxy_path:   f.proxy_path || null,
        shot_type:    f.shot_type,
        description:  f.description || null,
        subjects:     (() => { try { return JSON.parse(f.subjects || '[]'); } catch { return []; } })(),
        thumbnail_path: f.thumbnail_path || null,
        score:        scoreClip(f),
        same_project: pid && f.project_id === pid,
      }))
      .filter(f => f.score > 0)
      .sort((a, b) => {
        if (a.same_project !== b.same_project) return a.same_project ? -1 : 1;
        return b.score - a.score;
      })
      .slice(0, 5);

    res.json({ clips: results });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'vault-search failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/generate (SSE)
// Body: { moment_label, prompt, camera_motion, style, project_id?, duration? }
// ─────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 10 * 60 * 1000 });

  const {
    moment_label,
    prompt,
    camera_motion = 'handheld',
    style         = 'documentary',
    project_id    = null,
    duration      = 5,
    soul_id       = null,
  } = req.body || {};

  if (!moment_label || !prompt) {
    send({ step: 'error', error: 'moment_label and prompt are required' });
    end();
    return;
  }

  // Create DB record
  let generationId;
  try {
    generationId = db.createBrollGeneration({
      project_id:   project_id ? parseInt(project_id) : null,
      moment_label,
      prompt,
      camera_motion,
      style,
      status:       'generating',
      duration_s:   duration,
    });
  } catch (dbErr) {
    logger.error({ module: 'brollr', err: dbErr.message }, 'Failed to create generation record');
    send({ step: 'error', error: 'Database error: ' + dbErr.message });
    end();
    return;
  }

  if (isDemoMode()) {
    // Demo mode — emit progress without hitting any external API
    send({ step: 'creating', message: 'Demo mode — HIGGSFIELD_API_KEY not set. Simulating generation…' });

    await new Promise(r => setTimeout(r, 800));
    send({ step: 'processing', message: 'AI is generating your clip… (demo)' });

    await new Promise(r => setTimeout(r, 1200));

    try {
      db.updateBrollGeneration(generationId, { status: 'demo' });
    } catch (_) {}

    send({
      step:           'demo',
      generation_id:  generationId,
      status:         'demo',
      message:        'Add HIGGSFIELD_API_KEY to .env to generate real clips. Sign up at higgsfield.ai',
    });
    end();
    return;
  }

  // Live mode — two-step pipeline: text→image (soul) → image→video (dop)
  try {
    const axios = require('axios');
    const [apiKey, apiSecret] = getCredentials().split(':');
    const hfHeaders = { Authorization: `Key ${apiKey}:${apiSecret}`, 'Content-Type': 'application/json' };

    // Look up character appearance notes if soul_id provided
    let charNotes = '';
    if (soul_id) {
      try {
        const char = db.prepare('SELECT notes FROM brollr_characters WHERE soul_id = ?').get(soul_id);
        if (char?.notes) charNotes = char.notes.trim();
      } catch (_) {}
    }

    const notesClause = charNotes ? ` ${charNotes}.` : '';

    // VisualΩr — append style note to generation prompts
    let visualStyleNote = '';
    try {
      const visRaw = require('../db').getKv('visual_intelligence_profile');
      if (visRaw) {
        const vis = JSON.parse(visRaw);
        if (vis?.brollr_style_note) visualStyleNote = ' ' + vis.brollr_style_note;
      }
    } catch (_) {}

    const imagePrompt = `${prompt}.${notesClause} Style: ${style}. Homestead setting, authentic, cinematic. Real outdoor environment.${visualStyleNote}`;
    const videoPrompt = `${camera_motion} camera movement. ${prompt}. ${style} style.${visualStyleNote}`;

    // ── STEP 1: Generate still image ─────────────────────────
    send({ step: 'creating', message: 'Step 1/2 — Generating image with Higgsfield Soul…' });

    const imageParams = {
      prompt:           imagePrompt,
      width_and_height: '2048x1152',
    };
    if (soul_id) {
      imageParams.custom_reference_id       = soul_id;
      imageParams.custom_reference_strength = 1;
    }

    const imgResp = await axios.post(
      'https://platform.higgsfield.ai/v1/text2image/soul',
      { params: imageParams },
      { headers: hfHeaders }
    );

    const imgJobSetId = imgResp.data?.id;
    if (!imgJobSetId) throw new Error('No job ID returned from Higgsfield image step');

    // Poll image to completion
    let imageUrl = null;
    const imgPollStart = Date.now();
    while (Date.now() - imgPollStart < 8 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 4000));
      const pollResp = await axios.get(
        `https://platform.higgsfield.ai/requests/${imgJobSetId}/status`,
        { headers: hfHeaders }
      );
      const d = pollResp.data;
      if (d.status === 'nsfw')      throw new Error('Image flagged — try a different prompt');
      if (d.status === 'failed')    throw new Error('Image generation failed');
      if (d.status === 'completed') { imageUrl = d.images?.[0]?.url; break; }
    }
    if (!imageUrl) throw new Error('Image generation timed out');

    // ── Step 1 done — send image to frontend for review ──────
    db.updateBrollGeneration(generationId, {
      status:            'image_ready',
      higgsfield_job_id: imgJobSetId,
      result_url:        imageUrl,
    });

    send({
      step:          'image_ready',
      generation_id: generationId,
      image_url:     imageUrl,
      message:       'Image ready — review and click Animate to Video',
    });
    end();
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'Higgsfield generate failed');
    try { db.updateBrollGeneration(generationId, { status: 'failed' }); } catch (_) {}
    send({ step: 'error', error: err.message, generation_id: generationId });
    end();
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/animate (SSE)
// Body: { generation_id, image_url, camera_motion, style, moment_label, soul_id? }
// Step 2: animate an approved still image to video
// ─────────────────────────────────────────────
router.post('/animate', async (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 12 * 60 * 1000 });

  const {
    generation_id,
    image_url,
    camera_motion = 'handheld',
    style         = 'documentary',
    moment_label  = '',
    soul_id       = null,
  } = req.body || {};

  if (!generation_id || !image_url) {
    send({ step: 'error', error: 'generation_id and image_url are required' });
    end(); return;
  }

  try {
    send({ step: 'processing', message: 'Animating to video… (1–3 min)' });

    const axios = require('axios');
    const [apiKey, apiSecret] = getCredentials().split(':');
    const hfHeaders = { Authorization: `Key ${apiKey}:${apiSecret}`, 'Content-Type': 'application/json' };

    const videoPrompt = `${camera_motion} camera movement. ${moment_label}. ${style} style. Homestead setting, cinematic.`;

    const vidResp = await axios.post(
      'https://platform.higgsfield.ai/v1/image2video/dop',
      { params: {
        model:        'dop-turbo',
        prompt:       videoPrompt,
        input_images: [{ type: 'image_url', image_url }],
      }},
      { headers: hfHeaders }
    );

    const vidJobSetId = vidResp.data?.id;
    if (!vidJobSetId) throw new Error('No job ID returned from Higgsfield');

    // Poll to completion — video gen can take 7-10 min
    let finalUrl = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 5000));
      const pollResp = await axios.get(
        `https://platform.higgsfield.ai/requests/${vidJobSetId}/status`,
        { headers: hfHeaders }
      );
      const d = pollResp.data;
      if (d.status === 'nsfw')      throw new Error('Video flagged — try a different prompt');
      if (d.status === 'failed')    throw new Error('Video generation failed');
      if (d.status === 'completed') { finalUrl = d.video?.url || d.images?.[0]?.url; break; }
    }
    if (!finalUrl) throw new Error('Video generation timed out');

    db.updateBrollGeneration(parseInt(generation_id), {
      status:     'done',
      result_url: finalUrl,
    });

    send({ step: 'done', generation_id, result_url: finalUrl });
    end();
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'animate failed');
    try { db.updateBrollGeneration(parseInt(generation_id), { status: 'failed' }); } catch (_) {}
    send({ step: 'error', error: err.message });
    end();
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/speak (SSE)
// Body: { script_text, image_url, project_id?, voice_id? }
// Pipeline:
//   1. ElevenLabs TTS → temp .mp3 file
//   2. ngrok tunnel so Higgsfield can fetch the audio
//   3. Higgsfield /v1/speak/higgsfield (input_image + input_audio → lip-sync video)
//   4. Poll to completion, save result to brollr_generations
// ─────────────────────────────────────────────
router.post('/speak', async (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 15 * 60 * 1000 });

  const {
    script_text,
    image_url,
    project_id = null,
    voice_id   = null,
  } = req.body || {};

  if (!script_text || !script_text.trim()) {
    send({ step: 'error', error: 'script_text is required' });
    end(); return;
  }
  if (!image_url || !image_url.trim()) {
    send({ step: 'error', error: 'image_url is required' });
    end(); return;
  }

  const elKey     = process.env.ELEVENLABS_API_KEY;
  const elVoiceId = voice_id || process.env.ELEVENLABS_VOICE_ID;

  if (!elKey) {
    send({ step: 'error', error: 'ELEVENLABS_API_KEY not set in .env' });
    end(); return;
  }
  if (!elVoiceId) {
    send({ step: 'error', error: 'ELEVENLABS_VOICE_ID not set in .env (or pass voice_id in body)' });
    end(); return;
  }
  if (isDemoMode()) {
    send({ step: 'error', error: 'HIGGSFIELD_API_KEY not configured — add to .env' });
    end(); return;
  }

  // Create DB record
  const generationId = db.createBrollGeneration({
    project_id:   project_id ? parseInt(project_id) : null,
    moment_label: '🎙 Speak',
    prompt:       script_text.slice(0, 500),
    camera_motion: 'static',
    style:        'speaking',
    status:       'creating',
  });

  // Tag as speak type — safe even if column migration not yet applied to Electron AppData DB
  try { db.updateBrollGeneration(generationId, { generation_type: 'speak' }); } catch (_) {}

  send({ step: 'creating', generation_id: generationId, message: 'Step 1/2 — Generating voice audio with ElevenLabs…' });

  const os       = require('os');
  const tmpAudio = path.join(os.tmpdir(), `kre8r-speak-${generationId}.mp3`);
  let tunnelCleanup = null;

  try {
    const axios = require('axios');

    // ── STEP 1: ElevenLabs TTS ────────────────────────────────────────
    const elResp = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${elVoiceId}`,
      {
        text:     script_text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability:         0.5,
          similarity_boost:  0.75,
          style:             0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key':   elKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        responseType: 'arraybuffer',
      }
    );

    fs.writeFileSync(tmpAudio, Buffer.from(elResp.data));
    send({ step: 'audio_ready', generation_id: generationId, message: 'Audio generated — Step 2/2: Creating lip-sync video…' });

    // ── STEP 2: Tunnel the audio so Higgsfield can fetch it ──────────
    const { createFileTunnel } = require('../postor/video-tunnel');
    const tunnel = await createFileTunnel(tmpAudio);
    tunnelCleanup = tunnel.cleanup;

    // ── STEP 3: Higgsfield Speak ─────────────────────────────────────
    const [apiKey, apiSecret] = getCredentials().split(':');
    const hfHeaders = { Authorization: `Key ${apiKey}:${apiSecret}`, 'Content-Type': 'application/json' };

    const speakResp = await axios.post(
      'https://platform.higgsfield.ai/v1/speak/higgsfield',
      {
        params: {
          input_image: { type: 'image_url', image_url: image_url.trim() },
          input_audio: { type: 'audio_url', audio_url: tunnel.url },
          prompt:      'Natural talking head delivery, authentic expression, cinematic',
        },
      },
      { headers: hfHeaders }
    );

    const speakJobId = speakResp.data?.id;
    if (!speakJobId) throw new Error('No job ID returned from Higgsfield speak');

    db.updateBrollGeneration(generationId, { higgsfield_job_id: speakJobId, status: 'processing' });
    send({ step: 'processing', generation_id: generationId, message: 'Lip-sync in progress… (1–3 min)' });

    // ── STEP 4: Poll until done ───────────────────────────────────────
    let finalUrl = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 8 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 4000));
      const pollResp = await axios.get(
        `https://platform.higgsfield.ai/requests/${speakJobId}/status`,
        { headers: hfHeaders }
      );
      const d = pollResp.data;
      if (d.status === 'nsfw')      throw new Error('Content flagged — try a different image or script');
      if (d.status === 'failed')    throw new Error('Higgsfield speak generation failed');
      if (d.status === 'completed') { finalUrl = d.video?.url || d.images?.[0]?.url; break; }
    }
    if (!finalUrl) throw new Error('Speak generation timed out');

    db.updateBrollGeneration(generationId, { status: 'done', result_url: finalUrl });
    send({ step: 'done', generation_id: generationId, result_url: finalUrl });
    end();

  } catch (err) {
    logger.error({ module: 'brollr/speak', err: err.message }, 'speak failed');
    try { db.updateBrollGeneration(generationId, { status: 'failed' }); } catch (_) {}
    send({ step: 'error', error: err.message, generation_id: generationId });
    end();
  } finally {
    if (tunnelCleanup) { try { await tunnelCleanup(); } catch (_) {} }
    try { fs.unlinkSync(tmpAudio); } catch (_) {}
  }
});

// ─────────────────────────────────────────────
// GET /api/brollr/history
// Query: ?project_id=X (optional)
// ─────────────────────────────────────────────
router.get('/history', (req, res) => {
  try {
    const { project_id } = req.query;
    const generations = db.getBrollGenerations(project_id ? parseInt(project_id) : null);
    res.json({ generations });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'history fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/brollr/generation/:id
// ─────────────────────────────────────────────
router.delete('/generation/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    db.deleteBrollGeneration(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'delete generation failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/save-to-vault
// Body: { generation_id }
// ─────────────────────────────────────────────
router.post('/save-to-vault', (req, res) => {
  try {
    const { generation_id } = req.body || {};
    if (!generation_id) return res.status(400).json({ error: 'generation_id required' });

    const gen = db.prepare('SELECT * FROM brollr_generations WHERE id = ?').get(parseInt(generation_id));
    if (!gen) return res.status(404).json({ error: 'Generation not found' });
    if (!gen.result_url) return res.status(400).json({ error: 'No result_url on this generation — cannot save to vault' });

    const footageId = db.insertFootage({
      file_path:    gen.result_url,
      proxy_path:   gen.result_url,
      shot_type:    'b-roll',
      source:       'ai_generated',
      description:  gen.prompt,
      project_id:   gen.project_id || null,
      quality_flag: 'approved',
    });

    db.updateBrollGeneration(gen.id, { footage_id: footageId });

    res.json({ ok: true, footage_id: footageId });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'save-to-vault failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/brollr/characters/higgsfield-list
// Fetch trained Soul IDs from Higgsfield account
// ─────────────────────────────────────────────
router.get('/characters/higgsfield-list', async (req, res) => {
  if (isDemoMode()) return res.status(400).json({ error: 'No Higgsfield credentials configured' });
  try {
    const axios = require('axios');
    const [apiKey, apiSecret] = getCredentials().split(':');
    const response = await axios.get('https://platform.higgsfield.ai/v1/custom-references', {
      headers: { Authorization: `Key ${apiKey}:${apiSecret}` },
      params: { limit: 50 },
    });
    const rawItems = response.data?.items || response.data?.data || response.data || [];
    const itemsArray = Array.isArray(rawItems) ? rawItems : [];
    const items = itemsArray.map(s => ({
      id:     s.id   || s.soul_id || s.reference_id,
      name:   s.name || s.label  || 'Unnamed',
      status: s.status || 'unknown',
    }));
    res.json({ ok: true, items });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'higgsfield-list failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/characters/import
// Body: { name, soul_id, notes? }
// Save an existing Higgsfield Soul ID without training
// ─────────────────────────────────────────────
router.post('/characters/import', (req, res) => {
  try {
    const { name, soul_id, notes } = req.body || {};
    if (!name)    return res.status(400).json({ error: 'name is required' });
    if (!soul_id) return res.status(400).json({ error: 'soul_id is required' });
    const id = db.createBrollCharacter({ name, soul_id, status: 'ready', photo_count: 0, notes: notes || null });
    res.json({ ok: true, id });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'import character failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/brollr/characters
// ─────────────────────────────────────────────
router.get('/characters', (req, res) => {
  try {
    res.json({ characters: db.getBrollCharacters() });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'list characters failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/brollr/characters (SSE)
// Multipart: name + up to 25 photos
// Trains a Higgsfield Soul ID ($3/character)
// ─────────────────────────────────────────────
router.post('/characters', upload.array('photos', 25), async (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 25 * 60 * 1000 });

  const name   = (req.body?.name  || '').trim();
  const notes  = (req.body?.notes || '').trim();
  const files  = req.files || [];

  if (!name) {
    send({ step: 'error', error: 'Character name is required' });
    end(); return;
  }
  if (files.length < 5) {
    send({ step: 'error', error: `Upload at least 5 photos (you sent ${files.length}). 15–20 recommended for best results.` });
    end(); return;
  }
  if (isDemoMode()) {
    send({ step: 'error', error: 'Add HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET to .env first' });
    end(); return;
  }

  // Create DB record immediately
  let charId;
  try {
    charId = db.createBrollCharacter({ name, status: 'training', photo_count: files.length, notes: notes || null });
  } catch (dbErr) {
    send({ step: 'error', error: 'DB error: ' + dbErr.message }); end(); return;
  }

  try {
    // Soul ID training uses the v1 HiggsfieldClient — it has uploadImage() + createSoulId()
    // The v2 client only has subscribe() for video generation
    const { HiggsfieldClient } = require('@higgsfield/client');
    const [apiKey, apiSecret] = getCredentials().split(':');
    // Soul ID training can queue for 10+ min then train for 3-5 min — give it 25 min total
    const client = new HiggsfieldClient({ apiKey, apiSecret, maxPollTime: 25 * 60 * 1000, pollInterval: 8000 });

    send({ step: 'uploading', message: `Uploading ${files.length} photos to Higgsfield…` });

    // Upload each photo to Higgsfield CDN to get hosted URLs
    const inputImages = [];
    for (let i = 0; i < files.length; i++) {
      send({ step: 'uploading', message: `Uploading photo ${i + 1} of ${files.length}…`, index: i });
      try {
        const ext    = (files[i].originalname.split('.').pop() || 'jpg').toLowerCase();
        const format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
        const url    = await client.uploadImage(files[i].buffer, format);
        inputImages.push({ type: 'image_url', image_url: url });
      } catch (uploadErr) {
        logger.warn({ module: 'brollr', err: uploadErr.message }, `Photo ${i + 1} upload failed — skipping`);
      }
    }

    if (inputImages.length < 5) {
      throw new Error(`Only ${inputImages.length} photos uploaded successfully — need at least 5`);
    }

    send({ step: 'training', message: `Training Soul ID on ${inputImages.length} photos… queuing (may wait 10 min before training starts)` });

    // Emit periodic heartbeats so the frontend doesn't look frozen during the queue
    let heartbeatMin = 0;
    const heartbeat = setInterval(() => {
      heartbeatMin++;
      send({ step: 'training', message: `Training in progress… ${heartbeatMin} min elapsed (queue + training can take 15 min total)` });
    }, 60 * 1000);

    let soulIdObj;
    try {
      soulIdObj = await client.createSoulId({ name, input_images: inputImages }, true);
    } finally {
      clearInterval(heartbeat);
    }
    const soulIdValue = soulIdObj?.id || (typeof soulIdObj === 'string' ? soulIdObj : JSON.stringify(soulIdObj));

    db.updateBrollCharacter(charId, {
      status:  'ready',
      soul_id: soulIdValue,
    });

    send({
      step:         'done',
      character_id: charId,
      soul_id:      soulIdValue,
      message:      `Soul ID trained! "${name}" is ready to use in b-roll generation.`,
    });
    end();
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'Soul ID training failed');
    try { db.updateBrollCharacter(charId, { status: 'failed' }); } catch (_) {}
    send({ step: 'error', error: err.message, character_id: charId });
    end();
  }
});

// ─────────────────────────────────────────────
// PATCH /api/brollr/characters/:id
// Body: { notes }
// ─────────────────────────────────────────────
router.patch('/characters/:id', (req, res) => {
  try {
    const id    = parseInt(req.params.id);
    const notes = (req.body?.notes ?? '').trim();
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    db.updateBrollCharacter(id, { notes: notes || null });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'patch character failed');
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/brollr/characters/:id
// ─────────────────────────────────────────────
router.delete('/characters/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    db.deleteBrollCharacter(id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ module: 'brollr', err: err.message }, 'delete character failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
