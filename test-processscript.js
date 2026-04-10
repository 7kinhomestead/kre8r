// ── Minimal stubs so processScript runs standalone ──────────────
let showSpeakerNames = true;

// ── Extract processScript from teleprompter.html ─────────────────
const fs = require('fs');
const html = fs.readFileSync('public/teleprompter.html', 'utf8');
const fnStart = html.indexOf('function processScript(rawText)');
const fnEnd   = html.indexOf('\n}', fnStart) + 2;
const fnSrc   = html.slice(fnStart, fnEnd);
eval(fnSrc);

// ── Test helpers ─────────────────────────────────────────────────
let pass = 0, fail = 0;
function test(label, got, check) {
  const ok = check(got);
  if (ok) { pass++; }
  else     { fail++; console.log('FAIL', label, '--', typeof got === 'object' ? JSON.stringify(got).slice(0,200) : got); }
}
function texts(segs)    { return segs.filter(s => s.type === 'text'); }
function beats(segs)    { return segs.filter(s => s.type === 'beat_marker'); }
function speakers(segs) { return segs.filter(s => s.type === 'speaker'); }

// ═════════════════ FIXTURES ═════════════════════════════════════
const SIMPLE = `
Here is some spoken text.
This is the second sentence.
And the third.
`;

const WITH_BEATS = `
[● BEAT 1: Opening Hook]
Here is the hook line.
[● BEAT 2: Main Content]
This is the main content.
[● BEAT 3: Closing CTA]
Call to action here.
`;

const WITH_SPEAKERS = `
[JASON]
This is Jason speaking now.
[CARI]
And Cari responds here.
[JASON]
Jason continues talking.
`;

const BROLL_INLINE = `
Built this (b-roll: aerial shot) ourselves from scratch.
Three years here (b-roll: timelapse) teaches things fast.
`;

const BROLL_LEADLINE = `
(b-roll: wide farm shot)
Main spoken content here.
`;

const BROLL_PAREN_PREFIX = `
(b-roll: laughing) Backup plan always works.
`;

const MIXED_PRODUCTION = `
[● BEAT 1: Hook]
[JASON]
Start strong here always.
(b-roll: opening shot)
This sentence has (b-roll: close-up) inline note.
[CARI]
Cari chimes in right now.
PRODUCTION NOTES: shoot at golden hour
Final spoken line here.
`;

const BEAT_NEEDED = `
Need content here - BEAT NEEDED
This is spoken.
`;

const PAREN_LOWER = `
This is real text.
(director note: pause here)
More real text follows.
`;

const MIC_EMOJI = `
🎤 This line starts with mic emoji.
Regular line without emoji here.
`;

const BLANK_LINES = `
First sentence.

Second sentence.

Third sentence.
`;

const SPEAKER_TOGGLE_OFF = `
[JASON]
Jason speaks this.
[CARI]
Cari answers here.
`;

const UNICODE_CHARS = `
Here's a line with unicode — em dash.
And one with 'smart quotes' too.
`;

const ONLY_PRODUCTION = `
(b-roll: farm intro)
[B-ROLL: wide shot]
PRODUCTION NOTES: use golden hour
`;

const FULL_SCRIPT = `
[● BEAT 1: Opening Hook]
[JASON]
We built this place from nothing.
(b-roll: aerial shot of farm)
Three years (b-roll: timelapse) of building it.
[CARI]
(b-roll: laughing) Backup plan always works.
[● BEAT 2: Main Content]
[JASON]
Here is the actual main content.
This covers everything we learned.
[CARI]
And Cari adds perspective here.
[● BEAT 3: Closing CTA]
[JASON]
Join us in the community now.
PRODUCTION NOTES: add b-roll of sunset
`;

const DIVIDERS = `
Real spoken content here.
---
More spoken content follows.
----
Final line of content.
`;

const STAR_LINES = `
Real line of content.
* Director note here
** Another note here
More real content here.
`;

const BRACKET_GENERAL = `
[Some random bracket note]
Real spoken line here.
[Another bracket thing]
More spoken content.
`;

const NESTED_BROLL = `
This is (b-roll: sunset (golden)) the main text.
`;

const LONG_SCRIPT = Array.from({length:20}, (_,i) => `Line number ${i+1} of content.`).join('\n');

const INSERT_INLINE = `
Here is text with (INSERT stock footage) embedded.
Normal line here.
`;

// ═════════════════ TESTS ════════════════════════════════════════

// 1. Basic text extraction
test('basic text count', texts(processScript(SIMPLE)), r => r.length === 3);
test('basic text content 1', texts(processScript(SIMPLE)), r => r[0].content === 'Here is some spoken text.');
test('basic text content 2', texts(processScript(SIMPLE)), r => r[1].content === 'This is the second sentence.');

// 2. Beat markers
test('beat count', beats(processScript(WITH_BEATS)), r => r.length === 3);
test('beat names', beats(processScript(WITH_BEATS)), r => r[0].beatName === 'Opening Hook');
test('beat numbers', beats(processScript(WITH_BEATS)), r => r[2].beatN === 3);
test('beat text after', texts(processScript(WITH_BEATS)), r => r.length === 3);

// 3. Speaker markers
test('speaker count', speakers(processScript(WITH_SPEAKERS)), r => r.length === 3);
test('speaker names', speakers(processScript(WITH_SPEAKERS)), r => r[0].name === 'JASON' && r[1].name === 'CARI');
test('speaker text preserved', texts(processScript(WITH_SPEAKERS)), r => r.length === 3);

// 4. B-roll inline stripped (BUG WAS HERE)
test('b-roll inline stripped text1', texts(processScript(BROLL_INLINE)), r => {
  return r.length >= 1 && r[0].content === 'Built this ourselves from scratch.';
});
test('b-roll inline stripped text2', texts(processScript(BROLL_INLINE)), r => {
  return r.length >= 2 && r[1].content === 'Three years here teaches things fast.';
});

// 5. B-roll standalone line dropped
test('b-roll lead line dropped', texts(processScript(BROLL_LEADLINE)), r => r.length === 1 && r[0].content === 'Main spoken content here.');

// 6. B-roll paren prefix with spoken content (BUG WAS HERE)
test('b-roll paren prefix kept', texts(processScript(BROLL_PAREN_PREFIX)), r => {
  return r.length === 1 && r[0].content === 'Backup plan always works.';
});

// 7. Mixed production notes
test('mixed: beat count', beats(processScript(MIXED_PRODUCTION)), r => r.length === 1);
test('mixed: production notes stripped', texts(processScript(MIXED_PRODUCTION)), r => !r.some(s => /PRODUCTION NOTES/i.test(s.content)));
test('mixed: inline b-roll stripped from text', texts(processScript(MIXED_PRODUCTION)), r => {
  return !r.some(s => /b-roll/i.test(s.content));
});
test('mixed: spoken lines kept', texts(processScript(MIXED_PRODUCTION)), r => r.some(s => s.content === 'Start strong here always.'));

// 8. BEAT NEEDED keyword
test('beat needed dropped', texts(processScript(BEAT_NEEDED)), r => r.length === 1 && r[0].content === 'This is spoken.');

// 9. Parenthetical director notes
test('paren lower note dropped', texts(processScript(PAREN_LOWER)), r => r.length === 2);

// 10. Mic emoji
test('mic emoji stripped', texts(processScript(MIC_EMOJI)), r => r[0].content === 'This line starts with mic emoji.');

// 11. Blank lines become breaks (3 breaks: between each sentence + trailing newline in fixture)
test('blank lines = breaks', processScript(BLANK_LINES).filter(s => s.type === 'break'), r => r.length >= 2);

// 12. Speaker toggle off
showSpeakerNames = false;
test('speaker toggle off: no speaker segs', speakers(processScript(SPEAKER_TOGGLE_OFF)), r => r.length === 0);
test('speaker toggle off: text kept', texts(processScript(SPEAKER_TOGGLE_OFF)), r => r.length === 2);
showSpeakerNames = true;

// 13. Unicode chars pass through
test('unicode chars', texts(processScript(UNICODE_CHARS)), r => r.length === 2);

// 14. Only production notes -> empty
test('only production = empty', texts(processScript(ONLY_PRODUCTION)), r => r.length === 0);

// 15. Full script
const fullSegs = processScript(FULL_SCRIPT);
test('full script: 3 beats', beats(fullSegs), r => r.length === 3);
test('full script: 5 speakers (JASON 3x, CARI 2x)', speakers(fullSegs), r => r.length === 5);
test('full script: no b-roll in text', texts(fullSegs), r => !r.some(s => /b-roll/i.test(s.content)));
test('full script: has spoken content', texts(fullSegs), r => r.length >= 6);

// 16. Dividers dropped
test('dividers dropped', processScript(DIVIDERS).filter(s => s.type !== 'break'), r => r.every(s => s.type === 'text'));

// 17. Star lines dropped
test('star lines dropped', texts(processScript(STAR_LINES)), r => r.length === 2);

// 18. Bracket general dropped
test('bracket general dropped', texts(processScript(BRACKET_GENERAL)), r => r.length === 2);

// 19. INSERT inline stripped
test('insert inline stripped', texts(processScript(INSERT_INLINE)), r => r[0].content === 'Here is text with embedded.');

// 20. Long script
test('long script 20 lines', texts(processScript(LONG_SCRIPT)), r => r.length === 20);

// ═════════════════ RESULTS ══════════════════════════════════════
console.log(`\n${pass + fail} tests  |  ${pass} passed  |  ${fail} failed`);
if (fail === 0) console.log('ALL PASS ✅');
