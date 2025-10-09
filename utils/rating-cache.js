/**
 * Rating Cache Manager
 * Handles caching of ratings for different media sources to ensure consistent filter options
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class RatingCacheManager {
    constructor() {
        this.cachePath = path.join(__dirname, '..', 'cache', 'ratings.json');
        this.cache = {};
        this.loadCache();
    }

    /**
     * Load rating cache from disk
     */
    async loadCache() {
        try {
            const data = await fs.readFile(this.cachePath, 'utf8');
            this.cache = JSON.parse(data);
            logger.debug('[RatingCache] Loaded cache from disk', this.cache);
        } catch (error) {
            // File doesn't exist or is invalid, start with empty cache
            this.cache = {};
            logger.debug('[RatingCache] Starting with empty cache');
        }
    }

    /**
     * Save rating cache to disk
     */
    async saveCache() {
        try {
            // Ensure cache directory exists
            const cacheDir = path.dirname(this.cachePath);
            try {
                await fs.access(cacheDir);
            } catch {
                await fs.mkdir(cacheDir, { recursive: true });
            }

            await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2));
            logger.debug('[RatingCache] Saved cache to disk');
        } catch (error) {
            logger.error('[RatingCache] Failed to save cache:', error.message);
        }
    }

    /**
     * Get cached ratings for a source type
     * @param {string} sourceType - The source type (jellyfin, plex, etc.)
     * @returns {Array<string>} Array of ratings
     */
    getRatings(sourceType) {
        const sourceCache = this.cache[sourceType];
        if (!sourceCache) {
            return [];
        }

        // Check if cache is still valid (24 hours)
        const cacheAge = Date.now() - sourceCache.timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        if (cacheAge > maxAge) {
            logger.debug(
                `[RatingCache] Cache for ${sourceType} is stale (${Math.round(cacheAge / 1000 / 60)} minutes old)`
            );
            return [];
        }

        return sourceCache.ratings || [];
    }

    /**
     * Set ratings for a source type
     * @param {string} sourceType - The source type
     * @param {Array<string>} ratings - Array of ratings
     */
    async setRatings(sourceType, ratings) {
        this.cache[sourceType] = {
            ratings: ratings.sort(), // Keep sorted
            timestamp: Date.now(),
            count: ratings.length,
        };

        await this.saveCache();
        logger.info(`[RatingCache] Updated cache for ${sourceType}: ${ratings.length} ratings`);
    }

    /**
     * Check if cache is valid for a source type
     * @param {string} sourceType - The source type
     * @returns {boolean} True if cache is valid
     */
    isCacheValid(sourceType) {
        const sourceCache = this.cache[sourceType];
        if (!sourceCache) {
            return false;
        }

        const cacheAge = Date.now() - sourceCache.timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        return cacheAge <= maxAge;
    }

    /**
     * Invalidate cache for a source type
     * @param {string} sourceType - The source type
     */
    async invalidateCache(sourceType) {
        if (this.cache[sourceType]) {
            delete this.cache[sourceType];
            await this.saveCache();
            logger.info(`[RatingCache] Invalidated cache for ${sourceType}`);
        }
    }

    /**
     * Get cache stats
     * @returns {Object} Cache statistics
     */
    getStats() {
        const stats = {};

        for (const [sourceType, sourceCache] of Object.entries(this.cache)) {
            const cacheAge = Date.now() - sourceCache.timestamp;
            const isValid = cacheAge <= 24 * 60 * 60 * 1000;

            stats[sourceType] = {
                ratingsCount: sourceCache.count || 0,
                lastUpdated: new Date(sourceCache.timestamp).toISOString(),
                ageMinutes: Math.round(cacheAge / 1000 / 60),
                isValid,
            };
        }

        return stats;
    }
}

module.exports = new RatingCacheManager();
