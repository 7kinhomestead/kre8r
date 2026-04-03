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

const {
  sendBroadcast,
  postToCommunity,
  createSequence,
  createAutomation,
  updateLandingPage,
} = require('../playwright/kajabi');

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
    send({ stage: 'progress', message: 'Navigating to Email Broadcasts...' });
    const result = await sendBroadcast(activePage, req.body);
    if (result.ok) {
      send({ stage: 'done', message: 'Broadcast sent.', broadcastId: result.broadcastId, sentAt: result.sentAt });
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

module.exports = router;
