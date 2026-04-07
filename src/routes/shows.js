/**
 * ShowΩr Routes — /api/shows
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const db         = require('../db');
const { callClaude } = require('../utils/claude');

// GET /api/shows — list all active shows with episode counts
router.get('/', (req, res) => {
  try {
    const shows = db.getAllShows();
    res.json(shows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shows — create a new show
router.post('/', (req, res) => {
  try {
    const show = db.createShow(req.body);
    res.json({ ok: true, show_id: show.id, show });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shows/:id — get show detail with episodes
router.get('/:id', (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const show = db.getShow(id);
    if (!show) return res.status(404).json({ error: 'Show not found' });
    const episodes = db.getShowEpisodes(id);
    res.json({ ...show, episodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/shows/:id — update show fields
router.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!db.getShow(id)) return res.status(404).json({ error: 'Show not found' });
    db.updateShow(id, req.body);
    res.json({ ok: true, show: db.getShow(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shows/:id/context — season context for WritΩr / Id8Ωr
router.get('/:id/context', (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const context = db.buildSeasonContext(id);
    if (!context) return res.status(404).json({ error: 'Show not found' });
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shows/:id/episodes — create episode record
router.post('/:id/episodes', (req, res) => {
  try {
    const show_id = parseInt(req.params.id, 10);
    if (!db.getShow(show_id)) return res.status(404).json({ error: 'Show not found' });
    const episode = db.createShowEpisode({ ...req.body, show_id });
    res.json({ ok: true, episode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/shows/episodes/:id — update episode fields
router.patch('/episodes/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!db.getShowEpisode(id)) return res.status(404).json({ error: 'Episode not found' });
    db.updateShowEpisode(id, req.body);
    res.json({ ok: true, episode: db.getShowEpisode(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shows/:id/generate-summary — generate episode summary via Claude
// Body: { episode_id }
router.post('/:id/generate-summary', async (req, res) => {
  try {
    const show_id    = parseInt(req.params.id, 10);
    const episode_id = parseInt(req.body.episode_id, 10);
    if (!episode_id) return res.status(400).json({ error: 'episode_id required' });

    const episode = db.getShowEpisode(episode_id);
    if (!episode) return res.status(404).json({ error: 'Episode not found' });

    const show = db.getShow(show_id);
    if (!show) return res.status(404).json({ error: 'Show not found' });

    const prompt = `You are summarizing an episode of "${show.name}", Season ${show.season}.

Episode ${episode.episode_number}: ${episode.title || '(untitled)'}

WHAT WAS ESTABLISHED: ${episode.what_was_established || '(not recorded)'}
ARC ADVANCEMENT: ${episode.arc_advancement || '(not recorded)'}
SEEDS PLANTED: ${episode.seeds_planted || '(none)'}
CHARACTER MOMENTS: ${episode.character_moments || '(not recorded)'}
CENTRAL QUESTION STATUS: ${episode.central_question_status || 'unknown'}

Write a 2-3 sentence episode summary that captures what happened, what changed in the season arc, and what was left unresolved. Be specific and concrete. Write in past tense, third-person narrative style suitable for a show bible.

Return ONLY valid JSON:
{"summary": "string"}`;

    const result = await callClaude(prompt, 1024);
    const summary = result.summary || '';

    db.updateShowEpisode(episode_id, { episode_summary: summary });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shows/:id/next-episode-brief — generate what the next episode must accomplish
router.get('/:id/next-episode-brief', async (req, res) => {
  try {
    const id      = parseInt(req.params.id, 10);
    const context = db.buildSeasonContext(id);
    if (!context) return res.status(404).json({ error: 'Show not found' });

    const { show, episodes, seeds_unresolved, threads, arc_position, next_episode_number } = context;

    const establishedList = threads.length
      ? threads.map(t => `• Ep${t.episode}: ${t.established}`).join('\n')
      : '(No completed episodes yet — this is the pilot)';

    const seedsList = seeds_unresolved.length
      ? seeds_unresolved.map(s => `• ${s}`).join('\n')
      : '(None yet)';

    const prompt = `You are a showrunner for "${show.name}", a ${show.show_type} series.

SERIES OVERVIEW:
Season ${show.season}, Episode ${next_episode_number} of ${show.target_episodes}
Arc Position: ${arc_position}
Central Question: ${show.central_question || '(not defined)'}
Finale Answer: ${show.finale_answer || '(not defined yet)'}
Season Arc: ${show.season_arc || '(not defined)'}

WHAT HAS BEEN ESTABLISHED (from completed episodes):
${establishedList}

SEEDS PLANTED (unresolved story threads):
${seedsList}

Based on where we are in the season arc, determine what Episode ${next_episode_number} MUST accomplish.
Be specific about:
1. The standalone story this episode needs to tell (something any new viewer can follow)
2. The arc advancement required (one clear step toward the season finale)
3. Which seeds should be watered (not necessarily resolved)
4. The character moment that must happen

Return ONLY valid JSON:
{
  "brief": "string — 3-4 sentences describing what this episode must do",
  "standalone_story": "string — the self-contained episode story",
  "arc_advancement": "string — the specific season story step",
  "seeds_to_water": ["string"],
  "character_moment": "string",
  "episode_number": ${next_episode_number},
  "arc_position": "${arc_position}"
}`;

    const result = await callClaude(prompt, 2048);
    res.json({
      brief:            result.brief || '',
      standalone_story: result.standalone_story || '',
      arc_advancement:  result.arc_advancement || '',
      seeds_to_water:   result.seeds_to_water || [],
      character_moment: result.character_moment || '',
      episode_number:   next_episode_number,
      arc_position,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
