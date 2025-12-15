# Testing Guide

**Version:** 2.9.9
**Last Updated:** 2025-12-14
**Test runner:** Jest

This document covers how to run Posterrama’s tests and validation scripts.

---

## Quick Start

### Daily development

```bash
npm test
npm run test:watch
npm run lint
npm run format
```

### Release readiness

```bash
npm run release:ready
npm run release:ready:fast
```

---

## Core Test Commands

### Unit/integration (Jest)

- Run all tests:

```bash
npm test
```

- Run with coverage:

```bash
npm run test:coverage
```

- Run a focused subset:

```bash
npm test -- devices
npm test -- mqtt
```

### Regression suites

- Full regression folder:

```bash
npm run test:regression
```

- Targeted regression runs:

```bash
npm run test:regression:contracts
npm run test:regression:config
npm run test:regression:external
npm run test:regression:e2e
```

---

## Live Environment Validation

These scripts hit a running Posterrama server. Set `TEST_URL` if it’s not `http://localhost:4000`.

```bash
TEST_URL=http://localhost:4000 npm run test:contract:live
TEST_URL=http://localhost:4000 npm run test:performance
```

Update / create a performance baseline:

```bash
TEST_URL=http://localhost:4000 npm run test:performance:baseline
```

Smoke test a live server:

```bash
npm run test:smoke:live http://localhost:4000
```

---

## Release Readiness Script

`npm run release:ready` runs `scripts/master-test.sh` (multi-phase). It typically covers:

- Lint/format checks
- Config validation
- Test hygiene (focused/skipped tests, docs data validation)
- Jest test suite
- OpenAPI sync + validation
- Dependency hygiene and security audit

Some phases may depend on local-only files (for example `private/test-credentials.json`). If that file isn’t present, those checks may be skipped.

---

## Coverage Outputs

- Jest coverage: `npm run test:coverage`
- Generate the per-file coverage table:

```bash
npm run coverage:table
```

This updates `docs/COVERAGE.md`.

---

## Mutation Testing (Optional)

```bash
npm run test:mutation
npm run test:mutation:quick
```

---

## Related Docs

- `SCRIPTS-OVERVIEW.md`
- `COVERAGE.md`
- `PERFORMANCE-BASELINE.md`
