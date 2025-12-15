# Project Audit — Observability (Metrics, Logs, Operations)

## Current strengths

- Prometheus-style metrics endpoint exists (`/metrics`).
- Request IDs are generated and included in request logging.
- There are admin log streaming and download endpoints, with security checks.

## Concrete improvements

### 1) Make metrics safe to run in production

- Decide on a default posture:
    - Option A: metrics enabled + protected (recommended)
    - Option B: metrics disabled by default in prod

- Add one of:
    - bearer token middleware
    - IP allowlist (works well behind reverse proxy)
    - reverse-proxy auth (basic auth / mTLS)

### 2) Control label cardinality

- If any HTTP metrics include labels like `path=req.path`, cardinality can blow up.
- Concrete guardrails:
    - label on “route pattern” not raw path
    - cap/sanitize user agent logging fields

### 3) Standardize error codes

- Recommendation: adopt a small, stable error-code vocabulary.
- Example categories:
    - `invalid_request`
    - `not_found`
    - `unauthorized`
    - `upstream_timeout`
    - `io_error`

This improves client UX and makes alerting/analytics meaningful.

### 4) Add operational runbooks (short)

- “Server won’t start” (config/schema/env)
- “Images missing” (cache, upstream)
- “Devices not pairing” (wsHub, time sync)
- “High memory” (cache tiers, ZIP download, thumbnails)

## Alerts worth having

- process RSS over threshold + rising trend
- event-loop lag P95 over threshold
- 5xx rate over threshold
- upstream errors per source (Plex/Jellyfin/TMDB)

Last updated: 2025-12-15
