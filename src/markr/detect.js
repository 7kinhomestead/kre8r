'use strict';

/**
 * MarkΩr — Detection Engine
 *
 * Given a video file (or URL to download), runs multi-layer detection:
 *   Layer 1: pHash comparison against video_fingerprints table (Hamming distance)
 *   Layer 2: Audio fingerprint comparison against audio_fingerprints table
 *   Layer 3: Watermark extraction against watermarks table
 *
 * Confidence score (0–100):
 *   pHash match:     40% weight
 *   Audio match:     40% weight
 *   Watermark match: 20% weight
 *
 * Thresholds:
 *   ≥ 70 → confirmed match
 *   40–69 → possible match (ask for more info)
 *   < 40  → no match
 */

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const crypto    = require('crypto');
const https     = require('https');
const http      = require('http');
const { execFile } = require('child_process');

const db          = require('../db');
const { fingerprintVideo, fingerprintAudio, computePHash, hammingDistance, FRAME_INTERVAL_S } = require('./fingerprint');
const { detectWatermark } = require('./watermark');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// Hamming distance thresholds for pHash comparison
const PHASH_EXACT  = 5;   // ≤ 5 bits → almost certainly same video
const PHASH_STRONG = 12;  // ≤ 12 bits → very likely same video
const PHASH_WEAK   = 20;  // ≤ 20 bits → possible match (heavy compression)

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Download a URL to a temporary file. Returns the file path.
 * Only supports http/https. Caller must clean up the file.
 */
function downloadToTmp(url, ext = '.mp4') {
  return new Promise((resolve, reject) => {
    const tmpPath = path.join(os.tmpdir(), `markr-dl-${crypto.randomBytes(6).toString('hex')}${ext}`);
    const file = fs.createWriteStream(tmpPath);
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, res => {
      if (res.statusCode !== 200) {
        file.destroy();
        return reject(new Error(`HTTP ${res.statusCode} downloading: ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(tmpPath); });
    }).on('error', err => {
      fs.unlink(tmpPath, () => {});
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Layer 1: pHash comparison
// ─────────────────────────────────────────────────────────────────

/**
 * Compare a video file's frames against the entire video_fingerprints DB.
 *
 * Returns the best match found, including:
 *   - matched footage_id / video_path
 *   - average Hamming distance over matched frames
 *   - confidence score (0–100)
 */
async function compareByPHash(videoPath) {
  // Get all stored hashes (grouped by video)
  const allHashes = db.getAllVideoFingerprints();
  if (!allHashes.length) return { match: false, confidence: 0 };

  // Extract frames from the query video
  const { hashes: queryHashes } = await fingerprintVideo(videoPath, null, {});
  if (!queryHashes.length) return { match: false, confidence: 0 };

  // Group stored hashes by video_path
  const byVideo = new Map();
  for (const row of allHashes) {
    if (!byVideo.has(row.video_path)) byVideo.set(row.video_path, []);
    byVideo.get(row.video_path).push(row);
  }

  let bestMatch   = null;
  let bestScore   = 0;

  for (const [storedPath, storedHashes] of byVideo) {
    // For each query frame, find the closest stored hash from the same video
    let totalDist = 0;
    let matchCount = 0;

    for (const qf of queryHashes) {
      let minDist = 64;
      for (const sf of storedHashes) {
        const d = hammingDistance(qf.phash, sf.phash);
        if (d < minDist) minDist = d;
      }
      totalDist += minDist;
      if (minDist <= PHASH_WEAK) matchCount++;
    }

    if (queryHashes.length === 0) continue;
    const avgDist = totalDist / queryHashes.length;
    const matchRatio = matchCount / queryHashes.length;

    // Score: combination of average distance and match ratio
    let score = 0;
    if (avgDist <= PHASH_EXACT)  score = 95;
    else if (avgDist <= PHASH_STRONG) score = 75 + (PHASH_STRONG - avgDist) * (20 / (PHASH_STRONG - PHASH_EXACT));
    else if (avgDist <= PHASH_WEAK)   score = 40 + matchRatio * 35;
    else score = Math.max(0, 40 - (avgDist - PHASH_WEAK) * 2);

    if (score > bestScore) {
      bestScore = score;
      const representative = storedHashes[0];
      bestMatch = {
        video_path: storedPath,
        footage_id: representative.footage_id,
        avg_hamming: parseFloat(avgDist.toFixed(1)),
        match_ratio: parseFloat(matchRatio.toFixed(2)),
        confidence:  Math.round(score),
      };
    }
  }

  if (!bestMatch || bestScore < 20) return { match: false, confidence: 0 };

  return {
    match: bestScore >= 40,
    confidence: bestScore,
    details: bestMatch,
    layer: 'phash',
  };
}

// ─────────────────────────────────────────────────────────────────
// Layer 2: Audio fingerprint comparison
// ─────────────────────────────────────────────────────────────────

/**
 * Compare a video's audio fingerprint against all stored audio fingerprints.
 *
 * Uses correlation of RMS energy sequences.
 * Returns best match confidence (0–100).
 */
async function compareByAudio(videoPath) {
  const allAudio = db.getAllAudioFingerprints();
  if (!allAudio.length) return { match: false, confidence: 0 };

  // Fingerprint the query video
  const { fingerprint: queryFP } = await fingerprintAudio(videoPath, null);
  if (!queryFP || !queryFP.length) return { match: false, confidence: 0 };

  let bestMatch   = null;
  let bestScore   = 0;

  for (const row of allAudio) {
    let storedFP;
    try { storedFP = JSON.parse(row.fingerprint_data); }
    catch (_) { continue; }
    if (!storedFP || !storedFP.length) continue;

    // Slide the shorter fingerprint over the longer one to find best alignment
    const qLen = queryFP.length;
    const sLen = storedFP.length;
    const minLen = Math.min(qLen, sLen, 30); // cap at 30 seconds for speed

    let bestCorrForVideo = 0;
    const maxShift = Math.abs(qLen - sLen);

    for (let shift = 0; shift <= Math.min(maxShift, 10); shift++) {
      const qStart = shift < qLen - minLen ? shift : 0;
      const sStart = shift < sLen - minLen ? shift : 0;

      let dotProduct = 0, normQ = 0, normS = 0;
      for (let i = 0; i < minLen; i++) {
        const q = queryFP[qStart + i] || 0;
        const s = storedFP[sStart + i] || 0;
        dotProduct += q * s;
        normQ += q * q;
        normS += s * s;
      }
      const corr = normQ > 0 && normS > 0
        ? dotProduct / (Math.sqrt(normQ) * Math.sqrt(normS))
        : 0;
      if (corr > bestCorrForVideo) bestCorrForVideo = corr;
    }

    const score = Math.round(Math.min(100, Math.max(0, bestCorrForVideo * 100)));
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { video_path: row.video_path, footage_id: row.footage_id, correlation: bestCorrForVideo };
    }
  }

  if (!bestMatch || bestScore < 20) return { match: false, confidence: 0 };

  return {
    match: bestScore >= 40,
    confidence: bestScore,
    details: bestMatch,
    layer: 'audio',
  };
}

// ─────────────────────────────────────────────────────────────────
// Layer 3: Watermark check
// ─────────────────────────────────────────────────────────────────

/**
 * Test a video against all known watermark seeds.
 * Returns the first matching watermark (if any) and its confidence.
 */
async function compareByWatermark(videoPath) {
  const allWatermarks = db.getAllWatermarks();
  if (!allWatermarks.length) return { match: false, confidence: 0 };

  for (const wm of allWatermarks) {
    const { match, confidence } = await detectWatermark(videoPath, wm.seed);
    if (match) {
      return {
        match: true,
        confidence,
        details: {
          watermark_id:   wm.id,
          seed:           wm.seed,
          watermark_code: wm.watermark_code,
          original_path:  wm.video_path,
          footage_id:     wm.footage_id,
          channel:        wm.channel,
        },
        layer: 'watermark',
      };
    }
  }
  return { match: false, confidence: 0 };
}

// ─────────────────────────────────────────────────────────────────
// Multi-layer detection
// ─────────────────────────────────────────────────────────────────

/**
 * Run all detection layers against a video file.
 *
 * @param {string} videoPath       Absolute path to video to check
 * @param {{ runWatermark?: boolean }} opts
 * @returns {Promise<DetectionResult>}
 *
 * DetectionResult:
 *   {
 *     overall_confidence: number (0–100)
 *     verdict: 'confirmed' | 'possible' | 'none'
 *     match_type: 'watermark' | 'phash' | 'audio' | 'multi' | 'none'
 *     matched_footage_id: number | null
 *     matched_video_path: string | null
 *     evidence: { phash, audio, watermark }
 *   }
 */
async function detectInVideo(videoPath, opts = {}) {
  const { runWatermark = true } = opts;

  const [phashResult, audioResult] = await Promise.all([
    compareByPHash(videoPath).catch(e => ({ match: false, confidence: 0, error: e.message })),
    compareByAudio(videoPath).catch(e => ({ match: false, confidence: 0, error: e.message })),
  ]);

  let watermarkResult = { match: false, confidence: 0 };
  if (runWatermark) {
    watermarkResult = await compareByWatermark(videoPath).catch(e => ({ match: false, confidence: 0, error: e.message }));
  }

  // Weighted aggregate (pHash 40% + audio 40% + watermark 20%)
  const combined =
    (phashResult.confidence     * 0.40) +
    (audioResult.confidence     * 0.40) +
    (watermarkResult.confidence * 0.20);

  const overallConfidence = Math.round(Math.min(100, combined));

  let verdict;
  if (overallConfidence >= 70)      verdict = 'confirmed';
  else if (overallConfidence >= 40) verdict = 'possible';
  else                              verdict = 'none';

  // Determine match type
  const matchLayers = [
    phashResult.match     && 'phash',
    audioResult.match     && 'audio',
    watermarkResult.match && 'watermark',
  ].filter(Boolean);

  let matchType = 'none';
  if (matchLayers.length >= 2)     matchType = 'multi';
  else if (matchLayers.length === 1) matchType = matchLayers[0];

  // Pick the best-matching footage_id across layers
  const matchedFootageId =
    watermarkResult.details?.footage_id ||
    phashResult.details?.footage_id     ||
    audioResult.details?.footage_id     ||
    null;

  const matchedVideoPath =
    watermarkResult.details?.original_path ||
    phashResult.details?.video_path        ||
    audioResult.details?.video_path        ||
    null;

  // Look up footage info from DB
  let matchedVideoTitle = null;
  if (matchedFootageId) {
    const footage = db.getFootageById ? db.getFootageById(matchedFootageId) : null;
    if (footage) matchedVideoTitle = footage.filename || footage.title || null;
  }

  return {
    overall_confidence:  overallConfidence,
    verdict,
    match_type:          matchType,
    matched_footage_id:  matchedFootageId,
    matched_video_path:  matchedVideoPath,
    matched_video_title: matchedVideoTitle,
    evidence: {
      phash:     phashResult,
      audio:     audioResult,
      watermark: watermarkResult,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────

module.exports = {
  detectInVideo,
  compareByPHash,
  compareByAudio,
  compareByWatermark,
  PHASH_EXACT,
  PHASH_STRONG,
  PHASH_WEAK,
};
