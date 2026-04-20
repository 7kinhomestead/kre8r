/**
 * VectΩr Routes — src/routes/vectr.js
 *
 * Weekly strategic session with Claude. Lives as a slide-out panel in NorthΩr.
 * Syncs all fresh platform data, runs pushback-enabled debate, locks a Strategic Brief
 * that injects into Id8Ωr and WritΩr.
 *
 * POST /api/vectr/sync          — pull fresh YouTube + email + community data
 * GET  /api/vectr/session       — load persisted VectΩr conversation
 * POST /api/vectr/session       — save conversation to kv_store
 * DELETE /api/vectr/session     — clear session
 * POST /api/vectr/chat          — SSE streaming chat (Claude as strategic advisor)
 * POST /api/vectr/brief         — save locked Strategic Brief
 * GET  /api/vectr/brief/active  — get active brief (for injection downstream)
 * GET  /api/vectr/briefs        — list brief history
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { getCreatorContext } = require('../utils/creator-context');
const log = require('../utils/logger');

const ML_BASE = 'https://connect.mailerlite.com/api';

// ─── POST /api/vectr/sync ─────────────────────────────────────────────────────
// Pulls YouTube channel health + recent videos, MailerLite recent campaigns,
// Kajabi member count, pipeline health. Returns sync snapshot + stores in kv_store.

router.post('/sync', async (req, res) => {
  try {
    const { default: fetch } = await import('node-fetch');
    const result = { youtube: null, email: null, community: null, pipeline: null, synced_at: new Date().toISOString() };

    // ── YouTube / MirrΩr data ──────────────────────────────────────────────
    try {
      const health = db.getGlobalChannelHealth();
      const recent = db.getRecentProjectsWithAnalytics(10);
      const fmtMap = db.getYouTubeFormats ? db.getYouTubeFormats() : {};
      const longform = recent.filter(v => {
        const f = fmtMap[v.id]?.format;
        return !f || f === 'longform' || f === 'standard';
      });
      const videos = (longform.length > 0 ? longform : recent).slice(0, 10);
      result.youtube = {
        avg_views:    health?.avg_views    || 0,
        total_views:  health?.total_views  || 0,
        best_video:   health?.best_video   || null,
        video_count:  health?.video_count  || 0,
        recent_videos: videos.map(v => ({
          title:         v.title,
          views:         v.total_views  || 0,
          likes:         v.total_likes  || 0,
          comments:      v.total_comments || 0,
          published_at:  v.published_at  || null,
        })),
      };
    } catch (e) {
      log.warn({ module: 'vectr/sync', err: e.message }, 'YouTube data pull failed (non-fatal)');
    }

    // ── MailerLite recent campaigns ──────────────────────────────────────────
    try {
      const mlKey = process.env.MAILERLITE_API_KEY;
      if (mlKey) {
        const mlRes = await fetch(`${ML_BASE}/campaigns?limit=5`, {
          headers: { 'Authorization': `Bearer ${mlKey}`, 'Accept': 'application/json' },
        });
        if (mlRes.ok) {
          const mlData  = await mlRes.json();
          const campaigns = (mlData.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
          result.email = {
            campaigns: campaigns.map(c => ({
              subject:    c.emails?.[0]?.subject || c.name || '—',
              status:     c.status,
              sent_at:    c.sent_at || c.scheduled_for || c.created_at,
              open_rate:  c.stats?.open_rate  ?? null,
              click_rate: c.stats?.click_rate ?? null,
              total_sent: c.stats?.sent       ?? null,
            })),
          };
        }
      }
    } catch (e) {
      log.warn({ module: 'vectr/sync', err: e.message }, 'MailerLite pull failed (non-fatal)');
    }

    // ── Kajabi community (member count from postor_connections fallback) ─────
    try {
      const kajKey   = process.env.KAJABI_CLIENT_ID;
      const kajToken = process.env.KAJABI_API_TOKEN || db.getKv('kajabi_access_token');
      if (kajToken) {
        const kjRes = await fetch('https://kajabi-app.com/api/v1/people?per_page=1', {
          headers: { 'Authorization': `Bearer ${kajToken}`, 'Accept': 'application/json' },
        });
        if (kjRes.ok) {
          const kjData = await kjRes.json();
          result.community = {
            member_count: kjData.total_count || kjData.meta?.total || null,
          };
        }
      }
    } catch (e) {
      log.warn({ module: 'vectr/sync', err: e.message }, 'Kajabi pull failed (non-fatal)');
    }

    // ── Pipeline health ───────────────────────────────────────────────────────
    try {
      result.pipeline = db.getPipelineHealth ? db.getPipelineHealth() : null;
    } catch (_) {}

    // Cache for session use
    db.setVectrSyncCache(result);
    res.json({ ok: true, sync: result });
  } catch (e) {
    log.error({ module: 'vectr/sync', err: e }, 'sync failed');
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/vectr/session ───────────────────────────────────────────────────
router.get('/session', (req, res) => {
  try {
    const messages = db.getVectrSession();
    res.json({ ok: true, messages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/vectr/session ──────────────────────────────────────────────────
router.post('/session', (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  try {
    db.setVectrSession(messages);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/vectr/session ────────────────────────────────────────────────
router.delete('/session', (req, res) => {
  try {
    db.clearVectrSession();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/vectr/chat (SSE) ───────────────────────────────────────────────
// Body: { messages: [{role, content}] }
// Streams Claude as strategic advisor with full context + pushback mechanic.

router.post('/chat', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    const { messages = [] } = req.body;
    if (!messages.length) { send({ type: 'error', error: 'No messages provided' }); return res.end(); }

    const { brand, voiceSummary, creatorName, followerSummary, profile: cp } = getCreatorContext();

    // ── Build platform context block from sync cache ─────────────────────────
    let platformBlock = '';
    const syncCache = db.getVectrSyncCache();
    if (syncCache?.data) {
      const sd = syncCache.data;
      platformBlock = '\n\n## CURRENT PLATFORM DATA\n';
      platformBlock += `_Synced: ${syncCache.updated_at || sd.synced_at || 'recently'}_\n\n`;

      if (sd.youtube) {
        const yt = sd.youtube;
        platformBlock += `**YouTube:** ${Number(yt.avg_views).toLocaleString()} avg views | ${Number(yt.total_views).toLocaleString()} total | ${yt.video_count || '?'} videos\n`;
        if (yt.best_video) {
          platformBlock += `Best: "${yt.best_video.title}" — ${Number(yt.best_video.views).toLocaleString()} views\n`;
        }
        if (yt.recent_videos?.length) {
          platformBlock += `\nRecent videos (newest first):\n`;
          yt.recent_videos.slice(0, 8).forEach(v => {
            platformBlock += `- "${v.title}": ${Number(v.views || 0).toLocaleString()} views, ${Number(v.likes || 0).toLocaleString()} likes, ${Number(v.comments || 0).toLocaleString()} comments\n`;
          });
        }
      }

      if (sd.email?.campaigns?.length) {
        platformBlock += `\n**Email (MailerLite) — last ${sd.email.campaigns.length} campaigns:**\n`;
        sd.email.campaigns.forEach(c => {
          const open  = c.open_rate  != null ? `${(c.open_rate  * 100).toFixed(1)}% open`  : 'no open data';
          const click = c.click_rate != null ? `${(c.click_rate * 100).toFixed(1)}% click` : 'no click data';
          platformBlock += `- "${c.subject}": ${open}, ${click} (${c.total_sent || '?'} sent)\n`;
        });
      }

      if (sd.community?.member_count) {
        platformBlock += `\n**Kajabi community:** ${Number(sd.community.member_count).toLocaleString()} members\n`;
      }
    }

    // ── Strategic Principles from creator-profile.json ───────────────────────
    let principlesBlock = '';
    try {
      const sp = cp?.strategic_principles;
      if (sp) {
        principlesBlock = '\n\n## STRATEGIC PRINCIPLES (hold these as constraints — push back when violated)\n';
        if (sp.core_worldview?.thesis) {
          principlesBlock += `\n**Core Thesis:** ${sp.core_worldview.thesis}\n`;
        }
        if (sp.core_worldview?.intellectual_consistency_test) {
          principlesBlock += `**Consistency Test:** ${sp.core_worldview.intellectual_consistency_test}\n`;
        }
        if (Array.isArray(sp.brand_limits) && sp.brand_limits.length) {
          principlesBlock += `\n**Brand Limits (non-negotiable):**\n`;
          sp.brand_limits.forEach(l => { principlesBlock += `- ${l}\n`; });
        }
        if (sp.creative_consistency) {
          const cc = sp.creative_consistency;
          principlesBlock += `\n**Creative Consistency:**\n`;
          if (cc.voice_model)     principlesBlock += `Voice: ${cc.voice_model}\n`;
          if (cc.villain_structure) principlesBlock += `Villain structure: ${cc.villain_structure}\n`;
          if (cc.failure_framing) principlesBlock += `Framing: ${cc.failure_framing}\n`;
          if (cc.rock_rich_dna)   principlesBlock += `Rock Rich DNA: ${cc.rock_rich_dna}\n`;
        }
        if (sp.content_strategy_constraints) {
          const cs = sp.content_strategy_constraints;
          principlesBlock += `\n**Strategy Constraints:**\n`;
          Object.values(cs).forEach(v => { if (v) principlesBlock += `- ${v}\n`; });
        }
        if (sp.long_term_vision) {
          principlesBlock += `\n**Long-Term Vision:** ${sp.long_term_vision}\n`;
        }
      }
    } catch (_) {}

    // ── Previous locked brief ─────────────────────────────────────────────────
    let prevBriefBlock = '';
    try {
      const active = db.getActiveBrief();
      if (active?.brief_json) {
        const b = active.brief_json;
        prevBriefBlock = '\n\n## LAST LOCKED STRATEGIC BRIEF\n';
        if (b.vector)       prevBriefBlock += `Vector: ${b.vector}\n`;
        if (b.focus)        prevBriefBlock += `Focus: ${b.focus}\n`;
        if (b.constraints)  prevBriefBlock += `Constraints: ${b.constraints}\n`;
        if (b.locked_date)  prevBriefBlock += `Locked: ${b.locked_date}\n`;
      }
    } catch (_) {}

    // ── MirrΩr coaching context ───────────────────────────────────────────────
    let coachBlock = '';
    try {
      const health = db.getGlobalChannelHealth();
      const recent = db.getRecentProjectsWithAnalytics ? db.getRecentProjectsWithAnalytics(10) : [];
      if (health && recent.length) {
        coachBlock = '\n\n## CHANNEL PERFORMANCE CONTEXT\n';
        coachBlock += `Channel average: ${Number(health.avg_views || 0).toLocaleString()} views per video\n`;
        if (health.best_video) {
          coachBlock += `Best performer: "${health.best_video.title}" — ${Number(health.best_video.views || 0).toLocaleString()} views\n`;
        }
        // Identify over/under-performers relative to average
        const avg = health.avg_views || 1;
        const over  = recent.filter(v => v.total_views > avg * 1.5).slice(0, 3);
        const under = recent.filter(v => v.total_views < avg * 0.5 && v.total_views > 0).slice(0, 3);
        if (over.length)  coachBlock += `Over-performing: ${over.map(v => `"${v.title}" (${Number(v.total_views).toLocaleString()})`).join(', ')}\n`;
        if (under.length) coachBlock += `Under-performing: ${under.map(v => `"${v.title}" (${Number(v.total_views).toLocaleString()})`).join(', ')}\n`;
      }
    } catch (_) {}

    // ── Vectr session conduct rules from creator-profile.json ────────────────
    const vsc = cp?.strategic_principles?.vectr_session_conduct;
    const pushbackTriggersText = vsc?.pushback_triggers?.length
      ? vsc.pushback_triggers.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '';

    // ── Build the system prompt ───────────────────────────────────────────────
    const systemPrompt = `You are the strategic advisor for ${creatorName} at ${brand} — ${followerSummary}.

This is a weekly strategic review session. Your role is NOT to be a yes-man. Your role is to hold a position based on data and brand principles, engage in genuine debate, push back when necessary, and ultimately align on a direction that is both strategically sound AND authentic to the creator.

CREATOR VOICE: ${voiceSummary}

HOW THIS SESSION WORKS:
- You open with your read of the current situation based on performance data
- Jason can agree, challenge, redirect, or add lived context
- Debate is the mechanism — you argue from data and principles, he argues from lived experience and creative instinct
- A yield from you requires: evidence of creative opportunity, lived experience that contradicts the data, or a values-based argument. Document the yield in your response.
- Session ends when Jason decides to lock a Strategic Brief — you help draft it

PUSHBACK TRIGGERS — hold your position and argue back when:
${pushbackTriggersText || `1. A short-term tactic contradicts long-term brand positioning
2. A content idea optimizes for algorithm at the expense of authenticity
3. A direction abandons what's proven to work without documented reasoning
4. A decision is driven by emotion/frustration rather than strategy
5. A pivot away from a strong cluster happens without evidence the cluster is saturated
6. A production escalation is proposed without verifying it solves a real audience problem`}

YIELD CONDITIONS: Only yield when Jason presents:
- Lived experience that directly contradicts what the data implies
- A creative opportunity the data cannot see (novelty, timing, cultural moment)
- A values argument — "this violates who I am" is a valid override
- New context that changes the picture

When you yield, say explicitly: "I'm yielding on [point] because [reason]. This means [implication]."

RESPONSE STYLE:
- Direct. Sharp. No corporate hedging.
- Reference specific video titles and real numbers when making arguments
- Short paragraphs. No bullet-point avalanches.
- If you're making a bold recommendation, state it clearly and defend it.
- Ask one focused question per turn — not five.
${platformBlock}${coachBlock}${principlesBlock}${prevBriefBlock}`;

    // ── Stream from Anthropic ─────────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send({ type: 'error', error: 'ANTHROPIC_API_KEY not set' }); return res.end(); }

    const { default: fetch } = await import('node-fetch');
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        stream:     true,
        system:     systemPrompt,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      send({ type: 'error', error: err?.error?.message || `API error ${claudeRes.status}` });
      return res.end();
    }

    const decoder = new (require('util').TextDecoder)();
    let buffer = '';
    for await (const chunk of claudeRes.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            send({ type: 'token', text: evt.delta.text });
          } else if (evt.type === 'message_stop') {
            send({ type: 'done' });
          }
        } catch (_) {}
      }
    }

    res.end();
  } catch (e) {
    log.error({ module: 'vectr/chat', err: e }, 'chat stream failed');
    send({ type: 'error', error: e.message });
    res.end();
  }
});

// ─── POST /api/vectr/brief ────────────────────────────────────────────────────
// Locks the current session as a Strategic Brief.
// Body: { brief_json: { vector, focus, constraints, locked_date, ... }, conversation? }

router.post('/brief', (req, res) => {
  const { brief_json, conversation } = req.body;
  if (!brief_json) return res.status(400).json({ error: 'brief_json required' });
  try {
    // Include locked_date if not provided
    const brief = {
      ...brief_json,
      locked_date: brief_json.locked_date || new Date().toISOString().slice(0, 10),
    };
    // Get current session messages for the conversation snapshot
    const sessionMessages = db.getVectrSession();
    const id = db.insertStrategicBrief({
      platform_context:  db.getVectrSyncCache()?.data || null,
      conversation_json: conversation || sessionMessages,
      brief_json:        brief,
    });
    res.json({ ok: true, id, brief });
  } catch (e) {
    log.error({ module: 'vectr/brief', err: e }, 'brief save failed');
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/vectr/brief/active ─────────────────────────────────────────────
// Returns the current active Strategic Brief for injection into other modules.

router.get('/brief/active', (req, res) => {
  try {
    const brief = db.getActiveBrief();
    res.json({ ok: true, brief });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/vectr/briefs ────────────────────────────────────────────────────
// Returns brief history (id, status, locked_at, brief summary)

router.get('/briefs', (req, res) => {
  try {
    const briefs = db.getAllStrategicBriefs(20);
    res.json({ ok: true, briefs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
