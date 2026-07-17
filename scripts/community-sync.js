/**
 * Community Sync Script — scripts/community-sync.js
 * Pulls all members from Kajabi community via the MCP-equivalent REST API,
 * transforms them, and pushes to kre8r /api/community/sync.
 *
 * Run: node scripts/community-sync.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const INTERNAL_KEY   = process.env.INTERNAL_API_KEY;
const KAJABI_BASE    = 'https://api.kajabi.com/v1';
const TOKEN_URL      = 'https://api.kajabi.com/v1/oauth/token';
const KRE8R_BASE     = 'http://localhost:3000';
const SITE_ID        = '2148808568';
const COMMUNITY_ID   = '972809';

// Access group IDs for tier detection
const TIER_GROUPS = {
  '1145056': 'founding50',
  '1145150': 'garden',
  '1145109': 'greenhouse',
};

async function getToken() {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.KAJABI_CLIENT_ID,
      client_secret: process.env.KAJABI_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Kajabi auth failed: ${res.status}`);
  const d = await res.json();
  return d.access_token;
}

async function fetchAll(token, endpoint, params = {}) {
  const { default: fetch } = await import('node-fetch');
  const all = [];
  let page = 1;

  while (true) {
    const qs = new URLSearchParams({ ...params, page, per_page: 200 }).toString();
    const url = `${KAJABI_BASE}${endpoint}?${qs}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text();
      console.log(`  ⚠ ${endpoint} page ${page}: ${res.status} — ${body.slice(0,200)}`);
      break;
    }

    const data = await res.json();

    // Handle various Kajabi response shapes
    const items = data.members || data.contacts || data.data || (Array.isArray(data) ? data : []);
    if (!items.length) break;

    all.push(...items);
    console.log(`  Page ${page}: ${items.length} items (total so far: ${all.length})`);

    // Check if more pages exist
    const meta = data.meta || data.pagination;
    if (!meta || (meta.total && all.length >= meta.total) || items.length < 200) break;
    page++;
  }

  return all;
}

async function main() {
  const { default: fetch } = await import('node-fetch');

  console.log('🔐 Getting Kajabi token...');
  let token;
  try {
    token = await getToken();
    console.log('  ✓ Token acquired');
  } catch (e) {
    console.error('  ✗ Auth failed:', e.message);
    process.exit(1);
  }

  // Try to pull contacts with tier/membership info
  console.log('\n📋 Pulling Kajabi contacts...');
  const contacts = await fetchAll(token, '/contacts');
  console.log(`  Total contacts: ${contacts.length}`);

  if (!contacts.length) {
    console.log('\n⚠ No contacts returned from Kajabi REST API.');
    console.log('The community progress_score data requires the Kajabi MCP.');
    console.log('Falling back to basic contact data only...');
  }

  // Try community members endpoint (may or may not be available)
  console.log('\n🏕 Trying community members API...');
  let communityMembers = [];
  try {
    const url = `https://api.kajabi.com/kc/v1/community_groups/${COMMUNITY_ID}/members?per=200`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (res.ok) {
      const d = await res.json();
      communityMembers = d.members || d.data || [];
      console.log(`  ✓ Got ${communityMembers.length} community members via kc API`);
    } else {
      console.log(`  Community API returned ${res.status} — not available via REST token`);
    }
  } catch (e) {
    console.log('  Community API not accessible:', e.message);
  }

  // Transform contacts into community member format
  const today = new Date().toISOString().slice(0, 10);
  const members = contacts.map(c => {
    // Determine tier from offers/tags
    let tier = 'greenhouse';
    const tags = c.tags || [];
    if (tags.includes('founding_50') || tags.includes('founding50')) tier = 'founding50';
    else if (tags.includes('garden') || tags.includes('the_garden')) tier = 'garden';

    return {
      id:               c.id?.toString() || c.uuid || `contact-${c.email}`,
      kajabi_user_id:   `Member/${c.id}`,
      first_name:       c.first_name || null,
      last_name:        c.last_name || null,
      email:            c.email || null,
      role:             'member',
      tier,
      joined_at:        c.created_at || null,
      last_active_at:   c.last_sign_in_at || c.updated_at || null,
      progress_score:   0,   // Not available via REST API — needs MCP
      posts_count:      0,
      comments_count:   0,
      posts_30d:        0,
      comments_30d:     0,
      onboarding_status: 'not_started',
      tags_json:        JSON.stringify(tags),
    };
  });

  if (!members.length) {
    console.log('\n✗ No members to sync. Exiting.');
    process.exit(1);
  }

  // Get aggregate metrics
  const metrics = {
    new_members_7d: 0,
    active_users_7d: 0,
    challenge_completions: 0,
  };

  // Push to kre8r
  console.log(`\n🚀 Pushing ${members.length} members to kre8r...`);
  const syncRes = await fetch(`${KRE8R_BASE}/api/community/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
    },
    body: JSON.stringify({ members, metrics, snapshot_date: today }),
  });

  if (!syncRes.ok) {
    const err = await syncRes.text();
    console.error('  ✗ Sync failed:', err);
    process.exit(1);
  }

  const result = await syncRes.json();
  console.log('\n✅ Sync complete!');
  console.log(`  Members upserted: ${result.upserted}`);
  console.log(`  New members detected: ${result.new_members}`);
  console.log(`  Events logged: ${result.events}`);
  console.log(`  Warm leads detected: ${result.new_leads}`);
  console.log(`  Counts: ${JSON.stringify(result.counts)}`);
  console.log(`\nNote: progress_score data requires MCP snapshot. This sync populated`);
  console.log(`contact info and tier data. Run the MCP snapshot for full engagement data.`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
