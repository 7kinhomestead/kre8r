# PostΩr Third-Party Posting Platform Research

**Date:** June 12, 2026
**Question:** Which third-party posting API should PostΩr use so Jason never deals with platform app reviews again?
**Answer up front:** **Upload-Post** (~$16/mo annual, $24/mo monthly) is the #1 pick. **Zernio** (formerly "Late" / getlate.dev, ~$18/mo for 5 accounts) is the runner-up — and its 2-free-accounts tier means you can test TikTok posting for $0 before paying anyone.

All pricing below was verified on live pages June 12, 2026 — not from memory.

---

## 1. The one fact that decided everything

TikTok's posting API has a built-in rule that no software can route around:

> Unaudited apps can only post **private** ("Only You") videos, max 5 users per day. Public posting requires passing TikTok's audit — and the audit is attached to **whoever owns the developer app**, not the software.

This means:
- **Self-hosted tools (Postiz, Mixpost) do NOT escape app review.** When you self-host, *you* bring your own TikTok developer app — which means *you* do the TikTok audit. That's exactly the purgatory we're trying to leave. Mixpost's own docs admit only their $1,199 Enterprise customers are even eligible to apply for TikTok review. **Self-hosting is eliminated as a category.**
- **Hosted services that already passed TikTok's audit with their own app** are the only real solution. You just click "Connect TikTok," log in, done. Their approval covers you. No review, ever.

Two other ground truths that apply to *every* option:
- **TikTok caps third-party posting at ~15 posts per day per account** (TikTok's rule, not the vendor's). Irrelevant at your volume.
- **Lemon8 has no API. Anywhere.** No official API, no third-party support in any scheduler on the market. Lemon8 stays manual — confirmed, not a maybe.

---

## 2. Comparison table

All five finalists work the same way: **they own the approved platform apps; you just OAuth your accounts on their dashboard.** No app reviews for you on any of them.

| Service | Real cost (your scale) | Platforms (video) | API | TikTok notes | Free path | Risks / caveats |
|---|---|---|---|---|---|---|
| **Upload-Post** ⭐ #1 | **$16/mo annual** ($24 monthly) — unlimited posts, 5 "profiles" (1 profile = one account per platform, covers your whole brand) | TikTok, YouTube (title/tags/thumbnail/privacy), IG Reels/Stories, FB Reels/Stories, + X, Threads, Pinterest, etc. | API-first product. REST + official Node SDK. Best docs of the bunch — full parameter tables per platform | Direct public posting via their audited app. Duet/stitch/comment toggles, draft mode, branded-content flags — matches PostΩr's existing TikTok options 1:1. Documented 25/day cap | Free tier: 10 uploads/mo, no credit card (TikTok excluded from free) | Young company (founded Jan 2025). One competitor alleges reliability issues (no data given) |
| **Zernio** (ex-Late) — runner-up | **$18/mo** for 5 accounts (first 2 accounts **free**, then $6/acct) | TikTok, YouTube, IG, FB + 8 more | REST + SDKs in 8 languages incl. Node. Good docs | Direct public posting; API even exposes your account's allowed privacy levels | **First 2 accounts free forever** — test TikTok for $0 | Rebranded from "Late" in 2026 and burned AppSumo lifetime-deal buyers in the process; one review pegs ~90% post success rate |
| **Post for Me** | **$10/mo** — 1,000 posts, unlimited accounts | TikTok, YouTube, IG, FB + more | REST, developer-oriented | Their credentials or bring-your-own | Not stated | Cheapest, but least track record / least verified depth |
| **Blotato** | $29/mo Starter | TikTok, YouTube, IG, FB + more | API on every paid plan | Direct or draft. Starter caps: 10 posts/TikTok-account/day | 7-day trial — but **API excluded**; creating an API key ends the trial and bills you | AI-content upsell machine; dev API is not the focus |
| **Post Bridge** | **$34/mo** ($29 + $5/mo API add-on) | TikTok, YouTube, IG, FB + more | API is a paid add-on | ⚠️ **Requires converting TikTok to a Business account** — which restricts the commercial music library. Bad trade for a 730k music-using creator | 7-day trial | Business-account requirement is disqualifying for 7 Kin |

### Eliminated

| Option | Why it's out |
|---|---|
| **Postiz** (self-hosted) | Research agent froze twice; moot anyway — self-hosting means bringing your own TikTok app = doing TikTok's audit yourself. Defeats the purpose. |
| **Mixpost** (self-hosted) | Same TikTok problem, made explicit in their own docs (Enterprise-only TikTok review eligibility, $1,199). Plus it's a full PHP 8.3 + MySQL + Redis + Horizon stack bolted next to your Node droplet. |
| **Ayrshare** | $149/mo for 1 profile. Confirmed over budget, as expected. |
| **Buffer** | New GraphQL API launched July 2025 — exists, but still marked "Experimental," no pricing/SLA. Not ready to bet the pipeline on. |
| **SocialBee** | No public API at all (confirmed in their own help docs). |
| **bundle.social** | Free tier is 20 posts/mo, then jumps straight to $100/mo. |

---

## 3. Recommendation

### #1: Upload-Post (~$16/mo)

For a solo creator who hates approvals and posts video to four platforms, Upload-Post fits best:

1. **It's an API company, not a dashboard company.** The API *is* the product — which is exactly the failure mode we're avoiding with Buffer/SocialBee, where the API is an afterthought.
2. **Its TikTok options map 1:1 onto what PostΩr already stores.** Privacy level, duet/stitch/comment toggles, branded-content flags — these are literally the `tt_*` columns already in the `postor_queue` table. The adapter is mostly renaming fields.
3. **YouTube support is full-fat** (title, tags, thumbnail, privacy, scheduling) — so if YouTube's first-party API ever audits or annoys you, PostΩr flips a flag and routes YouTube through the same pipe.
4. **One "profile" covers the whole 7 Kin brand** across TikTok + YouTube + IG + FB. You need 1, the plan includes 5.
5. **$16/mo (annual) is half the $30 ceiling**, unlimited posts.

The honest caveat: it launched January 2025, so it's ~18 months old. That's the trade-off at this price point — every option in the ≤$30 tier is a young company. Mitigation: PostΩr's queue already records per-platform failures (`partial`/`failed` status + error text), so a flaky day shows up in the dashboard instead of silently eating a post. And nothing about the integration locks you in — the adapter pattern (below) makes switching vendors a one-file job.

### Runner-up: Zernio ($18/mo, first 2 accounts free)

Nearly as good on paper, slightly better price flexibility, and the **2-free-accounts tier is the single best validation path in this entire research**: connect your TikTok there today, post one real video through their API, and prove the whole concept for $0. Why it's not #1: the Late→Zernio rebrand burned their lifetime-deal customers (a yellow flag on how they treat existing users), and a third-party review pegged their post success rate around 90% — fine for a hobbyist, sketchy for "never lose the creative thread."

### Strategy note: you don't have to move everything at once

Meta and YouTube **work today** through your own apps. The actual emergency is TikTok. Recommended rollout:
- **Phase 1:** Route only TikTok through the new adapter. Meta/YouTube keep working exactly as they do now. The stuck TikTok app review becomes irrelevant overnight.
- **Phase 2 (optional, whenever):** Flip Instagram/Facebook/YouTube to the adapter too — kills the ngrok tunnel requirement for Meta uploads and retires three OAuth code paths. Do it when one of them next misbehaves, not before.

---

## 4. Integration sketch (what changes in `src/postor/`)

PostΩr's queue processor already loops platforms per queue item and calls a per-platform `uploadVideo`/`publish*` function that returns `{ ok, ... }`. A third-party adapter is just one more module honoring that contract. **No database changes needed** — every field the adapter needs already exists in `postor_queue`.

**New file: `src/postor/thirdparty.js`** (~150 lines)
- `uploadVideo({ platform, videoPath, title, caption, options })` → calls Upload-Post's REST API (multipart file upload — Node `fetch` + `FormData`, consistent with `src/utils/` conventions), returns `{ ok, postId, url }` or `{ ok: false, error }`.
- Reads `UPLOAD_POST_API_KEY` from `.env`.
- Because the file uploads directly (multipart), **no ngrok tunnel needed** for anything routed through it — unlike Meta's URL-based flow.

**Changed file: `src/postor/queue-processor.js`** (~15 lines)
- In the platform loop, each platform branch checks a routing flag (e.g. `POSTOR_TIKTOK_PROVIDER=upload-post` in `.env`) and calls `thirdparty.uploadVideo(...)` instead of the first-party module. Existing watermarking, status logic (`posted`/`partial`/`failed`), and publish fan-out are untouched.

**Changed file: `public/postor.html`** (small)
- TikTok connection card changes from the OAuth flow to: "Connected via Upload-Post — manage at upload-post.com" + a test-connection button.

**Untouched:** `tiktok.js` stays in the repo (dormant) in case the first-party review ever clears; `meta.js`, `youtube.js`, `video-tunnel.js` keep working as-is for Phase 1.

**Effort estimate:** half a day for Phase 1 (adapter + TikTok routing + UI card), including a real end-to-end test post. Phase 2 is another couple of hours per platform, mostly testing.

---

## 5. Upload-Post full feature surface (added after follow-up research)

Beyond posting, the API exposes (verified in docs.upload-post.com June 12, 2026):

**Publishing**
- Video upload (`POST /api/upload`), photo/carousel upload, text posts — 12+ platforms
- Scheduled posting + upload-status polling (`GET /api/uploadposts/status`) + paginated upload history
- Auto-adaptation of video format per platform (FFmpeg server-side)

**Analytics (the intel-loop part)**
- `GET /api/analytics/{profile}` — profile metrics across platforms in one call: followers, reach, views, impressions, profile views, likes, comments, shares, saves
- `GET /api/uploadposts/total-impressions/{profile}` — cross-platform impressions, deduped per platform's primary metric; supports `last_day`/`last_week`/`last_month`/`last_3months`/`last_year` and custom date ranges
- `GET /api/uploadposts/post-analytics/{request_id}` — per-post metrics for posts published through them
- `GET /api/uploadposts/post-analytics?platform_post_id=` — **per-post metrics for ANY post, including organic/historical posts never touched by Upload-Post.** This is the headline: TikTok/IG/FB metrics for the existing back catalog become available to NorthΩr/VectΩr through one API key — no TikTok analytics API approval, no Meta insights app review.
- Covers TikTok, Instagram, Facebook, YouTube, X, Threads, Pinterest, Reddit, Bluesky

**Engagement / automation (Instagram)**
- Read comments, reply, send DMs, list DM conversations
- "AutoDM monitors" — auto-DM people who comment on a post (the comment-to-DM funnel pattern; relevant to ROCK RICH lead capture if IG becomes a funnel)

**Misc**
- Facebook Pages / LinkedIn pages / Pinterest boards / Google Business location listing endpoints
- White-label JWT user management (multi-tenant — irrelevant now, but it's there)
- n8n / Make / Zapier / Airtable integrations + dashboard UI

**Intel-loop fit:** MirrΩr is currently YouTube-only because YouTube was the only analytics API Kre8r could access. Upload-Post's analytics endpoints would let a single nightly sync pull TikTok + IG + FB + YouTube numbers into the same `posts`/analytics tables NorthΩr and VectΩr already read — including backfilling historical TikTok posts by video ID. That's a bigger strategic win than the posting itself.

**Caveat to verify on the free tier:** the docs don't state which pricing plan gates analytics (no gating is mentioned anywhere, and third-party reviews describe "scheduling + analytics in one API," but confirm metrics actually return on the entry plan during the trial). Also expect per-platform freshness differences — these are wrappers over each platform's native insights APIs.

## 6. Validate before paying — $0 test plan

1. **Zernio free tier (today, $0):** Sign up, connect TikTok (1 of 2 free accounts), post one real video through their API from a 20-line Node script. This proves the entire "third party posts publicly to my TikTok, no app review" concept costs nothing.
2. **Upload-Post free tier ($0):** 10 uploads/mo free, no card — test YouTube/IG/FB posting and API ergonomics. (TikTok is excluded from their free tier, which is why step 1 uses Zernio.)
3. **Decision point:** If both work, pay Upload-Post ($24 for one month, monthly — don't commit annual until a month of real posts clears) and build the adapter. If Upload-Post disappoints in testing, Zernio is a drop-in alternative — the adapter pattern means switching is a one-file change.
4. **Cancel-anytime check:** both are month-to-month with no lock-in at the monthly tier.

---

## Sources

Key claims verified June 12, 2026 on live pages: TikTok unaudited-app rules (developers.tiktok.com content-sharing-guidelines + content-posting-api docs), Upload-Post pricing/docs (upload-post.com, docs.upload-post.com), Zernio pricing/rebrand (zernio.com/pricing, zernio.com/rebrand), Post Bridge API add-on + Business-account requirement (support.post-bridge.com), Blotato pricing/API trial exclusion (blotato.com/pricing, help.blotato.com), Post for Me (postforme.dev/pricing), Ayrshare (ayrshare.com/pricing), Mixpost TikTok/Enterprise docs (docs.mixpost.app), Buffer GraphQL API (developers.buffer.com), SocialBee no-API confirmation (help.socialbee.com), Lemon8 absence (no developer portal; no scheduler support found anywhere).
