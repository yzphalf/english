# 19401128.xyz Ubuntu VPS 一键部署

## 1. Cloudflare DNS

在 Cloudflare 托管 `19401128.xyz` 后，添加：

- Type: `A`
- Name: `@`
- IPv4 address: `<你的 VPS 公网 IPv4>`
- Proxy status: `Proxied`
- TTL: `Auto`

如果也要支持 `www.19401128.xyz`，再添加一条：

- Type: `CNAME`
- Name: `www`
- Target: `19401128.xyz`
- Proxy status: `Proxied`

## 2. Cloudflare SSL

Cloudflare 控制台：

- SSL/TLS encryption mode: `Full (strict)`
- Always Use HTTPS: `On`
- Automatic HTTPS Rewrites: `On`

## 3. VPS 执行

先把仓库推到 GitHub，并确认 `REPO_URL` 可被 VPS 拉取。然后在 Ubuntu VPS 上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/yzphalf/english/main/scripts/deploy_ubuntu_cloudflare.sh -o /tmp/deploy_english.sh
sudo DOMAIN=19401128.xyz \
  REPO_URL=https://github.com/yzphalf/english.git \
  EMAIL=admin@19401128.xyz \
  bash /tmp/deploy_english.sh
```

如果你要指定老师端密码：

```bash
sudo DOMAIN=19401128.xyz \
  REPO_URL=https://github.com/yzphalf/english.git \
  EMAIL=admin@19401128.xyz \
  TEACHER_USERNAME=admin \
  TEACHER_PASSWORD='change-this-password' \
  bash /tmp/deploy_english.sh
```

## 4. 常用检查命令

```bash
pm2 status
curl -I http://127.0.0.1:3000/healthz
nginx -t
curl -I https://19401128.xyz/healthz
```

## 5. 数据位置

应用目录：

```bash
/opt/english/app
```

SQLite 数据：

```bash
/opt/english/app/data/app.db
```

生产环境变量：

```bash
/opt/english/.env.production
```
