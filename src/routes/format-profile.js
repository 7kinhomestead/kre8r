'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { callClaude } = require('../utils/claude');

const PROFILE_KEY = 'format_profile_rock_rich';

// Default seed profile — used when no profile exists yet
const DEFAULT_PROFILE = {
  show_name: 'Rock Rich',
  tagline: 'Gold Rush meets How the Universe Works, off-grid edition.',
  narrative_spine: 'Today Jason set out to [GOAL] and the environment [OBSTACLE]ed him.',
  tone: 'Short documentary. Discovery Channel DNA. Real stakes, real outcomes. Tension arc. No performance.',
  character_roles: {
    jason: 'Protagonist. Sets the goal, hits the wall, finds a way. Or doesn\'t — both are valid.',
    cari: 'The voice of reality. Often right before Jason knows it. Witness and participant.',
    environment: 'The antagonist. Indifferent, not malicious. More powerful than any human plan. The land always has a vote.',
    kids: 'The stakes. Why any of this matters.'
  },
  beat_structure: [
    'Cold Open — drop in mid-action, problem already visible',
    'The Mission — one clear goal stated simply',
    'Land Fights Back — first obstacle from environment/reality',
    'Adapt & Escalate — improvisation, trial and error, problem grows',
    'The Crisis — moment of maximum doubt',
    'Resolution — honest outcome, win or fail',
    'Rock Rich Thesis — zoom out to the larger meaning'
  ],
  opening_rule: 'Never open with "hey guys welcome back." Drop the viewer into the action or the problem. The context comes after.',
  tension_mechanism: 'The environment is always one move ahead. Each solution reveals a new problem. The viewer stays because they don\'t know if Jason wins — and Rock Rich doesn\'t always win.',
  visual_vocabulary: {
    hero_shots: 'Wide shots that make the land feel massive. Close-up hands doing the work.',
    broll: 'The obstacle itself — the broken thing, the weather, the failed attempt. Not beauty shots.',
    talking_head: 'Jason explaining what just happened — after the fact, in the field, not staged.'
  },
  pacing: '10-20 minutes. Each beat turn happens within 2-3 minutes max. No filler.',
  rock_rich_thesis: 'Resourcefulness is the superpower. Having less forces you to think more. The homestead keeps winning because Jason can\'t just throw money at problems.',
  what_it_never_is: 'Tutorial. Instructional content. Inspirational wallpaper. Fake drama. This is a show about someone actually living this life, not explaining how to.',
  hooks_that_work: [
    'Drop in mid-failure: "Three hours in and nothing is working."',
    'The paradox: "I tried to [X] and the land reminded me who\'s actually in charge."',
    'The upside-down: "This was supposed to be the easy part."',
    'Stakes first: "If this doesn\'t work, we\'re [real consequence]."'
  ],
  episode_examples: [],
  last_analyzed: null,
  version: 1
};

// GET /api/format-profile/rock-rich
router.get('/rock-rich', (req, res) => {
  try {
    const stored = db.getKv(PROFILE_KEY);
    const profile = stored ? JSON.parse(stored) : DEFAULT_PROFILE;
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/format-profile/rock-rich
// Body: { profile } — full profile object to store
router.post('/rock-rich', (req, res) => {
  try {
    const { profile } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile required' });
    db.setKv(PROFILE_KEY, JSON.stringify(profile));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/format-profile/rock-rich/analyze
// Body: { episode_descriptions: [{title, description, url}] }
// Analyzes episode descriptions and updates the format profile
router.post('/rock-rich/analyze', async (req, res) => {
  try {
    const { episode_descriptions } = req.body;
    if (!Array.isArray(episode_descriptions) || !episode_descriptions.length) {
      return res.status(400).json({ error: 'episode_descriptions array required' });
    }

    const stored = db.getKv(PROFILE_KEY);
    const currentProfile = stored ? JSON.parse(stored) : DEFAULT_PROFILE;

    const episodeText = episode_descriptions
      .map((ep, i) => `Episode ${i+1}: "${ep.title}"\n${ep.description || ''}${ep.transcript ? '\n\nTranscript excerpt:\n' + ep.transcript.slice(0, 2000) : ''}`)
      .join('\n\n---\n\n');

    const prompt = `You are analyzing episodes of "Rock Rich" — a short documentary show by 7 Kin Homestead.

Current format profile:
${JSON.stringify(currentProfile, null, 2)}

Episodes to analyze:
${episodeText}

Based on these episodes, extract and refine the Rock Rich format DNA. Look for:
- What patterns appear in every episode (opening structure, how tension is built, how it resolves)
- The specific language and voice Jason uses in this format vs his talking-head content
- What visual moments tend to occur
- What the emotional journey is for the viewer
- Any patterns that should update or refine the current format profile

Return a JSON object that updates the format profile. Only update fields where you found clear evidence. Preserve fields where you have no new information. Return the complete updated profile as valid JSON.

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation.`;

    const response = await callClaude(prompt, 4096);

    let updatedProfile;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      updatedProfile = JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch (_) {
      return res.status(500).json({ error: 'Claude returned invalid JSON', raw: response.slice(0, 500) });
    }

    // Merge with current, preserve structure
    const merged = {
      ...currentProfile,
      ...updatedProfile,
      last_analyzed: new Date().toISOString(),
      version: (currentProfile.version || 1) + 1
    };

    db.setKv(PROFILE_KEY, JSON.stringify(merged));
    res.json({ ok: true, profile: merged });

  } catch (err) {
    console.error('[FormatProfile] analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
