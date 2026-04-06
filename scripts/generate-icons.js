/**
 * scripts/generate-icons.js
 * Generates PNG icon files at every size needed by Electron.
 * Source: public/images/kre8r-icon.png (master 512×512)
 *
 * Usage: node scripts/generate-icons.js
 */

'use strict';

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const srcPath = path.join(__dirname, '../public/images/kre8r-icon.png');
const outDir  = path.join(__dirname, '../public/images');

// Sizes needed: 512 (master), 256, 128, 64, 32, 16
const sizes = [256, 128, 64, 32, 16];

async function generateIcons() {
  if (!fs.existsSync(srcPath)) {
    console.error('✗ Source icon not found:', srcPath);
    process.exit(1);
  }

  const meta = await sharp(srcPath).metadata();
  console.log(`Source: ${meta.width}×${meta.height} ${meta.format}`);

  for (const size of sizes) {
    const outPath = path.join(outDir, `kre8r-icon-${size}.png`);
    await sharp(srcPath).resize(size, size).png().toFile(outPath);
    console.log(`✓ ${size}×${size}  →  ${path.basename(outPath)}`);
  }

  console.log('\nAll icons generated.');
}

generateIcons().catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
