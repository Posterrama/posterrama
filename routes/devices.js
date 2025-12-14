/**
 * Device Management Routes
 * Handles device registration, pairing, heartbeat, listing, and WebSocket commands
 */

const express = require('express');
const deviceOps = require('../lib/device-operations');
/**
 * @typedef {Object} DeviceRequestExtensions
 * @property {boolean} [deviceBypass] - Whether device bypass mode is enabled
 */

/**
 * @typedef {import('express').Request & DeviceRequestExtensions} DeviceRequest
 */

/**
 * Create devices router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Object} deps.deviceStore - Device storage manager
 * @param {Object} deps.wsHub - WebSocket hub for device communication
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @param {Function} deps.adminAuthDevices - Admin auth middleware for device management
 * @param {Function} deps.testSessionShim - Test session shim middleware
 * @param {Function} deps.deviceBypassMiddleware - Device bypass middleware
 * @param {Function} deps.deviceRegisterLimiter - Rate limiter for registration
 * @param {Function} deps.devicePairClaimLimiter - Rate limiter for pairing
 * @param {Function} deps.asyncHandler - Async error handler wrapper
 * @param {Function} deps.ApiError - API error class constructor
 * @param {Object} deps.logger - Logger instance
 * @param {boolean} deps.isDebug - Debug mode flag
 * @param {Object} deps.config - Application configuration
 * @returns {express.Router} Configured router
 */
module.exports = function createDevicesRouter({
    deviceStore,
    wsHub,
    adminAuth,
    adminAuthDevices,
    testSessionShim,
    // @ts-ignore - unused parameter for API compatibility
    _deviceBypassMiddleware,
    deviceRegisterLimiter,
    devicePairClaimLimiter,
    // @ts-ignore - unused parameter for API compatibility
    _asyncHandler,
    // @ts-ignore - unused parameter for API compatibility
    _ApiError,
    logger,
    isDebug,
    config,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /api/devices/register:
     *   post:
     *     summary: Register a new device
     *     description: Register a new display device to receive media and commands. Returns device ID and secret for authentication.
     *     tags: ['Devices']
     *     x-codeSamples:
     *       - lang: 'curl'
     *         label: 'cURL'
     *         source: |
     *           curl -X POST http://localhost:4000/api/devices/register \
     *             -H "Content-Type: application/json" \
     *             -d '{"name": "Living Room TV", "location": "living-room"}'
     *       - lang: 'JavaScript'
     *         label: 'JavaScript (fetch)'
     *         source: |
     *           fetch('http://localhost:4000/api/devices/register', {
     *             method: 'POST',
     *             headers: { 'Content-Type': 'application/json' },
     *             body: JSON.stringify({
     *               name: 'Living Room TV',
     *               location: 'living-room'
     *             })
     *           })
     *             .then(response => response.json())
     *             .then(data => console.log('Device ID:', data.deviceId));
     *       - lang: 'Python'
     *         label: 'Python (requests)'
     *         source: |
     *           import requests
     *           response = requests.post(
     *               'http://localhost:4000/api/devices/register',
     *               json={'name': 'Living Room TV', 'location': 'living-room'}
     *           )
     *           device = response.json()
     *           print(f"Device ID: {device['deviceId']}")
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *                 description: Device name (optional, defaults to timestamp)
     *               location:
     *                 type: string
     *                 description: Device location (optional)
     *               installId:
     *                 type: string
     *                 description: Install identifier for tracking across sessions
     *               hardwareId:
     *                 type: string
     *                 description: Hardware identifier (optional)
     *     responses:
     *       200:
     *         description: Device registered successfully
     *         headers:
     *           X-RateLimit-Limit:
     *             schema:
     *               type: integer
     *             description: Maximum requests allowed per time window
     *             example: 5
     *           X-RateLimit-Remaining:
     *             schema:
     *               type: integer
     *             description: Remaining requests in current window
     *             example: 4
     *           X-RateLimit-Reset:
     *             schema:
     *               type: integer
     *             description: Unix timestamp when rate limit resets
     *             example: 1699876543
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DeviceRegisterResponse'
     *             example:
     *               deviceId: dev_a1b2c3d4e5f6
     *               secret: sec_x9y8z7w6v5u4t3s2
     *               message: registered
     *       429:
     *         description: Too many registration requests. Rate limit is 5 requests per minute.
     *         headers:
     *           Retry-After:
     *             schema:
     *               type: integer
     *             description: Seconds to wait before retrying
     *             example: 42
     *           X-RateLimit-Limit:
     *             schema:
     *               type: integer
     *             example: 5
     *           X-RateLimit-Remaining:
     *             schema:
     *               type: integer
     *             example: 0
     *           X-RateLimit-Reset:
     *             schema:
     *               type: integer
     *             example: 1699876585
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StandardErrorResponse'
     *             example:
     *               error: Too many requests
     *               message: Rate limit exceeded. Please wait 42 seconds before retrying.
     *               statusCode: 429
     *       500:
     *         description: Register failed
     */
    router.post(
        '/register',
        // @ts-ignore - Express router overload issue with rate limiter
        deviceRegisterLimiter,
        express.json(),
        async (/** @type {DeviceRequest} */ req, res) => {
            try {
                const ip = Array.isArray(req.headers['x-forwarded-for'])
                    ? req.headers['x-forwarded-for'][0]
                    : (Array.isArray(req.headers['x-forwarded-for'])
                          ? req.headers['x-forwarded-for'][0]
                          : req.headers['x-forwarded-for']?.split(',')[0]
                      )?.trim() || req.ip;

                const result = await deviceOps.processDeviceRegistration(deviceStore, {
                    body: req.body,
                    headers: req.headers,
                    ip,
                    deviceBypass: req.deviceBypass,
                });

                res.json({
                    deviceId: result.device.id,
                    secret: result.secret,
                    message: 'registered',
                });
            } catch (e) {
                logger.error('[Device Register] Unexpected error', {
                    error: e.message,
                    stack: e.stack,
                });
                res.status(500).json({ error: 'register_failed' });
            }
        }
    );

    /**
     * @swagger
     * /api/devices/check:
     *   post:
     *     summary: Check device authentication and registration status
     *     description: |
     *       Verify device credentials and registration status. Used by clients to confirm their stored ID/secret are valid.
     *
     *       **Flexible Authentication**: This endpoint accepts checks with only deviceId, hardwareId, or installId (without secret)
     *       to determine if a device is registered. When a secret is provided, it validates the credentials.
     *
     *       **Response behavior**:
     *       - Device not found: Returns `{valid: false, isRegistered: false, reason: 'device_not_found'}`
     *       - Device exists, no secret: Returns `{valid: false, isRegistered: true, deviceId, reason: 'secret_required'}`
     *       - Invalid secret: Returns 401 `{valid: false, error: 'invalid_secret'}`
     *       - Valid credentials: Returns `{valid: true, isRegistered: true, deviceId}`
     *     tags: ['Devices']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               deviceId:
     *                 type: string
     *                 description: Device ID (optional if hardwareId or installId provided)
     *               secret:
     *                 type: string
     *                 description: Device secret (optional for registration check)
     *     responses:
     *       200:
     *         description: Device check completed (see response body for valid/isRegistered status)
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 valid:
     *                   type: boolean
     *                   description: Whether the provided credentials are valid
     *                 isRegistered:
     *                   type: boolean
     *                   description: Whether the device is registered in the system
     *                 deviceId:
     *                   type: string
     *                   description: Device ID (when device is found)
     *                 reason:
     *                   type: string
     *                   description: Reason code (device_not_found, secret_required, etc.)
     *               examples:
     *                 not_found:
     *                   value: {valid: false, isRegistered: false, reason: 'device_not_found'}
     *                 registered_no_secret:
     *                   value: {valid: false, isRegistered: true, deviceId: 'dev_abc123', reason: 'secret_required'}
     *                 valid_credentials:
     *                   value: {valid: true, isRegistered: true, deviceId: 'dev_abc123'}
     *       400:
     *         description: Missing device identifier (no deviceId, hardwareId, or installId)
     *       401:
     *         description: Invalid secret provided
     */
    router.post('/check', express.json(), async (req, res) => {
        try {
            const { deviceId, secret } = req.body || {};
            const hardwareId = String(req.headers['x-hardware-id'] || '');
            const installId = String(req.headers['x-install-id'] || '');

            const result = await deviceOps.checkDeviceStatus(deviceStore, {
                deviceId,
                secret,
                hardwareId,
                installId,
            });

            // Handle error responses from business logic
            if (result.error === 'invalid_secret') {
                return res.status(401).json(result);
            }

            res.json(result);
        } catch (e) {
            if (e.message === 'missing_device_identifier') {
                return res.status(400).json({ error: e.message });
            }

            logger.error('[Device Check] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            res.status(500).json({ error: 'check_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/heartbeat:
     *   post:
     *     summary: Device heartbeat
     *     description: Report device status and update last seen timestamp. Automatically clears reload flags and handles queued commands.
     *     tags: ['Devices']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - deviceId
     *               - secret
     *             properties:
     *               deviceId:
     *                 type: string
     *               secret:
     *                 type: string
     *               status:
     *                 type: object
     *                 description: Device status information
     *     responses:
     *       200:
     *         description: Heartbeat received
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                 reload:
     *                   type: boolean
     *                   description: Whether device should reload
     *                 queuedCommands:
     *                   type: array
     *                   items:
     *                     type: object
     *                   description: Commands waiting to be executed
     *       401:
     *         description: Invalid credentials
     */
    router.post('/heartbeat', express.json(), async (req, res) => {
        try {
            const result = await deviceOps.processDeviceHeartbeat(deviceStore, req.body || {});
            res.json(result);
        } catch (e) {
            // Handle known authentication errors
            const authErrors = ['missing_credentials', 'device_not_found', 'invalid_secret'];
            if (authErrors.includes(e.message)) {
                return res.status(401).json({ error: e.message });
            }

            logger.error('[Device Heartbeat] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            res.status(500).json({ error: 'heartbeat_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/bypass-check:
     *   get:
     *     summary: Check if client IP is on device bypass list
     *     description: Returns whether the requesting IP address is whitelisted for device management bypass.
     *     tags: ['Devices']
     *     responses:
     *       200:
     *         description: Bypass status
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 bypass:
     *                   type: boolean
     *                   description: Whether this IP is on the bypass list
     *                 ip:
     *                   type: string
     *                   description: The detected IP address
     */
    router.get('/bypass-check', (/** @type {DeviceRequest} */ req, res) => {
        const bypass = !!req.deviceBypass;
        const ip =
            (Array.isArray(req.headers['x-forwarded-for'])
                ? req.headers['x-forwarded-for'][0]
                : req.headers['x-forwarded-for']?.split(',')[0]
            )?.trim() ||
            req.connection?.remoteAddress ||
            req.ip ||
            'unknown';
        res.json({ bypass, ip });
    });

    /**
     * @swagger
     * /api/devices/pair:
     *   post:
     *     summary: Pair device with pairing code
     *     description: Exchange a pairing code for device credentials. Used for simplified onboarding flow.
     *     tags: ['Devices']
     *     x-codeSamples:
     *       - lang: 'curl'
     *         label: 'cURL'
     *         source: |
     *           curl -X POST http://localhost:4000/api/devices/pair \
     *             -H "Content-Type: application/json" \
     *             -d '{"code": "123456"}'
     *       - lang: 'JavaScript'
     *         label: 'JavaScript (fetch)'
     *         source: |
     *           fetch('http://localhost:4000/api/devices/pair', {
     *             method: 'POST',
     *             headers: { 'Content-Type': 'application/json' },
     *             body: JSON.stringify({ code: '123456' })
     *           })
     *             .then(response => response.json())
     *             .then(data => {
     *               console.log('Device ID:', data.deviceId);
     *               console.log('Secret:', data.secret);
     *             });
     *       - lang: 'Python'
     *         label: 'Python (requests)'
     *         source: |
     *           import requests
     *           response = requests.post(
     *               'http://localhost:4000/api/devices/pair',
     *               json={'code': '123456'}
     *           )
     *           credentials = response.json()
     *           print(f"Device ID: {credentials['deviceId']}")
     *           print(f"Secret: {credentials['secret']}")
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - code
     *             properties:
     *               code:
     *                 type: string
     *                 description: 6-digit pairing code
     *     responses:
     *       200:
     *         description: Pairing successful
     *         headers:
     *           X-RateLimit-Limit:
     *             schema:
     *               type: integer
     *             description: Maximum requests allowed per time window
     *             example: 5
     *           X-RateLimit-Remaining:
     *             schema:
     *               type: integer
     *             description: Remaining requests in current window
     *             example: 4
     *           X-RateLimit-Reset:
     *             schema:
     *               type: integer
     *             description: Unix timestamp when rate limit resets
     *             example: 1699876543
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 deviceId:
     *                   type: string
     *                 secret:
     *                   type: string
     *             example:
     *               deviceId: dev_a1b2c3d4e5f6
     *               secret: sec_x9y8z7w6v5u4t3s2
     *       400:
     *         description: Invalid or expired code
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StandardErrorResponse'
     *             example:
     *               error: invalid_code_format
     *               message: Code must be a 6-digit number
     *               statusCode: 400
     *       429:
     *         description: Too many pairing attempts. Rate limit is 5 requests per minute.
     *         headers:
     *           Retry-After:
     *             schema:
     *               type: integer
     *             description: Seconds to wait before retrying
     *             example: 42
     *           X-RateLimit-Limit:
     *             schema:
     *               type: integer
     *             example: 5
     *           X-RateLimit-Remaining:
     *             schema:
     *               type: integer
     *             example: 0
     *           X-RateLimit-Reset:
     *             schema:
     *               type: integer
     *             example: 1699876585
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StandardErrorResponse'
     *             example:
     *               error: Too many requests
     *               message: Rate limit exceeded. Please wait 42 seconds before retrying.
     *               statusCode: 429
     */
    // @ts-ignore - Express router overload issue with rate limiter
    router.post('/pair', devicePairClaimLimiter, express.json(), async (req, res) => {
        try {
            const { code } = req.body || {};
            if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
                return res.status(400).json({ error: 'invalid_code_format' });
            }

            // Check if code exists in active pairings
            const activePairings = await deviceStore.getActivePairings();
            const pairingInfo = activePairings.find(p => p.code === code);
            if (!pairingInfo) {
                return res.status(400).json({ error: 'code_not_found_or_expired' });
            }

            // Claim the code (returns device and new secret)
            const result = await deviceStore.claimByPairingCode({
                code,
                token: req.body.token || null, // Optional token for enhanced security
                name: req.body.name || pairingInfo.name,
                location: req.body.location || pairingInfo.location,
            });

            if (!result) {
                return res.status(400).json({ error: 'claim_failed' });
            }

            // Return credentials
            res.json({
                deviceId: result.device.id,
                secret: result.secret,
                name: result.device.name,
            });

            if (isDebug)
                logger.debug(`[Device Pair] Device ${result.device.id} paired via code ${code}`);
        } catch (e) {
            logger.error('[Device Pair] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            res.status(500).json({ error: 'pair_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/{id}/pairing-code:
     *   post:
     *     summary: Generate pairing code for device
     *     description: Generates a new pairing code for a specific device. Admin only.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Device ID
     *     requestBody:
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               ttlMs:
     *                 type: number
     *                 description: Time-to-live in milliseconds
     *                 default: 600000
     *               requireToken:
     *                 type: boolean
     *                 description: Whether token is required for pairing
     *                 default: false
     *     responses:
     *       200:
     *         description: Pairing code generated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 code:
     *                   type: string
     *                 deviceId:
     *                   type: string
     *                 expiresAt:
     *                   type: string
     *                 expiresInMs:
     *                   type: number
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Device not found
     */
    // @ts-ignore - Express router overload issue with adminAuth
    router.post('/:id/pairing-code', adminAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const { ttlMs = 600000, requireToken = false } = req.body || {};

            // Verify device exists
            const device = await deviceStore.getById(id);
            if (!device) {
                return res.status(404).json({ error: 'device_not_found' });
            }

            // Generate pairing code
            const result = await deviceStore.generatePairingCode(id, {
                ttlMs: Number(ttlMs),
                requireToken: Boolean(requireToken),
            });

            if (!result) {
                return res.status(500).json({ error: 'generation_failed' });
            }

            const expiresAt = result.expiresAt;
            const expiresInMs = Number(ttlMs);

            res.json({
                code: result.code,
                deviceId: id,
                expiresAt,
                expiresInMs,
            });
        } catch (e) {
            logger.error('[Device Pairing Code] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            res.status(500).json({ error: 'generation_failed', message: e.message });
        }
    });

    /**
     * @swagger
     * /api/devices/pairing-codes/active:
     *   get:
     *     summary: List active pairing codes
     *     description: Returns all active (non-expired, unclaimed) pairing codes. Admin only.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: List of active pairing codes
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   code:
     *                     type: string
     *                   deviceId:
     *                     type: string
     *                   expiresAt:
     *                     type: string
     *                   claimed:
     *                     type: boolean
     *       401:
     *         description: Unauthorized
     */
    // @ts-ignore - Express router overload issue with adminAuth
    router.get('/pairing-codes/active', adminAuth, async (_req, res) => {
        try {
            const activeCodes = await deviceStore.getActivePairings();
            res.json(activeCodes);
        } catch (e) {
            logger.error('[Device Pairing Codes] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            res.status(500).json({ error: 'fetch_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices:
     *   get:
     *     summary: List all devices
     *     description: |
     *       Returns a list of all registered devices with their current status. Admin only.
     *
     *       **Note**: Pagination is not yet implemented. All devices are returned in a single response.
     *       Future versions may support page and limit query parameters.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: List of devices
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Device'
     *             example:
     *               - id: dev_abc123
     *                 name: Living Room TV
     *                 location: living-room
     *                 status: online
     *                 wsConnected: true
     *                 lastSeenAt: '2025-11-12T10:30:00.000Z'
     *               - id: dev_xyz789
     *                 name: Bedroom Display
     *                 location: bedroom
     *                 status: offline
     *                 wsConnected: false
     *                 lastSeenAt: '2025-11-11T22:15:00.000Z'
     *       401:
     *         description: Unauthorized
     */
    // @ts-ignore - Express router overload issue with testSessionShim
    router.get('/', testSessionShim, adminAuthDevices, async (_req, res) => {
        try {
            const devices = await deviceStore.getAll();
            // Add connection status from WebSocket hub
            const devicesWithStatus = devices.map(d => {
                const isConnected = wsHub.isConnected(d.id);
                return {
                    ...d,
                    wsConnected: isConnected,
                    connected: isConnected, // Keep both for backward compatibility
                    secret: undefined, // Don't expose secrets in list view
                };
            });
            res.json(devicesWithStatus);
        } catch (e) {
            logger.error('[Device List] Unexpected error', { error: e.message, stack: e.stack });
            res.status(500).json({ error: 'fetch_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/{id}:
     *   get:
     *     summary: Get device details
     *     description: Returns detailed information about a specific device. Admin only.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Device ID
     *     responses:
     *       200:
     *         description: Device details
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Device'
     *       404:
     *         description: Device not found
     *       401:
     *         description: Unauthorized
     */
    // @ts-ignore - Express router overload issue with testSessionShim
    router.get('/:id', testSessionShim, adminAuthDevices, async (req, res) => {
        try {
            const device = await deviceStore.getById(req.params.id);
            if (!device) {
                return res.status(404).json({ error: 'device_not_found' });
            }

            // Add connection status
            const isConnected = wsHub.isConnected(device.id);

            res.json({
                ...device,
                wsConnected: isConnected,
                connected: isConnected, // Keep both for backward compatibility
            });
        } catch (e) {
            logger.error('[Device Get] Unexpected error', { error: e.message, stack: e.stack });
            res.status(500).json({ error: 'fetch_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/{id}/preview:
     *   get:
     *     summary: Get device preview (read-only public view)
     *     description: Returns public device information without authentication. Used for display purposes.
     *     tags: ['Devices']
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Device ID
     *     responses:
     *       200:
     *         description: Device preview data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 id:
     *                   type: string
     *                 name:
     *                   type: string
     *                 location:
     *                   type: string
     *                 connected:
     *                   type: boolean
     *       404:
     *         description: Device not found
     */
    router.get('/:id/preview', async (req, res) => {
        try {
            const deviceId = req.params.id;
            if (!deviceId) {
                return res.status(400).json({ error: 'missing_device_id' });
            }

            const device = await deviceStore.getById(deviceId);
            if (!device) {
                return res.status(404).json({ error: 'device_not_found' });
            }

            // Return only safe, public fields
            const isConnected = wsHub.isConnected(device.id);

            // Use config as effective settings
            const effectiveSettings = { ...config };

            res.json({
                id: device.id,
                name: device.name || 'Unnamed Device',
                location: device.location || '',
                connected: isConnected,
                // Safe to expose: used by Cinema Now Playing filter, not a secret.
                plexUsername: device.plexUsername || null,
                settings: effectiveSettings,
                lastSeen: device.lastSeen || null,
                status: device.status || null,
            });
        } catch (e) {
            logger.error('[Device Preview] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            res.status(500).json({ error: 'preview_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/{id}:
     *   delete:
     *     summary: Delete a device
     *     description: Permanently removes a device from the system. Admin only.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Device ID
     *     responses:
     *       200:
     *         description: Device deleted successfully
     *       404:
     *         description: Device not found
     *       401:
     *         description: Unauthorized
     */
    // @ts-ignore - Express router overload issue with testSessionShim
    router.delete('/:id', testSessionShim, adminAuthDevices, async (req, res) => {
        try {
            const deviceId = req.params.id;
            const device = await deviceStore.getById(deviceId);

            if (!device) {
                return res.status(404).json({ error: 'device_not_found' });
            }

            // Delete the device
            await deviceStore.deleteDevice(deviceId);

            // Disconnect WebSocket if connected
            try {
                wsHub.disconnectDevice(deviceId);
            } catch (_) {
                // Ignore errors (device might not be connected)
            }

            res.json({ success: true, message: 'Device deleted' });

            if (isDebug) logger.debug(`[Device Delete] Device ${deviceId} deleted`);
        } catch (e) {
            logger.error('[Device Delete] Unexpected error', { error: e.message, stack: e.stack });
            res.status(500).json({ error: 'delete_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/{id}:
     *   patch:
     *     summary: Update device settings
     *     description: Update device properties like name, preset, or settings overrides
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Device ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *                 description: Device name
     *               location:
     *                 type: string
     *                 description: Device location
     *               profileId:
     *                 type: string
     *                 nullable: true
     *                 description: Profile ID to apply to this device
     *               plexUsername:
     *                 type: string
     *                 nullable: true
     *                 description: Plex username for Cinema Now Playing integration (null to clear)
     *     responses:
     *       200:
     *         description: Device updated successfully
     *       404:
     *         description: Device not found
     *       401:
     *         description: Unauthorized
     */
    // @ts-ignore - Express router overload issue with testSessionShim
    router.patch('/:id', testSessionShim, adminAuthDevices, express.json(), async (req, res) => {
        try {
            const deviceId = req.params.id;
            const updatedDevice = await deviceOps.processDeviceUpdate(
                deviceStore,
                deviceId,
                req.body
            );

            res.json({
                success: true,
                message: 'Device updated',
                device: updatedDevice,
            });
        } catch (e) {
            if (e.message === 'device_not_found') {
                return res.status(404).json({ error: e.message });
            }

            logger.error('[Device PATCH] Unexpected error', { error: e.message, stack: e.stack });
            res.status(500).json({ error: 'update_failed', message: e.message });
        }
    });

    /**
     * @swagger
     * /api/devices/{id}/merge:
     *   post:
     *     summary: Merge source devices into target device
     *     description: Merge one or more source devices into a target device, combining their properties, settings, and state
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Target device ID (device to merge into)
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - sourceIds
     *             properties:
     *               sourceIds:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of source device IDs to merge into target
     *     responses:
     *       200:
     *         description: Devices merged successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                 merged:
     *                   type: integer
     *                   description: Number of devices merged
     *       400:
     *         description: Invalid request
     *       404:
     *         description: Target device not found
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/:id/merge',
        // @ts-ignore - Express router overload issue with testSessionShim
        testSessionShim,
        adminAuthDevices,
        express.json(),
        async (req, res) => {
            try {
                const targetId = req.params.id;
                const { sourceIds } = req.body;

                if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
                    return res.status(400).json({ error: 'sourceIds array required' });
                }

                // Verify target device exists
                const target = await deviceStore.getById(targetId);
                if (!target) {
                    return res.status(404).json({ error: 'target_device_not_found' });
                }

                // Perform merge
                const result = await deviceStore.mergeDevices(targetId, sourceIds);

                if (result.ok) {
                    if (isDebug) {
                        logger.debug(
                            `[Device Merge] Merged ${result.merged} device(s) into ${targetId}`
                        );
                    }

                    res.json({
                        ok: true,
                        merged: result.merged,
                        message: `Merged ${result.merged} device(s)`,
                    });
                } else {
                    res.status(400).json({
                        ok: false,
                        merged: 0,
                        error: 'merge_failed',
                    });
                }
            } catch (e) {
                logger.error('[Device Merge] Unexpected error', {
                    error: e.message,
                    stack: e.stack,
                });
                res.status(500).json({ error: 'merge_failed', message: e.message });
            }
        }
    );

    /**
     * @swagger
     * /api/devices/command:
     *   post:
     *     summary: Send command to device(s)
     *     description: Send a control command to one or more devices via WebSocket. If device is offline, command is queued for next heartbeat.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - deviceIds
     *               - command
     *             properties:
     *               deviceIds:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of device IDs to send command to
     *               command:
     *                 type: object
     *                 description: Command object (type and payload)
     *     responses:
     *       200:
     *         description: Commands sent/queued successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 sent:
     *                   type: integer
     *                   description: Number of commands sent immediately via WebSocket
     *                 queued:
     *                   type: integer
     *                   description: Number of commands queued for offline devices
     *       400:
     *         description: Invalid request
     *       401:
     *         description: Unauthorized
     */

    /**
     * @swagger
     * /api/devices/{id}/command:
     *   post:
     *     summary: Send command to a specific device
     *     description: Send a management command to a device. Supports both WebSocket (live) and queued delivery.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Device ID
     *       - in: query
     *         name: wait
     *         schema:
     *           type: boolean
     *         description: Wait for ACK from device (timeout after 3s)
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               type:
     *                 type: string
     *                 description: Command type (e.g., core.mgmt.reload)
     *               payload:
     *                 type: object
     *                 description: Command payload
     *     responses:
     *       200:
     *         description: Command sent/queued
     *       404:
     *         description: Device not found
     *       500:
     *         description: Send failed
     */
    // @ts-ignore - Express router overload issue with adminAuth
    router.post('/:id/command', adminAuth, express.json(), async (req, res) => {
        try {
            const { type, payload } = req.body || {};
            if (!type) return res.status(400).json({ error: 'type_required' });

            const device = await deviceStore.getById(req.params.id);
            if (!device) return res.status(404).json({ error: 'not_found' });

            // Try live first via WS; fall back to queue if offline
            const wait = String(req.query.wait || '').toLowerCase() === 'true';

            if (wait) {
                try {
                    const result = await wsHub.sendCommandAwait(req.params.id, {
                        type,
                        payload,
                        timeoutMs: 3000,
                    });
                    return res.json({
                        queued: false,
                        live: true,
                        ack: result || { status: 'ok' },
                    });
                } catch (e) {
                    const msg = String(e && e.message ? e.message : e);
                    if (msg === 'not_connected') {
                        const cmd = deviceStore.queueCommand(req.params.id, { type, payload });
                        return res.json({ queued: true, live: false, command: cmd });
                    }
                    if (msg === 'ack_timeout') {
                        return res.status(202).json({
                            queued: false,
                            live: true,
                            ack: { status: 'timeout' },
                        });
                    }
                    return res.status(500).json({ error: 'send_failed', detail: msg });
                }
            }

            const liveSent = wsHub.sendCommand(req.params.id, { type, payload });
            if (liveSent) return res.json({ queued: false, live: true });

            const cmd = deviceStore.queueCommand(req.params.id, { type, payload });
            res.json({ queued: true, live: false, command: cmd });
        } catch (e) {
            logger.error('[Device Command] Unexpected error', { error: e.message, stack: e.stack });
            res.status(500).json({ error: 'queue_failed' });
        }
    });

    // @ts-ignore - Express router overload issue with adminAuth
    router.post('/command', adminAuth, express.json(), async (req, res) => {
        try {
            const { deviceIds, command } = req.body || {};

            if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
                return res.status(400).json({ error: 'invalid_device_ids' });
            }

            if (!command || typeof command !== 'object' || !command.type) {
                return res.status(400).json({ error: 'invalid_command' });
            }

            let sent = 0;
            let queued = 0;

            for (const deviceId of deviceIds) {
                const device = await deviceStore.getById(deviceId);
                if (!device) {
                    continue; // Skip non-existent devices
                }

                // Try to send via WebSocket if connected
                const isConnected = wsHub.isConnected(deviceId);
                if (isConnected) {
                    try {
                        wsHub.sendCommand(deviceId, command);
                        sent++;
                    } catch (e) {
                        // Failed to send, queue it instead
                        deviceStore.queueCommand(deviceId, command);
                        queued++;
                    }
                } else {
                    // Device offline, queue for next heartbeat
                    deviceStore.queueCommand(deviceId, command);
                    queued++;
                }
            }

            res.json({ success: true, sent, queued });
        } catch (e) {
            logger.error('[Device Command] Unexpected error', { error: e.message, stack: e.stack });
            res.status(500).json({ error: 'command_failed' });
        }
    });

    /**
     * @swagger
     * /api/devices/clear-reload:
     *   post:
     *     summary: Clear cache and reload all devices
     *     description: Sends clearCache and reload commands to all registered devices. Admin only.
     *     tags: ['Devices']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Commands sent/queued
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 ok:
     *                   type: boolean
     *                 live:
     *                   type: integer
     *                   description: Number of connected devices that received commands
     *                 queued:
     *                   type: integer
     *                   description: Number of offline devices with queued commands
     *                 total:
     *                   type: integer
     *       401:
     *         description: Unauthorized
     */
    // @ts-ignore - Express router overload issue with adminAuth
    router.post('/clear-reload', adminAuth, async (req, res) => {
        try {
            const all = await deviceStore.getAll();
            let live = 0;
            let queued = 0;
            for (const d of all) {
                const sentClear = wsHub.sendCommand(d.id, {
                    type: 'core.mgmt.clearCache',
                    payload: {},
                });
                const scheduleReload = () => {
                    setTimeout(() => {
                        try {
                            wsHub.sendCommand(d.id, { type: 'core.mgmt.reload', payload: {} });
                        } catch (_) {
                            /* ignore */
                        }
                    }, 500);
                };
                if (sentClear) {
                    live++;
                    scheduleReload();
                } else {
                    deviceStore.queueCommand(d.id, { type: 'core.mgmt.clearCache', payload: {} });
                    deviceStore.queueCommand(d.id, { type: 'core.mgmt.reload', payload: {} });
                    queued++;
                }
            }
            res.json({ ok: true, live, queued, total: all.length });
        } catch (e) {
            res.status(500).json({ error: 'devices_clear_reload_failed' });
        }
    });

    return router;
};
