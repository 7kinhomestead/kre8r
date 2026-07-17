# Kre8Ωr — Opus Review V3
*Pre-co-founder review. Prepared 2026-05-28. Focus: correctness, multi-tenancy, architecture, workflow logic, security, gaps.*

---

## Executive Summary

The system has grown substantially since V2 (April). Multi-tenancy is no longer scaffolding — it's a working architecture: `AsyncLocalStorage` tenant context (`src/utils/tenant-context.js`), per-tenant SQLite files under `tenants/{slug}/`, subdomain routing in `server.js:225–240`, Bearer-token sync API (`src/routes/sync.js`), and a tenant DB cache (`src/utils/tenant-db-cache.js`). The pipeline has gained Post-Mortem, VectΩr strategic sessions, AffiliateΩr, MarkΩr/GuardΩr, BrollΩr, VisualΩr, and TikTok publishing. better-sqlite3 + WAL has held up across sessions. Structured logging (pino) is in place. Backups exist (Electron rolling + DO daily cron).

What's genuinely strong: the **tenant context layer is the right shape** — a one-line `_activeDb()` indirection that every existing query inherits without rewriting the route layer. The **AssemblΩr 2-call architecture with model overrides** and the **calibration loop** (MirrΩr → VectΩr → Id8Ωr/WritΩr prompt injection) are real differentiators, not just claims. The **Post-Mortem + Studio Intel + VectΩr** triumvirate is a learning system most well-funded competitors don't have.

The three biggest concerns Trav will probably hit on:
1. **Multi-tenancy is wired but never actually tested with a second live tenant.** The plumbing exists; the integration risk is huge (singleton modules, in-memory queues, file paths, env-var API keys are all global).
2. **OAuth tokens are stored plaintext** in `platform_connections` (`src/db.js:5509–5530`). Acceptable for a single-creator desktop app. Not acceptable as a multi-tenant SaaS — and it's also the easiest fix to demo.
3. **In-memory queues with no persistence** (transcribe-queue, frame-analysis-queue, postor queue). Server restart silently loses pending work. For Jason today: tolerable. For 10 beta users: ticket generator.

Everything else is repairable, normal-for-stage technical debt. None of it is architectural rot.

---

## 1. Code Correctness & Silent Failure Risks

🔴 **`src/db.js:2688` `searchFootageByWhere(whereClause)` — Claude-generated SQL is interpolated into the query.** The sanitizer (`/;|--|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b/i`) is a blocklist, not a whitelist, and it can be bypassed trivially (`/**/UPDATE`, nested CTEs in SQLite, `ATTACH DATABASE`, `PRAGMA writable_schema=1`, `REPLACE INTO`, comments `--` survive because they're regex-escaped not stripped). Even though Claude is the source today, this is also reachable from any user query string that gets sent to `buildWhereClause`. **Fix**: parse the AST or use a strict allowlist of column names + operators; even simpler, have Claude return structured JSON `{filters: [{col, op, val}]}` and build the SQL server-side.

🔴 **`server.js:244` `SESSION_SECRET` falls back to a hardcoded string** (`'kre8r-session-secret-change-in-production'`). On any deployment that forgot to set `SESSION_SECRET`, every session can be forged. This needs to fail-fast on boot, not silently use a known string. Same problem applies in Electron mode — every desktop install would share the same fallback if env var is missing.

🔴 **`src/postor/queue-processor.js:158` — the queue runner has no overlap guard.** `setInterval(() => run(), 60_000)` plus an `await processItem` inside `run` means if a single upload takes > 60s (Instagram regularly does), the next tick starts a parallel `run()`. Combined with `db.getPendingQueueItems()` not transactionally claiming rows, **the same scheduled post can fire twice on slow uploads.** Fix: track a `running` flag at the top of `run()`, or transactionally update status to `'posting'` before yielding.

🟡 **`src/db.js:2151 _activeDb()` resolves on every query.** Cheap, but if `tenantContext.run(...)` isn't active (e.g. a background timer fires outside any request), it silently falls back to Jason's singleton DB. The `postor` queue processor, `scheduleMorningSync`, `scheduleVectrAutoRun`, the chokidar watcher, and the transcribe/frame queues all run **outside any tenant context** — they will operate on Jason's DB even on multi-tenant hosts. This is a correctness bomb for multi-tenancy.

🟡 **`src/utils/claude.js:153,254` — `require('../db').logTokenUsage(...)`** is inside a `try { } catch (_) {}` that swallows everything. Token-cost tracking will silently zero out under any DB hiccup, and you won't notice until pricing decisions are wrong.

🟡 **`src/vault/transcribe-queue.js:42 processing` boolean vs `frame-analysis-queue.js:64 activeCount` integer** — these queues use different concurrency models. The transcribe queue can't be parallelized later without rewriting the state model. Fine for now, note for refactor.

🟡 **`src/vault/watcher.js:211–223`** kicks off `transcribeFile` directly (not the queue) for social clips, **outside any tenant context, with no concurrency limit.** A folder drop of 30 social clips will spawn 30 concurrent Whisper processes, each ~2 GB RAM. Fix: route through `txQueue.enqueue`.

🟡 **`src/utils/sse.js:80–84`** explicitly doesn't end `res` on client disconnect — the comment says "job may still be running." But there's no upper bound on how many disconnected SSE clients a long job can accumulate references for. If a creator F5s a 6-minute transcription 10 times, the job emits 10× the events. Add explicit listener removal or a TTL.

🟡 **`src/postor/meta.js:225` `fs.readFileSync(videoPath)`** for Facebook video upload loads the whole video into RAM. A 4 GB upload will OOM a 4 GB droplet. Stream it.

🟢 **`src/postor/meta.js:179` "check Electron log for status details"** — error message leaks UI assumption into the API layer. Unhelpful when Instagram fails in server mode.

🟢 **`src/vault/intake.js:80 VisionQueue` is module-level singleton.** Multi-tenant: two creators ingesting at once share the 3-slot rate limit. Probably correct behavior (it's protecting your shared API key), but worth being explicit.

🟢 **JSON.parse without try/catch** appears in places but most external/AI-source parses are wrapped (claude.js, intake.js). I spot-checked writr/id8r/postor — 23 JSON.parse calls, the AI-source ones are wrapped. The risk pockets are `setPostorConnection.extra_data` round-tripping and any `kv_store` reads that assume valid JSON.

---

## 2. Multi-Tenancy — Honest Assessment

**What's real:**
- `tenant-context.js` (54 lines, AsyncLocalStorage) — clean.
- `tenant-db-cache.js` — per-slug DB instance cached after first open, applies schema + `bootstrapTenantTables`. Per-tenant `creator-profile.json` and `.env` stub.
- `server.js:225–240` subdomain detection (`slug.kre8r.app`) → `tenantContext.run({ db, profile, slug }, next)` wraps the whole request.
- `_activeDb()` in `src/db.js:2151` — every `_get/_all/_run` automatically routes to the active tenant. The thousands of existing queries inherit this with zero rewrites.
- `sync.js` Bearer-token API with `tenants` table, sync token, per-tenant snapshot files.
- `tenant-webhook.js` for tenant-scoped Kajabi webhooks.
- `auto-register first tenant` in `server.js:967–993` — first boot creates `7kin` tenant + sync token automatically.

**What's scaffolding / hasn't been pressure-tested:**

1. **Singleton modules that bypass tenant context** (the biggest gap):
   - `src/vault/watcher.js` runs once at boot, points at `creator-profile.json` (Jason's), and writes via the singleton `db`. There is no per-tenant watcher.
   - `src/vault/transcribe-queue.js` and `frame-analysis-queue.js` — single in-process queue, no tenant awareness. A queued job for tenant B will get its DB write routed through whatever context is active when the timer fires (none → Jason's DB).
   - `src/postor/queue-processor.js` runs `setInterval` outside any context → `db.getPendingQueueItems()` returns Jason's queue only.
   - `scheduleMorningSync` and `scheduleVectrAutoRun` similarly tenant-blind.
   - VaultΩr SSE broadcasters (`sseClients` Set) are global — tenant B's vault page would receive tenant A's ingest events.

2. **Process-global env vars are shared across all tenants:**
   - `ANTHROPIC_API_KEY`, `MAILERLITE_API_KEY`, `META_APP_ID/SECRET`, `KAJABI_*`, `NGROK_AUTHTOKEN`, `INTERNAL_API_KEY`, `OPERATOR_SECRET` — all read via `process.env` everywhere. The tenant `.env` stub in `provisionTenant()` writes a file but **nothing ever loads it.** Multi-tenant SaaS will need per-tenant API key resolution; this isn't wired.
   - `getAuthUrl` / `exchangeCode` in `meta.js` use the platform-global Meta app — fine — but the OAuth callback writes to `platform_connections` via `_activeDb()`. On tenant subdomain hosts this works; on `kre8r.app` it writes to Jason's row. **There is no tenant-aware OAuth state.**

3. **Filesystem paths:**
   - `THUMBNAIL_DIR = public/thumbnails` (intake.js:34), `UPLOAD_DIR`, `TRANSCRIPTS_DIR`, `database/whisper-model-cache`, `public/animr-renders/` — all global. Two tenants ingesting clips named `IMG_0001.MOV` will collide on thumbnail filenames. Hash-prefixing is partly there for ingest IDs, not for thumbnails.
   - `creator-profile.json` is loaded via the validator (which reads `process.env.CREATOR_PROFILE_PATH`) in places, but `src/vault/watcher.js:24` reads it directly with no tenant lookup.

4. **No tenant in session.** Auth doesn't pin sessions to a tenant. The pattern works because subdomain → context, but a user logged into `tenantA.kre8r.app` and then navigating to `tenantB.kre8r.app` would carry the same session cookie. Cookies are scoped to `kre8r.app` (the `secure:false, sameSite:'lax'`), so cross-tenant session leakage is real if you ever have multiple beta tenants live.

**The concrete gap, in one sentence:** request-driven routes are tenant-isolated; *anything that runs on a timer, watcher, queue, or external callback is not.* That's the work between "the plumbing is in" and "a second creator can actually use this tomorrow."

**Honest estimate of the gap to onboard tenant #2:** 2–4 sessions. Wire the queues + watcher + queue-processor + cron jobs to iterate over all tenants and `tenantContext.run` per tenant, plumb per-tenant ANTHROPIC_API_KEY, fix thumbnail path collisions, add tenant-aware OAuth state. None of it is hard; it just hasn't been done because there's only ever been one tenant.

---

## 3. Architecture & Scalability

**better-sqlite3 + WAL** — correct call. Holds at single-digit GB DBs with a handful of writers. Multi-tenant approach of one DB per tenant is *better* than one shared DB with `tenant_id` columns: blast radius is bounded, backups are per-tenant atomic, vacuums are isolated. The ceiling becomes filesystem-level, not DB-level. Trav will respect this choice.

**SQLite session store via custom `SQLiteStore` class** (`server.js:124–193`) — fine, uses `express_sessions` table. The `console.log` on every session get/set is a code smell that's going to flood production logs. The 15-minute prune is fine. Real issue: sessions live in the singleton DB, so on multi-tenant hosts all sessions share one table — a single hot tenant could starve writes.

**Queue persistence** — `transcribe-queue.js` and `frame-analysis-queue.js` are explicit about being in-memory only ("server restart clears the queue"). The DB serves as the eventual record of completion, but if Jason restarts mid-batch, anything not yet processed is silently lost. For a paid product, you need either a persistent queue (one more table) or an idempotent restart that re-scans for unanalyzed footage on boot — which `getUnanalyzedFootage` would actually support.

**`spawn` vs `utilityProcess.fork`** — V2 asked about this. The answer became `utilityProcess.fork` (electron/main.js:98). Correct choice: avoids node ABI mismatch with better-sqlite3, gets free IPC, no separate node sidecar. Good call.

**ngrok tunnel per upload** (`src/postor/video-tunnel.js`) — works because Instagram needs a public URL and Meta won't accept multipart for IG. Won't scale beyond ~5 concurrent uploads (free ngrok tier) and requires every desktop install to have an ngrok authtoken — not a great onboarding step. Long-term, this should become a server-side relay (cloud-hosted) that the desktop streams to, especially if you go SaaS.

**Frontend coupling to Electron** — `window.__KRE8R_ELECTRON` checks scattered across HTML files. Fine for V1; needs feature-flag abstraction before the web-hosted version of any module ships, otherwise web users see broken UI for DaVinci/VaultΩr-watcher/PostΩr-upload.

**Vanilla HTML/CSS/JS frontend (~30 pages)** — fine for solo dev, ages well, no build step to break. The cost is duplication: every page reimplements forms, state, error toasts. A shared lightweight component layer (web components or even just shared JS modules under `public/js/`) would save Trav a lot of "why is this pattern different in 5 places" friction.

**`scheduleMorningSync` and `scheduleVectrAutoRun`** in `server.js:1064,1094` — both use `setInterval(..., 60000)` and a `lastRunDate` guard. Works, but **if the server crashes between 8:00 and 8:01 UTC, the morning sync is silently skipped that day.** No catch-up. For Kajabi sync this is fine; for VectΩr brief generation it means an inconsistent Sunday morning experience.

**Whisper queue: 1 concurrent. Frame analysis queue: up to 3 concurrent.** The asymmetry is correct (Whisper is CPU/GPU bound, Vision is API bound). The concurrency change to `activeCount` in frame queue is clean — `maxConcurrent()` correctly checks for live-vs-batch mix to avoid starving live jobs.

**At what scale each decision breaks:**
- SQLite per tenant: hundreds of tenants on one box before filesystem matters. Beyond that, shard.
- In-memory queues: any restart = silent work loss. Breaks at "more than one paying user."
- Express session SQLite: single-digit thousands concurrent. Fine.
- Global thumbnail/upload dirs: breaks the first time two tenants ingest the same filename.
- Single shared ANTHROPIC_API_KEY across tenants: breaks pricing model (no per-tenant cost attribution) and rate limits (one heavy tenant throttles all).

---

## 4. Workflow & Navigation Logic

The stated pipeline order: SeedΩr → Id8Ωr → PipΩr → WritΩr → DirectΩr → ShootDay → VaultΩr → EditΩr (AssemblΩr) → ReviewΩr → ComposΩr → ClipsΩr → CaptionΩr → PostΩr.

The actual nav in `public/js/nav.js:28–85`:
- **Pre:** Soul BuildΩr, SeedΩr, Id8Ωr, ShowΩr, PipΩr, WritΩr ✓ (mostly matches)
- **Prod:** DirectΩr, ShootDay, TeleprΩmpter ✓
- **Post:** VaultΩr, AssemblΩr, ReviewΩr, ClipsΩr, ComposΩr, BrollΩr, AnimΩr, CleanΩr — note CleanΩr (a system maintenance tool) shows up in Post, which will confuse fresh users.
- **Dist:** GateΩr, PackageΩr, CaptionΩr, MailΩr, AudiencΩr, PostΩr, AutomatΩr, MirrΩr, AnalyticΩr, Analytics Import, MarkΩr, GuardΩr, AffiliateΩr — this list is 13 items. Distribution + analytics + copyright + monetization are jammed into one bucket. Trav will ask "what's a creator supposed to do here, top to bottom?"

**Wired handoffs (data passes through the system):**
- SeedΩr → PipΩr: "Promote to Project" pre-fills (good).
- Id8Ωr → PipΩr/WritΩr: Vision Brief pipeline handoff via project record.
- PipΩr → WritΩr: project_id is the bridge, beat map flows.
- VaultΩr → EditΩr/AssemblΩr: project_id on footage, transcripts auto-attached.
- CaptionΩr → PostΩr: localStorage one-shot prefill (`captionr_prefill`). Documented in CLAUDE.md.
- MirrΩr → Id8Ωr/WritΩr: prompt-injection block (`mirrrBlock`).
- VectΩr brief → Id8Ωr/WritΩr/Editr Room: documented prompt injection.
- Post-Mortem brief → in `CLAUDE.md`'s TODO: "inject active post-mortem brief into WritΩr id8rBlock + Id8Ωr concept phase" — **flagged as not yet done**. Carried from Session 78.
- Visual Intelligence Profile → WritΩr/BrollΩr/EditΩr/VectΩr ✓ (Session 77 wired).

**Manual / copy-paste handoffs:**
- ReviewΩr → ClipsΩr: approved cuts flow but the user still has to pick which clips are clip-worthy.
- ClipsΩr → CaptionΩr → PostΩr is wired via localStorage but is one-shot and lossy if a tab is closed mid-flow.
- Anything DaVinci → external — when DaVinci spits out a proxy, VaultΩr picks it up via folder watcher (good), but the user still has to manually export.
- ShootDay → TeleprΩmpter: separate apps, no direct bridge.
- Studio Intel: the queries are generated by Claude, but Jason still copies them into YouTube Studio and pastes responses back. This is by necessity (no YT internal API), but a fresh user won't understand the loop.

**Confusing nav for a fresh user:**
- "Show**Ω**r" is in Pre but never documented in CLAUDE.md's pipeline. New users won't know what it is.
- "AutomatΩr" appears in nav but isn't in CLAUDE.md's built-list. Phantom.
- "AnalyticΩr" alongside "MirrΩr" — what's the difference? Both are analytics.
- M1/M2/M3 prefixes are leftover from prototype days. They communicate nothing to a new user.
- "Analytics Import" as a peer of major tools — should be a button inside MirrΩr, not a nav item.
- CleanΩr under Post is a category mismatch.

**Best-case quick wins**: collapse CleanΩr + Doctor + Sync into a "System" cluster; merge AnalyticΩr into MirrΩr; remove or rename AutomatΩr; drop M1/M2/M3 prefixes. Cuts 4–6 nav items.

---

## 5. Security & Auth

🔴 **OAuth tokens stored plaintext.** `platform_connections` table holds `access_token` / `refresh_token` as TEXT (`src/db.js:5509–5530`). For a desktop app with one user, this is the same trust boundary as the OS — acceptable. For multi-tenant SaaS on `kre8r.app`, **a DB leak is a full Meta/YouTube/TikTok account takeover for every connected creator.** Fix path: encrypt at rest with a key derived from `SESSION_SECRET` (already required) + per-tenant salt. Standard pattern (Node `crypto.createCipheriv` aes-256-gcm, 50 lines).

🔴 **`SESSION_SECRET` default fallback** (`server.js:244`) — as noted in §1. This is a one-line fix and should ship before any beta opens. Add a boot-time assertion `if (!process.env.SESSION_SECRET) throw new Error(...)`.

🟡 **Internal API key pattern is consistent but the key is reused across many bridges** (OrgΩr, HarvestΩr, AffiliateΩr, blog push, contracts). One leaked `INTERNAL_API_KEY` opens all of them. Splitting into per-bridge keys is straightforward and lowers blast radius.

🟡 **Auth guard is in `server.js:299–409` — a 110-line waterfall of `if (req.path === ...)` allowlist checks.** This is dangerous in two ways: (1) the order matters and is implicit, (2) the next person who adds a route will quietly inherit "logged-in required" or accidentally make it public. Routes-as-data (an array of `{path, public}`) plus an explicit decorator pattern at each route file would let Trav reason about who can hit what without grepping the server file.

🟡 **`/r/:partnerKey/:linkKey`** at `server.js:662–678` writes to `affiliate_clicks` from public requests with no rate limiting. Trivial DoS or click-stuffing vector.

🟡 **Session cookie `secure:false`** is correct for "nginx terminates TLS," but the `trust proxy` setting is never explicitly enabled (`app.set('trust proxy', 1)`). Without it, `req.protocol`, `req.ip`, and rate-limit middleware will misbehave behind nginx. The Meta callback already had to work around this (`getCallbackUrl` reads `x-forwarded-proto` manually) — this is a symptom.

🟡 **Static file serving on `public/`** (`server.js:598`) sits *after* the auth guard ✓ for non-public paths, but `express.static` with `extensions: ['html']` will happily serve `/anything.html` if someone is logged in. That's fine. But any new file dropped in `public/` is automatically published. Add an awareness comment or move private pages to a separate folder.

🟢 **bcrypt rounds = 10** — fine.
🟢 **Session regenerate on login** — correctly prevents fixation (`auth.js:37`).
🟢 **First-run setup** correctly gated on `getUserCount() === 0`.

---

## 6. What's Missing / Better Approaches

**The single biggest gap to the stated vision** ("eliminates the administrative layer between idea and audience"): the pipeline is wired *forwards* but not *backwards*. Post-Mortem and MirrΩr feed prompts, but **there's no automated "this clip from VaultΩr matches that beat in PipΩr"** outside of EditΩr/AssemblΩr running on demand. ClipsΩr → CaptionΩr → PostΩr loses state if any tab is closed mid-handoff (localStorage one-shot). A persistent "in-flight content" view across all modules (the project-level dashboard mentioned in V1) is still missing. Jason has to remember which video is at which stage.

**What a CS PhD will ask about (with their likely concern):**

- **"How do you do background work in a multi-tenant system?"** Honest answer: today, you don't. Queues are global. This needs a tenant-iteration pattern on every periodic job.
- **"What happens if Anthropic returns a 200 with an unexpected JSON shape?"** `repairJSON` in `src/utils/claude.js` is impressive but the cleanup chain (strip fences → JSON.parse → repair → throw) doesn't surface the repair as a degraded result — downstream code thinks it got clean data.
- **"How do you ensure prompt changes don't break existing creator outputs?"** No prompt versioning, no eval suite, no golden-output regression tests. The SLOP_RULE in `claude.js` is a list of banned phrases — there's no test that proves Claude actually avoids them in the latest model version.
- **"What's your strategy for model deprecation?"** `CLAUDE_MODEL` is an env var, but module-specific overrides (`FRAME_ANALYSIS_MODEL`, `BATCH_ANALYSIS_MODEL`, `ASSEMBLY_MODEL`, `VISUALR_MODEL`) are sprinkled across files. No central registry. When Anthropic deprecates a model, you'll grep across the codebase.
- **"What's the cost per creator-month right now?"** No per-tenant token accounting wired up to a dashboard. `logTokenUsage` exists but doesn't include `tenant_slug` — every call gets attributed to "the active context" which on Jason's instance is fine but in multi-tenant land aggregates wrong.
- **"Why does the watcher only support one folder?"** It does. `creator-profile.json.vault.intake_folder` is a string, not an array. For creators with multiple drives this is restrictive.
- **"What's the test coverage?"** Zero automated tests. `scripts/test-sse.js` is the only test script. Trav will not be alarmed by this (it's normal for solo-built systems) but will probably want to see a minimal integration test added.
- **"How do you handle Claude downtime?"** `callClaude` has retry/backoff. Good. But there's no circuit breaker — a 30-minute Anthropic outage will spin every request through 5 retries × 30s = 150s of latency before failing. Add a circuit breaker or shorter outer timeout.
- **"What's the schema migration story?"** Migrations are inline `ALTER TABLE` statements in `runMigrations()`. They're idempotent (`if (!cols.includes(...))`), which works. But there's no version stamp, no rollback, no migration log. For multi-tenant where dozens of DBs need to migrate, this needs upgrading — the `bootstrapTenantTables` pattern is a step in the right direction.

**Better approaches available:**
- For queues: BullMQ + Redis if you go cloud, or just a `jobs` table in SQLite with status — gives you crash recovery and observability for ~50 lines.
- For OAuth tokens: `aes-256-gcm` with `SESSION_SECRET` as key material.
- For prompt versioning: a `prompts/` folder with versioned files, imported by tool. Lets you A/B test prompt changes.
- For pipeline state: one `project_state` table that every module reads and writes — replaces localStorage handoffs.
- For nav: declarative pipeline order in `creator-profile.json` so the workflow is configurable per creator (mentioned as planned).

---

## 7. Strengths Worth Highlighting

**For someone built this without prior coding experience, this is genuinely impressive:**

1. **The tenant context layer.** AsyncLocalStorage + a single `_activeDb()` indirection is exactly how mature SaaS systems handle per-request DB routing. Trav will see this immediately and know it's not amateur work.

2. **The calibration loop architecture.** MirrΩr → VectΩr → Id8Ωr/WritΩr is a closed-loop learning system. Most well-funded creator tools don't have this. The fact that it's prompt-injection (not fine-tuning) is correct for the current scale.

3. **AssemblΩr's two-call architecture** with model overrides per call. This is sophisticated cost engineering — Sonnet for assembly, Opus for editorial judgment, Haiku for batch backfill, Vision for frame analysis. Most solo builders pick one model and call it everywhere.

4. **`callClaude` JSON repair.** The `repairJSON` function in `src/utils/claude.js` handles truncated responses correctly by walking brace depth. This is the kind of thing that breaks in production constantly and most apps just throw — Jason caught it and built a recovery path. This is the Prime Directive made code.

5. **The Engine/Soul split** (`creator-profile.json` injected everywhere via `creator-context.js`) is now load-bearing across 30+ modules and it still works. That's a design decision that paid off.

6. **Failure-mode awareness.** SSE keepalive + timeout (`sse.js`), `process.on('unhandledRejection')`, `process.on('uncaughtException')` with `exit(1)`, rolling DB backup every 5 min, daily cron backup, Whisper model caching, ngrok per-upload teardown, Postor watermark fallback to original if MarkΩr fails. The whole system is full of "what if this breaks" thinking.

7. **The compliance work for TikTok/Meta/YouTube** — getting through Meta app review and the TikTok PKCE detective work (hex-encoded SHA256, not base64url — Session 78) is the kind of grind that founders pay engineers to do.

8. **First-run setup wizard, Electron auto-update, kre8r:// protocol handler, native folder picker via IPC.** This is mature desktop-app polish.

9. **The fact that `creator-profile.json` validator handles migrations** (`profile-validator.js`) — Jason was thinking about schema evolution from early on.

10. **Per-tenant DB isolation** (one SQLite file per slug) is a better multi-tenant model than the textbook `tenant_id` column. Bounded blast radius, atomic backups, simpler queries, easier to "export this creator's data."

---

## 8. If Trav Asks... (Q&A Prep)

**"How would a second creator actually use this today?"**
Honest: not yet without 2–3 sessions of work. The request path is tenant-isolated (subdomain → AsyncLocalStorage). But every background job — VaultΩr watcher, transcribe queue, frame queue, postor queue, morning sync, weekly VectΩr — operates on Jason's singleton DB because they run outside any request context. To onboard tenant #2 we'd need to (a) wrap periodic jobs in a per-tenant iteration, (b) wire per-tenant API keys from each tenant's `.env`, (c) namespace thumbnail/upload paths by tenant, (d) add a tenant-aware OAuth state.

**"How is your SQLite going to scale?"**
One DB file per tenant under `tenants/{slug}/kre8r.db`. WAL mode, ACID. Scales to hundreds of tenants on a single box before filesystem becomes the bottleneck. Beyond that, shard by tenant — which is trivial because we're already file-isolated.

**"Where do you store OAuth tokens?"**
Plaintext in SQLite right now. That's fine for a single-creator desktop app — same trust boundary as the OS. For multi-tenant SaaS, the plan is encrypt-at-rest using `SESSION_SECRET` + per-tenant salt with aes-256-gcm. Standard pattern, ~50 lines.

**"Tests?"**
Zero automated tests. There's one SSE smoke-test script. The plan is to add a minimal integration suite (DB migrations, the calibration loop's prompt injection points, the queue idempotency) before V1.0 beta opens.

**"What's the test coverage on prompts? How do you know a model update won't regress everything?"**
We don't, today. Prompts are inlined in route files. Each major prompt has a "voice authenticity rule" (the SLOP_RULE banned-phrase list) but no automated check. A `prompts/` directory with versioned files + an eval script is on the roadmap.

**"What does your background work model look like?"**
Three in-memory queues (transcribe, frame analysis, postor) + two cron-style intervals (morning Kajabi sync, Sunday VectΩr). All in-process. All lost on restart, though the DB schema supports re-deriving unprocessed work (`getUnanalyzedFootage`). For a paid product we'd move to a `jobs` table with status, which gives us crash recovery for ~50 lines.

**"How do you handle Claude downtime or schema drift in AI responses?"**
`callClaude` has retry/backoff for 429/529 and network errors. JSON responses go through a `repairJSON` function that walks brace depth to close truncated objects — handles the common case where Anthropic cuts off mid-response. WritΩr iterate has a regex fallback that extracts the script field directly if JSON parsing fails entirely (Session 77).

**"What's the moat?"**
Three things: the creator-profile.json + voice profile system means content sounds like the creator, not like AI. The calibration loop (MirrΩr evaluates its own past recommendations; VectΩr generates strategic briefs; Post-Mortem diagnoses failures) means the system gets better the longer you use it — that's months of real production data, not replicable in a sprint. And the integration depth — DaVinci, Whisper, ffmpeg, ngrok-tunnel Meta uploads, TikTok PKCE, MailerLite + Kajabi sync — is the unglamorous compliance work that takes the wind out of competitors.

**"What scares you most about the codebase?"**
Three things: the in-memory queue pattern (silent data loss on restart), the auth-guard waterfall (110 lines of if-statements is fragile), and the fact that multi-tenancy has never been tested with an actual second tenant. Easy to fix, but until tenant #2 is real, we don't know what we haven't accounted for.

**"What would a $50k engineering contract get us in three months?"**
1. Persistent job queue + tenant-aware background workers. 2. OAuth token encryption + per-bridge internal keys. 3. Per-tenant API key resolution and cost attribution. 4. Minimal integration test suite (50 tests, no full coverage). 5. Prompt versioning + simple eval harness. 6. Two paying beta tenants live on `kre8r.app`. 7. Cleaned-up nav and a project-level dashboard. After that, it's a sellable SaaS, not a "Jason's tool that one other person also uses."

**"What did you build that you're most proud of?"**
The calibration loop. Most AI creator tools generate content and forget. This system grades its own past recommendations against real YouTube performance, attaches weight adjustments, and lets those flow back into future Id8Ωr concepts and WritΩr scripts. That's not a feature — that's the actual product.

---

*End OPUS_REVIEW_V3.md*
