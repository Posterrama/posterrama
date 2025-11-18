/**
 * Source Error Metrics Routes (Issue #97)
 * Endpoints for unified error handling metrics per media source
 */

const express = require('express');
const { getErrorMetrics, resetErrorMetrics } = require('../utils/source-error-handler');

/**
 * Create source error metrics router
 * @returns {express.Router} Configured router
 */
module.exports = function createSourceErrorMetricsRouter() {
    const router = express.Router();

    /**
     * @swagger
     * /api/metrics/source-errors:
     *   get:
     *     summary: Get error metrics for all media sources
     *     description: |
     *       Returns comprehensive error metrics from the unified error handling system.
     *       Includes retry attempts, failure rates, and error categorization for all sources.
     *
     *       Raw format shows per-operation metrics: {source: {operation: {total, errors, retries}}}
     *     tags: ['Source Metrics']
     *     responses:
     *       200:
     *         description: Source error metrics retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: object
     *                 additionalProperties:
     *                   type: object
     *                   properties:
     *                     total:
     *                       type: number
     *                       description: Total operations attempted
     *                     errors:
     *                       type: number
     *                       description: Number of failed operations
     *                     retries:
     *                       type: number
     *                       description: Number of retry attempts
     *             examples:
     *               allSources:
     *                 value:
     *                   plex:
     *                     fetchMedia:
     *                       total: 10
     *                       errors: 2
     *                       retries: 3
     *                     getLibraries:
     *                       total: 5
     *                       errors: 0
     *                       retries: 1
     *                   jellyfin:
     *                     fetchMedia:
     *                       total: 8
     *                       errors: 1
     *                       retries: 2
     */
    router.get('/api/metrics/source-errors', (req, res) => {
        const metrics = getErrorMetrics();
        res.json(metrics);
    });

    /**
     * @swagger
     * /api/metrics/source-errors/{source}:
     *   get:
     *     summary: Get error metrics for a specific media source
     *     description: |
     *       Returns error metrics for a single media source (plex, jellyfin, tmdb, romm).
     *       Useful for targeted monitoring and debugging of specific integrations.
     *     tags: ['Source Metrics']
     *     parameters:
     *       - in: path
     *         name: source
     *         required: true
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, tmdb, romm, local]
     *         description: Source identifier
     *     responses:
     *       200:
     *         description: Source-specific error metrics retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 totalAttempts:
     *                   type: number
     *                 successfulRetries:
     *                   type: number
     *                 failedOperations:
     *                   type: number
     *                 lastError:
     *                   type: object
     *                   nullable: true
     *                 errorsByType:
     *                   type: object
     *       404:
     *         description: Source not found or no metrics available
     */
    router.get('/api/metrics/source-errors/:source', (req, res) => {
        const { source } = req.params;
        const metrics = getErrorMetrics(source);

        if (!metrics || Object.keys(metrics).length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: `No error metrics available for source: ${source}`,
            });
        }

        res.json(metrics);
    });

    /**
     * @swagger
     * /api/metrics/source-errors/{source}:
     *   delete:
     *     summary: Reset error metrics for a specific media source
     *     description: |
     *       Clears all error metrics and counters for the specified source.
     *       Useful for testing or after resolving persistent issues.
     *     tags: ['Source Metrics']
     *     parameters:
     *       - in: path
     *         name: source
     *         required: true
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, tmdb, romm, local]
     *         description: Source identifier to reset
     *     responses:
     *       200:
     *         description: Metrics reset successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 message:
     *                   type: string
     *                 source:
     *                   type: string
     *       400:
     *         description: Invalid source identifier
     */
    router.delete('/api/metrics/source-errors/:source', (req, res) => {
        const { source } = req.params;

        // Validate source parameter
        const validSources = ['plex', 'jellyfin', 'tmdb', 'romm', 'local'];
        if (!validSources.includes(source)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: `Invalid source identifier. Must be one of: ${validSources.join(', ')}`,
                provided: source,
            });
        }

        try {
            resetErrorMetrics(source);
            res.json({
                success: true,
                message: `Error metrics reset successfully for source: ${source}`,
                source: source,
            });
        } catch (error) {
            res.status(500).json({
                error: 'Internal Server Error',
                message: error.message,
            });
        }
    });

    return router;
};
