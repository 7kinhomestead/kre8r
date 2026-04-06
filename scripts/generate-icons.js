/**
 * scripts/generate-icons.js
 * Converts kre8r-icon.svg into PNG files at every size needed by
 * Electron (Windows .ico source, macOS .icns source, taskbar, etc.)
 *
 * Usage: node scripts/generate-icons.js
 */

'use strict';

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const svgPath = path.join(__dirname, '../public/images/kre8r-icon.svg');
const outDir  = path.join(__dirname, '../public/images');

const sizes = [512, 256, 128, 64, 32, 16];

async function generateIcons() {
  if (!fs.existsSync(svgPath)) {
    console.error('✗ SVG not found:', svgPath);
    process.exit(1);
  }

  const svg = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outPath = path.join(outDir, size === 512
      ? 'kre8r-icon.png'
      : `kre8r-icon-${size}.png`
    );
    await sharp(svg).resize(size, size).png().toFile(outPath);
    console.log(`✓ ${size}×${size}  →  ${path.basename(outPath)}`);
  }

  console.log('\nAll icons generated.');
}

generateIcons().catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
