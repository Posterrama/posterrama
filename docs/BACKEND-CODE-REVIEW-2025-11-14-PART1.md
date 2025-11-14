# Backend Code Review - November 14, 2025 (Part 1: Critical & High Priority)

**Review Date**: November 14, 2025  
**Reviewer**: AI Code Analysis  
**Scope**: Backend codebase security, reliability, and maintainability  
**Focus**: HIGH and MEDIUM priority issues

---

## Executive Summary

This is the second comprehensive backend code review following the November 13, 2025 review where 9 issues were resolved. This review identifies **6 new issues** requiring attention, categorized by severity.

### Issue Distribution

- **HIGH Priority**: 2 issues (Security & Reliability)
- **MEDIUM Priority**: 4 issues (Performance & Maintainability)
- **LOW Priority**: Documented in Part 2

### Overall Assessment

✅ **Strengths**:

- Recent improvements from Nov 13 review (centralized env config, eager DOMPurify init)
- Comprehensive test coverage (2551 tests, 91%+ coverage)
- Well-structured modular architecture
- Good separation of concerns

⚠️ **Areas for Improvement**:

- WebSocket authentication hardening needed
- Session security enhancements required
- Cache memory management optimization
- External API timeout consistency

---

## Issue #1: WebSocket Authentication Race Condition ⚠️ HIGH

**Priority**: HIGH  
**Category**: Security  
**Impact**: Potential unauthorized WebSocket access

### Problem Description

The WebSocket authentication in `utils/wsHub.js` has a race condition vulnerability where message handlers can process commands before authentication is fully verified. The current implementation allows a brief window between connection establishment and authentication completion where malformed messages could be processed.

**Affected Code**: `utils/wsHub.js` lines 201-280

```javascript
wss.on('connection', (ws, req) => {
    let authed = false;

    ws.on('message', async data => {
        try {
            const msg = JSON.parse(data.toString());
            if (!authed) {
                if (msg && msg.kind === 'hello') {
                    // Authentication happens here asynchronously
                    const ok = await verifyDevice(id, secret);
                    authed = true; // Race condition: messages can arrive during await
                }
                return closeSocket(ws, 1008, 'Authenticate first');
            }
            // Command processing happens here
        }
    });
});
```

### Security Implications

1. **Timing Attack**: Messages arriving during `await verifyDevice()` can be queued and processed
2. **State Confusion**: `authed` flag can be checked before it's set
3. **Bypass Potential**: Rapid message flooding during auth window
4. **No Rate Limiting**: WebSocket connections lack connection-level rate limiting

### Recommended Solution

```javascript
wss.on('connection', (ws, req) => {
    let authState = 'pending'; // Use state machine: pending -> authenticating -> authenticated -> failed
    let messageQueue = [];
    let isProcessingAuth = false;

    ws.on('message', async data => {
        try {
            const msg = JSON.parse(data.toString());

            // Immediate rejection if auth failed
            if (authState === 'failed') {
                return closeSocket(ws, 1008, 'Authentication failed');
            }

            // Queue messages during authentication
            if (authState === 'pending' || authState === 'authenticating') {
                if (msg && msg.kind === 'hello') {
                    if (isProcessingAuth) {
                        return closeSocket(ws, 1008, 'Duplicate auth attempt');
                    }

                    isProcessingAuth = true;
                    authState = 'authenticating';

                    try {
                        const { deviceId: id, secret } = msg;
                        if (!id || !secret) {
                            authState = 'failed';
                            return closeSocket(ws, 1008, 'Missing credentials');
                        }

                        const ok = await verifyDevice(id, secret);

                        if (!ok) {
                            authState = 'failed';
                            return closeSocket(ws, 1008, 'Unauthorized');
                        }

                        authState = 'authenticated';
                        registerConnection(ws, id);
                        sendJson(ws, { kind: 'hello-ack', serverTime: Date.now() });

                        // Process queued messages
                        while (messageQueue.length > 0 && authState === 'authenticated') {
                            const queuedMsg = messageQueue.shift();
                            processAuthenticatedMessage(ws, queuedMsg, id);
                        }
                    } catch (e) {
                        authState = 'failed';
                        logger.error('[WS] Auth error:', { error: e.message, ip });
                        return closeSocket(ws, 1011, 'Auth error');
                    } finally {
                        isProcessingAuth = false;
                    }
                } else {
                    // Queue non-hello messages (limit queue size)
                    if (messageQueue.length < 10) {
                        messageQueue.push(msg);
                    } else {
                        return closeSocket(ws, 1008, 'Message queue overflow');
                    }
                }
                return;
            }

            // Only authenticated messages reach here
            if (authState === 'authenticated') {
                const deviceId = socketToDevice.get(ws);
                processAuthenticatedMessage(ws, msg, deviceId);
            }
        } catch (e) {
            logger.error('[WS] Message handling error:', { error: e.message });
            if (authState !== 'authenticated') {
                return closeSocket(ws, 1011, 'Message processing error');
            }
        }
    });

    // Add timeout for authentication
    const authTimeout = setTimeout(() => {
        if (authState !== 'authenticated') {
            logger.warn('[WS] Authentication timeout', { ip, authState });
            closeSocket(ws, 1008, 'Authentication timeout');
        }
    }, 10000); // 10 second auth timeout

    ws.on('close', () => {
        clearTimeout(authTimeout);
        messageQueue = [];
        unregister(ws);
    });
});

function processAuthenticatedMessage(ws, msg, deviceId) {
    // All authenticated message handling logic here
    if (msg && msg.kind === 'ack' && msg.id) {
        // Handle acknowledgements
    }
}
```

### Additional Recommendations

1. **Rate Limiting**: Add per-IP connection rate limiting
2. **Connection Monitoring**: Track failed auth attempts per IP
3. **Message Size Limits**: Enforce maximum message size (currently unlimited)
4. **Heartbeat/Timeout**: Implement ping/pong for connection health

### Priority Justification

HIGH priority because:

- Direct security vulnerability
- WebSocket controls critical device management features
- Potential for unauthorized device control
- Relatively easy to exploit with automated tools

---

## Issue #2: Session Secret Fallback in Production ⚠️ HIGH

**Priority**: HIGH  
**Category**: Security  
**Impact**: Weak session security if SESSION_SECRET not properly configured

### Problem Description

The session configuration in `server.js` includes a fallback to a test secret when SESSION_SECRET is not set. While the centralized `config/environment.js` (from Nov 13 review) validates SESSION_SECRET in production, the actual session middleware still uses a fallback:

**Affected Code**: `server.js` lines 256-270

```javascript
app.use(
    session({
        store: __fileStore,
        name: 'posterrama.sid',
        secret: env.auth.sessionSecret || 'test-secret-fallback',
        resave: false,
        saveUninitialized: false,
        rolling: true,
        proxy: env.server.nodeEnv === 'production',
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
            httpOnly: true,
            secure: env.server.nodeEnv === 'production',
            sameSite: env.server.nodeEnv === 'production' ? 'strict' : 'lax',
        },
    })
);
```

### Security Implications

1. **Weak Secret**: If validation is bypassed, sessions use predictable secret
2. **Session Hijacking**: Predictable secrets allow session cookie forgery
3. **Defense in Depth**: No runtime check before session middleware initialization
4. **Silent Failure**: Server starts even with weak session security

### Recommended Solution

```javascript
// Validate session secret BEFORE initializing session middleware
const sessionSecret = env.auth.sessionSecret;

if (!sessionSecret || sessionSecret === 'test-secret-fallback') {
    if (env.server.nodeEnv === 'production') {
        logger.error('FATAL: SESSION_SECRET not configured in production');
        logger.error('Set SESSION_SECRET environment variable and restart');
        process.exit(1);
    } else if (env.server.nodeEnv !== 'test') {
        logger.warn('⚠️  WARNING: Using development fallback for SESSION_SECRET');
        logger.warn('⚠️  DO NOT use in production! Set SESSION_SECRET environment variable');
    }
}

// Validate secret strength in non-test environments
if (env.server.nodeEnv !== 'test' && sessionSecret && sessionSecret.length < 32) {
    logger.error('FATAL: SESSION_SECRET must be at least 32 characters');
    logger.error('Generate a strong secret: openssl rand -base64 48');
    if (env.server.nodeEnv === 'production') {
        process.exit(1);
    }
}

app.use(
    session({
        store: __fileStore,
        name: 'posterrama.sid',
        secret: sessionSecret, // Remove fallback entirely
        resave: false,
        saveUninitialized: false,
        rolling: true,
        proxy: env.server.nodeEnv === 'production',
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
            httpOnly: true,
            secure: env.server.nodeEnv === 'production',
            sameSite: env.server.nodeEnv === 'production' ? 'strict' : 'lax',
            // Add security headers
            partitioned: env.server.nodeEnv === 'production', // CHIPS support
        },
    })
);
```

### Additional Security Enhancements

1. **Session Rotation**: Implement session ID rotation on privilege escalation
2. **Session Validation**: Add middleware to validate session integrity
3. **Cookie Prefixes**: Use `__Secure-` or `__Host-` prefixes for production
4. **CSP Integration**: Ensure Content-Security-Policy doesn't leak session data

### Priority Justification

HIGH priority because:

- Directly impacts authentication security
- Admin panel relies entirely on session security
- Potential for complete system compromise
- Should fail-safe rather than fail-permissive

---

## Issue #3: Inconsistent External API Timeout Configuration ⚠️ MEDIUM

**Priority**: MEDIUM  
**Category**: Reliability  
**Impact**: Unpredictable behavior when external services are slow/unavailable

### Problem Description

External HTTP clients (Plex, Jellyfin, RomM) have inconsistent timeout configurations across the codebase. Some use hardcoded values, others use environment variables, and defaults vary widely.

**Affected Files**:

- `utils/plex-http-client.js`
- `utils/jellyfin-http-client.js`
- `utils/romm-http-client.js`
- `lib/plex-helpers.js`
- `lib/jellyfin-helpers.js`

**Examples of Inconsistency**:

```javascript
// jellyfin-http-client.js - default 15000ms
constructor({ timeout = 15000, ... }) { ... }

// plex-http-client.js - default 15000ms but different in helpers
constructor({ timeout = 15000, ... }) { ... }

// routes/admin-libraries.js - hardcoded 8000ms
const client = await createJellyfinClient({
    timeout: 8000, // Why different from default?
});

// routes/admin-config.js - hardcoded 10000ms
const client = await createPlexClient({
    timeout: 10000, // Different again
});
```

### Impact Analysis

1. **User Experience**: Inconsistent timeout = unpredictable wait times
2. **Error Handling**: Different timeouts = different error patterns
3. **Resource Leaks**: Long timeouts can exhaust connection pools
4. **Test Flakiness**: Hardcoded short timeouts cause test failures

### Recommended Solution

Add timeout configuration to `config/environment.js`:

```javascript
// config/environment.js additions
const env = {
    // ... existing config ...

    external: {
        // Base timeout for all external API calls
        baseTimeout: getNumber('EXTERNAL_API_TIMEOUT', 15000),

        // Per-service overrides
        plexTimeout: getNumber('PLEX_API_TIMEOUT', 15000),
        jellyfinTimeout: getNumber('JELLYFIN_API_TIMEOUT', 15000),
        tmdbTimeout: getNumber('TMDB_API_TIMEOUT', 10000), // TMDB usually faster
        rommTimeout: getNumber('ROMM_API_TIMEOUT', 15000),

        // Connection-specific timeouts
        testConnectionTimeout: getNumber('TEST_CONNECTION_TIMEOUT', 8000),
        quickTestTimeout: getNumber('QUICK_TEST_TIMEOUT', 5000),

        // Retry configuration
        retryMaxRetries: getNumber('EXTERNAL_API_MAX_RETRIES', 2),
        retryBaseDelay: getNumber('EXTERNAL_API_RETRY_DELAY', 1000),
    },
};
```

Update all HTTP clients to use centralized config:

```javascript
// utils/jellyfin-http-client.js
const env = require('../config/environment');

constructor({
    timeout = env.external.jellyfinTimeout,
    retryMaxRetries = env.external.retryMaxRetries,
    retryBaseDelay = env.external.retryBaseDelay,
    ...
}) { ... }
```

Update route handlers:

```javascript
// routes/admin-libraries.js
const client = await createJellyfinClient({
    hostname,
    port,
    apiKey,
    timeout: env.external.testConnectionTimeout, // Explicit "test" timeout
    insecureHttps,
});
```

### Testing Requirements

1. Test timeout behavior with mock slow servers
2. Verify all clients respect configured timeouts
3. Test retry logic with transient failures
4. Document expected timeout behavior in API docs

### Priority Justification

MEDIUM priority because:

- Affects reliability but not security
- Can cause user frustration with long waits
- Inconsistency indicates maintenance issues
- Should be standardized for predictability

---

## Issue #4: Cache Memory Management Lacks Boundaries ⚠️ MEDIUM

**Priority**: MEDIUM  
**Category**: Performance & Reliability  
**Impact**: Potential memory exhaustion under high load

### Problem Description

The `CacheManager` in `utils/cache.js` implements LRU eviction and TTL expiration, but lacks comprehensive memory usage monitoring and enforcement. While there's a `maxSize` limit (500 entries), there's no limit on individual entry size or total memory consumption.

**Affected Code**: `utils/cache.js` lines 17-400

### Issues Identified

1. **No Size Limits**: Individual cache entries can be arbitrarily large
2. **Memory Estimation**: Only rough estimation (`size * 1024` bytes)
3. **No Back Pressure**: No mechanism to reject large entries
4. **Tiered Cache Overhead**: L1/L2/L3 tiers add memory but lack per-tier limits

```javascript
// Current implementation
set(key, value, ttl) {
    // Check cache size limit - use LRU eviction
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
        this.evictLRU(); // Only evicts one entry, what if new entry is huge?
    }

    const entry = {
        value, // No size validation!
        etag,
        createdAt: now,
        expiresAt,
        accessCount: 0,
        lastAccessed: now,
    };

    this.cache.set(key, entry);
}
```

### Memory Leak Scenarios

1. **Large Playlist Cache**: Caching 5000-item media playlists (several MB each)
2. **Image Metadata**: Large image objects with base64 data
3. **Tiered Cache Multiplication**: Same data potentially in L1, L2, L3
4. **Timer References**: `this.timers` Map grows indefinitely

### Recommended Solution

```javascript
class CacheManager {
    constructor(options = {}) {
        // ... existing setup ...

        this.config = {
            // ... existing config ...

            // Memory limits
            maxEntrySizeBytes: options.maxEntrySizeBytes || 10 * 1024 * 1024, // 10MB per entry
            maxTotalMemoryBytes: options.maxTotalMemoryBytes || 100 * 1024 * 1024, // 100MB total
            enableMemoryMonitoring: options.enableMemoryMonitoring !== false,
        };

        this.memoryUsage = {
            totalBytes: 0,
            largestEntry: 0,
            entriesRejected: 0,
        };

        // Start memory monitoring
        if (this.config.enableMemoryMonitoring) {
            this.startMemoryMonitoring();
        }
    }

    /**
     * Calculate entry size in bytes
     */
    calculateEntrySize(value) {
        try {
            const serialized = JSON.stringify(value);
            return Buffer.byteLength(serialized, 'utf8');
        } catch (e) {
            // Estimation fallback for circular references
            return 1024; // 1KB default estimate
        }
    }

    /**
     * Check if entry can be stored without exceeding limits
     */
    canStoreEntry(key, value) {
        const entrySize = this.calculateEntrySize(value);

        // Check individual entry size
        if (entrySize > this.config.maxEntrySizeBytes) {
            logger.warn('Cache entry too large', {
                key,
                size: entrySize,
                maxSize: this.config.maxEntrySizeBytes,
            });
            this.memoryUsage.entriesRejected++;
            return false;
        }

        // Check total memory limit
        const existingEntry = this.cache.get(key);
        const existingSize = existingEntry ? this.calculateEntrySize(existingEntry.value) : 0;
        const netIncrease = entrySize - existingSize;

        if (this.memoryUsage.totalBytes + netIncrease > this.config.maxTotalMemoryBytes) {
            logger.debug('Cache memory limit reached, attempting eviction', {
                current: this.memoryUsage.totalBytes,
                needed: netIncrease,
                limit: this.config.maxTotalMemoryBytes,
            });

            // Try to free memory with aggressive eviction
            while (
                this.cache.size > 0 &&
                this.memoryUsage.totalBytes + netIncrease > this.config.maxTotalMemoryBytes
            ) {
                this.evictLRU();
            }

            // Check again after eviction
            if (this.memoryUsage.totalBytes + netIncrease > this.config.maxTotalMemoryBytes) {
                logger.warn('Cannot store entry even after eviction', {
                    key,
                    size: entrySize,
                    available: this.config.maxTotalMemoryBytes - this.memoryUsage.totalBytes,
                });
                return false;
            }
        }

        return true;
    }

    set(key, value, ttl) {
        try {
            // Check memory limits before storing
            if (!this.canStoreEntry(key, value)) {
                this.stats.errors++;
                return null;
            }

            this.stats.sets++;

            const entrySize = this.calculateEntrySize(value);

            // Update memory tracking
            const existingEntry = this.cache.get(key);
            if (existingEntry) {
                const oldSize = this.calculateEntrySize(existingEntry.value);
                this.memoryUsage.totalBytes -= oldSize;
            }

            // LRU eviction based on count (not just memory)
            if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
                this.evictLRU();
            }

            // Clear existing timer if updating
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
            }

            const ttlMs = typeof ttl === 'number' ? ttl : this.config.defaultTTL;
            const expiresAt = Date.now() + ttlMs;
            const etag = this.generateETag(value);
            const now = Date.now();

            const entry = {
                value,
                etag,
                createdAt: now,
                expiresAt,
                accessCount: 0,
                lastAccessed: now,
                sizeBytes: entrySize, // Track size
            };

            this.cache.set(key, entry);
            this.memoryUsage.totalBytes += entrySize;
            this.memoryUsage.largestEntry = Math.max(this.memoryUsage.largestEntry, entrySize);

            // Set expiration timer
            const timer = setTimeout(() => {
                this.delete(key);
                logger.debug('Cache entry expired (timer)', { key });
            }, ttlMs);

            this.timers.set(key, timer);

            logger.debug('Cache entry set', {
                key,
                ttl: ttlMs,
                expiresAt: new Date(expiresAt).toISOString(),
                size: `${Math.round(entrySize / 1024)}KB`,
                totalMemory: `${Math.round(this.memoryUsage.totalBytes / 1024 / 1024)}MB`,
            });

            return entry;
        } catch (error) {
            this.stats.errors++;
            logger.error('Failed to set cache entry', { key, error: error.message });
            return null;
        }
    }

    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            // Update memory tracking
            if (entry.sizeBytes) {
                this.memoryUsage.totalBytes -= entry.sizeBytes;
            }
        }

        // Clear timer
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }

        const deleted = this.cache.delete(key);
        if (deleted) {
            this.stats.deletes++;
            logger.debug('Cache entry deleted', { key });
        }

        return deleted;
    }

    /**
     * Start memory monitoring
     */
    startMemoryMonitoring() {
        this.memoryMonitorInterval = setInterval(() => {
            const stats = this.getStats();

            // Alert if memory usage is high
            const memoryPercent =
                (this.memoryUsage.totalBytes / this.config.maxTotalMemoryBytes) * 100;

            if (memoryPercent > 90) {
                logger.warn('Cache memory usage critical', {
                    usage: `${Math.round(memoryPercent)}%`,
                    totalBytes: this.memoryUsage.totalBytes,
                    maxBytes: this.config.maxTotalMemoryBytes,
                    entries: this.cache.size,
                });

                // Aggressive cleanup
                this.cleanupExpired();

                // Force eviction if still critical
                if (this.memoryUsage.totalBytes / this.config.maxTotalMemoryBytes > 0.9) {
                    const toEvict = Math.ceil(this.cache.size * 0.2); // Evict 20%
                    for (let i = 0; i < toEvict; i++) {
                        this.evictLRU();
                    }
                }
            }
        }, 60000); // Check every minute
    }

    cleanup() {
        this.stopPeriodicCleanup();

        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
            this.memoryMonitorInterval = null;
        }

        // Clear all timers
        for (const [, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();

        // Clear cache and reset memory tracking
        this.cache.clear();
        this.memoryUsage.totalBytes = 0;

        logger.debug('Cache manager cleaned up');
    }

    getStats() {
        // ... existing stats ...

        return {
            // ... existing returns ...

            // Memory stats
            memoryUsage: {
                totalBytes: this.memoryUsage.totalBytes,
                totalMB: Math.round((this.memoryUsage.totalBytes / 1024 / 1024) * 100) / 100,
                maxBytes: this.config.maxTotalMemoryBytes,
                maxMB: Math.round((this.config.maxTotalMemoryBytes / 1024 / 1024) * 100) / 100,
                percentUsed: (this.memoryUsage.totalBytes / this.config.maxTotalMemoryBytes) * 100,
                largestEntryBytes: this.memoryUsage.largestEntry,
                largestEntryKB: Math.round(this.memoryUsage.largestEntry / 1024),
                entriesRejected: this.memoryUsage.entriesRejected,
            },
        };
    }
}
```

### Configuration Updates

Add to config schema and example:

```javascript
// config.schema.json
"cache": {
    "type": "object",
    "properties": {
        "maxSizeGB": { "type": "number", "minimum": 0.1, "maximum": 100 },
        "maxEntrySizeMB": { "type": "number", "minimum": 1, "maximum": 100, "default": 10 },
        "maxTotalMemoryMB": { "type": "number", "minimum": 10, "maximum": 1000, "default": 100 },
        "enableMemoryMonitoring": { "type": "boolean", "default": true }
    }
}
```

### Testing Requirements

1. Test large entry rejection (>10MB)
2. Test total memory limit enforcement
3. Test eviction under memory pressure
4. Test memory tracking accuracy
5. Test cleanup on shutdown

### Priority Justification

MEDIUM priority because:

- Can cause OOM crashes under load
- Affects stability but not security
- Performance degradation grows over time
- Should be addressed before scaling

---

## Issue #5: Incomplete Input Validation on WebSocket Messages ⚠️ MEDIUM

**Priority**: MEDIUM  
**Category**: Security & Reliability  
**Impact**: Potential for malformed data causing crashes or unexpected behavior

### Problem Description

WebSocket message handling in `utils/wsHub.js` lacks comprehensive input validation. Messages are parsed as JSON but payload structure is not validated before processing, relying on implicit type checking.

**Affected Code**: `utils/wsHub.js` lines 215-280

```javascript
ws.on('message', async data => {
    try {
        const msg = JSON.parse(data.toString());

        // Minimal validation
        if (msg && msg.kind === 'ack' && msg.id) {
            const deviceId = socketToDevice.get(ws);
            const pending = pendingAcks.get(msg.id);

            // No validation of msg.status, msg.info structure
            if (pending && pending.deviceId === deviceId) {
                clearTimeout(pending.timer);
                pendingAcks.delete(msg.id);
                pending.resolve(msg); // Unvalidated object passed to promise
            }
        }
    } catch (e) {
        // Silent failure - no notification to client
    }
});
```

### Issues Identified

1. **No Schema Validation**: Message structure not validated
2. **Type Confusion**: Payload types assumed but not checked
3. **Size Limits**: No maximum message size enforcement
4. **Malformed JSON**: Parse errors silently ignored
5. **No Rate Limiting**: No per-device message rate limits

### Recommended Solution

Create WebSocket message validator:

```javascript
// utils/wsMessageValidator.js
const Joi = require('joi');

const schemas = {
    hello: Joi.object({
        kind: Joi.string().valid('hello').required(),
        deviceId: Joi.string().uuid().required(),
        secret: Joi.string().min(32).required(),
    }).required(),

    ack: Joi.object({
        kind: Joi.string().valid('ack').required(),
        id: Joi.string().required(),
        status: Joi.string().valid('ok', 'error').required(),
        info: Joi.object().optional(),
    }).required(),

    ping: Joi.object({
        kind: Joi.string().valid('ping').required(),
        timestamp: Joi.number().integer().positive().optional(),
    }).required(),
};

/**
 * Validate WebSocket message against schema
 * @param {Object} message - Parsed message object
 * @returns {Object} { valid: boolean, error?: string, value?: Object }
 */
function validateMessage(message) {
    // Basic structure check
    if (!message || typeof message !== 'object') {
        return { valid: false, error: 'Message must be an object' };
    }

    if (!message.kind || typeof message.kind !== 'string') {
        return { valid: false, error: 'Message must have a kind field' };
    }

    // Schema validation
    const schema = schemas[message.kind];
    if (!schema) {
        return { valid: false, error: `Unknown message kind: ${message.kind}` };
    }

    const { error, value } = schema.validate(message, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (error) {
        return {
            valid: false,
            error: error.details.map(d => d.message).join(', '),
        };
    }

    return { valid: true, value };
}

module.exports = { validateMessage };
```

Update wsHub.js to use validator:

```javascript
const { validateMessage } = require('./wsMessageValidator');

// Configuration
const WS_MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB
const WS_RATE_LIMIT_PER_SECOND = 10;

// Per-device rate limiting
const deviceMessageCounts = new Map(); // deviceId -> { count, resetAt }

function checkRateLimit(deviceId) {
    const now = Date.now();
    const record = deviceMessageCounts.get(deviceId);

    if (!record || now > record.resetAt) {
        deviceMessageCounts.set(deviceId, {
            count: 1,
            resetAt: now + 1000,
        });
        return true;
    }

    if (record.count >= WS_RATE_LIMIT_PER_SECOND) {
        logger.warn('[WS] Rate limit exceeded', { deviceId, count: record.count });
        return false;
    }

    record.count++;
    return true;
}

wss.on('connection', (ws, req) => {
    const ip =
        (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    let authed = false;
    let deviceId = null;

    ws.on('message', async data => {
        try {
            // Check message size
            if (data.length > WS_MAX_MESSAGE_SIZE) {
                logger.warn('[WS] Message too large', {
                    size: data.length,
                    maxSize: WS_MAX_MESSAGE_SIZE,
                    ip,
                });
                return closeSocket(ws, 1009, 'Message too large');
            }

            // Parse JSON with error handling
            let msg;
            try {
                msg = JSON.parse(data.toString());
            } catch (parseError) {
                logger.warn('[WS] Invalid JSON', {
                    error: parseError.message,
                    ip,
                    dataLength: data.length,
                });
                return closeSocket(ws, 1007, 'Invalid JSON');
            }

            // Validate message structure
            const validation = validateMessage(msg);
            if (!validation.valid) {
                logger.warn('[WS] Invalid message', {
                    error: validation.error,
                    kind: msg?.kind,
                    ip,
                });

                // Send error back to client for debugging
                sendJson(ws, {
                    kind: 'error',
                    message: 'Invalid message format',
                    details: validation.error,
                });

                // Close for repeated invalid messages
                if (!authed) {
                    return closeSocket(ws, 1008, 'Invalid message format');
                }

                return;
            }

            msg = validation.value; // Use validated/sanitized message

            // Rate limiting for authenticated devices
            if (authed && deviceId) {
                if (!checkRateLimit(deviceId)) {
                    return closeSocket(ws, 1008, 'Rate limit exceeded');
                }
            }

            // Continue with message processing...
            if (!authed) {
                if (msg.kind === 'hello') {
                    // Authentication logic
                    const ok = await verifyDevice(msg.deviceId, msg.secret);
                    if (!ok) {
                        return closeSocket(ws, 1008, 'Unauthorized');
                    }
                    authed = true;
                    deviceId = msg.deviceId;
                    registerConnection(ws, deviceId);
                    sendJson(ws, { kind: 'hello-ack', serverTime: Date.now() });
                    return;
                }
                return closeSocket(ws, 1008, 'Authenticate first');
            }

            // Handle authenticated messages
            if (msg.kind === 'ack') {
                const pending = pendingAcks.get(msg.id);
                if (pending && pending.deviceId === deviceId) {
                    clearTimeout(pending.timer);
                    pendingAcks.delete(msg.id);
                    pending.resolve(msg);
                }
            } else if (msg.kind === 'ping') {
                sendJson(ws, {
                    kind: 'pong',
                    timestamp: msg.timestamp || Date.now(),
                });
            }
        } catch (e) {
            logger.error('[WS] Message handling error', {
                error: e.message,
                stack: e.stack,
                ip,
                authed,
            });

            if (!authed) {
                return closeSocket(ws, 1011, 'Internal error');
            }
        }
    });

    // Cleanup rate limit tracking on disconnect
    ws.on('close', () => {
        if (deviceId) {
            deviceMessageCounts.delete(deviceId);
        }
        unregister(ws);
    });
});
```

### Testing Requirements

1. Test message size limits
2. Test invalid JSON handling
3. Test schema validation failures
4. Test rate limiting behavior
5. Test error responses to client

### Priority Justification

MEDIUM priority because:

- Can cause crashes but requires malicious intent
- Affects reliability more than security
- Rate limiting prevents DoS scenarios
- Should be hardened for production

---

## Issue #6: Inconsistent Error Logging Patterns ⚠️ MEDIUM

**Priority**: MEDIUM  
**Category**: Maintainability & Operations  
**Impact**: Difficult debugging and incident response

### Problem Description

Error logging across the codebase uses inconsistent patterns, making it difficult to:

- Correlate errors across modules
- Parse logs programmatically
- Set up effective monitoring/alerting
- Debug production issues

**Examples of Inconsistency**:

```javascript
// Different error logging styles found:

// Style 1: String only
logger.error('Failed to fetch media');

// Style 2: String with inline variables
logger.error(`Failed to fetch media from ${source}`);

// Style 3: String with object
logger.error('Failed to fetch media', { source, error: e.message });

// Style 4: String with stack
logger.error('Failed to fetch media', { error: e.message, stack: e.stack });

// Style 5: Direct error object
logger.error(e);

// Style 6: Console.error (bypasses logger)
console.error('[Media] Error:', e);
```

### Issues Identified

1. **No Standard Structure**: Error logs lack consistent fields
2. **Missing Context**: Often missing request ID, user, or operation context
3. **Stack Traces**: Inconsistently included (sometimes missing when needed)
4. **Error Classification**: No error type/code for categorization
5. **PII Leakage**: Sometimes logs sensitive data (tokens, passwords)

### Recommended Solution

Create centralized error logging utility:

```javascript
// utils/errorLogger.js
const logger = require('./logger');

/**
 * Standardized error logging with context
 */
class ErrorLogger {
    /**
     * Log error with full context and consistent structure
     *
     * @param {Error} error - The error object
     * @param {Object} context - Additional context
     * @param {string} context.operation - What operation was being performed
     * @param {string} context.module - Which module/file the error occurred in
     * @param {string} context.requestId - Request ID if applicable
     * @param {string} context.userId - User ID if applicable
     * @param {Object} context.metadata - Additional metadata
     * @param {string} level - Log level (error, warn, info)
     */
    static log(error, context = {}, level = 'error') {
        const {
            operation = 'unknown',
            module = 'unknown',
            requestId = null,
            userId = null,
            metadata = {},
        } = context;

        // Build standardized error object
        const errorLog = {
            // Error details
            errorMessage: error.message || String(error),
            errorName: error.name || 'Error',
            errorCode: error.code || error.statusCode || null,

            // Stack trace (sanitized)
            stack: this.sanitizeStack(error.stack),

            // Context
            operation,
            module,

            // Request tracking
            requestId,
            userId,

            // Timestamp
            timestamp: new Date().toISOString(),

            // Additional metadata (sanitized)
            metadata: this.sanitizeMetadata(metadata),
        };

        // Remove null values
        Object.keys(errorLog).forEach(key => {
            if (errorLog[key] === null || errorLog[key] === undefined) {
                delete errorLog[key];
            }
        });

        // Log with appropriate level
        const logMessage = `[${module}] ${operation} failed: ${errorLog.errorMessage}`;
        logger[level](logMessage, errorLog);

        return errorLog;
    }

    /**
     * Sanitize stack traces to remove sensitive paths
     */
    static sanitizeStack(stack) {
        if (!stack) return null;

        // Remove absolute paths, keep relative
        return stack
            .split('\n')
            .map(line => {
                // Replace /var/www/posterrama with .
                return line.replace(/\/var\/www\/posterrama\//g, './');
            })
            .join('\n');
    }

    /**
     * Sanitize metadata to remove sensitive data
     */
    static sanitizeMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object') {
            return {};
        }

        const sanitized = { ...metadata };

        // List of sensitive keys to redact
        const sensitiveKeys = [
            'password',
            'secret',
            'token',
            'apiKey',
            'api_key',
            'authorization',
            'cookie',
            'session',
        ];

        // Recursively sanitize object
        const sanitizeObject = obj => {
            for (const key of Object.keys(obj)) {
                const lowerKey = key.toLowerCase();

                // Redact sensitive fields
                if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
                    obj[key] = '[REDACTED]';
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObject(obj[key]);
                }
            }
        };

        sanitizeObject(sanitized);
        return sanitized;
    }

    /**
     * Quick error logger for common scenarios
     */
    static logHttpError(error, req, additionalContext = {}) {
        return this.log(error, {
            operation: `${req.method} ${req.path}`,
            module: 'http',
            requestId: req.id || req.requestId,
            userId: req.session?.user?.username || req.user?.username,
            metadata: {
                ip: req.ip,
                userAgent: req.get('user-agent')?.substring(0, 100),
                ...additionalContext,
            },
        });
    }

    static logDatabaseError(error, operation, additionalContext = {}) {
        return this.log(error, {
            operation,
            module: 'database',
            metadata: additionalContext,
        });
    }

    static logExternalApiError(error, service, endpoint, additionalContext = {}) {
        return this.log(error, {
            operation: `${service} API call`,
            module: 'external-api',
            metadata: {
                service,
                endpoint,
                ...additionalContext,
            },
        });
    }

    static logWebSocketError(error, deviceId, additionalContext = {}) {
        return this.log(error, {
            operation: 'WebSocket communication',
            module: 'websocket',
            metadata: {
                deviceId,
                ...additionalContext,
            },
        });
    }
}

module.exports = ErrorLogger;
```

Usage examples:

```javascript
// In route handlers
const ErrorLogger = require('./utils/errorLogger');

try {
    const media = await fetchMedia();
} catch (error) {
    ErrorLogger.logHttpError(error, req, {
        source: 'plex',
        action: 'fetchMedia',
    });
    throw new ApiError(500, 'Failed to fetch media');
}

// In external API clients
try {
    const response = await this.http.get('/api/endpoint');
} catch (error) {
    ErrorLogger.logExternalApiError(error, 'Jellyfin', '/api/endpoint', {
        hostname: this.hostname,
        timeout: this.timeout,
    });
    throw error;
}

// In WebSocket handlers
try {
    await verifyDevice(id, secret);
} catch (error) {
    ErrorLogger.logWebSocketError(error, id, {
        ip,
        action: 'authentication',
    });
    return closeSocket(ws, 1011, 'Auth error');
}
```

### Migration Strategy

1. Create ErrorLogger utility
2. Update middleware/errorHandler.js to use ErrorLogger
3. Gradually migrate high-traffic endpoints
4. Update documentation with examples
5. Add linting rule to detect direct console.error usage

### Monitoring Integration

With standardized logs, add:

```javascript
// Example: Send critical errors to external monitoring
class ErrorLogger {
    static log(error, context = {}, level = 'error') {
        const errorLog = {
            /* ... */
        };

        logger[level](logMessage, errorLog);

        // Send to external monitoring (Sentry, Datadog, etc.)
        if (level === 'error' && process.env.SENTRY_DSN) {
            this.sendToSentry(error, errorLog);
        }

        return errorLog;
    }

    static sendToSentry(error, errorLog) {
        // Integration with error tracking service
        // (Not implemented in this example)
    }
}
```

### Priority Justification

MEDIUM priority because:

- Doesn't affect functionality but impacts operations
- Makes debugging significantly harder
- Important for production monitoring
- Should be standardized for maintainability

---

## Summary of Findings

### HIGH Priority (Must Fix)

1. **WebSocket Authentication Race Condition** - Security vulnerability
2. **Session Secret Fallback in Production** - Weak session security

### MEDIUM Priority (Should Fix)

3. **Inconsistent External API Timeouts** - Reliability issues
4. **Cache Memory Management** - Potential OOM crashes
5. **WebSocket Message Validation** - Security & reliability
6. **Error Logging Inconsistency** - Operations & debugging

### Next Steps

1. **Immediate**: Address HIGH priority security issues
2. **Short-term**: Implement MEDIUM priority fixes
3. **Documentation**: Update security and operations guides
4. **Testing**: Add integration tests for fixes
5. **Monitoring**: Set up alerts for new issues

### Test Coverage Impact

All fixes should maintain or improve the current 91%+ test coverage:

- WebSocket authentication: +50 tests
- Session security: +15 tests
- Timeout configuration: +20 tests
- Cache memory: +30 tests
- Message validation: +25 tests
- Error logging: +20 tests

**Total new tests**: ~160

---

**Document continues in Part 2 with LOW priority issues and detailed recommendations.**
