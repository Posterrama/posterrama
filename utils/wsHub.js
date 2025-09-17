const WebSocket = require('ws');
const logger = require('./logger');

// In-memory maps
const deviceToSocket = new Map(); // deviceId -> ws
const socketToDevice = new WeakMap(); // ws -> deviceId

let wss = null;

// Pending command acknowledgements: id -> { resolve, reject, timer, deviceId }
const pendingAcks = new Map();

function genId() {
    // Simple unique id: timestamp + random
    return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

function sendJson(ws, obj) {
    try {
        ws.send(JSON.stringify(obj));
    } catch (e) {
        // ignore send errors
    }
}

function closeSocket(ws, code = 1008, reason = 'Policy violation') {
    try {
        ws.close(code, reason);
    } catch (_) {
        /* ignore close errors */
    }
}

function registerConnection(ws, deviceId) {
    // Drop existing connection for this device (single active connection policy)
    const existing = deviceToSocket.get(deviceId);
    if (existing && existing !== ws) {
        try {
            logger.info('🔄 WebSocket: Replacing existing connection', {
                deviceId,
                reason: 'single_connection_policy',
            });
            existing.terminate();
        } catch (_) {
            /* ignore terminate errors */
        }
    }

    deviceToSocket.set(deviceId, ws);
    socketToDevice.set(ws, deviceId);

    logger.info('🟢 WebSocket: Device connected', {
        deviceId,
        totalConnections: deviceToSocket.size,
        timestamp: new Date().toISOString(),
    });
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
                } catch (_) {
                    /* noop: ignore clearTimeout errors */
                }
                pendingAcks.delete(id);
                try {
                    p.reject(new Error('socket_closed'));
                } catch (_) {
                    /* noop: reject error ignored */
                }
                cleanedUpAcks++;
            }
        }

        logger.info('🔴 WebSocket: Device disconnected', {
            deviceId,
            cleanedUpAcks,
            totalConnections: deviceToSocket.size,
            timestamp: new Date().toISOString(),
        });
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

function sendCommandAwait(deviceId, { type, payload, timeoutMs = 3000 }) {
    const ws = deviceToSocket.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('not_connected'));
    }
    const id = genId();
    const msg = { kind: 'command', id, type, payload: payload || {} };
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => {
                pendingAcks.delete(id);
                reject(new Error('ack_timeout'));
            },
            Math.max(500, timeoutMs | 0)
        );
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
    } catch (_) {
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

        let authed = false;

        ws.on('message', async data => {
            try {
                const msg = JSON.parse(data.toString());
                if (!authed) {
                    if (msg && msg.kind === 'hello') {
                        const { deviceId: id, deviceSecret: secret } = msg;
                        if (!id || !secret) return closeSocket(ws, 1008, 'Missing credentials');
                        try {
                            const ok = await verifyDevice(id, secret);
                            if (!ok) return closeSocket(ws, 1008, 'Unauthorized');
                            authed = true;
                            registerConnection(ws, id);

                            // Log successful WebSocket device connection
                            const userAgent = req.headers['user-agent'] || 'Unknown';
                            logger.info(
                                `[WS] Device connected: ${ip} (${userAgent.substring(0, 40)}) - ${id.substring(0, 8)}...`,
                                {
                                    deviceId: id,
                                    ip,
                                    userAgent: userAgent.substring(0, 100),
                                    timestamp: new Date().toISOString(),
                                }
                            );

                            sendJson(ws, { kind: 'hello-ack', serverTime: Date.now() });
                            return;
                        } catch (e) {
                            return closeSocket(ws, 1011, 'Auth error');
                        }
                    }
                    return closeSocket(ws, 1008, 'Authenticate first');
                }
                // Ack from device for a previously sent command
                if (msg && msg.kind === 'ack' && msg.id) {
                    const deviceId = socketToDevice.get(ws);
                    const p = pendingAcks.get(msg.id);
                    if (p && p.deviceId === deviceId) {
                        pendingAcks.delete(msg.id);
                        try {
                            clearTimeout(p.timer);
                        } catch (_) {
                            /* noop: ignore clearTimeout on resolve */
                        }
                        try {
                            p.resolve({
                                status: msg.status || 'ok',
                                info: msg.info || null,
                            });
                        } catch (_) {
                            /* noop: resolve handler threw */
                        }
                    }
                    return; // nothing else to do for ack
                }
                // Future: handle client->server messages (e.g., state reports)
                if (msg && msg.kind === 'ping') {
                    sendJson(ws, { kind: 'pong', t: Date.now() });
                }
            } catch (e) {
                // ignore malformed
            }
        });

        ws.on('close', () => {
            unregister(ws);
        });
        ws.on('error', () => {
            unregister(ws);
        });
    });

    return wss;
}

module.exports = {
    init,
    isConnected,
    sendToDevice,
    sendCommand,
    sendCommandAwait,
    sendApplySettings,
    broadcast,
};
