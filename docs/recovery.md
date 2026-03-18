# Recovery Runbook

Use this when production is abnormal but you want to keep all teacher topics/comments.

## One-command recovery

```bash
bash /opt/english/app/scripts/recover.sh
```

## What it does

1. Backup SQLite (`data/app.db`, `app.db-wal`, `app.db-shm`) to `/opt/english/backups`.
2. Pull latest code from `origin/main`.
3. Reinstall production dependencies (`npm ci --omit=dev`).
4. Validate and restart Nginx.
5. Restart PM2 app (`english`) with existing env.
6. Check `http://127.0.0.1:3000/healthz`.

## Optional overrides

```bash
APP_DIR=/opt/english/app \
BACKUP_DIR=/opt/english/backups \
SERVICE_NAME=english \
BRANCH=main \
PORT=3000 \
bash /opt/english/app/scripts/recover.sh
```

## If DB restore is needed

```bash
pm2 stop english
cp /opt/english/backups/app.db.<timestamp> /opt/english/app/data/app.db
pm2 start english
```
