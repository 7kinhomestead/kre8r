'use strict';

/**
 * VisualΩr Route — src/routes/visualr.js
 *
 * Visual Intelligence module. Analyzes top/poor-performing footage for visual
 * patterns using Claude Vision (no Modal/MediaPipe dependency).
 *
 * Pipeline:
 *   1. yt-dlp resolves YouTube URLs to direct stream URLs (--get-url)
 *   2. ffmpeg extracts frames at 1/min rate (min 8, max 20) scaled to video length
 *   3. Claude Vision analyzes all frames in one call per video (semantic analysis)
 *   4. Claude Opus synthesizes a Visual Intelligence Profile with contrast reasoning
 *   5. Profile stored in kv_store, injected into WritΩr + BrollΩr
 *
 * GET  /api/visualr/status            — configured, profile exists
 * GET  /api/visualr/profile           — current Visual Intelligence Profile
 * GET  /api/visualr/available-footage — local footage with proxy files (Electron)
 * POST /api/visualr/analyze           — SSE: run full analysis pipeline
 * DELETE /api/visualr/profile         — clear stored profile
 */

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { spawn } = require('child_process');

const db     = require('../db');
const logger = require('../utils/logger');
const { startSseResponse } = require('../utils/sse');
const { callClaudeMessages } = require('../utils/claude');

const YTDLP_PATH        = process.env.YTDLP_PATH   || 'yt-dlp';
const VISUALR_MODEL     = process.env.VISUALR_MODEL || 'claude-opus-4-5';
const VISION_MODEL      = 'claude-sonnet-4-6';       // Sonnet for per-frame vision (fast)
const FRAMES_PER_MINUTE = 1;     // target sampling rate
const FRAMES_MIN        = 8;     // floor — even a 2-min clip gets decent coverage
const FRAMES_MAX        = 20;    // Claude Vision hard limit per call
const MAX_VIDEOS        = 8;
const FRAME_JPEG_QUALITY = 80;

// ─── GET /api/visualr/available-footage ──────────────────────────────────────

router.get('/available-footage', (req, res) => {
  try {
    const all = db.getAllFootage({ limit: 500 });
    const withProxy = (all || [])
      .filter(f => f.proxy_path && fs.existsSync(f.proxy_path))
      .map(f => ({
        id:         f.id,
        title:      f.title || f.filename || `Footage ${f.id}`,
        proxy_path: f.proxy_path,
        shot_type:  f.shot_type,
        project_id: f.project_id,
        created_at: f.created_at,
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ footage: withProxy });
  } catch (err) {
    logger.error({ module: 'visualr', err: err.message }, 'available-footage failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/visualr/status ──────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const profileRaw = db.getKv('visual_intelligence_profile');
  const profile    = profileRaw ? JSON.parse(profileRaw) : null;
  res.json({
    modal_configured: true,   // kept for UI compat — Vision needs no Modal config
    profile_exists:   !!profile,
    profile_age_days: profile?.created_at
      ? Math.floor((Date.now() - new Date(profile.created_at)) / 86400000)
      : null,
    videos_analyzed: profile?.videos_analyzed || 0,
  });
});

// ─── GET /api/visualr/profile ─────────────────────────────────────────────────

router.get('/profile', (req, res) => {
  try {
    const raw = db.getKv('visual_intelligence_profile');
    if (!raw) return res.json({ profile: null });
    res.json({ profile: JSON.parse(raw) });
  } catch (err) {
    logger.error({ module: 'visualr', err: err.message }, 'profile fetch failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/visualr/profile ─────────────────────────────────────────────

router.delete('/profile', (req, res) => {
  try {
    db.setKv('visual_intelligence_profile', null);
    db.setKv('visual_intelligence_video_results', null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/visualr/analyze (SSE) ─────────────────────────────────────────

router.post('/analyze', async (req, res) => {
  const { send, end } = startSseResponse(res, { timeoutMs: 120 * 60 * 1000 });

  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  if (!fs.existsSync(ffmpegPath)) {
    send({ stage: 'error', error: `ffmpeg not found at ${ffmpegPath}` });
    end(); return;
  }

  const { footage_ids, youtube_urls, youtube_urls_poor, analytics_screenshots } = req.body || {};

  const hasUrls     = Array.isArray(youtube_urls)      && youtube_urls.length      > 0;
  const hasPoorUrls = Array.isArray(youtube_urls_poor) && youtube_urls_poor.length > 0;
  const hasFootage  = Array.isArray(footage_ids)       && footage_ids.length       > 0;

  if (!hasUrls && !hasPoorUrls && !hasFootage) {
    send({ stage: 'error', error: 'Paste at least one YouTube URL or select a local footage file.' });
    end(); return;
  }

  const tempDirs = [];

  try {
    send({ stage: 'finding', message: 'Loading videos to analyze...' });

    const videosToAnalyze = [];

    // ── YouTube URLs — download lowest quality to temp file for fast local extraction ──
    const urlBatches = [
      { urls: hasUrls     ? youtube_urls.slice(0, MAX_VIDEOS)      : [], tier: 'top'  },
      { urls: hasPoorUrls ? youtube_urls_poor.slice(0, MAX_VIDEOS) : [], tier: 'poor' },
    ];
    let ytIndex = 0;
    for (const { urls, tier } of urlBatches) {
      for (const ytUrl of urls) {
        const label = tier === 'poor' ? 'underperformer' : 'top performer';
        send({ stage: 'finding', message: `Resolving ${label} (${ytIndex + 1})…` });
        try {
          const { title, streamUrl } = await resolveYtUrl(ytUrl.trim());
          videosToAnalyze.push({
            footage_id: `yt_${ytIndex}`, title,
            proxy_path: streamUrl,
            is_stream: true, performance_tier: tier,
          });
          ytIndex++;
        } catch (err) {
          send({ stage: 'warn', message: `Could not resolve ${ytUrl}: ${err.message}` });
        }
      }
    }

    // ── Local footage (Electron) ──────────────────────────────────────────────
    if (hasFootage) {
      const remaining = MAX_VIDEOS - videosToAnalyze.length;
      for (const fid of footage_ids.slice(0, remaining)) {
        try {
          const f = db.getFootageById(parseInt(fid));
          if (!f || !f.proxy_path || !fs.existsSync(f.proxy_path)) continue;
          videosToAnalyze.push({
            footage_id: f.id, title: f.title || f.filename || `Footage ${f.id}`,
            proxy_path: f.proxy_path, is_stream: false, performance_tier: 'top',
          });
        } catch (_) {}
      }
    }

    if (!videosToAnalyze.length) {
      send({ stage: 'error', error: 'Could not resolve any videos. Check that URLs are valid public YouTube videos.' });
      end(); return;
    }

    const ytCount    = videosToAnalyze.filter(v => v.is_stream).length;
    const localCount = videosToAnalyze.filter(v => !v.is_stream).length;
    const sourceNote = [ytCount && `${ytCount} YouTube`, localCount && `${localCount} local`].filter(Boolean).join(' + ');
    send({
      stage: 'found',
      message: `Analyzing ${videosToAnalyze.length} video${videosToAnalyze.length > 1 ? 's' : ''} (${sourceNote})`,
      videos: videosToAnalyze.map(v => ({ title: v.title })),
    });

    // ── Step 2: Extract frames + Claude Vision analysis per video ─────────────
    const allVideoResults = [];

    for (let i = 0; i < videosToAnalyze.length; i++) {
      const video = videosToAnalyze[i];
      const label = `(${i + 1}/${videosToAnalyze.length}) ${video.title.slice(0, 50)}`;

      send({ stage: 'extracting', message: `Getting video duration — ${label}` });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kre8r-visualr-'));
      tempDirs.push(tmpDir);
      const framePattern = path.join(tmpDir, 'frame_%04d.jpg');

      let durationSec = null;
      try { durationSec = await getVideoDuration(ffmpegPath, video.proxy_path); } catch (_) {}

      // Scale frame count to video length: 1 frame/min, min 8, max 20
      const durationMin  = durationSec ? durationSec / 60 : 10;
      const frameTarget  = Math.min(FRAMES_MAX, Math.max(FRAMES_MIN, Math.round(durationMin * FRAMES_PER_MINUTE)));
      const interval     = durationSec ? Math.max(1, Math.floor(durationSec / frameTarget)) : 60;

      send({ stage: 'extracting', message: `Extracting ${frameTarget} frames (${Math.round(durationMin)}min video) — ${label}` });

      await extractFrames(ffmpegPath, video.proxy_path, framePattern, interval, FRAME_JPEG_QUALITY);

      const frameFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).sort().slice(0, frameTarget);

      if (!frameFiles.length) {
        send({ stage: 'warn', message: `No frames extracted from ${video.title} — skipping` });
        continue;
      }

      const frames = frameFiles.map((filename, idx) => ({
        b64:         fs.readFileSync(path.join(tmpDir, filename)).toString('base64'),
        timestamp_s: interval * idx,
      }));

      send({ stage: 'analyzing', message: `Claude Vision analyzing — ${label}` });

      let visionFrames = [];
      try {
        visionFrames = await analyzeFramesWithVision(frames, video.title);
      } catch (err) {
        send({ stage: 'warn', message: `Vision analysis failed for ${video.title}: ${err.message}` });
        continue;
      }

      const summary = aggregateVisionResults(visionFrames);

      allVideoResults.push({
        title:            video.title,
        performance_tier: video.performance_tier || 'top',
        summary,
        frame_count:      visionFrames.length,
      });

      send({
        stage:   'video_done',
        message: `✓ ${video.title.slice(0, 50)} — ${visionFrames.length} frames analyzed`,
      });
    }

    if (!allVideoResults.length) {
      send({ stage: 'error', error: 'Vision analysis failed for all videos.' });
      end(); return;
    }

    // ── Step 3: Analytics screenshots ────────────────────────────────────────
    let analyticsContext = '';
    const shots = Array.isArray(analytics_screenshots) ? analytics_screenshots.filter(s => s?.b64) : [];
    if (shots.length > 0) {
      send({ stage: 'reading_analytics', message: `Reading ${shots.length} analytics screenshot${shots.length > 1 ? 's' : ''}…` });
      try {
        analyticsContext = await extractAnalyticsFromScreenshots(shots);
        send({ stage: 'analytics_done', message: '✓ Analytics data extracted from screenshots' });
      } catch (err) {
        send({ stage: 'warn', message: `Could not read analytics screenshots: ${err.message}` });
      }
    }

    // ── Step 4: Merge with any previously analyzed videos ────────────────────
    const prevRaw = db.getKv('visual_intelligence_video_results');
    const prevResults = prevRaw ? JSON.parse(prevRaw) : [];

    // Dedupe by title — new run wins if same title appears again
    const newTitles = new Set(allVideoResults.map(v => v.title));
    const merged = [
      ...prevResults.filter(v => !newTitles.has(v.title)),
      ...allVideoResults,
    ];

    if (prevResults.length > 0) {
      const addedCount = allVideoResults.length;
      const keptCount  = merged.length - addedCount;
      send({ stage: 'merging', message: `Merging ${addedCount} new video${addedCount > 1 ? 's' : ''} with ${keptCount} from previous run (${merged.length} total)` });
    }

    db.setKv('visual_intelligence_video_results', JSON.stringify(merged));

    // ── Step 5: Opus synthesizes Visual Intelligence Profile ─────────────────
    send({ stage: 'synthesizing', message: `Claude Opus synthesizing profile from ${merged.length} video${merged.length > 1 ? 's' : ''}…` });

    const profile = await synthesizeProfile(merged, analyticsContext);
    db.setKv('visual_intelligence_profile', JSON.stringify(profile));

    send({ stage: 'done', profile });
    end();

  } catch (err) {
    logger.error({ module: 'visualr', err: err.message }, 'analyze failed');
    send({ stage: 'error', error: err.message });
    end();
  } finally {
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

// ─── Claude Vision frame analysis ────────────────────────────────────────────

async function analyzeFramesWithVision(frames, videoTitle) {
  const imageBlocks = frames.map(f => ({
    type:   'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: f.b64 },
  }));

  const timestampList = frames.map((f, i) => `Frame ${i + 1}: ${f.timestamp_s}s`).join(' | ');

  const prompt = {
    type: 'text',
    text: `You are analyzing ${frames.length} frames from a YouTube video titled "${videoTitle}".
Frames are in chronological order, evenly sampled through the video.
Timestamps: ${timestampList}

For EACH frame, return one entry in the "frames" JSON array.

Return ONLY this JSON structure, no markdown:
{
  "frames": [
    {
      "frame_index": 1,
      "timestamp_s": <number>,
      "has_face": true/false,
      "face_count": 0,
      "face_fills_frame_pct": 0.0-1.0,
      "face_position": "center"|"left"|"right"|"none",
      "face_in_upper_half": true/false,
      "is_outdoors": true/false,
      "brightness": "dark"|"dim"|"normal"|"bright"|"overexposed",
      "color_temperature": "cool"|"neutral"|"warm"|"very_warm",
      "green_nature_coverage": "none"|"low"|"medium"|"high",
      "visual_complexity": "minimal"|"simple"|"moderate"|"busy"|"complex",
      "scene_description": "8 words max",
      "retention_signal": "strong"|"neutral"|"weak"
    }
  ]
}`,
  };

  const raw = await callClaudeMessages(
    null,
    [{ role: 'user', content: [...imageBlocks, prompt] }],
    4096,   // 20 frames × ~350 chars/frame needs headroom above 2048
    { tool: 'visualr-vision', model: VISION_MODEL }
  );

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed  = JSON.parse(cleaned);
  // Re-attach timestamps in case Claude shifted them
  return (parsed.frames || []).map((f, i) => ({
    ...f,
    timestamp_s: frames[i]?.timestamp_s ?? f.timestamp_s,
  }));
}

function aggregateVisionResults(frames) {
  const valid = frames.filter(f => f && typeof f === 'object' && !f.error);
  if (!valid.length) return {};

  const n        = valid.length;
  const opening  = valid.slice(0, Math.max(1, Math.floor(n * 0.1)));
  const withFace = valid.filter(f => f.has_face);

  const warmMap   = { very_warm: 1, warm: 0.5, neutral: 0, cool: -0.5 };
  const brightMap = { dark: 0.1, dim: 0.3, normal: 0.5, bright: 0.7, overexposed: 0.9 };
  const avg       = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const r3        = v => Math.round(v * 1000) / 1000;

  const sceneTypes = [...new Set(valid.map(f => f.scene_description).filter(Boolean))].slice(0, 8);
  const retentionWeak = r3(valid.filter(f => f.retention_signal === 'weak').length / n);
  const retentionStrong = r3(valid.filter(f => f.retention_signal === 'strong').length / n);

  return {
    total_frames_analyzed: n,
    face_presence_pct:     r3(withFace.length / n),
    opening_face_pct:      r3(opening.filter(f => f.has_face).length / opening.length),
    avg_warm_score:        r3(avg(valid.map(f => warmMap[f.color_temperature] ?? 0))),
    opening_warm_score:    r3(avg(opening.map(f => warmMap[f.color_temperature] ?? 0))),
    avg_outdoor_score:     r3(valid.filter(f => f.is_outdoors).length / n),
    opening_outdoor_score: r3(opening.filter(f => f.is_outdoors).length / opening.length),
    avg_brightness:        r3(avg(valid.map(f => brightMap[f.brightness] ?? 0.5))),
    avg_green_score:       r3(valid.filter(f => ['medium', 'high'].includes(f.green_nature_coverage)).length / n),
    center_framed_pct:     withFace.length ? r3(withFace.filter(f => f.face_position === 'center').length / withFace.length) : 0,
    strong_retention_pct:  retentionStrong,
    weak_retention_pct:    retentionWeak,
    scene_types:           sceneTypes,
    opening_scene:         opening[0]?.scene_description || '',
    // pass raw frames for Opus to reason over directly
    key_frames:            valid.filter((_, i) => i < 3 || i === Math.floor(n / 2) || i >= n - 2)
                               .map(f => ({ t: f.timestamp_s, scene: f.scene_description, retention: f.retention_signal, face: f.has_face, outdoors: f.is_outdoors })),
  };
}

// ─── Analytics screenshot extraction ─────────────────────────────────────────

async function extractAnalyticsFromScreenshots(screenshots) {
  const imageBlocks = screenshots.slice(0, 6).map(s => ({
    type:   'image',
    source: { type: 'base64', media_type: s.media_type || 'image/jpeg', data: s.b64 },
  }));

  const textBlock = {
    type: 'text',
    text: `These are YouTube Studio analytics screenshots. Extract every visible performance data point.

For each screenshot report:
- Video title (if visible)
- Average view duration / average percentage viewed
- Retention curve: where is the biggest drop-off? Any spikes? Start vs end %?
- Click-through rate from impressions (if visible)
- Views / impressions / watch time (if visible)
- Audience demographics (if visible)
- Traffic source breakdown (if visible)
- Notable retention anomalies (e.g. "sharp 15% drop at 0:08", "spike at 1:45", "above-average hold after 2:00")

Be specific about timestamps and percentages. Omit values that aren't visible.
Return plain text organized by video — no markdown headers.`,
  };

  return await callClaudeMessages(
    null,
    [{ role: 'user', content: [...imageBlocks, textBlock] }],
    1500,
    { tool: 'visualr-analytics', model: VISUALR_MODEL }
  );
}

// ─── Opus synthesis ───────────────────────────────────────────────────────────

function formatVideoBlock(v, i) {
  const s = v.summary;
  const scenes = (s.scene_types || []).join('; ') || 'N/A';
  const keyFrames = (s.key_frames || []).map(f =>
    `  t=${f.t}s: "${f.scene}" | face=${f.face} outdoors=${f.outdoors} retention=${f.retention}`
  ).join('\n');

  return [
    `${i + 1}. "${v.title}" [${v.performance_tier === 'poor' ? 'UNDERPERFORMER' : 'TOP PERFORMER'}]`,
    `   Face on screen: ${Math.round((s.face_presence_pct || 0) * 100)}% | Opening: ${Math.round((s.opening_face_pct || 0) * 100)}%`,
    `   Center-framed: ${Math.round((s.center_framed_pct || 0) * 100)}% of face frames`,
    `   Color: ${s.avg_warm_score > 0.3 ? 'warm' : s.avg_warm_score < -0.1 ? 'cool' : 'neutral'} | Brightness: ${s.avg_brightness?.toFixed(2)}`,
    `   Outdoor: ${Math.round((s.avg_outdoor_score || 0) * 100)}% | Opening outdoor: ${Math.round((s.opening_outdoor_score || 0) * 100)}%`,
    `   Green/nature: ${Math.round((s.avg_green_score || 0) * 100)}%`,
    `   Strong retention frames: ${Math.round((s.strong_retention_pct || 0) * 100)}% | Weak: ${Math.round((s.weak_retention_pct || 0) * 100)}%`,
    `   Opening scene: "${s.opening_scene}"`,
    `   Scene variety: ${scenes}`,
    `   Key frame sample:\n${keyFrames}`,
  ].join('\n');
}

async function synthesizeProfile(videoResults, analyticsContext) {
  const topVideos  = videoResults.filter(v => v.performance_tier !== 'poor');
  const poorVideos = videoResults.filter(v => v.performance_tier === 'poor');
  const hasContrast = poorVideos.length > 0;

  const { creatorName, niche, brand } = require('../utils/creator-context').getCreatorContext();

  const topSection  = topVideos.length  ? `TOP PERFORMERS (${topVideos.length}):\n\n${topVideos.map(formatVideoBlock).join('\n\n')}`   : '';
  const poorSection = poorVideos.length ? `\nUNDERPERFORMERS (${poorVideos.length}):\n\n${poorVideos.map(formatVideoBlock).join('\n\n')}` : '';

  const analyticsBlock = analyticsContext
    ? `\nYOUTUBE STUDIO ANALYTICS (from screenshots — ground truth on actual performance):\n\n${analyticsContext}\n`
    : '';

  const contrastInstruction = hasContrast ? `
CONTRAST ANALYSIS REQUIRED:
Find what separates top from poor performers visually — not just what the top videos share.

This channel has a documented inverse relationship: some low-view videos have exceptional
retention, and vice versa. Do NOT assume high views = good. Use the analytics data to
understand actual performance for each video. Call out any surprising reversals explicitly.

Find:
- What the top group has that poor group lacks
- What the poor group shares that top group avoids
- Any anomalies (a "poor" video outperforming on retention signals)
- The single strongest visual differentiator` : `
NOTE: Only top-performer data provided. Findings describe shared patterns but cannot
confirm causation without contrast data. Add underperformer URLs next run.`;

  const prompt = `You are doing a deep visual intelligence analysis of ${creatorName}'s ${niche} content for ${brand}.

TASK: Identify visual patterns that explain performance differences. Translate into specific,
actionable production rules for b-roll shots and video generation prompts.

RULES:
- NEVER use the word "psychology" — say "audience attention," "engagement signals," "visual resonance"
- Be specific: use percentages, timestamps, scene descriptions from the data
- If findings contradict common YouTube advice, say so — that is the most valuable insight
- This quarterly analysis governs shoot decisions and AI generation prompts for the next 90 days

${contrastInstruction}

VISUAL ANALYSIS DATA (Claude Vision semantic analysis — ${videoResults.length} videos, up to ${FRAMES_MAX} frames each scaled by duration):

${topSection}${poorSection}
${analyticsBlock}

Return ONLY this JSON structure, no markdown:
{
  "created_at": "${new Date().toISOString()}",
  "videos_analyzed": ${videoResults.length},
  "top_count": ${topVideos.length},
  "poor_count": ${poorVideos.length},
  "has_contrast_data": ${hasContrast},
  "top_video": "${topVideos[0]?.title || videoResults[0]?.title || ''}",
  "key_signals": [
    "Specific finding grounded in the data — e.g. 'Face in frame within opening 3s appears in 5/5 top performers, 0/3 underperformers'",
    "Another specific finding (4-6 total)",
    "If the inverse retention pattern appears in data, name it explicitly"
  ],
  "contrast_finding": "The single most important visual difference between top and poor performers. null if no poor performers provided.",
  "opening_frame_rules": [
    "Specific rule for first 3-8 seconds — face/no face, indoor/outdoor, warm/cool, wide/close",
    "Another rule (2-3 total)"
  ],
  "broll_shot_directives": [
    "Concrete directive — specific enough to paste directly into a video generator prompt",
    "Another directive (3-5 total)"
  ],
  "avoid": [
    "Visual pattern to actively avoid based on underperformer data"
  ],
  "writr_injection": "2-3 sentences for WritΩr b-roll suggestions. Second person, specific, actionable.",
  "brollr_style_note": "One sentence appended to every BrollΩr generation prompt to bias AI video output.",
  "audience_attention_profile": "3-4 sentences on how this audience's attention behaves — what locks them in, what loses them, any channel-specific anomalies like the retention/view inverse."
}`;

  const raw     = await callClaudeMessages(null, [{ role: 'user', content: prompt }], 3000, { tool: 'visualr-synthesis', model: VISUALR_MODEL });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    return {
      created_at: new Date().toISOString(), videos_analyzed: videoResults.length,
      top_count: topVideos.length, poor_count: poorVideos.length,
      has_contrast_data: hasContrast, raw_synthesis: raw.slice(0, 3000),
      key_signals: ['Analysis complete — see raw_synthesis for full output'],
      contrast_finding: null, broll_shot_directives: [], opening_frame_rules: [],
      avoid: [], writr_injection: '', brollr_style_note: '', audience_attention_profile: '',
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveYtUrl(youtubeUrl) {
  // Use yt-dlp to resolve a YouTube URL to a direct stream URL + title.
  // ffmpeg then extracts frames directly from the stream.
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      '--no-playlist',
      '--get-title',
      '--get-url',
      '-f', 'bestvideo[height<=360][ext=mp4]/bestvideo[height<=360]/worst',
      youtubeUrl,
    ], { windowsHide: true, timeout: 2 * 60 * 1000,
         env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(new Error(`yt-dlp spawn failed: ${err.message}`)));
    proc.on('close', code => {
      const lines = stdout.trim().split('\n').filter(Boolean);
      // --get-title outputs title, --get-url outputs the stream URL (in that order)
      if (lines.length < 2) {
        reject(new Error(`yt-dlp could not resolve URL (code ${code}). stderr: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve({ title: lines[0].trim(), streamUrl: lines[1].trim() });
    });
  });
}

function getVideoDuration(ffmpegPath, videoPath) {
  return new Promise((resolve, reject) => {
    const ffprobePath = process.env.FFPROBE_PATH || ffmpegPath.replace('ffmpeg', 'ffprobe');
    const proc = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', videoPath], { windowsHide: true });
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('error', reject);
    proc.on('close', () => {
      try { resolve(parseFloat(JSON.parse(stdout).format?.duration || '0')); }
      catch (_) { resolve(null); }
    });
  });
}

function extractFrames(ffmpegPath, inputPath, framePattern, intervalSec, quality) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-i', inputPath, '-vf', `fps=1/${intervalSec}`, '-q:v', String(quality), '-threads', '2', framePattern,
    ], { windowsHide: true, timeout: 12 * 60 * 1000 });
    proc.on('error', reject);
    proc.on('close', () => resolve());
  });
}

module.exports = router;
