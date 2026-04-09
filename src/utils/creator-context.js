/**
 * Creator Context Utility — src/utils/creator-context.js
 *
 * Reads creator-profile.json and returns pre-built context strings and
 * field accessors for use in Claude prompts throughout the engine.
 *
 * NEVER hardcode creator-specific data in route files.
 * ALWAYS use getCreatorContext() instead.
 */

const fs   = require('fs');
const path = require('path');

// In Electron mode CREATOR_PROFILE_PATH env var points to AppData; otherwise repo root.
const PROFILE_PATH = process.env.CREATOR_PROFILE_PATH
  || path.join(__dirname, '../../creator-profile.json');

/**
 * Load and return the full creator profile object.
 * Fresh read each call so live edits to creator-profile.json are picked up
 * without a server restart (acceptable cost — only called at request time).
 */
function loadProfile() {
  return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
}

/**
 * Returns a structured context object with all creator-specific fields
 * needed for prompt construction. All values sourced from creator-profile.json.
 *
 * @returns {{
 *   brand: string,
 *   creatorName: string,
 *   partnerName: string | null,
 *   voiceSummary: string,
 *   communityName: string,
 *   communityTiers: string,         // preformatted tier list
 *   followerSummary: string,        // e.g. "725k TikTok, 54k YouTube, 80k Lemon8"
 *   youtubeHandle: string,          // without @ prefix, for YouTube API calls
 *   tiktokHandle: string,           // with @ prefix
 *   niche: string,                  // e.g. "homesteading and off-grid living"
 *   contentAnglesText: string,      // preformatted angle list for prompts
 *   profile: object                 // full raw profile for custom field access
 * }}
 */
function getCreatorContext() {
  const profile = loadProfile();

  const brand         = profile?.creator?.brand       || 'Unknown Brand';
  const creatorName   = profile?.creator?.name        || 'Creator';
  const partnerName   = profile?.creator?.partner     || null;
  const voiceSummary  = profile?.voice?.summary       || 'Straight-talking, warm, never corporate.';
  const communityName = profile?.community?.name      || 'Community';
  const niche         = profile?.creator?.niche       || 'content creation';
  const tagline       = profile?.creator?.tagline     || '';

  // Platform follower summary
  const platforms = profile?.platforms || {};
  const followerParts = [];
  if (platforms.tiktok?.followers)   followerParts.push(`${fmtFollowers(platforms.tiktok.followers)} TikTok`);
  if (platforms.youtube?.subscribers) followerParts.push(`${fmtFollowers(platforms.youtube.subscribers)} YouTube`);
  if (platforms.lemon8?.followers)   followerParts.push(`${fmtFollowers(platforms.lemon8.followers)} Lemon8`);
  const followerSummary = followerParts.join(', ');

  // Handles
  const tiktokHandle  = platforms.tiktok?.handle  || '';
  const youtubeHandle = (platforms.youtube?.handle || tiktokHandle || '').replace(/^@/, ''); // no @ for YouTube API

  // Community tiers
  const tiers = profile?.community?.tiers || {};
  const tierLines = [];
  if (tiers.greenhouse) tierLines.push(`- ${tiers.greenhouse.label} (${tiers.greenhouse.price}): ${tiers.greenhouse.description || ''}`);
  if (tiers.garden)     tierLines.push(`- ${tiers.garden.label} (${tiers.garden.price}): ${tiers.garden.description || ''}`);
  if (tiers.founding_50) tierLines.push(`- ${tiers.founding_50.label} (${tiers.founding_50.price}): ${tiers.founding_50.description || ''}`);
  const communityTiers = tierLines.join('\n');

  // Content angles
  const angles = profile?.content_angles || {};
  const contentAnglesText = Object.entries(angles)
    .map(([key, a]) => `- ${key}: ${a.description || a.label || key}`)
    .join('\n');

  return {
    brand,
    creatorName,
    partnerName,
    voiceSummary,
    communityName,
    communityTiers,
    followerSummary,
    tiktokHandle,
    youtubeHandle,
    niche,
    tagline,
    contentAnglesText,
    profile,
  };
}

/**
 * Returns a short one-line creator identity string for prompt headers.
 * e.g. "7 Kin Homestead — homesteading and off-grid living, 725k TikTok, 54k YouTube"
 */
function getCreatorOneLiner() {
  const { brand, niche, followerSummary } = getCreatorContext();
  return `${brand} — ${niche}, ${followerSummary}`;
}

/**
 * Returns a preformatted community tier block for email/caption prompts.
 * e.g. "ROCK RICH COMMUNITY TIERS:\n- The Greenhouse (Free): ..."
 */
function getCommunityBlock() {
  const { communityName, communityTiers } = getCreatorContext();
  return `${communityName} COMMUNITY TIERS:\n${communityTiers}`;
}

/**
 * Returns a voice context block for prompts.
 */
function getVoiceBlock() {
  const profile = loadProfile();
  const v       = profile?.voice;
  if (!v) return 'Straight-talking, warm, funny, never corporate.';
  const lines = [v.summary];
  if (v.traits?.length)  lines.push(`Traits: ${v.traits.join('. ')}`);
  if (v.never?.length)   lines.push(`Never: ${v.never.join(', ')}`);
  return lines.join('\n');
}

/**
 * Returns a structured social links object and a preformatted prompt block.
 * All URLs come from creator-profile.json — never hardcoded.
 *
 * plaintext: for YouTube descriptions and plain email CTAs
 * html: for blog posts — actual <a href> links
 */
function getSocialLinksBlock() {
  const profile   = loadProfile();
  const platforms = profile?.platforms || {};
  const community = profile?.community || {};

  const links = [];
  if (platforms.youtube?.url)   links.push({ label: 'YouTube',   url: platforms.youtube.url,   handle: platforms.youtube.channel || platforms.youtube.handle || '' });
  if (platforms.tiktok?.url)    links.push({ label: 'TikTok',    url: platforms.tiktok.url,    handle: platforms.tiktok.handle || '' });
  if (platforms.instagram?.url) links.push({ label: 'Instagram', url: platforms.instagram.url, handle: platforms.instagram.handle || '' });
  if (platforms.facebook?.url)  links.push({ label: 'Facebook',  url: platforms.facebook.url,  handle: platforms.facebook.page || '' });
  if (platforms.lemon8?.url)    links.push({ label: 'Lemon8',    url: platforms.lemon8.url,    handle: platforms.lemon8.handle || '' });
  if (community.url)            links.push({ label: community.name || 'Community', url: community.url, handle: '' });

  const plaintext = links.map(l => `${l.label}: ${l.url}`).join('\n');
  const html      = links.map(l => `<a href="${l.url}">${l.label}${l.handle ? ' (' + l.handle + ')' : ''}</a>`).join(' | ');

  return { links, plaintext, html };
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function fmtFollowers(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k`;
  return String(n);
}

module.exports = {
  loadProfile,
  getCreatorContext,
  getCreatorOneLiner,
  getCommunityBlock,
  getVoiceBlock,
  getSocialLinksBlock,
};
