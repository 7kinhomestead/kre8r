'use strict';

/**
 * Project Data Vault — triple-hardened project data preservation
 *
 * Saves all Id8Ωr research, WritΩr scripts, and PipΩr config history
 * to database/projects/{id}/vault/ so nothing is ever lost again.
 */

const fs   = require('fs');
const path = require('path');

const PROJECTS_DIR = path.join(__dirname, '..', '..', 'database', 'projects');

/** Returns absolute path inside project vault */
function getVaultPath(projectId, ...subpaths) {
  return path.join(PROJECTS_DIR, String(projectId), 'vault', ...subpaths);
}

/** Creates vault dir (and optional subdir) if needed, returns dir path */
function ensureVaultDir(projectId, subdir) {
  const dir = subdir
    ? path.join(PROJECTS_DIR, String(projectId), 'vault', subdir)
    : path.join(PROJECTS_DIR, String(projectId), 'vault');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Save data to vault file. data can be object (serialised to JSON) or string.
 * filename may include subdirectory segments e.g. 'id8r/research.json'
 */
function saveVaultData(projectId, filename, data) {
  const filePath = getVaultPath(projectId, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** Read vault file. Returns parsed JSON object, raw string, or null if missing. */
function getVaultData(projectId, filename) {
  const filePath = getVaultPath(projectId, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    try { return JSON.parse(raw); } catch (_) { return raw; }
  } catch (_) { return null; }
}

/** List all files in vault, sorted newest-first. Returns array of {name, path, size, modified} */
function listVaultFiles(projectId) {
  const vaultDir = getVaultPath(projectId);
  if (!fs.existsSync(vaultDir)) return [];

  const results = [];
  function walk(dir, prefix) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath, relPath);
      } else {
        try {
          const stat = fs.statSync(absPath);
          results.push({ name: entry.name, path: relPath, size: stat.size, modified: stat.mtime.toISOString() });
        } catch (_) {}
      }
    }
  }
  walk(vaultDir, '');
  return results.sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Backup current project-config.json into vault/config-history/ with timestamp.
 * Called automatically on every PipΩr save.
 */
function backupVault(projectId) {
  const configPath = path.join(PROJECTS_DIR, String(projectId), 'project-config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `config-history/project-config-${ts}.json`;
    const data = fs.readFileSync(configPath, 'utf8');
    saveVaultData(projectId, filename, data);
    return filename;
  } catch (err) {
    console.warn(`[vault] backupVault ${projectId} failed:`, err.message);
    return null;
  }
}

module.exports = { getVaultPath, ensureVaultDir, saveVaultData, getVaultData, listVaultFiles, backupVault };
