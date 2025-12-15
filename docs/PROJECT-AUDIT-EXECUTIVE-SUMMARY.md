# Project Audit — Executive Summary (December 2025)

## What’s already strong

- Clear operational focus: health checks, OpenAPI validation, and quality gates exist.
- Sensible session hardening in server startup (e.g., minimum secret length; file-store ENOENT suppression).
- Good file-path safety patterns in several places (e.g., local directory endpoints and admin log download use “within base” / realpath checks).
- Many routes are modularized with dependency injection (route factories), which is the right direction.

## Top issues (prioritized)

### P0 (high risk / likely to bite)

1. Memory/OOM risk in local directory ZIP download
    - Current pattern reads every file into memory before writing ZIP (recursive download).
    - Fix: stream ZIP output (e.g., using a streaming archiver) and enforce size/entry limits.

2. Public `/metrics` exposure in production
    - Status: fixed — `/metrics` now requires authentication (admin session or API token).

3. Legacy “groups” remnants after feature removal
    - Status: fixed — `groups` is rejected on device updates and scrubbed from stored devices.

### P1 (medium risk / correctness and maintainability)

4. Event-loop blocking shell calls (`execSync`) for disk free space
    - Found in cache free-space logic; if invoked on request paths it can stall the server.
    - Fix: move to background interval caching, or use non-blocking child-process spawn and timeouts.

5. Config self-healing logs bypass the logger pipeline
    - `config/validate-env.js` uses `console.log` heavily.
    - Fix: route through the project logger (and add a “quiet” mode / structured summary).

6. Monolithic `server.js` still contains many “special-case” inline routes and legacy glue
    - This makes changes risky and increases regression probability.
    - Fix: continue extracting to route factories + services with stable interfaces.

### P2 (nice improvements that pay off)

7. Type safety debt concentrated in core utilities
    - Example: `utils/cache.js` is `@ts-nocheck` and very large.
    - Fix: split module + add JSDoc types incrementally; enforce via CI.

8. Metrics cardinality risks
    - If metrics label on raw request paths exists anywhere, it can explode cardinality.
    - Fix: normalize to route templates (e.g., `/api/media/:id`), cap label sets.

## Quick wins (1–3 days)

- Remove legacy groups handling (API + storage cleanup). (done)
- Guard `/metrics` in production (config flag + middleware). (done)
- Add limits + streaming for ZIP downloads (or disable ZIP for large directories).
- Replace config migration `console.log` with logger calls and a concise summary.

## Medium investments (1–3 weeks)

- Refactor `utils/cache.js` into smaller units (disk usage, tiering, persistence, metrics).
- Add targeted tests for the risky areas:
    - local path traversal attempts
    - ZIP download size limits
    - metrics auth behavior
    - groups deprecation behavior

## Longer-term (1–3 months)

- Continue decomposing `server.js` and formalize interfaces between:
    - route factories
    - services
    - data stores
- Add a “compatibility contract” for config migrations and API evolution (deprecation policy).

Last updated: 2025-12-15
