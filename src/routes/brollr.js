'use strict';
/**
 * BrollΩr — AI b-roll generation via Higgsfield AI
 *
 * POST /api/brollr/analyze          — analyze script → moment cards
 * POST /api/brollr/vault-search     — search vault footage for matching clips
 * POST /api/brollr/generate         — SSE: generate b-roll via Higgsfield (or demo mode)
 * GET  /api/brollr/history          — list all generations (optional ?project_id=X)
 * DELETE /api/brollr/generation/:id — delete a generation record
 * POST /api/brollr/save-to-vault    — save a generation's result_url into footage table
 * GET  /api/brollr/status           — demo_mode flag
 */

const express           = require('express');
const router            = express.Router();
const { callClaude }    = require('../utils/claude');
const db                = require('../db');
const logger            = require('../utils/logger');
const { startSseResponse } = require('../utils/sse');

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
${scriptText}`;

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
  const { send, end } = startSseResponse(res, { timeoutMs: 5 * 60 * 1000 });

  const {
    moment_label,
    prompt,
    camera_motion = 'handheld',
    style         = 'documentary',
    project_id    = null,
    duration      = 5,
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

  // Live mode — call Higgsfield API via SDK
  try {
    send({ step: 'creating', message: 'Sending to Higgsfield…' });

    const { higgsfield, config } = require('@higgsfield/client/v2');
    config({ credentials: getCredentials() });

    const fullPrompt = `${prompt}. Camera motion: ${camera_motion}. Style: ${style}. Homestead setting, authentic, cinematic. Real outdoor environment.`;

    send({ step: 'processing', message: 'AI is generating your clip… (this takes 1–3 min)' });

    const response = await higgsfield.subscribe('/v1/text2video/wan', {
      input: {
        prompt:   fullPrompt,
        model:    'wan-2.5',
        duration: duration || 5,
      },
      withPolling: true,
    });

    if (response.status === 'nsfw') {
      throw new Error('Content flagged — try a different prompt description');
    }
    if (response.status === 'failed') {
      throw new Error('Higgsfield generation failed: ' + (response.error || 'unknown'));
    }

    const finalUrl = response.results?.raw || response.results?.min || null;

    db.updateBrollGeneration(generationId, {
      status:            finalUrl ? 'done' : 'processing',
      higgsfield_job_id: response.request_id || null,
      result_url:        finalUrl || null,
    });

    send({
      step:          'done',
      generation_id: generationId,
      result_url:    finalUrl,
      status:        finalUrl ? 'done' : 'processing',
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

module.exports = router;
