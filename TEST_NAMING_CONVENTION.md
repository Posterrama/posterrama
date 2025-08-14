# Test Naming Convention & Rename Plan

This document defines a consistent naming scheme for all Jest test files and provides a mapping + script-ready commands to migrate.

## Goals
- Consistent, descriptive filenames
- Easy pattern selection (unit vs integration vs comprehensive vs edge/branch)
- Eliminate duplicate root-level tests in favour of structured subfolders (`__tests__/sources`, `__tests__/utils`, `__tests__/middleware`, `__tests__/api`)
- Prepare for future parallelization (CI can target `*.unit.test.js`, `*.integration.test.js`, etc.)

## Naming Pattern
```
<scope>/<subject>[.<subsubject>].<qualifier>.test.js
```
Where:
- `subject` = logical module (tmdb, tvdb, plex, cache, logger, auth, validators, metrics, healthcheck, errorhandler, rate-limiter, api, timezone, utils)
- Optional `.<subsubject>` when a meaningful secondary distinction (e.g. `cache.disk`, `cache.integration`)
- `qualifier` (one of):
  - `unit` (pure logic / no I/O or network stubs only)
  - `integration` (multiple modules or HTTP layer integration)
  - `comprehensive` (large full-coverage style suite spanning many branches)
  - `edge` / `edge2` (focused edge-case / negative tests)
  - `branch` (explicit branch / alternate-path coverage helpers)
  - `extra` (misc additional coverage where not strictly edge)
  - `smoke` (lightweight placeholder or API surface sanity check)

If a file today already effectively combines unit+edge+integration (e.g. current monolithic comprehensive suites), we keep `comprehensive`.

## Current Duplicate Roots To Remove (keep subfolder version)
Root duplicates slated for removal (subfolder copy already exists / canonical):
```
__tests__/tmdb-source.test.js              -> __tests__/sources/tmdb-source.test.js
__tests__/tmdb-source-extra.test.js        -> __tests__/sources/tmdb-source-extra.test.js
__tests__/sources/tmdb-source-edge2.test.js (canonical already ok)
__tests__/tvdb-source.comprehensive.test.js-> __tests__/sources/tvdb-source.comprehensive.test.js
__tests__/tvdb.test.js                     -> __tests__/sources/tvdb.test.js (rename planned)
__tests__/plex-source.test.js              -> __tests__/sources/plex-source.test.js
__tests__/cache-comprehensive.test.js      -> __tests__/utils/cache-comprehensive.test.js
__tests__/cache-integration.test.js        -> __tests__/utils/cache-integration.test.js
__tests__/cache-manager.test.js            -> __tests__/utils/cache-manager.test.js
__tests__/cache-diskmanager.test.js        -> __tests__/utils/cache-diskmanager.test.js
__tests__/cache-branch-extra.test.js       -> __tests__/utils/cache-branch-extra.test.js
__tests__/cache-edge2.test.js              -> __tests__/utils/cache-edge2.test.js
__tests__/utils-metrics-comprehensive.test.js    -> __tests__/utils/utils-metrics-comprehensive.test.js
__tests__/utils-healthcheck-comprehensive.test.js-> __tests__/utils/utils-healthcheck-comprehensive.test.js
__tests__/utils-auth-comprehensive.test.js -> __tests__/utils/utils-auth-comprehensive.test.js
__tests__/validators-unit.test.js          -> __tests__/utils/validators-unit.test.js
__tests__/logger-edge.test.js              -> __tests__/utils/logger-edge.test.js
__tests__/logger-extra.test.js             -> __tests__/utils/logger-extra.test.js
__tests__/logger.test.js                   -> __tests__/utils/logger.test.js
__tests__/timezone-config.test.js          -> __tests__/utils/timezone-config.test.js
__tests__/middleware-errorhandler-comprehensive.test.js -> __tests__/middleware/errorhandler-comprehensive.test.js
__tests__/rate-limiting.test.js            -> __tests__/middleware/rate-limiting.test.js
```
(If not already deleted during earlier cleanup, proceed before renaming.)

## Planned Renames (Canonical Files)
```
# Sources
__tests__/sources/tmdb-source.test.js                 -> __tests__/sources/tmdb.comprehensive.test.js
__tests__/sources/tmdb-source-extra.test.js           -> __tests__/sources/tmdb.edge.test.js
__tests__/sources/tmdb-source-edge2.test.js           -> __tests__/sources/tmdb.edge2.test.js
__tests__/sources/tmdb-branch-extra.test.js           -> __tests__/sources/tmdb.branch.test.js
__tests__/sources/tvdb-source.comprehensive.test.js   -> __tests__/sources/tvdb.comprehensive.test.js
__tests__/sources/tvdb-source-edge2.test.js           -> __tests__/sources/tvdb.edge.test.js
__tests__/sources/tvdb-branch-extra.test.js           -> __tests__/sources/tvdb.branch.test.js
__tests__/sources/tvdb.test.js                        -> __tests__/sources/tvdb.smoke.test.js
__tests__/sources/plex-source.test.js                 -> __tests__/sources/plex.comprehensive.test.js

# Utils - Cache
__tests__/utils/cache-comprehensive.test.js           -> __tests__/utils/cache.comprehensive.test.js
__tests__/utils/cache-integration.test.js             -> __tests__/utils/cache.integration.test.js
__tests__/utils/cache-manager.test.js                 -> __tests__/utils/cache.unit.test.js
__tests__/utils/cache-diskmanager.test.js             -> __tests__/utils/cache.disk.unit.test.js
__tests__/utils/cache-branch-extra.test.js            -> __tests__/utils/cache.branch.test.js
__tests__/utils/cache-edge2.test.js                   -> __tests__/utils/cache.edge2.test.js
__tests__/utils/cache-edge2.test.js (if keeping)      -> (unchanged if already covered)
__tests__/utils/cache-integration.test.js (subset)    -> (already mapped)

# Utils - Metrics & Health
__tests__/utils/utils-metrics-comprehensive.test.js   -> __tests__/utils/metrics.comprehensive.test.js
__tests__/utils/utils-healthcheck-comprehensive.test.js-> __tests__/utils/healthcheck.comprehensive.test.js
__tests__/utils/utils-metrics-comprehensive.test.js (duplicate?) -> remove if duplicate after rename
__tests__/utils/utils-metrics-comprehensive.test.js (subset) -> metrics.smoke.test.js (if subset only)

# Utils - Auth / Validators / Logger / Misc
__tests__/utils/utils-auth-comprehensive.test.js      -> __tests__/utils/auth.comprehensive.test.js
__tests__/utils/validators-unit.test.js               -> __tests__/utils/validators.unit.test.js
__tests__/utils/logger.test.js                        -> __tests__/utils/logger.unit.test.js
__tests__/utils/logger-edge.test.js                   -> __tests__/utils/logger.edge.test.js
__tests__/utils/logger-extra.test.js                  -> __tests__/utils/logger.extra.test.js
__tests__/utils/timezone-config.test.js               -> __tests__/utils/timezone.comprehensive.test.js (or timezone.config.unit.test.js if narrowed)
__tests__/utils/utils.test.js                         -> __tests__/utils/utils.unit.test.js
__tests__/utils/utils-metrics-comprehensive.test.js (simple subset) -> metrics.unit.test.js (if small)

# Middleware
__tests__/middleware/errorhandler-comprehensive.test.js -> __tests__/middleware/errorhandler.comprehensive.test.js
__tests__/middleware/rate-limiting.test.js              -> __tests__/middleware/rate-limiter.smoke.test.js
__tests__/middleware/auth-middleware.test.js            -> __tests__/middleware/auth.unit.test.js
__tests__/middleware/auth-middleware-comprehensive.test.js -> __tests__/middleware/auth.comprehensive.test.js
__tests__/middleware/middleware-validate-comprehensive.test.js -> __tests__/middleware/validate.comprehensive.test.js

# API (smoke placeholders)
__tests__/api/api.test.js                    -> __tests__/api/root.smoke.test.js
__tests__/api/api-versioning.test.js         -> __tests__/api/versioning.smoke.test.js
__tests__/api/api-authentication.test.js     -> __tests__/api/authentication.smoke.test.js
__tests__/api/admin-config.test.js           -> __tests__/api/admin-config.integration.test.js

# Environment & Validators at root
__tests__/validate-env.test.js               -> __tests__/env.validation.integration.test.js
__tests__/utils/validate-env.test.js (duplicate subset) -> remove if redundant or rename env.validation.smoke.test.js
__tests__/errors.test.js                     -> __tests__/errors.unit.test.js
__tests__/utils/errors.test.js (placeholder) -> errors.smoke.test.js or delete if redundant
__tests__/input-validation.test.js           -> __tests__/input-validation.smoke.test.js

# Timezone duplicates
__tests__/timezone-config.test.js (root) -> delete (keep utils/timezone...)

```

NOTE: Some mappings are suggestions where semantic intent must be confirmed (e.g. whether a suite is truly *unit* or *integration*). Adjust before executing.

## Execution Script (Dry-Run Template)
Use `git mv` to preserve history. Below is a generated command list (commented). Uncomment after validating.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Example rename commands (commented for safety)
# git mv __tests__/sources/tmdb-source.test.js __tests__/sources/tmdb.comprehensive.test.js
# git mv __tests__/sources/tmdb-source-extra.test.js __tests__/sources/tmdb.edge.test.js
# git mv __tests__/sources/tmdb-source-edge2.test.js __tests__/sources/tmdb.edge2.test.js
# git mv __tests__/sources/tmdb-branch-extra.test.js __tests__/sources/tmdb.branch.test.js
# git mv __tests__/sources/tvdb-source.comprehensive.test.js __tests__/sources/tvdb.comprehensive.test.js
# git mv __tests__/sources/tvdb-source-edge2.test.js __tests__/sources/tvdb.edge.test.js
# git mv __tests__/sources/tvdb-branch-extra.test.js __tests__/sources/tvdb.branch.test.js
# git mv __tests__/sources/tvdb.test.js __tests__/sources/tvdb.smoke.test.js
# git mv __tests__/sources/plex-source.test.js __tests__/sources/plex.comprehensive.test.js

# Cache / Utils
# git mv __tests__/utils/cache-comprehensive.test.js __tests__/utils/cache.comprehensive.test.js
# git mv __tests__/utils/cache-integration.test.js __tests__/utils/cache.integration.test.js
# git mv __tests__/utils/cache-manager.test.js __tests__/utils/cache.unit.test.js
# git mv __tests__/utils/cache-diskmanager.test.js __tests__/utils/cache.disk.unit.test.js
# git mv __tests__/utils/cache-branch-extra.test.js __tests__/utils/cache.branch.test.js
# git mv __tests__/utils/cache-edge2.test.js __tests__/utils/cache.edge2.test.js

# Metrics / Health / Auth / Validators / Logger / Utils
# git mv __tests__/utils/utils-metrics-comprehensive.test.js __tests__/utils/metrics.comprehensive.test.js
# git mv __tests__/utils/utils-healthcheck-comprehensive.test.js __tests__/utils/healthcheck.comprehensive.test.js
# git mv __tests__/utils/utils-auth-comprehensive.test.js __tests__/utils/auth.comprehensive.test.js
# git mv __tests__/utils/validators-unit.test.js __tests__/utils/validators.unit.test.js
# git mv __tests__/utils/logger.test.js __tests__/utils/logger.unit.test.js
# git mv __tests__/utils/logger-edge.test.js __tests__/utils/logger.edge.test.js
# git mv __tests__/utils/logger-extra.test.js __tests__/utils/logger.extra.test.js
# git mv __tests__/utils/timezone-config.test.js __tests__/utils/timezone.comprehensive.test.js
# git mv __tests__/utils/utils.test.js __tests__/utils/utils.unit.test.js

# Middleware
# git mv __tests__/middleware/errorhandler-comprehensive.test.js __tests__/middleware/errorhandler.comprehensive.test.js
# git mv __tests__/middleware/rate-limiting.test.js __tests__/middleware/rate-limiter.smoke.test.js
# git mv __tests__/middleware/auth-middleware.test.js __tests__/middleware/auth.unit.test.js
# git mv __tests__/middleware/auth-middleware-comprehensive.test.js __tests__/middleware/auth.comprehensive.test.js
# git mv __tests__/middleware/middleware-validate-comprehensive.test.js __tests__/middleware/validate.comprehensive.test.js

# API
# git mv __tests__/api/api.test.js __tests__/api/root.smoke.test.js
# git mv __tests__/api/api-versioning.test.js __tests__/api/versioning.smoke.test.js
# git mv __tests__/api/api-authentication.test.js __tests__/api/authentication.smoke.test.js
# git mv __tests__/api/admin-config.test.js __tests__/api/admin-config.integration.test.js

# Env / Errors / Misc
# git mv __tests__/validate-env.test.js __tests__/env.validation.integration.test.js
# git mv __tests__/errors.test.js __tests__/errors.unit.test.js
# git mv __tests__/input-validation.test.js __tests__/input-validation.smoke.test.js

# After renames, run:
# npm test -- --listTests
# npm test -- --coverage
```

## Jest Config Adjustments
Ensure `jest.config.js` will still match new names. If using default, no change needed. If you have a custom `testRegex` or `testMatch`, update to something like:
```js
// jest.config.js
module.exports = {
  // ...existing config
  testMatch: [
    '**/__tests__/**/*.?(unit|integration|comprehensive|edge|edge2|branch|extra|smoke).test.js',
    '**/__tests__/**/*.test.js'
  ]
};
```
(First pattern explicit, second is fallback during transition.)

## Rollout Strategy
1. Commit deletion of duplicates (if any remain).
2. Apply `git mv` renames in one commit (no content changes).
3. Adjust `jest.config.js` ONLY if needed.
4. Run full test & coverage. Update CI patterns.
5. Add a lint check (optional) ensuring filenames match regex.

## Post-Rename Optional Scripts
Add npm scripts:
```json
"scripts": {
  "test:unit": "jest --testPathPattern=unit",
  "test:integration": "jest --testPathPattern=integration",
  "test:comprehensive": "jest --testPathPattern=comprehensive"
}
```

---
Feel free to prune or adjust any mapping before executing. This plan is intentionally conservative; if a suite should be split (e.g., a massive comprehensive into separate unit + integration), do that in a later refactor commit to keep history clean.
