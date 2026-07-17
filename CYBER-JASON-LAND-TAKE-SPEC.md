# Cyber-Jason: "Ask Jason About This One" — Land Take Spec

**Pillar B opener of the Garden Moat** (see `GARDEN-MOAT-SPEC.md`). Turns the Finder from a
calculator into a counselor: cyber-Jason (Claude as Jason, off the 194-transcript voice) gives a
verdict on a specific parcel — generic for the public (bait), **personalized against the visitor's
saved Freedom Number** for Garden/Founding members (the paid unlock).

Built on the A.2 tier-gate shipped Jun 18 2026 (signed `land_tier` cookie → `req.tier` →
server-side enforcement). This is the feature that turns that gate into a money engine.

---

## 1. The core idea

Every land tool today outputs **data** (a number, a list, a score). A person actually wants
**judgment + one next move, in Jason's voice** — what he'd say leaning over the fence. Cyber-Jason
is the layer that converts tool output into a take. The Fence already proves the engine works
(`fence.js` = Claude answering as Jason). This pushes that brain *into* the Finder.

## 2. The three-rung ladder (Jason's "champagne on a beer budget" model)

| Tier | What they get | Ends with |
|---|---|---|
| 🌍 **Public / Greenhouse** (free, going-wide) | Generic take on the **parcel itself** — price, acres, water, road, red flags — charming + useful | **The tease:** "I'm flying blind — drop your freedom number in and I'll tell you if this is smart or champagne on a beer budget." |
| 🌿 **Garden / Founding** (paid) | Same take, **personalized against their saved Freedom Number** — "for your $1,400/mo number, this gets you free in ~3 years" / "beer budget, champagne land, keep looking" | A concrete verdict: smart move vs. trap, + one next action |

The tease lands **at the moment of desire** (they're staring at land they already want). It's the
best Garden pitch possible, running itself on every listing, every visitor, 24/7.

## 3. Gate reconciliation (changes what A.2 gated, NOT how)

A.2 (Jun 18) gated the **pre-written `verdict_text`** to Garden+. The champagne model wants the
**generic take public** (bait) and the **personalized take** as the Garden unlock. The A.2
mechanism (server-side tier enforcement via `req.tier`) is unchanged and reused — we just move
*what* sits behind it. Implementation: the static `verdict_text` can either (a) become the seed for
the public generic take, or (b) be retired in favor of the live generic take. **Decision: lean (a)**
— feed `verdict_text` as context into the generic take so it stays grounded in the batch analysis.

## 4. Architecture (small — pieces already exist)

- **New endpoint:** `POST /api/land/take` in a new `src/routes/land-take.js` (kre8r-land), SSE
  stream like `fence.js`. Mounted in `server.js`, exempt from any auth gate (public-reachable).
- **Reuses:** `callClaudeStream` (`src/utils/claude.js`) + a cyber-Jason system prompt adapted from
  `fence.js buildSystemPrompt` (same voice rules, same hard privacy line — never reveal location).
- **Inputs (request body):** `{ listingId, freedomNumber? }`. Server looks up the listing
  (price, acres, price_per_acre, water, zoning, road, financing, down/monthly, red_flags,
  homestead_score, region, verdict_text) from `land_listings`. `freedomNumber` comes from the
  client's existing `S7` store — the Finder already reads `S7.get('freedom_number')` (finder.html
  ~line 537), so no new data-linking needed.
- **The gate:** server does the **personalized** version only if `req.tier` ∈ {garden, founding}.
  Public/greenhouse get generic + tease even if they POST a `freedomNumber` (server ignores it for
  non-members). Unspoofable — same pattern as the A.2 verdict gate.
- **Client (finder.html):** an "🗣️ Ask Jason about this one" button in the property panel. On click,
  POST `{ listingId, freedomNumber: S7.get('freedom_number') }`, stream the answer into a take card.
  For non-members the tease CTA links to the Garden landing (`/garden-landing`).

## 5. Cost (it's almost nothing)

Per take ≈ 850 input tokens (prompt + listing + number) + ~250 output. On **Sonnet 4.6** (right
voice/price balance; Opus overkill):

| Scenario | Cost |
|---|---|
| One personalized take | ~$0.006 (0.6¢) |
| Garden member @ 50 takes/mo | ~$0.30 / member / month |
| Generic public take | ~$0.006 first view, **cached → free after** |
| ~5,000 cold visitors browsing | a few $ one-time (cache absorbs it) |

Haiku 4.5 ≈ 3× cheaper. A member would need **~3,000 takes/month** to cost $1 — a rounding error vs
$19/mo. *(Confirm exact API rates before launch; order of magnitude is stable.)* Only real risk =
abuse on the public endpoint under a viral spike → handled by **per-listing cache + the daily global
cap `fence.js` already runs** (`fence_daily_*` in kv_store) + per-IP limit.

## 6. Pricing implications

- **Include in Garden, fair-use capped. Do NOT meter / no credits** — metering adds a decision per
  click (violates the reduce-decisions directive) and kills the magic. Cost is far below price; no
  margin reason to nickel-and-dime.
- **Don't raise Garden's price now.** Use this to *fill* Garden at $19 (conversion velocity > +$5/mo).
- Builds the case for an **annual ($190/yr)** once value is felt, and a **new-members-only price
  bump later** (grandfather early members — matches the Founding-50 ethos).
- The monetization is the **tease as a 24/7 in-context salesman**, not a higher sticker price.

## 7. Build order (next session)

1. `src/routes/land-take.js` — endpoint, listing lookup, tier branch, cyber-Jason prompt, SSE,
   per-listing generic-take cache (kv_store), daily/IP caps. Mount + auth-exempt in `server.js`.
2. Cyber-Jason prompt: adapt `fence.js buildSystemPrompt`; two modes (generic + tease / personalized
   verdict). Keep the privacy hard-line. 2–4 sentences, his voice, end forward.
3. finder.html — "Ask Jason about this one" button + take card + SSE consumer; pass
   `S7.get('freedom_number')`; non-member tease CTA → `/garden-landing`.
4. Re-point the A.2 gate per §3 (generic take public; personalized = Garden).
5. Deploy (landapp: `git pull` + `pm2 restart kre8r-land`), test: public = generic+tease,
   Garden = personalized. (Need a garden/founding Orchard login to see the positive case.)
6. Wire the tease into the v2 Garden landing copy ("every piece of land, run past Jason").

## 8. Open decisions

- Model: Sonnet 4.6 (recommended) vs Haiku 4.5 for cost — A/B the voice quality.
- Generic take: button-triggered (controls cost, recommended) vs auto-on-open (more wow, more cost).
- Fair-use cap number for Garden members (e.g. 30–50/day) — generous; just a backstop.
- Greenhouse: pure public (generic only) — confirmed, no personalization for free members.
