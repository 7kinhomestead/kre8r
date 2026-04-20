/**
 * Local sync proxy — src/routes/local-sync.js
 *
 * Proxies sync operations between this local Kre8Ωr instance and the
 * remote sync server (kre8r.app or operator's server).
 * Stores sync config in .env (SYNC_SERVER_URL + SYNC_TOKEN).
 *
 * GET  /api/local-sync/config          — get current sync config (no token in response)
 * POST /api/local-sync/config          — save server URL + token to .env
 * GET  /api/local-sync/test            — test connection to remote server
 * POST /api/local-sync/push            — export local DB + profile → push to remote
 * POST /api/local-sync/pull            — pull snapshot from remote → return to client
 * GET  /api/local-sync/status          — last push/pull times from remote
 */

'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const log     = require('../utils/logger');
const db      = require('../db');

// ── Config helpers ─────────────────────────────────────────────────────────────
function getEnvPath() {
  return process.env.DB_PATH
    ? path.join(path.dirname(process.env.DB_PATH), '.env')
    : path.join(__dirname, '../../.env');
}

function getSyncConfig() {
  return {
    server_url: process.env.SYNC_SERVER_URL || '',
    has_token:  !!process.env.SYNC_TOKEN,
    token:      process.env.SYNC_TOKEN || '',
  };
}

function upsertEnv(key, value) {
  const envPath = getEnvPath();
  let content = '';
  try { content = fs.readFileSync(envPath, 'utf8'); } catch (_) {}
  const regex = new RegExp(`^${key}\\s*=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + (content.length ? '\n' : '') + `${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf8');
  process.env[key] = value;
}

// ── Remote API caller ──────────────────────────────────────────────────────────
async function remoteSync(method, endpoint, body = null) {
  const { default: fetch } = await import('node-fetch');
  const serverUrl = (process.env.SYNC_SERVER_URL || '').replace(/\/$/, '');
  const token     = process.env.SYNC_TOKEN;

  if (!serverUrl) throw new Error('No sync server URL configured');
  if (!token)     throw new Error('No sync token configured');

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${serverUrl}${endpoint}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `Remote server ${res.status}: ${endpoint}`);
  return data;
}

// ── GET /api/local-sync/config ─────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const cfg = getSyncConfig();
  res.json({
    server_url: cfg.server_url,
    has_token:  cfg.has_token,
    configured: !!(cfg.server_url && cfg.has_token),
  });
});

// ── POST /api/local-sync/config ────────────────────────────────────────────────
// token is optional if already stored — allows URL-only updates
router.post('/config', (req, res) => {
  const { server_url, token } = req.body || {};
  if (!server_url) {
    return res.status(400).json({ error: 'server_url is required' });
  }
  // Require token on first-time setup (no stored token yet)
  const existing = getSyncConfig();
  if (!token && !existing.has_token) {
    return res.status(400).json({ error: 'sync token is required on first setup' });
  }
  try {
    upsertEnv('SYNC_SERVER_URL', server_url.trim().replace(/\/$/, ''));
    if (token && token.trim()) upsertEnv('SYNC_TOKEN', token.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/local-sync/test ───────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  try {
    const data = await remoteSync('GET', '/api/sync/status');
    res.json({ ok: true, tenant: data.tenant_slug, display_name: data.display_name, last_sync_at: data.last_sync_at });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── POST /api/local-sync/push ──────────────────────────────────────────────────
router.post('/push', async (req, res) => {
  try {
    // Build DB export — projects + their approved scripts (no video files)
    const projects = db.getAllProjects() || [];

    // Attach approved writr scripts to each project so teleprompter works on pull
    const writrScripts = [];
    for (const p of projects) {
      try {
        const scripts = db.getWritrScriptsByProject(p.id) || [];
        scripts.forEach(s => writrScripts.push(s));
      } catch (_) {}
    }

    const dbExport = { projects, writr_scripts: writrScripts, exported_at: new Date().toISOString() };

    // Load creator profile
    let profile = null;
    try {
      const { loadProfile } = require('../utils/profile-validator');
      const pr = loadProfile();
      if (pr.ok) profile = pr.profile;
    } catch (_) {}

    const payload = {
      db_export:  dbExport,
      profile:    profile,
      pushed_at:  new Date().toISOString(),
    };

    const result = await remoteSync('POST', '/api/sync/push', payload);
    log.info({ module: 'local-sync' }, 'Push complete');
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error({ module: 'local-sync', err }, 'Push failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/local-sync/pull ──────────────────────────────────────────────────
// Returns the snapshot — client decides what to do with it (view / import)
router.post('/pull', async (req, res) => {
  try {
    const result = await remoteSync('GET', '/api/sync/pull');
    log.info({ module: 'local-sync' }, 'Pull complete');
    res.json({ ok: true, snapshot: result.snapshot, message: result.message });
  } catch (err) {
    log.error({ module: 'local-sync', err }, 'Pull failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/local-sync/status ─────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const cfg = getSyncConfig();
  if (!cfg.server_url || !cfg.has_token) {
    return res.json({ configured: false });
  }
  try {
    const data = await remoteSync('GET', '/api/sync/status');
    res.json({ configured: true, ok: true, ...data });
  } catch (err) {
    res.json({ configured: true, ok: false, error: err.message });
  }
});

// ── POST /api/local-sync/import ────────────────────────────────────────────────
// Merges projects from a pulled snapshot into the local DB.
// Default: skips projects that already exist (non-destructive).
// With overwrite:true: replaces existing projects by ID (delete + re-insert).
// Use overwrite on devices like the teleprompter laptop that only consume synced data.
router.post('/import', (req, res) => {
  const { snapshot, overwrite = false } = req.body || {};
  if (!snapshot?.db_export?.projects) {
    return res.status(400).json({ error: 'No projects in snapshot' });
  }

  const incoming       = snapshot.db_export.projects      || [];
  const incomingScript = snapshot.db_export.writr_scripts || [];
  let imported        = 0;
  let overwritten     = 0;
  let skipped         = 0;
  let scriptsImported = 0;

  try {
    // Get all local projects to check for duplicates
    const existing    = db.getAllProjects() || [];
    const existingIds = new Set(existing.map(p => p.id));

    for (const project of incoming) {
      const alreadyExists = existingIds.has(project.id);

      if (!alreadyExists) {
        // Check title+stage duplicate (even on fresh installs)
        const titleMatch = existing.find(
          p => p.title === project.title && p.current_stage === project.current_stage
        );
        if (titleMatch) {
          skipped++;
          continue;
        }

        // Import the project
        try {
          db.createProjectFromSnapshot(project);
          imported++;
        } catch (innerErr) {
          log.warn({ module: 'local-sync', title: project.title, err: innerErr }, 'Skipped project on import');
          skipped++;
          continue;
        }
      } else if (overwrite) {
        // Overwrite mode: replace stale local copy with the incoming snapshot version
        try {
          db.replaceProjectFromSnapshot(project);
          overwritten++;
        } catch (innerErr) {
          log.warn({ module: 'local-sync', title: project.title, err: innerErr }, 'Overwrite failed, skipping');
          skipped++;
          continue;
        }
      } else {
        // Default: skip existing projects
        skipped++;
      }

      // Always try to import scripts — even for pre-existing projects.
      // This handles the case where projects were synced before scripts were included.
      const scripts = incomingScript.filter(s => s.project_id === project.id);
      for (const script of scripts) {
        try {
          // Check if this script already exists by created_at timestamp
          const existingScripts = db.getWritrScriptsByProject(project.id) || [];
          const dup = existingScripts.find(e => e.created_at === script.created_at);
          if (!dup) {
            db.insertWritrScript(script);
            scriptsImported++;
          }

          // If this is an approved script, make sure the project knows it's writr_complete.
          // Projects imported in earlier syncs may have writr_complete=0 even though
          // the script now exists — this backfills that flag.
          if (script.approved) {
            try {
              db.updateProjectWritr(project.id, { writr_complete: 1 });
            } catch (_) {}
          }
        } catch (_) { /* non-fatal */ }
      }
    }

    log.info({ module: 'local-sync', imported, overwritten, skipped, scriptsImported }, 'Snapshot import complete');
    res.json({ ok: true, imported, overwritten, skipped, scripts_imported: scriptsImported });
  } catch (err) {
    log.error({ module: 'local-sync', err }, 'Import failed');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
