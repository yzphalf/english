# Cloudflare 上线配置（051231.xyz / english.051231.xyz）

## 目标

- 使用 `english.051231.xyz` 对外提供访问
- Cloudflare 作为反向代理/CDN
- 优先保证中国用户访问速度
- 满足约 100 人并发场景

## 1. DNS 配置

在 Cloudflare `051231.xyz` 的 DNS 页面新增/确认：

1. `A` 记录
- Name: `english`
- IPv4 address: `<你的源站公网 IP>`
- Proxy status: `Proxied`（橙色云，必须开启）
- TTL: `Auto`

2. 可选根域名（如果要主域也可访问）
- Name: `@`
- IPv4 address: `<你的源站公网 IP>`
- Proxy status: `Proxied`
- TTL: `Auto`

## 2. SSL/TLS 配置

在 Cloudflare -> SSL/TLS：

1. Encryption mode: `Full (strict)`
2. 打开 `Always Use HTTPS`
3. 打开 `Automatic HTTPS Rewrites`

说明：源站必须有有效证书（建议 Cloudflare Origin Certificate）。

## 3. Speed 配置

在 Cloudflare -> Speed：

1. 开启 `Brotli`
2. 开启 `HTTP/3 (with QUIC)`
3. 开启 `Early Hints`

## 4. Cache Rules（关键）

不要全站 `Cache Everything`，否则动态讨论页会出现旧数据。

新增规则：

1. 静态资源规则
- 匹配：`hostname eq "english.051231.xyz" and starts_with(http.request.uri.path, "/public/")`
- 动作：
  - Cache eligibility: `Eligible for cache`
  - Edge TTL: `1 day`
  - Browser TTL: `6 hours`

2. 动态页面规则
- 匹配：`hostname eq "english.051231.xyz" and (starts_with(http.request.uri.path, "/student") or starts_with(http.request.uri.path, "/teacher") or starts_with(http.request.uri.path, "/topics"))`
- 动作：
  - Cache eligibility: `Bypass cache`

## 5. 安全和稳定性

在 Security / WAF：

1. WAF 开启（默认 Managed Rules）
2. 新增 Rate Limiting（防刷）：
- 路径：`/student/topics/*/comments`
- 方法：`POST`
- 阈值建议：`60 requests / 1 minute / IP`
- 动作：`Managed Challenge` 或 `Block`

## 6. 源站部署要求

你的 Node 服务保持：

- 监听 `0.0.0.0`
- 端口由环境变量 `PORT` 注入
- 健康检查可访问：`GET /healthz`

当前项目代码已符合以上要求（见 `server.js`）。

## 7. 并发验证（100 并发）

在服务器执行：

```bash
npm install
npm run start
npm run bench:100
```

验收基线：

- 无 `5xx`
- p95 延迟在可接受范围内（建议 < 300ms，按你业务目标可调整）

## 8. 中国访问优化建议

1. 源站优先部署在中国周边低时延区域：香港/新加坡/东京
2. 页面内尽量避免加载第三方海外慢资源
3. 若后续中国用户占比高且需要更稳定低延迟，考虑：
- Cloudflare 中国网络能力（企业方案）
- 或双 CDN（Cloudflare + 中国大陆 CDN）+ GeoDNS

## 9. 当前架构边界（必须知道）

项目当前使用 `data/db.json` 本地文件存储。  
单实例可用；多实例横向扩容会有数据一致性风险。

当并发继续上涨时，建议迁移到共享数据库（如 D1 / 托管 MySQL/PostgreSQL）。
