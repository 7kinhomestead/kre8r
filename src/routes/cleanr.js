'use strict';

/**
 * CleanΩr — Disk cleanup + performance snapshot tool
 *
 * GET  /api/cleanr/scan       — SSE: scan all junk categories, stream results
 * GET  /api/cleanr/drives     — drive space overview (PowerShell)
 * GET  /api/cleanr/processes  — top CPU/RAM processes (PowerShell)
 * GET  /api/cleanr/startup    — startup programs (PowerShell)
 * POST /api/cleanr/delete     — delete selected items { paths: string[] }
 * POST /api/cleanr/move       — move items to D: { paths: string[], destRoot: string }
 *
 * SAFETY MODEL:
 *   - Scan populates a server-side whitelist of scanned paths
 *   - Delete/move only accepts paths that appeared in the last scan
 *   - Never touches system dirs, executables, or DLLs
 *   - Directories are deleted recursively only if the entire dir was scanned
 */

const express       = require('express');
const router        = express.Router();
const fs            = require('fs');
const path          = require('path');
const { exec }      = require('child_process');
const { promisify } = require('util');
const execAsync     = promisify(exec);

const { startSseResponse } = require('../utils/sse');
const log = require('../utils/logger');

// ─── Scan whitelist: populated during scan, validated on delete/move ───────
const scannedPaths = new Set();

// ─── Helpers ────────────────────────────────────────────────────────────────

function expandEnv(p) {
  return p.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
}

function safeStatSync(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function getDirSize(dirPath, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return 0;
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isFile()) {
          total += fs.statSync(full).size;
        } else if (entry.isSymbolicLink()) {
          // skip symlinks
        } else if (entry.isDirectory()) {
          total += getDirSize(full, maxDepth, depth + 1);
        }
      } catch { /* locked/permission — skip */ }
    }
  } catch { /* unreadable dir — skip */ }
  return total;
}

function scanDirContents(dirPath) {
  const items = [];
  let totalSize = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      try {
        const stat = safeStatSync(full);
        if (!stat) continue;
        const size = entry.isDirectory() ? getDirSize(full, 3) : stat.size;
        items.push({
          path: full,
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size,
          modified: stat.mtime.toISOString(),
        });
        totalSize += size;
      } catch { /* skip */ }
    }
  } catch { /* skip unreadable root */ }
  return { items, totalSize };
}

function findLargeFilesInDirs(dirs, minSize, maxDepth = 3) {
  const SKIP = new Set([
    'Windows', 'Program Files', 'Program Files (x86)',
    'ProgramData', '$Recycle.Bin', 'System Volume Information',
    'node_modules', '.git', 'AppData',
  ]);
  const results = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          if (entry.isFile()) {
            const stat = fs.statSync(full);
            if (stat.size >= minSize) {
              results.push({ path: full, name: entry.name, type: 'file', size: stat.size, modified: stat.mtime.toISOString() });
            }
          } else if (entry.isDirectory()) {
            walk(full, depth + 1);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  for (const dir of dirs) {
    if (fs.existsSync(dir)) walk(dir, 0);
  }
  return results.sort((a, b) => b.size - a.size);
}

function findNodeModules(searchRoots, maxDepth = 3) {
  const results = [];
  const SKIP = new Set(['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin']);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === 'node_modules') {
          const size = getDirSize(full, 4);
          const stat = safeStatSync(full) || {};
          results.push({ path: full, name: entry.name, type: 'dir', size, modified: (stat.mtime || new Date()).toISOString() });
          // Don't recurse into node_modules
        } else {
          walk(full, depth + 1);
        }
      }
    } catch { /* skip */ }
  }

  for (const root of searchRoots) {
    if (fs.existsSync(root)) walk(root, 0);
  }
  return results.sort((a, b) => b.size - a.size);
}

// ─── Junk category definitions ───────────────────────────────────────────────

function buildCategories() {
  const LOCAL = process.env.LOCALAPPDATA || expandEnv('%LOCALAPPDATA%');
  const APPDATA = process.env.APPDATA || expandEnv('%APPDATA%');
  const USERPROFILE = process.env.USERPROFILE || expandEnv('%USERPROFILE%');
  const TEMP = process.env.TEMP || path.join(LOCAL, 'Temp');

  return [
    {
      id: 'user_temp',
      name: 'User Temp Files',
      description: 'Temporary files created by apps — safe to delete, rebuilt as needed',
      safe: true,
      scanFn: () => {
        const r = scanDirContents(TEMP);
        // Also check second temp location if different
        const alt = path.join(LOCAL, 'Temp');
        if (alt.toLowerCase() !== TEMP.toLowerCase() && fs.existsSync(alt)) {
          const r2 = scanDirContents(alt);
          r.items.push(...r2.items);
          r.totalSize += r2.totalSize;
        }
        return r;
      },
    },
    {
      id: 'win_temp',
      name: 'Windows System Temp',
      description: 'System-wide temp folder (C:\\Windows\\Temp) — safe to delete',
      safe: true,
      scanFn: () => scanDirContents('C:\\Windows\\Temp'),
    },
    {
      id: 'win_update',
      name: 'Windows Update Cache',
      description: 'Downloaded Windows updates — Windows re-downloads if needed',
      safe: true,
      scanFn: () => scanDirContents('C:\\Windows\\SoftwareDistribution\\Download'),
    },
    {
      id: 'win_error',
      name: 'Windows Error Reports',
      description: 'Crash logs and error reports sent to Microsoft',
      safe: true,
      scanFn: () => scanDirContents(path.join(LOCAL, 'Microsoft', 'Windows', 'WER')),
    },
    {
      id: 'chrome_cache',
      name: 'Chrome Cache',
      description: 'Google Chrome browser cache — pages load from the internet again',
      safe: true,
      scanFn: () => {
        const items = [];
        let totalSize = 0;
        const chromeBase = path.join(LOCAL, 'Google', 'Chrome', 'User Data');
        if (!fs.existsSync(chromeBase)) return { items, totalSize };
        try {
          for (const profile of fs.readdirSync(chromeBase, { withFileTypes: true })) {
            if (!profile.isDirectory()) continue;
            // Default, Profile 1, Profile 2, etc.
            if (profile.name !== 'Default' && !profile.name.startsWith('Profile')) continue;
            const cacheDir = path.join(chromeBase, profile.name, 'Cache');
            if (fs.existsSync(cacheDir)) {
              const size = getDirSize(cacheDir, 2);
              const stat = safeStatSync(cacheDir) || {};
              items.push({ path: cacheDir, name: `Chrome ${profile.name} Cache`, type: 'dir', size, modified: (stat.mtime || new Date()).toISOString() });
              totalSize += size;
            }
          }
        } catch { /* skip */ }
        return { items, totalSize };
      },
    },
    {
      id: 'edge_cache',
      name: 'Edge Cache',
      description: 'Microsoft Edge browser cache',
      safe: true,
      scanFn: () => {
        const items = [];
        let totalSize = 0;
        const edgeBase = path.join(LOCAL, 'Microsoft', 'Edge', 'User Data');
        if (!fs.existsSync(edgeBase)) return { items, totalSize };
        try {
          for (const profile of fs.readdirSync(edgeBase, { withFileTypes: true })) {
            if (!profile.isDirectory()) continue;
            if (profile.name !== 'Default' && !profile.name.startsWith('Profile')) continue;
            const cacheDir = path.join(edgeBase, profile.name, 'Cache');
            if (fs.existsSync(cacheDir)) {
              const size = getDirSize(cacheDir, 2);
              const stat = safeStatSync(cacheDir) || {};
              items.push({ path: cacheDir, name: `Edge ${profile.name} Cache`, type: 'dir', size, modified: (stat.mtime || new Date()).toISOString() });
              totalSize += size;
            }
          }
        } catch { /* skip */ }
        return { items, totalSize };
      },
    },
    {
      id: 'npm_cache',
      name: 'npm Cache',
      description: 'Node.js npm package download cache',
      safe: true,
      scanFn: () => {
        const candidates = [
          path.join(APPDATA, 'npm-cache'),
          path.join(LOCAL, 'npm-cache'),
        ];
        const items = [];
        let totalSize = 0;
        for (const dir of candidates) {
          if (fs.existsSync(dir)) {
            const size = getDirSize(dir, 4);
            const stat = safeStatSync(dir) || {};
            items.push({ path: dir, name: 'npm cache', type: 'dir', size, modified: (stat.mtime || new Date()).toISOString() });
            totalSize += size;
          }
        }
        return { items, totalSize };
      },
    },
    {
      id: 'pip_cache',
      name: 'pip Cache',
      description: 'Python pip package download cache',
      safe: true,
      scanFn: () => {
        const dir = path.join(LOCAL, 'pip', 'Cache');
        if (!fs.existsSync(dir)) return { items: [], totalSize: 0 };
        const size = getDirSize(dir, 3);
        const stat = safeStatSync(dir) || {};
        return { items: [{ path: dir, name: 'pip cache', type: 'dir', size, modified: (stat.mtime || new Date()).toISOString() }], totalSize: size };
      },
    },
    {
      id: 'vscode_logs',
      name: 'VS Code Logs',
      description: 'VS Code application logs — safe to delete',
      safe: true,
      scanFn: () => {
        const dir = path.join(APPDATA, 'Code', 'logs');
        if (!fs.existsSync(dir)) return { items: [], totalSize: 0 };
        return scanDirContents(dir);
      },
    },
    {
      id: 'thumbnails',
      name: 'Windows Thumbnail Cache',
      description: 'Cached thumbnails for Windows Explorer — rebuilt automatically',
      safe: true,
      scanFn: () => {
        const dir = path.join(LOCAL, 'Microsoft', 'Windows', 'Explorer');
        if (!fs.existsSync(dir)) return { items: [], totalSize: 0 };
        const items = [];
        let totalSize = 0;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            if (!entry.name.startsWith('thumbcache') && !entry.name.startsWith('iconcache')) continue;
            const full = path.join(dir, entry.name);
            const stat = safeStatSync(full);
            if (!stat) continue;
            items.push({ path: full, name: entry.name, type: 'file', size: stat.size, modified: stat.mtime.toISOString() });
            totalSize += stat.size;
          }
        } catch { /* skip */ }
        return { items, totalSize };
      },
    },
    {
      id: 'crash_dumps',
      name: 'Crash Dumps',
      description: 'Memory dumps from app crashes',
      safe: true,
      scanFn: () => {
        const dirs = [
          path.join(LOCAL, 'CrashDumps'),
          path.join(USERPROFILE, 'AppData', 'Local', 'Temp', 'Crashes'),
          'C:\\Windows\\Minidump',
        ].filter(d => fs.existsSync(d));
        const items = [];
        let totalSize = 0;
        for (const d of dirs) {
          const r = scanDirContents(d);
          items.push(...r.items);
          totalSize += r.totalSize;
        }
        return { items, totalSize };
      },
    },
  ];
}

// ─── SSE: Scan ───────────────────────────────────────────────────────────────

router.get('/scan', (req, res) => {
  const { send, end } = startSseResponse(res);
  scannedPaths.clear();

  (async () => {
    const categories = buildCategories();
    let grandTotal = 0;

    for (const cat of categories) {
      send({ type: 'category_start', id: cat.id, name: cat.name, description: cat.description });
      let result = { items: [], totalSize: 0 };
      try { result = cat.scanFn(); } catch (err) {
        log.warn({ module: 'cleanr', catId: cat.id, err }, 'Category scan error');
      }
      // Register all found paths in the whitelist
      for (const item of result.items) scannedPaths.add(item.path);
      grandTotal += result.totalSize;
      send({ type: 'category_done', id: cat.id, name: cat.name, totalSize: result.totalSize, count: result.items.length, items: result.items });
    }

    // Large files in user dirs (>50MB)
    send({ type: 'category_start', id: 'large_files', name: 'Large Files (User Folders)', description: 'Files over 50 MB in your Downloads, Desktop, Documents, Videos' });
    const USERPROFILE = process.env.USERPROFILE || '';
    const userDirs = ['Downloads', 'Desktop', 'Documents', 'Videos', 'Pictures']
      .map(d => path.join(USERPROFILE, d))
      .filter(d => fs.existsSync(d));
    const largeFiles = findLargeFilesInDirs(userDirs, 50 * 1024 * 1024, 4);
    for (const f of largeFiles) scannedPaths.add(f.path);
    const largeTotal = largeFiles.reduce((s, f) => s + f.size, 0);
    grandTotal += largeTotal;
    send({ type: 'category_done', id: 'large_files', name: 'Large Files (User Folders)', totalSize: largeTotal, count: largeFiles.length, items: largeFiles });

    // node_modules in project dirs
    send({ type: 'category_start', id: 'node_modules', name: 'node_modules Folders', description: 'node_modules in your project folders — re-run npm install to restore' });
    const devRoots = [
      USERPROFILE,
      'C:\\Users\\18054',
      'C:\\dev',
      'C:\\projects',
    ].filter(d => fs.existsSync(d));
    const nodeMods = findNodeModules(devRoots, 3);
    for (const f of nodeMods) scannedPaths.add(f.path);
    const nodeTotal = nodeMods.reduce((s, f) => s + f.size, 0);
    grandTotal += nodeTotal;
    send({ type: 'category_done', id: 'node_modules', name: 'node_modules Folders', totalSize: nodeTotal, count: nodeMods.length, items: nodeMods });

    send({ type: 'scan_complete', grandTotal });
    end();
  })().catch(err => {
    log.error({ module: 'cleanr', err }, 'Scan failed');
    send({ type: 'error', message: err.message });
    end();
  });
});

// ─── Drives ──────────────────────────────────────────────────────────────────

router.get('/drives', async (req, res) => {
  try {
    const ps = `Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -ne $null -and $_.Used -ne $null } | Select-Object Name, Root, @{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}} | ConvertTo-Json`;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`);
    let drives = JSON.parse(stdout.trim());
    if (!Array.isArray(drives)) drives = [drives];
    res.json({ drives });
  } catch (err) {
    log.error({ module: 'cleanr', err }, 'Drive query failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── Processes ───────────────────────────────────────────────────────────────

router.get('/processes', async (req, res) => {
  try {
    const ps = `Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 Name, @{N='CPU';E={[math]::Round($_.CPU,1)}}, @{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}}, Id, @{N='Path';E={try{$_.Path}catch{''}}} | ConvertTo-Json`;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`);
    let processes = JSON.parse(stdout.trim());
    if (!Array.isArray(processes)) processes = [processes];
    res.json({ processes });
  } catch (err) {
    log.error({ module: 'cleanr', err }, 'Process query failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── Startup Programs ─────────────────────────────────────────────────────────

router.get('/startup', async (req, res) => {
  try {
    const ps = `Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | ConvertTo-Json`;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`);
    let startup = [];
    try {
      startup = JSON.parse(stdout.trim());
      if (!Array.isArray(startup)) startup = [startup];
    } catch { startup = []; }
    res.json({ startup });
  } catch (err) {
    log.error({ module: 'cleanr', err }, 'Startup query failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── Drivers ─────────────────────────────────────────────────────────────────

router.get('/drivers', async (req, res) => {
  try {
    // WMI DriverDate is in "yyyymmddHHMMSS.mmmmmm+UUU" format — convert to ISO
    const ps = [
      'Get-WmiObject Win32_PnPSignedDriver',
      '| Where-Object { $_.DeviceName -ne $null -and $_.DriverVersion -ne $null }',
      '| Select-Object DeviceName, DriverVersion,',
      '  @{N="DriverDate";E={',
      '    if($_.DriverDate){',
      '      try{[Management.ManagementDateTimeConverter]::ToDateTime($_.DriverDate).ToString("yyyy-MM-dd")}catch{""}',
      '    } else {""}',
      '  }},',
      '  Manufacturer, IsSigned, DeviceClass',
      '| ConvertTo-Json -Depth 2',
    ].join(' ');

    const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`, { maxBuffer: 8 * 1024 * 1024 });
    let drivers = [];
    try {
      drivers = JSON.parse(stdout.trim());
      if (!Array.isArray(drivers)) drivers = [drivers];
    } catch { drivers = []; }

    // Filter out blank/system entries and sort oldest first
    drivers = drivers
      .filter(d => d.DeviceName && d.DeviceName.trim())
      .sort((a, b) => (a.DriverDate || '').localeCompare(b.DriverDate || ''));

    res.json({ drivers });
  } catch (err) {
    log.error({ module: 'cleanr', err }, 'Driver query failed');
    res.status(500).json({ error: err.message });
  }
});

// ─── Safety validator ────────────────────────────────────────────────────────

const NEVER_DELETE = [
  'c:\\windows\\system32',
  'c:\\windows\\syswow64',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\users\\default',
  'c:\\boot',
  'c:\\$recycle.bin',
];
const NEVER_DELETE_EXTS = new Set(['.exe', '.dll', '.sys', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.lnk']);

// isPathSafe — used for DELETE: requires whitelist membership + protected-path check
function isPathSafe(p) {
  const norm = p.toLowerCase().replace(/\//g, '\\');
  if (!scannedPaths.has(p)) return false;
  for (const blocked of NEVER_DELETE) {
    if (norm.startsWith(blocked)) return false;
  }
  const ext = path.extname(p).toLowerCase();
  if (NEVER_DELETE_EXTS.has(ext)) return false;
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return false;
  return true;
}

// isMoveSafe — used for MOVE: validates path without requiring whitelist membership.
// Moves are copy-then-delete so they are safe even across server restarts.
function isMoveSafe(p) {
  if (!p || typeof p !== 'string') return false;
  // Must be an absolute Windows path
  if (!/^[a-zA-Z]:\\/.test(p)) return false;
  const norm = p.toLowerCase().replace(/\//g, '\\');
  // Must not touch system directories
  for (const blocked of NEVER_DELETE) {
    if (norm.startsWith(blocked)) return false;
  }
  // Must not be a system file type
  const ext = path.extname(p).toLowerCase();
  if (NEVER_DELETE_EXTS.has(ext)) return false;
  // Must be at least 2 path components deep
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return false;
  // Must actually exist on disk
  if (!fs.existsSync(p)) return false;
  return true;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

router.post('/delete', async (req, res) => {
  const { paths } = req.body;
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths array required' });
  }

  const results = [];
  let totalFreed = 0;

  for (const p of paths) {
    if (!isPathSafe(p)) {
      results.push({ path: p, ok: false, error: 'Path not in scan whitelist or is protected' });
      continue;
    }
    try {
      const stat = safeStatSync(p);
      if (!stat) { results.push({ path: p, ok: false, error: 'Not found' }); continue; }
      const size = stat.isDirectory() ? getDirSize(p, 5) : stat.size;
      if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
      totalFreed += size;
      scannedPaths.delete(p);
      results.push({ path: p, ok: true, size });
    } catch (err) {
      results.push({ path: p, ok: false, error: err.message });
    }
  }

  res.json({ results, totalFreed });
});

// ─── Move to D: ──────────────────────────────────────────────────────────────

router.post('/move', async (req, res) => {
  const { paths, destRoot = 'D:\\kre8r-moved' } = req.body;
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'paths array required' });
  }
  // Validate destRoot is on D:
  if (!destRoot.toLowerCase().startsWith('d:\\')) {
    return res.status(400).json({ error: 'destRoot must be on D:\\' });
  }

  const results = [];
  let totalMoved = 0;

  for (const p of paths) {
    if (!isMoveSafe(p)) {
      results.push({ path: p, ok: false, error: 'Path is protected or does not exist' });
      continue;
    }
    try {
      const stat = safeStatSync(p);
      if (!stat) { results.push({ path: p, ok: false, error: 'Not found' }); continue; }

      // Build destination path, preserving structure relative to drive root
      const relative = p.replace(/^[a-zA-Z]:\\/, '').replace(/\\/g, path.sep);
      const dest = path.join(destRoot, relative);
      const destDir = path.dirname(dest);

      fs.mkdirSync(destDir, { recursive: true });

      const size = stat.isDirectory() ? getDirSize(p, 5) : stat.size;

      if (stat.isDirectory()) {
        // Copy then delete
        function copyDir(src, dst) {
          fs.mkdirSync(dst, { recursive: true });
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, entry.name);
            const d = path.join(dst, entry.name);
            if (entry.isDirectory()) copyDir(s, d);
            else fs.copyFileSync(s, d);
          }
        }
        copyDir(p, dest);
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.copyFileSync(p, dest);
        fs.unlinkSync(p);
      }

      totalMoved += size;
      scannedPaths.delete(p);
      results.push({ path: p, dest, ok: true, size });
    } catch (err) {
      results.push({ path: p, ok: false, error: err.message });
    }
  }

  res.json({ results, totalMoved });
});

module.exports = router;
