# Project Audit — Stability & Reliability

## Reliability risks observed

### 1) ZIP download memory risk

- Location: `routes/local-directory.js` (download-all)
- Status: fixed — ZIP archives are streamed to the client (no whole-file reads into memory).
- Guardrails: enforced limits (max total bytes, max file count, max depth, max single file).
- Remaining considerations:
    - Abort work quickly if the client disconnects (avoid wasting CPU/disk on long exports).
    - Consider an explicit “small export only” policy with tighter default limits.

### 2) Disk free space sampling

- Location: `utils/cache.js` uses `fs.promises.statfs()` and caches the result briefly.
- Risk: excessive sampling on very high request volume (tune TTL if needed).
- Concrete next step:
    - Confirm the call-site frequency and adjust TTL/refresh behavior if required.

### 3) Config self-healing can be noisy and hard to reason about

- Location: `config/validate-env.js`
- Risk: hard-to-debug upgrades; logs not structured; changes applied implicitly.
- Concrete fix:
    - Emit a single “migration summary” object (counts per category + sampled changes).
    - Add a config option to disable auto-repair in production (fail fast vs self-heal).
    - Add tests for specific migrations.

### 4) Legacy fields left behind after feature removal

- Location: `lib/device-operations.js` allows `groups` updates.
- Risk: inconsistent API behavior, confusing UI behavior, unexpected persistence.
- Concrete fix:
    - Remove from `allowedFields`.
    - One-time migration to delete `groups` keys from `devices.json`.
    - Ensure schema/OpenAPI do not mention groups.

## Hardening checklist (concrete)

- Add a request-time budget for expensive endpoints
    - Example: directory scans, export operations.
- Add circuit-breakers for upstream calls
    - Plex/Jellyfin/TMDB: retries exist in clients; ensure timeouts are enforced everywhere.
- Normalize error responses
    - Ensure route factories use a shared error helper that maps known errors to stable codes.
- Add “safe mode” startup
    - If config validation fails: start in read-only admin UI mode rather than crashing (optional).

## What to test next (reliability focus)

- ZIP download of:
    - deep directory
    - many small files
    - a single huge file
- Cache cleanup and disk-full scenarios
- Concurrent uploads hitting configured limits
- Session file-store ENOENT scenarios (already partially handled)

Last updated: 2025-12-15
