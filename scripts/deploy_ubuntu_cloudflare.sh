#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-19401128.xyz}"
REPO_URL="${REPO_URL:-https://github.com/yzphalf/english.git}"
BRANCH="${BRANCH:-main}"
APP_ROOT="${APP_ROOT:-/opt/english}"
APP_DIR="${APP_DIR:-$APP_ROOT/app}"
SERVICE_NAME="${SERVICE_NAME:-english}"
EMAIL="${EMAIL:-admin@19401128.xyz}"
NODE_MAJOR="${NODE_MAJOR:-20}"
APP_PORT="${APP_PORT:-3000}"
TEACHER_USERNAME="${TEACHER_USERNAME:-admin}"
TEACHER_PASSWORD="${TEACHER_PASSWORD:-}"

random_string() {
  local chars="$1"
  local length="$2"
  local value
  value="$(tr -dc "$chars" </dev/urandom | head -c "$length" || true)"
  printf '%s' "$value"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root: sudo bash $0" >&2
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release; then
  echo "This script is intended for Ubuntu VPS hosts." >&2
  exit 1
fi

if [ -z "$TEACHER_PASSWORD" ]; then
  TEACHER_PASSWORD="$(random_string 'A-Za-z0-9' 18)"
fi

SESSION_SECRET="$(random_string 'A-Za-z0-9_-' 48)"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"
NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
PM2_CONFIG="${APP_ROOT}/ecosystem.config.cjs"
ENV_FILE="${APP_ROOT}/.env.production"

echo "==> Deploying ${SERVICE_NAME} to ${PUBLIC_BASE_URL}"

apt-get update
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx build-essential

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v${NODE_MAJOR}\\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

mkdir -p "$APP_ROOT"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

mkdir -p "$APP_DIR/data" "$APP_ROOT/backups"
npm ci --omit=dev

if [ -f "$ENV_FILE" ]; then
  # Keep existing production secrets on redeploy.
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  {
    printf 'TEACHER_USERNAME=%q\n' "$TEACHER_USERNAME"
    printf 'TEACHER_PASSWORD=%q\n' "$TEACHER_PASSWORD"
    printf 'SESSION_SECRET=%q\n' "$SESSION_SECRET"
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

cat >"$PM2_CONFIG" <<PM2
module.exports = {
  apps: [{
    name: '${SERVICE_NAME}',
    cwd: '${APP_DIR}',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '${APP_PORT}',
      PUBLIC_BASE_URL: '${PUBLIC_BASE_URL}',
      TEACHER_USERNAME: process.env.TEACHER_USERNAME,
      TEACHER_PASSWORD: process.env.TEACHER_PASSWORD,
      SESSION_SECRET: process.env.SESSION_SECRET,
      RATE_LIMIT_COMMENT_PER_MIN: '30',
      RATE_LIMIT_TEACHER_POST_PER_MIN: '10',
      RATE_LIMIT_LOGIN_PER_MIN: '20'
    }
  }]
};
PM2

cat >"$NGINX_SITE" <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};

  location /.well-known/acme-challenge/ {
    root /var/www/html;
  }

  location / {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX

ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
pm2 startOrReload "$PM2_CONFIG" --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    -m "$EMAIL" \
    --redirect
fi

nginx -t
systemctl reload nginx
curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow OpenSSH >/dev/null || true
  ufw allow 'Nginx Full' >/dev/null || true
fi

echo
echo "Deploy done."
echo "URL: ${PUBLIC_BASE_URL}"
echo "Local health: http://127.0.0.1:${APP_PORT}/healthz"
echo "Teacher username: ${TEACHER_USERNAME}"
echo "Teacher password: ${TEACHER_PASSWORD}"
echo
echo "Cloudflare DNS: A @ -> this VPS IPv4, Proxy status = Proxied."
echo "Cloudflare SSL/TLS: Full (strict)."
