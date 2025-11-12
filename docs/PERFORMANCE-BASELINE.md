# Performance Baseline Measurements

**Captured:** November 12, 2025, 15:04:29 UTC  
**Server:** Posterrama v2.8.1 on Node v20.19.5 (Linux x64)  
**Base URL:** http://localhost:4000

---

## API Response Times

Measurements based on 5 samples per endpoint:

| Endpoint       | Average  | Min  | Max   | Median | Response Size |
| -------------- | -------- | ---- | ----- | ------ | ------------- |
| `/health`      | **3ms**  | 3ms  | 4ms   | 3ms    | 117 B         |
| `/get-config`  | **6ms**  | 5ms  | 7ms   | 5ms    | 2.8 KB        |
| `/get-media`   | **97ms** | 84ms | 137ms | 86ms   | 5.9 MB        |
| `/api/devices` | **7ms**  | 6ms  | 9ms   | 7ms    | 12.9 KB       |

### Key Findings

- **Primary endpoint (`/get-media`)**: 97ms average response time
- **Response time range**: 84-137ms (variability: ~63%)
- **Response size**: ~6MB for 50 movie posters
- **Fast endpoints**: Health check (3ms) and config (6ms) are consistently fast

---

## Cache Performance

⚠️ **Cache statistics not available** - Requires authentication to access `/api/admin/performance/metrics`

To capture cache metrics with authentication:

```bash
SESSION_COOKIE="your-session-cookie" node scripts/baseline-metrics.js --save
```

Expected metrics:

- API Cache hit rate
- Main Cache hit rate
- Total requests (hits/misses)
- Cache size (entries)

---

## Performance Optimization Targets

Based on current baseline and [PERFORMANCE-OPTIMIZATION-PLAN.md](./PERFORMANCE-OPTIMIZATION-PLAN.md):

### Phase 1: Quick Wins (Expected Improvements)

1. **Cache TTL Optimization**
    - Target: -40% API calls
    - Impact: Reduce /get-media response time variability

2. **Progressive JPEG + mozjpeg**
    - Target: -35% bandwidth
    - Impact: 5.9MB → ~3.8MB per 50 posters

3. **Thumbnail Disk Caching**
    - Target: -95% Sharp CPU usage
    - Impact: More consistent response times

**Expected Result After Phase 1:**

- `/get-media`: 97ms → 60-70ms (30-40% faster)
- Response size: 5.9MB → 3.5-4.0MB
- More consistent response times (less variance)

---

### Phase 2: High Impact (Expected Improvements)

4. **Parallel Plex Queries**
    - Target: -70% Plex fetch time
    - Impact: Multiple libraries fetch in parallel

5. **Batch Jellyfin Pagination**
    - Target: -60% large library fetch time
    - Impact: Better performance for 5000+ item libraries

**Expected Result After Phase 2:**

- `/get-media`: 60-70ms → 40-50ms (additional 30-40% improvement)
- More stable under concurrent load

---

### Phase 3: Advanced (Expected Improvements)

6. **Tiered Caching**
    - Target: +35% cache hit rate
    - Impact: 50% → 75-85% hit rate

7. **Request Deduplication**
    - Target: -50% redundant calls
    - Impact: Better performance during concurrent requests

**Expected Result After Phase 3:**

- `/get-media`: 40-50ms → 30-40ms (final 20-25% improvement)
- Cache hit rate: 75-85%
- Highly optimized for production load

---

## Cumulative Expected Improvements

| Metric                     | Current Baseline | After Phase 1 | After Phase 2 | After Phase 3 | Total Improvement |
| -------------------------- | ---------------- | ------------- | ------------- | ------------- | ----------------- |
| `/get-media` response time | 97ms             | 60-70ms       | 40-50ms       | 30-40ms       | **60-70% faster** |
| Response size              | 5.9 MB           | 3.8 MB        | 3.8 MB        | 3.8 MB        | **35% smaller**   |
| Cache hit rate             | ~50%\*           | ~60%          | ~70%          | 75-85%        | **+35-70%**       |
| CPU usage (Sharp)          | Baseline         | -95%          | -95%          | -95%          | **-95%**          |

\*Estimated - actual measurement requires authentication

---

## Next Steps

1. ✅ Baseline captured and documented
2. **Implement Phase 1 optimizations** (3-4 hours)
3. Capture post-Phase-1 metrics for validation
4. Continue with Phase 2 if results are positive

---

## Files

- **Baseline data**: `performance-baseline.json`
- **Optimization plan**: `PERFORMANCE-OPTIMIZATION-PLAN.md`
- **Metrics script**: `scripts/baseline-metrics.js`
- **Performance endpoint**: `/api/admin/performance/metrics`

---

**Notes:**

- Measurements taken on development server with minimal load
- Production results may vary based on network latency and concurrent load
- Cache statistics require authentication (SESSION_COOKIE environment variable)
- This baseline serves as the comparison point for all optimization work
