/**
 * posterrama.app - Server-side logic for multiple media sources
 *
 * Author: Mark Frelink
 * Last Modified: 2025-07-26
 * License: GPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// --- In-memory Log Caching ---
// This should be at the very top to capture as many logs as possible.
const MAX_LOG_LINES = 200;
const logCache = [];

function captureLog(level, args) {
    const message = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                // A simple stringify for objects, limited depth to avoid circular reference issues
                return JSON.stringify(arg, (key, value) => {
                    if (key === '_raw' && value) return '[Raw Data Hidden]';
                    return value;
                }, 2);
            } catch (e) {
                return '[Unserializable Object]';
            }
        }
        return String(arg);
    }).join(' ');

    logCache.push({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        message: message
    });

    // Keep the cache from growing indefinitely
    if (logCache.length > MAX_LOG_LINES) {
        logCache.shift();
    }
}

// Override console methods to capture logs
const originalConsoleLog = console.log;
console.log = (...args) => { captureLog('log', args); originalConsoleLog.apply(console, args); };
const originalConsoleError = console.error;
console.error = (...args) => { captureLog('error', args); originalConsoleError.apply(console, args); };
const originalConsoleWarn = console.warn;
console.warn = (...args) => { captureLog('warn', args); originalConsoleWarn.apply(console, args); };

const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();
const crypto = require('crypto');

// --- Environment Initialization ---
// Automatically create and configure the .env file on first run.
(async function initializeEnvironment() {
    const envPath = path.join(__dirname, '.env');
    const exampleEnvPath = path.join(__dirname, 'config.example.env');

    try {
        // Check if .env file exists
        await fs.access(envPath);
    } catch (error) {
        // If .env doesn't exist, copy from config.example.env
        if (error.code === 'ENOENT') {
            console.log('.env file not found, creating from config.example.env...');
            await fs.copyFile(exampleEnvPath, envPath);
            console.log('.env file created successfully.');
            // Reload dotenv to pick up the new file
            require('dotenv').config({ override: true });
        } else {
            console.error('Error checking .env file:', error);
            process.exit(1);
        }
    }

    // Validate SESSION_SECRET
    if (!process.env.SESSION_SECRET) {
        console.log('SESSION_SECRET is missing, generating a new one...');
        const newSecret = require('crypto').randomBytes(32).toString('hex');
        // Read the .env file
        const envContent = await fs.readFile(envPath, 'utf8');
        // Append the new secret to the .env file
        const newEnvContent = envContent + `\nSESSION_SECRET="${newSecret}"\n`;
        // Write the updated content back to the .env file
        await fs.writeFile(envPath, newEnvContent, 'utf8');
        console.log('New SESSION_SECRET generated and saved to .env.');

        // If running under PM2, trigger a restart. The current process will likely crash
        // due to the missing session secret, and PM2 will restart it. The new process
        // will then load the secret correctly from the .env file.
        if (process.env.PM2_HOME) {
            console.log('Running under PM2. Triggering a restart to apply the new SESSION_SECRET...');
            const { exec } = require('child_process');
            const ecosystemConfig = require('./ecosystem.config.js');
            const appName = ecosystemConfig.apps[0].name || 'posterrama';

            exec(`pm2 restart ${appName}`, (error) => {
                if (error) console.error(`[Initial Setup] PM2 restart command failed: ${error.message}`);
            });
        } else {
            console.warn('SESSION_SECRET was generated, but the app does not appear to be running under PM2. A manual restart is recommended.');
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
const config = require('./config.json');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger.js');
const pkg = require('./package.json');
const ecosystemConfig = require('./ecosystem.config.js');
const { shuffleArray } = require('./utils.js');

const PlexSource = require('./sources/plex');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const app = express();
const { ApiError, NotFoundError } = require('./errors.js');

// Use process.env with a fallback to config.json
const port = process.env.SERVER_PORT || config.serverPort || 4000;
const isDebug = process.env.DEBUG === 'true';

if (isDebug) console.log('--- DEBUG MODE IS ACTIVE ---');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // For parsing form data

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// General request logger for debugging
if (isDebug) {
    app.use((req, res, next) => {
        console.log(`[Request Logger] Received: ${req.method} ${req.originalUrl}`);
        next();
    });
}

// Session middleware setup
app.use(session({
    store: new FileStore({
        path: './sessions', // Sessions will be stored in a 'sessions' directory
        logFn: isDebug ? console.log : () => {},
        ttl: 86400, // Session TTL in seconds, matches cookie maxAge
        reapInterval: 86400 // Clean up expired sessions once a day
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Wrapper for async routes to catch errors and pass them to the error handler
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};



/**
 * Returns the standard options for a PlexAPI client instance to ensure consistent identification.
 * @returns {object}
 */
function getPlexClientOptions() {
    // Default options ensure the app identifies itself correctly.
    // These can be overridden by setting a "plexClientOptions" object in config.json.
    const defaultOptions = {
        identifier: 'c8a5f7d1-b8e9-4f0a-9c6d-3e1f2a5b6c7d', // Static UUID for this app instance
        product: 'posterrama.app',
        version: pkg.version,
        deviceName: 'posterrama.app',
        platform: 'Node.js'
    };

    const finalOptions = { ...defaultOptions, ...(config.plexClientOptions || {}) };

    return {
        // These options must be nested inside an 'options' object per plex-api documentation.
        options: finalOptions
    };
}
/**
 * Fetches detailed metadata for a single Plex item.
 * @param {object} itemSummary - The summary object of the media item from Plex.
 * @param {object} serverConfig - The configuration for the Plex server.
 * @param {PlexAPI} plex - An active PlexAPI client instance.
 * @returns {Promise<object|null>} A processed media item object or null if processing fails.
 */
async function processPlexItem(itemSummary, serverConfig, plex) {
    const getImdbUrl = (guids) => {
        if (guids && Array.isArray(guids)) {
            const imdbGuid = guids.find(guid => guid.id.startsWith('imdb://'));
            if (imdbGuid) {
                const imdbId = imdbGuid.id.replace('imdb://', '');
                return `https://www.imdb.com/title/${imdbId}/`;
            }
        }
        return null;
    };

    const getClearLogoPath = (images) => {
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
            console.log(`[RT Debug] Processing rating for "${titleForDebug}". Raw rtRating object:`, JSON.stringify(rtRating));
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
        } else if (imageIdentifier.includes('ripe') || imageIdentifier.includes('upright') || finalScore >= 60) {
            // 'ripe' is for critic fresh, 'upright' is for audience fresh. The score is a fallback.
            icon = 'fresh';
        }

        if (isDebug) {
            console.log(`[RT Debug] -> For "${titleForDebug}": Identifier: "${imageIdentifier}", Score: ${finalScore}, Determined Icon: "${icon}"`);
        }

        return {
            score: finalScore, // The 0-100 score for display
            icon: icon,
            originalScore: score // The original 0-10 score for filtering
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
                console.log(`[Plex Debug] Found Rotten Tomatoes data for "${sourceItem.title}": Score ${rottenTomatoesData.score}%, Icon ${rottenTomatoesData.icon}`);
            } else if (sourceItem.Rating) {
                // Only log if the Rating array exists but we couldn't parse RT data from it.
                console.log(`[Plex Debug] Could not parse Rotten Tomatoes data for "${sourceItem.title}" from rating array:`, JSON.stringify(sourceItem.Rating));
            }
        }

        return {
            key: uniqueKey,
            title: sourceItem.title,
            backgroundUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(backgroundArt)}`,
            posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.thumb)}`,
            clearLogoUrl: clearLogoPath ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(clearLogoPath)}` : null,
            tagline: sourceItem.tagline,
            rating: sourceItem.rating,
            year: sourceItem.year,
            imdbUrl: imdbUrl,
            rottenTomatoes: rottenTomatoesData,
            _raw: isDebug ? item : undefined
        };
    } catch (e) {
        if (isDebug) console.log(`[Debug] Skipping item due to error fetching details for key ${itemSummary.key}: ${e.message}`);
        return null;
    }
}

// --- Client Management ---

/**
 * Creates a new PlexAPI client instance with the given options.
 * @param {object} options - The connection options.
 * @param {string} options.hostname - The Plex server hostname or IP.
 * @param {string|number} options.port - The Plex server port.
 * @param {string} options.token - The Plex authentication token.
 * @param {number} [options.timeout] - Optional request timeout in milliseconds.
 * @returns {PlexAPI} A new PlexAPI client instance.
 */
function createPlexClient({ hostname, port, token, timeout }) {
    if (!hostname || !port || !token) {
        throw new ApiError(500, 'Plex client creation failed: missing hostname, port, or token.');
    }

    // Sanitize hostname to prevent crashes if the user includes the protocol.
    let sanitizedHostname = hostname.trim();
    try {
        // The URL constructor needs a protocol to work.
        const fullUrl = sanitizedHostname.includes('://') ? sanitizedHostname : `http://${sanitizedHostname}`;
        const url = new URL(fullUrl);
        sanitizedHostname = url.hostname; // This extracts just the hostname/IP
        if (isDebug) console.log(`[Plex Client] Sanitized hostname to: "${sanitizedHostname}"`);
    } catch (e) {
        // Fallback for invalid URL formats that might still be valid hostnames (though unlikely)
        sanitizedHostname = sanitizedHostname.replace(/^https?:\/\//, '');
        if (isDebug) console.log(`[Plex Client] Could not parse hostname as URL, falling back to simple sanitization: "${sanitizedHostname}"`);
    }

    const clientOptions = {
        hostname: sanitizedHostname,
        port,
        token,
        ...getPlexClientOptions()
    };

    if (timeout) clientOptions.timeout = timeout;
    return new PlexAPI(clientOptions);
}

/**
 * Caches PlexAPI clients to avoid re-instantiating for every request.
 * @type {Object.<string, PlexAPI>}
 */
const plexClients = {};
function getPlexClient(serverConfig) {
    if (!plexClients[serverConfig.name]) {
        const hostname = process.env[serverConfig.hostnameEnvVar];
        const port = process.env[serverConfig.portEnvVar];
        const token = process.env[serverConfig.tokenEnvVar];

        // The createPlexClient function will throw an error if details are missing.
        // This replaces the explicit token check that was here before.
        plexClients[serverConfig.name] = createPlexClient({ hostname, port, token });
    }
    return plexClients[serverConfig.name];
}

/**
 * Fetches all library sections from a Plex server and returns them as a Map.
 * @param {object} serverConfig - The configuration for the Plex server.
 * @returns {Promise<Map<string, object>>} A map of library titles to library objects.
 */
async function getPlexLibraries(serverConfig) {
    const plex = getPlexClient(serverConfig);
    const sectionsResponse = await plex.query('/library/sections');
    const allSections = sectionsResponse?.MediaContainer?.Directory || [];
    const libraries = new Map();
    allSections.forEach(dir => libraries.set(dir.title, dir));
    return libraries;
}

// --- Main Data Aggregation ---

async function getPlaylistMedia() {
    let allMedia = [];
    const enabledServers = config.mediaServers.filter(s => s.enabled);
 
    for (const server of enabledServers) {
        if (isDebug) console.log(`[Debug] Fetching from server: ${server.name} (${server.type})`);
 
        let source;
        if (server.type === 'plex') {
            source = new PlexSource(server, getPlexClient, processPlexItem, getPlexLibraries, shuffleArray, config.rottenTomatoesMinimumScore, isDebug);
        } else {
            if (isDebug) console.log(`[Debug] Skipping server ${server.name} due to unsupported type ${server.type}`);
            continue;
        }
 
        const [movies, shows] = await Promise.all([
            source.fetchMedia(server.movieLibraryNames || [], 'movie', server.movieCount || 0),
            source.fetchMedia(server.showLibraryNames || [], 'show', server.showCount || 0)
        ]);
        const mediaFromServer = movies.concat(shows);
 
        if (isDebug) console.log(`[Debug] Fetched ${mediaFromServer.length} items from ${server.name}.`);
        allMedia = allMedia.concat(mediaFromServer);
    }
 
    return allMedia;
}

let playlistCache = null;
let cacheTimestamp = 0;
let isRefreshing = false; // Lock to prevent concurrent refreshes

/**
 * Fetches media from all enabled servers and refreshes the in-memory cache.
 */
async function refreshPlaylistCache() {
    if (isRefreshing) {
        if (isDebug) console.log('[Debug] A playlist refresh is already in progress. Skipping.');
        return;
    }

    isRefreshing = true;
    if (isDebug) console.log('[Debug] Starting background playlist refresh.');

    try {
        const allMedia = await getPlaylistMedia();
        playlistCache = shuffleArray(allMedia);
        cacheTimestamp = Date.now();
        if (isDebug) console.log(`[Debug] Background refresh complete. New playlist has ${playlistCache.length} items.`);
    } catch (error) {
        console.error('Error during background playlist refresh:', error.message);
        // We keep the old cache in case of an error
    } finally {
        isRefreshing = false;
    }
}

// --- Admin Panel Logic ---

/**
 * Middleware to check if the user is authenticated.
 */
function isAuthenticated(req, res, next) {    
    // 1. Check for session-based authentication (for browser users)
    if (req.session && req.session.user) {
        if (isDebug) console.log(`[Auth] Authenticated via session for user: ${req.session.user.username}`);
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

        if (storedTokenBuffer.length === providedTokenBuffer.length && crypto.timingSafeEqual(storedTokenBuffer, providedTokenBuffer)) {
            if (isDebug) console.log('[Auth] Authenticated via API Key.');
            // Optionally, you could attach a user object for consistency
            // req.user = { username: 'api_user' };
            return next();
        }
    }

    // 3. If neither method works, deny access.
    if (isDebug) {
        const reason = authHeader ? 'Invalid token' : 'No session or token';
        console.log(`[Auth] Authentication failed. Reason: ${reason}`);
    }

    // For API requests, send a 401 JSON error.
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required. Your session may have expired or your API token is invalid.' });
    }

    // For regular page navigations, redirect to the login page.
    return res.redirect('/admin/login');
}

/**
 * Reads the .env file and returns its content as a string.
 */
async function readEnvFile() {
    try {
        return await fs.readFile('.env', 'utf-8');
    } catch (error) {
        if (error.code === 'ENOENT') return ''; // File doesn't exist yet
        throw error;
    }
}

/**
 * Writes new values to the .env file, preserving existing content.
 * @param {Object} newValues - An object with key-value pairs to write.
 */
async function writeEnvFile(newValues) {
    if (isDebug) {
        console.log('[Admin API] Attempting to write to .env file with values:', newValues);
    }
    let content = await readEnvFile();
    const lines = content.split('\n');
    const updatedKeys = new Set(Object.keys(newValues));

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
    if (isDebug) {
        console.log('[Admin API] New .env content to be written:\n---\n' + newContent + '\n---');
    }

    await fs.writeFile('.env', newContent, 'utf-8');
    // Important: Update process.env for the current running instance
    Object.assign(process.env, newValues);
}

/**
 * Reads the config.json file.
 */
async function readConfig() {
    const content = await fs.readFile('./config.json', 'utf-8');
    return JSON.parse(content);
}

/**
 * Writes to the config.json file.
 * @param {object} newConfig - The new configuration object to write.
 */
async function writeConfig(newConfig) {
    if (isDebug) console.log('[Admin API] Attempting to write to config.json with data:', JSON.stringify(newConfig, null, 2));

    // Remove metadata before writing
    delete newConfig._metadata;
    const newContent = JSON.stringify(newConfig, null, 2);
    const tempPath = './config.json.tmp';
    const finalPath = './config.json';

    try {
        // Write to a temporary file first
        await fs.writeFile(tempPath, newContent, 'utf-8');
        // Atomically rename the temp file to the final file
        await fs.rename(tempPath, finalPath);
        // Update the in-memory config for the current running instance
        Object.assign(config, newConfig);
    } catch (error) {
        console.error('[Admin API] Failed to write config atomically. Cleaning up temp file if it exists.', error);
        // Attempt to clean up the temporary file on error to avoid leaving garbage
        await fs.unlink(tempPath).catch(cleanupError => {
            console.error('[Admin API] Failed to clean up temp config file:', cleanupError);
        });
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

app.get('/admin', (req, res) => {
    if (!isAdminSetup()) {
        return res.redirect('/admin/setup');
    }
    // If setup is done, the isAuthenticated middleware will handle the rest
    isAuthenticated(req, res, () => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
});

app.get('/admin/logs', isAuthenticated, (req, res) => {
    // This route serves the dedicated live log viewer page.
    res.sendFile(path.join(__dirname, 'public', 'logs.html'));
});

// --- API Endpoints ---

/**
 * @swagger
 * /get-config:
 *   get:
 *     summary: Retrieve the public application configuration
 *     description: Fetches the non-sensitive configuration needed by the frontend for display logic.
 *     tags: [Public API]
 *     responses:
 *       200:
 *         description: The public configuration object.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Config'
 */
app.get('/get-config', (req, res) => {
    res.json({
        clockWidget: config.clockWidget !== false,
        transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
        backgroundRefreshMinutes: config.backgroundRefreshMinutes || 30,
        showClearLogo: config.showClearLogo !== false,
        showPoster: config.showPoster !== false,
        showMetadata: config.showMetadata === true,
        showRottenTomatoes: config.showRottenTomatoes !== false,
        rottenTomatoesMinimumScore: config.rottenTomatoesMinimumScore || 0,
        kenBurnsEffect: config.kenBurnsEffect || { enabled: true, durationSeconds: 20 }
    });
});

/**
 * @swagger
 * /get-media:
 *   get:
 *     summary: Retrieve the shuffled media playlist
 *     description: >
 *       Fetches the media playlist from the cache. If the cache is empty or stale,
 *       it triggers a refresh from the configured media servers (Plex/Jellyfin).
 *       The client may receive a 202 status if the playlist is being built.
 *     tags: [Public API]
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
 */
app.get('/get-media', asyncHandler(async (req, res) => {
    // Prevent the browser from caching this endpoint, which is crucial for the polling mechanism.
    res.setHeader('Cache-Control', 'no-store');

    // If the cache is not null, it means the initial fetch has completed (even if it found no items).
    // An empty array is a valid state if no servers are configured or no media is found.
    if (playlistCache !== null) {
        const itemCount = playlistCache.length;
        if (isDebug) console.log(`[Debug] Serving ${itemCount} items from cache. Cache is ${itemCount > 0 ? 'populated' : 'empty'}.`);
        return res.json(playlistCache);
    }

    if (isRefreshing) {
        // The full cache is being built. Tell the client to wait and try again.
        if (isDebug) console.log('[Debug] Cache is empty but refreshing. Sending 202 Accepted.');
        // 202 Accepted is appropriate here: the request is accepted, but processing is not complete.
        return res.status(202).json({
            status: 'building',
            message: 'Playlist is being built. Please try again in a few seconds.',
            retryIn: 2000 // Suggest a 2-second polling interval
        });
    }

    // If we get here, the cache is empty and we are not refreshing, which means the initial fetch failed.
    if (isDebug) console.log('[Debug] Cache is empty and not refreshing. Sending 503 Service Unavailable.');
    return res.status(503).json({
        status: 'failed',
        error: "Media playlist is currently unavailable. The initial fetch may have failed. Check server logs."
    });
}));

/**
 * @swagger
 * /get-media-by-key/{key}:
 *   get:
 *     summary: Retrieve a single media item by its unique key
 *     description: Fetches the full details for a specific media item, typically used when a user clicks on a 'recently added' item that isn't in the main playlist.
 *     tags: [Public API]
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
app.get('/get-media-by-key/:key', asyncHandler(async (req, res) => {
    const keyParts = req.params.key.split('-'); // e.g., ['plex', 'My', 'Server', '12345']
    if (keyParts.length < 3) { // Must have at least type, name, and key
        throw new ApiError(400, 'Invalid media key format.');
    }
    const type = keyParts.shift();
    const originalKey = keyParts.pop();
    const serverName = keyParts.join('-'); // Re-join the middle parts
    const serverConfig = config.mediaServers.find(s => s.name === serverName && s.type === type && s.enabled === true);

    if (!serverConfig) {
        throw new NotFoundError('Server configuration not found for this item.');
    }

    let mediaItem = null;
    if (type === 'plex') {
        const plex = getPlexClient(serverConfig);
        mediaItem = await processPlexItem({ key: `/library/metadata/${originalKey}` }, serverConfig, plex);
    }
    if (mediaItem) {
        res.json(mediaItem);
    } else {
        throw new NotFoundError('Media not found or could not be processed.');
    }
}));

/**
 * @swagger
 * /image:
 *   get:
 *     summary: Image proxy
 *     description: Proxies image requests to the media server (Plex/Jellyfin) to avoid exposing server details and tokens to the client.
 *     tags: [Public API]
 *     parameters:
 *       - in: query
 *         name: server
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the server config from config.json.
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The image path from the media item object (e.g., /library/metadata/12345/art/...).
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
app.get('/image', asyncHandler(async (req, res) => {
    const { server: serverName, path: imagePath } = req.query;

    if (isDebug) {
        console.log(`[Image Proxy] Request for image received. Server: "${serverName}", Path: "${imagePath}"`);
    }

    if (!serverName || !imagePath) {
        if (isDebug) console.log('[Image Proxy] Bad request: server name or image path is missing.');
        return res.status(400).send('Server name or image path is missing');
    }

    const serverConfig = config.mediaServers.find(s => s.name === serverName);
    if (!serverConfig) {
        console.error(`[Image Proxy] Server configuration for "${serverName}" not found. Cannot process image request.`);
        return res.redirect('/fallback-poster.png');
    }

    let imageUrl;
    const fetchOptions = {
        method: 'GET',
        headers: {}
    };

    if (serverConfig.type === 'plex') {
        const token = process.env[serverConfig.tokenEnvVar];
        if (!token) {
            console.error(`[Image Proxy] Plex token not configured for server "${serverName}" (env var: ${serverConfig.tokenEnvVar}).`);
            return res.redirect('/fallback-poster.png');
        }
        const hostname = process.env[serverConfig.hostnameEnvVar];
        const port = process.env[serverConfig.portEnvVar];
        imageUrl = `http://${hostname}:${port}${imagePath}`;
        fetchOptions.headers['X-Plex-Token'] = token;
        if (isDebug) console.log(`[Image Proxy] Fetching from Plex URL: ${imageUrl}`);
    } else {
        console.error(`[Image Proxy] Unsupported server type "${serverConfig.type}" for server "${serverName}".`);
        return res.redirect('/fallback-poster.png');
    }

    try {
        const mediaServerResponse = await fetch(imageUrl, fetchOptions);

        if (!mediaServerResponse.ok) {
            const statusText = mediaServerResponse.statusText;
            const status = mediaServerResponse.status;
            console.warn(`[Image Proxy] Media server "${serverName}" returned status ${status} ${statusText} for path "${imagePath}".`);
            if (isDebug) {
                const responseText = await mediaServerResponse.text().catch(() => 'Could not read response body.');
                console.log(`[Image Proxy] Media server response body (truncated): ${responseText.substring(0, 200)}`);
            }            
            console.warn(`[Image Proxy] Serving fallback image for "${imagePath}".`);
            return res.redirect('/fallback-poster.png');
        }

        if (isDebug) console.log(`[Image Proxy] Successfully fetched and streaming image for path: "${imagePath}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 86400 seconds = 24 hours
        const contentType = mediaServerResponse.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        } else {
            console.warn(`[Image Proxy] No content-type header from "${serverName}" for path "${imagePath}". Defaulting to image/jpeg.`);
            res.setHeader('Content-Type', 'image/jpeg');
        }
        mediaServerResponse.body.pipe(res);
    } catch (error) {
        console.error(`[Image Proxy] Network or fetch error for path "${imagePath}" on server "${serverName}".`);

        if (error.name === 'AbortError') {
             console.error(`[Image Proxy] Fetch aborted, possibly due to timeout.`);
        } else if (error.message.startsWith('read ECONNRESET')) {
            console.error(`[Image Proxy] Connection reset by peer. The media server may have closed the connection unexpectedly.`);
        }

        console.error(`[Image Proxy] Error: ${error.message}`);
        if (error.cause) console.error(`[Image Proxy] Cause: ${error.cause}`);
        console.warn(`[Image Proxy] Serving fallback image for "${imagePath}".`);
        res.redirect('/fallback-poster.png');
    }
}));

app.get('/admin/setup', (req, res) => {
    if (isAdminSetup()) {
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.post('/admin/setup', asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin Setup] Received setup request.');
    if (isAdminSetup()) {
        if (isDebug) console.log('[Admin Setup] Aborted: Admin user is already configured.');
        throw new ApiError(403, 'Admin user is already configured.');
    }
    
    const { username, password } = req.body;
    if (!username || !password) {
        if (isDebug) console.log('[Admin Setup] Aborted: Username or password missing.');
        throw new ApiError(400, 'Username and password are required.');
    }
    
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const sessionSecret = require('crypto').randomBytes(32).toString('hex');
    
    // 2FA can be enabled from the admin panel after the first login.
    await writeEnvFile({
        ADMIN_USERNAME: username,
        ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: sessionSecret,
        ADMIN_2FA_SECRET: '' // Explicitly set to empty to ensure 2FA is off by default
    });
    
    if (isDebug) console.log(`[Admin Setup] Successfully created admin user "${username}". 2FA is not enabled by default.`);
    
    res.send('Setup complete! You can now log in. You will be redirected shortly. <script>setTimeout(() => window.location.href="/admin/login", 3000);</script>');
}));

app.get('/admin/login', (req, res) => {
    if (!isAdminSetup()) {
        return res.redirect('/admin/setup');
    }
    if (req.session.user) {
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (isDebug) console.log(`[Admin Login] Attempting login for user "${username}".`);

    const isValidUser = (username === process.env.ADMIN_USERNAME);
    if (!isValidUser) {
        if (isDebug) console.log(`[Admin Login] Login failed for user "${username}". Invalid username.`);
        throw new ApiError(401, 'Invalid username or password. <a href="/admin/login">Try again</a>.');
    }

    const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!isValidPassword) {
        if (isDebug) console.log(`[Admin Login] Login failed for user "${username}". Invalid credentials.`);
        throw new ApiError(401, 'Invalid username or password. <a href="/admin/login">Try again</a>.');
    }

    // --- Check if 2FA is enabled ---
    const secret = process.env.ADMIN_2FA_SECRET || '';
    const is2FAEnabled = secret.trim() !== '';

    if (is2FAEnabled) {
        // User is valid, but needs to provide a 2FA code.
        // Set a temporary flag in the session.
        req.session.tfa_required = true;
        req.session.tfa_user = { username: username }; // Store user info temporarily
        if (isDebug) console.log(`[Admin Login] Credentials valid for "${username}". Redirecting to 2FA verification.`);
        res.redirect('/admin/2fa-verify');
    } else {
        // No 2FA, log the user in directly.
        req.session.user = { username: username };
        if (isDebug) console.log(`[Admin Login] Login successful for user "${username}". Redirecting to admin panel.`);
        res.redirect('/admin');
    }
}));

app.get('/admin/2fa-verify', (req, res) => {
    // Only show this page if the user has passed the first step of login.
    if (!req.session.tfa_required) {
        return res.redirect('/admin/login');
    }
    res.sendFile(path.join(__dirname, 'public', '2fa-verify.html'));
});

app.post('/admin/2fa-verify', asyncHandler(async (req, res) => {
    const { totp_code } = req.body;

    if (!req.session.tfa_required || !req.session.tfa_user) {
        if (isDebug) console.log('[Admin 2FA Verify] 2FA verification attempted without prior password validation. Redirecting to login.');
        return res.redirect('/admin/login');
    }

    const secret = process.env.ADMIN_2FA_SECRET || '';
    const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: totp_code, window: 1 });

    if (verified) {
        req.session.user = { username: req.session.tfa_user.username };
        delete req.session.tfa_required;
        delete req.session.tfa_user;
        if (isDebug) console.log(`[Admin 2FA Verify] 2FA verification successful for user "${req.session.user.username}".`);
        res.redirect('/admin');
    } else {
        if (isDebug) console.log(`[Admin 2FA Verify] Invalid 2FA code for user "${req.session.tfa_user.username}".`);
        // Redirect back to the verification page with an error query parameter
        // for a better user experience than a generic error page.
        res.redirect('/admin/2fa-verify?error=invalid_code');
    }
}));

app.get('/admin/logout', (req, res, next) => {
    if (isDebug) console.log(`[Admin Logout] User "${req.session.user?.username}" logging out.`);
    req.session.destroy(err => {
        if (err) {
            if (isDebug) console.error('[Admin Logout] Error destroying session:', err);
            return next(new ApiError(500, 'Could not log out.'));
        }
        if (isDebug) console.log('[Admin Logout] Session destroyed successfully.');
        res.redirect('/admin/login');
    });
});

/**
 * @swagger
 * /api/admin/2fa/generate:
 *   post:
 *     summary: Genereer een nieuwe 2FA-geheim
 *     description: >
 *       Genereert een nieuw geheim voor Two-Factor Authentication (2FA) en geeft een QR-code terug
 *       die de gebruiker kan scannen met een authenticator-app. Het geheim wordt tijdelijk in de sessie
 *       opgeslagen en wordt pas permanent na succesvolle verificatie.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR-code en geheim succesvol gegenereerd.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Generate2FAResponse'
 *       400:
 *         description: 2FA is al ingeschakeld.
 *       401:
 *         description: Niet geautoriseerd.
 */
app.post('/api/admin/2fa/generate', isAuthenticated, asyncHandler(async (req, res) => {
    const secret = process.env.ADMIN_2FA_SECRET || '';
    const isEnabled = secret.trim() !== '';
    // Prevent generating a new secret if one is already active
    if (isEnabled) {
        throw new ApiError(400, '2FA is already enabled.');
    }

    const newSecret = speakeasy.generateSecret({
        length: 20,
        name: `posterrama.app (${req.session.user.username})`
    });

    // Store the new secret in the session, waiting for verification.
    // This is crucial so we don't lock the user out if they fail to verify.
    req.session.tfa_pending_secret = newSecret.base32;

    const qrCodeDataUrl = await qrcode.toDataURL(newSecret.otpauth_url);
    res.json({ qrCodeDataUrl });
}));

/**
 * @swagger
 * /api/admin/2fa/verify:
 *   post:
 *     summary: Verifieer en activeer 2FA
 *     description: >
 *       Verifieert de TOTP-code die door de gebruiker is ingevoerd tegen het tijdelijke geheim in de sessie.
 *       Bij succes wordt het 2FA-geheim permanent opgeslagen in het .env-bestand en wordt 2FA geactiveerd.
 *     tags: [Admin API]
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
 *         description: 2FA succesvol ingeschakeld.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Ongeldige verificatiecode of geen 2FA-proces in behandeling.
 *       401:
 *         description: Niet geautoriseerd.
 */
app.post('/api/admin/2fa/verify', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    const { token } = req.body;
    const pendingSecret = req.session.tfa_pending_secret;

    if (!pendingSecret) {
        throw new ApiError(400, 'No 2FA setup process is pending. Please try again.');
    }

    const verified = speakeasy.totp.verify({
        secret: pendingSecret,
        encoding: 'base32',
        token: token,
        window: 1
    });

    if (verified) {
        // Verification successful, save the secret to the .env file
        await writeEnvFile({ ADMIN_2FA_SECRET: pendingSecret });
        
        // Clear the pending secret from the session
        delete req.session.tfa_pending_secret;

        if (isDebug) console.log(`[Admin 2FA] 2FA enabled successfully for user "${req.session.user.username}".`);
        res.json({ success: true, message: '2FA enabled successfully.' });
    } else {
        if (isDebug) console.log(`[Admin 2FA] 2FA verification failed for user "${req.session.user.username}".`);
        throw new ApiError(400, 'Invalid verification code. Please try again.');
    }
}));

/**
 * @swagger
 * /api/admin/2fa/disable:
 *   post:
 *     summary: Schakel 2FA uit
 *     description: >
 *       Schakelt Two-Factor Authentication uit voor de admin-account.
 *       De gebruiker moet zijn huidige wachtwoord opgeven als bevestiging.
 *     tags: [Admin API]
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
 *         description: 2FA succesvol uitgeschakeld.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Wachtwoord is vereist.
 *       401:
 *         description: Onjuist wachtwoord of niet geautoriseerd.
 */
app.post('/api/admin/2fa/disable', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!password) throw new ApiError(400, 'Password is required to disable 2FA.');
    const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!isValidPassword) throw new ApiError(401, 'Incorrect password.');
    await writeEnvFile({ ADMIN_2FA_SECRET: '' });
    if (isDebug) console.log(`[Admin 2FA] 2FA disabled successfully for user "${req.session.user.username}".`);
    res.json({ success: true, message: '2FA disabled successfully.' });
}));

/**
 * @swagger
 * /api/admin/config:
 *   get:
 *     summary: Haal de volledige admin-configuratie op
 *     description: >
 *       Haalt de volledige `config.json` op, samen met relevante omgevingsvariabelen
 *       en beveiligingsstatus (zoals 2FA) die nodig zijn voor het admin-paneel.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: De configuratie-objecten.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminConfigResponse'
 *       401:
 *         description: Niet geautoriseerd.
 */
app.get('/api/admin/config', isAuthenticated, asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin API] Request received for /api/admin/config.');
    const currentConfig = await readConfig();
    if (isDebug) console.log('[Admin API] Successfully read config.json.');

    // WARNING: Exposing environment variables to the client can be a security risk.
    // This is done based on an explicit user request.
    const envVarsToExpose = {
        SERVER_PORT: process.env.SERVER_PORT,
        DEBUG: process.env.DEBUG
    };

    if (currentConfig.mediaServers) {
        currentConfig.mediaServers.forEach(server => {
            // Find all keys ending in 'EnvVar' and get their values from process.env
            Object.keys(server).forEach(key => {
                if (key.endsWith('EnvVar')) {
                    const envVarName = server[key];
                    if (envVarName) {
                        const isSensitive = key.toLowerCase().includes('token') || key.toLowerCase().includes('password') || key.toLowerCase().includes('apikey');
                        if (isSensitive) {
                            // For sensitive fields, just indicate if they are set or not.
                            envVarsToExpose[envVarName] = !!process.env[envVarName];
                        } else if (process.env[envVarName]) {
                            envVarsToExpose[envVarName] = process.env[envVarName];
                        }
                    }
                }
            });
        });
    }

    if (isDebug) console.log('[Admin API] Sending config and selected environment variables to client.');
    res.json({
        config: currentConfig,
        env: envVarsToExpose,
        security: { is2FAEnabled: !!(process.env.ADMIN_2FA_SECRET || '').trim() }
    });
}))

/**
 * @swagger
 * /api/admin/test-plex:
 *   post:
 *     summary: Test de verbinding met een Plex-server
 *     description: >
 *       Controleert of de applicatie verbinding kan maken met een Plex-server met de opgegeven
 *       hostnaam, poort en token. Dit is een lichtgewicht controle die de server-root opvraagt.
 *     tags: [Admin API]
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
 *         description: Verbinding succesvol.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Verbindingsfout (bv. onjuiste gegevens, time-out).
 */
app.post('/api/admin/test-plex', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin API] Received request to test Plex connection.');
    let { hostname, port, token } = req.body; // token is now optional

    if (!hostname || !port) {
        throw new ApiError(400, 'Hostname and port are required for the test.');
    }

    // Sanitize hostname to remove http(s):// prefix
    if (hostname) {
        hostname = hostname.trim().replace(/^https?:\/\//, '');
    }

    // If no token is provided in the request, use the one from the server's config.
    if (!token) {
        if (isDebug) console.log('[Plex Test] No token provided in request, attempting to use existing server token.');
        // Find the first enabled Plex server config. This assumes a single Plex server setup for now.
        const plexServerConfig = config.mediaServers.find(s => s.type === 'plex' && s.enabled);

        if (plexServerConfig && plexServerConfig.tokenEnvVar) {
            token = process.env[plexServerConfig.tokenEnvVar];
            if (!token) {
                throw new ApiError(400, 'Connection test failed: No new token was provided, and no token is configured on the server.');
            }
        } else {
            throw new ApiError(500, 'Connection test failed: Could not find Plex server configuration on the server.');
        }
    }

    try {
        const testClient = createPlexClient({
            hostname,
            port,
            token,
            timeout: 5000
        });
        // Querying the root is a lightweight way to check credentials and reachability.
        const result = await testClient.query('/');
        const serverName = result?.MediaContainer?.friendlyName;

        if (serverName) {
            res.json({ success: true, message: `Successfully connected to Plex server: ${serverName}` });
        } else {
            // This case is unlikely if the query succeeds, but good to handle.
            res.json({ success: true, message: 'Connection successful, but could not retrieve the server name.' });
        }
    } catch (error) {
        if (isDebug) console.error('[Plex Test] Connection failed:', error.message);
        let userMessage = 'Connection failed. Please check the hostname, port, and token.';
        if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
            userMessage = 'Connection refused. Is the hostname and port correct and is the server running?';
        } else if (error.message.includes('401 Unauthorized')) {
            userMessage = 'Connection failed: Unauthorized. Is the Plex token correct?';
        } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
            userMessage = 'Connection timed out. Is the server reachable? Check firewall settings.';
        }
        throw new ApiError(400, userMessage);
    }
}));



/**
 * @swagger
 * /api/admin/plex-libraries:
 *   post:
 *     summary: Haal Plex-bibliotheken op
 *     description: >
 *       Haalt een lijst op van alle beschikbare bibliotheken (zoals 'Movies', 'TV Shows')
 *       van de geconfigureerde Plex-server.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: Optionele verbindingsgegevens. Indien niet opgegeven, worden de geconfigureerde waarden gebruikt.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PlexConnectionRequest'
 *     responses:
 *       200:
 *         description: Een lijst met gevonden bibliotheken.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlexLibrariesResponse'
 *       400:
 *         description: Kon bibliotheken niet ophalen (bv. onjuiste gegevens).
 */
app.post('/api/admin/plex-libraries', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin API] Received request to fetch Plex libraries.');
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
        throw new ApiError(400, 'Plex-verbindingsdetails (hostnaam, poort, token) ontbreken.');
    }

    try {
        const client = createPlexClient({
            hostname,
            port,
            token,
            timeout: 10000
        });
        const sectionsResponse = await client.query('/library/sections');
        const allSections = sectionsResponse?.MediaContainer?.Directory || [];

        const libraries = allSections.map(dir => ({
            key: dir.key,
            name: dir.title,
            type: dir.type // 'movie', 'show', etc.
        }));

        res.json({ success: true, libraries });

    } catch (error) {
        if (isDebug) console.error('[Plex Lib Fetch] Failed:', error.message);
        let userMessage = 'Kon bibliotheken niet ophalen. Controleer de verbindingsgegevens.';
        if (error.message.includes('401 Unauthorized')) {
            userMessage = 'Ongeautoriseerd. Is de Plex-token correct?';
        } else if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
            userMessage = 'Verbinding geweigerd. Is de hostnaam en poort correct?';
        } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
            userMessage = 'Verbinding time-out. Is de server bereikbaar?';
        } else if (error.message.includes('The string did not match the expected pattern')) {
            userMessage = 'Ongeldig hostnaam-formaat. Gebruik een IP-adres of hostnaam zonder http:// of https://.';
        }
        throw new ApiError(400, userMessage);
    }
}));

/**
 * @swagger
 * /api/admin/config:
 *   post:
 *     summary: Sla de admin-configuratie op
 *     description: >
 *       Slaat de wijzigingen op in zowel `config.json` als het `.env`-bestand.
 *       Na een succesvolle opslag worden de caches en clients van de applicatie gewist
 *       en wordt een achtergrondvernieuwing van de afspeellijst gestart.
 *     tags: [Admin API]
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
 *         description: Configuratie succesvol opgeslagen.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Ongeldige request body.
 *       401:
 *         description: Niet geautoriseerd.
 */
app.post('/api/admin/config', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    if (isDebug) {
        console.log('[Admin API] Received POST request to /api/admin/config to save settings. Body:', JSON.stringify(req.body, null, 2));
    }
    const { config: newConfig, env: newEnv } = req.body;

    if (!newConfig || !newEnv) {
        if (isDebug) console.log('[Admin API] Invalid request body. Missing "config" or "env".');
        throw new ApiError(400, 'Invalid request body. "config" and "env" properties are required.');
    }

    // Write to config.json and .env
    await writeConfig(newConfig);
    if (isDebug) console.log('[Admin API] Successfully wrote to config.json.');
    await writeEnvFile(newEnv);
    if (isDebug) console.log('[Admin API] Successfully wrote to .env file.');

    // Clear caches to reflect changes without a full restart
    playlistCache = null;
    Object.keys(plexClients).forEach(key => delete plexClients[key]);

    // Trigger a background refresh of the playlist with the new settings.
    // We don't await this, so the admin UI gets a fast response.
    refreshPlaylistCache();

    if (isDebug) {
        console.log('[Admin] Configuration saved successfully. Caches and clients have been cleared. Triggered background playlist refresh.');
    }

    res.json({ message: 'Configuration saved successfully. Some changes may require an application restart.' });
}));

/**
 * @swagger
 * /api/admin/change-password:
 *   post:
 *     summary: Wijzig het admin-wachtwoord
 *     description: Stelt de gebruiker in staat om zijn eigen admin-wachtwoord te wijzigen.
 *     tags: [Admin API]
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
 *         description: Wachtwoord succesvol gewijzigd.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 *       400:
 *         description: Vereiste velden ontbreken of nieuwe wachtwoorden komen niet overeen.
 *       401:
 *         description: Huidig wachtwoord is onjuist.
 */
app.post('/api/admin/change-password', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin API] Received request to change password.');
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
        if (isDebug) console.log('[Admin API] Password change failed: missing fields.');
        throw new ApiError(400, 'All password fields are required.');
    }

    if (newPassword !== confirmPassword) {
        if (isDebug) console.log('[Admin API] Password change failed: new passwords do not match.');
        throw new ApiError(400, 'New password and confirmation do not match.');
    }

    const isValidPassword = await bcrypt.compare(currentPassword, process.env.ADMIN_PASSWORD_HASH);
    if (!isValidPassword) {
        if (isDebug) console.log('[Admin API] Password change failed: incorrect current password.');
        throw new ApiError(401, 'Incorrect current password.');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await writeEnvFile({ ADMIN_PASSWORD_HASH: newPasswordHash });

    if (isDebug) console.log('[Admin API] Password changed successfully and new hash written to .env file.');
    res.json({ message: 'Password changed successfully.' });
}));

/**
 * @swagger
 * /api/admin/restart-app:
 *   post:
 *     summary: Herstart de applicatie
 *     description: >
 *       Geeft een commando aan PM2 om de applicatie te herstarten.
 *       Dit is nuttig na het wijzigen van kritieke instellingen zoals de poort.
 *       De API reageert onmiddellijk met een 202 Accepted status.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Herstart-commando ontvangen en wordt verwerkt.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 */
app.post('/api/admin/restart-app', isAuthenticated, asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin API] Received request to restart the application.');

    const appName = ecosystemConfig.apps[0].name || 'posterrama';
    if (isDebug) console.log(`[Admin API] Determined app name for PM2: "${appName}"`);

    // Immediately send a response to the client to avoid a race condition.
    // We use 202 Accepted, as the server has accepted the request but the action is pending.
    res.status(202).json({ message: 'Herstart-commando ontvangen. De applicatie wordt nu herstart.' });

    // Execute the restart command after a short delay to ensure the HTTP response has been sent.
    setTimeout(() => {
        if (isDebug) console.log(`[Admin API] Executing command: "pm2 restart ${appName}"`);
        exec(`pm2 restart ${appName}`, (error, stdout, stderr) => {
            // We can't send a response here, but we can log the outcome for debugging.
            if (error) {
                console.error(`[Admin API] PM2 restart command failed after response was sent.`);
                console.error(`[Admin API] Error: ${error.message}`);
                if (stderr) console.error(`[Admin API] PM2 stderr: ${stderr}`);
                return;
            }
            if (isDebug) console.log(`[Admin API] PM2 restart command issued successfully for '${appName}'.`);
        });
    }, 100); // 100ms delay should be sufficient.
}));

/**
 * @swagger
 * /api/admin/refresh-media:
 *   post:
 *     summary: Forceer een onmiddellijke vernieuwing van de media-afspeellijst
 *     description: >
 *       Start handmatig het proces om media op te halen van alle geconfigureerde servers.
 *       Dit is een asynchrone operatie. De API reageert wanneer de vernieuwing is voltooid.
 *       Dit eindpunt is beveiligd en vereist een actieve admin-sessie.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: De afspeellijst is succesvol vernieuwd.
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
 *                   example: "Media playlist succesvol vernieuwd. 150 items gevonden."
 *                 itemCount:
 *                   type: integer
 *                   example: 150
 */
app.post('/api/admin/refresh-media', isAuthenticated, asyncHandler(async (req, res) => {
    if (isDebug) console.log('[Admin API] Received request to force-refresh media playlist.');

    // The refreshPlaylistCache function already has a lock (isRefreshing)
    // so we can call it directly. We'll await it to give feedback to the user.
    await refreshPlaylistCache();

    const itemCount = playlistCache ? playlistCache.length : 0;
    const message = `Media playlist succesvol vernieuwd. ${itemCount} items gevonden.`;
    if (isDebug) console.log(`[Admin API] ${message}`);

    res.json({ success: true, message: message, itemCount: itemCount });
}));

/**
 * @swagger
 * /api/admin/api-key:
 *   get:
 *     summary: Haal de huidige API-sleutel op
 *     description: Haalt de momenteel geconfigureerde API-toegangssleutel op. Deze wordt alleen teruggestuurd naar een geauthenticeerde admin-sessie.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: De API-sleutel.
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
 *     summary: Controleer de status van de API-sleutel
 *     description: Geeft aan of er momenteel een API-toegangssleutel is geconfigureerd in de applicatie.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: De status van de API-sleutel.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasKey:
 *                   type: boolean
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
 *     summary: Genereer een nieuwe API-sleutel
 *     description: >
 *       Genereert een nieuwe, cryptografisch veilige API-toegangssleutel, slaat deze op in het .env-bestand
 *       en overschrijft een eventuele bestaande sleutel. De nieuwe sleutel wordt EENMALIG teruggestuurd.
 *       Sla hem veilig op, want hij kan niet opnieuw worden opgevraagd.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: De nieuw gegenereerde API-sleutel.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiKeyResponse'
 */
app.post('/api/admin/api-key/generate', isAuthenticated, asyncHandler(async (req, res) => {
    const newApiKey = crypto.randomBytes(32).toString('hex');
    await writeEnvFile({ API_ACCESS_TOKEN: newApiKey });
    if (isDebug) console.log('[Admin API] New API Access Token generated and saved.');
    res.json({ apiKey: newApiKey, message: 'New API key generated. This is the only time it will be shown. Please save it securely.' });
}));

/**
 * @swagger
 * /api/admin/api-key/revoke:
 *   post:
 *     summary: Trek de huidige API-sleutel in
 *     description: Verwijdert de huidige API-toegangssleutel uit de configuratie, waardoor deze onbruikbaar wordt.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bevestiging dat de sleutel is ingetrokken.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminApiResponse'
 */
app.post('/api/admin/api-key/revoke', isAuthenticated, asyncHandler(async (req, res) => {
    await writeEnvFile({ API_ACCESS_TOKEN: '' });
    if (isDebug) console.log('[Admin API] API Access Token has been revoked.');
    res.json({ success: true, message: 'API key has been revoked.' });
}));

/**
 * @swagger
 * /api/admin/logs:
 *   get:
 *     summary: Haal de meest recente applicatielogs op
 *     description: >
 *       Haalt een lijst op van de meest recente log-regels die in het geheugen zijn opgeslagen.
 *       Dit is handig voor het debuggen vanuit het admin-paneel zonder directe servertoegang.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Een array van log-objecten.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/LogEntry'
 */
app.get('/api/admin/logs', isAuthenticated, (req, res) => {
    res.json(logCache);
});

/**
 * @swagger
 * /admin/debug:
 *   get:
 *     summary: Haal debug-informatie op
 *     description: >
 *       Geeft de onbewerkte data terug van alle items in de huidige *gecachte* afspeellijst.
 *       Dit eindpunt is alleen beschikbaar als de debug-modus is ingeschakeld in de .env-file.
 *     tags: [Admin API]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: De onbewerkte data van de afspeellijst.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DebugResponse'
 *       404:
 *         description: Niet gevonden (als de debug-modus is uitgeschakeld).
 */
app.get('/admin/debug', isAuthenticated, asyncHandler(async (req, res) => {
    if (!isDebug) {
        throw new NotFoundError('Debug endpoint is only available when debug mode is enabled.');
    }
    // Use the existing cache to inspect the current state, which is more useful for debugging.
    // Calling getPlaylistMedia() would fetch new data every time, which is not what the note implies.
    const allMedia = playlistCache || [];

    res.json({
        note: "This endpoint returns the raw data for all media items currently in the *cached* playlist. This reflects what the front-end is using.",
        playlist_item_count: allMedia.length,
        playlist_items_raw: allMedia.map(m => m?._raw).filter(Boolean) // Filter out items without raw data
    });
}));

// --- Centralized Error Handling ---
// This should be the last middleware added.
app.use((err, req, res, next) => {
    // Log the error with more context
    if (isDebug) {
        console.error(`[Error Handler] Caught error for ${req.method} ${req.originalUrl}:`, err);
    } else {
        // In production, a more structured log is better
        console.error({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: err.message,
            method: req.method,
            url: req.originalUrl,
            stack: err.stack,
            status: err.statusCode || 500
        });
    }

    // Determine status and message
    const isApiError = err instanceof ApiError;
    const statusCode = isApiError ? err.statusCode : 500;
    const isProd = process.env.NODE_ENV === 'production';

    // For known API errors, we can trust the message. For unknown errors, we hide details in production.
    const message = (isApiError || !isProd) ? err.message : 'Internal Server Error';

    // Avoid sending a response if one has already been sent
    if (res.headersSent) {
        return next(err);
    }

    // Respond with HTML for browser requests, JSON for API requests
    if (req.accepts('html', 'json') === 'html' && !req.path.startsWith('/api/')) {
        res.status(statusCode);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const stackTrace = !isProd ? `<pre>${err.stack || 'No stack trace available'}</pre>` : '';
        // A slightly more user-friendly error page
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>Error ${statusCode}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:2em;background-color:#1a1a1a;color:#e0e0e0}.container{max-width:800px;margin:0 auto;background-color:#2c2c2c;padding:2em;border-radius:8px}h1{color:#dc3545}pre{background-color:#1a1a1a;padding:1em;border-radius:4px;overflow-x:auto}a{color:#7fadf6}</style></head>
            <body><div class="container"><h1>Error ${statusCode}</h1><p>${message}</p><p><a href="javascript:history.back()">Go Back</a> or <a href="/">Go Home</a></p>${stackTrace}</div></body>
            </html>
        `);
    } else {
        // Always respond with JSON for API routes or when JSON is preferred
        res.status(statusCode).json({ error: message });
    }
});

// Start the server only if this script is run directly (e.g., `node server.js`)
// and not when it's imported by another script (like our tests).
if (require.main === module) {
    app.listen(port, async () => {
        console.log(`posterrama.app is running on http://localhost:${port}`);
        if(isDebug) console.log(`Debug endpoint is available at http://localhost:${port}/debug`);

        // Initial cache population on startup
        console.log('Performing initial playlist fetch...');
        await refreshPlaylistCache(); // Wait for the initial fetch to complete.

        if (playlistCache && playlistCache.length > 0) {
            console.log(`Initial playlist fetch complete. ${playlistCache.length} items loaded.`);
        } else {
            console.error('Initial playlist fetch did not populate any media. The application will run but will not display any media until a refresh succeeds. Check server configurations and logs for errors during fetch.');
        }

        const refreshInterval = (config.backgroundRefreshMinutes || 30) * 60 * 1000;
        if (refreshInterval > 0) {
            setInterval(refreshPlaylistCache, refreshInterval);
            console.log(`Playlist will be refreshed in the background every ${config.backgroundRefreshMinutes} minutes.`);
        }
    });

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
                if (isDebug) console.log(`[Site Server Proxy] Forwarding request to: ${targetUrl}`);
                const response = await fetch(targetUrl);

                // Intercept /get-config to add a flag indicating this is the public site.
                // The client-side script can use this flag to show specific elements, like a promo box.
                if (req.originalUrl === '/get-config' && response.ok) {
                    if (isDebug) console.log(`[Site Server Proxy] Modifying response for /get-config`);
                    const originalConfig = await response.json();
                    const modifiedConfig = { ...originalConfig, isPublicSite: true };
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
                console.error(`[Site Server Proxy] Error forwarding request to ${targetUrl}:`, error);
                res.status(502).json({ error: 'Bad Gateway', message: 'The site server could not connect to the main application.' });
            }
        };

        // Define the public API routes that need to be proxied
        siteApp.get('/get-config', proxyApiRequest);
        siteApp.get('/get-media', proxyApiRequest);
        siteApp.get('/get-media-by-key/:key', proxyApiRequest);
        siteApp.get('/image', proxyApiRequest);

        // Serve static files (CSS, JS, etc.) from the 'public' directory
        siteApp.use(express.static(path.join(__dirname, 'public')));

        // A catch-all route to serve the main index.html for any other GET request.
        // This is crucial for single-page applications (SPAs) to handle client-side routing.
        siteApp.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        siteApp.listen(sitePort, () => {
            console.log(`Public site server is enabled and running on http://localhost:${sitePort}`);
        });
    }
}

// Export the app instance so that it can be imported and used by Supertest in our tests.
module.exports = app;