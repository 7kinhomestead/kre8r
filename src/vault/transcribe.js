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

const PYTHON_PATH    = process.env.PYTHON_PATH    || 'python';
const WHISPER_MODEL  = process.env.WHISPER_MODEL  || 'base';
const TRANSCRIPTS_DIR = path.join(__dirname, '..', '..', 'database', 'transcripts');

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

function runWhisper(filePath, onProgress = null) {
  return new Promise((resolve, reject) => {
    ensureTranscriptsDir();

    const args = [
      '-m', 'whisper',
      filePath,
      '--model',         WHISPER_MODEL,
      '--output_format', 'json',
      '--word_timestamps', 'True',
      '--output_dir',    TRANSCRIPTS_DIR,
      '--verbose',       'False'
    ];

    onProgress?.({ stage: 'whisper_start', model: WHISPER_MODEL, file: path.basename(filePath) });

    // Whisper calls ffmpeg internally to decode audio — inject the bin dir into PATH
    // so it can find it even when the system PATH doesn't include it.
    const ffmpegBinDir = process.env.FFMPEG_PATH
      ? path.dirname(process.env.FFMPEG_PATH)
      : null;
    const childEnv = { ...process.env };
    if (ffmpegBinDir) {
      childEnv.PATH = ffmpegBinDir + path.delimiter + (childEnv.PATH || '');
    }

    const proc = spawn(PYTHON_PATH, args, { windowsHide: true, env: childEnv });

    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Whisper logs progress to stderr — surface key lines
      if (chunk.includes('%|') || chunk.includes('Detecting language') || chunk.includes('Transcribing')) {
        onProgress?.({ stage: 'whisper_progress', line: chunk.trim() });
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Whisper: ${err.message}. Check PYTHON_PATH in .env`));
    });

    proc.on('close', (code) => {
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
    transcript = {
      footage_id: footageId,
      file_path:  filePath,
      language:   parsed.language,
      text:       parsed.text,
      duration:   parsed.duration,
      segments:   parsed.segments
    };
    fs.writeFileSync(finalPath, JSON.stringify(transcript, null, 2));

    onProgress?.({ stage: 'transcribed', segments: transcript.segments.length, duration: transcript.duration });

    // Update DB if footageId provided
    if (footageId) {
      db.updateFootage(footageId, { transcript_path: finalPath });
    }

    return { ok: true, transcript_path: finalPath, ...transcript };

  } catch (e) {
    return { ok: false, error: `Parse failed: ${e.message}` };
  }
}

module.exports = { transcribeFile, TRANSCRIPTS_DIR };
