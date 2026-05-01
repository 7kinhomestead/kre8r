# ROCK RICH — HarvestΩr Gamification Spec
**Version 3.0 | April 2026 | Senior Engineering Review Incorporated**

---

## The Shift

V1 tried to build gamification on top of Kajabi. V3 builds it alongside Kajabi, on its own infrastructure, with no dependency on Kajabi internals.

Kajabi is the community hub — conversations, courses, live calls. HarvestΩr is the proof layer — where members document what they're building, recognize each other, and prove the lifestyle works. Kajabi is where they talk. HarvestΩr is where they show.

The Kajabi API does exactly one job: **verify that a visitor is a paying member and confirm their tier.** Everything else is owned by HarvestΩr.

---

## North Star

Build a system that makes members **better at their actual lives** — and then come back to share what they built. Not addicted to a platform. Not competing for a leaderboard. Genuinely growing, visibly proving it, and lifting the people around them.

**The one metric that matters:** How much has this community actually helped its members do? Not DAU. Not posts per week. The Collective Harvest number.

---

## Architecture

HarvestΩr is a **completely standalone Express app** on the 7kinhomestead.land droplet. No shared code, process, or database with Kre8Ωr or kre8r-land. The only wire between servers is the outbox bridge (see Infrastructure Foundations).

```
7kinhomestead.land droplet
├── kre8r-land      port 3010   PM2: kre8r-land    /home/landapp/kre8r-land   (existing)
└── harvestomr      port 3011   PM2: harvestomr    /home/landapp/harvestomr   (new)

nginx
├── 7kinhomestead.land             → port 3010  (existing)
└── rockrich.7kinhomestead.land    → port 3011  (new location block, Certbot subdomain)

kre8r.app droplet (separate server)
└── receives POST /api/seedr via outbox bridge (authenticated, retried, idempotent)
```

**App structure:**
```
/home/landapp/harvestomr/
├── server.js
├── src/
│   ├── db.js                  — SQLite init, WAL mode, all migrations
│   ├── routes/
│   │   ├── auth.js            — magic link
│   │   ├── members.js         — profiles, tiers
│   │   ├── skills.js          — skill map, directory
│   │   ├── wins.js            — harvest portfolio
│   │   ├── endorsements.js    — nominations + vouches + gratitude (unified)
│   │   ├── challenges.js      — challenges + responses
│   │   ├── predictions.js     — prediction board
│   │   ├── map.js             — living knowledge map
│   │   └── admin.js           — GardenΩr
│   └── utils/
│       ├── claude.js          — Claude API caller
│       ├── kajabi.js          — proxies to kre8r.app/api/kajabi/member-check (X-Internal-Key)
│       ├── email.js           — magic link via MailerSend API (same pattern as MailerLite v2)
│       ├── points.js          — point event writer
│       └── outbox.js          — cross-droplet bridge with retry
├── public/                    — PWA frontend (HTML/CSS/JS + manifest + service worker)
├── config/
│   ├── points.json            — point values per action (tunable without deploy)
│   └── levels.json            — level thresholds and titles (tunable without deploy)
└── database/harvestomr.db     — SQLite, WAL mode
```

**Deploy:**
```
cd /home/landapp/harvestomr && git pull origin main &&
npm install --production && pm2 restart harvestomr
```

**Pre-launch infrastructure gate:** Resize droplet to $18/mo 2GB before any public announcement. One-click in DigitalOcean, no data loss.

---

## Infrastructure Foundations
*These are built in Phase 0 before any feature. They are not optional.*

### Community Timezone
All time-sensitive data (week_of, streaks, challenge windows, nomination resets) uses **America/Denver ("Rock Rich time")**. Server stores UTC; display converts to Denver. A member in any timezone sees their week reset at the same "Rock Rich Monday." Documented in code and in the community FAQ.

### Rate Limiting
`express-rate-limit` on every write route from day one. Rate-limit by `req.session.memberId` (not IP — IP is trivially bypassed by VPN) on authenticated routes. IP fallback for unauthenticated routes (magic link request, public profile views).

```js
const writeLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session.memberId || req.ip
})
// Applied to every POST/PATCH/DELETE route individually
```

Business logic in the DB (weekly nomination caps, etc.) is the primary fraud defense. Rate limiting is the second layer that prevents hammering before business logic runs.

### Transactional Email (Magic Link Delivery)
Use **MailerSend** — MailerLite's sister product built specifically for transactional email. 3,000 emails/month free. Jason's MailerLite credentials log straight into mailersend.com — the account is likely already there. ~10 minutes to add a sending domain and get an API key.

The API is simple and follows the same pattern as the MailerLite v2 calls already in `src/routes/mailerlite.js` on kre8r.app. Do not send magic links from raw server SMTP — Gmail and Outlook spam filters eat "click this link" emails from cold domains. SPF, DKIM, and DMARC are configured through the MailerSend domain setup wizard. Members locked out on launch day is the worst possible start.

### Outbox Pattern (Cross-Droplet Bridge)
Any event that needs to reach Kre8Ωr (Challenge DNA → SeedΩr, Campfire → MailΩr) is written to `harvest_outbound_events` first, then a worker drains the queue with retry + exponential backoff. Never a direct synchronous HTTP call to the other server.

```sql
harvest_outbound_events  -- id, event_type, payload JSON, status (pending/sent/failed),
                         -- attempts, last_attempt_at, sent_at, created_at
```

Worker runs every 60 seconds, marks sent on 200, increments attempts on failure, gives up after 10 attempts and alerts Jason via email.

### Protection Stack (applied to every write route)
```
Request arrives
  → Rate limit (by memberId/IP)
    → Auth check (valid session, member active)
      → Business logic check (do you have a token? is this valid?)
        → DB write
```

---

## Member Identity & Auth

**Auth is Phase 0. Nothing else is built until it is rock-solid.**

### Identity Anchor: `kajabi_contact_id`
Member identity is locked to the Kajabi contact ID, not email. Email is a lookup key that can change. If a member updates their Kajabi email, they don't lose their account and don't get duplicated.

```sql
harvest_members        -- id, kajabi_contact_id (unique), display_name, homestead_name,
                       -- tier, role (member/admin), level,
                       -- open_to_mentoring BOOLEAN DEFAULT 0,
                       -- mentoring_skills TEXT (JSON array of skill tags),
                       -- kajabi_verified_at, joined_at, last_active_at,
                       -- status (active/lapsed/removed),
                       -- created_at, updated_at

harvest_member_emails  -- id, member_id, email (unique), is_primary, created_at
                       -- (tracks email history — member can change Kajabi email
                       --  without losing account or creating a duplicate)
```

### Magic Link Flow

```
Member enters email
  → rate limit check (3 magic link requests/hour per email)
  → lookup harvest_member_emails WHERE email = ?
      → found: identify member_id
      → not found on first-time path: will create after Kajabi check
  → generate token: crypto.randomBytes(32) → hex string
  → store SHA-256(token) in harvest_magic_tokens (expires 15min)
  → send email via transactional provider: "Tap here to sign in"
    → https://rockrich.7kinhomestead.land/auth/verify?token=xxx
  → member taps → server SHA-256s the token → lookup → validate expiry → delete token
  → if new member: Kajabi tier check → profile setup → create records
  → if returning: straight to dashboard
  → set req.session.memberId
```

### First-Visit Kajabi Verification

HarvestΩr does **not** call the Kajabi API directly. It proxies through kre8r.app, which already holds the OAuth credentials (same pattern as AffiliateΩr and blog sync bridges). One set of credentials, one place to rotate them.

```
Token validated, email not in harvest_member_emails
  → POST https://kre8r.app/api/kajabi/member-check
    headers: { X-Internal-Key: INTERNAL_API_KEY }
    body: { email }
  ← { kajabi_contact_id, tier, active: true } or { active: false } or 404
  → No match / active: false → "This email isn't connected to a ROCK RICH membership."
  → Match: create harvest_members + harvest_member_emails, set kajabi_verified_at
  → Redirect to profile setup
```

**New endpoint required on kre8r.app** (small addition to `src/routes/audience.js` or a new `src/routes/member-check.js`):
```
POST /api/kajabi/member-check
  Auth: X-Internal-Key header
  Body: { email }
  Calls: GET /v1/contacts?email= → GET /v1/contacts/:id/offers
  Returns: { kajabi_contact_id, tier, active } | 404
  Whitelisted in kre8r.app auth middleware
```

This call is **synchronous** — the member is waiting for the magic link to resolve. It is not an outbox candidate. Graceful failure: if kre8r.app is unreachable or returns an error, show a friendly retry message. Do not cache the failure — retry on next login attempt.

### Re-verification
- Same proxy endpoint called on every login, result cached for 7 days in `kajabi_verified_at`
- If kre8r.app is unreachable: fail-open with logging (never lock out a paying member due to an upstream outage)
- If response confirms lapsed/cancelled: set `status = lapsed`, member sees "your membership has lapsed" screen with Kajabi renewal link
- Hard-block after 14 consecutive days of confirmed lapse

### Soft-Delete Strategy
`harvest_members.status` controls member state:
- `active` — full access
- `lapsed` — Kajabi membership cancelled. Read-only: can view their profile and history, cannot post/nominate/vouch. Historical contributions remain (nominations they gave still count, vouches still valid — they earned those).
- `removed` — Jason banned them. Profile hidden. Nominations they gave are marked revoked. Vouches reversed (vouch_count recomputed). Wins removed from Collective Harvest aggregate.

### Tier Permissions
| Kajabi Tier | HarvestΩr Role | Extras |
|-------------|---------------|--------|
| The Greenhouse 🌱 | Member | Full access to all features |
| The Garden 🌿 | Member+ | 2 nomination tokens/week |
| The Founding 50 🏆 | Elder | 3 nomination tokens/week, vouches count double, 500pt headstart |

### Jason's Admin Access
Jason's email is seeded as `role: admin` in `harvest_members`. Same magic link flow — his session unlocks admin actions inline on existing pages (no separate admin app). One summary dashboard page at `/admin` for the health overview.

---

## The Unified Endorsements Model

Skills vouches, peer nominations, and gratitude tags share the same shape: one member endorses another with a written statement. Rather than three separate tables, one table handles all three:

```sql
harvest_endorsements  -- id, type (vouch|nomination|gratitude),
                      -- from_member_id, to_member_id,
                      -- target_id (nullable → skill_id for vouch type),
                      -- text, week_of (Denver Monday ISO, nullable for non-weekly types),
                      -- status (pending_acceptance|accepted|rejected|flagged|revoked),
                      -- created_at, updated_at
```

**Why this works:**
- Nominations: `type=nomination`, `week_of` set, `target_id` null
- Vouches: `type=vouch`, `target_id = skill_id`, `week_of` null
- Gratitude (replaces Ripple Effect — see Feature 4): `type=gratitude`, `target_id` null
- Living Knowledge Map edges: `SELECT * FROM harvest_endorsements WHERE status = 'accepted'` — all connection types in one query
- New endorsement types add zero migrations

### Nomination Moderation (required)
- `status = pending_acceptance` on creation
- Recipient receives a notification: *"@member wants to nominate you — accept?"*
- Recipient accepts → `status = accepted` → points awarded → appears in public feed
- Recipient ignores for 72hrs → auto-accepts (reduces friction for inactive members)
- Recipient rejects → `status = rejected` → nominator's token is NOT returned (prevents spam rejections)
- Any member flags an endorsement (2 flags) → `status = flagged` → hidden until Jason reviews
- Block list: `harvest_member_blocks` table — blocked members cannot endorse you

---

## The Points Economy

### Event-Based Source of Truth

Points and credits are **never stored as columns on `harvest_members`**. The source of truth is event tables. The member's balance is always computed from events.

```sql
harvest_point_events   -- id, member_id, amount, reason, source_id (nullable),
                       -- created_at
harvest_credit_events  -- id, member_id, amount, reason, source_id (nullable),
                       -- created_at
```

`member.points` and `member.credits` can be cached as columns (rebuilt nightly) but the events table is always authoritative. This gives a free audit trail for any "why did my balance change" question.

### Point Values (config/points.json — tunable without deploy)
```json
{
  "join": 50,
  "complete_profile": 25,
  "log_first_win": 50,
  "log_win": 10,
  "give_nomination": 15,
  "receive_nomination": 150,
  "add_skill": 10,
  "receive_vouch": 75,
  "complete_weekly_challenge": 75,
  "complete_monthly_challenge": 200,
  "streak_7_day": 100,
  "streak_30_day": 400,
  "irl_connection": 5,
  "prediction_delivered": 50,
  "mentee_milestone": 100,
  "win_of_the_week": 100
}
```

Note: IRL connection reduced to 5 points (see QR Passport — mutual confirmation needed to prevent farming).

### Levels (config/levels.json — tunable without deploy)
```json
[
  { "level": 1, "title": "Seedling 🌱",   "min_points": 0,    "tagline": "Just planted." },
  { "level": 2, "title": "Grower 🪴",     "min_points": 250,  "tagline": "Putting down roots." },
  { "level": 3, "title": "Cultivator 🌿", "min_points": 750,  "tagline": "You know what you're doing." },
  { "level": 4, "title": "Steward 🌾",    "min_points": 2000, "tagline": "You tend this land. You give back." },
  { "level": 5, "title": "Rock Rich 🏆",  "min_points": 5000, "tagline": "Living proof that resourcefulness wins." }
]
```

### Contribution Score (invisible — used only for map node sizing)
```
Contribution Score =
  (nominations received × 40%) +
  (vouches given × 25%) +
  (challenge responses × 20%) +
  (wins logged × 15%)
```

Never shown as a number to members. Shapes the map. No leaderboard anxiety.

---

## Feature 1: The Skill Map (PRIORITY ONE — Founding 50 Requested)

Community-validated skills. Not a platform badge. Not a course completion. Peer vouches from people who've seen your work.

### Progression
| Status | Requirement | Display |
|--------|-------------|---------|
| Self-Certified | Member adds it | `[Self-Certified]` |
| 1 Vouch | Any member vouches with written statement | `[1 Vouch]` |
| Peer Certified | 2 vouches (Elder vouches count double) | `[Peer Certified ✓]` gold |
| Community Expert | 3+ vouches | `[Community Expert ⭐]` — surfaces in directory |
| Jason Endorsed | Jason's personal endorsement = 3 vouches | `[Jason Endorsed 🏆]` |

Vouching is done via `harvest_endorsements` (type=vouch). Vouch statement is required. Voucher's name and statement are public — they stake their reputation.

Vouch Phase unlocks 30 days after platform launch (lets self-certifications accumulate so there's something to vouch for on day 31).

### Skills Database
```sql
harvest_skills  -- id, member_id, skill_name, category, description,
                -- created_at, updated_at
                -- (status and vouch_count are DERIVED from harvest_endorsements,
                --  never stored — computed at read time or in a view)
```

Vouch count: `SELECT COUNT(*) FROM harvest_endorsements WHERE type='vouch' AND target_id=skill_id AND status='accepted'`

### Skills Directory
Searchable by skill name and category. Categories: Land & Infrastructure, Financial Systems, Food & Preservation, Content Creation, Community Building, Off-Grid Tech.
The community's living talent database. Public — visible without login (encourages sign-ups).

---

## Feature 2: The Harvest Portfolio

Every member has a living record of what they've actually built, saved, and done. Real wins with real numbers.

### Win Entry
- **What you did:** 1-3 sentences
- **The result:** number if possible — *"Saved $340/month"*, *"Built for $180"*, *"Paid off $12k"*
- **Category:** Financial / Built Something / Learned / Taught Someone / System Built / Land & Food
- **Who helped you?** (optional — tag a member → creates a `gratitude` endorsement, see Feature 4)
- **Photo or link:** optional
- **Public or Private:** member controls
- **Date**

### The Collective Harvest
Aggregate of all public wins with dollar values. Displayed on the public landing page:
*"ROCK RICH members have collectively saved $284,000, completed 47 builds, and paid off $1.2M in debt since [launch date]."*

This number is the most powerful recruiting tool and proof of concept for the Rock Rich identity that exists.

### Database
```sql
harvest_wins  -- id, member_id, description, result_text, result_value,
              -- result_unit (dollars/hours/items/count), category,
              -- helper_member_id (nullable — "who helped you" tag),
              -- photo_url, is_public, win_date, created_at, updated_at
```

---

## Feature 3: The Rock Rich Nomination

1 nomination token per member per week (Garden: 2, Founding 50: 3). Resets Monday Denver time. Scarce. Deliberate. Public.

### Flow
1. Member clicks "Give My Nom"
2. Selects a member, writes a public statement (required, minimum 20 chars)
3. Creates `harvest_endorsements` record (type=nomination, status=pending_acceptance)
4. Recipient gets notified — accepts/ignores/rejects
5. On acceptance (or 72hr auto-accept): status=accepted, 150 points awarded, appears in feed

### The Nomination Feed
Public feed, newest first. Beautiful, warm, human. Jason reads it every week — it's his cheat sheet for Win of the Week. New members scroll it and immediately understand the culture.

The nomination token count is enforced in the DB:
```sql
SELECT COUNT(*) FROM harvest_endorsements
WHERE type='nomination' AND from_member_id=? AND week_of=?
```
This is the primary fraud defense. Rate limiting is the second layer.

---

## Feature 4: The Gratitude Chain (replaces Ripple Effect)

When logging a win, the optional **"Who helped you?"** field tags a member. That member receives a notification:

*"@[member] said you helped them save $400 this month. Your contribution is showing up in the world."*

- Creates a `gratitude` type endorsement (no acceptance flow needed — it's a thank-you, not a nomination)
- Gratitude giver: 10 points. Gratitude receiver: 25 points
- Draws an edge in the Living Knowledge Map
- Displays on both profiles: *"Helped 7 members with documented wins"* / *"Received help from 3 members"*

**Why this replaces Ripple Effect:** Same emotional payload (quiet helpers become visible). Zero fraud surface (tied to a real win entry, not a chain of nominations). Members understand it immediately. No graph traversal complexity.

---

## Feature 5: The Prediction Board

Members make public bets on themselves. Track records become reputation.

### Flow
- Member posts: *"I'm going to reduce our grocery bill by 30% in 60 days."*
- Sets a deadline (14 / 30 / 60 / 90 days)
- Others can: Support / Challenge (with written pushback) / Me Too (I'm trying this)
- At deadline: member reports back — delivered / partial / missed — with honest explanation
- Track record on profile: *"8 predictions. 7 delivered. 87% accuracy."*

High-accuracy members become trusted voices with no official designation. Failed predictions + honest postmortems are celebrated — this is the Tension Engine format in action.

### Database
```sql
harvest_predictions  -- id, member_id, statement, method_description,
                     -- deadline_at (UTC), status (open/delivered/partial/missed),
                     -- result_notes, support_count, challenge_count, metoo_count,
                     -- created_at, updated_at
```

---

## Feature 6: The Living Knowledge Map

A 2D force-directed graph. Members are nodes. Endorsements (nominations, vouches, gratitude) are edges. The shape of the graph is the health of the community.

**2D, not 3D.** For a community of 50–500 members, d3-force or cytoscape.js delivers 95% of the visual value at a fraction of the build cost and without killing mobile GPUs inside the Capacitor wrapper. Revisit 3D when membership exceeds 1,000.

### What it shows
- **Nodes:** members — sized by Contribution Score, colored by tier
- **Edges:** drawn from accepted endorsements of any type
- **Clusters:** emerge naturally as members interact
- **Isolated nodes:** at-risk members with zero connections

### Member vs Admin view
- **Member:** ego-network (your connections + depth-2 neighbors). Discover members worth connecting with.
- **Jason (admin):** full graph with health overlay — isolated members flagged, hubs identified.

### Tech
- Graph data computed server-side from `harvest_endorsements WHERE status='accepted'`
- Cached as static JSON file, rebuilt daily (not per-request)
- `GET /api/map` returns cached JSON
- d3-force renders client-side
- Ego-network paginated: return depth-2 neighbors of requesting member by default

---

## Feature 7: The Shadow Economy — Rock Rich Credits

Credits for real-world results, not engagement. V1 ships credits as a counter with **one redemption only.**

### Earning Credits (V1)
| Action | Credits |
|--------|---------|
| Log a win with dollar value | 1 per $10 saved/earned |
| Build something (photo proof, 2 upvotes) | 50 |
| Receive a vouch (teaching proof) | 100 |
| Complete a monthly challenge | 75 |
| 30-day streak | 100 |
| Prediction delivered | 50 |
| Receive 5 nominations lifetime | 200 |

### V1 Redemption: One Option Only
**Coaching call with Jason — 500 credits.**
Ship everything else (early access, merch, Campfire feature) only when there's evidence members want them and Jason has bandwidth to deliver. Don't build an operational catalog before you know what people will redeem.

### Points vs Credits
Points = how active you are. Credits = real-world value you created. A member can have low points and high credits — reclusive but enormously productive. Both tell part of the story. Neither is the whole picture.

---

## Feature 8: The Campfire

Weekly auto-generated newsletter draft from member activity. Claude synthesizes using Jason's voice profile. Jason edits and sends.

### Content
- Top 3 wins (by credit value, public only)
- Predictions in progress (what members are attempting)
- Skills newly certified this week
- Nomination spotlight (most-nominated member, their received statement)
- New map connections formed
- Jason's note (editable before send)

### How it works
- `GET /admin/campfire/draft` — queries HarvestΩr DB for week's activity, passes to Claude with Jason's voice profile, returns formatted draft
- Draft persisted in `harvest_campfire_drafts` table so Jason can leave and come back
- Jason edits in the admin panel, approves
- `POST /admin/campfire/send` → writes to `harvest_outbound_events` (type: campfire_send) → outbox worker POSTs to Kre8Ωr MailΩr endpoint → sends via MailerLite
- Send-once guard: `harvest_campfire_drafts.sent_at` — if set, block re-send

```sql
harvest_campfire_drafts  -- id, week_of, draft_content, edited_content,
                         -- sent_at (nullable), created_at, updated_at
```

---

## Feature 9: Challenge DNA — The Content Loop

Members respond to challenges in HarvestΩr. Best responses surface in Kre8Ωr SeedΩr. Members see their thinking become Jason's next video.

### The Tension Engine Format
Every challenge prompt is a tension narrative, not a checkbox:

> *"Your mission: pick one thing you've been avoiding because it feels too expensive or complicated. Try it anyway with whatever you have. Report back — what went wrong, what surprised you, what the environment taught you."*

Failure responses score the same as success. The attempt is the achievement.

### The Loop
1. Jason creates a challenge (or clicks "Generate Options" → Claude writes 5 options using monthly theme + Jason's voice, Jason picks one)
2. Members respond in HarvestΩr
3. Claude scores responses against a rubric (novelty, specificity, insight value) — scores are internal only, never shown to members
4. Top responses added to `harvest_outbound_events` (type: seedr_seed) → outbox POSTs to Kre8Ωr SeedΩr
5. When Jason makes a video citing a community insight, he marks the response as used (manually in GardenΩr) → `seeded_to_seedr_idea_id` populated → member gets 100 credit bonus + notification

### Database
```sql
harvest_challenges   -- id, title, prompt, theme, month, type (weekly/monthly),
                     -- points_value, credits_value, starts_at, ends_at,
                     -- created_at, updated_at

harvest_responses    -- id, challenge_id, member_id, response_text, photo_url,
                     -- insight_score (internal, never exposed to members),
                     -- seeded_to_seedr_idea_id (nullable — Kre8Ωr idea ID when seeded),
                     -- seeded_at (nullable),
                     -- created_at, updated_at
```

---

## Feature 10: Open to Mentoring (replaces Mentor Graph)

A checkbox on the member profile. Two fields:
- `open_to_mentoring: BOOLEAN` (stored in `harvest_members`)
- `mentoring_skills: JSON array` (skill tags they'll mentor on)

Members browsing the Skills Directory see a "🤝 Open to Mentoring" badge on profiles where it's set. That's the feature. Direct connection happens in Kajabi (DMs, the community) — HarvestΩr surfaces the signal, Kajabi facilitates the relationship.

Build the full request/match/track/milestone flow only if there is demonstrated member demand for structured mentorship after launch.

---

## Feature 11: The QR Passport

Personal QR code per member. Scan IRL to record a real-world connection.

### Mutual Confirmation Flow (fraud prevention)
- A scans B's QR → opens `rockrich.7kinhomestead.land/connect/:member_id` → creates a pending connection
- B sees a notification on their device: *"@A wants to record an IRL connection with you"*
- B confirms within 60 seconds on their phone → connection recorded, 5 credits each, edge added to map
- If B doesn't confirm in 60s: pending connection expires, no credits

Credits are 5 (not 50) because this is a social ritual, not a primary value driver. The map edge and the profile note (*"3 IRL connections"*) is the real value.

### Implementation
- `GET /api/members/:id/qr` — generates QR code pointing to `/connect/:member_id`
- `qrcode` npm package
- `harvest_connections` table: id, member_a_id, member_b_id, confirmed_at, created_at

---

## The GardenΩr Admin Panel (Jason-Only)

Admin actions live **inline on existing pages**, not in a separate app. Jason sees extra buttons and controls that regular members don't. One dedicated summary page at `/admin` for the health overview.

### /admin Summary Dashboard
- Map health: total nodes, total edges, isolated members (0 connections)
- Activity this week: wins, nominations, challenge responses, new members
- At-risk list: joined 30+ days ago, no wins, no nominations given or received
- Challenge completion rate (is this week's prompt working?)
- Collective Harvest numbers
- Campfire draft: generate → edit → send

### Inline Admin Actions (visible only to Jason, on context pages)
- **On any member profile:** "Award Win of the Week" (100pts + notification) / "Endorse this skill" / "Mark at-risk" / "Reach out" (pre-fills MailΩr to their email)
- **On any skill:** "Jason Endorses This" (= 3 vouches)
- **On any response:** "Seed to SeedΩr" (marks `seeded_to_seedr_idea_id`, triggers outbox)
- **On nominations feed:** "Feature in Campfire"
- **Season controls:** Trigger quarterly reset (archives leaderboard, resets Contribution Scores — NOT lifetime points)

---

## Build Phases

### Pre-Build Infrastructure (Do Before Writing Any Code)
Five minutes now saves a mid-build interruption later.

- [ ] **DNS:** Add `rockrich.7kinhomestead.land` A record pointing to the 7kinhomestead droplet IP (same IP as `7kinhomestead.land`). Done in your DNS provider. Propagation takes up to 24hrs — do it first.
- [ ] **nginx block:** Add server block for `rockrich.7kinhomestead.land` → `proxy_pass http://localhost:3011` on the droplet. Same pattern as the existing `7kinhomestead.land` block.
- [ ] **SSL:** Run `certbot --nginx -d rockrich.7kinhomestead.land` to extend the existing cert to the subdomain.
- [ ] **MailerSend:** Log into mailersend.com with MailerLite credentials, confirm account exists, add `rockrich.7kinhomestead.land` as a sending domain, generate API key, configure SPF/DKIM/DMARC via their wizard. Free tier — 3,000 emails/month.
- [ ] **Kajabi member-check endpoint:** Add `POST /api/kajabi/member-check` to kre8r.app (`src/routes/audience.js` or new file), whitelisted in auth middleware. HarvestΩr's Phase 0 auth depends on this existing first.

Verify: `curl https://rockrich.7kinhomestead.land` returns a 502 (nginx is routing, app not running yet). That's the green light to start Phase 0.

### Phase 0 — Auth Foundation (Week 1)
Nothing else is touched until this is solid. Paid members locked out is the worst possible launch.

- [ ] `harvest_members` table + `harvest_member_emails` table
- [ ] `harvest_sessions` table (express-session SQLite store)
- [ ] `harvest_magic_tokens` table (SHA-256 hashed, 15min expiry)
- [ ] `harvest_outbound_events` table + outbox worker
- [ ] Magic link flow end-to-end (email entry → token → verify → session)
- [ ] Kajabi tier verification (first-visit + 7-day cache)
- [ ] Rate limiting on all routes (express-rate-limit by memberId/IP)
- [ ] Transactional email provider configured (Postmark or SES, SPF/DKIM/DMARC)
- [ ] Soft-delete status field (active/lapsed/removed)
- [ ] Jason admin seed (role: admin)
- [ ] Profile setup screen (display name, homestead name, location optional)
- [ ] `config/points.json` and `config/levels.json`
- [ ] `harvest_point_events` and `harvest_credit_events` tables
- [ ] PWA manifest.json and service worker (shell only — no offline data yet)

### Phase 1 — Core Value (Weeks 2-3)
Soft launch to Founding 50 only. Get real feedback before opening to all tiers.

- [ ] Harvest Portfolio (log wins, Collective Harvest aggregate, public/private toggle)
- [ ] "Who helped you?" gratitude field on wins → gratitude endorsement
- [ ] Harvest Portfolio public page (shareable, no auth required)
- [ ] Skill Map: self-certify + vouch (via unified endorsements)
- [ ] Skills Directory (searchable, public)
- [ ] Member profile page (wins, skills, endorsements received)
- [ ] Points awarded for: join, profile, first win, log win, add skill, receive vouch
- [ ] Level computation from point events
- [ ] GardenΩr /admin summary page (basic)

### Phase 2 — Community Layer (Weeks 4-5)
Open to all tiers after Founding 50 beta feedback.

- [ ] Rock Rich Nominations (unified endorsements, pending_acceptance flow, moderation)
- [ ] Nomination feed (public)
- [ ] Block list (harvest_member_blocks)
- [ ] Weekly token reset (Denver Monday cron)
- [ ] Points for nominations
- [ ] GardenΩr inline admin actions
- [ ] Nomination moderation (flag queue)
- [ ] Win of the Week admin action

### Phase 3 — The Living Layer (Weeks 6-7)

- [ ] Prediction Board
- [ ] Living Knowledge Map (2D, d3-force, ego-network + full admin view)
- [ ] Daily graph recompute + static JSON cache
- [ ] Campfire draft generator (Claude + draft persistence + outbox send to MailΩr)
- [ ] GardenΩr: at-risk members, Campfire send, seasonal reset

### Phase 4 — Challenges + App Store (Weeks 8-10)

- [ ] Challenge system with Tension Engine prompts
- [ ] Challenge response scoring (internal rubric, scores never shown to members)
- [ ] Challenge DNA → SeedΩr outbox bridge
- [ ] "Generate challenge options" (Claude + voice profile)
- [ ] Capacitor install and configuration (iOS + Android)
- [ ] PWA offline capability (service worker caches profile + wins + skills)
- [ ] Community tab (WebView → Kajabi community URL)
- [ ] **iOS WKWebView note:** Isolated cookie store — members see Kajabi login on first open inside app. Session persists after first login. Expected behavior, not a bug.
- [ ] Submit to Apple App Store ($99/yr) and Google Play ($25 one-time)
- [ ] **Pre-launch gate: resize droplet to 2GB before any public announcement**

### Phase 5 — Shadow Economy + QR Passport (After Phase 4 Stable)

- [ ] Credits economy (harvest_credit_events, earning rules)
- [ ] One redemption: coaching call with Jason (500 credits)
- [ ] QR Passport (mutual confirmation flow, harvest_connections table)
- [ ] Open to Mentoring (checkbox + skill tags on profile, surfaced in Skills Directory)

---

## What's Cut From V1

| Feature | Decision |
|---------|----------|
| Ripple Effect | Cut. Replaced by Gratitude Chain on wins — same value, zero fraud surface. |
| 3D Three.js map | Replaced with 2D d3-force. Revisit at 1,000+ members. |
| Mentor Graph (structured) | Replaced with Open to Mentoring checkbox. Build full flow if demand is demonstrated post-launch. |
| Emergency Network | Cut. Low frequency, liability-adjacent. Wrong phase. |
| AI Twin | Moved to a separate ideas doc. Not a V1 commitment. |
| Full credit redemption catalog | Replaced with one redemption (coaching call). Add more when demand is known. |

---

## What Kajabi Still Does

- Live calls and async video content
- Course delivery
- Community conversations and threads
- Payment processing and membership management
- The emotional home of the community

HarvestΩr is the proof layer. Kajabi is where members talk. HarvestΩr is where they show.

---

## Claude Usage (4 Jobs Only)

HarvestΩr is standard CRUD. Claude is bolted on for four specific jobs:

1. **Campfire draft** — synthesize week's activity into Jason's newsletter draft
2. **Challenge prompt generation** — 5 options from monthly theme + voice profile (Jason picks)
3. **Challenge response scoring** — internal rubric scoring for DNA seeding (never shown to members)
4. **Future: AI Twin endpoint** — synthesizes community knowledge (Phase 6, not committed)

Everything else — auth, profiles, wins, nominations, predictions, skills, map — is plain Express + SQLite. No Claude in the transactional data path.

---

*Spec V3.0 | April 2026 | Locked for build. Phase 0 begins when Jason says go.*
