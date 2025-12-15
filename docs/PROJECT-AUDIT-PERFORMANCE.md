# Project Audit — Performance & Scalability

## Biggest performance risks

### 1) ZIP download-all builds ZIP in memory

- Location: `routes/local-directory.js` (download-all)
- Why it matters:
    - `readFile()` per entry means memory usage scales with directory size.
    - Long event-loop blocks degrade the whole app.
- Concrete fix:
    - Stream ZIP creation and stream the response.
    - Add server-side limits and return a clear error when exceeded.

### 2) Expensive disk checks via shell pipelines

- Location: `utils/cache.js` (`df -k ... | tail -1 | awk ...`)
- Concrete fix:
    - Move to background sampling and cache results.
    - Use `spawn` with strict args and timeout.

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
