# Issues from Backend Analysis (November 15, 2025)

This document contains all improvement opportunities identified in the comprehensive backend analysis. Create these issues in Gitea to track implementation.

**Analysis Documents:** BACKEND-ANALYSIS-2025-11-15-\*.md (can be archived after issues are created)

---

## Issue #81: API Versioning Implementation

**Labels:** enhancement, api, documentation  
**Milestone:** Sprint 4  
**Priority:** MEDIUM  
**Estimated Effort:** 10-12 hours

### Problem

Current API has no versioning, making breaking changes difficult to manage and deprecation complicated.

### Proposed Solution

Implement versioned API endpoints with deprecation strategy:

- `/api/v1/*` (current endpoints)
- `/api/v2/*` (future breaking changes)
- `/api/latest/*` (alias to current version)

### Implementation Steps

#### 1. Version Routing (4 hours)

```javascript
// routes/api-versioning.js (new)
const express = require('express');
const v1Routes = require('./api-v1');
const v2Routes = require('./api-v2');

const router = express.Router();

router.use('/v1', v1Routes);
router.use('/v2', v2Routes);
router.use('/latest', v1Routes); // Alias to current

module.exports = router;
```

#### 2. Deprecation Strategy (2 hours)

```javascript
// middleware/api-deprecation.js (new)
const deprecate = (version, message) => {
    return (req, res, next) => {
        res.set('Warning', `299 - "API ${version} is deprecated. ${message}"`);
        logger.warn('Deprecated API usage', {
            version,
            endpoint: req.path,
            ip: req.ip,
        });
        next();
    };
};

module.exports = deprecate;
```

#### 3. Documentation Update (2 hours)

- Update Swagger to show version paths
- Document versioning policy
- Add deprecation timeline

#### 4. Migration Plan (2 hours)

- Move current routes to /api/v1
- Update client applications
- Set 6-month deprecation timeline

### Impact

- ✅ Backward compatibility maintained
- ✅ Easier API evolution
- ✅ Better client communication
- ✅ Reduced breaking change risk

### Dependencies

None

### References

- API-PRODUCTION-READINESS.md
- BACKEND-ANALYSIS-2025-11-15-PART4.md

---

## Issue #82: Encrypt 2FA Secrets at Rest

**Labels:** security, enhancement  
**Milestone:** Sprint 4  
**Priority:** MEDIUM  
**Estimated Effort:** 7-8 hours

### Problem

2FA secrets currently stored base32-encoded but not encrypted at rest. Potential security risk if config.json is compromised.

### Proposed Solution

Implement AES-256-GCM encryption for 2FA secrets using key derivation from environment variable.

### Implementation Steps

#### 1. Encryption Service (3 hours)

```javascript
// lib/encryption.js (new)
const crypto = require('crypto');

class EncryptionService {
    constructor(masterKey) {
        this.algorithm = 'aes-256-gcm';
        this.key = crypto.scryptSync(masterKey, 'salt', 32);
    }

    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
        };
    }

    decrypt(encrypted, iv, authTag) {
        const decipher = crypto.createDecipheriv(this.algorithm, this.key, Buffer.from(iv, 'hex'));

        decipher.setAuthTag(Buffer.from(authTag, 'hex'));

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}

module.exports = EncryptionService;
```

#### 2. Migration Script (2 hours)

```javascript
// scripts/migrate-2fa-secrets.js
const config = require('./config.json');
const encryption = new EncryptionService(process.env.ENCRYPTION_KEY);

config.users.forEach(user => {
    if (user.tfa_secret) {
        const encrypted = encryption.encrypt(user.tfa_secret);
        user.tfa_secret_encrypted = encrypted;
        delete user.tfa_secret; // Remove plaintext
    }
});

fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
```

#### 3. Update Auth Routes (1 hour)

```javascript
// routes/auth.js
const encryption = new EncryptionService(process.env.ENCRYPTION_KEY);

// Decrypt for verification
const secret = encryption.decrypt(
    user.tfa_secret_encrypted.encrypted,
    user.tfa_secret_encrypted.iv,
    user.tfa_secret_encrypted.authTag
);

const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: req.body.code,
});
```

#### 4. Documentation (1 hour)

- Update setup guide
- Document ENCRYPTION_KEY requirement
- Add to environment variable validation

### Impact

- ✅ Enhanced security (defense in depth)
- ✅ Compliance with best practices
- ✅ Protection against config.json compromise

### Dependencies

- ENCRYPTION_KEY environment variable (32+ bytes recommended)
- One-time migration of existing secrets

### References

- BACKEND-ANALYSIS-2025-11-15-PART3.md (Security Analysis)

---

## Issue #83: Extract WebSocket Server Setup

**Labels:** refactoring, code-quality  
**Milestone:** Sprint 5  
**Priority:** LOW  
**Estimated Effort:** 4-6 hours

### Problem

WebSocket logic currently in server.js (~600 lines), reducing clarity of server orchestration.

### Proposed Solution

Extract to dedicated module `lib/websocket-server.js` for better separation of concerns.

### Implementation

```javascript
// lib/websocket-server.js (new)
const WebSocket = require('ws');
const { wsHub } = require('../utils/wsHub');

function createWebSocketServer(server, dependencies) {
    const { logger, deviceStore } = dependencies;

    const wss = new WebSocket.Server({
        server,
        path: '/ws/devices',
    });

    wss.on('connection', (ws, req) => {
        const deviceId = new URL(req.url, 'http://localhost').searchParams.get('deviceId');

        if (!deviceId) {
            ws.close(1008, 'Device ID required');
            return;
        }

        // Register with hub
        wsHub.registerDevice(deviceId, ws);

        // Handle messages
        ws.on('message', async data => {
            // ... message handling logic
        });

        // Handle disconnect
        ws.on('close', () => {
            wsHub.unregisterDevice(deviceId);
        });
    });

    return wss;
}

module.exports = { createWebSocketServer };
```

**Usage in server.js:**

```javascript
const { createWebSocketServer } = require('./lib/websocket-server');

const wss = createWebSocketServer(server, {
    logger,
    deviceStore,
});
```

### Impact

- ✅ Reduced server.js size (~600 lines)
- ✅ Improved testability
- ✅ Better separation of concerns

### Dependencies

None

### References

- BACKEND-ANALYSIS-2025-11-15-PART2.md (Code Quality)
- BACKEND-ANALYSIS-2025-11-15-PART4.md (Recommendations)

---

## Issue #84: Extract Helper Functions from server.js

**Labels:** refactoring, code-quality  
**Milestone:** Sprint 5  
**Priority:** LOW  
**Estimated Effort:** 6-8 hours

### Problem

server.js contains ~1,200 lines of helper functions that could be moved to appropriate lib/ modules.

### Proposed Solution

Systematically extract helper functions to focused modules:

- Media transformation helpers → `lib/media-helpers.js`
- Configuration helpers → `lib/config-helpers.js`
- Utility functions → appropriate utils/ files

### Implementation Steps

1. **Identify helper categories** (1 hour)
    - Group related functions
    - Determine target modules
    - Check for dependencies

2. **Create target modules** (2 hours)
    - Create new files in lib/
    - Add JSDoc documentation
    - Implement tests

3. **Extract functions** (2 hours)
    - Move functions to new modules
    - Update imports in server.js
    - Maintain backward compatibility

4. **Testing & validation** (2 hours)
    - Run full test suite
    - Verify no regressions
    - Update documentation

### Impact

- ✅ Cleaner server.js (~1,200 lines reduction)
- ✅ Better code organization
- ✅ Improved reusability
- ✅ Easier testing

### Risk

LOW - Pure functions are easy to extract

### Dependencies

None

### References

- BACKEND-ANALYSIS-2025-11-15-PART2.md (Large File Analysis)

---

## Issue #85: Split Cache Module (Optional)

**Labels:** refactoring, code-quality, optional  
**Milestone:** Future  
**Priority:** LOW  
**Estimated Effort:** 4-6 hours

### Problem

utils/cache.js is large (2,143 lines) but cohesive. Only split if adding significant new features.

### Proposed Solution

Split into focused submodules:

- `utils/cache/memory.js` - Memory cache implementation
- `utils/cache/disk.js` - Disk cache operations
- `utils/cache/http.js` - HTTP header caching
- `utils/cache/metrics.js` - Metrics & monitoring

### When to Implement

**Only consider if:**

- Adding new caching tiers
- Implementing distributed cache
- Adding complex cache policies
- Cache module becomes difficult to maintain

### Current Assessment

**Not recommended yet:**

- ✅ File is large but cohesive
- ✅ Single responsibility (caching)
- ✅ Excellent test coverage (97%)
- ⚠️ Splitting might reduce cohesion
- ⚠️ Would increase complexity

### Impact

- ✅ Smaller, focused files
- ⚠️ Might reduce cohesion
- ⚠️ Increased import complexity

### Risk

MEDIUM - Complex module, splitting might reduce clarity

### References

- BACKEND-ANALYSIS-2025-11-15-PART2.md (Code Complexity Analysis)

---

## Issue #86: Performance Monitoring Dashboard

**Labels:** enhancement, monitoring, observability  
**Milestone:** Sprint 8  
**Priority:** LOW  
**Estimated Effort:** 8-12 hours (built-in) or 16-20 hours (Prometheus)

### Problem

Metrics collected but not visualized. No real-time performance monitoring. Difficult to identify trends.

### Proposed Solution

#### Option 1: Built-in Dashboard (Recommended)

```javascript
// routes/admin-metrics.js (new)
router.get('/metrics/dashboard', adminAuth, async (req, res) => {
    const metrics = {
        requestLatency: metricsCollector.getLatencyStats(),
        cachePerformance: cache.getMetrics(),
        websocketStats: wsHub.getStats(),
        mediaSourceHealth: await checkMediaSources(),
    };
    res.render('admin/metrics-dashboard', { metrics });
});
```

**Features:**

- Request latency (P50, P95, P99)
- Cache performance (hit rate, memory usage)
- WebSocket connections (active devices, avg latency)
- Media source health (Plex, Jellyfin, TMDB status)

#### Option 2: External Monitoring (Prometheus + Grafana)

```javascript
// lib/prometheus-exporter.js (new)
const promClient = require('prom-client');

const register = new promClient.Registry();

const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [10, 50, 100, 200, 500, 1000, 2000],
});

register.registerMetric(httpRequestDuration);

// Expose metrics endpoint
router.get('/metrics', (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(register.metrics());
});
```

### Impact

- ✅ Real-time visibility
- ✅ Trend identification
- ✅ Proactive issue detection
- ✅ Performance optimization insights

### Dependencies

- **Built-in:** None (just frontend work)
- **External:** Prometheus + Grafana setup

### References

- BACKEND-ANALYSIS-2025-11-15-PART4.md (Performance Monitoring)

---

## Issue #87: CDN Integration for Static Assets

**Labels:** enhancement, performance, infrastructure  
**Milestone:** Sprint 9  
**Priority:** LOW  
**Estimated Effort:** 4-8 hours

### Problem

Server serves all static assets (images, CSS, JS), increasing load and latency for global users.

### Proposed Solution

Integrate CDN (CloudFlare, AWS CloudFront, or similar) for static asset delivery.

### Implementation Steps

#### 1. CDN Configuration (2 hours)

- Set up CDN service
- Configure origin server
- Set cache rules (1 year for immutable assets)
- Configure SSL/TLS

#### 2. Asset URL Rewriting (2 hours)

```javascript
// lib/cdn-helper.js (new)
const CDN_URL = process.env.CDN_URL || '';

function getCDNUrl(assetPath) {
    if (!CDN_URL) return assetPath;
    return `${CDN_URL}${assetPath}`;
}

module.exports = { getCDNUrl };
```

#### 3. Update Templates (2 hours)

- Update HTML templates to use CDN URLs
- Update CSS/JS references
- Update image URLs

#### 4. Testing (2 hours)

- Verify all assets load correctly
- Test cache headers
- Verify HTTPS works
- Load testing

### Impact

- ✅ Reduced server load (offload image serving)
- ✅ Improved global latency (edge caching)
- ✅ Better scalability
- ✅ Reduced bandwidth costs

### Dependencies

- CDN service account
- DNS configuration
- SSL certificate

### References

- BACKEND-ANALYSIS-2025-11-15-PART4.md (Performance Optimization)

---

## Issue #88: Security Headers Audit

**Labels:** security, enhancement  
**Milestone:** Sprint 4  
**Priority:** LOW  
**Estimated Effort:** 2-4 hours

### Problem

Current security headers are good but could be tightened, especially CSP 'unsafe-inline' directives.

### Proposed Solution

Audit and improve security headers:

#### 1. Content Security Policy Review (2 hours)

**Current CSP (needs improvement):**

```javascript
contentSecurityPolicy: {
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],  // ⚠️ Tighten this
        styleSrc: ["'self'", "'unsafe-inline'"],   // ⚠️ Tighten this
        imgSrc: ["'self'", 'data:', 'https:'],
    },
}
```

**Proposed improvements:**

```javascript
contentSecurityPolicy: {
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'nonce-{random}'"],  // Use nonces instead
        styleSrc: ["'self'", "'nonce-{random}'"],   // Use nonces instead
        imgSrc: ["'self'", 'data:', 'https://trusted-cdn.com'],  // Specific domains
        connectSrc: ["'self'", 'wss://posterrama.app'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
    },
}
```

#### 2. Add Permissions-Policy Header (1 hour)

```javascript
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    next();
});
```

#### 3. Testing (1 hour)

- Test with securityheaders.com
- Verify all functionality works
- Document any required exceptions

### Impact

- ✅ Reduced XSS attack surface
- ✅ Better defense in depth
- ✅ Compliance with security best practices

### Dependencies

None (might require template updates for nonces)

### References

- BACKEND-ANALYSIS-2025-11-15-PART3.md (Security Analysis)

---

## Issue #89: Database Migration (Future Consideration)

**Labels:** enhancement, scalability, future  
**Milestone:** 2026+  
**Priority:** FUTURE  
**Estimated Effort:** 40-60 hours

### Problem

File-based storage limits scalability for very large deployments (100+ concurrent devices).

### When to Consider

**Only migrate if:**

- ✅ Cluster mode implemented (Issue #80)
- ✅ 100+ concurrent devices needed
- ✅ Complex query requirements emerge
- ✅ Multi-tenant deployment needed

### Current Assessment

**Not recommended yet:**

- ✅ Current file-based solution works well
- ✅ Simple, reliable, easy to backup
- ✅ Adequate for current scale
- ⚠️ Database adds complexity
- ⚠️ Additional infrastructure required

### Proposed Solution (when needed)

Migrate to PostgreSQL or SQLite:

- Keep config.json for basic settings
- Use database for:
    - Device states
    - Sessions
    - Media library cache
    - User preferences

### Impact

**Benefits:**

- ✅ Better scalability
- ✅ ACID transactions
- ✅ Efficient queries
- ✅ Better concurrency

**Drawbacks:**

- ⚠️ Increased complexity
- ⚠️ Additional infrastructure
- ⚠️ More dependencies
- ⚠️ Higher operational overhead

### Dependencies

- Cluster mode (Issue #80)
- Database server setup
- Migration tooling
- ORM selection (optional)

### References

- BACKEND-ANALYSIS-2025-11-15-PART4.md (Future Considerations)

---

## Issue #90: Shared Transformation Logic Extraction

**Labels:** refactoring, code-quality, optional  
**Milestone:** Future  
**Priority:** LOW  
**Estimated Effort:** 8-12 hours

### Problem

Similar transformation patterns in `lib/plex-helpers.js` and `lib/jellyfin-helpers.js` for image URLs and metadata normalization.

### When to Consider

**Only extract if:**

- Adding more media sources (TMDB has different patterns)
- Duplication becomes maintenance burden
- Common bugs found in both implementations

### Current Assessment

**Not recommended yet:**

- ✅ Current code is clear and maintainable
- ✅ Excellent test coverage
- ⚠️ Abstraction would be complex due to API differences
- ⚠️ Might reduce clarity
- ⚠️ Only 2 sources currently

### Proposed Solution (if needed)

Extract common transformation logic:

```javascript
// lib/media-transformer.js (new)
class MediaTransformer {
    normalizeMetadata(sourceType, rawData) {
        // Common transformation logic
        return {
            id: this.extractId(sourceType, rawData),
            title: this.extractTitle(sourceType, rawData),
            year: this.extractYear(sourceType, rawData),
            rating: this.normalizeRating(sourceType, rawData),
            genres: this.extractGenres(sourceType, rawData),
            poster: this.buildPosterUrl(sourceType, rawData),
            backdrop: this.buildBackdropUrl(sourceType, rawData),
        };
    }
}
```

### Impact

**Benefits:**

- ✅ Reduced duplication
- ✅ Consistent transformation logic
- ✅ Single place for fixes

**Drawbacks:**

- ⚠️ Increased abstraction
- ⚠️ Might reduce clarity
- ⚠️ More complex to maintain

### Risk

MEDIUM - Complex abstraction might reduce clarity

### References

- BACKEND-ANALYSIS-2025-11-15-PART2.md (Code Duplication Analysis)

---

## Sprint Planning Recommendations

### Q2 2025 - Sprint 4: Security & API Foundation (44 hours)

**High Priority:**

- Issue #80: Cluster Mode Implementation (36 hours) - Already created
- Issue #82: Encrypt 2FA Secrets at Rest (8 hours)

**Total:** 44 hours (~5-6 days)

---

### Q2 2025 - Sprint 5: API & Code Quality (26 hours)

**Medium Priority:**

- Issue #81: API Versioning Implementation (12 hours)
- Issue #88: Security Headers Audit (4 hours)
- Issue #83: Extract WebSocket Server Setup (6 hours)
- Issue #84: Extract Helper Functions from server.js (8 hours) - Start only

**Total:** 30 hours (~4 days)

---

### Q3 2025 - Sprint 6-7: Feature Development

Focus on user-facing features based on feedback.

---

### Q4 2025 - Sprint 8-9: Observability & Optimization (20-32 hours)

**Low Priority:**

- Issue #86: Performance Monitoring Dashboard (12 hours)
- Issue #87: CDN Integration (8 hours)
- Issue #84: Extract Helper Functions - Complete (remaining hours)

**Optional:**

- Issue #85: Split Cache Module (evaluate need first)
- Issue #90: Shared Transformation Logic (evaluate need first)

---

### Future (2026+)

**Consider only if needed:**

- Issue #89: Database Migration (40-60 hours)

---

## Action Items

1. ✅ Create all issues in Gitea (copy from this document)
2. ✅ Assign to appropriate milestones (Sprint 4, 5, 8, Future)
3. ✅ Add labels (enhancement, security, refactoring, etc.)
4. ✅ Link to analysis documents
5. ✅ Archive analysis documents after issues created:
    - Move to `docs/archive/backend-analysis-2025-11-15/`
    - Update references in other docs
6. ✅ Plan Sprint 4 kickoff

---

## Summary

**Total Issues Created:** 10

**Priority Breakdown:**

- HIGH: 1 (Issue #80 - already created)
- MEDIUM: 2 (Issues #81, #82)
- LOW: 5 (Issues #83, #84, #86, #87, #88)
- FUTURE/OPTIONAL: 2 (Issues #85, #89, #90)

**Estimated Total Effort:** ~90-120 hours (spread across multiple sprints)

**Immediate Focus:** Sprint 4 (Q2 2025) - Cluster Mode + Encrypt 2FA Secrets

---

**Analysis Documents to Archive:**

- BACKEND-ANALYSIS-2025-11-15-README.md
- BACKEND-ANALYSIS-2025-11-15-PART1.md
- BACKEND-ANALYSIS-2025-11-15-PART2.md
- BACKEND-ANALYSIS-2025-11-15-PART3.md
- BACKEND-ANALYSIS-2025-11-15-PART4.md

**Keep for Reference:**

- ARCHITECTURE-DIAGRAMS.md
- DEPENDENCY-GRAPH.md
- MODULE-ARCHITECTURE.md
- API-PRODUCTION-READINESS.md
