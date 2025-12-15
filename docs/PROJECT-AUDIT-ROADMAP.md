# Project Audit — Roadmap (30/60/90 days)

This is a pragmatic execution plan. Adjust based on how widely Posterrama is deployed and whether “local directory” is a core feature for your users.

## 0–30 days (high ROI)

1. Protect `/metrics` in production (done)
    - Auth middleware added.
    - Regression test added.

2. Fix ZIP download-all memory risk (done)
    - ZIP endpoints stream output via a streaming archiver.
    - Limits enforced (max bytes/files/depth/max single file) with clear 413 errors.
    - Tests cover streaming behavior and limit enforcement.

3. Remove legacy “groups” remnants (done)
    - Device update rejects legacy `groups`.
    - One-time migration scrubs stored devices.
    - Tests updated.

4. Unify runtime logging
    - Convert `config/validate-env.js` migration logs to `logger.*`.
    - Emit a concise migration summary.
    - Status: partially done — logger initialization no longer uses sync filesystem calls; config self-healing still uses direct console output.

## 31–60 days (stability and maintainability)

5. Remove/replace `execSync` usage in server paths (mostly done)
    - Runtime disk free space checks use `fs.promises.statfs()` (no shell pipeline).
    - Follow-up: audit remaining `execSync` usage in non-request utilities and keep it off hot paths.
    - Related: avoid `fs.*Sync` in runtime paths where possible; remaining sync usage is primarily startup-only utilities and tests.

6. Add a small “error taxonomy” and enforce it
    - Stable error codes + consistent HTTP mapping.

7. Add targeted security tests
    - Admin endpoints auth boundary.
    - Local-directory traversal attempts.

## 61–90 days (future-proofing)

8. Decompose `utils/cache.js`
    - Split into 3–5 modules.
    - Add unit tests around the cache tiers.

9. Continue shrinking `server.js`
    - Move remaining inline route definitions to route factories.
    - Move app construction to a single module (wiring-only in `server.js`).

10. Operational readiness pass

- Runbooks + alert thresholds (memory, event loop lag, 5xx, upstream failures).

## Decision points (needs your input)

- Should `/metrics` be protected-by-default in production?
- Should ZIP export support huge directory trees, or should it be “small export only”?

Last updated: 2025-12-15
