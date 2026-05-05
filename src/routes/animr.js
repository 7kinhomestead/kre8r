'use strict';
/**
 * AnimΩr — Remotion motion-graphics render route
 * POST /api/animr/render        — start render job (returns jobId)
 * GET  /api/animr/render/:id/stream — SSE progress
 * GET  /api/animr/renders       — list completed renders
 * DELETE /api/animr/renders/:filename — delete a render
 */

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { EventEmitter } = require('events');
const { startSseResponse } = require('../utils/sse');
const logger   = require('../utils/logger');

const router = express.Router();

const RENDERS_DIR = path.join(__dirname, '../../public/animr-renders');
fs.mkdirSync(RENDERS_DIR, { recursive: true });

// In-memory job store (render jobs don't need persistence)
const jobs = new Map();

function makeJobId() {
  return `animr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── POST /api/animr/render ────────────────────────────────────────────────────
router.post('/render', async (req, res) => {
  const { composition, props = {}, durationInFrames, fps = 30, transparent = false } = req.body;

  if (!composition) return res.status(400).json({ error: 'composition required' });

  const jobId = makeJobId();
  const emitter = new EventEmitter();
  const events  = [];

  const emit = (data) => {
    events.push(data);
    emitter.emit('event', data);
  };

  const job = { status: 'running', events, emitter, jobId };
  jobs.set(jobId, job);

  res.json({ jobId });

  // Run render asynchronously
  (async () => {
    try {
      emit({ type: 'log', msg: 'Bundling compositions…' });

      const { bundle }       = require('@remotion/bundler');
      const { renderMedia, selectComposition } = require('@remotion/renderer');

      const rootFile = path.join(__dirname, '../animr/Root.jsx');

      const bundleLocation = await bundle({
        entryPoint: rootFile,
        onProgress: (pct) => {
          emit({ type: 'bundle_progress', pct: Math.round(pct * 100) });
        },
      });

      emit({ type: 'log', msg: 'Bundle ready. Selecting composition…' });

      const inputProps = props || {};

      const comp = await selectComposition({
        serveUrl: bundleLocation,
        id: composition,
        inputProps,
      });

      // Override duration if caller specified one
      if (durationInFrames) comp.durationInFrames = durationInFrames;

      const ext         = transparent ? 'mov' : 'mp4';
      const outFilename = `${composition}_${Date.now()}.${ext}`;
      const outputLocation = path.join(RENDERS_DIR, outFilename);

      emit({ type: 'log', msg: `Rendering ${comp.durationInFrames} frames at ${fps}fps${transparent ? ' (ProRes 4444 α)' : ''}…` });

      if (transparent) {
        // ── Transparent path: PNG frames → ProRes 4444 .mov with true alpha ──
        // Remotion's 'prores' codec maps to the `prores` ffmpeg encoder which
        // does NOT support alpha. We must use `prores_ks` with yuva444p10le.
        // Solution: render RGBA PNG frames via renderFrames, then stitch with
        // a direct ffmpeg call using prores_ks -profile:v 4444.
        const { renderFrames } = require('@remotion/renderer');
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const execFileAsync  = promisify(execFile);

        const framesDir = path.join(RENDERS_DIR, `_frames_${jobId}`);
        fs.mkdirSync(framesDir, { recursive: true });

        try {
          emit({ type: 'log', msg: 'Rendering RGBA PNG frames…' });

          await renderFrames({
            composition: comp,
            serveUrl:    bundleLocation,
            outputDir:   framesDir,
            inputProps,
            imageFormat: 'png',
            fps,
            onFrameUpdate: (rendered) => {
              emit({ type: 'render_progress', pct: Math.round((rendered / comp.durationInFrames) * 80) });
            },
          });

          emit({ type: 'log', msg: 'Stitching ProRes 4444 with alpha channel…' });

          // Build concat list (alphabetical sort = correct frame order)
          const frameFiles = fs.readdirSync(framesDir)
            .filter(f => f.endsWith('.png'))
            .sort();

          if (!frameFiles.length) throw new Error('renderFrames produced no PNG frames');

          const concatPath = path.join(framesDir, 'concat.txt');
          fs.writeFileSync(concatPath,
            frameFiles.map(f =>
              `file '${path.join(framesDir, f).replace(/\\/g, '/')}'`
            ).join('\n')
          );

          const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
          await execFileAsync(ffmpegBin, [
            '-f', 'concat', '-safe', '0',
            '-r', String(fps),
            '-i', concatPath,
            '-c:v', 'prores_ks',
            '-profile:v', '4444',
            '-pix_fmt', 'yuva444p10le',
            '-r', String(fps),
            '-y', outputLocation,
          ]);

          emit({ type: 'render_progress', pct: 100 });

        } finally {
          fs.rmSync(framesDir, { recursive: true, force: true });
        }

      } else {
        // ── Standard h264 path ────────────────────────────────────────────────
        await renderMedia({
          composition: comp,
          serveUrl:    bundleLocation,
          codec:       'h264',
          outputLocation,
          inputProps,
          fps,
          onProgress: ({ progress }) => {
            emit({ type: 'render_progress', pct: Math.round(progress * 100) });
          },
        });
      }

      const stat = fs.statSync(outputLocation);
      emit({
        type: 'done',
        filename: outFilename,
        url: `/animr-renders/${outFilename}`,
        sizeBytes: stat.size,
      });

      job.status   = 'done';
      job.filename = outFilename;
      job.url      = `/animr-renders/${outFilename}`;

    } catch (err) {
      logger.error({ err }, 'AnimΩr render failed');
      emit({ type: 'error', error: err.message });
      job.status = 'error';
    } finally {
      emitter.emit('done');
      // Clean up job after 10 min
      setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
    }
  })();
});

// ── GET /api/animr/render/:id/stream ─────────────────────────────────────────
router.get('/render/:id/stream', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });

  const { send, end } = startSseResponse(res, { timeoutMs: 10 * 60 * 1000 });

  // Replay buffered events
  for (const ev of job.events) send(ev);

  if (job.status !== 'running') { end(); return; }

  const onEvent = (data) => send(data);
  const onDone  = () => end();

  job.emitter.on('event', onEvent);
  job.emitter.once('done', onDone);

  req.on('close', () => {
    job.emitter.off('event', onEvent);
    job.emitter.off('done', onDone);
  });
});

// ── GET /api/animr/renders ───────────────────────────────────────────────────
router.get('/renders', (req, res) => {
  try {
    const files = fs.readdirSync(RENDERS_DIR)
      .filter(f => f.endsWith('.mp4') || f.endsWith('.mov'))
      .map(f => {
        const stat = fs.statSync(path.join(RENDERS_DIR, f));
        return {
          filename: f,
          url: `/animr-renders/${f}`,
          sizeBytes: stat.size,
          createdAt: stat.birthtime,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ renders: files });
  } catch (err) {
    logger.error({ err }, 'animr list renders');
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/animr/renders/:filename ──────────────────────────────────────
router.delete('/renders/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  if (!safe.endsWith('.mp4') && !safe.endsWith('.mov')) return res.status(400).json({ error: 'mp4/mov only' });
  const fp = path.join(RENDERS_DIR, safe);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'animr delete render');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
