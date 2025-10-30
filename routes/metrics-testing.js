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
