/**
 * Scene Analyzer — src/composor/scene-analyzer.js
 *
 * Reads script sections (selects table) and CutΩr analysis (cuts table)
 * for a project, then asks Claude to identify distinct musical scenes
 * with emotional direction, genre, and energy level.
 *
 * Output: array of scene objects ready for the prompt writer.
 */

'use strict';

const db = require('../db');

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const COMPOSER_PERSONA = `You are a world-class film composer — a mix of Danny Elfman (dark quirky whimsy, memorable themes, orchestral storytelling), John Williams (sweeping emotional orchestration, heroic builds, musical motifs that carry meaning), and Marco Beltrami (tension, suspense, modern hybrid scoring). You are also eclectic and unafraid — if a scene calls for hip hop, it gets hip hop. If it calls for hard rock, it gets hard rock. If it calls for warm acoustic folk, it gets that. The music always serves the scene first, genre second.`;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function fmtTs(s) {
  if (s == null) return '?';
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

// ─────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────

function buildAnalysisPrompt({ sections, cuts, overallNotes, projectTitle }) {
  const sectionsText = sections.length > 0
    ? sections.map((s, i) => {
        const takes = (s.takes || []).map(t =>
          t.transcript_excerpt ? `"${t.transcript_excerpt}"` : t.filename
        ).join('; ');
        return `  ${i + 1}. ${s.script_section}${s.gold_nugget ? ' [GOLD NUGGET]' : ''}${takes ? ` — ${takes}` : ''}`;
      }).join('\n')
    : '  (No selects data — reason from cuts analysis only)';

  const socialClips = cuts.filter(c => c.cut_type === 'social').sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const clipsText = socialClips.length > 0
    ? socialClips.map(c =>
        `  Clip ${c.rank || '?'}: ${fmtTs(parseFloat(c.start_timestamp))}→${fmtTs(parseFloat(c.end_timestamp))} — ${c.description || 'no description'}`
      ).join('\n')
    : '  (No social clips identified yet)';

  const ctaCut = cuts.find(c => c.cut_type === 'CTA');
  const ctaText = ctaCut
    ? `CTA moment at ${fmtTs(parseFloat(ctaCut.start_timestamp))}`
    : 'No CTA identified';

  return `${COMPOSER_PERSONA}

You are scoring a homesteading and off-grid living video for 7 Kin Homestead — a creator whose content covers financial independence, self-sufficient living, and opting out of the broken system. Their audience values authenticity, real numbers, and genuine personality.

## VIDEO: ${projectTitle || 'Untitled'}

## SCRIPT SECTIONS (from editorial selects):
${sectionsText}

## KEY MOMENTS (from transcript analysis):
${clipsText}
${ctaText}

${overallNotes ? `## OVERALL CONTENT NOTES:\n${overallNotes}\n` : ''}
## YOUR TASK

Identify distinct musical scenes — moments where the emotional tone or energy shifts enough to warrant different music. A typical 8-15 minute YouTube video has 4-8 scenes.

For each scene:
- scene_label: short descriptive name (e.g. "Opening hook", "The problem revealed", "Emotional payoff")
- scene_type: one of exactly: intro | buildup | emotional | practical | tension | payoff | cta | outro
- emotional_direction: what the music needs to make the viewer FEEL (be specific and evocative)
- energy_level: 1-10 (1=whisper quiet, 10=full orchestral/beat drop)
- duration_seconds: estimated duration from section timestamps or clip lengths
- genre_direction: be specific and bold — not just "orchestral" but "sparse acoustic fingerpicking with melancholy cello undertones" or "driving hip hop beat with dusty sample feel and warm low-end" or "full orchestral swell, heroic theme, ascending brass"
- start_hint: approximate start reference (e.g. "Opening / intro section" or "After the cost reveal moment")

## OUTPUT FORMAT

Return ONLY a valid JSON array — no markdown, no explanation, no code fences:

[
  {
    "scene_label": "The Hook",
    "scene_index": 0,
    "scene_type": "intro",
    "emotional_direction": "Curiosity mixed with quiet determination — the viewer should lean in",
    "energy_level": 4,
    "duration_seconds": 45,
    "genre_direction": "Sparse acoustic fingerpicking, slight reverb, unhurried. Like a Western film opening but warmer.",
    "start_hint": "Opening of video"
  }
]

Be decisive. If you're unsure between two scenes, merge them. Aim for 4-7 scenes. scene_index must be sequential starting from 0.`;
}

// ─────────────────────────────────────────────
// CALL CLAUDE
// ─────────────────────────────────────────────

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: fetch } = await import('node-fetch');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data    = await response.json();
  const raw     = data.content[0].text.trim();
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(
      `Claude returned malformed JSON: ${parseErr.message}. ` +
      `First 300 chars: ${cleaned.slice(0, 300)}`
    );
  }
}

// ─────────────────────────────────────────────
// MAIN — analyzeScenes
// ─────────────────────────────────────────────

async function analyzeScenes(projectId, onProgress = null) {
  const project = db.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  onProgress?.({ stage: 'start', project: project.title });

  // Pull selects (editorial sections)
  const sections = db.getSelectsByProject(projectId);
  onProgress?.({ stage: 'data_loaded', sections: sections.length });

  // Pull cuts (CutΩr analysis)
  const cuts         = db.getCutsByProject(projectId);
  const overallNotes = cuts.find(c => c.overall_notes)?.overall_notes || null;

  onProgress?.({ stage: 'claude_start' });

  const prompt = buildAnalysisPrompt({
    sections,
    cuts,
    overallNotes,
    projectTitle: project.title
  });

  const scenes = await callClaude(prompt);

  if (!Array.isArray(scenes)) {
    throw new Error('Claude returned unexpected structure — expected JSON array of scenes');
  }

  // Normalise scene_index to be sequential 0-based
  scenes.forEach((s, i) => { s.scene_index = i; });

  onProgress?.({ stage: 'analysis_done', scenes: scenes.length });

  return scenes;
}

module.exports = { analyzeScenes };
