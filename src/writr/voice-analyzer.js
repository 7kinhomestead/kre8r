/**
 * Kre8Ωr — Voice Analyzer
 * src/writr/voice-analyzer.js
 *
 * Accepts a video file path → Whisper transcription → Claude voice analysis
 * → saves a voice profile to creator-profile.json under voice_profiles[].
 *
 * SINE RESISTENTIA
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { spawn } = require('child_process');

const { callClaude } = require('./claude');

const CREATOR_PROFILE_PATH = path.join(__dirname, '..', '..', 'creator-profile.json');

// Python candidates — same order as CutΩr transcription
const PYTHON_CANDIDATES = [
  'python3',
  'python',
  'py'
];

// ─────────────────────────────────────────────
// WHISPER RUNNER
// ─────────────────────────────────────────────

async function findPython() {
  for (const bin of PYTHON_CANDIDATES) {
    try {
      await runProcess(bin, ['-c', 'import whisper'], 5_000);
      return bin;
    } catch (_) { /* try next */ }
  }
  throw new Error('Python + openai-whisper not found. Run: pip install openai-whisper');
}

function runProcess(bin, args, timeout = 600_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, timeout);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.slice(-500) || `Exit ${code}`));
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function transcribeForVoice(filePath, emit) {
  emit?.({ stage: 'transcribing', message: 'Running Whisper on audio — this takes a minute…' });

  const py     = await findPython();
  const outDir = path.join(os.tmpdir(), 'kre8r-voice-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(outDir, { recursive: true });

  const model = process.env.WHISPER_MODEL || 'medium';

  try {
    await runProcess(py, [
      '-m', 'whisper',
      filePath,
      '--model',         model,
      '--output_format', 'json',
      '--output_dir',    outDir,
      '--verbose',       'False'
    ]);

    // Find output JSON
    const base     = path.basename(filePath, path.extname(filePath));
    const jsonPath = path.join(outDir, base + '.json');

    if (!fs.existsSync(jsonPath)) {
      throw new Error('Whisper did not produce output JSON — check the file has audio');
    }

    const raw  = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const text = raw.text || (raw.segments || []).map(s => s.text).join(' ') || '';

    emit?.({ stage: 'transcribed', message: `Transcribed ${text.split(/\s+/).length} words` });
    return text.trim();

  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ─────────────────────────────────────────────
// CLAUDE VOICE ANALYSIS
// ─────────────────────────────────────────────

const ANALYSIS_PROMPT = `Analyze this video transcript and extract a detailed voice profile.
Focus entirely on HOW this person speaks — their rhythm, humor, directness, personality.
Do NOT summarize WHAT they talk about.

TRANSCRIPT:
{TRANSCRIPT}

Return a JSON object with exactly these fields — no other text, no markdown fences:
{
  "sentence_rhythm": "describe sentence length and pacing — short/punchy vs long/flowing, when each is used",
  "humor_style": "how humor appears — self-deprecating, unexpected drops, observation-based, frequency",
  "directness": <integer 1-10, where 10 = extremely blunt>,
  "formality": <integer 1-10, where 1 = extremely casual>,
  "audience_address": "how they speak TO the viewer — peer, teacher, friend, authority",
  "characteristic_phrases": ["phrase they use often", "construction that sounds like them", "at least 5 items"],
  "never_says": ["word or phrase that would sound wrong in their voice", "corporate language to avoid", "at least 5 items"],
  "numbers_and_specifics": "how they use data, prices, measurements — do they cite real numbers or stay vague",
  "emotional_range": "describe range from instructional to vulnerable — when and how emotion shows up",
  "sample_sentences": [
    "pick 10 sentences that sound unmistakably like this person",
    "include variety: funny, serious, instructional, vulnerable",
    "these will be used as style references for AI writing",
    "pick the most characteristic moments — not summaries",
    "sentence 5",
    "sentence 6",
    "sentence 7",
    "sentence 8",
    "sentence 9",
    "sentence 10"
  ],
  "summary": "2-3 sentences an AI writer could use to reproduce this voice exactly"
}`;

async function analyzeTranscript(transcript, emit) {
  emit?.({ stage: 'analyzing', message: 'Claude is reading the voice patterns…' });

  // Trim to ~5000 words — enough signal without blowing context
  const words   = transcript.split(/\s+/);
  const trimmed = words.slice(0, 5000).join(' ');

  const prompt = ANALYSIS_PROMPT.replace('{TRANSCRIPT}', trimmed);

  // callClaude with raw:false expects JSON — voice analysis prompt returns JSON directly
  try {
    return await callClaude(prompt, { maxTokens: 2048, raw: false });
  } catch (e) {
    // Retry as raw and manually parse (handles truncated/fenced responses)
    const raw     = await callClaude(prompt, { maxTokens: 2048, raw: true });
    const jsonStr = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    try {
      return JSON.parse(jsonStr);
    } catch (_) {
      const start = jsonStr.indexOf('{');
      const end   = jsonStr.lastIndexOf('}');
      if (start !== -1 && end !== -1) return JSON.parse(jsonStr.slice(start, end + 1));
      throw new Error('Claude returned malformed JSON for voice analysis');
    }
  }
}

// ─────────────────────────────────────────────
// CREATOR-PROFILE JSON HELPERS
// ─────────────────────────────────────────────

function loadProfileJson() {
  try { return JSON.parse(fs.readFileSync(CREATOR_PROFILE_PATH, 'utf8')); } catch (_) { return {}; }
}

function saveProfileToLibrary(profile) {
  const data = loadProfileJson();
  if (!Array.isArray(data.voice_profiles)) data.voice_profiles = [];
  const idx = data.voice_profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) data.voice_profiles[idx] = profile;
  else          data.voice_profiles.push(profile);
  fs.writeFileSync(CREATOR_PROFILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function removeProfileFromLibrary(profileId) {
  const data = loadProfileJson();
  data.voice_profiles = (data.voice_profiles || []).filter(p => p.id !== profileId);
  fs.writeFileSync(CREATOR_PROFILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function listProfiles() {
  return loadProfileJson().voice_profiles || [];
}

function getProfile(id) {
  return listProfiles().find(p => p.id === id) || null;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Analyze a video file and produce a voice profile.
 *
 * @param {string}   opts.filePath   — absolute path to video/audio file
 * @param {string}   opts.name       — display name for this profile
 * @param {Function} [opts.emit]     — SSE progress callback ({ stage, message })
 * @param {boolean}  [opts.save]     — save to creator-profile.json (default true)
 * @returns {object} complete voice profile
 */
async function analyzeVoice({ filePath, name, emit, save = true }) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const transcript = await transcribeForVoice(filePath, emit);
  if (!transcript || transcript.split(/\s+/).length < 30) {
    throw new Error('Transcription too short — check the file has speech audio');
  }

  const characteristics = await analyzeTranscript(transcript, emit);

  const profile = {
    id:           crypto.randomBytes(8).toString('hex'),
    name:         name || path.basename(filePath, path.extname(filePath)),
    source_file:  path.basename(filePath),
    analyzed_at:  new Date().toISOString().slice(0, 10),
    word_count:   transcript.split(/\s+/).length,
    characteristics
  };

  if (save) {
    saveProfileToLibrary(profile);
    emit?.({ stage: 'saved', message: `"${profile.name}" saved to Voice Library` });
  }

  emit?.({ stage: 'complete', profile });
  return profile;
}

/**
 * Build a voice summary string for injection into WritΩr prompts.
 * Used by script-first, shoot-first, hybrid, iterate.
 *
 * @param {object}   creatorProfile  — full creator-profile.json object
 * @param {Array}    voiceProfiles   — [{ profile, weight }] selected by user, or null
 * @returns {string}
 */
function buildVoiceSummaryFromProfiles(creatorProfile, voiceProfiles) {
  // No specific profiles selected → fall back to creator profile defaults
  if (!voiceProfiles || voiceProfiles.length === 0) {
    const v = creatorProfile?.voice;
    if (!v) return 'Straight-talking, warm, funny, never corporate.';
    return [
      `Summary: ${v.summary}`,
      `Traits: ${(v.traits || []).join('; ')}`,
      `Never: ${(v.never  || []).join('; ')}`
    ].join('\n');
  }

  // Specific profiles selected — build weighted voice summary
  const lines = [
    `Write in a voice that blends the following profiles (weights = influence on final script):`,
    ''
  ];

  for (const { profile: vp, weight } of voiceProfiles) {
    const c = vp.characteristics || {};
    // Number of sample sentences proportional to weight (out of 10 total)
    const sampleCount = Math.max(2, Math.round(weight / 10));
    const samples     = (c.sample_sentences || []).slice(0, sampleCount);

    lines.push(`### ${vp.name} — ${weight}% weight`);
    lines.push(`Summary: ${c.summary || '(no summary)'}`);
    lines.push(`Sentence rhythm: ${c.sentence_rhythm || ''}`);
    lines.push(`Directness: ${c.directness ?? '?'}/10 | Formality: ${c.formality ?? '?'}/10`);
    lines.push(`Humor: ${c.humor_style || ''}`);
    lines.push(`Audience address: ${c.audience_address || ''}`);
    if ((c.characteristic_phrases || []).length)
      lines.push(`Characteristic: ${c.characteristic_phrases.join(', ')}`);
    if ((c.never_says || []).length)
      lines.push(`Never say: ${c.never_says.join(', ')}`);
    if (samples.length) {
      lines.push(`Voice samples:`);
      samples.forEach(s => lines.push(`  "${s}"`));
    }
    lines.push('');
  }

  lines.push('Weight toward the higher-percentage profile when the two styles diverge.');
  return lines.join('\n');
}

module.exports = {
  analyzeVoice,
  buildVoiceSummaryFromProfiles,
  saveProfileToLibrary,
  removeProfileFromLibrary,
  listProfiles,
  getProfile
};
