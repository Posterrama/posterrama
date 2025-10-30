/**
 * Public Configuration Routes
 * Handles the /get-config endpoint that provides non-sensitive configuration to frontend clients
 */

const express = require('express');
const logger = require('../utils/logger');
const deepMerge = require('../utils/deep-merge');

/**
 * Create public config router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Object} deps.config - Global config object
 * @param {Function} deps.validateGetConfigQuery - Query validation middleware
 * @param {Function} deps.cacheMiddleware - Cache middleware factory
 * @param {boolean} deps.isDebug - Debug mode flag
 * @param {Object} deps.deviceStore - Device storage
 * @param {Object} deps.groupsStore - Groups storage
 * @returns {express.Router} Configured router
 */
module.exports = function createConfigPublicRouter({
    config,
    validateGetConfigQuery,
    cacheMiddleware,
    isDebug,
    deviceStore,
    groupsStore,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /get-config:
     *   get:
     *     summary: Retrieve the public application configuration
     *     description: >
     *       Fetches the non-sensitive configuration needed by the frontend for display logic.
     *       This endpoint is also accessible via the versioned API at /api/v1/config.
     *       The response is cached for 30 seconds to improve performance.
     *     tags: ['Public API']
     *     responses:
     *       200:
     *         description: The public configuration object.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Config'
     */
    router.get(
        '/',
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
        async (req, res) => {
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
            // Ensure wallartMode has required defaults even if config.wallartMode exists without them
            const wallartDefaults = {
                enabled: false,
                // legacy list/grid parameters
                itemsPerScreen: 30,
                columns: 6,
                transitionInterval: 30,
                // new wallart UX parameters with safe defaults
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
                cinemaOrientation: config.cinemaOrientation || 'auto',
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
                // Include source configuration so client knows which sources are enabled
                mediaServers: config.mediaServers || null,
                localDirectory: config.localDirectory
                    ? {
                          enabled: config.localDirectory.enabled || false,
                          // Don't expose the rootPath for security
                      }
                    : null,
            };

            // Try to identify device and merge settings from groups and device (Global < Group < Device)
            let merged = baseConfig;
            try {
                const deviceId = req.get('X-Device-Id');
                const installId = req.get('X-Install-Id');
                const hardwareId = req.get('X-Hardware-Id');

                let device = null;
                // Prefer exact id match when provided, but avoid requiring secret on GET
                if (deviceId) {
                    device = await deviceStore.getById(deviceId);
                }
                if (!device && installId && deviceStore.findByInstallId) {
                    device = await deviceStore.findByInstallId(installId);
                }
                if (!device && hardwareId && deviceStore.findByHardwareId) {
                    device = await deviceStore.findByHardwareId(hardwareId);
                }

                // Accumulate group templates deterministically by group.order, then device order, then apply device overrides
                let fromGroups = {};
                try {
                    if (device && Array.isArray(device.groups) && device.groups.length) {
                        const allGroups = await groupsStore.getAll();
                        // Build and sort group sequence: by numeric order asc, then by device list index asc
                        const seq = device.groups
                            .map((gid, idx) => {
                                const g = allGroups.find(x => x.id === gid);
                                return g ? { g, idx } : null;
                            })
                            .filter(Boolean)
                            .sort((a, b) => {
                                const ao = Number.isFinite(a.g.order)
                                    ? a.g.order
                                    : Number.MAX_SAFE_INTEGER;
                                const bo = Number.isFinite(b.g.order)
                                    ? b.g.order
                                    : Number.MAX_SAFE_INTEGER;
                                if (ao !== bo) return ao - bo;
                                return a.idx - b.idx;
                            });
                        for (const { g } of seq) {
                            if (g && g.settingsTemplate && typeof g.settingsTemplate === 'object') {
                                // Later templates override earlier ones
                                fromGroups = deepMerge({}, fromGroups, g.settingsTemplate);
                            }
                        }
                    }
                } catch (ge) {
                    if (isDebug)
                        logger.debug('[get-config] Group template merge failed', {
                            error: ge?.message,
                        });
                }

                const devOverrides =
                    device && device.settingsOverride && typeof device.settingsOverride === 'object'
                        ? device.settingsOverride
                        : null;

                merged = deepMerge({}, baseConfig, fromGroups || {}, devOverrides || {});
                if (isDebug) {
                    const gKeys = Object.keys(fromGroups || {});
                    const dKeys = Object.keys(devOverrides || {});
                    if (gKeys.length || dKeys.length) {
                        logger.debug('[get-config] Applied group/device overrides', {
                            deviceId: device?.id,
                            groupKeys: gKeys,
                            deviceKeys: dKeys,
                        });
                    }
                }
            } catch (e) {
                if (isDebug) {
                    logger.debug('[get-config] Override merge failed', { error: e?.message });
                }
            }

            // Build final payload and ensure it's safe to stringify to avoid intermittent 500s
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
                // Fast path: validate serializability
                JSON.stringify(finalPayload);
            } catch (_) {
                try {
                    // Fallback: sanitize to a JSON-safe plain structure
                    safeObjToSend = toPlainJSONSafe(finalPayload);
                    // Validate again
                    JSON.stringify(safeObjToSend);
                    if (isDebug)
                        logger.debug('[get-config] Response normalized via safe serializer');
                } catch (err) {
                    // Last resort: serve minimal base (without _debug)
                    safeObjToSend = toPlainJSONSafe({ ...merged, _debug: undefined }) || {};
                    if (isDebug)
                        logger.debug(
                            '[get-config] Failed to serialize full config, returned minimal',
                            {
                                error: err?.message,
                            }
                        );
                }
            }

            // If device bypass is active for this request, surface a lightweight flag so frontend can avoid loading device-mgmt.js logic.
            try {
                if (req.deviceBypass) {
                    safeObjToSend.deviceMgmt = safeObjToSend.deviceMgmt || {};
                    safeObjToSend.deviceMgmt.bypassActive = true;
                }
            } catch (_) {
                // ignore inability to append bypass flag
            }
            res.json(safeObjToSend);
        }
    );

    return router;
};
