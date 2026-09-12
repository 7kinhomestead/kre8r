// kre8r-vault MCP — local footage brain for LM Studio / any MCP client.
// Two sources, deliberately:
//   1. THE CORPUS (source of truth for Season 2, per the S2 Corpus Law):
//      H:\edit-staging\S2RAW\corpus-index.js — ears (whisper) + eyes (VLM) for every clip.
//      Read straight off disk. No server needed. Works even if Kre8Ωr is down.
//   2. VaultΩr (Kre8Ωr's footage DB) over http://localhost:3000 with INTERNAL_API_KEY —
//      shot types, proxies, project assignment. Needs the server running.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, statSync } from "node:fs";

const KRE8R_URL = process.env.KRE8R_URL || "http://localhost:3000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";
const CORPUS_PATH = process.env.CORPUS_PATH || "H:\\edit-staging\\S2RAW\\corpus-index.js";

function getHeaders() {
  const h = { "Content-Type": "application/json" };
  if (INTERNAL_KEY) h["x-internal-key"] = INTERNAL_KEY;
  return h;
}

let corpus = null, corpusMtime = 0;
function loadCorpus() {
  const m = statSync(CORPUS_PATH).mtimeMs;
  if (corpus && m === corpusMtime) return corpus;
  const raw = readFileSync(CORPUS_PATH, "utf8");
  // index file shape: window.CORPUS=[...];\nwindow.CORPUS_BUILT="...";
  const start = raw.indexOf("[");
  const tail = raw.indexOf(";\nwindow.CORPUS_BUILT", start);
  const json = raw.slice(start, tail > 0 ? tail : raw.lastIndexOf("]") + 1);
  corpus = JSON.parse(json); corpusMtime = m;
  return corpus;
}
const tc = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const clipDate = n => { const m = n.match(/(20[2-3]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; };

function searchCorpus(query, { limit = 12, source = "both", after = "", before = "" } = {}) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const c of loadCorpus()) {
    const d = clipDate(c.n);
    if (after && d && d < after) continue;
    if (before && d && d > before) continue;
    const segs = [];
    if (source !== "eyes") for (const [t, txt] of (c.e || [])) segs.push(["ears", t, txt]);
    if (source !== "ears") for (const [t, txt] of (c.v || [])) segs.push(["eyes", t, txt]);
    const matched = segs.filter(([, , txt]) => { const l = String(txt).toLowerCase(); return terms.every(w => l.includes(w)); });
    if (!matched.length) continue;
    hits.push({ clip: c.n, path: c.p, date: d, score: matched.length,
      hits: matched.slice(0, 6).map(([k, t, txt]) => `[${tc(t)}] (${k}) ${String(txt).slice(0, 160)}`) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

const server = new Server({ name: "kre8r-vault", version: "1.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "search_corpus",
      description: "Search the Season 2 footage corpus (source of truth): whisper transcripts (ears) and visual descriptions (eyes) for every clip, with timecodes and absolute file paths. Use this FIRST for 'find the clip where...'. Works offline.",
      inputSchema: { type: "object", properties: {
        query: { type: "string", description: "Words that must all appear in a segment (case-insensitive)." },
        limit: { type: "number", description: "Max clips (default 12)" },
        source: { type: "string", enum: ["both", "ears", "eyes"], description: "Search speech, visuals, or both (default both)" },
        after: { type: "string", description: "Only clips dated on/after YYYY-MM-DD (from filename)" },
        before: { type: "string", description: "Only clips dated on/before YYYY-MM-DD" } },
        required: ["query"] } },
    { name: "get_clip",
      description: "Full ears+eyes timeline for one clip by name (e.g. VID20260718165056 or A013_06020955_C031).",
      inputSchema: { type: "object", properties: { clip: { type: "string" } }, required: ["clip"] } },
    { name: "corpus_stats",
      description: "How many clips the corpus holds, newest/oldest dates, index file age.",
      inputSchema: { type: "object", properties: {} } },
    { name: "search_vault",
      description: "Search Kre8Ωr's VaultΩr DB (shot types, proxies, project assignment). Needs the Kre8Ωr server running on localhost:3000.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", description: "default 10" } }, required: ["query"] } },
    { name: "get_recent_footage",
      description: "Recently ingested VaultΩr items.",
      inputSchema: { type: "object", properties: { limit: { type: "number" }, shot_type: { type: "string" } } } }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const text = o => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
  try {
    if (name === "search_corpus") return text(searchCorpus(args.query, args));
    if (name === "get_clip") {
      const c = loadCorpus().find(x => x.n === args.clip || x.n.startsWith(args.clip));
      if (!c) return text(`No clip named ${args.clip}`);
      const lines = [`${c.n}  ${c.p}  (${clipDate(c.n) || "undated"})`];
      for (const [t, s] of (c.e || [])) lines.push(`[${tc(t)}] ${s}`);
      lines.push("--- eyes ---");
      for (const [t, s] of (c.v || [])) lines.push(`[${tc(t)}] ${s}`);
      return text(lines.join("\n"));
    }
    if (name === "corpus_stats") {
      const cs = loadCorpus(); const dates = cs.map(c => clipDate(c.n)).filter(Boolean).sort();
      return text({ clips: cs.length, oldest: dates[0], newest: dates[dates.length - 1], index_file: CORPUS_PATH, index_updated: new Date(corpusMtime).toISOString() });
    }
    if (name === "search_vault") {
      const res = await fetch(`${KRE8R_URL}/api/vault/search`, { method: "POST", headers: getHeaders(), body: JSON.stringify({ q: args.query }) });
      if (!res.ok) throw new Error(`Vault returned HTTP ${res.status}`);
      const data = await res.json(); const results = Array.isArray(data) ? data : (data.footage || data.results || []);
      return text(results.slice(0, args.limit || 10).map(f => ({ id: f.id, filename: f.original_filename || f.filename, file_path: f.file_path || f.proxy_path || f.organized_path, shot_type: f.shot_type, tags: f.tags, duration: f.duration })));
    }
    if (name === "get_recent_footage") {
      const url = new URL(`${KRE8R_URL}/api/vault/footage`);
      if (args.limit) url.searchParams.set("limit", String(args.limit));
      if (args.shot_type) url.searchParams.set("shot_type", args.shot_type);
      const res = await fetch(url.toString(), { headers: getHeaders() });
      if (!res.ok) throw new Error(`Vault returned HTTP ${res.status}`);
      const data = await res.json(); const results = Array.isArray(data) ? data : (data.footage || []);
      return text(results.slice(0, args.limit || 15).map(f => ({ id: f.id, filename: f.original_filename, file_path: f.file_path || f.proxy_path, shot_type: f.shot_type, duration: f.duration })));
    }
    throw new Error(`Tool not found: ${name}`);
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `kre8r-vault error: ${err.message}` }] };
  }
});

await server.connect(new StdioServerTransport());
