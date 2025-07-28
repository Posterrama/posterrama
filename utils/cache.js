const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

// Logger will be passed in during initialization to avoid circular dependencies
let logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
};

/**
 * In-memory cache with TTL and storage capabilities
 */
class CacheManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.timers = new Map();
        this.config = {
            defaultTTL: options.defaultTTL || 300000, // 5 minutes default
            maxSize: options.maxSize || 100, // Max cache entries
            persistPath: options.persistPath || path.resolve(__dirname, '../cache'),
            enablePersistence: options.enablePersistence || false
        };
        
        logger.debug('Cache manager initialized', {
            defaultTTL: this.config.defaultTTL,
            maxSize: this.config.maxSize,
            persistPath: this.config.persistPath,
            enablePersistence: this.config.enablePersistence
        });
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
            // Check cache size limit
            if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
                // Remove oldest entry
                const firstKey = this.cache.keys().next().value;
                this.delete(firstKey);
                logger.debug('Cache size limit reached, removed oldest entry', { removedKey: firstKey });
            }

            // Clear existing timer if updating
            if (this.timers.has(key)) {
                clearTimeout(this.timers.get(key));
            }

            const expiresAt = Date.now() + (ttl || this.config.defaultTTL);
            const etag = this.generateETag(value);
            
            const entry = {
                value,
                etag,
                createdAt: Date.now(),
                expiresAt,
                accessCount: 0,
                lastAccessed: Date.now()
            };

            this.cache.set(key, entry);

            // Set expiration timer
            const timer = setTimeout(() => {
                this.delete(key);
                logger.debug('Cache entry expired', { key });
            }, ttl || this.config.defaultTTL);

            this.timers.set(key, timer);

            logger.debug('Cache entry set', { 
                key, 
                ttl: ttl || this.config.defaultTTL,
                etag,
                cacheSize: this.cache.size 
            });

            // Persist if enabled
            if (this.config.enablePersistence) {
                this.persistEntry(key, entry).catch(err => 
                    logger.warn('Failed to persist cache entry', { key, error: err.message })
                );
            }

            return entry;
        } catch (error) {
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
                logger.debug('Cache miss', { key });
                return null;
            }

            // Check if expired
            if (Date.now() > entry.expiresAt) {
                this.delete(key);
                logger.debug('Cache entry expired on access', { key });
                return null;
            }

            // Update access statistics
            entry.accessCount++;
            entry.lastAccessed = Date.now();

            logger.debug('Cache hit', { 
                key, 
                accessCount: entry.accessCount,
                age: Date.now() - entry.createdAt 
            });

            return entry;
        } catch (error) {
            logger.error('Failed to get cache entry', { key, error: error.message });
            return null;
        }
    }

    /**
     * Check if entry exists and is valid
     */
    has(key) {
        const entry = this.cache.get(key);
        return entry && Date.now() <= entry.expiresAt;
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
                logger.debug('Cache entry deleted', { key, cacheSize: this.cache.size });
            }

            return deleted;
        } catch (error) {
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
        
        return {
            size: this.cache.size,
            maxSize: this.config.maxSize,
            entries: entries.map(entry => ({
                age: now - entry.createdAt,
                ttl: entry.expiresAt - now,
                accessCount: entry.accessCount,
                lastAccessed: now - entry.lastAccessed
            })),
            totalAccess: entries.reduce((sum, entry) => sum + entry.accessCount, 0),
            hitRate: entries.length > 0 ? 
                entries.reduce((sum, entry) => sum + entry.accessCount, 0) / entries.length : 0
        };
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
            
            await fs.writeFile(filepath, JSON.stringify({
                key,
                ...entry
            }, null, 2));
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
                            lastAccessed: data.lastAccessed || data.createdAt
                        });
                        loaded++;
                    } else {
                        // Remove expired persisted entry
                        await fs.unlink(filepath);
                    }
                } catch (err) {
                    logger.warn('Failed to load persisted cache entry', { 
                        file, 
                        error: err.message 
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
    enablePersistence: false // Disable for now to avoid complexity
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
        keyGenerator = (req) => `${req.method}:${req.originalUrl}`,
        varyHeaders = ['Accept-Encoding', 'User-Agent'],
        cacheControl = 'public, max-age=300'
    } = options;

    return (req, res, next) => {
        // Skip caching for certain conditions
        if (req.method !== 'GET' || 
            req.headers['cache-control'] === 'no-cache' ||
            req.query.nocache === '1') {
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
            res.set({
                'Cache-Control': cacheControl,
                'ETag': cached.etag,
                'X-Cache': 'HIT',
                'Vary': varyHeaders.join(', ')
            });

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

        res.send = function(data) {
            if (res.statusCode === 200) {
                const entry = cacheManager.set(cacheKey, data, ttl);
                if (entry) {
                    res.set({
                        'Cache-Control': cacheControl,
                        'ETag': entry.etag,
                        'X-Cache': 'MISS',
                        'Vary': varyHeaders.join(', ')
                    });
                }
            }
            return originalSend.call(this, data);
        };

        res.json = function(data) {
            if (res.statusCode === 200) {
                const entry = cacheManager.set(cacheKey, data, ttl);
                if (entry) {
                    res.set({
                        'Cache-Control': cacheControl,
                        'ETag': entry.etag,
                        'X-Cache': 'MISS',
                        'Vary': varyHeaders.join(', ')
                    });
                }
            }
            return originalJson.call(this, data);
        };

        next();
    };
}

module.exports = {
    cacheManager,
    cacheMiddleware,
    initializeCache
};
