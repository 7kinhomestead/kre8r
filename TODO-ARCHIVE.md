# TODO-ARCHIVE — Completed Items + Full Specs

This file holds completed tasks and full feature specs that were moved out of TODO.md
to keep the active context lean. Reference this when building features — the specs are detailed.

---

## ✅ COMPLETED FEATURES

| Feature | Session | Notes |
|---------|---------|-------|
| better-sqlite3 migration | 26 | Replaced sql.js |
| Pipeline handoff gaps | 26 | VaultΩr→EditΩr, ReviewΩr→ComposΩr, ComposΩr→ClipsΩr |
| Id8Ωr rate limiting fix | 26 | Compact prompts, max_uses caps, delays |
| ReviewΩr refocus (rough cut only) | 27 | CutΩr moved to ClipsΩr |
| Short-form pipeline mode | 27 | content_type flag, SHORT FORM structures in PipΩr/WritΩr |
| ClipsΩr inline editing | 27 | Click-to-edit, auto-save on blur |
| MirrΩr first evaluation run | 27 | YouTube sync, NorthΩr eval card, calibration context |
| Auth system | 28 | express-session + bcrypt, owner/viewer roles, kre8r.app protected |
| TeleprΩmpter field mode | 28 | 3-device system, QR codes, session code, voice scroll |
| Electron desktop app | 32-33 | BrowserWindow, setup wizard, 5-min backup, v1.0.0 |
| SeedΩr idea vault | 33 | ideas table, bulk entry, ConstellΩr 3D view |
| Cross-device sync (SyncΩr) | 35 | push/pull/import, ID-preserving, overwrite mode (v55) |
| Email automation + MailΩr | 37-39 | MailerLite v2 API, A/B, schedule, NorthΩr email stats |
| PostΩr + YouTube sync | 38 | YouTube, Facebook, Instagram posting live |
| Beta hardening | 40-41 | Bug fixes, WritΩr storyboard pipeline |
| Instagram Reels live | 44 | SAR-2 app, new Instagram API, ngrok tunnel |
| PostΩr Scheduler | 45 | Queue table, 60s processor, calendar view |
| CaptionΩr→PostΩr handoff | 45 | localStorage prefill, one-click send |
| MailΩr→Facebook post | 45 | Gen checkbox, editable caption, Post Now/Schedule |
| CLAUDE.md update | 46 | All modules documented |
| Project Folder Architecture | 46 | [id]_[slug] folders, DaVinci auto-watch, VaultΩr depth:5 |
| PostΩr Batch Mode / Campaign Builder | 46-47 | Campaign tab, caption_package prefill, schedule board |
| Workflow audit polish | 48 | Whisper progress, PipΩr suggestion, GateΩr queue, NorthΩr grid |
| TikTok posting API | 49 | OAuth 2.0 + PKCE + FILE_UPLOAD, app in review April 19 |
| Privacy + TOS pages | 49 | Required for TikTok review, whitelisted in auth |
| Design system color audit | 50 | Hunter green fix, teal accent consistency |
| MarkΩr fingerprint infrastructure | 51 | pHash, audio fingerprint, watermark embed, guard_reports table |
| GuardΩr public fan page | 52 | Fan submission, inversion tool, creator inbox |
| OrgΩr standalone org board | 53 | Full org board builder, divisions/departments/jobs/policies |
| ClaimsΩr DMCA engine | 54 | Claude-generated DMCA notices, NorthΩr copyright health stats |
| VectΩr strategic session | 55 | NorthΩr slide-out, SSE chat, pushback mechanic, brief lock/inject |
| VaultΩr tag chip filter | 55 | Client-side instant filter, active pill, session persist |
| SyncΩr overwrite import | 55 | replaceProjectFromSnapshot, amber checkbox, teleprompter fix |
| Electron v1.0.7 | 55 | Built + deployed to kre8r.app/download |
| Media kit visual fixes | 56 | Hero text, headshot swap, logo containment |
| Kre8r↔OrgΩr bridge | 56 | stats-export endpoint, kre8r-bridge routes, board.html UI |

---

## FULL SPECS (reference when building)

### MarkΩr + GuardΩr Architecture
Detection layers: perceptual hash (40%), audio fingerprint (40%), spatial watermark (20%).
Confidence threshold 70% for confirmed match. Tables: watermarks, video_fingerprints,
audio_fingerprints, guard_reports. Watermark: FFmpeg pixel luma ±1 in seed-driven pattern.
"Invert to reveal" mechanism: Canvas API client-side. DMCA automation: Claude generates
platform-specific notices. GuardΩr public URL: guard.7kinhomestead.com.
Build plan was 3 sessions (A=fingerprints, B=fan site, C=DMCA) — all completed Sessions 51-54.

### VectΩr Architecture
System prompt: strategic advisor, holds positions based on data, pushback mechanic.
strategic_briefs table (focus_angle, platform_priority, format_priority, duration_weeks,
expires_at, rationale, what_was_debated, full_conversation, status active/superseded).
kv_store: vectr_session + vectr_sync_cache. Active brief injected into Id8Ωr mirrrBlock
and WritΩr id8rBlock. Sync phase: YouTube + MailerLite + Kajabi + pipeline health.

### PostΩr Batch Mode / Campaign Builder
Campaign tab in postor.html. Unpackaged clips from vault_footage (shot_type=social-clip,
no postor_queue entry). Batch caption gen with SSE progress. Week grid scheduling board
(Mon-Sun × time slots). Lock Schedule → batch postor_queue insert. caption_package column
on vault_footage (JSON: tiktok, instagram, facebook, youtube, lemon8).

### Project Folder Architecture
[id]_[slug] under D:\kre8r\intake. Subfolders: raw/, completed/, clips/.
DaVinci watches D:\kre8r\intake (depth 5, creates raw/proxy/ automatically).
VaultΩr watcher: parseProjectFromPath() → auto-assigns project_id + shot_type on ingest.
ShootDay: 3 copy-to-clipboard path buttons (BRAW dest, render dest, clips dest).
projects.folder_path column stores full absolute path.

### TikTok Analytics Module (planned)
Separate from MirrΩr. Tables: tiktok_videos, tiktok_metrics.
Display API: views, likes, shares, comments, avg watch time, completion rate.
Short-form calibration context feeds WritΩr SHORT FORM only.
ConstellΩr platform selector: [YouTube] [TikTok] [All Ideas].
Dependency: TikTok app approval (~April 28-30 2026).

### Electron Packaging Reference
`npm run dist:win` → dist/Kre8Ωr Setup X.X.X.exe (~238MB).
npmRebuild:false + scripts/prebuild-sqlite.js for correct ABI.
DB at app.getPath('userData') — reinstall never overwrites DB.
5-min rolling backup → database/kre8r-electron-backup.db.
Auto-update via electron-updater checks GitHub releases.

### Android APK (planned — zero-signal field fallback)
NanoHTTPD + Java-WebSocket on Phone 1. Laptop + Phone 2 connect via hotspot IP.
Sideload APK — not Play Store. ~400-500 lines Kotlin.
Build after beta users are onboarded.

### Desktop-Only Feature Gate Plan
Detect: window.__KRE8R_ELECTRON. Show "🖥️ Desktop App Only" badge on:
PostΩr upload, VaultΩr watcher, EditΩr proxy, DaVinci section, Whisper, TeleprΩmpter QR.
Quick gate first, web-native replacements later if needed.
