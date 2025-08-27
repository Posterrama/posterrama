/**
 * posterrama.app - Server-side logic for multiple media sources
 *
 * Author: Mark Frelink
 * Last Modified: 2025-07-27
 * License: GPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const logger = require('./utils/logger');

// Handle uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', error => {
    logger.fatal('Uncaught Exception:', error);
    // Give the logger time to write before exiting
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, _promise) => {
    logger.fatal('Unhandled Promise Rejection:', reason);
});

// Track memory usage
const MEMORY_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
global.memoryCheckInterval = setInterval(() => {
    const used = process.memoryUsage();
    logger.debug('Memory Usage:', {
        rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(used.external / 1024 / 1024)}MB`,
    });
}, MEMORY_CHECK_INTERVAL);

// Override console methods to use the logger
const originalConsoleLog = console.log;
console.log = (...args) => {
    logger.info(...args);
    originalConsoleLog.apply(console, args);
};
const originalConsoleError = console.error;
console.error = (...args) => {
    logger.error(...args);
    originalConsoleError.apply(console, args);
};
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
    logger.warn(...args);
    originalConsoleWarn.apply(console, args);
};

const path = require('path');
const fs = require('fs');
require('dotenv').config();
const crypto = require('crypto');
const { PassThrough } = require('stream');
const fsp = fs.promises;

// --- Auto Cache Busting ---
const cachedVersions = {};
let lastVersionCheck = 0;
const VERSION_CACHE_TTL = 10000; // Cache versions for 10 seconds

function generateAssetVersion(filePath) {
    try {
        const fullPath = path.join(__dirname, 'public', filePath);
        const stats = fs.statSync(fullPath);
        // Use modification time as version
        return Math.floor(stats.mtime.getTime() / 1000).toString(36);
    } catch (error) {
        // Fallback to current timestamp if file doesn't exist
        return Math.floor(Date.now() / 1000).toString(36);
    }
}

function getAssetVersions() {
    const now = Date.now();
    if (now - lastVersionCheck > VERSION_CACHE_TTL) {
        const criticalAssets = [
            'script.js',
            'admin.js',
            'style.css',
            'admin.css',
            'sw.js',
            'client-logger.js',
            'manifest.json',
        ];

        criticalAssets.forEach(asset => {
            cachedVersions[asset] = generateAssetVersion(asset);
        });

        lastVersionCheck = now;
        logger.debug('Asset versions refreshed:', cachedVersions);
    }

    return cachedVersions;
}

// --- Auto-create .env if missing ---
const envPath = path.join(__dirname, '.env');
const exampleEnvPath = path.join(__dirname, 'config.example.env');
if (!fs.existsSync(envPath)) {
    if (fs.existsSync(exampleEnvPath)) {
        fs.copyFileSync(exampleEnvPath, envPath);
        logger.info('[Config] .env aangemaakt op basis van config.example.env');
    } else {
        console.error('[Config] config.example.env ontbreekt, kan geen .env aanmaken!');
        process.exit(1);
    }
}

// --- Auto-create config.json if missing ---
const configPath = path.join(__dirname, 'config.json');
const exampleConfigPath = path.join(__dirname, 'config.example.json');
if (!fs.existsSync(configPath)) {
    if (fs.existsSync(exampleConfigPath)) {
        fs.copyFileSync(exampleConfigPath, configPath);
        logger.info('[Config] config.json aangemaakt op basis van config.example.json');
    } else {
        console.error('[Config] config.example.json ontbreekt, kan geen config.json aanmaken!');
        process.exit(1);
    }
}

// Define paths early
const imageCacheDir = path.join(__dirname, 'image_cache');

// --- Environment Initialization ---
// Automatically create and configure the .env file on first run.
(function initializeEnvironment() {
    const envPath = path.join(__dirname, '.env');
    const exampleEnvPath = path.join(__dirname, 'config.example.env');
    const sessionsPath = path.join(__dirname, 'sessions');
    const cacheDir = path.join(__dirname, 'cache');
    const logsDir = path.join(__dirname, 'logs');

    try {
        // Ensure all required directories exist before the application starts.
        // Using sync methods here prevents race conditions with middleware initialization.
        logger.info('Creating required directories...');

        fs.mkdirSync(sessionsPath, { recursive: true });
        fs.mkdirSync(imageCacheDir, { recursive: true });
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });

        logger.info(
            '✓ All required directories created/verified: sessions, image_cache, cache, logs'
        );
    } catch (error) {
        console.error('FATAL ERROR: Could not create required directories.', error);
        process.exit(1);
    }

    try {
        // Check if .env file exists
        fs.accessSync(envPath);
    } catch (error) {
        // If .env doesn't exist, copy from config.example.env
        if (error.code === 'ENOENT') {
            logger.debug('.env file not found, creating from config.example.env...');
            fs.copyFileSync(exampleEnvPath, envPath);
            logger.debug('.env file created successfully.');
            // Reload dotenv to pick up the new file
            require('dotenv').config({ override: true });
        } else {
            console.error('Error checking .env file:', error);
            process.exit(1);
        }
    }

    // Validate SESSION_SECRET
    if (!process.env.SESSION_SECRET) {
        logger.info('SESSION_SECRET is missing, generating a new one...');
        const newSecret = require('crypto').randomBytes(32).toString('hex');
        // Read the .env file
        const envContent = fs.readFileSync(envPath, 'utf8');
        // Append the new secret to the .env file
        const newEnvContent = envContent + `\nSESSION_SECRET="${newSecret}"\n`;
        // Write the updated content back to the .env file
        fs.writeFileSync(envPath, newEnvContent, 'utf8');
        logger.info('New SESSION_SECRET generated and saved to .env.');

        // If running under PM2, trigger a restart. The current process will likely crash
        // due to the missing session secret, and PM2 will restart it. The new process
        // will then load the secret correctly from the .env file.
        if (process.env.PM2_HOME) {
            logger.debug(
                'Running under PM2. Triggering a restart to apply the new SESSION_SECRET...'
            );
            const { exec } = require('child_process');
            const ecosystemConfig = require('./ecosystem.config.js');
            const appName = ecosystemConfig.apps[0].name || 'posterrama';

            exec(`pm2 restart ${appName}`, error => {
                if (error)
                    console.error(`[Initial Setup] PM2 restart command failed: ${error.message}`);
            });
        } else {
            console.warn(
                'SESSION_SECRET was generated, but the app does not appear to be running under PM2. A manual restart is recommended.'
            );
            // If not under PM2, we can update the current process's env and continue.
            process.env.SESSION_SECRET = newSecret;
        }
    }
})();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcrypt');
const { exec } = require('child_process');
const PlexAPI = require('plex-api');
const fetch = require('node-fetch');

// Check if config.json exists, if not copy from config.example.json
(function ensureConfigExists() {
    const configPath = './config.json';
    const exampleConfigPath = './config.example.json';

    try {
        fs.accessSync(configPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.debug('config.json not found, creating from config.example.json...');
            try {
                fs.copyFileSync(exampleConfigPath, configPath);
                logger.debug('config.json created successfully from example.');
            } catch (copyError) {
                console.error(
                    'FATAL ERROR: Could not create config.json from config.example.json:',
                    copyError
                );
                process.exit(1);
            }
        } else {
            console.error('Error checking config.json:', error);
            process.exit(1);
        }
    }
})();

const config = require('./config.json');
const swaggerUi = require('swagger-ui-express');
const pkg = require('./package.json');
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
    TVDB_MOVIES: 50,
    TVDB_SHOWS: 50,
    TOTAL_CAP: 500, // Max total items in final playlist
});

const PlexSource = require('./sources/plex');
const JellyfinSource = require('./sources/jellyfin');
const TMDBSource = require('./sources/tmdb');
const TVDBSource = require('./sources/tvdb');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const rateLimit = require('express-rate-limit');
const app = express();
const { ApiError, NotFoundError } = require('./utils/errors.js');
const ratingCache = require('./utils/rating-cache.js');

// Use process.env with a fallback to config.json
const port = process.env.SERVER_PORT || config.serverPort || 4000;
const isDebug = process.env.DEBUG === 'true';

// Helper function to get local IP address
function getLocalIPAddress() {
    const os = require('os');
    const interfaces = os.networkInterfaces();

    // Look for the first non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (i.e., 127.0.0.1) and IPv6 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    // Fallback to localhost if no external IP found
    return 'localhost';
}

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

// Initialize cache disk manager
const cacheDiskManager = new CacheDiskManager(imageCacheDir, config.cache || {});

// Metrics system
const metricsManager = require('./utils/metrics');
const { metricsMiddleware } = require('./middleware/metrics');

// GitHub integration
const githubService = require('./utils/github');

// Auto-updater system
const autoUpdater = require('./utils/updater');

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

        const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';

        logger[logLevel]('Request completed', {
            ...requestLog,
            status: res.statusCode,
            duration: `${duration.toFixed(2)}ms`,
            contentLength: res.get('content-length'),
        });

        // Log slow requests
        if (duration > 1000) {
            // 1 second threshold
            logger.warn('Slow request detected', {
                ...requestLog,
                duration: `${duration.toFixed(2)}ms`,
                status: res.statusCode,
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

// Rate Limiting
const { createRateLimiter } = require('./middleware/rateLimiter');

// General API Rate Limiting (more lenient for screensaver usage)
const apiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    1000, // Max requests (increased for heavy usage)
    'Too many requests from this IP, please try again later.'
);

// Admin API Rate Limiting (more lenient for development/testing)
const adminApiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    500, // Max requests (increased for admin testing)
    'Too many admin API requests from this IP, please try again later.'
);

// Apply rate limiting
app.use('/api/admin/', adminApiLimiter);

// In test mode, use more lenient rate limiting for all /api/ routes
const testApiLimiter =
    process.env.NODE_ENV === 'test'
        ? createRateLimiter(
              15 * 60 * 1000,
              1000,
              'Too many requests from this IP, please try again later.'
          )
        : apiLimiter;

app.use('/api/', testApiLimiter);
app.use('/get-config', apiLimiter);
app.use('/get-media', apiLimiter);
app.use('/get-media-by-key', apiLimiter);
app.use('/image', apiLimiter);

// Lightweight template injection for admin.html to stamp asset version
/**
 * @swagger
 * /admin:
 *   get:
 *     summary: Serve admin panel HTML
 *     description: >
 *       Serves the admin panel HTML with asset version stamping for cache busting.
 *       Injects the ASSET_VERSION into the HTML template before serving.
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Admin panel HTML
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 * /admin.html:
 *   get:
 *     summary: Serve admin panel HTML (alternative route)
 *     description: Alternative route for admin panel HTML with asset version stamping
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Admin panel HTML
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
app.get(['/admin', '/admin.html'], (req, res, next) => {
    const filePath = path.join(__dirname, 'public', 'admin.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) return next(err);

        // Get current asset versions
        const versions = getAssetVersions();

        // Replace asset version placeholders with individual file versions
        const stamped = contents
            .replace(/\{\{ASSET_VERSION\}\}/g, ASSET_VERSION)
            // Normalize any admin.js existing query string to just v=<version>
            .replace(
                /admin\.js\?v=[^"&\s]+/g,
                `admin.js?v=${versions['admin.js'] || ASSET_VERSION}`
            )
            // Normalize any admin.css existing query string to just v=<version>
            .replace(
                /admin\.css\?v=[^"&\s]+/g,
                `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
            );

        res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
        res.send(stamped);
    });
});

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
app.get(['/', '/index.html'], (req, res, next) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) return next(err);

        // Get current asset versions
        const versions = getAssetVersions();

        // Replace asset version placeholders with individual file versions
        const stamped = contents
            .replace(
                /script\.js\?v=[^"&\s]+/g,
                `script.js?v=${versions['script.js'] || ASSET_VERSION}`
            )
            .replace(
                /style\.css\?v=[^"&\s]+/g,
                `style.css?v=${versions['style.css'] || ASSET_VERSION}`
            )
            // Stamp client-side logger
            .replace(
                /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
            )
            // Stamp manifest
            .replace(
                /\/manifest\.json(\?v=[^"'\s>]+)?/g,
                `/manifest.json?v=${versions['manifest.json'] || ASSET_VERSION}`
            )
            // Ensure service worker registration always fetches latest sw.js
            .replace(/\/sw\.js(\?v=[^"'\s>]+)?/g, `/sw.js?v=${versions['sw.js'] || ASSET_VERSION}`);

        res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
        res.send(stamped);
    });
});

/**
 * @swagger
 * /promo.html:
 *   get:
 *     summary: Serve promotional page
 *     description: Serves the promotional page with automatic asset versioning and cache-busting for iOS devices
 *     tags: ['Frontend']
 *     responses:
 *       200:
 *         description: Promotional page HTML content
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       500:
 *         description: Internal server error
 */
// Serve promo.html with the same asset stamping and iOS cache-busting
app.get('/promo.html', (req, res, next) => {
    const filePath = path.join(__dirname, 'public', 'promo.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) return next(err);

        const versions = getAssetVersions();

        const stamped = contents
            .replace(
                /script\.js\?v=[^"&\s]+/g,
                `script.js?v=${versions['script.js'] || ASSET_VERSION}`
            )
            .replace(
                /style\.css\?v=[^"&\s]+/g,
                `style.css?v=${versions['style.css'] || ASSET_VERSION}`
            )
            .replace(
                /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
            )
            .replace(
                /\/manifest\.json(\?v=[^"'\s>]+)?/g,
                `/manifest.json?v=${versions['manifest.json'] || ASSET_VERSION}`
            )
            .replace(/\/sw\.js(\?v=[^"'\s>]+)?/g, `/sw.js?v=${versions['sw.js'] || ASSET_VERSION}`);

        res.setHeader('Cache-Control', 'no-cache');
        res.send(stamped);
    });
});

// Add metrics collection middleware
app.use(metricsMiddleware);

// Input Validation Middleware and Endpoints
const {
    createValidationMiddleware,
    validateQueryParams,
    validateGetConfigQuery,
    validateGetMediaQuery,
    validateImageQuery,
    validateMediaKeyParam,
    schemas,
} = require('./middleware/validate');

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
app.use('/api/v1/get-media', validateQueryParams);

/**
 * @swagger
 * /api/v1/test-error:
 *   get:
 *     summary: Test error handling (Development only)
 *     description: Throws a test error to verify error handling middleware works correctly
 *     tags: ['Testing']
 *     responses:
 *       500:
 *         description: Test error thrown successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "This is a test error"
 */
app.get('/api/v1/test-error', (req, res, next) => {
    const error = new Error('This is a test error');
    next(error);
});

/**
 * @swagger
 * /api/v1/test-async-error:
 *   get:
 *     summary: Test async error handling (Development only)
 *     description: Throws a test async error to verify async error handling middleware works correctly
 *     tags: ['Testing']
 *     responses:
 *       500:
 *         description: Test async error thrown successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "This is a test async error"
 */
app.get('/api/v1/test-async-error', async (req, res, next) => {
    try {
        throw new Error('This is a test async error');
    } catch (error) {
        next(error);
    }
});

// Metrics Dashboard API Endpoints

/**
 * @swagger
 * /api/v1/metrics/performance:
 *   get:
 *     summary: Get performance metrics
 *     description: Returns current performance metrics including response times, throughput, and resource usage
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Performance metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 responseTime:
 *                   type: object
 *                   description: Average response times
 *                 throughput:
 *                   type: object
 *                   description: Requests per second metrics
 *                 resourceUsage:
 *                   type: object
 *                   description: CPU and memory usage
 */
app.get('/api/v1/metrics/performance', (req, res) => {
    const metrics = metricsManager.getPerformanceMetrics();
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/endpoints:
 *   get:
 *     summary: Get endpoint metrics
 *     description: Returns metrics for individual API endpoints including request counts and response times
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Endpoint metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 endpoints:
 *                   type: object
 *                   description: Per-endpoint metrics
 */
app.get('/api/v1/metrics/endpoints', (req, res) => {
    const metrics = metricsManager.getEndpointMetrics();
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/errors:
 *   get:
 *     summary: Get error metrics
 *     description: Returns error statistics including error rates, error types, and recent errors
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Error metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 errorRate:
 *                   type: number
 *                   description: Current error rate percentage
 *                 errorTypes:
 *                   type: object
 *                   description: Breakdown by error type
 *                 recentErrors:
 *                   type: array
 *                   description: Recent error occurrences
 */
app.get('/api/v1/metrics/errors', (req, res) => {
    const metrics = metricsManager.getErrorMetrics();
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/cache:
 *   get:
 *     summary: Get cache metrics
 *     description: Returns cache performance metrics including hit rates, miss rates, and cache sizes
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Cache metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hitRate:
 *                   type: number
 *                   description: Cache hit rate percentage
 *                 missRate:
 *                   type: number
 *                   description: Cache miss rate percentage
 *                 size:
 *                   type: object
 *                   description: Cache size information
 */
app.get('/api/v1/metrics/cache', (req, res) => {
    const metrics = metricsManager.getCacheMetrics();
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/system:
 *   get:
 *     summary: Get system metrics
 *     description: Returns system-level metrics including memory usage, CPU usage, and uptime
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: System metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 memory:
 *                   type: object
 *                   description: Memory usage statistics
 *                 cpu:
 *                   type: object
 *                   description: CPU usage statistics
 *                 uptime:
 *                   type: number
 *                   description: Process uptime in seconds
 */
app.get('/api/v1/metrics/system', (req, res) => {
    const metrics = metricsManager.getSystemMetrics();
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/realtime:
 *   get:
 *     summary: Get real-time metrics
 *     description: Returns current real-time metrics for live monitoring dashboards
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Real-time metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current timestamp
 *                 metrics:
 *                   type: object
 *                   description: Current metric values
 */
app.get('/api/v1/metrics/realtime', (req, res) => {
    const metrics = metricsManager.getRealTimeMetrics();
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/history:
 *   get:
 *     summary: Get historical metrics
 *     description: Returns historical metrics data for the specified time period
 *     tags: ['Metrics']
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1h, 6h, 24h, 7d, 30d]
 *           default: 1h
 *         description: Time period for historical data
 *     responses:
 *       200:
 *         description: Historical metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period:
 *                   type: string
 *                   description: Requested time period
 *                 data:
 *                   type: array
 *                   description: Time-series metric data
 */
app.get('/api/v1/metrics/history', (req, res) => {
    const period = req.query.period || '1h';
    const metrics = metricsManager.getHistoricalMetrics(period);
    res.json(metrics);
});

/**
 * @swagger
 * /api/v1/metrics/dashboard:
 *   get:
 *     summary: Get dashboard summary metrics
 *     description: Returns a summary of key metrics suitable for dashboard display
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Dashboard metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   description: Key metric summaries
 *                 alerts:
 *                   type: array
 *                   description: Active alerts or warnings
 */
app.get('/api/v1/metrics/dashboard', (req, res) => {
    const summary = metricsManager.getDashboardSummary();
    res.json(summary);
});

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Prometheus metrics endpoint
 *     description: Returns metrics in Prometheus format for monitoring systems
 *     tags: ['Metrics']
 *     responses:
 *       200:
 *         description: Prometheus metrics data
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               description: Metrics in Prometheus text format
 */
app.get('/metrics', (req, res) => {
    const prometheusMetrics = metricsManager.exportMetrics('prometheus');
    res.set('Content-Type', 'text/plain');
    res.send(prometheusMetrics);
});

/**
 * @swagger
 * /api/v1/metrics/export:
 *   get:
 *     summary: Export metrics in various formats
 *     description: Exports all metrics data in the specified format (JSON or Prometheus)
 *     tags: ['Metrics']
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, prometheus]
 *           default: json
 *         description: Export format
 *     responses:
 *       200:
 *         description: Metrics exported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Metrics data in JSON format
 *           text/plain:
 *             schema:
 *               type: string
 *               description: Metrics data in Prometheus format
 */
app.get('/api/v1/metrics/export', (req, res) => {
    const format = req.query.format || 'json';
    const metrics = metricsManager.exportMetrics(format);

    if (format === 'prometheus') {
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
    } else {
        res.json(metrics);
    }
});

/**
 * @swagger
 * /api/v1/admin/metrics/config:
 *   post:
 *     summary: Update metrics configuration
 *     description: Updates the metrics collection configuration
 *     tags: ['Metrics', 'Admin API']
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
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
        logger.info(`[Request Logger] Received: ${req.method} ${req.originalUrl}`);
        next();
    });
}

// Session middleware setup
app.use(
    session({
        store: new FileStore({
            path: './sessions', // Sessions will be stored in a 'sessions' directory
            logFn: isDebug ? logger.debug : () => {},
            ttl: 86400 * 7, // Session TTL in seconds (7 days)
            reapInterval: 86400, // Clean up expired sessions once a day
            retries: 3, // Retry file operations up to 3 times
        }),
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

// Wrapper for async routes to catch errors and pass them to the error handler
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Returns the standard options for a PlexAPI client instance to ensure consistent identification.
 * These options include application identifier, name, version and platform details for Plex server
 * identification and analytics.
 * @returns {object} An object containing the Plex client options with identifier and app metadata.
 */
function getPlexClientOptions() {
    // Default options ensure the app identifies itself correctly.
    // These can be overridden by setting a "plexClientOptions" object in config.json.
    const defaultOptions = {
        identifier: 'c8a5f7d1-b8e9-4f0a-9c6d-3e1f2a5b6c7d', // Static UUID for this app instance
        product: 'posterrama.app',
        version: pkg.version,
        deviceName: 'posterrama.app',
        platform: 'Node.js',
    };

    const finalOptions = { ...defaultOptions, ...(config.plexClientOptions || {}) };

    return {
        // These options must be nested inside an 'options' object per plex-api documentation.
        options: finalOptions,
    };
}
/**
 * Fetches detailed metadata for a single Plex item and transforms it into the application's format.
 * Handles movies, TV shows, and their child items (seasons, episodes). For TV content,
 * fetches the parent show's metadata to ensure consistent background art.
 *
 * @param {object} itemSummary - The summary object of the media item from Plex.
 * @param {object} serverConfig - The configuration for the Plex server.
 * @param {PlexAPI} plex - An active PlexAPI client instance.
 * @returns {Promise<object|null>} A processed media item object containing metadata, URLs, and ratings,
 *                                or null if the item cannot be processed or is missing required data.
 * @throws {Error} If there are network errors or invalid responses from the Plex server.
 * @example
 * const mediaItem = await processPlexItem(
 *   { key: "/library/metadata/12345" },
 *   serverConfig,
 *   plexClient
 * );
 * if (mediaItem) {
 *   console.log('Processed:', mediaItem.title, mediaItem.rottenTomatoes?.score);
 * }
 */
async function processPlexItem(itemSummary, serverConfig, plex) {
    const getImdbUrl = guids => {
        if (guids && Array.isArray(guids)) {
            const imdbGuid = guids.find(guid => guid.id.startsWith('imdb://'));
            if (imdbGuid) {
                const imdbId = imdbGuid.id.replace('imdb://', '');
                return `https://www.imdb.com/title/${imdbId}/`;
            }
        }
        return null;
    };

    const getClearLogoPath = images => {
        if (images && Array.isArray(images)) {
            const logoObject = images.find(img => img.type === 'clearLogo');
            return logoObject ? logoObject.url : null;
        }
        return null;
    };

    const getRottenTomatoesData = (ratings, titleForDebug = 'Unknown') => {
        if (!ratings || !Array.isArray(ratings)) {
            return null;
        }

        const rtRating = ratings.find(r => r.image && r.image.includes('rottentomatoes'));

        if (!rtRating || typeof rtRating.value === 'undefined') {
            return null;
        }

        // --- START ENHANCED DEBUG LOGGING ---
        if (isDebug) {
            logger.debug(
                `[RT Debug] Processing rating for "${titleForDebug}". Raw rtRating object:`,
                JSON.stringify(rtRating)
            );
        }
        // --- END ENHANCED DEBUG LOGGING ---

        const score = parseFloat(rtRating.value);
        if (isNaN(score)) {
            return null;
        }

        // The score from Plex is on a 10-point scale, so we multiply by 10 for a percentage.
        const finalScore = Math.round(score * 10);

        const imageIdentifier = rtRating.image || '';
        const isCriticRating = rtRating.type === 'critic';
        let icon = 'rotten';

        // Heuristic for "Certified Fresh": We assume a high critic score (>= 85) indicates
        // this status, as the identifier from Plex ('ripe') doesn't distinguish it from regular "Fresh".
        if (isCriticRating && finalScore >= 85) {
            icon = 'certified-fresh';
        } else if (
            imageIdentifier.includes('ripe') ||
            imageIdentifier.includes('upright') ||
            finalScore >= 60
        ) {
            // 'ripe' is for critic fresh, 'upright' is for audience fresh. The score is a fallback.
            icon = 'fresh';
        }

        if (isDebug) {
            logger.debug(
                `[RT Debug] -> For "${titleForDebug}": Identifier: "${imageIdentifier}", Score: ${finalScore}, Determined Icon: "${icon}"`
            );
        }

        return {
            score: finalScore, // The 0-100 score for display
            icon: icon,
            originalScore: score, // The original 0-10 score for filtering
        };
    };

    try {
        if (!itemSummary.key) return null;
        const detailResponse = await plex.query(itemSummary.key);
        const item = detailResponse?.MediaContainer?.Metadata?.[0];
        if (!item) return null;

        let sourceItem = item; // This will be the movie or the show
        let backgroundArt = item.art; // Default to item's art

        if ((item.type === 'season' || item.type === 'episode') && item.parentKey) {
            const showDetails = await plex.query(item.parentKey).catch(() => null);
            if (showDetails?.MediaContainer?.Metadata?.[0]) {
                sourceItem = showDetails.MediaContainer.Metadata[0];
                backgroundArt = sourceItem.art; // Use the show's art for the background
            }
        }

        if (!backgroundArt || !sourceItem.thumb) return null;

        const imdbUrl = getImdbUrl(sourceItem.Guid);
        const clearLogoPath = getClearLogoPath(sourceItem.Image);
        const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${sourceItem.ratingKey}`;
        const rottenTomatoesData = getRottenTomatoesData(sourceItem.Rating, sourceItem.title);

        if (isDebug) {
            if (rottenTomatoesData) {
                logger.debug(
                    `[Plex Debug] Found Rotten Tomatoes data for "${sourceItem.title}": Score ${rottenTomatoesData.score}%, Icon ${rottenTomatoesData.icon}`
                );
            } else if (sourceItem.Rating) {
                // Only log if the Rating array exists but we couldn't parse RT data from it.
                logger.debug(
                    `[Plex Debug] Could not parse Rotten Tomatoes data for "${sourceItem.title}" from rating array:`,
                    JSON.stringify(sourceItem.Rating)
                );
            }
        }

        // Process genres from Plex data
        const genres =
            sourceItem.Genre && Array.isArray(sourceItem.Genre)
                ? sourceItem.Genre.map(genre => genre.tag)
                : null;

        return {
            key: uniqueKey,
            title: sourceItem.title,
            backgroundUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(backgroundArt)}`,
            posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.thumb)}`,
            clearLogoUrl: clearLogoPath
                ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(clearLogoPath)}`
                : null,
            tagline: sourceItem.tagline,
            rating: sourceItem.rating,
            contentRating: sourceItem.contentRating,
            year: sourceItem.year,
            imdbUrl: imdbUrl,
            rottenTomatoes: rottenTomatoesData,
            genres: genres,
            genre_ids:
                sourceItem.Genre && Array.isArray(sourceItem.Genre)
                    ? sourceItem.Genre.map(genre => genre.id)
                    : null,
            _raw: isDebug ? item : undefined,
        };
    } catch (e) {
        if (isDebug)
            logger.debug(
                `[Debug] Skipping item due to error fetching details for key ${itemSummary.key}: ${e.message}`
            );
        return null;
    }
}

// --- Client Management ---

/**
 * Creates a new PlexAPI client instance with the given options.
 * Sanitizes and validates the input parameters before creating the client.
 *
 * @param {object} options - The connection options.
 * @param {string} options.hostname - The Plex server hostname or IP. Will be sanitized to remove http/https prefixes.
 * @param {string|number} options.port - The Plex server port.
 * @param {string} options.token - The Plex authentication token (X-Plex-Token).
 * @param {number} [options.timeout] - Optional request timeout in milliseconds. Defaults to no timeout.
 * @returns {PlexAPI} A new PlexAPI client instance configured with the sanitized options.
 * @throws {ApiError} If required parameters are missing or if the hostname format is invalid.
 * @example
 * const plexClient = createPlexClient({
 *   hostname: '192.168.1.100',
 *   port: 32400,
 *   token: 'xyz123',
 *   timeout: 5000
 * });
 */
function createPlexClient({ hostname, port, token, timeout }) {
    if (!hostname || !port || !token) {
        throw new ApiError(500, 'Plex client creation failed: missing hostname, port, or token.');
    }

    // Sanitize hostname to prevent crashes if the user includes the protocol.
    let sanitizedHostname = hostname.trim();
    try {
        // The URL constructor needs a protocol to work.
        const fullUrl = sanitizedHostname.includes('://')
            ? sanitizedHostname
            : `http://${sanitizedHostname}`;
        const url = new URL(fullUrl);
        sanitizedHostname = url.hostname; // This extracts just the hostname/IP
        if (isDebug) logger.debug(`[Plex Client] Sanitized hostname to: "${sanitizedHostname}"`);
    } catch (e) {
        // Fallback for invalid URL formats that might still be valid hostnames (though unlikely)
        sanitizedHostname = sanitizedHostname.replace(/^https?:\/\//, '');
        if (isDebug)
            logger.debug(
                `[Plex Client] Could not parse hostname as URL, falling back to simple sanitization: "${sanitizedHostname}"`
            );
    }

    const clientOptions = {
        hostname: sanitizedHostname,
        port,
        token,
        ...getPlexClientOptions(),
    };

    if (timeout) clientOptions.timeout = timeout;
    return new PlexAPI(clientOptions);
}

/**
 * Performs a lightweight connection test for a given media server configuration.
 * @param {object} serverConfig The configuration object for the server from config.json.
 * @returns {Promise<{status: ('ok'|'error'), message: string}>} The result of the connection test.
 */
async function testServerConnection(serverConfig) {
    if (serverConfig.type === 'plex') {
        const startTime = process.hrtime();

        logger.debug('Testing Plex server connection', {
            action: 'plex_connection_test',
            server: {
                name: serverConfig.name,
                hostnameVar: serverConfig.hostnameEnvVar,
                portVar: serverConfig.portEnvVar,
            },
        });

        try {
            const hostname = process.env[serverConfig.hostnameEnvVar];
            const port = process.env[serverConfig.portEnvVar];
            const token = process.env[serverConfig.tokenEnvVar];

            if (!hostname || !port || !token) {
                throw new Error(
                    'Missing required environment variables (hostname, port, or token) for this server.'
                );
            }

            const testClient = createPlexClient({
                hostname,
                port,
                token,
                timeout: 5000, // 5-second timeout for health checks
            });

            // A lightweight query to check reachability and authentication
            await testClient.query('/');

            // Calculate response time
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const responseTime = seconds * 1000 + nanoseconds / 1000000;

            // Log success with metrics
            logger.info('Plex server connection test successful', {
                action: 'plex_connection_success',
                server: {
                    name: serverConfig.name,
                    hostname: hostname,
                    port: port,
                },
                metrics: {
                    responseTime: `${responseTime.toFixed(2)}ms`,
                },
            });

            // Log warning if connection was slow
            if (responseTime > 1000) {
                //  1 second threshold
                logger.warn('Slow Plex server response detected', {
                    action: 'plex_connection_slow',
                    server: {
                        name: serverConfig.name,
                        hostname: hostname,
                        port: port,
                    },
                    responseTime: `${responseTime.toFixed(2)}ms`,
                });
            }

            return { status: 'ok', message: 'Connection successful.' };
        } catch (error) {
            let errorMessage = error.message;
            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Connection refused. Check hostname and port.';

                logger.error('Plex server connection refused', {
                    action: 'plex_connection_refused',
                    server: {
                        name: serverConfig.name,
                        hostname: process.env[serverConfig.hostnameEnvVar],
                        port: process.env[serverConfig.portEnvVar],
                    },
                    error: {
                        code: error.code,
                        message: error.message,
                    },
                });
            } else if (error.message.includes('401 Unauthorized')) {
                errorMessage = 'Unauthorized. Check token.';
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'Connection timed out.';
            }
            return { status: 'error', message: `Plex connection failed: ${errorMessage}` };
        }
    } else if (serverConfig.type === 'jellyfin') {
        const startTime = process.hrtime();

        logger.debug('Testing Jellyfin server connection', {
            action: 'jellyfin_connection_test',
            server: {
                name: serverConfig.name,
                hostnameVar: serverConfig.hostnameEnvVar,
                portVar: serverConfig.portEnvVar,
            },
        });

        try {
            const hostname = process.env[serverConfig.hostnameEnvVar];
            const port = process.env[serverConfig.portEnvVar];
            const apiKey = process.env[serverConfig.tokenEnvVar];

            if (!hostname || !port || !apiKey) {
                throw new Error(
                    'Missing required environment variables (hostname, port, or API key) for this server.'
                );
            }

            const testClient = await createJellyfinClient({
                hostname,
                port,
                apiKey,
                timeout: 5000, // 5-second timeout for health checks
            });

            // A lightweight query to check reachability and authentication
            await testClient.systemApi.getPublicSystemInfo();

            // Calculate response time
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const responseTime = seconds * 1000 + nanoseconds / 1000000;

            // Log success with metrics
            logger.info('Jellyfin server connection test successful', {
                action: 'jellyfin_connection_success',
                server: {
                    name: serverConfig.name,
                    hostname: hostname,
                    port: port,
                },
                metrics: {
                    responseTime: `${responseTime.toFixed(2)}ms`,
                },
            });

            // Log warning if connection was slow
            if (responseTime > 1000) {
                //  1 second threshold
                logger.warn('Slow Jellyfin server response detected', {
                    action: 'jellyfin_connection_slow',
                    server: {
                        name: serverConfig.name,
                        hostname: hostname,
                        port: port,
                    },
                    responseTime: `${responseTime.toFixed(2)}ms`,
                });
            }

            return { status: 'ok', message: 'Connection successful.' };
        } catch (error) {
            let errorMessage = error.message;
            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Connection refused. Check hostname and port.';

                logger.error('Jellyfin server connection refused', {
                    action: 'jellyfin_connection_refused',
                    server: {
                        name: serverConfig.name,
                        hostname: process.env[serverConfig.hostnameEnvVar],
                        port: process.env[serverConfig.portEnvVar],
                    },
                    error: {
                        code: error.code,
                        message: error.message,
                    },
                });
            } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                errorMessage = 'Unauthorized. Check API key.';
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'Connection timed out.';
            }
            return { status: 'error', message: `Jellyfin connection failed: ${errorMessage}` };
        }
    }
    // Future server types can be added here
    return {
        status: 'error',
        message: `Unsupported server type for health check: ${serverConfig.type}`,
    };
}

/**
 * Caches PlexAPI clients to avoid re-instantiating for every request.
 * @type {Object.<string, PlexAPI>}
 */
const plexClients = {};
function getPlexClient(serverConfig) {
    // If a direct client is provided (for testing), use that
    if (serverConfig._directClient) {
        return serverConfig._directClient;
    }

    if (!plexClients[serverConfig.name]) {
        // Support both environment variables and direct values (for testing)
        const hostname = serverConfig.hostname || process.env[serverConfig.hostnameEnvVar];
        const port = serverConfig.port || process.env[serverConfig.portEnvVar];
        const token = serverConfig.token || process.env[serverConfig.tokenEnvVar];

        // The createPlexClient function will throw an error if details are missing.
        // This replaces the explicit token check that was here before.
        plexClients[serverConfig.name] = createPlexClient({ hostname, port, token });
    }
    return plexClients[serverConfig.name];
}

/**
 * Fetches all library sections from a Plex server and returns them as a Map.
 * @param {object} serverConfig - The configuration for the Plex server including connection details and options.
 * @returns {Promise<Map<string, object>>} A map of library titles to library objects containing metadata about each library section.
 * @throws {ApiError} If the server connection fails or the server returns an error response.
 * @example
 * const libraries = await getPlexLibraries(serverConfig);
 * for (const [title, library] of libraries) {
 *   console.log(`Found library: ${title}, type: ${library.type}`);
 * }
 */
async function getPlexLibraries(serverConfig) {
    const plex = getPlexClient(serverConfig);
    const sectionsResponse = await plex.query('/library/sections');
    const allSections = sectionsResponse?.MediaContainer?.Directory || [];
    const libraries = new Map();
    allSections.forEach(dir => libraries.set(dir.title, dir));
    return libraries;
}

async function getPlexGenres(serverConfig) {
    try {
        const plex = getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const genres = new Set();

        for (const [libraryName, library] of allLibraries) {
            // Only get genres from movie and show libraries
            if (library.type === 'movie' || library.type === 'show') {
                try {
                    // Get all unique genres from this library using the genre filter endpoint
                    const genreFilter = await plex.query(`/library/sections/${library.key}/genre`);
                    if (genreFilter?.MediaContainer?.Directory) {
                        genreFilter.MediaContainer.Directory.forEach(genreDir => {
                            if (genreDir.title) {
                                genres.add(genreDir.title);
                            }
                        });
                    }

                    // Fallback: if genre endpoint doesn't work, get from content
                    if (genres.size === 0) {
                        const content = await plex.query(
                            `/library/sections/${library.key}/all?limit=100`
                        );
                        if (content?.MediaContainer?.Metadata) {
                            content.MediaContainer.Metadata.forEach(item => {
                                if (item.Genre && Array.isArray(item.Genre)) {
                                    item.Genre.forEach(genre => {
                                        if (genre.tag) {
                                            genres.add(genre.tag);
                                        }
                                    });
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.warn(
                        `[getPlexGenres] Error fetching from library ${libraryName}: ${error.message}`
                    );
                }
            }
        }

        if (isDebug)
            logger.debug(
                `[getPlexGenres] Found ${genres.size} unique genres from ${allLibraries.size} libraries`
            );
        return Array.from(genres).sort();
    } catch (error) {
        console.error(`[getPlexGenres] Error: ${error.message}`);
        return [];
    }
}

/**
 * Get Plex genres with counts
 * @param {Object} serverConfig - Plex server configuration
 * @returns {Promise<Array>} Array of genre objects with {genre, count}
 */
async function getPlexGenresWithCounts(serverConfig) {
    try {
        const plex = getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const genreCounts = new Map();

        for (const [libraryName, library] of allLibraries) {
            // Only get genres from movie and show libraries
            if (library.type === 'movie' || library.type === 'show') {
                try {
                    // Get all unique genres with counts from this library
                    // First try the genre endpoint for available genres
                    const genreFilter = await plex.query(`/library/sections/${library.key}/genre`);
                    const availableGenres = new Set();

                    if (genreFilter?.MediaContainer?.Directory) {
                        genreFilter.MediaContainer.Directory.forEach(genreDir => {
                            if (genreDir.title) {
                                availableGenres.add(genreDir.title);
                            }
                        });
                    }

                    // Get actual content to count genres
                    const content = await plex.query(
                        `/library/sections/${library.key}/all?limit=1000&includeGuids=1`
                    );

                    if (content?.MediaContainer?.Metadata) {
                        content.MediaContainer.Metadata.forEach(item => {
                            if (item.Genre && Array.isArray(item.Genre)) {
                                item.Genre.forEach(genre => {
                                    if (genre.tag) {
                                        const genreName = genre.tag;
                                        genreCounts.set(
                                            genreName,
                                            (genreCounts.get(genreName) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.warn(
                        `[getPlexGenresWithCounts] Error fetching from library ${libraryName}: ${error.message}`
                    );
                }
            }
        }

        // Convert to array of objects and sort by genre name
        const result = Array.from(genreCounts.entries())
            .map(([genre, count]) => ({ genre, count }))
            .sort((a, b) => a.genre.localeCompare(b.genre));

        if (isDebug)
            logger.debug(
                `[getPlexGenresWithCounts] Found ${result.length} unique genres with counts from ${allLibraries.size} libraries`
            );

        return result;
    } catch (error) {
        console.error(`[getPlexGenresWithCounts] Error: ${error.message}`);
        return [];
    }
}

/**
 * Get all unique quality/resolution values with counts from a Plex server
 * @param {Object} serverConfig - Plex server configuration
 * @returns {Promise<Array>} Array of quality objects with count
 */
async function getPlexQualitiesWithCounts(serverConfig) {
    try {
        const plex = getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const qualityCounts = new Map();

        for (const [libraryName, library] of allLibraries) {
            // Only get qualities from movie and show libraries
            if (library.type === 'movie' || library.type === 'show') {
                try {
                    // Get actual content to extract quality information
                    const content = await plex.query(
                        `/library/sections/${library.key}/all?limit=1000&includeGuids=1`
                    );

                    if (content?.MediaContainer?.Metadata) {
                        content.MediaContainer.Metadata.forEach(item => {
                            if (item.Media && Array.isArray(item.Media)) {
                                item.Media.forEach(media => {
                                    if (media.videoResolution) {
                                        let quality;
                                        const resolution = media.videoResolution;

                                        // Map Plex resolution values to standardized quality labels
                                        switch (resolution) {
                                            case 'sd':
                                                quality = 'SD';
                                                break;
                                            case '720':
                                            case 'hd':
                                                quality = '720p';
                                                break;
                                            case '1080':
                                                quality = '1080p';
                                                break;
                                            case '4k':
                                                quality = '4K';
                                                break;
                                            default:
                                                // For unknown resolutions, use the raw value
                                                quality = resolution.toUpperCase();
                                        }

                                        qualityCounts.set(
                                            quality,
                                            (qualityCounts.get(quality) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.warn(
                        `[getPlexQualitiesWithCounts] Error fetching from library ${libraryName}: ${error.message}`
                    );
                }
            }
        }

        // Convert to array of objects and sort by quality preference (SD, 720p, 1080p, 4K, others)
        const qualityOrder = ['SD', '720p', '1080p', '4K'];
        const result = Array.from(qualityCounts.entries())
            .map(([quality, count]) => ({ quality, count }))
            .sort((a, b) => {
                const aIndex = qualityOrder.indexOf(a.quality);
                const bIndex = qualityOrder.indexOf(b.quality);

                // If both are in the predefined order, sort by order
                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                }
                // If only one is in predefined order, prioritize it
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;
                // If neither is in predefined order, sort alphabetically
                return a.quality.localeCompare(b.quality);
            });

        if (isDebug)
            logger.debug(
                `[getPlexQualitiesWithCounts] Found ${result.length} unique qualities with counts from ${allLibraries.size} libraries`
            );

        return result;
    } catch (error) {
        console.error(`[getPlexQualitiesWithCounts] Error: ${error.message}`);
        return [];
    }
}

// --- JELLYFIN UTILITY FUNCTIONS ---

/**
 * Caches Jellyfin API clients to avoid re-instantiating for every request.
 * @type {Object.<string, Object>}
 */
const jellyfinClients = {};

/**
 * Creates and caches a Jellyfin API client instance.
 * @param {object} serverConfig - The server configuration from config.json
 * @returns {object} Jellyfin API client with authentication methods
 */
async function getJellyfinClient(serverConfig) {
    // If a direct client is provided (for testing), use that
    if (serverConfig._directClient) {
        return serverConfig._directClient;
    }

    if (!jellyfinClients[serverConfig.name]) {
        // Support both environment variables and direct values (for testing)
        const hostname = serverConfig.hostname || process.env[serverConfig.hostnameEnvVar];
        const port = serverConfig.port || process.env[serverConfig.portEnvVar];
        const apiKey = serverConfig.apiKey || process.env[serverConfig.tokenEnvVar];

        // Create Jellyfin client
        jellyfinClients[serverConfig.name] = await createJellyfinClient({ hostname, port, apiKey });
    }
    return jellyfinClients[serverConfig.name];
}

/**
 * Fetches libraries from a Jellyfin client
 * @param {JellyfinHttpClient} client - Jellyfin HTTP client instance
 * @returns {Promise<Array>} Array of library objects
 */
async function fetchJellyfinLibraries(client) {
    try {
        const libraries = await client.getLibraries();

        if (isDebug) {
            logger.debug(
                `[fetchJellyfinLibraries] Found ${libraries.length} libraries:`,
                libraries.map(lib => `${lib.Name} (${lib.CollectionType})`)
            );
        }

        return libraries;
    } catch (error) {
        logger.error(`[fetchJellyfinLibraries] Error: ${error.message}`);
        throw error;
    }
}

/**
 * Creates a new Jellyfin HTTP client instance with the given options.
 * @param {object} options - Client configuration options
 * @param {string} options.hostname - Jellyfin server hostname/IP
 * @param {number} options.port - Jellyfin server port
 * @param {string} options.apiKey - Jellyfin API key for authentication
 * @param {number} [options.timeout] - Request timeout in milliseconds
 * @returns {Promise<object>} A new Jellyfin HTTP client instance
 */
async function createJellyfinClient({ hostname, port, apiKey, timeout = 15000 }) {
    if (!hostname || !port || !apiKey) {
        throw new ApiError(
            500,
            'Jellyfin client creation failed: missing hostname, port, or API key.'
        );
    }

    const { JellyfinHttpClient } = require('./utils/jellyfin-http-client');

    // Sanitize hostname to prevent crashes if the user includes the protocol
    let sanitizedHostname = hostname.trim();
    try {
        const fullUrl = sanitizedHostname.includes('://')
            ? sanitizedHostname
            : `http://${sanitizedHostname}`;
        const url = new URL(fullUrl);
        sanitizedHostname = url.hostname;
        if (isDebug)
            logger.debug(`[Jellyfin Client] Sanitized hostname to: "${sanitizedHostname}"`);
    } catch (e) {
        sanitizedHostname = sanitizedHostname.replace(/^https?:\/\//, '');
        if (isDebug)
            logger.debug(
                `[Jellyfin Client] Could not parse hostname as URL, falling back to simple sanitization: "${sanitizedHostname}"`
            );
    }

    const client = new JellyfinHttpClient({
        hostname: sanitizedHostname,
        port,
        apiKey,
        timeout,
    });

    // Test connection to ensure it works
    await client.testConnection();

    return client;
}

/**
 * Fetches all library sections from a Jellyfin server and returns them as a Map.
 * @param {object} serverConfig - The configuration for the Jellyfin server
 * @returns {Promise<Map<string, object>>} A map of library names to library objects
 */
async function getJellyfinLibraries(serverConfig) {
    try {
        const client = await getJellyfinClient(serverConfig);

        // Use our new HTTP client method
        const libraries = await client.getLibraries();
        const librariesMap = new Map();

        libraries.forEach(library => {
            // Jellyfin virtual folders use ItemId instead of Id
            const libraryId = library.ItemId || library.Id;
            if (library.Name && libraryId) {
                librariesMap.set(library.Name, {
                    id: libraryId,
                    name: library.Name,
                    type: library.CollectionType || 'mixed',
                });
            }
        });

        if (isDebug) {
            logger.debug(`[getJellyfinLibraries] Found ${librariesMap.size} libraries`);
        }

        return librariesMap;
    } catch (error) {
        logger.error(`[getJellyfinLibraries] Error: ${error.message}`);
        throw new ApiError(500, `Failed to fetch Jellyfin libraries: ${error.message}`);
    }
}

/**
 * Processes a Jellyfin media item and converts it to Posterrama format.
 * @param {object} item - Raw Jellyfin item object
 * @param {object} serverConfig - Server configuration
 * @param {object} client - Jellyfin client instance
 * @returns {object|null} Processed media item or null if invalid
 */
function processJellyfinItem(item, serverConfig, client) {
    try {
        if (!item || !item.Id || !item.Name) {
            return null;
        }

        // Determine media type
        const mediaType =
            item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'show' : 'unknown';

        if (mediaType === 'unknown') {
            return null;
        }

        // Build poster and backdrop URLs using the image proxy
        let posterUrl = null;
        let backdropUrl = null;
        let clearLogoUrl = null;

        // Use the dedicated Primary endpoint for posters only if image exists
        if (item.ImageTags && item.ImageTags.Primary) {
            const primaryImageUrl = client.getImageUrl(item.Id, 'Primary');
            posterUrl = `/image?url=${encodeURIComponent(primaryImageUrl)}`;
        }

        // Use the dedicated Backdrop endpoint for backgrounds only if image exists
        if (
            (item.ImageTags && item.ImageTags.Backdrop) ||
            (item.BackdropImageTags && item.BackdropImageTags.length > 0)
        ) {
            const backdropImageUrl = client.getImageUrl(item.Id, 'Backdrop');
            backdropUrl = `/image?url=${encodeURIComponent(backdropImageUrl)}`;
        }

        // Use the dedicated Logo endpoint for clear logos only if image exists
        if (item.ImageTags && item.ImageTags.Logo) {
            const logoImageUrl = client.getImageUrl(item.Id, 'Logo');
            clearLogoUrl = `/image?url=${encodeURIComponent(logoImageUrl)}`;
        }

        // Extract metadata
        const processedItem = {
            id: `jellyfin_${item.Id}`,
            key: `jellyfin_${item.Id}`, // Add key property for consistency with Plex
            title: item.OriginalTitle || item.Name, // Prefer original title if available
            type: mediaType,
            year: item.ProductionYear || null,
            posterUrl: posterUrl,
            backgroundUrl: backdropUrl, // Use backgroundUrl for consistency with Plex
            clearLogoUrl: clearLogoUrl, // Add clear logo support
            poster: posterUrl, // Keep legacy property for backward compatibility
            overview: item.Overview || '',
            tagline: item.Taglines?.[0] || null, // Use first tagline from array
            genres: item.Genres || [],
            rating: item.CommunityRating || null,
            // Extended ratings information from Jellyfin
            ratings: {
                community: item.CommunityRating || null, // 0-10 scale
                official: item.OfficialRating || null, // MPAA rating (PG, R, etc.)
                user: item.UserData?.Rating || null, // User's personal rating
            },
            officialRating: item.OfficialRating || null, // Keep for backward compatibility
            source: 'jellyfin',
            serverName: serverConfig.name,
            originalData: item,
        };

        // Add type-specific metadata
        if (mediaType === 'movie') {
            processedItem.runtime = item.RunTimeTicks
                ? Math.round(item.RunTimeTicks / 600000000)
                : null; // Convert ticks to minutes
        } else if (mediaType === 'show') {
            processedItem.seasons = item.ChildCount || null;
        }

        return processedItem;
    } catch (error) {
        logger.warn(`[processJellyfinItem] Error processing item ${item?.Name}: ${error.message}`);
        return null;
    }
}

// --- Main Data Aggregation ---

async function getPlaylistMedia() {
    let allMedia = [];
    const enabledServers = config.mediaServers.filter(s => s.enabled);

    // Process Plex/Media Servers with error resilience
    for (const server of enabledServers) {
        if (isDebug) logger.debug(`[Debug] Fetching from server: ${server.name} (${server.type})`);

        try {
            let source;
            if (server.type === 'plex') {
                source = new PlexSource(
                    server,
                    getPlexClient,
                    processPlexItem,
                    getPlexLibraries,
                    shuffleArray,
                    config.rottenTomatoesMinimumScore,
                    isDebug
                );
            } else if (server.type === 'jellyfin') {
                source = new JellyfinSource(
                    server,
                    getJellyfinClient,
                    processJellyfinItem,
                    getJellyfinLibraries,
                    shuffleArray,
                    config.rottenTomatoesMinimumScore,
                    isDebug
                );
            } else {
                if (isDebug)
                    logger.debug(
                        `[Debug] Skipping server ${server.name} due to unsupported type ${server.type}`
                    );
                continue;
            }

            const movieLimit =
                server.type === 'plex' ? FIXED_LIMITS.PLEX_MOVIES : FIXED_LIMITS.JELLYFIN_MOVIES;
            const showLimit =
                server.type === 'plex' ? FIXED_LIMITS.PLEX_SHOWS : FIXED_LIMITS.JELLYFIN_SHOWS;

            // Fetch movies and shows separately with individual error handling
            let movies = [];
            let shows = [];

            // Try to fetch movies
            if (server.movieLibraryNames && server.movieLibraryNames.length > 0) {
                try {
                    movies = await source.fetchMedia(server.movieLibraryNames, 'movie', movieLimit);
                    if (isDebug)
                        logger.debug(`[Debug] Fetched ${movies.length} movies from ${server.name}`);
                } catch (error) {
                    logger.error(`[${server.name}] Failed to fetch movies:`, {
                        error: error.message,
                        libraries: server.movieLibraryNames,
                    });
                    // Continue with shows even if movies failed
                }
            }

            // Try to fetch shows
            if (server.showLibraryNames && server.showLibraryNames.length > 0) {
                try {
                    shows = await source.fetchMedia(server.showLibraryNames, 'show', showLimit);
                    if (isDebug)
                        logger.debug(`[Debug] Fetched ${shows.length} shows from ${server.name}`);
                } catch (error) {
                    logger.error(`[${server.name}] Failed to fetch shows:`, {
                        error: error.message,
                        libraries: server.showLibraryNames,
                    });
                    // Continue even if shows failed
                }
            }

            const mediaFromServer = movies.concat(shows);
            if (mediaFromServer.length > 0) {
                logger.info(
                    `[${server.name}] Successfully fetched ${mediaFromServer.length} items (${movies.length} movies, ${shows.length} shows)`
                );
                allMedia = allMedia.concat(mediaFromServer);
            } else {
                logger.warn(
                    `[${server.name}] No media fetched - check server configuration and connectivity`
                );
            }
        } catch (error) {
            // Server completely failed - log but continue with other servers
            logger.error(`[${server.name}] Server completely failed:`, {
                error: error.message,
                type: server.type,
            });
            // Continue with next server
        }
    }

    // Process TMDB Source
    if (config.tmdbSource && config.tmdbSource.enabled && config.tmdbSource.apiKey) {
        if (isDebug) logger.debug(`[Debug] Fetching from TMDB source`);

        // Add a name to the TMDB source for consistent logging
        const tmdbSourceConfig = { ...config.tmdbSource, name: 'TMDB' };
        const tmdbSource = new TMDBSource(tmdbSourceConfig, shuffleArray, isDebug);

        // Schedule periodic cache cleanup for TMDB source
        if (!global.tmdbCacheCleanupInterval) {
            global.tmdbCacheCleanupInterval = setInterval(
                () => {
                    if (global.tmdbSourceInstance) {
                        global.tmdbSourceInstance.cleanupCache();
                    }
                },
                10 * 60 * 1000
            ); // Clean up every 10 minutes
        }
        global.tmdbSourceInstance = tmdbSource;

        const [tmdbMovies, tmdbShows] = await Promise.all([
            tmdbSource.fetchMedia('movie', FIXED_LIMITS.TMDB_MOVIES),
            tmdbSource.fetchMedia('tv', FIXED_LIMITS.TMDB_TV),
        ]);
        const tmdbMedia = tmdbMovies.concat(tmdbShows);

        if (isDebug) logger.debug(`[Debug] Fetched ${tmdbMedia.length} items from TMDB.`);
        allMedia = allMedia.concat(tmdbMedia);
    }

    // Process Streaming Sources
    if (config.streamingSources && Array.isArray(config.streamingSources)) {
        for (const streamingConfig of config.streamingSources) {
            if (streamingConfig.enabled && streamingConfig.apiKey) {
                logger.debug(
                    `[Streaming Debug] Fetching from: ${streamingConfig.name} (Category: ${streamingConfig.category})`
                );
                logger.debug(
                    `[Streaming Debug] Settings - Movies: ${streamingConfig.movieCount || 0}, Shows: ${streamingConfig.showCount || 0}, Min Rating: ${streamingConfig.minRating || 0}, Region: ${streamingConfig.watchRegion || 'US'}`
                );

                const streamingSource = new TMDBSource(streamingConfig, shuffleArray, isDebug);

                try {
                    const [streamingMovies, streamingShows] = await Promise.all([
                        // Per provider fixed small limits to keep latency low
                        streamingSource.fetchMedia(
                            'movie',
                            FIXED_LIMITS.STREAMING_MOVIES_PER_PROVIDER
                        ),
                        streamingSource.fetchMedia('tv', FIXED_LIMITS.STREAMING_TV_PER_PROVIDER),
                    ]);
                    const streamingMedia = streamingMovies.concat(streamingShows);

                    logger.debug(
                        `[Streaming Debug] ${streamingConfig.name} results: ${streamingMovies.length} movies + ${streamingShows.length} shows = ${streamingMedia.length} total items`
                    );
                    if (streamingMedia.length === 0) {
                        logger.debug(
                            `[Streaming Debug] WARNING: No content found for ${streamingConfig.name} - check provider ID or regional availability`
                        );
                    }
                    allMedia = allMedia.concat(streamingMedia);
                } catch (error) {
                    console.error(
                        `[Error] Failed to fetch from streaming source ${streamingConfig.name}: ${error.message}`
                    );
                }
            } else {
                if (!streamingConfig.enabled) {
                    logger.info(`[Streaming Debug] Skipping ${streamingConfig.name} - disabled`);
                } else if (!streamingConfig.apiKey) {
                    logger.info(`[Streaming Debug] Skipping ${streamingConfig.name} - no API key`);
                }
            }
        }
    }

    // Process TVDB Source
    if (config.tvdbSource && config.tvdbSource.enabled) {
        if (isDebug) logger.debug(`[Debug] Fetching from TVDB source`);

        // Enforce fixed limits regardless of admin-config
        const tvdbSource = new TVDBSource({
            ...config.tvdbSource,
            movieCount: FIXED_LIMITS.TVDB_MOVIES,
            showCount: FIXED_LIMITS.TVDB_SHOWS,
        });

        // Schedule periodic cache cleanup for TVDB source
        if (!global.tvdbCacheCleanupInterval) {
            global.tvdbCacheCleanupInterval = setInterval(
                () => {
                    if (global.tvdbSourceInstance) {
                        global.tvdbSourceInstance.clearCache();
                    }
                },
                10 * 60 * 1000
            ); // Clean up every 10 minutes
        }
        global.tvdbSourceInstance = tvdbSource;

        const [tvdbMovies, tvdbShows] = await Promise.all([
            tvdbSource.getMovies(),
            tvdbSource.getShows(),
        ]);
        const tvdbMedia = tvdbMovies.concat(tvdbShows);

        if (isDebug) logger.debug(`[Debug] Fetched ${tvdbMedia.length} items from TVDB.`);
        allMedia = allMedia.concat(tvdbMedia);
    }

    return allMedia;
}

let playlistCache = null;
let cacheTimestamp = 0;
let isRefreshing = false; // Lock to prevent concurrent refreshes
let refreshStartTime = null; // Track when refresh started for auto-recovery

/**
 * Fetches media from all enabled servers and refreshes the in-memory cache.
 * Uses a locking mechanism to prevent concurrent refreshes.
 * Maintains the old cache in case of errors to prevent service interruption.
 * Logs performance metrics and memory usage.
 *
 * @returns {Promise<void>} Resolves when the refresh is complete.
 * @throws {Error} If media fetching fails. Errors are caught and logged but won't crash the server.
 * @example
 * await refreshPlaylistCache();
 * console.log(`Cache now contains ${playlistCache.length} items`);
 */
async function refreshPlaylistCache() {
    if (isRefreshing) {
        // Check if the current refresh is stuck
        if (refreshStartTime && Date.now() - refreshStartTime > 20000) {
            logger.warn('Force-clearing stuck refresh state before starting new refresh', {
                action: 'force_clear_stuck_refresh',
                stuckDuration: `${Date.now() - refreshStartTime}ms`,
            });
            isRefreshing = false;
            refreshStartTime = null;
        } else {
            logger.debug('Playlist refresh skipped - already in progress');
            return;
        }
    }

    const startTime = process.hrtime();
    isRefreshing = true;
    refreshStartTime = Date.now(); // Track when refresh started

    // Add a safety timeout to prevent stuck refresh state
    const refreshTimeout = setTimeout(() => {
        logger.warn('Playlist refresh timeout - forcing reset of isRefreshing flag', {
            action: 'playlist_refresh_timeout',
            duration: '15000ms',
        });
        isRefreshing = false;
        refreshStartTime = null;
    }, 15000); // 15 second timeout (was 60)

    logger.info('Starting playlist refresh', {
        action: 'playlist_refresh_start',
        timestamp: new Date().toISOString(),
    });

    try {
        // Track memory usage before fetch
        const memBefore = process.memoryUsage();

        let allMedia = await getPlaylistMedia();
        // Apply global cap before shuffling to bound payload size
        if (allMedia.length > FIXED_LIMITS.TOTAL_CAP) {
            logger.debug(
                `[Limits] Applying global cap: trimming ${allMedia.length} -> ${FIXED_LIMITS.TOTAL_CAP}`
            );
            allMedia = allMedia.slice(0, FIXED_LIMITS.TOTAL_CAP);
        }
        playlistCache = shuffleArray(allMedia);
        cacheTimestamp = Date.now();

        // Track memory usage after fetch
        const memAfter = process.memoryUsage();
        const [seconds, nanoseconds] = process.hrtime(startTime);
        const duration = seconds * 1000 + nanoseconds / 1000000;

        // Log success with performance metrics
        logger.info('Playlist refresh completed', {
            action: 'playlist_refresh_complete',
            metrics: {
                duration: `${duration.toFixed(2)}ms`,
                itemCount: playlistCache.length,
                memoryDelta: {
                    heapUsed: `${Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024)}MB`,
                    rss: `${Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024)}MB`,
                },
            },
        });

        // Log warning if refresh was slow
        if (duration > 5000) {
            // 5 seconds threshold
            logger.warn('Slow playlist refresh detected', {
                action: 'playlist_refresh_slow',
                duration: `${duration.toFixed(2)}ms`,
                itemCount: playlistCache.length,
            });
        }
    } catch (error) {
        logger.error('Playlist refresh failed', {
            action: 'playlist_refresh_error',
            error: error.message,
            stack: error.stack,
        });
        // We keep the old cache in case of an error
    } finally {
        clearTimeout(refreshTimeout);
        isRefreshing = false;
        refreshStartTime = null;
    }
}

// --- Admin Panel Logic ---

/**
 * Middleware to check if the user is authenticated.
 */
function isAuthenticated(req, res, next) {
    // 1. Check for session-based authentication (for browser users)
    if (req.session && req.session.user) {
        if (isDebug)
            logger.info(`[Auth] Authenticated via session for user: ${req.session.user.username}`);
        return next();
    }

    // 2. Check for API key authentication (for scripts, Swagger, etc.)
    const apiToken = process.env.API_ACCESS_TOKEN;
    const authHeader = req.headers.authorization;

    if (apiToken && authHeader && authHeader.startsWith('Bearer ')) {
        const providedToken = authHeader.substring(7, authHeader.length);

        // Use timing-safe comparison to prevent timing attacks
        const storedTokenBuffer = Buffer.from(apiToken);
        const providedTokenBuffer = Buffer.from(providedToken);

        if (
            storedTokenBuffer.length === providedTokenBuffer.length &&
            crypto.timingSafeEqual(storedTokenBuffer, providedTokenBuffer)
        ) {
            if (isDebug) logger.debug('[Auth] Authenticated via API Key.');
            // Attach a user object for consistency in downstream middleware/routes.
            req.user = { username: 'api_user', authMethod: 'apiKey' };
            return next();
        }
    }

    // 3. If neither method works, deny access.
    if (isDebug) {
        const reason = authHeader ? 'Invalid token' : 'No session or token';
        logger.info(`[Auth] Authentication failed. Reason: ${reason}`);
    }

    // For API requests, send a 401 JSON error.
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({
            error: 'Authentication required. Your session may have expired or your API token is invalid.',
        });
    }

    // For regular page navigations, redirect to the login page.
    return res.redirect('/admin/login');
}

/**
 * Reads the .env file and returns its content as a string.
 */
async function readEnvFile() {
    try {
        return await fsp.readFile('.env', 'utf-8');
    } catch (error) {
        if (error.code === 'ENOENT') return ''; // File doesn't exist yet
        throw error;
    }
}

/**
 * Writes new values to the .env file while preserving existing content.
 * Creates a backup of the current .env file before making changes.
 * Updates both the file and process.env for immediate effect.
 *
 * @param {Object} newValues - An object with key-value pairs to write.
 * @throws {Error} If file operations fail or if backup creation fails.
 * @example
 * await writeEnvFile({
 *   SERVER_PORT: '4000',
 *   DEBUG: 'true'
 * });
 */
async function writeEnvFile(newValues) {
    // Log environment update attempt
    logger.info('Environment update initiated', {
        action: 'env_update',
        keys: Object.keys(newValues).map(key => {
            // Mask sensitive values in logs
            const isSensitive =
                key.toLowerCase().includes('token') ||
                key.toLowerCase().includes('password') ||
                key.toLowerCase().includes('secret') ||
                key.toLowerCase().includes('apikey');
            return {
                key,
                type: isSensitive ? 'sensitive' : 'regular',
            };
        }),
    });

    try {
        const content = await readEnvFile();
        const lines = content.split('\n');
        const updatedKeys = new Set(Object.keys(newValues));
        const previousEnv = { ...process.env };

        const newLines = lines.map(line => {
            if (line.trim() === '' || line.trim().startsWith('#')) {
                return line;
            }
            const [key] = line.split('=');
            if (updatedKeys.has(key)) {
                updatedKeys.delete(key);
                return `${key}="${newValues[key]}"`;
            }
            return line;
        });

        // Add any new keys that weren't in the file
        updatedKeys.forEach(key => {
            newLines.push(`${key}="${newValues[key]}"`);
        });

        const newContent = newLines.join('\n');

        // Create a backup of the current .env file
        const backupPath = '.env.backup';
        await fsp.writeFile(backupPath, content, 'utf-8');
        logger.debug('Created .env backup file', {
            action: 'env_backup',
            path: backupPath,
        });

        // Write the new content
        await fsp.writeFile('.env', newContent, 'utf-8');

        // Update process.env for the current running instance
        Object.assign(process.env, newValues);

        // Log successful environment update with changes
        logger.info('Environment updated successfully', {
            action: 'env_update_success',
            changes: Object.keys(newValues).map(key => {
                const isSensitive =
                    key.toLowerCase().includes('token') ||
                    key.toLowerCase().includes('password') ||
                    key.toLowerCase().includes('secret') ||
                    key.toLowerCase().includes('apikey');
                return {
                    key,
                    type: isSensitive ? 'sensitive' : 'regular',
                    changed: previousEnv[key] !== newValues[key],
                };
            }),
        });
    } catch (error) {
        logger.error('Failed to update environment', {
            action: 'env_update_error',
            error: error.message,
            stack: error.stack,
        });
        throw error;
    }
}

/**
 * Reads the config.json file.
 */
async function readConfig() {
    const content = await fsp.readFile('./config.json', 'utf-8');
    return JSON.parse(content);
}

/**
 * Writes to the config.json file using a safe, atomic write process.
 * Creates a temporary file and renames it to avoid partial writes.
 * Updates the in-memory config object after successful write.
 *
 * @param {object} newConfig - The new configuration object to write.
 * @throws {Error} If file operations fail or if JSON serialization fails.
 * @example
 * await writeConfig({
 *   mediaServers: [{
 *     name: 'MainPlex',
 *     type: 'plex',
 *     enabled: true
 *   }],
 *   clockWidget: true
 * });
 */
async function writeConfig(newConfig) {
    // Log configuration change attempt
    logger.info('Configuration update initiated', {
        action: 'config_update',
        changes: Object.keys(newConfig).filter(key => !key.startsWith('_')),
    });

    // Create a deep copy to avoid mutating the original config
    const configCopy = JSON.parse(JSON.stringify(newConfig));

    // Remove metadata before writing
    delete configCopy._metadata;
    const newContent = JSON.stringify(configCopy, null, 2);
    const tempPath = './config.json.tmp';
    const finalPath = './config.json';

    try {
        // Write to a temporary file first
        logger.debug('About to write temp config file', {
            action: 'config_write_start',
            tempPath,
            contentLength: newContent.length,
        });

        await fsp.writeFile(tempPath, newContent, 'utf-8');

        // Log backup creation
        logger.debug('Created temporary config backup', {
            action: 'config_backup',
            tempPath,
        });

        // Atomically rename the temp file to the final file
        logger.debug('About to rename temp file', {
            action: 'config_rename_start',
            tempPath,
            finalPath,
        });

        await fsp.rename(tempPath, finalPath);

        // Update the in-memory config for the current running instance
        const previousConfig = { ...config };
        Object.assign(config, newConfig);

        // Log successful configuration change with detailed diff
        logger.info('Configuration updated successfully', {
            action: 'config_update_success',
            changes: Object.keys(newConfig).reduce((acc, key) => {
                if (
                    !key.startsWith('_') &&
                    JSON.stringify(newConfig[key]) !== JSON.stringify(previousConfig[key])
                ) {
                    acc[key] = {
                        previous: previousConfig[key],
                        new: newConfig[key],
                    };
                }
                return acc;
            }, {}),
        });
    } catch (error) {
        logger.error('Failed to update configuration', {
            action: 'config_update_error',
            error: error.message,
            stack: error.stack,
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            path: error.path,
        });

        // Attempt to clean up the temporary file on error
        try {
            await fsp.unlink(tempPath);
            logger.debug('Cleaned up temporary config file after error', {
                action: 'config_cleanup',
                tempPath,
            });
        } catch (cleanupError) {
            logger.warn('Failed to clean up temporary config file', {
                action: 'config_cleanup_error',
                error: cleanupError.message,
            });
        }
        throw error; // Re-throw the original error
    }
}

/**
 * Checks if the admin user has been set up.
 */
function isAdminSetup() {
    return !!process.env.ADMIN_USERNAME && !!process.env.ADMIN_PASSWORD_HASH;
}

// --- Admin Panel Routes ---

/**
 * @swagger
 * /admin:
 *   get:
 *     summary: Admin panel homepage
 *     description: Serves the main admin panel interface. Redirects to setup if not configured, requires authentication.
 *     tags: ['Admin Panel']
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
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
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
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.send(updatedHtml);
            });
        }
    });
});

/**
 * @swagger
 * /admin/logs:
 *   get:
 *     summary: Admin logs viewer
 *     description: Serves the live log viewer page for administrators
 *     tags: ['Admin Panel']
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
        const versions = getAssetVersions();

        // Replace asset version placeholders with individual file versions
        const stamped = contents.replace(
            /admin\.css\?v=[^"&\s]+/g,
            `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
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
// Import health check utilities
const { getBasicHealth, getDetailedHealth } = require('./utils/healthCheck');

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health Check Endpoint
 *     description: >
 *       Health check endpoint that returns basic service status by default.
 *       Use ?detailed=true query parameter for comprehensive health checks
 *       including configuration validation, filesystem access, and media server connectivity.
 *     tags: ['Public API']
 *     parameters:
 *       - in: query
 *         name: detailed
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether to perform detailed health checks
 *     responses:
 *       200:
 *         description: Health check completed
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/BasicHealthResponse'
 *                 - $ref: '#/components/schemas/HealthCheckResponse'
 */
app.get(
    '/health',
    asyncHandler(async (req, res) => {
        const detailed = req.query.detailed === 'true';

        if (detailed) {
            const health = await getDetailedHealth();
            res.json(health);
        } else {
            const health = getBasicHealth();
            res.json(health);
        }
    })
);

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
app.get(
    '/get-config',
    validateGetConfigQuery,
    cacheMiddleware({
        ttl: 30000, // 30 seconds instead of 10 minutes
        cacheControl: 'public, max-age=30',
        varyHeaders: ['Accept-Encoding', 'User-Agent'], // Add User-Agent to vary headers
    }),
    (req, res) => {
        const userAgent = req.get('user-agent') || '';
        const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);

        if (isDebug) {
            logger.debug(
                `[get-config] Request from ${isMobile ? 'mobile' : 'desktop'} device: ${userAgent.substring(0, 50)}...`
            );
        }

        res.json({
            clockWidget: config.clockWidget !== false,
            clockTimezone: config.clockTimezone || 'auto',
            clockFormat: config.clockFormat || '24h',
            cinemaMode: config.cinemaMode || false,
            cinemaOrientation: config.cinemaOrientation || 'auto',
            wallartMode: config.wallartMode || {
                enabled: false,
                itemsPerScreen: 30,
                columns: 6,
                transitionInterval: 30,
            },
            transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
            backgroundRefreshMinutes: 30,
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
            // Debug info for mobile genre filtering issue
            _debug: isDebug
                ? {
                      isMobile,
                      userAgent: userAgent.substring(0, 100),
                      configTimestamp: Date.now(),
                  }
                : undefined,
        });
    }
);

/**
 * @swagger
 * /get-media:
 *   get:
 *     summary: Retrieve the shuffled media playlist
 *     description: >
 *       Returns an array of media items from all configured and enabled media servers.
 *       This endpoint is also accessible via the versioned API at /api/v1/media.
 *       The response is served from an in-memory cache that is periodically refreshed
 *       in the background. If the cache is empty (e.g., on first startup), returns
 *       a 202 Accepted response while the playlist is being built. If no media servers
 *       are configured or the initial fetch fails, returns a 503 Service Unavailable.
 *       The playlist is shuffled to ensure random playback order.
 *     tags: ['Public API']
 *     responses:
 *       200:
 *         description: An array of media items.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MediaItem'
 *       202:
 *         description: The playlist is being built, please try again.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiMessage'
 *       503:
 *         description: Service unavailable. The initial media fetch may have failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiMessage'
 */
app.get(
    '/get-media',
    validateGetMediaQuery,
    apiCacheMiddleware.media,
    asyncHandler(async (req, res) => {
        // Skip caching if nocache param is present (for admin invalidation)
        if (req.query.nocache === '1') {
            res.setHeader('Cache-Control', 'no-store');
        }

        // If the cache is not null, it means the initial fetch has completed (even if it found no items).
        // An empty array is a valid state if no servers are configured or no media is found.
        if (playlistCache !== null) {
            const itemCount = playlistCache.length;
            const userAgent = req.get('user-agent') || '';
            const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);

            if (isDebug) {
                logger.debug(
                    `[Debug] Serving ${itemCount} items from cache to ${isMobile ? 'mobile' : 'desktop'} device.`
                );

                // Extra debug for mobile devices showing empty results
                if (isMobile && itemCount === 0) {
                    logger.debug(
                        `[Debug] WARNING: Empty cache for mobile device. User-Agent: ${userAgent.substring(0, 100)}`
                    );
                    logger.debug(
                        `[Debug] Current config.mediaServers:`,
                        JSON.stringify(
                            config.mediaServers?.map(s => ({
                                name: s.name,
                                enabled: s.enabled,
                                genreFilter: s.genreFilter,
                                movieCount: s.movieCount,
                                showCount: s.showCount,
                            })),
                            null,
                            2
                        )
                    );
                }
            }

            return res.json(playlistCache);
        }

        if (isRefreshing) {
            // Check if refresh has been stuck for too long (over 20 seconds)
            if (refreshStartTime && Date.now() - refreshStartTime > 20000) {
                logger.warn('Detected stuck refresh state - forcing reset', {
                    action: 'stuck_refresh_reset',
                    stuckDuration: `${Date.now() - refreshStartTime}ms`,
                });
                isRefreshing = false;
                refreshStartTime = null;

                // Start a new refresh
                refreshPlaylistCache();

                return res.status(202).json({
                    status: 'building',
                    message:
                        'Playlist refresh was stuck and has been restarted. Please try again in a few seconds.',
                    retryIn: 3000,
                });
            }

            // The full cache is being built. Tell the client to wait and try again.
            if (isDebug)
                logger.debug('[Debug] Cache is empty but refreshing. Sending 202 Accepted.');
            // 202 Accepted is appropriate here: the request is accepted, but processing is not complete.
            return res.status(202).json({
                status: 'building',
                message: 'Playlist is being built. Please try again in a few seconds.',
                retryIn: 2000, // Suggest a 2-second polling interval
            });
        }

        // If we get here, the cache is empty and we are not refreshing, which means the initial fetch failed.
        if (isDebug)
            logger.debug(
                '[Debug] Cache is empty and not refreshing. Sending 503 Service Unavailable.'
            );
        return res.status(503).json({
            status: 'failed',
            error: 'Media playlist is currently unavailable. The initial fetch may have failed. Check server logs.',
        });
    })
);

/**
 * @swagger
 * /get-media-by-key/{key}:
 *   get:
 *     summary: Retrieve a single media item by its unique key
 *     description: Fetches the full details for a specific media item, typically used when a user clicks on a 'recently added' item that isn't in the main playlist.
 *     tags: ['Public API']
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique key of the media item (e.g., plex-MyPlex-12345).
 *     responses:
 *       200:
 *         description: The requested media item.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MediaItem'
 *       404:
 *         description: Media item not found.
 */
app.get(
    '/get-media-by-key/:key',
    validateMediaKeyParam,
    asyncHandler(async (req, res) => {
        const keyParts = req.params.key.split('-'); // e.g., ['plex', 'My', 'Server', '12345']
        if (keyParts.length < 3) {
            // Must have at least type, name, and key
            throw new ApiError(400, 'Invalid media key format.');
        }
        const type = keyParts.shift();
        const originalKey = keyParts.pop();
        const serverName = keyParts.join('-'); // Re-join the middle parts
        const serverConfig = config.mediaServers.find(
            s => s.name === serverName && s.type === type && s.enabled === true
        );

        if (!serverConfig) {
            throw new NotFoundError('Server configuration not found for this item.');
        }

        let mediaItem = null;
        if (type === 'plex') {
            const plex = getPlexClient(serverConfig);
            mediaItem = await processPlexItem(
                { key: `/library/metadata/${originalKey}` },
                serverConfig,
                plex
            );
        }
        if (mediaItem) {
            res.json(mediaItem);
        } else {
            throw new NotFoundError('Media not found or could not be processed.');
        }
    })
);

/**
 * @swagger
 * /image:
 *   get:
 *     summary: Image proxy
 *     description: Proxies image requests to the media server (Plex/Jellyfin) or external URLs to avoid exposing server details and tokens to the client.
 *     tags: ['Public API']
 *     parameters:
 *       - in: query
 *         name: server
 *         schema:
 *           type: string
 *         description: The name of the server config from config.json (for Plex-style paths).
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *         description: The image path from the media item object (e.g., /library/metadata/12345/art/...).
 *       - in: query
 *         name: url
 *         schema:
 *           type: string
 *         description: Direct URL to proxy (for Jellyfin and external images).
 *     responses:
 *       200:
 *         description: The requested image.
 *         content:
 *           image/*: {}
 *       400:
 *         description: Bad request, missing parameters.
 *       302:
 *         description: Redirects to a fallback image on error.
 */
app.get(
    '/image',
    validateImageQuery,
    cacheMiddleware({
        ttl: 86400000, // 24 hours
        cacheControl: 'public, max-age=86400',
        varyHeaders: ['Accept-Encoding'],
        keyGenerator: req =>
            `image:${req.query.server || 'url'}-${req.query.path || req.query.url}`,
    }),
    asyncHandler(async (req, res) => {
        const imageCacheDir = path.join(__dirname, 'image_cache');
        const { server: serverName, path: imagePath, url: directUrl } = req.query;

        if (isDebug) {
            logger.debug(
                `[Image Proxy] Request for image received. Server: "${serverName}", Path: "${imagePath}", URL: "${directUrl}"`
            );
        }

        // Check if we have either server+path or direct URL
        if ((!serverName || !imagePath) && !directUrl) {
            if (isDebug)
                logger.debug(
                    '[Image Proxy] Bad request: either (server name and image path) or direct URL is required.'
                );
            return res
                .status(400)
                .send('Either (server name and image path) or direct URL is required');
        }

        // Create a unique and safe filename for the cache
        const cacheKey = directUrl || `${serverName}-${imagePath}`;
        const cacheHash = crypto.createHash('sha256').update(cacheKey).digest('hex');
        const fileExtension = directUrl
            ? path.extname(new URL(directUrl).pathname) || '.jpg'
            : path.extname(imagePath) || '.jpg';
        const cachedFilePath = path.join(imageCacheDir, `${cacheHash}${fileExtension}`);

        // 1. Check if file exists in cache
        try {
            await fsp.access(cachedFilePath);
            if (isDebug)
                logger.debug(
                    `[Image Cache] HIT: Serving "${directUrl || imagePath}" from cache file: ${cachedFilePath}`
                );
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
            return res.sendFile(cachedFilePath);
        } catch (e) {
            // File does not exist, proceed to fetch
            if (isDebug)
                logger.debug(
                    `[Image Cache] MISS: "${directUrl || imagePath}". Fetching from origin.`
                );
        }

        let imageUrl;
        const fetchOptions = { method: 'GET', headers: {} };

        // 2. Handle direct URL proxying (for Jellyfin and external images)
        if (directUrl) {
            imageUrl = directUrl;
            if (isDebug) logger.debug(`[Image Proxy] Using direct URL: ${imageUrl}`);
        } else {
            // 3. Handle server-based proxying (for Plex)
            const serverConfig = config.mediaServers.find(s => s.name === serverName);
            if (!serverConfig) {
                console.error(
                    `[Image Proxy] Server configuration for "${serverName}" not found. Cannot process image request.`
                );
                return res.redirect('/fallback-poster.png');
            }

            if (serverConfig.type === 'plex') {
                const token = process.env[serverConfig.tokenEnvVar];
                if (!token) {
                    console.error(
                        `[Image Proxy] Plex token not configured for server "${serverName}" (env var: ${serverConfig.tokenEnvVar}).`
                    );
                    return res.redirect('/fallback-poster.png');
                }
                const hostname = process.env[serverConfig.hostnameEnvVar];
                const port = process.env[serverConfig.portEnvVar];
                imageUrl = `http://${hostname}:${port}${imagePath}`;
                fetchOptions.headers['X-Plex-Token'] = token;
            } else if (serverConfig.type === 'jellyfin') {
                const token = process.env[serverConfig.tokenEnvVar];
                if (!token) {
                    console.error(
                        `[Image Proxy] Jellyfin token not configured for server "${serverName}" (env var: ${serverConfig.tokenEnvVar}).`
                    );
                    return res.redirect('/fallback-poster.png');
                }
                const hostname = process.env[serverConfig.hostnameEnvVar];
                const port = process.env[serverConfig.portEnvVar];
                imageUrl = `http://${hostname}:${port}${imagePath}`;
                fetchOptions.headers['X-Emby-Token'] = token;
            } else {
                console.error(
                    `[Image Proxy] Unsupported server type "${serverConfig.type}" for server "${serverName}".`
                );
                return res.redirect('/fallback-poster.png');
            }
        }

        if (isDebug) logger.debug(`[Image Proxy] Fetching from origin URL: ${imageUrl}`);

        try {
            const mediaServerResponse = await fetch(imageUrl, fetchOptions);

            if (!mediaServerResponse.ok) {
                console.warn(
                    `[Image Proxy] Media server "${serverName}" returned status ${mediaServerResponse.status} for path "${imagePath}".`
                );
                console.warn(`[Image Proxy] Serving fallback image for "${imagePath}".`);
                return res.redirect('/fallback-poster.png');
            }

            // Set headers on the client response
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 86400 seconds = 24 hours
            const contentType = mediaServerResponse.headers.get('content-type');
            res.setHeader('Content-Type', contentType || 'image/jpeg');

            // 3. Pipe the response to both the client and the cache file
            const passthrough = new PassThrough();
            mediaServerResponse.body.pipe(passthrough);

            const fileStream = fs.createWriteStream(cachedFilePath);
            passthrough.pipe(fileStream);
            passthrough.pipe(res);

            fileStream.on('finish', async () => {
                if (isDebug)
                    logger.debug(
                        `[Image Cache] SUCCESS: Saved "${imagePath}" to cache: ${cachedFilePath}`
                    );

                // Check if auto cleanup is enabled and perform cleanup if needed
                const config = await readConfig();
                if (config.cache?.autoCleanup !== false) {
                    try {
                        const cleanupResult = await cacheDiskManager.cleanupCache();
                        if (cleanupResult.cleaned && cleanupResult.deletedFiles > 0) {
                            logger.info('Automatic cache cleanup performed', {
                                trigger: 'image_cache_write',
                                deletedFiles: cleanupResult.deletedFiles,
                                freedSpaceMB: cleanupResult.freedSpaceMB,
                            });
                        }
                    } catch (cleanupError) {
                        logger.warn('Automatic cache cleanup failed', {
                            error: cleanupError.message,
                            trigger: 'image_cache_write',
                        });
                    }
                }
            });

            fileStream.on('error', err => {
                console.error(
                    `[Image Cache] ERROR: Failed to write to cache file ${cachedFilePath}:`,
                    err
                );
                // If caching fails, the user still gets the image, so we just log the error.
                // We should also clean up the potentially partial file.
                fsp.unlink(cachedFilePath).catch(unlinkErr => {
                    console.error(
                        `[Image Cache] Failed to clean up partial cache file ${cachedFilePath}:`,
                        unlinkErr
                    );
                });
            });
        } catch (error) {
            console.error(
                `[Image Proxy] Network or fetch error for path "${imagePath}" on server "${serverName}".`
            );

            if (error.name === 'AbortError') {
                console.error(`[Image Proxy] Fetch aborted, possibly due to timeout.`);
            } else if (error.message.startsWith('read ECONNRESET')) {
                console.error(
                    `[Image Proxy] Connection reset by peer. The media server may have closed the connection unexpectedly.`
                );
            }

            console.error(`[Image Proxy] Error: ${error.message}`);
            if (error.cause) console.error(`[Image Proxy] Cause: ${error.cause}`);
            console.warn(`[Image Proxy] Serving fallback image for "${imagePath}".`);
            res.redirect('/fallback-poster.png');
        }
    })
);

/**
 * @swagger
 * /admin/setup:
 *   get:
 *     summary: Admin setup page
 *     description: Serves the initial admin setup page if no admin user exists, otherwise redirects to admin panel
 *     tags: ['Admin Setup']
 *     responses:
 *       200:
 *         description: Setup page served successfully
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       302:
 *         description: Redirects to admin panel if setup is already complete
 */
app.get('/admin/setup', (req, res) => {
    // If setup is already done, normally redirect to /admin
    // But if the completion flag is present, serve the setup page so it can show the completion message
    const hasCompleteFlag = typeof req.query?.complete !== 'undefined';
    if (isAdminSetup() && !hasCompleteFlag) {
        return res.redirect('/admin');
    }

    const filePath = path.join(__dirname, 'public', 'setup.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) {
            console.error('Error reading setup.html:', err);
            return res.sendFile(filePath); // Fallback to static file
        }

        // Get current asset versions
        const versions = getAssetVersions();

        // Replace asset version placeholders with individual file versions
        const stamped = contents.replace(
            /admin\.css\?v=[^"&\s]+/g,
            `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
        );

        res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
        res.send(stamped);
    });
});

/**
 * @swagger
 * /admin/setup:
 *   post:
 *     summary: Complete admin setup
 *     description: Creates the initial admin user account with username and password
 *     tags: ['Admin Setup']
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Admin username
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Admin password
 *     responses:
 *       200:
 *         description: Admin setup completed successfully
 *       400:
 *         description: Missing username or password
 *       403:
 *         description: Admin user already configured
 */
app.post(
    '/admin/setup',
    express.urlencoded({ extended: true }),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin Setup] Received setup request.');
        if (isAdminSetup()) {
            if (isDebug) logger.debug('[Admin Setup] Aborted: Admin user is already configured.');
            throw new ApiError(403, 'Admin user is already configured.');
        }

        const { username, password, enable2fa } = req.body;
        if (!username || !password) {
            if (isDebug) logger.debug('[Admin Setup] Aborted: Username or password missing.');
            throw new ApiError(400, 'Username and password are required.');
        }

        if (password.length < 8) {
            if (isDebug) logger.debug('[Admin Setup] Aborted: Password too short.');
            throw new ApiError(400, 'Password must be at least 8 characters long.');
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const sessionSecret = require('crypto').randomBytes(32).toString('hex');

        let tfaSecret = '';
        let qrCodeDataUrl = null;

        // Check if 2FA should be enabled during setup
        if (enable2fa === 'true') {
            if (isDebug) logger.debug('[Admin Setup] Enabling 2FA during setup...');
            tfaSecret = speakeasy.generateSecret({
                name: 'Posterrama Admin',
                issuer: 'Posterrama',
            }).base32;

            // Generate QR code for setup
            const qrCodeUrl = speakeasy.otpauthURL({
                secret: tfaSecret,
                label: username,
                name: 'Posterrama Admin',
                issuer: 'Posterrama',
                encoding: 'base32',
            });

            qrCodeDataUrl = await qrcode.toDataURL(qrCodeUrl);
            if (isDebug) logger.debug('[Admin Setup] 2FA secret generated and QR code created.');
        } else {
            if (isDebug) logger.debug('[Admin Setup] 2FA not enabled during setup.');
        }

        await writeEnvFile({
            ADMIN_USERNAME: username,
            ADMIN_PASSWORD_HASH: passwordHash,
            SESSION_SECRET: sessionSecret,
            ADMIN_2FA_SECRET: tfaSecret, // Will be empty string if 2FA not enabled
        });

        if (isDebug)
            logger.debug(
                `[Admin Setup] Successfully created admin user "${username}". 2FA enabled: ${enable2fa === 'true'}`
            );

        // If 2FA was enabled and we're expecting JSON response (like from setup wizard)
        const wantsJson = String(req.headers.accept || '').includes('application/json');
        if (enable2fa === 'true' && qrCodeDataUrl) {
            return res.json({
                success: true,
                message: 'Admin user created successfully with 2FA enabled.',
                qrCodeDataUrl: qrCodeDataUrl,
            });
        }

        // If the client prefers JSON (fetch from setup wizard), avoid redirects to prevent fetch confusion
        if (wantsJson) {
            return res.json({ success: true, message: 'Admin user created successfully.' });
        }

        // Otherwise redirect to completion page
        res.redirect('/setup.html?complete=1');
    })
);

/**
 * @swagger
 * /admin/login:
 *   get:
 *     summary: Admin login page
 *     description: Serves the admin login page, redirects to setup if admin not configured, or to admin panel if already logged in
 *     tags: ['Admin Authentication']
 *     responses:
 *       200:
 *         description: Login page served successfully
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       302:
 *         description: Redirects to setup page or admin panel as appropriate
 */
app.get('/admin/login', (req, res) => {
    if (!isAdminSetup()) {
        return res.redirect('/admin/setup');
    }
    if (req.session.user) {
        return res.redirect('/admin');
    }

    const filePath = path.join(__dirname, 'public', 'login.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) {
            console.error('Error reading login.html:', err);
            return res.sendFile(filePath); // Fallback to static file
        }

        // Get current asset versions
        const versions = getAssetVersions();

        // Replace asset version placeholders with individual file versions
        const stamped = contents.replace(
            /admin\.css\?v=[^"&\s]+/g,
            `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
        );

        res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
        res.send(stamped);
    });
});

// Apply rate limiting to protect against brute-force password attacks.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        // Redirect to error page instead of throwing ApiError
        const errorMessage = encodeURIComponent(
            'Too many login attempts from this IP. Please try again after 15 minutes.'
        );
        return res.redirect(`/error.html?error=${errorMessage}`);
    },
});

/**
 * @swagger
 * /admin/login:
 *   post:
 *     summary: Admin login authentication
 *     description: Authenticate admin user with username and password. May require 2FA verification if enabled.
 *     tags: ['Admin Authentication']
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Admin username
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Admin password
 *     responses:
 *       200:
 *         description: Login successful (may redirect to 2FA verification)
 *       401:
 *         description: Invalid username or password
 *       429:
 *         description: Too many login attempts
 */
app.post('/admin/login', loginLimiter, express.urlencoded({ extended: true }), async (req, res) => {
    try {
        logger.info(`[Admin Login] POST /admin/login route hit`);
        if (isDebug) logger.debug(`[Admin Login] Received login request:`, req.body);

        const { username, password } = req.body;
        if (isDebug) logger.debug(`[Admin Login] Attempting login for user "${username}".`);

        // Check if admin is setup
        if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
            if (isDebug) logger.debug(`[Admin Login] Admin not setup yet.`);
            return res
                .status(400)
                .json({ error: 'Admin user not configured. Please run the setup first.' });
        }

        const isValidUser = username === process.env.ADMIN_USERNAME;
        if (!isValidUser) {
            if (isDebug)
                logger.info(`[Admin Login] Login failed for user "${username}". Invalid username.`);
            return res
                .status(401)
                .json({ error: 'Invalid username or password. Please try again.' });
        }

        const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
        if (!isValidPassword) {
            if (isDebug)
                logger.debug(
                    `[Admin Login] Login failed for user "${username}". Invalid credentials.`
                );
            return res
                .status(401)
                .json({ error: 'Invalid username or password. Please try again.' });
        }

        // --- Check if 2FA is enabled ---
        const secret = process.env.ADMIN_2FA_SECRET || '';
        const is2FAEnabled = secret.trim() !== '';

        if (is2FAEnabled) {
            // User is valid, but needs to provide a 2FA code.
            // Set a temporary flag in the session.
            req.session.tfa_required = true;
            req.session.tfa_user = { username: username }; // Store user info temporarily
            if (isDebug)
                logger.debug(
                    `[Admin Login] Credentials valid for "${username}". Requires 2FA verification.`
                );
            return res
                .status(200)
                .json({ success: true, requires2FA: true, redirectTo: '/admin/2fa-verify' });
        } else {
            // No 2FA, log the user in directly. Regenerate session to prevent fixation.
            return req.session.regenerate(err => {
                if (err) {
                    logger.error('[Admin Login] Error regenerating session:', err);
                    return res.status(500).json({ error: 'Internal server error.' });
                }
                req.session.user = { username };
                if (isDebug) logger.debug(`[Admin Login] Login successful for user "${username}".`);
                return res.status(200).json({
                    success: true,
                    requires2FA: false,
                    redirectTo: '/admin',
                });
            });
        }
    } catch (error) {
        console.error('[Admin Login] Error:', error);
        return res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
});

/**
 * @swagger
 * /admin/2fa-verify:
 *   get:
 *     summary: Two-factor authentication verification page
 *     description: Serves the 2FA verification page for users who have completed initial login
 *     tags: ['Authentication']
 *     responses:
 *       200:
 *         description: 2FA verification page served successfully
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       302:
 *         description: Redirect to login if 2FA not required
 */
app.get('/admin/2fa-verify', (req, res) => {
    // Only show this page if the user has passed the first step of login.
    if (!req.session.tfa_required) {
        return res.redirect('/admin/login');
    }

    const filePath = path.join(__dirname, 'public', '2fa-verify.html');
    fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) {
            console.error('Error reading 2fa-verify.html:', err);
            return res.sendFile(filePath); // Fallback to static file
        }

        // Get current asset versions
        const versions = getAssetVersions();

        // Replace asset version placeholders with individual file versions
        const stamped = contents.replace(
            /admin\.css\?v=[^"&\s]+/g,
            `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
        );

        res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
        res.send(stamped);
    });
});

// Apply a stricter rate limit for 2FA code attempts.
const twoFaLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Limit each IP to 5 verification requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: (req, res) => {
        // Redirecting with an error is better UX for this form.
        res.redirect('/admin/2fa-verify?error=rate_limited');
    },
});

/**
 * @swagger
 * /admin/2fa-verify:
 *   post:
 *     summary: Verify two-factor authentication code
 *     description: Verifies the TOTP code and completes the admin login process
 *     tags: ['Authentication']
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               totp_code:
 *                 type: string
 *                 description: 6-digit TOTP code from authenticator app
 *                 pattern: "^\\d{6}$"
 *             required:
 *               - totp_code
 *     responses:
 *       200:
 *         description: 2FA verification successful, user logged in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 redirectTo:
 *                   type: string
 *       400:
 *         description: Invalid or missing TOTP code
 *       302:
 *         description: Redirect to login if 2FA session expired
 */

app.post(
    '/admin/2fa-verify',
    twoFaLimiter,
    express.urlencoded({ extended: true }),
    asyncHandler(async (req, res) => {
        const { totp_code } = req.body;

        if (!req.session.tfa_required || !req.session.tfa_user) {
            if (isDebug)
                logger.debug(
                    '[Admin 2FA Verify] 2FA verification attempted without prior password validation. Redirecting to login.'
                );
            return res.redirect('/admin/login');
        }

        const secret = process.env.ADMIN_2FA_SECRET || '';
        const verified = speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token: totp_code,
            window: 1,
        });

        if (verified) {
            // Snapshot user before regenerating session; regeneration creates a new session object
            const { username } = req.session.tfa_user || {};
            // Rotate session on successful 2FA to prevent fixation
            await new Promise((resolve, reject) => {
                req.session.regenerate(err => {
                    if (err) return reject(err);
                    return resolve();
                });
            });
            req.session.user = { username };
            // Clean up any 2FA flags on the fresh session
            delete req.session.tfa_required;
            delete req.session.tfa_user;
            if (isDebug)
                logger.debug(
                    `[Admin 2FA Verify] 2FA verification successful for user "${username}".`
                );
            res.redirect('/admin');
        } else {
            if (isDebug)
                logger.debug(
                    `[Admin 2FA Verify] Invalid 2FA code for user "${req.session.tfa_user.username}".`
                );
            // Redirect back to the verification page with an error query parameter
            // for a better user experience than a generic error page.
            res.redirect('/admin/2fa-verify?error=invalid_code');
        }
    })
);

/**
 * @swagger
 * /admin/logout:
 *   get:
 *     summary: Admin logout
 *     description: Logs out the admin user by destroying their session and redirects to login page
 *     tags: ['Admin Authentication']
 *     responses:
 *       302:
 *         description: Session destroyed, redirects to login page
 *       500:
 *         description: Error destroying session
 */
app.get('/admin/logout', (req, res, next) => {
    if (isDebug) logger.debug(`[Admin Logout] User "${req.session.user?.username}" logging out.`);
    req.session.destroy(err => {
        if (err) {
            if (isDebug) console.error('[Admin Logout] Error destroying session:', err);
            return next(new ApiError(500, 'Could not log out.'));
        }
        if (isDebug) logger.debug('[Admin Logout] Session destroyed successfully.');
        // Clear cookie explicitly
        res.clearCookie('posterrama.sid');
        res.redirect('/admin/login');
    });
});

/**
 * @swagger
 * /api/admin/2fa/generate:
 *   post:
 *     summary: Generate a new 2FA secret
 *     description: >
 *       Generates a new secret for Two-Factor Authentication (2FA) and returns a QR code
 *       that the user can scan with an authenticator app. The secret is temporarily stored in the session
 *       and only becomes permanent after successful verification.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code and secret successfully generated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Generate2FAResponse'
 *       400:
 *         description: 2FA is already enabled.
 *       401:
 *         description: Unauthorized.
 */
app.post(
    '/api/admin/2fa/generate',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const secret = process.env.ADMIN_2FA_SECRET || '';
        const isEnabled = secret.trim() !== '';
        // Prevent generating a new secret if one is already active
        if (isEnabled) {
            throw new ApiError(400, '2FA is already enabled.');
        }

        const newSecret = speakeasy.generateSecret({
            length: 20,
            name: `posterrama.app (${req.session.user.username})`,
        });

        // Store the new secret in the session, waiting for verification.
        // This is crucial so we don't lock the user out if they fail to verify.
        req.session.tfa_pending_secret = newSecret.base32;

        const qrCodeDataUrl = await qrcode.toDataURL(newSecret.otpauth_url);
        res.json({ qrCodeDataUrl });
    })
);

/**
 * @swagger
 * /api/admin/2fa/verify:
 *   post:
 *     summary: Verify and enable 2FA
 *     description: >
 *       Verifies the TOTP code entered by the user against the temporary secret in the session.
 *       Upon success, the 2FA secret is permanently stored in the .env file and 2FA is activated.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Verify2FARequest'
 *     responses:
 *       200:
 *         description: 2FA successfully enabled.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Invalid verification code or no 2FA process pending.
 *       401:
 *         description: Niet geautoriseerd.
 */
app.post(
    '/api/admin/2fa/verify',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        const { token } = req.body;
        const pendingSecret = req.session.tfa_pending_secret;

        if (!pendingSecret) {
            throw new ApiError(400, 'No 2FA setup process is pending. Please try again.');
        }

        const verified = speakeasy.totp.verify({
            secret: pendingSecret,
            encoding: 'base32',
            token: token,
            window: 1,
        });

        if (verified) {
            // Verification successful, save the secret to the .env file
            await writeEnvFile({ ADMIN_2FA_SECRET: pendingSecret });

            // Clear the pending secret from the session
            delete req.session.tfa_pending_secret;

            if (isDebug)
                logger.debug(
                    `[Admin 2FA] 2FA enabled successfully for user "${req.session.user.username}".`
                );
            res.json({ success: true, message: '2FA enabled successfully.' });
        } else {
            if (isDebug)
                logger.debug(
                    `[Admin 2FA] 2FA verification failed for user "${req.session.user.username}".`
                );
            throw new ApiError(400, 'Invalid verification code. Please try again.');
        }
    })
);

/**
 * @swagger
 * /api/admin/2fa/disable:
 *   post:
 *     summary: Disable 2FA
 *     description: >
 *       Disables Two-Factor Authentication for the admin account.
 *       The user must provide their current password for confirmation.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Disable2FARequest'
 *     responses:
 *       200:
 *         description: 2FA successfully disabled.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Password is required.
 *       401:
 *         description: Invalid password or unauthorized.
 */
app.post(
    '/api/admin/2fa/disable',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        const { password } = req.body;
        if (!password) throw new ApiError(400, 'Password is required to disable 2FA.');
        const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
        if (!isValidPassword) throw new ApiError(401, 'Incorrect password.');
        await writeEnvFile({ ADMIN_2FA_SECRET: '' });
        if (isDebug)
            logger.debug(
                `[Admin 2FA] 2FA disabled successfully for user "${req.session.user.username}".`
            );
        res.json({ success: true, message: '2FA disabled successfully.' });
    })
);

// ============================================================================
// PUBLIC API ENDPOINTS
// ============================================================================

// ============================================================================
// RATING UTILITIES
// ============================================================================

/**
 * Fetch all available ratings from a Jellyfin server
 * @param {Object} serverConfig - Jellyfin server configuration
 * @returns {Promise<Array<string>>} Array of unique ratings
 */
async function fetchAllJellyfinRatings(serverConfig) {
    try {
        const client = await getJellyfinClient(serverConfig);
        const allLibraries = await getJellyfinLibraries(serverConfig);

        // Get library IDs that are configured for this server
        const configuredLibraries = [
            ...(serverConfig.movieLibraryNames || []),
            ...(serverConfig.showLibraryNames || []),
        ];
        const libraryIds = [];

        for (const libraryName of configuredLibraries) {
            const library = allLibraries.get(libraryName);
            if (library) {
                libraryIds.push(library.id);
            }
        }

        if (libraryIds.length === 0) {
            logger.warn(
                `[fetchAllJellyfinRatings] No configured libraries found for ${serverConfig.name}`
            );
            return [];
        }

        logger.info(
            `[fetchAllJellyfinRatings] Fetching ratings from ${libraryIds.length} libraries for ${serverConfig.name}`
        );
        const ratings = await client.getRatings(libraryIds);

        logger.info(
            `[fetchAllJellyfinRatings] Found ${ratings.length} unique ratings in ${serverConfig.name}:`,
            ratings
        );
        return ratings;
    } catch (error) {
        logger.error(
            `[fetchAllJellyfinRatings] Failed to fetch ratings for ${serverConfig.name}:`,
            error.message
        );
        return [];
    }
}

/**
 * Fetch all available content ratings from a Plex server
 * @param {object} serverConfig - The Plex server configuration
 * @returns {Promise<Array<string>>} Array of unique content ratings
 */
async function fetchAllPlexRatings(serverConfig) {
    try {
        const PlexHttpClient = require('./utils/plex-http-client');
        const plexClient = getPlexClient(serverConfig);
        const client = new PlexHttpClient(plexClient, serverConfig, isDebug);

        logger.info(`[fetchAllPlexRatings] Fetching ratings from ${serverConfig.name}`);
        const ratings = await client.getRatings();

        logger.info(
            `[fetchAllPlexRatings] Found ${ratings.length} unique ratings in ${serverConfig.name}:`,
            ratings
        );
        return ratings;
    } catch (error) {
        logger.error(
            `[fetchAllPlexRatings] Failed to fetch ratings for ${serverConfig.name}:`,
            error.message
        );
        return [];
    }
}

/**
 * Get all available ratings for a source type with intelligent caching
 * @param {string} sourceType - The source type (jellyfin, plex, etc.)
 * @returns {Promise<Array<string>>} Array of unique ratings
 */
async function getAllSourceRatings(sourceType) {
    // Check cache first
    const cachedRatings = ratingCache.getRatings(sourceType);
    if (cachedRatings.length > 0) {
        logger.debug(
            `[getAllSourceRatings] Using cached ratings for ${sourceType}: ${cachedRatings.length} ratings`
        );
        return cachedRatings;
    }

    logger.info(`[getAllSourceRatings] Cache miss for ${sourceType}, fetching from source...`);

    // Find enabled servers of this type
    const enabledServers =
        config.mediaServers?.filter(
            server => server.enabled && server.type?.toLowerCase() === sourceType.toLowerCase()
        ) || [];

    if (enabledServers.length === 0) {
        logger.warn(`[getAllSourceRatings] No enabled servers found for ${sourceType}`);
        return [];
    }

    const allRatings = new Set();

    // Fetch ratings from all enabled servers of this type
    for (const server of enabledServers) {
        try {
            let serverRatings = [];

            switch (sourceType.toLowerCase()) {
                case 'jellyfin':
                    serverRatings = await fetchAllJellyfinRatings(server);
                    break;
                case 'plex':
                    serverRatings = await fetchAllPlexRatings(server);
                    break;
                default:
                    logger.warn(`[getAllSourceRatings] Unsupported source type: ${sourceType}`);
                    continue;
            }

            // Add all ratings to the set
            serverRatings.forEach(rating => allRatings.add(rating));
        } catch (error) {
            logger.error(
                `[getAllSourceRatings] Failed to fetch ratings from server ${server.name}:`,
                error.message
            );
        }
    }

    const finalRatings = Array.from(allRatings).sort();

    // Cache the results
    await ratingCache.setRatings(sourceType, finalRatings);

    return finalRatings;
}

/**
 * Get ratings with counts for each rating
 * @param {string} sourceType - The source type (e.g., 'jellyfin', 'plex')
 * @returns {Promise<Array<{rating: string, count: number}>>} Array of ratings with counts
 */
async function getRatingsWithCounts(sourceType) {
    if (!['jellyfin', 'plex'].includes(sourceType.toLowerCase())) {
        throw new Error(`Rating counts not supported for source type: ${sourceType}`);
    }

    // Find the enabled server of the specified type
    const server = config.mediaServers.find(
        server => server.type?.toLowerCase() === sourceType.toLowerCase() && server.enabled
    );

    if (!server) {
        throw new Error(`No enabled ${sourceType} server found`);
    }

    try {
        let ratingsWithCounts = [];

        switch (sourceType.toLowerCase()) {
            case 'jellyfin': {
                const jellyfinClient = await getJellyfinClient(server);
                const allLibraries = await getJellyfinLibraries(server);

                // Get library IDs
                const configuredLibraries = [
                    ...(server.movieLibraryNames || []),
                    ...(server.showLibraryNames || []),
                ];
                const libraryIds = [];

                for (const libraryName of configuredLibraries) {
                    const library = allLibraries.get(libraryName);
                    if (library) {
                        libraryIds.push(library.id);
                    }
                }

                if (libraryIds.length === 0) {
                    logger.warn(
                        `[getRatingsWithCounts] No configured libraries found for ${server.name}`
                    );
                    return [];
                }

                ratingsWithCounts = await jellyfinClient.getRatingsWithCounts(libraryIds);
                break;
            }

            case 'plex': {
                const PlexHttpClient = require('./utils/plex-http-client');
                const plexClient = getPlexClient(server);
                const plexHttpClient = new PlexHttpClient(plexClient, server, isDebug);

                ratingsWithCounts = await plexHttpClient.getRatingsWithCounts();
                break;
            }
        }

        return ratingsWithCounts;
    } catch (error) {
        logger.error(
            `[getRatingsWithCounts] Failed to get ratings with counts for ${sourceType}:`,
            error.message
        );
        throw error;
    }
}

/**
 * Get all unique quality/resolution values with counts from a Jellyfin server
 * @param {Object} serverConfig - Jellyfin server configuration
 * @returns {Promise<Array>} Array of quality objects with count
 */
async function getJellyfinQualitiesWithCounts(serverConfig) {
    try {
        const jellyfinClient = await getJellyfinClient(serverConfig);

        // Use the existing getJellyfinLibraries function that properly handles ItemId
        const allLibrariesMap = await getJellyfinLibraries(serverConfig);

        // Filter for movie and show libraries and extract IDs
        const selectedLibraries = Array.from(allLibrariesMap.values()).filter(library => {
            return library.type === 'movies' || library.type === 'tvshows';
        });

        const libraryIds = selectedLibraries.map(library => library.id);

        console.log(
            '[DEBUG] Selected libraries:',
            selectedLibraries.map(lib => ({ name: lib.name, id: lib.id, type: lib.type }))
        );
        console.log('[DEBUG] Library IDs:', libraryIds);

        if (libraryIds.length === 0) {
            console.warn('[getJellyfinQualitiesWithCounts] No movie or TV show libraries found');
            return [];
        }

        // Use the HTTP client method to get qualities with counts
        const result = await jellyfinClient.getQualitiesWithCounts(libraryIds);

        if (isDebug)
            logger.debug(
                `[getJellyfinQualitiesWithCounts] Found ${result.length} unique qualities with counts from ${selectedLibraries.length} libraries`
            );

        return result;
    } catch (error) {
        console.error(`[getJellyfinQualitiesWithCounts] Error: ${error.message}`);
        return [];
    }
}

/**
 * Check if a source type is enabled in the current configuration
 * @param {string} sourceType - The source type to check (e.g., 'jellyfin', 'plex')
 * @returns {boolean} True if the source type is enabled
 */
function isSourceTypeEnabled(sourceType) {
    if (!config.mediaServers) {
        return false;
    }

    const server = config.mediaServers.find(s => s.type === sourceType);
    return server && server.enabled === true;
}

// Get available ratings for dropdown filters
app.get(
    '/api/sources/:sourceType/ratings',
    asyncHandler(async (req, res) => {
        const { sourceType } = req.params;

        try {
            // Check if the source type is enabled
            const isEnabled = isSourceTypeEnabled(sourceType);
            if (!isEnabled) {
                return res.json({
                    success: true,
                    data: [],
                    cached: false,
                    count: 0,
                    message: `${sourceType} server is disabled`,
                });
            }

            // Use the new intelligent rating fetching system
            const ratings = await getAllSourceRatings(sourceType);

            return res.json({
                success: true,
                data: ratings,
                cached: ratingCache.isCacheValid(sourceType),
                count: ratings.length,
            });
        } catch (error) {
            logger.error(`[API] Failed to get ratings for ${sourceType}:`, error.message);

            return res.status(500).json({
                success: false,
                error: `Failed to fetch ratings: ${error.message}`,
                data: [],
            });
        }
    })
);

// Get available ratings with counts for dropdown filters
app.get(
    '/api/sources/:sourceType/ratings-with-counts',
    asyncHandler(async (req, res) => {
        const { sourceType } = req.params;

        try {
            // Check if the source type is enabled
            const isEnabled = isSourceTypeEnabled(sourceType);
            if (!isEnabled) {
                return res.json({
                    success: true,
                    data: [],
                    count: 0,
                    message: `${sourceType} server is disabled`,
                });
            }

            const ratingsWithCounts = await getRatingsWithCounts(sourceType);

            return res.json({
                success: true,
                data: ratingsWithCounts,
                count: ratingsWithCounts.length,
            });
        } catch (error) {
            logger.error(
                `[API] Failed to get ratings with counts for ${sourceType}:`,
                error.message
            );

            return res.status(500).json({
                success: false,
                error: `Failed to fetch ratings with counts: ${error.message}`,
                data: [],
            });
        }
    })
);

// Rating cache management endpoints
app.get(
    '/api/admin/rating-cache/stats',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const stats = ratingCache.getStats();
        res.json({
            success: true,
            data: stats,
        });
    })
);

app.post(
    '/api/admin/rating-cache/:sourceType/refresh',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        const { sourceType } = req.params;

        try {
            // Invalidate cache and force refresh
            await ratingCache.invalidateCache(sourceType);
            const ratings = await getAllSourceRatings(sourceType);

            res.json({
                success: true,
                message: `Rating cache refreshed for ${sourceType}`,
                data: ratings,
                count: ratings.length,
            });
        } catch (error) {
            logger.error(`[API] Failed to refresh rating cache for ${sourceType}:`, error.message);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    })
);

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get public configuration
 *     description: Returns basic configuration information for client-side functionality (fanart, etc.) without sensitive data
 *     tags: ['Configuration']
 *     responses:
 *       200:
 *         description: Public configuration data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plex:
 *                   type: object
 *                   properties:
 *                     server:
 *                       type: string
 *                       description: Plex server URL (for fanart functionality)
 *                     token:
 *                       type: boolean
 *                       description: Whether Plex token is configured (boolean only)
 */

/**
 * @swagger
 * /api/version:
 *   get:
 *     summary: Get application version
 *     description: Returns the current version of the Posterrama application
 *     tags: ['Public API']
 *     responses:
 *       200:
 *         description: Application version information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   description: The current version number
 *                 name:
 *                   type: string
 *                   description: Application name
 */
app.get(
    '/api/version',
    asyncHandler(async (req, res) => {
        const packageJson = require('./package.json');
        res.json({
            version: packageJson.version,
            name: packageJson.name,
        });
    })
);

/**
 * @swagger
 * /api/github/latest:
 *   get:
 *     summary: Get latest release information (public)
 *     description: >
 *       Public endpoint to check for the latest GitHub release.
 *       Returns basic version comparison without authentication.
 *     tags: ['Public API']
 *     responses:
 *       200:
 *         description: Latest release information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentVersion:
 *                   type: string
 *                 latestVersion:
 *                   type: string
 *                 hasUpdate:
 *                   type: boolean
 *                 releaseUrl:
 *                   type: string
 */
app.get(
    '/api/github/latest',
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

            // Return simplified public data
            const publicInfo = {
                currentVersion: updateInfo.currentVersion,
                latestVersion: updateInfo.latestVersion,
                hasUpdate: updateInfo.hasUpdate,
                releaseUrl: updateInfo.releaseUrl,
                publishedAt: updateInfo.publishedAt,
                releaseName: updateInfo.releaseName,
            };

            res.json(publicInfo);
        } catch (error) {
            logger.error('Failed to check for latest release', { error: error.message });

            // Fallback response when GitHub is unavailable
            try {
                const packagePath = path.join(__dirname, 'package.json');
                const packageData = JSON.parse(await fsp.readFile(packagePath, 'utf8'));
                const currentVersion = packageData.version || 'Unknown';

                res.json({
                    currentVersion,
                    latestVersion: currentVersion,
                    hasUpdate: false,
                    releaseUrl: null,
                    publishedAt: null,
                    releaseName: null,
                    error: 'Could not connect to GitHub',
                });
            } catch (fallbackError) {
                res.status(500).json({ error: 'Failed to check for latest release' });
            }
        }
    })
);

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get public configuration
 *     description: >
 *       Public endpoint that returns non-sensitive configuration data,
 *       such as server availability and enabled services status.
 *     tags: ['Public API']
 *     responses:
 *       200:
 *         description: Public configuration data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plex:
 *                   type: object
 *                   properties:
 *                     server:
 *                       type: string
 *                       nullable: true
 *                       description: Plex server address
 *                     token:
 *                       type: boolean
 *                       description: Whether Plex token is configured
 *                 tmdb:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                       description: Whether TMDB API is enabled
 *                 tvdb:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                       description: Whether TVDB API is enabled
 */
app.get(
    '/api/config',
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Public API] Request received for /api/config.');

        try {
            const currentConfig = await readConfig();

            // Return only non-sensitive configuration data
            const publicConfig = {
                plex: {
                    server: currentConfig.plex?.server || null,
                    token: !!currentConfig.plex?.token, // Boolean only, not the actual token
                },
                tmdb: {
                    enabled: !!currentConfig.tmdb?.apiKey,
                },
                tvdb: {
                    enabled: !!currentConfig.tvdb?.apiKey,
                },
            };

            if (isDebug) logger.debug('[Public API] Returning public config.');
            res.json(publicConfig);
        } catch (error) {
            if (isDebug) console.error('[Public API] Error reading config:', error);
            // Return empty config if file doesn't exist yet
            res.json({
                plex: { server: null, token: false },
                tmdb: { enabled: false },
                tvdb: { enabled: false },
            });
        }
    })
);

// ============================================================================
// ADMIN API ENDPOINTS
// ============================================================================

/**
 * @swagger
 * /api/admin/config:
 *   get:
 *     summary: Retrieve complete admin configuration
 *     description: >
 *       Retrieves the complete `config.json` along with relevant environment variables
 *       and security status (like 2FA) needed for the admin panel.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The configuration objects.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminConfigResponse'
 *       401:
 *         description: Unauthorized.
 */
app.get(
    '/api/admin/config',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/config.');
        const currentConfig = await readConfig();
        if (isDebug) logger.debug('[Admin API] Successfully read config.json.');

        // Convert streaming sources array to object format for admin panel
        if (currentConfig.streamingSources && Array.isArray(currentConfig.streamingSources)) {
            const streamingArray = currentConfig.streamingSources;
            const streamingObject = {
                enabled: streamingArray.some(source => source.enabled),
                region: 'US',
                maxItems: 20,
                minRating: 0,
                netflix: false,
                disney: false,
                prime: false,
                hbo: false,
                newReleases: false,
            };

            // Extract settings from first enabled source
            const firstEnabled = streamingArray.find(source => source.enabled);
            if (firstEnabled) {
                streamingObject.region = firstEnabled.watchRegion || 'US';
                // Reflect fixed per-provider limits in the admin view
                streamingObject.maxItems =
                    FIXED_LIMITS.STREAMING_MOVIES_PER_PROVIDER +
                        FIXED_LIMITS.STREAMING_TV_PER_PROVIDER || 20;
                streamingObject.minRating = firstEnabled.minRating || 0;
            }

            // Set provider checkboxes based on enabled sources
            streamingArray.forEach(source => {
                if (source.enabled) {
                    switch (source.category) {
                        case 'streaming_netflix':
                            streamingObject.netflix = true;
                            break;
                        case 'streaming_disney':
                            streamingObject.disney = true;
                            break;
                        case 'streaming_prime':
                            streamingObject.prime = true;
                            break;
                        case 'streaming_hbo':
                            streamingObject.hbo = true;
                            break;
                        case 'streaming_new_releases':
                            streamingObject.newReleases = true;
                            break;
                    }
                }
            });

            currentConfig.streamingSources = streamingObject;
            logger.debug(
                '[Streaming Debug] Converted streaming array to object for admin panel:',
                JSON.stringify(streamingObject, null, 2)
            );
        }

        // WARNING: Exposing environment variables to the client can be a security risk.
        // This is done based on an explicit user request.
        const envVarsToExpose = {
            SERVER_PORT: process.env.SERVER_PORT,
            DEBUG: process.env.DEBUG,
        };

        if (Array.isArray(currentConfig.mediaServers)) {
            currentConfig.mediaServers.forEach(server => {
                // Ensure server is a valid object before processing to prevent crashes
                if (server && typeof server === 'object') {
                    // Find all keys ending in 'EnvVar' and get their values from process.env
                    Object.keys(server).forEach(key => {
                        if (key.endsWith('EnvVar')) {
                            const envVarName = server[key];
                            if (envVarName) {
                                const isSensitive =
                                    key.toLowerCase().includes('token') ||
                                    key.toLowerCase().includes('password') ||
                                    key.toLowerCase().includes('apikey');
                                if (isSensitive) {
                                    // For sensitive fields, just indicate if they are set or not.
                                    envVarsToExpose[envVarName] = !!process.env[envVarName];
                                } else if (process.env[envVarName]) {
                                    envVarsToExpose[envVarName] = process.env[envVarName];
                                }
                            }
                        }
                    });
                }
            });
        }

        if (isDebug)
            logger.debug(
                '[Admin API] Sending config and selected environment variables to client.'
            );
        res.json({
            config: currentConfig,
            env: envVarsToExpose,
            security: { is2FAEnabled: !!(process.env.ADMIN_2FA_SECRET || '').trim() },
            server: { ipAddress: serverIPAddress },
        });
    })
);

/**
 * @swagger
 * /api/admin/test-plex:
 *   post:
 *     summary: Test connection to a Plex server
 *     description: >
 *       Checks if the application can connect to a Plex server with the provided
 *       hostname, port, and token. This is a lightweight check that queries the server root.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PlexConnectionRequest'
 *     responses:
 *       200:
 *         description: Connection successful.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Connection error (e.g., incorrect credentials, timeout).
 */
app.post(
    '/api/admin/test-plex',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to test Plex connection.');
        let { hostname, token } = req.body; // token is now optional
        const { port: portValue } = req.body;

        if (!hostname || !portValue) {
            throw new ApiError(400, 'Hostname and port are required for the test.');
        }

        // Sanitize hostname to remove http(s):// prefix
        if (hostname) {
            hostname = hostname.trim().replace(/^https?:\/\//, '');
        }

        // If no token is provided in the request, use the one from the server's config.
        if (!token) {
            if (isDebug)
                logger.debug(
                    '[Plex Test] No token provided in request, attempting to use existing server token.'
                );
            // Find the Plex server config (enabled or disabled)
            const plexServerConfig = config.mediaServers.find(s => s.type === 'plex');

            if (plexServerConfig && plexServerConfig.tokenEnvVar) {
                token = process.env[plexServerConfig.tokenEnvVar];
                if (!token) {
                    throw new ApiError(
                        400,
                        'Connection test failed: No new token was provided, and no token is configured on the server.'
                    );
                }
            } else {
                throw new ApiError(
                    500,
                    'Connection test failed: Could not find Plex server configuration on the server.'
                );
            }
        }

        try {
            const testClient = createPlexClient({
                hostname,
                port: portValue,
                token,
                timeout: 5000,
            });
            // Querying the root is a lightweight way to check credentials and reachability.
            const result = await testClient.query('/');
            const serverName = result?.MediaContainer?.friendlyName;

            if (serverName) {
                res.json({
                    success: true,
                    message: `Successfully connected to Plex server: ${serverName}`,
                });
            } else {
                // This case is unlikely if the query succeeds, but good to handle.
                res.json({
                    success: true,
                    message: 'Connection successful, but could not retrieve the server name.',
                });
            }
        } catch (error) {
            if (isDebug) console.error('[Plex Test] Connection failed:', error.message);
            let userMessage = 'Connection failed. Please check the hostname, port, and token.';
            if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                userMessage = `Connection refused to ${hostname}:${port}. Is Plex running on this address? Check if the hostname and port are correct.`;
            } else if (error.message.includes('401 Unauthorized')) {
                userMessage =
                    'Connection failed: Unauthorized. The Plex token is incorrect or has expired.';
            } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                userMessage = `Connection timed out to ${hostname}:${port}. Is the server reachable? Check firewall settings.`;
            } else if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
                userMessage = `Hostname "${hostname}" not found. Please check if the hostname is correct.`;
            }
            throw new ApiError(400, userMessage);
        }
    })
);

/**
 * @swagger
 * /api/admin/plex-libraries:
 *   post:
 *     summary: Retrieve Plex libraries
 *     description: >
 *       Retrieves a list of all available libraries (such as 'Movies', 'TV Shows')
 *       from the configured Plex server.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: Optional connection details. If not provided, the configured values will be used.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PlexConnectionRequest'
 *     responses:
 *       200:
 *         description: A list of found libraries.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlexLibrariesResponse'
 *       400:
 *         description: Could not fetch libraries (e.g., incorrect credentials).
 */
app.post(
    '/api/admin/plex-libraries',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to fetch Plex libraries.');
        let { hostname, port, token } = req.body;

        // Sanitize hostname
        if (hostname) {
            hostname = hostname.trim().replace(/^https?:\/\//, '');
        }

        // Fallback to configured values if not provided in the request
        const plexServerConfig = config.mediaServers.find(s => s.type === 'plex');
        if (!plexServerConfig) {
            throw new ApiError(500, 'Plex server is not configured in config.json.');
        }

        if (!hostname) {
            const envHostname = process.env[plexServerConfig.hostnameEnvVar];
            if (envHostname) hostname = envHostname.trim().replace(/^https?:\/\//, '');
        }
        port = port || process.env[plexServerConfig.portEnvVar];
        token = token || process.env[plexServerConfig.tokenEnvVar];

        if (!hostname || !port || !token) {
            throw new ApiError(400, 'Plex connection details (hostname, port, token) are missing.');
        }

        try {
            const client = createPlexClient({
                hostname,
                port,
                token,
                timeout: 10000,
            });
            const sectionsResponse = await client.query('/library/sections');
            const allSections = sectionsResponse?.MediaContainer?.Directory || [];

            // Fetch item counts for each library
            const libraries = await Promise.all(
                allSections.map(async dir => {
                    let itemCount = 0;
                    try {
                        // Only fetch count for movie and show libraries
                        if (dir.type === 'movie' || dir.type === 'show') {
                            const sectionResponse = await client.query(
                                `/library/sections/${dir.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=1`
                            );
                            itemCount = parseInt(sectionResponse?.MediaContainer?.totalSize || 0);
                        }
                    } catch (countError) {
                        if (isDebug)
                            logger.debug(
                                `[Plex Lib Count] Failed to get count for ${dir.title}:`,
                                countError.message
                            );
                        // Continue without count
                    }

                    return {
                        key: dir.key,
                        name: dir.title,
                        type: dir.type, // 'movie', 'show', etc.
                        itemCount: itemCount,
                    };
                })
            );

            res.json({ success: true, libraries });
        } catch (error) {
            if (isDebug) console.error('[Plex Lib Fetch] Failed:', error.message);
            let userMessage = 'Could not fetch libraries. Please check the connection details.';
            if (error.message.includes('401 Unauthorized')) {
                userMessage = 'Unauthorized. Is the Plex token correct?';
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
 * /api/admin/test-jellyfin:
 *   post:
 *     summary: Test connection to a Jellyfin server
 *     description: >
 *       Checks if the application can connect to a Jellyfin server with the provided
 *       hostname, port, and API key. This is a lightweight check that queries the system info.
 *     tags: ['Admin API']
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
 *                 description: Jellyfin server port (typically 8096)
 *               apiKey:
 *                 type: string
 *                 description: Jellyfin API key
 *     responses:
 *       200:
 *         description: Connection successful.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Connection error (e.g., incorrect credentials, timeout).
 */
app.post(
    '/api/admin/test-jellyfin',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to test Jellyfin connection.');
        let { hostname, apiKey } = req.body; // apiKey is now optional
        const { port: portValue } = req.body;

        if (!hostname || !portValue) {
            throw new ApiError(400, 'Hostname and port are required for the test.');
        }

        // Sanitize hostname to remove http(s):// prefix
        if (hostname) {
            hostname = hostname.trim().replace(/^https?:\/\//, '');
        }

        // If no API key is provided in the request, use the one from the server's config.
        if (!apiKey) {
            if (isDebug)
                logger.debug(
                    '[Jellyfin Test] No API key provided in request, attempting to use existing server API key.'
                );
            // Find any Jellyfin server config (enabled or disabled) to get the API key
            const jellyfinServerConfig = config.mediaServers.find(s => s.type === 'jellyfin');

            if (jellyfinServerConfig && jellyfinServerConfig.tokenEnvVar) {
                apiKey = process.env[jellyfinServerConfig.tokenEnvVar];
                if (!apiKey) {
                    throw new ApiError(
                        400,
                        'Connection test failed: No new API key was provided, and no API key is configured on the server.'
                    );
                }
            } else {
                throw new ApiError(
                    400,
                    'Connection test failed: No API key provided and no Jellyfin server configuration found.'
                );
            }
        }

        const port = parseInt(portValue, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            throw new ApiError(400, 'Port must be a valid number between 1 and 65535.');
        }

        try {
            const client = await createJellyfinClient({
                hostname,
                port,
                apiKey,
                timeout: 10000,
            });

            // Test connection with our HTTP client
            const info = await client.testConnection();

            res.json({
                success: true,
                message: 'Jellyfin connection successful.',
                serverInfo: {
                    name: info.serverName,
                    version: info.version,
                },
            });
        } catch (error) {
            if (isDebug) console.error('[Jellyfin Test] Failed:', error.message);
            let userMessage = 'Could not connect to Jellyfin. Please check the connection details.';
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

/**
 * @swagger
 * /api/admin/jellyfin-libraries:
 *   post:
 *     summary: Fetch Jellyfin media libraries
 *     description: >
 *       Retrieves the list of media libraries from a Jellyfin server.
 *       Returns libraries with their types (movie, show, etc.).
 *     tags: ['Admin API']
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
    express.json(),
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

        if (!hostname) {
            const envHostname = process.env[jellyfinServerConfig.hostnameEnvVar];
            if (envHostname) hostname = envHostname.trim().replace(/^https?:\/\//, '');
        }
        port = port || process.env[jellyfinServerConfig.portEnvVar];
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
                timeout: 10000,
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

/**
 * @swagger
 * /api/test-tvdb-connection:
 *   post:
 *     summary: Test TVDB connection and fetch sample data
 *     description: >
 *       Tests the connection to TVDB API using the hardcoded developer key and fetches sample data
 *       to verify that the integration is working correctly.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TVDB connection test successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sampleData:
 *                   type: array
 *                   items:
 *                     type: object
 *                 stats:
 *                   type: object
 *                   properties:
 *                     responseTime:
 *                       type: number
 *                     totalItems:
 *                       type: number
 *       400:
 *         description: TVDB connection test failed.
 */
app.post(
    '/api/admin/test-tvdb',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Received request to test TVDB connection.');

        const startTime = Date.now();

        try {
            // Import TVDB source dynamically
            const TVDBSource = require('./sources/tvdb');

            // Create TVDB instance with test configuration
            const testConfig = {
                enabled: true,
                showCount: 5, // Small number for testing
                movieCount: 5, // Small number for testing
                category: 'popular',
                minRating: 0,
                yearFilter: null,
                genreFilter: '',
            };

            const tvdbSource = new TVDBSource(testConfig);

            if (isDebug) logger.debug('[TVDB Test] Attempting to fetch sample data...');

            // Test both movies and shows using the correct method names
            const [movies, shows] = await Promise.all([
                tvdbSource.getMovies().catch(e => {
                    console.warn('[TVDB Test] Movies failed:', e.message);
                    return [];
                }),
                tvdbSource.getShows().catch(e => {
                    console.warn('[TVDB Test] Shows failed:', e.message);
                    return [];
                }),
            ]);

            const sampleData = movies.concat(shows);

            const responseTime = Date.now() - startTime;

            if (sampleData && sampleData.length > 0) {
                if (isDebug)
                    logger.debug(
                        `[TVDB Test] Successfully retrieved ${sampleData.length} items from TVDB.`
                    );

                res.json({
                    success: true,
                    message: 'TVDB connection successful',
                    sampleData: sampleData.slice(0, 10), // Return first 10 items for display
                    stats: {
                        responseTime,
                        totalItems: sampleData.length,
                        movies: movies.length,
                        shows: shows.length,
                    },
                });
            } else {
                throw new Error('No data returned from TVDB API');
            }
        } catch (error) {
            const errorMessage = error.message || 'Unknown error occurred';
            if (isDebug) console.error('[TVDB Test] Connection test failed:', errorMessage);

            res.status(400).json({
                success: false,
                error: errorMessage,
                stats: {
                    responseTime: Date.now() - startTime,
                },
            });
        }
    })
);

/**
 * @swagger
 * /api/admin/config:
 *   post:
 *     summary: Save the admin configuration
 *     description: >
 *       Saves the changes to both `config.json` and the `.env` file.
 *       After a successful save, the application caches and clients are cleared
 *       and a background refresh of the playlist is initiated.
 *     tags: ['Admin API']
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
    express.json(),
    asyncHandler(async (req, res) => {
        logger.info('[Admin API] Received POST request to /api/admin/config');
        logger.info('[Admin API] Request body exists:', !!req.body);
        logger.info('[Admin API] Request body size:', JSON.stringify(req.body).length);

        if (isDebug) {
            logger.debug('[Admin API] Full request body:', JSON.stringify(req.body, null, 2));
        }

        const { config: newConfig, env: newEnv } = req.body;

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
                        name: 'New Streaming Releases',
                        category: 'streaming_new_releases',
                        enabled: streamingConfig.newReleases,
                    },
                ];

                providers.forEach(provider => {
                    if (provider.enabled) {
                        streamingArray.push({
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
                        });
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

        // Write to config.json and .env
        await writeConfig(mergedConfig);
        if (isDebug) logger.debug('[Admin API] Successfully wrote to config.json.');
        await writeEnvFile(newEnv);
        if (isDebug) logger.debug('[Admin API] Successfully wrote to .env file.');

        // Clear caches to reflect changes without a full restart
        playlistCache = null;
        Object.keys(plexClients).forEach(key => delete plexClients[key]);

        // Clear the /get-config cache so changes are immediately visible
        cacheManager.delete('GET:/get-config');

        // Trigger a background refresh of the playlist with the new settings.
        // We don't await this, so the admin UI gets a fast response.
        // Add a small delay to prevent overwhelming the server during rapid config changes
        setTimeout(() => {
            refreshPlaylistCache();
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
            const testClient = createPlexClient({
                hostname,
                port: parseInt(port),
                token,
            });

            // Create a temporary server config for testing
            const testServerConfig = {
                name: `Test Server ${hostname}:${port}`, // Unique name to avoid caching issues
                type: 'plex',
                enabled: true, // Temporarily enabled for testing
                hostnameEnvVar: null,
                portEnvVar: null,
                tokenEnvVar: null,
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
 *     tags: ['Admin API']
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
            const testClient = createPlexClient({
                hostname,
                port: parseInt(port),
                token,
            });

            // Create a temporary server config for testing
            const testServerConfig = {
                name: `Test Server ${hostname}:${port}`,
                type: 'plex',
                enabled: true,
                hostnameEnvVar: null,
                portEnvVar: null,
                tokenEnvVar: null,
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
 *     tags: ['Admin API']
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
            hostname = hostname || process.env[jellyfinServerConfig.hostnameEnvVar];
            port = port || process.env[jellyfinServerConfig.portEnvVar];
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
                timeout: 15000,
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
 *     tags: ['Admin API']
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
            hostname = hostname || process.env[jellyfinServerConfig.hostnameEnvVar];
            port = port || process.env[jellyfinServerConfig.portEnvVar];
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

// ============================================
// QUALITY ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/admin/plex-qualities-with-counts:
 *   get:
 *     summary: Get Plex qualities with content counts
 *     description: Retrieves available video qualities from Plex servers with item counts
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
                const testMovies = await tmdbSource.fetchMedia('movie', 5);

                if (testMovies.length > 0) {
                    res.json({
                        success: true,
                        count: testMovies.length,
                        message: `Successfully connected to TMDB and fetched ${category} movies`,
                    });
                } else {
                    res.json({
                        success: false,
                        error: 'Connected to TMDB but no movies found. Check your API key or category.',
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
 * /api/admin/tvdb-genres:
 *   get:
 *     summary: Get available TVDB genres
 *     description: Fetches the list of available genres from TVDB API for filtering.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available TVDB genres.
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
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 */
app.get(
    '/api/admin/tvdb-genres',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for TVDB genres.');

        try {
            if (!global.tvdbSourceInstance) {
                // Create a temporary instance since API key is hardcoded
                global.tvdbSourceInstance = new TVDBSource({ enabled: true });
            }

            const genres = await global.tvdbSourceInstance.getGenres();

            if (isDebug) logger.debug(`[Admin API] Found ${genres.length} TVDB genres.`);
            res.json({ genres });
        } catch (error) {
            console.error(`[Admin API] Failed to get TVDB genres: ${error.message}`);
            res.json({ genres: [], error: error.message });
        }
    })
);

/**
 * @swagger
 * /api/admin/tvdb-genres-test:
 *   post:
 *     summary: Get TVDB genres for testing
 *     description: Retrieves all available genres from TVDB API for testing purposes.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
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
    '/api/admin/tvdb-genres-test',
    isAuthenticated,
    express.json(),
    asyncHandler(async (req, res) => {
        if (isDebug) logger.debug('[Admin API] Request received for /api/admin/tvdb-genres-test.');

        try {
            // Create a fresh TVDB instance for testing
            const testTVDBConfig = {
                enabled: true,
                showCount: 5,
                movieCount: 5,
                category: 'popular',
                minRating: 0,
                yearFilter: null,
                genreFilter: '',
            };

            const tvdbSource = new TVDBSource(testTVDBConfig);
            const genres = await tvdbSource.getGenres();

            if (isDebug)
                logger.debug(
                    `[Admin API] Found ${genres.length} genres from test TVDB:`,
                    genres.slice(0, 5)
                );

            res.json({ genres });
        } catch (error) {
            if (isDebug)
                console.error('[Admin API] Error getting genres from test TVDB:', error.message);
            throw new ApiError(400, `Failed to get TVDB genres: ${error.message}`);
        }
    })
);

/**
 * @swagger
 * /api/admin/tmdb-cache-stats:
 *   get:
 *     summary: Get TMDB cache statistics
 *     description: Returns cache statistics for debugging TMDB performance.
 *     tags: ['Admin API']
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

/**
 * @swagger
 * /api/admin/change-password:
 *   post:
 *     summary: Change the admin password
 *     description: Allows the user to change their own admin password.
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
 *                   example: "2 days, 5 hours"
 */
app.get(
    '/api/admin/status',
    isAuthenticated,
    asyncHandler(async (req, res) => {
        try {
            const os = require('os');
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const uptimeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

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

            // Get memory info
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memUsage = Math.round((usedMem / totalMem) * 100);

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
                    usage: `${memUsage}%`,
                    status: memUsage > 90 ? 'error' : memUsage > 70 ? 'warning' : 'success',
                },
                uptime: uptimeString,
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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

            // CPU information
            const cpus = os.cpus();
            let totalIdle = 0;
            let totalTick = 0;

            cpus.forEach(cpu => {
                for (const type in cpu.times) {
                    totalTick += cpu.times[type];
                }
                totalIdle += cpu.times.idle;
            });

            const idle = totalIdle / cpus.length;
            const total = totalTick / cpus.length;
            const cpuUsage = 100 - Math.round((100 * idle) / total);

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
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const uptimeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

            const performanceData = {
                cpu: {
                    usage: cpuUsage,
                    loadAverage: loadAverage,
                },
                memory: {
                    usage: memUsage,
                    used: formatBytes(usedMem),
                    total: formatBytes(totalMem),
                },
                disk: diskUsage,
                uptime: uptimeString,
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
 *     tags: ['Admin API']
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
        if (isRefreshing) {
            logger.warn('Admin refresh: Force-clearing stuck refresh state', {
                action: 'admin_force_clear_refresh',
                stuckDuration: refreshStartTime ? `${Date.now() - refreshStartTime}ms` : 'unknown',
            });
            isRefreshing = false;
            refreshStartTime = null;
        }

        // The refreshPlaylistCache function already has a lock (isRefreshing)
        // so we can call it directly. We'll await it to give feedback to the user.
        await refreshPlaylistCache();

        const itemCount = playlistCache ? playlistCache.length : 0;
        const message = `Media playlist successfully refreshed. ${itemCount} items found. Cache cleared: ${cleared} entries.`;
        if (isDebug) logger.debug(`[Admin API] ${message}`);

        res.json({ success: true, message: message, itemCount: itemCount, cacheCleared: cleared });
    })
);

/**
 * @swagger
 * /api/admin/reset-refresh:
 *   post:
 *     summary: Reset stuck playlist refresh state
 *     description: Force-reset the playlist refresh state if it gets stuck
 *     tags: ['Admin API']
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
            wasRefreshing: isRefreshing,
            stuckDuration: refreshStartTime ? `${Date.now() - refreshStartTime}ms` : 'none',
        });

        // Force reset the refresh state
        isRefreshing = false;
        refreshStartTime = null;

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
        logger.info('User reset refresh requested via GET', {
            action: 'user_refresh_reset',
            wasRefreshing: isRefreshing,
            stuckDuration: refreshStartTime ? `${Date.now() - refreshStartTime}ms` : 'none',
        });

        // Force reset the refresh state
        const wasStuck = isRefreshing;
        isRefreshing = false;
        refreshStartTime = null;

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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
                    key.startsWith('tvdb:')
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

            if (isDebug) logger.debug('[Admin API] Cache stats calculated:', response);
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

// Cache configuration is now hardcoded for simplicity and security
const CACHE_CONFIG = {
    maxSizeGB: 2,
    minFreeDiskSpaceMB: 500,
};

/**
 * Get hardcoded cache configuration
 * @returns {Object} Cache configuration with maxSizeGB and minFreeDiskSpaceMB
 */
function getCacheConfig() {
    return { ...CACHE_CONFIG };
}

/**
 * @swagger
 * /api/admin/cleanup-cache:
 *   post:
 *     summary: Cleanup cache directories
 *     description: Performs cleanup of cache directories by removing old or expired files based on configuration
 *     tags: ['Admin API']
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
            const maxSizeGB = cacheConfig.maxSizeGB;

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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
 *     tags: ['Admin API']
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
        if (isDebug) logger.debug('[Admin API] API Access Token has been revoked.');
        res.json({ success: true, message: 'API key has been revoked.' });
    })
);

/**
 * @swagger
 * /api/admin/logs:
 *   get:
 *     summary: Get the most recent application logs
 *     description: >
 *       Retrieves a list of the most recent log entries stored in memory.
 *       This is useful for debugging from the admin panel without direct server access.
 *     tags: ['Admin API']
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: An array of log objects.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/LogEntry'
 */
app.get('/api/admin/logs', isAuthenticated, (req, res) => {
    const { level, limit } = req.query;
    res.setHeader('Cache-Control', 'no-store'); // Prevent browser caching of log data
    res.json(logger.getRecentLogs(level, parseInt(limit) || 200));
});

/**
 * @swagger
 * /admin/debug:
 *   get:
 *     summary: Retrieve debug information
 *     description: >
 *       Returns the raw data of all items in the current *cached* playlist.
 *       This endpoint is only available when debug mode is enabled in the .env file.
 *     tags: ['Admin API']
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
    // Pre-populate cache before starting the server to prevent race conditions
    logger.info('Performing initial playlist fetch before server startup...');

    refreshPlaylistCache()
        .then(() => {
            if (playlistCache && playlistCache.length > 0) {
                logger.info(
                    `Initial playlist fetch complete. ${playlistCache.length} items loaded.`
                );
            } else {
                logger.warn(
                    'Initial playlist fetch did not populate any media. The application will run but will not display any media until a refresh succeeds. Check server configurations and logs for errors during fetch.'
                );
            }

            // Now start the server with cache ready
            app.listen(port, async () => {
                logger.info(`posterrama.app is listening on http://localhost:${port}`);
                if (isDebug)
                    logger.debug(
                        `Debug endpoint is available at http://localhost:${port}/admin/debug`
                    );

                logger.info('Server startup complete - media cache is ready');

                // Fixed background refresh interval (30 minutes)
                const refreshInterval = 30 * 60 * 1000;
                if (refreshInterval > 0) {
                    global.playlistRefreshInterval = setInterval(
                        refreshPlaylistCache,
                        refreshInterval
                    );
                    logger.debug(`Playlist will be refreshed in the background every 30 minutes.`);
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
            });
        })
        .catch(err => {
            logger.error('Initial playlist fetch failed during startup:', err);

            // Start server anyway but with empty cache
            app.listen(port, async () => {
                logger.info(
                    `posterrama.app is listening on http://localhost:${port} (with empty cache due to startup error)`
                );
                if (isDebug)
                    logger.debug(
                        `Debug endpoint is available at http://localhost:${port}/admin/debug`
                    );

                // Fixed background refresh interval (30 minutes)
                const refreshInterval = 30 * 60 * 1000;
                if (refreshInterval > 0) {
                    global.playlistRefreshInterval = setInterval(
                        refreshPlaylistCache,
                        refreshInterval
                    );
                    logger.debug(`Playlist will be refreshed in the background every 30 minutes.`);
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

                // Retry cache population in the background
                setTimeout(() => {
                    logger.info('Retrying playlist fetch after startup error...');
                    refreshPlaylistCache()
                        .then(() => {
                            if (playlistCache && playlistCache.length > 0) {
                                logger.info(
                                    `Retry successful: ${playlistCache.length} items loaded.`
                                );
                            }
                        })
                        .catch(retryErr => {
                            logger.error('Retry also failed:', retryErr);
                        });
                }, 5000); // Retry after 5 seconds
            });
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
                if (req.originalUrl === '/get-config' && response.ok) {
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
                    // We send the modified JSON and stop further processing for this request.
                    return res.json(modifiedConfig);
                }

                // Forward the status code from the main app
                res.status(response.status);

                // Forward all headers from the main app's response
                response.headers.forEach((value, name) => {
                    res.setHeader(name, value);
                });

                // Pipe the response body
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
            res.sendFile(path.join(__dirname, 'public', 'promo.html'));
        });

        // Serve static files (CSS, JS, etc.) from the 'public' directory
        siteApp.use(express.static(path.join(__dirname, 'public')));

        // Fallback for other routes
        /**
         * @swagger
         * /[site]/*:
         *   get:
         *     summary: Site server fallback route
         *     description: Fallback route that serves the promotional page for any unmatched paths on the site server
         *     tags: ['Site Server']
         *     responses:
         *       200:
         *         description: Promotional page HTML
         *         content:
         *           text/html:
         *             schema:
         *               type: string
         */
        siteApp.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'promo.html'));
        });

        siteApp.listen(sitePort, () => {
            logger.debug(
                `Public site server is enabled and running on http://localhost:${sitePort}`
            );
        });
    }
}

// Cleanup function for proper shutdown and test cleanup
function cleanup() {
    logger.info('Cleaning up server resources...');

    // Clear global intervals
    if (global.memoryCheckInterval) {
        clearInterval(global.memoryCheckInterval);
        global.memoryCheckInterval = null;
    }

    if (global.tmdbCacheCleanupInterval) {
        clearInterval(global.tmdbCacheCleanupInterval);
        global.tmdbCacheCleanupInterval = null;
    }

    if (global.tvdbCacheCleanupInterval) {
        clearInterval(global.tvdbCacheCleanupInterval);
        global.tvdbCacheCleanupInterval = null;
    }

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

    if (global.tvdbSourceInstance && typeof global.tvdbSourceInstance.cleanup === 'function') {
        global.tvdbSourceInstance.cleanup();
        global.tvdbSourceInstance = null;
    }

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

// Error handling middleware (must be last)
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Handle 404 for unmatched routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

// Export the app instance so that it can be imported and used by Supertest in our tests.
module.exports = app;
module.exports.testServerConnection = testServerConnection;
