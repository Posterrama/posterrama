/**
 * API Response Caching Middleware
 * Implements intelligent caching for API responses
 */

const logger = require('../utils/logger');

class ApiCache {
    constructor(defaultTTL = 5 * 60 * 1000) {
        // 5 minutes default
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
        };

        // Cleanup expired entries every 2 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 2 * 60 * 1000);
    }

    /**
     * Stop cleanup interval and clean resources
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.cache.clear();
    }

    /**
     * Generate cache key from request
     */
    generateKey(req) {
        const { method, url, query, body } = req;
        const keyData = {
            method,
            url: url.split('?')[0], // Remove query params from URL
            query: this.sortObject(query || {}),
            body: method === 'POST' ? this.sortObject(body || {}) : undefined,
        };
        return JSON.stringify(keyData);
    }

    /**
     * Sort object keys for consistent cache keys
     */
    sortObject(obj) {
        if (typeof obj !== 'object' || obj === null) return obj;

        const sorted = {};
        Object.keys(obj)
            .sort()
            .forEach(key => {
                sorted[key] = obj[key];
            });
        return sorted;
    }

    /**
     * Get cached response
     */
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            this.stats.misses++;
            return null;
        }

        if (Date.now() > cached.expiresAt) {
            this.cache.delete(key);
            this.stats.misses++;
            return null;
        }

        this.stats.hits++;
        cached.lastAccessed = Date.now();
        return cached.data;
    }

    /**
     * Set cached response
     */
    set(key, data, ttl = this.defaultTTL) {
        this.cache.set(key, {
            data,
            createdAt: Date.now(),
            expiresAt: Date.now() + ttl,
            lastAccessed: Date.now(),
        });
        this.stats.sets++;
    }

    /**
     * Delete cached response
     */
    delete(key) {
        if (this.cache.delete(key)) {
            this.stats.deletes++;
            return true;
        }
        return false;
    }

    /**
     * Clear all cached responses
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats.deletes += size;
        logger.info('API cache cleared', { deletedEntries: size });
    }

    /**
     * Cleanup expired entries
     */
    cleanup() {
        const now = Date.now();
        let deletedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            logger.info('API cache cleanup completed', {
                deletedEntries: deletedCount,
                remainingEntries: this.cache.size,
            });
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const totalRequests = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            totalRequests,
            hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
            size: this.cache.size,
            memoryUsage: this.cache.size * 1024, // rough estimate
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
        };
    }
}

// Global cache instance
const apiCache = new ApiCache();

/**
 * Middleware factory for API response caching
 */
function createCacheMiddleware(options = {}) {
    const {
        ttl = 5 * 60 * 1000, // 5 minutes
        methods = ['GET'], // Only cache GET requests by default
        skipIf = () => false, // Function to skip caching
        keyGenerator = null, // Custom key generator
    } = options;

    return (req, res, next) => {
        // Skip if method not allowed
        if (!methods.includes(req.method)) {
            return next();
        }

        // Skip if custom condition is met
        if (skipIf(req, res)) {
            return next();
        }

        // Generate cache key
        const cacheKey = keyGenerator ? keyGenerator(req) : apiCache.generateKey(req);

        // Try to get cached response
        const cachedResponse = apiCache.get(cacheKey);
        if (cachedResponse) {
            res.set('X-Cache', 'HIT');
            res.set('X-Cache-Key', cacheKey.substring(0, 32) + '...');
            return res.json(cachedResponse);
        }

        // Override res.json to cache response
        const originalJson = res.json;
        res.json = function (data) {
            // Only cache successful responses that are not "building" or error states
            const shouldCache =
                res.statusCode >= 200 &&
                res.statusCode < 300 &&
                !(data && (data.status === 'building' || data.status === 'failed'));

            if (shouldCache) {
                apiCache.set(cacheKey, data, ttl);
                res.set('X-Cache', 'MISS');
                res.set('X-Cache-Key', cacheKey.substring(0, 32) + '...');
            } else {
                res.set('X-Cache', 'SKIP');
            }
            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Specific cache middleware for different endpoints
 *
 * TTL Strategy (optimized for performance):
 * - Static content (config, genres, libraries): Long TTL (hours)
 * - Semi-static (media listings): Medium TTL (minutes to hour)
 * - Dynamic (device status, groups): Short TTL (1-2 minutes)
 */
const cacheMiddleware = {
    // Very short cache for highly dynamic data (device status)
    veryShort: createCacheMiddleware({ ttl: 1 * 60 * 1000 }), // 1 minute

    // Short cache for frequently changing data (groups, filtered media)
    short: createCacheMiddleware({ ttl: 2 * 60 * 1000 }), // 2 minutes

    // Medium cache for semi-static data (unfiltered media)
    medium: createCacheMiddleware({ ttl: 30 * 60 * 1000 }), // 30 minutes

    // Long cache for static data (libraries)
    long: createCacheMiddleware({ ttl: 2 * 60 * 60 * 1000 }), // 2 hours

    // Very long cache for highly static data (genres, ratings)
    veryLong: createCacheMiddleware({ ttl: 4 * 60 * 60 * 1000 }), // 4 hours

    // Media cache for media listings (differentiated by filters)
    media: createCacheMiddleware({
        ttl: 30 * 60 * 1000, // 30 minutes (unfiltered content)
        skipIf: req =>
            req.query.nocache === 'true' ||
            req.query.musicMode === '1' ||
            req.query.musicMode === 'true' ||
            req.query.gamesOnly === '1' ||
            req.query.gamesOnly === 'true',
    }),

    // Filtered media cache (shorter TTL for user-specific filters)
    mediaFiltered: createCacheMiddleware({
        ttl: 5 * 60 * 1000, // 5 minutes (filtered content)
        skipIf: req =>
            req.query.nocache === 'true' ||
            req.query.musicMode === '1' ||
            req.query.musicMode === 'true' ||
            req.query.gamesOnly === '1' ||
            req.query.gamesOnly === 'true',
    }),

    // Config cache for configuration data
    config: createCacheMiddleware({
        ttl: 4 * 60 * 60 * 1000, // 4 hours (rarely changes)
        skipIf: req => req.method !== 'GET',
    }),
};

module.exports = {
    ApiCache,
    apiCache,
    createCacheMiddleware,
    cacheMiddleware,
};
