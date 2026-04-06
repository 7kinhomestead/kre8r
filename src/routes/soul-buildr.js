/**
 * Soul BuildΩr — src/routes/soul-buildr.js
 *
 * GET  /api/soul-buildr/status                     — detect first-run vs update mode
 * POST /api/soul-buildr/generate                   — SSE: generate creator-profile.json from wizard data
 * PATCH /api/soul-buildr/update-section            — update a specific section of creator-profile.json
 * GET  /api/soul-buildr/collaborators              — list all collaborator soul files
 * GET  /api/soul-buildr/collaborator/:slug         — read one collaborator profile
 * POST /api/soul-buildr/collaborator/generate      — SSE: generate collaborator profile (3-screen wizard)
 * POST /api/soul-buildr/collaborator/import        — save uploaded .kre8r JSON as collaborator profile
 * POST /api/soul-buildr/primary/import             — overwrite creator-profile.json from .kre8r file
 * GET  /api/soul-buildr/export                     — download primary soul as .kre8r
 * GET  /api/soul-buildr/collaborator/:slug/export  — download collaborator soul as .kre8r
 */

'use strict';

const express      = require('express');
const router       = express.Router();
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { execSync } = require('child_process');
const multer       = require('multer');
const { callClaude } = require('../utils/claude');

// In Electron mode CREATOR_PROFILE_PATH env var points to AppData.
const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH
  || path.join(__dirname, '../../creator-profile.json');
const ROOT_PATH    = path.join(__dirname, '../../');

// ─── Multer: voice clip uploads ───────────────────────────────────────────────
const voiceUpload = multer({
  dest: os.tmpdir(),
  limits: { files: 6, fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Accept audio/video formats for voice analysis, plus .kre8r/.json for soul imports
    cb(null, /\.(mp4|mov|m4a|mp3|wav|webm|ogg|aac|flac|kre8r|json)$/i.test(file.originalname));
  },
});

function readProfile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

// ─── GET /status ──────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  try {
    const profile = readProfile();
    if (!profile) {
      return res.json({ exists: false, last_updated: null, creator_name: null,
        has_voice_samples: false, has_audience: false, has_content_angles: false });
    }
    // voice_words: handle both wizard schema (tone_descriptors) and hand-built schema (traits / summary)
    const v = profile.voice || {};
    let voiceWords = null;
    if (v.tone_descriptors?.length)         voiceWords = v.tone_descriptors.slice(0, 3).join(', ');
    else if (v.voice_in_3_words?.length)    voiceWords = v.voice_in_3_words.slice(0, 3).join(', ');
    else if (v.traits?.length)              voiceWords = v.traits.slice(0, 3).map(t => t.split(/[—–]/)[0].trim()).join(', ');
    else if (v.summary)                     voiceWords = v.summary.split('.')[0].trim().slice(0, 60);

    // avatar_name: wizard schema vs hand-built (may not exist)
    const avatarName = profile.audience?.avatar_name
      || profile.audience?.avatar
      || null;

    res.json({
      exists:             true,
      last_updated:       profile.meta?.created_at || profile.meta?.updated_at || null,
      creator_name:       profile.creator?.name   || null,
      channel_name:       profile.creator?.channel || profile.creator?.brand || null,
      voice_words:        voiceWords,
      avatar_name:        avatarName,
      content_angles:     Array.isArray(profile.content_angles)
        ? profile.content_angles.map(a => a.name || a)
        : Object.values(profile.content_angles || {}).map(a => a.label || a.name || '').filter(Boolean),
      has_voice_samples:  !!(v.writing_style || v.writing_guidelines || v.summary),
      has_audience:       !!(avatarName || profile.audience?.situation),
      has_content_angles: !!(profile.content_angles && Object.keys(profile.content_angles).length),
      content_intelligence: profile.content_intelligence || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /generate (SSE) ─────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  function sse(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  try {
    const data = req.body;

    sse({ type: 'status', message: '✦ Reading your voice samples...' });
    await new Promise(r => setTimeout(r, 600));

    sse({ type: 'status', message: '✦ Analyzing your audience profile...' });
    await new Promise(r => setTimeout(r, 500));

    sse({ type: 'status', message: '✦ Mapping your content angles...' });
    await new Promise(r => setTimeout(r, 500));

    sse({ type: 'status', message: '✦ Synthesizing your creative identity...' });

    // Build prompt
    const writingSamples = [data.sample1, data.sample2, data.sample3]
      .filter(Boolean).map((s, i) => `Sample ${i+1}:\n${s}`).join('\n\n');

    const voiceBoxes = (data.voice_checkboxes || []).join(', ') || 'not specified';

    const platforms = [
      data.youtube   ? `YouTube: ${data.youtube}`     : '',
      data.tiktok    ? `TikTok: ${data.tiktok}`       : '',
      data.instagram ? `Instagram: ${data.instagram}` : '',
      data.lemon8    ? `Lemon8: ${data.lemon8}`       : '',
      data.facebook  ? `Facebook: ${data.facebook}`   : '',
    ].filter(Boolean).join('\n');

    const bestVideos = (data.best_videos || [])
      .filter(v => v.url || v.title)
      .map((v, i) => `${i+1}. ${v.title || ''}${v.url ? ' (' + v.url + ')' : ''}`)
      .join('\n') || 'not provided';

    const prompt = `You are building a complete creator profile for a content creator.
Generate a creator-profile.json that will power an AI content production system.
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.

CREATOR DATA:
Name: ${data.creator_name || 'Unknown'}
Channel: ${data.channel_name || ''}
Handle: ${data.handle || ''}
Tagline: ${data.tagline || ''}
Creating for: ${data.years_creating || 'unknown'}
Full time: ${data.full_time || 'unknown'}
Transformation documenting: ${data.transformation || ''}

VOICE SAMPLES:
${writingSamples || 'No writing samples provided.'}

VOICE DESCRIPTORS: ${voiceBoxes}
Tone (1=casual, 10=professional): ${data.tone_slider || '5'}
Never says: ${data.never_say || 'not specified'}

AUDIENCE:
Age range: ${data.audience_age || 'unknown'}
Their situation: ${data.audience_situation || ''}
What they believe: ${data.audience_belief || ''}
What they fear: ${data.audience_fear || ''}
Transformation you give them: ${data.audience_transformation || ''}
What they say in comments: ${data.comment_patterns || ''}

CONTENT:
Best performing videos:
${bestVideos}
Content angles: ${data.content_angles_text || ''}
Content pillars: ${(data.content_pillars || []).join(', ')}
Contrarian take: ${data.contrarian_take || ''}

SETUP:
${platforms}
Editor: ${data.editor || 'DaVinci Resolve'}
Footage path: ${data.footage_path || ''}
Community platform: ${data.community_platform || 'None'}
Community URL: ${data.community_url || ''}
Email platform: ${data.email_platform || 'None'}
Publishing cadence: ${data.cadence || 'Weekly'}

Generate a complete creator-profile.json with ALL of these sections:

{
  "creator": {
    "name": "...",
    "channel": "...",
    "handle": "...",
    "tagline": "...",
    "transformation": "...",
    "years_creating": "...",
    "full_time": true/false
  },
  "voice": {
    "tone_descriptors": ["...", "...", "..."],
    "never_say": ["...", "..."],
    "writing_style": "paragraph description of their voice",
    "sentence_patterns": "short/punchy or long/flowing, use of rhetorical questions, etc.",
    "humor_style": "self-deprecating/observational/dry/none",
    "authority_markers": "personal experience/data/story",
    "avg_sentence_length": "short/medium/long",
    "use_of_numbers": "high/low",
    "signature_phrases": ["...", "..."]
  },
  "audience": {
    "avatar_name": "A short invented name for this reader archetype, e.g. The Fence-Sitter",
    "age_range": "...",
    "situation": "...",
    "beliefs": ["...", "..."],
    "fears": ["...", "..."],
    "transformation": "...",
    "comment_patterns": ["...", "..."]
  },
  "content_angles": [
    {
      "name": "...",
      "description": "...",
      "hook_formula": "...",
      "tag": "financial|system|howto|mistakes|lifestyle|viral|rockrich|other"
    }
  ],
  "contrarian_take": "...",
  "platforms": {
    "youtube": "...",
    "tiktok": "...",
    "instagram": "...",
    "lemon8": "...",
    "facebook": "..."
  },
  "setup": {
    "editor": "...",
    "footage_path": "...",
    "community_platform": "...",
    "community_url": "...",
    "email_platform": "..."
  },
  "publishing": {
    "cadence": "..."
  },
  "meta": {
    "created_at": "${new Date().toISOString()}",
    "version": "1.0",
    "soul_builder_version": "1.0"
  }
}

For voice analysis from writing samples, carefully identify sentence length, humor, authority style, and any signature phrases or patterns. Invent a vivid audience avatar name based on their actual situation. Generate 5-8 content angles with specific hook formulas. Make everything specific — not generic creator advice.`;

    sse({ type: 'status', message: '✦ Writing your soul file...' });

    // Direct Claude API call (raw — we need full text, not JSON parse via callClaude)
    const { default: fetch } = await import('node-fetch');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const e = await claudeRes.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Claude API error ${claudeRes.status}`);
    }

    const claudeData = await claudeRes.json();
    let raw = claudeData.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let profile;
    try {
      profile = JSON.parse(raw);
    } catch (parseErr) {
      // Try to find JSON object in response
      const start = raw.indexOf('{');
      const end   = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        profile = JSON.parse(raw.slice(start, end + 1));
      } else {
        throw new Error('Claude returned malformed JSON: ' + parseErr.message);
      }
    }

    // Ensure meta
    if (!profile.meta) profile.meta = {};
    profile.meta.created_at          = new Date().toISOString();
    profile.meta.soul_builder_version = '1.0';

    // Preserve existing content_intelligence if present
    const existing = readProfile();
    if (existing?.content_intelligence) {
      profile.content_intelligence = existing.content_intelligence;
    }

    // Write to disk
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');

    // Build preview
    const preview = {
      niche_sentence:  profile.contrarian_take || profile.creator?.transformation || '',
      voice_words:     (profile.voice?.tone_descriptors || []).slice(0, 3).join(', '),
      avatar_name:     profile.audience?.avatar_name || '',
      content_angles:  (profile.content_angles || []).slice(0, 5).map(a => a.name || a),
    };

    sse({ type: 'done', preview });

  } catch (err) {
    res.write('data: ' + JSON.stringify({ type: 'error', message: err.message }) + '\n\n');
  } finally {
    res.end();
  }
});

// ─── PATCH /update-section ────────────────────────────────────────────────────
router.patch('/update-section', (req, res) => {
  try {
    const { section, data } = req.body;
    if (!section || !data) return res.status(400).json({ error: 'section and data required' });

    const profile = readProfile();
    if (!profile) return res.status(404).json({ error: 'No creator profile found' });

    profile[section] = { ...(profile[section] || {}), ...data };
    if (!profile.meta) profile.meta = {};
    profile.meta.updated_at = new Date().toISOString();

    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// COLLABORATOR SOUL SUPPORT
// ─────────────────────────────────────────────────────────────────────────────

function listCollabFiles() {
  try {
    return fs.readdirSync(ROOT_PATH)
      .filter(f => /^creator-profile-.+\.json$/.test(f))
      .map(f => {
        const slug = f.replace('creator-profile-', '').replace('.json', '');
        try {
          const p = JSON.parse(fs.readFileSync(path.join(ROOT_PATH, f), 'utf8'));
          return {
            slug,
            name:        p.creator?.name  || slug,
            role:        p.creator?.role  || 'Collaborator',
            badge:       p.badge          || { letter: slug[0].toUpperCase(), color: 'amber' },
            voice_words: (p.voice?.tone_descriptors || []).slice(0, 3).join(', ') || '',
          };
        } catch (_) {
          return { slug, name: slug, role: 'Collaborator',
                   badge: { letter: slug[0].toUpperCase(), color: 'amber' }, voice_words: '' };
        }
      });
  } catch (_) { return []; }
}

// GET /collaborators
router.get('/collaborators', (req, res) => {
  res.json({ ok: true, collaborators: listCollabFiles() });
});

// GET /collaborator/:slug  (must come before /collaborator/generate to avoid :slug matching "generate")
router.get('/collaborator/:slug/export', (req, res) => {
  try {
    const slug     = req.params.slug.replace(/[^a-z0-9-]/gi, '');
    const filePath = path.join(ROOT_PATH, `creator-profile-${slug}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const profile  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const name     = (profile.creator?.name || slug).toLowerCase().replace(/\s+/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="creator-soul-${name}.kre8r"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(profile, null, 2));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/collaborator/:slug', (req, res) => {
  try {
    const slug     = req.params.slug.replace(/[^a-z0-9-]/gi, '');
    const filePath = path.join(ROOT_PATH, `creator-profile-${slug}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Collaborator not found' });
    res.json({ ok: true, profile: JSON.parse(fs.readFileSync(filePath, 'utf8')) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /export — download primary soul as .kre8r
router.get('/export', (req, res) => {
  try {
    const profile = readProfile();
    if (!profile) return res.status(404).json({ error: 'No profile found' });
    const name = (profile.creator?.name || 'creator').toLowerCase().replace(/\s+/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="creator-soul-${name}.kre8r"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(profile, null, 2));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /primary/import — overwrite creator-profile.json with an uploaded .kre8r file
// Accepts application/json or text/plain (for .kre8r files which have no registered MIME type)
router.post('/primary/import', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    let profile = req.body;
    // express.text() gives us a string; express.json() gives an object.
    // Handle both so .kre8r files (unknown MIME) always parse correctly.
    if (typeof profile === 'string') {
      try { profile = JSON.parse(profile); } catch (_) {
        return res.status(400).json({ error: 'Invalid JSON in .kre8r file' });
      }
    }
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ error: 'Invalid profile JSON' });
    }
    // Back up current profile before overwriting
    if (fs.existsSync(PROFILE_PATH)) {
      const backupPath = PROFILE_PATH.replace(/\.json$/, '-backup-before-import.json');
      fs.copyFileSync(PROFILE_PATH, backupPath);
    }
    if (!profile.meta) profile.meta = {};
    profile.meta.imported_at = new Date().toISOString();
    profile.type = 'primary';
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
    const name = profile.creator?.name || 'Unknown';
    const brand = profile.creator?.brand || name;
    res.json({ ok: true, name, brand });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /collaborator/import — accept JSON body, save as creator-profile-{slug}.json
router.post('/collaborator/import', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    let profile = req.body;
    if (typeof profile === 'string') {
      try { profile = JSON.parse(profile); } catch (_) {
        return res.status(400).json({ error: 'Invalid JSON in .kre8r file' });
      }
    }
    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ error: 'Invalid profile JSON' });
    }
    const rawSlug = profile.slug ||
      (profile.creator?.name || 'collaborator').toLowerCase()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const slug = rawSlug || 'collaborator';
    if (!profile.meta) profile.meta = {};
    profile.meta.imported_at = new Date().toISOString();
    profile.type = profile.type || 'collaborator';
    const filePath = path.join(ROOT_PATH, `creator-profile-${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
    res.json({ ok: true, slug, name: profile.creator?.name || slug });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /collaborator/generate (SSE) — legacy text-only path (used when analyze-voice was skipped)
router.post('/collaborator/generate', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  function sse(obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }

  try {
    const {
      name, role, badge_letter, badge_color,
      voice_samples, never_say, tone_descriptors,
      role_in_videos, relationship_dynamic, beats_typically_covers,
    } = req.body;
    if (!name) throw new Error('Collaborator name is required');

    sse({ type: 'status', message: '✦ Analyzing voice samples...' });
    await new Promise(r => setTimeout(r, 600));
    sse({ type: 'status', message: '✦ Building collaborator soul...' });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'collaborator';

    const prompt = `You are building a collaborator profile for a multi-creator content production system.
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.

COLLABORATOR DATA:
Name: ${name}
Role: ${role || 'Collaborator'}
Badge: ${badge_letter || name[0].toUpperCase()} (${badge_color || 'amber'})
Voice descriptors: ${(tone_descriptors || []).join(', ') || 'not specified'}
Never says: ${never_say || 'not specified'}

VOICE SAMPLES:
${voice_samples || 'No writing samples provided — infer from role and name.'}

Generate a collaborator profile JSON:
{
  "type": "collaborator",
  "slug": "${slug}",
  "creator": {
    "name": "${name}",
    "role": "${role || 'Collaborator'}"
  },
  "voice": {
    "tone_descriptors": ["...", "..."],
    "never_say": ["..."],
    "writing_style": "A paragraph describing how this person communicates on camera. Be specific and useful for an AI script writer.",
    "sentence_patterns": "...",
    "humor_style": "...",
    "avg_sentence_length": "short/medium/long",
    "signature_phrases": ["..."]
  },
  "badge": {
    "letter": "${badge_letter || name[0].toUpperCase()}",
    "color": "${badge_color || 'amber'}"
  },
  "meta": {
    "created_at": "${new Date().toISOString()}",
    "version": "1.0",
    "soul_builder_version": "1.0"
  }
}`;

    const { default: fetch } = await import('node-fetch');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const e = await claudeRes.json().catch(() => ({}));
      throw new Error(e?.error?.message || `Claude API error ${claudeRes.status}`);
    }

    const claudeData = await claudeRes.json();
    let raw = claudeData.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let profile;
    try {
      profile = JSON.parse(raw);
    } catch (_) {
      const s = raw.indexOf('{'), e2 = raw.lastIndexOf('}');
      if (s !== -1 && e2 !== -1) profile = JSON.parse(raw.slice(s, e2 + 1));
      else throw new Error('Malformed JSON from Claude');
    }

    if (!profile.slug) profile.slug = slug;
    const finalSlug = profile.slug;

    // Inject new structured fields if provided
    if (role_in_videos)        profile.role_in_videos          = role_in_videos;
    if (relationship_dynamic)  profile.relationship_to_primary  = relationship_dynamic;
    if (beats_typically_covers) profile.beats_typically_covers  = beats_typically_covers;
    // Legacy aliases for WritΩr
    if (!profile.voice) profile.voice = {};
    if (!profile.voice.tone_descriptors && profile.voice.signature_phrases) {
      profile.voice.tone_descriptors = profile.voice.signature_phrases.slice(0, 3);
    }
    if (!profile.voice.never_say && never_say) {
      profile.voice.never_say = [never_say];
    }
    if (!profile.voice.writing_style && profile.voice.writing_guidelines) {
      profile.voice.writing_style = profile.voice.writing_guidelines;
    }

    const filePath = path.join(ROOT_PATH, `creator-profile-${finalSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');

    sse({ type: 'done', slug: finalSlug, name: profile.creator?.name || name, badge: profile.badge });

  } catch (err) {
    sse({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

// ─── POST /analyze-voice (SSE) ───────────────────────────────────────────────
// Accepts: multipart — up to 6 clip files + transcript_text + descriptors + tone_slider + never_say + collab_name
// Returns SSE stream → { type:'status'|'done'|'error', ... }

// Whisper executable name differs by platform
const WHISPER_BIN = process.platform === 'win32' ? 'whisper.exe' : 'whisper';

router.post('/analyze-voice', voiceUpload.array('clips', 6), async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  function sse(obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }

  const files          = req.files || [];
  const transcriptText = (req.body.transcript_text || '').trim();
  const descriptors    = (req.body.descriptors     || '').trim();
  const toneSlider     = req.body.tone_slider       || '5';
  const neverSay       = (req.body.never_say        || '').trim();
  const collabName     = (req.body.collab_name      || 'this person').trim();

  const allTranscripts = [];
  const tmpToClean     = [];

  try {
    // ── Phase 1: transcribe each uploaded clip ──────────────────────────────
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Safe temp name: no spaces, no special chars — use index + timestamp
      const safeBase = `kre8r_clip_${i}_${Date.now()}`;
      const wavPath  = path.join(os.tmpdir(), safeBase + '.wav');
      tmpToClean.push(file.path, wavPath);

      sse({ type: 'status', step: 'transcribe', clip: i + 1, total: files.length,
            message: `Transcribing clip ${i + 1} of ${files.length}...` });

      try {
        // Resample to 16 kHz mono WAV — works for .mp3, .mp4, .mov, .m4a, .wav, etc.
        execSync(
          `ffmpeg -y -i "${file.path}" -ar 16000 -ac 1 "${wavPath}"`,
          { timeout: 120_000, stdio: 'pipe' }
        );

        // Whisper transcription — GPU accelerated, small model, English forced
        execSync(
          `"${WHISPER_BIN}" "${wavPath}" --model small --language en --device cuda --output_format txt --output_dir "${os.tmpdir()}"`,
          { timeout: 600_000, stdio: 'pipe' }   // 10 min per clip
        );

        // Whisper names output: <basename_no_ext>.txt in output_dir
        const txtPath = path.join(os.tmpdir(), safeBase + '.txt');
        tmpToClean.push(txtPath);

        if (fs.existsSync(txtPath)) {
          const txt = fs.readFileSync(txtPath, 'utf8').trim();
          if (txt) allTranscripts.push(`[Clip ${i + 1} — ${file.originalname}]\n${txt}`);
        }

        sse({ type: 'status', step: 'transcribe', clip: i + 1, total: files.length,
              message: `Clip ${i + 1} of ${files.length} transcribed ✓` });
      } catch (_clipErr) {
        sse({ type: 'status', message: `Clip ${i + 1}: transcription failed — skipping...` });
      }
    }

    // ── Phase 2: add pasted transcript ─────────────────────────────────────
    if (transcriptText) {
      allTranscripts.push(`[Pasted Transcript]\n${transcriptText}`);
    }

    if (allTranscripts.length === 0 && !descriptors) {
      throw new Error('Nothing to analyze — provide video clips, a transcript, or voice descriptors.');
    }

    sse({ type: 'status', step: 'analyze', message: 'Analyzing voice patterns...' });

    // ── Phase 3: Claude deep voice analysis ────────────────────────────────
    const transcriptBlock = allTranscripts.length > 0
      ? `TRANSCRIPTS FROM THEIR ON-CAMERA FOOTAGE:\n${allTranscripts.join('\n\n---\n\n')}\n\n`
      : '';

    const descriptorBlock = descriptors
      ? `VOICE DESCRIPTORS (how the creator describes their voice): ${descriptors}\n`
        + `Tone (1=very casual, 10=very professional): ${toneSlider}\n`
        + `They would never say: ${neverSay || 'not specified'}\n\n`
      : '';

    sse({ type: 'status', step: 'claude', message: 'Building voice profile...' });

    const prompt = `You are analyzing on-camera content to build a detailed voice profile for a content creator named ${collabName}.
This profile will be used by an AI system to write scripts authentically in their voice.

${transcriptBlock}${descriptorBlock}Analyze their speaking voice in extreme detail.
${allTranscripts.length === 0 ? 'No transcripts are available — infer from the voice descriptors provided.' : 'Be specific and reference actual phrases from the transcripts.'}

Return a comprehensive JSON voice profile. Return ONLY valid JSON — no preamble, no markdown:

{
  "voice_in_3_words": ["word1", "word2", "word3"],
  "voice_summary": "2-3 sentences describing their overall voice and on-camera presence",
  "energy_level": "high/medium/low — with description of how that energy shows up",
  "sentence_patterns": {
    "average_length": "short/medium/long",
    "structure": "description of how they construct sentences — fragments, run-ons, rhetorical questions, etc.",
    "examples": ["example phrase", "another example"]
  },
  "humor_style": {
    "type": "self-deprecating/observational/dry/none",
    "description": "how humor shows up in their speech",
    "examples": ["funny moment or constructed example"]
  },
  "authority_markers": {
    "type": "personal experience/expertise/story/question",
    "description": "how they establish credibility or trust with their audience"
  },
  "filler_words": ["um", "like", "you know"],
  "signature_phrases": ["phrases that feel distinctly them", "recurring structures"],
  "emotional_range": "description of emotional variation — do they stay even-keel or swing wide?",
  "relationship_to_camera": "friend/teacher/peer/entertainer — with description of how they treat their audience",
  "pacing": "fast/medium/slow — description of their verbal rhythm and how it shifts",
  "vocabulary_level": "simple/conversational/educated — with specific word-choice examples",
  "unique_characteristics": ["3-5 things that make this voice unmistakably theirs"],
  "what_not_to_write": ["3-5 things that would feel wrong or out of character in their voice"],
  "writing_guidelines": "One detailed paragraph with specific instructions for writing in this voice. Be concrete enough that someone who has never met this person could write convincingly as them."
}

This profile must capture their actual voice with enough specificity to be useful for AI script generation.
Return ONLY valid JSON.`;

    const raw = await callClaude(prompt, 4096);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let profile;
    try {
      profile = JSON.parse(cleaned);
    } catch (_) {
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        profile = JSON.parse(cleaned.slice(s, e + 1));
      } else {
        throw new Error('Claude returned malformed JSON — please try again');
      }
    }

    profile._analyzed_clips   = files.length;
    profile._has_transcript   = transcriptText.length > 0;
    profile._has_descriptors  = descriptors.length > 0;

    sse({ type: 'done', profile });

  } catch (err) {
    sse({ type: 'error', message: err.message });
  } finally {
    tmpToClean.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} });
    res.end();
  }
});

// ─── POST /collaborator/save ──────────────────────────────────────────────────
// Direct save — used after voice analysis preview confirmed ("This sounds like them ✓")
// No Claude call needed — voice_profile already analyzed.
router.post('/collaborator/save', (req, res) => {
  try {
    const {
      name, role_in_videos, relationship_dynamic, beats_typically_covers,
      voice_profile, badge_letter, badge_color,
    } = req.body;

    if (!name)          return res.status(400).json({ error: 'name is required' });
    if (!voice_profile) return res.status(400).json({ error: 'voice_profile is required' });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'collaborator';

    const soul = {
      type: 'collaborator',
      slug,
      creator: {
        name,
        role:  role_in_videos || 'Collaborator',
      },
      voice: {
        // Rich fields from analyze-voice
        voice_in_3_words:       voice_profile.voice_in_3_words       || [],
        voice_summary:          voice_profile.voice_summary           || '',
        energy_level:           voice_profile.energy_level            || '',
        sentence_patterns:      voice_profile.sentence_patterns       || {},
        humor_style:            voice_profile.humor_style             || {},
        authority_markers:      voice_profile.authority_markers       || {},
        filler_words:           voice_profile.filler_words            || [],
        signature_phrases:      voice_profile.signature_phrases       || [],
        emotional_range:        voice_profile.emotional_range         || '',
        relationship_to_camera: voice_profile.relationship_to_camera  || '',
        pacing:                 voice_profile.pacing                  || '',
        vocabulary_level:       voice_profile.vocabulary_level        || '',
        unique_characteristics: voice_profile.unique_characteristics  || [],
        what_not_to_write:      voice_profile.what_not_to_write       || [],
        writing_guidelines:     voice_profile.writing_guidelines      || '',
        // Legacy aliases for WritΩr compatibility
        tone_descriptors:       voice_profile.voice_in_3_words        || [],
        never_say:              voice_profile.what_not_to_write       || [],
        writing_style:          voice_profile.voice_summary           || '',
      },
      role_in_videos:          role_in_videos        || '',
      beats_typically_covers:  beats_typically_covers || '',
      relationship_to_primary: relationship_dynamic  || '',
      badge: {
        letter: (badge_letter || name[0] || 'C').toUpperCase(),
        color:  badge_color || 'amber',
      },
      meta: {
        created_at:      new Date().toISOString(),
        analyzed_clips:  voice_profile._analyzed_clips  || 0,
        has_transcript:  voice_profile._has_transcript  || false,
        has_descriptors: voice_profile._has_descriptors || false,
        version:         '1.0',
        soul_builder_version: '2.0',
      },
    };

    const filePath = path.join(ROOT_PATH, `creator-profile-${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(soul, null, 2), 'utf8');

    res.json({ ok: true, slug, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
