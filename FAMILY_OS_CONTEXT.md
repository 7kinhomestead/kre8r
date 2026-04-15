# Family OS — Claude Code Session Context
## Project Bootstrap Document

*Written by Claude at the end of Kre8Ωr development (Sessions 1–39) to transfer everything
learned into a new project. Drop this file as context at the start of every session.*

---

## What This App Is

A **Family Operating System** — a mobile-first app that turns the beautiful chaos of running
a large family (wife, 5 kids, a homestead, a business, and aging parents) into a coordinated,
gamified, low-friction experience. Less arguments. More wins. Everyone on the same page without
anyone having to be the manager.

**The core insight:** The same cognitive overload that kills creative momentum in content creation
kills family harmony. Too many decisions, too much state living in one person's head, too many
dropped balls. The same principles that built Kre8r apply here.

**The creator:** Jason Rutland — 7 Kin Homestead. Off-grid family, 700 sq ft house, 5 kids,
wife Cari. Two parents whose memories are at capacity. A business. A homestead. And a genuine
belief that this can all be a game worth playing, not a burden to survive.

---

## The Problem It Solves

Current family pain points to eliminate:

1. **"Why didn't you pick that up when you were at the store?"** — No one knew it was needed
   or that someone was nearby.
2. **"I told you about that three times."** — Information lives in one person's head and dies there.
3. **"Whose turn is it?"** — Chore/task ambiguity creates arguments.
4. **"I forgot."** — Especially for grandparents with memory overload. Gentle, non-condescending
   reminders.
5. **"We need this but I don't know where to get it cheapest."** — Uncoordinated shopping.
6. **Schedule collisions** — Double-booked vehicles, activities, people.
7. **No one sees the whole picture** — Everyone operating in their own silo.

---

## Core Feature Set (Prioritized)

### Tier 1 — Must Have at V1

**Shared Lists (Living Lists)**
- Shopping list, errands, household needs — shared and real-time across all family members
- Items have: name, quantity, category, urgency, estimated price, preferred store
- Anyone can add, check off, or comment
- Lists never "complete" — checking off an item archives it, doesn't delete it (history matters)

**Location-Aware Alerts**
- When a family member is near a store where a needed item is available, they get a nudge
- "You're 0.3 miles from Tractor Supply — they have the cheapest chicken feed on your list"
- Proximity threshold is configurable per person (some don't want constant pings)
- Uses device GPS — opt-in per family member
- Store database: manual entry first (user adds their regular stores), Google Places API later

**Schedules + Coordination**
- Shared family calendar — who is where, when, with what vehicle
- Resource conflicts flagged automatically: "Both Jason and Cari need the truck on Thursday"
- Kid schedules — school, activities, appointments
- Grandparent version: simplified view, large text, essential reminders only

**Family Todo / Chore Engine**
- Tasks assigned to people or left in a pool to be claimed
- Recurring tasks with frequency (daily/weekly/monthly/seasonal)
- Homestead task categories: animals, garden, maintenance, house, business, school
- Task completion logged — who did it, when

**Gamification Layer**
- Every completed task = points
- Family-wide leaderboard (friendly competition, not punitive)
- Streaks: "Cari has done morning chores 12 days in a row 🔥"
- Weekly family score — did we hit our goals as a team?
- Achievements: "First 100 tasks", "Perfect Week", "Errand Ninja" (caught by location alert)
- Kids especially — make it feel like a game, not a job

### Tier 2 — V1.1

**Smart Shopping Price Comparison**
- When an item is added to the list, app searches local store prices
- Sources: manually entered price history, Google Shopping API, or store-specific APIs
- Suggests cheapest option within reasonable distance
- "Walmart has it for $4.99, Rural King has it for $3.49 (6 miles further)"

**Memory Assist (Grandparent Mode)**
- Simplified interface: large text, high contrast, minimal options
- Daily summary pushed to their phone: "Today: doctor appointment at 2pm, pick up Eli at 3:30"
- Gentle recurring reminders for medications, calls, tasks
- Family can add reminders for them without them needing to manage the app

**Communication Layer**
- Quick family broadcast: "Dinner at 6, everyone home"
- Task comments: notes on a chore without a full messaging thread
- NOT trying to replace iMessage — just the operational stuff

**Homestead Inventory**
- Track what you have (feed, seeds, medications, supplies)
- Low stock alerts — "Chicken feed drops below 50lbs, alert Jason"
- Batch tracking (when did we buy it, how long does it last)

### Tier 3 — Future

- Vehicle maintenance tracking (oil changes, tire rotations)
- Budget tracking per category
- Integration with local store loyalty programs
- Kid learning/homeschool tracking
- Seasonal planning (planting calendar, harvest schedule)
- Business/homestead crossover task management

---

## Tech Stack (Same as Kre8Ωr — proven, don't change what works)

```
Runtime:    Node.js 18+
Server:     Express.js on port 3000
Database:   SQLite via better-sqlite3 (synchronous, WAL mode)
AI:         Anthropic Claude API (claude-sonnet-4-5 or latest)
Frontend:   Vanilla HTML/CSS/JS — NO frameworks
Mobile:     Progressive Web App (PWA) first, Electron for desktop later
            Service workers for offline + push notifications
Auth:       Session-based (express-session + SQLite session store)
Process:    PM2 for dev, Electron for desktop distribution
```

**Why this stack again:**
- Jason built Kre8r in 3 weeks with zero prior coding experience on this stack
- No build step = instant feedback loop
- SQLite is shockingly capable for family-scale data
- Claude API does the heavy lifting for intelligence
- Vanilla JS means Claude can write and reason about every line without framework magic

**New additions needed vs Kre8r:**
- Geolocation API (browser/PWA) — location tracking with permission
- Service Workers — background location monitoring + push notifications
- WebSockets or SSE — real-time list updates across family members
- Google Places API (optional) — store lookup and distance
- Push Notification API — family alerts

---

## Design System

### Same as Kre8Ωr with ONE key difference: WHITE/LIGHT background

```css
/* Light mode — same accent colors, inverted background */
--bg:        #f8faf8;     /* near-white with a breath of green */
--bg-card:   #ffffff;
--bg-card-2: #f0f4f0;
--bg-deep:   #e8ede8;

--border:        #d4dcd4;
--border-bright: #b8c8b8;

--text:       #1a1f1a;    /* near-black */
--text-dim:   #4a5a4a;
--text-dimmer: #8a9a8a;

/* SAME accent colors as Kre8r — brand continuity */
--teal:      #14b8a6;
--teal-dark: #0d9488;
--teal-glow: rgba(20,184,166,0.10);

--red:   #dc2626;
--amber: #d97706;
--green: #16a34a;

--radius:    10px;
--radius-sm: 6px;

/* SAME fonts as Kre8r */
/* Bebas Neue — section headers, hero text */
/* DM Sans — body, labels, everything else */
```

**Design principles:**
- Clean, airy, domestic — not dark and cinematic like Kre8r
- Cards have soft shadows, not glowing borders
- Color is used sparingly — teal for action, green for complete, amber for attention
- Mobile-first grid (1 col on phone, 2-3 col on tablet/desktop)
- Large tap targets — kids and grandparents use this
- No jargon — "Shopping List" not "Acquisition Queue"

---

## Prime Directives (adapted from Kre8r)

### Prime Directive
**Never lose family state. Never drop a ball without a recovery path.**

A shopping item added at 11pm must still be there at 9am when someone's at the store.
A reminder set for grandma must fire even if the app hasn't been opened in two days.
A chore logged by a kid must appear on Jason's dashboard instantly.

Ask of every feature and every failure mode: *if this goes wrong right now, what does the
family lose, and how do they get it back?*

### Secondary Directive
**Does this reduce friction, or add it?**

Every screen, every tap, every notification: is it reducing the cognitive load of running
a family, or is it adding to it? If it adds friction — redesign it.

The app must be faster than texting. If "just text Cari" is easier than using the app,
the app has failed.

### Tertiary Directive (new — not in Kre8r)
**No one should have to be the family manager.**

The system does the coordination. No one person carries the mental load. The app is the
external brain that holds the state — not Cari, not Jason.

---

## Architecture Principles (Learned from Kre8r)

### Engine vs Soul
Config is separate from logic. A `family-profile.json` holds:
- Family member list (names, ages, roles, phone numbers, notification preferences)
- Home location + coordinates
- Regular store list (name, address, lat/lng, categories it covers)
- Gamification settings (point values, streak rules)
- Grandparent mode config

The engine never hardcodes any of this. This is also the foundation for future
multi-family (multi-tenant) deployment if this ever becomes a product.

### One Route File Per Module
```
src/routes/
  lists.js        — shopping + errand lists
  tasks.js        — chores + todos
  schedule.js     — calendar + events
  location.js     — proximity alerts, family locations
  gamification.js — points, streaks, achievements
  family.js       — members, roles, settings
  notifications.js — push + in-app alerts
  inventory.js    — homestead supplies
```

### Database First
Design the schema before anything else. SQLite with WAL mode handles concurrent
readers fine (multiple family members reading simultaneously).

Key tables:
- `family_members` — id, name, role, phone, notification_prefs, location_consent
- `lists` — id, name, type (shopping/errand/todo), created_by
- `list_items` — id, list_id, name, qty, category, store_pref, status, assigned_to
- `tasks` — id, title, category, recurrence, assigned_to, points, status
- `task_completions` — id, task_id, completed_by, completed_at, points_awarded
- `events` — id, title, start_at, end_at, attendees, resources (vehicle etc)
- `stores` — id, name, address, lat, lng, categories
- `item_prices` — id, item_name, store_id, price, recorded_at
- `notifications` — id, member_id, type, message, sent_at, read_at
- `achievements` — id, member_id, achievement_key, awarded_at

### Shared Utilities (copy pattern from Kre8r)
```
src/utils/
  claude.js      — shared Claude API caller (callClaude(prompt, maxTokens))
  logger.js      — pino logger
  sse.js         — SSE helper for real-time updates
  push.js        — web push notification helper
  geo.js         — distance calculations, proximity checks
  profile-validator.js — load + validate family-profile.json
```

### CRITICAL: DB Write Rule
Same as Kre8r — never edit the .db file directly while server is running.
All reads/writes go through the live API. SQLite WAL lock will corrupt data.

---

## Working With Jason — What Claude Needs to Know

### Background
- **Zero prior coding experience** when he started Kre8r
- Built a full production app in ~3 weeks with Claude Code
- Now has strong intuition for what's possible and how the system works
- Thinks in systems, not in code — describe what you want, not how to implement it
- Will catch logical inconsistencies fast but trusts Claude on implementation details

### Working Style
- **Reads the CLAUDE.md bible first** — don't re-explain the stack or architecture
- **Iterates fast** — show results, then polish. Don't over-plan before building.
- **Excited by feature momentum** — keep the creative thread moving
- **Notices when something feels wrong** even if he can't name why — trust that instinct
- **Doesn't like being asked about optional parameters** — make a reasonable choice and go
- **Only ask about credentials and file paths** — everything else, decide and build

### Communication Style
- Direct and conversational — not corporate
- Jokes around, tells stories — match that energy
- When something is working: confirm what was built, what it does, move on
- When something is broken: name the root cause clearly, fix it, don't over-explain
- Goes off on productive tangents (like this new app) — follow them, they're usually important
- Thinks out loud — the best ideas come mid-conversation

### Project Management Style
- `CLAUDE.md` — the project bible. Read it at every session start.
- `SESSION-LOG.md` — log what was built each session. Critical for continuity across context windows.
- `TODO.md` — living roadmap. Update it as things get built and new ideas come in.
- `DEVNOTES.md` — critical technical notes. Write gotchas here as you discover them.

### What Works Well
- Build the thing, show it, iterate — don't design forever
- One feature at a time, fully working before moving on
- Commit at end of every session
- Name things in the same brand voice as the app (fun, intentional names)
- The Prime Directive framing — it cuts through any feature debate instantly

### What Doesn't Work
- Asking too many clarifying questions before building
- Over-engineering before there's a reason to
- Leaving partial implementations with TODOs
- Re-explaining things that are already in the CLAUDE.md
- Suggesting rewrites of things that already work

---

## Lessons Learned Building Kre8r (Apply to Every Project)

### Session Management
- **Context windows run out** — plan for it. SESSION-LOG.md is the handoff document.
- End every session with: what was built, what's broken, what's next.
- The CLAUDE.md should be dense but readable — it's the first thing read every session.
- When a session summary is passed in, jump straight back in — don't recap, don't acknowledge.

### Database Lessons
- **SQLite WAL mode is remarkably capable** — don't reach for Postgres until you have a reason
- **Migrations via column existence checks** — `pragma('table_info')` before ALTER TABLE
- **UNIQUE constraints** save you from duplicate data bugs that are hard to debug later
- **JSON fields in SQLite** are fine for structured-but-variable data (brief_data, connections)
- **Foreign keys with ON DELETE CASCADE** — always set them. Silent orphan data is nasty.
- **Never use `DELETE` for user data in early versions** — soft delete (status = 'archived') first

### API + Routes Lessons
- **SSE for anything that takes >2 seconds** — never block an HTTP response
- **One route file per module** — when routes.js hits 300 lines, split it
- **Validate inputs at the route level** — don't let bad data reach the DB
- **Consistent error format** — always `{ error: "message" }` on failure
- **POST for actions, PATCH for updates, DELETE for removal** — don't get creative with HTTP verbs

### Claude API Lessons
- **Always pass explicit maxTokens** — never rely on defaults
- **One shared callClaude() utility** — never inline fetch calls to the API
- **Claude as a parser is extremely reliable** — use it to extract structure from messy text
- **Ask Claude for JSON, validate the response** — always use `match(/\{[\s\S]*\}/)` or `match(/\[[\s\S]*\]/)` to extract
- **Rate limiting is real** — add delays between batch operations, cap concurrency at 3
- **Prompt quality compounds** — invest in good prompts early, they pay dividends on every call

### Frontend Lessons
- **Vanilla JS is enough** — no React, no Vue, no build step
- **SSE event streams** from the server keep the UI alive during long operations
- **Toast notifications** (3 second auto-dismiss, bottom center) — standard feedback pattern
- **Skeleton screens** on load — better UX than spinners for data-heavy pages
- **Mobile-first CSS** — start with 1-col layout, add breakpoints for larger screens
- **Shared nav component** (nav.js) — one file, injected into every page. Update once, everywhere updated.

### Electron Lessons (for desktop distribution)
- **native modules (better-sqlite3) need rebuilding** for Electron's Node version — `npmRebuild: false` + prebuild script
- **Session persistence** — use 30-day cookie expiry in Electron (detect via User-Agent)
- **User data paths** — never write to the app bundle. Use `app.getPath('userData')` for DB, config, logs.
- **Diagnostic error dialog** on startup failure — users can't open a terminal to see errors
- **First-run wizard** — API key, folder config, initial setup. Skip on subsequent launches.

### Architecture Lessons
- **Start with the schema** — if the data model is right, everything else follows
- **Prime Directive first** — before any feature is designed, ask: what does the user lose if this fails?
- **Don't hardcode anything creator/family-specific** — it always needs to change later
- **Feature flags beat dead code** — if a feature isn't ready, hide it rather than break it
- **One source of truth** — if a value lives in two places, they will disagree

---

## Session Start Checklist (For New Project)

1. Read this document fully
2. Read `SESSION-LOG.md` for what was done last session
3. Read `TODO.md` for current priorities
4. Check server status: `pm2 status` (or check Electron app is running)
5. Tell Jason current state and ask what to hit first

---

## Naming Conventions (For This App)

Following the Kre8Ωr pattern — Omega (Ω) as a suffix, creative spelling:

Suggestions (Jason to pick):
- **KinΩS** — Family OS, "Kin" ties to 7 Kin Homestead
- **HomeΩr** — Homestead + Homer (wanderer, storyteller)
- **HearthΩr** — Hearth = center of the home, warmth
- **OrdΩr** — Order out of chaos

Module names could follow the same Ωr pattern:
- ListΩr — shopping + errand lists
- TaskΩr — chores and todos
- HerdΩr — tracking where everyone is
- StockΩr — homestead inventory
- PointΩr — gamification + leaderboard
- RemindΩr — alerts + memory assists
- CalΩr — schedule + calendar

---

## The Big Picture

Jason built Kre8r — a professional content production OS — in 3 weeks with no prior coding
experience, using Claude Code. That is not a small thing.

The same approach — clear Prime Directive, lean stack, one module at a time, iterate fast —
will build this Family OS just as fast.

The difference: Kre8r is a solo tool. This app has multiple users with different roles,
real-time sync needs, mobile-first requirements, and location services. Those aren't harder
problems — they're different ones. And Claude has solved all of them many times.

The goal: six months from now, the Rutland family runs smoother, arguments are fewer, grandma
gets her reminders, the kids earn points for feeding the chickens, and nobody misses the cheap
chicken feed because they were 0.3 miles from Rural King and didn't know it was on the list.

That's worth building.

---

*This document was generated at the end of Kre8Ωr Session ~39 to bootstrap the Family OS project.*
*Keep it updated as the project evolves — it is the institutional memory of the build.*
