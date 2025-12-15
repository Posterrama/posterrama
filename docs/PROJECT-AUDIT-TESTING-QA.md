# Project Audit — Testing & QA

## What’s strong already

- Jest test suite exists with multiple domains (integration, regression, utils).
- There are quality checks and validation scripts (OpenAPI, docs-data, etc.).

## Highest-value test additions (concrete)

### 1) Security regression tests

- Assert all `/api/admin/*` endpoints require authentication.
- Assert `/metrics` behavior matches your decision:
    - protected in production
    - open only in dev/test

### 2) Local directory safety tests

- Path traversal attempts:
    - `../..` variations
    - absolute path outside root
    - symlink traversal (if applicable)

### 3) ZIP export tests

- Ensure download-all:
    - does not load entire files into memory (after refactor)
    - enforces configured limits
    - returns meaningful errors

### 4) “Groups removed” cleanup test

- Ensure device patch/update rejects `groups` and stored devices do not contain legacy keys.

## Process improvements

- Add a small set of “contract tests” for the most important public endpoints.
- Keep the test suite fast by:
    - making heavy performance checks optional
    - running minimal smoke + API-contract checks on push

Last updated: 2025-12-15
