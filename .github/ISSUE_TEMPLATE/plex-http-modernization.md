---
name: 'Plex HTTP Stack Modernization'
about: 'Migrate legacy request-based Plex client to modern fetch-based implementation'
labels: ['plex', 'tech-debt', 'refactor']
assignees: []
---

## Summary

Modernize the Plex HTTP integration by replacing deprecated `request` ecosystem deps with a fetch-based internal client, improving security posture and maintainability.

## Motivation

Security audits repeatedly flag transitive vulnerabilities (form-data, tough-cookie, xml2js). A native / minimal dependency approach reduces surface and future upgrade friction.

## Scope

- New internal fetch wrapper (timeout, retry, logging tags)
- Optional XML parser migration (evaluate fast-xml-parser)
- Dual-path flag: `PLEX_HTTP_STACK=new`
- Metrics + error shape parity

## Non-Goals

- Changing public API routes
- Altering Plex config schema
- Refactoring unrelated sources (Jellyfin/TMDB)

## Detailed Plan

1. Inventory existing calls & headers
2. Implement `utils/http/fetchClient.js`
3. Response normalizer returning current adapter structure
4. Add fixture-based contract tests (legacy vs new)
5. Add performance comparison script (optional)
6. Ship behind flag (default: legacy)
7. Flip default after 1 minor release if stable
8. Remove legacy path + deps

## Risks & Mitigations

| Risk                     | Mitigation                               |
| ------------------------ | ---------------------------------------- |
| Parsing behavior drift   | Golden fixture tests                     |
| Timeout semantics change | Explicit AbortController tests           |
| Hidden header coupling   | Header snapshot tests                    |
| Rollback complexity      | Feature flag keeps legacy path available |

## Acceptance Criteria

- Flag on: all Plex tests pass unchanged
- Coverage new code ≥90% lines
- No increase in critical vulns (npm audit)
- p95 latency within ±5%

## Testing Checklist

- [ ] Unit: fetch wrapper (timeouts, retries, abort)
- [ ] Contract: legacy vs new responses diff minimal
- [ ] Integration: mocked Plex server fixture
- [ ] Error paths: auth fail, network timeout, malformed XML

## Rollout

1. Merge flag-off
2. Enable in staging
3. Observe metrics 48h
4. Default to new
5. Remove legacy in subsequent minor

## Additional Notes

See internal design notes in `private/MODULARIZATION.md` (Plex modernization section) for architectural context.

## Open Questions

- Adopt fast-xml-parser now or later?
- Maintain cookie jar, or can we rely purely on token headers?
- Implement jittered exponential backoff for retries?
