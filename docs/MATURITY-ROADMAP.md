# Posterrama Maturity & Stability Roadmap

**Version**: 2.8.6  
**Date**: October 26, 2025  
**Status**: 91.24% test coverage, 1933 passing tests, 10 dependency vulnerabilities

---

## 🚨 CRITICAL PRIORITIES (Week 1-2)

### 1. Security Vulnerabilities [BLOCKER]

**Impact**: Production deployment blocked  
**Effort**: 4-8 hours

```bash
# Current state: 2 critical, 8 moderate CVEs
npm audit --json | jq '.vulnerabilities'

# Action items:
□ Upgrade/replace plex-api (2 critical CVEs in dependencies)
□ Update express-validator to >=7.2.1
□ Run: npm audit fix --force
□ Test all Plex functionality after upgrade
□ Document breaking changes if any
```

**Files to modify**:

- `package.json` - Update dependencies
- `sources/plex.js` - Test after upgrade
- `__tests__/sources/plex.*.test.js` - Verify tests pass

---

### 2. Monolithic File Refactoring [HIGH]

**Impact**: Maintainability, parallel development  
**Effort**: 60-80 hours

**Current state**:

- `server.js`: 19,810 lines (routes, middleware, init, cleanup)
- `public/admin.js`: 24,196 lines (UI, API, modals, forms)

**Phase 1: Split server.js** (40h)

```
server.js (19810 lines)
├── lib/init.js (300 lines) - Startup sequence
├── lib/middleware.js (200 lines) - Middleware setup
├── routes/
│   ├── devices.js (800 lines) - Device management
│   ├── admin.js (1000 lines) - Admin endpoints
│   ├── media.js (600 lines) - Media endpoints
│   ├── groups.js (400 lines) - Group management
│   ├── auth.js (500 lines) - Authentication
│   ├── config.js (400 lines) - Configuration
│   ├── health.js (200 lines) - Health checks
│   └── static.js (300 lines) - Static assets
└── server.js (500 lines) - Entry point only
```

**Checkpoint after Phase 1**:

```bash
npm test  # All 1933 tests must pass
npm start # Server must start normally
```

**Phase 2: Split admin.js** (40h)

```
public/admin.js (24196 lines)
├── admin/
│   ├── auth.js (1500 lines) - Login, 2FA, password
│   ├── devices.js (3000 lines) - Device management
│   ├── sources.js (4000 lines) - Plex, Jellyfin, TMDB config
│   ├── dashboard.js (2000 lines) - Overview, metrics
│   ├── modals.js (3000 lines) - All modal dialogs
│   ├── groups.js (1500 lines) - Group management
│   ├── settings.js (2500 lines) - App settings
│   ├── logs.js (1000 lines) - Log viewer
│   └── utils.js (1500 lines) - Shared utilities
└── admin.js (2000 lines) - Main coordinator
```

**Implementation checklist**:

- [ ] Create `routes/` directory
- [ ] Extract device routes to `routes/devices.js`
- [ ] Extract admin routes to `routes/admin.js`
- [ ] Extract media routes to `routes/media.js`
- [ ] Update `server.js` to use router modules
- [ ] Run full test suite after each extraction
- [ ] Create `public/admin/` directory
- [ ] Extract auth logic to `admin/auth.js`
- [ ] Extract device UI to `admin/devices.js`
- [ ] Test admin UI after each extraction

---

### 3. Increase Test Coverage 91% → 95% [MEDIUM]

**Impact**: Production confidence  
**Effort**: 16 hours

**Current gaps** (80.5% branch coverage):

```
Uncovered critical paths:
- errorHandler.js:72,111,132-137 (production error logging)
- metrics.js:421-448,459,525-535 (system resource failures)
- mqttBridge.js:463-553,615-624 (MQTT reconnection)
- wsHub.js:117,175-177,196 (WebSocket error handling)
- cache.js:211-214,301-302 (cache eviction edge cases)
```

**Action plan**:

```javascript
// Add tests for error paths
describe('Error handling edge cases', () => {
    test('errorHandler production mode logging', () => {
        /* ... */
    });
    test('metrics system resource unavailable', () => {
        /* ... */
    });
    test('MQTT reconnection failure cascade', () => {
        /* ... */
    });
    test('WebSocket unexpected disconnect', () => {
        /* ... */
    });
    test('Cache LRU eviction under memory pressure', () => {
        /* ... */
    });
});
```

**Files to create**:

- `__tests__/middleware/errorHandler.edge-cases.test.js`
- `__tests__/utils/metrics.system-failures.test.js`
- `__tests__/utils/mqttBridge.reconnection.test.js`
- `__tests__/utils/wsHub.edge-cases.test.js`
- `__tests__/utils/cache.eviction.test.js`

---

## 🔧 HIGH PRIORITY (Week 3-4)

### 4. Performance Optimizations

#### 4a. Async Asset Versioning

**Current**: `fs.statSync()` blocks event loop  
**Fix**: Use `fs.promises.stat()` with cache

```javascript
// server.js:50-96
async function generateAssetVersion(filePath) {
    try {
        const fullPath = path.join(__dirname, 'public', filePath);
        const stats = await fs.promises.stat(fullPath);
        return Math.floor(stats.mtime.getTime() / 1000).toString(36);
    } catch (error) {
        return Math.floor(Date.now() / 1000).toString(36);
    }
}
```

#### 4b. LRU Cache Implementation

**Current**: Unbounded memory cache  
**Fix**: Add maxSize with LRU eviction

```javascript
// utils/cache.js - Add LRU
class CacheManager {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 1000; // 1000 entries max
        this.accessOrder = new Map(); // Track access order
        // ... existing code
    }

    set(key, value, ttl) {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.accessOrder.keys().next().value;
            this.cache.delete(oldestKey);
            this.accessOrder.delete(oldestKey);
        }
        // ... rest of set logic
    }
}
```

#### 4c. Redis Session Store

**Current**: File-based sessions (slow, doesn't scale)  
**Fix**: Redis for sessions

```bash
npm install connect-redis redis
```

```javascript
// server.js session config
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect();

app.use(
    session({
        store: new RedisStore({ client: redisClient }),
        // ... rest of config
    })
);
```

---

### 5. Security Hardening

#### 5a. Rate Limiting on Auth Endpoints

```javascript
// middleware/rateLimiter.js - Add auth-specific limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: 'Too many login attempts, try again later',
});

// server.js
app.post('/api/login', authLimiter, loginHandler);
app.post('/api/2fa/verify', authLimiter, verify2FAHandler);
```

#### 5b. CSRF Protection

```bash
npm install csurf
```

```javascript
// server.js
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

// Apply to state-changing routes
app.post('/api/admin/*', csrfProtection, adminRoutes);
app.put('/api/devices/*', csrfProtection, deviceRoutes);
```

#### 5c. Content Security Policy

```javascript
// server.js
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; " +
            "connect-src 'self' ws: wss:;"
    );
    next();
});
```

---

## 📋 MEDIUM PRIORITY (Month 2)

### 6. DEVELOPMENT.md Feature Implementation

Priority order based on impact:

#### 6a. Mobile Optimization [16h]

**Status**: Partially done  
**Remaining**:

- [ ] Test all admin sections on mobile (320px - 768px)
- [ ] Fix modal overflow on small screens
- [ ] Add touch-friendly controls (48px min tap target)
- [ ] Test on real devices (iOS Safari, Android Chrome)

**Files**: `public/admin.css`, `public/admin.html`

#### 6b. Device Presets Template [2h]

```javascript
// server.js startup
const presetsPath = path.join(__dirname, 'device-presets.json');
const presetsExamplePath = path.join(__dirname, 'config/device-presets.example.json');

if (!fs.existsSync(presetsPath) && fs.existsSync(presetsExamplePath)) {
    fs.copyFileSync(presetsExamplePath, presetsPath);
    logger.info('Created device-presets.json from example');
}
```

#### 6c. MQTT Complete Testing [16h]

- [ ] E2E tests for all 30+ MQTT settings
- [ ] Broadcast commands via MQTT
- [ ] Group control integration
- [ ] Server metrics sensors
- [ ] Event notifications

**File**: `__tests__/utils/mqttBridge.complete.e2e.test.js`

#### 6d. Time Schedules [24h]

```javascript
// New file: utils/scheduler.js
class Scheduler {
    constructor() {
        this.schedules = [];
        this.timers = new Map();
    }

    addSchedule(deviceId, schedule) {
        // schedule: { time: '22:00', action: 'power.off', days: [0,1,2,3,4,5,6] }
    }

    start() {
        // Check every minute for scheduled actions
    }
}
```

**UI**: New "Schedules" tab in admin

---

### 7. New Media Sources

#### 7a. Emby Integration [16h]

```javascript
// sources/emby.js
class EmbySource {
    constructor(
        serverConfig,
        getClient,
        processItem,
        getLibraries,
        shuffleArray,
        rtMinScore,
        isDebug
    ) {
        this.serverConfig = serverConfig;
        // ... similar to jellyfin.js
    }

    async fetchMedia(libraryNames, type, count) {
        // Use Emby API (very similar to Jellyfin)
    }
}
```

**Files to create**:

- `sources/emby.js`
- `utils/emby-http-client.js`
- `__tests__/sources/emby.test.js`

#### 7b. Radarr/Sonarr Integration [20h]

```javascript
// sources/arr.js
class ArrSource {
    async fetchMedia(libraryNames, type, count) {
        // Fetch from Radarr/Sonarr API
        // Map to standard media format
    }
}
```

---

## 🔄 CONTINUOUS IMPROVEMENTS

### 8. Code Quality Automation

#### 8a. Pre-commit Hooks

```json
// package.json
{
    "husky": {
        "hooks": {
            "pre-commit": "npm run lint && npm run format:check",
            "pre-push": "npm test"
        }
    }
}
```

#### 8b. File Size Limits

```javascript
// .eslintrc.js
module.exports = {
    rules: {
        'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
        'max-lines-per-function': ['warn', { max: 50 }],
    },
};
```

#### 8c. Dependency Updates

```bash
# Monthly schedule
npm outdated
npm update --save
npm audit fix
npm test
```

---

## 📊 SUCCESS METRICS

### Before Refactoring

- **Test Coverage**: 91.24% statements, 80.5% branches
- **Vulnerabilities**: 2 critical, 8 moderate
- **Largest File**: 19,810 lines (server.js)
- **Test Duration**: 100s
- **Maintainability**: Low (monolithic structure)

### After Phase 1 (Critical Priorities)

- **Test Coverage**: 95%+ statements, 85%+ branches
- **Vulnerabilities**: 0 critical, 0 high
- **Largest File**: <500 lines
- **Test Duration**: <60s (parallel execution)
- **Maintainability**: High (modular structure)

### After Phase 2 (All Priorities)

- **Test Coverage**: 95%+ with E2E tests
- **Performance**: <100ms avg response time
- **Security**: A+ rating (SSL Labs equivalent)
- **Features**: All DEVELOPMENT.md items implemented
- **Documentation**: Complete API docs, deployment guide

---

## 📅 TIMELINE ESTIMATE

| Phase               | Duration   | Deliverable                         |
| ------------------- | ---------- | ----------------------------------- |
| **Critical**        | 2 weeks    | Production-ready, secure, testable  |
| **High Priority**   | 2 weeks    | Performant, hardened                |
| **Medium Priority** | 4 weeks    | Feature-complete per DEVELOPMENT.md |
| **Continuous**      | Ongoing    | Maintained, up-to-date              |
| **TOTAL**           | 8-10 weeks | Mature, stable, scalable platform   |

---

## 🚀 QUICK START

**Week 1 Actions**:

```bash
# Day 1: Security
npm audit
npm audit fix --force
npm test  # Verify nothing broke

# Day 2-3: Start refactoring
mkdir -p routes lib
git checkout -b refactor/modularize-server

# Day 4-5: Tests
npm test -- --coverage
# Write tests for uncovered branches

# Week 2: Continue modularization
# Extract one route file per day
# Test after each extraction
```

**Quick Wins** (< 4 hours each):

1. ✅ Fix dependency vulnerabilities
2. ✅ Add rate limiting to auth endpoints
3. ✅ Implement CSP headers
4. ✅ Add device-presets.json template
5. ✅ Async asset versioning
6. ✅ File size linting rules

---

## 📝 NOTES

- **Backward Compatibility**: All refactoring maintains API compatibility
- **Zero Downtime**: Rolling updates supported via PM2
- **Testing**: Test suite must pass after each change
- **Documentation**: Update docs/ as features are implemented
- **Git Strategy**: Feature branches, PR reviews, squash merges

**Questions? Issues?**  
Create issue at: https://github.com/Posterrama/posterrama/issues
