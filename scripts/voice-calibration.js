/**
 * voice-calibration.js
 *
 * One-time voice calibration pass across all 190 transcripts.
 * Uses Claude Opus for maximum analysis quality.
 *
 * What it does:
 *   1. Loads all transcripts from kre8r-land/data/transcripts.json
 *   2. Batches them 10 at a time through Opus (19 batches)
 *   3. Extracts voice patterns from each batch
 *   4. Runs a final synthesis call to build the master voice profile
 *   5. Saves result to data/voice-calibration.json
 *   6. Stores result in kv_store as 'voice_calibration' so WritΩr can use it
 *
 * Usage:
 *   node scripts/voice-calibration.js
 *   node scripts/voice-calibration.js --dry-run   (shows counts, no API calls)
 *   node scripts/voice-calibration.js --resume     (skips already-completed batches)
 *
 * Cost estimate: ~$8 on Opus. Progress is saved after each batch so you can
 * resume if interrupted without re-paying for completed batches.
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const TRANSCRIPTS_PATH = path.join(__dirname, '..', '..', 'kre8r-land', 'data', 'transcripts.json');
const PROGRESS_PATH    = path.join(__dirname, '..', 'data', 'voice-cal-progress.json');
const OUTPUT_PATH      = path.join(__dirname, '..', 'data', 'voice-calibration.json');
const BATCH_SIZE       = 10;
const MODEL            = process.env.OPUS_MODEL || 'claude-opus-4-5';
const API_KEY          = process.env.ANTHROPIC_API_KEY;

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME  = process.argv.includes('--resume');

// ── Pricing estimate (Opus) ───────────────────────────────────────────────────
const INPUT_COST_PER_M  = 15.00;  // $ per 1M input tokens
const OUTPUT_COST_PER_M = 75.00;  // $ per 1M output tokens
let totalInputTokens  = 0;
let totalOutputTokens = 0;

function estimatedCost() {
  return (
    (totalInputTokens  / 1_000_000) * INPUT_COST_PER_M +
    (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_M
  ).toFixed(4);
}

// ── Claude caller ─────────────────────────────────────────────────────────────
async function callOpus(systemPrompt, userPrompt, maxTokens = 4000) {
  const { default: fetch } = await import('node-fetch');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }
  const data = await response.json();
  totalInputTokens  += data.usage?.input_tokens  || 0;
  totalOutputTokens += data.usage?.output_tokens || 0;
  return data.content[0].text.trim();
}

// ── Batch extraction prompt ───────────────────────────────────────────────────
const BATCH_SYSTEM = `You are analyzing video transcripts from Jason Rutland — creator of 7 Kin Homestead, a homesteading and off-grid living channel with 725k TikTok followers. These are raw auto-captions from real unscripted videos.

Your job: extract the patterns that make Jason sound like Jason. Not descriptions — actual evidence from the text.

Be ruthlessly specific. Quote actual sentences. Name actual patterns. This analysis will be used to train an AI writing assistant to write in Jason's voice.`;

function batchPrompt(transcripts) {
  const formatted = transcripts.map((t, i) =>
    `--- VIDEO ${i + 1}: "${t.title}" ---\n${t.transcript}`
  ).join('\n\n');

  return `Analyze these ${transcripts.length} video transcripts from Jason Rutland and extract his voice patterns.

${formatted}

---

Extract and return a JSON object with these exact fields:

{
  "signature_phrases": [
    // 8-12 phrases Jason actually uses — quoted verbatim from the transcripts.
    // Not paraphrases. Actual words he said.
  ],
  "opening_patterns": [
    // 3-5 observations about how Jason starts videos/topics.
    // Include actual opening lines as examples.
    // Note: he NEVER says "In this video I will..." — what does he do instead?
  ],
  "humor_mechanics": [
    // 3-5 specific examples of Jason being funny, with the actual quote and
    // a one-line explanation of WHY it works (specificity? absurdity? self-deprecation?)
  ],
  "number_and_data_style": [
    // 3-5 examples of how Jason uses numbers/facts.
    // He always makes them personal and specific. Show examples.
  ],
  "sentence_patterns": [
    // 3-5 observations about sentence structure — length, rhythm, interruptions.
    // Include verbatim examples of his most characteristic sentence constructions.
  ],
  "vocabulary_fingerprint": [
    // 8-12 words or expressions that are distinctly Jason —
    // big vocabulary words he uses naturally, his own coinages, recurring expressions.
    // Quote the context sentence for each.
  ],
  "tangent_and_correction_patterns": [
    // 3-5 examples where Jason goes off on a tangent or self-corrects mid-sentence.
    // These are gold — they're what makes him sound real, not scripted.
  ],
  "direct_address_patterns": [
    // 3-5 examples of how Jason talks directly TO the viewer.
    // Not "you" generically — specific Jason-isms.
  ],
  "quintessential_sentences": [
    // 8-10 verbatim sentences from these transcripts that are the most Jason.
    // Sentences that could ONLY have come from him. Use these as writing examples.
  ]
}

Return ONLY valid JSON. No preamble, no explanation, no markdown fences.`;
}

// ── Synthesis prompt ──────────────────────────────────────────────────────────
const SYNTHESIS_SYSTEM = `You are building the definitive voice profile for Jason Rutland — creator of 7 Kin Homestead. You have detailed voice analysis from all 190 of his long-form videos. This profile will be injected into an AI writing assistant to ensure everything written for Jason sounds authentically like him.

Your output will be used directly in AI prompts. Make it precise, actionable, and example-rich.`;

function synthesisPrompt(batchResults) {
  const allResults = batchResults.map((r, i) =>
    `=== BATCH ${i + 1} ANALYSIS ===\n${JSON.stringify(r, null, 2)}`
  ).join('\n\n');

  return `You have analyzed all 190 of Jason Rutland's long-form video transcripts in ${batchResults.length} batches. Here are all the batch analyses:

${allResults}

---

Now synthesize everything into a master voice calibration profile. Return a JSON object:

{
  "voice_summary": "A 3-4 sentence description of Jason's voice that captures what makes him distinctive. Write it as if briefing a ghostwriter who has never heard him.",

  "signature_phrases": [
    // Top 20 phrases Jason actually says — sourced from real transcripts.
    // These are things a writer CAN use in his voice.
  ],

  "opening_playbook": [
    // 6-8 real opening lines from actual videos showing how Jason starts.
    // Pattern note after each one explaining the technique.
  ],

  "humor_playbook": [
    // 6-8 real examples of Jason being funny with the technique labeled.
    // e.g. { "quote": "...", "technique": "absurdist specificity" }
  ],

  "sentence_rhythm": "A description of Jason's sentence length and rhythm patterns. Does he write long or short? Does he vary? When does he go long?",

  "vocabulary_level": "Description of his vocabulary usage — he has a large vocabulary but uses it naturally. Examples of big words in context.",

  "the_tangent_move": "Description of how Jason uses tangents and self-corrections. These are his most authentic moments. Give 3 real examples.",

  "number_rules": "How Jason always handles numbers and data — never vague, always personal, always contextual. 3 examples.",

  "few_shot_examples": {
    "financial": [
      // 5 verbatim sentences from financial/money angle videos
    ],
    "system": [
      // 5 verbatim sentences from 'system is rigged' angle videos
    ],
    "howto": [
      // 5 verbatim sentences from how-to / practical videos
    ],
    "lifestyle": [
      // 5 verbatim sentences from day-in-the-life videos
    ],
    "general": [
      // 10 verbatim sentences that work across any content
    ]
  },

  "what_jason_never_does": [
    // 8-10 things that NEVER appear in his real speech.
    // Derived from the corpus — not generic AI slop warnings,
    // but things specifically absent from Jason's 190 videos.
  ],

  "cari_and_family_references": "How Jason references Cari and the kids — naturally, by name, with real moments. Never generic 'my family'.",

  "the_fence_post_rule": "One sentence that captures the overall vibe — the 'sharp-tongued neighbor talking over a fence' principle in Jason's own words if possible."
}

Return ONLY valid JSON. No preamble, no markdown fences.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  // Load transcripts
  if (!fs.existsSync(TRANSCRIPTS_PATH)) {
    console.error(`❌ Transcripts not found at: ${TRANSCRIPTS_PATH}`);
    process.exit(1);
  }
  const transcripts = JSON.parse(fs.readFileSync(TRANSCRIPTS_PATH, 'utf8'));
  console.log(`\n📼  Loaded ${transcripts.length} transcripts`);

  // Build batches
  const batches = [];
  for (let i = 0; i < transcripts.length; i += BATCH_SIZE) {
    batches.push(transcripts.slice(i, i + BATCH_SIZE));
  }
  console.log(`📦  ${batches.length} batches of ${BATCH_SIZE}`);
  console.log(`🤖  Model: ${MODEL}`);
  console.log(`💰  Estimated cost: ~$8 on Opus\n`);

  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no API calls made.');
    let words = 0;
    transcripts.forEach(t => { words += (t.transcript || '').split(' ').length; });
    console.log(`    Total words: ${words.toLocaleString()}`);
    console.log(`    Est tokens:  ${Math.round(words * 1.3).toLocaleString()}`);
    return;
  }

  // Load progress if resuming
  let progress = { completedBatches: [], batchResults: [] };
  if (RESUME && fs.existsSync(PROGRESS_PATH)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    console.log(`▶️   Resuming — ${progress.completedBatches.length}/${batches.length} batches already done\n`);
  }

  // Process batches
  for (let i = 0; i < batches.length; i++) {
    if (progress.completedBatches.includes(i)) {
      console.log(`✅  Batch ${i + 1}/${batches.length} — already done, skipping`);
      continue;
    }

    const batch = batches[i];
    const titles = batch.map(t => t.title).join(', ');
    process.stdout.write(`🔄  Batch ${i + 1}/${batches.length} (${batch.length} videos)… `);

    try {
      const raw    = await callOpus(BATCH_SYSTEM, batchPrompt(batch), 3000);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const result  = JSON.parse(cleaned);

      progress.batchResults.push(result);
      progress.completedBatches.push(i);
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
      console.log(`✓  (~$${estimatedCost()} so far)`);
    } catch (err) {
      console.log(`\n❌  Batch ${i + 1} failed: ${err.message}`);
      console.log(`    Partial progress saved. Re-run with --resume to continue.`);
      process.exit(1);
    }

    // Polite delay between calls
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  // Synthesis call
  console.log(`\n🧠  Running synthesis across all ${batches.length} batch analyses…`);
  let voiceProfile;
  try {
    const raw     = await callOpus(SYNTHESIS_SYSTEM, synthesisPrompt(progress.batchResults), 6000);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    voiceProfile  = JSON.parse(cleaned);
    console.log(`✅  Synthesis complete`);
  } catch (err) {
    console.error(`❌  Synthesis failed: ${err.message}`);
    console.error(`    Batch results saved at ${PROGRESS_PATH} — you can retry synthesis only`);
    process.exit(1);
  }

  // Add metadata
  voiceProfile._meta = {
    generated_at:      new Date().toISOString(),
    transcript_count:  transcripts.length,
    model:             MODEL,
    total_input_tokens:  totalInputTokens,
    total_output_tokens: totalOutputTokens,
    estimated_cost_usd:  parseFloat(estimatedCost()),
  };

  // Save output JSON
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(voiceProfile, null, 2));
  console.log(`\n💾  Saved to ${OUTPUT_PATH}`);

  // Store in kv_store
  try {
    const db = require('../src/db');
    db.setKv('voice_calibration', JSON.stringify(voiceProfile));
    console.log(`✅  Stored in kv_store as 'voice_calibration'`);
  } catch (err) {
    console.warn(`⚠️  Could not write to kv_store: ${err.message}`);
    console.warn(`    The JSON file at ${OUTPUT_PATH} is still usable.`);
  }

  // Clean up progress file
  if (fs.existsSync(PROGRESS_PATH)) fs.unlinkSync(PROGRESS_PATH);

  // Final summary
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  VOICE CALIBRATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Transcripts analyzed : ${transcripts.length}
  Model used           : ${MODEL}
  Input tokens         : ${totalInputTokens.toLocaleString()}
  Output tokens        : ${totalOutputTokens.toLocaleString()}
  Actual cost          : $${estimatedCost()}
  Output file          : data/voice-calibration.json
  kv_store key         : voice_calibration

  Next step: restart Electron — WritΩr will pick up
  the calibration automatically on next script generation.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
