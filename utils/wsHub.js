const WebSocket = require('ws');
const logger = require('./logger');

// In-memory maps
const deviceToSocket = new Map(); // deviceId -> ws
const socketToDevice = new WeakMap(); // ws -> deviceId

let wss = null;

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
            existing.terminate();
        } catch (_) {
            /* ignore terminate errors */
        }
    }
    deviceToSocket.set(deviceId, ws);
    socketToDevice.set(ws, deviceId);
}

function unregister(ws) {
    const deviceId = socketToDevice.get(ws);
    if (deviceId) {
        deviceToSocket.delete(deviceId);
        socketToDevice.delete(ws);
    }
}

function isConnected(deviceId) {
    const ws = deviceToSocket.get(deviceId);
    return !!(ws && ws.readyState === WebSocket.OPEN);
}

function sendToDevice(deviceId, message) {
    const ws = deviceToSocket.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    sendJson(ws, message);
    return true;
}

function sendCommand(deviceId, { type, payload }) {
    return sendToDevice(deviceId, { kind: 'command', type, payload: payload || {} });
}

function sendApplySettings(deviceId, settingsOverride) {
    return sendToDevice(deviceId, {
        kind: 'apply-settings',
        payload: settingsOverride || {},
    });
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
                            sendJson(ws, { kind: 'hello-ack', serverTime: Date.now() });
                            return;
                        } catch (e) {
                            return closeSocket(ws, 1011, 'Auth error');
                        }
                    }
                    return closeSocket(ws, 1008, 'Authenticate first');
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
    sendApplySettings,
};
