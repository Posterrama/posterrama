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
 * @param {Object} deps.apiCache - API response cache instance
 * @param {Object} deps.wsHub - WebSocket hub instance
 * @param {Object} deps.config - Config instance
 * @param {Function} deps.asyncHandler - Async error handler middleware
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @returns {express.Router} Configured router
 */
module.exports = function createAdminPerformanceRouter({
    logger,
    metricsManager,
    cacheManager: _cacheManager, // Keep for backwards compatibility but use apiCache instead
    apiCache,
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
        // @ts-ignore - Express router overload issue with asyncHandler
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

                // Get cache metrics from API response cache (the one users actually see)
                let cacheMetrics = {
                    hitRate: 0,
                    memoryMB: 0,
                    diskMB: 0,
                    entries: 0,
                };

                if (apiCache) {
                    const stats = apiCache.getStats();
                    const total = stats.hits + stats.misses;
                    const hitRate = total > 0 ? (stats.hits / total) * 100 : 0;

                    cacheMetrics = {
                        hitRate: Math.round(hitRate * 100) / 100,
                        memoryMB: Math.round((stats.memoryUsage || 0) / 1024 / 1024),
                        diskMB: 0, // API cache is memory-only
                        entries: stats.size || 0,
                        memoryEntries: stats.size || 0,
                        diskEntries: 0,
                        hits: stats.hits || 0,
                        misses: stats.misses || 0,
                        totalRequests: total,
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
                const sourceMetrics = getSourceHealth(config, logger, metricsManager);

                // Combine all metrics
                // Merge request rate and response time histories
                const requestHistory = (aggregatedData.requestRate || []).map(rateData => {
                    // Find matching response time data by timestamp
                    const responseData = (aggregatedData.responseTime || []).find(
                        rt => Math.abs(rt.timestamp - rateData.timestamp) < 30000 // Within 30 seconds
                    );

                    return {
                        timestamp: rateData.timestamp,
                        requestsPerMinute: Math.round((rateData.rate || 0) * 60 * 100) / 100, // Convert rate/sec to rate/min
                        avg: responseData?.avg || 0,
                        p95: responseData?.p95 || 0,
                        p99: responseData?.p99 || 0,
                    };
                });

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
                        history: requestHistory,
                        topEndpoints: getTopEndpoints(endpointMetrics.endpoints || [], 999),
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
        // @ts-ignore - Express router overload issue with asyncHandler
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
 * Get source health status from actual metrics
 * @private
 */
function getSourceHealth(config, logger, metricsManager) {
    const sources = {
        current: {},
        history: {},
    };

    try {
        const endpointMetrics = metricsManager.getEndpointMetrics();
        const endpoints = endpointMetrics.endpoints || [];

        // Helper to calculate metrics for a source type
        const getSourceMetrics = sourcePrefix => {
            const sourceEndpoints = endpoints.filter(
                e =>
                    e.path.includes(`/api/${sourcePrefix}/`) ||
                    e.path.includes(`/api/sources/${sourcePrefix}/`)
            );

            if (sourceEndpoints.length === 0) {
                return { healthy: true, errors: 0, avgLatency: 0, requests: 0 };
            }

            const totalRequests = sourceEndpoints.reduce((sum, e) => sum + e.requestCount, 0);
            const totalErrors = sourceEndpoints.reduce((sum, e) => sum + (e.errorCount || 0), 0);
            const avgLatency =
                sourceEndpoints.reduce(
                    (sum, e) => sum + e.averageResponseTime * e.requestCount,
                    0
                ) / totalRequests;

            return {
                healthy: totalErrors === 0 || totalErrors / totalRequests < 0.1,
                errors: totalErrors,
                avgLatency: Math.round(avgLatency),
                requests: totalRequests,
            };
        };

        // Check each enabled media server
        if (config && config.mediaServers) {
            for (const server of config.mediaServers) {
                if (server.enabled) {
                    sources.current[server.type] = getSourceMetrics(server.type);
                }
            }
        }

        // Check TMDB
        if (config && config.tmdbSource && config.tmdbSource.enabled) {
            sources.current.tmdb = getSourceMetrics('tmdb');
        }
    } catch (error) {
        logger.warn('[Admin Performance] Failed to get source health:', error.message);
    }

    return sources;
}

/**
 * Get top endpoints by request count, filtered for relevance
 * @private
 */
function getTopEndpoints(endpoints, limit = 10) {
    // Priority endpoints we always want to monitor
    const priorityEndpoints = [
        '/api/get-media',
        '/api/get-playlist',
        '/api/get-music-artists',
        '/api/image',
        '/api/devices/heartbeat',
        '/api/devices/command',
        '/api/admin/config',
        '/api/admin/dashboard',
        '/api/admin/cache/invalidate',
        '/api/admin/libraries',
        '/api/admin/filter-preview',
        '/api/plex/sessions',
        '/api/get-media-by-key',
    ];

    // Filter and categorize endpoints
    const filtered = endpoints.filter(endpoint => {
        const path = endpoint.path;

        // Skip health checks, static assets, etc.
        if (
            path.includes('/health') ||
            path.includes('/ping') ||
            path.includes('/favicon') ||
            path.includes('/robots.txt') ||
            path.includes('/logo.png') ||
            path.includes('.js') ||
            path.includes('.css') ||
            path.includes('.map')
        ) {
            return false;
        }

        // Skip admin UI pages (keep admin API)
        if (path === '/admin' || path === '/admin.html' || path === '/logs') {
            return false;
        }

        // Skip SSE/streaming endpoints (long-lived connections)
        if (
            path.includes('/stream') ||
            path.includes('/api/admin/events') ||
            path.includes('/ws/')
        ) {
            return false;
        }

        // Keep API endpoints and interesting routes
        return true;
    });

    // Add priority scoring
    const scored = filtered.map(endpoint => {
        const isPriority = priorityEndpoints.some(
            priority => endpoint.path === priority || endpoint.path.startsWith(priority + '/')
        );

        return {
            ...endpoint,
            priorityScore: isPriority ? 1000 : 0,
        };
    });

    return scored
        .sort((a, b) => {
            // First, prioritize by priority list
            if (a.priorityScore !== b.priorityScore) {
                return b.priorityScore - a.priorityScore;
            }

            // Then sort by: high error rate first, then slow latency, then high request count
            if (a.errorRate > 0 && b.errorRate === 0) return -1;
            if (b.errorRate > 0 && a.errorRate === 0) return 1;
            if (a.averageResponseTime > 1000 && b.averageResponseTime < 1000) return -1;
            if (b.averageResponseTime > 1000 && a.averageResponseTime < 1000) return 1;
            return b.requestCount - a.requestCount;
        })
        .slice(0, limit)
        .map(endpoint => ({
            path: endpoint.path,
            count: endpoint.requestCount,
            avgLatency: Math.round(endpoint.averageResponseTime),
            errorRate: Math.round(endpoint.errorRate * 10) / 10,
        }));
}
