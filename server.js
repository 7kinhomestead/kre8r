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
  // Reload .env from the same directory as the DB (set above by main.js env vars).
  // override: false — never overwrite DB_PATH/CREATOR_PROFILE_PATH that main.js set.
  // This pulls in SYNC_SERVER_URL, SYNC_TOKEN etc. saved by upsertEnv() between sessions.
  const _userEnvPath = _path.join(_path.dirname(process.env.DB_PATH), '.env');
  require('dotenv').config({ path: _userEnvPath, override: false });
}

// ─────────────────────────────────────────────
// FFMPEG PATH BOOTSTRAP
// ─────────────────────────────────────────────
// Auto-wire bundled ffmpeg-static binaries when the env vars aren't already set.
// This fires before any route file requires fluent-ffmpeg, so the paths are in
// place by the time the library initialises.
// Priority: env var (Electron/Docker) → ffmpeg-static package → system PATH
if (!process.env.FFMPEG_PATH) {
  try {
    process.env.FFMPEG_PATH = require('ffmpeg-static');
    console.log('[ffmpeg] bundled binary →', process.env.FFMPEG_PATH);
  } catch (_) {
    console.log('[ffmpeg] ffmpeg-static not found — falling back to system PATH');
  }
}
if (!process.env.FFPROBE_PATH) {
  try {
    process.env.FFPROBE_PATH = require('ffprobe-static').path;
    console.log('[ffprobe] bundled binary →', process.env.FFPROBE_PATH);
  } catch (_) {
    console.log('[ffprobe] ffprobe-static not found — falling back to system PATH');
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
const log     = require('./src/utils/logger');

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
// SESSION — SQLite-backed persistent store
// Sessions survive server restarts. No extra packages needed —
// we reuse the existing better-sqlite3 DB.
// ─────────────────────────────────────────────

const { Store } = session;

class SQLiteStore extends Store {
  constructor(getDb) {
    super();
    // getDb is a function — called lazily so initDb() has run by first request
    this._getDb = getDb;
    this._pruneTimer = null;
    // Schedule prune after startup (not immediately — db not ready yet)
    setTimeout(() => {
      this._prune();
      this._pruneTimer = setInterval(() => this._prune(), 15 * 60 * 1000);
      if (this._pruneTimer.unref) this._pruneTimer.unref();
    }, 5000).unref();
  }

  _db() { return this._getDb(); }

  _prune() {
    try {
      this._db().prepare('DELETE FROM express_sessions WHERE expires_at <= ?').run(Date.now());
    } catch (_) {}
  }

  get(sid, cb) {
    try {
      const row = this._db().prepare('SELECT data, expires_at FROM express_sessions WHERE sid = ?').get(sid);
      if (!row) {
        console.log(`[session] get sid=${sid.slice(0,8)}… → NOT FOUND`);
        return cb(null, null);
      }
      if (row.expires_at <= Date.now()) {
        console.log(`[session] get sid=${sid.slice(0,8)}… → EXPIRED`);
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      console.log(`[session] get sid=${sid.slice(0,8)}… → OK (user=${JSON.parse(row.data)?.username})`);
      cb(null, JSON.parse(row.data));
    } catch (e) {
      console.error('[session] get failed:', e.message);
      cb(e);
    }
  }

  set(sid, session, cb) {
    try {
      const expires = session.cookie?.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;
      this._db().prepare(
        'INSERT INTO express_sessions (sid, data, expires_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at'
      ).run(sid, JSON.stringify(session), expires);
      console.log(`[session] saved sid=${sid.slice(0,8)}… expires=${new Date(expires).toISOString()}`);
      if (cb) cb(null);
    } catch (e) {
      console.error('[session] set failed:', e.message);
      if (cb) cb(e);
    }
  }

  destroy(sid, cb) {
    try {
      this._db().prepare('DELETE FROM express_sessions WHERE sid = ?').run(sid);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  touch(sid, session, cb) {
    this.set(sid, session, cb);
  }
}

const _dbModule = require('./src/db');

// ─────────────────────────────────────────────
// TENANT MIDDLEWARE
// Reads Host header, detects beta creator subdomains (slug.kre8r.app),
// and activates that tenant's DB + profile transparently via AsyncLocalStorage.
// Jason's root instance (kre8r.app / localhost) gets no tenant context — uses singleton DB.
// ─────────────────────────────────────────────
const tenantContext  = require('./src/utils/tenant-context');
const tenantDbCache  = require('./src/utils/tenant-db-cache');

const ROOT_HOSTS = new Set([
  'kre8r.app', 'www.kre8r.app', 'localhost',
  '127.0.0.1', '0.0.0.0',
  'guard.kre8r.app',
]);

function extractTenantSlug(hostname) {
  if (!hostname) return null;
  // strip port
  const host = hostname.split(':')[0].toLowerCase();
  if (ROOT_HOSTS.has(host)) return null;
  // *.kre8r.app → slug
  if (host.endsWith('.kre8r.app')) {
    const slug = host.replace('.kre8r.app', '');
    if (slug && slug !== 'teleprompter' && slug !== 'www') return slug;
  }
  return null;
}

app.use((req, res, next) => {
  const slug = extractTenantSlug(req.hostname);
  if (!slug) return next(); // Jason's instance — no tenant context

  const tenantDb = tenantDbCache.getTenantDb(slug);
  if (!tenantDb) {
    // Tenant folder exists-check failed — unknown subdomain
    return res.status(404).send(`Unknown creator instance: ${slug}`);
  }

  const tenantProfile = tenantDbCache.loadTenantProfile(slug);
  req.tenantSlug = slug;

  // Activate tenant context — all db._get/_all/_run calls now hit this tenant's DB
  tenantContext.run({ db: tenantDb, profile: tenantProfile, slug }, next);
});

app.use(session({
  name:   'kre8r.sid',
  secret: process.env.SESSION_SECRET || 'kre8r-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  store:  new SQLiteStore(() => _dbModule.getRawDb()),
  cookie: {
    httpOnly: true,
    secure:   false,   // nginx handles TLS termination; keep false at Express level
    sameSite: 'lax',   // prevents CSRF from cross-origin requests
    maxAge:   30 * 24 * 60 * 60 * 1000,  // 30 days default
  },
}));

// ─────────────────────────────────────────────
// AUTH ROUTES — before guard so login page works
// ─────────────────────────────────────────────
app.use('/auth', require('./src/routes/auth'));

// Onboarding — public (invite token is the auth)
app.use('/api/onboarding', require('./src/routes/onboarding'));

// Admin panel — owner only (enforced inside route)
app.use('/api/admin', require('./src/routes/admin'));

// ─────────────────────────────────────────────
// KAJABI WEBHOOK — PUBLIC (no auth)
// Must be mounted BEFORE the auth guard.
// Tenant-scoped webhooks — public, no auth, slug routes to correct tenant data
app.use('/api/tenant/:slug/webhook', require('./src/routes/tenant-webhook'));

// Sync API — Bearer token auth per tenant
app.use('/api/sync', require('./src/routes/sync'));

// Kajabi calls /api/kajabi-webhook/receive from their servers.
// ─────────────────────────────────────────────
app.use('/api/kajabi-webhook', require('./src/routes/kajabi-webhook'));

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
    return res.redirect(302, '/teleprompter.html'); // 302 not 301 — never cache this permanently
  }
  next();
});

app.use((req, res, next) => {
  // Allow the teleprompter subdomain through without user login —
  // session codes protect individual sessions, scripts aren't secret
  if (req.hostname === TELEPROMPTER_HOST) return next();

  // ── First-run detection: if no users exist, funnel to setup wizard ──────────
  // Import here to avoid circular-require; initDb() has already run by this point.
  const _db = require('./src/db');
  let _userCount = 0;
  try { _userCount = _db.getUserCount(); } catch (_) { /* table may not exist yet during initDb */ }

  if (_userCount === 0) {
    // Setup page itself and its static assets must always pass through
    const isSetupPath =
      req.path === '/setup' ||
      req.path === '/setup.html' ||
      req.path === '/setup-api' ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/css/') ||
      req.path.startsWith('/images/') ||
      req.path === '/favicon.ico' ||
      req.path === '/favicon.png' ||
      req.path === '/api/health';
    if (isSetupPath) return next();
    // API calls during first run — tell the client to go to setup
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Setup required', redirect: '/setup' });
    }
    return res.redirect('/setup');
  }

  // ── Normal auth guard ────────────────────────────────────────────────────────
  // Always public
  if (req.path === '/login' || req.path === '/login.html') return next();
  if (req.path.startsWith('/auth/'))       return next();
  // Onboarding — invite token is the auth
  if (req.path === '/onboarding' || req.path === '/onboarding.html') return next();
  if (req.path.startsWith('/api/onboarding/')) return next();
  // Beta public endpoints — ONLY the three submission POSTs are open to the world.
  // Admin reads (GET /applications, /reports, /nps, /funnel, /stats, /token-stats)
  // and status PATCHes require authentication.
  const PUBLIC_BETA_PATHS = ['/api/beta/apply', '/api/beta/report', '/api/beta/nps'];
  if (PUBLIC_BETA_PATHS.includes(req.path) && req.method === 'POST') return next();
  if (req.path === '/api/health')                    return next();
  if (req.path.startsWith('/api/releases'))          return next(); // own auth
  if (['/landing', '/landing.html', '/media-kit', '/media-kit.html',
       '/beta-invite', '/beta-invite.html',
       '/gate', '/kre8r-gate', '/kre8r-gate.html',
       '/download', '/download.html',
       '/privacy', '/privacy.html', '/tos', '/tos.html'].includes(req.path)) return next();
  // Download assets (installer, yml) are public
  if (req.path.startsWith('/downloads/')) return next();
  // Media kit photography (public, no auth required)
  if (req.path.startsWith('/media-kit-images/')) return next();
  // GuardΩr — public fan-facing pages, no auth
  if (req.path.startsWith('/guard/') || req.path === '/guard') return next();
  if (req.path.startsWith('/api/guard/')) return next();
  // OrgΩr bridge — internal key auth handled inside the route, no session needed
  if (req.path === '/api/stats-export') return next();

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

// ─────────────────────────────────────────────
// FIRST-RUN SETUP
// GET  /setup       — setup wizard HTML
// POST /setup-api   — create owner account + write API key
// ─────────────────────────────────────────────
app.get('/setup',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/setup.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));

app.post('/setup-api', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const _db    = require('./src/db');
  const { loadProfile } = require('./src/utils/profile-validator');

  try {
    // Guard: only works on a fresh install
    const count = _db.getUserCount();
    if (count > 0) {
      return res.status(403).json({ error: 'Setup has already been completed. Sign in to continue.' });
    }

    const { name, username, password, confirmPassword, intakeFolder } = req.body || {};

    // Validation
    if (!username || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // 1. Create owner account
    const hash = await bcrypt.hash(password, 10);
    _db.createUser(username.trim(), hash, 'owner');
    log.info({ module: 'setup', username: username.trim() }, 'Owner account created via setup wizard');

    // 2. Update creator-profile.json if name or intake folder was provided
    if (name || intakeFolder) {
      try {
        const profPath = process.env.CREATOR_PROFILE_PATH
          || path.join(__dirname, 'creator-profile.json');
        const profResult = loadProfile(profPath);

        if (profResult.ok) {
          const profile = profResult.profile;
          if (name && name.trim()) {
            profile.creator = profile.creator || {};
            profile.creator.name       = name.trim();
            profile.creator.first_name = name.trim().split(' ')[0];
          }
          if (intakeFolder && intakeFolder.trim()) {
            profile.vault = profile.vault || {};
            profile.vault.intake_folder = intakeFolder.trim();
          }
          fs.writeFileSync(profPath, JSON.stringify(profile, null, 2), 'utf8');
          log.info({ module: 'setup' }, 'creator-profile.json updated from setup wizard');
        } else {
          log.warn({ module: 'setup', errors: profResult.errors }, 'Could not load creator-profile.json during setup');
        }
      } catch (profErr) {
        // Non-fatal — app works fine with default profile
        log.warn({ module: 'setup', err: profErr }, 'Could not update creator-profile.json during setup');
      }
    }

    res.json({ ok: true });
  } catch (err) {
    log.error({ module: 'setup', err }, 'Setup failed');
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    res.status(500).json({ error: 'Setup failed — ' + err.message });
  }
});

app.get('/download',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'download.html')));
app.get('/landing',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/landing.html',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
// GuardΩr — public fan page (no auth). Serves for any /guard/:slug path.
// Also handles guard.kre8r.app/:slug subdomain (ROOT_HOSTS treats it as main app)
app.get('/guard/:slug',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'guardr.html')));
app.get('/guard',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'guardr.html')));
app.get('/:slug', (req, res, next) => {
  if (req.hostname === 'guard.kre8r.app') {
    return res.sendFile(path.join(__dirname, 'public', 'guardr.html'));
  }
  next();
});
app.get('/media-kit',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'media-kit.html')));
app.get('/media-kit.html',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'media-kit.html')));
app.get('/beta-invite',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'beta-invite.html')));
app.get('/beta-invite.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'beta-invite.html')));
app.get('/onboarding',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'onboarding.html')));
app.get('/onboarding.html',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'onboarding.html')));

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
app.use('/api/vault/scan', require('./src/routes/vault-scan'));
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
app.use('/api/sequences',    require('./src/routes/sequence-builder'));
app.use('/api/kajabi',       require('./src/routes/kajabi'));
app.use('/api/mailerlite',   require('./src/routes/mailerlite'));
app.use('/api/id8r',         require('./src/routes/id8r'));
app.use('/api/playwright',   require('./src/routes/playwright'));
const mirrRouter = require('./src/routes/mirrr');
app.use('/api/mirrr',        mirrRouter);          // MirrΩr (new canonical)
app.use('/api/analytr',      mirrRouter);           // legacy alias — keep so old bookmarks don't 404
app.use('/api/soul-buildr',  require('./src/routes/soul-buildr'));
app.use('/api/project-vault', require('./src/routes/project-vault'));
app.use('/api/northr',        require('./src/routes/northr'));
app.use('/api/lab',           require('./src/routes/lab'));
app.use('/api/local-sync',        require('./src/routes/local-sync'));
app.use('/api/releases',          require('./src/routes/releases'));
app.use('/api/analytics-import',  require('./src/routes/analytics-import'));
app.use('/api/postor',            require('./src/routes/postor'));
app.use('/api/markr',             require('./src/routes/markr'));
app.use('/api/guard',             require('./src/routes/guard'));
app.use('/api/ideas',             require('./src/routes/ideas'));
app.use('/api/vectr',             require('./src/routes/vectr'));
app.use('/api/stats-export',      require('./src/routes/stats-export'));

// PostΩr queue processor — starts 60s interval to fire scheduled posts
require('./src/postor/queue-processor').start();

// Creator profile — served to all tools
// On tenant subdomains, return the tenant's profile directly.
// On the root instance, validate and return Jason's creator-profile.json.
app.get('/api/creator-profile', (req, res) => {
  const tenantProfile = tenantContext.getProfile();
  if (tenantProfile) {
    return res.json(tenantProfile);
  }

  const { loadProfile } = require('./src/utils/profile-validator');
  const result = loadProfile();
  if (!result.ok) {
    console.error('[Profile] Validation failed:', result.errors);
    return res.status(500).json({
      error: 'creator-profile.json is invalid or missing',
      details: result.errors
    });
  }
  if (result.warnings && result.warnings.length) {
    result.warnings.forEach(w => console.warn('[Profile]', w));
  }
  if (result.migrations && result.migrations.length) {
    console.log('[Profile] Migrations applied:', result.migrations.join(', '));
  }
  res.json(result.profile);
});

// Health check
app.get('/api/health', (req, res) => {
  let instance = 'kre8r';
  try {
    const { loadProfile } = require('./src/utils/profile-validator');
    const result = loadProfile();
    if (result.ok) instance = result.profile.instance || 'kre8r';
  } catch (_) { /* no profile yet — fresh install */ }
  res.json({
    status: 'ok',
    instance,
    version: '1.0',
    ai_configured: !!process.env.ANTHROPIC_API_KEY
  });
});

// Diagnostic — returns recent structured log lines for "Copy Diagnostic Info" UI
app.get('/api/health/diagnostic', (req, res) => {
  const lines = log.getRecentLines(150);
  res.json({
    log_file: log.logFilePath,
    lines: lines ? lines.split('\n') : [],
  });
});

// ─────────────────────────────────────────────
// KREΩR DOCTOR — preflight system check
// GET /api/doctor
// ─────────────────────────────────────────────
app.get('/api/doctor', async (req, res) => {
  const checks = [];

  // Helper: push a check result
  const check = (id, label, ok, detail = '', fix = '') =>
    checks.push({ id, label, ok, detail, fix });

  // 1. AI connection — key set + live ping
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasApiKey) {
    check('ai', 'AI connection', false,
      'ANTHROPIC_API_KEY not set',
      'Add ANTHROPIC_API_KEY to your .env file and restart.');
  } else {
    try {
      const { default: fetch } = await import('node-fetch');
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
      check('ai', 'AI connection', r.ok,
        r.ok ? 'Anthropic API reachable' : `API returned ${r.status}`,
        r.ok ? '' : 'Check your API key and network connection.');
    } catch (e) {
      check('ai', 'AI connection', false, `Network error: ${e.message}`, 'Check internet connection.');
    }
  }

  // 2. ffmpeg
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    const { execSync } = require('child_process');
    const out = execSync(`"${ffmpegBin}" -version 2>&1`, { timeout: 5000 }).toString();
    const ver = (out.match(/ffmpeg version ([^\s]+)/) || [])[1] || 'found';
    check('ffmpeg', 'ffmpeg', true, `v${ver}`);
  } catch {
    check('ffmpeg', 'ffmpeg', false,
      'ffmpeg not found',
      'ffmpeg-static should be bundled. Try reinstalling: npm install');
  }

  // 3. Python
  try {
    const { detectPython } = require('./src/vault/transcribe');
    const bin = await detectPython();
    check('python', 'Python', !!bin,
      bin ? `Found: ${bin}` : 'Python not found',
      bin ? '' : 'Install Python 3.8+ from python.org and add to PATH.');
  } catch (e) {
    check('python', 'Python', false, e.message, 'Install Python 3.8+');
  }

  // 4. Whisper
  try {
    const { checkWhisper } = require('./src/vault/transcribe');
    const w = await checkWhisper();
    check('whisper', 'Whisper (transcription)', w.whisper,
      w.whisper ? `v${w.whisper_version || 'found'} at ${w.whisper_binary}` : 'openai-whisper not installed',
      w.whisper ? '' : 'Open EditΩr and click "Install Whisper".');
  } catch (e) {
    check('whisper', 'Whisper (transcription)', false, e.message, 'Open EditΩr and click "Install Whisper".');
  }

  // 5. Creator profile
  try {
    const { loadProfile } = require('./src/utils/profile-validator');
    const result = loadProfile();
    check('profile', 'Creator profile', result.ok,
      result.ok ? `${result.profile.instance} (schema v${result.profile.schema_version})` : result.errors.join('; '),
      result.ok ? '' : 'Fix creator-profile.json or restore from backup.');
    if (result.ok && result.warnings && result.warnings.length) {
      for (const w of result.warnings) {
        check('profile_warn', 'Profile warning', false, w, 'Check vault path in creator-profile.json.');
      }
    }
  } catch (e) {
    check('profile', 'Creator profile', false, e.message, 'creator-profile.json missing or unreadable.');
  }

  // 6. Vault intake path
  try {
    const { loadProfile } = require('./src/utils/profile-validator');
    const result = loadProfile();
    if (result.ok && result.profile.vault && result.profile.vault.intake_folder) {
      const intakePath = result.profile.vault.intake_folder;
      try {
        fs.accessSync(intakePath, fs.constants.R_OK);
        check('vault', 'Vault intake folder', true, intakePath);
      } catch {
        check('vault', 'Vault intake folder', false,
          `Not accessible: ${intakePath}`,
          'Connect external drive or update vault.intake_folder in creator-profile.json.');
      }
    }
  } catch (_) { /* profile already checked above */ }

  // 7. Disk space (C:\ and DB location)
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const out = execSync('wmic logicaldisk get caption,freespace,size /format:csv 2>nul', { timeout: 5000 }).toString();
      const lines = out.trim().split('\n').slice(1).filter(Boolean);
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length < 4) continue;
        const drive = (parts[1] || '').trim();
        const free  = parseInt(parts[2], 10);
        const total = parseInt(parts[3], 10);
        if (!drive || isNaN(free) || isNaN(total) || total === 0) continue;
        const freeGB = (free / 1e9).toFixed(1);
        const pct    = Math.round((free / total) * 100);
        const low    = freeGB < 5;
        check(`disk_${drive}`, `Disk ${drive}`, !low,
          `${freeGB} GB free (${pct}%)`,
          low ? `${drive} is low on space. Free up disk space.` : '');
      }
    }
  } catch (_) { /* disk check is non-fatal */ }

  // 8. DaVinci Resolve (Windows only, non-fatal)
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync('tasklist /FI "IMAGENAME eq Resolve.exe" 2>nul', { timeout: 3000 });
      check('davinci', 'DaVinci Resolve', true, 'Process running');
    } catch {
      check('davinci', 'DaVinci Resolve', false,
        'Not running (optional for non-video work)',
        'Open DaVinci Resolve before using DaVinci integration features.');
    }
  }

  const allOk = checks.every(c => c.ok || c.id === 'davinci' || c.id.startsWith('disk_'));
  res.json({ ok: allOk, checks });
});

// ─────────────────────────────────────────────
// DATA EXPORT — GET /api/export/all
// Returns a JSON snapshot of all user data for backup / migration.
// Excludes binary files (footage, thumbnails) — just the DB records.
// ─────────────────────────────────────────────
app.get('/api/export/all', (req, res) => {
  try {
    const db     = require('./src/db');
    const profResult = require('./src/utils/profile-validator').loadProfile();

    const snapshot = {
      exported_at:    new Date().toISOString(),
      schema_version: 1,
      instance:       profResult.ok ? profResult.profile.instance : 'unknown',
      data: {
        projects:   db.getAllProjects(),
        footage:    db.getAllFootage(),
        voice_profiles: (() => {
          try { return db.getAllVoiceProfiles ? db.getAllVoiceProfiles() : []; } catch { return []; }
        })(),
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="kre8r-export-${new Date().toISOString().slice(0,10)}.json"`
    );
    res.json(snapshot);
  } catch (err) {
    log.error({ module: 'export', err }, 'Export failed');
    res.status(500).json({ error: 'Export failed', detail: err.message });
  }
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
  log.error({
    module:    'api',
    requestId: req.id,
    method:    req.method,
    url:       req.url,
    err,
  }, 'Unhandled API error');
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

  // ── Auto-register first tenant from creator-profile.json ──────────────────
  // On a fresh install (or first boot after multi-tenancy was added), create a
  // tenant record for this instance so sync and tenant webhooks work immediately.
  try {
    const _db = require('./src/db');
    const existing = _db.getAllTenants();
    if (existing.length === 0) {
      const crypto = require('crypto');
      let slug = '7kin', name = 'Kre8Ωr Instance';
      try {
        const { loadProfile } = require('./src/utils/profile-validator');
        const pr = loadProfile();
        if (pr.ok) {
          const brand = pr.profile?.creator?.brand || pr.profile?.creator?.name || 'instance';
          slug = brand.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 32);
          name = pr.profile?.creator?.name || name;
        }
      } catch (_) {}
      const sync_token = crypto.randomBytes(32).toString('hex');
      _db.createTenant({ tenant_slug: slug, display_name: name, sync_token, plan: 'solo' });
      console.log(`[Sync] First tenant registered: ${slug}`);
      console.log(`[Sync] Sync token: ${sync_token}`);
      console.log(`[Sync] Save this token — it's your desktop app connection key.`);
    }
  } catch (tenantErr) {
    console.warn('[Sync] Could not auto-register tenant (non-fatal):', tenantErr.message);
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
    let _brand = 'INSTANCE';
    try {
      const { loadProfile } = require('./src/utils/profile-validator');
      const _pr = loadProfile();
      if (_pr.ok) _brand = (_pr.profile?.creator?.brand || 'INSTANCE').toUpperCase();
    } catch (_) {}
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
    console.log(`  \x1b[2m  Kre8\u03a9r Doctor  →\x1b[0m http://localhost:${PORT}/doctor.html`);
    console.log('');
    console.log('  \x1b[2mSINE RESISTENTIA\x1b[0m');
    console.log('');

    log.info({ module: 'server', port: PORT, instance: _brand }, 'Kre8Ωr started');

    // ─── Morning Kajabi → MailerLite bulk sync ──────────────────────────────
    // Runs once every morning at 8:00 AM local time so new members who joined
    // overnight land in the right MailerLite group before the morning reads.
    scheduleMorningSync();
  });
}

function scheduleMorningSync() {
  const TARGET_HOUR = 12; // 12:00 UTC = 8:00 AM US Eastern (EDT)
  const CHECK_INTERVAL_MS = 60 * 1000; // check every minute
  let lastRunDate = null;

  const tick = async () => {
    const now = new Date();
    const today = now.toDateString();
    if (now.getHours() === TARGET_HOUR && lastRunDate !== today) {
      lastRunDate = today;
      log.info({ module: 'scheduler' }, 'Morning bulk sync starting...');
      try {
        const { runBulkSync } = require('./src/routes/kajabi');
        const result = await runBulkSync({ memberOnly: true });
        log.info({ module: 'scheduler', ...result }, 'Morning bulk sync complete');
      } catch (e) {
        log.error({ module: 'scheduler', err: e.message }, 'Morning bulk sync failed');
      }
    }
  };

  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref(); // don't keep process alive for this alone
  log.info({ module: 'scheduler', targetHour: TARGET_HOUR }, 'Morning sync scheduler registered');
}

start();
