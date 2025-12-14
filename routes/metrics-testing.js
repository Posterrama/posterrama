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

        // Get source response times from performance metrics
        const sourceMetrics = metricsManager.getSourceMetrics
            ? metricsManager.getSourceMetrics()
            : {};

        // Calculate response time trend (last 10 data points)
        const responseTimeHistory = metricsManager.getResponseTimeHistory
            ? metricsManager.getResponseTimeHistory(10)
            : [];

        // Get image cache stats for poster health
        const fs = require('fs');
        const path = require('path');
        const imageCacheDir = path.join(process.cwd(), 'image_cache');
        const posterStats = { total: 0, analyzed: false };
        try {
            const files = fs.readdirSync(imageCacheDir);
            posterStats.total = files.length;
            posterStats.analyzed = true;
        } catch {
            // Image cache may not exist yet
        }

        // Count active sources from request metrics
        const activeSources = Object.keys(sourceMetrics).filter(
            source => sourceMetrics[source]?.count > 0
        ).length;

        res.json({
            success: true,
            timestamp: Date.now(),
            kpi: {
                // Poster Health - based on image cache count
                posterHealth: {
                    total: posterStats.total,
                    cached: posterStats.total,
                    percentage: posterStats.total > 0 ? 100 : 0,
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
                },
                // Cache Performance
                cachePerformance: {
                    hitRate: cacheMetrics.hitRate || 0,
                    hits: cacheMetrics.totalHits || 0,
                    misses: cacheMetrics.totalMisses || 0,
                },
                // System uptime
                uptime: {
                    seconds: Math.floor(systemMetrics.uptime / 1000) || 0,
                    formatted: formatUptime(systemMetrics.uptime || 0),
                },
                // Most Displayed Content (placeholder - needs display tracking)
                mostDisplayed: {
                    items: [],
                    tracking: false,
                },
                // Error Rate (last hour)
                errorRate: {
                    total: errorMetrics.totalErrors || 0,
                    last24h: errorMetrics.totalErrors || 0,
                    rate: errorMetrics.errorRate || 0,
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
