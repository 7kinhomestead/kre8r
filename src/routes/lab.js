/**
 * Lab Route — src/routes/lab.js
 *
 * GET  /api/lab/projects          — list projects that have approved scripts
 * GET  /api/lab/context/:id       — full project context (script + beatmap + id8r)
 * POST /api/lab/chat              — SSE streaming chat with Claude as creative director
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { callClaudeMessages } = require('../utils/claude');
const { getCreatorContext }  = require('../utils/creator-context');

// ─── GET /api/lab/projects ────────────────────────────────────────────────────
// Returns all kre8r projects with their script status
router.get('/projects', (req, res) => {
  try {
    const projects = db.getKre8rProjects();
    const withScripts = projects.map(p => {
      const script = db.getApprovedWritrScript(p.id);
      return {
        id:            p.id,
        title:         p.title,
        topic:         p.topic,
        high_concept:  p.high_concept,
        has_script:    !!script,
        has_beat_map:  !!(script?.beat_map_json),
        created_at:    p.created_at,
      };
    }).filter(p => p.has_script || p.topic); // show projects with scripts OR at least a topic
    res.json(withScripts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/lab/context/:id ─────────────────────────────────────────────────
// Returns everything Claude needs to know about this project
router.get('/context/:id', (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const project   = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const script    = db.getApprovedWritrScript(projectId);
    const id8rData  = project.id8r_data ? (() => { try { return JSON.parse(project.id8r_data); } catch { return null; } })() : null;

    res.json({
      project: {
        id:           project.id,
        title:        project.title,
        topic:        project.topic,
        high_concept: project.high_concept,
        story_structure: project.story_structure,
        content_type: project.content_type,
      },
      script: script ? {
        full_script:  script.generated_script || script.full_script || null,
        beat_map:     script.beat_map_json || null,
        mode:         script.mode,
      } : null,
      id8r: id8rData ? {
        chosen_concept:   id8rData.chosenConcept || null,
        research_summary: id8rData.researchSummary || null,
      } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/lab/chat ───────────────────────────────────────────────────────
// Body: { project_id, messages: [{role, content}], context_override? }
// SSE stream: Claude responds as creative director with full project context loaded
router.post('/chat', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    const { project_id, messages = [] } = req.body;
    if (!messages.length) { send({ type: 'error', error: 'No messages provided' }); return res.end(); }

    const { brand, voiceSummary, profile: cp } = getCreatorContext();

    // Build project context block
    let projectBlock = '';
    if (project_id) {
      const projectId = parseInt(project_id);
      const project   = db.getProject(projectId);
      if (project) {
        const script   = db.getApprovedWritrScript(projectId);
        const id8rData = project.id8r_data ? (() => { try { return JSON.parse(project.id8r_data); } catch { return null; } })() : null;

        projectBlock = `\n\n## CURRENT PROJECT: "${project.title}"\n`;
        if (project.high_concept) projectBlock += `High Concept: ${project.high_concept}\n`;
        if (project.topic)        projectBlock += `Topic: ${project.topic}\n`;
        if (project.story_structure) projectBlock += `Story Structure: ${project.story_structure}\n`;

        if (id8rData?.chosenConcept) {
          // H1 fix: field is .headline, not .title — .title is always undefined
          const cc = id8rData.chosenConcept;
          projectBlock += `\nChosen Angle: ${cc.headline || cc.title || ''} — ${cc.hook || ''}\n`;
          if (cc.why) projectBlock += `Why it works: ${cc.why}\n`;
        }
        if (id8rData?.researchSummary) {
          projectBlock += `\nResearch Summary:\n${id8rData.researchSummary}\n`;
        }

        // H2 fix: inject VaultΩr footage — LabΩr claimed to know about footage but never read it
        try {
          const footage = db.getFootageByProject ? db.getFootageByProject(projectId) : [];
          const relevant = (footage || [])
            .filter(f => f.shot_type && f.shot_type !== 'archived')
            .slice(0, 40);
          if (relevant.length) {
            projectBlock += `\n## AVAILABLE FOOTAGE (${relevant.length} clips in vault)\n`;
            relevant.forEach(f => {
              const name = f.original_filename || f.file_path?.split(/[\\/]/).pop() || 'clip';
              const vd = f.visual_analyzed_at && f.visual_description
                ? (() => { try { const v = typeof f.visual_description === 'string' ? JSON.parse(f.visual_description) : f.visual_description; const p=[]; if(v.peak_energy_range) p.push(`peak energy ${v.peak_energy_range}`); if(v.physical_demonstration) p.push('physical demo'); return p.length ? ` [${p.join(', ')}]` : ''; } catch(_){return '';} })()
                : '';
              const gold = f.off_script_gold ? ' ⭐ gold moment' : '';
              projectBlock += `- ${name} (${f.shot_type || 'unknown'})${vd}${gold}\n`;
            });
          }
        } catch (_) {}

        if (script) {
          if (script.beat_map_json) {
            projectBlock += `\n## BEAT MAP\n`;
            const beats = Array.isArray(script.beat_map_json) ? script.beat_map_json : (script.beat_map_json.beats || []);
            beats.forEach((b, i) => {
              projectBlock += `Beat ${i + 1}: ${b.name || b.beat_name || ''} — ${b.emotional_function || b.description || ''}\n`;
              if (b.script_notes) projectBlock += `  Notes: ${b.script_notes}\n`;
            });
          }
          const fullScript = script.generated_script || script.full_script || '';
          if (fullScript) {
            projectBlock += `\n## FULL SCRIPT\n${fullScript}\n`;
          }
        }
      }
    }

    // H5 fix: use profile fields instead of hardcoded creator description
    const { niche, followerSummary, contentAnglesText, profile } = getCreatorContext();
    const partnerName = profile?.creator?.partner || 'Cari';
    const contentAnglesBlock = contentAnglesText
      ? `\nCONTENT ANGLES: ${contentAnglesText}` : '';
    const productionConstraints = `\nPRODUCTION CONSTRAINTS: Shoots outdoors only. ${partnerName} operates camera. Single long proxy clip per session. Blackmagic BRAW. No studio, no teleprompter crew.`;

    const systemPrompt = `You are the Creative Director for ${brand} — ${followerSummary}. ${niche || ''}.

CREATOR VOICE: ${voiceSummary}${contentAnglesBlock}${productionConstraints}

Your job is to be a brilliant creative collaborator — available whenever Jason has a question, idea, or creative problem. You know his entire creative pipeline: the script, the beat structure, the research, the angle. You think in visuals, pacing, and emotion. You give direct, actionable answers — not hedged advice.

You help with:
- B-roll ideas specific to beats in the script
- Creative decisions about shoot approach
- Script improvements and additions
- Hook and thumbnail concepts
- Pacing and structure questions
- Ideas that came up during the shoot
- Anything else creative

Be specific. Reference the actual script and beats when relevant. Think like a director who's also a writer who's also done the research. Short, punchy responses unless depth is needed.
${projectBlock}`;

    // Use streaming via the Anthropic API directly for SSE
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { send({ type: 'error', error: 'ANTHROPIC_API_KEY not set' }); return res.end(); }

    const { default: fetch } = await import('node-fetch');
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        stream:     true,
        system:     systemPrompt,
        messages:   messages,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}));
      send({ type: 'error', error: err?.error?.message || `API error ${claudeRes.status}` });
      return res.end();
    }

    // M2 fix: abort upstream fetch when client disconnects — stops wasting tokens
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    // Stream the response token by token
    const reader  = claudeRes.body;
    const decoder = new (require('util').TextDecoder)();
    let buffer = '';
    let doneSent = false;

    for await (const chunk of reader) {
      if (abortController.signal.aborted) break;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete line

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        // M1 fix: tolerant parse — handle both 'data: ' and 'data:' framing
        const raw = line.slice(line.indexOf(':') + 1).trim();
        if (raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            send({ type: 'token', text: evt.delta.text });
          } else if (evt.type === 'message_stop') {
            send({ type: 'done' });
            doneSent = true;
          }
        } catch (_) {}
      }
    }

    // M1 fix: flush trailing buffer + guarantee done event
    if (buffer.trim()) {
      const raw = buffer.startsWith('data:') ? buffer.slice(buffer.indexOf(':') + 1).trim() : '';
      if (raw && raw !== '[DONE]') {
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            send({ type: 'token', text: evt.delta.text });
          }
        } catch (_) {}
      }
    }
    if (!doneSent && !res.writableEnded) send({ type: 'done' });

    res.end();
  } catch (e) {
    console.error('[lab/chat]', e);
    send({ type: 'error', error: e.message });
    res.end();
  }
});

module.exports = router;
