/**
 * B-roll Bridge — src/editor/broll-bridge.js
 *
 * Surfaces b-roll suggestions from SelectsΩr output and imports
 * approved b-roll clips into the DaVinci 02_SELECTS timeline on
 * Video Track 2.
 *
 * Workflow:
 *   1. getBrollSuggestions(projectId)
 *      → Returns sections whose fire_suggestion mentions b-roll,
 *        plus a VaultΩr search for matching clips.
 *
 *   2. importBroll(projectId, assignments)
 *      → assignments: [{ section_id, footage_id }]
 *        Calls scripts/davinci/import-broll.py with the full
 *        assignment list and returns the Resolve result.
 */

'use strict';

const { spawn }  = require('child_process');
const path       = require('path');

const db = require('../db');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'davinci', 'import-broll.py');

// Python binary detection — reuse transcribe pattern
const PYTHON_CANDIDATES = process.env.PYTHON_PATH
  ? [process.env.PYTHON_PATH]
  : ['py', 'python3', 'python'];

let _pythonBin = null;

async function detectPython() {
  if (_pythonBin !== null) return _pythonBin || null;
  for (const bin of PYTHON_CANDIDATES) {
    const found = await new Promise(resolve => {
      const p = spawn(bin, ['--version'], { windowsHide: true, timeout: 5_000 });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    });
    if (found) { _pythonBin = bin; return bin; }
  }
  _pythonBin = '';
  return null;
}

// ─────────────────────────────────────────────
// KEYWORD PATTERNS THAT SIGNAL B-ROLL NEED
// ─────────────────────────────────────────────

const BROLL_KEYWORDS = [
  'b-roll', 'broll', 'b roll', 'cutaway', 'cut away',
  'overlay', 'insert shot', 'cover with', 'show the'
];

function isBrollSuggestion(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BROLL_KEYWORDS.some(kw => lower.includes(kw));
}

// ─────────────────────────────────────────────
// GET B-ROLL SUGGESTIONS
// Returns sections that need b-roll + VaultΩr clip candidates
// ─────────────────────────────────────────────

function getBrollSuggestions(projectId) {
  const sections = db.getSelectsByProject(projectId);

  const brollSections = sections
    .filter(s => isBrollSuggestion(s.fire_suggestion))
    .map(s => ({
      section_id:       s.id,
      section_index:    s.section_index,
      script_section:   s.script_section,
      fire_suggestion:  s.fire_suggestion,
      gold_nugget:      s.gold_nugget
    }));

  if (brollSections.length === 0) {
    return { sections: [], candidates: {} };
  }

  // Pull all b-roll footage for this project from VaultΩr
  const brollFootage = db.getAllFootage({ project_id: projectId })
    .filter(f => {
      const t = (f.shot_type || '').toLowerCase();
      return t.startsWith('b_roll') || t.startsWith('b-roll') || t === 'action';
    })
    .map(f => ({
      footage_id:  f.id,
      filename:    path.basename(f.organized_path || f.file_path || ''),
      file_path:   f.organized_path || f.file_path,
      shot_type:   f.shot_type,
      duration:    f.duration,
      description: f.description || f.notes || null,
      thumbnail:   f.thumbnail_path || null
    }));

  return {
    sections:   brollSections,
    candidates: brollFootage
  };
}

// ─────────────────────────────────────────────
// IMPORT B-ROLL INTO DAVINCI
// assignments: [{ section_id: number, footage_id: number }]
// ─────────────────────────────────────────────

async function importBroll(projectId, assignments, onProgress = null) {
  const project = db.getProject(projectId);
  if (!project) return { ok: false, error: `Project ${projectId} not found` };

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { ok: false, error: 'No assignments provided' };
  }

  const binary = await detectPython();
  if (!binary) {
    return { ok: false, error: `Python not found. Tried: ${PYTHON_CANDIDATES.join(', ')}` };
  }

  // Build section → footage_path map
  const sections    = db.getSelectsByProject(projectId);
  const sectionMap  = Object.fromEntries(sections.map(s => [s.id, s]));
  const allFootage  = db.getAllFootage({ project_id: projectId });
  const footageMap  = Object.fromEntries(allFootage.map(f => [f.id, f]));

  const resolvedAssignments = assignments.map(a => {
    const section = sectionMap[a.section_id];
    const footage = footageMap[a.footage_id];
    return {
      section_id:      a.section_id,
      section_index:   section?.section_index ?? 0,
      script_section:  section?.script_section || '',
      footage_id:      a.footage_id,
      file_path:       footage?.organized_path || footage?.file_path || null
    };
  }).filter(a => a.file_path);

  if (resolvedAssignments.length === 0) {
    return { ok: false, error: 'No valid file paths found for assigned footage' };
  }

  // Find DaVinci project name
  const davinciTimelines = db.getDavinciTimelines(projectId);
  const projectRecord    = davinciTimelines?.[0];
  const davinciName      = projectRecord?.resolve_project_name || project.title;

  onProgress?.({ stage: 'davinci_start', assignments: resolvedAssignments.length });

  return new Promise((resolve, reject) => {
    const args = [
      SCRIPT_PATH,
      '--project_id',       String(projectId),
      '--project_name',     davinciName,
      '--assignments_json', JSON.stringify(resolvedAssignments),
      '--fps',              String(project.fps || 24)
    ];

    const proc = spawn(binary, args, { windowsHide: true, timeout: 120_000 });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      const line = d.toString();
      stderr += line;
      if (line.trim()) {
        onProgress?.({ stage: 'davinci_log', line: line.trim() });
      }
    });

    proc.on('error', err => {
      resolve({ ok: false, error: `Failed to start Python: ${err.message}` });
    });

    proc.on('close', code => {
      if (code !== 0) {
        return resolve({ ok: false, error: `import-broll.py exited ${code}: ${stderr.slice(-400)}` });
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.ok) {
          db.updateProjectEditorState(projectId, 'broll_imported');
        }
        resolve(result);
      } catch (_) {
        resolve({ ok: false, error: `Parse failed. stdout: ${stdout.slice(0, 300)}` });
      }
    });
  });
}

module.exports = { getBrollSuggestions, importBroll };
