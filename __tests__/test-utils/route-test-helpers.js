/**
 * Test Utilities for Isolated Route Testing
 *
 * Provides helpers for testing route modules without loading the full server.
 * Eliminates timing/race conditions from full server startup.
 */

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

/**
 * Create a mock device store with in-memory storage
 * @returns {Object} Mock device store implementation
 */
function createMockDeviceStore() {
    const devices = new Map();
    const pairingCodes = new Map();

    return {
        // Storage
        devices,
        pairingCodes,

        // Device management
        async registerDevice({ name, location, installId, hardwareId }) {
            const deviceId = `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const secret = `secret-${Math.random().toString(36).slice(2)}`;

            const device = {
                id: deviceId,
                name: name || 'Test Device',
                location: location || '',
                installId: installId || null,
                hardwareId: hardwareId || null,
                createdAt: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                secret,
                isPaired: false,
                settings: {},
                commandQueue: [],
                reload: false,
                status: 'offline',
            };

            devices.set(deviceId, device);
            return { device: { ...device, id: deviceId }, secret };
        },

        async getDevice(deviceId) {
            return devices.get(deviceId) || null;
        },

        async getById(deviceId) {
            return devices.get(deviceId) || null;
        },

        async getAll() {
            return Array.from(devices.values());
        },

        async verifyDevice(deviceId, deviceSecret) {
            const device = devices.get(deviceId);
            if (!device) return null;
            if (device.secret !== deviceSecret) return null;
            return device;
        },

        async updateDevice(deviceId, updates) {
            const device = devices.get(deviceId);
            if (!device) throw new Error('Device not found');
            Object.assign(device, updates, { lastSeen: new Date().toISOString() });
            devices.set(deviceId, device);
            return device;
        },

        async patchDevice(deviceId, updates) {
            const device = devices.get(deviceId);
            if (!device) throw new Error('Device not found');
            Object.assign(device, updates);
            devices.set(deviceId, device);
            return device;
        },

        async deleteDevice(deviceId) {
            return devices.delete(deviceId);
        },

        async listDevices() {
            return Array.from(devices.values());
        },

        // Pairing management
        async generatePairingCode(deviceId, ttlMs = 60000) {
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const token = `token-${Math.random().toString(36).slice(2)}`;
            const expiresAt = new Date(Date.now() + ttlMs).toISOString();

            pairingCodes.set(code, {
                deviceId,
                token,
                expiresAt,
                claimed: false,
            });

            // Auto-expire
            setTimeout(() => pairingCodes.delete(code), ttlMs);

            return { code, token, expiresAt };
        },

        async claimByPairingCode(params) {
            // Support both object parameter and direct code/token parameters
            const code = typeof params === 'string' ? params : params.code;
            const token = typeof params === 'object' ? params.token : arguments[1];

            const pairing = pairingCodes.get(code);
            if (!pairing) return null; // Return null instead of throwing
            if (pairing.claimed) return null;
            if (token && pairing.token !== token) return null;
            if (new Date(pairing.expiresAt) < new Date()) return null;

            pairing.claimed = true;

            const device = devices.get(pairing.deviceId);
            if (!device) return null;

            // Apply name/location if provided
            if (params.name) device.name = params.name;
            if (params.location) device.location = params.location;

            // Rotate secret
            const newSecret = `secret-${Math.random().toString(36).slice(2)}`;
            device.secret = newSecret;
            device.isPaired = true;
            devices.set(pairing.deviceId, device);

            return { device, secret: newSecret };
        },

        async getActivePairings() {
            const now = new Date();
            const active = [];
            for (const [code, pairing] of pairingCodes) {
                if (!pairing.claimed && new Date(pairing.expiresAt) > now) {
                    active.push({ code, ...pairing });
                }
            }
            return active;
        },

        // Settings management
        async updateDeviceSettings(deviceId, settings) {
            const device = devices.get(deviceId);
            if (!device) throw new Error('Device not found');
            device.settings = { ...device.settings, ...settings };
            devices.set(deviceId, device);
            return device;
        },

        async getDeviceSettings(deviceId) {
            const device = devices.get(deviceId);
            return device?.settings || {};
        },

        // Command queue
        async enqueueCommand(deviceId, command) {
            const device = devices.get(deviceId);
            if (!device) throw new Error('Device not found');
            if (!device.commandQueue) device.commandQueue = [];
            device.commandQueue.push({ ...command, id: `cmd-${Date.now()}` });
            devices.set(deviceId, device);
            return device.commandQueue[device.commandQueue.length - 1];
        },

        async queueCommand(deviceId, command) {
            return this.enqueueCommand(deviceId, command);
        },

        async dequeueCommands(deviceId) {
            const device = devices.get(deviceId);
            if (!device) return [];
            const commands = device.commandQueue || [];
            device.commandQueue = [];
            devices.set(deviceId, device);
            return commands;
        },

        popCommands(deviceId) {
            const device = devices.get(deviceId);
            if (!device) return [];
            const commands = device.commandQueue || [];
            device.commandQueue = [];
            devices.set(deviceId, device);
            return commands;
        },

        // Merge devices
        async mergeDevices(keepId, removeId) {
            const keep = devices.get(keepId);
            const remove = devices.get(removeId);
            if (!keep || !remove) throw new Error('Device not found');

            // Merge command queues
            keep.commandQueue = [...(keep.commandQueue || []), ...(remove.commandQueue || [])];
            devices.set(keepId, keep);
            devices.delete(removeId);

            return keep;
        },

        // Heartbeat
        async recordHeartbeat(deviceId, data) {
            const device = devices.get(deviceId);
            if (!device) throw new Error('Device not found');

            device.lastSeen = new Date().toISOString();
            device.lastHeartbeat = data;
            devices.set(deviceId, device);

            return {
                device,
                commandsQueued: device.commandQueue || [],
            };
        },
    };
}

/**
 * Create a mock WebSocket hub
 * @returns {Object} Mock WebSocket hub implementation
 */
function createMockWsHub() {
    const connections = new Map();
    const emitter = new EventEmitter();

    return {
        // Connection management
        connections,
        emitter,

        isConnected(deviceId) {
            return connections.has(deviceId);
        },

        getConnection(deviceId) {
            return connections.get(deviceId);
        },

        addConnection(deviceId, ws) {
            connections.set(deviceId, ws);
            emitter.emit('connected', deviceId);
        },

        removeConnection(deviceId) {
            connections.delete(deviceId);
            emitter.emit('disconnected', deviceId);
        },

        // Command sending
        async sendCommand(deviceId, command) {
            if (!connections.has(deviceId)) {
                throw new Error('Device not connected');
            }

            const connection = connections.get(deviceId);
            if (connection && connection.send) {
                connection.send(JSON.stringify(command));
            }

            emitter.emit('command', { deviceId, command });
            return { sent: true, deviceId, command };
        },
        async sendCommandAwait(deviceId, command, options = {}) {
            const timeoutMs = options.timeoutMs || 5000;

            if (!connections.has(deviceId)) {
                throw new Error('Device not connected');
            }

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Command timeout'));
                }, timeoutMs);

                // Simulate immediate ACK for tests
                setTimeout(() => {
                    clearTimeout(timeout);
                    resolve({
                        success: true,
                        deviceId,
                        command,
                        ack: { status: 'ok', timestamp: Date.now() },
                    });
                }, 50);

                this.sendCommand(deviceId, command);
            });
        },

        // Broadcasting
        async broadcast(command, filter = null) {
            const results = [];

            for (const [deviceId] of connections) {
                if (filter && !filter(deviceId)) continue;

                try {
                    await this.sendCommand(deviceId, command);
                    results.push({ deviceId, success: true });
                } catch (error) {
                    results.push({ deviceId, success: false, error: error.message });
                }
            }

            return results;
        },

        async sendApplySettings(deviceId, settings) {
            return this.sendCommand(deviceId, {
                type: 'core.mgmt.applySettings',
                payload: settings,
            });
        },

        // Event listeners
        on(event, handler) {
            emitter.on(event, handler);
        },

        off(event, handler) {
            emitter.off(event, handler);
        },
    };
}

/**
 * Create a mock admin authentication middleware
 * @param {boolean} authenticated - Whether to allow requests
 * @returns {Function} Express middleware
 */
function createMockAdminAuth(authenticated = true) {
    return (req, res, next) => {
        if (!authenticated) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = { id: 'test-admin', username: 'admin' };
        next();
    };
}

/**
 * Create a mock rate limiter that always allows requests
 * @returns {Function} Express middleware
 */
function createMockRateLimiter() {
    return (req, res, next) => next();
}

/**
 * Create a mock async handler (passthrough)
 * @param {Function} fn - Route handler function
 * @returns {Function} Wrapped handler
 */
function createMockAsyncHandler(fn) {
    return (req, res, _next) => {
        Promise.resolve(fn(req, res, _next)).catch(_next);
    };
}

/**
 * Create a mock logger
 * @returns {Object} Mock logger
 */
function createMockLogger() {
    const logs = [];

    const log = (level, message, meta = {}) => {
        logs.push({ level, message, meta, timestamp: new Date().toISOString() });
    };

    return {
        logs,
        debug: (msg, meta) => log('debug', msg, meta),
        info: (msg, meta) => log('info', msg, meta),
        warn: (msg, meta) => log('warn', msg, meta),
        error: (msg, meta) => log('error', msg, meta),
        clearLogs: () => logs.splice(0, logs.length),
    };
}

/**
 * Create a mock API Error class
 * @returns {Class} ApiError class
 */
function createMockApiError() {
    return class ApiError extends Error {
        constructor(message, statusCode = 500, details = {}) {
            super(message);
            this.name = 'ApiError';
            this.statusCode = statusCode;
            this.details = details;
        }
    };
}

/**
 * Setup an Express app with a router for testing
 * @param {express.Router} router - Router to mount
 * @param {string} basePath - Base path to mount router at (default: '/')
 * @returns {express.Application} Express app
 */
function setupTestApp(router, basePath = '/') {
    const app = express();

    // Standard middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mount router
    app.use(basePath, router);

    // Error handler
    app.use((err, req, res, _next) => {
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            error: err.message || 'Internal server error',
            details: err.details || {},
        });
    });

    return app;
}

/**
 * Create a complete test context for device routes
 * @param {Object} options - Configuration options
 * @returns {Object} Test context with app, mocks, and helpers
 */
function createDeviceRouteTestContext(options = {}) {
    const { authenticated = true, config = {}, isDebug = false } = options;

    // Create mocks
    const deviceStore = createMockDeviceStore();
    const wsHub = createMockWsHub();
    const logger = createMockLogger();
    const ApiError = createMockApiError();

    // Create middleware
    const adminAuth = createMockAdminAuth(authenticated);
    const adminAuthDevices = createMockAdminAuth(authenticated);
    const testSessionShim = (req, res, next) => next();
    const deviceBypassMiddleware = (req, res, next) => {
        req.deviceBypass = false;
        next();
    };
    const deviceRegisterLimiter = createMockRateLimiter();
    const devicePairClaimLimiter = createMockRateLimiter();
    const asyncHandler = createMockAsyncHandler;

    // Load devices router
    const createDevicesRouter = require('../../routes/devices');
    const router = createDevicesRouter({
        deviceStore,
        wsHub,
        adminAuth,
        adminAuthDevices,
        testSessionShim,
        _deviceBypassMiddleware: deviceBypassMiddleware,
        deviceRegisterLimiter,
        devicePairClaimLimiter,
        _asyncHandler: asyncHandler,
        _ApiError: ApiError,
        logger,
        isDebug,
        config: { ...config, deviceManagementEnabled: true },
    });

    // Create Express app
    const app = setupTestApp(router, '/api/devices');

    return {
        app,
        request: () => request(app),
        mocks: {
            deviceStore,
            wsHub,
            logger,
            ApiError,
        },
        helpers: {
            async registerDevice(data = {}) {
                const defaults = {
                    installId: `iid-${Date.now()}`,
                    hardwareId: `hw-${Date.now()}`,
                    name: 'Test Device',
                    location: 'Test Location',
                };

                const response = await request(app)
                    .post('/api/devices/register')
                    .send({ ...defaults, ...data });

                return response;
            },

            async sendHeartbeat(deviceId, deviceSecret, data = {}) {
                const defaults = {
                    deviceId,
                    secret: deviceSecret,
                    installId: `iid-${Date.now()}`,
                    hardwareId: `hw-${Date.now()}`,
                    userAgent: 'test-agent',
                    screen: { w: 1920, h: 1080, dpr: 1 },
                    mode: 'screensaver',
                };

                const response = await request(app)
                    .post('/api/devices/heartbeat')
                    .send({ ...defaults, ...data });

                return response;
            },

            async generatePairingCode(deviceId, ttlMs = 120000) {
                // Since the /:id/pairing-code endpoint doesn't exist in routes,
                // we generate the code directly via the mock device store and
                // return a response-like object for compatibility with tests
                try {
                    const result = await deviceStore.generatePairingCode(deviceId, ttlMs);
                    return {
                        status: 200,
                        body: result,
                    };
                } catch (error) {
                    return {
                        status: 404,
                        body: { error: error.message },
                    };
                }
            },

            async claimPairing(code, token) {
                const response = await request(app).post('/api/devices/pair').send({ code, token });

                return response;
            },
        },
    };
}

module.exports = {
    createMockDeviceStore,
    createMockWsHub,
    createMockAdminAuth,
    createMockRateLimiter,
    createMockAsyncHandler,
    createMockLogger,
    createMockApiError,
    setupTestApp,
    createDeviceRouteTestContext,
};
