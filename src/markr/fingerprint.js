'use strict';

/**
 * MarkΩr — Perceptual Hash Fingerprinting
 *
 * Extracts frame-level pHash fingerprints from video files using FFmpeg + sharp.
 * Stores results in video_fingerprints table via db helpers.
 *
 * pHash algorithm:
 *   1. Extract a JPEG frame via FFmpeg at the given timestamp
 *   2. Use sharp to resize to 32×32 grayscale
 *   3. Compute 2D DCT over the pixel grid
 *   4. Extract the top-left 8×8 block (64 coefficients, excluding DC)
 *   5. Median-threshold → 64-bit binary → 16-char hex string
 *
 * Hamming distance of ≤ 10 bits = same video (accounts for re-encoding & compression)
 * Hamming distance of ≤ 20 bits = likely same video after heavy compression
 * Hamming distance > 20 bits     = different video
 */

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');
const { execFile } = require('child_process');
const sharp   = require('sharp');
const db      = require('../db');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// Interval between sampled frames (seconds)
const FRAME_INTERVAL_S = 5;

// ─────────────────────────────────────────────────────────────────
// pHash computation
// ─────────────────────────────────────────────────────────────────

/**
 * Compute a 64-bit perceptual hash of an image file.
 * Returns a 16-character lowercase hex string.
 */
async function computePHash(imagePath) {
  // 1. Resize to 32×32 grayscale, get raw luma bytes
  const { data } = await sharp(imagePath)
    .resize(32, 32, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // data is a Uint8Array of 1024 bytes (32×32 luma values)
  const pixels = new Float64Array(1024);
  for (let i = 0; i < 1024; i++) pixels[i] = data[i];

  // 2. 2D DCT — row-major; we only need the top-left 8×8 output block
  // Using separable 1D DCT: apply row-wise, then column-wise
  const N = 32;
  const dct = new Float64Array(N * N);

  // Row-wise 1D DCT
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < N; u++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        sum += pixels[y * N + x] * Math.cos((2 * x + 1) * u * Math.PI / (2 * N));
      }
      dct[y * N + u] = sum;
    }
  }

  // Column-wise 1D DCT (into the top-left 8×8 block — we only need u,v < 8)
  const block = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      if (u === 0 && v === 0) { block[v * 8 + u] = 0; continue; } // skip DC
      let sum = 0;
      for (let y = 0; y < N; y++) {
        sum += dct[y * N + u] * Math.cos((2 * y + 1) * v * Math.PI / (2 * N));
      }
      block[v * 8 + u] = sum;
    }
  }

  // 3. Compute median of the 63 AC coefficients (excluding DC at [0,0])
  const acValues = Array.from(block).filter((_, i) => i !== 0);
  const sorted   = [...acValues].sort((a, b) => a - b);
  const median   = sorted[Math.floor(sorted.length / 2)];

  // 4. Binarise → 64-bit hash, convert to 16-char hex
  let hi = 0, lo = 0;
  for (let i = 0; i < 64; i++) {
    const bit = block[i] >= median ? 1 : 0;
    if (i < 32) hi = (hi * 2 + bit) >>> 0;
    else        lo = (lo * 2 + bit) >>> 0;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/**
 * Compute Hamming distance between two 16-char hex pHash strings.
 * Returns number of differing bits (0–64).
 */
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== 16 || hash2.length !== 16) return 64;
  let dist = 0;
  for (let i = 0; i < 4; i++) {
    const a = parseInt(hash1.slice(i * 4, i * 4 + 4), 16);
    const b = parseInt(hash2.slice(i * 4, i * 4 + 4), 16);
    let xor = (a ^ b) >>> 0;
    while (xor) { dist += xor & 1; xor >>>= 1; }
  }
  return dist;
}

// ─────────────────────────────────────────────────────────────────
// Frame extraction (FFmpeg)
// ─────────────────────────────────────────────────────────────────

/**
 * Extract a single JPEG frame at `timeSecs` from `videoPath`.
 * Returns path to the temporary JPEG file. Caller must clean it up.
 */
function extractFrame(videoPath, timeSecs, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss',  String(timeSecs),
      '-i',   videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      outputPath,
    ];
    execFile(FFMPEG_PATH, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(`FFmpeg frame extract failed at ${timeSecs}s: ${stderr || err.message}`));
      if (!fs.existsSync(outputPath)) return reject(new Error(`FFmpeg did not write frame at ${timeSecs}s`));
      resolve(outputPath);
    });
  });
}

/**
 * Get video duration in seconds via ffprobe.
 */
function getVideoDuration(videoPath) {
  const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
  return new Promise((resolve, reject) => {
    const args = [
      '-v',        'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath,
    ];
    execFile(FFPROBE_PATH, args, (err, stdout) => {
      if (err) return reject(err);
      try {
        const info = JSON.parse(stdout);
        resolve(parseFloat(info.format.duration) || 0);
      } catch (e) {
        reject(new Error('Could not parse ffprobe output'));
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Main fingerprint job
// ─────────────────────────────────────────────────────────────────

/**
 * Fingerprint a video: extract frame pHashes every FRAME_INTERVAL_S seconds.
 * Stores results in video_fingerprints table.
 *
 * @param {string} videoPath   Absolute path to video file
 * @param {number|null} footageId  FK to vault_footage (nullable)
 * @param {{ onProgress?: function }} opts
 * @returns {Promise<{ frameCount: number, hashes: Array }>}
 */
async function fingerprintVideo(videoPath, footageId = null, opts = {}) {
  const { onProgress } = opts;

  // Already fingerprinted? Skip (idempotent).
  const existing = db.getVideoFingerprints(videoPath);
  if (existing.length > 0) {
    return { frameCount: existing.length, hashes: existing, skipped: true };
  }

  const duration = await getVideoDuration(videoPath);
  if (!duration || duration < 1) {
    throw new Error(`Could not determine duration for: ${path.basename(videoPath)}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markr-'));
  const hashes = [];
  let frameIndex = 0;

  try {
    const timestamps = [];
    for (let t = 0; t < duration - 0.5; t += FRAME_INTERVAL_S) {
      timestamps.push(parseFloat(t.toFixed(2)));
    }
    // Always include the last frame area
    if (duration > FRAME_INTERVAL_S) {
      timestamps.push(parseFloat((duration - 1).toFixed(2)));
    }

    for (const t of timestamps) {
      const framePath = path.join(tmpDir, `frame_${frameIndex}.jpg`);
      try {
        await extractFrame(videoPath, t, framePath);
        const phash = await computePHash(framePath);

        db.insertVideoFingerprint({
          footage_id:  footageId,
          video_path:  videoPath,
          frame_index: frameIndex,
          frame_time_s: t,
          phash,
        });

        hashes.push({ frameIndex, frameTimeS: t, phash });

        if (onProgress) onProgress({ frameIndex, total: timestamps.length, time: t });
      } catch (frameErr) {
        // Skip bad frames — don't fail the whole job
        console.warn(`[markr/fingerprint] Skipping frame at ${t}s: ${frameErr.message}`);
      }

      frameIndex++;

      // Clean up frame file immediately to save disk space
      try { fs.unlinkSync(framePath); } catch (_) {}
    }
  } finally {
    // Clean up temp dir
    try { fs.rmdirSync(tmpDir, { recursive: true }); } catch (_) {}
  }

  return { frameCount: hashes.length, hashes };
}

// ─────────────────────────────────────────────────────────────────
// Audio fingerprint (lightweight energy-band signature)
// ─────────────────────────────────────────────────────────────────

/**
 * Extract a simple audio energy fingerprint from a video.
 * Splits audio into 1-second chunks, computes RMS energy per octave band.
 * Stored as JSON array in audio_fingerprints table.
 *
 * NOTE: This is a lightweight "audio DNA" signature — not as robust as
 * Chromaprint/AcoustID but requires no extra binaries.
 */
async function fingerprintAudio(videoPath, footageId = null) {
  const existing = db.getAudioFingerprint(videoPath);
  if (existing) return { skipped: true, fingerprint: existing };

  const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
  const duration = await getVideoDuration(videoPath);
  if (!duration || duration < 2) return { skipped: true, fingerprint: null };

  // Extract raw audio as PCM s16le mono 8000Hz via ffmpeg stdout
  return new Promise((resolve, reject) => {
    const chunks = [];
    const args = [
      '-i',   videoPath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar',  '8000',
      '-ac',  '1',
      '-f',   'f32le',  // 32-bit float for easy RMS
      'pipe:1',
    ];

    const child = require('child_process').spawn(FFMPEG_PATH, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      try {
        const raw = Buffer.concat(chunks);
        // raw is float32le PCM at 8000 Hz mono
        const SAMPLES_PER_SEC = 8000;
        const BYTES_PER_SAMPLE = 4;
        const totalSamples = raw.length / BYTES_PER_SAMPLE;
        const fingerprintData = [];

        for (let sec = 0; sec < Math.floor(totalSamples / SAMPLES_PER_SEC); sec++) {
          let sumSq = 0;
          const offset = sec * SAMPLES_PER_SEC * BYTES_PER_SAMPLE;
          for (let i = 0; i < SAMPLES_PER_SEC; i++) {
            const s = raw.readFloatLE(offset + i * BYTES_PER_SAMPLE);
            sumSq += s * s;
          }
          const rms = Math.sqrt(sumSq / SAMPLES_PER_SEC);
          fingerprintData.push(parseFloat(rms.toFixed(5)));
        }

        db.insertAudioFingerprint({
          footage_id:       footageId,
          video_path:       videoPath,
          fingerprint_data: JSON.stringify(fingerprintData),
          duration_s:       duration,
        });

        resolve({ skipped: false, fingerprint: fingerprintData });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────

module.exports = {
  fingerprintVideo,
  fingerprintAudio,
  computePHash,
  hammingDistance,
  FRAME_INTERVAL_S,
};
