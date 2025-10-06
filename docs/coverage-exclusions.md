# Test coverage policy and exclusions

This note explains our current Jest coverage thresholds, which files are excluded from coverage, and why. It also covers how and when to revisit these choices.

## Global thresholds

We enforce the following minimums at the project level:

- Statements: 85%
- Branches: 65%
- Functions: 85%
- Lines: 85%

These gates are meant to keep unit‑testable logic well covered without penalizing integration-heavy or side‑effectful modules where line coverage has low signal.

Tip: Focused runs (running a single test file) relax thresholds automatically to avoid noisy local failures while iterating.

## Files excluded from coverage

These exclusions are defined in `jest.config.js` via `collectCoverageFrom` negations and `coveragePathIgnorePatterns`.

- server.js
- ecosystem.config.js
- jest.config.js
- config/validate-env.js
- middleware/fileUpload.js
- utils/job-queue.js
- utils/export-logger.js
- sources/local.js
- config/index.js
- utils/healthCheck.js
- utils/updater.js
- sources/jellyfin.js
- sources/tmdb.js
- utils/jellyfin-http-client.js
- utils/deviceStore.js

Additionally ignored directories (never counted):

- /node_modules/
- /**tests**/
- /logs/
- /sessions/
- /image_cache/
- /screenshots/
- /public/

## Rationale (why these are excluded)

We aim to count coverage primarily for deterministic, unit‑testable code paths. The modules below are verified by behavior‑focused tests but excluded from percentage gates to avoid low‑signal coverage churn.

- Bootstrap/configuration
    - server.js, ecosystem.config.js, jest.config.js
    - Heavily tied to environment/bootstrap. Full unit coverage is brittle; behavior is covered through integration/regression tests.

- Environment/config loaders
    - config/index.js, config/validate-env.js
    - Require-time side effects, process.env and filesystem interactions. We test behavior but exclude from the gate to avoid incidental swings.

- IO and concurrency heavy
    - middleware/fileUpload.js, utils/job-queue.js, utils/export-logger.js
    - Multipart parsing, disk IO, timers, and backpressure are best validated through integration rather than line coverage.

- External API adapters and network clients
    - sources/jellyfin.js, sources/tmdb.js, utils/jellyfin-http-client.js
    - Pagination/network flows and remote schemas are covered with behavior/integration tests; line coverage adds little signal and can be flaky.

- Local filesystem/event driven
    - sources/local.js
    - File watching, ZIP/FS operations, and event sequencing are validated by integration tests; excluded from coverage gating.

- Operational/maintenance utilities
    - utils/healthCheck.js, utils/updater.js, utils/deviceStore.js
    - Probe external services, perform downloads/updates, and persist device metadata. Behavior is tested; coverage is de‑emphasized for gating due to IO variability.

Note: Excluded ≠ untested. Many of these modules have tests that assert behavior; they simply don’t count toward the coverage percentages.

## Included adapters and balance

We keep `sources/plex.js` in coverage with pragmatic, file‑level thresholds to ensure at least one fully featured adapter remains coverage‑driven. Other adapters are validated through behavior tests but excluded from coverage gates.

## Maintenance checklist

When touching coverage settings:

1. Keep `collectCoverageFrom` negations and `coveragePathIgnorePatterns` in sync.
2. Prefer raising global thresholds or adding unit tests before expanding exclusions.
3. If re‑including a module, add or extend unit tests to keep the build green under global gates.
4. For new integration‑heavy modules, add behavior/integration tests first; exclude from gates only if line coverage is low‑value.

## Focused runs and local dev

For iterative local work (e.g., running a single test file), thresholds are relaxed automatically based on CLI args. CI runs enforce full thresholds.
