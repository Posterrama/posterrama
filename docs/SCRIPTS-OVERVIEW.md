# Scripts Overview - Posterrama

Complete guide to all scripts in the `scripts/` directory, what they do, and how they're used.

---

## Quick Reference

**Total Scripts:** 32 active scripts (after cleanup from 38)

### By Category

| Category                 | Count | Purpose                                  |
| ------------------------ | ----- | ---------------------------------------- |
| **Testing & Validation** | 13    | Test execution, coverage, API validation |
| **Configuration**        | 3     | Config validation and verification       |
| **Maintenance**          | 7     | Cleanup, MQTT, device management         |
| **Build & Deploy**       | 4     | Production deployment, icons, secrets    |
| **Documentation**        | 3     | OpenAPI, coverage tables, release notes  |
| **Quality**              | 2     | Security audit, git hooks                |

---

## Master Script (The Main Entry Point)

### `master-test.sh` ⭐ **PRIMARY RELEASE READINESS CHECK**

**Purpose:** Complete 9-phase pre-release validation with real credentials
**npm command:** `npm run release:ready`
**Used by:** Release process, pre-deployment validation
**Calls these scripts:**

- `scripts/validation/validate-admin-defaults.js`
- `scripts/validation/test-media-connectivity.js`
- `scripts/validation/verify-api-docs.js`

**What it does:**

- Phase 0: Environment setup (Node, npm, credentials)
- Phase 1: Code quality (ESLint, Prettier, hygiene)
- Phase 2: Configuration validation
- Phase 3: Dependencies & security
- Phase 4: Unit & API tests
- Phase 5: Integration tests (with real Plex/Jellyfin/TMDB)
- Phase 6: Regression tests
- Phase 7: Performance & health
- Phase 8: Documentation & API
- Phase 9: File system & cleanup

**Exit codes:**

- `0` = Ready for release
- `1` = Blocked or failed

---

## All Scripts (Alphabetical)

### Testing & Validation (11 scripts)

#### `check-tests-clean.js`

**Purpose:** Detects focused/skipped tests (.only, .skip, xit, test.todo)
**npm command:** Part of `npm run test:hygiene`
**Standalone:** Yes
**Used by:** `test:hygiene` script, quality pipeline
**Exit:** 1 if any focused/skipped tests found

#### `cleanup-test-artifacts.sh`

**Purpose:** Removes test-generated files (devices.broadcast._.json, etc.)
**npm command:** `npm run test:cleanup`
**Standalone:** Yes
**Used by:** Manual cleanup, test workflows
**Removes:** `devices.broadcast._.json`, `_.groups.test.json`, `devices.test._.json`

#### `health-check.sh`

**Purpose:** Full system health check (dependencies, config, docs, deployment readiness)
**npm command:** `npm run health`
**Standalone:** Yes
**Used by:** Manual health checks, CI workflows
**Checks:** 20+ health indicators

#### `health-check-quick.sh`

**Purpose:** Quick health check (essential checks only)
**npm command:** `npm run health:quick`
**Standalone:** Yes
**Used by:** Fast pre-commit checks
**Checks:** ~10 essential indicators

#### `performance-audit.sh`

**Purpose:** Lighthouse performance audits on key pages
**npm command:** `npm run perf:audit`
**Standalone:** Yes
**Used by:** Performance monitoring
**Requires:** Puppeteer, Lighthouse
**Output:** `lighthouse-reports/*.html`

#### `test-memory.js`

**Purpose:** Automated memory profiling with Puppeteer
**npm command:** `npm run perf:memory`
**Standalone:** Yes
**Used by:** Performance testing
**Profiles:** Admin, Screensaver, Wallart, Cinema pages

#### `measure-tiered-cache.js`

**Purpose:** Test script to compare cache performance with/without tiering
**npm command:** None
**Standalone:** Yes
**Used by:** Performance testing
**Simulates:** Hot/warm/cold data patterns

#### `validate-runtime.js`

**Purpose:** Validates runtime environment (Node version, memory, etc.)
**npm command:** `npm run validate:runtime`
**Standalone:** Yes
**Used by:** Startup checks, CI workflows

#### `validation/api-contract-tests.js`

**Purpose:** Validates API endpoints return expected structures on live server
**npm command:** `npm run test:contract:live`
**Standalone:** Yes
**Used by:** Live environment testing
**Env:** `TEST_URL` (default: http://localhost:4000)

#### `validation/performance-monitor.js`

**Purpose:** Performance regression detection with baseline comparison
**npm command:** `npm run test:performance`
**Standalone:** Yes
**Used by:** Continuous performance monitoring
**Baseline file:** `__tests__/regression/performance-baseline.json`

#### `validation/smoke-test-live.sh`

**Purpose:** Quick 30-second smoke test on live server
**npm command:** `npm run test:smoke:live [URL]`
**Standalone:** Yes
**Used by:** Post-deployment verification
**Tests:** Connectivity, API endpoints, static assets, display modes

#### `validation/test-media-connectivity.js`

**Purpose:** Tests connectivity to Plex/Jellyfin/TMDB sources
**npm command:** None (called by `master-test.sh`)
**Standalone:** Yes
**Used by:** `master-test.sh` (Phase 5)
**Requires:** Real credentials in `private/test-credentials.json`

#### `validation/verify-api-docs.js`

**Purpose:** Verifies API documentation completeness
**npm command:** None (called by `master-test.sh`)
**Standalone:** Yes
**Used by:** `master-test.sh` (Phase 8)
**Checks:** Missing routes, undocumented endpoints

---

### Configuration (3 scripts)

#### `validate-config.js`

**Purpose:** Validates `config.json` against `config.schema.json`
**npm command:** `npm run config:validate`
**Standalone:** Yes
**Used by:** Quality pipeline, startup validation
**Validator:** Ajv (JSON Schema)

#### `validate-config-example.js`

**Purpose:** Validates `config.example.json` against schema
**npm command:** `npm run config:validate:example`
**Standalone:** Yes
**Used by:** Quality pipeline, PR checks
**Ensures:** Example config stays in sync with schema

#### `validation/validate-admin-defaults.js`

**Purpose:** Validates admin defaults for new installations
**npm command:** None (called by `master-test.sh`)
**Standalone:** Yes
**Used by:** `master-test.sh` (Phase 2)
**Checks:** Default admin username, password hash format

---

### Maintenance (5 scripts)

#### `cleanup-groups.js`

**Purpose:** Removes placeholder/test groups named 'G Wait'
**npm command:** None
**Standalone:** Yes
**Usage:** `node scripts/cleanup-groups.js [--dry-run] [--keep N]`
**Options:**

- `--dry-run` - Show what would be removed
- `--keep N` - Keep N newest groups

#### `manual-update.sh`

**Purpose:** Manual update script for troubleshooting or failed auto-updates
**npm command:** None
**Standalone:** Yes
**Usage:** `sudo bash scripts/manual-update.sh [version]`
**Features:** Backups config, preserves data, updates code

#### `mqtt-cleanup-entities.js`

**Purpose:** Removes old/orphaned MQTT entities from Home Assistant
**npm command:** None
**Standalone:** Yes
**Usage:** `node scripts/mqtt-cleanup-entities.js`
**What it does:** Publishes empty payloads to discovery topics, forces republish

#### `mqtt-republish-discovery.js`

**Purpose:** Force republish MQTT discovery for all devices
**npm command:** None
**Standalone:** Yes
**Usage:** `node scripts/mqtt-republish-discovery.js`
**What it does:** Updates object_id format, refreshes entity configs

#### `prune-orphan-device-groups.js`

**Purpose:** Removes orphaned group references from devices
**npm command:** None
**Standalone:** Yes
**Usage:** `node scripts/prune-orphan-device-groups.js [--dry-run]`
**Options:**

- `--dry-run` - Show what would be removed
- `--file path` - Target specific devices/groups files

#### `reset-admin-password.js`

**Purpose:** Reset admin password from command line
**npm command:** None
**Standalone:** Yes
**Usage:** `node scripts/reset-admin-password.js <new_password>`
**Used by:** Emergency access recovery

#### `restart-with-env.sh`

**Purpose:** Restart PM2 with fresh environment variables
**npm command:** None
**Standalone:** Yes
**Usage:** `./scripts/restart-with-env.sh`
**What it does:** `pm2 delete posterrama && pm2 start ecosystem.config.js`

---

### Build & Deploy (4 scripts)

#### `build-production.sh`

**Purpose:** Production build script (cleans dist, copies public, removes console.logs)
**npm command:** `npm run build:prod`
**Standalone:** Yes
**Used by:** Deployment workflow
**Features:** Console log stripping, backup generation

#### `deploy-production.sh`

**Purpose:** Production deployment (build + PM2 restart)
**npm command:** None
**Standalone:** Yes
**Usage:** `./scripts/deploy-production.sh`
**Steps:**

1. `npm run build` (Vite)
2. Copy `dist/public` to `public`
3. `pm2 reload posterrama` or `pm2 start ecosystem.config.js`

#### `generate-icons.js`

**Purpose:** Generate multi-size icons from SVG source
**npm command:** `npm run icons:generate`
**Standalone:** Yes
**Used by:** Icon generation workflow
**Sizes:** 16, 32, 72, 96, 128, 144, 152, 192, 384, 512
**Requires:** Sharp

#### `generate-secrets.js`

**Purpose:** Generate cryptographically strong secrets for .env
**npm command:** None
**Standalone:** Yes
**Usage:** `node scripts/generate-secrets.js [--hex|--base64|--session|--all]`
**Examples:**

- `--session` - 64-char hex for SESSION_SECRET
- `--hex 48` - Custom length hex
- `--base64 32` - Base64 from 32 bytes

---

### Documentation (3 scripts)

#### `export-openapi.js`

**Purpose:** Export OpenAPI spec to `docs/openapi-latest.json`
**npm command:** `npm run openapi:export`, `npm run openapi:sync`
**Standalone:** Yes
**Used by:** Documentation workflow, quality pipeline
**Source:** `swagger.js`

#### `generate-coverage-table.js`

**Purpose:** Generate per-file coverage table in `docs/COVERAGE.md`
**npm command:** `npm run coverage:table`
**Standalone:** Yes
**Used by:** Git pre-push hook, manual updates
**Called by:** `setup-git-hooks.sh` (pre-push hook)
**Requires:** `coverage/coverage-final.json`, `coverage/lcov.info`

#### `generate-release-summary.js`

**Purpose:** Generate/refresh `private/release-check-summary.md`
**npm command:** `npm run release:summary`
**Standalone:** Yes
**Used by:** Release workflow
**Data sources:** jest-results.json, coverage-final.json, package.json

---

### Quality (2 scripts)

#### `security-audit-filtered.sh`

**Purpose:** Security audit with accepted risks filtered
**npm command:** `npm run deps:security-audit`, `npm run deps:security-daily`
**Standalone:** Yes
**Used by:** Quality pipeline, CI workflows
**Accepted risks:** Plex API dependencies (breaking changes if updated)

#### `setup-git-hooks.sh`

**Purpose:** Install Git pre-push hook (update badges/coverage)
**npm command:** `npm run hooks:setup`
**Standalone:** Yes
**Used by:** Development setup
**What it does:** Creates `.git/hooks/pre-push` that calls:

- `update-badges.js`
- `generate-coverage-table.js`

---

### OpenAPI & Validation (3 scripts)

#### `validate-openapi.js`

**Purpose:** Validate OpenAPI spec against OpenAPI 3.0 standards
**npm command:** `npm run openapi:validate`
**Standalone:** Yes
**Used by:** Quality pipeline
**Checks:** Valid structure, examples, security schemes, no duplicate IDs

#### `verify-swagger-docs.js`

**Purpose:** Verify Swagger docs completeness (CLI wrapper)
**npm command:** Part of `npm run test:hygiene`
**Standalone:** Yes
**Used by:** Quality pipeline
**Delegates to:** `scripts/lib/swaggerVerifier.js`
**Checks:** Missing routes, orphaned spec paths

#### `lib/swaggerVerifier.js`

**Purpose:** Core Swagger verification logic
**npm command:** None (library)
**Standalone:** No (library)
**Used by:** `verify-swagger-docs.js`
**Returns:** `{ missing: [], orphaned: [] }`

---

### Dependencies (2 scripts)

#### `deps-unused.js`

**Purpose:** Detect unused dependencies with allowlist
**npm command:** `npm run deps:unused`
**Standalone:** Yes
**Used by:** Quality pipeline
**Tool:** depcheck wrapper
**Allowlist:** `audit-ci` (shell-only), `@jellyfin/sdk` (optional)

#### `update-badges.js`

**Purpose:** Update README badges (coverage, version)
**npm command:** `npm run badges:update`
**Standalone:** Yes
**Used by:** Git pre-push hook, manual updates
**Called by:** `setup-git-hooks.sh` (pre-push hook)
**Updates:**

- Coverage badge (from coverage-final.json)
- Version badge (from package.json)

---

### Additional Validation Scripts (4 scripts in `validation/`)

#### `validation/validate-api-responses.js`

**Purpose:** Validate API response structures
**npm command:** None
**Standalone:** Yes
**Usage:** Manual validation testing

#### `validation/validate-config-schema.js`

**Purpose:** Validate config schema structure
**npm command:** None
**Standalone:** Yes
**Usage:** Schema validation testing

#### `validation/validate-example-configs.js`

**Purpose:** Validate all example configs
**npm command:** None
**Standalone:** Yes
**Usage:** Example config verification

---

## Script Dependencies (What Calls What)

### `master-test.sh` (calls 3 scripts)

```
master-test.sh
├── scripts/validation/validate-admin-defaults.js
├── scripts/validation/test-media-connectivity.js
└── scripts/validation/verify-api-docs.js
```

### `setup-git-hooks.sh` (installs hook that calls 2 scripts)

```
setup-git-hooks.sh
└── .git/hooks/pre-push (created)
 ├── update-badges.js
 └── generate-coverage-table.js
```

### `verify-swagger-docs.js` (wrapper for library)

```
verify-swagger-docs.js
└── scripts/lib/swaggerVerifier.js
```

---

## Standalone vs. Called Scripts

### Standalone Scripts (24 scripts)

Can be run independently, have clear purposes:

**Testing:**

- check-tests-clean.js
- cleanup-test-artifacts.sh
- health-check.sh
- health-check-quick.sh
- performance-audit.sh
- test-memory.js
- validation/api-contract-tests.js
- validation/performance-monitor.js
- validation/smoke-test-live.sh
- validation/test-media-connectivity.js
- validation/verify-api-docs.js

**Configuration:**

- validate-config.js
- validate-config-example.js
- validation/validate-admin-defaults.js

**Maintenance:**

- cleanup-groups.js
- mqtt-cleanup-entities.js
- mqtt-republish-discovery.js
- prune-orphan-device-groups.js
- restart-with-env.sh

**Build & Deploy:**

- deploy-production.sh
- generate-icons.js
- generate-secrets.js

**Documentation:**

- export-openapi.js
- generate-coverage-table.js
- generate-release-summary.js

**Quality:**

- security-audit-filtered.sh
- setup-git-hooks.sh
- deps-unused.js
- update-badges.js
- validate-openapi.js
- verify-swagger-docs.js

### Called by Other Scripts (3 scripts)

These are typically invoked by other scripts:

1. **validation/validate-admin-defaults.js**

- Called by: `master-test.sh` (Phase 2)

2. **validation/test-media-connectivity.js**

- Called by: `master-test.sh` (Phase 5)

3. **validation/verify-api-docs.js**

- Called by: `master-test.sh` (Phase 8)

### Library Scripts (1 script)

Not meant to be run directly:

1. **lib/swaggerVerifier.js**

- Used by: `verify-swagger-docs.js`

---

## Most Important Scripts

### For Development

1. `master-test.sh` - Complete pre-release check
2. `health-check.sh` - System health check
3. `test-memory.js` - Memory profiling
4. `validate-config.js` - Config validation

### For CI/CD

1. `master-test.sh` - Release readiness
2. `validation/api-contract-tests.js` - Live API validation
3. `validation/smoke-test-live.sh` - Quick deployment check
4. `security-audit-filtered.sh` - Security check

### For Maintenance

1. `cleanup-test-artifacts.sh` - Test cleanup
2. `mqtt-cleanup-entities.js` - MQTT cleanup
3. `prune-orphan-device-groups.js` - Device cleanup
4. `restart-with-env.sh` - PM2 restart with fresh env

### For Production

1. `deploy-production.sh` - Full deployment
2. `validation/smoke-test-live.sh` - Post-deploy verification
3. `restart-with-env.sh` - Quick restart

---

## Common Workflows

### Pre-Release Checklist

```bash
npm run release:ready # Master test (all 9 phases)
# Review output for blockers/failures/warnings
# Fix any issues
npm run release:patch # Release and push
```

### Quick Development Check

```bash
npm run lint # Code quality
npm test # Unit tests
npm run health:quick # Quick health check
```

### After Deployment

```bash
npm run test:smoke:live https://your-domain.com # 30-second check
TEST_URL=https://your-domain.com npm run test:contract:live # API validation
TEST_URL=https://your-domain.com npm run test:performance # Performance check
```

### Maintenance Tasks

```bash
npm run test:cleanup # Remove test artifacts
node scripts/cleanup-groups.js # Remove test groups
node scripts/prune-orphan-device-groups.js # Fix orphaned groups
```

---

## Notes

### Removed Scripts (Post-Cleanup)

These scripts were removed during the November 2025 cleanup:

- `check-deps.js` (duplicate of deps-unused.js)
- `config-check.js` (overlaps with validate-config.js)
- `coverage-report.sh` (wrapper for npm run test:coverage)
- `generate-openapi-spec.js` (duplicate of export-openapi.js)
- `create-backend-issues.sh` (Gitea-specific)
- `setup-gitea-labels.sh` (Gitea-specific)
- `setup-branch-protection.sh` (GitHub CLI-specific)
- `dev-auth-debug.js` (dev utility)
- `deps-advice.sh` (wrapper)
- `simple-review-check.sh` (consolidated into master-test.sh)
- `pre-deployment-regression.sh` (consolidated into master-test.sh)

### Script Count

- **Before cleanup:** 38 scripts
- **After cleanup:** 27 scripts
- **Reduction:** 29% (11 redundant scripts removed)

---

**Last updated:** November 16, 2025
**Version:** 2.9.8
