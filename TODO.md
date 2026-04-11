# Kre8Ωr — Roadmap to Downloadable App

**The destination:** A creator downloads a `.exe` (Windows) or `.dmg` (Mac), runs an install wizard,
enters their Anthropic API key, and has a fully working Kre8Ωr desktop app. No terminal. No Node.
No PM2. A real app with an icon in the taskbar.

**The route:** Feature polish → Electron wrapper → Bundle dependencies → Setup wizard → Package → Ship.

---

## ✅ PHASES 2, 3 & 5 — Electron + Bundling + Packaging — DONE Session 32–33

Desktop app boots on Jason's laptop. Login screen, server starts, DB initialises.
Default credentials: jason / kre8r2024. Installer: `npm run dist:win` → `dist/Kre8Ωr Setup 1.0.0.exe`

**Key fixes locked in (Session 33):**
- `npmRebuild: false` + `scripts/prebuild-sqlite.js` — correct Electron 41 ABI (NMV 145) every build
- server.js loads from inside asar via `app.getAppPath()` — all require() calls resolve correctly
- Diagnostic error dialog on startup failure — no more silent white screen
- `!node_modules` removed from files — was silently stripping all dependencies

**Remaining before wider distribution:**
- App size: 238MB (playwright is the main culprit — move to devDependencies if not needed in packaged app)
- Mac build: untested (needs Mac machine or CI)
- Code signing: self-signed for now, SmartScreen warning on Windows install is expected

---

## PHASE 1 — Feature & Polish (before packaging anything)
*Get the app right before wrapping it. ~3-4 sessions.*

---

### ✅ P1-A — ReviewΩr Refocus (rough cut only) — DONE Session 27

Strip CutΩr analysis out of ReviewΩr entirely. One job: does this rough cut work as a long-form video?

**What gets removed from reviewr.html:**
- "Run CutΩr" button and all CutΩr result sections (social clips, retention cuts, CTA, off-script gold)
- All `/api/cutor/` fetch calls
- ClipsΩr advance banner (already correctly placed after ComposΩr)

**What stays:**
- Project select
- Selects list (approve / skip / reorder)
- Extract approved clips button (ffmpeg stream copy)
- ComposΩr advance banner
- PackageΩr bypass banner

**DB:** `cuts` table and `/api/cutor/` routes stay — ClipsΩr uses them. UI only.
**Doc:** `09-reviewr.html` already updated to reflect the decision. No doc changes needed after build.

---

### ✅ P1-B — Short-Form Pipeline Mode — DONE Session 27

Add `content_type` ('long' | 'short') as a first-class flag that flows through the entire pipeline.

**DB:** `projects` table — add `content_type TEXT DEFAULT 'long'`

**Id8Ωr:** Detect short-form intent in conversation OR ask explicitly at session start.
When short: research prompt shifts to scroll-stopping angles, hook formats, viral patterns.
Vision Brief adapts: hook = opening 3 seconds, title = caption hook.

**PipΩr:** Add SHORT FORM tile. Sub-structures:
- Hook → Tension → Payoff
- Open Loop
- PAS (Problem / Agitate / Solve)
- Before → Bridge → After
- 5-Point List
- Hot Take
- Tutorial
Beat map: 3–7 beats max, each with second-range duration target (e.g. "Hook: 0–3s").

**WritΩr:** When short — 150–300 words max, hook beat = one punchy sentence, timing shown per card.

**EditΩr:** Add SHORTS shoot mode — single best take per beat, no multi-take comparison.

**ClipsΩr:** When short — video IS the clip. Role flips to validator:
checks hook timing, retention arc, CTA presence, loop-ability. Outputs validation report + captions.

---

### ✅ P1-C — ClipsΩr Inline Editing — DONE Session 27

Click-to-edit on hook text, why_it_works, caption, and hashtags fields on each clip card.
Auto-save on blur → `PATCH /api/mirrr/viral-clips/:id`
Visual cue: light border + cursor change on click, reverts to display on save.

---

### ✅ P1-D — MirrΩr First Real Evaluation Run — DONE Session 27

The compounding intelligence loop activates here.
1. Run YouTube sync → confirm video performance data in DB
2. NorthΩr → Evaluate Last Month → confirm evaluation card renders with score + weight badges
3. Id8Ωr → run a concept → confirm mirrrBlock appears in server logs
4. WritΩr → generate script → confirm MIRRΩR CALIBRATION section in prompt context

---

### ✅ P1-E — Cosmetic Polish Pass — DONE Session 27

Before packaging, one focused pass on rough edges:
- Any "Rockridge" / stale creator name artifacts still in generated content prompts
- Empty states that don't explain what to do next
- Error messages that say nothing useful
- Mobile responsiveness on key pages (TeleprΩmpter, ShootDay)
- CLAUDE.md: update tech stack — still says sql.js, migration to better-sqlite3 is done

---

### ⚡ P1-F — Deploy Sessions 26+27 to DigitalOcean — CODE PUSHED, RUN VIA DO CONSOLE

```bash
cd /home/kre8r/kre8r && sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production && sudo -u kre8r pm2 restart kre8r
```

---

### ✅ P1-G — Auth System + TeleprΩmpter Subdomain — Session 28

See Phase 1-G below for implementation details (built this session).

---

## PHASE 1-G — Auth + Field TeleprΩmpter (Session 28)

### Auth — kre8r.app login system
Full session-based login replacing nginx basic auth.
- `users` table: id, username, password_hash (bcrypt), role ('owner' | 'viewer'), created_at
- `sessions` table via express-session + better-sqlite3 session store
- `/login` page (dark theme, matches app) — POST → sets session cookie
- Auth middleware on all routes except /login and /health
- Owner role: full access. Viewer role: read-only, no destructive actions.
- First run: seeds default owner (jason / set via env var KRE8R_OWNER_PW)
- Remove nginx basic auth (htpasswd) once Express auth is confirmed working

### teleprompter.kre8r.app subdomain
Dedicated subdomain for field teleprompter use. Same DigitalOcean droplet.
- DNS: A record `teleprompter.kre8r.app` → same IP as kre8r.app
- Nginx: new server block for teleprompter.kre8r.app → proxy port 3000
- SSL: certbot --expand to add teleprompter.kre8r.app to existing cert
- Express: detect Host header, serve teleprompter.html with no main-app auth wall
- Auth model: session code IS the auth — 4-digit code required to join any session
  so hitting the URL blind does nothing useful
- Script fetch: teleprompter calls existing /api/projects/:id/script endpoint
  (no separate API needed — same server)

**Field workflow:**
1. Jason selects project in kre8r.app desktop before leaving
2. Display device (laptop) opens teleprompter.kre8r.app, loads project, generates session QR codes
3. Phone 1 (hotspot): scans QR → control mode. Phone 1 data provides internet to all devices.
4. Phone 2 (voice): scans QR → voice mode
5. All three reach teleprompter.kre8r.app through Phone 1's hotspot data. Zero office wifi needed.

---

### 📱 Android APK — Beta User Onboarding + Zero-Signal Fallback

**When to build:** After beta users are onboarded. Dedicated session.

**Primary use case:** Zero mobile signal locations (no data on hotspot phone).
For normal field use, teleprompter.kre8r.app through Phone 1's hotspot data handles it.

**Architecture (Phone 1 = server in the field):**
- Phase 1 (office, on same wifi as desktop): Scan QR from Kre8r → app fetches script, stores locally
- Phase 2 (field, no signal): App starts NanoHTTPD server + Java-WebSocket on Phone 1
- Laptop: scans QR from app → browser opens `http://[phone1-hotspot-ip]:PORT/` → display mode
- Phone 2: scans QR → browser → voice mode
- Phone 1 app: control interface + WebSocket hub. Zero internet needed.

**Libraries:** NanoHTTPD (HTTP server in Android), Java-WebSocket, ZXing (QR scanner)
**Size estimate:** ~400-500 lines Kotlin + bundled teleprompter.html assets
**Distribution:** Sideload APK (Settings → Unknown sources). NOT Play Store.

**Beta user onboarding flow:**
- Upon first login to kre8r.app: modal/banner — "Download the Field TeleprΩmpter app"
- QR code to download the APK directly from kre8r.app/downloads/kre8r-teleprompter.apk
- Small written tutorial (3 steps): Enable unknown sources → scan QR → install
- Tutorial lives at kre8r.app/teleprompter-setup (simple HTML page, printable)
- Also shown in ShootDay checklist ("Field kit ready?")

---

## PHASE 4 — First-Run Setup Wizard ← NEXT
*Wrap the existing app in a real desktop window. ~1-2 sessions.*

The Express server runs inside Electron's main process.
The HTML frontend runs in an Electron BrowserWindow.
No terminal visible. Real app icon. Works like a native app.

**Steps:**
1. `npm install --save-dev electron electron-builder`
2. Create `electron/main.js`:
   - Start Express server programmatically (import server.js, don't spawn)
   - Open BrowserWindow pointing to `http://localhost:3000`
   - Handle app lifecycle: quit on window close, system tray option
   - Splash screen while server starts
3. Add `"main": "electron/main.js"` to package.json
4. Add npm scripts: `"electron:dev"`, `"electron:build"`
5. Test: `npm run electron:dev` — should open app window, no terminal

**App identity:**
- Name: Kre8Ωr
- Icon: `build/icon.ico` (Windows), `build/icon.icns` (Mac), `build/icon.png` (Linux)
- Window: 1280×800 minimum, resizable, no default Electron menu bar

---

## PHASE 3 — Bundle Dependencies
*Make the app self-contained — user installs nothing else. ~2-3 sessions.*

| Dependency | Solution | Notes |
|------------|----------|-------|
| Node.js runtime | Electron bundles automatically | Nothing to do |
| better-sqlite3 | `electron-rebuild` after install | Needs native recompile for Electron's Node version |
| ffmpeg + ffprobe | `ffmpeg-static` npm package | Prebuilt binaries, cross-platform |
| Python + Whisper | Optional in v1 — see below | Hardest dependency |
| Anthropic API | HTTPS call | Nothing to bundle |

**better-sqlite3:**
```bash
npm install --save-dev electron-rebuild
./node_modules/.bin/electron-rebuild -f -w better-sqlite3
```
Add to package.json scripts: `"postinstall": "electron-rebuild -f -w better-sqlite3"`

**ffmpeg:**
```bash
npm install ffmpeg-static ffprobe-static
```
Replace hardcoded `ffmpeg`/`ffprobe` path calls with:
```js
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
```

**Python/Whisper — v1 strategy (make optional):**
- App detects Python/Whisper on PATH at startup
- If not found: transcription features show "Transcription requires Python + Whisper" with setup link
- VaultΩr, WritΩr, ClipsΩr, MailΩr all work without it
- v1.1: auto-download portable Python + Whisper on first transcription attempt

**File paths — must be dynamic in packaged app:**
All hardcoded paths (database location, intake folder, etc.) must use Electron's `app.getPath()`:
- Database: `app.getPath('userData')/kre8r.db`
- Intake folder: configurable, defaults to `app.getPath('home')/kre8r/intake`
- Public/clips: inside app resources or userData

---

## PHASE 4 — First-Run Setup Wizard
*New users get configured automatically on first launch. ~1-2 sessions.*

On first launch: if no config exists → show setup screen before app loads.

**Step 1 — API Key (required)**
- Input: Anthropic API key
- Validate: test call to Claude API, confirm it works
- Won't proceed without a valid key
- Stored in: OS keychain via `keytar` npm package (never plaintext)

**Step 2 — Intake Folder**
- Default: `~/kre8r/intake` (created automatically if missing)
- Creator can change to any folder (e.g. DaVinci proxy output folder)
- VaultΩr watcher starts here

**Step 3 — Optional Integrations**
- Kajabi: OAuth2 connect button (opens browser for auth flow)
- Suno API key (optional — Prompt Mode works without it)
- Both skippable — can configure later in app settings

**Step 4 — DaVinci (Windows only, shown only if Resolve detected)**
- Confirm Python path for scripting API
- Test connection to port 9237

**Config stored:** `app.getPath('userData')/config.json`
Subsequent launches: skip wizard entirely, load app directly.
Settings page in-app lets creator update any config value later.

---

## PHASE 5 — Packaging + Installer
*Build the actual .exe / .dmg installer files. ~1-2 sessions.*

**electron-builder config (`electron-builder.yml`):**
```yaml
appId: com.kre8r.app
productName: Kre8Ωr
directories:
  output: dist
win:
  target: nsis
  icon: build/icon.ico
nsis:
  installerIcon: build/icon.ico
  installerHeaderIcon: build/icon.ico
  createDesktopShortcut: true
  createStartMenuShortcut: true
mac:
  target: dmg
  icon: build/icon.icns
files:
  - "**/*"
  - "!tool-purpose-docs/**"
  - "!.git/**"
```

**Build commands:**
```bash
npm run electron:build        # builds for current platform
npm run electron:build:win    # Windows .exe from any platform (via Wine or CI)
npm run electron:build:mac    # Mac .dmg
```

**Code signing:**
- Windows: Authenticode certificate — prevents SmartScreen "Unknown publisher" warning (~$300/yr or use self-signed for beta)
- Mac: Apple Developer account required for Gatekeeper approval ($99/yr)
- For beta: unsigned is fine, users right-click → Open to bypass warning

**Distribution:**
- GitHub Releases: upload `.exe` and `.dmg` to a release tag
- Link from website: `https://github.com/7kinhomestead/kre8r/releases/latest`
- Auto-update: `electron-updater` checks GitHub releases on launch, prompts to update

---

## PHASE 6 — Beta Testing
*Put it in real hands before public release. ~2-3 sessions.*

- Install on a second machine (not the dev machine) — confirm cold install works
- Developer friend (the one who is already using kre8r.app) — ideal first beta tester
- 5–10 creators from the community — free beta access in exchange for feedback
- Document every setup friction point → fix before public release
- Confirm: API key entry, VaultΩr watcher, DaVinci integration, first video pipeline end-to-end

---

## Email Marketing — Distribution Pipeline Decision

**The problem:** Kajabi's API has no broadcast send endpoint. MailΩr generates email copy but final
send requires manual copy/paste. This is the last un-automated step in the distribution pipeline.

**Research completed Session 28.**

### Option A — Wait on Kajabi (free, best outcome)
Kajabi is known to be building out their email API surface. If they ship a broadcast endpoint,
the problem solves itself at zero extra cost. **Action: ask Kajabi support if broadcast API
is on the roadmap and rough timeframe.**

### Option B — Mailerlite (~$20/mo, best value if going third-party)
Subscriber-count based (same model as Kit, easier to predict). Full broadcast API on all paid
plans. ~$20/mo at 5k subscribers vs Kit's $89–109/mo. 92% inbox placement rate.
Kre8r calls their API directly — no Zapier. One session to wire into MailΩr.

### Option C — Brevo (~$18/mo, cheapest, volume-based)
Prices by emails sent, not subscribers. ~$18/mo for 40k sends/month (5k subs × 2/week).
Full broadcast API. Free tier (300/day) usable for dev/testing. Slight unpredictability
if send volume spikes.

### Option D — Upgrade Kit to Creator ($39–109/mo depending on subs)
Known platform, already had account, best creator features. But $89/mo at 5k subs is
painful alongside Kajabi. Only worth it if already heavily invested in Kit ecosystem.

### Comparison at 5k subscribers
| Platform | Price | Broadcast API |
|---|---|---|
| Kit Creator | $89–109/mo | ✅ |
| Mailerlite | ~$20/mo | ✅ |
| Brevo | ~$18/mo | ✅ |
| EmailOctopus | $24/mo | ✅ |
| Resend | $40/mo | ✅ |
| Kajabi (if they ship it) | $0 extra | ❓ |

**Decision pending Kajabi support call. If Kajabi punts → build Mailerlite integration in MailΩr.**

When building: `src/routes/mailerlite.js` (or `kitr.js`), same pattern as kajabi.js.
POST /api/mailerlite/send-broadcast → calls Mailerlite v2 API with subject + HTML body + tag segment.
MailΩr gets a second send button alongside the Kajabi copy/paste option.

---

## Technical Debt (cleared or confirmed)

- ~~better-sqlite3 migration~~ — DONE (confirmed Session 26)
- ~~Tool purpose docs~~ — DONE (Session 26)
- Engine vs Soul audit — ongoing (creator-profile.json purpose field added Session 26)
- No automated tests — acceptable for now, address before commercial launch
- AudiencΩr tag filter — Kajabi 500 on filtered requests, low priority

---

## PM2 Quick Reference (local dev only — not needed after Electron)

```
pm2 status              # check kre8r is running
pm2 logs kre8r          # live server logs
pm2 restart kre8r       # after pulling code changes
pm2 save                # save process list after any pm2 changes
```

---

## ✅ DONE — Session 26 (2026-04-09)

- 3 pipeline handoff gaps wired: VaultΩr→EditΩr, ReviewΩr→ComposΩr, ComposΩr→ClipsΩr
- Id8Ωr rate limiting fix: compact prompts, max_uses caps, delays 120s→30s, Phase 3 wait removed
- 19 tool purpose docs created (tool-purpose-docs/) — indexed, branded, Engine vs Soul clean
- ReviewΩr doc rewritten: pure rough cut approval, CutΩr explained as moved to ClipsΩr
- DirectΩr doc corrected: beat map → shot list today, V2.0 AI shot direction planned
- Creator purpose added to creator-profile.json as load-bearing soul config
- Short-form pipeline architecture logged with full implementation spec
- ReviewΩr refocus decision logged with full implementation spec
- CLAUDE.md stale sql.js note identified (needs updating)
