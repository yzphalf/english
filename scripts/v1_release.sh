#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/english/app}"
SERVICE_NAME="${SERVICE_NAME:-english}"
BRANCH="${BRANCH:-main}"

if [ ! -d "$APP_DIR" ]; then
  echo "APP_DIR not found: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
mkdir -p data
npm ci --omit=dev
nginx -t && systemctl reload nginx
pm2 restart "$SERVICE_NAME" --update-env
pm2 save
curl -fsS http://127.0.0.1:3000/healthz >/dev/null
echo "Release done: $BRANCH"
