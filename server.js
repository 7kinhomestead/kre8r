/**
 * Kre8\u03a9r — server.js
 * Express local server for the 7 Kin Homestead instance.
 * Serves all four prototype tools through a shared SQLite database.
 *
 * SINE RESISTENTIA — Create without limits. Distribute without resistance.
 */

require('dotenv').config({ override: true });

// ─────────────────────────────────────────────
// ELECTRON MODE — redirect DB + profile paths
// ─────────────────────────────────────────────
// When running inside Electron, main.js sets ELECTRON=true and passes
// DB_PATH + CREATOR_PROFILE_PATH pointing to the user's AppData folder.
// This block is a safety net if those vars weren't set by main.js.
if (process.env.ELECTRON === 'true') {
  const _os   = require('os');
  const _path = require('path');
  const _kre8rHome = _path.join(_os.homedir(), '.kre8r');
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = _path.join(_kre8rHome, 'kre8r.db');
  }
  if (!process.env.CREATOR_PROFILE_PATH) {
    process.env.CREATOR_PROFILE_PATH = _path.join(_kre8rHome, 'creator-profile.json');
  }
}

// ─────────────────────────────────────────────
// PROCESS-LEVEL ERROR HANDLERS — must be first
// ─────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', {
    time:   new Date().toISOString(),
    reason: reason?.message || String(reason),
    stack:  reason?.stack
  });
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', {
    time:    new Date().toISOString(),
    message: err.message,
    stack:   err.stack
  });
  // Give the logger time to flush, then exit — uncaught exceptions leave the
  // process in an undefined state and should not be silently swallowed.
  process.exit(1);
});

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const session = require('express-session');

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

// Request ID — attached to every request so errors are traceable in logs
app.use((req, res, next) => {
  req.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ─────────────────────────────────────────────
// SESSION
// ─────────────────────────────────────────────
app.use(session({
  name:   'kre8r.sid',
  secret: process.env.SESSION_SECRET || 'kre8r-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   false,   // set true if serving HTTPS directly (nginx handles it here)
    maxAge:   30 * 24 * 60 * 60 * 1000,  // 30 days
  },
}));

// ─────────────────────────────────────────────
// AUTH ROUTES — before guard so login page works
// ─────────────────────────────────────────────
app.use('/auth', require('./src/routes/auth'));

// ─────────────────────────────────────────────
// AUTH GUARD — protects everything except:
//   • /login page
//   • /auth/* (login/logout endpoints)
//   • /landing, /media-kit, /beta-invite (public marketing)
//   • /api/beta (public beta signup)
//   • /api/health
//   • teleprompter.kre8r.app subdomain (session-code protected)
// ─────────────────────────────────────────────
const TELEPROMPTER_HOST = 'teleprompter.kre8r.app';

// Teleprompter subdomain root → go straight to the teleprompter page
app.get('/', (req, res, next) => {
  if (req.hostname === TELEPROMPTER_HOST) {
    return res.redirect(301, '/teleprompter.html');
  }
  next();
});

app.use((req, res, next) => {
  // Allow the teleprompter subdomain through without user login —
  // session codes protect individual sessions, scripts aren't secret
  if (req.hostname === TELEPROMPTER_HOST) return next();

  // Always public
  if (req.path === '/login' || req.path === '/login.html') return next();
  if (req.path.startsWith('/auth/'))       return next();
  if (req.path.startsWith('/api/beta'))    return next();
  if (req.path === '/api/health')          return next();
  if (['/landing', '/landing.html', '/media-kit', '/media-kit.html',
       '/beta-invite', '/beta-invite.html',
       '/gate', '/kre8r-gate', '/kre8r-gate.html'].includes(req.path)) return next();

  // Logged in — allow
  if (req.session?.userId) return next();

  // API request — return 401 (don't redirect, let the frontend handle it)
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated', redirect: '/login' });
  }

  // HTML page request — redirect to login with ?next= return path
  const next_ = encodeURIComponent(req.originalUrl);
  res.redirect(`/login?next=${next_}`);
});

// ─────────────────────────────────────────────
// PUBLIC MARKETING PAGES — no auth, declared FIRST
// ─────────────────────────────────────────────
app.use('/api/beta', require('./src/routes/beta'));

app.get('/login',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/landing',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/landing.html',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/media-kit',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'media-kit.html')));
app.get('/media-kit.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'media-kit.html')));
app.get('/beta-invite',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'beta-invite.html')));
app.get('/beta-invite.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'beta-invite.html')));

// KRE8R website prototype — public, no auth
app.get('/gate',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'kre8r-gate.html')));
app.get('/kre8r-gate',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'kre8r-gate.html')));
app.get('/kre8r-gate.html',(req, res) => res.sendFile(path.join(__dirname, 'public', 'kre8r-gate.html')));

// Admin dashboard — behind nginx basic auth on production
app.get('/admin',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ─────────────────────────────────────────────
// STATIC FILES
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────
app.use('/api/projects', require('./src/routes/projects'));
app.use('/api/shows',   require('./src/routes/shows'));
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
app.use('/api/format-profile', require('./src/routes/format-profile'));
app.use('/api/clipsr',       require('./src/routes/clipsr'));
const { router: teleprompterRouter, createTeleprompterWS } = require('./src/routes/teleprompter');
app.use('/api/teleprompter',  teleprompterRouter);
app.use('/api/shootday',      require('./src/routes/shootday'));
app.use('/api/voice-library', require('./src/routes/voice-library'));
app.use('/api/mailor',       require('./src/routes/mailor'));
app.use('/api/kajabi',       require('./src/routes/kajabi'));
app.use('/api/id8r',         require('./src/routes/id8r'));
app.use('/api/playwright',   require('./src/routes/playwright'));
const mirrRouter = require('./src/routes/mirrr');
app.use('/api/mirrr',        mirrRouter);          // MirrΩr (new canonical)
app.use('/api/analytr',      mirrRouter);           // legacy alias — keep so old bookmarks don't 404
app.use('/api/soul-buildr',  require('./src/routes/soul-buildr'));
app.use('/api/project-vault', require('./src/routes/project-vault'));
app.use('/api/northr',        require('./src/routes/northr'));
app.use('/api/lab',           require('./src/routes/lab'));

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
  let instance = 'kre8r';
  try {
    const _p = process.env.CREATOR_PROFILE_PATH || require('path').join(__dirname, 'creator-profile.json');
    instance = JSON.parse(require('fs').readFileSync(_p, 'utf8')).instance || 'kre8r';
  } catch (_) { /* no profile yet — fresh install */ }
  res.json({
    status: 'ok',
    instance,
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
// GLOBAL ERROR HANDLER — must be last app.use()
// ─────────────────────────────────────────────
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[API ERROR]', {
    requestId: req.id,
    method:    req.method,
    url:       req.url,
    error:     err.message,
    stack:     err.stack
  });
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error:     'Internal server error',
    requestId: req.id
  });
});

// ─────────────────────────────────────────────
// START — synchronous init (better-sqlite3)
// ─────────────────────────────────────────────
const { initDb } = require('./src/db');

const { startWatcher } = require('./src/vault/watcher');

async function start() {
  try {
    initDb();
    console.log('[DB] SQLite database ready at database/kre8r.db (better-sqlite3 WAL)');
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
    const _profilePath = process.env.CREATOR_PROFILE_PATH || require('path').join(__dirname, 'creator-profile.json');
    let _brand = 'INSTANCE';
    try { _brand = (JSON.parse(require('fs').readFileSync(_profilePath, 'utf8'))?.creator?.brand || 'INSTANCE').toUpperCase(); } catch (_) {}
    const _banner  = `KRE8\u03a9R \u2014 ${_brand}`;
    const _pad     = Math.max(0, Math.floor((42 - _banner.length) / 2));
    const _bannerL = ' '.repeat(_pad) + _banner + ' '.repeat(Math.max(0, 42 - _pad - _banner.length));
    console.log('\x1b[36m╔══════════════════════════════════════════╗\x1b[0m');
    console.log(`\x1b[36m║${_bannerL}║\x1b[0m`);
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
