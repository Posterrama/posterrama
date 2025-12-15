# Project Audit — Performance & Scalability

## Biggest performance risks

### 1) ZIP export scalability

- Location: `routes/local-directory.js` (download-all)
- Why it matters:
    - Directory exports can be long-running and disk-heavy.
    - If handled poorly, they can cause latency spikes for unrelated requests.
- Status: improved — ZIP creation is streamed and protected by limits.
- Next hardening:
    - Stop work on client disconnect.
    - Consider caching/indexing for repeated large exports (or declare “small exports only”).

### 2) Disk free space checks

- Location: `utils/cache.js` (`fs.promises.statfs()` + TTL cache)
- Status: improved — avoids shell pipelines and avoids per-call duplication via in-flight caching.
- Next hardening:
    - Consider increasing TTL if free-space checks show up in hot paths.

### 3) Metrics and logs can become high-cardinality or too chatty

- Risks:
    - Labels or logs based on raw paths, user agents, etc.
    - Excessive debug output under normal use.
- Concrete fix:
    - Normalize paths (route templates), cap label values, sample low-value logs.

## Opportunities

- Cache layer already has strong foundations (tiering, memory monitoring). Next wins:
    - Split `utils/cache.js` to isolate concerns.
    - Add performance tests around cache hot paths.

- For directory scans/search:
    - Enforce timeouts (stop after X ms and return partial results with “truncated: true”).
    - Support pagination rather than global recursion.

## Suggested benchmarks (lightweight)

- Baseline latency for:
    - `/api/media` hot cache vs cold cache
    - admin pages load
    - local directory search on large tree

- Track event-loop lag percentile (P95/P99) and memory RSS.

Last updated: 2025-12-15
