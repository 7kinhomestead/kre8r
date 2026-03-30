'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const PROJECTS_DIR = path.join(__dirname, '..', '..', 'database', 'projects');

function getConfigPath(projectId) {
  return path.join(PROJECTS_DIR, String(projectId), 'project-config.json');
}

function readConfig(projectId) {
  const p = getConfigPath(projectId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_) { return null; }
}

function writeConfig(projectId, config) {
  const dir = path.join(PROJECTS_DIR, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  config.updated_at = new Date().toISOString();
  fs.writeFileSync(getConfigPath(projectId), JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Map a section label to a beat using keyword matching + pct proximity.
 * Returns the best matching beat index (0-based into beats array) or -1.
 */
function matchSectionToBeat(sectionLabel, sectionPct, beats) {
  const label = (sectionLabel || '').toLowerCase();

  // 1. Keyword match against beat name and reality_note
  let bestKwIdx = -1;
  let bestKwScore = 0;
  beats.forEach((beat, i) => {
    const haystack = `${beat.name} ${beat.reality_note || ''} ${beat.emotional_function || ''}`.toLowerCase();
    const words = label.split(/\s+/).filter(w => w.length > 3);
    const score = words.filter(w => haystack.includes(w)).length;
    if (score > bestKwScore) { bestKwScore = score; bestKwIdx = i; }
  });

  if (bestKwScore >= 2) return bestKwIdx;

  // 2. Proximity to target_pct
  let bestPctIdx = 0;
  let bestPctDist = Infinity;
  beats.forEach((beat, i) => {
    const dist = Math.abs(beat.target_pct - sectionPct);
    if (dist < bestPctDist) { bestPctDist = dist; bestPctIdx = i; }
  });
  return bestPctIdx;
}

/**
 * Update beat coverage for a project based on current selects.
 * Returns { covered, missing, out_of_sequence, coverage_pct }
 */
function updateBeatCoverage(projectId) {
  const config = readConfig(projectId);
  if (!config || !config.beats || config.beats.length === 0) {
    return { ok: false, error: 'No project config or no beats defined' };
  }

  const sections = db.getSelectsByProject(projectId);
  if (!sections || sections.length === 0) {
    return {
      ok: true,
      covered: [],
      missing: config.beats.map(b => b.name),
      out_of_sequence: [],
      coverage_pct: 0
    };
  }

  const totalSections = sections.length;
  const beats = config.beats;

  // Reset coverage
  beats.forEach(b => {
    b.covered = false;
    b.coverage_footage_ids = [];
    b.out_of_sequence = false;
    b.needs_coverage = true;
  });

  // Map each section to a beat
  const beatAssignments = []; // [{ sectionIndex, beatArrayIdx }]

  sections.forEach((section, si) => {
    const sectionPct = (si / Math.max(totalSections - 1, 1)) * 100;
    const beatIdx = matchSectionToBeat(section.script_section, sectionPct, beats);
    if (beatIdx >= 0) {
      const beat = beats[beatIdx];
      beat.covered = true;
      beat.needs_coverage = false;
      if (section.winner_footage_id) {
        beat.coverage_footage_ids.push(section.winner_footage_id);
      }
      beatAssignments.push({ sectionIndex: si, beatArrayIdx: beatIdx });
    }
  });

  // Detect out-of-sequence beats
  // A beat is out of sequence if it appears earlier in the section list
  // than a beat with a lower index
  for (let i = 0; i < beatAssignments.length - 1; i++) {
    for (let j = i + 1; j < beatAssignments.length; j++) {
      if (beatAssignments[j].beatArrayIdx < beatAssignments[i].beatArrayIdx) {
        beats[beatAssignments[i].beatArrayIdx].out_of_sequence = true;
        break;
      }
    }
  }

  // Build report
  const covered        = beats.filter(b => b.covered).map(b => b.name);
  const missing        = beats.filter(b => !b.covered).map(b => b.name);
  const outOfSequence  = beats.filter(b => b.out_of_sequence).map(b => b.name);
  const coverage_pct   = beats.length > 0 ? Math.round((covered.length / beats.length) * 100) : 0;

  // Write updated config
  config.beats = beats;
  writeConfig(projectId, config);

  // Update DB
  try {
    db.updateProjectPipr(projectId, {
      pipr_complete: config.story_structure === 'free_form' ? 1 : (covered.length > 0 ? 1 : 0)
    });
  } catch (_) {}

  return {
    ok:              true,
    total_beats:     beats.length,
    covered,
    missing,
    out_of_sequence: outOfSequence,
    coverage_pct
  };
}

module.exports = { readConfig, writeConfig, getConfigPath, updateBeatCoverage };
