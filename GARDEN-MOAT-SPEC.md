# GARDEN MOAT — Master Spec
**Created:** 2026-06-18 · **Owner initiative:** Rock Rich / Kajabi game (see `KAJABI-GAME-PLAN.md`, memory `project_kajabi_game.md`)
**Spans three repos/properties:** `kre8r` (Kajabi bridge + dashboard) · `kre8r-land` (the tools) · `harvestomr` (The Orchard)

---

## 0. The Thesis
The free→paid conversion engine is live (course → bridge → landing → checkout). What it sells today is honest but thin: a course + a weekly call + community. The **moat** is the value that **can't be screenshotted and shared** — live access, **AI-assisted tools gated to Garden**, and a community where you're **seen**. Building it does four things at once:
1. Makes Garden a **no-brainer at $19** (the real reason people don't cancel).
2. Makes the **v2 landing page honest** so we can ship it (v2 already sells this moat — it's the product spec).
3. Drives Jason's **land-finder commissions** (Land Drop Live + premium Finder).
4. **Unifies the three properties** into one felt product ("Home Base").

**Locked decisions (Jason, Jun 18):** Home Base = build onto The Orchard · cut prediction-market + vouching for v1 · gating source of truth = the Kajabi bridge · the Oracle reads Jason's library (full "Jason voice") · phase order A→B→C→D, E alongside · **hard condition: going-wide free tools on `/links` stay open to everyone, and no cross-tool login fatigue.**

---

## 1. The Three Properties + The Identity Spine
| Property | Domain | Role | Embeddable? |
|---|---|---|---|
| **Kajabi** | `7kinhomestead.com` | Courses, community, live calls, **payments, tier source-of-truth** | ❌ No (blocks framing, we don't own it) — **launch into it** |
| **Land tools** | `7kinhomestead.land` | 5 calculators + Fence (AI) + Land Finder + alerts | ✅ Yes (our domain) — embed or launch |
| **The Orchard** | `rockrich.7kinhomestead.land` | Gamification + identity + **Home Base PWA** | ✅ Ours |

**Identity model:** Kajabi is the **source of truth** for who's a member and what tier. The Orchard already verifies Kajabi membership via the `kre8r` bridge (`POST /api/kajabi/member-check`, internal key). We extend that into a **shared signed tier-token** (§3) so one login flows across every `.land` property. Kajabi keeps its own session (different domain, sticky).

---

## 2. The Tier Matrix (gating is ADDITIVE — nobody loses, members gain)
> Going wide is preserved: **the free version of every tool stays open to the public, no login.** Garden adds a premium layer *on top*.

| | Public (no login) | Greenhouse (free member) | **Garden ($19/mo)** | Founding 50 |
|---|---|---|---|---|
| **The 5 tools** | Free version (going wide) | Free version | **+ saved & emailed plans** | everything |
| **Jason's Take verdicts** | — | 3 sample verdicts | **Unlimited on every parcel** | Unlimited |
| **The Fence (AI Q&A)** | 3/day → email gate | 15/day | **No daily limit** | No limit |
| **Land alerts** | — | alerts on saved searches | **+ Jason's Take in each alert** | + |
| **Land Drop Live** | — | — | **Submit your parcel, reviewed live monthly** | + |
| **Courses** | — | Starting System + Solar mini + books | **+ Out of Your Own Way + every new drop** | + Becoming Rock Rich + lifetime |
| **Live calls** | — | — | **4 weekly + the monthly Land Review** | + |
| **The Orchard** | — | log wins + watch feed + **earn mentee status** | **be a mentor + The Oracle + spotlight priority** | + |

---

## 3. Architecture: The Shared `.land` Tier-Token (the heart of A)
**Problem today:** tools branch on a `?tier=` URL param (spoofable) — anyone can append `?tier=garden`. **Fix:** replace it with a **signed token** that proves tier, minted after a real Kajabi check, shared across `.land` via a parent-domain cookie.

**Flow:**
1. Member opens Home Base (The Orchard) → logs in **once** via magic link (already built).
2. The Orchard calls the Kajabi membership-check (bridge) → gets `tier` (`greenhouse|garden|founding`).
3. The Orchard **mints a signed JWT** (HS256, shared secret in env across `harvestomr` + `kre8r-land`): `{ contact_id, tier, exp }`, ~24h TTL.
4. Sets it as a cookie: `Domain=7kinhomestead.land; Secure; HttpOnly; SameSite=Lax` — valid for the apex **and** every subdomain (incl. `rockrich.`).
5. **Every land tool** runs a `resolveTier()` middleware: read cookie → verify signature → `req.tier`. No/invalid cookie → `public`. The existing tier-branching (Fence `buildSystemPrompt(tier)`, `pickCta(tier)`, verdict visibility) now consumes a **trustworthy** tier.
6. **Re-verify** against Kajabi on token refresh (the Orchard already does a 7-day re-check; mirror it — a lapsed member's next refresh drops them to `public`).

**Why this hits the condition:**
- **Going wide:** no cookie = `public` = the free tool, no login wall. Untouched.
- **No login fatigue:** one magic-link login → cookie on `.land` → **every tool already knows you.** Walk all 5 tools + the Orchard, never log in again.
- **Kajabi seam:** different domain, can't take our cookie; but its session is sticky, so "Courses" almost always just opens. The one login we can't merge — acceptable.

**Kill `?tier=`** as an auth signal (keep it only as a dev override behind an env flag).

---

## 4. Home Base (the PWA hub) — Pillar D
The Orchard graduates from gamification side-app to **the single front door**.
- **Dashboard = launcher.** Tiles: *Your Courses* (→ Kajabi deep link), *This Week's Call / Land Review*, *Your Tools* (embedded or launched, carrying the cookie), *The Community* (→ Kajabi), *Your Wins & Level*, *Ask The Oracle*.
- **PWA:** already has `manifest.json` + `sw.js`. Installable on **iOS + Android** — no App Store, no APK. iOS install is the manual "Add to Home Screen" (reuse the front-gate device-aware coaching); push works iOS 16.4+ once installed.
- **Tools:** embed via iframe where they render well inside Home Base (our domain → we control `X-Frame-Options`), launch in a tab where they need full screen. Either way the `.land` cookie carries the member in.
- **Kajabi:** launched-into (deep link / Kajabi app if installed). Never embedded.

---

## 5. The Five Pillars (build detail)

### Pillar A — Gate the value to Garden  *(FIRST — highest ROI, unlocks v2 + conversion)*
1. Build the tier-token + `resolveTier()` middleware (§3) in `kre8r-land` and the minting in `harvestomr`.
2. Per tool, wire premium to `req.tier`:
   - **Fence:** unlimited when `tier∈{garden,founding}` (limiter already tier-aware — feed the real tier).
   - **Finder:** show `verdict_text` on every listing for garden+ (data already generated by the parser); public/greenhouse see 3 then a nudge.
   - **All calculators:** add **save + email plan** for garden+ (new `saved_plans` table).
   - **Alerts:** include `verdict_text` in the email for garden+ (alerts.js already renders it — gate by recipient tier).
3. Add the soft **"🌿 Unlock with The Garden →"** nudge on premium bits for public/greenhouse (links to `/garden-landing`).
4. **Ship v2 landing** (it's now honest) — swap `/garden-landing` content + repoint the bridge stays as-is.

### Pillar B — AI for Paid Members
- **The Orchard Oracle** (Garden+): Claude-powered mentor that knows (a) the member's Orchard profile (solar setup, animals, goals, biggest obstacle — already captured), (b) **Jason's content library** (RAG over the 190+ transcripts, same pattern as the Fence), (c) the community's collective wins. Use `src/utils/claude` (kre8r) / the land Claude caller. New `harvest_oracle_threads` table. Daily token cap per member (cost control).
- **AI-assist the tools:** feed a member's tool outputs + profile → a **personalized 90-day homestead plan** (turns 5 calculators into one guided advisor). Garden+.

### Pillar C — Mentor↔Mentee Engine  *(the connection flywheel)*
- **Greenhouse EARNS mentee status** by hitting milestones (define: complete profile + finish the Starting System + log ≥3 wins). This *manufactures the mentee supply* AND gives free members a reason to engage (fixes the lurker wall).
- **Garden/F50 = mentors** (opt-in; status + `mentee_milestone:100` pts when their mentee levels up).
- Matching by skill/biome/goal (manual-assisted first, algorithmic later). New `harvest_mentorships` table. Build the **Connect/Reach Out** button (already in the Orchard TODO) as the substrate.

### Pillar D — Home Base unification (see §4)

### Pillar E — Land Drop Live (monthly) + commissions  *(start once A exists)*
- Member submits a parcel (form in Finder/Orchard → `land_submissions` table).
- Monthly **live call**: Jason pulls up member parcels and gives his verdict live. This **is** the dedicated monthly Garden call.
- Drives Finder usage → owner-finance clicks → **Jason's commissions.** Operationally Jason-run; just needs the submission form + a queue view.

---

## 6. The Orchard Build-Out: Keep / Build / Cut
- **KEEP (built, working):** magic-link auth, Kajabi gating, wins/points/levels, feed, directory, nominations, challenges, invites, notifications bell, admin panel.
- **BUILD (priority order):** (1) **tier enforcement** (`requireGarden` middleware — the paywall is currently cosmetic), (2) the token-mint for `.land` SSO (§3), (3) Home Base launcher (§4), (4) the **Oracle**, (5) **Mentor↔Mentee**, (6) Connect button + notification triggers + `mark-read` endpoint, (7) day-2 welcome + Garden/F50 nurture wiring.
- **CUT / DEFER for v1:** Prediction Market, Vouching, Win-of-the-Week, 7/30-day Streaks, IRL-Connection bonus. *(Keep their `points.json` values; just don't build the mechanics — complexity vs. ROI. Revisit after the core moat ships.)*

---

## 7. Data Model Touchpoints
- **`harvestomr`:** `harvest_members.tier` (exists) · new: `harvest_mentorships`, `harvest_connections`, `harvest_oracle_threads`, `land_submissions` · `welcome_email_sent_at` column.
- **`kre8r-land`:** `resolveTier()` middleware (shared JWT verify) · new `saved_plans` (member_id, tool, payload, created_at) · gate `verdict_text` visibility + Fence limits + alert verdicts by `req.tier`.
- **Shared secret:** one signing key in env for both `harvestomr` (mint) and `kre8r-land` (verify).
- **Source of truth:** Kajabi (via the `kre8r` bridge) — never store tier as the only copy; always re-verifiable.

---

## 8. Phased Runbook
- **Phase A — Moat ON:** tier-token SSO + per-tool gating + ship v2 landing. *Converts immediately; reuses the existing bridge + tier-branching.*
- **Phase B — AI:** Orchard Oracle + tool AI-assist (90-day plan).
- **Phase C — Connection:** Mentor↔Mentee engine + Connect button.
- **Phase D — Home Base:** PWA launcher, embed tools, deep-link Kajabi, install coaching.
- **Phase E — Land Drop Live:** submission form + monthly call (anytime after A).
- **Parallel housekeeping:** audit the MailerLite "Rock Rich Greenhouse Welcome Sequence" (8-step), build Garden/F50 nurtures, Orchard notification triggers.

---

## 9. Open Decisions (resolve before building each phase)
1. **Token authority:** The Orchard mints (it owns the magic-link + bridge) — confirm vs. a standalone `kre8r` auth service. *(Rec: Orchard.)*
2. **Tools in Home Base:** embed (iframe) vs. launch-in-tab, per tool — decide case by case during D.
3. **Oracle guardrails:** model tier, per-member daily cap, and how much transcript context to RAG-inject. Cost model before launch.
4. **Mentee milestones:** exact criteria to "earn" mentee status (proposed: profile + Starting System + 3 wins).
5. **Annual Garden offer** ($190/yr, "2 months free") — create in Kajabi to front-load cash + cut churn (the v2 page already has a TODO slot for it). Founding 50 stays open, closing naturally.

---
*Build order is A→B→C→D with E alongside. Phase A is the unlock — it makes Garden real, makes v2 honest, and starts the commission flywheel. Everything else deepens retention.*
