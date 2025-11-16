const logger = require('./utils/logger');
const env = require('./config/environment');
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
const {
    sseDbg,
    getLocalIPAddress,
    getAvatarPath,
    isDeviceMgmtEnabled,
} = require('./lib/utils-helpers');
const { calculateDirectoryHash } = require('./lib/build-helpers');
const { cleanup: cleanupHelper } = require('./lib/server-helpers');
const {
    asyncHandler,
    createIsAuthenticated,
    testSessionShim,
    createAdminAuth,
    createAdminAuthDevices,
} = require('./middleware');
const { readPresets, writePresets } = require('./lib/preset-helpers');
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
forceReloadEnv();

// Initialize environment (directories, .env, config.json)
const { imageCacheDir, avatarDir } = initializeEnvironment(__dirname);

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcrypt');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fsp = fs.promises;

// Import Config class instance (provides methods like getTimeout())
const config = require('./config/');
const configJson = require('./config.json');

// Validate configuration at startup (Issue #10: Config Validation Runs Too Late)
// This ensures invalid configurations are caught before services initialize
const { validateConfig } = require('./config/validators');
try {
    const validation = validateConfig(configJson);
    if (!validation.valid) {
        logger.error('❌ Configuration validation failed:');
        validation.errors.forEach(err => {
            logger.error(`  - ${err.path}: ${err.message}`);
        });
        logger.error('Please fix the configuration errors in config.json and restart the server.');
        process.exit(1);
    }
    logger.info('✅ Configuration validated successfully');
} catch (error) {
    logger.error('❌ Configuration validation error:', error.message);
    logger.error('Please check your config.json file for syntax errors.');
    process.exit(1);
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
        try {
            const configPath = path.join(__dirname, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
            logger.info('[Config Migration] Added missing "name" fields to mediaServers');
        } catch (e) {
            logger.warn('[Config Migration] Could not save updated config:', e.message);
        }
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
const ASSET_VERSION = pkg.version || '1.0.0';

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
const deepMerge = require('./utils/deep-merge');
// Device management stores and WebSocket hub
const deviceStore = require('./utils/deviceStore');
const groupsStore = require('./utils/groupsStore');
const wsHub = require('./utils/wsHub');
// Plex Sessions Poller
const PlexSessionsPoller = require('./services/plexSessionsPoller');
const app = express();
const { ApiError, NotFoundError } = require('./utils/errors.js');
const ratingCache = require('./utils/rating-cache.js');
// Device management bypass (IP allow list)
const { deviceBypassMiddleware } = require('./middleware/deviceBypass');

// Use environment configuration with fallback to config.json
const port = env.server.port || config.serverPort || 4000;
const isDebug = env.server.debug;

// Wrapper for isAuthenticated that passes isDebug
const isAuthenticated = createIsAuthenticated({ isDebug });

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
const __fileStore = new FileStore({
    path: './sessions', // Sessions will be stored in a 'sessions' directory
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

// Validate session secret BEFORE initializing session middleware (Security Fix: Issue #2)
const sessionSecret = env.auth.sessionSecret;

if (!sessionSecret || sessionSecret === 'test-secret-fallback') {
    if (env.server.nodeEnv === 'production') {
        logger.error('FATAL: SESSION_SECRET not configured in production');
        logger.error('Set SESSION_SECRET environment variable and restart');
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
            secure: env.server.nodeEnv === 'production',
            sameSite: env.server.nodeEnv === 'production' ? 'strict' : 'lax',
        },
    })
);

// Seed a stable install cookie early so concurrent tabs share one installId
app.use((req, res, next) => {
    try {
        const cookies = String(req.headers['cookie'] || '');
        if (!/(^|;\s*)pr_iid=/.test(cookies)) {
            const iid = require('crypto').randomUUID();
            res.setHeader(
                'Set-Cookie',
                `pr_iid=${encodeURIComponent(iid)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`
            );
        }
    } catch (_) {
        // ignore cookie seeding failures
    }
    next();
});

// Performance and security logging middleware
app.use((req, res, next) => {
    // Add request ID for tracking
    req.id = crypto.randomBytes(16).toString('hex');

    // Log start of request processing
    const start = process.hrtime();
    const requestLog = {
        id: req.id,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
    };

    // Security logging for admin endpoints - only log truly suspicious activity
    if (req.path.startsWith('/api/admin/')) {
        const hasSessionUser = Boolean(req.session?.user);
        const authHeader = req.headers.authorization || '';
        const hasBearer = authHeader.startsWith('Bearer ');
        // Only warn for modifying requests with neither a session nor a bearer token
        if (!hasSessionUser && !hasBearer && req.method !== 'GET') {
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
                req.path.startsWith('/api/admin/status'));

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

        // Only log if it's not routine/monitoring AND (has issues OR is not a GET request OR took long time)
        const shouldLog =
            !isAdminMonitoring &&
            !isRoutineRequest &&
            (res.statusCode >= 400 || req.method !== 'GET' || duration > 1000);

        if (shouldLog) {
            logger[logLevel]('Request completed', {
                ...requestLog,
                status: res.statusCode,
                duration: `${duration.toFixed(2)}ms`,
                contentLength: res.get('content-length'),
            });
        }

        // Log slow requests (configurable threshold)
        const slowReqMs = env.server.slowRequestMs;
        if (duration > slowReqMs) {
            logger.warn('Slow request detected', {
                ...requestLog,
                duration: `${duration.toFixed(2)}ms`,
                status: res.statusCode,
                thresholdMs: slowReqMs,
            });
        }
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

        if (!supportedVersions.includes(acceptedVersion)) {
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
 *       Returns the aggregated playlist from all configured media sources (Plex, Jellyfin, TMDB).
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
    publicDir: path.join(__dirname, 'public'),
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
 *     responses:
 *       200:
 *         description: Prometheus metrics in text format
 *         content:
 *           text/plain:
 *             example: |
 *               # HELP posterrama_http_requests_total Total HTTP requests
 *               # TYPE posterrama_http_requests_total counter
 *               posterrama_http_requests_total{method="GET",path="/api/media",status="200"} 42
 */
app.get('/metrics', async (req, res) => {
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
 *           enum: [poster, background, clearlogo, thumbnail, banner]
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
            if (entryKey === 'trailer') {
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
            if (entryKey === 'trailer') {
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
                if (cached && now - cached.ts < 15000) {
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
    const filePath = path.join(__dirname, 'public', 'wallart.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) {
            logger.error('Error reading wallart.html:', err);
            return res.sendFile(filePath); // Fallback to static file
        }

        // Generate versions inline for immediate availability
        const crypto = require('crypto');
        const generateVersion = assetPath => {
            try {
                const fullPath = path.join(__dirname, 'public', assetPath);
                const stats = fs.statSync(fullPath);
                const hash = crypto
                    .createHash('sha1')
                    .update(stats.mtime.getTime().toString())
                    .digest('hex');
                return hash.substring(0, 6);
            } catch {
                return 'fallback';
            }
        };

        const versions = {
            'wallart/wallart-display.js': generateVersion('wallart/wallart-display.js'),
            'wallart/artist-cards.js': generateVersion('wallart/artist-cards.js'),
            'wallart/wallart.css': generateVersion('wallart/wallart.css'),
            'core.js': generateVersion('core.js'),
            'lazy-loading.js': generateVersion('lazy-loading.js'),
            'device-mgmt.js': generateVersion('device-mgmt.js'),
            'debug-logger.js': generateVersion('debug-logger.js'),
            'client-logger.js': generateVersion('client-logger.js'),
        };

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

// Serve static files - use built version in production, raw files in development
const isProduction = process.env.NODE_ENV === 'production';
let publicDir = isProduction ? path.join(__dirname, 'dist/public') : path.join(__dirname, 'public');

// Auto-build in production if dist/ is missing or outdated
if (isProduction) {
    const { execSync } = require('child_process');

    const distDir = path.join(__dirname, 'dist/public');
    const sourceDir = path.join(__dirname, 'public');
    const hashFile = path.join(__dirname, 'dist/.build-hash');

    const currentHash = calculateDirectoryHash(sourceDir);
    let needsBuild = false;

    if (!fs.existsSync(distDir)) {
        logger.info('[Server] dist/public/ not found, building frontend...');
        needsBuild = true;
    } else if (!fs.existsSync(hashFile)) {
        logger.info('[Server] Build hash not found, rebuilding to ensure consistency...');
        needsBuild = true;
    } else {
        const savedHash = fs.readFileSync(hashFile, 'utf8').trim();
        if (savedHash !== currentHash) {
            logger.info('[Server] public/ directory changed, rebuilding frontend...');
            needsBuild = true;
        }
    }

    if (needsBuild) {
        try {
            logger.info('[Server] Running npm run build...');
            execSync('npm run build', { stdio: 'inherit', cwd: __dirname });

            // Save hash after successful build
            fs.mkdirSync(path.dirname(hashFile), { recursive: true });
            fs.writeFileSync(hashFile, currentHash, 'utf8');

            logger.info('[Server] Frontend build completed successfully');
        } catch (err) {
            logger.error('[Server] Frontend build failed:', err.message);
            logger.warn('[Server] Falling back to public/ directory');
            publicDir = sourceDir;
        }
    } else {
        logger.info('[Server] dist/public/ is up-to-date, skipping build');
    }
}

logger.info(
    `[Server] Static files served from: ${publicDir} (NODE_ENV=${process.env.NODE_ENV || 'development'})`
);
app.use(express.static(publicDir));

// Ensure cache-busted assets are not cached by proxies and mark as must-revalidate
app.use((req, res, next) => {
    if (/[?&]v=|[?&]cb=/.test(req.url)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(express.json({ limit: '10mb' })); // For parsing JSON payloads

// Apply new optimization middleware
// Fixed compression middleware - now respects Accept-Encoding properly
app.use(compressionMiddleware());
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(requestLoggingMiddleware());
// In test environment, optionally log requests; only seed session for safe idempotent reads (GET/HEAD)
if (env.server.nodeEnv === 'test') {
    app.use((req, _res, next) => {
        if (env.logging.printAuthDebug) {
            // Replaced raw console.log with logger.debug (pre-review enforcement)
            logger.debug('[REQ]', req.method, req.path, 'Auth:', req.headers.authorization || '');
        }
        // Only seed a session automatically for benign, non-sensitive reads in tests.
        // Never auto-seed for /api/devices* so unauthenticated access can be correctly tested.
        if ((req.method === 'GET' || req.method === 'HEAD') && req.path.startsWith('/api/groups')) {
            req.session = req.session || {};
            req.session.user = req.session.user || { username: 'test-admin' };
        }
        next();
    });
}
// Admin guard alias (module-scope so routes outside feature blocks can use it)
const adminAuth = createAdminAuth({ isAuthenticated, logger });
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

async function getJellyfinQualitiesWithCounts(serverConfig) {
    return ratingsUtil.getJellyfinQualitiesWithCounts({
        serverConfig,
        getJellyfinClient,
        getJellyfinLibraries,
        isDebug,
        logger,
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
    wsHub,
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
adminCacheRouter.initCacheReferences(cacheManager, apiCache);

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

// Device Presets storage (simple JSON file)
/**
 * @swagger
 * /api/admin/device-presets:
 *   get:
 *     summary: Get device presets
 *     description: Returns the list of saved device presets for quick per-device overrides.
 *     tags: ['Admin', 'Devices']
 *     security:
 *       - sessionAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of device presets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                     description: Preset identifier
 *                   label:
 *                     type: string
 *                     description: Human-friendly name
 *                   settings:
 *                     type: object
 *                     description: Settings override payload applied when preset is used
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to read presets
 */
// Admin: get device presets (JSON)
app.get('/api/admin/device-presets', adminAuth, async (req, res) => {
    try {
        const list = await readPresets(__dirname);
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: 'presets_read_failed' });
    }
});

/**
 * @swagger
 * /api/admin/device-presets:
 *   put:
 *     summary: Replace device presets
 *     description: Replaces the entire device presets list. Provide an array of presets with unique keys.
 *     tags: ['Admin', 'Devices']
 *     security:
 *       - sessionAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required: [key]
 *               properties:
 *                 key:
 *                   type: string
 *                   description: Preset identifier (must be unique)
 *                 label:
 *                   type: string
 *                 settings:
 *                   type: object
 *     responses:
 *       200:
 *         description: Presets replaced
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/StandardOkResponse'
 *                 - type: object
 *                   properties:
 *                     count: { type: integer }
 *       400:
 *         description: Validation error (array required or invalid entries)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to write presets
 */
// Admin: replace device presets (JSON)
app.put(
    '/api/admin/device-presets',
    adminAuth,
    express.json({ limit: '1mb' }),
    async (req, res) => {
        try {
            const body = req.body;
            if (!Array.isArray(body)) return res.status(400).json({ error: 'array_required' });
            // Light validation: key must be string
            const ok = body.every(p => p && typeof p.key === 'string');
            if (!ok) return res.status(400).json({ error: 'invalid_entries' });
            await writePresets(body, __dirname);
            res.json({ ok: true, count: body.length });
        } catch (e) {
            res.status(500).json({ error: 'presets_write_failed' });
        }
    }
);

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

        const genres = await getPlexMusicGenres(plexServer, library);
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
            library,
            parseInt(limit, 10),
            parseInt(offset, 10)
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
    res.sendFile(path.join(__dirname, 'public', 'api-docs-scalar.html'));
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
    const hasOldVersionParam = queryParams.v && !/^\d+$/.test(queryParams.v);

    if (hasOldVersionParam) {
        // Redirect to clean URL with cache-busting timestamp
        const cleanUrl = `/admin?_refresh=${Date.now()}`;
        logger.info(`Redirecting old cached version (v=${queryParams.v}) to latest`);
        return res.redirect(302, cleanUrl);
    }

    // If setup is done, the isAuthenticated middleware will handle the rest
    isAuthenticated(req, res, () => {
        // Generate cache buster based on file modification times for better caching
        const cssPath = path.join(__dirname, 'public', 'admin.css');
        const jsPath = path.join(__dirname, 'public', 'admin.js');

        try {
            const cssStats = fs.statSync(cssPath);
            const jsStats = fs.statSync(jsPath);
            const cssCacheBuster = cssStats.mtime.getTime();
            const jsCacheBuster = jsStats.mtime.getTime();

            // Read admin.html and inject cache busters
            fs.readFile(path.join(__dirname, 'public', 'admin.html'), 'utf8', (err, data) => {
                if (err) {
                    logger.error('Error reading admin.html:', err);
                    return res.status(500).send('Internal Server Error');
                }

                // Replace version parameters with file-based cache busters
                const updatedHtml = data
                    // Replace any existing query string after admin.css?v=... (including extra params)
                    .replace(/admin\.css\?v=[^"&\s]+/g, `admin.css?v=${cssCacheBuster}`)
                    // Replace any existing query string after admin.js?v=... (including extra params)
                    .replace(/admin\.js\?v=[^"&\s]+/g, `admin.js?v=${jsCacheBuster}`);

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
        } catch (error) {
            // Fallback to timestamp-based cache buster if file stats fail
            logger.warn(
                'Could not read file stats for cache busting, using timestamp fallback:',
                error.message
            );
            const fallbackCacheBuster = Date.now();

            fs.readFile(path.join(__dirname, 'public', 'admin.html'), 'utf8', (err, data) => {
                if (err) {
                    logger.error('Error reading admin.html:', err);
                    return res.status(500).send('Internal Server Error');
                }

                const updatedHtml = data
                    .replace(/admin\.css\?v=[^"&\s]+/g, `admin.css?v=${fallbackCacheBuster}`)
                    .replace(/admin\.js\?v=[^"&\s]+/g, `admin.js?v=${fallbackCacheBuster}`);

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
        }
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
app.get('/admin/logs', isAuthenticated, (req, res) => {
    // This route serves the dedicated live log viewer page with auto-versioning.
    const filePath = path.join(__dirname, 'public', 'logs.html');
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

// Groups management routes (modularized)
const createGroupsRouter = require('./routes/groups');
app.use('/api/groups', createGroupsRouter({ adminAuth, cacheManager }));

// Public configuration route (modularized)
const createConfigPublicRouter = require('./routes/config-public');
app.use(
    '/get-config',
    createConfigPublicRouter({
        config,
        validateGetConfigQuery,
        cacheMiddleware,
        isDebug,
        deviceStore,
        groupsStore,
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
if (isDeviceMgmtEnabled(__dirname)) {
    // Test session shim now imported from middleware/

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
}

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
        cacheMiddleware,
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
                const timeoutConfig = require('./config/');
                setTimeout(
                    () => process.exit(0),
                    timeoutConfig.getTimeout('processGracefulShutdown')
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

        // Restart PM2 to clear environment cache
        restartPM2ForEnvUpdate('password changed');

        if (isDebug)
            logger.debug(
                '[Admin API] Password changed successfully. Invalidating current session for security.'
            );

        // For security, destroy the current session after a password change,
        // forcing the user to log in again with their new credentials.
        req.session.destroy(err => {
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
                diskUsage = {
                    available: `${totalSpaceGB} GB available`,
                    status: totalSpaceGB > 5 ? 'success' : totalSpaceGB > 1 ? 'warning' : 'error',
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
                    usedGB: Number(toGB(usedMem).toFixed(1)),
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
 *                   example: "1.7.6"
 *       401:
 *         description: Unauthorized
 */
app.get(
    '/api/admin/version',
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
 *                   example: "1.5.0"
 *                 latestVersion:
 *                   type: string
 *                   example: "1.6.0"
 *                 hasUpdate:
 *                   type: boolean
 *                   example: true
 *                 updateType:
 *                   type: string
 *                   example: "minor"
 *                 releaseUrl:
 *                   type: string
 *                   example: "https://github.com/Posterrama/posterrama/releases/tag/v1.6.0"
 *                 downloadUrl:
 *                   type: string
 *                   example: "https://github.com/Posterrama/posterrama/archive/v1.6.0.tar.gz"
 *                 releaseNotes:
 *                   type: string
 *                   example: "### New Features\n- Added GitHub integration"
 *                 publishedAt:
 *                   type: string
 *                   example: "2025-08-15T20:00:00Z"
 *                 releaseName:
 *                   type: string
 *                   example: "Version 1.6.0 - GitHub Integration"
 */
app.get(
    '/api/admin/update-check',
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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 20);
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
 *                 example: "1.6.0"
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
                user: req.user?.username,
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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            let status = autoUpdater.getStatus();
            let isUpdating = autoUpdater.isUpdating();

            // If not actively updating in this process, try to read the last known status
            if (!isUpdating) {
                const path = require('path');
                const fs = require('fs');
                const statusFile = path.resolve(__dirname, 'logs', 'updater-status.json');
                try {
                    if (fs.existsSync(statusFile)) {
                        const parsed = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
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
                                    fs.writeFileSync(statusFile, JSON.stringify(normalized));
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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            if (autoUpdater.isUpdating()) {
                return res
                    .status(400)
                    .json({ error: 'Cannot rollback while update is in progress' });
            }

            logger.info('Rollback initiated by admin', { user: req.user?.username });

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
                user: req.user?.username,
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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const mqttBridge = global.__posterramaMqttBridge;

        if (!mqttBridge) {
            return res.json({
                enabled: false,
                connected: false,
                message: 'MQTT integration is not enabled',
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
                if (
                    key.startsWith('media:') ||
                    key.startsWith('plex:') ||
                    key.startsWith('tmdb:') ||
                    false
                ) {
                    itemCount.media++;
                } else if (key.startsWith('config:')) {
                    itemCount.config++;
                } else if (key.startsWith('image:')) {
                    itemCount.image++;
                }
            }

            const response = {
                diskUsage,
                itemCount,
                cacheStats: {
                    hits: cacheStats.hits,
                    misses: cacheStats.misses,
                    hitRate: cacheStats.hitRate,
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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const { tier } = req.query;

        if (isDebug) {
            logger.debug('[Admin API] Cache clear request', { tier: tier || 'all' });
        }

        try {
            let cleared = 0;
            let message = '';

            if (tier) {
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
                if (!validTiers.includes(tier)) {
                    throw new ApiError(
                        400,
                        `Invalid tier '${tier}'. Valid tiers: ${validTiers.join(', ')}`
                    );
                }

                // Count entries in this tier before clearing
                const tierPrefix = `tier:${tier}:`;
                for (const key of cacheManager.cache.keys()) {
                    if (key.startsWith(tierPrefix)) {
                        cacheManager.delete(key);
                        cleared++;
                    }
                }

                message = `Cleared ${cleared} entries from '${tier}' tier`;
                logger.info('[Admin API] Cache tier cleared', { tier, cleared });
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
 * /api/admin/config:
 *   post:
 *     summary: Update server configuration (partial)
 *     tags: ['Admin']
 *     security:
 *       - sessionAuth: []
 *     x-codeSamples:
 *       - lang: 'curl'
 *         label: 'Update Screensaver Interval'
 *         source: |
 *           curl -X POST http://localhost:4000/api/admin/config \
 *             -H "Content-Type: application/json" \
 *             -H "Cookie: connect.sid=your-session" \
 *             -d '{
 *               "config": {
 *                 "screensaverInterval": 5000
 *               }
 *             }'
 *       - lang: 'JavaScript'
 *         label: 'Configure Plex Source'
 *         source: |
 *           fetch('http://localhost:4000/api/admin/config', {
 *             method: 'POST',
 *             headers: { 'Content-Type': 'application/json' },
 *             credentials: 'include',
 *             body: JSON.stringify({
 *               config: {
 *                 plex: {
 *                   enabled: true,
 *                   baseUrl: 'http://192.168.1.100:32400',
 *                   token: 'YOUR_PLEX_TOKEN',
 *                   libraries: ['Movies', 'TV Shows']
 *                 }
 *               }
 *             })
 *           });
 *       - lang: 'Python'
 *         label: 'Enable Local Directory'
 *         source: |
 *           import requests
 *           session = requests.Session()
 *           session.post('http://localhost:4000/admin/login',
 *                        data={'username': 'admin', 'password': 'pass'})
 *           session.post('http://localhost:4000/api/admin/config',
 *             json={'config': {
 *               'localDirectory': {
 *                 'enabled': True,
 *                 'rootPath': '/mnt/media/posterrama'
 *               }
 *             }})
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               config:
 *                 type: object
 *                 description: Partial config to deep-merge into config.json
 *           examples:
 *             screensaver:
 *               summary: Update screensaver settings
 *               value:
 *                 config:
 *                   screensaverInterval: 5000
 *                   transitionDuration: 2000
 *                   randomOrder: true
 *             plex:
 *               summary: Configure Plex connection
 *               value:
 *                 config:
 *                   plex:
 *                     enabled: true
 *                     baseUrl: 'http://192.168.1.100:32400'
 *                     token: 'YOUR_PLEX_TOKEN'
 *                     libraries: ['Movies', 'TV Shows']
 *             jellyfin:
 *               summary: Configure Jellyfin connection
 *               value:
 *                 config:
 *                   jellyfin:
 *                     enabled: true
 *                     baseUrl: 'http://192.168.1.100:8096'
 *                     apiKey: 'YOUR_API_KEY'
 *                     userId: 'YOUR_USER_ID'
 *                     libraries: ['Movies']
 *     responses:
 *       200:
 *         description: Configuration updated
 */
app.post(
    '/api/admin/config',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const body = req.body || {};
            const incoming = body.config || {};
            // Load current config and deep-merge
            const current = await readConfig();
            const merged = deepMerge({}, current, incoming);
            await writeConfig(merged, config);

            // Invalidate /get-config cache so changes are immediately visible
            try {
                if (
                    typeof apiCache !== 'undefined' &&
                    apiCache &&
                    typeof apiCache.clearPattern === 'function'
                ) {
                    apiCache.clearPattern('/get-config');
                    logger.debug('Cleared /get-config cache after config update');
                }
            } catch (e2) {
                logger.warn('Cache invalidation failed', { error: e2?.message });
            }

            // If cache section changed, update CacheDiskManager live
            if (incoming && Object.prototype.hasOwnProperty.call(incoming, 'cache')) {
                try {
                    const c = merged.cache || {};
                    if (cacheDiskManager && typeof cacheDiskManager.updateConfig === 'function') {
                        cacheDiskManager.updateConfig(c);
                    }
                } catch (e2) {
                    logger.warn('Live cache config update failed', { error: e2?.message });
                }
            }

            // Prevent caching and include effective cache config so UI can update immediately
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            const effective = getCacheConfig();
            try {
                if (typeof broadcastAdminEvent === 'function') {
                    broadcastAdminEvent('config-updated', {
                        at: Date.now(),
                        keys: Object.keys(incoming || {}),
                        cacheConfig: effective,
                    });
                }
            } catch (_) {
                /* ignore broadcast errors */
            }
            res.json({ success: true, config: merged, cache: { cacheConfig: effective } });
        } catch (e) {
            res.status(500).json({ error: 'config_write_failed', message: e?.message || 'error' });
        }
    })
);

/**
 * @swagger
 * /api/admin/source-status:
 *   get:
 *     summary: Get per-source status for admin UI
 *     description: Returns enabled/configured flags and lastFetch timestamps for Plex, Jellyfin, and TMDB.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Per-source status
 */
app.get(
    '/api/admin/source-status',
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
                if (fs.existsSync(cacheDir)) {
                    try {
                        const files = fs
                            .readdirSync(cacheDir)
                            .filter(
                                file =>
                                    file.endsWith('.json') ||
                                    file.endsWith('.jpg') ||
                                    file.endsWith('.png') ||
                                    file.endsWith('.webp')
                            );

                        // Sort files by modification time (oldest first)
                        const fileStats = files
                            .map(file => {
                                const filePath = path.join(cacheDir, file);
                                const stats = fs.statSync(filePath);
                                return { file, filePath, mtime: stats.mtime, size: stats.size };
                            })
                            .sort((a, b) => a.mtime - b.mtime);

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
                                fs.unlinkSync(oldestFile.filePath);
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
                                fs.unlinkSync(oldFile.filePath);
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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await writeEnvFile({ API_ACCESS_TOKEN: newApiKey });

        // Restart PM2 to clear environment cache
        restartPM2ForEnvUpdate('API key generated');

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
    isAuthenticated,
    asyncHandler(async (req, res) => {
        await writeEnvFile({ API_ACCESS_TOKEN: '' });

        // Restart PM2 to clear environment cache
        restartPM2ForEnvUpdate('API key revoked');

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
 *     summary: Get Plex users with access to this server
 *     description: >
 *       Returns a list of all Plex users (including owner and shared users) who have access to the server.
 *       Useful for filtering Now Playing sessions by specific users.
 *     tags: ['Admin', 'Plex']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Plex users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       username:
 *                         type: string
 *                       title:
 *                         type: string
 *                       email:
 *                         type: string
 *                       thumb:
 *                         type: string
 *       404:
 *         description: No Plex server configured
 *       500:
 *         description: Failed to fetch users from Plex
 */
app.get(
    '/api/plex/users',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const mediaServers = config.mediaServers || [];
        const plexServer = mediaServers.find(s => s.type === 'plex' && s.enabled);

        if (!plexServer) {
            return res.status(404).json({ error: 'No Plex server configured', users: [] });
        }

        try {
            const plex = await getPlexClient(plexServer);
            if (!plex) {
                return res.status(500).json({ error: 'Failed to connect to Plex', users: [] });
            }

            const users = [];

            // Method 1: Get users from recent sessions
            const poller = global.__posterramaSessionsPoller;
            if (poller) {
                const sessionData = poller.getSessions();
                const sessions = sessionData?.sessions || [];
                const seenUsers = new Set();

                sessions.forEach(session => {
                    const username = session.User?.title || session.username;
                    if (username && !seenUsers.has(username)) {
                        seenUsers.add(username);
                        users.push({
                            id: session.User?.id,
                            username: username,
                            title: username,
                            thumb: session.User?.thumb,
                        });
                    }
                });
            }

            // Method 2: Try to get account owner info
            try {
                const identity = await plex.query('/identity');
                const ownerName =
                    identity?.MediaContainer?.friendlyName ||
                    identity?.MediaContainer?.machineIdentifier;
                if (ownerName && !users.find(u => u.username === ownerName)) {
                    users.unshift({
                        id: 'owner',
                        username: ownerName,
                        title: ownerName,
                    });
                }
            } catch (e) {
                logger.debug('Could not fetch owner info:', e.message);
            }

            // Method 3: Query accounts endpoint (admin only)
            try {
                const accounts = await plex.query('/accounts');
                if (accounts?.MediaContainer?.Account) {
                    const accountList = Array.isArray(accounts.MediaContainer.Account)
                        ? accounts.MediaContainer.Account
                        : [accounts.MediaContainer.Account];

                    accountList.forEach(account => {
                        const username = account.name || account.title;
                        if (username && !users.find(u => u.username === username)) {
                            users.push({
                                id: account.id,
                                username: username,
                                title: username,
                                thumb: account.thumb,
                            });
                        }
                    });
                }
            } catch (e) {
                logger.debug('Could not fetch accounts (may require admin):', e.message);
            }

            // Fallback: If no users found, add a placeholder
            if (users.length === 0) {
                users.push({
                    id: 'owner',
                    username: 'Owner',
                    title: 'Owner (Server Owner)',
                });
            }

            res.json({ users });
        } catch (error) {
            logger.error('Failed to fetch Plex users:', error);
            res.status(500).json({ error: 'Failed to fetch users from Plex', users: [] });
        }
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
                    const tempSource = new LocalDirectorySource(
                        config.localDirectory || { rootPath: 'media', enabled: false },
                        logger
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
                await configBackupsRouter.scheduleConfigBackups();
            } catch (e) {
                logger.warn('Failed to initialize config backup scheduler:', e?.message || e);
            }

            // Set up automatic cache cleanup - use configurable interval
            if (config.cache?.autoCleanup !== false) {
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
            setTimeout(() => {
                try {
                    refreshPlaylistCache();
                } catch (_) {
                    /* optional logging only */
                }
            }, 5000);

            // Initialize WebSocket hub once server is listening
            try {
                wsHub.init(httpServer, {
                    path: '/ws/devices',
                    verifyDevice: deviceStore.verifyDevice,
                });
            } catch (e2) {
                logger.warn('[WS] init failed', e2);
            }
        });
        // SSE route is registered earlier (before 404 handler)

        // Initialize MQTT bridge if enabled
        (async () => {
            let mqttBridge = null;
            if (config.mqtt && config.mqtt.enabled) {
                try {
                    logger.info('🔌 Initializing MQTT bridge...');
                    const MqttBridge = require('./utils/mqttBridge');
                    mqttBridge = new MqttBridge(config.mqtt);
                    await mqttBridge.init();

                    // Store globally for access in other routes
                    global.__posterramaMqttBridge = mqttBridge;

                    // Listen to device events for real-time MQTT updates
                    deviceStore.deviceEvents.on('device:updated', async device => {
                        try {
                            await mqttBridge.onDeviceUpdate(device);
                        } catch (error) {
                            logger.error('Error handling device:updated event in MQTT:', error);
                        }
                    });

                    deviceStore.deviceEvents.on('device:registered', async device => {
                        try {
                            await mqttBridge.onDeviceUpdate(device);
                        } catch (error) {
                            logger.error('Error handling device:registered event in MQTT:', error);
                        }
                    });

                    deviceStore.deviceEvents.on('device:patched', async device => {
                        try {
                            await mqttBridge.onDeviceUpdate(device);
                        } catch (error) {
                            logger.error('Error handling device:patched event in MQTT:', error);
                        }
                    });

                    deviceStore.deviceEvents.on('device:deleted', async device => {
                        try {
                            await mqttBridge.onDeviceDelete(device);
                        } catch (error) {
                            logger.error('Error handling device:deleted event in MQTT:', error);
                        }
                    });

                    logger.info('✅ MQTT bridge initialized successfully');
                } catch (mqttError) {
                    logger.error('❌ Failed to initialize MQTT bridge:', mqttError);
                    // Don't crash the server if MQTT fails
                }
            } else {
                logger.debug('MQTT integration disabled in configuration');
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

        // Start sync-tick broadcaster even if initial fetch failed
        try {
            if (!global.__posterramaSyncTicker) {
                const minMs = 2000;
                global.__posterramaSyncTicker = setInterval(() => {
                    try {
                        const periodMs = Math.max(
                            minMs,
                            Number(config.transitionIntervalSeconds || 15) * 1000
                        );
                        const now = Date.now();
                        const nextAt = Math.ceil(now / periodMs) * periodMs;
                        const msToNext = nextAt - now;
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
        const siteApp = express();
        const sitePort = config.siteServer.port || 4001;
        const mainAppUrl = `http://localhost:${port}`; // 'port' is the main app's port

        // A simple proxy for API requests to the main application.
        // This ensures that the public site can fetch data without exposing admin endpoints.
        const proxyApiRequest = async (req, res) => {
            const targetUrl = `${mainAppUrl}${req.originalUrl}`;
            try {
                if (isDebug)
                    logger.debug(`[Site Server Proxy] Forwarding request to: ${targetUrl}`);
                const response = await fetch(targetUrl);

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
        siteApp.get('/get-media-by-key/:key', proxyApiRequest);
        siteApp.get('/image', proxyApiRequest);
        siteApp.get('/local-posterpack', proxyApiRequest);

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
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
        siteApp.use(express.static(publicDir));

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
                logger.debug(
                    `Public site server is enabled and running on http://localhost:${sitePort}`
                );
            });
            // Also handle async errors emitted by the server after listen
            siteServerInstance.on('error', err => {
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
app.cleanup = cleanup;

// Handle process termination
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

// --- Admin SSE: /api/admin/events (logs + alerts) ---
// Register BEFORE the 404 handler so it isn't shadowed.
try {
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
            // Also broadcast to adminSseClients (older handler above) if available
            try {
                if (
                    typeof adminSseClients !== 'undefined' &&
                    adminSseClients &&
                    adminSseClients.size
                ) {
                    for (const res of adminSseClients) {
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
    if (!global.__adminSSECleanup) {
        global.__adminSSECleanup = () => {
            try {
                logger.events.off('log', __onLog);
            } catch (_) {
                /* ignore */
            }
            __sseClients.clear();
        };
    }
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
