# Performance Baseline

**Version:** 3.0.0
**Last Updated:** 2025-12-14

This document defines how to capture and track performance baselines for Posterrama.

Posterrama serves frontend assets directly from `public/` (no `dist/` build pipeline).

---

## What We Measure

### 1) Endpoint latency (server)

Posterrama includes a performance monitor that measures common endpoints and compares them against thresholds and (optionally) a baseline file.

Run (requires a running server):

```bash
TEST_URL=http://localhost:4000 npm run test:performance
```

Create/update a baseline:

```bash
TEST_URL=http://localhost:4000 npm run test:performance:baseline
```

Notes:

- Baseline file path: `__tests__/regression/performance-baseline.json`
- The baseline file is auto-generated if missing.
- It may be gitignored (see `.gitignore`). Commit it only if you explicitly want baselines versioned.
- Thresholds and measured endpoints are defined in `scripts/validation/performance-monitor.js`.

### 2) Frontend memory profile (browser)

Posterrama includes a Puppeteer-based profiling script that loads key pages and reports heap/DOM/listener/layout/script-time metrics.

Run (requires a running server):

```bash
npm run perf:memory
```

When you capture new results, update this document with:

- The measured values
- The environment (host hardware + browser)
- Any notable deltas compared to the previous run

### 3) Static asset size snapshot

Because there is no bundling/minification step in v3.0.0, tracking the largest raw assets is useful.

```bash
npm run perf:largest-files
du -sh public/
```

---

## When To Update Baselines

- After changing caching behavior
- After changing source adapters (Plex/Jellyfin / Emby/TMDB/local)
- After adding metrics, middleware, or request validation
- After large frontend changes (admin / display modes)

---

## Related Docs

- `FRONTEND-ANALYSIS.md`
- `DEPLOYMENT-GUIDE.md`
- `SCRIPTS-OVERVIEW.md`
