# Project Audit — Security Hardening

## Threat model (pragmatic)

Posterrama is “private/trusted clients”, but the biggest realistic risks are:

- Accidental exposure (reverse proxy misconfig, public port, `/metrics` open)
- Local file access features (local directory browsing/download)
- Admin endpoints used without authentication due to routing/config mistakes
- Command execution helpers used unsafely (shell injection, event-loop blocking)

## High-impact findings

### 1) `/metrics` should be treated as sensitive

- Location: `server.js` defines `GET /metrics`.
- Risk: leaks operational details (paths, versions, potentially high-cardinality labels).
- Concrete mitigation options:
    - Config-gate in production (default: disabled or protected).
    - Protect with bearer token (`Authorization: Bearer ...`).
    - IP allowlist when behind proxy.
    - Keep public only in dev/test.

### 2) Shell execution should avoid string commands

- Locations:
    - `utils/cache.js` uses `execSync` with shell pipeline for `df | tail | awk`.
    - `lib/config-helpers.js` builds a `pm2 restart <appName>` command string.
- Risks:
    - Shell injection (low probability, but avoidable).
    - Event-loop blocking (guaranteed with execSync).
- Concrete fixes:
    - Use `spawn('df', ['-k', dir])` then parse.
    - Use `spawn('pm2', ['restart', appName, '--update-env'])`.
    - Validate `appName` against a conservative regex like `/^[A-Za-z0-9:_-]+$/`.

### 3) Local file features are mostly safe, but need guardrails

- Location: `routes/local-directory.js`
- Current strengths:
    - Uses path resolution + “within base” checks.
    - Requires authentication on download endpoints.
- Remaining risks:
    - ZIP download-all can be abused to create very expensive operations.
    - Symlink traversal needs explicit policy (allow or block symlinks under base).
- Concrete fixes:
    - Add max total bytes/file count.
    - Use streaming ZIP.
    - Decide whether symlinks under root are allowed; enforce consistently.

### 4) Upload pipeline looks disciplined, but verify root constraints

- Location: `middleware/fileUpload.js`
- Strengths:
    - Allowed directory list.
    - Filename validation.
    - Size limits.
- Recommended additions:
    - Ensure final write path is within expected root even if rootPath changes.
    - Ensure uploaded file extensions match expected MIME types for risky formats.

## Operational hardening

- Default to strict cookies in production (already done) and ensure proxy settings match deployment.
- Add security headers validation tests (CSP/permissions policy/cors).
- Make “admin endpoints require auth” a testable invariant:
    - A regression test that iterates `/api/admin/*` and asserts 401/403 without auth.

Last updated: 2025-12-15
