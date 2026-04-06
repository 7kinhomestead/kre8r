/**
 * Generate routes — /api/generate
 * Proxies all Claude API calls server-side.
 * API key lives in .env, never touches the browser.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { getCreatorContext, getCommunityBlock } = require('../utils/creator-context');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';

async function callClaude(systemPrompt, userPrompt, maxTokens = 4000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in environment');

  const { default: fetch } = await import('node-fetch');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

function parseJson(text) {
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

function fmtTs(s) {
  s = parseFloat(s);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

// ─────────────────────────────────────────────
// POST /api/generate/packages — M2 PackageΩr
// ─────────────────────────────────────────────
router.post('/packages', async (req, res) => {
  try {
    const {
      project_id,
      youtube_url,
      youtube_video_id,
      topic,
      goal,
      angles,
      extra_context
    } = req.body;

    const { brand, followerSummary, communityName, voiceSummary, profile: cp } = getCreatorContext();
    const communityBlock = getCommunityBlock();
    const cpAngles = cp?.content_angles || {};

    const angleDescriptions = Object.fromEntries(
      Object.entries(cpAngles).map(([k, a]) => [k, `${(a.label || k).toUpperCase()}: ${a.description || ''}`])
    );

    const goalMap = {
      grow:      'Grow the audience — titles and hooks that attract new subscribers',
      community: `Drive to ${communityName} community — build desire for the paid community`,
      evergreen: 'Build evergreen archive — search-optimised, timeless value',
      viral:     'Maximize viral potential — hooks and formats that get shared'
    };

    const activeAngles = (angles || ['financial', 'system', 'rockrich'])
      .map(a => angleDescriptions[a]).filter(Boolean).join('\n\n');

    const systemPrompt = `You are the content strategist for ${brand} — ${followerSummary}, and a paid Kajabi community called ${communityName}.

CREATOR VOICE:
${voiceSummary}

COMMUNITY:
${communityBlock}

CONTENT ANGLES AVAILABLE:
${activeAngles}

PRIMARY GOAL FOR THIS VIDEO:
${goalMap[goal] || goalMap.grow}

OUTPUT FORMAT — valid JSON only, no preamble, no markdown fences:
{
  "packages": [
    {
      "number": 1,
      "title": "YouTube title here",
      "hook": "TikTok/short-form hook — the first line that stops the scroll",
      "rationale": "2-3 sentences on why this angle works for this content and audience",
      "thumbnail_concept": "Detailed thumbnail description — what's in frame, text overlay, creator expression",
      "youtube_description": "150-220 word YouTube description with natural keyword placement, CTA to ${communityName} community"
    }
  ]
}

Generate exactly 5 packages. Each must be a distinct angle — not variations of the same idea.`;

    let userPrompt = `Generate 5 content packages for this ${brand} video.\n\n`;
    if (youtube_url) userPrompt += `YouTube URL: ${youtube_url}\n`;
    if (youtube_video_id) userPrompt += `Video ID: ${youtube_video_id}\n`;
    if (topic) userPrompt += `Video topic: ${topic}\n`;
    if (extra_context) userPrompt += `Creator direction: ${extra_context}\n`;

    // Inject CutΩr approved clips if project has been through ReviewΩr
    if (project_id) {
      const allCuts = db.getCutsByProject(parseInt(project_id));
      const approvedClips = allCuts
        .filter(c => c.cut_type === 'social' && c.approved)
        .sort((a, b) => (a.rank || 99) - (b.rank || 99));

      if (approvedClips.length > 0) {
        userPrompt += `\nCUTΩR ANALYSIS — APPROVED CLIPS FROM TRANSCRIPT:\n`;
        userPrompt += `The following clips have been identified as the strongest moments in this video by transcript analysis. Build all 5 packages around these specific moments — each package should lead with one of these clips as the primary hook:\n\n`;
        approvedClips.forEach((clip, i) => {
          const ts = clip.start_timestamp != null
            ? `${fmtTs(clip.start_timestamp)} → ${fmtTs(clip.end_timestamp)}`
            : 'timestamp unknown';
          userPrompt += `[CLIP ${i + 1}${clip.rank != null ? ` — ranked #${clip.rank}` : ''}]\n`;
          userPrompt += `Timestamp: ${ts}\n`;
          userPrompt += `Description: "${clip.description}"\n`;
          if (clip.reasoning) userPrompt += `Why it works: ${clip.reasoning}\n`;
          userPrompt += '\n';
        });
      }
    }

    // Inject approved WritΩr script if available — gives PackageΩr the actual script content
    if (project_id) {
      const script = db.getApprovedWritrScript(parseInt(project_id));
      const scriptText = script?.generated_script || script?.full_script || '';
      if (scriptText) {
        userPrompt += `\nAPPROVED SCRIPT:\n${scriptText}\n`;
      }
    }

    userPrompt += `\nGenerate all 5 packages now. JSON only.`;

    const rawText = await callClaude(systemPrompt, userPrompt, 4000);
    const parsed = parseJson(rawText);
    const packages = parsed.packages;

    // Create or update project
    let projectId = project_id ? parseInt(project_id) : null;
    if (!projectId) {
      const project = db.createProject(
        topic || 'Untitled Video',
        topic,
        youtube_url,
        youtube_video_id
      );
      projectId = project.id;
    } else {
      // Update youtube info if provided
      if (youtube_url || topic) {
        db.updateProjectMeta(projectId, { youtube_url, youtube_video_id, topic });
      }
    }

    db.savePackages(projectId, packages);

    res.json({ project_id: projectId, packages });
  } catch (err) {
    console.error('[generate/packages]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/generate/captions — M3 CaptionΩr
// ─────────────────────────────────────────────
router.post('/captions', async (req, res) => {
  try {
    const {
      project_id,
      video_title,
      package_title,
      content_angle,
      caption_direction,
      clips
    } = req.body;

    if (!clips || clips.length === 0) {
      return res.status(400).json({ error: 'At least one clip is required' });
    }

    const { brand: captBrand, followerSummary: captFs, profile: captCp } = getCreatorContext();
    const captAngles = captCp?.content_angles || {};
    const angleMap = Object.fromEntries(
      Object.entries(captAngles).map(([k, a]) => [k, `${a.label || k} — ${a.description || ''}`])
    );

    const systemPrompt = `You are the social media voice for ${captBrand} — ${captFs}.

CREATOR VOICE: Straight-talking, warm, encouraging, genuinely funny. Never corporate. Slips jokes in. Real numbers always.

PLATFORM RULES:
- TikTok: Hook in the first line. Punchy, fast, scroll-stopping. 2-3 hashtags max. Under 300 characters total.
- Instagram Reels: Warm, save-worthy. Ask a question or give a clear CTA. 5-8 hashtags at the end. 150-250 characters.
- Facebook: Conversational and community-driven. 3-5 short paragraphs. "Comment X for the link" format works well. 0-2 hashtags.
- YouTube Shorts: Search-aware. Include the main topic keyword naturally in the first sentence. 2-3 sentences + 3-5 hashtags.
- Lemon8: Visual storytelling and lifestyle vibe. More descriptive than TikTok. Lists and "here's what I learned" structure. 5-8 hashtags.

OUTPUT FORMAT — valid JSON only, no preamble, no markdown fences:
{
  "clips": [
    {
      "clip_id": "1",
      "timestamp": "0:00 – 0:00",
      "captions": {
        "tiktok": "caption text",
        "instagram": "caption text",
        "facebook": "caption text",
        "shorts": "caption text",
        "lemon8": "caption text"
      }
    }
  ]
}`;

    const clipLines = clips.map(c =>
      `CLIP ${c.id}${c.timestamp ? ` (${c.timestamp})` : ''}: ${c.description}`
    ).join('\n');

    let userPrompt = `Generate platform-native captions for the following clips.\n\n`;
    userPrompt += `Video Title: ${video_title || 'Untitled'}\n`;
    if (package_title) userPrompt += `Selected Package Title (tone anchor): ${package_title}\n`;
    if (content_angle) userPrompt += `Content Angle: ${angleMap[content_angle] || content_angle}\n`;
    if (caption_direction) userPrompt += `Creator Direction: ${caption_direction}\n`;

    // Inject approved WritΩr script if available — gives CaptionΩr the actual script content
    if (project_id) {
      const script = db.getApprovedWritrScript(parseInt(project_id));
      const scriptText = script?.generated_script || script?.full_script || '';
      if (scriptText) {
        userPrompt += `\nAPPROVED SCRIPT:\n${scriptText}\n`;
      }
    }

    userPrompt += `\nCLIPS:\n${clipLines}\n\nWrite all 5 platform captions for each clip. JSON only.`;

    const rawText = await callClaude(systemPrompt, userPrompt, 5000);
    const parsed = parseJson(rawText);

    // Save to DB if project_id provided
    if (project_id) {
      const clipsWithTimestamps = parsed.clips.map((c, i) => ({
        ...c,
        timestamp: clips[i]?.timestamp || '',
        description: clips[i]?.description || ''
      }));
      db.saveCaptions(parseInt(project_id), clipsWithTimestamps);
    }

    res.json({ project_id: project_id || null, clips: parsed.clips });
  } catch (err) {
    console.error('[generate/captions]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/generate/emails — M4 MailΩr
// ─────────────────────────────────────────────
router.post('/emails', async (req, res) => {
  try {
    const {
      project_id,
      video_title,
      package_title,
      content_angle,
      video_url,
      key_moments,
      next_video,
      live_offer,
      community_event,
      email_direction,
      tiers
    } = req.body;

    const activeTiers = tiers || ['greenhouse', 'garden', 'founding'];

    const { brand: emailBrand, followerSummary: emailFs, communityName: emailComm, voiceSummary: emailVoice, profile: emailCp } = getCreatorContext();
    const emailAnglesCp = emailCp?.content_angles || {};
    const angleMap = Object.fromEntries(
      Object.entries(emailAnglesCp).map(([k, a]) => [k, `${a.label || k} — ${a.description || ''}`])
    );
    const emailCommunityBlock = getCommunityBlock();

    const systemPrompt = `You are the email strategist and copywriter for ${emailBrand} — ${emailFs}, and a paid community called ${emailComm} on Kajabi.

${emailCommunityBlock}

CREATOR VOICE:
${emailVoice} Plain text only — no markdown, no asterisks, no symbols.

EMAIL STRATEGY:
- Day 0: Everyone gets the same email. One job: get them to watch the video. Short, warm, feels like a personal heads-up not a newsletter blast.
- Day 3 (Greenhouse): Value-add related to the video topic. One useful thing they can act on. End with a soft, natural nudge toward joining The Garden — frame it as "more of this."
- Day 3 (Garden): Deeper context or behind-the-scenes insight from the video. Reward their paid status. Make them feel like they're getting the version nobody else gets.
- Day 3 (Founding 50): Even more insider. Could be a personal note style. Acknowledge they're the inner circle. Give them something — a thought, a resource, a question — that feels exclusive.
- Day 7 (Greenhouse): The soft pitch. Video as proof of what they get. Invitation to join The Garden. Not pushy — feels like a friend saying "hey you should really come to this thing."
- Day 7 (Garden): Tease the next video. Reinforce they're in the right place. Maybe a question or prompt related to the video topic to spark community engagement.
- Day 7 (Founding 50): Full insider energy. What's coming. What they'll get first. Feels like a personal update from the creator to their most committed people.

OUTPUT FORMAT — valid JSON only, no preamble, no markdown fences:
{
  "day0": { "everyone": { "subject": "Subject line here", "body": "Full email body" } },
  "day3": {
    "greenhouse": { "subject": "Subject line", "body": "Email body" },
    "garden":     { "subject": "Subject line", "body": "Email body" },
    "founding":   { "subject": "Subject line", "body": "Email body" }
  },
  "day7": {
    "greenhouse": { "subject": "Subject line", "body": "Email body" },
    "garden":     { "subject": "Subject line", "body": "Email body" },
    "founding":   { "subject": "Subject line", "body": "Email body" }
  }
}`;

    let userPrompt = `Generate a full email sequence for this video.\n\n`;
    userPrompt += `Video Title: ${video_title || 'Untitled'}\n`;
    if (package_title) userPrompt += `Package Title (the angle we led with): ${package_title}\n`;
    if (content_angle) userPrompt += `Content Angle: ${angleMap[content_angle] || content_angle}\n`;
    if (video_url) userPrompt += `YouTube URL: ${video_url}\n`;
    if (key_moments) userPrompt += `Key moments and insights: ${key_moments}\n`;
    if (next_video) userPrompt += `Next video coming (for Day 7 tease): ${next_video}\n`;
    if (live_offer) userPrompt += `Live offer or deadline to mention: ${live_offer}\n`;
    if (community_event) userPrompt += `Upcoming community event: ${community_event}\n`;
    if (email_direction) userPrompt += `Creator direction: ${email_direction}\n`;
    userPrompt += `Tiers to write for (Day 3 and Day 7): ${activeTiers.join(', ')}\n`;
    userPrompt += `\nWrite all emails now. JSON only.`;

    const rawText = await callClaude(systemPrompt, userPrompt, 6000);
    const parsed = parseJson(rawText);

    // Save to DB if project_id provided
    if (project_id) {
      db.saveEmails(parseInt(project_id), parsed);
    }

    res.json({ project_id: project_id || null, emails: parsed });
  } catch (err) {
    console.error('[generate/emails]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
