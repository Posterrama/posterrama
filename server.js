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
const {
    sseDbg,
    getLocalIPAddress,
    getAvatarPath,
    isDeviceMgmtEnabled,
} = require('./lib/utils-helpers');
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
    clearPlexClients,
    getPlexLibraries,
    getPlexGenres,
    getPlexGenresWithCounts,
    getPlexQualitiesWithCounts,
    processPlexItem,
} = require('./lib/plex-helpers');
const {
    invalidateJellyfinClient,
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
    clearPlaylistCache,
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

const config = require('./config.json');

// Make writeConfig available globally for MQTT capability handlers
// Wrapper function that passes the config object automatically
global.writeConfig = newConfig => writeConfig(newConfig, config);

const swaggerUi = require('swagger-ui-express');
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
    readScheduleConfig: cfgReadSchedule,
    writeScheduleConfig: cfgWriteSchedule,
} = require('./utils/configBackup');
const ecosystemConfig = require('./ecosystem.config.js');
const { shuffleArray } = require('./utils.js');

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
    TOTAL_CAP: 500, // Max total items in final playlist
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
const app = express();
const { ApiError, NotFoundError } = require('./utils/errors.js');
const ratingCache = require('./utils/rating-cache.js');
// Device management bypass (IP allow list)
const { deviceBypassMiddleware } = require('./middleware/deviceBypass');

// Use process.env with a fallback to config.json
const port = process.env.SERVER_PORT || config.serverPort || 4000;
const isDebug = process.env.DEBUG === 'true';

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
initializeCache(logger);

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
let jobQueue = localDirInit.jobQueue;
let localDirectorySource = localDirInit.localDirectorySource;
let uploadMiddleware = localDirInit.uploadMiddleware;

// Metrics system
const metricsManager = require('./utils/metrics');
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

app.use(
    session({
        store: __fileStore,
        name: 'posterrama.sid',
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true, // Extend session lifetime on each request
        proxy: process.env.NODE_ENV === 'production',
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
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
        const slowReqMs = Number(process.env.SLOW_REQUEST_WARN_MS || 3000);
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
 *     summary: Get configuration (v1 API alias)
 *     description: Version 1 API alias that redirects to the main configuration endpoint /get-config
 *     tags: ['Public API']
 *     responses:
 *       200:
 *         description: Configuration data (handled by /get-config endpoint)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Config'
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
 *     summary: Get media data (v1 API alias)
 *     description: Version 1 API alias that redirects to the main media endpoint /get-media
 *     tags: ['Public API']
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter media
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by year
 *       - in: query
 *         name: genre
 *         schema:
 *           type: string
 *         description: Filter by genre
 *     responses:
 *       200:
 *         description: Media data (handled by /get-media endpoint)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MediaItem'
 */
app.get('/api/v1/media', (req, res) => {
    req.url = '/get-media';
    req.originalUrl = '/get-media';
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
});
app.use('/', frontendPagesRouter);

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

            // Allow only known entry types
            const allowed = new Set(['poster', 'background', 'clearlogo', 'thumbnail', 'banner']);
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

            // Preferred extensions order
            const exts = ['jpg', 'jpeg', 'png', 'webp'];
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

            const allowed = new Set(['poster', 'background', 'clearlogo', 'thumbnail', 'banner']);
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

            const exts = ['jpg', 'jpeg', 'png', 'webp'];
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
            const perfTrace = String(process.env.PERF_TRACE_ADMIN || '').toLowerCase() === 'true';
            const reqStart = Date.now();
            const timeoutMs = Number(process.env.ADMIN_FILTER_PREVIEW_TIMEOUT_MS) || 8000;
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
                            const pageSize = Math.max(
                                1,
                                Number(process.env.PLEX_PREVIEW_PAGE_SIZE || 200)
                            );
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
                            const pageSize = Math.max(
                                1,
                                Number(process.env.JF_PREVIEW_PAGE_SIZE || 1000)
                            );
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

// Redirect /setup.html to /admin/setup for consistency (must be before static middleware)

// Redirect /setup.html to /admin/setup for consistency (must be before static middleware)
/**
 * @swagger
 * /setup.html:
 *   get:
 *     summary: Redirect to admin setup
 *     description: Redirects legacy setup.html requests to the unified admin setup route
 *     tags: ['Frontend']
 *     responses:
 *       302:
 *         description: Redirect to /admin/setup
 */
app.get('/setup.html', (req, res) => {
    // Preserve any query string (e.g., ?complete=1) so the setup completion logic can run
    const originalUrl = req.originalUrl || req.url || '/setup.html';
    const queryIndex = originalUrl.indexOf('?');
    const query = queryIndex !== -1 ? originalUrl.substring(queryIndex) : '';
    res.redirect(`/admin/setup${query}`);
});

// Redirect /login.html to /admin/login for consistency (must be before static middleware)
/**
 * @swagger
 * /login.html:
 *   get:
 *     summary: Redirect to admin login
 *     description: Redirects legacy login.html requests to the unified admin login route
 *     tags: ['Frontend']
 *     responses:
 *       302:
 *         description: Redirect to /admin/login
 */
app.get('/login.html', (req, res) => {
    res.redirect('/admin/login');
});

// Redirect /2fa-verify.html to /admin/login if not in 2FA flow (must be before static middleware)
/**
 * @swagger
 * /2fa-verify.html:
 *   get:
 *     summary: Serve 2FA verification page or redirect
 *     description: >
 *       Serves the 2FA verification page if user is in an active 2FA flow,
 *       otherwise redirects to login page for security.
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: 2FA verification page HTML
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       302:
 *         description: Redirect to /admin/login if not in 2FA flow
 */
app.get('/2fa-verify.html', (req, res) => {
    // Only allow access to 2FA page if user is in the middle of 2FA verification
    if (req.session && req.session.tfa_required) {
        res.sendFile(path.join(__dirname, 'public', '2fa-verify.html'));
    } else {
        res.redirect('/admin/login');
    }
});

// Cache busting middleware for admin assets
/**
 * @swagger
 * /admin.css:
 *   get:
 *     summary: Serve admin CSS with cache busting
 *     description: Serves the admin panel CSS file with no-cache headers to ensure latest version is always loaded
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Admin CSS file
 *         content:
 *           text/css:
 *             schema:
 *               type: string
 */
app.get('/admin.css', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'admin.css'));
});

/**
 * @swagger
 * /admin.js:
 *   get:
 *     summary: Serve admin JavaScript with cache busting
 *     description: Serves the admin panel JavaScript file with no-cache headers to ensure latest version is always loaded
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Admin JavaScript file
 *         content:
 *           application/javascript:
 *             schema:
 *               type: string
 */
app.get('/admin.js', (req, res) => {
    // Aggressive cache-busting for admin.js to ensure users always get latest version
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.setHeader('ETag', `"${Date.now()}"`);
    res.sendFile(path.join(__dirname, 'public', 'admin.js'));
});

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

// Protect logs.html from public access - require authentication
app.get('/logs.html', isAuthenticated, (req, res, _next) => {
    // Redirect to admin/logs route instead
    res.redirect('/admin/logs');
});

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

app.use(express.static(path.join(__dirname, 'public')));

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
if (process.env.NODE_ENV === 'test') {
    app.use((req, _res, next) => {
        if (process.env.PRINT_AUTH_DEBUG === '1') {
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
    ApiError,
    asyncHandler,
    isAuthenticated,
    createPlexClient,
    createJellyfinClient,
    serverIPAddress,
    port,
});
app.use('/', adminConfigRouter);

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
 *       - isAuthenticated: []
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

    // Generate fresh swagger spec
    delete require.cache[require.resolve('./swagger.js')];
    const freshSwaggerSpecs = require('./swagger.js');

    res.json(freshSwaggerSpecs);
});

// Swagger API documentation with cache busting
app.use(
    '/api-docs',
    (req, res, next) => {
        // Prevent caching of API documentation
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('ETag', Math.random().toString()); // Force unique response
        next();
    },
    swaggerUi.serve,
    (req, res, next) => {
        // Generate fresh swagger spec on each request to avoid version caching
        delete require.cache[require.resolve('./swagger.js')];
        const freshSwaggerSpecs = require('./swagger.js');

        swaggerUi.setup(freshSwaggerSpecs, {
            // Force Swagger UI to use our custom endpoint with cache busting
            swaggerOptions: {
                url: `/api-docs/swagger.json?t=${Date.now()}`,
                persistAuthorization: true,
                // Disable all caching in Swagger UI
                requestInterceptor: function (request) {
                    request.headers['Cache-Control'] = 'no-cache';
                    return request;
                },
            },
            // Add custom HTML to override any cached content
            customSiteTitle: `Posterrama API v${require('./package.json').version}`,
            customfavIcon: '/favicon.ico',
        })(req, res, next);
    }
);

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
            req.originalUrl.startsWith('/api/v1/metrics');

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
                    console.error('Error reading admin.html:', err);
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
            console.warn(
                'Could not read file stats for cache busting, using timestamp fallback:',
                error.message
            );
            const fallbackCacheBuster = Date.now();

            fs.readFile(path.join(__dirname, 'public', 'admin.html'), 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading admin.html:', err);
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
 *       - isAuthenticated: []
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
            console.error('Error reading logs.html:', err);
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
app.use(
    '/admin',
    createAuthRouter({
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
    })
);

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
    cfgReadSchedule,
    cfgWriteSchedule,
    broadcastAdminEvent,
});
app.use('/', configBackupsRouter);

// Backward-compatible alias for /api/health (documented in swagger but previously missing implementation)
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
            const underPm2 = !!process.env.PM2_HOME;
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
                setTimeout(() => process.exit(0), 250);
            }
        } catch (e) {
            try {
                logger.error('[Admin Restart] Unexpected failure', { error: e?.message });
            } catch (_) {
                // best-effort logging
            }
            if (!process.env.PM2_HOME) setTimeout(() => process.exit(0), 250);
        }
    }, 200);
});

// --- Local Directory API Endpoints ---

/**
 * @swagger
 * /api/local/scan:
 *   post:
 *     summary: Scan local media directories
 *     description: Rescan posters/backgrounds/motion folders and generate missing metadata files
 *     tags: ['Local Directory']
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               createMetadata:
 *                 type: boolean
 *                 description: Create missing *.poster.json metadata files
 *                 default: true
 *     responses:
 *       200:
 *         description: Scan completed
 *       404:
 *         description: Local directory not enabled
 */
app.post(
    '/api/local/scan',
    express.json(),
    asyncHandler(async (req, res) => {
        if (!config.localDirectory?.enabled || !localDirectorySource) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }
        try {
            const { createMetadata = true } = req.body || {};
            const summary = await localDirectorySource.rescan({ createMetadata });
            return res.json({ success: summary.success, ...summary });
        } catch (e) {
            logger.error('Local rescan failed:', e);
            return res.status(500).json({ error: e.message || 'scan_failed' });
        }
    })
);

/**
 * @swagger
 * /api/local/browse:
 *   get:
 *     summary: Browse local directory structure
 *     description: Get directory contents and file information for local media management
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *         description: Relative path to browse (defaults to root)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, directories, files, media]
 *         description: Filter results by type
 *     responses:
 *       200:
 *         description: Directory contents
 *       404:
 *         description: Directory not found
 *       500:
 *         description: Server error
 */
app.get(
    '/api/local/browse',
    asyncHandler(async (req, res) => {
        // Permit browsing even if Local source is disabled for playlist purposes.
        if (!localDirectorySource) {
            try {
                localDirectorySource = new LocalDirectorySource(config.localDirectory, logger);
            } catch (e) {
                return res.status(500).json({ error: 'Local directory unavailable' });
            }
        }

        const { path: relativePath = '', type = 'all' } = req.query;

        try {
            // Prevent intermediaries from caching directory listings; sizes should reflect realtime state
            res.setHeader('Cache-Control', 'no-store');
            const contents = await localDirectorySource.browseDirectory(relativePath, type);
            res.json(contents);
        } catch (error) {
            logger.error('Local directory browse error:', error);
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'Directory not found' });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    })
);

/**
 * @swagger
 * /api/local/search:
 *   get:
 *     summary: Recursively search for files and folders in local directory
 *     description: Searches recursively through all subdirectories for matching files and folders
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query string
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *         description: Starting path for search (defaults to root)
 *     responses:
 *       200:
 *         description: Array of matching items
 *       500:
 *         description: Server error
 */
app.get(
    '/api/local/search',
    asyncHandler(async (req, res) => {
        if (!localDirectorySource) {
            try {
                localDirectorySource = new LocalDirectorySource(config.localDirectory, logger);
            } catch (e) {
                return res.status(500).json({ error: 'Local directory unavailable' });
            }
        }

        const { query = '', path: startPath = '' } = req.query;
        const searchQuery = String(query).toLowerCase().trim();

        if (!searchQuery) {
            return res.json([]);
        }

        try {
            res.setHeader('Cache-Control', 'no-store');

            const base = path.resolve(config.localDirectory.rootPath);
            const searchRoot = startPath ? path.resolve(base, startPath) : base;

            // Verify search root is within base
            const within =
                searchRoot === base || (searchRoot + path.sep).startsWith(base + path.sep);
            if (!within) {
                return res.status(400).json({ error: 'Invalid path' });
            }

            const results = [];
            const maxResults = 100; // Limit results to prevent overwhelming the UI

            // eslint-disable-next-line no-inner-declarations
            async function searchRecursive(dir, relativePath = '') {
                if (results.length >= maxResults) return;

                try {
                    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

                    for (const entry of entries) {
                        if (results.length >= maxResults) break;

                        const entryPath = path.join(dir, entry.name);
                        const entryRelativePath = relativePath
                            ? `${relativePath}/${entry.name}`
                            : entry.name;

                        // Skip .poster.json files
                        if (entry.name.endsWith('.poster.json')) {
                            continue;
                        }

                        // Check if name matches query
                        if (entry.name.toLowerCase().includes(searchQuery)) {
                            const stats = await fs.promises.stat(entryPath).catch(() => null);
                            const resultPath = startPath
                                ? `${startPath}/${entryRelativePath}`
                                : entryRelativePath;
                            results.push({
                                name: entry.name,
                                path: resultPath,
                                type: entry.isDirectory() ? 'directory' : 'file',
                                sizeBytes: stats && stats.isFile() ? stats.size : null,
                            });
                        }

                        // Recurse into directories
                        if (entry.isDirectory()) {
                            await searchRecursive(entryPath, entryRelativePath);
                        }
                    }
                } catch (error) {
                    // Skip directories we can't read
                    logger.debug(`Search skipped directory: ${dir}`, error.message);
                }
            }

            await searchRecursive(searchRoot);
            res.json(results);
        } catch (error) {
            logger.error('Local directory search error:', error);
            res.status(500).json({ error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/local/download:
 *   get:
 *     summary: Download a single file from the local directory
 *     description: Streams a single file to the client after validating the path is within the configured root
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Absolute or relative path to the file under the local root
 *     responses:
 *       200:
 *         description: File stream
 *       400:
 *         description: Invalid request or path
 *       404:
 *         description: File not found
 */
app.get(
    '/api/local/download',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const requestedPath = String(req.query.path || '').trim();
        if (!requestedPath) {
            return res.status(400).json({ error: 'Missing path' });
        }

        try {
            const base = path.resolve(config.localDirectory.rootPath);
            let fullPath;
            if (path.isAbsolute(requestedPath)) {
                const abs = path.resolve(requestedPath);
                fullPath = abs.startsWith(base)
                    ? abs
                    : path.resolve(base, requestedPath.replace(/^\/+/, ''));
            } else {
                fullPath = path.resolve(base, requestedPath);
            }
            // ensure within base
            const within = fullPath === base || (fullPath + path.sep).startsWith(base + path.sep);
            if (!within) return res.status(400).json({ error: 'Invalid path' });

            const st = await fs.promises.stat(fullPath).catch(() => null);
            if (!st || !st.isFile()) return res.status(404).json({ error: 'File not found' });

            const mime = require('mime-types');
            const type = mime.lookup(fullPath) || 'application/octet-stream';
            res.setHeader('Content-Type', type);
            // Set content-disposition using filename only
            const filename = path.basename(fullPath);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.sendFile(fullPath);
        } catch (error) {
            logger.error('Local file download error:', error);
            return res.status(500).json({ error: 'download_failed' });
        }
    })
);

/**
 * @swagger
 * /api/local/download-all:
 *   get:
 *     summary: Download a directory as a ZIP (recursive)
 *     description: Zips a directory under the local root and streams it to the client
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Absolute or relative path to the directory under the local root
 *     responses:
 *       200:
 *         description: ZIP stream
 *       400:
 *         description: Invalid request or path
 *       404:
 *         description: Directory not found
 */
app.get(
    '/api/local/download-all',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const requestedPath = String(req.query.path || '').trim();
        if (!requestedPath) {
            return res.status(400).json({ error: 'Missing path' });
        }
        try {
            const base = path.resolve(config.localDirectory.rootPath);
            let dirPath;
            if (path.isAbsolute(requestedPath)) {
                const abs = path.resolve(requestedPath);
                dirPath = abs.startsWith(base)
                    ? abs
                    : path.resolve(base, requestedPath.replace(/^\/+/, ''));
            } else {
                dirPath = path.resolve(base, requestedPath);
            }
            // ensure within base
            const within = dirPath === base || (dirPath + path.sep).startsWith(base + path.sep);
            if (!within) return res.status(400).json({ error: 'Invalid path' });

            const st = await fs.promises.stat(dirPath).catch(() => null);
            if (!st || !st.isDirectory())
                return res.status(404).json({ error: 'Directory not found' });

            const JSZip = require('jszip');
            const zip = new JSZip();

            const addDirToZip = async (rootDir, zipFolder, rel = '') => {
                const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
                for (const entry of entries) {
                    // Skip internal system dir and generated metadata
                    if (entry.name === '.posterrama' || entry.name.endsWith('.poster.json'))
                        continue;
                    const full = path.join(rootDir, entry.name);
                    const relPath = rel ? path.join(rel, entry.name) : entry.name;
                    if (entry.isDirectory()) {
                        const sub = zipFolder.folder(entry.name);
                        await addDirToZip(full, sub, relPath);
                    } else if (entry.isFile()) {
                        try {
                            const data = await fs.promises.readFile(full);
                            zipFolder.file(entry.name, data);
                        } catch (_) {
                            // Skip unreadable files silently
                        }
                    }
                }
            };

            const folderName = path.basename(dirPath) || 'download';
            const rootZipFolder = zip.folder(folderName);
            await addDirToZip(dirPath, rootZipFolder);

            const ts = new Date();
            const pad = n => String(n).padStart(2, '0');
            const date = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
            const filename = `${folderName}-${date}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            const stream = zip.generateNodeStream({
                type: 'nodebuffer',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
            });
            stream.pipe(res);
        } catch (error) {
            logger.error('Local directory zip download error:', error);
            return res.status(500).json({ error: 'zip_failed' });
        }
    })
);

/**
 * @swagger
 * /api/local/import-posterpacks:
 *   post:
 *     summary: Manage posterpack ZIPs (ZIP-only)
 *     description: ZIPs are never extracted. By default this operation does nothing (manual ZIPs already live under complete/manual). When includeGenerated=true, it copies any ZIPs from complete/plex-export and complete/jellyfin-export into complete/manual for safekeeping.
 *     tags: ['Local Directory']
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               includeGenerated:
 *                 type: boolean
 *                 description: Also import from generated export folders (plex-export, jellyfin-export)
 *                 default: true
 *               refresh:
 *                 type: boolean
 *                 description: Trigger a playlist refresh after import
 *                 default: true
 *     responses:
 *       200:
 *         description: Import completed
 *       404:
 *         description: Local directory not enabled
 */
app.post(
    '/api/local/import-posterpacks',
    express.json(),
    asyncHandler(async (req, res) => {
        if (!config.localDirectory?.enabled || !localDirectorySource) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }
        const { includeGenerated = false, refresh = true } = req.body || {};
        try {
            const imported = await localDirectorySource.importPosterpacks({ includeGenerated });
            if (refresh) {
                try {
                    await refreshPlaylistCache();
                } catch (_) {
                    /* non-fatal */
                }
            }
            return res.json({ success: true, imported });
        } catch (e) {
            logger.error('Local import-posterpacks failed:', e);
            return res.status(500).json({ error: e.message || 'import_failed' });
        }
    })
);

/**
 * @swagger
 * /api/local/upload:
 *   post:
 *     summary: Upload media files to local directory
 *     description: Upload one or more media files with automatic organization. For posterpack ZIPs, use targetDirectory=complete (stored under complete/manual).
 *     tags: ['Local Directory']
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               targetPath:
 *                 type: string
 *                 description: Target directory path
 *     responses:
 *       200:
 *         description: Upload successful
 *       400:
 *         description: Invalid request or files
 *       500:
 *         description: Upload failed
 */
app.post('/api/local/upload', (req, res) => {
    // Permit uploading even if Local source is disabled for playlist purposes.
    if (!uploadMiddleware) {
        return res.status(404).json({ error: 'Local directory support not enabled' });
    }

    uploadMiddleware(req, res, err => {
        if (err) {
            logger.error('Upload error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File size too large' });
            } else if (err.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({ error: err.message });
            }
            return res.status(500).json({ error: err.message });
        }
        try {
            const uploadedFiles = req.files || [];
            const targetDirectory =
                req.body?.targetDirectory || req.query?.targetDirectory || 'posters';
            const targetPath = req.uploadTargetPath || '';

            if (!uploadedFiles.length) {
                return res.status(400).json({ success: false, error: 'No files uploaded' });
            }

            logger.info(
                `Upload completed: ${uploadedFiles.length} files to ${targetDirectory} (${targetPath})`
            );

            const payload = {
                success: true,
                uploadedFiles: uploadedFiles.map(file => ({
                    filename: file.filename,
                    originalName: file.originalname,
                    size: file.size,
                    path: file.path,
                })),
                targetDirectory,
                targetPath,
            };

            // Nudge playlist/media cache so UI pills and screensaver pick up new files immediately
            try {
                if (cacheManager && typeof cacheManager.clear === 'function') {
                    cacheManager.clear('media');
                }
                // Fire-and-forget refresh (does its own locking); do not block upload response
                Promise.resolve(refreshPlaylistCache()).catch(err => {
                    // Non-fatal: background refresh is best-effort after upload
                    logger.debug(
                        'refreshPlaylistCache after upload failed (ignored):',
                        err?.message || err
                    );
                });
            } catch (e) {
                // Non-fatal: cache nudge after upload failed; upload still considered successful
                logger.debug('Post-upload cache nudge failed (ignored):', e?.message || e);
            }

            res.json(payload);
        } catch (e) {
            logger.error('Upload post-processing error:', e);
            res.status(500).json({ success: false, error: 'Upload processing failed' });
        }
    });
});

/**
 * @swagger
 * /api/local/cleanup:
 *   post:
 *     summary: Clean up local directory
 *     description: Remove empty directories, duplicate files, and orphaned metadata
 *     tags: ['Local Directory']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               operations:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [empty-directories, duplicates, orphaned-metadata, unused-images]
 *                 description: Cleanup operations to perform
 *               dryRun:
 *                 type: boolean
 *                 description: Perform dry run without making changes
 *     responses:
 *       200:
 *         description: Cleanup completed
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Cleanup failed
 */
app.post(
    '/api/local/cleanup',
    express.json(),
    asyncHandler(async (req, res) => {
        // Permit cleanup/delete even if Local source is disabled for playlist purposes.
        if (!localDirectorySource) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }

        const { operations = [], dryRun = false } = req.body;

        if (!Array.isArray(operations) || operations.length === 0) {
            return res.status(400).json({ error: 'No cleanup operations specified' });
        }

        try {
            const results = await localDirectorySource.cleanupDirectory(operations, dryRun);
            // After destructive operations, refresh playlist/media cache so UI reflects current state
            try {
                if (!dryRun) {
                    if (cacheManager && typeof cacheManager.clear === 'function') {
                        cacheManager.clear('media');
                    }
                    Promise.resolve(refreshPlaylistCache()).catch(err => {
                        // Non-fatal: background refresh is best-effort after cleanup
                        logger.debug(
                            'refreshPlaylistCache after cleanup failed (ignored):',
                            err?.message || err
                        );
                    });
                }
            } catch (e) {
                // Non-fatal: cache clear/refresh after cleanup failed
                logger.debug('Post-cleanup cache nudge failed (ignored):', e?.message || e);
            }
            res.json({
                success: true,
                dryRun: dryRun,
                results: results,
            });
        } catch (error) {
            logger.error('Cleanup error:', error);
            res.status(500).json({ error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/local/generate-posterpack:
 *   post:
 *     summary: Generate posterpack from media servers
 *     description: Create ZIP archives of posters and metadata from Plex/Jellyfin libraries
 *     tags: ['Local Directory']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceType, libraryIds]
 *             properties:
 *               sourceType:
 *                 type: string
 *                 enum: [plex, jellyfin]
 *                 description: Source media server type
 *               libraryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of library IDs to process
 *               options:
 *                 type: object
 *                 description: Generation options
 *                 properties:
 *                   includeAssets:
 *                     type: object
 *                     description: Asset types to include
 *                   outputNaming:
 *                     type: string
 *                     description: Output filename template
 *     responses:
 *       200:
 *         description: Generation job started
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Local directory or job queue not available
 *       500:
 *         description: Generation failed to start
 */
app.post(
    '/api/local/generate-posterpack',
    express.json(),
    asyncHandler(async (req, res) => {
        if (!config.localDirectory?.enabled || !jobQueue) {
            return res
                .status(404)
                .json({ error: 'Local directory support or job queue not available' });
        }

        const { sourceType, libraryIds, options = {} } = req.body;

        if (!sourceType || !libraryIds || !Array.isArray(libraryIds)) {
            return res.status(400).json({ error: 'sourceType and libraryIds array are required' });
        }

        if (!['plex', 'jellyfin', 'local'].includes(sourceType)) {
            return res.status(400).json({ error: 'sourceType must be plex, jellyfin, or local' });
        }

        try {
            const jobId = await jobQueue.addPosterpackGenerationJob(
                sourceType,
                libraryIds,
                options
            );

            res.json({
                success: true,
                jobId: jobId,
                message: 'Posterpack generation job started',
                sourceType: sourceType,
                libraryCount: libraryIds.length,
            });
        } catch (error) {
            logger.error('Posterpack generation error:', error);
            res.status(500).json({ error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/local/preview-posterpack:
 *   post:
 *     summary: Preview posterpack generation
 *     description: Estimate how many items would be included based on selected source and libraries
 *     tags: ['Local Directory']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceType]
 *             properties:
 *               sourceType:
 *                 type: string
 *                 enum: [plex, jellyfin, local]
 *               libraryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               mediaType:
 *                 type: string
 *               yearRange:
 *                 type: object
 *               limit:
 *                 type: number
 *     responses:
 *       200:
 *         description: Preview data
 *       400:
 *         description: Invalid request
 */
app.post(
    '/api/local/preview-posterpack',
    express.json(),
    asyncHandler(async (req, res) => {
        if (!config.localDirectory?.enabled) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }

        const { sourceType, libraryIds = [], options = {} } = req.body || {};
        const mediaType = options.mediaType || 'all';
        // Use a higher default preview limit; UI hides limit for Local
        const limit = Number(options.limit) || 10000;
        const yearFilterExpr = (options.yearFilter || '').trim();
        const filtersPlex = options.filtersPlex || {};
        const filtersJellyfin = options.filtersJellyfin || {};
        const filtersLocal = options.filtersLocal || {};

        if (!sourceType) return res.status(400).json({ error: 'sourceType is required' });

        const clamp = (n, max) => (Number.isFinite(n) ? Math.max(0, Math.min(n, max)) : 0);

        try {
            let totalItems = 0;
            const perLibrary = [];

            if (sourceType === 'plex') {
                const serverConfig = (config.mediaServers || []).find(s => s.type === 'plex');
                if (!serverConfig)
                    return res.status(400).json({ error: 'No Plex server configured' });
                const plex = await getPlexClient(serverConfig);
                // Build filter helpers
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
                const f = {
                    years: (yearFilterExpr || filtersPlex.years || '').trim(),
                    genres: parseCsv(filtersPlex.genres),
                    ratings: parseCsv(filtersPlex.ratings).map(r => r.toUpperCase()),
                    qualities: parseCsv(filtersPlex.qualities),
                };
                const yearOk = yearTester(f.years);
                for (const id of libraryIds) {
                    try {
                        // For estimation respecting filters, we need to scan items (shallow) and apply filters
                        let start = 0;
                        const pageSize = Math.max(
                            1,
                            Number(process.env.PLEX_PREVIEW_PAGE_SIZE) || 200
                        );
                        let total = 0;
                        let matched = 0;
                        do {
                            const q = `/library/sections/${id}/all?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`;
                            const resp = await plex.query(q);
                            const mc = resp?.MediaContainer;
                            const items = Array.isArray(mc?.Metadata) ? mc.Metadata : [];
                            total = Number(mc?.totalSize || mc?.size || start + items.length);
                            for (const it of items) {
                                // Years
                                if (yearOk) {
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
                                    if (y == null || !yearOk(y)) continue;
                                }
                                // Genres
                                if (f.genres.length) {
                                    const g = Array.isArray(it.Genre)
                                        ? it.Genre.map(x =>
                                              x && x.tag ? String(x.tag).toLowerCase() : ''
                                          )
                                        : [];
                                    if (
                                        !f.genres.some(need =>
                                            g.includes(String(need).toLowerCase())
                                        )
                                    )
                                        continue;
                                }
                                // Ratings
                                if (f.ratings.length) {
                                    const r = it.contentRating
                                        ? String(it.contentRating).trim().toUpperCase()
                                        : null;
                                    if (!r || !f.ratings.includes(r)) continue;
                                }
                                // Qualities
                                if (f.qualities.length) {
                                    const medias = Array.isArray(it.Media) ? it.Media : [];
                                    let ok = false;
                                    for (const m of medias) {
                                        const label = mapResToLabel(m?.videoResolution);
                                        if (f.qualities.includes(label)) {
                                            ok = true;
                                            break;
                                        }
                                    }
                                    if (!ok) continue;
                                }
                                matched++;
                            }
                            start += items.length;
                        } while (start < total && pageSize > 0);
                        perLibrary.push({ id, count: matched });
                        totalItems += matched;
                    } catch (e) {
                        perLibrary.push({ id, count: 0, error: e.message });
                    }
                }
            } else if (sourceType === 'jellyfin') {
                const serverConfig = (config.mediaServers || []).find(s => s.type === 'jellyfin');
                if (!serverConfig)
                    return res.status(400).json({ error: 'No Jellyfin server configured' });
                const client = await getJellyfinClient(serverConfig);
                // Build filter helpers
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
                const f = {
                    years: (yearFilterExpr || filtersJellyfin.years || '').trim(),
                    genres: parseCsv(filtersJellyfin.genres),
                    ratings: parseCsv(filtersJellyfin.ratings).map(r => r.toUpperCase()),
                };
                const yearOk = yearTester(f.years);
                for (const id of libraryIds) {
                    try {
                        // Page and apply filters to estimate count
                        const pageSize = Math.max(
                            1,
                            Number(process.env.JF_PREVIEW_PAGE_SIZE) || 1000
                        );
                        let startIndex = 0;
                        let matched = 0;
                        let fetched;
                        do {
                            const page = await client.getItems({
                                parentId: id,
                                includeItemTypes: ['Movie', 'Series'],
                                recursive: true,
                                // We don't need MediaStreams since we aren't filtering qualities here
                                fields: [
                                    'Genres',
                                    'OfficialRating',
                                    'ProductionYear',
                                    'PremiereDate',
                                ],
                                sortBy: [],
                                limit: pageSize,
                                startIndex,
                            });
                            const items = Array.isArray(page?.Items) ? page.Items : [];
                            fetched = items.length;
                            startIndex += fetched;
                            for (const it of items) {
                                // Year
                                if (yearOk) {
                                    let y = undefined;
                                    if (it.ProductionYear != null) {
                                        const yy = Number(it.ProductionYear);
                                        y = Number.isFinite(yy) ? yy : undefined;
                                    }
                                    if (y == null && it.PremiereDate) {
                                        const d = new Date(it.PremiereDate);
                                        if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                    }
                                    if (y == null || !yearOk(y)) continue;
                                }
                                // Genres
                                if (f.genres.length) {
                                    const g = Array.isArray(it.Genres)
                                        ? it.Genres.map(x => String(x).toLowerCase())
                                        : [];
                                    if (
                                        !f.genres.some(need =>
                                            g.includes(String(need).toLowerCase())
                                        )
                                    )
                                        continue;
                                }
                                // Ratings (MPAA/TV)
                                if (f.ratings.length) {
                                    const r = it.OfficialRating
                                        ? String(it.OfficialRating).trim().toUpperCase()
                                        : null;
                                    if (!r || !f.ratings.includes(r)) continue;
                                }
                                matched++;
                            }
                        } while (fetched === pageSize);
                        perLibrary.push({ id, count: matched });
                        totalItems += matched;
                    } catch (e) {
                        perLibrary.push({ id, count: 0, error: e.message });
                    }
                }
            } else if (sourceType === 'local') {
                totalItems = 0;
            }

            const preview = {
                summary: {
                    sourceType,
                    totalItems,
                    mediaType,
                    limit,
                    filters: {
                        yearFilter: yearFilterExpr,
                        plex: filtersPlex,
                        jellyfin: filtersJellyfin,
                        local: filtersLocal,
                    },
                },
                libraries: perLibrary,
                estimatedToGenerate: clamp(Math.min(totalItems, limit), 10000),
            };
            return res.json(preview);
        } catch (error) {
            logger.error('Preview posterpack failed:', error);
            res.status(500).json({ error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/local/posterpacks:
 *   get:
 *     summary: List generated posterpacks
 *     description: Return generated posterpack ZIP files for the given source (plex/jellyfin/local)
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: source
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plex, jellyfin, local]
 *         description: Source type to list
 *     responses:
 *       200:
 *         description: List of ZIP files
 */
app.get(
    '/api/local/posterpacks',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            if (!config.localDirectory?.enabled) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }
            const source = String(req.query.source || '').toLowerCase();
            if (!['plex', 'jellyfin', 'local'].includes(source)) {
                return res.status(400).json({ error: 'Invalid source' });
            }
            const base = path.resolve(config.localDirectory.rootPath);
            const exportDir = path.join(base, 'complete', `${source}-export`);
            await fs.promises.mkdir(exportDir, { recursive: true });
            const entries = await fs.promises.readdir(exportDir);
            const files = [];
            for (const name of entries) {
                if (!name.toLowerCase().endsWith('.zip')) continue;
                const full = path.join(exportDir, name);
                const st = await fs.promises.stat(full).catch(() => null);
                if (!st || !st.isFile()) continue;
                files.push({
                    name,
                    size: st.size,
                    mtime: st.mtimeMs,
                    downloadUrl: `/api/local/posterpacks/download?source=${encodeURIComponent(source)}&file=${encodeURIComponent(name)}`,
                });
            }
            // Sort newest first
            files.sort((a, b) => b.mtime - a.mtime);
            res.json({ files });
        } catch (e) {
            logger.error('List posterpacks failed:', e);
            res.status(500).json({ error: 'list_failed' });
        }
    })
);

/**
 * @swagger
 * /api/local/posterpacks/download:
 *   get:
 *     summary: Download a single posterpack ZIP
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: source
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plex, jellyfin, local]
 *       - in: query
 *         name: file
 *         required: true
 *         schema:
 *           type: string
 */
app.get(
    '/api/local/posterpacks/download',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const source = String(req.query.source || '').toLowerCase();
            const file = String(req.query.file || '');
            if (!['plex', 'jellyfin', 'local'].includes(source) || !file.endsWith('.zip')) {
                return res.status(400).json({ error: 'Invalid parameters' });
            }
            const base = path.resolve(config.localDirectory.rootPath);
            const exportDir = path.join(base, 'complete', `${source}-export`);
            const full = path.join(exportDir, path.basename(file));
            // Ensure path is within exportDir
            if (!full.startsWith(exportDir)) return res.status(400).json({ error: 'Invalid path' });
            return res.download(full);
        } catch (e) {
            logger.error('Download posterpack failed:', e);
            res.status(500).json({ error: 'download_failed' });
        }
    })
);

/**
 * @swagger
 * /api/local/posterpacks/download-all:
 *   get:
 *     summary: Download all posterpacks for a source as a ZIP
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: source
 *         required: true
 *         schema:
 *           type: string
 *           enum: [plex, jellyfin, local]
 */
app.get(
    '/api/local/posterpacks/download-all',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const source = String(req.query.source || '').toLowerCase();
            if (!['plex', 'jellyfin', 'local'].includes(source)) {
                return res.status(400).json({ error: 'Invalid source' });
            }
            const base = path.resolve(config.localDirectory.rootPath);
            const exportDir = path.join(base, 'complete', `${source}-export`);
            await fs.promises.mkdir(exportDir, { recursive: true });
            const entries = await fs.promises.readdir(exportDir);

            // Build zip stream
            const JSZip = require('jszip');
            const zip = new JSZip();
            for (const name of entries) {
                if (!name.toLowerCase().endsWith('.zip')) continue;
                const full = path.join(exportDir, name);
                const st = await fs.promises.stat(full).catch(() => null);
                if (!st || !st.isFile()) continue;
                const data = await fs.promises.readFile(full);
                zip.file(name, data);
            }

            const filename = `${source}-posterpacks-${Date.now()}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            const stream = zip.generateNodeStream({
                type: 'nodebuffer',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
            });
            stream.pipe(res);
        } catch (e) {
            logger.error('Download-all posterpacks failed:', e);
            res.status(500).json({ error: 'download_all_failed' });
        }
    })
);
/**
 * @swagger
 * /api/local/jobs/{jobId}:
 *   get:
 *     summary: Get job status and progress
 *     description: Retrieve detailed information about a specific background job
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job information
 *       404:
 *         description: Job not found
 */
app.get('/api/local/jobs/:jobId', (req, res) => {
    if (!jobQueue) {
        return res.status(404).json({ error: 'Job queue not available' });
    }

    const { jobId } = req.params;
    const job = jobQueue.getJob(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
});

/**
 * @swagger
 * /api/local/jobs:
 *   get:
 *     summary: List all jobs
 *     description: Get list of all background jobs with optional status filtering
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [queued, running, completed, failed, cancelled]
 *         description: Filter jobs by status
 *     responses:
 *       200:
 *         description: List of jobs
 */
app.get('/api/local/jobs', (req, res) => {
    if (!jobQueue) {
        return res.status(404).json({ error: 'Job queue not available' });
    }

    const { status } = req.query;
    const jobs = jobQueue.getAllJobs(status);

    res.json({
        jobs: jobs,
        statistics: jobQueue.getStatistics(),
    });
});

/**
 * @swagger
 * /api/local/jobs/{jobId}/cancel:
 *   post:
 *     summary: Cancel a queued job
 *     description: Cancel a job that is currently in the queue (not yet running)
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID to cancel
 *     responses:
 *       200:
 *         description: Job cancelled successfully
 *       400:
 *         description: Job cannot be cancelled (not queued)
 *       404:
 *         description: Job not found
 */
app.post('/api/local/jobs/:jobId/cancel', (req, res) => {
    if (!jobQueue) {
        return res.status(404).json({ error: 'Job queue not available' });
    }

    const { jobId } = req.params;
    const cancelled = jobQueue.cancelJob(jobId);

    if (cancelled) {
        res.json({ success: true, message: 'Job cancelled successfully' });
    } else {
        const job = jobQueue.getJob(jobId);
        if (!job) {
            res.status(404).json({ error: 'Job not found' });
        } else {
            res.status(400).json({
                error: 'Job cannot be cancelled',
                status: job.status,
            });
        }
    }
});

/**
 * @swagger
 * /api/local/metadata:
 *   get:
 *     summary: Get metadata for local media files
 *     description: Retrieve or generate metadata for files in the local directory
 *     tags: ['Local Directory']
 *     parameters:
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *         description: File or directory path
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *         description: Force refresh metadata from external sources
 *     responses:
 *       200:
 *         description: Metadata information
 *       404:
 *         description: File not found or no metadata available
 *       500:
 *         description: Metadata retrieval failed
 */
app.get(
    '/api/local/metadata',
    asyncHandler(async (req, res) => {
        if (!config.localDirectory?.enabled || !localDirectorySource) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }

        const { path: filePath = '', refresh = false } = req.query;

        try {
            const metadata = await localDirectorySource.getFileMetadata(filePath, refresh);
            res.json(metadata);
        } catch (error) {
            logger.error('Metadata retrieval error:', error);
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File not found' });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    })
);

/**
 * @swagger
 * /api/local/stats:
 *   get:
 *     summary: Get local directory statistics
 *     description: Retrieve usage statistics and summary information
 *     tags: ['Local Directory']
 *     responses:
 *       200:
 *         description: Directory statistics
 *       404:
 *         description: Local directory support not enabled
 */
app.get(
    '/api/local/stats',
    asyncHandler(async (req, res) => {
        if (!config.localDirectory?.enabled || !localDirectorySource) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }

        try {
            const stats = await localDirectorySource.getDirectoryStats();
            const jobStats = jobQueue ? jobQueue.getStatistics() : null;

            res.json({
                directory: stats,
                jobs: jobStats,
            });
        } catch (error) {
            logger.error('Stats retrieval error:', error);
            res.status(500).json({ error: error.message });
        }
    })
);

// --- Device bypass status endpoint (public) ---
// Lightweight probe so clients can quickly decide to skip device management boot sequence.

// ============================================================================
// ADMIN API ENDPOINTS
// ============================================================================

/**
            let userMessage = 'Could not connect to Jellyfin. Please check the connection details.';
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                userMessage = 'Unauthorized. Is the API key correct?';
            } else if (error.code === 'EJELLYFIN_NOT_FOUND' || /404/.test(error.message)) {
                userMessage =
                    'Not found. If Jellyfin is behind a base path (e.g. /jellyfin), include it in the hostname field.';
            } else if (error.code === 'EJELLYFIN_CERT') {
                userMessage =
                    'TLS certificate error. If using a self-signed cert, enable Insecure HTTPS for the test.';
            } else if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                userMessage = 'Connection refused. Is the hostname and port correct?';
            } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                userMessage = 'Connection timeout. Is the server reachable?';
            } else if (error.message.includes('The string did not match the expected pattern')) {
                userMessage =
                    'Invalid hostname format. Use an IP address or hostname without http:// or https://.';
            }
            throw new ApiError(400, userMessage);
        }
    })
);

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
app.post(
    '/api/admin/jellyfin-libraries',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to fetch Jellyfin libraries.');
        let { hostname, port, apiKey } = req.body;

        // Sanitize hostname
        if (hostname) {
            hostname = hostname.trim().replace(/^https?:\/\//, '');
        }

        // Fallback to configured values if not provided in the request
        const jellyfinServerConfig = config.mediaServers.find(s => s.type === 'jellyfin');
        if (!jellyfinServerConfig) {
            throw new ApiError(500, 'Jellyfin server is not configured in config.json.');
        }

        if (!hostname && jellyfinServerConfig.hostname) {
            hostname = jellyfinServerConfig.hostname.trim().replace(/^https?:\/\//, '');
        }
        if (!port && typeof jellyfinServerConfig.port !== 'undefined') {
            port = jellyfinServerConfig.port;
        }
        apiKey = apiKey || process.env[jellyfinServerConfig.tokenEnvVar];

        if (!hostname || !port || !apiKey) {
            throw new ApiError(
                400,
                'Jellyfin connection details (hostname, port, API key) are missing.'
            );
        }

        try {
            const client = await createJellyfinClient({
                hostname,
                port,
                apiKey,
                timeout: 6000,
                insecureHttps:
                    typeof req.body.insecureHttps !== 'undefined'
                        ? !!req.body.insecureHttps
                        : process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                retryMaxRetries: 0,
                retryBaseDelay: 300,
            });

            // Step 1: Get user views (libraries)
            // First try to get any user to use for the Views endpoint
            let userViews = [];
            try {
                // Try the general Views endpoint first
                const viewsResponse = await client.http.get('/Library/Views');
                userViews = viewsResponse?.data?.Items || [];
            } catch (viewsError) {
                if (isDebug) {
                    logger.debug(
                        '[Jellyfin Libraries] Library/Views failed, trying Users endpoint:',
                        viewsError.message
                    );
                }

                try {
                    // Get users and use the first one
                    const usersResponse = await client.http.get('/Users');
                    const users = usersResponse?.data || [];

                    if (users.length > 0) {
                        const userId = users[0].Id;
                        const userViewsResponse = await client.http.get(`/Users/${userId}/Views`);
                        userViews = userViewsResponse?.data?.Items || [];
                    }
                } catch (userError) {
                    if (isDebug) {
                        logger.debug(
                            '[Jellyfin Libraries] Users approach also failed:',
                            userError.message
                        );
                    }
                    // Fallback to original virtual folders approach
                    const libraries = await fetchJellyfinLibraries(client);
                    userViews = libraries.map(lib => ({
                        Id: lib.Id,
                        Name: lib.Name,
                        CollectionType: lib.CollectionType,
                    }));
                }
            }

            if (isDebug) {
                logger.debug(
                    '[Jellyfin Libraries] Found user views:',
                    userViews.map(view => `${view.Name} (${view.CollectionType || 'unknown'})`)
                );
            }

            // Step 2: For each library, get the item counts
            const formattedLibraries = await Promise.all(
                userViews.map(async view => {
                    let itemCount = 0;
                    const libType =
                        view.CollectionType === 'movies'
                            ? 'movie'
                            : view.CollectionType === 'tvshows'
                              ? 'show'
                              : view.CollectionType || 'other';

                    try {
                        if (libType === 'movie' || libType === 'show') {
                            // The /Items/Counts endpoint doesn't properly filter by parentId
                            // So we use the /Items endpoint with a small limit to get TotalRecordCount
                            const itemTypes = libType === 'movie' ? ['Movie'] : ['Series'];
                            const response = await client.getItems({
                                parentId: view.Id,
                                includeItemTypes: itemTypes,
                                recursive: true,
                                limit: 1,
                                startIndex: 0,
                            });

                            // Use TotalRecordCount from the Items endpoint
                            itemCount = parseInt(response?.TotalRecordCount || 0);
                        }
                    } catch (countError) {
                        if (isDebug) {
                            logger.debug(
                                `[Jellyfin Lib Count] Failed to get count for ${view.Name}:`,
                                countError.message
                            );
                        }
                        // Continue without count
                    }

                    return {
                        key: view.Id,
                        name: view.Name,
                        type: libType,
                        itemCount: itemCount,
                    };
                })
            );

            res.json({ success: true, libraries: formattedLibraries });
        } catch (error) {
            if (isDebug) console.error('[Jellyfin Lib Fetch] Failed:', error.message);
            let userMessage = 'Could not fetch libraries. Please check the connection details.';
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                userMessage = 'Unauthorized. Is the API key correct?';
            } else if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                userMessage = 'Connection refused. Is the hostname and port correct?';
            } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                userMessage = 'Connection timeout. Is the server reachable?';
            } else if (error.message.includes('The string did not match the expected pattern')) {
                userMessage =
                    'Invalid hostname format. Use an IP address or hostname without http:// or https://.';
            }
            throw new ApiError(400, userMessage);
        }
    })
);

//

/**
 * @swagger
 * /api/admin/config:
 *   post:
 *     summary: Save the admin configuration
 *     description: >
 *       Saves the changes to both `config.json` and the `.env` file.
 *       After a successful save, the application caches and clients are cleared
 *       and a background refresh of the playlist is initiated.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SaveConfigRequest'
 *     responses:
 *       200:
 *         description: Configuration successfully saved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Niet geautoriseerd.
 */
app.post(
    '/api/admin/config',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        logger.info('[Admin API] Received POST request to /api/admin/config');
        logger.info('[Admin API] Request body exists:', !!req.body);

        // Safely calculate body size without stringifying entire object (OOM risk)
        let bodySize = 0;
        try {
            bodySize = req.headers['content-length'] || 0;
        } catch (_) {
            bodySize = 'unknown';
        }
        logger.info('[Admin API] Request body size:', bodySize);

        if (isDebug) {
            // Only log in debug mode and avoid huge objects
            try {
                const bodyStr = JSON.stringify(req.body, null, 2);
                if (bodyStr.length < 10000) {
                    // Only log if < 10KB
                    logger.debug('[Admin API] Full request body:', bodyStr);
                } else {
                    logger.debug('[Admin API] Request body too large to log:', bodyStr.length);
                }
            } catch (e) {
                logger.warn('[Admin API] Could not stringify request body:', e.message);
            }
        }

        const { config: newConfig, env: newEnv } = req.body;

        // Extra logging to debug old frontend behavior
        logger.info('[Admin API] Received env keys:', Object.keys(newEnv || {}));
        logger.info(
            '[Admin API] Received env values (masked):',
            Object.fromEntries(
                Object.entries(newEnv || {}).map(([k, v]) => {
                    if (k.includes('TOKEN') || k.includes('KEY') || k.includes('SECRET')) {
                        return [
                            k,
                            typeof v === 'string'
                                ? `${v.substring(0, 5)}...(${v.length})`
                                : `${typeof v}`,
                        ];
                    }
                    return [k, v];
                })
            )
        );

        if (!newConfig || !newEnv) {
            if (isDebug)
                logger.debug('[Admin API] Invalid request body. Missing "config" or "env".');
            throw new ApiError(
                400,
                'Invalid request body. "config" and "env" properties are required.'
            );
        }

        // Debug: Log all TMDB config details
        logger.info(
            '[TMDB Debug] Full newConfig.tmdbSource:',
            JSON.stringify(newConfig.tmdbSource, null, 2)
        );
        if (newConfig.tmdbSource) {
            logger.debug('[TMDB Debug] API key value:', newConfig.tmdbSource.apiKey);
            logger.debug('[TMDB Debug] API key type:', typeof newConfig.tmdbSource.apiKey);
            logger.debug('[TMDB Debug] API key === null:', newConfig.tmdbSource.apiKey === null);
            logger.debug('[TMDB Debug] API key == null:', newConfig.tmdbSource.apiKey == null);
        }

        // Handle TMDB API key preservation and merge with existing config
        const existingConfig = await readConfig();

        // Merge existing config with new config to preserve properties not in admin UI
        const mergedConfig = { ...existingConfig, ...newConfig };
        try {
            // Diff logging for mediaServers host/port to debug persistence issues
            const beforeServers = existingConfig.mediaServers || [];
            const afterServers = mergedConfig.mediaServers || [];
            const diff = [];
            const indexByTypeName = list => {
                const map = new Map();
                list.forEach(s => map.set(`${s.type}:${s.name}`, s));
                return map;
            };
            const beforeMap = indexByTypeName(beforeServers);
            const afterMap = indexByTypeName(afterServers);
            const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
            keys.forEach(k => {
                const b = beforeMap.get(k) || {};
                const a = afterMap.get(k) || {};
                if (b.hostname !== a.hostname || b.port !== a.port) {
                    diff.push({
                        key: k,
                        before: { hostname: b.hostname, port: b.port },
                        after: { hostname: a.hostname, port: a.port },
                    });
                }
            });
            if (diff.length) {
                logger.info('[Admin API] Host/port diff', { changes: diff });
            } else {
                logger.debug('[Admin API] No host/port changes detected in mediaServers');
            }
        } catch (e) {
            logger.warn('[Admin API] Failed diff logging mediaServers host/port:', e.message);
        }

        if (
            newConfig.tmdbSource &&
            (newConfig.tmdbSource.apiKey === null || newConfig.tmdbSource.apiKey === undefined)
        ) {
            logger.debug(
                '[TMDB API Key Debug] Received null/undefined API key, preserving existing'
            );
            // Preserve existing API key if null/undefined is passed (meaning "don't change")
            if (existingConfig.tmdbSource && existingConfig.tmdbSource.apiKey) {
                mergedConfig.tmdbSource.apiKey = existingConfig.tmdbSource.apiKey;
                logger.debug(
                    '[TMDB API Key Debug] Preserved existing key:',
                    existingConfig.tmdbSource.apiKey.substring(0, 8) + '...'
                );
            } else {
                // No existing key, use empty string
                mergedConfig.tmdbSource.apiKey = '';
                logger.debug('[TMDB API Key Debug] No existing key found, using empty string');
            }
        } else if (newConfig.tmdbSource) {
            logger.debug(
                '[TMDB API Key Debug] Received API key:',
                mergedConfig.tmdbSource.apiKey
                    ? mergedConfig.tmdbSource.apiKey.substring(0, 8) + '...'
                    : 'empty'
            );
        }

        // Process streaming sources configuration
        if (
            mergedConfig.streamingSources &&
            typeof mergedConfig.streamingSources === 'object' &&
            !Array.isArray(mergedConfig.streamingSources)
        ) {
            logger.debug('[Streaming Debug] Converting streamingSources object to array format');
            const streamingConfig = mergedConfig.streamingSources;
            const streamingArray = [];

            // Get TMDB API key for streaming sources
            let apiKey = '';
            if (mergedConfig.tmdbSource && mergedConfig.tmdbSource.apiKey) {
                apiKey = mergedConfig.tmdbSource.apiKey;
            }

            if (streamingConfig.enabled && apiKey) {
                // Create streaming source entries based on selected providers
                const providers = [
                    {
                        name: 'Netflix Releases',
                        category: 'streaming_netflix',
                        enabled: streamingConfig.netflix,
                    },
                    {
                        name: 'Disney+ Releases',
                        category: 'streaming_disney',
                        enabled: streamingConfig.disney,
                    },
                    {
                        name: 'Prime Video Releases',
                        category: 'streaming_prime',
                        enabled: streamingConfig.prime,
                    },
                    {
                        name: 'HBO Max Releases',
                        category: 'streaming_hbo',
                        enabled: streamingConfig.hbo,
                    },
                    {
                        name: 'Hulu Releases',
                        category: 'streaming_hulu',
                        enabled: streamingConfig.hulu,
                    },
                    {
                        name: 'Apple TV+ Releases',
                        category: 'streaming_apple',
                        enabled: streamingConfig.apple,
                    },
                    {
                        name: 'Paramount+ Releases',
                        category: 'streaming_paramount',
                        enabled: streamingConfig.paramount,
                    },
                    {
                        name: 'Crunchyroll Releases',
                        category: 'streaming_crunchyroll',
                        enabled: streamingConfig.crunchyroll,
                    },
                    {
                        name: 'New Streaming Releases',
                        category: 'streaming_new_releases',
                        enabled: streamingConfig.newReleases,
                    },
                ];

                // Map provider flag keys to TMDB IDs for dynamic new releases
                const PROVIDER_ID_MAP = {
                    netflix: 8,
                    disney: 337,
                    prime: 119,
                    hbo: 1899,
                    hulu: 15,
                    apple: 350,
                    paramount: 531,
                    crunchyroll: 283,
                };
                providers.forEach(provider => {
                    if (provider.enabled) {
                        const entry = {
                            name: provider.name,
                            enabled: true,
                            apiKey: apiKey,
                            category: provider.category,
                            watchRegion: streamingConfig.region || 'US',
                            movieCount: FIXED_LIMITS.STREAMING_MOVIES_PER_PROVIDER,
                            showCount: FIXED_LIMITS.STREAMING_TV_PER_PROVIDER,
                            minRating: streamingConfig.minRating || 0,
                            yearFilter: null,
                            genreFilter: '',
                        };
                        if (provider.category === 'streaming_new_releases') {
                            // collect selected providers' TMDB IDs
                            const selected = Object.entries(streamingConfig)
                                .filter(([k, v]) => v === true && PROVIDER_ID_MAP[k])
                                .map(([k]) => PROVIDER_ID_MAP[k]);
                            entry.withWatchProviders = selected;
                        }
                        streamingArray.push(entry);
                    }
                });
            }

            // Replace the object with the array
            mergedConfig.streamingSources = streamingArray;
            logger.debug(
                '[Streaming Debug] Created streaming sources array:',
                JSON.stringify(streamingArray, null, 2)
            );
        }

        // Before writing env, preserve sensitive token vars if the UI sent empty/masked values
        const sensitiveEnvKeys = new Set();
        try {
            if (mergedConfig && Array.isArray(mergedConfig.mediaServers)) {
                mergedConfig.mediaServers.forEach(s => {
                    if (s && s.tokenEnvVar) sensitiveEnvKeys.add(s.tokenEnvVar);
                });
            }
            // Common legacy keys, just in case
            ['PLEX_TOKEN', 'JELLYFIN_API_KEY'].forEach(k => sensitiveEnvKeys.add(k));
        } catch (e) {
            // Non-fatal; proceed with what we have
        }

        const maskedPattern = /^\*{3,}$/; // e.g., *** or ******
        const bulletPattern = /^[•]+$/; // e.g., ••••••••••••••
        const sanitizedEnv = { ...newEnv };

        // Log what we received for debugging
        logger.info('[Admin API] Received env update keys:', Object.keys(sanitizedEnv));
        logger.info(
            '[Admin API] PLEX_TOKEN in received env:',
            'PLEX_TOKEN' in sanitizedEnv,
            sanitizedEnv.PLEX_TOKEN
                ? `(length: ${String(sanitizedEnv.PLEX_TOKEN).length})`
                : '(not present or empty)'
        );

        for (const key of sensitiveEnvKeys) {
            // If key is not being sent at all, skip (writeEnvFile will preserve existing)
            if (!(key in sanitizedEnv)) {
                if (process.env[key]) {
                    logger.info(
                        `[Admin API] Token key ${key} not in update, will preserve existing value`
                    );
                }
                continue;
            }

            const val = sanitizedEnv[key];
            const str = val == null ? '' : String(val).trim();

            // If value is empty, masked (***), or bullet points (••••), preserve existing
            if (str === '' || maskedPattern.test(str) || bulletPattern.test(str)) {
                if (process.env[key]) {
                    logger.info(
                        `[Admin API] Preserving sensitive env var ${key} (received: ${str ? 'masked/empty' : 'empty'})`
                    );
                    delete sanitizedEnv[key]; // Remove so writeEnvFile keeps existing
                } else {
                    logger.warn(
                        `[Admin API] Token key ${key} is empty but no existing value to preserve`
                    );
                }
            } else {
                logger.info(
                    `[Admin API] Updating sensitive env var ${key} with new value (length: ${str.length})`
                );
            }
        }

        // Log final state after masking checks
        logger.info(
            '[Admin API] After masking checks - sanitizedEnv keys:',
            Object.keys(sanitizedEnv)
        );
        logger.info(
            '[Admin API] After masking checks - PLEX_TOKEN present:',
            'PLEX_TOKEN' in sanitizedEnv
        );

        // Detect rootRoute defaultMode change to optionally broadcast navigation
        let __broadcastModeChange = null;
        try {
            const beforeMode = (existingConfig?.rootRoute?.defaultMode || '').toString();
            const afterMode = (mergedConfig?.rootRoute?.defaultMode || '').toString();
            const behavior = (mergedConfig?.rootRoute?.behavior || 'landing').toString();
            const allowed = new Set(['screensaver', 'wallart', 'cinema']);
            if (
                behavior === 'redirect' &&
                ((beforeMode && afterMode && beforeMode !== afterMode && allowed.has(afterMode)) ||
                    // If defaultMode removed, broadcast using new active mode from Display Settings
                    (!afterMode && beforeMode))
            ) {
                // Determine target mode: prefer afterMode if present; else compute from Display Settings
                let target = afterMode;
                if (!target) {
                    const ds = mergedConfig || {};
                    target =
                        (ds.cinemaMode && 'cinema') ||
                        (ds.wallartMode && (ds.wallartMode.enabled ? 'wallart' : null)) ||
                        'screensaver';
                }
                __broadcastModeChange = target;
                logger.info(
                    '[Admin API] rootRoute.defaultMode changed (redirect). Will broadcast',
                    {
                        from: beforeMode || 'derived',
                        to: __broadcastModeChange,
                    }
                );
            }
        } catch (e) {
            logger.warn(
                '[Admin API] Unable to diff rootRoute.defaultMode for broadcast:',
                e?.message || e
            );
        }

        // Write to config.json and .env
        await writeConfig(mergedConfig, config);
        if (isDebug) logger.debug('[Admin API] Successfully wrote to config.json.');

        // Enhanced logging for .env write debugging
        logger.info(
            '[Admin API] About to write to .env file with keys:',
            Object.keys(sanitizedEnv)
        );
        logger.info(
            '[Admin API] .env update details:',
            Object.fromEntries(
                Object.entries(sanitizedEnv).map(([k, v]) => {
                    if (k.includes('TOKEN') || k.includes('KEY') || k.includes('SECRET')) {
                        return [k, `${typeof v} (length: ${String(v || '').length})`];
                    }
                    return [k, v];
                })
            )
        );

        await writeEnvFile(sanitizedEnv);
        if (isDebug) logger.debug('[Admin API] Successfully wrote to .env file.');

        // Verify the token was written by checking process.env
        logger.info(
            '[Admin API] Post-write verification - PLEX_TOKEN in process.env:',
            !!process.env.PLEX_TOKEN
        );

        // Clear caches to reflect changes without a full restart
        clearPlaylistCache();
        clearPlexClients();
        // Also clear Jellyfin clients so updated hostname/port/token/insecure flag take effect
        invalidateJellyfinClient();

        // Clear the /get-config cache so changes are immediately visible
        cacheManager.delete('GET:/get-config');

        // Broadcast settings update to all connected displays
        try {
            logger.info('[WS] Broadcasting settings update to all displays');
            const settingsPayload = {
                transitionIntervalSeconds: mergedConfig.transitionIntervalSeconds,
                transitionEffect: mergedConfig.transitionEffect,
                effectPauseTime: mergedConfig.effectPauseTime,
                clockWidget: mergedConfig.clockWidget,
                clockFormat: mergedConfig.clockFormat,
                clockTimezone: mergedConfig.clockTimezone,
                showPoster: mergedConfig.showPoster,
                showMetadata: mergedConfig.showMetadata,
                showClearLogo: mergedConfig.showClearLogo,
                showRottenTomatoes: mergedConfig.showRottenTomatoes,
                rottenTomatoesMinimumScore: mergedConfig.rottenTomatoesMinimumScore,
                uiScaling: mergedConfig.uiScaling,
                syncEnabled: mergedConfig.syncEnabled,
                syncAlignMaxDelayMs: mergedConfig.syncAlignMaxDelayMs,
                cinemaMode: mergedConfig.cinemaMode,
                cinemaOrientation: mergedConfig.cinemaOrientation,
                wallartMode: mergedConfig.wallartMode,
                cinema: mergedConfig.cinema,
                rootRoute: mergedConfig.rootRoute,
            };

            const broadcastOk = wsHub.broadcast({
                kind: 'command',
                type: 'settings.apply',
                payload: settingsPayload,
            });

            logger.info('[WS] Settings broadcast result:', {
                broadcastOk,
                connectedDevices: wsHub.getConnectedDevices?.()?.length || 0,
            });
        } catch (e) {
            logger.warn('[WS] Settings broadcast failed:', e?.message || e);
        }

        // After saving and cache invalidation, broadcast mode navigate if scheduled
        try {
            if (__broadcastModeChange) {
                const mode = __broadcastModeChange;
                const ok = wsHub.broadcast({
                    kind: 'command',
                    type: 'mode.navigate',
                    payload: { mode },
                });
                logger.info('[WS] Broadcast: mode.navigate', { mode, ok });
            }
        } catch (e) {
            logger.warn('[WS] mode.navigate broadcast failed:', e?.message || e);
        }

        // Restart PM2 to clear environment cache ONLY if environment variables changed
        // Display settings don't require restart, only tokens/keys/secrets do
        if (Object.keys(sanitizedEnv).length > 0) {
            restartPM2ForEnvUpdate('configuration saved');
        }

        // --- Live-apply Local Directory changes without restart ---
        try {
            // Shallow-assign to the in-memory config so subsequent routes read the latest values
            Object.assign(config, mergedConfig);
            // Recreate or dispose Local directory components to match the new config
            if (config.localDirectory && config.localDirectory.enabled) {
                // (Re)initialize if missing or if root/watch settings changed
                if (!localDirectorySource) {
                    jobQueue = new (require('./utils/job-queue'))(config);
                    localDirectorySource = new LocalDirectorySource(config.localDirectory, logger);
                    uploadMiddleware = require('./middleware/fileUpload').createUploadMiddleware(
                        config.localDirectory
                    );
                    Promise.resolve(localDirectorySource.initialize()).catch(() => {});
                } else {
                    // If already present, update its config fields and restart watcher if needed
                    try {
                        const prev = {
                            enabled: localDirectorySource.enabled,
                            rootPath: localDirectorySource.rootPath,
                            watchDirectories: localDirectorySource.watchDirectories,
                        };
                        localDirectorySource.enabled = !!config.localDirectory.enabled;
                        localDirectorySource.rootPath =
                            config.localDirectory.rootPath || localDirectorySource.rootPath;
                        localDirectorySource.watchDirectories = Array.isArray(
                            config.localDirectory.watchDirectories
                        )
                            ? config.localDirectory.watchDirectories
                            : [];
                        localDirectorySource.rootPaths = [
                            localDirectorySource.rootPath,
                            ...localDirectorySource.watchDirectories,
                        ]
                            .filter(Boolean)
                            .map(p => require('path').resolve(p));
                        // If toggled from disabled->enabled or roots changed, re-init the watcher
                        const rootsChanged =
                            prev.rootPath !== localDirectorySource.rootPath ||
                            JSON.stringify(prev.watchDirectories || []) !==
                                JSON.stringify(localDirectorySource.watchDirectories || []);
                        if (!prev.enabled && localDirectorySource.enabled) {
                            Promise.resolve(localDirectorySource.initialize()).catch(err => {
                                logger.debug(
                                    'LocalDirectorySource.initialize failed (ignored):',
                                    err?.message || err
                                );
                            });
                        } else if (rootsChanged && localDirectorySource.enabled) {
                            try {
                                await localDirectorySource.stopFileWatcher();
                            } catch (e) {
                                logger.debug(
                                    'LocalDirectorySource.stopFileWatcher failed (ignored):',
                                    e?.message || e
                                );
                            }
                            Promise.resolve(localDirectorySource.startFileWatcher()).catch(err => {
                                logger.debug(
                                    'LocalDirectorySource.startFileWatcher failed (ignored):',
                                    err?.message || err
                                );
                            });
                        }
                    } catch (e) {
                        logger.warn('[Admin API] Failed to live-update LocalDirectorySource:', e);
                    }
                }
            } else {
                // Disabled now: stop watchers and drop refs so routes return 404 quickly
                if (localDirectorySource) {
                    try {
                        await localDirectorySource.stopFileWatcher();
                    } catch (e) {
                        logger.debug(
                            'LocalDirectorySource.stopFileWatcher on disable failed (ignored):',
                            e?.message || e
                        );
                    }
                }
                localDirectorySource = null;
                jobQueue = null;
                uploadMiddleware = null;
            }
        } catch (e) {
            logger.warn('[Admin API] Live-apply of Local Directory changes failed:', e?.message);
        }

        // Trigger a background refresh of the playlist with the new settings.
        // We don't await this, so the admin UI gets a fast response.
        // Also reschedule the background refresh interval in case backgroundRefreshMinutes changed.
        // Add a small delay to prevent overwhelming the server during rapid config changes
        setTimeout(async () => {
            try {
                schedulePlaylistBackgroundRefresh();
            } catch (_) {
                /* ignore */
            }
            refreshPlaylistCache();

            // If baseUrl changed, republish MQTT discovery for all devices
            try {
                const mqttBridge = global.__posterramaMqttBridge;
                if (mqttBridge && config.baseUrl) {
                    const devices = await deviceStore.getAll();
                    logger.info(
                        '[MQTT] Republishing discovery for all devices after baseUrl change',
                        {
                            count: devices.length,
                            baseUrl: config.baseUrl,
                        }
                    );
                    devices.forEach(device => {
                        mqttBridge.republishDiscovery(device).catch(err => {
                            logger.warn('[MQTT] Failed to republish discovery for device', {
                                deviceId: device.id,
                                error: err.message,
                            });
                        });
                    });
                }
            } catch (err) {
                logger.warn('[MQTT] Failed to republish discovery after config save:', err.message);
            }
        }, 1000);

        if (isDebug) {
            logger.debug(
                '[Admin] Configuration saved successfully. Caches and clients have been cleared. Triggered background playlist refresh.'
            );
        }

        res.json({
            message:
                'Configuration saved successfully. Some changes may require an application restart.',
        });
    })
);

/**
 * @swagger
 * /api/admin/plex-genres:
 *   get:
 *     summary: Get all available genres from Plex servers
 *     description: Retrieves a list of all genres available in the configured Plex servers.
 *     tags: ['Admin']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available genres.
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
 *         description: Niet geautoriseerd.
 */
app.get(
    '/api/admin/plex-genres',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/plex-genres.');

        const currentConfig = await readConfig();
        const enabledServers = currentConfig.mediaServers.filter(
            s => s.enabled && s.type === 'plex'
        );

        if (enabledServers.length === 0) {
            return res.json({ genres: [] });
        }

        const allGenres = new Set();

        for (const server of enabledServers) {
            try {
                const genres = await getPlexGenres(server);
                genres.forEach(genre => allGenres.add(genre));
            } catch (error) {
                console.warn(
                    `[Admin API] Failed to get genres from ${server.name}: ${error.message}`
                );
            }
        }

        const sortedGenres = Array.from(allGenres).sort();
        if (isDebug) logger.debug(`[Admin API] Found ${sortedGenres.length} unique genres.`);

        res.json({ genres: sortedGenres });
    })
);

/**
 * @swagger
 * /api/admin/plex-genres-with-counts:
 *   get:
 *     summary: Retourneert alle Plex genres met aantallen
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *       - SessionAuth: []
 *     responses:
 *       200:
 *         description: Succesvol
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 genres:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       genre:
 *                         type: string
 *                       count:
 *                         type: number
 *       401:
 *         description: Niet geautoriseerd.
 */
app.get(
    '/api/admin/plex-genres-with-counts',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug)
            logger.debug('[Admin API] Request received for /api/admin/plex-genres-with-counts.');

        const currentConfig = await readConfig();
        const enabledServers = currentConfig.mediaServers.filter(
            s => s.enabled && s.type === 'plex'
        );

        if (enabledServers.length === 0) {
            return res.json({ genres: [] });
        }

        const allGenreCounts = new Map();

        for (const server of enabledServers) {
            try {
                const genresWithCounts = await getPlexGenresWithCounts(server);
                // Accumulate counts across servers
                genresWithCounts.forEach(({ genre, count }) => {
                    allGenreCounts.set(genre, (allGenreCounts.get(genre) || 0) + count);
                });
            } catch (error) {
                console.warn(
                    `[Admin API] Failed to get genres with counts from ${server.name}: ${error.message}`
                );
            }
        }

        // Convert to array and sort
        const sortedGenresWithCounts = Array.from(allGenreCounts.entries())
            .map(([genre, count]) => ({ genre, count }))
            .sort((a, b) => a.genre.localeCompare(b.genre));

        if (isDebug)
            logger.debug(
                `[Admin API] Found ${sortedGenresWithCounts.length} unique genres with counts.`
            );

        res.json({ genres: sortedGenresWithCounts });
    })
);

/**
 * @swagger
 * /api/admin/plex-genres-test:
 *   post:
 *     summary: Get Plex genres for testing (with connection parameters)
 *     description: Retrieves all available genres from a Plex server using provided connection parameters.
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
 *                 description: Plex server hostname or IP
 *               port:
 *                 type: string
 *                 description: Plex server port
 *               token:
 *                 type: string
 *                 description: Plex authentication token (optional if configured)
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
    '/api/admin/plex-genres-test',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/plex-genres-test.');

        const { hostname: rawHostname, port } = req.body;
        let { token } = req.body;
        const hostname = rawHostname ? rawHostname.trim().replace(/^https?:\/\//, '') : rawHostname;

        // If no token is provided in the request, use the one from the server's config.
        if (!token) {
            const config = await readConfig();
            const plexServerConfig = config.mediaServers.find(s => s.type === 'plex');
            if (plexServerConfig && plexServerConfig.tokenEnvVar) {
                token = process.env[plexServerConfig.tokenEnvVar];
            }
            if (!token) {
                throw new ApiError(400, 'No token provided and no token configured on the server.');
            }
        }

        try {
            // Create a direct client for testing without caching
            const testClient = await createPlexClient({
                hostname,
                port: parseInt(port),
                token,
            });

            // Create a temporary server config for testing
            const testServerConfig = {
                name: `Test Server ${hostname}:${port}`, // Unique name to avoid caching issues
                type: 'plex',
                enabled: true, // Temporarily enabled for testing
                // Direct values for testing
                hostname,
                port: parseInt(port),
                token,
                // Provide the direct client to bypass caching
                _directClient: testClient,
            };

            const genres = await getPlexGenres(testServerConfig);
            if (isDebug)
                logger.debug(
                    `[Admin API] Found ${genres.length} genres from test server:`,
                    genres.slice(0, 5)
                );

            res.json({ genres: genres.sort() });
        } catch (error) {
            if (isDebug)
                console.error('[Admin API] Error getting genres from test server:', error.message);
            throw new ApiError(400, `Failed to get genres: ${error.message}`);
        }
    })
);

/**
 * @swagger
 * /api/admin/plex-genres-with-counts-test:
 *   post:
 *     summary: Get Plex genres with counts for testing (with connection parameters)
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
 *               port:
 *                 type: string
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: List of genres with counts successfully retrieved
 */
app.post(
    '/api/admin/plex-genres-with-counts-test',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug)
            logger.debug(
                '[Admin API] Request received for /api/admin/plex-genres-with-counts-test.'
            );

        let { hostname, token } = req.body;
        const { port } = req.body;

        if (!hostname || !port) {
            throw new ApiError(400, 'Hostname and port are required.');
        }

        // Sanitize hostname
        hostname = hostname.trim().replace(/^https?:\/\//, '');

        // Fallback to configured token if not provided
        if (!token) {
            const plexServerConfig = config.mediaServers.find(s => s.type === 'plex');
            if (plexServerConfig) {
                token = process.env[plexServerConfig.tokenEnvVar];
            }
            if (!token) {
                throw new ApiError(400, 'No token provided and no token configured on the server.');
            }
        }

        try {
            // Create a direct client for testing without caching
            const testClient = await createPlexClient({
                hostname,
                port: parseInt(port),
                token,
            });

            // Create a temporary server config for testing
            const testServerConfig = {
                name: `Test Server ${hostname}:${port}`,
                type: 'plex',
                enabled: true,
                hostname,
                port: parseInt(port),
                token,
                _directClient: testClient,
            };

            const genresWithCounts = await getPlexGenresWithCounts(testServerConfig);
            logger.info(
                `[Admin API] Test: Found ${genresWithCounts.length} unique genres with counts from ${hostname}:${port}.`
            );

            res.json({ success: true, genres: genresWithCounts });
        } catch (error) {
            if (isDebug)
                console.error(
                    '[Admin API] Error getting genres with counts from test server:',
                    error.message
                );
            throw new ApiError(400, `Failed to get genres with counts: ${error.message}`);
        }
    })
);

/**
 * @swagger
 * /api/admin/jellyfin-genres:
 *   post:
 *     summary: Get genres from Jellyfin libraries
 *     description: >
 *       Retrieves all unique genres from the specified Jellyfin libraries.
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
 *               port:
 *                 type: number
 *               apiKey:
 *                 type: string
 *               movieLibraries:
 *                 type: array
 *                 items:
 *                   type: string
 *               showLibraries:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Genres retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
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
    '/api/admin/jellyfin-genres',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/jellyfin-genres.');

        let { hostname, port, apiKey } = req.body;
        const { movieLibraries = [], showLibraries = [] } = req.body;

        // Sanitize hostname
        if (hostname) {
            hostname = hostname.trim().replace(/^https?:\/\//, '');
        }

        // Fallback to configured values if not provided
        const jellyfinServerConfig = config.mediaServers.find(s => s.type === 'jellyfin');
        if (jellyfinServerConfig) {
            if (!hostname && jellyfinServerConfig.hostname)
                hostname = jellyfinServerConfig.hostname;
            if (!port && typeof jellyfinServerConfig.port !== 'undefined')
                port = jellyfinServerConfig.port;
            apiKey = apiKey || process.env[jellyfinServerConfig.tokenEnvVar];
        }

        if (!hostname || !port || !apiKey) {
            throw new ApiError(400, 'Jellyfin connection details are missing.');
        }

        if (movieLibraries.length === 0 && showLibraries.length === 0) {
            throw new ApiError(400, 'At least one library must be specified.');
        }

        try {
            const client = await createJellyfinClient({
                hostname,
                port: parseInt(port),
                apiKey,
                timeout: 8000,
                insecureHttps:
                    typeof req.body.insecureHttps !== 'undefined'
                        ? !!req.body.insecureHttps
                        : process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                retryMaxRetries: 0,
                retryBaseDelay: 300,
            });

            const allLibraries = await fetchJellyfinLibraries(client);
            const selectedLibraries = allLibraries.filter(
                lib => movieLibraries.includes(lib.Name) || showLibraries.includes(lib.Name)
            );

            if (isDebug) {
                logger.debug(
                    `[Jellyfin Genres] All libraries:`,
                    allLibraries.map(l => `${l.Name} (${l.Id})`)
                );
                logger.debug(
                    `[Jellyfin Genres] Selected libraries:`,
                    selectedLibraries.map(l => `${l.Name} (${l.Id})`)
                );
                logger.debug(`[Jellyfin Genres] Movie libraries requested:`, movieLibraries);
                logger.debug(`[Jellyfin Genres] Show libraries requested:`, showLibraries);
            }

            // Get selected library IDs
            const selectedLibraryIds = selectedLibraries.map(lib => lib.Id);

            if (selectedLibraryIds.length === 0) {
                throw new ApiError(
                    400,
                    'No matching libraries found. Available libraries: ' +
                        allLibraries.map(l => l.Name).join(', ')
                );
            }

            // Use our HTTP client to get genres
            const genres = await client.getGenres(selectedLibraryIds);

            logger.info(
                `[Admin API] Extracted ${genres.length} unique Jellyfin genres from ${selectedLibraries.length} libraries.`
            );

            res.json({ success: true, genres });
        } catch (error) {
            if (isDebug) console.error('[Admin API] Error getting Jellyfin genres:', error.message);
            throw new ApiError(400, `Failed to get Jellyfin genres: ${error.message}`);
        }
    })
);

/**
 * @swagger
 * /api/admin/jellyfin-genres-with-counts:
 *   post:
 *     summary: Get genres with counts from Jellyfin libraries
 *     description: >
 *       Retrieves all unique genres with their counts from the specified Jellyfin libraries.
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
 *               port:
 *                 type: number
 *               apiKey:
 *                 type: string
 *               movieLibraries:
 *                 type: array
 *                 items:
 *                   type: string
 *               showLibraries:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 genres:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       genre:
 *                         type: string
 *                       count:
 *                         type: number
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 */
app.post(
    '/api/admin/jellyfin-genres-with-counts',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug)
            logger.debug(
                '[Admin API] Request received for /api/admin/jellyfin-genres-with-counts.'
            );

        let { hostname, port, apiKey } = req.body;
        const { movieLibraries = [], showLibraries = [] } = req.body;

        // Sanitize hostname
        if (hostname) {
            hostname = hostname.trim().replace(/^https?:\/\//, '');
        }

        // Fallback to configured values if not provided
        const jellyfinServerConfig = config.mediaServers.find(s => s.type === 'jellyfin');
        if (jellyfinServerConfig) {
            if (!hostname && jellyfinServerConfig.hostname)
                hostname = jellyfinServerConfig.hostname;
            if (!port && typeof jellyfinServerConfig.port !== 'undefined')
                port = jellyfinServerConfig.port;
            apiKey = apiKey || process.env[jellyfinServerConfig.tokenEnvVar];
        }

        // Check if Jellyfin is enabled
        if (!jellyfinServerConfig || !jellyfinServerConfig.enabled) {
            return res.json({
                success: true,
                genres: [],
                message: 'Jellyfin is disabled',
            });
        }

        if (!hostname || !port || !apiKey) {
            throw new ApiError(400, 'Jellyfin connection details are missing.');
        }

        if (movieLibraries.length === 0 && showLibraries.length === 0) {
            throw new ApiError(400, 'At least one library must be specified.');
        }

        try {
            const client = await createJellyfinClient({
                hostname,
                port: parseInt(port),
                apiKey,
                timeout: 15000,
            });

            const allLibraries = await fetchJellyfinLibraries(client);
            const selectedLibraries = allLibraries.filter(
                lib => movieLibraries.includes(lib.Name) || showLibraries.includes(lib.Name)
            );

            if (isDebug) {
                logger.debug(
                    `[Jellyfin Genres with Counts] All libraries:`,
                    allLibraries.map(l => `${l.Name} (${l.Id})`)
                );
                logger.debug(
                    `[Jellyfin Genres with Counts] Selected libraries:`,
                    selectedLibraries.map(l => `${l.Name} (${l.Id})`)
                );
                logger.debug(
                    `[Jellyfin Genres with Counts] Movie libraries requested:`,
                    movieLibraries
                );
                logger.debug(
                    `[Jellyfin Genres with Counts] Show libraries requested:`,
                    showLibraries
                );
            }

            // Get selected library IDs
            const selectedLibraryIds = selectedLibraries.map(lib => lib.Id);

            if (selectedLibraryIds.length === 0) {
                throw new ApiError(
                    400,
                    'No matching libraries found. Available libraries: ' +
                        allLibraries.map(l => l.Name).join(', ')
                );
            }

            // Use our HTTP client to get genres with counts
            const genresWithCounts = await client.getGenresWithCounts(selectedLibraryIds);

            logger.info(
                `[Admin API] Extracted ${genresWithCounts.length} unique Jellyfin genres with counts from ${selectedLibraries.length} libraries.`
            );

            res.json({ success: true, genres: genresWithCounts });
        } catch (error) {
            if (isDebug)
                console.error(
                    '[Admin API] Error getting Jellyfin genres with counts:',
                    error.message
                );
            throw new ApiError(400, `Failed to get Jellyfin genres with counts: ${error.message}`);
        }
    })
);

// Fallback: return unique Jellyfin genres across all libraries of the configured server
/**
 * @swagger
 * /api/admin/jellyfin-genres-all:
 *   get:
 *     summary: Get Jellyfin genres across all libraries
 *     description: >
 *       Returns a de-duplicated, sorted list of all Jellyfin genres across all configured and
 *       enabled Jellyfin libraries. This serves as a lightweight fallback when per-library counts
 *       are unavailable. Requires admin authentication.
 *     tags: ['Admin']
 *     responses:
 *       200:
 *         description: Successfully retrieved genres
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
 *         description: Authentication required
 */
app.get(
    '/api/admin/jellyfin-genres-all',
    isAuthenticated,
    asyncHandler(async (_req, res) => {
        try {
            const jellyfinServerConfig = config.mediaServers.find(s => s.type === 'jellyfin');
            if (!jellyfinServerConfig) return res.json({ genres: [] });
            const client = await createJellyfinClient({
                hostname: jellyfinServerConfig.hostname,
                port: jellyfinServerConfig.port,
                apiKey: process.env[jellyfinServerConfig.tokenEnvVar],
                timeout: 8000,
                insecureHttps: process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                retryMaxRetries: 0,
                retryBaseDelay: 300,
            });
            const libs = await fetchJellyfinLibraries(client);
            const ids = libs.map(l => l.Id);
            const genres = await client.getGenres(ids);
            // De-duplicate and sort
            const unique = Array.from(
                new Set(genres.map(g => (g.genre || g.name || g).toString()))
            ).sort((a, b) => a.localeCompare(b));
            return res.json({ genres: unique });
        } catch (e) {
            logger.warn('[Admin API] jellyfin-genres-all failed:', e?.message);
            return res.json({ genres: [] });
        }
    })
);

// ============================================
// QUALITY ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/admin/plex-qualities-with-counts:
 *   get:
 *     summary: Get Plex qualities with content counts
 *     description: Retrieves available video qualities from Plex servers with item counts
 *     tags: ['Admin']
 *     responses:
 *       200:
 *         description: Quality data with counts
 *       401:
 *         description: Niet geautoriseerd.
 */
app.get(
    '/api/admin/plex-qualities-with-counts',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug)
            logger.debug('[Admin API] Request received for /api/admin/plex-qualities-with-counts.');

        const currentConfig = await readConfig();
        const enabledServers = currentConfig.mediaServers.filter(
            s => s.enabled && s.type === 'plex'
        );

        if (enabledServers.length === 0) {
            return res.json({ qualities: [] });
        }

        const allQualityCounts = new Map();

        for (const server of enabledServers) {
            try {
                const qualitiesWithCounts = await getPlexQualitiesWithCounts(server);
                // Accumulate counts across servers
                qualitiesWithCounts.forEach(({ quality, count }) => {
                    allQualityCounts.set(quality, (allQualityCounts.get(quality) || 0) + count);
                });
            } catch (error) {
                console.warn(
                    `[Admin API] Failed to get qualities with counts from ${server.name}: ${error.message}`
                );
            }
        }

        // Convert to array and sort by quality preference
        const qualityOrder = ['SD', '720p', '1080p', '4K'];
        const sortedQualitiesWithCounts = Array.from(allQualityCounts.entries())
            .map(([quality, count]) => ({ quality, count }))
            .sort((a, b) => {
                const aIndex = qualityOrder.indexOf(a.quality);
                const bIndex = qualityOrder.indexOf(b.quality);

                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                }
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;
                return a.quality.localeCompare(b.quality);
            });

        if (isDebug)
            logger.debug(
                `[Admin API] Found ${sortedQualitiesWithCounts.length} unique qualities with counts.`
            );

        res.json({ qualities: sortedQualitiesWithCounts });
    })
);

/**
 * @swagger
 * /api/admin/jellyfin-qualities-with-counts:
 *   get:
 *     summary: Get Jellyfin qualities with content counts
 *     description: Retrieves available video qualities from Jellyfin servers with item counts
 *     tags: ['Admin']
 *     responses:
 *       200:
 *         description: Quality data with counts
 *       401:
 *         description: Niet geautoriseerd.
 */
app.get(
    '/api/admin/jellyfin-qualities-with-counts',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug)
            logger.debug(
                '[Admin API] Request received for /api/admin/jellyfin-qualities-with-counts.'
            );

        const currentConfig = await readConfig();
        const enabledServers = currentConfig.mediaServers.filter(
            s => s.enabled && s.type === 'jellyfin'
        );

        if (enabledServers.length === 0) {
            return res.json({ qualities: [] });
        }

        const allQualityCounts = new Map();

        for (const server of enabledServers) {
            try {
                const qualitiesWithCounts = await getJellyfinQualitiesWithCounts(server);
                // Accumulate counts across servers
                qualitiesWithCounts.forEach(({ quality, count }) => {
                    allQualityCounts.set(quality, (allQualityCounts.get(quality) || 0) + count);
                });
            } catch (error) {
                console.warn(
                    `[Admin API] Failed to get qualities with counts from ${server.name}: ${error.message}`
                );
            }
        }

        // Convert to array and sort by quality preference
        const qualityOrder = ['SD', '720p', '1080p', '4K'];
        const sortedQualitiesWithCounts = Array.from(allQualityCounts.entries())
            .map(([quality, count]) => ({ quality, count }))
            .sort((a, b) => {
                const aIndex = qualityOrder.indexOf(a.quality);
                const bIndex = qualityOrder.indexOf(b.quality);

                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                }
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;
                return a.quality.localeCompare(b.quality);
            });

        if (isDebug)
            logger.debug(
                `[Admin API] Found ${sortedQualitiesWithCounts.length} unique qualities with counts.`
            );

        res.json({ qualities: sortedQualitiesWithCounts });
    })
);

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
 *         description: Niet geautoriseerd.
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
            if (isDebug) console.error('[Admin API] TMDB test failed:', error);
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
 *         description: Niet geautoriseerd.
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
            console.error(`[Admin API] Failed to get TMDB genres: ${error.message}`);
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
                console.error('[Admin API] Error getting genres from test TMDB:', error.message);
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
 *         description: Niet geautoriseerd.
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

        const isValidPassword = await bcrypt.compare(
            currentPassword,
            process.env.ADMIN_PASSWORD_HASH
        );
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
                    console.error(
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
                    console.error(
                        `[Admin API] PM2 restart command failed after response was sent.`
                    );
                    console.error(`[Admin API] Error: ${error.message}`);
                    if (stderr) console.error(`[Admin API] PM2 stderr: ${stderr}`);
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
            console.error('[Admin API] Error getting system status:', error);
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
                const underPM2 = !!process.env.PM2_HOME;
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
                console.warn('[Admin API] Could not get disk stats:', e.message);
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
            console.error('[Admin API] Error getting performance metrics:', error);
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
 *       - isAuthenticated: []
 *     responses:
 *       200:
 *         description: Cache debug information
 *       401:
 *         description: Niet geautoriseerd.
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
            console.error('[Admin API] Error clearing image cache:', error);
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
 *       - isAuthenticated: []
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
            console.error('[Admin API] Error getting cache stats:', error);
            throw new ApiError(
                500,
                'Failed to get cache statistics. Check server logs for details.'
            );
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
 *       - isAuthenticated: []
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
 *       - isAuthenticated: []
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
                                    console.warn(
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
                                    console.warn(
                                        '[Admin API] Failed to remove expired file:',
                                        oldFile.file,
                                        err.message
                                    );
                            }
                        }
                    } catch (err) {
                        if (isDebug)
                            console.warn(
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
            if (isDebug) console.error('[Admin API] Error during cache cleanup:', error);
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
    const apiKey = process.env.API_ACCESS_TOKEN || null;
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
    const hasKey = !!(process.env.API_ACCESS_TOKEN || '').trim();
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

    const STARTUP_FETCH_TIMEOUT_MS = Math.max(
        5000,
        Number(process.env.STARTUP_FETCH_TIMEOUT_MS || 12000)
    );

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
        });
        // SSE route is registered earlier (before 404 handler)
        // Initialize WebSocket hub once server is listening
        try {
            wsHub.init(httpServer, {
                path: '/ws/devices',
                verifyDevice: deviceStore.verifyDevice,
            });
        } catch (e2) {
            logger.warn('[WS] init failed', e2);
        }

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
                console.error(
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

        // Serve static files (CSS, JS, etc.) from the 'public' directory
        siteApp.use(express.static(path.join(__dirname, 'public')));

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
    logger.info('Cleaning up server resources...');

    // Clear global intervals
    if (global.memoryCheckInterval) {
        clearInterval(global.memoryCheckInterval);
    }
    // Always normalize to null so tests can assert strict null
    global.memoryCheckInterval = null;

    if (global.tmdbCacheCleanupInterval) {
        clearInterval(global.tmdbCacheCleanupInterval);
        global.tmdbCacheCleanupInterval = null;
    }

    //

    if (global.playlistRefreshInterval) {
        clearInterval(global.playlistRefreshInterval);
        global.playlistRefreshInterval = null;
    }

    if (global.cacheCleanupInterval) {
        clearInterval(global.cacheCleanupInterval);
        global.cacheCleanupInterval = null;
    }

    // Cleanup source instances
    if (global.tmdbSourceInstance && typeof global.tmdbSourceInstance.cleanup === 'function') {
        global.tmdbSourceInstance.cleanup();
        global.tmdbSourceInstance = null;
    }

    //

    // Cleanup cache and auth managers
    if (cacheManager && typeof cacheManager.cleanup === 'function') {
        cacheManager.cleanup();
    }

    if (cacheDiskManager && typeof cacheDiskManager.cleanup === 'function') {
        cacheDiskManager.cleanup();
    }

    // Cleanup API cache middleware
    if (global.apiCacheInstance && typeof global.apiCacheInstance.destroy === 'function') {
        global.apiCacheInstance.destroy();
        global.apiCacheInstance = null;
    }

    // Cleanup metrics manager
    if (metricsManager && typeof metricsManager.shutdown === 'function') {
        metricsManager.shutdown();
    }

    logger.info('Server cleanup completed');
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
if (process.env.EXPOSE_INTERNAL_ENDPOINTS === 'true') {
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
