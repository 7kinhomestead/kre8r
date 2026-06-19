'use strict';

/**
 * GeneratΩr output path utility
 *
 * Both BrollΩr and AnimΩr (the GeneratΩr tools) download generated clips to:
 *   {intake_folder}/{project_id}_{slug}/generated/
 *
 * This follows the VaultΩr watcher convention so generated assets are
 * automatically ingested and associated with the correct project.
 * Shot type defaults to 'broll' so they're available in AssemblΩr immediately.
 */

const path = require('path');
const fs   = require('fs');
const https = require('https');
const http  = require('http');

function getIntakeFolder() {
  try {
    const { loadProfile } = require('./creator-context');
    const profile = loadProfile();
    return profile?.vault?.intake_folder || null;
  } catch (_) {
    return null;
  }
}

function slugify(title) {
  return (title || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/**
 * Returns the GeneratΩr output folder for a project, creating it if needed.
 * Format: {intake_folder}/{project_id}_{slug}/generated/
 */
function getGeneratorOutputPath(projectId, projectTitle) {
  const intakeFolder = getIntakeFolder();
  if (!intakeFolder) return null;

  const slug    = slugify(projectTitle);
  const dirName = `${projectId}_${slug}`;
  const outDir  = path.join(intakeFolder, dirName, 'generated');

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (_) {
    return null;
  }

  return outDir;
}

/**
 * Downloads a URL to the GeneratΩr output folder for a project.
 * Returns the local file path on success, null on failure.
 *
 * @param {string} url           - CDN URL to download
 * @param {string} filename      - output filename (e.g. 'broll-001.mp4')
 * @param {number} projectId     - project ID for folder naming
 * @param {string} projectTitle  - project title for folder naming
 */
function downloadToGenerator(url, filename, projectId, projectTitle) {
  return new Promise((resolve) => {
    const outDir = getGeneratorOutputPath(projectId, projectTitle);
    if (!outDir) return resolve(null);

    const dest = path.join(outDir, filename);
    const protocol = url.startsWith('https') ? https : http;

    const file = fs.createWriteStream(dest);
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return resolve(null);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(dest);
      });
    }).on('error', () => {
      file.close();
      try { fs.unlinkSync(dest); } catch (_) {}
      resolve(null);
    });
  });
}

module.exports = { getGeneratorOutputPath, downloadToGenerator, getIntakeFolder };
