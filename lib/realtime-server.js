/**
 * Real-time communication server setup
 * Handles WebSocket and Server-Sent Events (SSE) initialization
 * Extracted from server.js (Issue #83)
 */

/**
 * Initialize WebSocket hub for device communication
 * @param {Object} options - Initialization options
 * @param {Object} options.httpServer - HTTP server instance
 * @param {Object} options.wsHub - WebSocket hub instance
 * @param {Object} options.deviceStore - Device store instance
 * @param {Object} options.logger - Logger instance
 */
function initializeWebSocketServer({ httpServer, wsHub, deviceStore, logger }) {
    try {
        wsHub.init(httpServer, {
            path: '/ws/devices',
            verifyDevice: deviceStore.verifyDevice,
        });
        logger.info('✅ WebSocket server initialized on /ws/devices');
    } catch (error) {
        logger.warn('[WS] WebSocket initialization failed:', error.message);
    }
}

/**
 * Initialize Server-Sent Events (SSE) endpoint for admin panel
 * Sets up real-time log streaming and event broadcasting
 * @param {Object} options - Initialization options
 * @param {Object} options.app - Express app instance
 * @param {Object} options.logger - Logger instance
 * @returns {Object} SSE control functions (cleanup, broadcast)
 */
function initializeSSEServer({ app, logger }) {
    const __sseClients = new Set();

    /**
     * @swagger
     * /api/admin/events:
     *   get:
     *     summary: Subscribe to Admin Server-Sent Events
     *     description: |
     *       Stream of server-sent events (SSE) for admin notifications and logs. Requires an authenticated admin session.
     *       The stream emits periodic ping events to keep the connection alive and "log" events for recent log entries
     *       and admin notifications. Content-Type is text/event-stream.
     *     tags: ['Admin']
     *     security:
     *       - sessionAuth: []
     *     responses:
     *       200:
     *         description: Event stream started
     *         content:
     *           text/event-stream:
     *             schema:
     *               type: string
     *               example: |
     *                 : connected\n\n
     *                 event: hello\n
     *                 data: {"t": 1700000000000}\n\n
     *                 event: ping\n
     *                 data: {"t": 1700000002500}\n\n
     *                 event: log\n
     *                 data: {"level":"info","message":"Started"}\n\n
     *       401:
     *         description: Unauthorized (no admin session)
     */
    app.get('/api/admin/events', (req, res) => {
        // Basic auth guard: require admin session
        if (!req.session || !req.session.user) {
            return res.status(401).end();
        }

        // SSE headers; harden for proxies (nginx/cloudflare) and intermediaries
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        // Disable nginx proxy buffering so events flush immediately
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        // Send an initial comment line to force flush in some proxies
        res.write(`: connected\n\n`);
        res.write(`event: hello\n`);
        res.write(`data: {"t": ${Date.now()}}\n\n`);

        // Keep-alive heartbeat to prevent idle timeouts
        const heartbeat = setInterval(() => {
            try {
                res.write(`event: ping\n` + `data: {"t": ${Date.now()}}\n\n`);
            } catch (_) {
                // On write error, the close listener will cleanup
            }
        }, 25000);

        const client = { res, heartbeat };
        __sseClients.add(client);

        req.on('close', () => {
            try {
                clearInterval(client.heartbeat);
            } catch (_) {
                /* ignore */
            }
            __sseClients.delete(client);
        });
    });

    // Bridge logger events to SSE clients
    const __onLog = log => {
        const payload = `event: log\n` + `data: ${JSON.stringify(log)}\n\n`;
        for (const c of __sseClients) {
            try {
                c.res.write(payload);
            } catch (_) {
                /* ignore SSE write errors (client closed) */
            }
        }
    };
    logger.events.on('log', __onLog);

    // Expose a safe broadcaster for other modules/routes
    global.__adminSSEBroadcast = function (eventName, data) {
        try {
            const payload =
                `event: ${String(eventName || 'message')}\n` +
                `data: ${JSON.stringify(data || {})}\n\n`;
            for (const c of __sseClients) {
                try {
                    c.res.write(payload);
                } catch (_) {
                    /* ignore */
                }
            }
            // Legacy compatibility: check for global adminSseClients if available
            try {
                if (
                    typeof global.adminSseClients !== 'undefined' &&
                    global.adminSseClients &&
                    global.adminSseClients.size
                ) {
                    for (const res of global.adminSseClients) {
                        try {
                            res.write(payload);
                        } catch (_) {
                            /* ignore */
                        }
                    }
                }
            } catch (_) {
                /* ignore */
            }
            return true;
        } catch (_) {
            return false;
        }
    };

    // Cleanup hook for tests or hot-reload
    const cleanup = () => {
        try {
            logger.events.off('log', __onLog);
        } catch (_) {
            /* ignore */
        }
        __sseClients.clear();
    };

    global.__adminSSECleanup = cleanup;

    logger.info('✅ SSE server initialized on /api/admin/events');

    return {
        cleanup,
        broadcast: global.__adminSSEBroadcast,
    };
}

module.exports = {
    initializeWebSocketServer,
    initializeSSEServer,
};
