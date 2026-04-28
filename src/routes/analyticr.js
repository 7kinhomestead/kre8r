'use strict';
/**
 * AnalyticΩr — src/routes/analyticr.js
 *
 * Backend proxy for kre8r-land stats (keeps LAND_INTERNAL_KEY server-side).
 * The AnalyticΩr page calls other endpoints (northr/dashboard, mirrr/*) directly.
 *
 * GET /api/analyticr/land  — proxies to kre8r-land /api/land/stats-export
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');

const LAND_URL = process.env.LAND_URL          || 'https://7kinhomestead.land';
const LAND_KEY = process.env.LAND_INTERNAL_KEY || '';

router.get('/land', async (req, res) => {
  if (!LAND_KEY) {
    return res.json({ ok: false, message: 'LAND_INTERNAL_KEY not configured', stats: null });
  }
  try {
    const { default: fetch } = await import('node-fetch');
    const upstream = await fetch(`${LAND_URL}/api/land/stats-export`, {
      headers: { 'x-internal-key': LAND_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      return res.json({ ok: false, message: `land server returned ${upstream.status}`, stats: null });
    }
    const data = await upstream.json();
    res.json({ ok: true, ...data });
  } catch (err) {
    logger.warn({ err: err.message }, 'analyticr/land proxy failed');
    res.json({ ok: false, message: err.message, stats: null });
  }
});

module.exports = router;
