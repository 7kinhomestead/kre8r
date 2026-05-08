/**
 * EditΩr Room — src/routes/editr-room.js
 *
 * A persistent collaborative editing partner that lives alongside AssemblΩr.
 * Knows the beat map, script, voice profile, and assembly choices.
 * Carries context into BrollΩr so b-roll suggestions fit the narrative.
 *
 * Routes:
 *   POST /api/editr-room/chat          — SSE streaming chat
 *   GET  /api/editr-room/session/:pid  — load conversation from kv_store
 *   POST /api/editr-room/session/:pid  — save conversation
 *   DELETE /api/editr-room/session/:pid — clear session
 *   GET  /api/editr-room/context/:pid  — get edit context for BrollΩr injection
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { getCreatorContext } = require('../utils/creator-context');
const { callClaudeStream } = require('../utils/claude');
const { readConfig } = require('../pipr/beat-tracker');
const log = require('../utils/logger');

// ─────────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// Builds a rich context block from the project for Claude to work with.
// ─────────────────────────────────────────────

function buildSystemPrompt(project, piprConfig, writrScript, selects, creatorCtx) {
  const beats     = piprConfig?.beats || [];
  const structure = piprConfig?.story_structure || 'custom';
  const { creatorName, brand, voiceSummary } = creatorCtx;

  // Beat map with assembly status
  let beatBlock = '';
  if (beats.length > 0) {
    beatBlock = '\n\n## BEAT MAP\n';
    for (let i = 0; i < beats.length; i++) {
      const b   = beats[i];
      const sel = selects.find(s => s.section_index === i);
      const seqCount = sel?.selected_takes?.length || 0;
      const takesCount = sel?.takes?.length || 0;
      const note = sel?.assembly_note || '';
      beatBlock += `${i + 1}. **${b.name}** (${b.emotional_function || ''})\n`;
      if (sel) {
        beatBlock += `   → Assembly: ${seqCount} segment(s) from ${takesCount} take(s)`;
        if (note) beatBlock += ` — "${note}"`;
        beatBlock += '\n';
      } else {
        beatBlock += `   → Not yet assembled\n`;
      }
    }
  }

  // WritΩr script excerpt
  let scriptBlock = '';
  if (writrScript?.generated_script) {
    const excerpt = writrScript.generated_script.slice(0, 2000);
    scriptBlock = `\n\n## WRITΩR SCRIPT (excerpt)\n${excerpt}${writrScript.generated_script.length > 2000 ? '\n[...continues...]' : ''}`;
  }

  // Voice profile
  let voiceBlock = '';
  if (voiceSummary) {
    voiceBlock = `\n\n## VOICE PROFILE\n${voiceSummary}`;
  }

  return `You are the EditΩr Room — ${creatorName || brand}'s persistent editing partner for the "${project.title}" video.

You know everything about this edit: the beat map, the assembly choices, the script, the voice. Your job is to be a genuine collaborative partner — not a cheerleader. Think like a seasoned editor who has seen thousands of these cuts.

## YOUR ROLE
- Help Jason think through story and pacing decisions
- Point out when an assembly choice might not serve the story (e.g. fumbled take leading to a key moment, or a strong take being buried)
- Suggest where b-roll would help cover a cut or add breathing room
- Be honest when something isn't working — Jason will listen to pushback that's grounded in the story
- When the conversation moves to BrollΩr, carry the story context with you — your b-roll suggestions should serve the narrative, not just look cool

## WHAT NOT TO DO
- Don't summarize or recap unless asked
- Don't start every response with "Great question!" or any similar corporate filler
- Don't hedge everything — if you have a clear opinion, state it
- Don't write essays. Short, direct, editor-to-editor talk.

## THE EDIT
**Project:** "${project.title}"
**Story Structure:** ${structure}
**Story concept:** ${project.high_concept || project.description || '—'}${beatBlock}${scriptBlock}${voiceBlock}

The creator's rule of thumb: "the story comes out in the edit." Your job is to help find it.`;
}

// ─────────────────────────────────────────────
// LOAD EDIT CONTEXT
// ─────────────────────────────────────────────

async function loadEditContext(projectId) {
  const project = db.getProject(parseInt(projectId));
  if (!project) return null;

  const piprConfig  = readConfig(projectId);
  const selects     = db.getSelectsByProject(projectId);
  const creatorCtx  = getCreatorContext();

  let writrScript = null;
  try { writrScript = db.getApprovedWritrScript(projectId); } catch (_) {}

  return { project, piprConfig, writrScript, selects, creatorCtx };
}

// ─────────────────────────────────────────────
// POST /api/editr-room/chat — SSE streaming
// Body: { project_id, messages: [{role, content}] }
// ─────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    const { project_id, messages = [] } = req.body;
    if (!project_id) { send({ type: 'error', error: 'project_id required' }); return res.end(); }
    if (!messages.length) { send({ type: 'error', error: 'No messages' }); return res.end(); }

    const ctx = await loadEditContext(project_id);
    if (!ctx) { send({ type: 'error', error: `Project ${project_id} not found` }); return res.end(); }

    const { project, piprConfig, writrScript, selects, creatorCtx } = ctx;
    const systemPrompt = buildSystemPrompt(project, piprConfig, writrScript, selects, creatorCtx);

    // Keepalive heartbeat every 20s
    const hb = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 20_000);

    let fullText = '';
    try {
      fullText = await callClaudeStream(
        systemPrompt,
        messages,
        1024,
        (token) => { send({ type: 'token', text: token }); },
        { tool: 'editr-room', timeoutMs: 60_000 }
      );
    } finally {
      clearInterval(hb);
    }

    send({ type: 'done', text: fullText });
    res.end();

  } catch (e) {
    log.error({ err: e }, '[EditΩr Room] Chat error');
    const send2 = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
    send2({ type: 'error', error: e.message });
    if (!res.writableEnded) res.end();
  }
});

// ─────────────────────────────────────────────
// GET /api/editr-room/session/:project_id
// Returns { messages: [...] } from kv_store
// ─────────────────────────────────────────────

router.get('/session/:project_id', (req, res) => {
  try {
    const key  = `editr_room_session_${req.params.project_id}`;
    const data = db.getKv(key);  // getKv auto-parses JSON
    res.json(data || { messages: [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/editr-room/session/:project_id
// Body: { messages: [...] }
// ─────────────────────────────────────────────

router.post('/session/:project_id', (req, res) => {
  try {
    const key = `editr_room_session_${req.params.project_id}`;
    // setKv auto-serializes value
    db.setKv(key, { messages: req.body.messages || [], updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/editr-room/session/:project_id
// ─────────────────────────────────────────────

router.delete('/session/:project_id', (req, res) => {
  try {
    const key = `editr_room_session_${req.params.project_id}`;
    // Use setKv with null to clear (no deleteKv function in db.js)
    db.setKv(key, { messages: [], updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/editr-room/context/:project_id
// Returns a summary of the edit context for BrollΩr injection.
// Called by BrollΩr when generating b-roll prompts.
// ─────────────────────────────────────────────

router.get('/context/:project_id', async (req, res) => {
  try {
    const ctx = await loadEditContext(req.params.project_id);
    if (!ctx) return res.status(404).json({ error: 'Project not found' });

    const { project, piprConfig, selects } = ctx;
    const beats = piprConfig?.beats || [];

    // Build a compact context summary for BrollΩr
    const beatSummary = beats.map((b, i) => {
      const sel = selects.find(s => s.section_index === i);
      return {
        index:             i,
        name:              b.name,
        emotional_function: b.emotional_function || '',
        assembly_note:     sel?.assembly_note || null,
        segments:          sel?.selected_takes?.length || 0,
      };
    });

    res.json({
      project_id:     project.id,
      project_title:  project.title,
      high_concept:   project.high_concept || '',
      story_structure: piprConfig?.story_structure || '',
      beats:          beatSummary,
      // Conversation context (last 3 turns for BrollΩr awareness)
      recent_conversation: (() => {
        try {
          const key  = `editr_room_session_${project.id}`;
          const data = db.getKv(key);  // auto-parsed
          return ((data?.messages) || []).slice(-6); // last 3 pairs
        } catch (_) { return []; }
      })(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
