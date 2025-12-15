# Project Audit (Consolidated) — December 2025

This document consolidates the Posterrama project audit into a single, current source of truth.
It focuses on what remains open and what has been completed.

Last updated: 2025-12-15

## Current status (high level)

**Done / shipped**

- ZIP download-all: streamed output + hard limits (max bytes/files/depth/max single file) with tests.
- `/metrics`: protected (authentication required).
- Legacy `groups` field: rejected on device updates + scrubbed from stored devices.
- Runtime sync filesystem I/O: major hot paths migrated off `fs.*Sync` (including logger init and updater worker logging).
- Config maintenance logging: `config/validate-env.js` no longer spams `console.log`; uses the shared logger + quiet/verbose + summary.
- Metrics cardinality guardrails: HTTP metrics now use route templates (baseUrl + route path) and Prometheus HTTP request metrics are recorded.
- ZIP exports: abort work on client disconnect (ZIP streaming routes stop traversal and abort the archive on disconnect).
- Error taxonomy: error responses now include an additive `code` field (e.g. `invalid_request`, `not_found`, `internal_error`).
- Security regression tests: enforce admin auth boundary + local-directory traversal/symlink protections.

## Open items (the only things worth tracking here)

### P1 (medium risk / correctness and maintainability)

1. Continue shrinking `server.js`
    - Goal: fewer inline routes/special-cases; more route factories and services.
    - Payoff: lower regression probability and easier changes.

2. (Optional) Tighten the admin-auth boundary test
    - Current invariant: every `/api/admin/*` route definition contains an auth middleware.
    - If desired: make it stricter (e.g., require auth middleware before the handler, not just present in the argument list).

### P2 (nice improvements that pay off)

5. Type-safety and modularity debt in core utilities (especially `utils/cache.js`)
    - Approach: split by concern first, then add JSDoc typedefs incrementally.
    - Constraint: keep changes small and test-backed to avoid regressions.

## Notes / guardrails

- Keep `console.*` mostly for fatal CLI/startup output and tests; use the shared logger for runtime behavior.
- Prefer route-template labels for metrics (avoid `req.originalUrl` / raw paths as labels).
