/**
 * ClipsΩr Engine — src/vault/clipsr.js
 *
 * Takes a completed/final video transcript and asks Claude to identify
 * the best viral clip candidates for TikTok/Reels/Shorts distribution.
 *
 * Different from CutΩr:
 * - CutΩr: editing tool, works with script, outputs cuts for DaVinci
 * - ClipsΩr: distribution tool, works on finished video, outputs social posts
 */

'use strict';

const { callClaude }        = require('../utils/claude');
const { getCreatorContext } = require('../utils/creator-context');

function buildClipsPrompt({ transcript, footageMeta }) {
  const { brand, followerSummary, niche } = getCreatorContext();

  const transcriptText = transcript.segments
    .map(s => `[${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s] ${s.text}`)
    .join('\n');

  const metaSection = footageMeta
    ? `SOURCE VIDEO: ${footageMeta.filename} | Duration: ${footageMeta.duration}s | Type: ${footageMeta.shot_type || 'completed-video'}\n`
    : '';

  return `You are ClipsΩr, a viral clip extraction AI for ${brand} — a ${niche} channel with ${followerSummary}.

${metaSection}
## TASK

Analyze this completed video transcript and identify the 3–6 best moments to extract as standalone short-form clips for TikTok, Instagram Reels, and YouTube Shorts.

A great clip:
- Works without watching the full video (self-contained story or moment)
- Has a scroll-stopping first 3 seconds (surprising, emotional, funny, or counterintuitive)
- Is ideally 30–90 seconds (exceptions for very strong 15s or 2min clips)
- Has a clear arc or punchline — a reason to watch to the end
- Reflects the creator's authentic voice, not a polished TV moment

## TRANSCRIPT
${transcriptText}

## OUTPUT FORMAT

Return ONLY valid JSON — no markdown, no code fences, no explanation:

{
  "clips": [
    {
      "rank": 1,
      "start": 42.5,
      "end": 89.3,
      "duration": 46.8,
      "clip_type": "gold",
      "hook": "The exact first words/moment — what stops the scroll in the first 3 seconds",
      "hook_overlay": "Text overlay for the first frame (max 8 words, bold statement or question)",
      "why_it_works": "One paragraph — why this moment works as a standalone clip, what emotion it triggers, why someone would share it",
      "caption": "Full TikTok/Reels caption ready to post — natural voice, no corporate speak. Include a question or CTA at the end.",
      "hashtags": "#homestead #offgrid #7kinhomestead #rockrich",
      "platform_fit": {
        "tiktok": 9,
        "reels": 8,
        "shorts": 7
      }
    }
  ],
  "overall_assessment": "One paragraph — how this video performs overall for short-form repurposing, what angles are strongest"
}

clip_type options: "gold" (best clip, shareworthy), "social" (strong clip), "retention" (good but requires context)
platform_fit: score 1-10 for each platform
rank 1 = strongest clip overall

IMPORTANT: The creator's community is called "Rock Rich" — Whisper sometimes transcribes it as "Rockridge". Always write "Rock Rich" in hooks, captions, and all output.`;
}

async function analyzeForClips({ transcript, footageMeta, onProgress }) {
  if (onProgress) onProgress({ step: 'analyzing', message: 'Claude is finding the gold...' });

  const prompt = buildClipsPrompt({ transcript, footageMeta });

  // callClaude already parses the JSON response — analysis is a plain object
  let analysis;
  try {
    analysis = await callClaude(prompt, 4096);
  } catch (err) {
    return { ok: false, error: `Claude API error: ${err.message}` };
  }

  if (!analysis || !Array.isArray(analysis.clips)) {
    return { ok: false, error: 'No clips array in Claude response', raw: JSON.stringify(analysis).slice(0, 500) };
  }

  return {
    ok: true,
    clips: analysis.clips,
    overall_assessment: analysis.overall_assessment || ''
  };
}

module.exports = { analyzeForClips };
