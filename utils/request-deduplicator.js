const crypto = require('crypto');

// Logger will be passed in during initialization
let logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
};

/**
 * Request Deduplication System
 * Prevents duplicate concurrent requests by tracking in-flight requests
 * and returning shared promises for identical requests.
 */
class RequestDeduplicator {
    constructor(options = {}) {
        this.inFlight = new Map(); // key -> { promise, timestamp, requestCount }
        this.stats = {
            totalRequests: 0,
            deduplicated: 0,
            completed: 0,
            failed: 0,
            lastReset: Date.now(),
        };
        this.config = {
            keyPrefix: options.keyPrefix || 'req',
            timeout: options.timeout || 30000, // 30 seconds default
            enableStats: options.enableStats !== false,
        };

        // Cleanup stale requests periodically
        this.startPeriodicCleanup();

        logger.debug('Request deduplicator initialized', {
            keyPrefix: this.config.keyPrefix,
            timeout: this.config.timeout,
        });
    }

    /**
     * Generate cache key for request deduplication
     */
    generateKey(method, ...args) {
        const parts = [this.config.keyPrefix, method, ...args.map(arg => JSON.stringify(arg))];
        return crypto.createHash('md5').update(parts.join('|')).digest('hex');
    }

    /**
     * Deduplicate a request
     * Returns existing promise if request is in-flight, otherwise executes the request
     */
    async deduplicate(key, requestFn) {
        this.stats.totalRequests++;

        // Check if request is already in-flight
        if (this.inFlight.has(key)) {
            const existing = this.inFlight.get(key);
            existing.requestCount++;
            this.stats.deduplicated++;

            logger.debug('Request deduplicated', {
                key,
                requestCount: existing.requestCount,
                age: Date.now() - existing.timestamp,
            });

            return existing.promise;
        }

        // Execute new request
        const timestamp = Date.now();
        const promise = this._executeRequest(key, requestFn, timestamp);

        this.inFlight.set(key, {
            promise,
            timestamp,
            requestCount: 1,
        });

        return promise;
    }

    /**
     * Execute request with timeout and cleanup
     */
    async _executeRequest(key, requestFn, timestamp) {
        try {
            // Create timeout promise
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), this.config.timeout)
            );

            // Race between request and timeout
            const result = await Promise.race([requestFn(), timeoutPromise]);

            this.stats.completed++;

            const duration = Date.now() - timestamp;
            const flight = this.inFlight.get(key);

            logger.debug('Request completed', {
                key,
                duration,
                requestCount: flight?.requestCount || 1,
            });

            // Cleanup
            this.inFlight.delete(key);

            return result;
        } catch (error) {
            this.stats.failed++;

            logger.warn('Request failed', {
                key,
                error: error.message,
                duration: Date.now() - timestamp,
            });

            // Cleanup on error
            this.inFlight.delete(key);

            throw error;
        }
    }

    /**
     * Wrap a function with deduplication
     * Returns a new function that automatically deduplicates calls
     */
    wrap(method, fn) {
        return async (...args) => {
            const key = this.generateKey(method, ...args);
            return this.deduplicate(key, () => fn(...args));
        };
    }

    /**
     * Get current statistics
     */
    getStats() {
        const uptime = Date.now() - this.stats.lastReset;
        const deduplicationRate =
            this.stats.totalRequests > 0
                ? ((this.stats.deduplicated / this.stats.totalRequests) * 100).toFixed(2)
                : 0;

        return {
            ...this.stats,
            inFlight: this.inFlight.size,
            uptime,
            deduplicationRate: `${deduplicationRate}%`,
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            deduplicated: 0,
            completed: 0,
            failed: 0,
            lastReset: Date.now(),
        };

        logger.info('Request deduplicator stats reset');
    }

    /**
     * Clear all in-flight requests
     */
    clear() {
        this.inFlight.clear();
        logger.debug('Request deduplicator cleared');
    }

    /**
     * Start periodic cleanup of stale requests
     */
    startPeriodicCleanup() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupStale();
        }, 60 * 1000); // Every minute
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
     * Cleanup stale in-flight requests
     */
    cleanupStale() {
        const now = Date.now();
        let stale = 0;

        for (const [key, flight] of this.inFlight.entries()) {
            const age = now - flight.timestamp;
            if (age > this.config.timeout) {
                this.inFlight.delete(key);
                stale++;
            }
        }

        if (stale > 0) {
            logger.warn(`Cleaned up ${stale} stale in-flight requests`);
        }
    }

    /**
     * Cleanup all resources
     */
    cleanup() {
        this.stopPeriodicCleanup();
        this.clear();
        logger.debug('Request deduplicator cleaned up');
    }
}

/**
 * Initialize logger
 */
function initializeDeduplicator(loggerInstance) {
    logger = loggerInstance;
}

module.exports = {
    RequestDeduplicator,
    initializeDeduplicator,
};
