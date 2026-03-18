#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-english.051231.xyz}"
REPO_URL="${REPO_URL:-https://github.com/yzphalf/english.git}"
APP_ROOT="${APP_ROOT:-/opt/english}"
APP_DIR="$APP_ROOT/app"
SERVICE_NAME="${SERVICE_NAME:-english}"
BRANCH="${BRANCH:-main}"
EMAIL="${EMAIL:-admin@051231.xyz}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}:8443}"

echo "==> v1.0 one-click install"

apt-get update
apt-get install -y curl git nginx certbot python3-certbot-nginx
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null 2>&1; then
  npm i -g pm2
fi

mkdir -p "$APP_ROOT"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  git checkout "$BRANCH"
fi

mkdir -p "$APP_DIR/data"
cd "$APP_DIR"
npm ci --omit=dev

cat >/etc/nginx/sites-available/english <<NGINX
server {
  listen 80;
  server_name $DOMAIN;
  return 301 https://\$host:8443\$request_uri;
}

server {
  listen 8443 ssl http2;
  server_name $DOMAIN;

  ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX

ln -sf /etc/nginx/sites-available/english /etc/nginx/sites-enabled/english
rm -f /etc/nginx/sites-enabled/default

# Certificate bootstrap. If DNS/CDN state blocks challenge, rerun this after setting DNS only temporarily.
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || true
fi

nginx -t
systemctl restart nginx

pm2 delete "$SERVICE_NAME" >/dev/null 2>&1 || true
PUBLIC_BASE_URL="$PUBLIC_BASE_URL" \
PORT=3000 HOST=127.0.0.1 NODE_ENV=production \
RATE_LIMIT_COMMENT_PER_MIN=30 \
RATE_LIMIT_TEACHER_POST_PER_MIN=10 \
RATE_LIMIT_LOGIN_PER_MIN=20 \
pm2 start server.js --name "$SERVICE_NAME" --instances 1 --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "\nInstall done."
echo "URL: $PUBLIC_BASE_URL"
echo "Health: curl -I http://127.0.0.1:3000/healthz"
