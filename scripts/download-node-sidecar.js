/**
 * download-node-sidecar.js
 * Downloads Node.js 20 LTS binaries into build-resources/ for Electron packaging.
 *
 * Usage:
 *   node scripts/download-node-sidecar.js          # current platform only
 *   node scripts/download-node-sidecar.js --all    # win + mac
 *
 * Output:
 *   build-resources/node-win/node.exe     (Windows x64)
 *   build-resources/node-mac/bin/node     (macOS arm64)
 *
 * These are referenced in package.json build.extraResources and copied next
 * to app.asar in the installer, accessible at process.resourcesPath/node/
 */

'use strict';
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { execSync } = require('child_process');

// Node 20 LTS — update this when moving to a newer LTS
const NODE_VERSION = '20.19.1';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;

const TARGETS = {
  win: {
    url:    `${BASE_URL}/node-v${NODE_VERSION}-win-x64.zip`,
    dest:   path.join(__dirname, '..', 'build-resources', 'node-win'),
    binary: 'node.exe',
    strip:  `node-v${NODE_VERSION}-win-x64/node.exe`,
  },
  mac: {
    url:    `${BASE_URL}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    dest:   path.join(__dirname, '..', 'build-resources', 'node-mac'),
    binary: 'bin/node',
    strip:  `node-v${NODE_VERSION}-darwin-arm64/bin/node`,
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || 0, 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.round((received / total) * 100);
          process.stdout.write(`\r  Downloading… ${pct}%`);
        }
      });
      res.pipe(file);
      file.on('finish', () => { process.stdout.write('\n'); file.close(resolve); });
    }).on('error', reject);
  });
}

async function fetchTarget(name, target) {
  console.log(`\n[${name}] Node.js v${NODE_VERSION}`);
  fs.mkdirSync(target.dest, { recursive: true });

  const tmpFile = path.join(target.dest, `_node_download_${name}`);

  console.log(`  → ${target.url}`);
  await download(target.url, tmpFile);

  // Extract only the node binary
  const isZip = target.url.endsWith('.zip');
  if (isZip) {
    // Windows zip — PowerShell extraction (cross-platform when building on Win)
    const outDir = target.dest;
    const nodeDest = path.join(outDir, 'node.exe');
    console.log('  Extracting node.exe from zip…');
    execSync(
      `powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${tmpFile}'); ` +
      `$entry = $zip.Entries | Where-Object { $_.FullName -eq '${target.strip}' }; ` +
      `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${nodeDest}', $true); ` +
      `$zip.Dispose()"`,
      { stdio: 'inherit' }
    );
  } else {
    // macOS tar.gz
    const outDir = target.dest;
    const binDir = path.join(outDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const nodeDest = path.join(outDir, 'bin', 'node');
    console.log('  Extracting bin/node from tar.gz…');
    execSync(
      `tar -xzf "${tmpFile}" -C "${outDir}" --strip-components=2 "node-v${NODE_VERSION}-darwin-arm64/bin/node"`,
      { stdio: 'inherit' }
    );
    execSync(`chmod +x "${nodeDest}"`);
  }

  fs.unlinkSync(tmpFile);
  const finalPath = path.join(target.dest, target.binary);
  const stat = fs.statSync(finalPath);
  console.log(`  ✓ ${finalPath} (${(stat.size / 1e6).toFixed(1)} MB)`);
}

async function main() {
  const all = process.argv.includes('--all');
  const platform = process.platform;

  const toFetch = all
    ? Object.entries(TARGETS)
    : platform === 'win32'
      ? [['win', TARGETS.win]]
      : [['mac', TARGETS.mac]];

  for (const [name, target] of toFetch) {
    await fetchTarget(name, target);
  }

  console.log('\nDone. Run `npm run dist:win` or `npm run dist:mac` to package.\n');
}

main().catch(err => { console.error(err.message); process.exit(1); });
