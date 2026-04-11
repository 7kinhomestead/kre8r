/**
 * rebrand-ui.js
 * Strips all "Claude" / "Anthropic" references from public/*.html
 * and replaces them with Kre8r-branded alternatives.
 * Run once: node scripts/rebrand-ui.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');

// [pattern, replacement] — specific first, general last
const replacements = [
  // ── Processing / loading states ──────────────────────────────────────────
  [/Claude is finding the gold\.\.\./g,                       'Finding the gold…'],
  [/Claude is writing \d+ emails[^<.]*/g,                     'Writing your emails…'],
  [/Claude is analyzing episodes\.\.\./g,                     'Analyzing episodes…'],
  [/Sending thumbnails to Claude…/g,                          'Analyzing thumbnails…'],
  [/Sending your content universe to Claude\.\.\./g,          'Analyzing your content…'],
  [/Sending your content library to Claude\.\.\./g,           'Analyzing your content library…'],
  [/Building voice profile with Claude\.\.\./g,               'Building your voice profile…'],
  [/Classifying with Claude Vision…/g,                        'Classifying…'],
  [/Asking Claude to identify scenes…/g,                      'Identifying scenes…'],
  [/Analyzing with Claude… \(10-20s\)/g,                      'Analyzing… (10–20s)'],
  [/Analyzing with Claude&hellip;\s*\(10-20s\)/g,             'Analyzing… (10–20s)'],
  [/Claude is reading the transcript and extracting season intelligence…/g,
                                                              'Reading transcript and extracting season intelligence…'],
  [/Claude is busy — retrying in /g,                          'Kre8r is busy — retrying in '],
  [/Claude is synthesizing everything/g,                      'Kre8r is synthesizing everything'],

  // ── Buttons ───────────────────────────────────────────────────────────────
  [/Analyze with Claude/g,                                    'Analyze'],

  // ── Feature descriptions ──────────────────────────────────────────────────
  [/Claude picks the winner from every retake/g,
   'Kre8r picks the winner from every retake'],

  [/Claude will transcribe every clip, map each segment to your beat map, and pick the best take from every retake/g,
   'Kre8r will transcribe every clip, map each segment to your beat map, and pick the best take from every retake'],

  [/Claude will analyze this video and surface/g,
   'Kre8r will analyze this video and surface'],

  [/Claude writes it, Playwright sends it/g,
   'Kre8r writes it, Playwright sends it'],

  [/Claude identifies scenes → writes Suno prompts → generates music/g,
   'Kre8r identifies scenes → writes Suno prompts → generates music'],

  [/AI film scoring\. Claude identifies scenes/g,
   'AI film scoring. Kre8r identifies scenes'],

  [/Claude will write your Suno prompts/g,
   'Kre8r will write your Suno prompts'],

  [/Claude knows where you are in the season arc/g,
   'Kre8r knows where you are in the season arc'],

  [/Claude has your full script and beat map loaded/g,
   'Kre8r has your full script and beat map loaded'],

  [/Claude will read your actual words and learn how you communicate/g,
   'Kre8r will read your actual words and learn how you communicate'],

  [/Your best work teaches Claude what to amplify/g,
   'Your best work teaches Kre8r what to amplify'],

  [/tells Claude everything\./g,
   'is all Kre8r needs.'],

  [/Claude will build a data-driven plan/g,   'Kre8r will build a data-driven plan'],
  [/have Claude build a data-driven plan/g,   'generate a data-driven plan'],

  [/Claude back-engineers a month-by-month trajectory/g,
   'Kre8r back-engineers a month-by-month trajectory'],

  [/[Ll]eave blank — Claude will infer realistic targets/g,
   'Leave blank — Kre8r will infer realistic targets'],

  [/shapes the angle Claude leads with/g,     'shapes the angle Kre8r leads with'],
  [/helps Claude match the tone/g,            'helps Kre8r match the tone'],
  [/helps Claude write specific emails/g,     'context for your emails'],
  [/Add context around what Claude found/g,   'Add context around what Kre8r found'],

  [/Claude will update the profile fields where it finds clear evidence/g,
   'Kre8r will update the profile fields where it finds clear evidence'],

  [/let Claude refine the format profile/g,   'let Kre8r refine the format profile'],
  [/Give Claude something real to analyze/g,  'Give Kre8r something real to analyze'],
  [/Add the video title so Claude has context/g, 'Add the video title for context'],

  [/Start a new show or generate the next episode\. Claude knows/g,
   'Start a new show or generate the next episode. Kre8r knows'],

  [/Tag all clips with searchable subjects using Claude Vision/g,
   'Tag all clips with searchable subjects'],

  [/Patterns and connections Claude found/g,  'Patterns and connections Kre8r found'],
  [/Claude read their voice/g,                'Kre8r read their voice'],

  [/Upload two thumbnails — Claude scores both and picks a winner/g,
   'Upload two thumbnails — Kre8r scores both and picks a winner'],

  [/Claude reads your last 10 videos and coaches you/g,
   'Kre8r reads your last 10 videos and coaches you'],

  [/Claude will read your actual words/g,     'Kre8r will read your actual words'],

  [/Scan a folder for video files and classify with Claude Vision/g,
   'Scan a folder for video files and classify with Kre8r'],

  [/classify with Claude Vision/g,            'classify with Kre8r'],

  // ── Possessives ───────────────────────────────────────────────────────────
  [/Claude&rsquo;s/g,                         'Kre8r&rsquo;s'],
  [/Claude's/g,                               "Kre8r's"],

  // ── JS log/status strings ─────────────────────────────────────────────────
  [/'Claude is finding the gold\.\.\.'/g,     "'Finding the gold…'"],
  [/`Claude: \$\{ev\.total_clips\}/g,         '`Found ${ev.total_clips}'],
  [/'Claude is busy/g,                        "'Kre8r is busy"],

  // ── Anthropic API key (index.html health check) ───────────────────────────
  [/Anthropic API key not set[^'"]*/g,        'Kre8r AI not configured'],
  [/anthropic_configured/g,                   'ai_configured'],

  // ── case 'claude_start' SSE event label ──────────────────────────────────
  [/case 'claude_start':\s*return '[^']*'/g,  "case 'claude_start': return 'Kre8r is working…'"],
];

const htmlFiles = fs.readdirSync(publicDir)
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(publicDir, f));

let filesChanged = 0;
let totalHits    = 0;

for (const file of htmlFiles) {
  let content  = fs.readFileSync(file, 'utf8');
  let original = content;
  let hits     = 0;

  for (const [pattern, replacement] of replacements) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) {
      const m = before.match(new RegExp(pattern.source, pattern.flags));
      hits += m ? m.length : 0;
    }
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`  ✓ ${path.basename(file).padEnd(35)} (${hits} replacement${hits !== 1 ? 's' : ''})`);
    filesChanged++;
    totalHits += hits;
  }
}

console.log(`\nDone. ${filesChanged} files updated, ${totalHits} replacements made.`);

// Verify — anything remaining?
console.log('\nResidual check (should be empty or backend-only):');
let residual = false;
for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (/\bClaude\b|\bAnthropic\b/i.test(line) && !/\/\/|<!--/.test(line.trim().slice(0,3))) {
      console.log(`  ${path.basename(file)}:${i+1}  ${line.trim().slice(0, 90)}`);
      residual = true;
    }
  });
}
if (!residual) console.log('  Clean — no residual references found.');
