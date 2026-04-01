'use strict';

const fs   = require('fs');
const path = require('path');

const PROJECTS_DIR   = path.join(__dirname, '..', '..', 'database', 'projects');
const PROFILE_PATH   = path.join(__dirname, '..', '..', 'creator-profile.json');

function readAllConfigs() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const configs = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR)) {
    const p = path.join(PROJECTS_DIR, dir, 'project-config.json');
    if (fs.existsSync(p)) {
      try { configs.push(JSON.parse(fs.readFileSync(p, 'utf8'))); }
      catch (_) {}
    }
  }
  return configs;
}

function topN(counts, n = 3) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ value: k, count: v }));
}

function minePatterns() {
  const configs = readAllConfigs();
  if (configs.length === 0) {
    return { ok: true, projects_analyzed: 0, patterns: null };
  }

  // Tally counts
  const structureCounts  = {};
  const contentCounts    = {};
  const paletteCounts    = {};
  const themeCounts      = {};
  const durationByType   = {};

  let totalCoverage = 0;
  let coverageCount = 0;

  const beatStrength = {}; // beat name → { covered, total }

  for (const cfg of configs) {
    if (cfg.story_structure) structureCounts[cfg.story_structure] = (structureCounts[cfg.story_structure] || 0) + 1;
    if (cfg.content_type)    contentCounts[cfg.content_type]      = (contentCounts[cfg.content_type]     || 0) + 1;
    if (cfg.emotional_palette) paletteCounts[cfg.emotional_palette] = (paletteCounts[cfg.emotional_palette] || 0) + 1;
    if (cfg.musical_theme)   themeCounts[cfg.musical_theme]       = (themeCounts[cfg.musical_theme]      || 0) + 1;

    if (cfg.estimated_duration_minutes && cfg.content_type) {
      if (!durationByType[cfg.content_type]) durationByType[cfg.content_type] = [];
      durationByType[cfg.content_type].push(cfg.estimated_duration_minutes);
    }

    if (cfg.beats && cfg.beats.length > 0) {
      const covered = cfg.beats.filter(b => b.covered).length;
      const total   = cfg.beats.length;
      totalCoverage += (covered / total) * 100;
      coverageCount++;

      for (const beat of cfg.beats) {
        if (!beatStrength[beat.name]) beatStrength[beat.name] = { covered: 0, total: 0 };
        beatStrength[beat.name].total++;
        if (beat.covered) beatStrength[beat.name].covered++;
      }
    }
  }

  // Compute beat analysis
  const strongBeats = [];
  const weakBeats   = [];
  for (const [name, { covered, total }] of Object.entries(beatStrength)) {
    const pct = (covered / total) * 100;
    if (pct >= 80) strongBeats.push(name);
    if (pct <= 40) weakBeats.push(name);
  }

  // Average duration by type
  const avgDurationByType = {};
  for (const [type, durations] of Object.entries(durationByType)) {
    avgDurationByType[type] = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }

  const patterns = {
    projects_analyzed:         configs.length,
    top_story_structures:      topN(structureCounts),
    top_content_types:         topN(contentCounts),
    top_emotional_palettes:    topN(paletteCounts, 5),
    top_musical_themes:        topN(themeCounts, 5),
    avg_beat_coverage_pct:     coverageCount > 0 ? Math.round(totalCoverage / coverageCount) : null,
    consistently_strong_beats: strongBeats,
    consistently_weak_beats:   weakBeats,
    avg_duration_by_type:      avgDurationByType
  };

  // Update creator-profile.json
  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    profile.storytelling_patterns = {
      ...patterns,
      last_mined: new Date().toISOString()
    };
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
  } catch (err) {
    console.warn('[config-miner] Could not update creator-profile.json:', err.message);
  }

  return { ok: true, projects_analyzed: configs.length, patterns };
}

module.exports = { minePatterns, readAllConfigs };
