#!/bin/bash
# ─────────────────────────────────────────────
#  Kre8Ωr — Deploy latest code from GitHub
#  Run on the DigitalOcean server as kre8r user
#  Usage: bash deploy.sh
# ─────────────────────────────────────────────
set -e

APP_DIR="/home/kre8r/kre8r"

echo "[deploy] Pulling latest from master..."
git -C "$APP_DIR" pull origin master

echo "[deploy] Installing dependencies..."
cd "$APP_DIR" && npm install --production --quiet

echo "[deploy] Restarting PM2..."
pm2 restart kre8r

echo "[deploy] ✓ Done. Status:"
pm2 status
