# Project Audit Index (December 2025)

The project audit has been consolidated.

## Read this

- [PROJECT-AUDIT.md](PROJECT-AUDIT.md) — single source of truth: current status + open items

## Archived (historical detail)

Older audit documents were archived to keep the docs folder focused.

- `docs/archive/project-audit/`

## How this was produced

- Repo-wide grep-style scans (errors/todos/child_process/file-path usage)
- Targeted deep dives into high-risk areas (local file routes, uploads, cache, config migrations, metrics)
- Cross-checks against existing architecture patterns described in docs/

## Questions to answer (to finalize decisions)

- (Resolved) Legacy “groups” device field fully removed (API + storage).
- (Resolved) `/metrics` protected (auth required).
- Is local directory ZIP download intended for very large trees, or just small exports?

Last updated: 2025-12-15
