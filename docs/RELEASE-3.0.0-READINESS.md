# Posterrama v3.0.0 — Release Readiness (Public Release)

**Date:** 2025-12-16  
**Target Version:** 3.0.0  
**Scope:** This document is the single “go/no-go” reference for publishing Posterrama v3.0.0.

---

## 1) Executive Summary (Go/No-Go)

**Current posture:** _Release-candidate quality_.

Why:

- Mature quality gates exist and are automated (`npm run quality:all`, `release:ready`, regression suites, OpenAPI validation, config validation).
- Strong operational surface: backup/restore, metrics, audit logging, update-check flows, MQTT/HA integration.
- Primary risk is maintainability/complexity concentration (not correctness): `server.js` is large and acts as the orchestrator.

**Go/No-Go decision should be based on:**

- A clean run of the release gate commands in §3.
- A final “breaking changes + migration” review in §4.
- Dependency security posture in §7.

---

## 2) Project Health Snapshot (Codebase Signals)

### 2.1 Quality signals (high confidence)

- Extensive automated testing (Jest + regression suites + contract checks).
- Dedicated validation scripts for config and docs datasets.
- OpenAPI export + validation is automated.
- ESLint + Prettier are integrated into hooks and CI-style scripts.

### 2.2 Maintainability hotspots (risk)

Large files aren’t inherently bad, but they are “risk multipliers” because changes require more context and review:

- `server.js`: ~7,707 LOC (main orchestrator).
- `docs/openapi-latest.json`: ~14,594 LOC (generated snapshot; should be treated as an artifact).
- `public/admin.html`: ~5,624 LOC.
- `public/device-mgmt.js`: ~3,326 LOC.
- `public/wallart/wallart-display.js`: ~2,979 LOC.

Other notable complexity hotspots by LOC (non-exhaustive):

- `routes/media.js`, `routes/local-directory.js`, `routes/admin-config.js`.
- `utils/capabilityRegistry.js`, `utils/job-queue.js`, `utils/cache.js`.
- `sources/local.js`, `lib/plex-helpers.js`, `lib/jellyfin-helpers.js`.

**Risk implication:** The codebase is stable, but “small changes can touch large blast-radius areas”. Use stricter review on those files.

### 2.3 Feature surface (strength)

Posterrama v3.0.0 is not just “features”; it has product-level capabilities:

- Multi-source aggregation (Plex, Jellyfin, TMDB, local libraries).
- Multiple display modes (Screensaver, Wallart, Cinema).
- Device management + realtime updates (WebSocket hub).
- Tiered caching and request de-duplication.
- MQTT bridge + Home Assistant discovery and dashboards.
- Admin tooling: backups, scheduler, logs, metrics, update-check.

---

## 3) Release Gates (Must Be Green)

### 3.1 Required commands (release gating)

These should be run from a clean workspace on a release candidate commit/tag:

- `npm ci`
- `npm run quality:all`

Alternative (project-provided):

- `npm run release:ready`
- `npm run release:ready:fast` (only if explicitly acceptable to skip slow checks)

### 3.2 Minimum checks if time is tight (still “public release safe”)

- `npm ci`
- `npm run lint`
- `npm run format:check`
- `npm test`
- `npm run openapi:validate`
- `npm run config:validate:example`

### 3.4 Recorded gate run (this repo state)

**Date:** 2025-12-16  
**Command:** `npm run quality:all`  
**Result:** PASS (exit code 0)

Highlights:

- Type-check: PASS (`tsc --noEmit`)
- Lint: PASS (`eslint .`)
- Format: PASS (`prettier --check .`)
- Test hygiene: PASS
    - Warning: config schema contains many defaults (“Found 262 properties with defaults in config.schema.json”)
- Jest: PASS
    - Test suites: 214 passed
    - Tests: 2395 passed
    - Notes: Some tests intentionally emit `console.warn`/`console.error` output while still passing
- OpenAPI: PASS
    - `openapi:sync` re-exported the snapshot to `docs/openapi-latest.json`
    - Endpoints: 193
    - Spec validation: valid (Example coverage reported as 100%)
- Dependency checks: PASS
    - Unused deps: CLEAN
    - Security audit (filtered): “No new vulnerabilities found” with an explicit accepted-risk allowlist

### 3.3 Runtime smoke validation (manual but recommended)

On a representative target machine (your typical deployment host):

- Start server: `npm start`
- Confirm basic health: `GET /health` and `GET /api/health`
- Confirm admin version endpoint: `GET /api/admin/version`
- Load UI entrypoints: `/`, `/screensaver.html`, `/wallart.html`, `/cinema.html`
- Confirm device mgmt UI loads and can authenticate.

---

## 4) “Real 3.0.0” Expectations (Breaking Changes + Migration)

A major version implies deliberate change management, not just a bigger number.

### 4.1 Required for any breaking change

If _anything_ breaks compatibility (config shape, endpoints, behavior):

- A clear statement of what breaks.
- The upgrade path (automatic migration vs manual steps).
- Safe defaults, and validation that produces actionable errors.

### 4.2 Compatibility contracts to explicitly confirm

- **Config compatibility:**
    - `config.schema.json` validation matches runtime expectations.
    - `config.example.json` and `config.example.env` represent a working baseline.
- **API compatibility:**
    - If `Accept-Version` is supported, confirm the behavior is stable and documented.
    - Confirm `/api/v1/*` aliases remain as intended.
- **Client compatibility:**
    - Service worker cache versioning is intentionally independent; confirm no unexpected cache-breaking changes.

### 4.3 Migration checklist (fill in during release candidate review)

- [ ] Any schema changes since 2.x documented (what changed, why, and impact)
- [ ] Any removed/renamed config keys enumerated
- [ ] Any route removals enumerated
- [ ] Any auth/session behavior changes noted
- [ ] Any new required env vars documented + validated

---

## 5) Stability & Reliability Review

### 5.1 Strengths

- “Failure-aware” architecture: multiple external integrations, but the project contains graceful-degradation patterns and test coverage.
- Dedicated HTTP clients and retry/timeout handling.
- Caching layers reduce load and stabilize performance.

### 5.2 Known stability risks (watch list)

- **Complexity concentration:** `server.js` is a blast-radius file.
- **External integrations:** Plex/Jellyfin/TMDB availability and rate limiting will dominate real-world support cases.
- **Frontend artifacts:** large single-file UI assets can be harder to reason about and can regress subtly.

### 5.3 What “stable enough for public” means here

- The server must keep serving UI and health endpoints even when external services fail.
- Admin auth boundaries must not leak.
- Cache behavior must not cause runaway disk/memory growth.
- MQTT should degrade gracefully when broker is down.

---

## 6) Performance Readiness

### 6.1 Baseline expectations

- No obvious memory leaks in long-running screensaver/wallart/cinema sessions.
- Caches respect eviction/limits.
- Media aggregation does not exceed “total cap” or block event loop.

### 6.2 Suggested pre-release checks

- `npm run test:performance`
- `npm run test:performance:baseline` (only when intentionally updating baselines)
- Run at least one 1–2 hour soak test on a typical device.

---

## 7) Security & Privacy Readiness

### 7.1 Dependency posture

- Run one of:
    - `npm run deps:security-audit` (preferred project script)
    - `npm audit --audit-level=high`
- Confirm how vulnerabilities are triaged (acceptable vs must-fix).

### 7.2 Auth/session boundaries

- Confirm admin endpoints require auth.
- Confirm rate limiting is active and tuned.
- Confirm logs do not leak secrets.

### 7.3 User data considerations

- Clarify what is stored locally (devices, profiles, sessions, logs).
- Provide default retention guidance (log rotation, backup retention).

---

## 8) Operational Readiness (What “Public Release” Requires)

### 8.1 Install/upgrade paths

- Fresh install: works from example config.
- Upgrade: does not brick existing configs; backups created before migration.
- Clear rollback story:
    - backup files are restorable
    - update mechanism can roll back safely if available

### 8.2 Observability

- Health endpoints are reliable.
- Metrics endpoint works (and is protected if needed).
- Logs are actionable (avoid excessive noise; include context on failures).

### 8.3 Support readiness

Before public release, decide:

- Where issues should be filed (GitHub vs Gitea) and what the public will see.
- How to collect diagnostics (logs, config export, health output).

---

## 9) Release Procedure (Recommended)

### 9.1 Pre-release (RC)

- [ ] Cut RC branch/tag (optional but recommended)
- [ ] Run `npm run quality:all`
- [ ] Run smoke validation on a real host
- [ ] Verify OpenAPI export/validate matches committed snapshot

### 9.2 Release

- [ ] Tag `v3.0.0`
- [ ] Publish release notes (what’s new, breaking changes, upgrade steps)
- [ ] Announce support channels + known issues

### 9.3 Post-release

- [ ] Monitor issues for 48–72h
- [ ] If needed: patch release process (`release:patch`) is ready

---

## 10) Recommendations (High ROI, Post-3.0.0)

These are not blockers for 3.0.0, but will pay down risk quickly:

- Modularize `server.js` by responsibility while keeping behavior identical.
- Continue splitting the largest frontend/admin assets into smaller modules.
- Formalize versioning domains (app version vs API contract version vs data schema vs service worker cache version).

---

## Appendix A — Quick Links (Repo Commands)

- Full quality gate: `npm run quality:all`
- Release gate: `npm run release:ready`
- Lint/format: `npm run lint` / `npm run format:check`
- OpenAPI: `npm run openapi:sync` / `npm run openapi:validate`
- Config validation: `npm run config:validate:example`
- Security audit: `npm run deps:security-audit`
