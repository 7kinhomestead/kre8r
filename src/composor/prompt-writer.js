/**
 * Suno Prompt Writer — src/composor/prompt-writer.js
 *
 * For each scene from the analyzer, asks Claude to write 3 distinct
 * Suno-optimised music generation prompts (variations).
 *
 * Returns:
 * [
 *   { scene_index, scene_label, scene_type, duration_seconds,
 *     generation_index (1|2|3), suno_prompt }
 * ]
 */

'use strict';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL             = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const VARIATION_BRIEFS = [
  'Write the primary interpretation — the most direct realisation of the genre and mood described.',
  'Write an alternative interpretation — same emotional direction but approach the genre from an unexpected angle or subgenre.',
  'Write a stripped-back interpretation — fewer instruments, more space, more intimate. Same mood, more restraint.'
];

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
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

// ─────────────────────────────────────────────
// PROMPT BUILDER — single variation
// ─────────────────────────────────────────────

function buildVariationPrompt(scene, variationIndex) {
  const brief = VARIATION_BRIEFS[variationIndex] || VARIATION_BRIEFS[0];

  return `You are writing a Suno AI music generation prompt for a specific scene in a homesteading and off-grid living YouTube video. You compose like a mix of Danny Elfman, John Williams, and Marco Beltrami — with full eclectic range including hip hop, rock, folk, orchestral, electronic, or any genre that serves the scene.

SCENE DETAILS:
- Label: ${scene.scene_label}
- Type: ${scene.scene_type}
- Emotional direction: ${scene.emotional_direction}
- Energy level: ${scene.energy_level}/10
- Genre direction: ${scene.genre_direction}
- Duration: ${scene.duration_seconds ? `${scene.duration_seconds} seconds` : 'flexible'}

VARIATION BRIEF:
${brief}

SUNO PROMPT RULES:
- Specify instruments concretely ("fingerpicked acoustic guitar" not just "guitar")
- Specify tempo and feel ("slow burn, 72 BPM" or "urgent, driving, 140 BPM")
- Include mood descriptors ("melancholy but resolute", "tense and unresolved", "joyful and free")
- Reference sonic touchstones by describing the STYLE not the artist name ("like an Italian western film score" or "like late-90s East Coast hip hop with a dusty soul sample")
- If duration is relevant, suggest structure ("builds over 30 seconds to full ensemble", "stays sparse throughout")
- Include: INSTRUMENTAL (no vocals, no lyrics)
- Keep the prompt under 400 characters — Suno works best with focused, specific prompts
- Do NOT use specific copyrighted artist names in the output

Return ONLY the Suno prompt text — no explanation, no preamble, no quotes around it.`;
}

// ─────────────────────────────────────────────
// MAIN — writePrompts
// ─────────────────────────────────────────────

async function writePrompts(scenes, onProgress = null) {
  const results = [];

  for (const scene of scenes) {
    onProgress?.({ stage: 'scene_start', scene_label: scene.scene_label, scene_index: scene.scene_index });

    for (let varIdx = 0; varIdx < 3; varIdx++) {
      const genIndex = varIdx + 1;

      onProgress?.({
        stage:            'writing_prompt',
        scene_label:      scene.scene_label,
        generation_index: genIndex
      });

      try {
        const sunoPrompt = await callClaude(buildVariationPrompt(scene, varIdx));

        results.push({
          scene_index:      scene.scene_index,
          scene_label:      scene.scene_label,
          scene_type:       scene.scene_type,
          duration_seconds: scene.duration_seconds || null,
          generation_index: genIndex,
          suno_prompt:      sunoPrompt
        });

        onProgress?.({
          stage:            'prompt_written',
          scene_label:      scene.scene_label,
          generation_index: genIndex,
          prompt_preview:   sunoPrompt.slice(0, 80)
        });

      } catch (err) {
        onProgress?.({
          stage:            'prompt_error',
          scene_label:      scene.scene_label,
          generation_index: genIndex,
          error:            err.message
        });
        // Push placeholder so the track row still exists in DB
        results.push({
          scene_index:      scene.scene_index,
          scene_label:      scene.scene_label,
          scene_type:       scene.scene_type,
          duration_seconds: scene.duration_seconds || null,
          generation_index: genIndex,
          suno_prompt:      null
        });
      }
    }
  }

  return results;
}

module.exports = { writePrompts };
