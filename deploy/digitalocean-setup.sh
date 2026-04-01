#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Kre8Ωr — DigitalOcean Droplet Setup Script
#  Run as root on a fresh Ubuntu 22.04 LTS droplet
#
#  Recommended droplet: Basic, $12/mo, 2 vCPU / 2GB RAM / 50GB SSD
#  Region: nyc3 or sfo3
#
#  Usage:
#    1. SSH into your new droplet:  ssh root@YOUR_DROPLET_IP
#    2. Paste and run this script:  bash digitalocean-setup.sh
#    3. Follow the post-install steps at the bottom
# ═══════════════════════════════════════════════════════════════════

set -e  # Exit immediately if any command fails

# ── CONFIGURATION ─────────────────────────────────────────────────
APP_USER="kre8r"
APP_DIR="/home/$APP_USER/kre8r"
REPO_URL="https://github.com/7kinhomestead/kre8r.git"
NODE_VERSION="20"
DOMAIN=""   # Set this to your domain e.g. kre8r.app (leave blank to skip nginx SSL)
APP_PORT=3000

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Kre8Ωr — DigitalOcean Server Setup        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── STEP 1: System update ─────────────────────────────────────────
echo "[1/10] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ── STEP 2: Install essentials ────────────────────────────────────
echo "[2/10] Installing system dependencies..."
apt-get install -y -qq \
  curl \
  git \
  build-essential \
  ffmpeg \
  python3 \
  python3-pip \
  nginx \
  certbot \
  python3-certbot-nginx \
  ufw

# Verify ffmpeg
echo "  ✓ ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

# ── STEP 3: Install Node.js via nvm ──────────────────────────────
echo "[3/10] Installing Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - > /dev/null 2>&1
apt-get install -y -qq nodejs
echo "  ✓ Node: $(node --version)"
echo "  ✓ npm:  $(npm --version)"

# ── STEP 4: Install PM2 globally ─────────────────────────────────
echo "[4/10] Installing PM2..."
npm install -g pm2 -q
echo "  ✓ PM2: $(pm2 --version)"

# ── STEP 5: Create app user ───────────────────────────────────────
echo "[5/10] Creating app user: $APP_USER..."
if id "$APP_USER" &>/dev/null; then
  echo "  → User $APP_USER already exists, skipping"
else
  useradd -m -s /bin/bash "$APP_USER"
  echo "  ✓ User created"
fi

# ── STEP 6: Clone the repo ────────────────────────────────────────
echo "[6/10] Cloning kre8r from GitHub..."
if [ -d "$APP_DIR" ]; then
  echo "  → Directory exists, pulling latest..."
  sudo -u "$APP_USER" git -C "$APP_DIR" pull origin master
else
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi
echo "  ✓ Code at $APP_DIR"

# ── STEP 7: Install npm dependencies ─────────────────────────────
echo "[7/10] Installing npm dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --production --quiet
echo "  ✓ Dependencies installed"

# ── STEP 8: Create .env file ─────────────────────────────────────
echo "[8/10] Setting up environment..."
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" << 'ENVEOF'
# ── Kre8Ωr Environment ──────────────────────────────────────────
# REQUIRED: Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-api03-REPLACE_ME

# OPTIONAL: Suno API key (ComposΩr music generation)
# Without this, ComposΩr runs in Prompt Mode
# SUNO_API_KEY=your-suno-key-here

# Server port (nginx will proxy this — don't change)
PORT=3000

# Claude model (defaults to this if omitted)
# CLAUDE_MODEL=claude-sonnet-4-6
ENVEOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "  ✓ .env created — YOU MUST edit it with your API key:"
  echo "      nano $APP_DIR/.env"
else
  echo "  → .env already exists, skipping (confirm ANTHROPIC_API_KEY is set)"
fi

# Create required directories
sudo -u "$APP_USER" mkdir -p "$APP_DIR/database" "$APP_DIR/public/thumbnails"

# ── STEP 9: Configure PM2 ─────────────────────────────────────────
echo "[9/10] Configuring PM2..."
cat > "$APP_DIR/ecosystem.config.js" << PMEOF
module.exports = {
  apps: [{
    name:        'kre8r',
    script:      'server.js',
    cwd:         '$APP_DIR',
    instances:   1,
    autorestart: true,
    watch:       false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT:     $APP_PORT
    },
    error_file: '/var/log/pm2/kre8r-error.log',
    out_file:   '/var/log/pm2/kre8r-out.log',
    time:       true
  }]
};
PMEOF

mkdir -p /var/log/pm2
chown -R "$APP_USER:$APP_USER" /var/log/pm2
chown "$APP_USER:$APP_USER" "$APP_DIR/ecosystem.config.js"

# Start the app
sudo -u "$APP_USER" bash -c "cd $APP_DIR && pm2 start ecosystem.config.js"
sudo -u "$APP_USER" bash -c "pm2 save"

# Configure PM2 to start on boot
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -1 | bash
echo "  ✓ PM2 running and configured for auto-restart on boot"

# ── STEP 10: Configure nginx reverse proxy ────────────────────────
echo "[10/10] Configuring nginx..."
cat > /etc/nginx/sites-available/kre8r << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN:-_};

    # Increase body size for footage thumbnail uploads
    client_max_body_size 10G;

    # Proxy timeouts for long-running SSE streams
    proxy_read_timeout    3600s;
    proxy_connect_timeout 60s;
    proxy_send_timeout    3600s;

    # WebSocket support (TeleprΩmpter)
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # SSE: disable buffering for real-time log streams
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_request_buffering off;
        proxy_send_timeout    3600s;
        proxy_connect_timeout 60s;
        proxy_buffering off;
    }
}
NGINXEOF

# Enable the site
ln -sf /etc/nginx/sites-available/kre8r /etc/nginx/sites-enabled/kre8r
rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
nginx -t && systemctl reload nginx
echo "  ✓ nginx configured"

# ── FIREWALL ──────────────────────────────────────────────────────
echo "[UFW] Configuring firewall..."
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable
echo "  ✓ Firewall: SSH + HTTP/HTTPS open"

# ── DONE ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Setup complete!                            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Add your API key:"
echo "       nano $APP_DIR/.env"
echo "       # Set ANTHROPIC_API_KEY=sk-ant-api03-..."
echo "       # Then restart: sudo -u $APP_USER pm2 restart kre8r"
echo ""
echo "  2. Point your domain DNS A record to this droplet IP:"
echo "       $(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_DROPLET_IP')"
echo ""
echo "  3. (After DNS propagates) Enable HTTPS with Let's Encrypt:"
echo "       certbot --nginx -d kre8r.app -d www.kre8r.app"
echo ""
echo "  4. Verify the app is running:"
echo "       sudo -u $APP_USER pm2 status"
echo "       curl http://localhost:$APP_PORT/api/projects"
echo ""
echo "  5. Open in browser:"
echo "       http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_DROPLET_IP')"
echo ""
echo "PM2 quick reference:"
echo "  sudo -u $APP_USER pm2 status          # check running"
echo "  sudo -u $APP_USER pm2 logs kre8r       # live logs"
echo "  sudo -u $APP_USER pm2 restart kre8r    # after code changes"
echo ""
echo "Deploy new code:"
echo "  cd $APP_DIR && git pull origin master && npm install --production && pm2 restart kre8r"
echo ""
