const logger = require('./utils/logger');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const {
    forceReloadEnv,
    initializeEnvironment,
    getAssetVersions,
    refreshAssetVersionsSync,
} = require('./lib/init');
const {
    readEnvFile,
    writeEnvFile,
    restartPM2ForEnvUpdate,
    readConfig,
    writeConfig,
    isAdminSetup,
} = require('./lib/config-helpers');
const { sseDbg, getLocalIPAddress, getAvatarPath } = require('./lib/utils-helpers');
const { cleanup: cleanupHelper } = require('./lib/server-helpers');
const { initializeWebSocketServer, initializeSSEServer } = require('./lib/realtime-server');
const {
    asyncHandler,
    createIsAuthenticated,
    createMetricsAuth,
    testSessionShim,
    createAdminAuth,
    createAdminAuthDevices,
} = require('./middleware');
const {
    createPlexClient,
    getPlexClient,
    getPlexLibraries,
    getPlexGenres,
    getPlexGenresWithCounts,
    getPlexQualitiesWithCounts,
    processPlexItem,
    getPlexMusicLibraries,
    getPlexMusicGenres,
    getPlexMusicArtists,
} = require('./lib/plex-helpers');
const {
    getJellyfinClient,
    fetchJellyfinLibraries,
    createJellyfinClient,
    getJellyfinLibraries,
    processJellyfinItem,
} = require('./lib/jellyfin-helpers');
const { testServerConnection } = require('./lib/server-test-helpers');
const {
    refreshPlaylistCache: refreshPlaylistCacheCore,
    schedulePlaylistBackgroundRefresh: schedulePlaylistBackgroundRefreshCore,
    getPlaylistCache,
    isPlaylistRefreshing,
    getRefreshStartTime,
    resetRefreshState,
} = require('./lib/playlist-cache');

// Force reload environment on startup to prevent PM2 cache issues
forceReloadEnv(__dirname);

// Default to production when NODE_ENV is not set.
// NOTE: This runs AFTER dotenv has loaded .env, so setting NODE_ENV=development in .env still works.
if (!process.env.NODE_ENV || !String(process.env.NODE_ENV).trim()) {
    process.env.NODE_ENV = 'production';
}

// Initialize environment (directories, .env, config.json)
const { imageCacheDir, avatarDir } = initializeEnvironment(__dirname);

// Load env-derived configuration AFTER dotenv is loaded
const env = require('./config/environment');

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcrypt');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fsp = fs.promises;

// Always serve static assets directly from public/.
const publicDir = path.join(__dirname, 'public');

logger.info(`[Server] Static files served from: ${publicDir}`);

// Import Config class instance (provides methods like getTimeout())
const config = require('./config/');
const configJson = require('./config.json');

// Validate configuration at startup (Issue #10: Config Validation Runs Too Late)
// This ensures invalid configurations are caught before services initialize
const { validateConfig } = require('./config/validators');
const __isJestRun = !!process.env.JEST_WORKER_ID;
const __isMainModule = require.main === module;
const __shouldHardFailOnInvalidConfig = __isMainModule && !__isJestRun;
try {
    const validation = validateConfig(configJson);
    if (!validation.valid) {
        logger.error('❌ Configuration validation failed:');
        validation.errors.forEach(err => {
            logger.error(`  - ${err.path}: ${err.message}`);
        });
        logger.error('Please fix the configuration errors in config.json and restart the server.');
        if (__shouldHardFailOnInvalidConfig) {
            process.exit(1);
        } else {
            logger.warn('[Test/Module Mode] Continuing despite invalid config.json');
        }
    }
    logger.info('✅ Configuration validated successfully');
} catch (error) {
    logger.error('❌ Configuration validation error:', error.message);
    logger.error('Please check your config.json file for syntax errors.');
    if (__shouldHardFailOnInvalidConfig) {
        process.exit(1);
    } else {
        logger.warn('[Test/Module Mode] Continuing despite config validation error');
    }
}

// Migrate config: ensure all mediaServers have a 'name' field
if (Array.isArray(config.mediaServers)) {
    let needsSave = false;
    config.mediaServers.forEach((server, index) => {
        if (!server.name) {
            // Auto-generate name based on type
            const typeName =
                server.type === 'plex'
                    ? 'Plex Server'
                    : server.type === 'jellyfin'
                      ? 'Jellyfin Server'
                      : server.type === 'tmdb'
                        ? 'TMDB'
                        : server.type === 'local'
                          ? 'Local Media'
                          : 'Media Server';
            server.name = `${typeName}${index > 0 ? ` ${index + 1}` : ''}`;
            needsSave = true;
        }
    });
    if (needsSave) {
        const configPath = path.join(__dirname, 'config.json');
        void fsp
            .writeFile(configPath, JSON.stringify(config, null, 4), 'utf8')
            .then(() => {
                logger.info('[Config Migration] Added missing "name" fields to mediaServers');
            })
            .catch(e => {
                logger.warn('[Config Migration] Could not save updated config:', e.message);
            });
    }
}

// Make writeConfig available globally for MQTT capability handlers
// Wrapper function that passes the config object automatically
global.writeConfig = newConfig => writeConfig(newConfig, config);

// Defer internal/test routes mounting until after app is created and env inspected.
// They are only mounted automatically when EXPOSE_INTERNAL_ENDPOINTS === 'true'.
let testRoutes; // will be conditionally required later (after app initialization) to avoid side effects
const pkg = require('./package.json');
const {
    FILE_WHITELIST: CFG_FILES,
    createBackup: cfgCreateBackup,
    listBackups: cfgListBackups,
    cleanupOldBackups: cfgCleanupOld,
    restoreFile: cfgRestoreFile,
    deleteBackup: cfgDeleteBackup,
    updateBackupMetadata: cfgUpdateBackupMeta,
    readScheduleConfig: cfgReadSchedule,
    writeScheduleConfig: cfgWriteSchedule,
} = require('./utils/configBackup');
const ecosystemConfig = require('./ecosystem.config.js');
const { shuffleArray } = require('./utils/array-utils');

// Asset version (can later be replaced by build hash); fallback to package.json version
const ASSET_VERSION = pkg.version || '3.0.0';

// --- Fixed hardcoded limits (not user-configurable) ---
const FIXED_LIMITS = Object.freeze({
    PLEX_MOVIES: 150,
    PLEX_SHOWS: 75,
    JELLYFIN_MOVIES: 150,
    JELLYFIN_SHOWS: 75,
    TMDB_MOVIES: 100,
    TMDB_TV: 50,
    STREAMING_MOVIES_PER_PROVIDER: 10,
    STREAMING_TV_PER_PROVIDER: 10,
    TOTAL_CAP: 5000, // Max total items in final playlist (increased for large game collections)
});

const TMDBSource = require('./sources/tmdb');
const LocalDirectorySource = require('./sources/local');
const { getPlaylistMedia } = require('./lib/media-aggregator');
const { getCacheConfig: getCacheConfigUtil } = require('./lib/cache-utils');
// INTENTIONAL-TODO(new-source): If you add a new source adapter under sources/<name>.js, require it here
// const MyNewSource = require('./sources/mynew');
// Device management stores and WebSocket hub
const deviceStore = require('./utils/deviceStore');
const wsHub = require('./utils/wsHub');

// -----------------------------------------------------------------------------
// MQTT bridge manager (supports reconnect without full process restart)
// -----------------------------------------------------------------------------

let __mqttBridgeTeardownListeners = null;
let __mqttBridgeRestartQueue = Promise.resolve();

function __attachMqttBridgeDeviceListeners(mqttBridge) {
    if (!deviceStore?.deviceEvents?.on || !deviceStore?.deviceEvents?.off) {
        return () => {};
    }

    const safe = fn => async payload => {
        try {
            await fn(payload);
        } catch (error) {
            logger.error('Error handling device event in MQTT:', error);
        }
    };

    const onUpdated = safe(device => mqttBridge.onDeviceUpdate(device));
    const onRegistered = safe(device => mqttBridge.onDeviceUpdate(device));
    const onPatched = safe(device => mqttBridge.onDeviceUpdate(device));
    const onDeleted = safe(device => mqttBridge.onDeviceDelete(device));

    deviceStore.deviceEvents.on('device:updated', onUpdated);
    deviceStore.deviceEvents.on('device:registered', onRegistered);
    deviceStore.deviceEvents.on('device:patched', onPatched);
    deviceStore.deviceEvents.on('device:deleted', onDeleted);

    return () => {
        try {
            deviceStore.deviceEvents.off('device:updated', onUpdated);
            deviceStore.deviceEvents.off('device:registered', onRegistered);
            deviceStore.deviceEvents.off('device:patched', onPatched);
            deviceStore.deviceEvents.off('device:deleted', onDeleted);
        } catch (_) {
            /* noop */
        }
    };
}

async function __stopMqttBridge(reason = 'stop') {
    const existing = global.__posterramaMqttBridge;
    if (!existing) return;

    logger.info('🔌 Stopping MQTT bridge...', { reason });

    try {
        __mqttBridgeTeardownListeners?.();
    } catch (_) {
        /* noop */
    }
    __mqttBridgeTeardownListeners = null;

    try {
        if (typeof existing.shutdown === 'function') {
            await existing.shutdown();
        }
    } catch (e) {
        logger.warn('Failed to shutdown MQTT bridge cleanly', { error: e?.message || String(e) });
    }

    global.__posterramaMqttBridge = null;
}

async function __startMqttBridge(reason = 'start') {
    // Config is a Config class instance; mqtt is derived from config.json
    const mqttCfg = config?.mqtt;
    if (!mqttCfg || !mqttCfg.enabled) {
        return;
    }

    logger.info('🔌 Initializing MQTT bridge...', { reason });

    const MqttBridge = require('./utils/mqttBridge');
    const mqttBridge = new MqttBridge(mqttCfg);
    await mqttBridge.init();

    global.__posterramaMqttBridge = mqttBridge;
    __mqttBridgeTeardownListeners = __attachMqttBridgeDeviceListeners(mqttBridge);

    logger.info('✅ MQTT bridge initialized successfully', { reason });
}

function restartMqttBridge(reason = 'restart') {
    __mqttBridgeRestartQueue = __mqttBridgeRestartQueue
        .then(async () => {
            await __stopMqttBridge(reason);
            try {
                await __startMqttBridge(reason);
            } catch (e) {
                logger.error('❌ Failed to initialize MQTT bridge:', e);
                // Don't crash the server if MQTT fails
            }
        })
        .catch(() => {
            /* swallow to keep queue alive */
        });

    return __mqttBridgeRestartQueue;
}

global.__restartMqttBridge = restartMqttBridge;
global.__stopMqttBridge = __stopMqttBridge;

// Plex Sessions Poller
const PlexSessionsPoller = require('./services/plexSessionsPoller');
// Jellyfin Sessions Poller
const JellyfinSessionsPoller = require('./services/jellyfinSessionsPoller');
const app = express();
const { ApiError, NotFoundError } = require('./utils/errors.js');
const ratingCache = require('./utils/rating-cache.js');
// Device management bypass (IP allow list)
const { deviceBypassMiddleware } = require('./middleware/deviceBypass');

// Use environment configuration with fallback to config.json
// @ts-ignore - Config.serverPort exists at runtime
const port = env.server.port || config.serverPort || 4000;
const isDebug = env.server.debug;

// Wrapper for isAuthenticated that passes isDebug
const isAuthenticated = /** @type {import('express').RequestHandler} */ (
    createIsAuthenticated({ isDebug })
);

// Auth middleware specifically for the Prometheus /metrics endpoint (no redirects).
const metricsAuth = /** @type {import('express').RequestHandler} */ (createMetricsAuth({ logger }));

// Cache the server IP address
const serverIPAddress = getLocalIPAddress();

// Caching system
const {
    cacheManager,
    cacheMiddleware,
    initializeCache,
    CacheDiskManager,
} = require('./utils/cache');

// Metrics system (needs to be initialized before cache for integration)
const metricsManager = require('./utils/metrics');

initializeCache(logger, metricsManager);

// --- Global pre-routing middleware ---
// Attach bypass flag ASAP so downstream handlers and config responses can react.
app.use(deviceBypassMiddleware);

// Initialize cache disk manager
// @ts-ignore - Config.cache exists at runtime
const cacheDiskManager = new CacheDiskManager(imageCacheDir, config.cache || {});

// Initialize local directory support (extracted to lib/local-directory-init.js)
const { initializeLocalDirectory } = require('./lib/local-directory-init');
const localDirInit = initializeLocalDirectory({
    config,
    logger,
    port,
    getPlexClient,
    processPlexItem,
    getJellyfinClient,
    processJellyfinItem,
});
const jobQueue = localDirInit.jobQueue;
const localDirectorySource = localDirInit.localDirectorySource;
const uploadMiddleware = localDirInit.uploadMiddleware;

// Metrics middleware
const { metricsMiddleware } = require('./middleware/metrics');

// GitHub integration
const githubService = require('./utils/github');

// Auto-updater system
const autoUpdater = require('./utils/updater');

// Session middleware setup (must come BEFORE any middleware/routes that access req.session)
// Create a session store that gracefully ignores missing files (ENOENT)
// IMPORTANT: Keep test sessions isolated so running Jest on a live install doesn't wipe real sessions.
const __sessionsDir = process.env.SESSION_DIR
    ? path.resolve(String(process.env.SESSION_DIR))
    : path.join(__dirname, env.server.nodeEnv === 'test' ? 'sessions-test' : 'sessions');
const __fileStore = new FileStore({
    path: __sessionsDir, // Sessions will be stored in a stable, absolute directory
    logFn: isDebug ? logger.debug : () => {},
    ttl: 86400 * 7, // Session TTL in seconds (7 days)
    reapInterval: 86400, // Clean up expired sessions once a day
    retries: 3, // Retry file operations up to 3 times
});

if (typeof __fileStore.get === 'function') {
    const __origGet = __fileStore.get.bind(__fileStore);
    __fileStore.get = (sid, cb) => {
        try {
            __origGet(sid, (err, sess) => {
                if (err && (err.code === 'ENOENT' || /ENOENT/.test(String(err.message)))) {
                    // Treat missing session file as no session instead of an error
                    logger.debug?.(`[Session] ENOENT for sid ${sid} — treating as no session`);
                    return cb(null, null);
                }
                return cb(err, sess);
            });
        } catch (e) {
            if (e && (e.code === 'ENOENT' || /ENOENT/.test(String(e.message)))) {
                logger.debug?.(`[Session] ENOENT (thrown) for sid ${sid} — treating as no session`);
                return cb(null, null);
            }
            return cb(e);
        }
    };
}

// express-session may call store.touch() (rolling sessions) to extend TTL without rewriting the whole session.
// session-file-store's touch() reads the session file first; if the file was reaped/removed, it can throw ENOENT.
// Treat that as benign to avoid noisy 500s and SSE reconnect loops.
if (typeof __fileStore.touch === 'function') {
    const __origTouch = __fileStore.touch.bind(__fileStore);
    __fileStore.touch = (sid, sess, cb) => {
        const callback = typeof cb === 'function' ? cb : () => {};
        try {
            __origTouch(sid, sess, err => {
                if (err && (err.code === 'ENOENT' || /ENOENT/.test(String(err.message)))) {
                    logger.debug?.(`[Session] ENOENT on touch for sid ${sid} — ignoring`);
                    return callback(null);
                }
                return callback(err);
            });
        } catch (e) {
            if (e && (e.code === 'ENOENT' || /ENOENT/.test(String(e.message)))) {
                logger.debug?.(`[Session] ENOENT (thrown) on touch for sid ${sid} — ignoring`);
                return callback(null);
            }
            return callback(e);
        }
    };
}

// Validate session secret BEFORE initializing session middleware (Security Fix: Issue #2)
const sessionSecret = env.auth.sessionSecret;

if (!sessionSecret || sessionSecret === 'test-secret-fallback') {
    if (env.server.nodeEnv === 'production') {
        // This should never happen now due to auto-generation in environment.js
        logger.error('FATAL: SESSION_SECRET not configured in production');
        logger.error('Auto-generation failed - please manually set SESSION_SECRET');
        logger.error('Generate a strong secret: openssl rand -base64 48');
        process.exit(1);
    } else if (env.server.nodeEnv !== 'test') {
        logger.warn('⚠️  WARNING: Using development fallback for SESSION_SECRET');
        logger.warn('⚠️  DO NOT use in production! Set SESSION_SECRET environment variable');
        logger.warn('⚠️  Generate one with: openssl rand -base64 48');
    }
}

// Validate secret strength in non-test environments
if (env.server.nodeEnv !== 'test' && sessionSecret && sessionSecret.length < 32) {
    logger.error('FATAL: SESSION_SECRET must be at least 32 characters');
    logger.error('Current length:', sessionSecret.length);
    logger.error('Generate a strong secret: openssl rand -base64 48');
    if (env.server.nodeEnv === 'production') {
        process.exit(1);
    } else {
        logger.warn('⚠️  Continuing in development, but this is INSECURE!');
    }
}

app.use(
    session({
        store: __fileStore,
        name: 'posterrama.sid',
        secret: sessionSecret || 'test-secret-fallback', // Fallback only for tests
        resave: false,
        saveUninitialized: false,
        rolling: true, // Extend session lifetime on each request
        proxy: env.server.nodeEnv === 'production',
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
            httpOnly: true,
            // 'auto' avoids accidental logouts when production runs behind HTTP or TLS-terminating proxies.
            // It sets Secure cookies only when the request is actually secure (req.secure / X-Forwarded-Proto).
            secure: env.server.nodeEnv === 'production' ? 'auto' : false,
            // 'strict' can break legitimate flows in some deployments; 'lax' is a safer default for session cookies.
            sameSite: 'lax',
        },
    })
);

// Seed a stable install cookie early so concurrent tabs share one installId
app.use((req, res, next) => {
    try {
        const cookies = String(req.headers['cookie'] || '');
        if (!/(^|;\s*)pr_iid=/.test(cookies)) {
            const iid = require('crypto').randomUUID();
            const cookieValue = `pr_iid=${encodeURIComponent(
                iid
            )}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`;

            // Never overwrite existing Set-Cookie headers (e.g. express-session).
            const existing = res.getHeader('Set-Cookie');
            if (!existing) {
                res.setHeader('Set-Cookie', cookieValue);
            } else if (Array.isArray(existing)) {
                res.setHeader('Set-Cookie', [...existing, cookieValue]);
            } else {
                res.setHeader('Set-Cookie', [String(existing), cookieValue]);
            }
        }
    } catch (_) {
        // ignore cookie seeding failures
    }
    next();
});

// Performance and security logging middleware
app.use((req, res, next) => {
    // Add request ID for tracking
    // @ts-ignore - req.id is a custom property
    req.id = crypto.randomBytes(16).toString('hex');

    // Log start of request processing
    const start = process.hrtime();
    const requestLog = {
        // @ts-ignore - req.id is a custom property
        id: req.id,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
    };

    // Security logging for admin endpoints - only log truly suspicious activity
    if (req.path.startsWith('/api/admin/')) {
        // @ts-ignore - req.session is provided by express-session
        const hasSessionUser = Boolean(req.session?.user);
        const authHeader = req.headers.authorization || '';
        const hasBearer = authHeader.startsWith('Bearer ');
        // Only warn for modifying requests with neither a session nor a bearer token
        // Skip test-* endpoints as frontend routinely calls these before login
        const isTestEndpoint = req.path.includes('/test-');
        if (!hasSessionUser && !hasBearer && req.method !== 'GET' && !isTestEndpoint) {
            logger.warn('Unauthorized admin API modification attempt', {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: (req.get('user-agent') || '').substring(0, 100),
            });
        }
        // GET requests without auth are normal (frontend loading data before login)
        // Don't log successful authenticated requests to reduce noise
    }

    // Log request completion and performance metrics
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(start);
        const duration = seconds * 1000 + nanoseconds / 1000000;

        // Skip logging for noisy admin/monitoring endpoints (unless they error or are slow)
        const isAdminMonitoring =
            req.path &&
            (req.path.startsWith('/api/admin/performance') ||
                req.path.startsWith('/api/v1/metrics') ||
                req.path.startsWith('/api/admin/metrics') ||
                req.path.startsWith('/api/admin/logs') ||
                req.path.startsWith('/api/admin/status') ||
                req.path === '/api/admin/events'); // SSE endpoint for admin real-time updates

        // Skip logging for routine browser requests
        const isRoutineRequest =
            req.path &&
            (req.path === '/favicon.ico' ||
                req.path.startsWith('/static/') ||
                req.path.startsWith('/images/') ||
                req.path.startsWith('/css/') ||
                req.path.startsWith('/js/') ||
                req.path.startsWith('/fonts/') ||
                req.path.endsWith('.css') ||
                req.path.endsWith('.js') ||
                req.path.endsWith('.png') ||
                req.path.endsWith('.jpg') ||
                req.path.endsWith('.ico') ||
                req.path.endsWith('.svg') ||
                req.path.endsWith('.woff') ||
                req.path.endsWith('.woff2') ||
                req.path.endsWith('.ttf'));

        const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';

        // Expected noise: admin UI polls before/after login; 401s here are normal and can be very chatty.
        const isAdminAuthNoise =
            res.statusCode === 401 &&
            Boolean(req.path) &&
            (req.path === '/api/admin' || req.path.startsWith('/api/admin/'));

        // Only log if it's not routine/monitoring AND (has issues OR is not a GET request OR took long time)
        const shouldLog =
            !isAdminMonitoring &&
            !isRoutineRequest &&
            !isAdminAuthNoise &&
            (res.statusCode >= 400 || req.method !== 'GET' || duration > 1000);

        if (shouldLog) {
            logger[logLevel]('Request completed', {
                ...requestLog,
                status: res.statusCode,
                duration: `${duration.toFixed(2)}ms`,
                contentLength: res.get('content-length'),
            });
        }

        // Note: Slow request detection is handled by metricsMiddleware
    });

    next();
});

// API Versioning Middleware
app.use('/api', (req, res, next) => {
    const currentVersion = pkg.version;
    const acceptedVersion = req.headers['accept-version'];

    // Always add current API version to response headers
    res.setHeader('X-API-Version', currentVersion);

    // Check if client requests specific version
    if (acceptedVersion) {
        const supportedVersions = ['1.2.0', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5'];

        if (!supportedVersions.includes(String(acceptedVersion))) {
            return res.status(400).json({
                error: `Unsupported API version: ${acceptedVersion}. Supported versions: ${supportedVersions.join(', ')}`,
            });
        }
    }

    next();
});

// Version-specific route aliases - redirect to actual endpoints
/**
 * @swagger
 * /api/v1/config:
 *   get:
 *     summary: Get public configuration
 *     description: |
 *       Fetches the non-sensitive configuration needed by the frontend for display logic.
 *
 *       This endpoint returns configuration settings for:
 *       - Display mode intervals and transitions
 *       - Available media sources and libraries
 *       - UI customization options
 *       - Device-specific overrides
 *
 *       The response is cached for 30 seconds to improve performance.
 *     tags: ['API v1']
 *     x-codeSamples:
 *       - lang: 'curl'
 *         label: 'cURL'
 *         source: |
 *           curl http://localhost:4000/api/v1/config
 *       - lang: 'JavaScript'
 *         label: 'JavaScript (fetch)'
 *         source: |
 *           fetch('http://localhost:4000/api/v1/config')
 *             .then(response => response.json())
 *             .then(config => console.log('Screensaver interval:', config.screensaverInterval));
 *       - lang: 'Python'
 *         label: 'Python (requests)'
 *         source: |
 *           import requests
 *           config = requests.get('http://localhost:4000/api/v1/config').json()
 *           print(f"Screensaver interval: {config['screensaverInterval']}")
 *     responses:
 *       200:
 *         description: The public configuration object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Config'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Internal server error'
 *               message: 'Failed to retrieve configuration'
 *               statusCode: 500
 */
app.get('/api/v1/config', (req, res) => {
    req.url = '/get-config';
    req.originalUrl = '/get-config';
    app._router.handle(req, res);
});

/**
 * @swagger
 * /api/v1/media:
 *   get:
 *     summary: Get media collection
 *     description: |
 *       Returns the aggregated playlist from all configured media sources (Plex, Jellyfin / Emby, TMDB).
 *
 *       Features:
 *       - Cached for performance
 *       - Supports source filtering (plex, jellyfin, tmdb, local)
 *       - Music Mode: Returns music albums instead of movies/TV shows
 *       - Games Mode: Returns game covers from RomM
 *       - Optional extras: Trailers and theme music URLs
 *
 *       The playlist is automatically shuffled and filtered based on configuration.
 *     tags: ['API v1']
 *     x-codeSamples:
 *       - lang: 'curl'
 *         label: 'cURL'
 *         source: |
 *           curl http://localhost:4000/api/v1/media
 *       - lang: 'JavaScript'
 *         label: 'JavaScript (fetch)'
 *         source: |
 *           fetch('http://localhost:4000/api/v1/media')
 *             .then(response => response.json())
 *             .then(data => console.log(data));
 *       - lang: 'Python'
 *         label: 'Python (requests)'
 *         source: |
 *           import requests
 *           response = requests.get('http://localhost:4000/api/v1/media')
 *           media = response.json()
 *     parameters:
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [plex, jellyfin, tmdb, local]
 *         description: Optional source filter to return only items from a specific provider
 *       - in: query
 *         name: nocache
 *         schema:
 *           type: string
 *           enum: ['1']
 *         description: Set to '1' to bypass cache (admin use)
 *       - in: query
 *         name: musicMode
 *         schema:
 *           type: string
 *           enum: ['1', 'true']
 *         description: 'Set to "1" or "true" to return music albums instead of movies/TV shows. Requires wallartMode.musicMode.enabled=true in config.'
 *       - in: query
 *         name: gamesOnly
 *         schema:
 *           type: string
 *           enum: ['1', 'true']
 *         description: 'Set to "1" or "true" to return game covers from RomM. Requires wallartMode.gamesOnly=true in config.'
 *       - in: query
 *         name: count
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *         description: Number of items to return (used with musicMode and gamesOnly)
 *       - in: query
 *         name: includeExtras
 *         schema:
 *           type: boolean
 *         description: When true, enriches items with trailers and theme music URLs. Adds latency as it fetches additional metadata per item.
 *     responses:
 *       200:
 *         description: Playlist of media items. When includeExtras=true, items include extras array with trailers and theme URLs.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MediaItem'
 *       202:
 *         description: Playlist is being built. Client should retry in a few seconds.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: building
 *                 message:
 *                   type: string
 *                 retryIn:
 *                   type: number
 *                   description: Suggested retry delay in milliseconds
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Invalid request parameters'
 *               message: 'The count parameter must be between 1 and 1000'
 *               statusCode: 400
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Internal server error'
 *               message: 'Failed to fetch media from configured sources'
 *               statusCode: 500
 */
app.get('/api/v1/media', (req, res) => {
    req.url = '/get-media';
    req.originalUrl = '/get-media';
    app._router.handle(req, res);
});

/**
 * @swagger
 * /api/v1/media/{key}:
 *   get:
 *     summary: Get single media item
 *     description: |
 *       Retrieves a single media item by its unique key.
 *
 *       The key format is: `{type}-{serverName}-{itemId}`
 *       - Examples: `plex-My Server-12345`, `jellyfin-MainServer-67890`
 *
 *       This endpoint is typically used when a user clicks on a 'recently added' item
 *       that isn't in the main playlist cache.
 *     tags: ['API v1']
 *     x-codeSamples:
 *       - lang: 'curl'
 *         label: 'cURL'
 *         source: |
 *           curl "http://localhost:4000/api/v1/media/plex-My%20Server-12345"
 *       - lang: 'JavaScript'
 *         label: 'JavaScript (fetch)'
 *         source: |
 *           fetch('http://localhost:4000/api/v1/media/plex-My%20Server-12345')
 *             .then(response => response.json())
 *             .then(item => console.log(item.title));
 *       - lang: 'Python'
 *         label: 'Python (requests)'
 *         source: |
 *           import requests
 *           item = requests.get('http://localhost:4000/api/v1/media/plex-My%20Server-12345').json()
 *           print(f"Title: {item['title']}")
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: 'Unique media item key in format: type-serverName-itemId (e.g., plex-My Server-12345)'
 *         example: 'plex-My Server-12345'
 *     responses:
 *       200:
 *         description: The requested media item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MediaItem'
 *       400:
 *         description: Invalid key format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Invalid media key parameter'
 *               details:
 *                 - field: key
 *                   message: 'Key must contain only alphanumeric characters, hyphens, underscores, and spaces'
 *               statusCode: 400
 *       404:
 *         description: Media item not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Media item not found'
 *               message: 'No media item found with the specified key'
 *               statusCode: 404
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Internal server error'
 *               statusCode: 500
 */
app.get('/api/v1/media/:key', (req, res) => {
    // 308 Permanent Redirect preserves method and body
    res.redirect(
        308,
        '/get-media-by-key/' +
            req.params.key +
            (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '')
    );
});

/**
 * @swagger
 * /api/v1/devices/bypass-status:
 *   get:
 *     summary: Check device bypass status
 *     description: |
 *       Returns whether the requesting IP address is whitelisted for device management bypass.
 *
 *       IPs on the bypass list can access device management features without authentication.
 *       This is useful for trusted local networks or specific administrative IPs.
 *     tags: ['API v1']
 *     x-codeSamples:
 *       - lang: 'curl'
 *         label: 'cURL'
 *         source: |
 *           curl http://localhost:4000/api/v1/devices/bypass-status
 *       - lang: 'JavaScript'
 *         label: 'JavaScript (fetch)'
 *         source: |
 *           fetch('http://localhost:4000/api/v1/devices/bypass-status')
 *             .then(response => response.json())
 *             .then(data => console.log('Bypass:', data.bypass, 'IP:', data.ip));
 *     responses:
 *       200:
 *         description: Bypass status and detected IP address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bypass:
 *                   type: boolean
 *                   description: Whether this IP is on the bypass list
 *                   example: false
 *                 ip:
 *                   type: string
 *                   description: The detected IP address of the requester
 *                   example: '192.168.1.100'
 */
app.get('/api/v1/devices/bypass-status', (req, res) => {
    req.url = '/api/devices/bypass-check';
    req.originalUrl = '/api/devices/bypass-check';
    app._router.handle(req, res);
});

/**
 * @swagger
 * /api/v1/devices/reload:
 *   post:
 *     summary: Reload all devices
 *     description: |
 *       Sends clearCache and reload commands to all registered devices via WebSocket.
 *
 *       This endpoint:
 *       - Clears the cache on all connected devices
 *       - Triggers a page reload after 500ms
 *       - Queues commands for offline devices
 *
 *       Requires admin authentication (Bearer token).
 *     tags: ['API v1']
 *     security:
 *       - bearerAuth: []
 *     x-codeSamples:
 *       - lang: 'curl'
 *         label: 'cURL'
 *         source: |
 *           curl -X POST http://localhost:4000/api/v1/devices/reload \
 *             -H "Authorization: Bearer YOUR_TOKEN"
 *       - lang: 'JavaScript'
 *         label: 'JavaScript (fetch)'
 *         source: |
 *           fetch('http://localhost:4000/api/v1/devices/reload', {
 *             method: 'POST',
 *             headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
 *           })
 *             .then(response => response.json())
 *             .then(data => console.log(`Reloaded ${data.live} live, ${data.queued} queued`));
 *     responses:
 *       200:
 *         description: Commands sent/queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 live:
 *                   type: integer
 *                   description: Number of connected devices that received commands
 *                   example: 3
 *                 queued:
 *                   type: integer
 *                   description: Number of offline devices with queued commands
 *                   example: 1
 *                 total:
 *                   type: integer
 *                   description: Total number of devices
 *                   example: 4
 *       401:
 *         description: Unauthorized - Invalid or missing authentication token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 *             example:
 *               error: 'Unauthorized'
 *               message: 'Authentication required'
 *               statusCode: 401
 */
app.post('/api/v1/devices/reload', (req, res) => {
    req.url = '/api/devices/clear-reload';
    req.originalUrl = '/api/devices/clear-reload';
    app._router.handle(req, res);
});

if (isDebug) logger.debug('--- DEBUG MODE IS ACTIVE ---');

// Trust the first proxy in front of the app (e.g., Nginx, Cloudflare).
// This is necessary for express-rate-limit to work correctly when behind a proxy,
// as it allows the app to correctly identify the client's IP address.
app.set('trust proxy', 1);

// --- Static Asset Cache Busting Middleware ---
// Allows appending ?v=<pkg.version> to static asset URLs and strips it so the real file is served.
// Also sets long-term caching headers with immutable if version param present.
app.use((req, res, next) => {
    if (req.method === 'GET' && req.url.includes('?')) {
        // Separate path and query
        const [pathname, queryString] = req.url.split('?');
        if (queryString) {
            const params = new URLSearchParams(queryString);
            const v = params.get('v');
            if (v) {
                // Remove v param for static handler
                params.delete('v');
                const remaining = params.toString();
                req.url = remaining ? `${pathname}?${remaining}` : pathname;
                // Strong caching only when version param supplied (asset fingerprinting)
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        }
    }
    next();
});

// === FRONTEND PAGES ===
// All HTML serving routes extracted to routes/frontend-pages.js
const createFrontendPagesRouter = require('./routes/frontend-pages');
const frontendPagesRouter = createFrontendPagesRouter({
    isAdminSetup,
    isAuthenticated,
    getAssetVersions,
    ASSET_VERSION,
    logger,
    publicDir,
    getConfig: () => config,
});
app.use('/', frontendPagesRouter);

/**
 * @openapi
 * /metrics:
 *   get:
 *     tags:
 *       - Monitoring
 *     summary: Prometheus metrics endpoint
 *     description: |
 *       Exposes server metrics in Prometheus format for monitoring and alerting.
 *       Includes default metrics (CPU, memory, event loop) and custom metrics
 *       (cache, HTTP, WebSocket, source APIs, devices).
 *
 *       Authentication required: admin session or API token (Bearer / X-API-Key).
 *     responses:
 *       200:
 *         description: Prometheus metrics in text format
 *         content:
 *           text/plain:
 *             example: |
 *               # HELP posterrama_http_requests_total Total HTTP requests
 *               # TYPE posterrama_http_requests_total counter
 *               posterrama_http_requests_total{method="GET",path="/api/media",status="200"} 42
 *       401:
 *         description: Unauthorized
 */
app.get('/metrics', metricsAuth, async (req, res) => {
    try {
        const contentType = metricsManager.getPrometheusContentType();
        const metricsText = await metricsManager.getPrometheusMetrics();

        res.setHeader('Content-Type', contentType);
        res.send(metricsText);
    } catch (err) {
        logger.error('Failed to generate Prometheus metrics:', err);
        res.status(500).send('Error generating metrics');
    }
});

// Lightweight route to serve the preview page (friendly URL)
// EXTRACTED to routes/frontend-pages.js

// Rate Limiting (Selective)
// Rate limiters removed from general endpoints (/api/*, /get-media, /image) as they caused
// 429 errors during normal usage. Posterrama is a private application with trusted clients.
// Retained only for critical device management endpoints to prevent abuse.
const { createRateLimiter, authLimiter } = require('./middleware/rateLimiter');

// Lightweight template injection for admin.html to stamp asset version
// EXTRACTED to routes/frontend-pages.js

/**
 * @swagger
 * /:
 *   get:
 *     summary: Serve main application HTML
 *     description: >
 *       Serves the main application HTML with asset version stamping for cache busting.
 *       Injects the ASSET_VERSION into the HTML template before serving.
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Main application HTML
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 * /index.html:
 *   get:
 *     summary: Serve main application HTML (alternative route)
 *     description: Alternative route for main application HTML with asset version stamping
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Main application HTML
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
// Serve main index.html with automatic asset versioning
// Add metrics collection middleware
app.use(metricsMiddleware);

// Add user context middleware for enhanced logging
const { userContextMiddleware } = require('./middleware/user-context');
app.use(userContextMiddleware);

// Input Validation Middleware and Endpoints
const {
    createValidationMiddleware,
    validateGetConfigQuery,
    validateGetMediaQuery,
    validateImageQuery,
    validateMediaKeyParam,
    schemas,
} = require('./middleware/validate');

// asyncHandler now imported from middleware/

// Small in-memory cache for Admin filter preview results to avoid repeated work
// TTL is short to keep UI responsive to recent changes.
const adminFilterPreviewCache = new Map(); // key -> { ts, value }

/**
 * @swagger
 * /api/_internal/health-debug:
 *   get:
 *     summary: Internal health debug info
 *     description: Returns lightweight diagnostic info for internal tooling (excluded from public spec).
 *     x-internal: true
 *     tags: ['Testing']
 *     responses:
 *       200:
 *         description: Internal diagnostic info
 */
app.get('/api/_internal/health-debug', (req, res) => {
    res.json({ ok: true, ts: Date.now(), pid: process.pid });
});

/**
 * @swagger
 * /local-media/{path}:
 *   get:
 *     summary: Serve local media files
 *     description: |
 *       Serves images and videos from configured local directories.
 *       This endpoint is disabled by default for security.
 *       Local media can be accessed via /local-posterpack for ZIP contents.
 *     tags: ['Local Media']
 *     parameters:
 *       - name: path
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path to media file (e.g., posters/Movie.jpg)
 *     responses:
 *       200:
 *         description: Media file content
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Local directory support not enabled or direct serving disabled
 */
// Serve Local Directory media (images/videos) securely from configured roots
// Example URL shape produced by LocalDirectorySource: /local-media/posters/My%20Movie.jpg
app.get(
    '/local-media/*',
    // @ts-ignore - Express router overload with asyncHandler
    asyncHandler(async (req, res) => {
        // Minimal placeholder: disable direct file serving by default.
        // Local media can be accessed via /local-posterpack for ZIP contents.
        if (!config.localDirectory?.enabled || !localDirectorySource) {
            return res.status(404).send('Local directory support not enabled');
        }
        return res.status(404).send('Direct local-media serving is disabled');
    })
);

/**
 * Stream assets from a folder-based local "pack" (used for motion posterpacks).
 * This avoids enabling arbitrary /local-media serving while still allowing cinema devices to play videos.
 *
 * Example:
 *   /local-folderpack?dir=motion/My%20Movie%20(2024)&entry=motion
 */
app.get(
    '/local-folderpack',
    // @ts-ignore - Express router overload with asyncHandler
    asyncHandler(async (req, res) => {
        try {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.status(404).send('Local directory support not enabled');
            }

            const entryKey = String(req.query.entry || '').toLowerCase();
            let dirRel = String(req.query.dir || '').trim();
            try {
                if (/%[0-9A-Fa-f]{2}/.test(dirRel)) dirRel = decodeURIComponent(dirRel);
            } catch (_) {
                /* ignore */
            }

            if (!dirRel || !entryKey) return res.status(400).send('Missing parameters');

            // Security: prevent traversal and absolute paths
            if (
                dirRel.includes('..') ||
                dirRel.startsWith('/') ||
                dirRel.startsWith('\\') ||
                /^[a-zA-Z]:/.test(dirRel)
            ) {
                return res.status(400).send('Invalid dir path');
            }

            // Restrict to motion/* packs only (cinema-only feature)
            const dirRelNorm = dirRel.replace(/\\/g, '/').replace(/^\/+/, '');
            if (!dirRelNorm.toLowerCase().startsWith('motion/')) {
                return res.status(400).send('Invalid pack directory');
            }

            const allowed = new Set(['motion', 'poster', 'thumbnail', 'background', 'metadata']);
            if (!allowed.has(entryKey)) return res.status(400).send('Invalid entry type');

            const bases = Array.isArray(localDirectorySource.rootPaths)
                ? localDirectorySource.rootPaths
                : [localDirectorySource.rootPath].filter(Boolean);

            // Resolve pack directory against configured bases
            let packDirFull = null;
            for (const base of bases) {
                const full = path.resolve(base, dirRelNorm);
                const withinBase = full === base || (full + path.sep).startsWith(base + path.sep);
                if (!withinBase) continue;
                try {
                    const st = await fsp.stat(full);
                    if (st.isDirectory()) {
                        packDirFull = full;
                        break;
                    }
                } catch (_) {
                    /* try next base */
                }
            }

            if (!packDirFull) return res.status(404).send('Pack directory not found');

            const entries = await fsp.readdir(packDirFull, { withFileTypes: true }).catch(() => []);
            const fileNames = entries.filter(e => e.isFile()).map(e => e.name);

            const pickByPatterns = patterns => {
                for (const re of patterns) {
                    const found = fileNames.find(n => re.test(n));
                    if (found) return found;
                }
                return null;
            };

            let filename = null;
            if (entryKey === 'metadata') {
                filename = pickByPatterns([/^metadata\.json$/i]);
            } else if (entryKey === 'motion') {
                filename = pickByPatterns([
                    /^(motion)\.(mp4|webm|m4v|mov|mkv|avi)$/i,
                    /^(poster)\.(mp4|webm|m4v|mov|mkv|avi)$/i,
                ]);
                if (!filename) {
                    filename = pickByPatterns([/\.(mp4|webm|m4v|mov|mkv|avi)$/i]);
                }
            } else if (entryKey === 'background') {
                filename = pickByPatterns([
                    /^(background|backdrop)\.(jpg|jpeg|png|webp)$/i,
                    /\.(jpg|jpeg|png|webp)$/i,
                ]);
            } else {
                // poster/thumbnail
                filename = pickByPatterns([
                    /^(thumb|thumbnail)\.(jpg|jpeg|png|webp)$/i,
                    /^poster\.(jpg|jpeg|png|webp)$/i,
                    /\.(jpg|jpeg|png|webp)$/i,
                ]);
            }

            if (!filename) return res.status(404).send('Entry not found in folder');

            const fileFull = path.join(packDirFull, filename);
            const st = await fsp.stat(fileFull).catch(() => null);
            if (!st?.isFile()) return res.status(404).send('Entry not found');

            const mime = require('mime-types');
            const ctype = mime.lookup(fileFull) || 'application/octet-stream';
            res.setHeader('Content-Type', ctype);
            res.setHeader('Cache-Control', 'public, max-age=86400');

            const size = st.size;
            const range = req.headers.range;

            // Range support for video/audio
            if (range && /^bytes=\d*-\d*$/.test(range)) {
                const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
                const start = startStr ? parseInt(startStr, 10) : 0;
                const end = endStr ? parseInt(endStr, 10) : size - 1;
                const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
                const safeEnd = Number.isFinite(end) ? Math.min(size - 1, end) : size - 1;
                if (safeStart > safeEnd || safeStart >= size) {
                    res.setHeader('Content-Range', `bytes */${size}`);
                    return res.sendStatus(416);
                }

                res.status(206);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Range', `bytes ${safeStart}-${safeEnd}/${size}`);
                res.setHeader('Content-Length', safeEnd - safeStart + 1);
                fs.createReadStream(fileFull, { start: safeStart, end: safeEnd }).pipe(res);
                return;
            }

            res.setHeader('Content-Length', size);
            fs.createReadStream(fileFull).pipe(res);
        } catch (err) {
            logger.error('[Local Folderpack] Failed to stream entry', {
                error: err?.message || String(err),
                stack: err?.stack,
            });
            return res.status(500).send('Internal server error');
        }
    })
);

/**
 * @swagger
 * /local-posterpack:
 *   get:
 *     summary: Stream assets from posterpack ZIP files
 *     description: |
 *       Streams poster, background, clearlogo, thumbnail, or banner directly from a posterpack ZIP
 *       without extraction. Used for serving local media from compressed archives.
 *     tags: ['Local Media']
 *     parameters:
 *       - name: zip
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path to ZIP file (e.g., complete/manual/Movie (2024).zip)
 *         example: complete/manual/Movie (2024).zip
 *       - name: entry
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           enum: [poster, background, clearlogo, thumbnail, banner, motion, trailer, theme]
 *         description: Type of asset to extract from ZIP
 *         example: poster
 *     responses:
 *       200:
 *         description: Image content from ZIP
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Missing parameters or invalid zip path/entry type
 *       404:
 *         description: Local directory support not enabled or file not found
 *       500:
 *         description: Error reading ZIP file
 */
// Stream poster/background/clearlogo directly from a posterpack ZIP without extraction
// Example: /local-posterpack?zip=complete/manual/Movie%20(2024).zip&entry=poster
app.get(
    '/local-posterpack',
    // @ts-ignore - Express router overload with asyncHandler
    asyncHandler(async (req, res) => {
        try {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.status(404).send('Local directory support not enabled');
            }

            const entryKey = String(req.query.entry || '').toLowerCase();
            let zipRel = String(req.query.zip || '').trim();
            // Be robust to percent-encoded query values
            try {
                if (/%[0-9A-Fa-f]{2}/.test(zipRel)) zipRel = decodeURIComponent(zipRel);
            } catch (_) {
                /* ignore decode issues; use raw */
            }

            // Validate required parameters
            if (!zipRel || !entryKey) return res.status(400).send('Missing parameters');

            // Security: prevent path traversal attacks and absolute paths
            if (
                zipRel.includes('..') ||
                zipRel.startsWith('/') ||
                zipRel.startsWith('\\') ||
                /^[a-zA-Z]:/.test(zipRel)
            ) {
                return res.status(400).send('Invalid zip path');
            }

            // Allow only known entry types (including trailer and theme)
            const allowed = new Set([
                'poster',
                'background',
                'clearlogo',
                'thumbnail',
                'banner',
                'motion',
                'trailer',
                'theme',
            ]);
            if (!allowed.has(entryKey)) return res.status(400).send('Invalid entry type');

            const bases = Array.isArray(localDirectorySource.rootPaths)
                ? localDirectorySource.rootPaths
                : [localDirectorySource.rootPath].filter(Boolean);

            // Resolve the ZIP against configured bases
            let zipFull = null;
            for (const base of bases) {
                const full = path.resolve(base, zipRel);
                const withinBase = full === base || (full + path.sep).startsWith(base + path.sep);
                if (!withinBase) continue;
                try {
                    const st = await fsp.stat(full);
                    if (st.isFile() && /\.zip$/i.test(full)) {
                        zipFull = full;
                        break;
                    }
                } catch (_) {
                    /* try next base */
                }
            }

            if (!zipFull) return res.status(404).send('ZIP not found');

            // Open ZIP and locate the requested entry (case-insensitive, top-level or nested)
            let zip;
            let entries;
            try {
                zip = new AdmZip(zipFull);
                entries = zip.getEntries();
            } catch (e) {
                logger.error('[Local Posterpack] Corrupted or invalid ZIP file', {
                    zipPath: zipFull,
                    error: e.message,
                    stack: e.stack,
                });
                return res.status(500).send('Failed to open ZIP');
            }

            // Validate ZIP has entries
            if (!entries || entries.length === 0) {
                logger.warn('[Local Posterpack] Empty ZIP file', { zipPath: zipFull });
                return res.status(404).send('Entry not found in ZIP');
            }

            // Preferred extensions order based on entry type
            let exts;
            if (entryKey === 'trailer' || entryKey === 'motion') {
                exts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'];
            } else if (entryKey === 'theme') {
                exts = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];
            } else {
                exts = ['jpg', 'jpeg', 'png', 'webp'];
            }
            let target = null;
            for (const ext of exts) {
                const re = new RegExp(
                    `(^|/)${entryKey === 'thumbnail' ? '(thumb|thumbnail)' : entryKey}\\.${ext}$`,
                    'i'
                );
                target = entries.find(e => re.test(e.entryName));
                if (target) break;
            }

            if (!target) return res.status(404).send('Entry not found in ZIP');

            // Extract data with error handling
            let data;
            try {
                data = target.getData();
                if (!data || data.length === 0) {
                    logger.warn('[Local Posterpack] Empty entry data', {
                        zipPath: zipFull,
                        entry: target.entryName,
                    });
                    return res.status(404).send('Entry contains no data');
                }
            } catch (e) {
                logger.error('[Local Posterpack] Failed to extract entry from ZIP', {
                    zipPath: zipFull,
                    entry: target.entryName,
                    error: e.message,
                });
                return res.status(500).send('Failed to read entry from ZIP');
            }

            const mime = require('mime-types');
            const ctype = mime.lookup(target.entryName) || 'application/octet-stream';
            res.setHeader('Content-Type', ctype);
            res.setHeader('Cache-Control', 'public, max-age=86400');

            // Support HTTP Range for video/audio entries (required for motion posters)
            const wantsRange =
                typeof req.headers.range === 'string' &&
                (entryKey === 'motion' || entryKey === 'trailer' || entryKey === 'theme');
            if (wantsRange) {
                const size = data.length;
                const range = req.headers.range;
                const match = /^bytes=(\d*)-(\d*)$/.exec(range);
                if (!match) {
                    res.setHeader('Content-Range', `bytes */${size}`);
                    return res.status(416).end();
                }
                const start = match[1] ? parseInt(match[1], 10) : 0;
                const end = match[2] ? parseInt(match[2], 10) : size - 1;
                const safeStart = Number.isFinite(start) ? start : 0;
                const safeEnd = Number.isFinite(end) ? end : size - 1;
                if (safeStart >= size || safeStart > safeEnd) {
                    res.setHeader('Content-Range', `bytes */${size}`);
                    return res.status(416).end();
                }
                const finalEnd = Math.min(safeEnd, size - 1);
                res.status(206);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Range', `bytes ${safeStart}-${finalEnd}/${size}`);
                res.setHeader('Content-Length', finalEnd - safeStart + 1);
                return res.end(data.subarray(safeStart, finalEnd + 1));
            }

            res.setHeader('Content-Length', data.length);
            return res.end(data);
        } catch (err) {
            logger.error('[Local Posterpack] Failed to stream zip entry', {
                error: err.message,
                stack: err.stack,
            });
            return res.status(500).send('Internal server error');
        }
    })
);

// HEAD support to quickly check presence of a posterpack entry (no body streamed)
app.head(
    '/local-posterpack',
    // @ts-ignore - Express router overload with asyncHandler
    asyncHandler(async (req, res) => {
        try {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.sendStatus(404);
            }
            const entryKey = String(req.query.entry || '').toLowerCase();
            let zipRel = String(req.query.zip || '').trim();
            // Be robust to percent-encoded query values
            try {
                if (/%[0-9A-Fa-f]{2}/.test(zipRel)) zipRel = decodeURIComponent(zipRel);
            } catch (_) {
                /* ignore decode issues; use raw */
            }

            // Validate required parameters
            if (!zipRel || !entryKey) return res.sendStatus(400);

            // Security: prevent path traversal and absolute paths
            if (
                zipRel.includes('..') ||
                zipRel.startsWith('/') ||
                zipRel.startsWith('\\') ||
                /^[a-zA-Z]:/.test(zipRel)
            ) {
                return res.sendStatus(400);
            }

            const allowed = new Set([
                'poster',
                'background',
                'clearlogo',
                'thumbnail',
                'banner',
                'motion',
                'trailer',
                'theme',
            ]);
            if (!allowed.has(entryKey)) return res.sendStatus(400);

            const bases = Array.isArray(localDirectorySource.rootPaths)
                ? localDirectorySource.rootPaths
                : [localDirectorySource.rootPath].filter(Boolean);
            let zipFull = null;
            for (const base of bases) {
                const full = path.resolve(base, zipRel);
                const withinBase = full === base || (full + path.sep).startsWith(base + path.sep);
                if (!withinBase) continue;
                try {
                    const st = await fsp.stat(full);
                    if (st.isFile() && /\.zip$/i.test(full)) {
                        zipFull = full;
                        break;
                    }
                } catch (_) {
                    // noop: missing or inaccessible file is non-fatal for presence check
                }
            }
            if (!zipFull) return res.sendStatus(404);

            let zip;
            let entries;
            try {
                zip = new AdmZip(zipFull);
                entries = zip.getEntries();
            } catch (e) {
                logger.error('[Local Posterpack HEAD] Failed to open ZIP', {
                    zipPath: zipFull,
                    error: e.message,
                });
                return res.sendStatus(500);
            }

            // Check for empty ZIP
            if (!entries || entries.length === 0) {
                return res.sendStatus(404);
            }

            // Check extensions based on entry type
            let exts;
            if (entryKey === 'trailer' || entryKey === 'motion') {
                exts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'];
            } else if (entryKey === 'theme') {
                exts = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];
            } else {
                exts = ['jpg', 'jpeg', 'png', 'webp'];
            }
            let found = false;
            for (const ext of exts) {
                const re = new RegExp(
                    `(^|/)${entryKey === 'thumbnail' ? '(thumb|thumbnail)' : entryKey}\\.${ext}$`,
                    'i'
                );
                if (entries.some(e => re.test(e.entryName))) {
                    found = true;
                    break;
                }
            }
            if (!found) return res.sendStatus(404);
            return res.sendStatus(200);
        } catch (e) {
            logger.error('[Local Posterpack HEAD] Unexpected error', {
                error: e.message,
                stack: e.stack,
            });
            return res.sendStatus(500);
        }
    })
);

/**
 * @swagger
 * /api/admin/filter-preview:
 *   post:
 *     summary: Preview filter results for admin configuration
 *     description: Admin-only. Generates a preview of media results given filter criteria without caching them.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Filter criteria object
 *     responses:
 *       200:
 *         description: Preview results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 cached:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 sample:
 *                   type: array
 *                   items:
 *                     type: object
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Validation/timeout error
 */
app.post(
    '/api/admin/filter-preview',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        try {
            const perfTrace = env.logging.perfTraceAdmin;
            const reqStart = Date.now();
            const timeoutMs = env.performance.adminFilterPreviewTimeoutMs;
            // Fast-path cache (15s TTL) keyed by the normalized request body
            const cacheKey = (() => {
                try {
                    return JSON.stringify(req.body || {});
                } catch (_) {
                    return null;
                }
            })();
            const now = Date.now();
            if (cacheKey && adminFilterPreviewCache.has(cacheKey)) {
                const cached = adminFilterPreviewCache.get(cacheKey);
                // Increased cache TTL from 15s to 60s to reduce repeated expensive queries
                if (cached && now - cached.ts < 60000) {
                    try {
                        res.setHeader('X-Preview-Cache', 'hit');
                    } catch (_) {
                        /* ignore header set failure */
                    }
                    if (perfTrace) {
                        try {
                            res.setHeader('Server-Timing', `cache;dur=${Date.now() - reqStart}`);
                        } catch (_) {
                            /* ignore server-timing header failure */
                        }
                    }
                    return res.json(cached.value);
                }
            }
            const withTimeout = (promise, ms, label) =>
                new Promise(resolve => {
                    let settled = false;
                    const to = setTimeout(() => {
                        if (!settled) {
                            settled = true;
                            try {
                                logger.warn('[Admin Preview] Count timed out', {
                                    source: label,
                                    timeoutMs: ms,
                                });
                            } catch (_) {
                                /* noop */
                            }
                            resolve(0);
                        }
                    }, ms);
                    promise
                        .then(v => {
                            if (!settled) {
                                settled = true;
                                clearTimeout(to);
                                resolve(v);
                            }
                        })
                        .catch(e => {
                            try {
                                if (isDebug)
                                    logger.debug('[Admin Preview] Count failed', {
                                        source: label,
                                        error: e?.message,
                                    });
                            } catch (_) {
                                /* noop */
                            }
                            if (!settled) {
                                settled = true;
                                clearTimeout(to);
                                resolve(0);
                            }
                        });
                });
            const {
                plex = {},
                jellyfin = {},
                // Source-specific filters
                filtersPlex = {},
                filtersJellyfin = {},
            } = req.body || {};

            const parseCsv = v =>
                String(v || '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);

            const yearTester = expr => {
                if (!expr) return null;
                const parts = String(expr)
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
                const ranges = [];
                for (const p of parts) {
                    const m1 = p.match(/^\d{4}$/);
                    const m2 = p.match(/^(\d{4})\s*-\s*(\d{4})$/);
                    if (m1) {
                        const y = Number(m1[0]);
                        if (y >= 1900) ranges.push([y, y]);
                    } else if (m2) {
                        const a = Number(m2[1]);
                        const b = Number(m2[2]);
                        if (a >= 1900 && b >= a) ranges.push([a, b]);
                    }
                }
                if (!ranges.length) return null;
                return y => ranges.some(([a, b]) => y >= a && y <= b);
            };

            const mapResToLabel = reso => {
                const r = (reso || '').toString().toLowerCase();
                if (!r || r === 'sd') return 'SD';
                if (r === '720' || r === 'hd' || r === '720p') return '720p';
                if (r === '1080' || r === '1080p' || r === 'fullhd') return '1080p';
                if (r === '4k' || r === '2160' || r === '2160p' || r === 'uhd') return '4K';
                return r.toUpperCase();
            };

            const Fp = {
                years: String(filtersPlex.years || '').trim(),
                genres: parseCsv(filtersPlex.genres),
                ratings: parseCsv(filtersPlex.ratings).map(r => r.toUpperCase()),
                qualities: parseCsv(filtersPlex.qualities),
                recentOnly: !!filtersPlex.recentOnly,
                recentDays: Number(filtersPlex.recentDays) || 0,
            };
            const Fj = {
                years: String(filtersJellyfin.years || '').trim(),
                genres: parseCsv(filtersJellyfin.genres),
                ratings: parseCsv(filtersJellyfin.ratings).map(r => r.toUpperCase()),
                // Disable quality filtering for Jellyfin (unstable/expensive)
                // qualities: parseCsv(filtersJellyfin.qualities),
                qualities: [],
                recentOnly: !!filtersJellyfin.recentOnly,
                recentDays: Number(filtersJellyfin.recentDays) || 0,
            };
            const yearOkP = yearTester(Fp.years);
            const yearOkJ = yearTester(Fj.years);
            const recentCutoffP =
                Fp.recentOnly && Fp.recentDays > 0
                    ? Date.now() - Fp.recentDays * 24 * 60 * 60 * 1000
                    : null;
            const recentCutoffJ =
                Fj.recentOnly && Fj.recentDays > 0
                    ? Date.now() - Fj.recentDays * 24 * 60 * 60 * 1000
                    : null;

            // Compute counts in parallel, but each source internally serializes per library
            if (isDebug) {
                try {
                    logger.debug('[Admin Preview] Received filter-preview request', {
                        plex: {
                            movies: Array.isArray(plex?.movies) ? plex.movies : [],
                            shows: Array.isArray(plex?.shows) ? plex.shows : [],
                        },
                        jellyfin: {
                            movies: Array.isArray(jellyfin?.movies) ? jellyfin.movies : [],
                            shows: Array.isArray(jellyfin?.shows) ? jellyfin.shows : [],
                        },
                        filtersPlex: Fp,
                        filtersJellyfin: Fj,
                    });
                } catch (_) {
                    /* noop */
                }
            }
            // Perf collection containers
            const plexPerf = { tGetLibs: 0, libs: [] };
            const jfPerf = { tGetLibs: 0, libs: [] };

            const [plexCount, jfCount] = await Promise.all([
                withTimeout(
                    (async () => {
                        const pSel = plex && typeof plex === 'object' ? plex : {};
                        const movieLibs = Array.isArray(pSel.movies) ? pSel.movies : [];
                        const showLibs = Array.isArray(pSel.shows) ? pSel.shows : [];
                        if (!movieLibs.length && !showLibs.length) return 0;

                        // Resolve configured Plex server
                        const pServer = (config.mediaServers || []).find(
                            s => s.enabled && s.type === 'plex'
                        );
                        if (!pServer) return 0;
                        const plexClient = await getPlexClient(pServer);
                        const _tLibsStart = Date.now();
                        const libsMap = await getPlexLibraries(pServer);
                        plexPerf.tGetLibs = Date.now() - _tLibsStart;

                        const countForLib = async libName => {
                            const lib = libsMap.get(libName);
                            if (!lib) return 0;
                            let start = 0;
                            const pageSize = Math.max(1, env.plex.previewPageSize);
                            let total = 0;
                            let matched = 0;
                            let scanned = 0;
                            let pages = 0;
                            const _tStart = Date.now();
                            do {
                                const q = `/library/sections/${lib.key}/all?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`;
                                const resp = await plexClient.query(q);
                                const mc = resp?.MediaContainer;
                                const items = Array.isArray(mc?.Metadata) ? mc.Metadata : [];
                                scanned += items.length;
                                total = Number(mc?.totalSize || mc?.size || start + items.length);
                                for (const it of items) {
                                    // Years
                                    if (yearOkP) {
                                        let y = undefined;
                                        if (it.year != null) {
                                            const yy = Number(it.year);
                                            y = Number.isFinite(yy) ? yy : undefined;
                                        }
                                        if (y == null && it.originallyAvailableAt) {
                                            const d = new Date(it.originallyAvailableAt);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null && it.firstAired) {
                                            const d = new Date(it.firstAired);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null || !yearOkP(y)) continue;
                                    }
                                    // Genres
                                    if (Fp.genres.length) {
                                        const g = Array.isArray(it.Genre)
                                            ? it.Genre.map(x =>
                                                  x && x.tag ? String(x.tag).toLowerCase() : ''
                                              )
                                            : [];
                                        if (
                                            !Fp.genres.some(need =>
                                                g.includes(String(need).toLowerCase())
                                            )
                                        )
                                            continue;
                                    }
                                    // Ratings
                                    if (Fp.ratings.length) {
                                        const r = it.contentRating
                                            ? String(it.contentRating).trim().toUpperCase()
                                            : null;
                                        if (!r || !Fp.ratings.includes(r)) continue;
                                    }
                                    // Qualities
                                    if (Fp.qualities.length) {
                                        const medias = Array.isArray(it.Media) ? it.Media : [];
                                        let ok = false;
                                        for (const m of medias) {
                                            const label = mapResToLabel(m?.videoResolution);
                                            if (Fp.qualities.includes(label)) {
                                                ok = true;
                                                break;
                                            }
                                        }
                                        if (!ok) continue;
                                    }
                                    // Recently added
                                    if (recentCutoffP != null) {
                                        if (!it.addedAt) continue;
                                        const ts = Number(it.addedAt) * 1000; // seconds -> ms
                                        if (!Number.isFinite(ts) || ts < recentCutoffP) continue;
                                    }
                                    matched++;
                                }
                                start += items.length;
                                pages += 1;
                            } while (start < total && pageSize > 0);
                            if (perfTrace) {
                                try {
                                    plexPerf.libs.push({
                                        library: libName,
                                        durationMs: Date.now() - _tStart,
                                        pages,
                                        scanned,
                                        matched,
                                    });
                                } catch (_) {
                                    /* noop */
                                }
                            }
                            return matched;
                        };

                        let totalMatched = 0;
                        for (const name of [...movieLibs, ...showLibs]) {
                            try {
                                totalMatched += await countForLib(name);
                            } catch (e) {
                                if (isDebug)
                                    logger.debug('[Admin Preview] Plex count failed for library', {
                                        library: name,
                                        error: e?.message,
                                    });
                            }
                        }
                        return totalMatched;
                    })(),
                    timeoutMs,
                    'plex'
                ),
                withTimeout(
                    (async () => {
                        const jSel = jellyfin && typeof jellyfin === 'object' ? jellyfin : {};
                        const movieLibs = Array.isArray(jSel.movies) ? jSel.movies : [];
                        const showLibs = Array.isArray(jSel.shows) ? jSel.shows : [];
                        if (!movieLibs.length && !showLibs.length) return 0;

                        const jServer = (config.mediaServers || []).find(
                            s => s.enabled && s.type === 'jellyfin'
                        );
                        if (!jServer) return 0;
                        const jf = await getJellyfinClient(jServer);
                        const _tJLibsStart = Date.now();
                        const libsMap = await getJellyfinLibraries(jServer);
                        jfPerf.tGetLibs = Date.now() - _tJLibsStart;

                        const countForLib = async (libName, kind) => {
                            const lib = libsMap.get(libName);
                            if (!lib) return 0;
                            const pageSize = Math.max(1, env.jellyfin.previewPageSize);
                            let startIndex = 0;
                            let matched = 0;
                            let scanned = 0;
                            let pages = 0;
                            const _tStart = Date.now();
                            let fetched;
                            do {
                                const page = await jf.getItems({
                                    parentId: lib.id,
                                    includeItemTypes: kind === 'movie' ? ['Movie'] : ['Series'],
                                    recursive: true,
                                    // No MediaStreams/MediaSources since quality filtering is disabled
                                    fields: [
                                        'Genres',
                                        'OfficialRating',
                                        'ProductionYear',
                                        'PremiereDate',
                                        'DateCreated',
                                    ],
                                    sortBy: [],
                                    limit: pageSize,
                                    startIndex,
                                });
                                const items = Array.isArray(page?.Items) ? page.Items : [];
                                fetched = items.length;
                                scanned += items.length;
                                startIndex += fetched;
                                for (const it of items) {
                                    // Years
                                    if (yearOkJ) {
                                        let y = undefined;
                                        if (it.ProductionYear != null) {
                                            const yy = Number(it.ProductionYear);
                                            y = Number.isFinite(yy) ? yy : undefined;
                                        }
                                        if (y == null && it.PremiereDate) {
                                            const d = new Date(it.PremiereDate);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null && it.DateCreated) {
                                            const d = new Date(it.DateCreated);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null || !yearOkJ(y)) continue;
                                    }
                                    // Genres
                                    if (Fj.genres.length) {
                                        const g = Array.isArray(it.Genres)
                                            ? it.Genres.map(x => String(x).toLowerCase())
                                            : [];
                                        if (
                                            !Fj.genres.some(need =>
                                                g.includes(String(need).toLowerCase())
                                            )
                                        )
                                            continue;
                                    }
                                    // Ratings
                                    if (Fj.ratings.length) {
                                        const r = it.OfficialRating
                                            ? String(it.OfficialRating).trim().toUpperCase()
                                            : null;
                                        if (!r || !Fj.ratings.includes(r)) continue;
                                    }
                                    // Qualities: disabled for Jellyfin
                                    // Recently added
                                    if (recentCutoffJ != null) {
                                        const dt = it.DateCreated
                                            ? new Date(it.DateCreated).getTime()
                                            : NaN;
                                        if (!Number.isFinite(dt) || dt < recentCutoffJ) continue;
                                    }
                                    matched++;
                                }
                                pages += 1;
                            } while (fetched === pageSize);
                            if (perfTrace) {
                                try {
                                    jfPerf.libs.push({
                                        library: libName,
                                        kind,
                                        durationMs: Date.now() - _tStart,
                                        pages,
                                        scanned,
                                        matched,
                                    });
                                } catch (_) {
                                    /* noop */
                                }
                            }
                            return matched;
                        };

                        let totalMatched = 0;
                        for (const name of movieLibs) {
                            try {
                                totalMatched += await countForLib(name, 'movie');
                            } catch (e) {
                                if (isDebug)
                                    logger.debug('[Admin Preview] Jellyfin movie count failed', {
                                        library: name,
                                        error: e?.message,
                                    });
                            }
                        }
                        for (const name of showLibs) {
                            try {
                                totalMatched += await countForLib(name, 'show');
                            } catch (e) {
                                if (isDebug)
                                    logger.debug('[Admin Preview] Jellyfin show count failed', {
                                        library: name,
                                        error: e?.message,
                                    });
                            }
                        }
                        return totalMatched;
                    })(),
                    timeoutMs,
                    'jellyfin'
                ),
            ]);

            if (isDebug) {
                try {
                    logger.debug('[Admin Preview] Computed counts', {
                        counts: { plex: plexCount, jellyfin: jfCount },
                    });
                } catch (_) {
                    /* fire-and-forget */
                }
            }
            // Optional perf trace output and Server-Timing header
            if (perfTrace) {
                try {
                    const totalMs = Date.now() - reqStart;
                    const st = [
                        `total;dur=${totalMs}`,
                        `plex-libs;dur=${plexPerf.tGetLibs}`,
                        `jf-libs;dur=${jfPerf.tGetLibs}`,
                    ].join(', ');
                    res.setHeader('Server-Timing', st);
                    logger.info('[Admin Preview][perf]', {
                        totalMs,
                        plex: plexPerf,
                        jellyfin: jfPerf,
                        result: { plex: plexCount, jellyfin: jfCount },
                    });
                } catch (_) {
                    /* noop */
                }
            }
            const payload = { success: true, counts: { plex: plexCount, jellyfin: jfCount } };
            if (cacheKey) {
                // Cache for 60 seconds to reduce load during filter configuration
                adminFilterPreviewCache.set(cacheKey, { ts: Date.now(), value: payload });
                try {
                    res.setHeader('X-Preview-Cache', 'miss');
                } catch (_) {
                    /* ignore header set failure */
                }
            }
            res.json(payload);
        } catch (e) {
            if (isDebug)
                logger.debug('[Admin Preview] Error computing filtered counts', {
                    error: e?.message,
                });
            res.status(500).json({ success: false, error: 'Failed to compute filtered counts' });
        }
    })
);

/**
 * @swagger
 * /api/v1/admin/config/validate:
 *   post:
 *     summary: Validate configuration data
 *     description: Validates configuration object against schema and returns sanitized data
 *     tags: ['Validation']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Configuration object to validate
 *     responses:
 *       200:
 *         description: Configuration is valid
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
 *                   example: "Configuration is valid"
 *                 sanitized:
 *                   type: object
 *                   description: Sanitized configuration data
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StandardErrorResponse'
 */
app.post(
    '/api/v1/admin/config/validate',
    express.json(),
    createValidationMiddleware(schemas.config, 'body'),
    (req, res) => {
        res.json({
            success: true,
            message: 'Configuration is valid',
            sanitized: req.body,
        });
    }
);

/**
 * @swagger
 * /api/v1/admin/plex/validate-connection:
 *   post:
 *     summary: Validate Plex connection data
 *     description: Validates Plex server connection parameters against schema
 *     tags: ['Validation']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostname:
 *                 type: string
 *                 description: Plex server hostname or IP
 *               port:
 *                 type: number
 *                 description: Plex server port
 *               token:
 *                 type: string
 *                 description: Plex authentication token
 *     responses:
 *       200:
 *         description: Plex connection data is valid
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
 *                   example: "Plex connection data is valid"
 *                 sanitized:
 *                   type: object
 *                   description: Sanitized connection data
 *       400:
 *         description: Validation error
 */
app.post(
    '/api/v1/admin/plex/validate-connection',
    express.json(),
    createValidationMiddleware(schemas.plexConnection, 'body'),
    (req, res) => {
        res.json({
            success: true,
            message: 'Plex connection data is valid',
            sanitized: req.body,
        });
    }
);

// Apply query parameter validation to media endpoints

// === METRICS & TESTING ROUTES ===
// Extracted to routes/metrics-testing.js
const createMetricsTestingRouter = require('./routes/metrics-testing');
const metricsTestingRouter = createMetricsTestingRouter({ metricsManager });
app.use('/', metricsTestingRouter);

// Source error metrics routes (Issue #97)
const createSourceErrorMetricsRouter = require('./routes/source-error-metrics');
const sourceErrorMetricsRouter = createSourceErrorMetricsRouter();
app.use('/', sourceErrorMetricsRouter);

// Apply query parameter validation to media endpoints
/**
 * @swagger
 * /api/v1/admin/metrics/config:
 *   post:
 *     summary: Update metrics configuration
 *     description: Updates the metrics collection configuration
 *     tags: ['Metrics', 'Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Enable or disable metrics collection
 *               collectInterval:
 *                 type: number
 *                 description: Metrics collection interval in milliseconds
 *               retentionPeriod:
 *                 type: number
 *                 description: How long to retain metrics data in milliseconds
 *               endpoints:
 *                 type: object
 *                 description: Per-endpoint configuration
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 config:
 *                   type: object
 *                   description: Updated configuration
 *       400:
 *         description: Invalid configuration
 */
app.post('/api/v1/admin/metrics/config', express.json(), (req, res) => {
    try {
        const { enabled, collectInterval, retentionPeriod, endpoints } = req.body;

        // Validate configuration
        const config = {};
        if (typeof enabled === 'boolean') config.enabled = enabled;
        if (typeof collectInterval === 'number' && collectInterval > 0)
            config.collectInterval = collectInterval;
        if (typeof retentionPeriod === 'number' && retentionPeriod > 0)
            config.retentionPeriod = retentionPeriod;
        if (endpoints && typeof endpoints === 'object') config.endpoints = endpoints;

        metricsManager.updateConfig(config);
        res.json({ success: true, config });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Frontend legacy redirects and admin assets extracted to routes/frontend-pages.js

// Redirect routes for legacy HTML paths (setup.html, login.html, 2fa-verify.html)
// and cache-busted admin assets (admin.css, admin.js) extracted to routes/frontend-pages.js

// Import optimized middleware
const {
    securityMiddleware,
    permissionsPolicyMiddleware,
    compressionMiddleware,
    corsMiddleware,
    requestLoggingMiddleware,
} = require('./middleware/index');
const { cacheMiddleware: apiCacheMiddleware, apiCache } = require('./middleware/cache');

// Register apiCache globally for cleanup
global.apiCacheInstance = apiCache;

const {
    validationRules,
    createValidationMiddleware: newValidationMiddleware,
} = require('./middleware/validation');

// logs.html redirect extracted to routes/frontend-pages.js

// Disable ALL caching for admin files - they must ALWAYS be fresh
app.use((req, res, next) => {
    // Admin files: admin.html, admin.js, admin.css, logs.html, logs.js, device-mgmt.js
    const isAdminFile = /\/(admin|logs|device-mgmt)\.(html|js|css)/.test(req.url);

    if (isAdminFile) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
    next();
});

// Serve wallart.html with asset version stamping
app.get(['/wallart', '/wallart.html'], (req, res) => {
    logger.info('[WALLART ROUTE] Serving wallart.html with asset versioning');
    const filePath = path.join(publicDir, 'wallart.html');

    fs.readFile(filePath, 'utf8', async (err, contents) => {
        if (err) {
            logger.error('Error reading wallart.html:', err);
            return res.sendFile(filePath); // Fallback to static file
        }

        // Generate versions inline for immediate availability
        const crypto = require('crypto');
        const generateVersion = async assetPath => {
            try {
                const fullPath = path.join(publicDir, assetPath);
                const stats = await fs.promises.stat(fullPath);
                const hash = crypto
                    .createHash('sha1')
                    .update(stats.mtime.getTime().toString())
                    .digest('hex');
                return hash.substring(0, 6);
            } catch {
                return 'fallback';
            }
        };

        const versionAssets = [
            'wallart/wallart-display.js',
            'wallart/artist-cards.js',
            'wallart/film-cards.js',
            'wallart/wallart.css',
            'admin.js',
            'admin.css',
            'core.js',
            'lazy-loading.js',
            'device-mgmt.js',
            'debug-logger.js',
            'client-logger.js',
        ];
        const versions = Object.fromEntries(
            await Promise.all(
                versionAssets.map(async assetPath => [assetPath, await generateVersion(assetPath)])
            )
        );

        // Simple replacement of all {{ASSET_VERSION}} placeholders with actual versions
        const stamped = contents
            .replace(
                /\/wallart\/wallart-display\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/wallart/wallart-display.js?v=${versions['wallart/wallart-display.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/wallart\/artist-cards\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/wallart/artist-cards.js?v=${versions['wallart/artist-cards.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/wallart\/film-cards\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/wallart/film-cards.js?v=${versions['wallart/film-cards.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/wallart\/wallart\.css\?v=\{\{ASSET_VERSION\}\}/g,
                `/wallart/wallart.css?v=${versions['wallart/wallart.css'] || ASSET_VERSION}`
            )
            .replace(
                /\/core\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/core.js?v=${versions['core.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/lazy-loading\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/lazy-loading.js?v=${versions['lazy-loading.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/device-mgmt\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/device-mgmt.js?v=${versions['device-mgmt.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/debug-logger\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/debug-logger.js?v=${versions['debug-logger.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/client-logger\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/admin\.css\?v=\{\{ASSET_VERSION\}\}/g,
                `/admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
            )
            .replace(
                /\/admin\.js\?v=\{\{ASSET_VERSION\}\}/g,
                `/admin.js?v=${versions['admin.js'] || ASSET_VERSION}`
            );

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(stamped);
    });
});

// Serve static files from public/
// Some pages or browsers may request /favicon.png; redirect to the canonical favicon.ico
app.get('/favicon.png', (req, res) => {
    res.redirect(302, '/favicon.ico');
});

// iOS/Safari will probe these defaults even if we provide explicit <link rel="apple-touch-icon"> tags.
app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => {
    res.redirect(302, '/icons/icon-192x192.png?v=2');
});
app.use(
    express.static(publicDir, {
        setHeaders: (res, _path) => {
            try {
                const url = res.req?.url || '';
                if (/[?&](v|cb)=/.test(url)) {
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                }
            } catch {
                // ignore
            }
        },
    })
);

// Block Next.js routes early to prevent MIME type errors from JSON 404 responses
// These routes are injected by browser extensions, service workers, or stale caches
app.use((req, res, next) => {
    if (req.path.startsWith('/_next')) {
        logger.debug(`[Security] Blocked Next.js route attempt: ${req.path}`);
        res.status(404).type('text/plain').send('Not Found');
        return;
    }
    next();
});

// NOTE: cache-busted static assets are handled via express.static setHeaders above.
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(express.json({ limit: '10mb' })); // For parsing JSON payloads

// Apply new optimization middleware
// Fixed compression middleware - now respects Accept-Encoding properly
app.use(compressionMiddleware());
app.use(securityMiddleware());
app.use(permissionsPolicyMiddleware());
app.use(corsMiddleware());
app.use(requestLoggingMiddleware());
// In test environment, optionally log requests; only seed session for safe idempotent reads (GET/HEAD)
if (env.server.nodeEnv === 'test') {
    app.use((req, _res, next) => {
        if (env.logging.printAuthDebug) {
            // Replaced raw console.log with logger.debug (pre-review enforcement)
            logger.debug('[REQ]', req.method, req.path, 'Auth:', req.headers.authorization || '');
        }
        next();
    });
}
// Admin guard alias (module-scope so routes outside feature blocks can use it)
const adminAuth = /** @type {import('express').RequestHandler} */ (
    createAdminAuth({ isAuthenticated, logger })
);
const adminAuthDevices = createAdminAuthDevices({ adminAuth, logger });

// --- Profile Photo (Avatar) Routes ---
// Modularized profile photo upload/retrieval/deletion
const createProfilePhotoRouter = require('./routes/profile-photo');
const profilePhotoRouter = createProfilePhotoRouter({
    adminAuth,
    getAvatarPath,
    avatarDir,
});
app.use('/', profilePhotoRouter);

// === RATING & QUALITY HELPERS ===
// Helper functions for admin endpoints that use ratings utilities
const ratingsUtil = require('./utils/ratings');

async function getJellyfinQualitiesWithCounts(serverConfig, fullScan = false) {
    return ratingsUtil.getJellyfinQualitiesWithCounts({
        serverConfig,
        getJellyfinClient,
        getJellyfinLibraries,
        isDebug,
        logger,
        fullScan,
    });
}

// === PUBLIC API ROUTES ===
// Extracted to routes/public-api.js
const createPublicApiRouter = require('./routes/public-api');
const publicApiRouter = createPublicApiRouter({
    config,
    logger,
    ratingCache,
    githubService,
    asyncHandler,
    isAuthenticated,
    ratingsUtil: require('./utils/ratings'),
    getJellyfinClient,
    getJellyfinLibraries,
    getPlexClient,
    readConfig,
    isDebug,
});
app.use('/', publicApiRouter);

// === ADMIN CONFIG ROUTES ===
// Extracted to routes/admin-config.js
const createAdminConfigRouter = require('./routes/admin-config');
const adminConfigRouter = createAdminConfigRouter({
    config,
    logger,
    isDebug,
    FIXED_LIMITS,
    readConfig,
    readEnvFile,
    writeConfig,
    writeEnvFile,
    restartPM2ForEnvUpdate,
    schedulePlaylistBackgroundRefresh,
    wsHub,
    apiCache,
    ApiError,
    asyncHandler,
    isAuthenticated,
    createPlexClient,
    createJellyfinClient,
    serverIPAddress,
    port,
});
app.use('/', adminConfigRouter);

// === QUALITY & RATINGS ROUTES ===
// Extracted to routes/quality-ratings.js
const createQualityRatingsRouter = require('./routes/quality-ratings');
const qualityRatingsRouter = createQualityRatingsRouter({
    logger,
    isDebug,
    readConfig,
    asyncHandler,
    isAuthenticated,
    getPlexQualitiesWithCounts,
    getJellyfinQualitiesWithCounts,
});
app.use('/', qualityRatingsRouter);

// === ADMIN LIBRARY ROUTES ===
// Extracted to routes/admin-libraries.js
const createAdminLibrariesRouter = require('./routes/admin-libraries');
const adminLibrariesRouter = createAdminLibrariesRouter({
    logger,
    isDebug,
    readConfig,
    asyncHandler,
    isAuthenticated,
    ApiError,
    createJellyfinClient,
    fetchJellyfinLibraries,
    getPlexGenres,
    getPlexGenresWithCounts,
});
app.use('/', adminLibrariesRouter);

// === ADMIN CACHE ROUTES ===
// Extracted to routes/admin-cache.js
const createAdminCacheRouter = require('./routes/admin-cache');
const adminCacheRouter = createAdminCacheRouter({
    logger,
    asyncHandler,
    adminAuth,
});
app.use('/', adminCacheRouter);
// Initialize cache references (must be done after apiCache is created)
// @ts-ignore - Custom method on router
adminCacheRouter.initCacheReferences(cacheManager, apiCache);

// === ADMIN LOGS ROUTES ===
// Extracted to routes/admin-logs.js
const adminLogsRouter = require('./routes/admin-logs');
// @ts-ignore - Express router overload with middleware
app.use('/api/admin', isAuthenticated, adminLogsRouter);

// === ADMIN PERFORMANCE ROUTES ===
// Extracted to routes/admin-performance.js
const createAdminPerformanceRouter = require('./routes/admin-performance');
const adminPerformanceRouter = createAdminPerformanceRouter({
    logger,
    metricsManager,
    cacheManager,
    apiCache, // API response cache (for hit rate metrics)
    wsHub,
    config,
    asyncHandler,
    adminAuth,
});
app.use('/', adminPerformanceRouter);

// Minimal CSP violation report endpoint
// Accepts both deprecated report-uri (application/csp-report) and modern report-to (application/reports+json)
const cspReportJson = express.json({
    type: req => {
        const ct = (req.headers['content-type'] || '').toLowerCase();
        return (
            ct.includes('application/csp-report') ||
            ct.includes('application/reports+json') ||
            ct.includes('application/json')
        );
    },
});

/**
 * @swagger
 * /api/admin/plex/music-libraries:
 *   get:
 *     summary: Get all Plex music libraries with metadata
 *     description: Returns a list of all music libraries from the configured Plex server, including album and artist counts.
 *     tags: ['Admin', 'Plex', 'Music']
 *     security:
 *       - sessionAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of music libraries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                     description: Library section key
 *                   title:
 *                     type: string
 *                     description: Library name
 *                   type:
 *                     type: string
 *                     description: Library type (artist for music)
 *                   agent:
 *                     type: string
 *                     nullable: true
 *                   scanner:
 *                     type: string
 *                     nullable: true
 *                   language:
 *                     type: string
 *                     nullable: true
 *                   uuid:
 *                     type: string
 *                     nullable: true
 *                   albumCount:
 *                     type: integer
 *                     description: Number of albums in library
 *                   artistCount:
 *                     type: integer
 *                     description: Number of artists in library
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No Plex server configured
 *       500:
 *         description: Failed to fetch music libraries
 */
// @ts-ignore - Express router overload with middleware
app.get('/api/admin/plex/music-libraries', adminAuth, async (req, res) => {
    try {
        // Find enabled Plex server
        const plexServer = (config.mediaServers || []).find(s => s.enabled && s.type === 'plex');

        if (!plexServer) {
            return res.status(404).json({ error: 'no_plex_server_configured' });
        }

        const libraries = await getPlexMusicLibraries(plexServer);
        res.json(libraries);
    } catch (err) {
        logger.error(`Failed to fetch Plex music libraries: ${err.message}`);
        res.status(500).json({ error: 'music_libraries_fetch_failed', message: err.message });
    }
});

/**
 * @swagger
 * /api/admin/plex/music-genres:
 *   get:
 *     summary: Get genres from a Plex music library
 *     description: Returns all genres available in the specified music library with usage counts, sorted by count descending.
 *     tags: ['Admin', 'Plex', 'Music']
 *     security:
 *       - sessionAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: library
 *         required: true
 *         schema:
 *           type: string
 *         description: Library section key
 *     responses:
 *       200:
 *         description: List of genres with counts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   tag:
 *                     type: string
 *                     description: Genre name
 *                   count:
 *                     type: integer
 *                     description: Number of albums with this genre
 *       400:
 *         description: Missing library parameter
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No Plex server configured
 *       500:
 *         description: Failed to fetch genres
 */
// @ts-ignore - Express router overload with middleware
app.get('/api/admin/plex/music-genres', adminAuth, async (req, res) => {
    try {
        const { library } = req.query;

        if (!library) {
            return res.status(400).json({ error: 'library_parameter_required' });
        }

        // Find enabled Plex server
        const plexServer = (config.mediaServers || []).find(s => s.enabled && s.type === 'plex');

        if (!plexServer) {
            return res.status(404).json({ error: 'no_plex_server_configured' });
        }

        const genres = await getPlexMusicGenres(plexServer, String(library));
        res.json(genres);
    } catch (err) {
        logger.error(`Failed to fetch Plex music genres: ${err.message}`);
        res.status(500).json({ error: 'music_genres_fetch_failed', message: err.message });
    }
});

/**
 * @swagger
 * /api/admin/plex/music-artists:
 *   get:
 *     summary: Get artists from a Plex music library
 *     description: Returns artists from the specified music library with pagination support.
 *     tags: ['Admin', 'Plex', 'Music']
 *     security:
 *       - sessionAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: library
 *         required: true
 *         schema:
 *           type: string
 *         description: Library section key
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of artists to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Starting offset for pagination
 *     responses:
 *       200:
 *         description: Artists with pagination info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 artists:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                         description: Artist rating key
 *                       title:
 *                         type: string
 *                         description: Artist name
 *                       thumb:
 *                         type: string
 *                         nullable: true
 *                         description: Artist thumbnail URL
 *                       albumCount:
 *                         type: integer
 *                         description: Number of albums by this artist
 *                 total:
 *                   type: integer
 *                   description: Total number of artists in library
 *       400:
 *         description: Missing library parameter
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No Plex server configured
 *       500:
 *         description: Failed to fetch artists
 */
// @ts-ignore - Express router overload with middleware
app.get('/api/admin/plex/music-artists', adminAuth, async (req, res) => {
    try {
        const { library, limit = 100, offset = 0 } = req.query;

        if (!library) {
            return res.status(400).json({ error: 'library_parameter_required' });
        }

        // Find enabled Plex server
        const plexServer = (config.mediaServers || []).find(s => s.enabled && s.type === 'plex');

        if (!plexServer) {
            return res.status(404).json({ error: 'no_plex_server_configured' });
        }

        const result = await getPlexMusicArtists(
            plexServer,
            String(library),
            parseInt(String(limit), 10),
            parseInt(String(offset), 10)
        );
        res.json(result);
    } catch (err) {
        logger.error(`Failed to fetch Plex music artists: ${err.message}`);
        res.status(500).json({ error: 'music_artists_fetch_failed', message: err.message });
    }
});

/**
 * @swagger
 * /csp-report:
 *   post:
 *     summary: Receive CSP violation reports
 *     description: Accepts Content Security Policy violation reports from browsers to monitor security issues
 *     tags: ['Security']
 *     requestBody:
 *       required: true
 *       content:
 *         application/csp-report:
 *           schema:
 *             type: object
 *         application/reports+json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       204:
 *         description: Report received and logged
 *       400:
 *         description: Invalid report format
 */
app.post('/csp-report', cspReportJson, (req, res) => {
    try {
        let report = req.body;
        // Old-style: { "csp-report": { ... } }
        if (report && report['csp-report']) report = report['csp-report'];
        // New-style Report-To batches: [ { type: 'csp-violation', body: {...} }, ... ]
        if (Array.isArray(report)) {
            const first = report.find(r => r?.type?.includes('csp')) || report[0];
            report = first?.body || first || {};
        }

        const safe = JSON.stringify(report || {}).slice(0, 5000);
        logger.warn('CSP Violation Report', { report: safe });
    } catch (e) {
        logger.warn('CSP Violation Report (unparseable)', { error: e.message });
    }
    // Always respond 204 No Content to avoid probing
    res.status(204).end();
});

// API cache stats endpoint (admin only)
/**
 * @swagger
 * /api/admin/cache/stats:
 *   get:
 *     summary: Get API cache statistics
 *     description: Retrieve detailed statistics about API cache performance and usage
 *     tags: ['Cache']
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Cache statistics data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin role required
 */
app.get(
    '/api/admin/cache/stats',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    newValidationMiddleware(validationRules.adminRequest),
    apiCacheMiddleware.short,
    (req, res) => {
        const stats = apiCache.getStats();
        res.json({
            success: true,
            data: stats,
        });
    }
);

// Performance metrics endpoint (admin only)
/**
 * @swagger
 * /api/admin/performance/metrics:
 *   get:
 *     summary: Get comprehensive performance metrics
 *     description: |
 *       Retrieve detailed performance metrics including cache statistics,
 *       source performance, and system information. Used for baseline
 *       measurements and optimization monitoring.
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Performance metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 data:
 *                   type: object
 *                   properties:
 *                     cache:
 *                       type: object
 *                       description: Cache performance metrics
 *                     sources:
 *                       type: object
 *                       description: Media source performance metrics
 *                     system:
 *                       type: object
 *                       description: System information
 *       401:
 *         description: Unauthorized
 */
app.get(
    '/api/admin/performance/metrics',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    newValidationMiddleware(validationRules.adminRequest),
    asyncHandler(async (req, res) => {
        const cacheStats = apiCache.getStats();
        const mainCacheStats = cacheManager.getStats();

        // Gather source metrics
        const sourceMetrics = {};
        if (global.__posterramaPlexSources) {
            sourceMetrics.plex = Object.fromEntries(
                Array.from(global.__posterramaPlexSources.entries()).map(([name, source]) => [
                    name,
                    source.getMetrics(),
                ])
            );
        }
        if (global.__posterramaJellyfinSources) {
            sourceMetrics.jellyfin = Object.fromEntries(
                Array.from(global.__posterramaJellyfinSources.entries()).map(([name, source]) => [
                    name,
                    source.getMetrics(),
                ])
            );
        }
        if (global.__posterramaTmdbSource) {
            sourceMetrics.tmdb = global.__posterramaTmdbSource.getMetrics();
        }
        if (global.__posterramaLocalSource) {
            sourceMetrics.local = global.__posterramaLocalSource.getMetrics();
        }

        // System information
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: {
                cache: {
                    api: cacheStats,
                    main: mainCacheStats,
                },
                sources: sourceMetrics,
                system: {
                    memory: {
                        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                        external: Math.round(memUsage.external / 1024 / 1024),
                        rss: Math.round(memUsage.rss / 1024 / 1024),
                        unit: 'MB',
                    },
                    uptime: {
                        seconds: Math.round(uptime),
                        formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
                    },
                    node: process.version,
                    platform: process.platform,
                },
            },
        });
    })
);

// Direct swagger spec endpoint for debugging
/**
 * @swagger
 * /api-docs/swagger.json:
 *   get:
 *     summary: Get OpenAPI/Swagger specification
 *     description: Returns the complete OpenAPI specification for the API
 *     tags: ['Documentation']
 *     responses:
 *       200:
 *         description: OpenAPI specification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: OpenAPI 3.0 specification
 */
app.get('/api-docs/swagger.json', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Generate fresh swagger spec with dynamic server URL from request
    delete require.cache[require.resolve('./swagger.js')];
    const { generate } = require('./swagger.js');
    const freshSwaggerSpecs = generate(req);

    res.json(freshSwaggerSpecs);
});

// Scalar API documentation (modern interactive docs with Try It functionality)
app.get('/api-docs', (req, res) => {
    res.sendFile(path.join(publicDir, 'api-docs-scalar.html'));
});

// General request logger for debugging
if (isDebug) {
    app.use((req, res, next) => {
        // Skip logging admin polling endpoints to reduce debug noise
        const isPollingEndpoint =
            req.originalUrl.startsWith('/api/admin/status') ||
            req.originalUrl.startsWith('/api/admin/performance') ||
            req.originalUrl.startsWith('/api/admin/mqtt/status') ||
            req.originalUrl.startsWith('/api/admin/logs') ||
            req.originalUrl.startsWith('/api/admin/metrics') ||
            req.originalUrl.startsWith('/api/v1/metrics') ||
            req.originalUrl.startsWith('/api/plex/sessions');

        if (!isPollingEndpoint) {
            logger.debug(`[Request Logger] Received: ${req.method} ${req.originalUrl}`);
        }
        next();
    });
}

// --- Main Data Aggregation ---

/**
 * Legacy wrapper for getPlaylistMedia that injects dependencies.
 * This maintains backward compatibility while using the extracted module.
 * @returns {Promise<Array>} Array of media items from all sources
 */
async function getPlaylistMediaWrapper() {
    // @ts-ignore - Returns {media, errors} object, not array
    return getPlaylistMedia({
        config,
        processPlexItem,
        shuffleArray,
        localDirectorySource,
        logger,
        isDebug,
    });
}

/**
 * Wrapper for refreshPlaylistCache that injects dependencies.
 */
async function refreshPlaylistCache() {
    return refreshPlaylistCacheCore({
        getPlaylistMediaWrapper,
        shuffleArray,
        totalCap: FIXED_LIMITS.TOTAL_CAP,
    });
}

/**
 * Wrapper for schedulePlaylistBackgroundRefresh that injects dependencies.
 */
function schedulePlaylistBackgroundRefresh() {
    return schedulePlaylistBackgroundRefreshCore({
        // @ts-ignore - Config.backgroundRefreshMinutes exists at runtime
        intervalMinutes: config.backgroundRefreshMinutes,
        refreshCallback: refreshPlaylistCache,
    });
}

// --- Admin Panel Logic ---

// --- Admin Panel Routes ---

/**
 * @swagger
 * /admin:
 *   get:
 *     summary: Admin panel homepage
 *     description: Serves the main admin panel interface. Redirects to setup if not configured, requires authentication.
 *     tags: ['Admin']
 *     responses:
 *       200:
 *         description: Admin panel served successfully
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       302:
 *         description: Redirects to setup page if admin not configured
 *       401:
 *         description: Authentication required
 */
app.get('/admin', (req, res) => {
    if (!isAdminSetup()) {
        return res.redirect('/admin/setup');
    }

    // Force redirect to remove old version parameters from cached URLs
    // This ensures users always get the latest admin interface
    const queryParams = req.query;
    const hasOldVersionParam = queryParams.v && !/^\d+$/.test(String(queryParams.v));

    if (hasOldVersionParam) {
        // Redirect to clean URL with cache-busting timestamp
        const cleanUrl = `/admin?_refresh=${Date.now()}`;
        logger.info(`Redirecting old cached version (v=${queryParams.v}) to latest`);
        return res.redirect(302, cleanUrl);
    }

    // If setup is done, the isAuthenticated middleware will handle the rest
    isAuthenticated(req, res, () => {
        // Generate cache buster based on file modification times for better caching
        const cssPath = path.join(publicDir, 'admin.css');
        const jsPath = path.join(publicDir, 'admin.js');

        Promise.all([fs.promises.stat(cssPath), fs.promises.stat(jsPath)])
            .then(([cssStats, jsStats]) => {
                const cssCacheBuster = cssStats.mtime.getTime();
                const jsCacheBuster = jsStats.mtime.getTime();

                // Read admin.html and inject cache busters
                fs.readFile(path.join(publicDir, 'admin.html'), 'utf8', (err, data) => {
                    if (err) {
                        logger.error('Error reading admin.html:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    // Replace version parameters with file-based cache busters
                    const updatedHtml = data
                        // Replace any existing query string after admin.css?v=... (including extra params)
                        .replace(/admin\.css\?v=[^"&\s]+/g, `admin.css?v=${cssCacheBuster}`)
                        // Replace any existing query string after admin.js?v=... (including extra params)
                        .replace(/admin\.js\?v=[^"&\s]+/g, `admin.js?v=${jsCacheBuster}`)
                        // Replace all remaining {{ASSET_VERSION}} placeholders with app version
                        .replace(/\{\{ASSET_VERSION\}\}/g, ASSET_VERSION);

                    res.setHeader('Content-Type', 'text/html');
                    // AGGRESSIVE cache headers to force reload
                    res.setHeader(
                        'Cache-Control',
                        'no-cache, no-store, must-revalidate, max-age=0, proxy-revalidate'
                    );
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                    // Use JS mtime as ETag to detect when files change
                    res.setHeader('ETag', `"admin-js-${jsCacheBuster}"`);
                    // Force browsers to check with server even if cached
                    res.setHeader('Vary', 'Accept-Encoding');
                    res.send(updatedHtml);
                });
            })
            .catch(error => {
                // Fallback to timestamp-based cache buster if file stats fail
                logger.warn(
                    'Could not read file stats for cache busting, using timestamp fallback:',
                    error.message
                );
                const fallbackCacheBuster = Date.now();

                fs.readFile(path.join(publicDir, 'admin.html'), 'utf8', (err, data) => {
                    if (err) {
                        logger.error('Error reading admin.html:', err);
                        return res.status(500).send('Internal Server Error');
                    }

                    const updatedHtml = data
                        .replace(/admin\.css\?v=[^"&\s]+/g, `admin.css?v=${fallbackCacheBuster}`)
                        .replace(/admin\.js\?v=[^"&\s]+/g, `admin.js?v=${fallbackCacheBuster}`)
                        // Replace all remaining {{ASSET_VERSION}} placeholders with app version
                        .replace(/\{\{ASSET_VERSION\}\}/g, ASSET_VERSION);

                    res.setHeader('Content-Type', 'text/html');
                    res.setHeader(
                        'Cache-Control',
                        'no-cache, no-store, must-revalidate, max-age=0, proxy-revalidate'
                    );
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', '0');
                    res.setHeader('ETag', `"admin-fallback-${fallbackCacheBuster}"`);
                    res.setHeader('Vary', 'Accept-Encoding');
                    res.send(updatedHtml);
                });
            });
    });
});

// Note: Admin v2 is now served exclusively at /admin; legacy /admin2 routes removed

/**
 * @swagger
 * /admin/logs:
 *   get:
 *     summary: Admin logs viewer
 *     description: Serves the live log viewer page for administrators
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Logs viewer page served successfully
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       401:
 *         description: Authentication required
 */
// @ts-ignore - Express router overload with middleware
app.get('/admin/logs', isAuthenticated, (req, res) => {
    // This route serves the dedicated live log viewer page with auto-versioning.
    const filePath = path.join(publicDir, 'logs.html');

    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) {
            logger.error('Error reading logs.html:', err);
            return res.sendFile(filePath); // Fallback to static file
        }

        // Get current asset versions
        const versions = getAssetVersions(__dirname);

        // Replace asset version placeholders with individual file versions
        let stamped = contents.replace(
            /admin\.css\?v=[^"&\s]+/g,
            `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
        );

        stamped = stamped.replace(
            /logs\.css\?v=[^"&\s]+/g,
            `logs.css?v=${versions['logs.css'] || ASSET_VERSION}`
        );

        stamped = stamped.replace(
            /logs\.js\?v=[^"&\s]+/g,
            `logs.js?v=${versions['logs.js'] || ASSET_VERSION}`
        );

        stamped = stamped.replace(
            /admin-logs-viewer\.js\?v=[^"&\s]+/g,
            `admin-logs-viewer.js?v=${versions['js/admin-logs-viewer.js'] || ASSET_VERSION}`
        );

        stamped = stamped.replace(
            /admin-logs-viewer\.css\?v=[^"&\s]+/g,
            `admin-logs-viewer.css?v=${versions['css/admin-logs-viewer.css'] || ASSET_VERSION}`
        );

        res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
        res.send(stamped);
    });
});

// --- API Endpoints ---

/**
 * @swagger
 * components:
 *   schemas:
 *     HealthCheckResult:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: The name of the check performed
 *           example: "Connection: Plex Server (plex)"
 *         status:
 *           type: string
 *           enum: [ok, warn, error]
 *           description: The status of the check
 *           example: "ok"
 *         message:
 *           type: string
 *           description: A descriptive message about the check result
 *           example: "Connection successful"
 *     HealthCheckResponse:
 *       type: object
 *       required: [status, timestamp, checks]
 *       properties:
 *         status:
 *           type: string
 *           enum: [ok, error]
 *           description: Overall health status of the application
 *           example: "ok"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Timestamp when the health check was performed
 *           example: "2025-07-27T12:00:00Z"
 *         checks:
 *           type: array
 *           description: List of individual health check results
 *           items:
 *             $ref: '#/components/schemas/HealthCheckResult'
 * /api/health:
 *   get:
 *     summary: Application Health Check
 *     description: >
 *       Performs comprehensive health checks of the application, including configuration validation
 *       and connectivity tests for all configured media servers. The response includes detailed
 *       status information for each component. Returns a 200 OK status if all critical checks pass,
 *       and a 503 Service Unavailable if any critical check fails. Some non-critical warnings
 *       (like having no media servers enabled) will not cause a 503 status.
 *     tags: ['Public API']
 *     responses:
 *       200:
 *         description: All systems are operational.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheckResponse'
 *       503:
 *         description: One or more systems are not operational.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheckResponse'
 */
// Health check routes (modularized)
app.use('/', require('./routes/health'));

// Device Profiles management routes
const createProfilesRouter = require('./routes/profiles');
app.use('/api/profiles', createProfilesRouter({ adminAuth, cacheManager }));

// Public configuration route (modularized)
const createConfigPublicRouter = require('./routes/config-public');
const profilesStore = require('./utils/profilesStore');
app.use(
    '/get-config',
    createConfigPublicRouter({
        config,
        validateGetConfigQuery,
        cacheMiddleware,
        isDebug,
        deviceStore,
        profilesStore,
    })
);

// Authentication routes (modularized)
const createAuthRouter = require('./routes/auth');
const authRouter = createAuthRouter({
    isAdminSetup,
    writeEnvFile,
    restartPM2ForEnvUpdate,
    getAssetVersions: () => getAssetVersions(__dirname),
    isDebug,
    ASSET_VERSION,
    isAuthenticated,
    authLimiter,
    asyncHandler,
    ApiError,
});
// Mount auth pages under /admin and API routes at root
app.use('/admin', authRouter);
app.use('/', authRouter);

// Device management routes (modularized, feature-flagged)
// Device management is always enabled.
// Bypass behavior is handled separately via IP allow list and client-side skip flows.
const deviceRegisterLimiter = createRateLimiter(
    60 * 1000,
    10,
    'Too many device registrations from this IP, please try again later.'
);
const devicePairClaimLimiter = createRateLimiter(
    60 * 1000,
    10,
    'Too many pairing attempts from this IP, please try again later.'
);

const createDevicesRouter = require('./routes/devices');
app.use(
    '/api/devices',
    createDevicesRouter({
        deviceStore,
        wsHub,
        adminAuth,
        adminAuthDevices,
        testSessionShim,
        deviceBypassMiddleware,
        deviceRegisterLimiter,
        devicePairClaimLimiter,
        asyncHandler,
        ApiError,
        logger,
        isDebug,
        config,
    })
);

// Media routes (modularized)
const createMediaRouter = require('./routes/media');
app.use(
    '/',
    createMediaRouter({
        config,
        logger,
        isDebug,
        fsp,
        fetch,
        ApiError,
        NotFoundError,
        asyncHandler,
        isAuthenticated,
        getPlexClient,
        processPlexItem,
        getPlexLibraries,
        shuffleArray,
        getPlaylistCache,
        isPlaylistRefreshing,
        getRefreshStartTime,
        resetRefreshState,
        refreshPlaylistCache,
        readConfig,
        cacheDiskManager,
        validateGetMediaQuery,
        validateMediaKeyParam,
        validateImageQuery,
        apiCacheMiddleware,
    })
);

// QR code generation route (modularized)
const createQRRouter = require('./routes/qr');
app.use('/', createQRRouter({ isAuthenticated }));

// Admin observable routes (logs, events/SSE, notifications, test utilities) - modularized
const createAdminObservableRouter = require('./routes/admin-observable');
const adminObservable = createAdminObservableRouter({
    isAuthenticated,
    asyncHandler,
    logger,
    broadcastAdminEvent: null, // Will be set after initialization
    sseDbg,
});
const { router: adminObservableRouter, adminSseClients, broadcastAdminEvent } = adminObservable;
// Store globally for backward compatibility with SSE broadcaster
global.adminSseClients = adminSseClients;
app.use('/', adminObservableRouter);

// Config backups routes (modularized)
const createConfigBackupsRouter = require('./routes/config-backups');
const configBackupsRouter = createConfigBackupsRouter({
    isAuthenticated,
    logger,
    CFG_FILES,
    cfgListBackups,
    cfgCreateBackup,
    cfgCleanupOld,
    cfgRestoreFile,
    cfgDeleteBackup,
    cfgUpdateBackupMeta,
    cfgReadSchedule,
    cfgWriteSchedule,
    broadcastAdminEvent,
});
app.use('/', configBackupsRouter);

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint (API alias)
 *     description: Backward-compatible alias that forwards to /health. See /health documentation for full details.
 *     tags: ['System']
 *     parameters:
 *       - in: query
 *         name: detailed
 *         schema:
 *           type: boolean
 *         description: Return detailed health information
 *     responses:
 *       200:
 *         description: Health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 */
app.get('/api/health', (req, res, next) => {
    // Re-use existing /health handler logic by forwarding internally
    req.url = '/health' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    req.originalUrl = '/health';
    app._router.handle(req, res, next);
});

// Compatibility endpoint: older cached clients may still probe this route.
// Posterrama now always serves static assets from public/.

/**
 * @swagger
 * /api/frontend/static-dir:
 *   get:
 *     summary: Get static assets mode (compatibility)
 *     description: Returns information about where Posterrama serves frontend static assets from.
 *     tags: ['Frontend']
 *     security: []
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Static asset configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mode:
 *                   type: string
 *                 publicDir:
 *                   type: string
 *                 staticPath:
 *                   type: string
 *                 assetVersion:
 *                   type: string
 *             example:
 *               mode: public
 *               publicDir: public
 *               staticPath: public
 *               assetVersion: "3.0.0"
 */
app.get('/api/frontend/static-dir', (req, res) => {
    res.json({
        mode: 'public',
        publicDir: 'public',
        staticPath: publicDir,
        assetVersion: ASSET_VERSION,
    });
});

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

/**
 * @swagger
 * /api/admin/restart-app:
 *   post:
 *     summary: Restart the Posterrama application
 *     description: >
 *       Triggers a safe application restart. When running under PM2, the process
 *       is restarted using PM2 with --update-env to ensure fresh environment variables.
 *       The endpoint responds immediately to avoid client timeouts while the process
 *       restarts in the background. The admin UI will poll /health until the server
 *       is back online.
 *     tags: ['Admin', 'Operations']
 *     responses:
 *       200:
 *         description: Restart initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 restarting:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Unauthorized (admin only)
 */
// @ts-ignore - Express router overload with middleware
app.post('/api/admin/restart-app', adminAuth, (req, res) => {
    try {
        // Respond immediately so the client can start polling /health
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, restarting: true });
    } catch (_) {
        // Even if response fails, still attempt restart below
    }

    // Defer actual restart a moment to allow response to flush
    setTimeout(() => {
        try {
            const name = (ecosystemConfig?.apps && ecosystemConfig.apps[0]?.name) || 'posterrama';
            const underPm2 = env.pm2.isEnabled();
            if (underPm2) {
                const cmd = `pm2 restart ${name} --update-env || pm2 start ecosystem.config.js`;
                exec(cmd, (err, stdout, stderr) => {
                    if (err) {
                        try {
                            logger.warn('[Admin Restart] PM2 command failed', {
                                error: err.message,
                                stdout: (stdout || '').slice(0, 500),
                                stderr: (stderr || '').slice(0, 500),
                            });
                        } catch (_) {
                            // best-effort logging
                        }
                        return;
                    }
                    try {
                        logger.info('[Admin Restart] Restart command issued via PM2');
                    } catch (_) {
                        // best-effort logging
                    }
                });
            } else {
                // Not under PM2: exit and rely on nodemon/systemd/supervisor to restart (or manual)
                try {
                    logger.info('[Admin Restart] Exiting process to trigger external restart');
                } catch (_) {
                    // best-effort logging
                }
                const timeoutConfig = require('./config/');
                setTimeout(
                    () => process.exit(0),
                    timeoutConfig.getTimeout('processGracefulShutdown')
                );
            }
        } catch (e) {
            try {
                logger.error('[Admin Restart] Unexpected failure', { error: e?.message });
            } catch (_) {
                // best-effort logging
            }
            if (!env.pm2.isEnabled()) {
                const timeoutConfig2 = require('./config/');
                setTimeout(
                    () => process.exit(0),
                    timeoutConfig2.getTimeout('processGracefulShutdown')
                );
            }
        }
    }, 200);
});

// === LOCAL DIRECTORY ROUTES ===
// Extracted to routes/local-directory.js
const createLocalDirectoryRouter = require('./routes/local-directory');
const localDirectoryRouter = createLocalDirectoryRouter({
    logger,
    config,
    express,
    asyncHandler,
    isAuthenticated,
    localDirectorySource,
    jobQueue,
    uploadMiddleware,
    cacheManager,
    refreshPlaylistCache,
    fs,
    path,
    getPlexClient,
    getJellyfinClient,
});
app.use('/', localDirectoryRouter);

// --- Device bypass status endpoint (public) ---
// Lightweight probe so clients can quickly decide to skip device management boot sequence.

// ============================================================================
// ADMIN API ENDPOINTS
// ============================================================================

/**
 * @swagger
 * /api/admin/jellyfin-libraries:
 *   post:
 *     summary: Fetch Jellyfin media libraries
 *     description: >
 *       Retrieves the list of media libraries from a Jellyfin server.
 *       Returns libraries with their types (movie, show, etc.).
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostname:
 *                 type: string
 *                 description: Jellyfin server hostname or IP address
 *               port:
 *                 type: number
 *                 description: Jellyfin server port
 *               apiKey:
 *                 type: string
 *                 description: Jellyfin API key
 *     responses:
 *       200:
 *         description: Libraries fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 libraries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *       400:
 *         description: Could not fetch libraries (e.g., incorrect credentials).
 */

/**
 * @swagger
 * /api/admin/test-tmdb:
 *   post:
 *     summary: Test TMDB API connection
 *     description: Tests the connection to TMDB API with provided credentials.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               apiKey:
 *                 type: string
 *                 description: TMDB API key
 *               category:
 *                 type: string
 *                 description: Content category to test
 *             required:
 *               - apiKey
 *     responses:
 *       200:
 *         description: TMDB connection test result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 error:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
app.post(
    '/api/admin/test-tmdb',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/test-tmdb.');

        const {
            apiKey: rawApiKey,
            category = 'popular',
            testType = 'normal',
            region = 'US',
        } = req.body;
        let apiKey = rawApiKey;

        // If apiKey is 'stored_key', use the stored API key from config
        if (apiKey === 'stored_key') {
            const currentConfig = await readConfig();
            if (currentConfig.tmdbSource && currentConfig.tmdbSource.apiKey) {
                apiKey = currentConfig.tmdbSource.apiKey;
                if (isDebug) logger.debug('[Admin API] Using stored TMDB API key for test.');
            } else {
                return res.json({
                    success: false,
                    error: 'No stored API key found. Please enter a new API key.',
                });
            }
        }

        if (!apiKey) {
            return res.json({ success: false, error: 'API key is required' });
        }

        try {
            // Create a temporary TMDB source for testing
            const testConfig = {
                apiKey: apiKey,
                category: category,
                enabled: true,
                name: testType === 'streaming' ? 'TMDB-Streaming-Test' : 'TMDB-Test',
            };

            const tmdbSource = new TMDBSource(testConfig, shuffleArray, isDebug);

            if (testType === 'streaming') {
                // Test streaming functionality
                try {
                    // Test streaming discover endpoint - build full URL manually
                    const baseUrl = 'https://api.themoviedb.org/3';
                    const testUrl = `${baseUrl}/discover/movie?api_key=${apiKey}&with_watch_providers=8&watch_region=${region}&page=1&sort_by=popularity.desc`;

                    const response = await fetch(testUrl);
                    if (!response.ok) {
                        throw new Error(`TMDB API responded with status ${response.status}`);
                    }

                    const data = await response.json();

                    res.json({
                        success: true,
                        message: `Streaming API test successful for region ${region}`,
                        region: region,
                        providersSupported: true,
                        totalResults: data.total_results || 0,
                    });
                } catch (error) {
                    res.json({
                        success: false,
                        error: `Streaming test failed: ${error.message}`,
                    });
                }
            } else {
                // Regular TMDB test
                const inferTypeFromCategory = cat => {
                    if (!cat) return 'movie';
                    const c = String(cat);
                    if (c.startsWith('tv_')) return 'tv';
                    if (c.includes('_tv')) return 'tv';
                    if (c === 'tv' || c === 'tv_latest') return 'tv';
                    return 'movie';
                };

                let mediaType = inferTypeFromCategory(category);
                let testItems = await tmdbSource.fetchMedia(mediaType, 5);

                // For trending_all_* categories, try the alternate type if nothing returned
                if (testItems.length === 0 && String(category).startsWith('trending_all_')) {
                    const altType = mediaType === 'movie' ? 'tv' : 'movie';
                    try {
                        testItems = await tmdbSource.fetchMedia(altType, 5);
                        if (testItems.length > 0) mediaType = altType;
                    } catch (_) {
                        // ignore and fall through to error handling
                    }
                }

                if (testItems.length > 0) {
                    const label = mediaType === 'tv' ? 'TV shows' : 'movies';
                    res.json({
                        success: true,
                        count: testItems.length,
                        message: `Successfully connected to TMDB and fetched ${category} ${label}`,
                    });
                } else {
                    const label = mediaType === 'tv' ? 'TV shows' : 'movies';
                    res.json({
                        success: false,
                        error: `Connected to TMDB but no ${label} found. Check your API key or category.`,
                    });
                }
            }
        } catch (error) {
            if (isDebug) logger.error('[Admin API] TMDB test failed:', error);
            res.json({
                success: false,
                error: error.message || 'Failed to connect to TMDB API',
            });
        }
    })
);

/**
 * @swagger
 * /api/admin/tmdb-genres:
 *   get:
 *     summary: Get available TMDB genres
 *     description: Fetches the list of available genres from TMDB API for filtering.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of TMDB genres.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 genres:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized
 */
app.get(
    '/api/admin/tmdb-genres',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/tmdb-genres.');

        const currentConfig = await readConfig();

        if (
            !currentConfig.tmdbSource ||
            !currentConfig.tmdbSource.enabled ||
            !currentConfig.tmdbSource.apiKey
        ) {
            return res.json({ genres: [] });
        }

        try {
            const tmdbSourceConfig = { ...currentConfig.tmdbSource, name: 'TMDB-Genres' };
            const tmdbSource = new TMDBSource(tmdbSourceConfig, shuffleArray, isDebug);
            const genres = await tmdbSource.getAvailableGenres();

            if (isDebug) logger.debug(`[Admin API] Found ${genres.length} TMDB genres.`);
            res.json({ genres: genres });
        } catch (error) {
            logger.error(`[Admin API] Failed to get TMDB genres: ${error.message}`);
            res.json({ genres: [], error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/admin/tmdb-genres-test:
 *   post:
 *     summary: Get TMDB genres for testing (with connection parameters)
 *     description: Retrieves all available genres from TMDB using provided API key.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               apiKey:
 *                 type: string
 *                 description: TMDB API key
 *               category:
 *                 type: string
 *                 description: TMDB category (popular, top_rated, etc.)
 *     responses:
 *       200:
 *         description: List of genres successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 genres:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 */
app.post(
    '/api/admin/tmdb-genres-test',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/tmdb-genres-test.');

        const { apiKey, category } = req.body;

        if (!apiKey) {
            throw new ApiError(400, 'API key is required for testing.');
        }

        try {
            // Create a temporary TMDB config for testing
            const testTMDBConfig = {
                name: 'TMDB-Test',
                enabled: true, // Temporarily enabled for testing
                apiKey,
                category: category || 'popular',
                movieCount: 50,
                showCount: 25,
                minRating: 0,
                yearFilter: null,
                genreFilter: '',
            };

            const tmdbSource = new TMDBSource(testTMDBConfig, shuffleArray, isDebug);
            const genres = await tmdbSource.getAvailableGenres();

            if (isDebug) logger.debug(`[Admin API] Found ${genres.length} genres from test TMDB.`);

            res.json({ genres: genres });
        } catch (error) {
            if (isDebug)
                logger.error('[Admin API] Error getting genres from test TMDB:', error.message);
            throw new ApiError(400, `Failed to get TMDB genres: ${error.message}`);
        }
    })
);

/**
 * @swagger
 * /api/admin/tmdb-total:
 *   get:
 *     summary: Get uncapped TMDB totals for current configuration
 *     description: Returns the approximate total number of movies and shows available from TMDB for the configured category/region (not limited to the 150 cached in the playlist).
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TMDB totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 movies:
 *                   type: number
 *                 shows:
 *                   type: number
 *                 total:
 *                   type: number
 *                 note:
 *                   type: string
 */
app.get(
    '/api/admin/tmdb-total',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const cfg = await readConfig();
        if (!cfg.tmdbSource || !cfg.tmdbSource.enabled || !cfg.tmdbSource.apiKey) {
            return res.json({ enabled: false, movies: 0, shows: 0, total: 0 });
        }

        // Brief in-memory cache to avoid rate limiting
        global.__tmdbTotalsCache = global.__tmdbTotalsCache || { ts: 0, value: null };
        const ttlMs = 5 * 60 * 1000; // 5 minutes
        if (global.__tmdbTotalsCache.value && Date.now() - global.__tmdbTotalsCache.ts < ttlMs) {
            return res.json(global.__tmdbTotalsCache.value);
        }

        const tmdbSource = new TMDBSource(
            { ...cfg.tmdbSource, name: 'TMDB-Totals' },
            shuffleArray,
            isDebug
        );
        const category = (cfg.tmdbSource.category || '').toString();
        // Helper to ask TMDB for first page and read total_results; fall back to 0/unknown
        const fetchTotalFor = async type => {
            try {
                let endpoint;
                if (category.startsWith('trending_')) {
                    // trending_{all|movie|tv}_{day|week}
                    const parts = category.split('_');
                    const timeWindow = parts[2] || 'day';
                    const mediaType = type === 'tv' ? 'tv' : type === 'movie' ? 'movie' : 'all';
                    endpoint = `/trending/${mediaType}/${timeWindow}?page=1`;
                } else {
                    endpoint = tmdbSource.getEndpoint(type, 1);
                }
                // Some categories like 'latest' return a single object and no totals
                const url = `${tmdbSource.baseUrl}${endpoint}&api_key=${cfg.tmdbSource.apiKey}`;
                const data = await tmdbSource.cachedApiRequest(url);
                const total = typeof data?.total_results === 'number' ? data.total_results : null;
                if (total == null) {
                    // Heuristic: for latest endpoints, return 1; otherwise 0
                    if (endpoint.includes('/latest')) return 1;
                    return 0;
                }
                return total;
            } catch (e) {
                if (isDebug)
                    logger.debug('[Admin API] TMDB totals fetch failed', {
                        error: e?.message,
                        type,
                    });
                return 0;
            }
        };

        // For trending_all_<window>, compute movie+tv separately
        const cat = category;
        let movies = 0;
        let shows = 0;
        if (cat.startsWith('trending_all')) {
            movies = await fetchTotalFor('movie');
            shows = await fetchTotalFor('tv');
        } else if (cat.startsWith('tv_')) {
            shows = await fetchTotalFor('tv');
            movies = 0;
        } else if (cat === 'tv' || cat === 'tv') {
            shows = await fetchTotalFor('tv');
            movies = 0;
        } else if (cat.startsWith('discover_tv')) {
            shows = await fetchTotalFor('tv');
            movies = 0;
        } else if (cat.startsWith('discover_movie')) {
            movies = await fetchTotalFor('movie');
            shows = 0;
        } else {
            // Default: compute both movie and tv totals
            [movies, shows] = await Promise.all([fetchTotalFor('movie'), fetchTotalFor('tv')]);
        }

        const value = {
            enabled: true,
            movies,
            shows,
            total: (Number(movies) || 0) + (Number(shows) || 0),
            note: 'Totals reflect TMDB API total_results and may be capped by TMDB pagination limits.',
        };
        global.__tmdbTotalsCache = { ts: Date.now(), value };
        res.json(value);
    })
);

//

/**
 * @swagger
 * /api/admin/tmdb-cache-stats:
 *   get:
 *     summary: Get TMDB cache statistics
 *     description: Returns cache statistics for debugging TMDB performance.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TMDB cache statistics.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cacheStats:
 *                   type: object
 *                 enabled:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 */
app.get(
    '/api/admin/tmdb-cache-stats',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/tmdb-cache-stats.');

        if (global.tmdbSourceInstance) {
            const stats = global.tmdbSourceInstance.getCacheStats();
            res.json({
                enabled: true,
                cacheStats: stats,
            });
        } else {
            res.json({
                enabled: false,
                message: 'TMDB source not initialized',
            });
        }
    })
);

//

/**
 * @swagger
 * /api/admin/change-password:
 *   post:
 *     summary: Change the admin password
 *     description: Allows the user to change their own admin password.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password successfully changed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Required fields missing or new passwords do not match.
 *       401:
 *         description: Current password is incorrect.
 */
app.post(
    '/api/admin/change-password',
    authLimiter,
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to change password.');
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            if (isDebug) logger.debug('[Admin API] Password change failed: missing fields.');
            throw new ApiError(400, 'All password fields are required.');
        }

        if (newPassword !== confirmPassword) {
            if (isDebug)
                logger.debug('[Admin API] Password change failed: new passwords do not match.');
            throw new ApiError(400, 'New password and confirmation do not match.');
        }

        if (newPassword.length < 8) {
            if (isDebug)
                logger.debug('[Admin API] Password change failed: new password too short.');
            throw new ApiError(400, 'New password must be at least 8 characters long.');
        }

        const isValidPassword = await bcrypt.compare(currentPassword, env.auth.adminPasswordHash);
        if (!isValidPassword) {
            if (isDebug)
                logger.debug('[Admin API] Password change failed: incorrect current password.');
            throw new ApiError(401, 'Incorrect current password.');
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await writeEnvFile({ ADMIN_PASSWORD_HASH: newPasswordHash });

        // Update in-memory cache immediately - no restart needed
        process.env.ADMIN_PASSWORD_HASH = newPasswordHash;
        // Also update the env module cache
        const envModule = require('./config/environment');
        if (envModule && envModule.auth) {
            envModule.auth.adminPasswordHash = newPasswordHash;
        }

        if (isDebug)
            logger.debug(
                '[Admin API] Password changed successfully (no restart required). Invalidating current session for security.'
            );

        // For security, destroy the current session after a password change,
        // forcing the user to log in again with their new credentials.
        const session = /** @type {any} */ (req).session;
        session?.destroy(err => {
            if (err) {
                if (isDebug)
                    logger.error(
                        '[Admin API] Error destroying session after password change:',
                        err
                    );
                // Even if session destruction fails, the password change was successful.
                // We proceed but log the error.
            }
            res.json({
                message:
                    'Password changed successfully. You have been logged out for security and will need to log in again.',
            });
        });
    })
);

/**
 * @swagger
 * /api/admin/restart-app:
 *   post:
 *     summary: Restart the application
 *     description: >
 *       Sends a command to PM2 to restart the application.
 *       This is useful after modifying critical settings such as the port.
 *       The API responds immediately with a 202 Accepted status.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Restart command received and is being processed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 */
app.post(
    '/api/admin/restart-app',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to restart the application.');

        const appName = ecosystemConfig.apps[0].name || 'posterrama';
        if (isDebug) logger.debug(`[Admin API] Determined app name for PM2: "${appName}"`);

        // Immediately send a response to the client to avoid a race condition.
        // We use 202 Accepted, as the server has accepted the request but the action is pending.
        res.status(202).json({
            success: true,
            message: 'Restart command received. The application is now restarting.',
        });

        // Execute the restart command after a short delay to ensure the HTTP response has been sent.
        setTimeout(() => {
            if (isDebug) logger.debug(`[Admin API] Executing command: "pm2 restart ${appName}"`);
            exec(`pm2 restart ${appName}`, (error, stdout, stderr) => {
                // We can't send a response here, but we can log the outcome for debugging.
                if (error) {
                    logger.error(`[Admin API] PM2 restart command failed after response was sent.`);
                    logger.error(`[Admin API] Error: ${error.message}`);
                    if (stderr) logger.error(`[Admin API] PM2 stderr: ${stderr}`);
                    return;
                }
                if (isDebug)
                    logger.debug(
                        `[Admin API] PM2 restart command issued successfully for '${appName}'.`
                    );
            });
        }, 100); // 100ms delay should be sufficient.
    })
);

/**
 * @swagger
 * /api/admin/status:
 *   get:
 *     summary: Get system status information
 *     description: >
 *       Returns comprehensive system status including application, database, cache,
 *       disk space, memory usage, and uptime information.
 *     tags: ['Admin']
 *     responses:
 *       200:
 *         description: System status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 app:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "running"
 *                 database:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "connected"
 *                 cache:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "active"
 *                 uptime:
 *                   type: string
 *                   example: "2d 5h"
 *                 uptimeSeconds:
 *                   type: integer
 *                   example: 183600
 */
app.get(
    '/api/admin/status',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const os = require('os');
            const uptime = process.uptime();
            const uptimeSeconds = Math.max(0, Math.floor(Number(uptime) || 0));
            const days = Math.floor(uptimeSeconds / 86400);
            const hours = Math.floor((uptimeSeconds % 86400) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const uptimeString =
                days > 0
                    ? `${days}d ${hours}h`
                    : hours > 0
                      ? `${hours}h ${minutes}m`
                      : `${minutes}m`;

            // Check database connection (file system access)
            let databaseStatus = 'disconnected';
            try {
                await fsp.access(path.join(__dirname, 'sessions'), fs.constants.F_OK);
                databaseStatus = 'connected';
            } catch (e) {
                databaseStatus = 'error';
            }

            // Check cache status
            let cacheStatus = 'inactive';
            try {
                // Check if cache directory exists and is accessible
                const cacheDir = path.join(__dirname, 'cache');
                const imageCacheDir = path.join(__dirname, 'image_cache');

                await fsp.access(cacheDir, fs.constants.F_OK);
                await fsp.access(imageCacheDir, fs.constants.F_OK);

                // Check if cache manager is available
                if (cacheManager && typeof cacheManager.get === 'function') {
                    cacheStatus = 'active';
                }
            } catch (e) {
                cacheStatus = 'error';
            }

            // Get memory info (system-wide)
            const totalMem = os.totalmem(); // bytes
            const freeMem = os.freemem(); // bytes
            const usedMem = totalMem - freeMem; // bytes
            const memUsage = Math.round((usedMem / totalMem) * 100); // percent integer
            const toGB = b => b / 1024 ** 3;

            // Get disk space
            let diskUsage = { available: 'Unknown', status: 'info' };
            try {
                const stats = await fsp.statfs(__dirname);
                const totalSpace = stats.bavail * stats.bsize;
                const totalSpaceGB = (totalSpace / 1024 ** 3).toFixed(1);
                const totalSpaceNum = parseFloat(totalSpaceGB);
                diskUsage = {
                    available: `${totalSpaceGB} GB available`,
                    status: totalSpaceNum > 5 ? 'success' : totalSpaceNum > 1 ? 'warning' : 'error',
                };
            } catch (e) {
                // Fallback if statfs is not available
                diskUsage = { available: 'Cannot determine', status: 'warning' };
            }

            const statusData = {
                app: { status: 'running' },
                database: { status: databaseStatus },
                cache: { status: cacheStatus },
                disk: diskUsage,
                memory: {
                    usage: `${memUsage}%`, // deprecated: prefer percent
                    percent: memUsage,
                    totalBytes: totalMem,
                    usedBytes: usedMem,
                    freeBytes: freeMem,
                    totalGB: Number(toGB(totalMem).toFixed(1)),
                    usedGB:
                        usedMem < 1024 * 1024 * 1024
                            ? Math.round(usedMem / (1024 * 1024))
                            : Number(toGB(usedMem).toFixed(1)),
                    freeGB: Number(toGB(freeMem).toFixed(1)),
                    status: memUsage > 90 ? 'error' : memUsage > 70 ? 'warning' : 'success',
                },
                uptime: uptimeString,
                uptimeSeconds: uptimeSeconds,
            };

            res.json(statusData);
        } catch (error) {
            logger.error('[Admin API] Error getting system status:', error);
            res.status(500).json({ error: 'Failed to get system status' });
        }
    })
);

/**
 * @swagger
 * /api/admin/version:
 *   get:
 *     summary: Get current application version
 *     description: Returns the current version of the application from package.json
 *     tags: ['Admin']
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current version retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   example: "3.0.0"
 *       401:
 *         description: Unauthorized
 */
app.get(
    '/api/admin/version',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            // Read current version from package.json
            const packagePath = path.join(__dirname, 'package.json');
            const packageData = JSON.parse(await fsp.readFile(packagePath, 'utf8'));
            const version = packageData.version || 'Unknown';

            res.json({ version });
        } catch (error) {
            logger.error('Failed to read version', { error: error.message });
            res.json({ version: 'Unknown' });
        }
    })
);

/**
 * @swagger
 * /api/admin/update-check:
 *   get:
 *     summary: Check for application updates
 *     description: >
 *       Checks the current version against the latest GitHub release
 *       and determines if an update is available. Returns detailed
 *       version information and release notes.
 *     tags: ['Auto-Update']
 *     responses:
 *       200:
 *         description: Update check completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentVersion:
 *                   type: string
 *                   example: "3.0.0"
 *                 latestVersion:
 *                   type: string
 *                   example: "3.0.0"
 *                 hasUpdate:
 *                   type: boolean
 *                   example: true
 *                 updateType:
 *                   type: string
 *                   example: "minor"
 *                 releaseUrl:
 *                   type: string
 *                   example: "https://github.com/Posterrama/posterrama/releases/tag/v3.0.0"
 *                 downloadUrl:
 *                   type: string
 *                   example: "https://github.com/Posterrama/posterrama/archive/v3.0.0.tar.gz"
 *                 releaseNotes:
 *                   type: string
 *                   example: "### New Features\n- Added GitHub integration"
 *                 publishedAt:
 *                   type: string
 *                   example: "2025-08-15T20:00:00Z"
 *                 releaseName:
 *                   type: string
 *                   example: "Version 3.0.0"
 */
app.get(
    '/api/admin/update-check',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            // Read current version from package.json
            const packagePath = path.join(__dirname, 'package.json');
            let currentVersion = 'Unknown';

            try {
                const packageData = JSON.parse(await fsp.readFile(packagePath, 'utf8'));
                currentVersion = packageData.version || 'Unknown';
            } catch (e) {
                logger.warn('Could not read package.json for version info', { error: e.message });
            }

            // Check for updates using GitHub service
            const updateInfo = await githubService.checkForUpdates(currentVersion);

            if (isDebug) {
                logger.debug('[Admin API] Update check completed:', {
                    current: updateInfo.currentVersion,
                    latest: updateInfo.latestVersion,
                    hasUpdate: updateInfo.hasUpdate,
                    updateType: updateInfo.updateType,
                });
            }

            res.json(updateInfo);
        } catch (error) {
            logger.error('Failed to check for updates', { error: error.message });

            // Fallback response when GitHub is unavailable
            try {
                const packagePath = path.join(__dirname, 'package.json');
                const packageData = JSON.parse(await fsp.readFile(packagePath, 'utf8'));
                const currentVersion = packageData.version || 'Unknown';

                res.json({
                    currentVersion,
                    latestVersion: currentVersion,
                    hasUpdate: false,
                    updateType: null,
                    releaseUrl: null,
                    downloadUrl: null,
                    releaseNotes: null,
                    publishedAt: null,
                    releaseName: null,
                    error: 'Could not connect to GitHub to check for updates',
                });
            } catch (fallbackError) {
                res.status(500).json({
                    error: 'Failed to check for updates and could not read current version',
                });
            }
        }
    })
);

/**
 * @swagger
 * /api/admin/github/releases:
 *   get:
 *     summary: Get recent GitHub releases
 *     description: >
 *       Fetches recent releases from the GitHub repository.
 *       Useful for displaying a changelog or release history.
 *     tags: ['GitHub Integration']
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *           minimum: 1
 *           maximum: 20
 *         description: Maximum number of releases to fetch
 *     responses:
 *       200:
 *         description: List of recent releases
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   tag_name:
 *                     type: string
 *                   name:
 *                     type: string
 *                   body:
 *                     type: string
 *                   published_at:
 *                     type: string
 *                   html_url:
 *                     type: string
 */
app.get(
    '/api/admin/github/releases',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const limitRaw = req.query.limit;
            const limitStr = Array.isArray(limitRaw)
                ? String(limitRaw[0] ?? '')
                : String(limitRaw ?? '');
            const limit = Math.min(Math.max(parseInt(limitStr, 10) || 5, 1), 20);
            const releases = await githubService.getReleases(limit);

            // Return simplified release data
            const simplifiedReleases = releases.map(release => ({
                tagName: release.tag_name,
                name: release.name || release.tag_name,
                body: release.body || '',
                publishedAt: release.published_at,
                url: release.html_url,
                prerelease: release.prerelease,
                draft: release.draft,
            }));

            res.json(simplifiedReleases);
        } catch (error) {
            logger.error('Failed to fetch GitHub releases', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch releases from GitHub' });
        }
    })
);

/**
 * @swagger
 * /api/admin/github/repository:
 *   get:
 *     summary: Get repository information
 *     description: >
 *       Fetches general information about the GitHub repository,
 *       including stars, forks, and other metadata.
 *     tags: ['GitHub Integration']
 *     responses:
 *       200:
 *         description: Repository information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 fullName:
 *                   type: string
 *                 description:
 *                   type: string
 *                 url:
 *                   type: string
 *                 stars:
 *                   type: integer
 *                 forks:
 *                   type: integer
 *                 issues:
 *                   type: integer
 *                 language:
 *                   type: string
 *                 license:
 *                   type: string
 */
app.get(
    '/api/admin/github/repository',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const repoInfo = await githubService.getRepositoryInfo();
            res.json(repoInfo);
        } catch (error) {
            logger.error('Failed to fetch repository information', { error: error.message });
            res.status(500).json({ error: 'Failed to fetch repository information from GitHub' });
        }
    })
);

/**
 * @swagger
 * /api/admin/github/clear-cache:
 *   post:
 *     summary: Clear GitHub API cache
 *     description: >
 *       Clears the internal cache for GitHub API responses.
 *       This forces fresh data to be fetched on the next request.
 *     tags: ['GitHub Integration']
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "GitHub cache cleared successfully"
 */
app.post(
    '/api/admin/github/clear-cache',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            githubService.clearCache();
            logger.info('GitHub API cache cleared by admin user');
            res.json({ message: 'GitHub cache cleared successfully' });
        } catch (error) {
            logger.error('Failed to clear GitHub cache', { error: error.message });
            res.status(500).json({ error: 'Failed to clear GitHub cache' });
        }
    })
);

/**
 * @swagger
 * /api/admin/update/start:
 *   post:
 *     summary: Start automatic update process
 *     description: >
 *       Initiates the automatic update process. This will download the latest
 *       version, create a backup, and update the application. The process
 *       includes rollback capability in case of failure.
 *     tags: ['Auto-Update']
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               version:
 *                 type: string
 *                 description: Specific version to update to (optional)
 *                 example: "3.0.0"
 *               force:
 *                 type: boolean
 *                 description: Force update even if already on latest version
 *                 default: false
 *               dryRun:
 *                 type: boolean
 *                 description: Simulate update phases without changing files or services
 *                 default: false
 *     responses:
 *       200:
 *         description: Update process started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 updateId:
 *                   type: string
 *       400:
 *         description: Update already in progress or invalid request
 *       500:
 *         description: Failed to start update process
 */
app.post(
    '/api/admin/update/start',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        try {
            // Accept both `version` and legacy `targetVersion` from the frontend
            const requestedVersion = req.body?.version || req.body?.targetVersion || null;
            const { force, dryRun = false } = req.body || {};

            if (autoUpdater.isUpdating()) {
                return res.status(400).json({ error: 'Update already in progress' });
            }

            logger.info('Update process initiated by admin', {
                version: requestedVersion,
                force,
                user: /** @type {any} */ (req).user?.username,
            });

            // Prepare runner details
            const path = require('path');
            const runner = path.resolve(__dirname, 'utils', 'update-runner.js');
            const appRoot = path.resolve(__dirname);

            // Start updater via a detached Node process first to avoid PM2 side-effects
            try {
                const { spawn } = require('child_process');
                const underPM2 = env.pm2.isEnabled();
                const args = [
                    runner,
                    requestedVersion ? '--version' : '',
                    requestedVersion ? String(requestedVersion) : '',
                    dryRun ? '--dry-run' : '',
                    force ? '--force' : '',
                    underPM2 ? '--defer-stop' : '',
                ].filter(Boolean);
                const child = spawn(process.execPath, args, {
                    cwd: appRoot,
                    detached: true,
                    stdio: 'ignore',
                });
                child.unref();
                logger.info('Updater process started via detached spawn', {
                    runner,
                    requestedVersion,
                    dryRun,
                    force,
                    deferStop: underPM2,
                });
            } catch (spawnError) {
                logger.error('Failed to start updater process (detached spawn)', {
                    error: spawnError.message,
                });
                return res.status(500).json({ error: 'Failed to start updater process' });
            }

            // Respond immediately so the client isn't impacted when services stop
            res.json({
                success: true,
                message: dryRun ? 'Dry-run update started' : 'Update process started',
                updateId: Date.now().toString(),
            });
        } catch (error) {
            logger.error('Failed to start update process', { error: error.message });
            res.status(500).json({ error: 'Failed to start update process' });
        }
    })
);

/**
 * @swagger
 * /api/admin/update/status:
 *   get:
 *     summary: Get update process status
 *     description: >
 *       Returns the current status of any ongoing update process,
 *       including progress, current phase, and any errors.
 *     tags: ['Auto-Update']
 *     responses:
 *       200:
 *         description: Update status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 phase:
 *                   type: string
 *                   enum: [idle, checking, backup, download, validation, stopping, applying, dependencies, starting, verification, completed, error, rollback]
 *                 progress:
 *                   type: integer
 *                   minimum: 0
 *                   maximum: 100
 *                 message:
 *                   type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 startTime:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 backupPath:
 *                   type: string
 *                   nullable: true
 *                 isUpdating:
 *                   type: boolean
 */
app.get(
    '/api/admin/update/status',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            let status = autoUpdater.getStatus();
            let isUpdating = autoUpdater.isUpdating();

            // If not actively updating in this process, try to read the last known status
            if (!isUpdating) {
                const path = require('path');
                const fsp = require('fs').promises;
                const statusFile = path.resolve(__dirname, 'logs', 'updater-status.json');
                try {
                    const st = await fsp.stat(statusFile).catch(() => null);
                    if (st && st.isFile()) {
                        const parsed = JSON.parse(await fsp.readFile(statusFile, 'utf8'));
                        status = {
                            phase: parsed.phase || status.phase,
                            progress: parsed.progress ?? status.progress,
                            message: parsed.message || status.message,
                            error: parsed.error || null,
                            startTime: parsed.startTime || null,
                            backupPath: parsed.backupPath || null,
                        };

                        // Special case: if status is stuck at 'restarting' but the app is clearly up,
                        // normalize it to completed so the UI doesn’t hang.
                        if (parsed.phase === 'restarting') {
                            const uptimeSec = Math.floor(process.uptime());
                            if (uptimeSec >= 5) {
                                status.phase = 'completed';
                                status.progress = 100;
                                status.message = parsed.message || 'Restart complete';
                                isUpdating = false;
                                // Best-effort: persist the normalized state
                                try {
                                    const normalized = {
                                        ...parsed,
                                        phase: 'completed',
                                        progress: 100,
                                        message: status.message,
                                        ts: new Date().toISOString(),
                                    };
                                    await fsp.writeFile(statusFile, JSON.stringify(normalized));
                                } catch (_e) {
                                    // ignore
                                }
                            } else {
                                isUpdating = true;
                            }
                        } else {
                            isUpdating =
                                parsed.phase &&
                                !['idle', 'completed', 'error'].includes(parsed.phase);
                        }
                    }
                } catch (_e) {
                    // ignore
                }
            }

            res.json({ ...status, isUpdating });
        } catch (error) {
            logger.error('Failed to get update status', { error: error.message });
            res.status(500).json({ error: 'Failed to get update status' });
        }
    })
);

/**
 * @swagger
 * /api/admin/update/rollback:
 *   post:
 *     summary: Rollback to previous version
 *     description: >
 *       Rollback to the most recent backup created during an update.
 *       This is useful if an update causes issues.
 *     tags: ['Auto-Update']
 *     responses:
 *       200:
 *         description: Rollback completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: No backup available for rollback
 *       500:
 *         description: Rollback failed
 */
app.post(
    '/api/admin/update/rollback',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            if (autoUpdater.isUpdating()) {
                return res
                    .status(400)
                    .json({ error: 'Cannot rollback while update is in progress' });
            }

            logger.info('Rollback initiated by admin', {
                user: /** @type {any} */ (req).user?.username,
            });

            await autoUpdater.rollback();

            res.json({
                success: true,
                message: 'Rollback completed successfully',
            });
        } catch (error) {
            logger.error('Failed to rollback', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/admin/update/backups:
 *   get:
 *     summary: List available backups
 *     description: >
 *       Returns a list of all available backups that can be used
 *       for rollback or manual restoration.
 *     tags: ['Auto-Update']
 *     responses:
 *       200:
 *         description: List of available backups
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   version:
 *                     type: string
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *                   size:
 *                     type: integer
 *                   created:
 *                     type: string
 *                     format: date-time
 */
app.get(
    '/api/admin/update/backups',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const backups = await autoUpdater.listBackups();
            res.json(backups);
        } catch (error) {
            logger.error('Failed to list backups', { error: error.message });
            res.status(500).json({ error: 'Failed to list backups' });
        }
    })
);

/**
 * @swagger
 * /api/admin/update/cleanup:
 *   post:
 *     summary: Cleanup old backups
 *     description: >
 *       Remove old backups to free up disk space, keeping only
 *       the most recent backups as specified.
 *     tags: ['Auto-Update']
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keepCount:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 20
 *                 default: 5
 *                 description: Number of recent backups to keep
 *     responses:
 *       200:
 *         description: Cleanup completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: integer
 *                 kept:
 *                   type: integer
 *                 message:
 *                   type: string
 */
app.post(
    '/api/admin/update/cleanup',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        try {
            const { keepCount = 5 } = req.body;

            if (keepCount < 1 || keepCount > 20) {
                return res.status(400).json({ error: 'keepCount must be between 1 and 20' });
            }

            logger.info('Backup cleanup initiated by admin', {
                keepCount,
                user: /** @type {any} */ (req).user?.username,
            });

            const result = await autoUpdater.cleanupOldBackups(keepCount);

            res.json({
                ...result,
                message: `Deleted ${result.deleted} old backups, kept ${result.kept} recent backups`,
            });
        } catch (error) {
            logger.error('Failed to cleanup backups', { error: error.message });
            res.status(500).json({ error: 'Failed to cleanup backups' });
        }
    })
);

/**
 * @swagger
 * /api/admin/performance:
 *   get:
 *     summary: Get system performance metrics
 *     description: >
 *       Returns real-time system performance data including CPU usage,
 *       memory usage, disk usage, and load average.
 *     tags: ['Admin']
 *     responses:
 *       200:
 *         description: Performance metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cpu:
 *                   type: object
 *                   properties:
 *                     usage:
 *                       type: number
 *                       example: 45.2
 *                     loadAverage:
 *                       type: string
 *                       example: "0.75, 0.82, 0.90"
 *                 memory:
 *                   type: object
 *                   properties:
 *                     usage:
 *                       type: number
 *                       example: 68.5
 *                     used:
 *                       type: string
 *                       example: "2.1 GB"
 *                     total:
 *                       type: string
 *                       example: "3.1 GB"
 */
app.get(
    '/api/admin/performance',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const os = require('os');
            // Prefer sampled CPU metrics from metricsManager for better parity with OS tools
            const sysMetrics = metricsManager.getSystemMetrics();
            // Backward compatible "usage" remains the overall system CPU percent
            const cpuUsage = Math.max(
                0,
                Math.min(
                    100,
                    Math.round(Number(sysMetrics?.cpu?.percent ?? sysMetrics?.cpu?.usage ?? 0))
                )
            );
            const systemPercent = Math.max(
                0,
                Math.min(100, Math.round(Number(sysMetrics?.cpu?.system ?? cpuUsage)))
            );
            const processPercent = Math.max(
                0,
                Math.min(100, Math.round(Number(sysMetrics?.cpu?.process ?? 0)))
            );

            // Load average
            const loadAverage = os
                .loadavg()
                .map(load => load.toFixed(2))
                .join(', ');

            // Memory information
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memUsage = Math.round((usedMem / totalMem) * 100);

            const formatBytes = bytes => {
                if (bytes === 0) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
            };

            // Disk information (basic)
            let diskUsage = { usage: 0, used: '0 GB', total: '0 GB' };
            try {
                const stats = await fsp.statfs(__dirname);
                const totalSpace = stats.blocks * stats.bsize;
                const freeSpace = stats.bavail * stats.bsize;
                const usedSpace = totalSpace - freeSpace;
                const diskUsagePercent = Math.round((usedSpace / totalSpace) * 100);

                diskUsage = {
                    usage: diskUsagePercent,
                    used: formatBytes(usedSpace),
                    total: formatBytes(totalSpace),
                };
            } catch (e) {
                logger.warn('[Admin API] Could not get disk stats:', e.message);
            }

            // Uptime
            const uptime = process.uptime();
            const uptimeSeconds = Math.max(0, Math.floor(Number(uptime) || 0));
            const days = Math.floor(uptimeSeconds / 86400);
            const hours = Math.floor((uptimeSeconds % 86400) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const uptimeString =
                days > 0
                    ? `${days}d ${hours}h`
                    : hours > 0
                      ? `${hours}h ${minutes}m`
                      : `${minutes}m`;

            const performanceData = {
                cpu: {
                    usage: systemPercent,
                    percent: systemPercent,
                    system: systemPercent,
                    process: processPercent,
                    loadAverage: loadAverage,
                },
                memory: {
                    usage: memUsage,
                    used: formatBytes(usedMem),
                    total: formatBytes(totalMem),
                },
                disk: diskUsage,
                uptime: uptimeString,
                uptimeSeconds: uptimeSeconds,
            };

            res.json(performanceData);
        } catch (error) {
            logger.error('[Admin API] Error getting performance metrics:', error);
            res.status(500).json({ error: 'Failed to get performance metrics' });
        }
    })
);

/**
 * @swagger
 * /api/admin/refresh-media:
 *   post:
 *     summary: Force an immediate refresh of the media playlist
 *     description: >
 *       Manually starts the process to fetch media from all configured servers.
 *       This is an asynchronous operation. The API responds when the refresh is complete.
 *       This endpoint is secured and requires an active admin session.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The playlist has been successfully refreshed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RefreshMediaResponse'
 */
app.post(
    '/api/admin/refresh-media',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to force-refresh media playlist.');

        // Clear media cache before refreshing
        const cleared = cacheManager.clear('media');
        logger.info('Media cache cleared before refresh', { cleared });

        // Force reset any stuck refresh state before starting
        if (isPlaylistRefreshing()) {
            logger.warn('Admin refresh: Force-clearing stuck refresh state', {
                action: 'admin_force_clear_refresh',
                stuckDuration: getRefreshStartTime()
                    ? `${Date.now() - getRefreshStartTime()}ms`
                    : 'unknown',
            });
            resetRefreshState();
        }

        // The refreshPlaylistCache function already has a lock (isRefreshing)
        // so we can call it directly. We'll await it to give feedback to the user.
        await refreshPlaylistCache();

        const { cache: playlistCache } = getPlaylistCache();
        const itemCount = playlistCache ? playlistCache.length : 0;
        const message = `Media playlist successfully refreshed. ${itemCount} items found. Cache cleared: ${cleared} entries.`;
        if (isDebug) logger.debug(`[Admin API] ${message}`);

        res.json({ success: true, message: message, itemCount: itemCount, cacheCleared: cleared });
    })
);

/**
 * @swagger
 * /api/admin/mqtt/generate-dashboard:
 *   post:
 *     summary: Generate Home Assistant dashboard YAML
 *     description: Generates a Lovelace dashboard configuration for selected devices
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of device IDs to include
 *               includeSystemOverview:
 *                 type: boolean
 *                 default: true
 *               includeQuickActions:
 *                 type: boolean
 *                 default: true
 *               includeMobileView:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Dashboard YAML generated successfully
 */
app.post(
    '/api/admin/mqtt/generate-dashboard',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const { deviceIds = [], ...options } = req.body;

        logger.info('[Admin] Generating HA dashboard', {
            deviceCount: deviceIds.length,
            options,
        });

        // Get selected devices
        const allDevices = await deviceStore.getAll();
        const selectedDevices = allDevices.filter(d => deviceIds.includes(d.id));

        const generator = require('./utils/haDashboardGenerator');
        const yaml = generator.generateDashboard(selectedDevices, options);
        const info = generator.getPreviewInfo(selectedDevices);

        res.json({
            success: true,
            yaml,
            info,
            deviceCount: selectedDevices.length,
        });
    })
);

/**
 * @swagger
 * /api/admin/mqtt/republish:
 *   post:
 *     summary: Republish MQTT discovery for all devices
 *     description: Forces republishing of Home Assistant MQTT discovery for all registered devices
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MQTT discovery republished successfully
 *       503:
 *         description: MQTT bridge not available
 */
app.post(
    '/api/admin/mqtt/republish',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to republish MQTT discovery.');

        const mqttBridge = global.__posterramaMqttBridge;
        if (!mqttBridge) {
            return res.status(503).json({
                success: false,
                message: 'MQTT bridge is not enabled or not connected',
            });
        }

        const devices = await deviceStore.getAll();
        logger.info('[Admin] Republishing MQTT discovery for all devices', {
            deviceCount: devices.length,
        });

        let successCount = 0;
        let failCount = 0;

        for (const device of devices) {
            try {
                // Unpublish all capabilities first to clean up old entities
                await mqttBridge.unpublishAllCapabilities(device);

                // Republish discovery with current mode's available capabilities
                await mqttBridge.republishDiscovery(device);

                // Clear state cache to force republish
                mqttBridge.deviceStates?.delete(device.id);

                // Set current mode in tracking
                const currentMode =
                    device.clientInfo?.mode || device.currentState?.mode || 'screensaver';
                mqttBridge.deviceModes?.set(device.id, currentMode);

                // Publish current state immediately
                await mqttBridge.publishDeviceState(device);
                await mqttBridge.publishCameraState(device);
                successCount++;
            } catch (err) {
                logger.warn('[Admin] Failed to republish MQTT discovery for device', {
                    deviceId: device.id,
                    deviceName: device.name,
                    error: err.message,
                });
                failCount++;
            }
        }

        const message = `MQTT discovery republished: ${successCount} succeeded, ${failCount} failed`;
        logger.info('[Admin] ' + message);

        res.json({
            success: true,
            message,
            successCount,
            failCount,
            totalDevices: devices.length,
        });
    })
);

/**
 * @swagger
 * /api/admin/mqtt/test-connection:
 *   post:
 *     summary: Test connection to an MQTT broker
 *     description: Attempts a short-lived connection to the broker using the provided settings (does not persist settings and does not require restart).
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               broker:
 *                 type: object
 *                 properties:
 *                   host:
 *                     type: string
 *                   port:
 *                     type: integer
 *                   username:
 *                     type: string
 *                   password:
 *                     type: string
 *     responses:
 *       200:
 *         description: Connection successful
 *       400:
 *         description: Invalid input
 *       502:
 *         description: Broker unreachable / connection failed
 */
app.post(
    '/api/admin/mqtt/test-connection',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        const broker = (req.body && req.body.broker) || {};
        const hostInput = String(broker.host || '').trim();
        const portInput = Number(broker.port || 1883);
        const username =
            broker.username != null && String(broker.username).trim()
                ? String(broker.username).trim()
                : null;
        const password =
            broker.password != null && String(broker.password) ? String(broker.password) : null;
        let passwordEnvVar =
            broker.passwordEnvVar != null && String(broker.passwordEnvVar).trim()
                ? String(broker.passwordEnvVar).trim()
                : null;

        if (!hostInput) {
            return res.status(400).json({
                success: false,
                message: 'Missing broker host',
            });
        }

        if (!Number.isFinite(portInput) || portInput < 1 || portInput > 65535) {
            return res.status(400).json({
                success: false,
                message: 'Invalid broker port',
            });
        }

        // Normalize host input: allow host, host:port, mqtt://host[:port], mqtts://host[:port]
        let scheme = null;
        let host = hostInput;
        let port = portInput;
        try {
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(hostInput)) {
                const u = new URL(hostInput);
                scheme = (u.protocol || '').replace(':', '').toLowerCase() || null;
                host = u.hostname || hostInput;
                port = u.port ? Number(u.port) : portInput;
            } else if (hostInput.includes(':')) {
                // Parses host:port (also tolerates host with accidental extra spaces)
                const u = new URL(`mqtt://${hostInput}`);
                host = u.hostname || hostInput;
                port = u.port ? Number(u.port) : portInput;
            }
        } catch (_) {
            // If parsing fails, fall back to raw host + provided port
            host = hostInput;
            port = portInput;
        }

        if (!Number.isFinite(port) || port < 1 || port > 65535) {
            return res.status(400).json({
                success: false,
                message: 'Invalid broker port',
            });
        }

        // If no password was provided, allow using an env var (common setups store secrets in .env)
        // Prefer explicitly provided passwordEnvVar; otherwise, if the requested broker matches
        // the currently-configured broker, use its configured passwordEnvVar.
        if (!password && !passwordEnvVar) {
            try {
                const cfgMqtt = config?.mqtt;
                const cfgBroker =
                    cfgMqtt && typeof cfgMqtt.broker === 'object' ? cfgMqtt.broker : null;
                const cfgHost = String(cfgBroker?.host || '').trim();
                const cfgPort = Number(cfgBroker?.port || 1883);
                const cfgUser = String(cfgBroker?.username || '').trim();

                if (
                    cfgBroker?.passwordEnvVar &&
                    (cfgHost === host || cfgHost === hostInput) &&
                    cfgPort === port &&
                    (!username || !cfgUser || cfgUser === username)
                ) {
                    passwordEnvVar = String(cfgBroker.passwordEnvVar).trim();
                }
            } catch (_) {
                /* noop */
            }
        }

        // Infer mqtts when not explicit and using the standard TLS port
        if (!scheme && port === 8883) {
            scheme = 'mqtts';
        }

        const brokerUrl = `${scheme || 'mqtt'}://${host}:${port}`;

        const options = {
            clientId: `posterrama_test_${Date.now()}`,
            clean: true,
            reconnectPeriod: 0,
            connectTimeout: 5000,
        };
        if (username) options.username = username;
        if (password) {
            options.password = password;
        } else if (passwordEnvVar) {
            const envPw = process.env[passwordEnvVar];
            if (envPw) {
                options.password = String(envPw);
            }
        }
        if (scheme === 'mqtts') options.protocol = 'mqtts';

        let finished = false;
        const timeoutMs = 5500;

        let client;
        try {
            const mqtt = require('mqtt');
            if (!mqtt || typeof mqtt.connect !== 'function') {
                return res.status(502).json({
                    success: false,
                    connected: false,
                    broker: { host, port },
                    message: 'MQTT client library is unavailable',
                });
            }
            client = mqtt.connect(brokerUrl, options);
        } catch (e) {
            return res.status(502).json({
                success: false,
                connected: false,
                broker: { host, port },
                message: e?.message || 'MQTT connection failed to start',
            });
        }

        if (!client || typeof client.on !== 'function') {
            return res.status(502).json({
                success: false,
                connected: false,
                broker: { host, port },
                message: 'MQTT connection failed to start',
            });
        }

        const finish = (ok, message, extra = {}) => {
            if (finished) return;
            finished = true;

            try {
                client.removeAllListeners?.();
            } catch (_) {
                /* noop */
            }

            try {
                client.end?.(true);
            } catch (_) {
                /* noop */
            }

            const status = ok ? 200 : 502;
            res.status(status).json({
                success: ok,
                connected: ok,
                broker: { host, port },
                message,
                ...extra,
            });
        };

        const timer = setTimeout(() => {
            finish(false, 'MQTT connection timeout');
        }, timeoutMs);

        client.on('connect', () => {
            clearTimeout(timer);
            finish(true, `Connected to ${host}:${port}`);
        });

        client.on('error', err => {
            clearTimeout(timer);
            finish(false, err?.message || 'MQTT connection failed');
        });
    })
);

/**
 * @swagger
 * /api/admin/mqtt/reconnect:
 *   post:
 *     summary: Reconnect MQTT bridge using current config
 *     description: Stops and restarts the in-process MQTT bridge so config changes take effect without restarting the server.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reconnect scheduled
 */
app.post(
    '/api/admin/mqtt/reconnect',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (_req, res) => {
        try {
            if (typeof global.__restartMqttBridge === 'function') {
                // Fire-and-forget: the bridge connect timeout can be up to 30s.
                global.__restartMqttBridge('admin-reconnect');
            }
        } catch (e) {
            logger.warn('[Admin] MQTT reconnect trigger failed', {
                error: e?.message || String(e),
            });
        }

        res.json({
            success: true,
            restarting: true,
            enabled: !!config?.mqtt?.enabled,
        });
    })
);

/**
 * @swagger
 * /api/admin/mqtt/status:
 *   get:
 *     summary: Get MQTT bridge status and statistics
 *     description: Returns real-time status of MQTT connection, statistics, and recent command history
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MQTT status retrieved successfully
 *       503:
 *         description: MQTT bridge not available
 */
app.get(
    '/api/admin/mqtt/status',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const mqttBridge = global.__posterramaMqttBridge;

        // Reflect configured enablement even if the bridge failed to start.
        const cfgMqtt = config.mqtt || null;
        const enabledInConfig = !!(cfgMqtt && cfgMqtt.enabled);

        if (!enabledInConfig) {
            return res.json({
                enabled: false,
                connected: false,
                message: 'MQTT integration is disabled in configuration',
            });
        }

        if (!mqttBridge) {
            return res.json({
                enabled: true,
                connected: false,
                message:
                    'MQTT is enabled, but the bridge is not running. Check broker settings, then restart the server or use Test connection.',
            });
        }

        const stats = mqttBridge.getStats();
        const devices = await deviceStore.getAll();
        const onlineDevices = devices.filter(d => d.status === 'online');

        res.json({
            enabled: true,
            ...stats,
            deviceSummary: {
                total: devices.length,
                online: onlineDevices.length,
                offline: devices.length - onlineDevices.length,
                published: stats.devices_published || 0,
            },
        });
    })
);

/**
 * @swagger
 * /api/admin/reset-refresh:
 *   post:
 *     summary: Reset stuck playlist refresh state
 *     description: Force-reset the playlist refresh state if it gets stuck
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refresh state has been reset successfully
 */
app.post(
    '/api/admin/reset-refresh',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        logger.info('Admin refresh reset requested', {
            action: 'admin_refresh_reset',
            wasRefreshing: isPlaylistRefreshing(),
            stuckDuration: getRefreshStartTime()
                ? `${Date.now() - getRefreshStartTime()}ms`
                : 'none',
        });

        // Force reset the refresh state
        resetRefreshState();

        res.json({
            success: true,
            message: 'Playlist refresh state has been reset. You can now trigger a new refresh.',
        });
    })
);

/**
 * @swagger
 * /reset-refresh:
 *   get:
 *     summary: Reset stuck playlist refresh state
 *     description: |
 *       User-friendly endpoint to reset stuck refresh state.
 *       Returns an HTML page with reset confirmation.
 *       Can be accessed directly in a browser.
 *     tags: ['Utilities']
 *     responses:
 *       200:
 *         description: HTML page confirming refresh state reset
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               example: |
 *                 <!DOCTYPE html>
 *                 <html>
 *                 <body>
 *                   <h1>🔄 Refresh Reset</h1>
 *                   <p>✅ Playlist refresh state has been reset successfully!</p>
 *                 </body>
 *                 </html>
 */
/**
 * User-friendly endpoint to reset stuck refresh state
 * Can be accessed directly in browser: /reset-refresh
 */
app.get(
    '/reset-refresh',
    // @ts-ignore - Express router overload with asyncHandler
    asyncHandler(async (req, res) => {
        const isRefreshing = isPlaylistRefreshing();
        const refreshStartTime = getRefreshStartTime();

        logger.info('User reset refresh requested via GET', {
            action: 'user_refresh_reset',
            wasRefreshing: isRefreshing,
            stuckDuration: refreshStartTime ? `${Date.now() - refreshStartTime}ms` : 'none',
        });

        // Force reset the refresh state
        const wasStuck = isRefreshing;
        resetRefreshState();

        // Return HTML response for browser users
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>Posterrama - Refresh Reset</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; text-align: center; }
        .container { max-width: 500px; margin: 0 auto; }
        .success { color: #28a745; }
        .info { color: #6c757d; margin-top: 20px; }
        .button { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔄 Refresh Reset</h1>
        <p class="success">✅ Playlist refresh state has been reset successfully!</p>
        ${wasStuck ? '<p><strong>Status:</strong> Stuck refresh was detected and cleared.</p>' : '<p><strong>Status:</strong> No stuck state detected.</p>'}
        <p class="info">You can now refresh the screensaver or wait for automatic refresh.</p>
        <a href="/" class="button">Go to Screensaver</a>
        <a href="/admin" class="button">Go to Admin Panel</a>
    </div>
</body>
</html>`;

        res.send(html);
    })
);

/**
 * @swagger
 * /api/admin/debug-cache:
 *   get:
 *     summary: Debug cache status and configuration
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache debug information
 *       401:
 *         description: Unauthorized
 */
app.get(
    '/api/admin/debug-cache',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const userAgent = req.get('user-agent') || '';
        const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);

        const { cache: playlistCache, timestamp: cacheTimestamp } = getPlaylistCache();
        const isRefreshing = isPlaylistRefreshing();

        res.json({
            cache: {
                itemCount: playlistCache ? playlistCache.length : null,
                isNull: playlistCache === null,
                isRefreshing,
                timestamp: cacheTimestamp,
                age: cacheTimestamp ? Date.now() - cacheTimestamp : null,
            },
            request: {
                userAgent: userAgent.substring(0, 100),
                isMobile,
            },
            config: {
                mediaServers: config.mediaServers?.map(s => ({
                    name: s.name,
                    enabled: s.enabled,
                    type: s.type,
                    genreFilter: s.genreFilter,
                    movieCount: s.movieCount,
                    showCount: s.showCount,
                    movieLibraryNames: s.movieLibraryNames,
                    showLibraryNames: s.showLibraryNames,
                })),
                tmdbSource: config.tmdbSource
                    ? {
                          enabled: config.tmdbSource.enabled,
                          genreFilter: config.tmdbSource.genreFilter,
                          movieCount: config.tmdbSource.movieCount,
                          showCount: config.tmdbSource.showCount,
                      }
                    : null,
            },
        });
    })
);

/**
 * @swagger
 * /api/admin/clear-image-cache:
 *   post:
 *     summary: Clear the server-side image cache
 *     description: >
 *       Deletes all cached images from the `image_cache` directory on the server.
 *       This forces the application to re-fetch all images from the origin media servers.
 *     tags: ['Cache']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The image cache was successfully cleared.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 */
app.post(
    '/api/admin/clear-image-cache',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to clear image cache.');
        const imageCacheDir = path.join(__dirname, 'image_cache');
        let clearedCount = 0;

        try {
            const files = await fsp.readdir(imageCacheDir);
            const unlinkPromises = files.map(file => fsp.unlink(path.join(imageCacheDir, file)));
            await Promise.all(unlinkPromises);
            clearedCount = files.length;
            if (isDebug)
                logger.debug(
                    `[Admin API] Successfully cleared ${clearedCount} files from the image cache.`
                );
            res.json({
                success: true,
                message: `Successfully cleared ${clearedCount} cached images.`,
            });
        } catch (error) {
            logger.error('[Admin API] Error clearing image cache:', error);
            throw new ApiError(500, 'Failed to clear image cache. Check server logs for details.');
        }
    })
);

/**
 * @swagger
 * /api/admin/cache-stats:
 *   get:
 *     summary: Get cache statistics
 *     description: Returns cache size and disk usage information using session authentication
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
 */
app.get(
    '/api/admin/cache-stats',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request for cache stats');

        try {
            // Get cache stats from cache manager
            const cacheStats = cacheManager.getStats();

            // Calculate disk usage
            const diskUsage = {
                imageCache: 0,
                logFiles: 0,
                total: 0,
            };

            // Calculate image cache size
            try {
                const imageCacheDir = path.join(__dirname, 'image_cache');
                const files = await fsp.readdir(imageCacheDir);
                for (const file of files) {
                    try {
                        const stats = await fsp.stat(path.join(imageCacheDir, file));
                        diskUsage.imageCache += stats.size;
                    } catch (err) {
                        // Skip files that can't be read
                    }
                }
            } catch (err) {
                if (isDebug)
                    logger.debug('[Admin API] Image cache directory not accessible:', err.message);
            }

            // Calculate log files size
            try {
                const logsDir = path.join(__dirname, 'logs');
                const files = await fsp.readdir(logsDir);
                for (const file of files) {
                    try {
                        const stats = await fsp.stat(path.join(logsDir, file));
                        diskUsage.logFiles += stats.size;
                    } catch (err) {
                        // Skip files that can't be read
                    }
                }
            } catch (err) {
                if (isDebug)
                    logger.debug('[Admin API] Logs directory not accessible:', err.message);
            }

            diskUsage.total = diskUsage.imageCache + diskUsage.logFiles;

            // Count cached items by type
            const itemCount = {
                media: 0,
                config: 0,
                image: 0,
                total: cacheStats.size,
            };

            // Count items by prefix (basic categorization)
            for (const key of cacheManager.cache.keys()) {
                // @ts-ignore - Cache keys are strings
                const keyStr = String(key);
                if (
                    keyStr.startsWith('media:') ||
                    keyStr.startsWith('plex:') ||
                    keyStr.startsWith('tmdb:') ||
                    false
                ) {
                    itemCount.media++;
                } else if (keyStr.startsWith('config:')) {
                    itemCount.config++;
                } else if (keyStr.startsWith('image:')) {
                    itemCount.image++;
                }
            }

            // Get API cache stats if available
            const apiCacheStats = apiCache ? apiCache.getStats() : null;

            // Calculate combined performance metrics
            const totalHits = cacheStats.hits + (apiCacheStats?.hits || 0);
            const totalMisses = cacheStats.misses + (apiCacheStats?.misses || 0);
            const totalRequests = totalHits + totalMisses;
            const combinedHitRatio = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;

            const response = {
                diskUsage,
                itemCount,
                cacheStats: {
                    hits: cacheStats.hits,
                    misses: cacheStats.misses,
                    hitRate: cacheStats.hitRate,
                },
                cachePerformance: {
                    totalHits,
                    totalMisses,
                    totalRequests,
                    combinedHitRatio,
                },
            };

            // Include effective cache config for UI (max size, min free space)
            try {
                response.cacheConfig = getCacheConfig();
            } catch (_) {
                /* ignore */
            }

            if (isDebug) logger.debug('[Admin API] Cache stats calculated:', response);
            // Prevent any intermediary/browser caching of this dynamic data
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.json(response);
        } catch (error) {
            logger.error('[Admin API] Error getting cache stats:', error);
            throw new ApiError(
                500,
                'Failed to get cache statistics. Check server logs for details.'
            );
        }
    })
);

/**
 * @swagger
 * /api/admin/cache/clear:
 *   post:
 *     summary: Clear cache entries
 *     description: Clear all cache entries or specific tier. Supports query parameter 'tier' to clear specific cache tier (veryShort, short, medium, long, veryLong, mediaFiltered, config).
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [veryShort, short, medium, long, veryLong, mediaFiltered, config]
 *         required: false
 *         description: Specific cache tier to clear (omit to clear all)
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 cleared:
 *                   type: integer
 *                   description: Number of entries cleared
 *       400:
 *         description: Invalid tier specified
 */
app.post(
    '/api/admin/cache/clear',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const tierRaw = req.query.tier;
        const tier = Array.isArray(tierRaw) ? tierRaw[0] : tierRaw;
        const tierStr = tier == null ? '' : String(tier);

        if (isDebug) {
            logger.debug('[Admin API] Cache clear request', { tier: tier || 'all' });
        }

        try {
            let cleared = 0;
            let message = '';

            if (tierStr) {
                // Clear specific tier
                const validTiers = [
                    'veryShort',
                    'short',
                    'medium',
                    'long',
                    'veryLong',
                    'mediaFiltered',
                    'config',
                ];
                if (!validTiers.includes(tierStr)) {
                    throw new ApiError(
                        400,
                        `Invalid tier '${tierStr}'. Valid tiers: ${validTiers.join(', ')}`
                    );
                }

                // Count entries in this tier before clearing
                const tierPrefix = `tier:${tierStr}:`;
                for (const key of cacheManager.cache.keys()) {
                    // @ts-ignore - Cache keys are strings
                    if (String(key).startsWith(tierPrefix)) {
                        cacheManager.delete(key);
                        cleared++;
                    }
                }

                message = `Cleared ${cleared} entries from '${tierStr}' tier`;
                logger.info('[Admin API] Cache tier cleared', { tier: tierStr, cleared });
            } else {
                // Clear all cache
                cleared = cacheManager.cache.size;
                cacheManager.cache.clear();
                cacheManager.resetStats();

                message = `Cleared all cache entries (${cleared} total)`;
                logger.info('[Admin API] All cache cleared', { cleared });
            }

            res.json({
                success: true,
                message,
                cleared,
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            logger.error('[Admin API] Error clearing cache:', error);
            throw new ApiError(500, 'Failed to clear cache. Check server logs for details.');
        }
    })
);

/**
 * @swagger
 * /api/admin/config:
 *   get:
 *     summary: Get current server configuration
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Current configuration
 */
app.get(
    '/api/admin/config',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (_req, res) => {
        try {
            const cfg = await readConfig();
            // Always serve fresh config to the admin UI (no caching)
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.json({ config: cfg });
        } catch (e) {
            res.status(500).json({ error: 'config_read_failed', message: e?.message || 'error' });
        }
    })
);

/**
 * @swagger
 * /api/admin/source-status:
 *   get:
 *     summary: Get per-source status for admin UI
 *     description: Returns enabled/configured flags and lastFetch timestamps for Plex, Jellyfin / Emby, and TMDB.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Per-source status
 */
app.get(
    '/api/admin/source-status',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (_req, res) => {
        try {
            const currentConfig = await readConfig();
            const servers = Array.isArray(currentConfig?.mediaServers)
                ? currentConfig.mediaServers
                : [];
            const plexCfg = servers.find(s => s?.type === 'plex') || {};
            const jfCfg = servers.find(s => s?.type === 'jellyfin') || {};
            const tmdbCfg = currentConfig?.tmdbSource || {};

            const plexConfigured = !!(
                plexCfg.hostname &&
                typeof plexCfg.port !== 'undefined' &&
                plexCfg.tokenEnvVar &&
                process.env[plexCfg.tokenEnvVar]
            );
            const jfConfigured = !!(
                jfCfg.hostname &&
                typeof jfCfg.port !== 'undefined' &&
                jfCfg.tokenEnvVar &&
                process.env[jfCfg.tokenEnvVar]
            );
            const tmdbConfigured = !!tmdbCfg.apiKey;

            const lf = global.sourceLastFetch || {};
            const toIso = v => (typeof v === 'number' && v > 0 ? new Date(v).toISOString() : null);

            res.json({
                plex: {
                    enabled: !!plexCfg.enabled,
                    configured: plexConfigured,
                    lastFetch: toIso(lf.plex),
                    lastFetchMs: typeof lf.plex === 'number' ? lf.plex : null,
                },
                jellyfin: {
                    enabled: !!jfCfg.enabled,
                    configured: jfConfigured,
                    lastFetch: toIso(lf.jellyfin),
                    lastFetchMs: typeof lf.jellyfin === 'number' ? lf.jellyfin : null,
                },
                tmdb: {
                    enabled: !!tmdbCfg.enabled,
                    configured: tmdbConfigured,
                    lastFetch: toIso(lf.tmdb),
                    lastFetchMs: typeof lf.tmdb === 'number' ? lf.tmdb : null,
                },
            });
        } catch (e) {
            res.status(500).json({ error: 'source_status_failed', message: e?.message || 'error' });
        }
    })
);

/**
 * getCacheConfig moved to lib/cache-utils.js
 * Prefer live values from CacheDiskManager; fall back to loaded config.json defaults.
 */
const getCacheConfig = () => getCacheConfigUtil({ config, cacheDiskManager });

/**
 * @swagger
 * /api/admin/cleanup-cache:
 *   post:
 *     summary: Cleanup cache directories
 *     description: Performs cleanup of cache directories by removing old or expired files based on configuration
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleanup completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 filesRemoved:
 *                   type: number
 *                 spaceSaved:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Cache cleanup failed
 */
app.post(
    '/api/admin/cleanup-cache',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for cache cleanup.');

        try {
            const cacheConfig = getCacheConfig();
            const maxSizeGB = Number(cacheConfig.maxSizeGB);

            let totalFilesRemoved = 0;
            let totalSpaceSaved = 0;

            // Cache directories to clean
            const cacheDirectories = [
                path.join(__dirname, 'cache'),
                path.join(__dirname, 'image_cache'),
            ];

            if (isDebug)
                logger.debug('[Admin API] Starting cache cleanup with maxSize:', maxSizeGB, 'GB');

            for (const cacheDir of cacheDirectories) {
                const fsp = fs.promises;
                const cacheDirStat = await fsp.stat(cacheDir).catch(() => null);
                if (cacheDirStat && cacheDirStat.isDirectory()) {
                    try {
                        const files = (await fsp.readdir(cacheDir)).filter(
                            file =>
                                file.endsWith('.json') ||
                                file.endsWith('.jpg') ||
                                file.endsWith('.png') ||
                                file.endsWith('.webp')
                        );

                        // Sort files by modification time (oldest first)
                        const fileStats = [];
                        for (const file of files) {
                            const filePath = path.join(cacheDir, file);
                            const stats = await fsp.stat(filePath).catch(() => null);
                            if (!stats || !stats.isFile()) continue;
                            fileStats.push({
                                file,
                                filePath,
                                mtime: stats.mtime,
                                size: stats.size,
                            });
                        }
                        fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

                        // Calculate current cache size
                        let currentSizeBytes = fileStats.reduce(
                            (total, item) => total + item.size,
                            0
                        );
                        const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;

                        // Remove old files if cache exceeds max size
                        while (currentSizeBytes > maxSizeBytes && fileStats.length > 0) {
                            const oldestFile = fileStats.shift();
                            try {
                                await fsp.unlink(oldestFile.filePath);
                                totalFilesRemoved++;
                                totalSpaceSaved += oldestFile.size;
                                currentSizeBytes -= oldestFile.size;
                                if (isDebug)
                                    logger.debug(
                                        '[Admin API] Removed old cache file:',
                                        oldestFile.file
                                    );
                            } catch (err) {
                                if (isDebug)
                                    logger.warn(
                                        '[Admin API] Failed to remove file:',
                                        oldestFile.file,
                                        err.message
                                    );
                            }
                        }

                        // Remove files older than 30 days
                        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                        const oldFiles = fileStats.filter(item => item.mtime < thirtyDaysAgo);

                        for (const oldFile of oldFiles) {
                            try {
                                await fsp.unlink(oldFile.filePath);
                                totalFilesRemoved++;
                                totalSpaceSaved += oldFile.size;
                                if (isDebug)
                                    logger.debug(
                                        '[Admin API] Removed expired cache file:',
                                        oldFile.file
                                    );
                            } catch (err) {
                                if (isDebug)
                                    logger.warn(
                                        '[Admin API] Failed to remove expired file:',
                                        oldFile.file,
                                        err.message
                                    );
                            }
                        }
                    } catch (err) {
                        if (isDebug)
                            logger.warn(
                                '[Admin API] Error processing cache directory:',
                                cacheDir,
                                err.message
                            );
                    }
                }
            }

            const spaceSavedMB = (totalSpaceSaved / (1024 * 1024)).toFixed(2);
            const message =
                totalFilesRemoved > 0
                    ? `Cache cleanup completed. Removed ${totalFilesRemoved} files, saved ${spaceSavedMB} MB.`
                    : 'Cache cleanup completed. No files needed to be removed.';

            if (isDebug)
                logger.debug('[Admin API] Cache cleanup completed:', {
                    totalFilesRemoved,
                    spaceSavedMB,
                });

            res.json({
                success: true,
                message: message,
                filesRemoved: totalFilesRemoved,
                spaceSaved: `${spaceSavedMB} MB`,
            });
        } catch (error) {
            if (isDebug) logger.error('[Admin API] Error during cache cleanup:', error);
            throw new ApiError(500, 'Failed to cleanup cache. Check server logs for details.');
        }
    })
);

/**
 * @swagger
 * /api/admin/api-key:
 *   get:
 *     summary: Get the current API key
 *     description: Retrieves the currently configured API access key. This is only returned to an authenticated admin session.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The API key.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 apiKey:
 *                   type: string
 *                   nullable: true
 */
// @ts-ignore - Express router overload with middleware
app.get('/api/admin/api-key', isAuthenticated, (req, res) => {
    const apiKey = env.auth.apiAccessToken || null;
    res.json({ apiKey });
});
/**
 * @swagger
 * /api/admin/api-key/status:
 *   get:
 *     summary: Check the API key status
 *     description: Indicates whether an API access key is currently configured in the application.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The API key status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasKey:
 *                   type: boolean
 *                   description: Whether an API key is currently configured.
 *                   example: true
 */
// @ts-ignore - Express router overload with middleware
app.get('/api/admin/api-key/status', isAuthenticated, (req, res) => {
    const hasKey = env.auth.hasApiToken();
    res.json({ hasKey });
});

/**
 * @swagger
 * /api/admin/api-key/generate:
 *   post:
 *     summary: Generate a new API key
 *     description: >
 *       Generates a new, cryptographically secure API access token and stores it in the .env file
 *       and overwrites any existing key. The new key is returned ONCE ONLY.
 *       Store it securely, as it cannot be retrieved again.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The newly generated API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiKeyResponse'
 */
app.post(
    '/api/admin/api-key/generate',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await writeEnvFile({ API_ACCESS_TOKEN: newApiKey });

        // No restart needed - .env file is updated and key is immediately available
        if (isDebug) logger.debug('[Admin API] New API Access Token generated and saved.');
        res.json({
            apiKey: newApiKey,
            message:
                'New API key generated. This is the only time it will be shown. Please save it securely.',
        });
    })
);

/**
 * @swagger
 * /api/admin/api-key/revoke:
 *   post:
 *     summary: Revoke current API key
 *     description: Removes the current API access token from the configuration, making it unusable.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Confirmation that the key has been revoked.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 */
app.post(
    '/api/admin/api-key/revoke',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        await writeEnvFile({ API_ACCESS_TOKEN: '' });

        // No restart needed - .env file is updated immediately
        if (isDebug) logger.debug('[Admin API] API Access Token has been revoked.');
        res.json({ success: true, message: 'API key has been revoked.' });
    })
);

// Admin observable routes (logs, events/SSE, notifications) - modularized: see routes/admin-observable.js

/**
 * @swagger
 * /api/plex/sessions:
 *   get:
 *     summary: Get current Plex playback sessions
 *     description: >
 *       Returns cached Plex session data showing what is currently being played.
 *       Updated every 10 seconds via background polling.
 *     tags: ['Admin', 'Plex']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current Plex sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sessionKey:
 *                         type: string
 *                       ratingKey:
 *                         type: string
 *                       type:
 *                         type: string
 *                       title:
 *                         type: string
 *                       year:
 *                         type: number
 *                       thumb:
 *                         type: string
 *                       art:
 *                         type: string
 *                       viewOffset:
 *                         type: number
 *                       duration:
 *                         type: number
 *                       User:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           thumb:
 *                             type: string
 *                       Player:
 *                         type: object
 *                         properties:
 *                           state:
 *                             type: string
 *                           device:
 *                             type: string
 *                           platform:
 *                             type: string
 *                           product:
 *                             type: string
 *                           title:
 *                             type: string
 *                 lastUpdate:
 *                   type: number
 *                   description: Timestamp of last poll (milliseconds)
 *                 isActive:
 *                   type: boolean
 *                   description: Whether poller is currently running
 *       503:
 *         description: Sessions poller not initialized
 */
app.get(
    '/api/plex/sessions',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const poller = global.__posterramaSessionsPoller;
        if (!poller) {
            return res.status(503).json({
                error: 'Plex sessions poller not initialized',
                sessions: [],
                lastUpdate: null,
                isActive: false,
                serverName: 'Plex Server',
            });
        }

        const data = poller.getSessions();

        // Add Plex server name from config for Cinema display image proxy
        const plexServer = (config.mediaServers || []).find(s => s.enabled && s.type === 'plex');
        const serverName = plexServer?.name || 'Plex Server';

        res.json({ ...data, serverName });
    })
);

/**
 * @swagger
 * /api/plex/users:
 *   get:
 *     summary: Get Plex users (admin)
 *     description: Returns users with access to the configured Plex server (best-effort).
 *     tags: ['Admin', 'Plex']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users list
 */
app.get(
    '/api/plex/users',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const plexServer = (config.mediaServers || []).find(s => s.enabled && s.type === 'plex');
        const token =
            plexServer?.token ||
            (plexServer?.tokenEnvVar && process.env[plexServer.tokenEnvVar]
                ? process.env[plexServer.tokenEnvVar]
                : null);

        if (!plexServer || !token) {
            return res.status(200).json({
                success: false,
                error: 'Plex server not configured (missing token)',
                users: [],
            });
        }

        // Prefer Plex server's /accounts (includes shared users) over plex.tv Home users.
        // /accounts can require an admin token; if unavailable we fall back to active sessions.
        const users = [];
        try {
            const plex = await getPlexClient(plexServer);
            if (plex?.query) {
                try {
                    const accounts = await plex.query('/accounts');
                    const accountRaw = accounts?.MediaContainer?.Account;
                    const accountList = Array.isArray(accountRaw)
                        ? accountRaw
                        : accountRaw
                          ? [accountRaw]
                          : [];

                    accountList.forEach(account => {
                        const username = account?.name || account?.title || account?.username;
                        if (!username) return;
                        users.push({
                            id: account?.id ?? null,
                            username,
                            title: username,
                            email: account?.email || null,
                            thumb: account?.thumb || null,
                        });
                    });
                } catch (e) {
                    logger.debug('[api/plex/users] /accounts unavailable', { message: e?.message });
                }
            }
        } catch (e) {
            logger.debug('[api/plex/users] getPlexClient failed', { message: e?.message });
        }

        // Fallback: infer users from recent sessions
        if (users.length === 0) {
            try {
                const poller = global.__posterramaSessionsPoller;
                const sessions = poller?.getSessions?.()?.sessions || [];
                sessions.forEach(session => {
                    const username = session?.User?.title || session?.username;
                    if (!username) return;
                    users.push({
                        id: session?.User?.id ?? null,
                        username,
                        title: username,
                        email: null,
                        thumb: session?.User?.thumb || null,
                    });
                });
            } catch (_) {
                /* ignore */
            }
        }

        // De-dup + sort
        const uniqueUsers = users
            .filter(u => u && u.username)
            .reduce((acc, user) => {
                if (!acc.find(u => u.username === user.username)) acc.push(user);
                return acc;
            }, [])
            .sort((a, b) => (a.username || '').localeCompare(b.username || ''));

        if (uniqueUsers.length === 0) {
            return res.status(200).json({
                success: false,
                error: 'No Plex users found (insufficient permissions or no recent sessions)',
                users: [],
            });
        }

        // Cache for other subsystems (e.g., MQTT discovery option lists)
        try {
            global.__posterramaPlexUsersCache = uniqueUsers;
        } catch (_) {
            /* ignore */
        }

        res.json({ success: true, users: uniqueUsers });
    })
);

/**
 * @swagger
 * /api/jellyfin/sessions:
 *   get:
 *     summary: Get current Jellyfin playback sessions
 *     description: >
 *       Returns cached Jellyfin session data showing what is currently being played.
 *       Updated every 10 seconds via background polling.
 *     tags: ['Admin', 'Jellyfin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current Jellyfin sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                 lastUpdate:
 *                   type: number
 *                   description: Timestamp of last poll (milliseconds)
 *                 isActive:
 *                   type: boolean
 *                   description: Whether poller is currently running
 *       503:
 *         description: Sessions poller not initialized
 */
app.get(
    '/api/jellyfin/sessions',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const poller = global.__posterramaJellyfinSessionsPoller;
        if (!poller) {
            return res.status(503).json({
                error: 'Jellyfin sessions poller not initialized',
                sessions: [],
                lastUpdate: null,
                isActive: false,
                serverName: 'Jellyfin',
            });
        }

        const data = poller.getSessions();

        // Add Jellyfin server name from config
        const jellyfinServer = (config.mediaServers || []).find(
            s => s.enabled && s.type === 'jellyfin'
        );
        const serverName = jellyfinServer?.name || 'Jellyfin';

        res.json({ ...data, serverName });
    })
);

/**
 * @swagger
 * /admin/debug:
 *   get:
 *     summary: Retrieve debug information
 *     description: >
 *       Returns the raw data of all items in the current *cached* playlist.
 *       This endpoint is only available when debug mode is enabled in the .env file.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The raw data from the playlist.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DebugResponse'
 *       404:
 *         description: Not found (if debug mode is disabled).
 */
app.get(
    '/admin/debug',
    // @ts-ignore - Express router overload with middleware
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (!isDebug) {
            throw new NotFoundError('Debug endpoint is only available when debug mode is enabled.');
        }
        // Use the existing cache to inspect the current state, which is more useful for debugging.
        // Calling getPlaylistMedia() would fetch new data every time, which is not what the note implies.
        const { cache: playlistCache } = getPlaylistCache();
        const allMedia = playlistCache || [];

        res.json({
            note: 'This endpoint returns the raw data for all media items currently in the *cached* playlist. This reflects what the front-end is using.',
            playlist_item_count: allMedia.length,
            playlist_items_raw: allMedia.map(m => m?._raw).filter(Boolean), // Filter out items without raw data
        });
    })
);

// Start the server only if this script is run directly (e.g., `node server.js`)
// and not when it's imported by another script (like our tests).
if (require.main === module) {
    // Pre-load asset versions synchronously on startup to ensure they're available immediately
    logger.info('Pre-loading asset versions...');
    try {
        refreshAssetVersionsSync(__dirname);
        logger.info(`Asset versions pre-loaded`);
    } catch (err) {
        logger.warn('Failed to pre-load asset versions:', err.message);
    }

    // Pre-populate cache before starting the server to prevent race conditions
    logger.info('Performing initial playlist fetch before server startup...');

    const STARTUP_FETCH_TIMEOUT_MS = Math.max(5000, env.performance.startupFetchTimeoutMs);

    const startupFetch = Promise.race([
        refreshPlaylistCache()
            .then(() => 'ok')
            .catch(err => ({ error: err })),
        new Promise(resolve => setTimeout(() => resolve('timeout'), STARTUP_FETCH_TIMEOUT_MS)),
    ]);

    startupFetch.then(result => {
        const { cache: playlistCache } = getPlaylistCache();
        if (result === 'ok') {
            if (playlistCache && playlistCache.length > 0) {
                logger.info(
                    `Initial playlist fetch complete. ${playlistCache.length} items loaded.`
                );
            } else {
                logger.warn(
                    'Initial playlist fetch returned no media. The app will run and populate after the next refresh.'
                );
            }
        } else if (result === 'timeout') {
            logger.warn(
                `Initial playlist fetch is taking too long (> ${STARTUP_FETCH_TIMEOUT_MS}ms). Starting server now and continuing refresh in background.`
            );
            // Kick a background refresh if one isn't already active
            setTimeout(() => {
                try {
                    refreshPlaylistCache();
                } catch (_) {
                    /* fire-and-forget */
                }
            }, 0);
        } else if (result && result.error) {
            logger.error('Initial playlist fetch failed during startup:', result.error);
        }

        // Start the server regardless of the initial fetch outcome
        const httpServer = app.listen(port, async () => {
            logger.info(`posterrama.app is listening on http://localhost:${port}`);
            if (isDebug)
                logger.debug(`Debug endpoint is available at http://localhost:${port}/admin/debug`);

            logger.info('Server startup complete - media cache is ready');

            // Ensure local media directory structure exists on startup
            // This is critical - we should ALWAYS have these directories, even if local source is disabled
            // Create a temporary instance just for directory creation if needed
            try {
                if (!localDirectorySource) {
                    // Local source disabled, but we still need the directory structure
                    // @ts-ignore - LocalDirectorySource expects specific config structure
                    const tempSource = new LocalDirectorySource(
                        config.localDirectory || { rootPath: 'media', enabled: false }
                    );
                    await tempSource.createDirectoryStructure();
                    logger.info(
                        'Local media directory structure ensured on startup (source disabled)',
                        {
                            rootPath: tempSource.rootPath,
                        }
                    );
                } else {
                    await localDirectorySource.createDirectoryStructure();
                    logger.info('Local media directory structure ensured on startup', {
                        rootPath: localDirectorySource.rootPath,
                    });
                }
            } catch (e) {
                logger.error('Failed to ensure local media directory structure on startup:', {
                    error: e?.message,
                    stack: e?.stack,
                });
            }

            // Schedule background refresh based on config
            schedulePlaylistBackgroundRefresh();

            // Schedule automated config backups
            try {
                // @ts-ignore - Custom method on router
                await configBackupsRouter.scheduleConfigBackups();
            } catch (e) {
                logger.warn('Failed to initialize config backup scheduler:', e?.message || e);
            }

            // Set up automatic cache cleanup - use configurable interval
            // @ts-ignore - Config.cache exists at runtime
            if (config.cache?.autoCleanup !== false) {
                // @ts-ignore - Config.cache exists at runtime
                const cleanupIntervalMinutes = config.cache?.cleanupIntervalMinutes || 15;
                const cacheCleanupInterval = cleanupIntervalMinutes * 60 * 1000;
                global.cacheCleanupInterval = setInterval(async () => {
                    try {
                        const cleanupResult = await cacheDiskManager.cleanupCache();
                        if (cleanupResult.cleaned && cleanupResult.deletedFiles > 0) {
                            logger.info('Scheduled cache cleanup performed', {
                                trigger: 'scheduled',
                                deletedFiles: cleanupResult.deletedFiles,
                                freedSpaceMB: cleanupResult.freedSpaceMB,
                            });
                        }
                    } catch (cleanupError) {
                        logger.warn('Scheduled cache cleanup failed', {
                            error: cleanupError.message,
                            trigger: 'scheduled',
                        });
                    }
                }, cacheCleanupInterval);
                logger.debug('Automatic cache cleanup scheduled every 30 minutes.');
            }

            // Optional: trigger a one-off refresh shortly after startup to warm caches further

            // Prevent unhandled 'error' events (e.g., EADDRINUSE) from crashing without context
            httpServer.on('error', err => {
                /** @type {NodeJS.ErrnoException} */
                const errnoErr = err;
                const code = errnoErr?.code;
                const message = errnoErr?.message;

                if (code === 'EADDRINUSE') {
                    logger.error('Failed to start server: port already in use', {
                        port,
                        code,
                        message,
                        hint: 'Another process is already listening on this port. Stop it or change env.server.port / config.serverPort.',
                    });
                } else {
                    logger.error('Failed to start server: listen error', {
                        port,
                        code,
                        message,
                        stack: errnoErr?.stack,
                    });
                }

                // Exit so process managers (PM2/systemd) can handle restart/backoff
                process.exit(1);
            });
            setTimeout(() => {
                try {
                    refreshPlaylistCache();
                } catch (_) {
                    /* optional logging only */
                }
            }, 5000);

            // Initialize WebSocket hub once server is listening
            initializeWebSocketServer({ httpServer, wsHub, deviceStore, logger });
        });
        // SSE route is registered earlier (before 404 handler)

        // Initialize MQTT bridge if enabled
        (async () => {
            try {
                if (typeof global.__restartMqttBridge === 'function') {
                    await global.__restartMqttBridge('startup');
                }
            } catch (e) {
                logger.error('❌ Failed to initialize MQTT bridge:', e);
            }
        })();

        // Initialize Plex Sessions Poller
        (async () => {
            try {
                logger.info('🎬 Initializing Plex sessions poller...');
                const sessionsPoller = new PlexSessionsPoller({
                    getPlexClient,
                    config,
                    pollInterval: 10000, // 10 seconds
                });

                // Store globally for access in routes
                global.__posterramaSessionsPoller = sessionsPoller;

                // Broadcast sessions updates via WebSocket
                sessionsPoller.on('sessions', sessions => {
                    wsHub.broadcastAdmin({
                        kind: 'plex-sessions',
                        payload: { sessions, timestamp: Date.now() },
                    });
                });

                // Start polling
                sessionsPoller.start();

                logger.info('✅ Plex sessions poller initialized successfully');
            } catch (error) {
                logger.error('❌ Failed to initialize Plex sessions poller:', error);
                // Don't crash the server if poller fails
            }
        })();

        // Initialize Jellyfin Sessions Poller
        (async () => {
            try {
                logger.info('🎬 Initializing Jellyfin sessions poller...');
                const jellyfinSessionsPoller = new JellyfinSessionsPoller({
                    getJellyfinClient,
                    config,
                    pollInterval: 10000, // 10 seconds
                });

                // Store globally for access in routes
                global.__posterramaJellyfinSessionsPoller = jellyfinSessionsPoller;

                // Broadcast sessions updates via WebSocket
                jellyfinSessionsPoller.on('sessions', sessions => {
                    wsHub.broadcastAdmin({
                        kind: 'jellyfin-sessions',
                        payload: { sessions, timestamp: Date.now() },
                    });
                });

                // Start polling
                jellyfinSessionsPoller.start();

                logger.info('✅ Jellyfin sessions poller initialized successfully');
            } catch (error) {
                logger.error('❌ Failed to initialize Jellyfin sessions poller:', error);
                // Don't crash the server if poller fails
            }
        })();

        // Start sync-tick broadcaster even if initial fetch failed
        try {
            if (!global.__posterramaSyncTicker) {
                const minMs = 2000;
                global.__posterramaSyncTicker = setInterval(() => {
                    try {
                        const periodMs = Math.max(
                            minMs,
                            // @ts-ignore - Config.transitionIntervalSeconds exists at runtime
                            Number(config.transitionIntervalSeconds || 15) * 1000
                        );
                        const now = Date.now();
                        const nextAt = Math.ceil(now / periodMs) * periodMs;
                        const msToNext = nextAt - now;
                        // @ts-ignore - Config.syncEnabled exists at runtime
                        if (config.syncEnabled !== false && msToNext <= 800) {
                            wsHub.broadcast({
                                kind: 'sync-tick',
                                payload: { serverTime: now, periodMs, nextAt },
                            });
                        }
                    } catch (_) {
                        /* no-op: broadcasting sync tick is best-effort */
                    }
                }, 500);
            }
        } catch (e) {
            logger.warn('[SyncTick] scheduler init failed', e);
        }
    });

    // Note: The rest of the startup logic (intervals, cleanup) will be moved inside the app.listen callback

    // --- Conditional Site Server ---
    // This server runs on a separate port and is controlled by config.json.
    // It's intended for public viewing without exposing the main application's admin panel.
    if (config.siteServer && config.siteServer.enabled) {
        logger.info(
            `[Site Server] Initializing site server on port ${config.siteServer.port || 4001}...`
        );
        const siteApp = express();
        const sitePort = config.siteServer.port || 4001;
        const mainAppUrl = `http://localhost:${port}`; // 'port' is the main app's port

        // Site server may proxy a small set of API requests (including POST for admin preview).
        // We parse JSON bodies so we can forward them to the main app.
        // Keep the limit modest; this is only used for settings/preview payloads.
        siteApp.use(express.json({ limit: '1mb' }));

        // A simple proxy for API requests to the main application.
        // This ensures that the public site can fetch data without exposing admin endpoints.
        const proxyApiRequest = async (req, res) => {
            const targetUrl = `${mainAppUrl}${req.originalUrl}`;
            try {
                if (isDebug)
                    logger.debug(`[Site Server Proxy] Forwarding request to: ${targetUrl}`);

                // Forward method, headers (including cookies/auth), and body when present.
                // This is required for authenticated admin preview endpoints.
                const method = (req.method || 'GET').toUpperCase();
                const headers = { ...(req.headers || {}) };
                // Ensure Host header matches target; let fetch set it.
                delete headers.host;
                // Content-Length may not match after body re-serialization.
                delete headers['content-length'];

                let body;
                if (!['GET', 'HEAD'].includes(method)) {
                    // Only support JSON payloads for proxy POST/PUT/PATCH.
                    // For other body types, fall back to an empty body.
                    const ct = String(headers['content-type'] || '').toLowerCase();
                    if (ct.includes('application/json')) {
                        body = JSON.stringify(req.body || {});
                    }
                }

                const response = await fetch(targetUrl, {
                    method,
                    headers,
                    body,
                });

                // Intercept /get-config to add flags for the promo site.
                // Force screensaver mode + promo box for the public site (port 4001)
                if (req.originalUrl.startsWith('/get-config') && response.ok) {
                    if (isDebug)
                        logger.info(`[Site Server Proxy] Modifying response for /get-config`);
                    const originalConfig = await response.json();
                    const modifiedConfig = {
                        ...originalConfig,
                        isPublicSite: true,
                        // Preserve ALL original settings for promo site consistency
                        showPoster: originalConfig.showPoster,
                        showMetadata: originalConfig.showMetadata,
                        showClearLogo: originalConfig.showClearLogo,
                        showRottenTomatoes: originalConfig.showRottenTomatoes,
                        clockWidget: originalConfig.clockWidget,
                        clockTimezone: originalConfig.clockTimezone,
                        clockFormat: originalConfig.clockFormat,
                        uiScaling: originalConfig.uiScaling,
                        transitionEffect: originalConfig.transitionEffect,
                        effectPauseTime: originalConfig.effectPauseTime,
                        autoTransition: true,
                        // Promo site forces faster transitions for demo
                        transitionIntervalSeconds: Math.max(
                            8,
                            originalConfig.transitionIntervalSeconds || 15
                        ),
                        // Force promo box to be visible
                        promoBoxEnabled: true,
                        // Preserve original mode settings - promo box shows on top
                        wallartMode: originalConfig.wallartMode,
                        // Preserve original cinema mode setting
                        cinemaMode: originalConfig.cinemaMode,
                    };
                    // Send modified JSON - remove Content-Encoding header since we're sending uncompressed JSON
                    res.removeHeader('Content-Encoding');
                    return res.json(modifiedConfig);
                }

                // Forward the status code from the main app
                res.status(response.status);

                // Forward all headers from the main app's response, except compression headers
                // (fetch API already decompresses, so we'd send uncompressed data with wrong headers)
                response.headers.forEach((value, name) => {
                    const lowerName = name.toLowerCase();
                    // Skip Content-Encoding and Transfer-Encoding headers
                    if (lowerName !== 'content-encoding' && lowerName !== 'transfer-encoding') {
                        res.setHeader(name, value);
                    }
                });

                // Pipe the response body (already decompressed by fetch)
                response.body.pipe(res);
            } catch (error) {
                logger.error(
                    `[Site Server Proxy] Error forwarding request to ${targetUrl}:`,
                    error
                );
                res.status(502).json({
                    error: 'Bad Gateway',
                    message: 'The site server could not connect to the main application.',
                });
            }
        };

        // Define the public API routes that need to be proxied
        siteApp.get('/get-config', proxyApiRequest);
        siteApp.get('/get-media', proxyApiRequest);
        siteApp.get('/get-music-artists', proxyApiRequest);
        siteApp.get('/get-media-by-key/:key', proxyApiRequest);
        siteApp.get('/image', proxyApiRequest);
        siteApp.get('/local-posterpack', proxyApiRequest);

        // Compatibility endpoint (always public/)
        siteApp.get('/api/frontend/static-dir', proxyApiRequest);

        // Admin preview endpoint (authenticated): required for live preview of UNSAVED settings.
        // This is not exposed without valid session/token.
        siteApp.post('/api/admin/media/preview', proxyApiRequest);

        // Admin MQTT endpoints (authenticated): allow admin UI actions when served via site server.
        siteApp.get('/api/admin/mqtt/status', proxyApiRequest);
        siteApp.post('/api/admin/mqtt/test-connection', proxyApiRequest);
        siteApp.post('/api/admin/mqtt/reconnect', proxyApiRequest);
        siteApp.post('/api/admin/mqtt/republish', proxyApiRequest);

        // Proxy mode pages (cinema, wallart, screensaver) to main app for asset stamping
        siteApp.get(['/cinema', '/cinema.html'], proxyApiRequest);
        siteApp.get(['/wallart', '/wallart.html'], proxyApiRequest);
        siteApp.get(['/screensaver', '/screensaver.html'], proxyApiRequest);

        // A catch-all route to serve the index.html with promo box enabled for the public site.
        // This shows the marketing/promo content instead of the app interface.
        // IMPORTANT: This must come BEFORE express.static to override index.html
        /**
         * @swagger
         * /[site]:
         *   get:
         *     summary: Site server homepage
         *     description: Serves the promotional homepage for the public-facing site server
         *     tags: ['Site Server']
         *     responses:
         *       200:
         *         description: Promotional homepage HTML
         *         content:
         *           text/html:
         *             schema:
         *               type: string
         */
        siteApp.get('/', (req, res) => {
            // Serve index.html which will redirect to the appropriate mode
            // The config intercept adds promoBoxEnabled:true, and mode pages load the overlay
            res.sendFile(path.join(publicDir, 'index.html'));
        });

        // Disable caching for admin files on site server too
        siteApp.use((req, res, next) => {
            const isAdminFile = /\/(admin|logs|device-mgmt)\.(html|js|css)/.test(req.url);

            if (isAdminFile) {
                res.setHeader(
                    'Cache-Control',
                    'no-store, no-cache, must-revalidate, proxy-revalidate'
                );
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.setHeader('Surrogate-Control', 'no-store');
            }
            next();
        });

        // Serve static files (CSS, JS, etc.) - use built version in production
        siteApp.use(
            express.static(publicDir, {
                setHeaders: (res, _path) => {
                    try {
                        const url = res.req?.url || '';
                        if (/[?&](v|cb)=/.test(url)) {
                            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                            res.setHeader('Pragma', 'no-cache');
                            res.setHeader('Expires', '0');
                        }
                    } catch {
                        // ignore
                    }
                },
            })
        );

        // Fallback for unmatched routes - redirect to root
        /**
         * @swagger
         * /[site]/*:
         *   get:
         *     summary: Site server fallback route
         *     description: Redirects unmatched paths to homepage
         *     tags: ['Site Server']
         *     responses:
         *       302:
         *         description: Redirect to homepage
         */
        siteApp.get('*', (req, res) => {
            res.redirect(302, '/');
        });

        // Start the optional public site server, but don't let failures crash the main app
        let siteServerInstance;
        try {
            siteServerInstance = siteApp.listen(sitePort, () => {
                logger.info(
                    `[Site Server] Public site server is running on http://localhost:${sitePort}`
                );
            });
            // Also handle async errors emitted by the server after listen
            siteServerInstance.on('error', err => {
                // @ts-ignore - Error.code is a custom property
                if (err && err.code === 'EADDRINUSE') {
                    logger.error(
                        `Public site server failed to bind to port ${sitePort} (address in use). Continuing without the site server.`
                    );
                } else {
                    logger.error(`[Site Server] listen error: ${err?.message || err}`);
                }
            });
        } catch (err) {
            // Catch synchronous listen errors
            // @ts-ignore - Error.code is a custom property
            if (err && err.code === 'EADDRINUSE') {
                logger.error(
                    `Public site server failed to bind to port ${sitePort} (address in use). Continuing without the site server.`
                );
            } else {
                logger.error(`[Site Server] listen threw: ${err?.message || err}`);
            }
        }
    }
}

// Cleanup function for proper shutdown and test cleanup
function cleanup() {
    cleanupHelper({ logger, cacheManager, cacheDiskManager, metricsManager });
}

// Export cleanup function for tests
// @ts-ignore - Custom property on Express app
app.cleanup = cleanup;

// Handle process termination (only when running as the entrypoint, not when imported by Jest)
if (!__isJestRun && require.main === module) {
    process.on('SIGTERM', () => {
        logger.info('SIGTERM received, shutting down gracefully');
        cleanup();
        process.exit(0);
    });

    process.on('SIGINT', () => {
        logger.info('SIGINT received, shutting down gracefully');
        cleanup();
        process.exit(0);
    });
}

// --- Admin SSE: /api/admin/events (logs + alerts) ---
// Register BEFORE the 404 handler so it isn't shadowed.
try {
    initializeSSEServer({ app, logger });
} catch (e) {
    logger.warn('[SSE] init failed', e?.message || e);
}

// Conditionally mount internal test routes late (after all core middleware) to avoid affecting production
if (env.server.exposeInternalEndpoints) {
    try {
        // Lazy require only when needed
        testRoutes = require('./__tests__/routes/test-endpoints');
        app.use(testRoutes);
        logger.debug?.('[init] internal test routes mounted (EXPOSE_INTERNAL_ENDPOINTS)');
    } catch (e) {
        logger.warn('[init] failed to mount internal test routes', { error: e.message });
    }
}

// Error handling middleware (must be last)
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Handle 404 for unmatched routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

// Export the app instance so that it can be imported and used by Supertest in our tests.
module.exports = app;
module.exports.testServerConnection = testServerConnection;
