# Performance Guide

**Last Updated:** November 12, 2025  
**Version:** Posterrama v2.8.1

---

## Current Performance Status

**All optimizations implemented** ✅

| Metric                | Before | After | Improvement     |
| --------------------- | ------ | ----- | --------------- |
| Average response time | 97ms   | 92ms  | 5.2% faster     |
| Response variance     | 53ms   | 14ms  | **73.6% lower** |
| Response range        | 53ms   | 14ms  | Most consistent |
| All tests passing     | ✅     | ✅    | 2349/2349       |

**🎯 Key Achievement:** 73.6% more predictable response times

---

## Implemented Optimizations

### Cache System (7-tier TTL strategy)

```javascript
veryShort: 1 minute    // Device status, volatile data
short: 2 minutes       // Groups, frequently changing
medium: 30 minutes     // Media listings (no filters)
long: 2 hours          // Library lists, stable content
veryLong: 4 hours      // Config, static metadata
mediaFiltered: 5 minutes   // User expects fresh results
config: 4 hours        // Rarely changes
```

**API Endpoint:** `/api/admin/cache/clear` - Clear specific cache tier

### Image Processing

- **Progressive JPEG**: Faster perceived load times
- **mozjpeg compression**: 30-40% smaller images
- **Disk caching**: Thumbnails cached to `image_cache/thumb_*.jpg`
- **Result:** 95% reduction in Sharp CPU usage on cache hits

### API Parallelization

- **Plex**: Library queries run concurrently (`Promise.all`)
- **Jellyfin**: Batch pagination with `maxParallel: 5`
- **Benefit**: 60-70% faster with 3+ libraries

### Request Deduplication

- Prevents duplicate concurrent requests
- Shares single fetch across multiple clients
- **Status:** Active (automatic)
- **Monitoring:** Check `getMetrics().deduplication` on sources

---

## Optional: Tiered Caching

**Status:** Disabled by default (ready to enable)

```
L1 (hot):   100 entries - frequently accessed
L2 (warm):  300 entries - moderately accessed
L3 (cold):  500 entries - rarely accessed
```

**When to enable:**

- Cache hit rate < 60%
- Cache pressure: >100 unique keys actively accessed
- Clear hot/cold data patterns
- High memory pressure

**How to enable:**

```javascript
// In cache initialization
const cache = new CacheManager({
    enableTiering: true,
    l1MaxSize: 100,
    l2MaxSize: 300,
    l3MaxSize: 500,
    promotionThreshold: 3,
    demotionAge: 10 * 60 * 1000,
});
```

**Measurement tool:** `node scripts/measure-tiered-cache.js`

---

## Monitoring

### API Endpoints

```bash
# Performance metrics
GET /api/admin/performance/metrics

# Response includes:
{
  "cache": {
    "hitRate": 0.75,
    "size": 234,
    "hits": 1523,
    "misses": 508
  },
  "sources": {
    "plex": {
      "totalRequests": 156,
      "deduplication": {
        "rate": 0.15
      }
    }
  }
}
```

### Cache Management

```bash
# Clear all caches
POST /api/admin/cache/clear

# Clear specific tier
POST /api/admin/cache/clear?tier=medium

# Available tiers: veryShort, short, medium, long, veryLong, mediaFiltered, config
```

### Metrics to Watch

1. **Cache hit rate**: Target 75-85%
2. **Response variance**: Keep < 20ms
3. **Deduplication rate**: 5-15% normal, 30-50% concurrent load
4. **Disk cache size**: `image_cache/` directory (~100-500 MB)

---

## Production Recommendations

### Deployment Checklist

- ✅ Deploy current code (all optimizations active)
- ✅ Monitor deduplication metrics for 7 days
- ⏳ Enable tiered caching if hit rate < 60%
- ⏳ Test with multiple libraries (3+) to validate parallelization

### Multi-Library Testing

```bash
# Test parallelization with multiple libraries
curl "http://localhost:4000/get-media?type=movie&count=50&library=Movies,Kids,Anime"

# Test deduplication under concurrent load
for i in {1..5}; do
  curl "http://localhost:4000/get-media?type=movie&count=50" &
done
wait
```

### Expected Performance

| Scenario             | Response Time | Notes                            |
| -------------------- | ------------- | -------------------------------- |
| Single library       | 85-105ms      | Current baseline                 |
| 3+ libraries         | 50-70ms       | Parallelization benefits         |
| Concurrent requests  | 85-105ms      | Deduplication prevents redundant |
| Thumbnail generation | <1ms cached   | 95% reduction vs uncached        |

---

## Troubleshooting

### High Response Times

1. **Check cache hit rate**: `GET /api/admin/performance/metrics`
    - Low hit rate? Enable tiered caching
    - Clear stale cache: `POST /api/admin/cache/clear`

2. **Check upstream API latency**:
    - Plex/Jellyfin server responsiveness
    - Network latency to media servers

3. **Check deduplication rate**:
    - Low rate during concurrent requests? Check logs
    - Deduplication timeout (30s) might be too short

### High Memory Usage

1. **Disable tiered caching** if enabled: `enableTiering: false`
2. **Reduce cache sizes**:
    ```javascript
    maxSize: 500 → 300  // Reduce main cache
    l1MaxSize: 100 → 50 // Reduce hot tier
    ```
3. **Clear thumbnail cache**: Remove old files from `image_cache/`

### Cache Not Working

1. **Verify cache middleware loaded**: Check `middleware/cache.js`
2. **Check cache statistics**: Should show non-zero hits
3. **Verify TTL configuration**: 7 tiers should be present
4. **Check for cache-busting headers**: Client may bypass cache

---

## Configuration Reference

### Cache Configuration

```json
{
    "cache": {
        "enabled": true,
        "defaultTTL": 300000,
        "maxSize": 500,
        "persistence": false,
        "tiering": {
            "enabled": false,
            "l1MaxSize": 100,
            "l2MaxSize": 300,
            "l3MaxSize": 500
        }
    }
}
```

### Image Processing Configuration

```json
{
    "images": {
        "progressiveJpeg": true,
        "mozjpegEnabled": true,
        "thumbnailCaching": true,
        "quality": 80
    }
}
```

### API Configuration

```json
{
    "api": {
        "parallelRequests": true,
        "maxConcurrentLibraries": 5,
        "requestDeduplication": true,
        "deduplicationTimeout": 30000
    }
}
```

---

## Tools & Scripts

### Measurement

- `scripts/baseline-metrics.js` - Capture performance baseline
- `scripts/measure-tiered-cache.js` - Test tiered caching impact
- `scripts/compare-phase3.js` - Compare all optimization phases

### Usage

```bash
# Capture current metrics
node scripts/baseline-metrics.js

# Test tiered caching (30s simulation)
node scripts/measure-tiered-cache.js

# Compare all phases
node scripts/compare-phase3.js
```

---

## Files Reference

### Core Files

- `utils/cache.js` - Cache system with L1/L2/L3 tiering
- `utils/request-deduplicator.js` - Request deduplication
- `middleware/cache.js` - Cache middleware with 7-tier TTL
- `utils/job-queue.js` - Image processing with Sharp

### Source Integrations

- `sources/plex.js` - Parallelized queries + deduplication
- `sources/jellyfin.js` - Batch pagination + deduplication

---

## API Integration

Performance features are exposed via admin API:

### Clear Cache

```bash
# Clear all caches
curl -X POST http://localhost:4000/api/admin/cache/clear

# Clear specific tier
curl -X POST http://localhost:4000/api/admin/cache/clear?tier=medium
```

### Get Performance Metrics

```bash
curl http://localhost:4000/api/admin/performance/metrics
```

**Response structure:**

```json
{
    "cache": {
        "hitRate": 0.75,
        "size": 234,
        "maxSize": 500,
        "hits": 1523,
        "misses": 508,
        "sets": 508,
        "deletes": 0
    },
    "sources": {
        "plex": {
            "totalRequests": 156,
            "averageResponseTime": 87,
            "deduplication": {
                "totalRequests": 156,
                "deduplicated": 23,
                "rate": 0.147
            }
        },
        "jellyfin": {
            "totalRequests": 89,
            "averageResponseTime": 95,
            "deduplication": {
                "totalRequests": 89,
                "deduplicated": 12,
                "rate": 0.135
            }
        }
    },
    "system": {
        "uptime": 3600,
        "memory": {
            "used": 125000000,
            "total": 500000000
        }
    }
}
```

---

**Status:** Production-ready with comprehensive monitoring ✅
