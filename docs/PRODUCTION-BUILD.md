# Production Deployment Guide (No Build Pipeline)

**Version:** 2.9.9
**Last Updated:** 2025-12-14

Posterrama v2.9.9 does not use a bundler-driven frontend “production build” (`dist/public/`, `npm run build:prod`, etc.).

- Frontend assets are served directly from `public/`.
- “Production” primarily means runtime configuration + process management (PM2) + safe logging.

---

## Quick Start (Typical Production)

1. Configure `.env` (not committed) and `config.json`.

2. Install dependencies:

```bash
npm ci
```

3. Start with PM2:

```bash
pm2 delete posterrama
pm2 start ecosystem.config.js
pm2 save
```

---

## Recommended Release Gate

Run the full release readiness script before deploying:

```bash
npm run release:ready
```

For a faster run (skips slow checks):

```bash
npm run release:ready:fast
```

---

## Logging Expectations

- Backend logging should go through the server logger (`utils/logger.js`) rather than raw `console.log`.
- Frontend debugging should be treated as development-only. If you need persistent client-side logs, prefer the existing client logging patterns used by the project.

---

## Production Validation (Live)

These scripts hit a running Posterrama server. Set `TEST_URL` if it’s not `http://localhost:4000`.

```bash
npm run health
TEST_URL=http://localhost:4000 npm run test:contract:live
TEST_URL=http://localhost:4000 npm run test:performance
```

---

## Related Docs

- `DEPLOYMENT-GUIDE.md`
- `SCRIPTS-OVERVIEW.md`
- `PERFORMANCE-BASELINE.md`
