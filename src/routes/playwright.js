/**
 * Kre8Ωr — src/routes/playwright.js
 *
 * Express route handler for Playwright / Kajabi browser automation.
 *
 * Architecture — Handoff Mode:
 *   User logs into Kajabi manually in Chrome.
 *   Chrome must be launched with:  chrome.exe --remote-debugging-port=9222
 *   Playwright connects via CDP — no credentials stored anywhere.
 *
 * Routes:
 *   GET  /api/playwright/status        — check if port 9222 reachable
 *   POST /api/playwright/connect       — connect to Chrome, return { ok }
 *   POST /api/playwright/broadcast     — send email broadcast (SSE)
 *   POST /api/playwright/community     — post to community (SSE)
 *   POST /api/playwright/sequence      — create email sequence (SSE)
 *   POST /api/playwright/automation    — create automation rule (SSE)
 *   POST /api/playwright/landing-page  — update landing page (SSE)
 *   POST /api/playwright/disconnect    — close connection
 */

const express = require('express');
const router  = express.Router();
const http    = require('http');
const path    = require('path');
const fs      = require('fs');

const {
  sendBroadcast,
  postToCommunity,
  createSequence,
  createAutomation,
  updateLandingPage,
} = require('../playwright/kajabi');

const { generateOnSuno } = require('../playwright/suno');
const db = require('../db');

// ─── Singleton connection state ────────────────────────────────────────────

let browser = null;
let page    = null;

const CDP_URL = 'http://localhost:9222';

// ─── SSE helper ───────────────────────────────────────────────────────────

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  return (data) => {
    try { res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (_) {}
  };
}

// ─── Connection guard ─────────────────────────────────────────────────────

function requireConnection(res) {
  if (!browser || !page) {
    res.status(400).json({ ok: false, error: 'Not connected. Call /connect first.' });
    return false;
  }
  return true;
}

async function requireConnectionSSE(send, res) {
  if (!browser || !page) {
    send({ stage: 'error', error: 'Not connected. Connect Chrome first.' });
    res.end();
    return false;
  }
  return true;
}

// Auto-reconnect if the page context has gone stale
async function ensurePage() {
  if (!browser) return null;
  try {
    // Ping the page — throws if context is dead
    await page.evaluate(() => true);
    return page;
  } catch (_) {
    // Try to get the first available page from the browser
    try {
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) {
          page = pages[0];
          return page;
        }
      }
    } catch (_) {}
    browser = null;
    page    = null;
    return null;
  }
}

// ─── GET /api/playwright/status ───────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    // Check if Chrome debugging port 9222 responds
    const reachable = await new Promise((resolve) => {
      const req = http.get(`${CDP_URL}/json/version`, (r) => {
        resolve(r.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });

    const connected = reachable && browser !== null && page !== null;
    res.json({ ok: true, port_reachable: reachable, connected });
  } catch (e) {
    res.json({ ok: false, port_reachable: false, connected: false, error: e.message });
  }
});

// ─── POST /api/playwright/connect ─────────────────────────────────────────

router.post('/connect', async (req, res) => {
  try {
    const { chromium } = require('playwright');

    // Close any existing connection cleanly
    if (browser) {
      try { await browser.close(); } catch (_) {}
      browser = null;
      page    = null;
    }

    browser = await chromium.connectOverCDP(CDP_URL);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      browser = null;
      return res.status(400).json({ ok: false, error: 'No browser context found. Make sure Chrome is open and logged into Kajabi.' });
    }

    const pages = contexts[0].pages();
    page = pages.length > 0 ? pages[0] : await contexts[0].newPage();

    res.json({ ok: true, connected: true, message: 'Connected to Chrome session.' });
  } catch (e) {
    browser = null;
    page    = null;
    res.status(500).json({ ok: false, error: e.message, hint: 'Make sure Chrome is running with --remote-debugging-port=9222' });
  }
});

// ─── POST /api/playwright/disconnect ──────────────────────────────────────

router.post('/disconnect', async (req, res) => {
  try {
    if (browser) {
      await browser.close();
      browser = null;
      page    = null;
    }
    res.json({ ok: true, message: 'Disconnected.' });
  } catch (e) {
    browser = null;
    page    = null;
    res.json({ ok: true, message: 'Disconnected (with error: ' + e.message + ')' });
  }
});

// ─── POST /api/playwright/broadcast ───────────────────────────────────────

router.post('/broadcast', async (req, res) => {
  const send = sseSetup(res);
  if (!await requireConnectionSSE(send, res)) return;

  const activePage = await ensurePage();
  if (!activePage) {
    send({ stage: 'error', error: 'Connection lost. Reconnect Chrome.' });
    return res.end();
  }

  try {
    const dryRun = req.body.dryRun !== false; // default true; only false when explicitly set
    send({ stage: 'progress', message: dryRun ? 'Filling form for preview...' : 'Sending broadcast...' });
    const result = await sendBroadcast(activePage, { ...req.body, dryRun });
    if (result.ok && result.dryRun) {
      send({ stage: 'done', dryRun: true, message: 'Preview ready — check the screenshot.', screenshot: result.screenshot });
    } else if (result.ok) {
      send({ stage: 'done', dryRun: false, message: 'Broadcast sent.', broadcastId: result.broadcastId, sentAt: result.sentAt });
    } else {
      send({ stage: 'error', error: result.error, screenshot: result.screenshot });
    }
  } catch (e) {
    send({ stage: 'error', error: e.message });
  }
  res.end();
});

// ─── POST /api/playwright/community ───────────────────────────────────────

router.post('/community', async (req, res) => {
  const send = sseSetup(res);
  if (!await requireConnectionSSE(send, res)) return;

  const activePage = await ensurePage();
  if (!activePage) {
    send({ stage: 'error', error: 'Connection lost. Reconnect Chrome.' });
    return res.end();
  }

  try {
    send({ stage: 'progress', message: 'Navigating to Community Posts...' });
    const result = await postToCommunity(activePage, req.body);
    if (result.ok) {
      send({ stage: 'done', message: 'Community post published.', postUrl: result.postUrl });
    } else {
      send({ stage: 'error', error: result.error, screenshot: result.screenshot });
    }
  } catch (e) {
    send({ stage: 'error', error: e.message });
  }
  res.end();
});

// ─── POST /api/playwright/sequence ────────────────────────────────────────

router.post('/sequence', async (req, res) => {
  const send = sseSetup(res);
  if (!await requireConnectionSSE(send, res)) return;

  const activePage = await ensurePage();
  if (!activePage) {
    send({ stage: 'error', error: 'Connection lost. Reconnect Chrome.' });
    return res.end();
  }

  try {
    const { name, emails = [] } = req.body;
    send({ stage: 'progress', message: `Creating sequence "${name}" with ${emails.length} email(s)...` });
    const result = await createSequence(activePage, { name, emails });
    if (result.ok) {
      send({ stage: 'done', message: 'Sequence created.', sequenceId: result.sequenceId });
    } else {
      send({ stage: 'error', error: result.error, screenshot: result.screenshot });
    }
  } catch (e) {
    send({ stage: 'error', error: e.message });
  }
  res.end();
});

// ─── POST /api/playwright/automation ──────────────────────────────────────

router.post('/automation', async (req, res) => {
  const send = sseSetup(res);
  if (!await requireConnectionSSE(send, res)) return;

  const activePage = await ensurePage();
  if (!activePage) {
    send({ stage: 'error', error: 'Connection lost. Reconnect Chrome.' });
    return res.end();
  }

  try {
    send({ stage: 'progress', message: 'Creating automation rule...' });
    const result = await createAutomation(activePage, req.body);
    if (result.ok) {
      send({ stage: 'done', message: 'Automation created.', automationId: result.automationId });
    } else {
      send({ stage: 'error', error: result.error, screenshot: result.screenshot });
    }
  } catch (e) {
    send({ stage: 'error', error: e.message });
  }
  res.end();
});

// ─── POST /api/playwright/landing-page ────────────────────────────────────

router.post('/landing-page', async (req, res) => {
  const send = sseSetup(res);
  if (!await requireConnectionSSE(send, res)) return;

  const activePage = await ensurePage();
  if (!activePage) {
    send({ stage: 'error', error: 'Connection lost. Reconnect Chrome.' });
    return res.end();
  }

  try {
    send({ stage: 'progress', message: 'Navigating to landing page...' });
    const result = await updateLandingPage(activePage, req.body);
    if (result.ok) {
      send({ stage: 'done', message: 'Landing page updated.' });
    } else {
      send({ stage: 'error', error: result.error, screenshot: result.screenshot });
    }
  } catch (e) {
    send({ stage: 'error', error: e.message });
  }
  res.end();
});

// ─── GET /api/playwright/suno/prompts/:project_id ─────────────────────────
// Returns tracks that have a prompt but no downloaded audio yet.

router.get('/suno/prompts/:project_id', (req, res) => {
  const projectId = parseInt(req.params.project_id, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project_id' });

  try {
    const tracks = db.getPendingSunoTracks(projectId);
    res.json({
      project_id: projectId,
      count:      tracks.length,
      pending:    tracks.map(t => ({
        id:               t.id,
        scene_label:      t.scene_label,
        scene_index:      t.scene_index,
        suno_prompt:      t.suno_prompt,
        generation_index: t.generation_index,
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/playwright/suno ────────────────────────────────────────────
// SSE — fetches pending prompts for project, drives suno.com via Playwright,
// downloads both generated tracks per scene, ingests into composor_tracks.

router.post('/suno', async (req, res) => {
  const send = sseSetup(res);
  if (!await requireConnectionSSE(send, res)) return;

  const activePage = await ensurePage();
  if (!activePage) {
    send({ stage: 'error', error: 'Connection lost. Reconnect Chrome.' });
    return res.end();
  }

  const projectId = parseInt(req.body?.project_id, 10);
  if (!projectId) {
    send({ stage: 'error', error: 'project_id required' });
    return res.end();
  }

  try {
    const pending = db.getPendingSunoTracks(projectId);

    if (!pending.length) {
      send({ stage: 'done', message: 'No pending tracks found. Run scene analysis + Generate Music first to write prompts.' });
      return res.end();
    }

    send({ stage: 'start', total: pending.length, message: `Found ${pending.length} pending track${pending.length !== 1 ? 's' : ''} — starting Suno automation` });

    let successCount = 0;
    let failCount    = 0;

    for (let i = 0; i < pending.length; i++) {
      const track = pending[i];

      send({
        stage:       'scene_start',
        current:     i + 1,
        total:       pending.length,
        scene_label: track.scene_label,
        message:     `Scene ${i + 1}/${pending.length}: Generating "${track.scene_label}"…`
      });

      const result = await generateOnSuno(activePage, {
        prompt:          track.suno_prompt,
        projectId,
        sceneLabel:      track.scene_label,
        sceneIndex:      track.scene_index,
        generationIndex: track.generation_index,
      });

      if (!result.ok) {
        failCount++;
        send({
          stage:       'scene_error',
          current:     i + 1,
          total:       pending.length,
          scene_label: track.scene_label,
          error:       result.error,
          message:     `Scene ${i + 1}/${pending.length}: ✗ Failed — ${result.error}`
        });
        continue;
      }

      const files = result.files || [];

      // File 0 → update existing track row (the one with the prompt)
      if (files[0]) {
        db.updateComposorTrack(track.id, {
          suno_track_path: files[0].destPath,
          suno_track_url:  files[0].audioUrl,
          public_path:     files[0].publicPath,
        });
      }

      // File 1 → insert as a second variation row for the same scene
      if (files[1]) {
        db.insertComposorTrack({
          project_id:       projectId,
          scene_label:      track.scene_label,
          scene_index:      track.scene_index,
          scene_type:       track.scene_type || 'buildup',
          duration_seconds: null,
          suno_prompt:      track.suno_prompt,
          generation_index: track.generation_index + 1,
          selected:         false,
          suno_track_path:  files[1].destPath,
          suno_track_url:   files[1].audioUrl,
          public_path:      files[1].publicPath,
        });
      }

      successCount++;
      send({
        stage:             'scene_done',
        current:           i + 1,
        total:             pending.length,
        scene_label:       track.scene_label,
        tracks_downloaded: files.length,
        message:           `Scene ${i + 1}/${pending.length}: ✓ Downloaded ${files.length} track${files.length !== 1 ? 's' : ''}`
      });
    }

    // Advance project composor state if any tracks came in
    if (successCount > 0) {
      db.updateProjectComposorState(projectId, 'awaiting_selection');
    }

    send({
      stage:   'done',
      success: successCount,
      failed:  failCount,
      message: `Complete — ${successCount} scene${successCount !== 1 ? 's' : ''} generated, ${failCount} failed`
    });

  } catch (e) {
    console.error('[playwright/suno]', e);
    send({ stage: 'error', error: e.message });
  }

  res.end();
});

module.exports = router;
