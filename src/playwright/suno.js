/**
 * Suno Playwright Automation — src/playwright/suno.js
 *
 * Drives suno.com/create via an existing CDP-connected Playwright page.
 * Uses the same Chrome session as the Kajabi automation — no new browser.
 *
 * generateOnSuno(page, opts) → { ok, files: [{destPath, publicPath, audioUrl}], error }
 *
 * IMPORTANT: Logs first 3000 chars of DOM before any click interaction so
 * selectors can be verified. Screenshots saved to /tmp/ on each step.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const { sceneSlug, ensureMusicDir } = require('../composor/suno-client');

const SUNO_CREATE_URL = 'https://suno.com/create';
const POLL_INTERVAL   = 15_000;   // 15s between audio checks
const POLL_TIMEOUT    = 300_000;  // 5min max per scene
const PROMPT_MAX_CHARS = 200;

// ─── Selector candidates — tried in order ─────────────────────────────────
// Suno is React — these cover known DOM shapes across recent UI versions.

const PROMPT_SELECTORS = [
  'textarea[placeholder*="Describe" i]',
  'textarea[placeholder*="Enter" i]',
  'textarea[placeholder*="music" i]',
  'textarea[placeholder*="song" i]',
  'textarea[data-testid*="prompt"]',
  'textarea',
];

const CREATE_SELECTORS = [
  'button:has-text("Create")',
  '[data-testid*="create-button"]',
  '[data-testid*="generate"]',
  'button[aria-label*="Create" i]',
  'button[type="submit"]:has-text("Create")',
];

// ─── Screenshot helper ─────────────────────────────────────────────────────

async function snap(page, sceneIndex, step, label) {
  const p = `/tmp/playwright-suno-${sceneIndex}-step${step}-${label}.png`;
  try { await page.screenshot({ path: p, fullPage: false }); } catch (_) {}
  console.log(`[suno.js] screenshot → ${p}`);
  return p;
}

// ─── DOM inspector — called BEFORE any interaction ─────────────────────────

async function inspectDOM(page, sceneIndex) {
  try {
    const content = await page.content();
    console.log(`\n[suno.js] ── DOM inspect (scene ${sceneIndex}) ──────────────────────`);
    console.log(content.slice(0, 3000));
    console.log('[suno.js] ─────────────────────────────────────────────────────────\n');
    return content;
  } catch (e) {
    console.warn('[suno.js] DOM inspect failed:', e.message);
    return '';
  }
}

// ─── Find prompt input — tries each selector ──────────────────────────────

async function findPromptInput(page) {
  for (const sel of PROMPT_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el) { console.log(`[suno.js] prompt input found: ${sel}`); return el; }
    } catch (_) {}
  }
  console.warn('[suno.js] No prompt input found with any candidate selector');
  return null;
}

// ─── Find Create button — tries each selector ─────────────────────────────

async function findCreateButton(page) {
  for (const sel of CREATE_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el) { console.log(`[suno.js] Create button found: ${sel}`); return el; }
    } catch (_) {}
  }
  console.warn('[suno.js] No Create button found with any candidate selector');
  return null;
}

// ─── Poll for audio tracks ─────────────────────────────────────────────────
// Suno generates 2 tracks per submission. Polls DOM for <audio src> elements.

async function waitForAudioTracks(page, sceneIndex) {
  console.log('[suno.js] Polling for audio tracks (15s interval, 5min max)...');
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    try {
      const urls = await page.evaluate(() => {
        // <audio src="..."> elements
        const fromAudio = [...document.querySelectorAll('audio[src]')]
          .map(a => a.src)
          .filter(s => s && s.startsWith('http'));

        // <audio><source src="..."> elements
        const fromSource = [...document.querySelectorAll('audio source[src]')]
          .map(s => s.src)
          .filter(s => s && s.startsWith('http'));

        // data-audio-url attributes (Suno sometimes uses these)
        const fromData = [...document.querySelectorAll('[data-audio-url]')]
          .map(el => el.getAttribute('data-audio-url'))
          .filter(Boolean);

        // Deduplicate
        return [...new Set([...fromAudio, ...fromSource, ...fromData])];
      });

      console.log(`[suno.js] Poll — found ${urls.length} audio URL(s) at ${Math.round((Date.now() - start) / 1000)}s`);

      if (urls.length >= 2) {
        console.log('[suno.js] Got 2+ audio URLs:', urls);
        return urls.slice(0, 2);
      }
      if (urls.length === 1) {
        console.log('[suno.js] 1 URL so far, waiting for second...');
      }
    } catch (e) {
      console.warn('[suno.js] Poll error:', e.message);
    }

    await snap(page, sceneIndex, 'poll', `${Math.round((Date.now() - start) / 1000)}s`);
  }

  throw new Error(`Suno generation timed out (${POLL_TIMEOUT / 1000}s) — no audio found`);
}

// ─── Download MP3 with redirect following ─────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(destPath);

    function doGet(u) {
      const p = u.startsWith('https') ? https : http;
      p.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return doGet(res.headers.location);
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (e) => { fs.unlink(destPath, () => {}); reject(e); });
      }).on('error', (e) => { fs.unlink(destPath, () => {}); reject(e); });
    }

    doGet(url);
  });
}

// ─── Main export ───────────────────────────────────────────────────────────

async function generateOnSuno(page, { prompt, projectId, sceneLabel, sceneIndex, generationIndex }) {
  console.log(`\n[suno.js] ══ generateOnSuno — scene ${sceneIndex}: "${sceneLabel}" ══`);

  try {
    // ── Step 1: Navigate ──────────────────────────────────────────────────
    console.log('[suno.js] Navigating to suno.com/create...');
    await page.goto(SUNO_CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Give React time to hydrate fully
    await page.waitForTimeout(4000);

    // ── Step 2: Inspect DOM before touching anything ──────────────────────
    await inspectDOM(page, sceneIndex);
    await snap(page, sceneIndex, 1, 'loaded');

    // ── Step 3: Find and fill prompt input ───────────────────────────────
    const promptEl = await findPromptInput(page);
    if (!promptEl) {
      await snap(page, sceneIndex, 2, 'no-input');
      throw new Error('Could not find Suno prompt textarea — check /tmp screenshot for DOM state');
    }

    const truncated = prompt.slice(0, PROMPT_MAX_CHARS);
    await promptEl.click({ clickCount: 3 }); // select all existing text
    await promptEl.fill(truncated);
    console.log(`[suno.js] Filled prompt: ${truncated.length} chars`);
    await snap(page, sceneIndex, 2, 'filled');

    // ── Step 4: Find and click Create ────────────────────────────────────
    const createBtn = await findCreateButton(page);
    if (!createBtn) {
      await snap(page, sceneIndex, 3, 'no-create-btn');
      throw new Error('Could not find Suno Create button — check /tmp screenshot for DOM state');
    }

    await createBtn.click();
    console.log('[suno.js] Clicked Create — waiting for generation...');
    await snap(page, sceneIndex, 3, 'clicked-create');

    // ── Step 5: Poll for audio ────────────────────────────────────────────
    const audioUrls = await waitForAudioTracks(page, sceneIndex);
    await snap(page, sceneIndex, 4, 'tracks-ready');

    // ── Step 6: Download both tracks ─────────────────────────────────────
    const dir   = ensureMusicDir(projectId, sceneLabel);
    const slug  = sceneSlug(sceneLabel);
    const files = [];

    for (let i = 0; i < audioUrls.length; i++) {
      const url      = audioUrls[i];
      const filename = `suno_${sceneIndex}_v${generationIndex + i}.mp3`;
      const destPath = path.join(dir, filename);
      const pubPath  = `/music/${projectId}/${slug}/${filename}`;

      console.log(`[suno.js] Downloading track ${i + 1}/${audioUrls.length}: ${url}`);
      await downloadFile(url, destPath);
      console.log(`[suno.js] ✓ Saved → ${destPath}`);

      files.push({ destPath, publicPath: pubPath, audioUrl: url });
    }

    console.log(`[suno.js] ✓ Scene ${sceneIndex} complete — ${files.length} file(s)\n`);
    return { ok: true, files };

  } catch (err) {
    console.error(`[suno.js] ✗ generateOnSuno error (scene ${sceneIndex}):`, err.message);
    try { await snap(page, sceneIndex, 99, 'error'); } catch (_) {}
    return { ok: false, error: err.message };
  }
}

module.exports = { generateOnSuno };
