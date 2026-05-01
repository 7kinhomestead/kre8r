# ROCK RICH Community — Gamification System Spec
**Version 1.0 | April 2026**

---

## North Star

Build a gamification system that makes members feel like **they belong to something**, not like they're **competing against each other**. The ROCK RICH identity is resourcefulness as a superpower — doing a lot with a little. Every gamification mechanic should reinforce that identity and reward the *behaviors* that make the community valuable: showing up, sharing hard-won lessons, and helping each other win.

**Success metrics (in priority order):**
1. Members helping other members (replies, answers, nominations)
2. Long-term retention (still active at 90 days, 180 days)
3. Content contribution (posts, wins, questions)
4. Engagement volume (likes, comments) — last, because this is easiest to game

---

## The Three Layers

| Layer | What | Where | Dev Required |
|-------|------|--------|-------------|
| 1 | Identity system, levels, challenges, badges | Kajabi native | None |
| 2 | Contribution leaderboard, peer nomination, seasonal reset | Kre8Ωr API bridge | Medium |
| 3 | Community rituals | Community management | None |

---

## Layer 1 — Kajabi Native

### 1A. The Identity Ladder (Levels)

Kajabi's native level system assigns member titles based on cumulative points. We design the titles to feel like **real progression through homestead mastery**, not arbitrary ranks.

| Level | Title | Points Required | Identity |
|-------|-------|-----------------|----------|
| 1 | Seedling 🌱 | 0 | Just planted. Finding your footing. |
| 2 | Grower 🪴 | 250 | Putting down roots. Starting to produce. |
| 3 | Cultivator 🌿 | 750 | You know what you're doing. Others notice. |
| 4 | Steward 🌾 | 2,000 | You tend this land. You give back. |
| 5 | Rock Rich 🏆 | 5,000 | Living proof that resourcefulness wins. |

**Design notes:**
- Seedling → Grower gap should feel achievable in the first 2 weeks (encourages early habit formation)
- Steward and Rock Rich are aspirational — not everyone gets there, and that's intentional
- "Rock Rich" as the highest title is brand reinforcement, not just a rank
- The Founding 50 tier members start with a point bonus (see below) — they earned it

**Founding 50 Headstart:**
- All existing Founding 50 members receive a 500-point grant on launch day
- This reflects the investment they made before the system existed
- They won't dominate because Steward requires *ongoing* contribution

---

### 1B. Point Economy

Points must map to behaviors that actually make the community valuable. Volume rewards are second to quality rewards.

| Action | Points | Notes |
|--------|--------|-------|
| Join the community | 50 | One-time welcome bonus |
| Complete a course module | 25 | Per module, not per course (ongoing incentive) |
| Post in community | 10 | Capped at 3/day to prevent spam |
| Comment on a post | 5 | Capped at 10/day |
| Receive a like | 2 | Per like received (quality signal) |
| Complete a weekly challenge | 75 | See challenges below |
| Complete a monthly challenge | 200 | See challenges below |
| Receive a Rock Rich Nomination | 150 | Peer-to-peer, weekly (Layer 2) |
| 7-day activity streak | 100 | Login + at least one action |
| 30-day activity streak | 400 | Bonus on top of weekly bonuses |
| Win of the Week feature | 100 | Jason or Cari selects (Layer 3 ritual) |

**What we're NOT rewarding:**
- Posting the same thing multiple times
- Tagging people without context
- Reacting to everything without reading

**Point cap design:** Daily caps on posts and comments prevent the "gaming the system" problem. The high-value actions (nominations, challenge completions, streak bonuses) can't be faked.

---

### 1C. Badges

Badges are **earned, not awarded automatically for basic participation**. They should feel meaningful. Less is more — a member with 3 hard-earned badges is more proud than one with 23 cheap ones.

**Milestone Badges (automatic, tied to points/levels):**
| Badge | Trigger |
|-------|---------|
| 🌱 First Roots | First post in the community |
| 🔥 Seven Strong | 7-day streak |
| 🏅 30-Day Grower | 30-day streak |
| 📚 Knowledge Seeker | Complete first full course |
| 🌾 Full Harvest | Complete all available courses |
| 💬 Voice of the Land | 100 total comments |
| 🤝 Community Pillar | 10 Rock Rich Nominations received (lifetime) |

**Exclusive Identity Badges (manual, Jason/Cari awards):**
| Badge | Meaning |
|-------|---------|
| ⛏️ Rock Rich Original | Founding 50 member — original inner circle |
| 🌟 Win of the Week | Jason or Cari featured this member's win |
| 🧠 The Advisor | Recognized as a go-to voice on a topic |
| 🔨 Builder | Shared a real project with the community |

**Design note:** Manual badges stay rare. If Jason awards "The Advisor" badge every week it loses meaning. Reserve it for genuine moments.

---

### 1D. Challenges

Challenges are the engine of ongoing engagement. They must feel **achievable but worth doing** — not checkbox exercises.

**Weekly Challenges (recurring, 75 points):**

These rotate. Jason records a short video or voice note introducing each one. The challenge IS the content.

Examples:
- *"What's the one tool or skill you used this week that saved you the most time or money? Share it."*
- *"Find someone in the community who helped you this month. Tag them and tell us what they taught you."*
- *"Post a photo of a project you're working on — doesn't matter if it's not done."*
- *"What's something you tried this week that didn't work? What did you learn?"*
- *"Share your single best hack for [topic] — one thing you wish you'd known sooner."*

**Monthly Challenges (bigger, 200 points):**

These are structured around a theme. Members opt in and have the full month to complete.

Examples:
- *"The 30-Day Reduce Challenge"* — post one thing you eliminated, simplified, or replaced with something cheaper/better each week
- *"Build Something Month"* — document a real project from idea to done, share the result
- *"Teach Something Month"* — post one how-to per week, anything you know that others don't
- *"Win Log Month"* — every week, post one win (financial, system, lifestyle) from the past month

**Community Unlock Challenge (Layer 3 crossover, special):**

The whole community works toward a shared goal. When it's hit, everyone gets something.

Example: *"When 50 members complete this month's challenge, Jason records an exclusive Q&A only for this community."*

This is collaborative, not competitive. Everyone benefits when everyone participates.

---

## Layer 2 — Kre8Ωr API Bridge

These features require building a custom backend integration that pulls from Kajabi's API and surfaces the data inside a new Kre8Ωr panel. They're medium-lift dev work but high-impact for the behaviors we want.

---

### 2A. The Contribution Leaderboard

**Not a raw activity leaderboard.** A contribution-weighted leaderboard that surfaces members who are genuinely making the community better.

**How it works:**
- Kre8Ωr pulls Kajabi member data via API on a daily sync
- Calculates a **Contribution Score** — different from raw points
- Contribution Score weights:
  - 40% — nominations received (peer recognition)
  - 30% — replies/comments given (helping others)
  - 20% — challenge completions
  - 10% — course completions

**Why this matters:** A member who logs in every day and posts but never helps anyone gets a lower Contribution Score than a member who answers 3 great questions per week. This is the difference between a leaderboard that incentivizes noise and one that incentivizes value.

**Display:**
- Top 10 contributors for current season (not all-time)
- Shown inside a new `GardenΩr` panel in Kre8Ωr (admin view)
- Optionally surfaced inside Kajabi community as a weekly post by Jason ("This week's top contributors")
- **Not a persistent wall of shame for non-contributors** — framing is celebration, not comparison

**Seasonal resets:**
- Leaderboard resets quarterly (Jan, Apr, Jul, Oct)
- All-time hall of fame kept separately
- Reset prevents the same members permanently dominating and discouraging newcomers

---

### 2B. The Rock Rich Nomination

**The single most powerful mechanic in the system.** Peer recognition is 10x more meaningful than algorithm recognition.

**How it works:**
- Each member gets **1 nomination token per week** (resets every Monday)
- They can award it to any other member
- Nomination is public: *"I'm giving my Rock Rich Nom this week to @[member] because they helped me figure out [thing]. That saved me [time/money/headache]."*
- Receiving a nomination = 150 points + contributes to Contribution Score
- Nominations accumulate toward the "Community Pillar" badge (10 lifetime)

**Why nominations beat likes:**
- Likes are frictionless and meaningless. A nomination requires you to think, write, and publicly vouch for someone.
- The scarcity (1/week) makes the act feel deliberate
- The public format creates social proof and surfaces members worth following
- The giver feels good too — public generosity builds reputation

**Where nominations live:**
- Dedicated "Rock Rich Noms" post in the community (weekly thread, Jason kicks it off)
- Kre8Ωr tracks nomination count per member via API sync
- Kre8Ωr admin panel shows nomination leaderboard (who's most helped by peers)

**Implementation:**
- Kajabi: Weekly pinned post template for nominations
- Kre8Ωr: Nomination tracking endpoint that reads community post data via Kajabi API, parses @mentions in nomination thread, increments nomination count per member
- Simple MVP: Jason manually tracks and updates a lightweight Google Sheet or Kre8Ωr table; automate later

---

### 2C. GardenΩr — Admin Panel in Kre8Ωr

A new page in Kre8Ωr (or panel inside AudiencΩr) that gives Jason visibility into community health, not just raw counts.

**Dashboard shows:**
- Active members this week (posted or commented at least once)
- Members at risk of going dark (active before, silent for 14+ days)
- Top 10 by Contribution Score this season
- Nomination leaderboard (who's helping most)
- Challenge completion rate (% of community who completed weekly/monthly challenge)
- Streak distribution (how many members at 7-day, 30-day, etc.)
- New members in last 7 days + their first action (did they post? complete a module?)

**Why this matters for Jason:**
- He can personally reach out to members going dark before they churn
- He knows who the real community builders are (not just the loudest)
- He can give Win of the Week to someone who deserves it, not just the most visible person
- He sees if a challenge is working (low completion = bad prompt, not bad members)

**Routes to build:**
```
GET  /api/gardenr/summary          — weekly health snapshot
GET  /api/gardenr/leaderboard      — contribution scores, top 10
GET  /api/gardenr/at-risk          — members silent 14+ days
GET  /api/gardenr/nominations      — nomination counts by member
GET  /api/gardenr/challenges       — challenge completion rates
POST /api/gardenr/sync             — trigger Kajabi API pull
```

**Data storage:** New `community_members` table in Kre8Ωr SQLite. Syncs from Kajabi daily. Stores member ID, name, join date, last active, points, nomination count, contribution score, challenge completions.

---

### 2D. Seasonal Reset Automation

Every quarter, Kre8Ωr:
1. Archives current season leaderboard to `community_seasons` table
2. Resets Contribution Scores (not total points — Kajabi points are permanent)
3. Notifies Jason via dashboard alert: *"Season 2 ended. 47 members participated. Top contributor: @member. Archive ready."*
4. Optional: generates a summary post draft for Jason to publish in the community (celebratory, not competitive)

---

## Layer 3 — Community Rituals

No dev required. These are recurring community behaviors that Jason and Cari facilitate. They work *with* the gamification system but don't depend on it.

---

### 3A. Win of the Week (Every Friday)

Jason posts a short video (60–90 seconds) or written post highlighting one member's win from that week.

**Format:**
- *"This week's Rock Rich Win goes to @[member]. They [did the thing]. Here's why that matters..."*
- Member gets 100 points + Win of the Week badge
- Jason picks from: challenge completions, notable posts, nominations received, or DMs

**Why it works:**
- Weekly cadence creates a reason to show up (who got featured?)
- Being featured feels genuinely special (Jason personally called it out)
- Observers see real proof that the community rewards real action
- Low effort for Jason (he's already making content) — this is 90 seconds of authentic appreciation

---

### 3B. Monday Challenge Drop

Every Monday, Jason posts the week's challenge. Short video or voice note. Casual, not corporate.

**Format:**
- *"Alright, here's your challenge for this week. [Challenge]. Drop your answer in the comments. I'm reading every one."*
- Pin the post for the week
- Friday Win of the Week often features a challenge response

**Connection to gamification:** Challenge completions are tracked by Kajabi natively. 75 points per completion.

---

### 3C. Monthly Theme

Each month has a theme that all challenges orbit. This creates coherence and makes the community feel like it's moving through something together.

**Example themes:**
- January: *Build* (what are you building this year?)
- February: *Reduce* (what can you cut, simplify, eliminate?)
- March: *Teach* (share what you know)
- April: *Earn* (money wins, income moves, financial systems)
- May: *Grow* (literal and figurative — homestead + business)
- June: *Connect* (relationship building, community, support networks)

**Why this matters:** Themes give new members a way in. It's easier to post when you know what the community is talking about this month.

---

### 3D. Quarterly Celebration Post

When the seasonal leaderboard resets, Jason posts a genuine celebration of that season's contributors.

**Format:**
- *"Season [X] is done. Here's what this community built together..."*
- Stats from GardenΩr: challenges completed, nominations given, new members, top contributors
- Personal shoutouts to top 3 Contribution Score members
- Preview of Season [X+1] theme and what's coming

**Why it works:** Makes members feel like they're part of a story that has chapters. The reset isn't a punishment — it's a new beginning that everyone can participate in equally.

---

## Launch Plan

### Phase 1 — Kajabi Native Setup (Week 1-2)
- [ ] Configure levels and titles (Seedling through Rock Rich) in Kajabi
- [ ] Set up point values for all actions
- [ ] Create and upload all badges
- [ ] Build first 4 weekly challenges (enough for a month)
- [ ] Build Month 1 challenge
- [ ] Post community announcement explaining the system (Jason's voice, casual)
- [ ] Award Founding 50 headstart points (500 each)

### Phase 2 — Ritual Launch (Week 2)
- [ ] First Monday Challenge Drop post
- [ ] Pin the Nomination thread template
- [ ] First Win of the Week (Friday)
- [ ] Set Month 1 theme

### Phase 3 — Kre8Ωr Bridge (Weeks 3-6)
- [ ] Build `community_members` table in SQLite
- [ ] Build Kajabi sync endpoint (daily pull)
- [ ] Build GardenΩr admin panel (`/gardenr.html`)
- [ ] Build Contribution Score calculation
- [ ] Build nomination tracking
- [ ] Build at-risk member alert
- [ ] Build seasonal archive + reset

### Phase 4 — First Seasonal Reset (Month 3)
- [ ] Generate Season 1 archive
- [ ] Publish celebration post with GardenΩr stats
- [ ] Launch Season 2 with updated challenges

---

## What We're NOT Building (and Why)

| Feature | Decision |
|---------|----------|
| Public all-time leaderboard | Permanently discourages anyone not already at the top |
| Points for every login | Creates meaningless daily check-in addiction, not community value |
| Badges for basic participation (e.g. "Posted once") | Badge inflation kills badge meaning |
| Penalty mechanics (losing points) | Loss aversion creates anxiety, not motivation |
| Automated DMs for streaks | Feels pushy; Jason's personal touch is more valuable |
| Complex multi-path skill trees | Over-engineered for this community size and stage |

---

## Kajabi API Notes

- Kajabi Public API available on Pro Plan or as $25/month add-on (Q3 2025)
- Webhooks available for inbound and outbound triggers
- Member data: contacts endpoint returns all members with tags, offers, join date
- Community posts: accessible via API for parsing nominations
- Auth: OAuth2 client_credentials (already connected in AudiencΩr)
- All Kajabi API calls should route through existing `src/routes/audience.js` infrastructure

---

## Open Questions for Jason

1. **Do you want the leaderboard visible to members or just you?** Options: (a) Jason-only admin view, (b) weekly post showing top 3, (c) always-visible in community sidebar. Recommendation: (b) — weekly post keeps it celebratory not competitive.

2. **How many nominations per week should each member get?** Recommendation: 1 keeps it scarce and meaningful. Could be 2 for Founding 50 members.

3. **Should tier membership (Greenhouse vs. Garden vs. Founding 50) affect points?** Options: (a) everyone earns equally, (b) paid tiers earn a point multiplier (1.25x Garden, 1.5x Founding 50). Recommendation: (a) — don't make free-tier members feel like second-class citizens in the gamification system.

4. **What do you want to unlock with points/levels beyond titles?** Options: exclusive content drops, discount codes, early access, direct Q&A access. Recommendation: at Steward level, unlock a monthly "Stewards Circle" live call with Jason. Makes the top tier tangible.

5. **Who manages challenge creation?** Can MailΩr generate challenge prompts via Claude? We could build a "Generate This Week's Challenge" button that uses Jason's voice profile and this month's theme to write 5 options for him to choose from.

---

*Spec written April 2026. Next step: Jason reviews open questions, then Phase 1 Kajabi setup begins.*
