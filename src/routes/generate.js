/**
 * Generate routes — /api/generate
 * Proxies all Claude API calls server-side.
 * API key lives in .env, never touches the browser.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { getCreatorContext, getCommunityBlock, getSocialLinksBlock } = require('../utils/creator-context');
const { callClaudeMessages, repairJSON } = require('../utils/claude');

// callClaudeMessages from shared util has full retry/backoff logic (429, 529, ECONNRESET).
// Thin wrapper so call sites stay identical to the old local signature.
async function callClaude(systemPrompt, userPrompt, maxTokens = 4000) {
  return callClaudeMessages(systemPrompt, [{ role: 'user', content: userPrompt }], maxTokens);
}

function parseJson(text) {
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Fallback: attempt structural repair for truncated/malformed JSON
    return repairJSON(cleaned);
  }
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

    const { plaintext: socialLinksPlain } = getSocialLinksBlock();

    const systemPrompt = `You are the content strategist for ${brand} — ${followerSummary}, and a paid Kajabi community called ${communityName}.

CREATOR VOICE:
${voiceSummary}

COMMUNITY:
${communityBlock}

CONTENT ANGLES AVAILABLE:
${activeAngles}

PRIMARY GOAL FOR THIS VIDEO:
${goalMap[goal] || goalMap.grow}

SOCIAL LINKS (use these exact URLs in youtube_description — never make up links):
${socialLinksPlain}

OUTPUT FORMAT — valid JSON only, no preamble, no markdown fences:
{
  "packages": [
    {
      "number": 1,
      "title": "YouTube title here",
      "hook": "TikTok/short-form hook — the first line that stops the scroll",
      "rationale": "2-3 sentences on why this angle works for this content and audience",
      "thumbnail_concept": "Detailed thumbnail description — what's in frame, text overlay, creator expression",
      "youtube_description": "150-220 word YouTube description with natural keyword placement, real social links from the SOCIAL LINKS block above, CTA to ${communityName} community"
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

    // Inject ClipsΩr approved viral clips — the strongest moments Claude identified
    // and the creator approved. Takes priority over CutΩr for completed-video workflow.
    if (project_id) {
      const viralClips = db.getApprovedViralClipsByProject(parseInt(project_id));
      if (viralClips.length > 0) {
        userPrompt += `\nCLIPSΩR ANALYSIS — CREATOR-APPROVED VIRAL MOMENTS:\n`;
        userPrompt += `These are the exact moments the creator approved as the strongest clips for short-form distribution. Each hook was written to stop a scroll in the first 3 seconds. Build packages around these — they represent the real emotional and informational peaks of the video:\n\n`;
        viralClips.forEach((clip, i) => {
          userPrompt += `[CLIP ${i + 1} — Rank #${clip.rank} — ${(clip.clip_type || 'social').toUpperCase()}]\n`;
          userPrompt += `Hook: "${clip.hook}"\n`;
          if (clip.why_it_works) userPrompt += `Why it works: ${clip.why_it_works}\n`;
          if (clip.caption)      userPrompt += `Approved caption: ${clip.caption}\n`;
          if (clip.hashtags)     userPrompt += `Hashtags: ${clip.hashtags}\n`;
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

    // Inject transcript from completed-video footage — best context for finished videos
    // that went through ClipsΩr rather than the WritΩr scripted workflow
    if (project_id) {
      const footage = db.getCompletedFootageByProject(parseInt(project_id));
      if (footage?.transcript) {
        // First 2000 chars of transcript gives Claude the actual spoken content
        userPrompt += `\nVIDEO TRANSCRIPT (first 2000 chars):\n${footage.transcript.slice(0, 2000)}\n`;
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

    const rawText = await callClaude(systemPrompt, userPrompt, 8192);
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
// POST /api/generate/captions-from-vault
// Body: { footage_ids: [1,2,3], caption_direction? }
// Loads each clip's transcript from VaultΩr and generates
// platform captions from the actual spoken words.
// No manual description entry. No clip-to-caption matching needed.
// ─────────────────────────────────────────────
router.post('/captions-from-vault', async (req, res) => {
  const fs = require('fs');
  const { transcribeFile } = require('../vault/transcribe');

  try {
    const { footage_ids, caption_direction } = req.body;
    if (!footage_ids?.length) {
      return res.status(400).json({ error: 'footage_ids required' });
    }

    const { brand, followerSummary, profile: cp } = getCreatorContext();

    const systemPrompt = `You are the social media voice for ${brand} — ${followerSummary}.

CREATOR VOICE: Straight-talking, warm, encouraging, genuinely funny. Never corporate. Real numbers always.

PLATFORM RULES:
- TikTok: Hook in the first line. Punchy, fast, scroll-stopping. 2-3 hashtags max. Under 300 characters total.
- Instagram Reels: Warm, save-worthy. Ask a question or give a clear CTA. 5-8 hashtags at the end. 150-250 characters.
- Facebook: Conversational and community-driven. 3-5 short paragraphs. "Comment X for the link" format works well. 0-2 hashtags.
- YouTube Shorts: Search-aware. Include the main topic keyword naturally in the first sentence. 2-3 sentences + 3-5 hashtags.
- Lemon8: Visual storytelling and lifestyle vibe. More descriptive than TikTok. Lists and "here's what I learned" structure. 5-8 hashtags.

OUTPUT FORMAT — valid JSON only, no preamble:
{
  "footage_id": 123,
  "filename": "clip_name.mp4",
  "captions": {
    "tiktok": "caption text",
    "instagram": "caption text",
    "facebook": "caption text",
    "shorts": "caption text",
    "lemon8": "caption text"
  }
}`;

    // Build clip blocks — transcribe on-demand if not already done
    const clipBlocks = [];
    for (const rawId of footage_ids) {
      const id = parseInt(rawId, 10);
      const footage = db.getFootageById(id);
      if (!footage) { console.warn(`[captions-from-vault] footage_id=${id} not found`); continue; }

      console.log(`[captions-from-vault] id=${id} file=${footage.original_filename} has_transcript=${!!(footage.transcript)} transcript_path=${footage.transcript_path || 'none'}`);

      let transcriptText = footage.transcript || '';

      // If no plain-text transcript, try loading from transcript_path
      if (!transcriptText && footage.transcript_path && fs.existsSync(footage.transcript_path)) {
        try {
          const tx = JSON.parse(fs.readFileSync(footage.transcript_path, 'utf8'));
          transcriptText = tx.text || '';
          console.log(`[captions-from-vault] id=${id} loaded transcript from path (${transcriptText.length} chars)`);
        } catch (_) {}
      }

      // On-demand transcription if still missing
      if (!transcriptText) {
        const sourcePath = footage.proxy_path || footage.file_path;
        console.log(`[captions-from-vault] id=${id} no transcript — attempting Whisper on ${sourcePath} (exists=${sourcePath ? fs.existsSync(sourcePath) : false})`);
        if (sourcePath && fs.existsSync(sourcePath)) {
          try {
            console.log(`[captions-from-vault] id=${id} starting Whisper…`);
            const tx = await transcribeFile(sourcePath, { footageId: id });
            console.log(`[captions-from-vault] id=${id} Whisper done: ok=${tx.ok} error=${tx.error || 'none'}`);
            if (tx.ok) transcriptText = tx.text || '';
          } catch (txErr) {
            console.warn(`[captions-from-vault] id=${id} Whisper threw: ${txErr.message}`);
          }
        }
      }

      const filename = footage.original_filename || footage.file_path?.split(/[\\/]/).pop() || `clip_${id}`;
      const duration = footage.duration ? `${Math.round(footage.duration)}s` : '';
      const transcriptLine = transcriptText
        ? `TRANSCRIPT: ${transcriptText}`
        : `TRANSCRIPT: (not available — write captions based on the filename and typical homestead content)`;

      clipBlocks.push({
        footage_id: id,
        filename,
        block: `[CLIP footage_id=${id} | file: ${filename}${duration ? ` | ${duration}` : ''}]\n${transcriptLine}`
      });
    }

    // Call Claude once per clip — avoids timeout on large batches with full transcripts
    const allClips = [];
    for (let i = 0; i < clipBlocks.length; i++) {
      const { block, footage_id, filename } = clipBlocks[i];
      let userPrompt = `Generate platform-native captions for this short-form clip.\n`;
      if (caption_direction) userPrompt += `Creator direction: ${caption_direction}\n`;
      userPrompt += `\n${block}\n\nWrite all 5 platform captions. JSON only.`;
      try {
        console.log(`[captions-from-vault] calling Claude for footage_id=${footage_id} (${i+1}/${clipBlocks.length})`);
        const rawText = await callClaude(systemPrompt, userPrompt, 4096);
        let parsed;
        try {
          parsed = parseJson(rawText);
        } catch (parseErr) {
          // Last-resort: extract any complete caption strings via regex
          console.warn(`[captions-from-vault] JSON parse failed for footage_id=${footage_id}, attempting regex extraction`);
          const extract = (key) => {
            const m = rawText.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
            return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null;
          };
          const tiktok    = extract('tiktok');
          const instagram = extract('instagram');
          const facebook  = extract('facebook');
          const shorts    = extract('shorts');
          const lemon8    = extract('lemon8');
          if (tiktok || instagram || facebook || shorts || lemon8) {
            parsed = { captions: { tiktok, instagram, facebook, shorts, lemon8 } };
            console.log(`[captions-from-vault] Regex rescue recovered captions for footage_id=${footage_id}`);
          }
        }
        const captions = parsed?.captions || parsed?.clips?.[0]?.captions;
        if (captions) allClips.push({ footage_id, filename, captions });
        else console.warn(`[captions-from-vault] No captions parsed for footage_id=${footage_id}`);
      } catch (clipErr) {
        console.warn(`[captions-from-vault] Claude failed for footage_id=${footage_id}: ${clipErr.message}`);
      }
    }

    res.json({ clips: allClips });
  } catch (err) {
    console.error('[generate/captions-from-vault]', err);
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
