# Backend Code Analysis - Part 3: Performance & Scalability

**Date:** November 15, 2025  
**Version:** 2.9.4  
**Previous:** [Part 2: Code Quality & Technical Debt](BACKEND-ANALYSIS-2025-11-15-PART2.md)

---

## 1. Performance Architecture

### 1.1 Current Caching Strategy ✅

**Multi-Tier Caching Implementation:**

```
┌─────────────────────────────────────────────────────────────┐
│                   Request Processing                         │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │   Memory Cache (L1)     │  ← 5-300s TTL
        │   CacheManager          │     500 entries max
        │   In-process Map        │     LRU eviction
        └────────────┬────────────┘
                     │ miss
        ┌────────────▼────────────┐
        │   Disk Cache (L2)       │  ← 7 days TTL
        │   CacheDiskManager      │     2GB max
        │   image_cache/ dir      │     Age-based cleanup
        └────────────┬────────────┘
                     │ miss
        ┌────────────▼────────────┐
        │   HTTP Cache (L3)       │  ← ETag support
        │   Cache-Control headers │     304 Not Modified
        │   Browser caching       │     CDN-ready
        └─────────────────────────┘
```

### 1.2 Cache Performance Metrics

**Memory Cache (utils/cache.js):**

- Default TTL: 5 minutes
- Max entries: 500 (configurable)
- Eviction: LRU (Least Recently Used)
- Hit ratio: Not tracked (🔴 **Gap**)

**Disk Cache (image_cache/):**

- Max size: 2GB (configurable)
- Cleanup: Automatic when >2GB or <500MB free disk
- TTL: 7 days for images
- Compression: Optional (currently disabled)

**API Response Cache (middleware/cache.js):**

```javascript
class ApiCache {
    defaultTTL = 5 * 60 * 1000; // 5 minutes
    cleanupInterval = 2 * 60 * 1000; // 2 minutes

    stats: {
        hits, misses, sets, deletes
    }
}
```

---

## 2. Performance Issues & Optimizations

### 2.1 Cache Metrics Tracking

#### **ISSUE #19: Add Cache Hit Ratio Monitoring**

**Current State:** Cache stats tracked but not exposed/analyzed

**Problem:**

- No visibility into cache effectiveness
- Can't optimize TTLs without data
- No alerts for cache thrashing

**Recommendation:**

- **Priority:** MEDIUM
- **Effort:** 4 hours
- **Action:** Enhance cache metrics

```javascript
// utils/cache.js - Add to CacheManager
getHitRatio() {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? (this.stats.hits / total) * 100 : 0;
}

getDetailedStats() {
    return {
        ...this.getStats(),
        hitRatio: this.getHitRatio().toFixed(2) + '%',
        efficiency: {
            hitRate: this.stats.hits / (Date.now() - this.stats.lastReset) * 1000, // hits/sec
            missRate: this.stats.misses / (Date.now() - this.stats.lastReset) * 1000,
        },
        recommendations: this.getCacheRecommendations()
    };
}

getCacheRecommendations() {
    const hitRatio = this.getHitRatio();
    const recommendations = [];

    if (hitRatio < 50) {
        recommendations.push('Consider increasing TTL - low hit ratio');
    }
    if (this.cache.size > this.config.maxSize * 0.9) {
        recommendations.push('Cache near capacity - consider increasing maxSize');
    }
    // etc.

    return recommendations;
}
```

**Add endpoint:**

```javascript
// routes/admin-config.js or new routes/admin-cache.js
router.get('/api/admin/cache/metrics', adminAuth, (req, res) => {
    res.json({
        memory: cacheManager.getDetailedStats(),
        disk: cacheDiskManager.getStats(),
        api: apiCache.getStats(),
    });
});
```

---

### 2.2 Playlist Cache Optimization

#### **Current Implementation** (lib/playlist-cache.js)

```javascript
async function refreshPlaylistCache() {
    const memBefore = process.memoryUsage();
    const start = Date.now();

    // Fetch from all sources
    playlistCache = await getPlaylistMediaWrapper();

    const duration = Date.now() - start;
    const memAfter = process.memoryUsage();

    // Log warnings if slow (>5s)
    if (duration > 5000) {
        logger.warn('Slow playlist refresh', { duration });
    }
}
```

**Performance characteristics:**

- Sequential source fetching (🔴 **Bottleneck**)
- Full refresh every time (no incremental updates)
- Memory spike during refresh
- Blocks other operations if slow

#### **ISSUE #20: Parallel Playlist Source Fetching**

**Problem:** Sources fetched sequentially = cumulative latency

**Current:** 3 sources × 2s each = 6s total  
**Optimized:** 3 sources in parallel = 2s total

**Recommendation:**

- **Priority:** HIGH
- **Effort:** 3 hours
- **Action:** Parallelize source fetching

```javascript
// lib/playlist-cache.js
async function refreshPlaylistCache() {
    const memBefore = process.memoryUsage();
    const start = Date.now();

    try {
        // Fetch from all sources in parallel
        const enabledSources = config.mediaServers.filter(s => s.enabled);

        const fetchPromises = enabledSources.map(async source => {
            try {
                return await fetchMediaFromSource(source, options);
            } catch (error) {
                logger.error('Source fetch failed', {
                    source: source.type,
                    error: error.message,
                });
                return []; // Don't fail entire refresh
            }
        });

        const results = await Promise.allSettled(fetchPromises);

        // Combine successful results
        playlistCache = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

        if (options.shuffle) {
            shuffleArray(playlistCache);
        }

        const duration = Date.now() - start;
        logger.info('Playlist refresh completed', {
            duration: `${duration}ms`,
            sources: enabledSources.length,
            itemCount: playlistCache.length,
            failedSources: results.filter(r => r.status === 'rejected').length,
        });

        // Warning threshold can be lower with parallel fetching
        if (duration > 3000) {
            logger.warn('Slow playlist refresh', { duration, itemCount: playlistCache.length });
        }
    } catch (error) {
        logger.error('Playlist refresh failed', { error: error.message });
        // Keep existing cache if refresh fails
    }
}
```

**Expected improvement:**

- 50-70% faster refresh times
- Better fault tolerance (one source failure doesn't block others)
- Lower latency for users

---

### 2.3 Database Query Patterns

#### **Current State:** File-based storage

**Session storage:** `sessions/` directory (session-file-store)

- ~50-100 files typical
- Read/write for each session access
- No indexing or query optimization

**Configuration:** Single `config.json` file

- Read on startup + on-demand
- Written on admin changes
- No locking mechanism (🔴 **Race condition risk**)

**Device storage:** `devices.json` file (deviceStore)

- Read/write on every device state change
- Backup mechanism in place ✅
- File lock not implemented (🔴 **Race condition risk**)

#### **ISSUE #21: Add File Locking for Concurrent Writes**

**Problem:** Multiple processes/requests could corrupt files

**Scenarios:**

1. Two admin users save config simultaneously
2. Multiple devices send commands concurrently
3. Auto-backup runs during manual save

**Recommendation:**

- **Priority:** MEDIUM
- **Effort:** 5 hours
- **Action:** Implement proper-lockfile or fs-ext locking

```javascript
// lib/config-helpers.js
const lockfile = require('proper-lockfile');

async function writeConfig(newConfig, currentConfig) {
    const configPath = path.join(__dirname, '..', 'config.json');
    let release;

    try {
        // Acquire lock with timeout
        release = await lockfile.lock(configPath, {
            retries: {
                retries: 5,
                minTimeout: 100,
                maxTimeout: 1000,
            },
            stale: 5000, // Consider lock stale after 5s
        });

        // Validate before writing
        const validation = validateConfig(newConfig);
        if (!validation.valid) {
            throw new Error('Invalid config: ' + validation.errors.join(', '));
        }

        // Atomic write: write to temp file, then rename
        const tempPath = configPath + '.tmp';
        await fs.promises.writeFile(tempPath, JSON.stringify(newConfig, null, 4), 'utf8');
        await fs.promises.rename(tempPath, configPath);

        logger.info('Config written successfully');
    } catch (error) {
        if (error.code === 'ELOCKED') {
            throw new AppError('Config file is locked by another process', 409);
        }
        throw error;
    } finally {
        if (release) await release();
    }
}
```

**Apply same pattern to:**

- `utils/deviceStore.js` - writeDevices()
- `utils/groupsStore.js` - writeGroups()
- `lib/preset-helpers.js` - writePresets()

---

## 3. Concurrency & Scalability

### 3.1 Current Request Handling

**Express configuration:**

```javascript
// Single-threaded Node.js process
// PM2 manages multiple instances (ecosystem.config.js)
{
    instances: 1, // Single instance by default
    exec_mode: 'fork'
}
```

**Rate limiting:**

```javascript
// middleware/rateLimiter.js
{
    auth: { windowMs: 15 * 60 * 1000, max: 5 },     // 5/15min
    api: { windowMs: 1 * 60 * 1000, max: 60 },      // 60/min
    admin: { windowMs: 1 * 60 * 1000, max: 100 }    // 100/min
}
```

### 3.2 Scalability Considerations

#### **Current Limitations:**

1. **Single instance** = single point of failure
2. **In-memory cache** not shared across instances
3. **WebSocket connections** tied to single instance
4. **File-based storage** = no horizontal scaling

#### **ISSUE #22: Add Cluster Mode Support**

**Problem:** Can't utilize multi-core CPUs effectively

**Recommendation:**

- **Priority:** LOW (works fine for current scale)
- **Effort:** 12 hours
- **Action:** Add cluster mode + Redis for shared state

**Prerequisites:**

- Redis for shared cache
- Redis for session store (replace session-file-store)
- Redis Pub/Sub for WebSocket coordination
- Sticky sessions for load balancer

**Implementation outline:**

```javascript
// ecosystem.config.js
{
    instances: 'max', // or specific number
    exec_mode: 'cluster',
    env: {
        REDIS_URL: 'redis://localhost:6379'
    }
}

// server.js - conditional setup
if (process.env.REDIS_URL) {
    const RedisStore = require('connect-redis')(session);
    const { createClient } = require('redis');
    const redisClient = createClient({ url: process.env.REDIS_URL });

    app.use(session({
        store: new RedisStore({ client: redisClient }),
        // ...
    }));
}
```

**Benefits:**

- Better CPU utilization
- Higher throughput
- Better fault tolerance
- Enables horizontal scaling

**Note:** Not critical for current deployment scale. Consider when:

- Concurrent users > 50
- Request rate > 1000/min
- Response times degrade

---

## 4. Memory Management

### 4.1 Current Memory Patterns

**Good practices** ✅:

1. Cleanup intervals for cache/metrics
2. LRU eviction in memory cache
3. Memory tracking in playlist refresh
4. Graceful shutdown with cleanup()

**Test results** (from performance tests):

```javascript
// __tests__/performance/memory-leak-prevention.test.js
Memory growth: ~400MB over 1000 operations (CI environment)
Local: ~50-90MB (acceptable)
```

### 4.2 Potential Issues

#### **ISSUE #23: Monitor Playlist Cache Memory Growth**

**Observation:** Playlist cache grows unbounded

**Current:**

```javascript
// lib/playlist-cache.js
let playlistCache = []; // Can grow to 1000s of items

// Each item ~5-10KB (with metadata, images, etc.)
// 1000 items = 5-10MB (acceptable)
// 10000 items = 50-100MB (concerning)
```

**Recommendation:**

- **Priority:** LOW
- **Effort:** 2 hours
- **Action:** Add size limit and monitoring

```javascript
// lib/playlist-cache.js
const MAX_PLAYLIST_SIZE = 5000; // Configurable
const MAX_MEMORY_MB = 50; // Alert threshold

async function refreshPlaylistCache() {
    // ... existing code ...

    // Check size after refresh
    if (playlistCache.length > MAX_PLAYLIST_SIZE) {
        logger.warn('Playlist cache exceeds size limit', {
            size: playlistCache.length,
            limit: MAX_PLAYLIST_SIZE,
        });
        // Trim to limit
        playlistCache = playlistCache.slice(0, MAX_PLAYLIST_SIZE);
    }

    // Estimate memory usage
    const estimatedMB = (playlistCache.length * 8) / 1024; // ~8KB per item
    if (estimatedMB > MAX_MEMORY_MB) {
        logger.warn('Playlist cache memory high', {
            estimatedMB: estimatedMB.toFixed(2),
            threshold: MAX_MEMORY_MB,
        });
    }
}
```

---

## 5. Network Performance

### 5.1 HTTP Client Configuration

**Current timeouts:**

```javascript
// utils/plex-http-client.js, jellyfin-http-client.js
const DEFAULT_TIMEOUT = 10000; // 10 seconds
```

**Issues:**

- No connection pooling explicitly configured
- No keep-alive management
- Default axios/node-fetch settings

#### **ISSUE #24: Optimize HTTP Client Configuration**

**Recommendation:**

- **Priority:** LOW
- **Effort:** 3 hours
- **Action:** Configure connection pooling and keep-alive

```javascript
// utils/base-http-client.js (from Issue #16)
const http = require('http');
const https = require('https');

class BaseHttpClient {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;

        // Configure agents for connection pooling
        const agentOptions = {
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: 10,
            maxFreeSockets: 5,
            timeout: options.timeout || 10000,
        };

        this.httpAgent = new http.Agent(agentOptions);
        this.httpsAgent = new https.Agent(agentOptions);

        this.axios = axios.create({
            baseURL: baseUrl,
            timeout: options.timeout || 10000,
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent,
            headers: {
                'User-Agent': 'Posterrama/2.9.4', // Issue #7 resolved
                Connection: 'keep-alive',
            },
        });
    }

    cleanup() {
        this.httpAgent.destroy();
        this.httpsAgent.destroy();
    }
}
```

**Benefits:**

- Reduce connection overhead
- Better performance for repeated requests
- Lower latency for media fetching

---

## 6. Image Processing Performance

### 6.1 Current Implementation

**Sharp for image processing:**

```javascript
// Used in routes for image optimization
const sharp = require('sharp');

sharp(buffer).resize(width, height, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
```

**Observations:**

- Processing happens on-demand (good - no wasted work)
- Results cached on disk (good)
- No streaming (🔴 **Potential improvement**)

#### **ISSUE #25: Stream Image Processing**

**Current:** Load full image → process → send
**Optimized:** Stream processing (lower memory)

**Recommendation:**

- **Priority:** LOW
- **Effort:** 4 hours
- **Action:** Use streaming for large images

```javascript
// Example pattern
app.get('/image/:key', async (req, res) => {
    const imagePath = getImagePath(req.params.key);

    // Check cache first
    const cached = await cacheManager.get(`image:${req.params.key}`);
    if (cached) {
        return res.send(cached);
    }

    // Stream processing for large images
    const transform = sharp().resize(800, 600, { fit: 'cover' }).jpeg({ quality: 80 });

    // Pipe: file → sharp → response
    fs.createReadStream(imagePath).pipe(transform).pipe(res);
});
```

**Benefits:**

- Lower memory usage
- Faster time-to-first-byte
- Better handling of concurrent requests

---

## Summary: Performance Assessment

### Overall Rating: **8/10** ✅

**Strengths:**

- Multi-tier caching strategy
- Good memory management
- Cleanup intervals prevent leaks
- Lazy loading and optimization
- Reasonable default timeouts

**Improvement Opportunities:**

- Parallel source fetching (HIGH priority)
- Cache metrics and monitoring (MEDIUM)
- File locking for concurrent writes (MEDIUM)
- HTTP client optimization (LOW)
- Cluster mode support (LOW, future)

### Issues Identified This Part

| Issue # | Title                                  | Priority | Effort |
| ------- | -------------------------------------- | -------- | ------ |
| #19     | Add Cache Hit Ratio Monitoring         | MEDIUM   | 4h     |
| #20     | Parallel Playlist Source Fetching      | HIGH     | 3h     |
| #21     | Add File Locking for Concurrent Writes | MEDIUM   | 5h     |
| #22     | Add Cluster Mode Support               | LOW      | 12h    |
| #23     | Monitor Playlist Cache Memory Growth   | LOW      | 2h     |
| #24     | Optimize HTTP Client Configuration     | LOW      | 3h     |
| #25     | Stream Image Processing                | LOW      | 4h     |

**Total Effort:** ~33 hours across 7 issues

---

**Document:** Part 3 of 4  
**Previous:** [Part 2: Code Quality & Technical Debt](BACKEND-ANALYSIS-2025-11-15-PART2.md)  
**Next:** [Part 4: Improvement Roadmap](BACKEND-ANALYSIS-2025-11-15-PART4.md)
