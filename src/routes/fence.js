/**
 * fence.js  —  The Fence
 * GET  /fence          → serves public/fence/index.html
 * POST /api/fence/ask  → SSE: transcript search → Claude stream fallback
 * GET  /api/fence/log  → owner-only conversation log
 *
 * Flow:
 *  1. Extract keywords from question
 *  2. Search footage.transcript (joined to projects for YouTube URL)
 *  3. If confident match → stream "I covered this in [video] at [time]"
 *  4. If no match        → stream Claude response in Jason's voice
 *  5. End with { type:'route', cta:{...} } event
 *  6. Log everything to fence_conversations
 *
 * Tier param (?tier=public|garden|founding) adjusts system prompt + routing.
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const dbMod   = require('../db');
const { callClaudeStream } = require('../utils/claude');
const { loadProfile }      = require('../utils/profile-validator');
const logger               = require('../utils/logger');

// Lazy getter — getRawDb() must not be called until after initDb() runs in server.js
function getDb() { return dbMod.getRawDb(); }

// ── Bootstrap table (called on first request, after initDb has run) ───────────
let _tableReady = false;
function ensureTable() {
  if (_tableReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS fence_conversations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT,
      tier          TEXT    DEFAULT 'public',
      question      TEXT    NOT NULL,
      response      TEXT,
      route_type    TEXT,
      routed_to     TEXT,
      video_title   TEXT,
      timestamp_sec INTEGER,
      youtube_url   TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  _tableReady = true;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────
function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Transcript search ─────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can','need',
  'to','of','in','on','at','by','for','with','about','from','up','down','out',
  'this','that','these','those','my','your','his','her','its','our','their',
  'what','which','who','how','when','where','why','i','you','he','she','it',
  'we','they','and','or','but','if','so','then','than','just','get','got',
  'want','use','make','know','think','see','look','go','come','take','give',
  'tell','try','ask','work','let','like','say','one','two','time','way','day',
  'man','people','year','thing','really','very','much','also','into','back',
  'here','there','some','any','all','well','now','new','more','only','its'
]);

function extractKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 8);
}

function extractBestSnippet(text, keywords) {
  if (!text) return { snippet: '', charPos: 0 };
  const lc = text.toLowerCase();
  const WIN = 380;
  let bestPos = 0, bestScore = 0;

  for (let i = 0; i < Math.max(1, lc.length - WIN); i += 50) {
    const win = lc.slice(i, i + WIN);
    let sc = 0;
    for (const kw of keywords) { if (win.includes(kw)) sc++; }
    if (sc > bestScore) { bestScore = sc; bestPos = i; }
  }
  // Walk back to sentence boundary
  const before    = text.slice(Math.max(0, bestPos - 40), bestPos);
  const lastDot   = before.lastIndexOf('.');
  const actualPos = lastDot !== -1 ? Math.max(0, bestPos - 40 + lastDot + 1) : bestPos;

  return {
    snippet : text.slice(actualPos, actualPos + WIN).trim(),
    charPos : actualPos,
  };
}

function searchTranscripts(question) {
  const keywords = extractKeywords(question);
  if (!keywords.length) return null;

  const hits = new Map();
  for (const kw of keywords) {
    let rows;
    try {
      rows = getDb().prepare(`
        SELECT f.id, f.transcript, f.original_filename, f.description,
               p.title  AS project_title,
               p.youtube_url, p.youtube_video_id
        FROM   footage  f
        LEFT JOIN projects p ON p.id = f.project_id
        WHERE  f.shot_type  = 'completed-video'
          AND  f.transcript IS NOT NULL
          AND  length(f.transcript) > 120
          AND  f.transcript LIKE ?
        LIMIT 8
      `).all(`%${kw}%`);
    } catch (_) { rows = []; }

    for (const row of rows) {
      if (hits.has(row.id)) hits.get(row.id).score++;
      else hits.set(row.id, { ...row, score: 1 });
    }
  }
  if (!hits.size) return null;

  const sorted = [...hits.values()].sort((a, b) => b.score - a.score);
  const best   = sorted[0];
  if (best.score < 2) return null;  // require 2+ keyword matches

  const { snippet, charPos } = extractBestSnippet(best.transcript, keywords);

  // Rough timestamp: ~2.3 words/sec average speaking rate
  const wordsBefore = best.transcript.slice(0, charPos).trim().split(/\s+/).length;
  const timestampSec = Math.max(0, Math.floor(wordsBefore / 2.3));

  // Build YouTube URL with timestamp
  let ytUrl = null;
  if (best.youtube_video_id) {
    ytUrl = `https://www.youtube.com/watch?v=${best.youtube_video_id}&t=${timestampSec}`;
  } else if (best.youtube_url) {
    ytUrl = best.youtube_url + (timestampSec ? `&t=${timestampSec}` : '');
  }

  return {
    videoTitle  : best.project_title || best.original_filename || 'one of my videos',
    ytUrl,
    timestampSec,
    snippet,
    confidence  : best.score,
  };
}

// ── Format seconds → m:ss ─────────────────────────────────────────────────────
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── CTA routing by keyword ────────────────────────────────────────────────────
function pickCta(question, tier) {
  const q = question.toLowerCase();
  const base = 'https://www.7kinhomestead.com';

  if (/solar|panel|battery|watt|inverter|charge|photovoltaic/.test(q))
    return { icon:'☀️', label:'FREE COURSE', title:'Understanding Off Grid Solar — Free in The Greenhouse', href:`${base}/understanding-off-grid-solar-mini-course` };
  if (/land|property|acres|cheap land|buy land|purchase/.test(q))
    return { icon:'🗺️', label:'FREE TOOL', title:'Land Finder Tool — Free in The Greenhouse', href:`${base}/the-greenhouse-landing` };
  if (/money|afford|broke|budget|cost|expensive|financial|freedom/.test(q))
    return { icon:'💰', label:'FREE TOOL', title:'Freedom Calculator — Free in The Greenhouse', href:`${base}/the-greenhouse-landing` };
  if (/water|well|rain|harvest|pump|spring|cistern/.test(q))
    return { icon:'💧', label:'FREE TOOL', title:'Water Systems Planner — Free in The Greenhouse', href:`${base}/the-greenhouse-landing` };
  if (/family|kids|wife|husband|spouse|partner|children|together/.test(q))
    return { icon:'🏕️', label:'FREE COMMUNITY', title:'Join The Greenhouse — 500+ families doing this', href:`${base}/offers/WmMk5nvp/checkout` };
  if (/rock rich|founding|inner circle|premium|vip/.test(q) || tier === 'founding')
    return { icon:'🏆', label:'FOUNDING 50', title:'Becoming Rock Rich — $297 One-Time · Limited Spots', href:`${base}/founding-50` };
  if (tier === 'garden')
    return { icon:'🌿', label:'THE GARDEN', title:'Your Garden membership has everything →', href:`${base}/membership-tiers` };

  // Default — Greenhouse
  return { icon:'🏕️', label:'START HERE · FREE', title:'Join The Greenhouse — No Credit Card, Always Free', href:`${base}/offers/WmMk5nvp/checkout` };
}

// ── System prompt builder ─────────────────────────────────────────────────────
async function buildSystemPrompt(tier) {
  let profile;
  try { profile = await loadProfile(); } catch (_) { profile = {}; }

  const voice  = profile?.voice_profile || 'Straight-talking, warm, funny, never corporate. Like a sharp-tongued neighbor talking over a fence.';
  const angles = (profile?.content_angles || []).map(a => a.name || a).join(', ');

  // Pull active strategic brief if available
  let brief = '';
  try {
    const b = getDb().prepare(`SELECT brief_text FROM strategic_briefs WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1`).get();
    if (b?.brief_text) brief = `\nActive strategic direction: ${b.brief_text.slice(0, 400)}`;
  } catch (_) {}

  // Pull live member count
  let memberCount = '500+';
  try {
    const mc = getDb().prepare(`SELECT value FROM kv_store WHERE key = 'member_count_override'`).get();
    if (mc?.value) memberCount = mc.value;
  } catch (_) {}

  const tierContext = tier === 'founding'
    ? 'This person is a Founding 50 member — inner circle, $297 one-time. Be warm and specific. They know you well.'
    : tier === 'garden'
    ? 'This person is a Garden member ($19/mo). They are already invested. Be direct and helpful.'
    : 'This person arrived cold from TikTok or the bio page. They may not know much about you yet.';

  return `You are Jason Rutland — 7 Kin Homestead. Off-grid homestead creator, father of 5, PNW mountains, 700 sq ft house.

Voice: ${voice}
Content angles: ${angles}
Community: The Greenhouse (${memberCount} members — free tier), The Garden ($19/mo), Founding 50 ($297 one-time, 50 spots).${brief}

Visitor context: ${tierContext}

RULES — follow these exactly:
1. Respond in 2–4 sentences maximum. Never more.
2. Sound exactly like you: warm, direct, a little funny, zero corporate language.
3. Answer the actual question. Don't pivot immediately to a product.
4. The last sentence should organically lead toward the next step (community, tool, or video) — but only if it fits naturally.
5. Never say "as an AI", "I'm Jason's assistant", or break character in any way.
6. If asked about: specific prices, legal, medical, financial advice — answer truthfully that you're not qualified and point to the community.
7. Keep it conversational. This is a fence, not a landing page.`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Health check — confirms route is loaded and ANTHROPIC_API_KEY is set
router.get('/health', (req, res) => {
  res.json({
    ok     : true,
    hasKey : !!process.env.ANTHROPIC_API_KEY,
    table  : 'fence_conversations',
  });
});

// SSE ask endpoint
router.post('/ask', async (req, res) => {
  ensureTable();
  // SSE headers
  res.set({
    'Content-Type'               : 'text/event-stream',
    'Cache-Control'              : 'no-cache',
    'Connection'                 : 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering'          : 'no',
  });
  res.flushHeaders();

  const { question = '', session_id = '', tier = 'public' } = req.body || {};
  const q = question.trim().slice(0, 500);

  if (!q) {
    sseWrite(res, { type:'error', message:'Ask me something.' });
    return res.end();
  }

  let responseText = '';
  let routeType    = 'generated';
  let videoTitle   = null;
  let timestampSec = null;
  let ytUrl        = null;

  try {
    // ── Step 1: Transcript search ──────────────────────────────────────────
    sseWrite(res, { type:'status', message:'searching...' });

    const match = searchTranscripts(q);

    if (match && match.ytUrl) {
      // Found a real video — build a bridging response
      routeType    = 'transcript';
      videoTitle   = match.videoTitle;
      timestampSec = match.timestampSec;
      ytUrl        = match.ytUrl;

      const intro = `I actually made a video on that. In "${match.videoTitle}" — right around ${fmtTime(match.timestampSec)} — I walk through exactly this. `;
      const snippet = match.snippet.split(/[.!?]/)[0]; // first sentence of the relevant section
      const bridgeText = `${intro}Here's the short version: ${snippet.slice(0, 180).trim()}. The full breakdown is in the video.`;

      // Stream it word by word
      const words = bridgeText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? '' : ' ') + words[i];
        sseWrite(res, { type:'token', text: token });
        responseText += token;
        await new Promise(r => setTimeout(r, 32 + Math.random() * 20));
      }

      // Send the video CTA
      sseWrite(res, {
        type : 'route',
        cta  : {
          icon  : '▶',
          label : `WATCH AT ${fmtTime(match.timestampSec)}`,
          title : match.videoTitle,
          href  : match.ytUrl,
          isVideo: true,
        },
      });

    } else {
      // ── Step 2: Claude generated response ─────────────────────────────
      routeType = 'generated';
      const system   = await buildSystemPrompt(tier);
      const messages = [{ role:'user', content: q }];
      const cta      = pickCta(q, tier);

      responseText = await callClaudeStream(
        system,
        messages,
        300, // keep it tight — 2-4 sentences
        (token) => {
          sseWrite(res, { type:'token', text: token });
        },
        { tool:'fence', session_id }
      );

      sseWrite(res, { type:'route', cta });
    }

    sseWrite(res, { type:'done' });

  } catch (err) {
    logger.error({ err }, '[fence] ask error');
    // Graceful fallback — don't leave the user hanging
    const fallback = "That's a real question. Head into The Greenhouse — free, no card — and let's dig into it there.";
    sseWrite(res, { type:'token', text: fallback });
    sseWrite(res, {
      type:'route',
      cta:{ icon:'🏕️', label:'FREE · NO CARD', title:'Join The Greenhouse', href:'https://www.7kinhomestead.com/offers/WmMk5nvp/checkout' }
    });
    sseWrite(res, { type:'done' });
    routeType = 'fallback';
    responseText = fallback;
  } finally {
    // Log conversation
    try {
      getDb().prepare(`
        INSERT INTO fence_conversations
          (session_id, tier, question, response, route_type, video_title, timestamp_sec, youtube_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(session_id || null, tier, q, responseText, routeType, videoTitle, timestampSec, ytUrl);
    } catch (_) {}
    res.end();
  }
});

// ── Title fuzzy-match for YouTube ID enrichment ───────────────────────────────
function titleWords(str) {
  const SKIP = new Set(['a','an','the','and','or','but','in','on','at','to','of',
    'for','with','how','why','what','we','our','my','i','its','is','are','was',
    'this','that','it','do','did','get','got','your','from','up','out','off','if']);
  return (str || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !SKIP.has(w));
}

function titleSimilarity(a, b) {
  const wa = new Set(titleWords(a));
  const wb = new Set(titleWords(b));
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  for (const w of wa) { if (wb.has(w)) overlap++; }
  return overlap / Math.max(wa.size, wb.size);
}

// Owner-only: export transcripts as JSON → paste into kre8r-land's transcripts.json
// GET /api/fence/export-transcripts
router.get('/export-transcripts', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error:'Unauthorized' });
  ensureTable();
  try {
    const rows = getDb().prepare(`
      SELECT f.id, f.original_filename, f.description,
             p.title          AS project_title,
             p.youtube_url,
             p.youtube_video_id,
             f.transcript
      FROM   footage  f
      LEFT JOIN projects p ON p.id = f.project_id
      WHERE  f.shot_type  = 'completed-video'
        AND  f.transcript IS NOT NULL
        AND  length(f.transcript) > 120
      ORDER  BY f.id DESC
    `).all();

    // Load all YouTube-synced projects (from MirrΩr) that have a video ID
    const ytProjects = getDb().prepare(`
      SELECT title, youtube_video_id, youtube_url
      FROM   projects
      WHERE  youtube_video_id IS NOT NULL
        AND  youtube_video_id != ''
    `).all();

    const out = rows.map(r => {
      let ytId  = r.youtube_video_id || null;
      let ytUrl = r.youtube_url      || null;

      // If no YouTube ID on the footage's own project, fuzzy-match against
      // MirrΩr-synced projects (threshold: 50% significant-word overlap)
      if (!ytId) {
        const title = r.project_title || r.original_filename || '';
        let bestScore = 0, bestMatch = null;
        for (const yt of ytProjects) {
          const score = titleSimilarity(title, yt.title);
          if (score > bestScore) { bestScore = score; bestMatch = yt; }
        }
        if (bestScore >= 0.5 && bestMatch) {
          ytId  = bestMatch.youtube_video_id;
          ytUrl = ytUrl || `https://www.youtube.com/watch?v=${ytId}`;
        }
      }

      return {
        id         : r.id,
        title      : r.project_title || r.original_filename || 'Untitled',
        youtube_id : ytId,
        youtube_url: ytUrl,
        transcript : r.transcript,
        _matched   : !r.youtube_video_id && !!ytId, // flag auto-matched entries for review
      };
    });

    const matched = out.filter(r => r._matched).length;
    const total   = out.length;
    logger.info({ total, matched }, '[fence] export-transcripts: auto-matched YouTube IDs');

    res.setHeader('Content-Disposition', 'attachment; filename="transcripts.json"');
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner-only: view conversation log
router.get('/log', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error:'Unauthorized' });
  ensureTable();
  try {
    const rows = getDb().prepare(`
      SELECT id, tier, question, response, route_type, video_title, timestamp_sec, youtube_url, created_at
      FROM   fence_conversations
      ORDER  BY created_at DESC
      LIMIT  200
    `).all();
    res.json({ conversations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner-only: toggle fence on/off (kill switch)
router.post('/toggle', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error:'Unauthorized' });
  ensureTable();
  try {
    const current = getDb().prepare(`SELECT value FROM kv_store WHERE key = 'fence_enabled'`).get();
    const next    = current?.value === 'false' ? 'true' : 'false';
    getDb().prepare(`INSERT INTO kv_store (key, value) VALUES ('fence_enabled', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(next);
    res.json({ enabled: next === 'true' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
