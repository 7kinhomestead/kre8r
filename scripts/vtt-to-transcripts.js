/**
 * vtt-to-transcripts.js
 *
 * Reads all .vtt files from D:/kre8r/fence/
 * Parses title + YouTube ID from filename: "Title [videoId].en.vtt"
 * Strips VTT formatting, deduplicates repeated lines
 * Writes clean transcripts.json ready for kre8r-land
 *
 * Usage:
 *   node scripts/vtt-to-transcripts.js
 *
 * Output:
 *   D:/kre8r/fence/transcripts.json
 */

const fs   = require('fs');
const path = require('path');

const VTT_DIR = 'D:/kre8r/fence';
const OUT     = path.join(VTT_DIR, 'transcripts.json');

// ── Parse title + ID from filename ───────────────────────────────────────────
// Format: "Some Title Here [videoId].en.vtt"
function parseFilename(filename) {
  const match = filename.match(/^(.+?)\s*\[([a-zA-Z0-9_-]{11})\]\..*\.vtt$/);
  if (!match) return null;
  return { title: match[1].trim(), youtube_id: match[2] };
}

// ── Strip VTT formatting → plain text ────────────────────────────────────────
function vttToText(raw) {
  const lines = raw.split('\n');
  const textLines = [];

  for (const line of lines) {
    const l = line.trim();
    // Skip header, timestamps, cue settings, empty lines, NOTE blocks
    if (!l)                          continue;
    if (l === 'WEBVTT')              continue;
    if (l.startsWith('NOTE'))        continue;
    if (l.startsWith('STYLE'))       continue;
    if (/^\d+$/.test(l))             continue; // cue index numbers
    if (/-->/.test(l))               continue; // timestamp lines
    if (/^[A-Z][\w-]+:/.test(l))     continue; // metadata like Kind: captions
    // Strip VTT inline tags: <00:00:00.000>, <c>, </c>, <b>, etc.
    const cleaned = l
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (cleaned) textLines.push(cleaned);
  }

  // Deduplicate consecutive repeated lines (auto-captions repeat a lot)
  const deduped = [];
  for (let i = 0; i < textLines.length; i++) {
    if (i === 0 || textLines[i] !== textLines[i - 1]) {
      deduped.push(textLines[i]);
    }
  }

  // Join and collapse extra whitespace
  return deduped.join(' ').replace(/\s{2,}/g, ' ').trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
const files = fs.readdirSync(VTT_DIR).filter(f => f.endsWith('.vtt'));
console.log(`Found ${files.length} VTT files in ${VTT_DIR}`);

const results = [];
let skipped = 0;

for (const file of files) {
  const parsed = parseFilename(file);
  if (!parsed) {
    console.warn(`  SKIP (bad filename): ${file}`);
    skipped++;
    continue;
  }

  const raw  = fs.readFileSync(path.join(VTT_DIR, file), 'utf8');
  const text = vttToText(raw);

  if (text.length < 100) {
    console.warn(`  SKIP (too short, ${text.length} chars): ${file}`);
    skipped++;
    continue;
  }

  results.push({
    id         : null, // no footage DB ID — these come from YouTube directly
    title      : parsed.title,
    youtube_id : parsed.youtube_id,
    youtube_url: `https://www.youtube.com/watch?v=${parsed.youtube_id}`,
    transcript : text,
  });

  console.log(`  ✓ ${parsed.title} [${parsed.youtube_id}] — ${text.length} chars`);
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8');

console.log(`\nDone.`);
console.log(`  Exported : ${results.length} transcripts`);
console.log(`  Skipped  : ${skipped}`);
console.log(`  Output   : ${OUT}`);
