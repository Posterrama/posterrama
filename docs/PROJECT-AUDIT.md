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

## Open items (the only things worth tracking here)

### P1 (medium risk / correctness and maintainability)

1. Continue shrinking `server.js`
    - Goal: fewer inline routes/special-cases; more route factories and services.
    - Payoff: lower regression probability and easier changes.

2. ZIP exports: stop work on client disconnect
    - Status: output is streamed and bounded; remaining waste is CPU/disk if the client drops.
    - Fix: abort traversal/archiving quickly on `req`/`res` close.

3. Standardize error codes (small taxonomy)
    - Goal: stable error-code vocabulary + consistent HTTP mapping.
    - Payoff: better client UX and meaningful alerting.

4. Targeted security regression tests
    - Admin endpoints auth boundary as a testable invariant.
    - Local-directory traversal attempts (incl. symlink policy if applicable).

### P2 (nice improvements that pay off)

5. Type-safety and modularity debt in core utilities (especially `utils/cache.js`)
    - Approach: split by concern first, then add JSDoc typedefs incrementally.
    - Constraint: keep changes small and test-backed to avoid regressions.

## Notes / guardrails

- Keep `console.*` mostly for fatal CLI/startup output and tests; use the shared logger for runtime behavior.
- Prefer route-template labels for metrics (avoid `req.originalUrl` / raw paths as labels).
