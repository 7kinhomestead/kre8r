# Session 28 Deploy Guide — Auth System + Mark Complete + TeleprΩmpter Fixes

**Date:** 2026-04-10
**Commits pushed:** e077a1d (auth), e9ec4e9 (mark complete), 6dafebe (teleprompter bugs)

---

## BEFORE YOU START

This deploy removes nginx basic auth and replaces it with Express session login.
The app will be unprotected for about 60 seconds between removing nginx auth and
restarting PM2. Do it in one sequence without pausing.

---

## STEP 1 — Open DigitalOcean Console

Go to: https://cloud.digitalocean.com → Droplets → kre8r → Console

Log in as root (or your sudo user).

---

## STEP 2 — Pull the code and install deps

```bash
cd /home/kre8r/kre8r
sudo -u kre8r git pull origin master
sudo -u kre8r npm install --production
```

Verify `bcryptjs` and `express-session` are in the output.

---

## STEP 3 — Set a new password BEFORE restarting

The old password (`kre8r2024`) is known to the dev friend. Set a new one now,
before the server restarts with the new auth system.

Run this one-liner (replace `yourNewPassword` with the actual password you want):

```bash
sudo -u kre8r KRE8R_PASSWORD=yourNewPassword node -e "
const { initDb, updateUserPassword } = require('./src/db');
const bcrypt = require('bcryptjs');
initDb();
const hash = bcrypt.hashSync(process.env.KRE8R_PASSWORD, 10);
updateUserPassword(1, hash);
console.log('Password updated for user ID 1 (jason)');
"
```

> **Note:** If the `users` table doesn't exist yet (first deploy with this code),
> the server will seed it on first start with `KRE8R_PASSWORD` from the env.
> In that case, skip this step and instead set the env var in the next step.

---

## STEP 4 — Set SESSION_SECRET in the environment

The session secret is in `.env` locally but you need it on the server too.
Check if it's already in the server's `.env`:

```bash
grep SESSION_SECRET /home/kre8r/kre8r/.env
```

If missing, add it (generate a fresh one for the server):

```bash
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "SESSION_SECRET=$NEW_SECRET" | sudo -u kre8r tee -a /home/kre8r/kre8r/.env
echo "Added: SESSION_SECRET=$NEW_SECRET"
```

---

## STEP 5 — Remove nginx basic auth

The new Express auth replaces the nginx htpasswd wall. Remove it so nginx stops
blocking the login page itself.

```bash
sudo nano /etc/nginx/sites-enabled/kre8r
```

Find and **remove or comment out** these two lines (they'll be in the `server` block):

```nginx
# DELETE or comment these out:
auth_basic "Kre8r";
auth_basic_user_file /etc/nginx/.htpasswd;
```

Save with `Ctrl+X → Y → Enter`.

Test the config before reloading:

```bash
sudo nginx -t
```

Should say: `syntax is ok` and `test is successful`.

---

## STEP 6 — Restart PM2 and reload nginx simultaneously

```bash
sudo -u kre8r pm2 restart kre8r && sudo systemctl reload nginx
```

---

## STEP 7 — Verify login works

Open `https://kre8r.app` in your browser.

You should see the **Kre8Ωr sign in page** — dark theme, teal wordmark, username/password fields.

Log in with:
- Username: `jason`
- Password: whatever you set in Step 3

If it works → you're in. The nav bar now has a tiny ⏏ sign-out button top right.

---

## STEP 8 — Create a limited account for the dev friend (optional)

If you want to give him read-only access to specific things, create a viewer account.
Do this from the browser while logged in as jason, using the browser console or curl:

```bash
curl -X POST https://kre8r.app/auth/users \
  -H "Content-Type: application/json" \
  -H "Cookie: kre8r.sid=YOUR_SESSION_COOKIE" \
  -d '{"username":"devfriend","password":"somePassword","role":"viewer"}'
```

Or just don't — the simplest option is he gets nothing until you decide otherwise.

---

## STEP 9 — Mark the Rock Rich video complete

1. Go to `https://kre8r.app/northr.html`
2. Scroll to the 🟡 stalled section
3. Find the Rock Rich launch video
4. Hit `✓ Done` — it's gone. Pipeline is clean.

---

## STEP 10 — Verify TeleprΩmpter fixes (next shoot)

The teleprompter b-roll stripping bugs are fixed in this deploy. Any script lines with
inline b-roll notes (e.g. `"Three years (b-roll: aerial) of building this."`) will now
render correctly as `"Three years of building this."` instead of being dropped.

No action needed — it just works now.

---

## FUTURE: teleprompter.kre8r.app subdomain

Not in this deploy. Requires:

```bash
# 1. Add DNS A record in DigitalOcean Networking:
#    Type: A  |  Hostname: teleprompter  |  Value: [same droplet IP]  |  TTL: 300

# 2. Add nginx server block:
sudo nano /etc/nginx/sites-enabled/teleprompter-kre8r
```

Paste this server block:

```nginx
server {
    listen 80;
    server_name teleprompter.kre8r.app;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }
}
```

```bash
# 3. Test and reload nginx
sudo nginx -t && sudo systemctl reload nginx

# 4. Get SSL cert for the new subdomain
sudo certbot --nginx -d teleprompter.kre8r.app
```

Once this is done, the field teleprompter setup is:
- Laptop opens `teleprompter.kre8r.app` (through Phone 1's hotspot data)
- Loads project, generates QR codes
- Phone 1 scans QR → control mode (session code required)
- Phone 2 scans QR → voice mode (session code required)
- Done. No office wifi needed.

---

## TROUBLESHOOTING

**"I'm stuck in a login loop"**
The session cookie might not be setting. Check that nginx isn't stripping cookies.
Look for `proxy_set_header Cookie` in nginx config.

**"Password doesn't work after deploy"**
The users table seeded with the old `kre8r2024` password. Run Step 3 again.

**"Can't reach kre8r.app at all"**
nginx config error. Run `sudo nginx -t` and check the output.
Roll back: `sudo git stash` and `sudo -u kre8r pm2 restart kre8r`.

**"API calls returning 401 in the browser"**
Session expired or cookie cleared. Log in again at `/login`.
If it keeps happening, check `SESSION_SECRET` is set in `.env`.

**"PM2 logs show bcrypt errors"**
Run `sudo -u kre8r npm install --production` again — bcryptjs may not have installed.
