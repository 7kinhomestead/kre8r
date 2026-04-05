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
 * GET  /api/soul-buildr/export                     — download primary soul as .kre8r
 * GET  /api/soul-buildr/collaborator/:slug/export  — download collaborator soul as .kre8r
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');

const PROFILE_PATH = path.join(__dirname, '../../creator-profile.json');
const ROOT_PATH    = path.join(__dirname, '../../');

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
    res.json({
      exists:             true,
      last_updated:       profile.meta?.created_at || null,
      creator_name:       profile.creator?.name   || null,
      channel_name:       profile.creator?.channel || null,
      voice_words:        profile.voice?.tone_descriptors?.slice(0,3).join(', ') || null,
      avatar_name:        profile.audience?.avatar_name || null,
      content_angles:     Array.isArray(profile.content_angles)
        ? profile.content_angles.map(a => a.name || a)
        : Object.values(profile.content_angles || {}).map(a => a.label || a.name || '').filter(Boolean),
      has_voice_samples:  !!(profile.voice?.writing_style),
      has_audience:       !!(profile.audience?.avatar_name),
      has_content_angles: !!(profile.content_angles?.length),
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
Footage path: ${data.footage_path || 'D:\\kre8r\\intake'}
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

// POST /collaborator/import — accept JSON body, save as creator-profile-{slug}.json
router.post('/collaborator/import', (req, res) => {
  try {
    const profile = req.body;
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

// POST /collaborator/generate (SSE) — 3-screen wizard → collaborator profile
router.post('/collaborator/generate', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');

  function sse(obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }

  try {
    const { name, role, badge_letter, badge_color, voice_samples, never_say, tone_descriptors } = req.body;
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

    const filePath = path.join(ROOT_PATH, `creator-profile-${finalSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');

    sse({ type: 'done', slug: finalSlug, name: profile.creator?.name || name, badge: profile.badge });

  } catch (err) {
    sse({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
