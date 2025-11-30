/**
 * Media API Routes
 * Express routes for media fetching and source management
 */

const express = require('express');
const logger = require('./logger');

/**
 * Create media API routes
 * @param {Object} mediaManager - Media sources manager instance
 * @param {Object} middleware - Middleware functions
 * @returns {express.Router} Express router with media routes
 */
function createMediaRoutes(mediaManager, middleware = {}) {
    const router = express.Router();
    const { asyncHandler, cacheMiddleware } = middleware;

    /**
     * GET /get-media
     * Fetch media from configured sources
     *
     * Query params:
     * - source: plex|jellyfin|romm|tmdb|local|all (default: all)
     * - type: movie|show|game (default: movie)
     * - count: number of items (default: 50)
     * - libraries: comma-separated library names (for plex/jellyfin)
     * - platforms: comma-separated platform slugs (for romm)
     * - sourceName: specific source name to use
     */
    router.get(
        '/get-media',
        cacheMiddleware || ((req, res, next) => next()),
        asyncHandler(async (req, res) => {
            const {
                source = 'all',
                type = 'movie',
                count = 50,
                libraries,
                platforms,
                sourceName,
            } = req.query;

            const parsedCount = parseInt(count, 10) || 50;

            logger.info(
                `[Media API] Fetching media: source=${source}, type=${type}, count=${parsedCount}`
            );

            try {
                const options = {};
                if (libraries) {
                    options.libraries = libraries.split(',').map(l => l.trim());
                }
                if (platforms) {
                    options.platforms = platforms.split(',').map(p => p.trim());
                }
                if (sourceName) {
                    options.sourceName = sourceName;
                }

                const media = await mediaManager.fetchMedia(source, type, parsedCount, options);

                res.json(media);
            } catch (error) {
                logger.error('[Media API] Error fetching media:', error);
                res.status(500).json({
                    error: 'Failed to fetch media',
                    message: error.message,
                });
            }
        })
    );

    /**
     * GET /api/media/sources
     * Get list of all configured sources
     */
    router.get('/api/media/sources', (req, res) => {
        const sources = mediaManager.getAllSources().map(wrapper => ({
            key: Array.from(mediaManager.sources.entries()).find(([, v]) => v === wrapper)[0],
            type: wrapper.type,
            name: wrapper.name,
            enabled: wrapper.config.enabled !== false,
        }));

        res.json(sources);
    });

    /**
     * GET /api/media/metrics
     * Get performance metrics from all sources
     */
    router.get('/api/media/metrics', (req, res) => {
        const metrics = mediaManager.getMetrics();
        res.json(metrics);
    });

    /**
     * POST /api/media/reset-metrics
     * Reset performance metrics
     */
    router.post('/api/media/reset-metrics', (req, res) => {
        mediaManager.resetMetrics();
        res.json({ success: true, message: 'Metrics reset' });
    });

    /**
     * GET /api/media/platforms
     * Get available platforms from RomM sources
     */
    router.get(
        '/api/media/platforms',
        asyncHandler(async (req, res) => {
            const rommSources = mediaManager.getSourcesByType('romm');

            if (rommSources.length === 0) {
                return res.json([]);
            }

            const allPlatforms = [];

            for (const wrapper of rommSources) {
                try {
                    const platforms = await wrapper.source.getAvailablePlatforms();
                    allPlatforms.push({
                        server: wrapper.name,
                        platforms,
                    });
                } catch (error) {
                    logger.error(
                        `[Media API] Error fetching platforms from ${wrapper.name}:`,
                        error.message
                    );
                }
            }

            res.json(allPlatforms);
        })
    );

    return router;
}

module.exports = { createMediaRoutes };
