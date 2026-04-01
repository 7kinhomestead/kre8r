/**
 * Kre8\u03a9r — server.js
 * Express local server for the 7 Kin Homestead instance.
 * Serves all four prototype tools through a shared SQLite database.
 *
 * SINE RESISTENTIA — Create without limits. Distribute without resistance.
 */

require('dotenv').config({ override: true });

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// STATIC FILES
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────
app.use('/api/projects', require('./src/routes/projects'));
app.use('/api/generate', require('./src/routes/generate'));
app.use('/api/vault',      require('./src/routes/vault'));
app.use('/api/cutor',      require('./src/routes/cutor'));
app.use('/api/analytics',  require('./src/routes/analytics'));
app.use('/api/operator',   require('./src/routes/operator'));
app.use('/api/davinci',    require('./src/routes/davinci').router);
app.use('/api/editor',     require('./src/routes/editor'));
app.use('/api/composor',   require('./src/routes/composor'));
app.use('/api/pipr',          require('./src/routes/pipr'));
app.use('/api/writr',         require('./src/routes/writr'));
const { router: teleprompterRouter, createTeleprompterWS } = require('./src/routes/teleprompter');
app.use('/api/teleprompter',  teleprompterRouter);
app.use('/api/shootday',      require('./src/routes/shootday'));
app.use('/api/voice-library', require('./src/routes/voice-library'));
app.use('/api/mailor',       require('./src/routes/mailor'));

// Creator profile — served to all tools
app.get('/api/creator-profile', (req, res) => {
  try {
    const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'creator-profile.json'), 'utf8'));
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Could not load creator profile' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    instance: '7-kin-homestead',
    version: '1.0',
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY
  });
});

// ─────────────────────────────────────────────
// SPA FALLBACK — serve index.html for all non-API routes
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// START — async so we can await sql.js init
// ─────────────────────────────────────────────
const { initDb } = require('./src/db');

const { startWatcher } = require('./src/vault/watcher');

async function start() {
  try {
    await initDb();
    console.log('[DB] SQLite database ready at database/kre8r.db');
  } catch (err) {
    console.error('[DB] Failed to initialize database:', err.message);
    process.exit(1);
  }

  // Start VaultΩr folder watcher (non-fatal if intake folder missing)
  const watchResult = startWatcher();
  if (!watchResult.ok) {
    console.warn(`[VaultΩr Watcher] ${watchResult.error}`);
  }

  // Wrap Express in an HTTP server so WebSocket can share the same port
  const httpServer = http.createServer(app);

  // Attach TeleprΩmpter WebSocket server
  createTeleprompterWS(httpServer);

  httpServer.listen(PORT, () => {
    const localIP   = getLocalIP();
    const apiStatus = process.env.ANTHROPIC_API_KEY
      ? '\x1b[32m✓ Anthropic API key loaded\x1b[0m'
      : '\x1b[33m⚠ ANTHROPIC_API_KEY not set — add to .env to enable generation\x1b[0m';

    console.log('');
    console.log('\x1b[36m╔══════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m║         KRE8\u03a9R — 7 KIN HOMESTEAD         ║\x1b[0m');
    console.log('\x1b[36m╚══════════════════════════════════════════╝\x1b[0m');
    console.log('');
    console.log(`  \x1b[32m▶ Running:\x1b[0m  http://localhost:${PORT}`);
    if (localIP) {
      console.log(`  \x1b[32m▶ Network:\x1b[0m  http://${localIP}:${PORT}`);
    }
    console.log(`  ${apiStatus}`);
    console.log('');
    console.log('  \x1b[2mTools:\x1b[0m');
    console.log(`  \x1b[2m  Pipeline\u03a9r     →\x1b[0m http://localhost:${PORT}/`);
    console.log(`  \x1b[2m  Pip\u03a9r          →\x1b[0m http://localhost:${PORT}/pipr.html`);
    console.log(`  \x1b[2m  Writ\u03a9r         →\x1b[0m http://localhost:${PORT}/writr.html`);
    console.log(`  \x1b[2m  TeleprΩmpter   →\x1b[0m http://localhost:${PORT}/teleprompter.html`);
    console.log(`  \x1b[2m  Direct\u03a9r       →\x1b[0m http://localhost:${PORT}/director.html`);
    console.log(`  \x1b[2m  ShootDay       →\x1b[0m http://localhost:${PORT}/shootday.html`);
    if (localIP) {
      console.log(`  \x1b[36m  TeleprΩmpter   →\x1b[0m \x1b[36mhttp://${localIP}:${PORT}/teleprompter.html\x1b[0m  ← use on tablet`);
    }
    console.log(`  \x1b[2m  Vault\u03a9r        →\x1b[0m http://localhost:${PORT}/vault.html`);
    console.log(`  \x1b[2m  M1 Gate\u03a9r      →\x1b[0m http://localhost:${PORT}/m1-approval-dashboard.html`);
    console.log(`  \x1b[2m  M2 Package\u03a9r   →\x1b[0m http://localhost:${PORT}/m2-package-generator.html`);
    console.log(`  \x1b[2m  M3 Caption\u03a9r   →\x1b[0m http://localhost:${PORT}/m3-caption-generator.html`);
    console.log(`  \x1b[2m  M4 Mail\u03a9r      →\x1b[0m http://localhost:${PORT}/m4-email-generator.html`);
    console.log(`  \x1b[2m  Mail\u03a9r         →\x1b[0m http://localhost:${PORT}/mailor.html`);
    console.log('');
    console.log('  \x1b[2mSINE RESISTENTIA\x1b[0m');
    console.log('');
  });
}

start();
