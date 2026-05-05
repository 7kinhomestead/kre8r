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
// TAG-BASED RELEVANCE SCORING
// Score a clip against a query string using its
// subjects array + description from Claude Vision.
// Returns 0–100. Clips with 0 are excluded.
// ─────────────────────────────────────────────

function scoreClip(clip, queryWords) {
  if (!queryWords.length) return 50; // no query = show everything
  let score = 0;

  const subjects = (() => {
    try { return JSON.parse(clip.subjects || '[]'); } catch { return []; }
  })();
  const desc = (clip.description || '').toLowerCase();
  const subjectText = subjects.join(' ').toLowerCase();
  const combined = `${subjectText} ${desc}`;

  for (const word of queryWords) {
    if (word.length < 3) continue;
    // Exact subject tag match = high value
    if (subjects.some(s => s.toLowerCase().includes(word))) score += 25;
    // Partial match in combined text
    else if (combined.includes(word)) score += 10;
  }

  return Math.min(score, 100);
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

// ─────────────────────────────────────────────
// GET B-ROLL SUGGESTIONS
// Returns ALL beat sections (not just fire_suggestion ones),
// with ranked VaultΩr candidates searched across the ENTIRE
// vault — not just the current project.
// ─────────────────────────────────────────────

function getBrollSuggestions(projectId, query = '') {
  const sections = db.getSelectsByProject(projectId);

  // Include every beat section — editor decides which ones need b-roll
  const brollSections = sections.map(s => ({
    section_id:       s.id,
    section_index:    s.section_index,
    script_section:   s.script_section,
    fire_suggestion:  s.fire_suggestion,
    gold_nugget:      s.gold_nugget,
    needs_broll:      isBrollSuggestion(s.fire_suggestion),
  }));

  // Pull ALL b-roll from the entire vault (cross-project)
  const allBroll = db.getAllFootage()
    .filter(f => {
      const t = (f.shot_type || '').toLowerCase();
      return t.startsWith('b_roll') || t.startsWith('b-roll') || t === 'action';
    });

  // Build query words — use caller's search term, or fall back to
  // aggregating keywords from the beat fire_suggestions for this project
  const queryText = query || sections
    .map(s => s.fire_suggestion || s.script_section || '')
    .join(' ');
  const queryWords = tokenize(queryText);

  // Score, filter zeros, sort by relevance then recency
  const candidates = allBroll
    .map(f => {
      const subjects = (() => {
        try { return JSON.parse(f.subjects || '[]'); } catch { return []; }
      })();
      const score = scoreClip(f, queryWords);
      return {
        footage_id:   f.id,
        project_id:   f.project_id,
        filename:     path.basename(f.proxy_path || f.organized_path || f.file_path || ''),
        file_path:    f.proxy_path || f.organized_path || f.file_path,
        shot_type:    f.shot_type,
        duration:     f.duration,
        description:  f.description || null,
        subjects,
        thumbnail:    f.thumbnail_path || null,
        score,
        same_project: f.project_id === parseInt(projectId),
      };
    })
    .filter(f => f.score > 0 || !query) // if no query, show all
    .sort((a, b) => {
      // Same-project clips float to top, then by score
      if (a.same_project !== b.same_project) return a.same_project ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, 60); // cap at 60 results

  return {
    sections:   brollSections,
    candidates,
    query,
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
  // getAllFootage() with NO project filter — b-roll assignments can come from
  // any project in the vault (cross-project vault search is by design).
  const sections    = db.getSelectsByProject(projectId);
  const sectionMap  = Object.fromEntries(sections.map(s => [s.id, s]));
  const allFootage  = db.getAllFootage();   // <-- entire vault, not just this project
  const footageMap  = Object.fromEntries(allFootage.map(f => [f.id, f]));

  const resolvedAssignments = assignments.map(a => {
    const section = sectionMap[a.section_id];
    const footage = footageMap[a.footage_id];
    // Prefer proxy (MP4) → organized → raw file_path
    const filePath = footage?.proxy_path || footage?.organized_path || footage?.file_path || null;
    return {
      section_id:      a.section_id,
      section_index:   section?.section_index ?? 0,
      script_section:  section?.script_section || '',
      footage_id:      a.footage_id,
      file_path:       filePath
    };
  }).filter(a => a.file_path);

  if (resolvedAssignments.length === 0) {
    return { ok: false, error: 'No valid file paths found for assigned footage' };
  }

  // Find DaVinci project name — read from projects table, not davinci_timelines
  // (davinci_timelines has no resolve_project_name column)
  const davinciName = project.davinci_project_name || project.title;

  onProgress?.({ stage: 'davinci_start', assignments: resolvedAssignments.length });

  return new Promise((resolve, reject) => {
    const args = [
      SCRIPT_PATH,
      '--project_id',       String(projectId),
      '--project_name',     davinciName,
      '--assignments_json', JSON.stringify(resolvedAssignments),
      '--fps',              String(project.fps || 24)  // projects table has no fps column — defaults to 24
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
