# Kre8Ωr — Next Session TODO

---

## Task 1 — Id8Ωr Full End-to-End Test + Polish

Run the complete flow (all 3 modes) and note any issues. Known things to verify:

1. **Rate limit clear** — does the 3-phase sequential flow with 65s waits survive without hitting the 30k token/min limit?
2. **Summarization** — check `pm2 logs` after research: confirm `[id8r] summarization failed` does NOT appear
3. **Mindmap cache** — navigate away to mind map and back; confirm it doesn't re-call Claude
4. **Skip button** — click Skip during a phase wait; confirm countdown clears and next phase starts when server is ready
5. **Package + Brief** — confirm both complete without rate limit errors now that they use `researchSummary`
6. **Remove debug log** — `console.log('[mindmap] messages chars...')` in `/mindmap` handler once confirmed working

---

## Task 2 — Id8Ωr: Research Phase Wait Time Tuning

The 65s wait × 3 phases = ~3.5 min total research time. After real testing:
- If rate limits still hit → increase to 70s
- If no rate limits at all → reduce to 45s to tighten the UX
- Consider making the wait duration configurable via env var `ID8R_PHASE_WAIT_MS=65000`
- Also consider: skip the 65s wait after Phase 3 (VaultΩr) since it's a local DB call with no Claude token cost — the only waits needed are between Phase 1→2 and Phase 2→3

---

## Task 3 — Deploy to DigitalOcean and verify kre8r.app live

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
8. Test Id8Ωr full flow on live URL

---

## Carry-forward (still valid)

### TeleprΩmpter 3-device live test
1. Start display on laptop: `https://kre8r.app/teleprompter.html` → Load Script → Start
2. Note the 4-digit session code on screen
3. **Phone 1 (Control/Cari):** `https://kre8r.app/teleprompter.html?mode=control&session=XXXX`
4. **Phone 2 (Voice/Jason):** `https://kre8r.app/teleprompter.html?mode=voice&session=XXXX`

### Voice Library end-to-end test
1. Open VaultΩr → Upload from Device → upload a real `.mp4` with speech
2. Open WritΩr → Voice Library → confirm SSE: `transcribing` → `analyzing` → `saved`

### Code Fix — `davinci.js` → `runScript()` Python detection
- **Problem:** `runScript()` hardcodes `spawn('python', ...)` — fails on systems where the binary is `py` or `python3`
- **Fix:** Add `PYTHON_CANDIDATES` + `detectPython()` pattern (already in `editor.js` and `composor.js`)

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

---
