# Project Audit — Code Health & Maintainability

## Key maintainability risks

### 1) `server.js` remains a very large orchestration surface

- Large files increase merge conflicts and regression risk.
- Concrete next refactors:
    - Move remaining inline routes into `routes/` factories.
    - Move “policy” middleware wiring into a small `app/createApp.js`.
    - Keep `server.js` as composition only (env/config, wiring, start/stop).

### 2) Concentrated complexity in core utilities

- Example: `utils/cache.js` is large and `@ts-nocheck`.
- Concrete next refactors:
    - split into modules: memory tiering, persistence, image-cache disk, metrics.
    - incrementally add JSDoc typedefs (no big-bang TypeScript migration required).

### 3) Back-compat remnants after feature deletions

- “Groups removed” but legacy field still accepted.
- Concrete approach:
    - maintain a `docs/DEPRECATIONS.md` (short)
    - add one-time migrations and tests

## A suggested folder/interface structure (incremental)

- `app/` — create express app, register middleware
- `routes/` — route factories only
- `services/` — business logic with explicit interfaces
- `stores/` — file stores / persistence
- `utils/` — pure helpers (no side effects)

## Developer experience

- Add a “single command” dev bootstrap (if not already):
    - validate config
    - start server
    - run a quick health check

Last updated: 2025-12-15
