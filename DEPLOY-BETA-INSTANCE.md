# Deploying a Beta Instance on DigitalOcean

One server, second PM2 process, isolated DB and profile, nginx subdomain.

---

## 1. SSH into the droplet

```bash
ssh kre8r@your-droplet-ip
```

---

## 2. Clone the repo into a new directory

```bash
cd /home/kre8r
git clone https://github.com/7kinhomestead/kre8r.git kre8r-beta
cd kre8r-beta
npm install --production
```

---

## 3. Create the beta .env

```bash
cp /home/kre8r/kre8r/.env /home/kre8r/kre8r-beta/.env
nano /home/kre8r/kre8r-beta/.env
```

Change these values (leave API keys blank — the beta user fills in their own):

```
PORT=3001
DB_PATH=/home/kre8r/kre8r-beta/database/kre8r-beta.db
CREATOR_PROFILE_PATH=/home/kre8r/kre8r-beta/creator-profile.json
SESSION_SECRET=<generate a new random secret — never share Jason's>

# Beta user fills in their own keys:
ANTHROPIC_API_KEY=
YOUTUBE_API_KEY=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
GOOGLE_AI_API_KEY=
KIE_API_KEY=
SUNO_API_KEY=
MAILERLITE_API_KEY=
META_APP_ID=
META_APP_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
NGROK_AUTHTOKEN=

# Clear Jason's personal config:
YOUTUBE_CHANNEL_HANDLE=
MAILERLITE_FROM_EMAIL=
MAILERLITE_FROM_NAME=
KRE8R_OWNER_PW=<set the beta user's password here>
INTERNAL_API_KEY=<generate new — never share Jason's>
LAND_INTERNAL_KEY=
```

---

## 4. Set up the beta creator-profile.json

```bash
cp /home/kre8r/kre8r/creator-profile-beta.json /home/kre8r/kre8r-beta/creator-profile.json
```

The beta user edits this on first run via SoulBuildΩr, or manually.

---

## 5. Create the database directory

```bash
mkdir -p /home/kre8r/kre8r-beta/database
```

---

## 6. Start with PM2

```bash
cd /home/kre8r/kre8r-beta
pm2 start server.js --name kre8r-beta
pm2 save
```

Verify it's up:
```bash
pm2 status
curl http://localhost:3001/api/health
```

---

## 7. Nginx subdomain

Add a new server block to `/etc/nginx/sites-available/kre8r`:

```nginx
server {
    listen 80;
    server_name beta.kre8r.app;

    location / {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

Then enable SSL:
```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d beta.kre8r.app
```

---

## 8. DNS

Add an A record in your DNS provider:
- Type: A
- Name: beta
- Value: your-droplet-ip

---

## What the beta user sees

The `creator-profile-beta.json` disables 7 Kin specific tools in the nav:
- ❌ AffiliateΩr (land affiliate business)
- ❌ AudiencΩr (Kajabi community — 7 Kin specific)
- ❌ MarkΩr (community copyright enforcement)
- ❌ GuardΩr (community moderation inbox)
- ❌ AnalyticΩr (TikTok analytics — not needed yet)
- ❌ Analytics Import (TikTok CSV — not needed yet)

Everything else is live and functional. The beta user sets up their own API keys.

---

## Adding more instances later

Same pattern: new directory, new port (3002, 3003...), new PM2 name, new nginx block, new subdomain.
When multi-tenancy is fully built out (tenant DB isolation), this gets simpler.
