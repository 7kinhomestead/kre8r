/**
 * scripts/generate-icons.js
 * Generates PNG icon files at every size needed by Electron,
 * plus a multi-size .ico file for Windows.
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
const PNG_SIZES = [256, 128, 64, 32, 16];
// ICO sizes (multi-size ICO for best Windows display)
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

async function generateIcons() {
  if (!fs.existsSync(srcPath)) {
    console.error('✗ Source icon not found:', srcPath);
    process.exit(1);
  }

  const meta = await sharp(srcPath).metadata();
  console.log(`Source: ${meta.width}×${meta.height} ${meta.format}`);

  // Generate individual PNGs
  for (const size of PNG_SIZES) {
    const outPath = path.join(outDir, `kre8r-icon-${size}.png`);
    await sharp(srcPath).resize(size, size).png().toFile(outPath);
    console.log(`✓ ${size}×${size}  →  ${path.basename(outPath)}`);
  }

  // Generate .ico — manually build ICO format with multiple PNG frames
  // ICO format: 6-byte header + N*16-byte directory entries + N*image data
  const icoBuffers = await Promise.all(
    ICO_SIZES.map(size =>
      sharp(srcPath).resize(size, size).png().toBuffer()
    )
  );

  const ICO_HEADER_SIZE  = 6;
  const ICO_ENTRY_SIZE   = 16;
  const headerBuf = Buffer.alloc(ICO_HEADER_SIZE);
  headerBuf.writeUInt16LE(0,                   0); // reserved
  headerBuf.writeUInt16LE(1,                   2); // type = ICO
  headerBuf.writeUInt16LE(ICO_SIZES.length,    4); // count

  let offset = ICO_HEADER_SIZE + ICO_ENTRY_SIZE * ICO_SIZES.length;
  const entries = [];
  for (let i = 0; i < ICO_SIZES.length; i++) {
    const size = ICO_SIZES[i];
    const buf  = icoBuffers[i];
    const entry = Buffer.alloc(ICO_ENTRY_SIZE);
    entry.writeUInt8(size >= 256 ? 0 : size,  0); // width  (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size,  1); // height (0 = 256)
    entry.writeUInt8(0,                        2); // color count
    entry.writeUInt8(0,                        3); // reserved
    entry.writeUInt16LE(1,                     4); // color planes
    entry.writeUInt16LE(32,                    6); // bits per pixel
    entry.writeUInt32LE(buf.length,            8); // size of image data
    entry.writeUInt32LE(offset,               12); // offset of image data
    entries.push(entry);
    offset += buf.length;
  }

  const icoPath = path.join(outDir, 'kre8r-icon.ico');
  fs.writeFileSync(icoPath, Buffer.concat([headerBuf, ...entries, ...icoBuffers]));
  console.log(`✓ .ico (${ICO_SIZES.join('+')}px)  →  kre8r-icon.ico`);

  console.log('\nAll icons generated.');
  console.log('Note: macOS .icns requires iconutil (run on a Mac): iconutil -c icns kre8r-icon.iconset');
}

generateIcons().catch(err => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
