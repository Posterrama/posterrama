/**
 * Test-only endpoints (exposed without auth) used for diagnostics and automated tests.
 * They are annotated with Swagger under the [Test] tag and marked x-internal.
 */

const express = require('express');
const router = express.Router();
const logger = require('./utils/logger');

/**
 * @swagger
 * /api/test/clear-logs:
 *   get:
 *     summary: Clear in-memory captured logs (test only)
 *     description: Clears the in-memory logger ring buffer used by the admin UI. Test / internal use only.
 *     tags: [Test]
 *     x-internal: true
 *     responses:
 *       200:
 *         description: Successfully cleared memory logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 beforeCount:
 *                   type: integer
 *                 afterCount:
 *                   type: integer
 *       500:
 *         description: Server error clearing logs
 */
router.get('/api/test/clear-logs', (req, res) => {
    try {
        const beforeCount = logger.memoryLogs.length;
        logger.memoryLogs.length = 0; // Clear all memory logs
        res.json({
            success: true,
            message: `Cleared ${beforeCount} memory logs`,
            beforeCount,
            afterCount: logger.memoryLogs.length,
        });
    } catch (error) {
        logger.error('Failed to clear memory logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/test/generate-logs:
 *   get:
 *     summary: Generate synthetic log entries (test only)
 *     description: Generates a batch of synthetic log entries for UI/testing purposes. Internal use only.
 *     tags: [Test]
 *     x-internal: true
 *     parameters:
 *       - in: query
 *         name: count
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 1000
 *         description: Number of test log entries to generate (max 1000)
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
 *                 message:
 *                   type: string
 *                 count:
 *                   type: integer
 *                 memoryLogsCount:
 *                   type: integer
 *       500:
 *         description: Server error generating logs
 */
router.get('/api/test/generate-logs', (req, res) => {
    try {
        const count = parseInt(req.query.count) || 10;
        const maxCount = 1000; // Safety limit
        const actualCount = Math.min(count, maxCount);

        const messages = [
            'System startup complete',
            'Cache invalidated successfully',
            'User authentication successful',
            'Configuration updated',
            'Media scan initiated',
            'Database connection established',
            'API request processed',
            'Memory usage optimal',
            'Service health check passed',
            'Backup operation started',
        ];
        const getRandomItem = arr => arr[Math.floor(Math.random() * arr.length)];
        const logEntries = [];
        for (let i = 1; i <= actualCount; i++) {
            const messageBase = getRandomItem(messages);
            const message = `[${i}/${actualCount}] ${messageBase} - Test log entry #${i}`;
            logEntries.push(message);
        }
        logEntries.forEach(message => logger.info(message + ' [TEST-LOG]'));

        res.json({
            success: true,
            message: `Generated ${actualCount} test logs`,
            count: actualCount,
            memoryLogsCount: logger.memoryLogs.length,
        });
    } catch (error) {
        logger.error('Failed to generate test logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
