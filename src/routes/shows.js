/**
 * ShowΩr Routes — /api/shows
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const db         = require('../db');
const { callClaude } = require('../utils/claude');
const https      = require('https');

// ── YouTube helpers ──────────────────────────────────────────────────────────

function extractYouTubeId(url) {
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = String(url || '').match(re);
    if (m) return m[1];
  }
  return null;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from YouTube API')); }
      });
    }).on('error', reject);
  });
}

async function fetchYouTubeVideoData(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error('Could not extract video ID from URL');
  const apiKey  = process.env.YOUTUBE_API_KEY;
  if (!apiKey)  throw new Error('YOUTUBE_API_KEY not configured');
  const apiUrl  = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`;
  const json    = await httpsGet(apiUrl);
  const item    = json.items?.[0];
  if (!item) throw new Error(`Video not found: ${videoId}`);
  const s = item.snippet;
  const st = item.statistics;
  return {
    video_id:      videoId,
    title:         s.title,
    description:   s.description,
    published_at:  s.publishedAt,
    thumbnail:     s.thumbnails?.maxres?.url || s.thumbnails?.high?.url || s.thumbnails?.default?.url,
    view_count:    parseInt(st?.viewCount    || 0, 10),
    like_count:    parseInt(st?.likeCount    || 0, 10),
    comment_count: parseInt(st?.commentCount || 0, 10),
    channel:       s.channelTitle,
  };
}

async function fetchYouTubeComments(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&order=relevance&maxResults=50&key=${apiKey}`;
  try {
    const json = await httpsGet(url);
    if (!json.items?.length) return [];
    return json.items
      .map(item => {
        const c = item.snippet.topLevelComment.snippet;
        return {
          text:    c.textDisplay || '',
          likes:   parseInt(c.likeCount || 0, 10),
          replies: parseInt(item.snippet.totalReplyCount || 0, 10),
        };
      })
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 30);
  } catch (e) {
    console.warn('[shows/comments] fetch failed (non-fatal):', e.message);
    return [];
  }
}

// ── Static routes FIRST — must come before /:id to avoid Express swallowing them ──

// GET /api/shows/youtube-meta?url=... — fetch YouTube video metadata (server-side to protect API key)
router.get('/youtube-meta', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });
    const data = await fetchYouTubeVideoData(url);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/shows/import-episode — analyze existing episode via Claude; does NOT save to DB (client reviews first)
// Body: { show_id, episode_number, youtube_url?, transcript }
router.post('/import-episode', async (req, res) => {
  try {
    const { show_id, episode_number, youtube_url, transcript } = req.body;
    if (!show_id)   return res.status(400).json({ error: 'show_id required' });
    if (!transcript && !youtube_url) return res.status(400).json({ error: 'transcript or youtube_url required' });

    const show    = db.getShow(parseInt(show_id, 10));
    if (!show) return res.status(404).json({ error: 'Show not found' });

    const context = db.buildSeasonContext(parseInt(show_id, 10));
    const epNum   = episode_number || context.next_episode_number;

    let ytData    = null;
    let ytComments = [];
    if (youtube_url) {
      try { ytData = await fetchYouTubeVideoData(youtube_url); }
      catch (e) { console.warn('[shows/import] YouTube fetch failed (non-fatal):', e.message); }
      if (ytData?.video_id) {
        ytComments = await fetchYouTubeComments(ytData.video_id);
      }
    }

    const prevSummary = context.episodes.length
      ? context.episodes.map(e => `Ep${e.episode_number}: ${e.what_was_established || e.episode_summary || '(no summary)'}`).join('\n')
      : '(No completed episodes yet — this is the pilot)';

    const seedsBlock = context.seeds_unresolved.length
      ? context.seeds_unresolved.map(s => `• ${s}`).join('\n')
      : '(None planted yet)';

    const commentsBlock = ytComments.length
      ? ytComments.slice(0, 25).map((c, i) => `${i + 1}. [${c.likes}👍 ${c.replies ? c.replies + ' replies' : ''}] ${c.text.replace(/<[^>]+>/g, '').slice(0, 250)}`).join('\n')
      : '(Comments not available — disabled or video has none)';

    const prompt = `You are analyzing a YouTube episode for "${show.name}", a ${show.show_type} series.

SHOW CONTEXT:
Season ${show.season}, Episode ${epNum} of ${show.target_episodes}
Season Arc: ${show.season_arc || '(not defined)'}
Central Question: ${show.central_question || '(not defined)'}
Arc Position: ${context.arc_position}

WHAT WAS PREVIOUSLY ESTABLISHED:
${prevSummary}

SEEDS PREVIOUSLY PLANTED (unresolved):
${seedsBlock}

EPISODE DATA:
${ytData ? `Title: ${ytData.title}
Published: ${ytData.published_at}
Views: ${ytData.view_count?.toLocaleString()}  |  Likes: ${ytData.like_count?.toLocaleString()}  |  Comments: ${ytData.comment_count?.toLocaleString()}
Description: ${ytData.description?.slice(0, 600)}` : '(no YouTube data — working from transcript only)'}

FULL TRANSCRIPT:
${(transcript || '').slice(0, 12000)}

TOP AUDIENCE COMMENTS (sorted by most liked):
${commentsBlock}

Analyze this episode carefully. Extract and return ONLY valid JSON with no extra text:
{
  "what_was_established": "1-2 sentences describing the key facts/situations established in this episode that carry forward",
  "seeds_planted": ["string — each unresolved thread planted for future payoff"],
  "arc_advancement": "1 sentence — how this episode moved the season arc forward",
  "character_moments": ["string — key character-revealing moments"],
  "episode_summary": "2-3 sentences — concrete summary of what happened in past tense, third person, show-bible style",
  "central_question_status": "introduced|deepened|complicated|answered",
  "themes": ["string — recurring themes touched in this episode"],
  "what_next_episode_should_address": "1-2 sentences — the specific story threads and seeds that the next episode should pick up based on what was planted here",
  "audience_signals": {
    "what_landed": "What the audience responded to most emotionally based on the top comments — be specific",
    "recurring_questions": ["Each distinct question or confusion the audience keeps expressing in comments"],
    "what_they_want_next": "1-2 sentences — what the comment section is asking to see next, in their own terms",
    "emotional_pulse": "1 sentence — the overall emotional tone of the comment section (excited, divided, nostalgic, etc.)"
  }
}`;

    const result = await callClaude(prompt, 3500);

    res.json({
      ok:             true,
      episode_number: epNum,
      youtube:        ytData,
      comments_count: ytComments.length,
      extracted: {
        title:                            ytData?.title || null,
        what_was_established:             result.what_was_established             || '',
        seeds_planted:                    result.seeds_planted                    || [],
        arc_advancement:                  result.arc_advancement                  || '',
        character_moments:                result.character_moments                || [],
        episode_summary:                  result.episode_summary                  || '',
        central_question_status:          result.central_question_status          || 'deepened',
        themes:                           result.themes                           || [],
        what_next_episode_should_address: result.what_next_episode_should_address || '',
        audience_signals:                 result.audience_signals                 || null,
      },
    });
  } catch (err) {
    console.error('[shows/import-episode]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Dynamic /:id routes below ──

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
    console.log('[shows/create] body:', JSON.stringify(req.body, null, 2));
    const show = db.createShow(req.body);
    console.log('[shows/create] created show id:', show.id);
    res.json({ ok: true, show_id: show.id, show });
  } catch (err) {
    console.error('[shows/create] ERROR:', err.message, err.stack);
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
