/**
 * Public Configuration Routes
 * Handles the /get-config endpoint that provides non-sensitive configuration to frontend clients
 */

const express = require('express');
const logger = require('../utils/logger');
const deepMerge = require('../utils/deep-merge');

/**
 * @typedef {Object} ConfigRequestExtensions
 * @property {boolean} [deviceBypass] - Device bypass mode enabled
 */

/**
 * @typedef {import('express').Request & ConfigRequestExtensions} ConfigRequest
 */

/**
 * Create public config router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Object} deps.config - Global config object
 * @param {Function} deps.validateGetConfigQuery - Query validation middleware
 * @param {Function} deps.cacheMiddleware - Cache middleware factory
 * @param {boolean} deps.isDebug - Debug mode flag
 * @param {Object} deps.deviceStore - Device storage
 * @param {Object} [deps.profilesStore] - Profiles storage
 * @returns {express.Router} Configured router
 */
module.exports = function createConfigPublicRouter({
    config,
    validateGetConfigQuery,
    cacheMiddleware,
    isDebug,
    deviceStore,
    profilesStore,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /get-config:
     *   get:
     *     summary: Retrieve the public application configuration (legacy)
     *     description: |
     *       **Legacy endpoint** - Use \`/api/v1/config\` instead.
     *
     *       Fetches the non-sensitive configuration needed by the frontend for display logic.
     *       This endpoint is maintained for backwards compatibility.
     *     x-internal: true
     *     tags: ['Legacy API']
     *     x-codeSamples:
     *       - lang: 'curl'
     *         label: 'cURL'
     *         source: |
     *           curl http://localhost:4000/get-config
     *       - lang: 'JavaScript'
     *         label: 'JavaScript (fetch)'
     *         source: |
     *           fetch('http://localhost:4000/get-config')
     *             .then(response => response.json())
     *             .then(config => console.log('Screensaver interval:', config.screensaverInterval));
     *       - lang: 'Python'
     *         label: 'Python (requests)'
     *         source: |
     *           import requests
     *           config = requests.get('http://localhost:4000/get-config').json()
     *           print(f"Screensaver interval: {config['screensaverInterval']}")
     *     responses:
     *       200:
     *         description: The public configuration object.
     *         content:
     *           application/json:
     *             schema:
     *               \$ref: '#/components/schemas/Config'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               \$ref: '#/components/schemas/StandardErrorResponse'
     *             example:
     *               error: 'Internal server error'
     *               message: 'Failed to retrieve configuration'
     *               statusCode: 500
     */
    router.get(
        '/',
        // @ts-ignore - Express router overload issue with cacheMiddleware
        validateGetConfigQuery,
        cacheMiddleware({
            ttl: 30000, // 30 seconds
            cacheControl: 'public, max-age=30',
            // Vary on device-identifying headers so cache doesn't bleed across devices
            varyHeaders: [
                'Accept-Encoding',
                'User-Agent',
                'X-Device-Id',
                'X-Install-Id',
                'X-Hardware-Id',
            ],
            // Include a device discriminator in the cache key for correctness
            keyGenerator: req => {
                const devPart = (
                    req.headers['x-device-id'] ||
                    req.headers['x-install-id'] ||
                    req.headers['x-hardware-id'] ||
                    ''
                ).toString();
                return `${req.method}:${req.originalUrl}${devPart ? `#${devPart}` : ''}`;
            },
        }),
        async (/** @type {ConfigRequest} */ req, res) => {
            // Helper: normalize to a JSON-safe plain structure (drop functions/symbols, handle BigInt, Dates, NaN/Infinity)
            function toPlainJSONSafe(value, seen = new WeakSet()) {
                const t = typeof value;
                if (
                    value == null ||
                    t === 'string' ||
                    t === 'boolean' ||
                    (t === 'number' && Number.isFinite(value))
                )
                    return value;
                if (t === 'number') return 0; // normalize NaN/Infinity
                if (t === 'bigint') {
                    const num = Number(value);
                    return Number.isFinite(num) ? num : value.toString();
                }
                if (value instanceof Date) return value.toISOString();
                if (Array.isArray(value)) return value.map(v => toPlainJSONSafe(v, seen));
                if (t === 'function' || t === 'symbol') return undefined; // drop
                if (t === 'object') {
                    if (seen.has(value)) return undefined; // break cycles
                    seen.add(value);
                    const isPlain = Object.prototype.toString.call(value) === '[object Object]';
                    if (!isPlain) return undefined; // drop exotic objects (Map, Set, Buffer, etc.)
                    const out = {};
                    for (const [k, v] of Object.entries(value)) {
                        const pv = toPlainJSONSafe(v, seen);
                        if (pv !== undefined) out[k] = pv;
                    }
                    return out;
                }
                return undefined;
            }

            const userAgent = req.get('user-agent') || '';
            const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);

            if (isDebug) {
                logger.debug(
                    `[get-config] Request from ${isMobile ? 'mobile' : 'desktop'} device: ${userAgent.substring(0, 50)}...`
                );
            }

            // Base public config
            const wallartDefaults = {
                enabled: false,
                itemsPerScreen: 30,
                columns: 6,
                transitionInterval: 30,
                density: 'medium',
                refreshRate: 6,
                randomness: 3,
                animationType: 'fade',
                layoutVariant: 'heroGrid',
                ambientGradient: false,
                autoRefresh: true,
                layoutSettings: {
                    heroGrid: {
                        heroSide: 'left',
                        heroRotationMinutes: 10,
                        biasAmbientToHero: true,
                    },
                },
            };
            const baseConfig = {
                clockWidget: config.clockWidget !== false,
                clockTimezone: config.clockTimezone || 'auto',
                clockFormat: config.clockFormat || '24h',
                syncEnabled: config.syncEnabled !== false,
                syncAlignMaxDelayMs: Number.isFinite(Number(config.syncAlignMaxDelayMs))
                    ? Number(config.syncAlignMaxDelayMs)
                    : 1200,
                cinemaMode: config.cinemaMode || false,
                cinemaOrientation: config.cinema?.orientation || config.cinemaOrientation || 'auto',
                cinema: config.cinema || {},
                screensaverMode: config.screensaverMode || { orientation: 'auto' },
                wallartMode: { ...wallartDefaults, ...(config.wallartMode || {}) },
                transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
                backgroundRefreshMinutes: Number.isFinite(Number(config.backgroundRefreshMinutes))
                    ? Number(config.backgroundRefreshMinutes)
                    : 60,
                showClearLogo: config.showClearLogo !== false,
                showPoster: config.showPoster !== false,
                showMetadata: config.showMetadata === true,
                showRottenTomatoes: config.showRottenTomatoes !== false,
                rottenTomatoesMinimumScore: config.rottenTomatoesMinimumScore || 0,
                transitionEffect: config.transitionEffect || 'kenburns',
                effectPauseTime: config.effectPauseTime || 2,
                kenBurnsEffect: config.kenBurnsEffect || { enabled: true, durationSeconds: 20 },
                uiScaling: config.uiScaling || {
                    content: 100,
                    clearlogo: 100,
                    clock: 100,
                    global: 100,
                },
                mediaServers: config.mediaServers || null,
                localDirectory: config.localDirectory
                    ? {
                          enabled: config.localDirectory.enabled || false,
                      }
                    : null,
                pauseIndicator: config.pauseIndicator || { enabled: true },
                burnInPrevention: config.burnInPrevention || null,
            };

            // Try to identify device and merge settings from profile (Global < Profile)
            let merged = baseConfig;
            try {
                const deviceId = req.get('X-Device-Id');
                const installId = req.get('X-Install-Id');
                const hardwareId = req.get('X-Hardware-Id');

                let device = null;
                if (deviceId) {
                    device = await deviceStore.getById(deviceId);
                }
                if (!device && installId && deviceStore.findByInstallId) {
                    device = await deviceStore.findByInstallId(installId);
                }
                if (!device && hardwareId && deviceStore.findByHardwareId) {
                    device = await deviceStore.findByHardwareId(hardwareId);
                }

                // Apply profile settings if device has profileId
                let fromProfile = {};
                try {
                    if (device && device.profileId && profilesStore) {
                        const profile = await profilesStore.getById(device.profileId);
                        if (profile && profile.settings && typeof profile.settings === 'object') {
                            fromProfile = profile.settings;
                        }
                    }
                } catch (pe) {
                    if (isDebug)
                        logger.debug('[get-config] Profile merge failed', {
                            error: pe?.message,
                        });
                }

                // Merge order: Global < Profile
                merged = deepMerge({}, baseConfig, fromProfile || {});
                if (isDebug) {
                    const pKeys = Object.keys(fromProfile || {});
                    if (pKeys.length) {
                        logger.debug('[get-config] Applied profile overrides', {
                            deviceId: device?.id,
                            profileId: device?.profileId || null,
                            profileKeys: pKeys,
                        });
                    }
                }
            } catch (e) {
                if (isDebug) {
                    logger.debug('[get-config] Override merge failed', { error: e?.message });
                }
            }

            // Build final payload and ensure it's safe to stringify
            const finalPayload = {
                ...merged,
                _debug: isDebug
                    ? {
                          isMobile,
                          userAgent: userAgent.substring(0, 100),
                          configTimestamp: Date.now(),
                      }
                    : undefined,
            };

            let safeObjToSend = finalPayload;
            try {
                JSON.stringify(finalPayload);
            } catch (_) {
                try {
                    safeObjToSend = toPlainJSONSafe(finalPayload);
                    JSON.stringify(safeObjToSend);
                    if (isDebug)
                        logger.debug('[get-config] Response normalized via safe serializer');
                } catch (err) {
                    safeObjToSend = toPlainJSONSafe({ ...merged, _debug: undefined }) || {};
                    if (isDebug)
                        logger.debug(
                            '[get-config] Failed to serialize full config, returned minimal',
                            { error: err?.message }
                        );
                }
            }

            // If device bypass is active, surface flag
            try {
                if (req.deviceBypass) {
                    /** @type {any} */ (safeObjToSend).deviceMgmt =
                        /** @type {any} */ (safeObjToSend).deviceMgmt || {};
                    /** @type {any} */ (safeObjToSend).deviceMgmt.bypassActive = true;
                }
            } catch (_) {
                // ignore
            }
            res.json(safeObjToSend);
        }
    );

    return router;
};
