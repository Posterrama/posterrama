# Project Audit — Stability & Reliability

## Reliability risks observed

### 1) ZIP download reads whole files into memory

- Location: `routes/local-directory.js` (download-all)
- Risk: high memory usage, process OOM, long event-loop stalls on big directories.
- Concrete fix:
    - Use streaming ZIP generation.
    - Enforce limits (max total bytes, max file count, max depth).
    - Emit progress/heartbeat if it’s expected to take long.

### 2) Event-loop blocking process execution

- Location: `utils/cache.js` uses `execSync` for `df`.
- Risk: blocks requests if called on the hot path; can hang on slow disks/NFS.
- Concrete fix:
    - Cache results (e.g., recompute every 30–60 seconds in background).
    - Use `spawn` with timeout and parse stdout.

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
