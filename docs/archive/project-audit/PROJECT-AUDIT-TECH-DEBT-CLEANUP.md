# Project Audit — Tech Debt Cleanup (Concrete)

## Confirmed drift / leftovers

### 1) Legacy “groups” remnants

- Status: fixed
    1. `groups` removed from the allowlist and rejected on updates.
    2. One-time migration deletes `groups` keys from stored devices.
    3. Regression tests added.

### 2) Documentation drift

- There are various docs that reference removed/changed behaviors over time.
- Suggested control:
    - keep a short “breaking changes / deprecations” doc and link it from relevant guides.

### 3) Logging consistency

- Runtime code should use the shared logger; `console.log` should be limited to:
    - CLI scripts
    - tests

`config/validate-env.js` currently prints migration messages directly.

- Status update:
    - The core logger no longer performs synchronous filesystem work at module load (disk logging is initialized asynchronously, best-effort).
    - The remaining gap is still `config/validate-env.js` verbosity and direct console output.

## “Delete or simplify” candidates

These are candidates to reduce maintenance burden (evaluate before deleting):

- Consolidate or delete duplicate validation scripts if they overlap.
- Reduce duplicated filesystem path handling logic by creating a shared “safePath” helper.

## Tiny refactor wins

- Replace shell pipelines with native Node or non-blocking processes.
- Move repeated admin cache/file listing logic into a shared service.

Last updated: 2025-12-15
