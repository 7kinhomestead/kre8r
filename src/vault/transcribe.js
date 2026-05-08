/**
 * VaultΩr Transcription — src/vault/transcribe.js
 *
 * Node.js wrapper around openai-whisper (Python).
 * Accepts a video file path, runs Whisper with word-level timestamps,
 * writes a JSON transcript to database/transcripts/, and returns a
 * structured object ready for CutΩr to reason over.
 *
 * Output format:
 * {
 *   footage_id: number,
 *   file_path:  string,
 *   duration:   number,       // seconds
 *   language:   string,       // detected language code
 *   text:       string,       // full transcript as plain text
 *   segments: [
 *     {
 *       id:    number,
 *       start: number,        // seconds
 *       end:   number,        // seconds
 *       text:  string,        // segment text (sentence-ish)
 *       words: [
 *         { word: string, start: number, end: number, probability: number }
 *       ]
 *     }
 *   ]
 * }
 */

'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');

const db = require('../db');

const WHISPER_MODEL  = process.env.WHISPER_MODEL  || 'medium';
const TRANSCRIPTS_DIR = path.join(__dirname, '..', '..', 'database', 'transcripts');

// Pin the Whisper model cache to a fixed directory so every Python binary
// (py / python / python3) shares the same model download.
// Defaults to database/whisper-model-cache but can be overridden via .env.
const WHISPER_CACHE_DIR = process.env.WHISPER_CACHE_DIR
  || path.join(__dirname, '..', '..', 'database', 'whisper-model-cache');

const RESOLVE_TRANSCRIBE_SCRIPT = path.join(
  __dirname, '..', '..', 'scripts', 'davinci', 'resolve-transcribe.py'
);

// Binary detection — cached after first successful probe
let _whisperBinary  = null;   // null = not yet detected, '' = not found, string = binary name
let _whisperVersion = null;

const WHISPER_CANDIDATES = process.env.PYTHON_PATH
  ? [process.env.PYTHON_PATH]
  : ['py', 'python3', 'python'];

// Test whether `bin -c "import whisper; print(whisper.__version__)"` works;
// resolves version string or null.
// NOTE: we do NOT use `python -m whisper --help` because whisper's help text
// contains a Unicode character (U+3002) that crashes on Windows cp1252 pipes.
function _testWhisperBinary(bin) {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-c', 'import whisper; print(whisper.__version__)'], {
      windowsHide: true,
      timeout: 45_000   // torch cold-start can take 20-30s on first import
    });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      const ver = out.trim();
      resolve(ver.length > 0 ? ver : 'installed');
    });
  });
}

async function detectWhisperBinary() {
  if (_whisperBinary !== null) return _whisperBinary || null;  // '' means not found
  for (const bin of WHISPER_CANDIDATES) {
    const ver = await _testWhisperBinary(bin);
    if (ver !== null) {
      _whisperBinary  = bin;
      _whisperVersion = ver;
      console.log(`[Whisper] Detected binary: ${bin} (${ver})`);
      return bin;
    }
  }
  _whisperBinary = '';  // not found
  console.warn('[Whisper] Not found on any candidate path:', WHISPER_CANDIDATES.join(', '));
  return null;
}

async function checkWhisper() {
  const binary = await detectWhisperBinary();
  return {
    whisper:         binary !== null,
    whisper_binary:  binary || null,
    whisper_version: _whisperVersion || null
  };
}

// Probe whether any Python binary exists (regardless of Whisper install).
// Returns the binary name ('python3', 'python', 'py') or null.
async function detectPython() {
  for (const bin of WHISPER_CANDIDATES) {
    const found = await new Promise((resolve) => {
      const proc = spawn(bin, ['--version'], { windowsHide: true, timeout: 5_000 });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { out += d.toString(); });
      proc.on('error', () => resolve(null));
      proc.on('close', () => resolve(out.toLowerCase().includes('python') ? bin : null));
    });
    if (found) return found;
  }
  return null;
}

// Reset the Whisper detection cache — call after a successful pip install
// so the next checkWhisper() re-probes instead of returning the stale miss.
function resetWhisperCache() {
  _whisperBinary  = null;
  _whisperVersion = null;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function transcriptSlug(filePath) {
  return crypto.createHash('md5').update(path.resolve(filePath)).digest('hex');
}

function ensureTranscriptsDir() {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

// ─────────────────────────────────────────────
// RUN WHISPER
// Calls: python -m whisper <file> --model base --output_format json
//                           --word_timestamps True --output_dir <dir>
// ─────────────────────────────────────────────

async function runWhisper(filePath, onProgress = null, options = {}) {
  const binary = await detectWhisperBinary();
  if (!binary) {
    throw new Error(
      `Whisper not found. Tried: ${WHISPER_CANDIDATES.join(', ')}. ` +
      `Install with: pip install openai-whisper`
    );
  }

  return new Promise((resolve, reject) => {
    ensureTranscriptsDir();

    // Allow per-job model override via options.model, else use server default
    const modelToUse = (options && options.model) || WHISPER_MODEL;

    // Ensure model cache dir exists so --download-root doesn't fail
    fs.mkdirSync(WHISPER_CACHE_DIR, { recursive: true });

    const args = [
      '-m', 'whisper',
      filePath,
      '--model',           modelToUse,
      '--output_format',   'json',
      '--word_timestamps', 'True',
      '--output_dir',      TRANSCRIPTS_DIR,
      '--download-root',   WHISPER_CACHE_DIR,   // pin cache so all Python binaries share same model
      '--verbose',         'False',
    ];

    onProgress?.({ stage: 'whisper_start', model: modelToUse, file: path.basename(filePath) });

    // Whisper calls ffmpeg internally to decode audio — inject the bin dir into PATH
    // so it can find it even when the system PATH doesn't include it.
    const ffmpegBinDir = process.env.FFMPEG_PATH
      ? path.dirname(process.env.FFMPEG_PATH)
      : null;
    const childEnv = { ...process.env };
    if (ffmpegBinDir) {
      childEnv.PATH = ffmpegBinDir + path.delimiter + (childEnv.PATH || '');
    }

    const proc = spawn(binary, args, {
      windowsHide: true,
      env: childEnv,
      timeout: 600_000  // 10 minutes
    });

    let stderr = '';
    let stdout = '';
    let progressReceived = false;

    // On first run Whisper silently downloads the model (~1.5 GB) before any progress
    // output appears. After 8 s of silence, emit a hint so the UI doesn't look hung.
    const modelDownloadHint = setTimeout(() => {
      if (!progressReceived) {
        onProgress?.({
          stage:   'whisper_model_download',
          message: 'Downloading Whisper model for the first time (~1.5 GB). This only happens once — subsequent runs start immediately.'
        });
      }
    }, 8000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Whisper logs progress to stderr — surface key lines
      if (chunk.includes('%|') || chunk.includes('Detecting language') || chunk.includes('Transcribing')) {
        progressReceived = true;
        clearTimeout(modelDownloadHint);
        onProgress?.({ stage: 'whisper_progress', line: chunk.trim() });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(modelDownloadHint);
      reject(new Error(`Failed to start Whisper: ${err.message}. Check PYTHON_PATH in .env`));
    });

    proc.on('close', (code) => {
      clearTimeout(modelDownloadHint);
      if (code !== 0) {
        return reject(new Error(`Whisper exited with code ${code}: ${stderr.slice(-500)}`));
      }
      resolve();
    });
  });
}

// ─────────────────────────────────────────────
// PARSE WHISPER JSON OUTPUT
// Whisper names the output file after the input filename stem
// ─────────────────────────────────────────────

function parseWhisperOutput(filePath) {
  const stem     = path.basename(filePath, path.extname(filePath));
  const jsonPath = path.join(TRANSCRIPTS_DIR, stem + '.json');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Whisper output not found: ${jsonPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Normalise to our schema — Whisper JSON has text, segments[], language
  const segments = (raw.segments || []).map((seg, i) => ({
    id:    i,
    start: parseFloat(seg.start.toFixed(3)),
    end:   parseFloat(seg.end.toFixed(3)),
    text:  seg.text.trim(),
    words: (seg.words || []).map(w => ({
      word:        w.word.trim(),
      start:       parseFloat(w.start.toFixed(3)),
      end:         parseFloat(w.end.toFixed(3)),
      probability: parseFloat((w.probability || 1).toFixed(4))
    }))
  }));

  const duration = segments.length > 0
    ? segments[segments.length - 1].end
    : null;

  return {
    language: raw.language || 'en',
    text:     (raw.text || '').trim(),
    duration,
    segments,
    _source_json: jsonPath  // internal — used to build the stored path
  };
}

// ─────────────────────────────────────────────
// RENAME OUTPUT to slug-based filename
// Prevents collisions when two videos share the same basename
// ─────────────────────────────────────────────

function renameToSlug(filePath, parsed) {
  const stem        = path.basename(filePath, path.extname(filePath));
  const sourcePath  = parsed._source_json;
  const slug        = transcriptSlug(filePath);
  const destPath    = path.join(TRANSCRIPTS_DIR, slug + '.json');

  if (sourcePath !== destPath) {
    fs.renameSync(sourcePath, destPath);
  }

  delete parsed._source_json;
  return destPath;
}

// ─────────────────────────────────────────────
// MAIN — transcribeFile
// ─────────────────────────────────────────────

async function transcribeFile(filePath, options = {}) {
  const { footageId = null, onProgress = null } = options;

  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const slug     = transcriptSlug(filePath);
  const destPath = path.join(TRANSCRIPTS_DIR, slug + '.json');

  // Skip if already transcribed
  if (fs.existsSync(destPath)) {
    onProgress?.({ stage: 'skipped', reason: 'already transcribed' });
    const existing = JSON.parse(fs.readFileSync(destPath, 'utf8'));
    return { ok: true, skipped: true, transcript_path: destPath, ...existing };
  }

  // Run Whisper
  try {
    await runWhisper(filePath, onProgress);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // Parse + rename output
  let transcript;
  try {
    const parsed = parseWhisperOutput(filePath);
    const finalPath = renameToSlug(filePath, parsed);

    // Write final normalised JSON
    // Post-process: fix known Whisper mishearings for this creator
    // "Rockridge" is always "Rock Rich" (community name, not a place)
    const fixTranscriptText = (t) => t
      .replace(/\bRockridge\b/g, 'Rock Rich')
      .replace(/\brock ridge\b/gi, 'Rock Rich')
      .replace(/\brock-ridge\b/gi, 'Rock Rich');

    const fixedText     = fixTranscriptText(parsed.text);
    const fixedSegments = parsed.segments.map(seg => ({
      ...seg,
      text:  fixTranscriptText(seg.text),
      words: (seg.words || []).map(w => ({ ...w, word: fixTranscriptText(w.word) }))
    }));

    transcript = {
      footage_id: footageId,
      file_path:  filePath,
      language:   parsed.language,
      text:       fixedText,
      duration:   parsed.duration,
      segments:   fixedSegments
    };
    fs.writeFileSync(finalPath, JSON.stringify(transcript, null, 2));

    onProgress?.({ stage: 'transcribed', segments: transcript.segments.length, duration: transcript.duration });

    // Update DB if footageId provided
    // transcript_path = full JSON on disk (for CutΩr / ClipsΩr word-level timing)
    // transcript      = plain text (for semantic search, WritΩr, ComposΩr, downstream tools)
    if (footageId) {
      db.updateFootage(footageId, {
        transcript_path: finalPath,
        transcript:      transcript.text
      });
    }

    return { ok: true, transcript_path: finalPath, ...transcript };

  } catch (e) {
    return { ok: false, error: `Parse failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────
// RESOLVE TRANSCRIPTION
// Calls resolve-transcribe.py which uses DaVinci Resolve's built-in
// AI transcription (Whisper-based, timecode-accurate, Cari-filtered).
// Returns same schema as transcribeFile so it's a transparent swap.
// ─────────────────────────────────────────────

async function transcribeWithResolve(filePath, options = {}) {
  const { footageId = null, onProgress = null } = options;

  const pythonBin = await detectPython();
  if (!pythonBin) {
    return { ok: false, error: 'Python not found — cannot call resolve-transcribe.py' };
  }

  if (!fs.existsSync(RESOLVE_TRANSCRIBE_SCRIPT)) {
    return { ok: false, error: `resolve-transcribe.py not found at ${RESOLVE_TRANSCRIBE_SCRIPT}` };
  }

  const args = [
    RESOLVE_TRANSCRIBE_SCRIPT,
    '--file_path', filePath,
  ];
  if (footageId != null) args.push('--footage_id', String(footageId));

  onProgress?.({ stage: 'resolve_transcribe_start', file: path.basename(filePath) });

  return new Promise((resolve) => {
    const proc = spawn(pythonBin, args, {
      windowsHide: true,
      timeout: 360_000,  // 6 minutes — Resolve transcription can be slow on long clips
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });

    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      // Surface progress lines to SSE caller
      for (const line of chunk.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        if (l.startsWith('[progress]') || l.startsWith('[resolve]') || l.startsWith('[filter]')) {
          onProgress?.({ stage: 'resolve_progress', line: l });
        }
      }
    });

    proc.on('error', (err) => {
      resolve({ ok: false, error: `Failed to spawn resolve-transcribe.py: ${err.message}` });
    });

    proc.on('close', (code) => {
      const raw = stdout.trim();
      if (!raw) {
        resolve({
          ok: false,
          error: `resolve-transcribe.py produced no output (exit ${code}). stderr: ${stderr.slice(-400)}`
        });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.ok) {
          resolve({ ok: false, error: parsed.error || 'resolve-transcribe returned ok:false' });
          return;
        }
        resolve({ ok: true, ...parsed });
      } catch (e) {
        resolve({ ok: false, error: `resolve-transcribe.py JSON parse failed: ${e.message}. stdout: ${raw.slice(0, 200)}` });
      }
    });
  });
}

// ─────────────────────────────────────────────
// MODIFIED transcribeFile — tries Resolve first, falls back to Whisper
//
// Strategy:
//   1. If TRANSCRIBE_ENGINE=whisper env var is set → skip Resolve, go straight to Whisper
//   2. Try Resolve (transcribeWithResolve) — succeeds if DaVinci is running
//   3. If Resolve fails/unavailable → fall back to Whisper transparently
//   4. Either way: write to database/transcripts/, update DB, return same schema
//
// Zero changes needed in any caller (selects-new.js, assemblr.js, clipsr.js, etc.)
// ─────────────────────────────────────────────

const _originalTranscribeFile = transcribeFile;

async function transcribeFileSmart(filePath, options = {}) {
  const { footageId = null, onProgress = null } = options;

  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const slug     = transcriptSlug(filePath);
  const destPath = path.join(TRANSCRIPTS_DIR, slug + '.json');

  // Already transcribed? Serve from cache immediately
  if (fs.existsSync(destPath)) {
    onProgress?.({ stage: 'skipped', reason: 'already transcribed' });
    const existing = JSON.parse(fs.readFileSync(destPath, 'utf8'));
    return { ok: true, skipped: true, transcript_path: destPath, ...existing };
  }

  // Force-Whisper override
  const forceWhisper = (process.env.TRANSCRIBE_ENGINE || '').toLowerCase() === 'whisper';

  let transcript = null;
  let usedEngine  = null;

  // ── Try Resolve first ───────────────────────────────────────────────────
  if (!forceWhisper) {
    onProgress?.({ stage: 'resolve_attempt', message: 'Trying DaVinci Resolve transcription…' });
    const resolveResult = await transcribeWithResolve(filePath, { footageId, onProgress });

    if (resolveResult.ok && resolveResult.segments && resolveResult.segments.length > 0) {
      const src = resolveResult._source || 'resolve';
      transcript = {
        footage_id: footageId,
        file_path:  filePath,
        language:   resolveResult.language || 'en',
        text:       resolveResult.text      || '',
        duration:   resolveResult.duration  || 0,
        segments:   resolveResult.segments  || [],
        _source:    src,
      };
      usedEngine = src;
      onProgress?.({ stage: 'resolve_success', source: src, segments: transcript.segments.length });
    } else {
      // Resolve unavailable or failed — log and fall through to Whisper
      const reason = resolveResult.error || 'unknown';
      onProgress?.({ stage: 'resolve_fallback', message: `Resolve unavailable (${reason}), falling back to Whisper…` });
    }
  }

  // ── Fall back to Whisper ─────────────────────────────────────────────────
  if (!transcript) {
    // Reset detection cache — Resolve path may have set it to "not found" on a
    // timeout during the DaVinci attempt. Re-probe so Whisper gets a clean shot.
    resetWhisperCache();
    onProgress?.({ stage: 'whisper_start_fallback' });
    const whisperResult = await _originalTranscribeFile(filePath, options);
    // _originalTranscribeFile already writes the file and updates DB — just return
    return whisperResult;
  }

  // ── Write transcript file + update DB ────────────────────────────────────
  ensureTranscriptsDir();
  fs.writeFileSync(destPath, JSON.stringify(transcript, null, 2));

  if (footageId) {
    db.updateFootage(footageId, {
      transcript_path: destPath,
      transcript:      transcript.text
    });
  }

  onProgress?.({
    stage:    'transcribed',
    engine:   usedEngine,
    segments: transcript.segments.length,
    duration: transcript.duration,
  });

  return { ok: true, transcript_path: destPath, ...transcript };
}

module.exports = {
  transcribeFile:        transcribeFileSmart,   // primary export — Resolve-first
  transcribeWithResolve,                        // exposed so vault route can call it directly
  checkWhisper,
  detectPython,
  resetWhisperCache,
  TRANSCRIPTS_DIR,
};
