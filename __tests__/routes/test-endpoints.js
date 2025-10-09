/**
 * Test-only endpoints for log generation and clearing
 * These routes are only available when EXPOSE_INTERNAL_ENDPOINTS=true
 * Used for testing and debugging purposes
 *
 * Location: __tests__/routes/test-endpoints.js
 * Mounted in server.js when EXPOSE_INTERNAL_ENDPOINTS=true
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

/**
 * @swagger
 * /api/test/generate-logs:
 *   get:
 *     summary: Generate test log entries
 *     description: Creates dummy log entries for testing purposes
 *     tags: [Testing]
 *     x-internal: true
 *     parameters:
 *       - in: query
 *         name: count
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 1000
 *         description: Number of log entries to generate
 *     responses:
 *       200:
 *         description: Logs generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 */
router.get('/api/test/generate-logs', (req, res) => {
    const count = Math.min(1000, Math.max(1, parseInt(req.query.count) || 10));

    for (let i = 0; i < count; i++) {
        logger.info(`[TEST-LOG] Generated test log entry ${i + 1}/${count}`, {
            timestamp: new Date().toISOString(),
            testId: Math.random().toString(36).substring(7),
        });
    }

    res.json({
        success: true,
        count,
        message: `Generated ${count} test logs with TEST-LOG marker`,
    });
});

/**
 * @swagger
 * /api/test/clear-logs:
 *   get:
 *     summary: Clear in-memory log buffer
 *     description: Empties the logger's memory buffer for testing
 *     tags: [Testing]
 *     x-internal: true
 *     responses:
 *       200:
 *         description: Logs cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 beforeCount:
 *                   type: integer
 *                 afterCount:
 *                   type: integer
 */
router.get('/api/test/clear-logs', (req, res) => {
    const beforeCount = logger.memoryLogs?.length || 0;

    if (logger.memoryLogs) {
        logger.memoryLogs.length = 0;
    }

    const afterCount = logger.memoryLogs?.length || 0;

    res.json({
        success: true,
        beforeCount,
        afterCount,
        message: 'Cleared in-memory log buffer',
    });
});

/**
 * @swagger
 * /api/admin/sse-test:
 *   post:
 *     summary: Test SSE broadcast
 *     description: Broadcasts a test event via Server-Sent Events for testing purposes
 *     tags: [Testing, Admin]
 *     x-internal: true
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Test event broadcasted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 */
router.post('/api/admin/sse-test', (req, res) => {
    // Broadcast test event if SSE is available
    if (typeof global.__adminSSEBroadcast === 'function') {
        global.__adminSSEBroadcast('test-event', {
            timestamp: new Date().toISOString(),
            message: 'Test SSE broadcast',
        });
    }

    res.json({ ok: true });
});

module.exports = router;
