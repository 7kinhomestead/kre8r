# Kre8Ωr — Next Session TODO

---

## Task 1 — Deploy to DigitalOcean and verify kre8r.app live

The deploy script exists and is tested. Spin up the droplet and go live.

**Steps:**
1. Create DigitalOcean droplet: Ubuntu 22.04 LTS, Basic $12/mo, 2 vCPU / 2GB RAM
2. SSH in as root and run:
   ```
   curl -fsSL https://raw.githubusercontent.com/7kinhomestead/kre8r/main/deploy/digitalocean-setup.sh | bash
   ```
3. Add API key: `nano /home/kre8r/kre8r/.env` → set `ANTHROPIC_API_KEY`
4. Restart: `sudo -u kre8r pm2 restart kre8r`
5. Point `kre8r.app` DNS A record → droplet IP
6. After DNS propagates: `certbot --nginx -d kre8r.app -d www.kre8r.app`
7. Verify at `https://kre8r.app` — login: `demo` / `kre8r2024`
8. Test Upload from Device: phone browser → VaultΩr → Upload from Device → upload a clip
9. Test TeleprΩmpter: load a script, confirm 3-device setup works on cloud URL

---

## Task 2 — Id8Ωr (Ideation Engine) — Phase 3

First new tool of Phase 3. Generates content ideas from creator voice, trending angles, and past winners.

**Design:**
- Input: niche keywords, recent video titles, optional trending topic
- Output: 5–10 idea cards, each with: Hook, Angle (Financial/Rigged/Rock Rich), Story Structure, B-roll needs
- Ideas saved to DB, promotable to full PipΩr project with one click
- Uses Claude with creator-profile.json for voice + angle filtering

**Files to create:**
- `src/routes/id8r.js` — route + Claude generation
- `public/id8r.html` — idea card UI, promote-to-project button
- DB: `id8r_ideas` table (`project_id nullable`, `hook`, `angle`, `structure`, `created_at`)
- Mount in `server.js`

---

## Task 3 — Live test TeleprΩmpter full 3-device setup

All fixes are committed but haven't been tested end-to-end on real hardware.

**Test sequence:**
1. Start display on laptop: `https://kre8r.app/teleprompter.html` → Load Script → Start
2. Note the 4-digit session code on screen
3. **Phone 1 (Control/Cari):** `https://kre8r.app/teleprompter.html?mode=control&session=XXXX`
   - Confirm script text appears and scrolls in sync with display
   - Test ⏪ 10s / slider / 10s ⏩ seek controls
   - Test drag up/down on text → speed changes on display
   - Confirm all text is full white, no fading
4. **Phone 2 (Voice/Jason):** `https://kre8r.app/teleprompter.html?mode=voice&session=XXXX`
   - Confirm 🎤 icon + volume bar appear
   - Speak → display starts scrolling; pause → display stops
   - Confirm sensitivity slider adjusts threshold
5. Confirm teal reading guide line visible at 50% from top on display
6. Tap any line on paused display → confirm jump to that line

---

## Carry-forward (still valid)

### Voice Library end-to-end test
1. Open VaultΩr → Upload from Device → upload a real `.mp4` with speech
2. Open WritΩr → Voice Library → confirm SSE: `transcribing` → `analyzing` → `saved`
3. Select as Primary voice → write script → confirm voice instructions in prompt

### WritΩr three tabs end-to-end test
1. Generate → confirm all 3 tabs complete and render correctly
2. Beat coverage colors on cards and script sections
3. Navigate away and back → all tabs restore

---

## PM2 Quick Reference (server)

```
sudo -u kre8r pm2 status              # check kre8r is running
sudo -u kre8r pm2 logs kre8r          # live server logs
sudo -u kre8r pm2 restart kre8r       # after pulling code changes
sudo -u kre8r pm2 save                # save process list after any pm2 changes
```

## Redeploy (after pushing new code)

```
bash /home/kre8r/kre8r/deploy/deploy.sh
```
