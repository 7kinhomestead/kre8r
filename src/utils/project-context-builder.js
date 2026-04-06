// Builds the complete project context file at every pipeline stage
// Lives at: database/projects/{id}/vault/project-context.json

const { saveVaultData, getVaultData } = require('./project-vault');

function loadContext(projectId) {
  return getVaultData(projectId, 'project-context.json') || {};
}

function saveContext(projectId, updates) {
  const existing = loadContext(projectId);
  const merged = { ...existing, ...updates, last_updated: new Date().toISOString() };
  saveVaultData(projectId, 'project-context.json', merged);
  return merged;
}

function addId8rContext(projectId, { chosenConcept, researchSummary, packageData, briefData, collaborators }) {
  return saveContext(projectId, {
    stage: 'id8r_complete',
    concept: chosenConcept?.headline,
    why_it_works: chosenConcept?.why,
    hook: chosenConcept?.hook,
    research_summary: researchSummary,
    titles: packageData?.titles?.map(t => t.text || t),
    hooks: packageData?.hooks?.map(h => h.text || h),
    thumbnails: packageData?.thumbnails,
    elevator_pitch: briefData?.elevator_pitch,
    story_angle: briefData?.story_angle,
    talking_points: briefData?.talking_points,
    guardrails: briefData?.what_not_to_do,
    concept_note: briefData?.pipeline_brief?.concept_note,
    collaborators: collaborators || ['jason']
  });
}

function addPiprContext(projectId, { story_structure, beats, target_duration, setup_depth, entry_point }) {
  return saveContext(projectId, {
    stage: 'pipr_complete',
    story_structure,
    beats,
    target_duration,
    setup_depth,
    entry_point
  });
}

function addSoulContext(projectId, souls) {
  const soulProfiles = {};
  souls.forEach(soul => {
    const name = soul.creator?.name?.toLowerCase() || 'unknown';
    soulProfiles[name] = {
      voice_summary: soul.voice?.voice_summary,
      voice_in_3_words: soul.voice?.voice_in_3_words,
      writing_guidelines: soul.voice?.writing_guidelines,
      signature_phrases: soul.voice?.signature_phrases,
      what_not_to_write: soul.voice?.what_not_to_write,
      sentence_patterns: soul.voice?.sentence_patterns,
      humor_style: soul.voice?.humor_style,
      relationship_to_camera: soul.voice?.relationship_to_camera
    };
  });
  return saveContext(projectId, {
    stage: 'souls_loaded',
    soul_profiles: soulProfiles
  });
}

function buildWritrPromptContext(projectId) {
  const ctx = loadContext(projectId);
  if (!ctx.concept) return '';

  const lines = ['## CONTENT INTELLIGENCE FROM ID8ΩR RESEARCH'];

  if (ctx.concept)        lines.push(`Chosen Concept: ${ctx.concept}`);
  if (ctx.why_it_works)   lines.push(`Why this angle: ${ctx.why_it_works}`);
  if (ctx.hook)           lines.push(`Opening hook: ${ctx.hook}`);
  if (ctx.elevator_pitch) lines.push(`Elevator pitch: ${ctx.elevator_pitch}`);
  if (ctx.story_angle)    lines.push(`Story angle: ${ctx.story_angle}`);

  if (ctx.research_summary) {
    lines.push(`Research findings: ${ctx.research_summary.slice(0, 600)}`);
  }

  if (Array.isArray(ctx.titles) && ctx.titles.length) {
    lines.push(`Suggested titles:\n${ctx.titles.map(t => `- ${t}`).join('\n')}`);
  }

  if (Array.isArray(ctx.talking_points) && ctx.talking_points.length) {
    lines.push(`Talking points:\n${ctx.talking_points.map(p => `- ${p}`).join('\n')}`);
  }

  if (Array.isArray(ctx.guardrails) && ctx.guardrails.length) {
    lines.push(`What NOT to do:\n${ctx.guardrails.map(g => `- ${g}`).join('\n')}`);
  }

  if (ctx.concept_note) {
    lines.push(`Concept note: ${ctx.concept_note}`);
  }

  if (ctx.story_structure) {
    lines.push(`\nStory structure: ${ctx.story_structure}`);
  }

  if (ctx.setup_depth)   lines.push(`Setup depth: ${ctx.setup_depth}`);
  if (ctx.entry_point)   lines.push(`Entry point: ${ctx.entry_point}`);
  if (ctx.target_duration) lines.push(`Target duration: ${ctx.target_duration} minutes`);

  if (Array.isArray(ctx.beats) && ctx.beats.length) {
    lines.push(`\nBeat map:\n${ctx.beats.map(b => `- ${b.name}: ${b.description || ''}`).join('\n')}`);
  }

  // Soul profiles
  if (ctx.soul_profiles && Object.keys(ctx.soul_profiles).length) {
    lines.push('\n## CREATOR SOUL PROFILES');
    for (const [name, soul] of Object.entries(ctx.soul_profiles)) {
      lines.push(`\n### ${name.toUpperCase()}`);
      if (soul.voice_in_3_words)     lines.push(`Voice in 3 words: ${soul.voice_in_3_words}`);
      if (soul.humor_style)          lines.push(`Humor style: ${soul.humor_style}`);
      if (soul.relationship_to_camera) lines.push(`Relationship to camera: ${soul.relationship_to_camera}`);
      if (Array.isArray(soul.writing_guidelines) && soul.writing_guidelines.length) {
        lines.push(`Writing guidelines:\n${soul.writing_guidelines.map(g => `- ${g}`).join('\n')}`);
      }
      if (Array.isArray(soul.signature_phrases) && soul.signature_phrases.length) {
        lines.push(`Signature phrases: ${soul.signature_phrases.join(', ')}`);
      }
      if (Array.isArray(soul.what_not_to_write) && soul.what_not_to_write.length) {
        lines.push(`What NOT to write:\n${soul.what_not_to_write.map(w => `- ${w}`).join('\n')}`);
      }
      if (Array.isArray(soul.sentence_patterns) && soul.sentence_patterns.length) {
        lines.push(`Sentence patterns:\n${soul.sentence_patterns.slice(0, 3).map(p => `- ${p}`).join('\n')}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = { loadContext, saveContext, addId8rContext, addPiprContext, addSoulContext, buildWritrPromptContext };
