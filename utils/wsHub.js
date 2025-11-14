const WebSocket = require('ws');
const logger = require('./logger');
const ErrorLogger = require('./errorLogger');
const { validateMessage, MessageRateLimiter, MAX_MESSAGE_SIZE } = require('./wsMessageValidator');

// In-memory maps
const deviceToSocket = new Map(); // deviceId -> ws
const socketToDevice = new WeakMap(); // ws -> deviceId

let wss = null;

// Pending command acknowledgements: id -> { resolve, reject, timer, deviceId }
const pendingAcks = new Map();

// Rate limiter for WebSocket messages (Issue #5 fix)
const rateLimiter = new MessageRateLimiter();

function genId() {
    // Simple unique id: timestamp + random
    return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

function sendJson(ws, obj) {
    try {
        ws.send(JSON.stringify(obj));
    } catch (e) {
        logger.debug('WebSocket send failed', {
            error: e.message,
            messageType: obj.kind || obj.type,
            readyState: ws.readyState,
        });
    }
}

function closeSocket(ws, code = 1008, reason = 'Policy violation') {
    try {
        ws.close(code, reason);
    } catch (e) {
        logger.debug('WebSocket close failed', {
            error: e.message,
            code,
            reason,
            readyState: ws.readyState,
        });
    }
}

function registerConnection(ws, deviceId) {
    // Drop existing connection for this device (single active connection policy)
    const existing = deviceToSocket.get(deviceId);
    if (existing && existing !== ws) {
        try {
            logger.debug('🔄 WebSocket: Replacing existing connection', {
                deviceId,
                reason: 'single_connection_policy',
            });
            existing.terminate();
        } catch (e) {
            logger.debug('WebSocket terminate failed during replacement', {
                error: e.message,
                deviceId,
            });
        }
    }

    deviceToSocket.set(deviceId, ws);
    socketToDevice.set(ws, deviceId);

    logger.debug('🟢 WebSocket: Device connected', {
        deviceId,
        totalConnections: deviceToSocket.size,
        timestamp: new Date().toISOString(),
    });

    // Notify admin dashboards via SSE for instant UI updates
    try {
        if (typeof global.__adminSSEBroadcast === 'function') {
            global.__adminSSEBroadcast('device-ws', {
                id: deviceId,
                wsConnected: true,
                timestamp: Date.now(),
            });
        }
        if (process.env.DEBUG_DEVICE_SSE === 'true') {
            logger.debug('[SSE] device-ws connect', { deviceId });
        }
    } catch (e) {
        logger.debug('SSE broadcast failed on device connect', {
            error: e.message,
            deviceId,
        });
    }
}

function unregister(ws) {
    const deviceId = socketToDevice.get(ws);
    if (deviceId) {
        deviceToSocket.delete(deviceId);
        socketToDevice.delete(ws);

        // Clean up any pending acks for this device (fail them fast)
        let cleanedUpAcks = 0;
        for (const [id, p] of pendingAcks) {
            if (p.deviceId === deviceId) {
                try {
                    clearTimeout(p.timer);
                } catch (e) {
                    logger.debug('clearTimeout failed in unregister', {
                        error: e.message,
                        ackId: id,
                        deviceId,
                    });
                }
                pendingAcks.delete(id);
                try {
                    p.reject(new Error('socket_closed'));
                } catch (e) {
                    logger.debug('Promise reject failed in unregister', {
                        error: e.message,
                        ackId: id,
                        deviceId,
                    });
                }
                cleanedUpAcks++;
            }
        }

        // Cleanup rate limiter tracking (Issue #5 fix)
        rateLimiter.cleanup(deviceId);

        logger.debug('🔴 WebSocket: Device disconnected', {
            deviceId,
            cleanedUpAcks,
            totalConnections: deviceToSocket.size,
            timestamp: new Date().toISOString(),
        });

        // Notify admin dashboards via SSE for instant UI updates
        try {
            if (typeof global.__adminSSEBroadcast === 'function') {
                global.__adminSSEBroadcast('device-ws', {
                    id: deviceId,
                    wsConnected: false,
                    timestamp: Date.now(),
                });
            }
            if (process.env.DEBUG_DEVICE_SSE === 'true') {
                logger.debug('[SSE] device-ws disconnect', { deviceId });
            }
        } catch (e) {
            logger.debug('SSE broadcast failed on device disconnect', {
                error: e.message,
                deviceId,
            });
        }
    }
}

function isConnected(deviceId) {
    const ws = deviceToSocket.get(deviceId);
    return !!(ws && ws.readyState === WebSocket.OPEN);
}

function sendToDevice(deviceId, message) {
    const ws = deviceToSocket.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        logger.debug('📡 WebSocket message failed: device not connected', {
            deviceId,
            messageType: message.type || message.kind,
            reason: !ws ? 'no_socket' : 'socket_not_open',
        });
        return false;
    }

    sendJson(ws, message);
    logger.debug('📡 WebSocket message sent', {
        deviceId,
        messageType: message.type || message.kind,
        messageKind: message.kind,
        hasPayload: !!message.payload,
        payloadSize: message.payload ? JSON.stringify(message.payload).length : 0,
    });
    return true;
}

function sendCommand(deviceId, { type, payload }) {
    return sendToDevice(deviceId, { kind: 'command', type, payload: payload || {} });
}

function sendCommandAwait(deviceId, { type, payload, timeoutMs }) {
    const timeoutConfig = require('../config/');
    const defaultTimeout = timeoutConfig.getTimeout('wsCommandAck');
    const minTimeout = timeoutConfig.getTimeout('wsCommandAckMin');
    const effectiveTimeout = timeoutMs ? Math.max(minTimeout, timeoutMs | 0) : defaultTimeout;

    const ws = deviceToSocket.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('not_connected'));
    }
    const id = genId();
    const msg = { kind: 'command', id, type, payload: payload || {} };
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingAcks.delete(id);
            reject(new Error('ack_timeout'));
        }, effectiveTimeout);
        pendingAcks.set(id, { resolve, reject, timer, deviceId });
        try {
            sendJson(ws, msg);
        } catch (e) {
            clearTimeout(timer);
            pendingAcks.delete(id);
            reject(e);
        }
    });
}

function sendApplySettings(deviceId, settingsOverride) {
    return sendToDevice(deviceId, {
        kind: 'apply-settings',
        payload: settingsOverride || {},
    });
}

function broadcast(message) {
    try {
        for (const [, ws] of deviceToSocket) {
            if (ws && ws.readyState === WebSocket.OPEN) sendJson(ws, message);
        }
        return true;
    } catch (e) {
        logger.debug('WebSocket broadcast failed', {
            error: e.message,
            messageType: message.kind || message.type,
            totalDevices: deviceToSocket.size,
        });
        return false;
    }
}

function init(httpServer, { path = '/ws/devices', verifyDevice } = {}) {
    if (wss) return wss;
    wss = new WebSocket.Server({ server: httpServer, path });
    logger.info(`[WS] Device WebSocket listening on ${path}`);

    wss.on('connection', (ws, req) => {
        const ip =
            (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        logger.debug('[WS] connection from', ip);

        // State machine: pending -> authenticating -> authenticated -> failed
        let authState = 'pending';
        let deviceId = null;
        let messageQueue = [];
        let isProcessingAuth = false;
        let authTimeout = null;

        // Set authentication timeout (10 seconds)
        authTimeout = setTimeout(() => {
            if (authState !== 'authenticated') {
                logger.warn('[WS] Authentication timeout', {
                    ip,
                    authState,
                    queuedMessages: messageQueue.length,
                });
                authState = 'failed';
                messageQueue = [];
                closeSocket(ws, 1008, 'Authentication timeout');
            }
        }, 10000);

        /**
         * Process authenticated messages
         */
        function processAuthenticatedMessage(msg) {
            // Ack from device for a previously sent command
            if (msg && msg.kind === 'ack' && msg.id) {
                const p = pendingAcks.get(msg.id);
                if (p && p.deviceId === deviceId) {
                    pendingAcks.delete(msg.id);
                    try {
                        clearTimeout(p.timer);
                    } catch (e) {
                        logger.debug('clearTimeout failed on ack receive', {
                            error: e.message,
                            ackId: msg.id,
                            deviceId,
                        });
                    }
                    try {
                        p.resolve({
                            status: msg.status || 'ok',
                            info: msg.info || null,
                        });
                    } catch (e) {
                        logger.debug('Promise resolve handler threw error', {
                            error: e.message,
                            ackId: msg.id,
                            deviceId,
                            status: msg.status,
                        });
                    }
                }
                return;
            }

            // Handle ping/pong for connection health
            if (msg && msg.kind === 'ping') {
                sendJson(ws, { kind: 'pong', t: Date.now() });
                return;
            }

            // Future: handle other client->server messages (e.g., state reports)
        }

        ws.on('message', async data => {
            try {
                // Check message size (Issue #5 fix)
                if (data.length > MAX_MESSAGE_SIZE) {
                    logger.warn('[WS] Message too large', {
                        size: data.length,
                        maxSize: MAX_MESSAGE_SIZE,
                        ip,
                        deviceId,
                    });
                    return closeSocket(ws, 1009, 'Message too large');
                }

                // Parse JSON with error handling
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                } catch (parseError) {
                    logger.warn('[WS] Invalid JSON', {
                        error: parseError.message,
                        ip,
                        deviceId,
                        dataLength: data.length,
                    });
                    return closeSocket(ws, 1007, 'Invalid JSON');
                }

                // Validate message structure (Issue #5 fix)
                const validation = validateMessage(msg);
                if (!validation.valid) {
                    logger.warn('[WS] Invalid message', {
                        error: validation.error,
                        kind: msg?.kind,
                        ip,
                        deviceId,
                    });

                    // Send error back to client for debugging
                    sendJson(ws, {
                        kind: 'error',
                        message: 'Invalid message format',
                        details: validation.error,
                    });

                    // Close for repeated invalid messages during auth
                    if (authState !== 'authenticated') {
                        return closeSocket(ws, 1008, 'Invalid message format');
                    }

                    return;
                }

                msg = validation.value; // Use validated/sanitized message

                // Rate limiting for authenticated devices (Issue #5 fix)
                if (authState === 'authenticated' && deviceId) {
                    if (!rateLimiter.checkRateLimit(deviceId)) {
                        logger.warn('[WS] Rate limit exceeded', {
                            deviceId,
                            ip,
                            stats: rateLimiter.getStats(deviceId),
                        });
                        return closeSocket(ws, 1008, 'Rate limit exceeded');
                    }
                }

                // Immediate rejection if auth failed
                if (authState === 'failed') {
                    return closeSocket(ws, 1008, 'Authentication failed');
                }

                // Queue messages during authentication
                if (authState === 'pending' || authState === 'authenticating') {
                    if (msg && msg.kind === 'hello') {
                        // Prevent duplicate auth attempts
                        if (isProcessingAuth) {
                            logger.warn('[WS] Duplicate auth attempt', { ip });
                            return closeSocket(ws, 1008, 'Duplicate auth attempt');
                        }

                        isProcessingAuth = true;
                        authState = 'authenticating';

                        const { deviceId: id, secret } = msg;
                        if (!id || !secret) {
                            authState = 'failed';
                            return closeSocket(ws, 1008, 'Missing credentials');
                        }

                        try {
                            const ok = await verifyDevice(id, secret);

                            if (!ok) {
                                authState = 'failed';
                                return closeSocket(ws, 1008, 'Unauthorized');
                            }

                            // Authentication successful
                            authState = 'authenticated';
                            deviceId = id;
                            clearTimeout(authTimeout);
                            authTimeout = null;

                            registerConnection(ws, id);

                            // Log successful WebSocket device connection
                            const userAgent = req.headers['user-agent'] || 'Unknown';
                            logger.debug(
                                `[WS] Device authenticated: ${ip} (${userAgent.substring(0, 40)}) - ${id.substring(0, 8)}...`,
                                {
                                    deviceId: id,
                                    ip,
                                    userAgent: userAgent.substring(0, 100),
                                    timestamp: new Date().toISOString(),
                                    queuedMessages: messageQueue.length,
                                }
                            );

                            sendJson(ws, { kind: 'hello-ack', serverTime: Date.now() });

                            // Process queued messages
                            while (messageQueue.length > 0 && authState === 'authenticated') {
                                const queuedMsg = messageQueue.shift();
                                try {
                                    processAuthenticatedMessage(queuedMsg);
                                } catch (e) {
                                    logger.debug('[WS] Error processing queued message', {
                                        error: e.message,
                                        deviceId,
                                        messageKind: queuedMsg?.kind,
                                    });
                                }
                            }
                        } catch (e) {
                            authState = 'failed';
                            // Use standardized error logging (Issue #6 fix)
                            ErrorLogger.logWebSocketError(e, deviceId || 'unknown', {
                                ip,
                                action: 'authentication',
                            });
                            return closeSocket(ws, 1011, 'Auth error');
                        } finally {
                            isProcessingAuth = false;
                        }
                    } else {
                        // Queue non-hello messages (limit queue size to prevent memory exhaustion)
                        if (messageQueue.length < 10) {
                            messageQueue.push(msg);
                            logger.debug('[WS] Message queued during auth', {
                                ip,
                                messageKind: msg?.kind,
                                queueSize: messageQueue.length,
                            });
                        } else {
                            logger.warn('[WS] Message queue overflow', {
                                ip,
                                queueSize: messageQueue.length,
                            });
                            authState = 'failed';
                            return closeSocket(ws, 1008, 'Message queue overflow');
                        }
                    }
                    return;
                }

                // Only authenticated messages reach here
                if (authState === 'authenticated') {
                    processAuthenticatedMessage(msg);
                }
            } catch (e) {
                // Use standardized error logging (Issue #6 fix)
                ErrorLogger.logWebSocketError(e, deviceId || 'unknown', {
                    ip,
                    authState,
                    action: 'message_handling',
                });
                if (authState !== 'authenticated') {
                    return closeSocket(ws, 1011, 'Message processing error');
                }
            }
        });

        ws.on('close', () => {
            if (authTimeout) {
                clearTimeout(authTimeout);
                authTimeout = null;
            }
            messageQueue = [];
            unregister(ws);
        });

        ws.on('error', () => {
            if (authTimeout) {
                clearTimeout(authTimeout);
                authTimeout = null;
            }
            messageQueue = [];
            unregister(ws);
        });
    });

    return wss;
}

/**
 * Broadcast message to admin clients via SSE
 * @param {object} message - Message with kind and payload
 */
function broadcastAdmin(message) {
    if (typeof global.__adminSSEBroadcast === 'function') {
        global.__adminSSEBroadcast(message.kind, message.payload || {});
        return true;
    }
    return false;
}

module.exports = {
    init,
    isConnected,
    sendToDevice,
    sendCommand,
    sendCommandAwait,
    sendApplySettings,
    broadcast,
    broadcastAdmin,
};
