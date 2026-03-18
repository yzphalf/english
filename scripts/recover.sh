#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/english/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/english/backups}"
SERVICE_NAME="${SERVICE_NAME:-english}"
BRANCH="${BRANCH:-main}"

if [ ! -d "$APP_DIR" ]; then
  echo "APP_DIR not found: $APP_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

TS="$(date +%F_%H%M%S)"
DB_FILE="$APP_DIR/data/app.db"
DB_WAL="$APP_DIR/data/app.db-wal"
DB_SHM="$APP_DIR/data/app.db-shm"

step() {
  echo "\n==> $1"
}

step "1/8 Backup SQLite data"
if [ -f "$DB_FILE" ]; then
  cp "$DB_FILE" "$BACKUP_DIR/app.db.$TS"
  [ -f "$DB_WAL" ] && cp "$DB_WAL" "$BACKUP_DIR/app.db-wal.$TS" || true
  [ -f "$DB_SHM" ] && cp "$DB_SHM" "$BACKUP_DIR/app.db-shm.$TS" || true
  echo "Backup saved at $BACKUP_DIR (timestamp: $TS)"
else
  echo "No app.db found, skip DB backup"
fi

step "2/8 Fetch latest code"
git fetch origin

step "3/8 Checkout and pull branch: $BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

step "4/8 Install production dependencies"
npm ci --omit=dev

step "5/8 Reload Nginx safely"
if command -v nginx >/dev/null 2>&1; then
  nginx -t
  systemctl restart nginx
else
  echo "nginx not installed, skip"
fi

step "6/8 Restart PM2 service: $SERVICE_NAME"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    pm2 restart "$SERVICE_NAME" --update-env
  else
    RATE_LIMIT_COMMENT_PER_MIN="${RATE_LIMIT_COMMENT_PER_MIN:-30}" \
    RATE_LIMIT_TEACHER_POST_PER_MIN="${RATE_LIMIT_TEACHER_POST_PER_MIN:-10}" \
    RATE_LIMIT_LOGIN_PER_MIN="${RATE_LIMIT_LOGIN_PER_MIN:-20}" \
    pm2 start server.js --name "$SERVICE_NAME" --instances 1 --update-env
  fi
  pm2 save
else
  echo "pm2 not installed, skip"
fi

step "7/8 Health check"
if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null
  echo "Health check passed"
else
  echo "curl not installed, skip health check"
fi

step "8/8 Done"
echo "Recovery completed."
