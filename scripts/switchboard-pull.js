#!/usr/bin/env node
// THE SWITCHBOARD puller (Builder B). Runs on Jason's PC, hourly.
// Pulls the recent videos from Facebook (Graph, PostΩr Page token, read-only),
// YouTube (public RSS, no key; channel page fallback) and TikTok (public
// creator embed page + manual oEmbed seeds, fail-soft),
// makes 96 px webp thumbnails, guesses a destination per post from
// switchboard-rules.json, and POSTs the list to the house:
//   POST <HOUSE_URL>/api/bridge/switchboard  (x-internal-key)
//
// Flags:
//   --dry-run   write the body to scripts/switchboard/last-push.json, do not send
//   --local     send to http://localhost:3001 (a dev house)
//   --check     no pull; exit 1 + one line if the newest cached post is older than 48 h
//               (or a platform has not had a good pull in 48 h)
//
// Laws: the Facebook token and the internal key are NEVER printed or written
// anywhere; they live in memory only and go out in the request alone.

'use strict';

const _emit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String((w && w.message) || w).includes('SQLite is an experimental feature')) return;
  return _emit.call(process, w, ...rest);
};

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DIR = path.join(__dirname, 'switchboard');
const THUMBS = path.join(DIR, 'thumbs');
const CACHE = path.join(DIR, 'cache.json');
const LAST_PUSH = path.join(DIR, 'last-push.json');
const RULES_FILE = path.join(__dirname, 'switchboard-rules.json');
const MANUAL_FILE = path.join(DIR, 'manual-posts.json');
const ENV_FILE = path.join(REPO, '.env');

const GRAPH = 'https://graph.facebook.com/v21.0';
const YT_CHANNEL = 'UCFiYtvJimJzFZLH6rzNkc5Q';
const YT_RSS = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`;
const TT_HANDLE = '7kinhomestead';
const TT_EMBED = `https://www.tiktok.com/embed/@${TT_HANDLE}`;
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const KEEP_PER_PLATFORM = 10;
const MAX_AGE_MS = 60 * 24 * 3600 * 1000;
const STALE_MS = 48 * 3600 * 1000;
const THUMB_MAX_BYTES = 8 * 1024;
const PLATFORMS = ['facebook', 'youtube', 'tiktok'];

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const LOCAL = args.has('--local');
const CHECK = args.has('--check');

// Secrets seen this run, scrubbed from anything we print.
const SECRETS = [];
function redact(s) {
  let out = String(s == null ? '' : s);
  for (const x of SECRETS) if (x) out = out.split(x).join('[redacted]');
  return out.replace(/access_token=[^&\s"']+/gi, 'access_token=[redacted]');
}
function errLine(e) { return redact((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 160); }

// ── small file helpers ───────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeAtomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function emptyCache() {
  const c = { updated_at: null, platforms: {} };
  for (const p of PLATFORMS) c.platforms[p] = { fetched_at: null, posts: [] };
  return c;
}
function loadCache() {
  const c = readJson(CACHE, null);
  if (!c || typeof c !== 'object' || !c.platforms) return emptyCache();
  for (const p of PLATFORMS) if (!c.platforms[p]) c.platforms[p] = { fetched_at: null, posts: [] };
  return c;
}

// ── --check ──────────────────────────────────────────────────────────────────
function runCheck() {
  const c = loadCache();
  const now = Date.now();
  let newest = 0;
  const staleFetch = [];
  for (const post of Object.values(c.manual || {})) newest = Math.max(newest, Date.parse(post.posted_at) || 0);
  for (const p of PLATFORMS) {
    const pc = c.platforms[p];
    for (const post of pc.posts || []) newest = Math.max(newest, Date.parse(post.posted_at) || 0);
    // a good manual (oEmbed) read counts as a good TikTok pull
    const f = Math.max(Date.parse(pc.fetched_at) || 0, Date.parse(pc.manual_fetched_at) || 0);
    if (!f || now - f > STALE_MS) staleFetch.push(p);
  }
  const hrs = (ms) => Math.round(ms / 3600000);
  if (!newest) { console.log('switchboard check: STALE, the cache has no posts'); process.exit(1); }
  if (now - newest > STALE_MS) {
    console.log(`switchboard check: STALE, newest post is ${hrs(now - newest)} h old`);
    process.exit(1);
  }
  if (staleFetch.length) {
    console.log(`switchboard check: STALE, no good pull in 48 h for ${staleFetch.join(', ')}`);
    process.exit(1);
  }
  console.log(`switchboard check: ok, newest post ${hrs(now - newest)} h old`);
}

// ── fetch helpers ────────────────────────────────────────────────────────────
async function getText(url, headers = {}, timeoutMs = 20000) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return body;
}
async function getBuffer(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
function isoOrNull(v) {
  const t = typeof v === 'number' ? v * 1000 : Date.parse(v);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

// ── Facebook ─────────────────────────────────────────────────────────────────
function readFacebookConnection() {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(process.env.APPDATA || '', 'kre8r', 'kre8r.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT access_token, account_id FROM platform_connections WHERE platform = 'facebook'`).get();
    if (!row || !row.access_token || !row.account_id) throw new Error('no facebook row in platform_connections');
    SECRETS.push(row.access_token);
    return row;
  } finally { db.close(); }
}
async function pullFacebook() {
  const conn = readFacebookConnection();
  const fields = 'id,description,created_time,permalink_url,picture';
  const byId = new Map();
  const problems = [];
  for (const edge of ['videos', 'video_reels']) {
    try {
      const url = `${GRAPH}/${encodeURIComponent(conn.account_id)}/${edge}?fields=${fields}&limit=${KEEP_PER_PLATFORM}&access_token=${encodeURIComponent(conn.access_token)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'graph error');
      for (const v of j.data || []) {
        if (!v.id || byId.has(String(v.id))) continue;
        let link = v.permalink_url || `https://www.facebook.com/${v.id}`;
        if (link.startsWith('/')) link = 'https://www.facebook.com' + link;
        byId.set(String(v.id), {
          platform: 'facebook', id: String(v.id), url: link,
          posted_at: isoOrNull(v.created_time), caption: v.description || '',
          hashtags: [], thumb_src: v.picture || null,
        });
      }
    } catch (e) { problems.push(`${edge}: ${errLine(e)}`); }
  }
  if (!byId.size) throw new Error(problems.join('; ') || 'no videos returned');
  if (problems.length) console.log(`switchboard: facebook partial (${problems.join('; ')})`);
  return [...byId.values()];
}

// ── YouTube ──────────────────────────────────────────────────────────────────
function xmlDecode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? xmlDecode(m[1]).trim() : '';
}
function ytFromRss(xml) {
  const entries = xml.split('<entry>').slice(1).map(s => s.split('</entry>')[0]);
  if (!entries.length) throw new Error('no entries in the RSS feed');
  return entries.map(e => {
    const id = tag(e, 'yt:videoId');
    const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1];
    return {
      platform: 'youtube', id, url: link ? xmlDecode(link) : `https://www.youtube.com/watch?v=${id}`,
      posted_at: isoOrNull(tag(e, 'published')), caption: tag(e, 'title'), hashtags: [],
      // mqdefault is 16:9 with no letterbox bars (hqdefault, the feed's media:thumbnail, has bars)
      thumb_src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    };
  }).filter(p => p.id);
}
// Fallback when the RSS feed is down (it 404s for every channel at times):
// the public /videos tab (newest first, no key), then each NEW video's watch
// page once for its exact publish date. Dates already in the cache are reused.
async function ytFromChannelPage(cached) {
  const html = await getText(`https://www.youtube.com/channel/${YT_CHANNEL}/videos`, { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' });
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('no ytInitialData on the channel page');
  const data = JSON.parse(m[1]);
  const vids = [];
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object' || vids.length >= KEEP_PER_PLATFORM) return;
    const l = o.lockupViewModel;
    if (l && l.contentId && !seen.has(l.contentId) && (!l.contentType || /VIDEO/.test(l.contentType))) {
      seen.add(l.contentId);
      const t = (((l.metadata || {}).lockupMetadataViewModel || {}).title || {}).content || '';
      vids.push({ id: l.contentId, title: t });
    }
    const v = o.videoRenderer;
    if (v && v.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      vids.push({ id: v.videoId, title: ((v.title || {}).runs || [{}])[0].text || '' });
    }
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
  })(data);
  if (!vids.length) throw new Error('no videos on the channel page');
  const known = new Map((cached || []).map(p => [p.id, p]));
  const out = [];
  for (const v of vids) {
    let posted = known.get(v.id) && known.get(v.id).posted_at;
    let title = v.title || (known.get(v.id) || {}).caption || '';
    if (!posted) {
      try {
        const w = await getText(`https://www.youtube.com/watch?v=${v.id}`, { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' });
        posted = isoOrNull((w.match(/"publishDate":"([^"]+)"/) || w.match(/itemprop="datePublished" content="([^"]+)"/) || [])[1]);
        if (!title) title = xmlDecode((w.match(/<meta name="title" content="([^"]*)"/) || [])[1] || '');
      } catch (_) { /* no date, the post is dropped by trim() */ }
    }
    out.push({
      platform: 'youtube', id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`,
      posted_at: posted || null, caption: xmlDecode(title), hashtags: [],
      thumb_src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    });
  }
  return out;
}
async function pullYouTube(cached) {
  try {
    return ytFromRss(await getText(YT_RSS, { 'User-Agent': DESKTOP_UA }));
  } catch (e) {
    const posts = await ytFromChannelPage(cached);
    console.log(`switchboard: youtube rss failed (${errLine(e)}), used the channel page`);
    return posts;
  }
}

// ── TikTok: the public creator embed page (fail-soft, one fetch per run) ─────
// https://www.tiktok.com/embed/@<handle> carries the recent videos in its
// __FRONTITY_CONNECT_STATE__ JSON (videoList: id, desc, coverUrl, ...), no key.
// The profile page no longer carries them (its itemList is empty), so it is
// not tried. The post date comes from the video id (see tiktokIdDate).
function scriptJson(html, id) {
  const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (_) { return null; }
}
function collectEmbedItems(root) {
  const found = new Map();
  const seen = new Set();
  const stack = [root];
  let steps = 0;
  while (stack.length && steps++ < 500000) {
    const o = stack.pop();
    if (!o || typeof o !== 'object' || seen.has(o)) continue;
    seen.add(o);
    if (/^\d{15,22}$/.test(String(o.id || '')) && typeof o.desc === 'string' &&
        (o.coverUrl || o.originCoverUrl || o.dynamicCoverUrl) && !o.privateItem &&
        (!o.authorUniqueId || String(o.authorUniqueId).toLowerCase() === TT_HANDLE) &&
        !found.has(String(o.id))) found.set(String(o.id), o);
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
  }
  return [...found.values()];
}
async function pullTikTok() {
  const html = await getText(TT_EMBED, {
    'User-Agent': DESKTOP_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }, 25000);
  const state = scriptJson(html, '__FRONTITY_CONNECT_STATE__');
  if (!state) throw new Error('no embedded state in the creator embed page');
  const items = collectEmbedItems(state);
  if (!items.length) throw new Error('creator embed page has no video items');
  return items.map(it => ({
    platform: 'tiktok', id: String(it.id),
    url: `https://www.tiktok.com/@${TT_HANDLE}/video/${it.id}`,
    posted_at: tiktokIdDate(String(it.id)), caption: it.desc || '', hashtags: [],
    thumb_src: it.coverUrl || it.originCoverUrl || it.dynamicCoverUrl || null,
  }));
}

// ── manual TikTok seeds (scripts/switchboard/manual-posts.json) via oEmbed ────
// Each entry: { url, label?, destination_url?, posted_at? }. oEmbed gives the
// title and a cover; the post date comes from posted_at or from the video id
// itself (a TikTok id's top 32 bits are its Unix upload time).
function tiktokIdDate(id) {
  try { return isoOrNull(Number(BigInt(id) >> 32n)); } catch (_) { return null; }
}
function readManualSeeds() {
  if (!fs.existsSync(MANUAL_FILE)) return [];
  const list = readJson(MANUAL_FILE, null);
  if (!Array.isArray(list)) { console.log('switchboard: manual-posts.json is not a JSON array, skipped'); return []; }
  return list.filter(e => e && typeof e.url === 'string');
}
async function pullManual(cache) {
  const seeds = readManualSeeds();
  const prev = cache.manual || {};
  const next = {};
  let fresh = 0;
  for (const e of seeds) {
    const id = (e.url.match(/tiktok\.com\/@[^/]+\/video\/(\d{15,22})/) || [])[1];
    if (!id) { console.log(`switchboard: manual seed skipped, not a TikTok video URL (${e.url.slice(0, 80)})`); continue; }
    const override = {};
    if (e.label) override.label = String(e.label);
    if (e.destination_url) override.url = String(e.destination_url);
    try {
      const j = JSON.parse(await getText(`https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@${TT_HANDLE}/video/${id}`)}`, { 'User-Agent': DESKTOP_UA }));
      if (!j || typeof j.title !== 'string') throw new Error('oEmbed gave no title');
      next[id] = {
        platform: 'tiktok', id, url: `https://www.tiktok.com/@${TT_HANDLE}/video/${id}`,
        posted_at: isoOrNull(e.posted_at) || tiktokIdDate(id), caption: j.title, hashtags: [],
        thumb_src: j.thumbnail_url || null, manual: true, override,
      };
      fresh++;
    } catch (err) {
      if (prev[id]) { next[id] = { ...prev[id], override, posted_at: isoOrNull(e.posted_at) || prev[id].posted_at }; }
      console.log(`switchboard: manual tiktok ${id} oEmbed failed (${errLine(err)}), ${prev[id] ? 'kept last cached copy' : 'no cached copy'}`);
    }
  }
  cache.manual = next;                      // seeds removed from the file drop out here
  if (fresh) cache.platforms.tiktok.manual_fetched_at = new Date().toISOString();
  return { posts: Object.values(next), fresh };
}
function labelForUrl(rules, url) {
  const r = (rules.rules || []).find(x => x.url === url);
  if (r) return r.label;
  if (url === rules.default.url) return rules.default.label;
  return null;
}
function urlForLabel(rules, label) {
  const r = (rules.rules || []).find(x => x.label === label && x.url !== 'youtube:episode');
  return r ? r.url : null;
}

// ── thumbnails: ffmpeg-static, 96x96 cover-scale + top crop, webp ≤ 8 KB ─────
const FFMPEG = (() => { try { return require('ffmpeg-static'); } catch (_) { return null; } })();
function thumbPath(p) { return path.join(THUMBS, `${p.platform}-${String(p.id).replace(/[^\w.-]/g, '_')}.webp`); }
function encodeThumb(input, out) {
  if (!FFMPEG) throw new Error('ffmpeg-static not found');
  const vf = 'scale=96:96:force_original_aspect_ratio=increase,crop=96:96:(iw-96)/2:0';
  for (const q of [72, 55, 40, 25]) {
    const tmp = out + '.tmp.webp';
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0',
      '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', tmp],
      { input, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw new Error('ffmpeg: ' + String(r.stderr || '').trim().split(/\r?\n/).pop());
    }
    if (fs.statSync(tmp).size <= THUMB_MAX_BYTES) { fs.renameSync(tmp, out); return; }
    fs.unlinkSync(tmp);
  }
  throw new Error('thumbnail stays over 8 KB');
}
async function ensureThumb(p) {
  const out = thumbPath(p);
  if (fs.existsSync(out)) return out;               // cached by platform+id: no re-download
  if (!p.thumb_src) return null;
  try {
    const buf = await getBuffer(p.thumb_src, { 'User-Agent': DESKTOP_UA });
    encodeThumb(buf, out);
    return out;
  } catch (e) {
    console.log(`switchboard: thumb failed ${p.platform}:${p.id} (${errLine(e)})`);
    return null;
  }
}

// ── rules ────────────────────────────────────────────────────────────────────
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function termMatches(term, text, hashtags, full) {
  const t = String(term).toLowerCase().trim();
  if (!t) return false;
  if (t.startsWith('link:')) return full.toLowerCase().includes(t.slice(5));
  if (t.startsWith('re:')) {
    try { return new RegExp(t.slice(3), 'i').test(text); } catch (_) { return false; }
  }
  const prefix = t.endsWith('*');
  const word = prefix ? t.slice(0, -1) : t;
  const re = new RegExp(`(^|[^a-z0-9])${esc(word).replace(/\s+/g, '\\s+')}${prefix ? '' : '(?![a-z0-9])'}`, 'i');
  if (re.test(text)) return true;
  const squashed = word.replace(/\s+/g, '');
  return squashed.length >= 5 && hashtags.some(h => h.includes(squashed));
}
function hashtagsOf(p) {
  const inline = (p.caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => h.slice(1).toLowerCase());
  return [...new Set(inline.concat(p.hashtags || []))];
}
// Which episode a clip points at, in order: (1) the caption quotes a YouTube
// title ("From our episode 'The Only Way to Become Self-Sufficient...'"),
// (2) the caption names an EP number a title also carries, (3) the YouTube
// video that was newest when the clip went up, (4) the channel's videos page.
function normWords(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function resolveEpisode(p, ytPosts, fallbackUrl) {
  const cap = ' ' + normWords(p.caption) + ' ';
  for (const y of ytPosts) {
    const key = normWords(y.caption.replace(/\|\s*rock rich\s*$/i, '')).split(' ').slice(0, 6).join(' ');
    if (key.length >= 15 && cap.includes(' ' + key + ' ')) return y.url;
  }
  const n = (p.caption.match(/\bep(?:isode)?\s?(\d+)/i) || [])[1];
  if (n) {
    const hit = ytPosts.find(y => new RegExp(`\\bep(?:isode)?\\s?0*${n}(?!\\d)`, 'i').test(y.caption));
    if (hit) return hit.url;
  }
  const t = Date.parse(p.posted_at) || Date.now();
  const then = ytPosts.find(y => (Date.parse(y.posted_at) || 0) <= t);   // ytPosts are newest first
  return then ? then.url : (ytPosts[0] ? ytPosts[0].url : fallbackUrl);
}
// The standing call-to-action footer ("Rock Rich is free... www.7kinhomestead.com")
// rides on every post, so lines matching rules.ignore_lines are not read for
// words (link: terms still see the whole caption).
function matchText(p, rules) {
  let re = null;
  try { re = rules.ignore_lines ? new RegExp(rules.ignore_lines, 'i') : null; } catch (_) {}
  const body = (p.caption || '').split(/\r?\n/).filter(l => !(re && re.test(l))).join('\n');
  return body + ' ' + (p.hashtags || []).map(h => '#' + h).join(' ');
}
function destinationFor(p, rules, ytPosts) {
  const text = matchText(p, rules);
  const full = p.caption || '';
  const tags = hashtagsOf(p);
  for (const r of rules.rules || []) {
    if (p.platform === 'youtube' && !r.tool) continue;
    if (!(r.match || []).some(t => termMatches(t, text, tags, full))) continue;
    const url = r.url === 'youtube:episode' ? resolveEpisode(p, ytPosts, rules.episode_fallback_url) : r.url;
    return { label: r.label, url, how: `rule:${r.name}` };
  }
  if (p.platform === 'youtube') return { label: (rules.youtube_self || {}).label || 'watch on YouTube', url: p.url, how: 'rule:self' };
  return { label: rules.default.label, url: rules.default.url, how: 'rule:default' };
}

// ── caption line: first non-empty line, hashtags dropped, ≤ 70 chars on a word ─
const PLATFORM_WORD = { facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' };
function captionLine(p) {
  const first = (p.caption || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
  // trailing hashtag runs go; a hashtag inside the sentence keeps its word, loses the #
  let line = first.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '').replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1$2').replace(/\s+/g, ' ').trim() || first;
  if (!line) return `A video on ${PLATFORM_WORD[p.platform]}`;
  if (line.length <= 70) return line;
  let cut = line.slice(0, 69);
  const sp = cut.lastIndexOf(' ');
  if (sp > 30) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.!?-]+$/, '') + '…';
}

// ── keep the last 10, drop older than 60 days ───────────────────────────────
function trim(posts) {
  const cutoff = Date.now() - MAX_AGE_MS;
  return posts
    .filter(p => p.posted_at && Date.parse(p.posted_at) >= cutoff)
    .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at))
    .slice(0, KEEP_PER_PLATFORM);
}

function readInternalKey() {
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  const m = txt.match(/^\s*INTERNAL_API_KEY\s*=\s*(.*)\s*$/m);
  if (!m) throw new Error('INTERNAL_API_KEY not in .env');
  const key = m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!key) throw new Error('INTERNAL_API_KEY is empty');
  SECRETS.push(key);
  return key;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (CHECK) return runCheck();
  fs.mkdirSync(THUMBS, { recursive: true });
  const rules = readJson(RULES_FILE, null);
  if (!rules || !Array.isArray(rules.rules) || !rules.default) throw new Error('switchboard-rules.json missing or malformed');

  const cache = loadCache();
  const nowIso = new Date().toISOString();
  const pullers = { facebook: pullFacebook, youtube: pullYouTube, tiktok: pullTikTok };
  const status = {};
  for (const p of PLATFORMS) {
    try {
      const fresh = trim(await pullers[p](cache.platforms[p].posts));
      cache.platforms[p] = { fetched_at: nowIso, posts: fresh };
      status[p] = p === 'tiktok' ? 'embed' : 'ok';
    } catch (e) {
      const kept = trim(cache.platforms[p].posts || []);
      cache.platforms[p].posts = kept;
      status[p] = 'kept-last-good';
      console.log(`switchboard: ${p} pull failed (${errLine(e)}), kept last good (${kept.length})`);
    }
  }

  // manual TikTok seeds: merged over the auto list (a manual copy wins on the same id)
  const manual = await pullManual(cache);
  const manualIds = new Set(manual.posts.map(m => m.id));
  const lists = {
    facebook: cache.platforms.facebook.posts,
    youtube: cache.platforms.youtube.posts,
    tiktok: trim(cache.platforms.tiktok.posts.filter(p => !manualIds.has(p.id)).concat(manual.posts)),
  };

  // thumbnails, then destinations
  const yt = lists.youtube;
  const posts = [];
  for (const p of PLATFORMS) {
    for (const post of lists[p]) {
      const file = await ensureThumb(post);
      post.thumb_file = file ? path.basename(file) : null;
      let destination = destinationFor(post, rules, yt);
      const o = post.override || {};
      if (o.label || o.url) {
        const url = o.url || urlForLabel(rules, o.label) || destination.url;
        destination = { label: o.label || labelForUrl(rules, url) || destination.label, url, how: 'manual' };
      }
      const row = {
        platform: post.platform, id: post.id, url: post.url, posted_at: post.posted_at,
        caption: post.caption, caption_line: captionLine(post), destination,
        thumb_b64: file ? fs.readFileSync(file).toString('base64') : null,
      };
      if (post.manual) row.manual = true;
      posts.push(row);
    }
  }

  // prune thumbs nobody references any more and older than 60 days
  const keep = new Set(posts.map(p => thumbPath(p)));
  for (const f of fs.readdirSync(THUMBS)) {
    const full = path.join(THUMBS, f);
    try { if (!keep.has(full) && Date.now() - fs.statSync(full).mtimeMs > MAX_AGE_MS) fs.unlinkSync(full); } catch (_) {}
  }

  cache.updated_at = nowIso;
  writeAtomic(CACHE, JSON.stringify(cache, null, 2));

  const body = { updated_at: nowIso, posts };
  const counts = `fb=${lists.facebook.length} yt=${lists.youtube.length} tt=${lists.tiktok.length} (tiktok: ${status.tiktok}, manual=${manual.posts.length})`;

  if (DRY) {
    writeAtomic(LAST_PUSH, JSON.stringify(body, null, 2));
    console.log(`switchboard: ${counts} dry-run`);
    return;
  }
  const house = (LOCAL ? 'http://localhost:3001' : (process.env.HOUSE_URL || 'https://www.7kinhomestead.com')).replace(/\/+$/, '');
  const key = readInternalKey();
  let res;
  try {
    res = await fetch(`${house}/api/bridge/switchboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.log(`switchboard: ${counts} push-failed (${errLine(e)})`);
    process.exitCode = 1; return;
  }
  if (!res.ok) {
    let why = '';
    try { const j = await res.json(); why = j && (j.error || j.message) ? `, ${String(j.error || j.message).slice(0, 80)}` : ''; } catch (_) {}
    console.log(`switchboard: ${counts} push-failed (HTTP ${res.status}${redact(why)})`);
    process.exitCode = 1; return;
  }
  console.log(`switchboard: ${counts} pushed`);
}

main().catch(e => { console.log(`switchboard: failed (${errLine(e)})`); process.exitCode = 1; });
