/**
 * Admin Performance Metrics Routes
 *
 * Provides endpoints for monitoring system performance, request metrics,
 * cache health, WebSocket status, and source API health.
 */

const express = require('express');

/**
 * Create admin performance metrics router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.metricsManager - Metrics manager instance
 * @param {Object} deps.cacheManager - Cache manager instance
 * @param {Object} deps.wsHub - WebSocket hub instance
 * @param {Object} deps.config - Config instance
 * @param {Function} deps.asyncHandler - Async error handler middleware
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @returns {express.Router} Configured router
 */
module.exports = function createAdminPerformanceRouter({
    logger,
    metricsManager,
    cacheManager,
    wsHub,
    config,
    asyncHandler,
    adminAuth,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /api/admin/performance/metrics:
     *   get:
     *     summary: Get comprehensive performance metrics
     *     description: Returns detailed performance data including requests, cache, WebSocket, and source health
     *     tags:
     *       - Admin
     *       - Performance
     *     security:
     *       - basicAuth: []
     *     parameters:
     *       - in: query
     *         name: period
     *         schema:
     *           type: string
     *           enum: [15m, 1h, 6h, 24h, 7d]
     *           default: 24h
     *         description: Time period for historical data
     *     responses:
     *       200:
     *         description: Performance metrics retrieved successfully
     *       401:
     *         description: Unauthorized
     *       500:
     *         description: Server error
     */
    router.get(
        '/api/admin/performance/metrics',
        adminAuth,
        asyncHandler(async (req, res) => {
            const period = req.query.period || '24h';

            try {
                // Get request metrics
                const performanceMetrics = metricsManager.getPerformanceMetrics();
                const endpointMetrics = metricsManager.getEndpointMetrics();
                const errorMetrics = metricsManager.getErrorMetrics();
                const systemMetrics = metricsManager.getSystemMetrics();
                const realtimeMetrics = metricsManager.getRealTimeMetrics();

                // Get aggregated time-series data
                const aggregatedData = metricsManager.getAggregatedMetrics(period);

                // Get cache metrics
                let cacheMetrics = {
                    hitRate: 0,
                    memoryMB: 0,
                    diskMB: 0,
                    entries: 0,
                };

                if (cacheManager) {
                    const stats = cacheManager.getDetailedStats();
                    cacheMetrics = {
                        hitRate: stats.totalHitRate || 0,
                        memoryMB: Math.round((stats.memoryUsageBytes || 0) / 1024 / 1024),
                        diskMB: Math.round((stats.diskUsageBytes || 0) / 1024 / 1024),
                        entries: stats.totalEntries || 0,
                        memoryEntries: stats.memoryEntries || 0,
                        diskEntries: stats.diskEntries || 0,
                    };
                }

                // Get WebSocket metrics
                const websocketMetrics = {
                    activeDevices: 0,
                    totalConnections: 0,
                    reconnects: 0,
                };

                if (wsHub && typeof wsHub.getConnectedDevices === 'function') {
                    const devices = wsHub.getConnectedDevices();
                    websocketMetrics.activeDevices = devices.length;
                    websocketMetrics.totalConnections = devices.length;
                }

                // Get source health metrics
                const sourceMetrics = getSourceHealth(config, logger);

                // Combine all metrics
                const response = {
                    timestamp: Date.now(),
                    period,
                    requests: {
                        current: {
                            requestsPerMinute: realtimeMetrics.requestsPerMinute || 0,
                            latency: performanceMetrics.responseTime || {
                                average: 0,
                                median: 0,
                                p95: 0,
                                p99: 0,
                            },
                            slowRequestCount: 0, // Can be calculated from aggregated data
                            errorRate: errorMetrics.errorRate || 0,
                        },
                        history: aggregatedData.responseTime || [],
                        topEndpoints: getTopEndpoints(endpointMetrics.endpoints || []),
                    },
                    cache: {
                        current: cacheMetrics,
                        history: aggregatedData.systemLoad || [], // Reuse for now, can be extended
                    },
                    websocket: {
                        current: websocketMetrics,
                        history: [], // Can be populated from dedicated WebSocket metrics
                    },
                    sources: sourceMetrics,
                    system: {
                        current: systemMetrics,
                        history: aggregatedData.systemLoad || [],
                    },
                };

                res.json({
                    success: true,
                    data: response,
                });
            } catch (error) {
                logger.error('[Admin Performance] Failed to get metrics:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to retrieve performance metrics',
                    message: error.message,
                });
            }
        })
    );

    /**
     * @swagger
     * /api/admin/performance/summary:
     *   get:
     *     summary: Get performance summary
     *     description: Returns high-level performance overview
     *     tags:
     *       - Admin
     *       - Performance
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Performance summary retrieved successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/performance/summary',
        adminAuth,
        asyncHandler(async (req, res) => {
            try {
                const summary = metricsManager.getDashboardSummary();
                const systemMetrics = metricsManager.getSystemMetrics();
                const cacheMetrics = metricsManager.getCacheMetrics();

                res.json({
                    success: true,
                    data: {
                        ...summary.summary,
                        memory: systemMetrics.memory,
                        cpu: systemMetrics.cpu,
                        cacheHitRate: cacheMetrics.hitRate,
                    },
                });
            } catch (error) {
                logger.error('[Admin Performance] Failed to get summary:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to retrieve performance summary',
                });
            }
        })
    );

    return router;
};

/**
 * Get source health status
 * @private
 */
function getSourceHealth(config, logger) {
    const sources = {
        current: {},
        history: {},
    };

    try {
        // Check each media server
        if (config && config.mediaServers) {
            for (const server of config.mediaServers) {
                if (server.enabled) {
                    const sourceType = server.type; // plex, jellyfin, romm
                    sources.current[sourceType] = {
                        healthy: true, // Assume healthy if enabled
                        errors: 0,
                        avgLatency: 0,
                    };
                }
            }
        }

        // Check TMDB
        if (config && config.tmdbSource && config.tmdbSource.enabled) {
            sources.current.tmdb = {
                healthy: true,
                errors: 0,
                avgLatency: 0,
            };
        }
    } catch (error) {
        logger.warn('[Admin Performance] Failed to get source health:', error.message);
    }

    return sources;
}

/**
 * Get top endpoints by request count
 * @private
 */
function getTopEndpoints(endpoints, limit = 10) {
    return endpoints
        .sort((a, b) => b.requestCount - a.requestCount)
        .slice(0, limit)
        .map(endpoint => ({
            path: endpoint.path,
            count: endpoint.requestCount,
            avgLatency: Math.round(endpoint.averageResponseTime),
            errorRate: Math.round(endpoint.errorRate * 10) / 10,
        }));
}
