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
// WhisperX (forced alignment — fixes cumulative timestamp drift on long takes).
// Preferred when installed; classic whisper remains the fallback.
const WHISPERX_MODEL   = process.env.WHISPERX_MODEL || 'large-v3';
const WHISPERX_ENABLED = process.env.WHISPERX_DISABLED !== '1';
const TRANSCRIPTS_DIR = path.join(__dirname, '..', '..', 'database', 'transcripts');

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
      timeout: 10_000
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

// WhisperX detection — cached like the whisper probe above
let _whisperxBinary = null;   // null = unprobed, '' = not found, string = binary

async function detectWhisperX() {
  if (_whisperxBinary !== null) return _whisperxBinary || null;
  if (!WHISPERX_ENABLED) { _whisperxBinary = ''; return null; }
  for (const bin of WHISPER_CANDIDATES) {
    const ok = await new Promise((resolve) => {
      const proc = spawn(bin, ['-c', 'import whisperx; print(1)'], {
        windowsHide: true, timeout: 15_000
      });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
    if (ok) {
      _whisperxBinary = bin;
      console.log(`[WhisperX] Detected binary: ${bin}`);
      return bin;
    }
  }
  _whisperxBinary = '';
  return null;
}

async function checkWhisper() {
  const binary = await detectWhisperBinary();
  const xBinary = await detectWhisperX();
  return {
    whisper:         binary !== null,
    whisper_binary:  binary || null,
    whisper_version: _whisperVersion || null,
    whisperx:        xBinary !== null,
    whisperx_model:  xBinary ? WHISPERX_MODEL : null
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

    const args = [
      '-m', 'whisper',
      filePath,
      '--model',           modelToUse,
      '--output_format',   'json',
      '--word_timestamps', 'True',
      '--output_dir',      TRANSCRIPTS_DIR,
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
// RUN WHISPERX (preferred path)
// python -m whisperx <file> --model large-v3 --device cuda --compute_type float16
// GPU float16 ≈ 29x realtime measured on the 3070 Ti (Jul 15 2026).
// Throws on failure — caller falls back to classic whisper.
// ─────────────────────────────────────────────

async function runWhisperX(filePath, onProgress = null) {
  const binary = await detectWhisperX();
  if (!binary) throw new Error('WhisperX not installed');

  return new Promise((resolve, reject) => {
    ensureTranscriptsDir();
    const args = [
      '-m', 'whisperx', filePath,
      '--model',        WHISPERX_MODEL,
      '--language',     'en',
      '--device',       'cuda',
      '--compute_type', 'float16',
      '--batch_size',   '8',
      '--output_dir',   TRANSCRIPTS_DIR,
      '--output_format','json',
    ];
    onProgress?.({ stage: 'whisper_start', model: `whisperx/${WHISPERX_MODEL}`, file: path.basename(filePath) });

    const ffmpegBinDir = process.env.FFMPEG_PATH ? path.dirname(process.env.FFMPEG_PATH) : null;
    const childEnv = { ...process.env };
    if (ffmpegBinDir) childEnv.PATH = ffmpegBinDir + path.delimiter + (childEnv.PATH || '');

    const proc = spawn(binary, args, { windowsHide: true, env: childEnv, timeout: 1_800_000 });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      if (chunk.includes('Performing') || chunk.includes('%|')) {
        onProgress?.({ stage: 'whisper_progress', line: chunk.trim().slice(0, 200) });
      }
    });
    proc.on('error', (err) => reject(new Error(`WhisperX spawn failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`WhisperX exited ${code}: ${stderr.slice(-500)}`));
      resolve();
    });
  });
}

// ─────────────────────────────────────────────
// PARSE WHISPER JSON OUTPUT
// Whisper names the output file after the input filename stem.
// Handles BOTH shapes: classic whisper (text, segments[].words[].probability)
// and whisperx (segments[].words[].score, often no top-level text).
// ─────────────────────────────────────────────

function parseWhisperOutput(filePath) {
  const stem     = path.basename(filePath, path.extname(filePath));
  const jsonPath = path.join(TRANSCRIPTS_DIR, stem + '.json');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Whisper output not found: ${jsonPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Normalise to our schema. WhisperX words carry `score` and may lack start/end
  // on unalignable tokens (numbers, noises) — inherit the segment edge.
  const segments = (raw.segments || []).map((seg, i) => ({
    id:    i,
    start: parseFloat((seg.start ?? 0).toFixed(3)),
    end:   parseFloat((seg.end ?? seg.start ?? 0).toFixed(3)),
    text:  (seg.text || '').trim(),
    words: (seg.words || []).map(w => ({
      word:        (w.word || '').trim(),
      start:       parseFloat(((w.start ?? seg.start) || 0).toFixed(3)),
      end:         parseFloat(((w.end ?? w.start ?? seg.end) || 0).toFixed(3)),
      probability: parseFloat(((w.probability ?? w.score) || 1).toFixed(4))
    }))
  }));

  const duration = segments.length > 0
    ? segments[segments.length - 1].end
    : null;

  // whisperx JSON has no top-level `text` — assemble it from segments
  const fullText = (raw.text || segments.map(s => s.text).join(' ')).trim();

  return {
    language: raw.language || 'en',
    text:     fullText,
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

  // Run WhisperX (preferred — forced alignment, no drift); fall back to
  // classic whisper if it's not installed or the GPU path fails.
  try {
    await runWhisperX(filePath, onProgress);
  } catch (xErr) {
    if (await detectWhisperX()) {
      console.warn(`[WhisperX] failed (${xErr.message.slice(0, 200)}) — falling back to whisper`);
    }
    try {
      await runWhisper(filePath, onProgress);
    } catch (e) {
      return { ok: false, error: e.message };
    }
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

module.exports = { transcribeFile, checkWhisper, detectPython, resetWhisperCache, TRANSCRIPTS_DIR };
