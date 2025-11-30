# Testing Guide - Posterrama

Complete guide for all testing & validation in Posterrama v2.9.4.

---

## Quick Start

### For Release

```bash
npm run release:ready # Complete pre-release validation
npm run release:ready:fast # Fast version (skip slow tests)
```

### Daily Development

```bash
npm test # Unit tests
npm run test:watch # Watch mode
npm run lint # Code quality
npm run format # Auto-format
```

---

## Test Coverage Overview

**Backend:** 175 test files, ~2400 tests

- **Coverage target:** 60-70% (realistic behavioral testing)
- **Test types:** Unit, Integration, API, Performance, Regression
- **Frontend:** 88 Vitest browser tests

**Test distribution:**

- Utils: 71 tests
- API: 30 tests
- Middleware: 11 tests
- Sources: 11 tests
- Config: 13 tests
- Performance: 3 tests
- Integration: 4 tests
- Frontend: 88 tests

---

## The Master Test Script

### What is `master-test.sh`?

The **definitive pre-release validation script** that:

- Executes **9 phases** of checks
- Uses **real credentials** (`private/test-credentials.json`)
- **Clear categories**: BLOCKERS, FAILURES, WARNINGS
- **Auto-fix** where possible
- **Pass rate** percentage and final report

### Usage

```bash
# Standard (complete + auto-fix)
npm run release:ready

# Fast (skip slow tests)
npm run release:ready:fast

# Without auto-fix
AUTO_FIX=false ./scripts/master-test.sh
```

### What Does It Test? (9 Phases)

#### PHASE 0: Environment Setup

- Node.js & npm installed
- node_modules exists
- Test credentials available (`private/test-credentials.json`)

#### PHASE 1: Code Quality

- ESLint (auto-fix available)
- Prettier formatting (auto-fix available)
- No backup files
- No large files (>500KB)
- Console.log statements removed

#### PHASE 2: Configuration & Schema

- config.json exists & valid
- Config validates against schema
- Example configs up-to-date
- Admin defaults validated

#### PHASE 3: Dependencies & Security

- All dependencies installed
- No unused dependencies
- Security audit (filtered)
- No secrets in code

#### PHASE 4: Unit & API Tests

- Jest configuration valid
- All unit tests pass
- Test coverage meets threshold (60-70%)

#### PHASE 5: Integration Tests ⭐ **WITH REAL CREDENTIALS**

- Integration tests with real Plex/Jellyfin/TMDB
- Media source connectivity check
- ️ Skipped if `private/test-credentials.json` doesn't exist

#### PHASE 6: Regression Tests

- API contract validation (BLOCKING)
- Config schema backward compatibility (BLOCKING)
- ️ External service contracts
- ️ Critical path E2E tests

#### PHASE 7: Performance & Health

- Health check passes
- Performance baseline check
- Memory usage reasonable

#### PHASE 8: Documentation & API

- README.md exists
- OpenAPI spec generation
- OpenAPI spec validation
- Swagger documentation complete

#### PHASE 9: File System & Cleanup

- Shell scripts executable (auto-fix)
- Test artifacts cleaned (auto-fix)
- No .env files committed

### Output Example

```
╔═══════════════════════════════════════════════════════════════╗
║ POSTERRAMA MASTER TEST & RELEASE READINESS ║
║ Complete validation with real credentials ║
╚═══════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════
PHASE 1: CODE QUALITY
═══════════════════════════════════════════════════════════════

▶ Linting & Formatting
 [1] ESLint code quality... PASS
 [2] Prettier code formatting... PASS

... (more output)

═══════════════════════════════════════════════════════════════
 FINAL RELEASE READINESS REPORT
═══════════════════════════════════════════════════════════════

Summary:
 Total Checks: 45
 Passed: 42
 Failed: 1
 ️ Warnings: 2
 Blockers: 0

 Pass Rate: 93%

️ WARNINGS (review recommended):
 • [23] Integration tests: Cannot reach some media sources
 • [35] Memory usage: 450MB (monitor for leaks)

 RELEASE READY (with warnings)
 2 warnings to review
```

### Exit Codes

| Exit Code | Status                | Meaning                    |
| --------- | --------------------- | -------------------------- |
| `0`       | **READY**             | All checks passed          |
| `1`       | **BLOCKED**           | Blocking issues, fix first |
| `1`       | ️ **NOT RECOMMENDED** | Failures present           |

### Status Categories

** BLOCKER** - MUST be fixed before release:

- API contract regression
- Config schema breaking changes
- Critical system failures

** FAILURE** - SHOULD be fixed:

- Test failures
- Config validation errors
- ESLint/Prettier errors

**️ WARNING** - Review recommended:

- External service issues
- Performance warnings
- Documentation incompleteness

---

## All Test Commands

### Unit & Integration Tests

| Command                          | Description                        |
| -------------------------------- | ---------------------------------- |
| `npm test`                       | Alle backend tests (Jest)          |
| `npm run test:watch`             | Watch mode voor development        |
| `npm run test:all`               | Backend + Frontend (Jest + Vitest) |
| `npm run test:frontend`          | Alleen frontend tests (Vitest)     |
| `npm run test:frontend:watch`    | Frontend watch mode                |
| `npm run test:frontend:ui`       | Frontend met Vitest UI             |
| `npm run test:frontend:coverage` | Frontend met coverage              |
| `npm run test:coverage`          | Backend met coverage rapport       |
| `npm run test:stress`            | Stress test (5× herhalen)          |

### Regression Testing

| Command                             | Description                          |
| ----------------------------------- | ------------------------------------ |
| `npm run test:regression`           | Alle regressie tests                 |
| `npm run test:regression:contracts` | API contract validatie               |
| `npm run test:regression:e2e`       | Critical path E2E tests              |
| `npm run test:regression:config`    | Config schema backward compatibility |
| `npm run test:regression:external`  | External service contracts           |
| `npm run test:quick-regression`     | Snelle regressie check               |
| `npm run test:full-regression`      | Volledige regressie suite            |
| `npm run test:pre-deployment`       | Pre-deployment regressie             |

### Live Environment Testing

| Command                             | Description            | Usage                                           |
| ----------------------------------- | ---------------------- | ----------------------------------------------- |
| `npm run test:smoke:live`           | Quick smoke test       | `npm run test:smoke:live http://localhost:4000` |
| `npm run test:contract:live`        | API contract validatie | Verify API structure op live server             |
| `npm run test:performance`          | Performance monitoring | Meet response times vs baseline                 |
| `npm run test:performance:baseline` | Update baseline        | Na performance verbeteringen                    |

#### Smoke Test (30 seconden)

Quick check voor live servers:

- Basic connectivity (root, admin)
- API endpoints (/api/health, /get-config, /api/posters)
- Static assets (logo, CSS, JS)
- Display modes (screensaver, wallart, cinema)
- Response time check (<100ms = excellent)

#### Contract Test

API contract validatie op live server:

- Verify status codes
- Verify response structure
- Verify required fields
- Verify field types
- Response time measurement

#### Performance Test

Performance monitoring met baselines:

- Meet response times (5 iteraties)
- Calculate avg, min, max, P95
- Compare tegen thresholds
- Compare tegen baseline
- Detect >20% performance changes

### Code Quality

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `npm run lint`         | ESLint checking                  |
| `npm run lint:fix`     | ESLint auto-fix                  |
| `npm run format`       | Prettier format all              |
| `npm run format:check` | Check formatting zonder wijzigen |
| `npm run test:hygiene` | Test cleanliness checks          |
| `npm run quality:all`  | Volledige quality pipeline       |

### Configuration

| Command                           | Description              |
| --------------------------------- | ------------------------ |
| `npm run config:validate`         | Validate config.json     |
| `npm run config:validate:example` | Validate example configs |

### Dependencies & Security

| Command                       | Description                |
| ----------------------------- | -------------------------- |
| `npm run deps:check`          | Check outdated packages    |
| `npm run deps:update`         | Update dependencies        |
| `npm run deps:audit`          | Full npm audit             |
| `npm run deps:security-audit` | Filtered security audit    |
| `npm run deps:security-daily` | Daily security check       |
| `npm run deps:security-full`  | Full security audit        |
| `npm run deps:health`         | Dependency health check    |
| `npm run deps:advice`         | Dependency advice          |
| `npm run deps:unused`         | Detect unused dependencies |

### Health & Monitoring

| Command                | Description        |
| ---------------------- | ------------------ |
| `npm run health`       | Full health check  |
| `npm run health:quick` | Quick health check |

### Performance

| Command                      | Description        |
| ---------------------------- | ------------------ |
| `npm run perf:audit`         | Performance audit  |
| `npm run perf:bundle-size`   | Check bundle sizes |
| `npm run perf:largest-files` | Find largest files |
| `npm run perf:memory`        | Memory usage test  |

### Release & Deployment

| Command                      | Description                             |
| ---------------------------- | --------------------------------------- |
| `npm run release:ready`      | **Pre-release validatie (RECOMMENDED)** |
| `npm run release:ready:fast` | Fast release check (skip slow tests)    |
| `npm run release:patch`      | Release patch version                   |
| `npm run release:minor`      | Release minor version                   |
| `npm run release:major`      | Release major version                   |

### OpenAPI & Documentation

| Command                    | Description           |
| -------------------------- | --------------------- |
| `npm run openapi:export`   | Export OpenAPI spec   |
| `npm run openapi:validate` | Validate OpenAPI spec |
| `npm run openapi:sync`     | Sync OpenAPI spec     |

### Utilities

| Command                     | Description             |
| --------------------------- | ----------------------- |
| `npm run test:cleanup`      | Cleanup test artifacts  |
| `npm run coverage:table`    | Generate coverage table |
| `npm run badges:update`     | Update badges           |
| `npm run review:self-check` | Self-check review       |
| `npm run review:pre-check`  | Pre-review check        |

---

## Recommended Workflow

### For Each Feature

```bash
npm test # Quick unit test check
```

### For Commit

```bash
npm run lint && npm test # Basic quality gate
```

### For Pull Request

```bash
npm run release:ready # Full validation
```

### For Release

```bash
npm run release:ready # Complete check
# Review output
# Fix any blockers/failures
# Deploy!
```

### After Deployment (Live Check)

```bash
npm run test:smoke:live https://your-domain.com
TEST_URL=https://your-domain.com npm run test:contract:live
TEST_URL=https://your-domain.com npm run test:performance
```

### Update Performance Baseline

After performance improvements:

```bash
npm run test:performance:baseline
git add __tests__/regression/performance-baseline.json
git commit -m "chore: update performance baseline"
```

---

## Troubleshooting

### "BLOCKED: API contract regression"

```bash
# Review changes
npm run test:regression:contracts
# Fix breaking changes or update contracts
```

### "FAILED: Unit tests"

```bash
# See details
npm test
# Fix failing tests
```

### "WARNING: Integration tests failed"

```bash
# Check credentials
cat private/test-credentials.json
# Test connectivity (if script exists)
node scripts/validation/test-media-connectivity.js
```

### "No credentials file"

```bash
# Create from template
cp private/test-credentials.example.json private/test-credentials.json
# Edit with real values
nano private/test-credentials.json
```

### Performance Degradation

```bash
# Measure and analyze
npm run test:performance
# Update baseline if expected
npm run test:performance:baseline
```

### Tests Fail After New Feature

```bash
# Verify breaking changes
npm run test:regression:contracts
# Update baselines if expected
npm run test:performance:baseline
```

---

## Test Credentials

For **complete** integration testing (PHASE 5):

```json
{
    "plex": {
        "token": "your-plex-token",
        "serverUrl": "http://your-plex:32400"
    },
    "jellyfin": {
        "apiKey": "your-jellyfin-key",
        "serverUrl": "https://your-jellyfin:8096"
    },
    "tmdb": {
        "apiKey": "your-tmdb-key"
    },
    "admin": {
        "username": "admin",
        "passwordHash": "$2b$10$..."
    }
}
```

**Without credentials:**

- Unit tests: Work (use mocks)
- API tests: Work (use mocks)
- Integration tests: ️ Will be **skipped**
- Regression tests: Work (some use mocks)

Location: `private/test-credentials.json`

---

## Continuous Integration

### Potential CI/CD Extensions

#### Scheduled Smoke Tests

```yaml
name: Live Smoke Test
on:
    schedule:
        - cron: '0 */6 * * *' # Every 6 hours
    workflow_dispatch:
jobs:
    smoke-test:
    runs-on: ubuntu-latest
    steps:
        - uses: actions/checkout@v3
        - run: npm ci
        - run: npm run test:smoke:live https://your-domain.com
```

#### Performance Monitoring

```yaml
name: Performance Monitor
on:
    schedule:
        - cron: '0 0 * * *' # Daily
jobs:
    performance:
    runs-on: ubuntu-latest
    steps:
        - uses: actions/checkout@v3
        - run: npm ci
        - run: TEST_URL=https://your-domain.com npm run test:performance
```

#### Pre-deployment Gate

```yaml
name: Pre-deployment
on:
    push:
    branches: [main]
jobs:
    validate:
    runs-on: ubuntu-latest
    steps:
        - uses: actions/checkout@v3
        - run: npm ci
        - run: npm run test:pre-deployment
```

---

## Possible Extensions

Current coverage is very comprehensive. Optional additions:

### 1. Load Testing

```bash
npm install -D k6
# of
npm install -D artillery
```

### 2. Visual Regression Testing

```bash
npm install -D playwright @playwright/test
# Screenshot comparisons
```

### 3. Database/State Validation

- Config backup integrity
- Device state consistency
- Session data validation

### 4. WebSocket Connection Testing

- WebSocket connection stability
- Command/response validation
- Reconnection handling

---

## Metrics & Reporting

Automatically generated reports:

- `coverage/lcov-report/index.html` - Coverage report
- `private/regression-summary-*.md` - Regression reports
- `__tests__/regression/performance-baseline.json` - Performance baseline

---

## Best Practices

1. **Voor Development:** `npm run test:watch`
2. **Voor Commit:** `npm run lint && npm test`
3. **Voor PR:** `npm run release:ready`
4. **Voor Release:** `npm run release:ready` (DEFINITIEF)
5. **Na Deploy:** `npm run test:smoke:live [URL]`
6. **Wekelijks:** `npm run test:contract:live` + `npm run test:performance`

---

## Conclusion

**`npm run release:ready` is the definitive answer to:**

> "Are we ready for release? What still needs to be done?"

It gives you a clear, structured overview with:

- What works (PASSED)
- What needs to be fixed (FAILURES)
- What blocks the release (BLOCKERS)
- ️ What you should review (WARNINGS)

**One command to rule them all:** `npm run release:ready`

---

**Last update:** November 16, 2025
**Version:** 2.9.8
**Script location:** `scripts/master-test.sh`
