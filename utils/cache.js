const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

// Logger will be passed in during initialization to avoid circular dependencies
let logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

/**
 * In-memory cache with TTL and storage capabilities
 * Phase 3: Extended with tiered caching (L1/L2/L3)
 */
class CacheManager {
    constructor(options = {}) {
        // L1: Hot tier - frequently accessed, in-memory
        this.l1Cache = new Map();
        // L2: Warm tier - moderately accessed, in-memory
        this.l2Cache = new Map();
        // L3: Cold tier - rarely accessed, disk-backed
        this.l3Cache = new Map();

        // Legacy cache reference (points to L1 for backward compatibility)
        this.cache = this.l1Cache;

        this.timers = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            errors: 0,
            lastReset: Date.now(),
            // Tiered cache stats
            l1Hits: 0,
            l2Hits: 0,
            l3Hits: 0,
            promotions: 0,
            demotions: 0,
        };
        this.config = {
            defaultTTL: options.defaultTTL || 300000, // 5 minutes default
            maxSize: options.maxSize || 500, // Max cache entries (increased from 100)
            persistPath: options.persistPath || path.resolve(__dirname, '../cache'),
            enablePersistence: options.enablePersistence || false,
            enableCompression: options.enableCompression || false,
            // Tiered cache configuration
            enableTiering: options.enableTiering || false,
            l1MaxSize: options.l1MaxSize || 100, // Hot tier: 100 entries
            l2MaxSize: options.l2MaxSize || 300, // Warm tier: 300 entries
            l3MaxSize: options.l3MaxSize || 500, // Cold tier: 500 entries
            promotionThreshold: options.promotionThreshold || 3, // Promote after N accesses
            demotionAge: options.demotionAge || 10 * 60 * 1000, // Demote after 10 minutes
            // Memory limits (Issue #4 fix)
            maxEntrySizeBytes: options.maxEntrySizeBytes || 10 * 1024 * 1024, // 10MB per entry
            maxTotalMemoryBytes: options.maxTotalMemoryBytes || 100 * 1024 * 1024, // 100MB total
            enableMemoryMonitoring: options.enableMemoryMonitoring !== false,
        };

        // Memory tracking (Issue #4 fix)
        this.memoryUsage = {
            totalBytes: 0,
            largestEntry: 0,
            entriesRejected: 0,
        };

        // Start periodic cleanup
        this.startPeriodicCleanup();

        // Start periodic tier management (if tiering enabled)
        if (this.config.enableTiering) {
            this.startTierManagement();
        }

        // Start memory monitoring (Issue #4 fix)
        if (this.config.enableMemoryMonitoring) {
            this.startMemoryMonitoring();
        }

        logger.debug('Cache manager initialized', {
            defaultTTL: this.config.defaultTTL,
            maxSize: this.config.maxSize,
            persistPath: this.config.persistPath,
            enablePersistence: this.config.enablePersistence,
            enableCompression: this.config.enableCompression,
            enableTiering: this.config.enableTiering,
            maxEntrySizeMB: Math.round(this.config.maxEntrySizeBytes / 1024 / 1024),
            maxTotalMemoryMB: Math.round(this.config.maxTotalMemoryBytes / 1024 / 1024),
        });
    }

    /**
     * Start periodic cleanup of expired entries
     */
    startPeriodicCleanup() {
        // Run cleanup every 5 minutes
        this.cleanupInterval = setInterval(
            () => {
                this.cleanupExpired();
            },
            5 * 60 * 1000
        );

        // Initial cleanup after 30 seconds
        setTimeout(() => {
            this.cleanupExpired();
        }, 30000);
    }

    /**
     * Stop periodic cleanup
     */
    stopPeriodicCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        this.stopPeriodicCleanup();

        // Stop memory monitoring (Issue #4 fix)
        if (this.memoryMonitorInterval) {
            this.stopMemoryMonitoring();
        }

        // Clear all timers
        for (const [, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();

        // Clear cache and reset memory tracking (Issue #4 fix)
        this.cache.clear();
        this.memoryUsage.totalBytes = 0;

        // Clear tiered caches
        if (this.config.enableTiering) {
            this.l2Cache.clear();
            this.l3Cache.clear();
            this.stopTierManagement();
        }

        logger.debug('Cache manager cleaned up');
    }

    /**
     * Cleanup expired entries manually
     */
    cleanupExpired() {
        let expired = 0;
        const now = Date.now();

        // Cleanup all tiers
        const tiers = this.config.enableTiering
            ? [this.l1Cache, this.l2Cache, this.l3Cache]
            : [this.cache];

        for (const tier of tiers) {
            for (const [key, entry] of tier.entries()) {
                if (now >= entry.expiresAt) {
                    this.delete(key);
                    expired++;
                }
            }
        }

        if (expired > 0) {
            logger.info(`Cache cleanup: removed ${expired} expired entries`);
        }

        return expired;
    }

    /**
     * Start periodic tier management (promotion/demotion)
     */
    startTierManagement() {
        // Run tier management every 2 minutes
        this.tierInterval = setInterval(
            () => {
                this.manageTiers();
            },
            2 * 60 * 1000
        );

        logger.debug('Tier management started');
    }

    /**
     * Stop periodic tier management
     */
    stopTierManagement() {
        if (this.tierInterval) {
            clearInterval(this.tierInterval);
            this.tierInterval = null;
        }
    }

    /**
     * Manage cache tiers: promote hot entries, demote cold entries
     */
    manageTiers() {
        if (!this.config.enableTiering) return;

        const now = Date.now();
        let promoted = 0;
        let demoted = 0;

        // Promote L2 → L1 (frequently accessed entries)
        for (const [key, entry] of this.l2Cache.entries()) {
            if (entry.accessCount >= this.config.promotionThreshold) {
                if (this.l1Cache.size < this.config.l1MaxSize) {
                    this.l1Cache.set(key, entry);
                    this.l2Cache.delete(key);
                    this.stats.promotions++;
                    promoted++;
                    logger.debug('Promoted L2 → L1', { key, accessCount: entry.accessCount });
                }
            }
        }

        // Promote L3 → L2 (warming up)
        for (const [key, entry] of this.l3Cache.entries()) {
            if (entry.accessCount >= this.config.promotionThreshold) {
                if (this.l2Cache.size < this.config.l2MaxSize) {
                    this.l2Cache.set(key, entry);
                    this.l3Cache.delete(key);
                    this.stats.promotions++;
                    promoted++;
                    logger.debug('Promoted L3 → L2', { key, accessCount: entry.accessCount });
                }
            }
        }

        // Demote L1 → L2 (cooling down)
        for (const [key, entry] of this.l1Cache.entries()) {
            const age = now - entry.lastAccessed;
            if (
                age > this.config.demotionAge &&
                entry.accessCount < this.config.promotionThreshold
            ) {
                if (this.l2Cache.size < this.config.l2MaxSize) {
                    entry.accessCount = 0; // Reset access count on demotion
                    this.l2Cache.set(key, entry);
                    this.l1Cache.delete(key);
                    this.stats.demotions++;
                    demoted++;
                    logger.debug('Demoted L1 → L2', { key, age });
                }
            }
        }

        // Demote L2 → L3 (going cold)
        for (const [key, entry] of this.l2Cache.entries()) {
            const age = now - entry.lastAccessed;
            if (
                age > this.config.demotionAge &&
                entry.accessCount < this.config.promotionThreshold
            ) {
                if (this.l3Cache.size < this.config.l3MaxSize) {
                    entry.accessCount = 0; // Reset access count on demotion
                    this.l3Cache.set(key, entry);
                    this.l2Cache.delete(key);
                    this.stats.demotions++;
                    demoted++;
                    logger.debug('Demoted L2 → L3', { key, age });
                }
            }
        }

        if (promoted > 0 || demoted > 0) {
            logger.info('Tier management complete', {
                promoted,
                demoted,
                l1Size: this.l1Cache.size,
                l2Size: this.l2Cache.size,
                l3Size: this.l3Cache.size,
            });
        }
    }

    /**
     * Generate ETag for cache validation
     */
    generateETag(data) {
        const hash = crypto.createHash('md5');
        hash.update(typeof data === 'string' ? data : JSON.stringify(data));
        return `"${hash.digest('hex')}"`;
    }

    /**
     * Calculate entry size in bytes (Issue #4 fix)
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
     * Check if entry can be stored without exceeding limits (Issue #4 fix)
     */
    canStoreEntry(key, value) {
        const entrySize = this.calculateEntrySize(value);

        // Check individual entry size
        if (entrySize > this.config.maxEntrySizeBytes) {
            logger.warn('Cache entry too large', {
                key,
                size: entrySize,
                maxSize: this.config.maxEntrySizeBytes,
                sizeMB: Math.round((entrySize / 1024 / 1024) * 100) / 100,
            });
            this.memoryUsage.entriesRejected++;
            return false;
        }

        // Check total memory limit
        const existingEntry = this.cache.get(key);
        const existingSize = existingEntry?.sizeBytes || 0;
        const netIncrease = entrySize - existingSize;

        if (this.memoryUsage.totalBytes + netIncrease > this.config.maxTotalMemoryBytes) {
            logger.debug('Cache memory limit reached, attempting eviction', {
                current: this.memoryUsage.totalBytes,
                needed: netIncrease,
                limit: this.config.maxTotalMemoryBytes,
            });

            // Try to free memory with aggressive eviction
            const targetFree = netIncrease * 1.2; // Free 20% more than needed
            let freedBytes = 0;

            while (
                this.cache.size > 0 &&
                freedBytes < targetFree &&
                this.memoryUsage.totalBytes + netIncrease > this.config.maxTotalMemoryBytes
            ) {
                const beforeSize = this.memoryUsage.totalBytes;
                this.evictLRU();
                freedBytes += beforeSize - this.memoryUsage.totalBytes;
            }

            // Check again after eviction
            if (this.memoryUsage.totalBytes + netIncrease > this.config.maxTotalMemoryBytes) {
                logger.warn('Cannot store entry even after eviction', {
                    key,
                    size: entrySize,
                    available: this.config.maxTotalMemoryBytes - this.memoryUsage.totalBytes,
                });
                this.memoryUsage.entriesRejected++;
                return false;
            }
        }

        return true;
    }

    /**
     * Start memory monitoring (Issue #4 fix)
     */
    startMemoryMonitoring() {
        // Run monitoring every minute
        this.memoryMonitorInterval = setInterval(() => {
            const memoryPercent =
                (this.memoryUsage.totalBytes / this.config.maxTotalMemoryBytes) * 100;

            if (memoryPercent > 90) {
                logger.warn('Cache memory usage critical', {
                    usage: `${Math.round(memoryPercent)}%`,
                    totalBytes: this.memoryUsage.totalBytes,
                    totalMB: Math.round((this.memoryUsage.totalBytes / 1024 / 1024) * 100) / 100,
                    maxBytes: this.config.maxTotalMemoryBytes,
                    maxMB: Math.round((this.config.maxTotalMemoryBytes / 1024 / 1024) * 100) / 100,
                    entries: this.cache.size,
                });

                // Aggressive cleanup
                this.cleanupExpired();

                // Force eviction if still critical
                if (this.memoryUsage.totalBytes / this.config.maxTotalMemoryBytes > 0.9) {
                    const toEvict = Math.ceil(this.cache.size * 0.2); // Evict 20%
                    logger.info('Force evicting entries due to memory pressure', { toEvict });
                    for (let i = 0; i < toEvict && this.cache.size > 0; i++) {
                        this.evictLRU();
                    }
                }
            }
        }, 60000); // Check every minute

        logger.debug('Memory monitoring started');
    }

    /**
     * Stop memory monitoring (Issue #4 fix)
     */
    stopMemoryMonitoring() {
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
            this.memoryMonitorInterval = null;
        }
    }

    /**
     * Evict least recently used entry
     * Uses sort-based LRU for O(n log n) eviction
     */
    evictLRU() {
        if (this.cache.size === 0) return;

        // Find least recently used entry
        let lruKey = null;
        let oldestAccess = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccessed < oldestAccess) {
                oldestAccess = entry.lastAccessed;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.delete(lruKey);
            logger.debug('LRU eviction: removed least recently used entry', {
                key: lruKey,
                lastAccessed: new Date(oldestAccess).toISOString(),
                cacheSize: this.cache.size,
            });
        }
    }

    /**
     * Set cache entry with optional TTL
     */
    set(key, value, ttl) {
        try {
            // Check memory limits before storing (Issue #4 fix)
            if (!this.canStoreEntry(key, value)) {
                this.stats.errors++;
                return null;
            }

            this.stats.sets++;

            const entrySize = this.calculateEntrySize(value);

            // Update memory tracking (Issue #4 fix)
            const existingEntry = this.cache.get(key);
            if (existingEntry?.sizeBytes) {
                this.memoryUsage.totalBytes -= existingEntry.sizeBytes;
            }

            // Check cache size limit - use LRU eviction
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
                lastAccessed: now, // Will be updated on first get()
                sizeBytes: entrySize, // Track size (Issue #4 fix)
            };

            this.cache.set(key, entry);
            this.memoryUsage.totalBytes += entrySize;
            this.memoryUsage.largestEntry = Math.max(this.memoryUsage.largestEntry, entrySize);

            // Set expiration timer
            if (ttlMs > 0) {
                const timer = setTimeout(() => {
                    this.delete(key);
                    logger.debug('Cache entry expired', { key });
                }, ttlMs);
                this.timers.set(key, timer);
            } else {
                // Immediate expiration
                this.delete(key);
                return null;
            }

            logger.debug('Cache entry set', {
                key,
                ttl: ttl || this.config.defaultTTL,
                etag,
                cacheSize: this.cache.size,
                size: `${Math.round(entrySize / 1024)}KB`,
                totalMemory: `${Math.round((this.memoryUsage.totalBytes / 1024 / 1024) * 100) / 100}MB`,
            });

            // Persist if enabled
            if (this.config.enablePersistence) {
                this.persistEntry(key, entry).catch(err =>
                    logger.warn('Failed to persist cache entry', { key, error: err.message })
                );
            }

            return entry;
        } catch (error) {
            this.stats.errors++;
            logger.error('Failed to set cache entry', { key, error: error.message });
            return null;
        }
    }

    /**
     * Get cache entry
     */
    get(key) {
        try {
            let entry = null;
            let tier = null;

            // Search through tiers if tiering is enabled
            if (this.config.enableTiering) {
                if (this.l1Cache.has(key)) {
                    entry = this.l1Cache.get(key);
                    tier = 'L1';
                    this.stats.l1Hits++;
                } else if (this.l2Cache.has(key)) {
                    entry = this.l2Cache.get(key);
                    tier = 'L2';
                    this.stats.l2Hits++;
                } else if (this.l3Cache.has(key)) {
                    entry = this.l3Cache.get(key);
                    tier = 'L3';
                    this.stats.l3Hits++;
                }
            } else {
                entry = this.cache.get(key);
            }

            if (!entry) {
                this.stats.misses++;
                logger.debug('Cache miss', { key });
                return null;
            }

            // Check if expired
            if (Date.now() >= entry.expiresAt) {
                this.delete(key);
                this.stats.misses++;
                logger.debug('Cache entry expired on access', { key });
                return null;
            }

            // Update access statistics
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.hits++;

            logger.debug('Cache hit', {
                key,
                tier,
                accessCount: entry.accessCount,
                age: Date.now() - entry.createdAt,
            });

            return entry;
        } catch (error) {
            this.stats.errors++;
            logger.error('Failed to get cache entry', { key, error: error.message });
            return null;
        }
    }

    /**
     * Check if entry exists and is valid
     */
    has(key) {
        if (this.config.enableTiering) {
            // Check all tiers
            const entry = this.l1Cache.get(key) || this.l2Cache.get(key) || this.l3Cache.get(key);
            if (!entry) return false;
            return Date.now() < entry.expiresAt;
        }

        const entry = this.cache.get(key);
        if (!entry) return false;
        return Date.now() < entry.expiresAt;
    }

    /**
     * Delete cache entry
     */
    delete(key) {
        try {
            // Update memory tracking before delete (Issue #4 fix)
            const entry = this.cache.get(key);
            if (entry?.sizeBytes) {
                this.memoryUsage.totalBytes -= entry.sizeBytes;
            }

            // Clear timer
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
                this.timers.delete(key);
            }

            let deleted = false;

            // Delete from all tiers if tiering enabled
            if (this.config.enableTiering) {
                deleted =
                    this.l1Cache.delete(key) ||
                    this.l2Cache.delete(key) ||
                    this.l3Cache.delete(key);
            } else {
                deleted = this.cache.delete(key);
            }

            if (deleted) {
                this.stats.deletes++;
                logger.debug('Cache entry deleted', { key });
            }

            return deleted;
        } catch (error) {
            this.stats.errors++;
            logger.error('Failed to delete cache entry', { key, error: error.message });
            return false;
        }
    }

    /**
     * Clear all cache entries or specific type
     */
    clear(type = null) {
        try {
            let cleared = 0;

            if (type) {
                // Clear specific type (keys that start with type:)
                for (const key of this.cache.keys()) {
                    if (key.startsWith(`${type}:`)) {
                        this.delete(key);
                        cleared++;
                    }
                }
                logger.info('Cache cleared for type', { type, cleared });
            } else {
                // Clear all timers
                for (const timer of this.timers.values()) {
                    clearTimeout(timer);
                }

                cleared = this.cache.size;
                this.cache.clear();
                this.timers.clear();
                this.memoryUsage.totalBytes = 0; // Reset memory tracking (Issue #4 fix)
                logger.info('Cache cleared completely', { cleared });
            }

            return cleared;
        } catch (error) {
            logger.error('Failed to clear cache', { type, error: error.message });
            return 0;
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const entries = Array.from(this.cache.values());
        const now = Date.now();
        const totalRequests = this.stats.hits + this.stats.misses;

        const stats = {
            // Basic stats
            size: this.cache.size,
            maxSize: this.config.maxSize,
            hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,

            // Request stats
            totalRequests,
            hits: this.stats.hits,
            misses: this.stats.misses,
            sets: this.stats.sets,
            deletes: this.stats.deletes,

            // Entry details
            entries: entries.map(entry => ({
                age: Math.round((now - entry.createdAt) / 1000), // seconds
                ttl: Math.max(0, Math.round((entry.expiresAt - now) / 1000)), // seconds
                accessCount: entry.accessCount,
                lastAccessed: Math.round((now - entry.lastAccessed) / 1000), // seconds ago
            })),

            // Performance metrics
            totalAccess: entries.reduce((sum, entry) => sum + entry.accessCount, 0),
            averageAccessCount:
                entries.length > 0
                    ? Math.round(
                          (entries.reduce((sum, entry) => sum + entry.accessCount, 0) /
                              entries.length) *
                              100
                      ) / 100
                    : 0,

            // Memory usage (Issue #4 fix - accurate tracking)
            memoryUsage: {
                totalBytes: this.memoryUsage.totalBytes,
                totalMB: Math.round((this.memoryUsage.totalBytes / 1024 / 1024) * 100) / 100,
                maxBytes: this.config.maxTotalMemoryBytes,
                maxMB: Math.round((this.config.maxTotalMemoryBytes / 1024 / 1024) * 100) / 100,
                percentUsed:
                    Math.round(
                        (this.memoryUsage.totalBytes / this.config.maxTotalMemoryBytes) * 10000
                    ) / 100,
                largestEntryBytes: this.memoryUsage.largestEntry,
                largestEntryKB: Math.round(this.memoryUsage.largestEntry / 1024),
                entriesRejected: this.memoryUsage.entriesRejected,
                averageEntryBytes:
                    this.cache.size > 0
                        ? Math.round(this.memoryUsage.totalBytes / this.cache.size)
                        : 0,
                averageEntryKB:
                    this.cache.size > 0
                        ? Math.round((this.memoryUsage.totalBytes / this.cache.size / 1024) * 100) /
                          100
                        : 0,
            },

            // Cleanup stats
            lastCleanup: this.stats.lastCleanup,
            cleanupCount: this.stats.cleanups,
        };

        // Add tier-specific stats if tiering is enabled
        if (this.config.enableTiering) {
            stats.tiering = {
                l1Hits: this.stats.l1Hits,
                l2Hits: this.stats.l2Hits,
                l3Hits: this.stats.l3Hits,
                promotions: this.stats.promotions,
                demotions: this.stats.demotions,
                l1Size: this.l1Cache.size,
                l2Size: this.l2Cache.size,
                l3Size: this.l3Cache.size,
                l1MaxSize: this.config.l1MaxSize,
                l2MaxSize: this.config.l2MaxSize,
                l3MaxSize: this.config.l3MaxSize,
            };
        }

        return stats;
    }

    /**
     * Reset cache statistics
     */
    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            cleanups: 0,
            lastCleanup: null,
        };

        // Reset access counts for all entries
        for (const entry of this.cache.values()) {
            entry.accessCount = 0;
        }

        logger.info('Cache statistics reset');
    }

    /**
     * Persist cache entry to disk
     */
    async persistEntry(key, entry) {
        if (!this.config.enablePersistence) return;

        try {
            await fs.mkdir(this.config.persistPath, { recursive: true });
            const filename = crypto.createHash('md5').update(key).digest('hex') + '.json';
            const filepath = path.join(this.config.persistPath, filename);

            await fs.writeFile(
                filepath,
                JSON.stringify(
                    {
                        key,
                        ...entry,
                    },
                    null,
                    2
                )
            );
        } catch (error) {
            logger.warn('Failed to persist cache entry', { key, error: error.message });
        }
    }

    /**
     * Load persisted cache entries
     */
    async loadPersistedEntries() {
        if (!this.config.enablePersistence) return;

        try {
            const files = await fs.readdir(this.config.persistPath);
            let loaded = 0;

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                try {
                    const filepath = path.join(this.config.persistPath, file);
                    const content = await fs.readFile(filepath, 'utf8');
                    const data = JSON.parse(content);

                    // Check if still valid
                    if (Date.now() <= data.expiresAt) {
                        this.cache.set(data.key, {
                            value: data.value,
                            etag: data.etag,
                            createdAt: data.createdAt,
                            expiresAt: data.expiresAt,
                            accessCount: data.accessCount || 0,
                            lastAccessed: data.lastAccessed || data.createdAt,
                        });
                        loaded++;
                    } else {
                        // Remove expired persisted entry
                        await fs.unlink(filepath);
                    }
                } catch (err) {
                    logger.warn('Failed to load persisted cache entry', {
                        file,
                        error: err.message,
                    });
                }
            }

            logger.info('Loaded persisted cache entries', { loaded });
        } catch (error) {
            logger.warn('Failed to load persisted cache entries', { error: error.message });
        }
    }
}

// Create singleton instance
const cacheManager = new CacheManager({
    defaultTTL: 300000, // 5 minutes
    maxSize: 500, // Increased from 100 for better caching
    enablePersistence: false, // Disable for now to avoid complexity
});

/**
 * Initialize cache system with logger
 */
function initializeCache(loggerInstance) {
    logger = loggerInstance;
    return cacheManager;
}

/**
 * Express middleware for caching responses
 */
function cacheMiddleware(options = {}) {
    const {
        ttl = 300000, // 5 minutes default
        keyGenerator = req => `${req.method}:${req.originalUrl}`,
        varyHeaders = ['Accept-Encoding', 'User-Agent'],
        cacheControl = 'public, max-age=300',
    } = options;

    return (req, res, next) => {
        // Skip caching for certain conditions
        if (
            req.method !== 'GET' ||
            req.headers['cache-control'] === 'no-cache' ||
            req.query.nocache === '1'
        ) {
            return next();
        }

        const cacheKey = keyGenerator(req);
        const cached = cacheManager.get(cacheKey);

        // Handle conditional requests
        const clientETag = req.headers['if-none-match'];
        if (cached && clientETag === cached.etag) {
            res.status(304).end();
            return;
        }

        if (cached) {
            // Serve from cache
            const headers = {
                'Cache-Control': cacheControl,
                ETag: cached.etag,
                'X-Cache': 'HIT',
                Vary: varyHeaders.join(', '),
            };

            // Restore Content-Encoding header if it was cached
            if (cached.contentEncoding) {
                headers['Content-Encoding'] = cached.contentEncoding;
            }

            res.set(headers);

            // Set content type based on cached response
            if (cached.value && typeof cached.value === 'object') {
                res.json(cached.value);
            } else {
                res.send(cached.value);
            }
            return;
        }

        // Intercept response to cache it
        const originalSend = res.send;
        const originalJson = res.json;

        res.send = function (data) {
            if (res.statusCode === 200) {
                // Store the Content-Encoding header if present (for compressed responses)
                const contentEncoding = res.getHeader('Content-Encoding');
                const entry = cacheManager.set(cacheKey, data, ttl);
                if (entry && contentEncoding) {
                    entry.contentEncoding = contentEncoding;
                }
                if (entry) {
                    res.set({
                        'Cache-Control': cacheControl,
                        ETag: entry.etag,
                        'X-Cache': 'MISS',
                        Vary: varyHeaders.join(', '),
                    });
                }
            }
            return originalSend.call(this, data);
        };

        res.json = function (data) {
            if (res.statusCode === 200) {
                // Store the Content-Encoding header if present (for compressed responses)
                const contentEncoding = res.getHeader('Content-Encoding');
                const entry = cacheManager.set(cacheKey, data, ttl);
                if (entry && contentEncoding) {
                    entry.contentEncoding = contentEncoding;
                }
                if (entry) {
                    res.set({
                        'Cache-Control': cacheControl,
                        ETag: entry.etag,
                        'X-Cache': 'MISS',
                        Vary: varyHeaders.join(', '),
                    });
                }
            }
            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Cache disk management utilities
 */
class CacheDiskManager {
    constructor(imageCacheDir, config = {}) {
        this.imageCacheDir = imageCacheDir;
        this.maxSizeBytes = (config.maxSizeGB || 2) * 1024 * 1024 * 1024; // Convert GB to bytes
        this.minFreeDiskSpaceBytes = (config.minFreeDiskSpaceMB || 500) * 1024 * 1024; // Convert MB to bytes
        this.autoCleanup = config.autoCleanup !== false;
    }

    /**
     * Get disk usage for image cache directory
     */
    async getDiskUsage() {
        try {
            const fs = require('fs').promises;
            const path = require('path');

            let totalSize = 0;
            let fileCount = 0;

            const files = await fs.readdir(this.imageCacheDir, { withFileTypes: true });

            for (const file of files) {
                if (file.isFile()) {
                    const filePath = path.join(this.imageCacheDir, file.name);
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;
                    fileCount++;
                }
            }

            return {
                totalSizeBytes: totalSize,
                totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
                totalSizeGB: Math.round((totalSize / (1024 * 1024 * 1024)) * 100) / 100,
                fileCount,
                maxSizeBytes: this.maxSizeBytes,
                maxSizeGB: this.maxSizeBytes / (1024 * 1024 * 1024),
                usagePercentage: Math.round((totalSize / this.maxSizeBytes) * 100),
            };
        } catch (error) {
            logger.error('Failed to get cache disk usage', { error: error.message });
            return {
                totalSizeBytes: 0,
                totalSizeMB: 0,
                totalSizeGB: 0,
                fileCount: 0,
                maxSizeBytes: this.maxSizeBytes,
                maxSizeGB: this.maxSizeBytes / (1024 * 1024 * 1024),
                usagePercentage: 0,
            };
        }
    }

    /**
     * Get available disk space
     */
    async getFreeDiskSpace() {
        try {
            const { execSync } = require('child_process');
            const command =
                process.platform === 'win32'
                    ? `powershell "Get-PSDrive C | Select-Object Free"`
                    : `df -k "${this.imageCacheDir}" | tail -1 | awk '{print $4}'`;

            const output = execSync(command, { encoding: 'utf8' });

            if (process.platform === 'win32') {
                // Parse PowerShell output for Windows
                const match = output.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            } else {
                // Parse df output for Unix-like systems (result in KB)
                return parseInt(output.trim()) * 1024; // Convert KB to bytes
            }
        } catch (error) {
            logger.warn('Failed to get free disk space', { error: error.message });
            return 0;
        }
    }

    /**
     * Clean up old cache files to stay within limits
     */
    async cleanupCache() {
        try {
            const fs = require('fs').promises;
            const path = require('path');

            const usage = await this.getDiskUsage();
            const freeDiskSpace = await this.getFreeDiskSpace();

            // Check if cleanup is needed
            const needsCleanup =
                usage.totalSizeBytes > this.maxSizeBytes ||
                freeDiskSpace < this.minFreeDiskSpaceBytes;

            if (!needsCleanup) {
                return {
                    cleaned: false,
                    reason: 'No cleanup needed',
                    deletedFiles: 0,
                    freedSpaceBytes: 0,
                };
            }

            // Get all files with their access times
            const files = await fs.readdir(this.imageCacheDir, { withFileTypes: true });
            const fileStats = [];

            for (const file of files) {
                if (file.isFile()) {
                    const filePath = path.join(this.imageCacheDir, file.name);
                    const stats = await fs.stat(filePath);
                    fileStats.push({
                        name: file.name,
                        path: filePath,
                        size: stats.size,
                        atime: stats.atime,
                        mtime: stats.mtime,
                    });
                }
            }

            // Sort by oldest access time first
            fileStats.sort((a, b) => a.atime - b.atime);

            let deletedFiles = 0;
            let freedSpaceBytes = 0;
            let currentSize = usage.totalSizeBytes;

            // Delete files until we're within limits
            for (const file of fileStats) {
                const shouldDelete =
                    currentSize > this.maxSizeBytes ||
                    freeDiskSpace + freedSpaceBytes < this.minFreeDiskSpaceBytes;

                if (!shouldDelete) break;

                try {
                    await fs.unlink(file.path);
                    deletedFiles++;
                    freedSpaceBytes += file.size;
                    currentSize -= file.size;

                    logger.debug('Deleted cache file', {
                        file: file.name,
                        size: file.size,
                        freedTotal: freedSpaceBytes,
                    });
                } catch (deleteError) {
                    logger.warn('Failed to delete cache file', {
                        file: file.name,
                        error: deleteError.message,
                    });
                }
            }

            logger.info('Cache cleanup completed', {
                deletedFiles,
                freedSpaceMB: Math.round((freedSpaceBytes / (1024 * 1024)) * 100) / 100,
                newSizeGB: Math.round((currentSize / (1024 * 1024 * 1024)) * 100) / 100,
            });

            return {
                cleaned: true,
                deletedFiles,
                freedSpaceBytes,
                freedSpaceMB: Math.round((freedSpaceBytes / (1024 * 1024)) * 100) / 100,
                newSizeBytes: currentSize,
                newSizeGB: Math.round((currentSize / (1024 * 1024 * 1024)) * 100) / 100,
            };
        } catch (error) {
            logger.error('Failed to cleanup cache', { error: error.message });
            return { cleaned: false, error: error.message, deletedFiles: 0, freedSpaceBytes: 0 };
        }
    }

    /**
     * Update cache configuration
     */
    updateConfig(config) {
        // Preserve existing values if new config doesn't specify them
        const newMaxSizeGB =
            config.maxSizeGB !== undefined
                ? config.maxSizeGB
                : this.maxSizeBytes / (1024 * 1024 * 1024);
        const newMinFreeMB =
            config.minFreeDiskSpaceMB !== undefined
                ? config.minFreeDiskSpaceMB
                : this.minFreeDiskSpaceBytes / (1024 * 1024);

        // Check if values actually changed to avoid noisy logging
        const oldMaxSizeGB = this.maxSizeBytes / (1024 * 1024 * 1024);
        const oldMinFreeMB = this.minFreeDiskSpaceBytes / (1024 * 1024);
        const hasChanged =
            Math.abs(oldMaxSizeGB - newMaxSizeGB) > 0.01 ||
            Math.abs(oldMinFreeMB - newMinFreeMB) > 0.01 ||
            this.autoCleanup !== (config.autoCleanup !== false);

        this.maxSizeBytes = newMaxSizeGB * 1024 * 1024 * 1024;
        this.minFreeDiskSpaceBytes = newMinFreeMB * 1024 * 1024;
        this.autoCleanup = config.autoCleanup !== false;

        // Only log at INFO level if values actually changed meaningfully
        if (hasChanged) {
            logger.info('Cache configuration updated', {
                maxSizeGB: newMaxSizeGB,
                minFreeDiskSpaceMB: newMinFreeMB,
                autoCleanup: this.autoCleanup,
            });
        } else {
            logger.debug('Cache configuration unchanged', {
                maxSizeGB: newMaxSizeGB,
                minFreeDiskSpaceMB: newMinFreeMB,
                autoCleanup: this.autoCleanup,
            });
        }
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        // No timers to cleanup for disk manager currently
        logger.debug('Cache disk manager cleaned up');
    }
}

module.exports = {
    CacheManager,
    cacheManager,
    cacheMiddleware,
    initializeCache,
    CacheDiskManager,
};
