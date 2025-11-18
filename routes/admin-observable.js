/**
 * Admin Observable Routes
 * Handles logs, events (SSE), notifications, and test utilities
 */

const express = require('express');

/**
 * Create admin observable router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Function} deps.isAuthenticated - Authentication middleware
 * @param {Function} deps.asyncHandler - Async error handler middleware
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.broadcastAdminEvent - Broadcast admin event function (optional)
 * @param {Function} deps.sseDbg - SSE debug logger (optional)
 * @returns {Object} Router and adminSseClients set
 */
module.exports = function createAdminObservableRouter({
    isAuthenticated,
    asyncHandler,
    logger,
    broadcastAdminEvent,
    sseDbg,
}) {
    const router = express.Router();

    // Admin SSE clients set (for live updates)
    const adminSseClients = new Set(); // Set<res>

    // Broadcast function (can be called externally)
    function broadcastAdminEventInternal(event, payload) {
        const line = `event: ${event}\n` + `data: ${JSON.stringify(payload || {})}\n\n`;
        for (const res of adminSseClients) {
            try {
                res.write(line);
            } catch (_) {
                // drop broken client on next flush
            }
        }
    }

    /**
     * @swagger
     * /api/admin/logs:
     *   get:
     *     summary: Get the most recent application logs
     *     description: >
     *       Retrieves a list of the most recent log entries stored in memory.
     *       This is useful for debugging from the admin panel without direct server access.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: An array of log objects.
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/LogEntry'
     */
    router.get('/api/admin/logs', isAuthenticated, (req, res) => {
        const { level, limit, offset, testOnly } = req.query;
        res.setHeader('Cache-Control', 'no-store'); // Prevent browser caching of log data

        const parsedLimit = parseInt(limit, 10) || 200;
        const parsedOffset = parseInt(offset, 10) || 0;
        const testOnlyMode = testOnly === 'true';

        // Base logger returns chronological (oldest->newest) for the selected window.
        // For the admin UI, we want newest-first so latest entries appear at the top.
        const chronological = logger.getRecentLogs(level, parsedLimit, parsedOffset, testOnlyMode);
        const newestFirst = chronological.slice().reverse();
        res.json(newestFirst);
    });

    /**
     * @swagger
     * /api/admin/logs/level:
     *   get:
     *     summary: Get current log level configuration
     *     description: Retrieves the current Winston log level setting
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Current log level configuration
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 currentLevel:
     *                   type: string
     *                   enum: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']
     *                 availableLevels:
     *                   type: array
     *                   items:
     *                     type: string
     *   post:
     *     summary: Update log level configuration
     *     description: Changes the Winston log level at runtime without restarting the server
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - level
     *             properties:
     *               level:
     *                 type: string
     *                 enum: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']
     *     responses:
     *       200:
     *         description: Log level updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 oldLevel:
     *                   type: string
     *                 newLevel:
     *                   type: string
     *       400:
     *         description: Invalid log level
     *       500:
     *         description: Failed to update log level
     */
    router.get('/api/admin/logs/level', isAuthenticated, (req, res) => {
        try {
            const currentLevel = logger.level;
            const availableLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

            res.json({
                currentLevel,
                availableLevels,
            });
        } catch (error) {
            res.status(500).json({
                error: 'Failed to retrieve log level',
                details: error.message,
            });
        }
    });

    /**
     * @swagger
     * /api/admin/logs/level:
     *   post:
     *     summary: Update the server log level
     *     description: Changes the Winston logger level dynamically (error, warn, info, http, verbose, debug, silly)
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [level]
     *             properties:
     *               level:
     *                 type: string
     *                 enum: [error, warn, info, http, verbose, debug, silly]
     *     responses:
     *       200:
     *         description: Log level updated successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 oldLevel:
     *                   type: string
     *                 newLevel:
     *                   type: string
     *       400:
     *         description: Invalid log level
     *       500:
     *         description: Failed to update log level
     */
    router.post('/api/admin/logs/level', isAuthenticated, (req, res) => {
        try {
            const { level } = req.body;

            // Validate log level
            const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
            if (!level || !validLevels.includes(level)) {
                return res.status(400).json({
                    error: 'Invalid log level',
                    validLevels,
                    receivedLevel: level,
                });
            }

            const oldLevel = logger.level;

            // Update Winston log level and all transports
            logger.level = level;
            logger.transports.forEach(transport => {
                transport.level = level;
            });

            logger.info('Log level updated', {
                oldLevel,
                newLevel: level,
                transportCount: logger.transports.length,
                adminUser: req.session?.user?.username || 'unknown',
            });

            res.json({
                success: true,
                oldLevel,
                newLevel: level,
            });
        } catch (error) {
            const { level } = req.body; // Re-declare for error handler scope
            logger.error('Failed to update log level', {
                error: error.message,
                attemptedLevel: level,
                adminUser: req.session?.user?.username || 'unknown',
            });

            res.status(500).json({
                error: 'Failed to update log level',
                details: error.message,
            });
        }
    });

    // Admin Notifications: test logging endpoint to validate SSE + Notification Center
    // Usage: POST /api/admin/notify/test { level?: 'info'|'warn'|'error', message?: string }
    /**
     * @swagger
     * /api/admin/notify/test:
     *   post:
     *     summary: Emit a test admin notification
     *     description: Triggers a test log entry (info/warn/error) that flows through the admin notification center and SSE stream.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/NotificationTestRequest'
     *     responses:
     *       200:
     *         description: Notification emitted
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/NotificationTestResponse'
     *       500:
     *         description: Failed to emit notification
     */
    router.post('/api/admin/notify/test', isAuthenticated, (req, res) => {
        try {
            const lvl = String(req.body?.level || 'warn').toLowerCase();
            const msg = String(req.body?.message || 'Test notification from Admin');
            const log = logger[lvl] || logger.warn;
            log(`[Admin Notify Test] ${msg}`);
            res.json({ ok: true, level: lvl, message: msg });
        } catch (e) {
            res.status(500).json({
                ok: false,
                error: e?.message || 'Failed to emit test notification',
            });
        }
    });

    /**
     * @swagger
     * /api/admin/sse-test:
     *   post:
     *     summary: Test SSE broadcasting
     *     description: >
     *       Broadcasts a sample device event to all connected admin SSE clients for testing purposes.
     *       Useful for debugging SSE connectivity and verifying event delivery.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Test event broadcasted successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: 'SSE test event broadcasted'
     *                 eventType:
     *                   type: string
     *                   example: 'device-updated'
     *       401:
     *         description: Unauthorized - admin session required
     *     x-internal: true
     */
    // Admin SSE: simple test endpoint to broadcast a sample device event for debugging
    // Usage (in Admin console while logged in): fetch('/api/admin/sse-test', { method: 'POST' })
    router.post('/api/admin/sse-test', isAuthenticated, (req, res) => {
        try {
            const payload = {
                id: 'SSE_TEST_DEVICE',
                status: 'online',
                lastSeenAt: new Date().toISOString(),
                wsConnected: false,
                currentState: { title: 'SSE Test Broadcast', paused: false },
            };
            // Broadcast via both mechanisms to reach any connected admin SSE clients
            try {
                if (typeof global.__adminSSEBroadcast === 'function') {
                    global.__adminSSEBroadcast('device-updated', payload);
                }
            } catch (_) {
                // Ignore broadcast errors
            }
            try {
                if (typeof broadcastAdminEvent === 'function') {
                    broadcastAdminEvent('device-updated', payload);
                }
            } catch (_) {
                // Ignore broadcast errors
            }
            // Also broadcast via internal function
            try {
                broadcastAdminEventInternal('device-updated', payload);
            } catch (_) {
                // Ignore broadcast errors
            }
            sseDbg?.('device-updated broadcast (manual test)', { id: payload.id });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'sse-test failed' });
        }
    });

    /**
     * @swagger
     * /api/admin/events:
     *   get:
     *     summary: Admin SSE stream for real-time updates
     *     description: >
     *       Server-Sent Events stream that pushes real-time updates to the admin UI
     *       including log events, config changes, device updates, and backup operations.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: SSE stream established
     *         content:
     *           text/event-stream:
     *             schema:
     *               type: string
     *       401:
     *         description: Unauthorized - admin session required
     */
    router.get(
        '/api/admin/events',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            // SSE headers
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
            res.flushHeaders?.();

            // Add client and send an initial hello
            adminSseClients.add(res);
            // Initial comment line improves compatibility with some proxies/browsers
            res.write(`: connected\n\n`);
            res.write(`event: hello\n` + `data: {"t":${Date.now()}}\n\n`);

            // Heartbeat to keep connection alive
            const hb = setInterval(() => {
                try {
                    res.write(`event: ping\n` + `data: {"t":${Date.now()}}\n\n`);
                } catch (_) {
                    // if write fails, cleanup below on close
                }
            }, 25000);

            // Cleanup on close
            const cleanup = () => {
                try {
                    clearInterval(hb);
                } catch (_) {
                    /* ignore */
                }
                adminSseClients.delete(res);
                try {
                    res.end();
                } catch (_) {
                    /* ignore */
                }
            };
            req.on('close', cleanup);
            req.on('error', cleanup);
        })
    );

    // Export router, clients set, and broadcast function
    return {
        router,
        adminSseClients,
        broadcastAdminEvent: broadcastAdminEventInternal,
    };
};
