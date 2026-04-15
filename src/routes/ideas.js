/**
 * SeedΩr — Idea Vault Routes
 * /api/ideas
 *
 * Every idea lives here before it becomes a project.
 * Raw seeds → Id8Ωr develops → PipΩr produces.
 */

'use strict';

const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const { callClaude, callClaudeMessages } = require('../utils/claude');

// GET /api/ideas — list all ideas (with optional ?status=&angle=&search=)
router.get('/', (req, res) => {
  try {
    const { status, angle, search } = req.query;
    const ideas = db.getAllIdeas({ status, angle, search });
    // Parse JSON fields
    const parsed = ideas.map(parseIdeaJson);
    res.json({ ideas: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ideas/:id — single idea
router.get('/:id', (req, res) => {
  try {
    const idea = db.getIdea(parseInt(req.params.id));
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    res.json({ idea: parseIdeaJson(idea) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ideas — create one idea
router.post('/', (req, res) => {
  try {
    const { title, concept, angle, hook, notes, source } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const id = db.createIdea({ title: title.trim(), concept, angle, hook, notes, source });
    const idea = db.getIdea(id);
    res.status(201).json({ idea: parseIdeaJson(idea) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ideas/:id — update fields
router.patch('/:id', (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const idea = db.getIdea(id);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    db.updateIdea(id, req.body);
    res.json({ idea: parseIdeaJson(db.getIdea(id)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ideas/:id
router.delete('/:id', (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const idea = db.getIdea(id);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    db.deleteIdea(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ideas/bulk — paste raw text, Claude parses into individual ideas
router.post('/bulk', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

    const profile = (() => {
      try { return require('../utils/profile-validator').loadProfile(); } catch { return {}; }
    })();

    const angles = (profile.content_angles || []).map(a => a.id || a).join(', ') ||
      'financial, system, rockrich, howto, mistakes, lifestyle, viral';

    const prompt = `You are parsing a creator's raw idea dump into structured idea cards.

The creator is: ${profile.creator_name || 'a solo creator'}.
Valid content angles: ${angles}

Here is the raw text dump of ideas:
<ideas>
${text.trim()}
</ideas>

Parse each distinct idea from the text. Each idea may be:
- A single line
- A sentence or two
- A paragraph
- A rough phrase

For each idea, extract:
- title: Short punchy title (max 10 words)
- concept: What the video/content is actually about (1-2 sentences)
- angle: Best matching angle from the valid angles list (pick one)
- hook: Opening hook or most interesting tension in the idea (1 sentence, optional)

Return ONLY valid JSON — an array of idea objects:
[
  { "title": "...", "concept": "...", "angle": "...", "hook": "..." },
  ...
]

Parse as many ideas as you can find. Minimum 1, no maximum.`;

    // Use callClaudeMessages to get raw text, then extract JSON array
    const rawText = await callClaudeMessages(
      'You are a data processor. Return only valid JSON, no commentary.',
      [{ role: 'user', content: prompt }],
      4096
    );
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.status(500).json({ error: 'Claude did not return a valid JSON array' });
    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(500).json({ error: 'Could not parse Claude response: ' + e.message }); }
    if (!Array.isArray(parsed) || !parsed.length) {
      return res.status(400).json({ error: 'No ideas could be parsed from that text' });
    }

    const ids   = db.bulkCreateIdeas(parsed);
    const ideas = ids.map(id => parseIdeaJson(db.getIdea(id)));
    res.status(201).json({ ok: true, count: ideas.length, ideas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ideas/constellation — Claude generates cluster assignments + connection graph
router.post('/constellation', async (req, res) => {
  try {
    const allIdeas = db.getAllIdeas();
    if (!allIdeas.length) return res.json({ nodes: [], clusters: [] });

    const ideaSummaries = allIdeas.map(i =>
      `ID:${i.id} | "${i.title}" | angle:${i.angle || 'unknown'} | status:${i.status} | concept:${(i.concept || '').slice(0, 120)}`
    ).join('\n');

    const prompt = `You are mapping a creator's idea universe for a 3D constellation visualization.

Here are all their ideas:
${ideaSummaries}

Your job:
1. Assign each idea to a semantic cluster (3-7 clusters total). Clusters should reflect thematic content groups, not just angles. Name each cluster memorably (2-4 words max, e.g. "Off-Grid Wins", "System Escape", "Rock Rich DNA").
2. Find meaningful connections between ideas — ideas that share a theme, tension, audience, or story thread.

Return ONLY valid JSON:
{
  "clusters": [
    { "id": "cluster-1", "name": "Cluster Name", "color": "#hex" }
  ],
  "nodes": [
    { "idea_id": 123, "cluster_id": "cluster-1", "connections": [{"idea_id": 456, "weight": 0.8, "reason": "shared tension"}] }
  ]
}

Color palette for clusters (assign one per cluster):
#3ecfb2 (teal), #f59e0b (amber), #e05252 (red), #4ade80 (green), #818cf8 (indigo), #fb923c (orange), #c084fc (purple)

Keep connections meaningful — not everything is connected to everything. Weight 0.5-1.0 only for strong resonance.`;

    // Use callClaudeMessages to get raw text — Claude often adds color commentary
    // around the JSON for this kind of creative task. Extract JSON with regex.
    const rawText = await callClaudeMessages(
      'You are a data processor. Return only valid JSON, no commentary.',
      [{ role: 'user', content: prompt }],
      8192
    );
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Claude did not return a valid JSON object' });
    let graph;
    try { graph = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(500).json({ error: 'Could not parse Claude response as JSON: ' + e.message }); }
    if (!graph) return res.status(500).json({ error: 'Claude did not return a valid constellation graph' });

    const ideaMap = Object.fromEntries(allIdeas.map(i => [i.id, i]));

    // Enrich nodes with idea data
    graph.nodes = (graph.nodes || []).map(n => {
      const idea = ideaMap[n.idea_id] || {};
      return {
        ...n,
        title:   idea.title   || '',
        angle:   idea.angle   || '',
        status:  idea.status  || 'raw',
        concept: (idea.concept || '').slice(0, 120),
        hook:    (idea.hook    || '').slice(0, 100),
      };
    });

    // Save cluster + connections back to DB (connections already a string from JSON)
    for (const node of graph.nodes) {
      const clusterObj = (graph.clusters || []).find(c => c.id === node.cluster_id);
      try {
        db.updateIdea(node.idea_id, {
          cluster:     clusterObj?.name || node.cluster_id,
          connections: Array.isArray(node.connections) ? JSON.stringify(node.connections) : '[]',
        });
      } catch (_) {}
    }

    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ideas/constellation/integrate — place new ideas into existing clusters
router.post('/constellation/integrate', async (req, res) => {
  try {
    const { existingClusters = [], mappedIds = [] } = req.body;
    const mappedSet = new Set(mappedIds.map(Number));
    const allIdeas  = db.getAllIdeas();
    const newIdeas  = allIdeas.filter(i => !mappedSet.has(i.id));
    if (!newIdeas.length) return res.json({ newClusters: [], newNodes: [] });

    const clusterList = existingClusters.map(c => `"${c.id}" = ${c.name}`).join(', ');
    const newSummaries = newIdeas.map(i =>
      `ID:${i.id} | "${i.title}" | angle:${i.angle || 'unknown'} | concept:${(i.concept || '').slice(0, 100)}`
    ).join('\n');
    const existingSummaries = allIdeas.filter(i => mappedSet.has(i.id)).map(i =>
      `ID:${i.id} | "${i.title}" | angle:${i.angle || 'unknown'}`
    ).join('\n');

    const prompt = `You are placing new ideas into an existing constellation map.

Existing clusters: ${clusterList || 'none yet'}

Existing mapped ideas (DO NOT change their clusters or connections):
${existingSummaries || 'none'}

New ideas to place:
${newSummaries}

For each new idea:
1. Assign it to the best existing cluster — OR create a new cluster if it genuinely doesn't fit any existing one.
2. Find meaningful connections to ANY idea (new or existing). Max 3 connections per new idea, weight 0.5-1.0.

New cluster colors to use if needed (pick unused ones):
#3ecfb2 (teal), #f59e0b (amber), #e05252 (red), #4ade80 (green), #818cf8 (indigo), #fb923c (orange), #c084fc (purple)

Return ONLY valid JSON:
{
  "newClusters": [
    { "id": "cluster-N", "name": "Cluster Name", "color": "#hex" }
  ],
  "newNodes": [
    { "idea_id": 123, "cluster_id": "cluster-1", "connections": [{"idea_id": 456, "weight": 0.8, "reason": "shared tension"}] }
  ]
}

newClusters is empty array if all new ideas fit existing clusters.`;

    const rawText = await callClaudeMessages(
      'You are a data processor. Return only valid JSON, no commentary.',
      [{ role: 'user', content: prompt }],
      4096
    );
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Claude did not return valid JSON' });
    let result;
    try { result = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(500).json({ error: 'Could not parse Claude response: ' + e.message }); }

    // Save cluster + connections to DB for new nodes
    for (const node of (result.newNodes || [])) {
      const clusterObj = [...existingClusters, ...(result.newClusters || [])].find(c => c.id === node.cluster_id);
      try {
        db.updateIdea(node.idea_id, {
          cluster:     clusterObj?.name || node.cluster_id,
          connections: Array.isArray(node.connections) ? JSON.stringify(node.connections) : '[]',
        });
      } catch (_) {}
    }

    // Enrich new nodes with idea data
    const ideaMap = Object.fromEntries(allIdeas.map(i => [i.id, i]));
    result.newNodes = (result.newNodes || []).map(n => {
      const idea = ideaMap[n.idea_id] || {};
      return { ...n, title: idea.title || '', angle: idea.angle || '', status: idea.status || 'raw', concept: (idea.concept || '').slice(0, 120) };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ideas/:id/promote — promote idea to a PipΩr project
router.post('/:id/promote', (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    const idea = db.getIdea(id);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    const brief = idea.brief_data ? JSON.parse(idea.brief_data) : {};

    // Create the project
    const projectId = db.createProject(
      idea.title,
      idea.concept || idea.title,
      null, null
    );

    // Store id8r_data on the project so PipΩr can pre-fill
    const id8rData = {
      chosenConcept: {
        headline: idea.title,
        angle:    idea.angle,
        why:      idea.concept,
        hook:     idea.hook,
      },
      briefData:      brief.briefData      || {},
      packageData:    brief.packageData    || {},
      researchSummary: brief.researchSummary || '',
      fromIdeaVault: true,
      ideaId: id,
    };

    db.updateProjectMeta(projectId, { id8r_data: JSON.stringify(id8rData) });

    // Mark idea as in_development and link to project
    db.updateIdea(id, { status: 'in_development', project_id: projectId });

    res.json({ ok: true, project_id: projectId, redirect: `/pipr.html?load_project=${projectId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

function parseIdeaJson(idea) {
  if (!idea) return idea;
  const out = { ...idea };
  try { if (typeof out.brief_data  === 'string') out.brief_data  = JSON.parse(out.brief_data);  } catch {}
  try { if (typeof out.connections === 'string') out.connections = JSON.parse(out.connections); } catch {}
  return out;
}

module.exports = router;
