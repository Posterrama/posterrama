/**
 * Admin Cache Metrics Routes
 *
 * Provides endpoints for monitoring cache performance and health.
 * Supports detailed metrics, hit ratios, and optimization recommendations.
 */

const express = require('express');

/**
 * Create admin cache metrics router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.asyncHandler - Async error handler middleware
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @returns {express.Router} Configured router
 */
module.exports = function createAdminCacheRouter({ _logger, asyncHandler, adminAuth }) {
    const router = express.Router();

    // Cache instances (set via initCacheReferences)
    let cacheManager = null;
    let apiCache = null;

    /**
     * Initialize cache references
     * Called from server.js after cache instances are created
     */
    router.initCacheReferences = function (cacheManagerInstance, apiCacheInstance) {
        cacheManager = cacheManagerInstance;
        apiCache = apiCacheInstance;
    };

    /**
     * @swagger
     * /api/admin/cache/metrics:
     *   get:
     *     summary: Get detailed cache metrics
     *     description: Returns comprehensive cache statistics including hit ratios, memory usage, and performance recommendations
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache metrics retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 metrics:
     *                   type: object
     *                   properties:
     *                     memory:
     *                       type: object
     *                       description: Memory cache metrics
     *                     api:
     *                       type: object
     *                       description: API cache metrics
     *                     combined:
     *                       type: object
     *                       description: Combined cache statistics
     *       401:
     *         description: Unauthorized - authentication required
     *       500:
     *         description: Server error retrieving cache metrics
     */
    router.get(
        '/api/admin/cache/metrics',
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            // Get detailed stats from all cache instances
            const memoryStats = cacheManager.getDetailedStats();
            const apiStats = apiCache ? apiCache.getDetailedStats() : null;

            // Calculate combined metrics
            const combinedMetrics = {
                totalHits: memoryStats.hits + (apiStats?.hits || 0),
                totalMisses: memoryStats.misses + (apiStats?.misses || 0),
                totalRequests: memoryStats.totalRequests + (apiStats?.totalRequests || 0),
                combinedHitRatio:
                    memoryStats.totalRequests + (apiStats?.totalRequests || 0) > 0
                        ? Math.round(
                              ((memoryStats.hits + (apiStats?.hits || 0)) /
                                  (memoryStats.totalRequests + (apiStats?.totalRequests || 0))) *
                                  10000
                          ) / 100
                        : 0,
                totalSize: memoryStats.size + (apiStats?.size || 0),
                totalMemoryMB:
                    memoryStats.memoryUsage.totalMB + (apiStats?.memoryUsage?.totalMB || 0),
            };

            res.json({
                success: true,
                metrics: {
                    memory: memoryStats,
                    api: apiStats,
                    combined: combinedMetrics,
                },
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/metrics/summary:
     *   get:
     *     summary: Get cache metrics summary
     *     description: Returns a simplified view of cache performance
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache summary retrieved successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/cache/metrics/summary',
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            const memStats = cacheManager.getStats();
            const apiStats = apiCache ? apiCache.getStats() : null;

            const memHitRatio = Math.round(memStats.hitRate * 10000) / 100;
            const apiHitRatio = apiStats ? Math.round(apiStats.hitRate * 10000) / 100 : 0;
            const totalRequests = memStats.totalRequests + (apiStats?.totalRequests || 0);
            const totalHits = memStats.hits + (apiStats?.hits || 0);
            const combinedHitRatio =
                totalRequests > 0 ? Math.round((totalHits / totalRequests) * 10000) / 100 : 0;

            res.json({
                success: true,
                totalRequests,
                combinedHitRatio,
                memoryHitRatio: memHitRatio,
                apiHitRatio,
                totalMemoryMB: memStats.memoryUsage.totalMB + (apiStats?.memoryUsage?.totalMB || 0),
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/recommendations:
     *   get:
     *     summary: Get cache optimization recommendations
     *     description: Returns actionable recommendations for cache optimization
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Recommendations retrieved successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/cache/recommendations',
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            const memoryRecommendations = cacheManager.getCacheRecommendations();
            const apiRecommendations = apiCache ? apiCache.getCacheRecommendations() : [];

            // Combine and deduplicate recommendations
            const allRecommendations = [
                ...memoryRecommendations.map(r => ({ ...r, source: 'memory' })),
                ...apiRecommendations.map(r => ({ ...r, source: 'api' })),
            ];

            // Sort by severity: high > medium > info
            const severityOrder = { high: 0, medium: 1, info: 2 };
            allRecommendations.sort((a, b) => {
                return severityOrder[a.severity] - severityOrder[b.severity];
            });

            res.json({
                success: true,
                recommendations: allRecommendations,
                count: {
                    high: allRecommendations.filter(r => r.severity === 'high').length,
                    medium: allRecommendations.filter(r => r.severity === 'medium').length,
                    info: allRecommendations.filter(r => r.severity === 'info').length,
                    total: allRecommendations.length,
                },
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/reset:
     *   post:
     *     summary: Reset cache statistics
     *     description: Resets hit/miss counters and access counts (does not clear cached data)
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache statistics reset successfully
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/api/admin/cache/reset',
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            cacheManager.resetStats();
            if (apiCache) {
                apiCache.resetStats();
            }

            res.json({
                success: true,
                message: 'Cache statistics reset successfully',
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/clear:
     *   post:
     *     summary: Clear all cached data
     *     description: Removes all entries from memory and API caches
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache cleared successfully
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/api/admin/cache/clear',
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            const memoryCleared = cacheManager.cache.size;
            const apiCleared = apiCache ? apiCache.cache.size : 0;

            cacheManager.cache.clear();
            if (apiCache) {
                apiCache.cache.clear();
            }

            res.json({
                success: true,
                message: 'Cache cleared successfully',
                cleared: {
                    memory: memoryCleared,
                    api: apiCleared,
                    total: memoryCleared + apiCleared,
                },
                timestamp: new Date().toISOString(),
            });
        })
    );

    return router;
};
