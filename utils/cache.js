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
 */
class CacheManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.timers = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            errors: 0,
            lastReset: Date.now(),
        };
        this.config = {
            defaultTTL: options.defaultTTL || 300000, // 5 minutes default
            maxSize: options.maxSize || 100, // Max cache entries
            persistPath: options.persistPath || path.resolve(__dirname, '../cache'),
            enablePersistence: options.enablePersistence || false,
            enableCompression: options.enableCompression || false,
        };

        // Start periodic cleanup
        this.startPeriodicCleanup();

        logger.debug('Cache manager initialized', {
            defaultTTL: this.config.defaultTTL,
            maxSize: this.config.maxSize,
            persistPath: this.config.persistPath,
            enablePersistence: this.config.enablePersistence,
            enableCompression: this.config.enableCompression,
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

        // Clear all timers
        for (const [, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();

        // Clear cache
        this.cache.clear();

        logger.debug('Cache manager cleaned up');
    }

    /**
     * Cleanup expired entries manually
     */
    cleanupExpired() {
        let expired = 0;
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (now >= entry.expiresAt) {
                this.delete(key);
                expired++;
            }
        }

        if (expired > 0) {
            logger.info(`Cache cleanup: removed ${expired} expired entries`);
        }

        return expired;
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
     * Set cache entry with optional TTL
     */
    set(key, value, ttl) {
        try {
            this.stats.sets++;

            // Check cache size limit
            if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
                // Remove oldest entry (LRU-like)
                const firstKey = this.cache.keys().next().value;
                this.delete(firstKey);
                logger.debug('Cache size limit reached, removed oldest entry', {
                    removedKey: firstKey,
                });
            }

            // Clear existing timer if updating
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
            }

            const ttlMs = typeof ttl === 'number' ? ttl : this.config.defaultTTL;
            const expiresAt = Date.now() + ttlMs;
            const etag = this.generateETag(value);

            const entry = {
                value,
                etag,
                createdAt: Date.now(),
                expiresAt,
                accessCount: 0,
                lastAccessed: Date.now(),
            };

            this.cache.set(key, entry);

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
            const entry = this.cache.get(key);

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
        const entry = this.cache.get(key);
        if (!entry) return false;
        return Date.now() < entry.expiresAt;
    }

    /**
     * Delete cache entry
     */
    delete(key) {
        try {
            // Clear timer
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
                this.timers.delete(key);
            }

            const deleted = this.cache.delete(key);

            if (deleted) {
                this.stats.deletes++;
                logger.debug('Cache entry deleted', { key, cacheSize: this.cache.size });
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

        return {
            // Basic stats
            size: this.cache.size,
            maxSize: this.config.maxSize,
            hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,

            // Request stats
            totalRequests,
            hits: this.stats.hits,
            misses: this.stats.misses,

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

            // Memory usage
            memoryUsage: this.cache.size * 1024, // rough estimate in bytes

            // Cleanup stats
            lastCleanup: this.stats.lastCleanup,
            cleanupCount: this.stats.cleanups,
        };
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
    maxSize: 100,
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

        this.maxSizeBytes = newMaxSizeGB * 1024 * 1024 * 1024;
        this.minFreeDiskSpaceBytes = newMinFreeMB * 1024 * 1024;
        this.autoCleanup = config.autoCleanup !== false;

        logger.info('Cache configuration updated', {
            maxSizeGB: newMaxSizeGB,
            minFreeDiskSpaceMB: newMinFreeMB,
            autoCleanup: this.autoCleanup,
        });
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
