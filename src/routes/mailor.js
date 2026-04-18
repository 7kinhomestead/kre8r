/**
 * MailΩr Route — src/routes/mailor.js
 *
 * POST /api/mailor/broadcast  — single prompt → A/B emails in blended voice
 * POST /api/mailor/sequence   — full tier sequence (upgraded from generate.js)
 * GET  /api/mailor/kajabi/status — check if Kajabi API key is configured
 * POST /api/mailor/kajabi/send   — send via Kajabi (if key exists)
 */

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { buildVoiceSummaryFromProfiles } = require('../writr/voice-analyzer');
const { getSocialLinksBlock } = require('../utils/creator-context');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadProfile() {
  const p = path.join(__dirname, '../../creator-profile.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getKajabiKey() {
  return process.env.KAJABI_API_KEY || null;
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 4000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const { default: fetch } = await import('node-fetch');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method  : 'POST',
    headers : {
      'Content-Type'      : 'application/json',
      'x-api-key'         : apiKey,
      'anthropic-version' : '2023-06-01',
    },
    body: JSON.stringify({
      model      : process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens : maxTokens,
      system     : systemPrompt,
      messages   : [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API ${response.status}`);
  }
  const data    = await response.json();
  if (data.stop_reason === 'max_tokens') {
    throw new Error(`Response too long for token budget (${maxTokens}). Try unchecking Blog Post or Community Post and generating separately.`);
  }
  const raw     = data.content[0].text.trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch(e) {
    // Claude sometimes emits unescaped newlines or straight quotes inside JSON string values.
    // jsonrepair handles the full class of these issues robustly.
    try {
      const { jsonrepair } = require('jsonrepair');
      return JSON.parse(jsonrepair(cleaned));
    } catch(e2) {
      throw new Error(`Claude returned malformed JSON. First 300 chars: ${cleaned.slice(0,300)}`);
    }
  }
}

function buildTierContext(profile) {
  const tiers        = profile?.community?.tiers || {};
  const communityName = profile?.community?.name || 'Community';
  const lines = [`${communityName} COMMUNITY TIERS:`];
  if (tiers.greenhouse)  lines.push(`- ${tiers.greenhouse.label || 'Greenhouse'} (${tiers.greenhouse.price || 'Free'}): ${tiers.greenhouse.description || 'Free members — curious, not yet committed. Goal: convert to paid tier.'}`);
  if (tiers.garden)      lines.push(`- ${tiers.garden.label || 'Garden'} (${tiers.garden.price || '$19/mo'}): ${tiers.garden.description || 'Paid members. Reward their commitment. Make them glad they joined.'}`);
  if (tiers.founding_50) lines.push(`- ${tiers.founding_50.label || 'Founding 50'} (${tiers.founding_50.price || '$297 one-time'}): ${tiers.founding_50.description || 'Inner circle. Limited spots. Insider tone. Early access energy.'}`);
  return lines.join('\n');
}

function buildVoiceContext(profile, voiceProfiles) {
  // If voice profiles passed in, use blend logic from WritΩr
  if (voiceProfiles && voiceProfiles.length > 0) {
    return buildVoiceSummaryFromProfiles(profile, voiceProfiles);
  }
  // Fall back to profile default voice
  const v = profile?.voice;
  if (!v) return 'Straight-talking, warm, funny, never corporate. Plain text only.';
  return [
    v.summary,
    `Never: ${(v.never || []).join(', ')}`,
    'Plain text only — no markdown, no asterisks, no bullet symbols.',
  ].join('\n');
}

function buildSegmentList(profile) {
  // Core segments + any future ones added to profile
  const base = [
    { id: 'everyone',    label: 'Everyone (full list)' },
    { id: 'greenhouse',  label: 'Greenhouse (free members)' },
    { id: 'garden',      label: 'Garden ($19/mo)' },
    { id: 'founding',    label: 'Founding 50 ($297)' },
  ];
  // Merge any custom segments from profile
  const custom = profile?.email_segments || [];
  return [...base, ...custom];
}

// ─── GET /api/mailor/kajabi/status ────────────────────────────────────────────

router.get('/kajabi/status', (req, res) => {
  const key = getKajabiKey();
  res.json({ connected: !!key });
});

// ─── GET /api/mailor/segments ─────────────────────────────────────────────────

router.get('/segments', (req, res) => {
  try {
    const profile  = loadProfile();
    const segments = buildSegmentList(profile);
    res.json({ segments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/mailor/broadcast ───────────────────────────────────────────────
// Single prompt → A/B email pair in blended voice

router.post('/broadcast', async (req, res) => {
  try {
    const {
      prompt,           // what this email is about
      segment,          // who it's going to
      goal,             // what you want them to do
      voice_primary,    // voice profile name
      voice_secondary,  // optional second voice
      voice_blend,      // 10–90, primary weight
      project_id,       // optional
      gen_email,        // boolean — generate A/B email pair
      gen_blog,         // boolean — generate blog post
      gen_community,    // boolean — generate community post
      gen_fb_post,      // boolean — generate Facebook text/image post
    } = req.body;

    console.log('[mailor/broadcast] flags:', { gen_email, gen_blog, gen_community });

    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const profile = loadProfile();

    // Build voice blend
    const voiceProfiles = [];
    const allProfiles   = profile.voice_profiles || [];

    if (voice_primary) {
      const vp = allProfiles.find(v => v.name === voice_primary);
      if (vp) voiceProfiles.push({ profile: vp, weight: parseInt(voice_blend) || 70 });
    }
    if (voice_secondary) {
      const vs = allProfiles.find(v => v.name === voice_secondary);
      if (vs) voiceProfiles.push({ profile: vs, weight: 100 - (parseInt(voice_blend) || 70) });
    }

    const voiceContext = buildVoiceContext(profile, voiceProfiles);
    const tierContext  = buildTierContext(profile);

    const brand        = profile?.creator?.brand    || 'the creator';
    const communityNm  = profile?.community?.name   || 'the community';
    const followerStr  = (() => {
      const p = profile?.platforms || {};
      const parts = [];
      if (p.tiktok?.followers)    parts.push(`${Math.round(p.tiktok.followers/1000)}k TikTok`);
      if (p.youtube?.subscribers) parts.push(`${Math.round(p.youtube.subscribers/1000)}k YouTube`);
      return parts.join(', ');
    })();

    const systemPrompt = `You are the email copywriter for ${brand} — a creator with ${followerStr}, and a paid community called ${communityNm} on Kajabi.

${tierContext}

VOICE:
${voiceContext}

RULES:
- Output the email body as HTML, not plain text. Use <p> tags for paragraphs, <br> for line breaks, <a href="URL"> for links. No markdown, no asterisks, no bullet symbols.
- Write like a real person sending a personal email, not a newsletter blast.
- Short, punchy subject lines — no clickbait, no ALL CAPS gimmicks.
- Every email has one job. One CTA. Don't pile on.
- A/B means meaningfully different approaches — not just different subject lines. Different angle, different entry point, different emotional hook.
- Use {$name} once near the top of each email as the greeting. This is MailerLite's native merge tag for first name.`;

    let userPrompt = `Write an A/B broadcast email pair for this situation:\n\nPrompt: ${prompt}\nSegment: ${segment || 'everyone'}\nGoal: ${goal || 'not specified'}\n`;

    // ── Social links (always injected — never ask Jason for his own links) ───────
    const { plaintext: socialLinksPlain, html: socialLinksHtml } = getSocialLinksBlock();
    const socialBlock = `\nSOCIAL LINKS (use these exact URLs — never make up links):\n${socialLinksPlain}\n`;

    // ── Build shared project context block (reused across email, blog, community) ──
    let projectContextBlock = '';
    let viralClipsBlock = '';
    let transcriptBlock = '';
    let researchBlock = '';
    let citationsBlock = '';
    let citationsHtml = '';
    let packageBlock = '';

    if (project_id) {
      const pid = parseInt(project_id);
      const proj   = db.getProject(pid);
      const script = db.getApprovedWritrScript(pid);

      if (proj || script) {
        projectContextBlock += `\nPROJECT CONTEXT:\n`;
        if (proj?.title)         projectContextBlock += `Title: ${proj.title}\n`;
        if (proj?.content_angle) projectContextBlock += `Content Angle: ${proj.content_angle}\n`;
        if (proj?.high_concept)  projectContextBlock += `High Concept: ${proj.high_concept}\n`;
        const scriptText = script?.generated_script || script?.full_script || '';
        if (scriptText)          projectContextBlock += `Script (first 500 chars): ${scriptText.slice(0, 500)}\n`;
      }

      // Id8Ωr research — the "why this matters" argument, research findings, concept rationale
      if (proj?.id8r_data) {
        try {
          const id8r = typeof proj.id8r_data === 'string' ? JSON.parse(proj.id8r_data) : proj.id8r_data;
          researchBlock += `\nPRE-PRODUCTION RESEARCH (use this to validate the argument — the "why this matters"):\n`;
          if (id8r.chosenConcept?.title)       researchBlock += `Chosen Concept: ${id8r.chosenConcept.title}\n`;
          if (id8r.chosenConcept?.hook)        researchBlock += `Original Hook: ${id8r.chosenConcept.hook}\n`;
          if (id8r.researchSummary)            researchBlock += `Research Findings: ${String(id8r.researchSummary).slice(0, 800)}\n`;
          if (id8r.briefData?.visionStatement) researchBlock += `Vision: ${id8r.briefData.visionStatement}\n`;

          // Citations — credible sources for blog backlinks and argument validation
          if (Array.isArray(id8r.citations) && id8r.citations.length > 0) {
            citationsBlock = `\nCREDIBLE SOURCES TO CITE:\n`;
            id8r.citations.forEach((c, i) => {
              citationsBlock += `[${i + 1}] ${c.title} — ${c.key_stat || ''}\n    URL: ${c.url}\n`;
            });
            // HTML version for blog post backlinks
            citationsHtml = id8r.citations.map((c, i) =>
              `<li><a href="${c.url}" target="_blank" rel="noopener">${c.title}</a>${c.key_stat ? ' — ' + c.key_stat : ''}</li>`
            ).join('\n');
          }
        } catch(e) { /* bad JSON, skip */ }
      }

      // Selected package from PackageΩr
      const pkg = db.getSelectedPackage(pid) || (db.getPackages(pid) || [])[0];
      if (pkg) {
        packageBlock += `\nPACKAGEΩR — SELECTED CONTENT ANGLE:\n`;
        packageBlock += `Package Title: ${pkg.title}\n`;
        if (pkg.hook)      packageBlock += `Hook: ${pkg.hook}\n`;
        if (pkg.rationale) packageBlock += `Rationale: ${String(pkg.rationale).slice(0, 300)}\n`;
      }

      // ClipsΩr approved viral clips
      const viralClips = db.getApprovedViralClipsByProject(pid);
      if (viralClips.length > 0) {
        viralClipsBlock += `\nCLIPSΩR APPROVED HOOKS (strongest moments the creator approved — lead with these):\n`;
        viralClips.slice(0, 3).forEach((clip, i) => {
          viralClipsBlock += `[Clip ${i + 1}${clip.clip_type === 'gold' ? ' — GOLD' : ''}] Hook: "${clip.hook}"\n`;
          if (clip.why_it_works) viralClipsBlock += `  Why it works: ${clip.why_it_works.slice(0, 200)}\n`;
          if (clip.caption)      viralClipsBlock += `  Caption: ${clip.caption.slice(0, 150)}\n`;
        });
      }

      // Transcript from completed-video footage
      const footage = db.getCompletedFootageByProject(pid);
      if (footage?.transcript) {
        transcriptBlock = `\nVIDEO TRANSCRIPT (first 1000 chars):\n${footage.transcript.slice(0, 1000)}\n`;
      }
    }

    // ── Email prompt ──────────────────────────────────────────────────────────
    userPrompt += projectContextBlock + researchBlock + citationsBlock + packageBlock + viralClipsBlock + transcriptBlock + socialBlock;
    if (viralClipsBlock) {
      userPrompt += `\nThe #1 hook above should heavily influence at least one email subject line.\n`;
    }
    userPrompt += `\nInclude real social links from the SOCIAL LINKS block in the email CTA — use the actual URLs, never placeholder text.\n`;

    userPrompt += `\nKeep each email body under 350 words — punchy, one job, done.\nReturn JSON only:\n{\n  "segment": "${segment || 'everyone'}",\n  "version_a": {\n    "label": "one word describing this approach",\n    "subject": "subject line",\n    "body": "full email body"\n  },\n  "version_b": {\n    "label": "one word describing this approach",\n    "subject": "subject line",\n    "body": "full email body"\n  }\n}`;

    const result = await callClaude(systemPrompt, userPrompt, 8192);

    const response = { ok: true };

    if (gen_email !== false) {
      response.broadcast = result;
    }

    if (gen_blog) {
      const blogCitationsSection = citationsHtml
        ? `\n\nAt the end of the blog post, include a Sources section:\n<h3>Sources</h3>\n<ul>\n${citationsHtml}\n</ul>\nAlso weave 1-2 of these citations naturally into the body as inline <a href> links where they support the argument.`
        : '';
      const blogPrompt = `Write a blog post based on this prompt: ${prompt}
Segment: ${segment || 'everyone'}
Goal: ${goal || 'not specified'}
${projectContextBlock}${researchBlock}${citationsBlock}${packageBlock}${viralClipsBlock}${transcriptBlock}${socialBlock}
BLOG POST RULES:
- Use the pre-production research to validate the argument — cite what the research found, not just what the video says
- The research is the "why this matters" foundation; the video is proof of the concept in action
- Structure: strong opening hook → context/research validation → creator's real experience → CTA
- Write in the creator's voice — conversational, real numbers, no corporate language
- 600–900 words. Include a title.
- End CTA should link to the YouTube video (if URL available) and the ROCK RICH community using real URLs from the SOCIAL LINKS block
- Include social follow links naturally at the end (TikTok, Instagram, YouTube, Lemon8)${blogCitationsSection}

Return JSON only:
{
  "title": "blog post title",
  "body": "full blog post as HTML with <p>, <h2>, <ul>/<li> tags, real hyperlinks for all social and citation URLs"
}`;
      response.blog_post = await callClaude(systemPrompt, blogPrompt, 6000);
    }

    if (gen_community) {
      const communityPrompt = `Write a Kajabi community post based on this prompt: ${prompt}
Segment: ${segment || 'everyone'}
Goal: ${goal || 'not specified'}
${projectContextBlock}${researchBlock}${citationsBlock}${packageBlock}${viralClipsBlock}${socialBlock}
COMMUNITY POST RULES:
- This is a community post to paying members — it should feel personal, not like a broadcast
- Use the research findings and concept rationale as validation for why this topic matters to them specifically
- Reference the video naturally ("I just dropped a video on this — here's what I found")
- 2–4 short paragraphs. End with a genuine question or call to action that invites replies.
- If there's a ClipsΩr hook above, open with a version of that energy
- If linking to the video, use the real YouTube URL from the SOCIAL LINKS block

Return JSON only:
{
  "body": "full community post as plain text"
}`;
      response.community_post = await callClaude(systemPrompt, communityPrompt, 2500);
    }

    if (gen_fb_post) {
      const fbPrompt = `Write a Facebook Page post based on this situation: ${prompt}
Goal: ${goal || 'not specified'}
${projectContextBlock}${researchBlock}${packageBlock}${viralClipsBlock}${socialBlock}

FACEBOOK POST RULES:
- This posts to the creator's public Facebook page — it is public-facing, not a community post
- 2–4 short punchy paragraphs. Hook first. Story or insight. CTA at the end.
- Include relevant emojis naturally (not forced). Facebook audiences respond well to them.
- End with a link or call to action using the real social URLs from the SOCIAL LINKS block
- Write in the creator's natural voice — no corporate language, no hashtag spam
- Max 3 hashtags at the very end if relevant, otherwise skip them
- If there's a viral hook above, open with energy from that

Return JSON only:
{
  "caption": "the full Facebook post text",
  "suggested_hashtags": ["tag1", "tag2"]
}`;
      response.fb_post = await callClaude(systemPrompt, fbPrompt, 1500);
    }

    if (project_id) {
      db.saveEmails(parseInt(project_id), { broadcast: response.broadcast });
    }

    res.json(response);
  } catch (e) {
    console.error('[mailor/broadcast]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/mailor/sequence ────────────────────────────────────────────────
// Full tier sequence — upgraded from generate.js, now reads from creator-profile.json

router.post('/sequence', async (req, res) => {
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
      tiers,
      voice_primary,
      voice_secondary,
      voice_blend,
    } = req.body;

    const profile     = loadProfile();
    const activeTiers = tiers || ['greenhouse', 'garden', 'founding'];

    // Build voice blend
    const voiceProfiles = [];
    const allProfiles   = profile.voice_profiles || [];
    if (voice_primary) {
      const vp = allProfiles.find(v => v.name === voice_primary);
      if (vp) voiceProfiles.push({ profile: vp, weight: parseInt(voice_blend) || 70 });
    }
    if (voice_secondary) {
      const vs = allProfiles.find(v => v.name === voice_secondary);
      if (vs) voiceProfiles.push({ profile: vs, weight: 100 - (parseInt(voice_blend) || 70) });
    }

    const voiceContext = buildVoiceContext(profile, voiceProfiles);
    const tierContext  = buildTierContext(profile);

    const angleMap = {
      financial: 'Financial Take — real numbers, cost savings, ROI math',
      system:    'System Is Rigged — opting out of broken systems',
      rockrich:  'Rock Rich Episode — doing a lot with a little',
      howto:     'Practical How-To — step by step, achievable for anyone',
      mistakes:  'Mistakes / What Not To Do — hard-won lessons',
      lifestyle: 'Lifestyle / Day-in-Life — real life on the homestead',
      viral:     'High Curiosity — counterintuitive, scroll-stopping',
    };

    const brand2       = profile?.creator?.brand   || 'the creator';
    const systemPrompt = `You are the email strategist for ${brand2}.

${tierContext}

VOICE:
${voiceContext}

EMAIL STRATEGY:
- Day 0 (everyone): Get them to watch the video. Short, warm, personal.
- Day 3 (Greenhouse): Value-add on the topic. Soft nudge toward joining The Garden.
- Day 3 (Garden): Deeper insight or behind-the-scenes. Reward their paid status.
- Day 3 (Founding 50): Insider tone. Personal note style. Something exclusive.
- Day 7 (Greenhouse): Soft pitch. Video as proof. Invitation to join The Garden.
- Day 7 (Garden): Tease next video. Reinforce they're in the right place.
- Day 7 (Founding 50): Full insider. What's coming. What they get first.

Use {$name} once near the top of each email as the greeting — this is MailerLite's native merge tag for first name.
Plain text only. No markdown. No asterisks. No symbols.

OUTPUT: valid JSON only, no preamble:
{
  "day0": { "everyone": { "subject": "", "body": "" } },
  "day3": { "greenhouse": { "subject": "", "body": "" }, "garden": { "subject": "", "body": "" }, "founding": { "subject": "", "body": "" } },
  "day7": { "greenhouse": { "subject": "", "body": "" }, "garden": { "subject": "", "body": "" }, "founding": { "subject": "", "body": "" } }
}`;

    let userPrompt = `Generate a full email sequence.\n\n`;
    userPrompt += `Video Title: ${video_title || 'Untitled'}\n`;
    if (package_title)   userPrompt += `Package Title: ${package_title}\n`;
    if (content_angle)   userPrompt += `Angle: ${angleMap[content_angle] || content_angle}\n`;
    if (video_url)       userPrompt += `YouTube URL: ${video_url}\n`;
    if (key_moments)     userPrompt += `Key moments: ${key_moments}\n`;
    if (next_video)      userPrompt += `Next video (Day 7 tease): ${next_video}\n`;
    if (live_offer)      userPrompt += `Live offer: ${live_offer}\n`;
    if (community_event) userPrompt += `Community event: ${community_event}\n`;
    if (email_direction) userPrompt += `Direction: ${email_direction}\n`;

    // Inject project context from DB if project_id provided
    if (project_id) {
      const proj   = db.getProject(parseInt(project_id));
      const script = db.getApprovedWritrScript(parseInt(project_id));
      if (proj || script) {
        userPrompt += `\nPROJECT CONTEXT:\n`;
        if (proj?.title)         userPrompt += `Title: ${proj.title}\n`;
        if (proj?.content_angle) userPrompt += `Content Angle: ${proj.content_angle}\n`;
        if (proj?.high_concept)  userPrompt += `High Concept: ${proj.high_concept}\n`;
        const scriptText = script?.generated_script || script?.full_script || '';
        if (scriptText)          userPrompt += `Script (first 500 chars): ${scriptText.slice(0, 500)}\n`;
      }
    }

    userPrompt += `Tiers: ${activeTiers.join(', ')}\nJSON only.`;

    const result = await callClaude(systemPrompt, userPrompt, 6000);

    if (project_id) db.saveEmails(parseInt(project_id), result);

    res.json({ project_id: project_id || null, emails: result });
  } catch (e) {
    console.error('[mailor/sequence]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/mailor/kajabi/send ─────────────────────────────────────────────
// Stub — live when KAJABI_API_KEY is set

router.post('/kajabi/send', async (req, res) => {
  const key = getKajabiKey();
  if (!key) {
    return res.status(402).json({
      error     : 'Kajabi not connected',
      action    : 'Add KAJABI_API_KEY to your .env file to enable direct sending',
      connected : false,
    });
  }
  // TODO: implement Kajabi broadcast API call when key is available
  res.status(501).json({ error: 'Kajabi send not yet implemented — key found but API not wired' });
});

module.exports = router;
