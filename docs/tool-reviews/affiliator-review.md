# AffiliateΩr — Architectural Review
*Opus audit.*

## Synthesis
All findings verified against source. Here is the synthesis.

---

## AffiliateΩr — Synthesis

### Top 3

**1. [HIGH] Affiliate tables absent from tenant DB bootstrap (AFF-1)** — Confirmed. `affiliate_partners`, `affiliate_links`, `affiliate_clicks`, `affiliate_commissions` are created only in `runMigrations()` (src/db.js:1022–1078). `bootstrapTenantTables()` (src/db.js:1656+) ships `gear_categories` (line 2241) but **none** of the affiliate tables — a partial, inconsistent schema. Since `db.prepare()` routes to the active tenant DB, every AffiliateΩr endpoint and the public `/r/:partner/:link` redirect (server.js:674) throws `no such table: affiliate_links` → 500 on any hosted tenant. This is the exact dual-path violation CLAUDE.md's CRITICAL DATABASE RULE warns about. Invisible today (Jason's single-tenant desktop is fine), fatal the moment multi-tenancy ships. **Fix:** mirror the affiliate CREATE TABLEs into `bootstrapTenantTables()`, ideally via a shared schema helper called from both paths.

**2. [MEDIUM] Synced rows can go live with empty `destination_url` → dead redirects (AFF-3)** — Confirmed at affiliator.js:237 (`item.destination_url || ''`). A new synced row defaults `active=1`, and the redirect at server.js:685 does `res.redirect(302, link.destination_url)` — a 302 to `''` is a broken click that *still records* in `affiliate_clicks`. `SYNC_ALLOWED` (line 214) deliberately excludes `destination_url`, so a later sync can never repair it. Prime-Directive failure: a clicked gear link that goes nowhere is a silently lost conversion. **Fix:** skip inserts with empty `destination_url`, and harden the redirect to 404 on falsy URL.

**3. [MEDIUM] bulk-seed insert/update counter is wrong and `updated` is dropped (AFF-2)** — Confirmed at affiliator.js:562 / 568. `r.lastInsertRowid ? inserted++ : updated++` is unreliable on upserts (lastInsertRowid is non-zero even on UPDATE), and the response (`{ ok, inserted, total }`) throws away the `updated` tally entirely. The kre8r-land solar seeding tool gets misleading numbers. Not data-corrupting, but the success reporting is untrustworthy. **Fix:** check existence before run (as `applySyncBatch` does), report `updated` in the response, stop inferring from `lastInsertRowid`.

*(AFF-4 click bot-inflation and AFF-5 silent OrgΩr bridge swallow are both real but low-severity quality issues — worth a backlog note, not blockers.)*

---

### Verdict: Is revenue attribution actually working?

**For Jason today: yes, narrowly. As a product: no, not trustworthily.**

The attribution *path* is sound on the single-tenant desktop install — the `/r/` redirect logs partner/link/src/referrer to `affiliate_clicks` and 302s to the destination, and commissions persist locally even when the OrgΩr/TreasΩr bridge fails (orgr_synced=0). The money is never lost locally.

But three things undermine the *numbers* Jason reads to decide which gear converts:

- **Click counts are inflated** — no bot/unfurler filtering (AFF-4); a large share of "clicks" on links pasted into FB/IG/email are crawler prescans, not humans.
- **Some clicks attribute to nowhere** — empty-`destination_url` synced rows (AFF-3) record clicks that never reach a merchant, so a "converting" link may actually be a dead end.
- **Confirmed earnings can silently drift from the books** — the OrgΩr bridge swallows failures with `catch (_) {}` (line 511), no logger, no retry; rows sit at `orgr_synced=0` forever with no surfaced signal (AFF-5).

And for **any tenant other than Jason, attribution is fully broken** (AFF-1) — the tables don't exist, so the redirect 500s and nothing is recorded at all.

**Bottom line:** the engine records clicks and saves commissions, but the analytics layer over-reports (bots), can mis-attribute (dead links), and the bookkeeping bridge can silently desync — so the *directional* signal is usable for Jason but the *absolute* attribution numbers are not yet reliable, and the whole subsystem is multi-tenant-broken. Fix AFF-1 before any tenant ships; fix AFF-3 + AFF-5 before trusting the conversion/earnings reports.

Relevant files: `C:/Users/18054/kre8r/src/db.js` (1022–1078 vs 1656+), `C:/Users/18054/kre8r/src/routes/affiliator.js` (214–266 sync, 480–514 commissions, 529–572 bulk-seed), `C:/Users/18054/kre8r/server.js` (674–690 redirect).

## Findings (5 total)
### [HIGH] Affiliate tables missing from tenant DB bootstrap — routes crash for any tenant
**bug** | C:/Users/18054/kre8r/src/db.js (runMigrations ~1022-1078 has them; bootstrapTenantTables ~1656+ does not) and the consuming route C:/Users/18054/kre8r/src/routes/affiliator.js
affiliate_partners, affiliate_links, affiliate_clicks, and affiliate_commissions are created only in runMigrations() (src/db.js ~line 1022-1078), which initializes Jason's AppData/owner DB. They are entirely absent from bootstrapTenantTables() (starts src/db.js:1656; grep for 'affiliate' in that range returns no matches). Yet db.prepare() delegates to _activeDb() which routes to the active tenant DB. The result: on any hosted tenant subdomain, every AffiliateΩr endpoint (/partners, /links, /gear-public, the /r/:partner/:link redirect, /analytics, /commissions) throws 'no such table: affiliate_links' and the redirect returns 500 'Redirect error'. This is exactly the violation CLAUDE.md's CRITICAL DATABASE RULE warns about: new tables must go in BOTH paths. Notably gear_categories IS in bootstrapTenantTables (db.js:2241), so tenant DBs get an inconsistent partial schema — categories but no links. For Jason's single-tenant desktop install today it works fine; this only bites the moment multi-tenancy ships, but it will bite hard and silently.
**Fix:** Add CREATE TABLE statements for affiliate_partners, affiliate_links (incl. all gear/og_image/updated_at columns), affiliate_clicks (incl. src), and affiliate_commissions to bootstrapTenantTables() alongside the existing gear_categories block, mirroring the runMigrations definitions. Or extract the affiliate schema into a shared helper called from both paths to prevent future drift.

### [MEDIUM] bulk-seed insert/update counter is wrong and 'updated' count is silently dropped
**bug** | C:/Users/18054/kre8r/src/routes/affiliator.js — POST /bulk-seed, the upsertAll transaction and the final res.json
In POST /bulk-seed (affiliator.js), after stmt.run() on an INSERT ... ON CONFLICT DO UPDATE, the code does `if (r.changes > 0) r.lastInsertRowid ? inserted++ : updated++`. better-sqlite3 returns a non-zero lastInsertRowid even when the statement resolved as an UPDATE (it reflects the table's last rowid, not whether a new row was inserted), so genuine updates are miscounted as inserts. Worse, the response only returns `{ ok, inserted, total }` — the `updated` tally is computed and thrown away. The caller (kre8r-land solar tool seeding links) gets a misleading 'inserted' number and no visibility into how many were updates vs no-ops. Not data-corrupting, but the success reporting is untrustworthy.
**Fix:** Detect true inserts via `r.changes === 1 && r.lastInsertRowid` is unreliable for upserts; instead check existence first (SELECT before run) like applySyncBatch does, or use SQLite's RETURNING / a sentinel. At minimum, include `updated` in the response and stop inferring insert-vs-update from lastInsertRowid. Simplest: report only `{ ok, processed: r.changes-summed, total }`.

### [MEDIUM] Synced new rows can be created with empty destination_url, producing dead redirects
**bug** | C:/Users/18054/kre8r/src/routes/affiliator.js — applySyncBatch INSERT OR IGNORE branch (destination_url || '')
applySyncBatch() (used by /sync-from-electron and /pull-from-live) inserts new rows with `item.destination_url || ''`. destination_url is the actual affiliate target the /r/:partner/:link redirect 302s to. A synced row missing destination_url becomes a live tracked link (active defaults to 1) whose redirect sends the visitor to '' — meaning res.redirect(302, '') which redirects back to the same path / browser stays put, a broken click that still records in affiliate_clicks. Since SYNC_ALLOWED deliberately excludes destination_url, a later sync can never repair it either. The Prime Directive lens: a clicked gear link that goes nowhere is a lost conversion the creator can't see.
**Fix:** Skip (skipped++) any synced item whose new-row insert would have an empty destination_url, or add destination_url to SYNC_ALLOWED so it can be backfilled on a later sync. Also harden the /r/ redirect in server.js to 404 when link.destination_url is falsy rather than 302-ing to an empty string.

### [LOW] Click logging has no de-duplication or bot filtering — analytics inflated by prefetch/crawlers
**improvement** | C:/Users/18054/kre8r/server.js:674-690 (redirect handler) feeding C:/Users/18054/kre8r/src/routes/affiliator.js GET /analytics
The /r/:partner/:link redirect (server.js:674-690) records a row in affiliate_clicks for every GET, with no guard against link-preview crawlers (Facebook/Discord/Slack unfurlers), email-client image/link prescanners, or browser prefetch. For a creator pasting these links into FB/IG/email, a large fraction of recorded 'clicks' will be bots hitting the URL once on post, before any human clicks. This doesn't break anything but it quietly erodes the trust of the /analytics numbers Jason uses to judge which gear converts. Earns-its-place check: the redirect+tracking itself is genuinely low-overhead and works; the analytics layer just over-reports.
**Fix:** Filter obvious bot User-Agents before the INSERT (skip known unfurlers/crawlers), and/or collapse duplicate clicks from the same referrer+UA within a short window. Even a simple UA denylist for the big social unfurlers would materially clean up the byPartner/bySrc reports.

### [LOW] OrgΩr commission bridge swallows all errors silently — failed TreasΩr syncs are invisible
**improvement** | C:/Users/18054/kre8r/src/routes/affiliator.js — POST /commissions, the `catch (_) {}` around the ORGR fetch
In POST /commissions, the OrgΩr TreasΩr bridge is wrapped in `try { ... } catch (_) {}` with an empty catch and no logger call. If ORGR_URL is set but the call fails (network, 4xx/5xx, token rejected), the commission is saved locally with orgr_synced=0 and the response returns orgr_synced:false, but there is no log line (CLAUDE.md mandates pino logger, not silent swallow) and no retry/backfill path. Confirmed earnings that fail to bridge to bookkeeping just sit at orgr_synced=0 forever with no surfaced signal. Low severity because the money isn't lost locally, but the creator's books silently drift.
**Fix:** Log bridge failures via src/utils/logger.js (pino) and surface a way to re-sync rows where orgr_synced=0 (a small 'retry unsynced' endpoint or a flag in the /commissions list response), so a transient OrgΩr outage doesn't permanently desync confirmed income.
