/**
 * TeleprΩmpter processScript unit tests
 * Tests the updated processScript() with all the new segment types.
 * Run: node scripts/test-teleprompter.js
 */

'use strict';

// ── Mock globals ──────────────────────────────────────────────────────────────
let showSpeakerNames = true;

// ── Extract processScript verbatim ────────────────────────────────────────────
function processScript(rawText) {
  if (!rawText) return [];
  let text = rawText.replace(/\*{0,2}PRODUCTION NOTES:?\*{0,2}[\s\S]*$/im, '');
  const segs = [];
  let beatN = 0;
  let lastT = null;
  const DROP_KEYWORDS = [
    /\bBEAT NEEDED\b/i, /\bb-roll\b/i, /\bINSERT\b/,
    /\bPRODUCTION NOTES?\b/i, /\bBridge line\b/i, /\bRecord this\b/i,
  ];
  for (let line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (lastT === 'text') { segs.push({ type: 'break' }); lastT = 'break'; }
      continue;
    }
    const bm = trimmed.match(/^\[●\s*BEAT(?:\s+\d+)?:\s*([^\]]+)\]$/i);
    if (bm) { beatN++; segs.push({ type: 'beat_marker', beatName: bm[1].trim(), beatN }); lastT = 'beat_marker'; continue; }

    const sm = trimmed.match(/^\[([A-Z][A-Z\s]{0,25})\]$/);
    if (sm) {
      if (showSpeakerNames) { segs.push({ type: 'speaker', name: sm[1].trim() }); lastT = 'speaker'; }
      continue;
    }

    const fc = trimmed[0];
    if (fc === '[') continue;
    if (fc === '(') continue;
    if (fc === '*') continue;
    if (/^-{2,}/.test(trimmed)) continue;
    if (/^[\p{Emoji}\p{S}\s]+$/u.test(trimmed) && !/[a-zA-Z0-9]/.test(trimmed)) continue;
    line = trimmed.replace(/^🎤\s*/u, '').trim();
    if (DROP_KEYWORDS.some(re => re.test(line))) continue;
    line = line.replace(/\(b-roll:[^)]*\)/gi, '');
    line = line.replace(/\([^)]*b-roll[^)]*\)/gi, '');
    line = line.replace(/\(INSERT[^)]+\)/gi, '');
    line = line.replace(/\[[^\]]*\]/g, '');
    line = line.replace(/\([a-z][^)]{0,80}\)/g, '');
    line = line.replace(/\*{1,2}[^*\n]+\*{1,2}/g, '');
    line = line.replace(/\s{2,}/g, ' ').trim();
    if (!line) { if (lastT === 'text') { segs.push({ type: 'break' }); lastT = 'break'; } continue; }
    segs.push({ type: 'text', content: line });
    lastT = 'text';
  }
  return segs;
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}
function expect(val) {
  return {
    toBe: (expected) => { if (val !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`); },
    toEqual: (expected) => { if (JSON.stringify(val) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`); },
    toContain: (sub) => { if (!JSON.stringify(val).includes(JSON.stringify(sub).slice(1,-1))) throw new Error(`Expected to contain ${JSON.stringify(sub)}, got ${JSON.stringify(val)}`); },
    toHaveLength: (n) => { if (val.length !== n) throw new Error(`Expected length ${n}, got ${val.length}`); },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n🎬 TeleprΩmpter processScript — Test Suite\n');

// ── TEST 1: Basic dialogue script — Jason solo ────────────────────────────────
console.log('Test 1: Jason solo dialogue');
test('Extracts spoken text', () => {
  const segs = processScript('[JASON]\nHey everyone, welcome back to the homestead.');
  expect(segs.find(s => s.type === 'text')?.content).toBe('Hey everyone, welcome back to the homestead.');
});
test('Speaker [JASON] becomes speaker segment', () => {
  const segs = processScript('[JASON]\nHey everyone.');
  expect(segs[0].type).toBe('speaker');
  expect(segs[0].name).toBe('JASON');
});

// ── TEST 2: Two-person script ─────────────────────────────────────────────────
console.log('\nTest 2: Two-person script (Jason + Cari)');
test('Both [JASON] and [CARI] become speaker segments', () => {
  const script = `[JASON]\nToday we are building a fence.\n\n[CARI]\nAnd I am going to hold the camera.`;
  const segs = processScript(script);
  const speakers = segs.filter(s => s.type === 'speaker');
  expect(speakers).toHaveLength(2);
  expect(speakers[0].name).toBe('JASON');
  expect(speakers[1].name).toBe('CARI');
});
test('Text lines preserved after speaker names', () => {
  const script = `[JASON]\nToday we are building a fence.\n\n[CARI]\nAnd I am going to hold the camera.`;
  const segs = processScript(script);
  const texts = segs.filter(s => s.type === 'text');
  expect(texts).toHaveLength(2);
});

// ── TEST 3: Beat markers survive ──────────────────────────────────────────────
console.log('\nTest 3: Beat markers');
test('Beat marker extracted correctly', () => {
  const segs = processScript('[● BEAT 1: HOOK]\nThis is the hook.');
  expect(segs[0].type).toBe('beat_marker');
  expect(segs[0].beatName).toBe('HOOK');
  expect(segs[0].beatN).toBe(1);
});
test('Beat markers are numbered sequentially', () => {
  const script = `[● BEAT 1: HOOK]\nLine one.\n[● BEAT 2: SETUP]\nLine two.\n[● BEAT 3: PAYOFF]\nLine three.`;
  const segs = processScript(script);
  const beats = segs.filter(s => s.type === 'beat_marker');
  expect(beats).toHaveLength(3);
  expect(beats[2].beatN).toBe(3);
});

// ── TEST 4: Production notes stripped ─────────────────────────────────────────
console.log('\nTest 4: Production notes stripped');
test('[B-ROLL: chickens] does not become speaker segment', () => {
  const segs = processScript('[B-ROLL: chickens clucking]\nThis is real dialogue.');
  const speakers = segs.filter(s => s.type === 'speaker');
  expect(speakers).toHaveLength(0);
});
test('[INSERT footage] stripped', () => {
  const segs = processScript('[INSERT: aerial shot]\nKeep talking.');
  const speakers = segs.filter(s => s.type === 'speaker');
  expect(speakers).toHaveLength(0);
  expect(segs.find(s => s.type === 'text')?.content).toBe('Keep talking.');
});
test('(parenthetical notes) stripped from within spoken lines', () => {
  const segs = processScript('We built this fence (b-roll: fence construction) ourselves.');
  expect(segs.find(s => s.type === 'text')?.content).toBe('We built this fence ourselves.');
});
test('Everything after PRODUCTION NOTES cut', () => {
  const script = `[JASON]\nReal line.\n\nPRODUCTION NOTES:\nDirector note here.\nAnother director note.`;
  const segs = processScript(script);
  const texts = segs.filter(s => s.type === 'text');
  expect(texts).toHaveLength(1);
  expect(texts[0].content).toBe('Real line.');
});

// ── TEST 5: Speaker names OFF toggle ──────────────────────────────────────────
console.log('\nTest 5: showSpeakerNames toggle');
test('When OFF, [JASON] is silently dropped (no speaker segment, no text)', () => {
  showSpeakerNames = false;
  const segs = processScript('[JASON]\nHey everyone.');
  const speakers = segs.filter(s => s.type === 'speaker');
  expect(speakers).toHaveLength(0);
  const texts = segs.filter(s => s.type === 'text');
  expect(texts[0].content).toBe('Hey everyone.');
  showSpeakerNames = true; // reset
});

// ── TEST 6: [BOTH] and multi-word names ───────────────────────────────────────
console.log('\nTest 6: Multi-word speaker names');
test('[BOTH] becomes speaker segment
