#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-english.051231.xyz}"
PORT="${PORT:-8443}"

echo "==> Process"
pm2 status || true

echo "\n==> Health"
curl -I http://127.0.0.1:3000/healthz || true

echo "\n==> Nginx"
nginx -t || true
ss -lntp | grep -E ':80 |:8443 |:3000 ' || true

echo "\n==> Public URL"
curl -I "https://${DOMAIN}:${PORT}" || true

echo "\nDone"
