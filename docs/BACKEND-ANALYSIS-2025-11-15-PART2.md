# Backend Code Analysis - Part 2: Code Quality & Technical Debt

**Date:** November 15, 2025  
**Version:** 2.9.4  
**Previous:** [Part 1: Overview & Architecture](BACKEND-ANALYSIS-2025-11-15-PART1.md)

---

## 1. Code Quality Deep Dive

### 1.1 Technical Debt Markers Analysis

Found **50+ TODO/FIXME/HACK markers** across the codebase. Analysis by category:

#### **Debug Code (High Frequency - ~30 occurrences)**

**Pattern:** Extensive isDebug checks throughout routes

```javascript
// routes/frontend-pages.js, admin-libraries.js, etc.
const isDebug = process.env.ENABLE_DEBUG_VIEWER === 'true';
if (isDebug) logger.debug('[Viewer] Debug info...');
```

**Impact:**

- ✅ **Good:** Helps with development/troubleshooting
- ⚠️ **Concern:** Scattered across many files
- ⚠️ **Risk:** Debug code paths not covered by tests

**Recommendation - ISSUE #11: Debug Code Consolidation**

- **Priority:** LOW
- **Effort:** 2 hours
- **Action:** Create centralized debug utility module

```javascript
// utils/debug-logger.js
module.exports = {
    debugViewer: (msg, data) => {
        if (process.env.ENABLE_DEBUG_VIEWER === 'true') {
            logger.debug('[Viewer]', msg, data);
        }
    },
    // Other debug categories...
};
```

#### **Comment Markers (~15-20 occurrences)**

Examples found:

```javascript
// TODO: Add caching here
// FIXME: Handle edge case for null values
// HACK: Temporary workaround for upstream bug
```

**Assessment:** Need to review each marker individually for:

- Actual technical debt vs. completed work
- Priority and impact
- Whether still relevant

**Recommendation - ISSUE #12: Technical Debt Marker Audit**

- **Priority:** LOW
- **Effort:** 3 hours
- **Action:**
    1. Categorize all markers (done/active/invalid)
    2. Create GitHub issues for active items
    3. Remove obsolete markers
    4. Document decision for each

---

## 2. Code Complexity Analysis

### 2.1 Large Files (>1000 lines)

| File                        | Lines  | Functions | Complexity | Status                |
| --------------------------- | ------ | --------- | ---------- | --------------------- |
| `server.js`                 | 7,328  | ~20       | High       | ⚠️ Consider splitting |
| `routes/local-directory.js` | ~1,500 | ~15       | Medium     | ⚠️ Monitor            |
| `utils/cache.js`            | ~700   | ~25       | Medium     | ✅ Acceptable         |
| `lib/plex-helpers.js`       | ~800   | ~15       | Medium     | ✅ Acceptable         |
| `lib/jellyfin-helpers.js`   | ~600   | ~12       | Medium     | ✅ Acceptable         |

#### **ISSUE #13: Refactor Large Route Handlers**

**Problem:** Several inline route handlers in `server.js` exceed 100 lines

**Example - Device Presets Endpoint (lines ~2339-2400):**

```javascript
app.get('/api/admin/device-presets', adminAuth, async (req, res) => {
    // 60+ lines of business logic
    // Should be in routes/admin-device-presets.js
});
```

**Impact:**

- Testing complexity (need to test via HTTP)
- Code reusability (logic locked in route)
- Maintainability (hard to find specific logic)

**Recommendation:**

- **Priority:** MEDIUM
- **Effort:** 6 hours
- **Action:**
    1. Extract to `routes/admin-device-presets.js`
    2. Move business logic to `lib/preset-helpers.js`
    3. Add unit tests for extracted logic
    4. Verify integration tests still pass

**Files to Refactor:**

1. `/api/admin/device-presets` (GET/POST) - 100+ lines
2. `/api/admin/plex/music-*` endpoints - 60-80 lines each
3. Playlist refresh logic - 80+ lines

---

### 2.2 Function Complexity

#### **Moderate Complexity Functions** (worth reviewing)

1. **routes/local-directory.js - Media filtering logic**
    - Multiple nested conditions
    - Year range parsing
    - Genre matching
    - Resolution filtering
    - **Recommendation:** Extract filter builders to separate module

2. **lib/playlist-cache.js - refreshPlaylistCache()**
    - ~100 lines
    - Multiple async operations
    - Memory tracking
    - Error handling
    - **Status:** ✅ Acceptable (well-structured, well-tested)

3. **utils/cache.js - CacheManager class**
    - 25+ methods
    - Complex TTL management
    - LRU eviction
    - Persistence logic
    - **Status:** ✅ Acceptable (cohesive, single responsibility)

---

## 3. Error Handling Patterns

### 3.1 Current State ✅

**Excellent centralized error handling:**

```javascript
// middleware/errorHandler.js
class AppError extends Error {
    constructor(message, statusCode = 500, context = {}) {
        super(message);
        this.statusCode = statusCode;
        this.context = context;
        this.isOperational = true;
    }
}

function errorHandler(err, req, res, next) {
    // Comprehensive error response with context
    // Request ID tracking
    // Environment-specific details
    // Proper HTTP status codes
}
```

**Async error handling:**

```javascript
// middleware/asyncHandler.js
module.exports = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
```

### 3.2 Edge Cases to Address

#### **ISSUE #14: Improve Error Context in Source Adapters**

**Current:** Some source adapters swallow errors without context

```javascript
// sources/jellyfin.js (example pattern)
try {
    const items = await client.getItems(params);
    return items;
} catch (error) {
    logger.error('Jellyfin fetch failed', error.message);
    return []; // Lost error context!
}
```

**Problem:**

- Error details lost for troubleshooting
- No way to distinguish error types
- Metrics don't capture failure modes

**Recommendation:**

- **Priority:** LOW
- **Effort:** 4 hours
- **Action:**

```javascript
// Improved pattern
try {
    const items = await client.getItems(params);
    return items;
} catch (error) {
    logger.error('Jellyfin fetch failed', {
        source: 'jellyfin',
        library: params.libraryId,
        error: error.message,
        stack: error.stack,
        endpoint: client.baseUrl,
    });

    // Throw AppError for proper handling upstream
    throw new AppError('Failed to fetch media from Jellyfin', 500, {
        source: 'jellyfin',
        originalError: error.message,
    });
}
```

---

## 4. Input Validation Coverage

### 4.1 Current Coverage ✅

**Excellent validation infrastructure:**

1. **Joi Schemas** for complex objects

    ```javascript
    // middleware/validate.js
    const mediaKeyParamSchema = Joi.object({
        key: Joi.string()
            .pattern(/^[a-zA-Z0-9\-_]+$/)
            .max(100)
            .required(),
    });
    ```

2. **express-validator** for routes

    ```javascript
    // middleware/validation.js
    validationRules: {
        adminAuth: [
            body('username')
                .isLength({ min: 1, max: 50 })
                .matches(/^[a-zA-Z0-9_-]+$/),
            body('password').isLength({ min: 8, max: 200 }),
        ];
    }
    ```

3. **Sanitization** with DOMPurify
    ```javascript
    function sanitizeInput(obj) {
        if (typeof obj === 'string') {
            let sanitized = getPurify().sanitize(obj);
            // Additional XSS protection
            sanitized = sanitized.replace(/^javascript:/i, '');
            // ...
        }
    }
    ```

### 4.2 Gap Analysis

#### **ISSUE #15: Uncovered Sanitization Paths** ✅ RESOLVED

**Resolution:** Added 60 comprehensive XSS attack vector tests (Commit: 4a50ed5)

- File: `__tests__/middleware/validate.xss.test.js`
- Coverage: OWASP attack patterns, nested structures, real-world scenarios
- Tests: script tags, javascript: protocol, data URIs, event handlers
- Result: All 60 tests passing, improved security confidence

**Original Finding:** Coverage report shows `sanitizeInput()` string paths not tested

```html
<!-- coverage/validate.js.html -->
<span class="cstat-no">sanitized = sanitized.replace(/^javascript:/i, '');</span>
<span class="cstat-no">sanitized = sanitized.replace(/^data:.*?script/i, '');</span>
<span class="cstat-no">if (sanitized.match(/...script.../i)) return '';</span>
```

**Why Not Covered:**

- Most tests use plain text or JSON
- XSS attack vectors not explicitly tested
- Edge cases for script injection not covered

**Recommendation:**

- **Priority:** MEDIUM (security-related)
- **Effort:** 3 hours
- **Action:** Add XSS attack vector tests

```javascript
// __tests__/middleware/validate.xss.test.js
describe('XSS Protection', () => {
    const attacks = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        'data:text/html,<script>alert("XSS")</script>',
        '<img src=x onerror="alert(1)">',
        // etc.
    ];

    attacks.forEach(attack => {
        test(`should sanitize: ${attack}`, () => {
            const result = sanitizeInput(attack);
            expect(result).not.toContain('script');
            expect(result).not.toContain('javascript:');
        });
    });
});
```

---

## 5. Code Duplication Analysis

### 5.1 HTTP Client Patterns

**Good:** Dedicated HTTP clients for each service

```
utils/
├── plex-http-client.js
├── jellyfin-http-client.js
└── romm-http-client.js
```

**Observation:** Some duplication in:

- Request timeout handling
- Error retry logic
- Response validation
- Debug logging

#### **ISSUE #16: Extract Common HTTP Client Base**

**Recommendation:**

- **Priority:** LOW
- **Effort:** 4 hours
- **Action:** Create base HTTP client class

```javascript
// utils/base-http-client.js
class BaseHttpClient {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl;
        this.timeout = options.timeout || 10000;
        this.retries = options.retries || 3;
        this.debug = options.debug || false;
    }

    async request(method, path, options = {}) {
        // Common retry logic
        // Common timeout handling
        // Common error wrapping
        // Common debug logging
    }

    async get(path, options) {
        /* ... */
    }
    async post(path, data, options) {
        /* ... */
    }
}

// Then extend for specific services
class PlexHttpClient extends BaseHttpClient {
    constructor(config) {
        super(config.url, {
            timeout: config.timeout || 10000,
            debug: config.debug,
        });
        this.token = config.token;
    }

    // Plex-specific methods
}
```

**Benefits:**

- Reduce 100-150 lines of duplicated code
- Consistent error handling across clients
- Easier to add features (metrics, tracing, etc.)
- Better testability

---

### 5.2 Server Configuration Patterns

**Pattern:** Repeated server config retrieval

```javascript
// Found in multiple files:
const plexServer = (config.mediaServers || []).find(s => s.enabled && s.type === 'plex');
```

**Occurrences:** 5+ times across `server.js` and route files

#### **ISSUE #17: Create Server Config Helper**

**Recommendation:**

- **Priority:** LOW
- **Effort:** 2 hours
- **Action:**

```javascript
// lib/config-helpers.js (add to existing)
function getEnabledServer(type) {
    return (config.mediaServers || []).find(s => s.enabled && s.type === type);
}

function getAllEnabledServers(type = null) {
    const servers = config.mediaServers || [];
    return type
        ? servers.filter(s => s.enabled && s.type === type)
        : servers.filter(s => s.enabled);
}

module.exports = {
    // existing exports...
    getEnabledServer,
    getAllEnabledServers,
};
```

---

## 6. Test Coverage Gaps

### 6.1 Overall Coverage: 92%+ ✅

**Breakdown:**

- Statements: 92-94%
- Branches: 85-90%
- Functions: 90-95%
- Lines: 92-94%

### 6.2 Specific Gaps

#### **middleware/validate.js - 55-65% branches**

**Uncovered scenarios:**

1. Circular reference protection in `sanitizeInput()`
2. XSS attack vector handling (discussed above)
3. Edge cases in object/array recursion

**Action:** Already covered in Issue #15

#### **utils/cache.js - Persistence paths**

Coverage shows some persistence methods uncovered:

- `loadPersistedCache()` - warn path
- `CacheDiskManager` - error paths

**Recommendation:**

- **Priority:** LOW
- **Effort:** 2 hours
- **Action:** Add filesystem error simulation tests

---

## 7. Maintainability Metrics

### 7.1 Positive Indicators ✅

1. **Consistent code style** (Prettier + ESLint)
2. **Clear naming conventions** (camelCase, descriptive)
3. **Modular architecture** (routes, lib, utils)
4. **Comprehensive documentation** (Swagger, README, docs/)
5. **Good test organization** (mirrors source structure)

### 7.2 Areas for Improvement

#### **ISSUE #18: Add JSDoc Comments to Public APIs**

**Current State:** Some functions lack JSDoc comments

**Example:**

```javascript
// lib/media-aggregator.js
async function aggregateMediaFromSources(sources, options) {
    // 50 lines of logic
    // No documentation of parameters or return value
}
```

**Recommendation:**

- **Priority:** LOW
- **Effort:** 6 hours
- **Action:** Add JSDoc to all exported functions

```javascript
/**
 * Aggregates media items from multiple sources
 *
 * @param {Object[]} sources - Array of source configurations
 * @param {string} sources[].type - Source type (plex, jellyfin, local, tmdb)
 * @param {boolean} sources[].enabled - Whether source is active
 * @param {Object} options - Aggregation options
 * @param {number} [options.limit=50] - Max items per source
 * @param {string[]} [options.types=['movie','show']] - Media types to fetch
 * @param {boolean} [options.shuffle=true] - Shuffle results
 * @returns {Promise<Object[]>} Array of media items
 * @throws {AppError} If no sources are enabled
 */
async function aggregateMediaFromSources(sources, options) {
    // ...
}
```

---

## Summary: Code Quality Assessment

### Overall Rating: **8.5/10** ✅

**Strengths:**

- Excellent error handling infrastructure
- Comprehensive input validation
- Good test coverage
- Clear architectural patterns
- Consistent code style

**Improvement Opportunities:**

- Reduce code duplication (HTTP clients, config helpers)
- Extract large inline route handlers
- Add JSDoc documentation
- Improve XSS test coverage
- Consolidate debug logging patterns
- Audit and resolve TODO/FIXME markers

### Issues Identified This Part

| Issue # | Title                            | Priority | Effort |
| ------- | -------------------------------- | -------- | ------ |
| #11     | Debug Code Consolidation         | LOW      | 2h     |
| #12     | Technical Debt Marker Audit      | LOW      | 3h     |
| #13     | Refactor Large Route Handlers    | MEDIUM   | 6h     |
| #14     | Improve Error Context in Sources | LOW      | 4h     |
| #15     | Add XSS Attack Vector Tests      | MEDIUM   | 3h     |
| #16     | Extract Common HTTP Client Base  | LOW      | 4h     |
| #17     | Create Server Config Helper      | LOW      | 2h     |
| #18     | Add JSDoc Comments               | LOW      | 6h     |

**Total Effort:** ~30 hours across 8 issues

---

**Document:** Part 2 of 4  
**Previous:** [Part 1: Overview & Architecture](BACKEND-ANALYSIS-2025-11-15-PART1.md)  
**Next:** [Part 3: Performance & Scalability](BACKEND-ANALYSIS-2025-11-15-PART3.md)
