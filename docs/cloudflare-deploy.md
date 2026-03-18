# Cloudflare Deployment Notes

## 1) Current readiness in this project

This project now includes:
- gzip/br compression middleware (`compression`)
- static asset cache headers (`public/` max-age 6h)
- in-memory read cache for `data/db.json`
- serialized atomic writes for `data/db.json` to avoid concurrent write conflicts
- health check endpoint: `GET /healthz`

These changes are enough for a single small Node instance to handle around 100 concurrent users for this workload.

## 2) Recommended production architecture

Use Cloudflare as edge + one origin app server:
1. Deploy Node app to a nearby region for China users (Hong Kong / Tokyo / Singapore preferred).
2. Put domain behind Cloudflare proxy (orange cloud).
3. Enable HTTP/3, Brotli, Early Hints, and Tiered Cache in Cloudflare.
4. Add a health check against `/healthz`.

## 3) Cloudflare cache rules

Recommended cache behavior:
- `/public/*`: cache at edge (longer TTL, e.g. 1 day)
- dynamic pages (`/student*`, `/teacher*`, `/topics*`): bypass or short cache (only if stale tolerance is acceptable)
- POST requests: never cache

Because this app shows fresh comments, do not use "Cache Everything" globally.

## 4) China speed strategy

If most users are in mainland China:
- Best path: use Cloudflare's China-optimized network offering (enterprise capability) with compliant setup.
- Practical fallback: keep origin close to China (Hong Kong) and combine Cloudflare with strict static caching + lightweight pages.
- If you need consistently low latency across mainland operators, consider dual-CDN architecture (Cloudflare + mainland CDN) and geo DNS steering.

## 5) Scalability warning (important)

`data/db.json` is local file storage. For multi-instance scaling, this is not suitable.

Before scaling beyond one instance, migrate to shared storage:
- Cloudflare D1 / external managed DB for topics/comments
- optionally Cloudflare KV for non-critical cached reads

## 6) Quick 100-concurrency test

Run locally on the server:

```bash
npm install
npm run start
npx autocannon -c 100 -d 20 http://127.0.0.1:3000/student
```

Target guideline for this app:
- no 5xx errors
- p95 latency stable under expected SLA
