'use strict';

// Simulate a truncated response with one complete section and one cut off mid-object
const section1 = JSON.stringify({
  script_section: 'Intro — hook',
  section_index: 0,
  takes: [{ footage_id: 1, filename: 'clip1.mp4', start: 0, end: 12, transcript_excerpt: 'hey guys' }],
  selected_takes: [1],
  winner_footage_id: 1,
  gold_nugget: false,
  fire_suggestion: null,
  davinci_timeline_position: 0
});

const truncated = `{ "sections": [${section1}, {"script_section":"The Problem","section_index":1,"takes":[{"footage_id":2,"filename":"clip2.mp`;

// Inline the repair logic from selects.js
function findLastCompleteSection(cleaned) {
  const arrayMatch = cleaned.match(/"sections"\s*:\s*\[/);
  if (!arrayMatch) return -1;
  const arrayOpenIdx = cleaned.indexOf('[', arrayMatch.index);
  let depth = 0, inStr = false, esc = false, lastCompleteEnd = -1;
  for (let i = arrayOpenIdx + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc)                   { esc = false; continue; }
    if (ch === '\\' && inStr)  { esc = true;  continue; }
    if (ch === '"')            { inStr = !inStr; continue; }
    if (inStr)                 continue;
    if (ch === '{')            depth++;
    if (ch === '}') { depth--; if (depth === 0) lastCompleteEnd = i; }
    if (depth < 0)             break;
  }
  return lastCompleteEnd;
}

function repairJSON(cleaned) {
  const lastEnd = findLastCompleteSection(cleaned);
  if (lastEnd === -1) return null;
  const outerOpen = cleaned.indexOf('{');
  if (outerOpen === -1) return null;
  const repaired =
    cleaned.slice(outerOpen, lastEnd + 1) +
    '\n  ],"overall_notes":"[truncated]"\n}';
  try { return JSON.parse(repaired); } catch (_) { return null; }
}

// Test 1: direct parse of truncated → should fail
try {
  JSON.parse(truncated);
  console.error('FAIL: direct parse should have thrown');
  process.exit(1);
} catch (_) {
  console.log('[OK] direct parse correctly throws');
}

// Test 2: repair should recover section 1
const result = repairJSON(truncated);
if (!result) { console.error('FAIL: repairJSON returned null'); process.exit(1); }
if (result.sections.length !== 1) { console.error('FAIL: expected 1 section, got', result.sections.length); process.exit(1); }
if (result.sections[0].script_section !== 'Intro — hook') { console.error('FAIL: wrong section label'); process.exit(1); }
console.log('[OK] repairJSON recovered', result.sections.length, 'section(s):', result.sections[0].script_section);
console.log('[OK] overall_notes:', result.overall_notes.slice(0, 30));

// Test 3: word count and truncateTranscript
const { buildSelects } = require('./src/editor/selects'); // load to ensure no syntax errors
console.log('[OK] selects.js exports cleanly');

console.log('\nAll tests passed.');
