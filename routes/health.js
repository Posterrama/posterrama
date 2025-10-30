/**
 * Health Check Routes
 *
 * Endpoints for application health monitoring and status checks.
 */

const express = require('express');
const router = express.Router();
const { getBasicHealth, getDetailedHealth } = require('../utils/healthCheck');

// Async handler wrapper
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health Check Endpoint
 *     description: >
 *       Health check endpoint that returns basic service status by default.
 *       Use ?detailed=true query parameter for comprehensive health checks
 *       including configuration validation, filesystem access, and media server connectivity.
 *     tags: ['Public API']
 *     parameters:
 *       - in: query
 *         name: detailed
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to perform detailed health checks
 *     responses:
 *       200:
 *         description: Health check completed
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/BasicHealthResponse'
 *                 - $ref: '#/components/schemas/HealthCheckResponse'
 */
router.get(
    '/health',
    asyncHandler(async (req, res) => {
        const detailed = req.query.detailed === 'true';

        if (detailed) {
            const health = await getDetailedHealth();
            res.json(health);
        } else {
            const health = getBasicHealth();
            res.json(health);
        }
    })
);

module.exports = router;
router.get(
    '/health',
    asyncHandler(async (req, res) => {
        const detailed = req.query.detailed === 'true';

        if (detailed) {
            const health = await getDetailedHealth();
            res.json(health);
        } else {
            const health = getBasicHealth();
            res.json(health);
        }
    })
);

/**
 * Backward-compatible alias for /api/health
 * (documented in swagger but previously missing implementation)
 */
router.get('/api/health', (req, res, next) => {
    // Re-use existing /health handler logic
    req.query = req.query || {};
    const detailed = req.query.detailed === 'true';

    if (detailed) {
        getDetailedHealth()
            .then(health => res.json(health))
            .catch(next);
    } else {
        const health = getBasicHealth();
        res.json(health);
    }
});

module.exports = router;
