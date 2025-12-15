/**
 * Metrics and Testing Routes
 * Internal/development routes for metrics collection and error testing
 */

const express = require('express');

/**
 * Create metrics and testing router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.metricsManager - Metrics manager instance
 * @returns {express.Router} Configured router
 */
module.exports = function createMetricsTestingRouter({ metricsManager }) {
    const router = express.Router();

    // ======================
    // TEST ROUTES (Internal)
    // ======================

    /**
     * @swagger
     * /api/v1/test-error:
     *   get:
     *     summary: Test error handling (Development only)
     *     description: Throws a test error to verify error handling middleware works correctly.
     *     tags: ['Testing']
     *     deprecated: true
     *     x-internal: true
     *     responses:
     *       500:
     *         description: Test error thrown successfully
     */
    router.get('/api/v1/test-error', (req, res, next) => {
        const error = new Error('This is a test error');
        next(error);
    });

    /**
     * @swagger
     * /api/v1/test-async-error:
     *   get:
     *     summary: Test async error handling (Development only)
     *     description: Throws a test async error to verify async error handling middleware works correctly.
     *     tags: ['Testing']
     *     deprecated: true
     *     x-internal: true
     *     responses:
     *       500:
     *         description: Test async error thrown successfully
     */
    router.get('/api/v1/test-async-error', async (req, res, next) => {
        try {
            throw new Error('This is a test async error');
        } catch (error) {
            next(error);
        }
    });

    // ======================
    // METRICS ROUTES
    // ======================

    /**
     * @swagger
     * /api/v1/metrics/performance:
     *   get:
     *     summary: Get performance metrics
     *     description: Returns server performance metrics including CPU and memory usage
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Performance metrics retrieved successfully
     */
    router.get('/api/v1/metrics/performance', (req, res) => {
        const metrics = metricsManager.getPerformanceMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/endpoints:
     *   get:
     *     summary: Get endpoint metrics
     *     description: Returns metrics for individual API endpoints including request counts and response times
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Endpoint metrics retrieved successfully
     */
    router.get('/api/v1/metrics/endpoints', (req, res) => {
        const metrics = metricsManager.getEndpointMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/errors:
     *   get:
     *     summary: Get error metrics
     *     description: Returns error statistics including error rates, error types, and recent errors
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Error metrics retrieved successfully
     */
    router.get('/api/v1/metrics/errors', (req, res) => {
        const metrics = metricsManager.getErrorMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/cache:
     *   get:
     *     summary: Get cache metrics
     *     description: Returns cache performance metrics including hit rates, miss rates, and cache sizes
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Cache metrics retrieved successfully
     */
    router.get('/api/v1/metrics/cache', (req, res) => {
        const metrics = metricsManager.getCacheMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/system:
     *   get:
     *     summary: Get system metrics
     *     description: Returns system-level metrics including uptime, memory, CPU, and disk usage
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: System metrics retrieved successfully
     */
    router.get('/api/v1/metrics/system', (req, res) => {
        const metrics = metricsManager.getSystemMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/realtime:
     *   get:
     *     summary: Get real-time metrics
     *     description: Returns current real-time metrics snapshot
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Real-time metrics retrieved successfully
     */
    router.get('/api/v1/metrics/realtime', (req, res) => {
        const metrics = metricsManager.getRealTimeMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/history:
     *   get:
     *     summary: Get metrics history
     *     description: Returns historical metrics data over a time period
     *     tags: ['Metrics']
     *     parameters:
     *       - in: query
     *         name: period
     *         schema:
     *           type: string
     *           enum: [hour, day, week]
     *         description: Time period for historical data
     *     responses:
     *       200:
     *         description: Historical metrics retrieved successfully
     */
    router.get('/api/v1/metrics/history', (req, res) => {
        const period = req.query.period || 'hour';
        const metrics = metricsManager.getHistoricalMetrics(period);
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/dashboard:
     *   get:
     *     summary: Get dashboard metrics
     *     description: Returns comprehensive metrics for dashboard display
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Dashboard metrics retrieved successfully
     */
    router.get('/api/v1/metrics/dashboard', (req, res) => {
        const metrics = metricsManager.getDashboardSummary();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/v1/metrics/dashboard-kpi:
     *   get:
     *     summary: Get extended dashboard KPI metrics
     *     description: Returns comprehensive KPI metrics for dashboard cards including poster health, source freshness, error rates, etc.
     *     tags: ['Metrics']
     *     responses:
     *       200:
     *         description: Dashboard KPI metrics retrieved successfully
     */
    router.get('/api/v1/metrics/dashboard-kpi', async (req, res) => {
        const performanceMetrics = metricsManager.getPerformanceMetrics();
        const errorMetrics = metricsManager.getErrorMetrics();
        const systemMetrics = metricsManager.getSystemMetrics();
        const cacheMetrics = metricsManager.getCacheMetrics();
        const kpiMetrics = metricsManager.getKpiMetrics ? metricsManager.getKpiMetrics() : {};

        // Get source response times from performance metrics
        const sourceMetrics = metricsManager.getSourceMetrics
            ? metricsManager.getSourceMetrics()
            : {};

        // Calculate response time trend (last 10 data points)
        const responseTimeHistory = metricsManager.getResponseTimeHistory
            ? metricsManager.getResponseTimeHistory(10)
            : [];

        // Get image cache stats for poster health
        const fsp = require('fs').promises;
        const path = require('path');
        const imageCacheDir = path.join(process.cwd(), 'image_cache');
        const posterStats = { total: 0, totalSize: 0, analyzed: false };
        try {
            const files = await fsp.readdir(imageCacheDir);
            posterStats.total = files.length;
            posterStats.analyzed = true;

            // Calculate total size and quality distribution
            let totalBytes = 0;
            let highQuality = 0;
            for (const file of files.slice(0, 500)) {
                // Sample first 500 for performance
                try {
                    const stat = await fsp.stat(path.join(imageCacheDir, file));
                    if (!stat.isFile()) continue;
                    totalBytes += stat.size;
                    if (stat.size > 100 * 1024) highQuality++; // > 100KB = high quality
                } catch {
                    /* skip */
                }
            }
            posterStats.totalSize = Math.round(totalBytes / 1024 / 1024); // MB
            posterStats.highQualityPercent =
                files.length > 0
                    ? Math.round((highQuality / Math.min(files.length, 500)) * 100)
                    : 0;
        } catch {
            // Image cache may not exist yet
        }

        // Count active sources from request metrics
        const activeSources = Object.keys(sourceMetrics).filter(
            source => sourceMetrics[source]?.count > 0
        ).length;

        // Get fallback metrics from the dedicated endpoint data (if available)
        const fallbackStats = { total: 0, rate: 0 };
        if (kpiMetrics.fallbacks) {
            fallbackStats.total = kpiMetrics.fallbacks.total || 0;
            fallbackStats.recentCount = kpiMetrics.fallbacks.recentCount || 0;
        }

        // Get last sync info
        const lastSyncInfo = {
            timestamp: kpiMetrics.lastSyncTime || null,
            source: kpiMetrics.lastSyncSource || null,
            sources: kpiMetrics.lastSync || {},
        };

        // Calculate time since last sync
        let timeSinceSync = null;
        if (lastSyncInfo.timestamp) {
            const ago = Date.now() - lastSyncInfo.timestamp;
            const minutes = Math.floor(ago / 60000);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) timeSinceSync = { value: days, unit: 'd', formatted: `${days}d ago` };
            else if (hours > 0)
                timeSinceSync = { value: hours, unit: 'h', formatted: `${hours}h ago` };
            else timeSinceSync = { value: minutes, unit: 'm', formatted: `${minutes}m ago` };
        }

        res.json({
            success: true,
            timestamp: Date.now(),
            kpi: {
                // Poster Health - based on image cache analysis
                posterHealth: {
                    total: posterStats.total,
                    totalSizeMB: posterStats.totalSize || 0,
                    highQualityPercent: posterStats.highQualityPercent || 0,
                    analyzed: posterStats.analyzed,
                },
                // Source Response Time Trend
                sourceResponseTime: {
                    current: performanceMetrics.responseTime?.average || 0,
                    median: performanceMetrics.responseTime?.median || 0,
                    p95: performanceMetrics.responseTime?.p95 || 0,
                    trend: responseTimeHistory,
                    sources: sourceMetrics,
                    activeSourceCount: activeSources,
                    perSource: kpiMetrics.sourceResponseTimes || {},
                },
                // Fallback Rate
                fallbackRate: {
                    total: fallbackStats.total,
                    recentCount: fallbackStats.recentCount,
                    byReason: kpiMetrics.fallbacks?.byReason || {},
                },
                // Library Freshness / Last Sync
                libraryFreshness: {
                    lastSync: lastSyncInfo,
                    timeSinceSync,
                    sources: lastSyncInfo.sources,
                },
                // Cache Performance
                cachePerformance: {
                    hitRate: cacheMetrics.hitRate || 0,
                    hits: cacheMetrics.totalHits || 0,
                    misses: cacheMetrics.totalMisses || 0,
                },
                // System uptime
                uptime: {
                    ms: systemMetrics.uptime || 0,
                    seconds: Math.floor((systemMetrics.uptime || 0) / 1000),
                    formatted: formatUptime(systemMetrics.uptime || 0),
                },
                // Most Displayed Content
                mostDisplayed: {
                    items: kpiMetrics.mostDisplayed || [],
                    totalDisplays: kpiMetrics.totalDisplays || 0,
                    tracking: (kpiMetrics.totalDisplays || 0) > 0,
                },
                // Error Rate (last hour)
                errorRate: {
                    total: errorMetrics.totalErrors || 0,
                    rate: errorMetrics.errorRate || 0,
                    byStatus: errorMetrics.errorsByStatus || {},
                    trend:
                        errorMetrics.totalErrors > 10
                            ? 'high'
                            : errorMetrics.totalErrors > 0
                              ? 'low'
                              : 'none',
                },
            },
        });
    });

    /**
     * @swagger
     * /api/v1/metrics/track-display:
     *   post:
     *     summary: Track poster display
     *     description: Called by frontend when a poster is displayed to track most-shown content
     *     tags: ['Metrics']
     *     requestBody:
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               mediaId:
     *                 type: string
     *               title:
     *                 type: string
     *     responses:
     *       200:
     *         description: Display tracked
     */
    router.post('/api/v1/metrics/track-display', express.json(), (req, res) => {
        const { mediaId, title } = req.body || {};

        if (mediaId && metricsManager.recordPosterDisplay) {
            metricsManager.recordPosterDisplay(mediaId, title);
        }

        res.json({ success: true });
    });

    // Helper function to format uptime
    function formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    }

    /**
     * @swagger
     * /api/v1/metrics/export:
     *   get:
     *     summary: Export metrics
     *     description: Exports metrics in various formats (JSON, Prometheus)
     *     tags: ['Metrics']
     *     parameters:
     *       - in: query
     *         name: format
     *         schema:
     *           type: string
     *           enum: [json, prometheus]
     *         description: Export format
     *     responses:
     *       200:
     *         description: Metrics exported successfully
     */
    router.get('/api/v1/metrics/export', (req, res) => {
        const format = req.query.format || 'json';
        const metrics = metricsManager.exportMetrics(format);

        if (format === 'prometheus') {
            res.set('Content-Type', 'text/plain');
            res.send(metrics);
        } else {
            res.json(metrics);
        }
    });

    return router;
};
