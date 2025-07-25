/**
 * posterrama.app - Server-side logic for multiple media sources
 *
 * Author: Mark Frelink
 * Last Modified: 2024-08-02
 * License: GPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const { exec } = require('child_process');
const PlexAPI = require('plex-api');
const fetch = require('node-fetch');
const config = require('./config.json');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger.js');
const pkg = require('./package.json');
const ecosystemConfig = require('./ecosystem.config.js');
const qrcode = require('qrcode');
const { shuffleArray } = require('./utils.js');

const speakeasy = require('speakeasy');
const app = express();
const { ApiError, NotFoundError } = require('./errors.js');
const { Jellyfin } = require('@jellyfin/sdk');

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

/**
 * Processes a Jellyfin media item and transforms it into the application's standard format.
 * @param {object} item - The media item object from the Jellyfin API.
 * @param {object} serverConfig - The configuration for the Jellyfin server.
 * @returns {object|null} A processed media item object or null if processing fails.
 */
function processJellyfinItem(item, serverConfig) {
    if (!item || !item.Id || !item.Name) return null;

    const serverUrl = process.env[serverConfig.urlEnvVar];

    // Construct image URLs. Jellyfin requires the server URL.
    const getImageUrl = (type, imageTag) => {
        if (!imageTag) return null;
        // We only store the path; the proxy will prepend the server URL and add auth.
        return `/Items/${item.Id}/Images/${type}?tag=${imageTag}`;
    };

    const backgroundArt = getImageUrl('Backdrop', item.BackdropImageTags?.[0]);
    const posterArt = getImageUrl('Primary', item.ImageTags?.Primary);

    if (!backgroundArt || !posterArt) {
        if (isDebug) console.log(`[Jellyfin Debug] Skipping item "${item.Name}" due to missing primary or background image.`);
        return null;
    }

    const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${item.Id}`;

    // For shows, the main item doesn't have a tagline, but we can still display it.
    const tagline = item.Taglines && item.Taglines.length > 0 ? item.Taglines[0] : null;

    return {
        key: uniqueKey,
        title: item.Name,
        backgroundUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(backgroundArt)}`,
        posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(posterArt)}`,
        clearLogoUrl: item.ImageTags?.Logo ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(getImageUrl('Logo', item.ImageTags.Logo))}` : null,
        tagline: tagline,
        rating: item.CommunityRating,
        year: item.ProductionYear,
        imdbUrl: item.ProviderIds?.Imdb ? `https://www.imdb.com/title/${item.ProviderIds.Imdb}/` : null,
        _raw: isDebug ? item : undefined
    };
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

const jellyfinClients = {};

async function getJellyfinClient(serverConfig) {
    if (!jellyfinClients[serverConfig.name]) {
        const serverUrl = process.env[serverConfig.urlEnvVar];
        const apiKey = process.env[serverConfig.apiKeyEnvVar];

        if (!serverUrl || !apiKey) {
            throw new ApiError(500, `[${serverConfig.name}] FATAL: Jellyfin URL or API Key is not set.`);
        }

        // Initialize the main Jellyfin class
        const jellyfin = new Jellyfin({
            clientInfo: { name: 'posterrama.app', version: pkg.version },
            deviceInfo: { name: 'Posterrama Server', id: 'posterrama-server-node' }
        });

        // The newer SDK versions require creating an API instance for a specific server,
        // and then setting the authentication token on it.
        const api = jellyfin.createApi(serverUrl);
        api.setAccessToken(apiKey);
        jellyfinClients[serverConfig.name] = api;
    }
    return jellyfinClients[serverConfig.name];
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

async function fetchPlexMedia(serverConfig, libraryNames, type, count) {
    const plex = getPlexClient(serverConfig);
    const libraries = await getPlexLibraries(serverConfig);
    let allSummaries = [];

    // We might need to fetch more items to have enough after filtering.
    // A multiplier of 3 is a reasonable heuristic.
    const fetchMultiplier = 3;
    const itemsToFetch = count * fetchMultiplier;

    for (const name of libraryNames) {
        const library = libraries.get(name);
        if (library && library.type === type) {
            try {
                // Fetch a larger number of items to ensure we have enough after filtering.
                const content = await plex.query(`/library/sections/${library.key}/all?X-Plex-Container-Size=${itemsToFetch}`);
                if (content?.MediaContainer?.Metadata) {
                    allSummaries = allSummaries.concat(content.MediaContainer.Metadata);
                }
            } catch (e) {
                console.error(`[${serverConfig.name}] Error fetching media from library "${name}": ${e.message}`);
            }
        }
    }
    const randomSummaries = shuffleArray(allSummaries);

    const mediaItemPromises = randomSummaries.map(itemSummary => processPlexItem(itemSummary, serverConfig, plex));
    const allProcessedItems = (await Promise.all(mediaItemPromises)).filter(item => item !== null);

    const parsedScore = parseFloat(config.rottenTomatoesMinimumScore);
    const minScore = isNaN(parsedScore) ? 0 : parsedScore;
    const filteredItems = allProcessedItems.filter(item => {
        if (minScore === 0) return true; // No filter applied
        // The originalScore is on the 0-10 scale, which matches our config setting.
        return item.rottenTomatoes && item.rottenTomatoes.originalScore >= minScore;
    });

    // Return the desired count from the filtered list.
    return filteredItems.slice(0, count);
}

async function fetchJellyfinMedia(serverConfig, libraryNames, type, count) {
    const jellyfin = await getJellyfinClient(serverConfig);
    const userId = process.env[serverConfig.userIdEnvVar];
    if (!userId) throw new ApiError(500, `[${serverConfig.name}] User ID is not configured.`);

    const { data: views } = await jellyfin.getViews(userId);
    let allItems = [];

    const itemType = type === 'movie' ? 'Movie' : 'Series';

    for (const name of libraryNames) {
        const library = views.Items.find(v => v.Name === name);
        if (library) {
            try {
                const { data: content } = await jellyfin.getItems(userId, {
                    parentId: library.Id,
                    includeItemTypes: itemType,
                    recursive: true,
                    fields: 'Taglines,CommunityRating,ProductionYear,ProviderIds,ImageTags,BackdropImageTags'
                });
                if (content.Items) {
                    allItems = allItems.concat(content.Items);
                }
            } catch (e) {
                console.error(`[${serverConfig.name}] Error fetching media from Jellyfin library "${name}": ${e.message}`);
            }
        }
    }

    const randomItems = shuffleArray(allItems).slice(0, count);
    return randomItems.map(item => processJellyfinItem(item, serverConfig)).filter(item => item !== null);
}

async function fetchPlexRecentlyAdded(serverConfig) {
    const plex = getPlexClient(serverConfig);
    const libraries = await getPlexLibraries(serverConfig);
    const libraryNames = [
        ...(serverConfig.movieLibraryNames || []),
        ...(serverConfig.showLibraryNames || [])
    ];

    let recentItemsRaw = [];

    for (const name of libraryNames) {
        const library = libraries.get(name);
        if (library) {
            try {
                const content = await plex.query(`/library/sections/${library.key}/recentlyAdded?X-Plex-Container-Size=15`);
                if (content?.MediaContainer?.Metadata) {
                    recentItemsRaw = recentItemsRaw.concat(content.MediaContainer.Metadata);
                }
            } catch (e) {
                console.error(`[${serverConfig.name}] Error fetching recently added from library "${name}": ${e.message}`);
            }
        }
    }

    return recentItemsRaw.map(item => {
        const isShow = item.type === 'episode' || item.type === 'season';
        const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${item.ratingKey}`;
        return {
            key: uniqueKey,
            addedAt: item.addedAt,
            title: isShow ? item.grandparentTitle : item.title,
            subtitle: isShow ? `S${item.parentIndex} E${item.index} - ${item.title}` : `${item.year}`,
            posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(isShow ? item.grandparentThumb : item.thumb)}`,
        };
    });
}

async function fetchJellyfinRecentlyAdded(serverConfig) {
    const jellyfin = await getJellyfinClient(serverConfig);
    const userId = process.env[serverConfig.userIdEnvVar];
    if (!userId) return [];

    try {
        const { data: recentItems } = await jellyfin.getLatestMedia(userId, {
            limit: 15,
            fields: 'ParentId,ProductionYear,ImageTags'
        });

        return recentItems.map(item => {
            const isShow = item.Type === 'Episode';
            const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${item.Id}`;
            return {
                key: uniqueKey,
                addedAt: new Date(item.DateCreated).getTime() / 1000,
                title: isShow ? item.SeriesName : item.Name,
                subtitle: isShow ? `S${item.ParentIndexNumber} E${item.IndexNumber} - ${item.Name}` : `${item.ProductionYear}`,
                posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(`/Items/${isShow ? item.SeriesId : item.Id}/Images/Primary?tag=${isShow ? item.SeriesPrimaryImageTag : item.ImageTags.Primary}`)}`,
            };
        });
    } catch (e) {
        console.error(`[${serverConfig.name}] Error fetching recently added from Jellyfin: ${e.message}`);
        return [];
    }
}


// --- Main Data Aggregation ---

async function getPlaylistMedia() {
    let allMedia = [];
    const enabledServers = config.mediaServers.filter(s => s.enabled);

    for (const server of enabledServers) {
        if (isDebug) console.log(`[Debug] Fetching from server: ${server.name} (${server.type})`);
        
        let mediaFromServer = [];
        if (server.type === 'plex') {
            const [movies, shows] = await Promise.all([
                fetchPlexMedia(server, server.movieLibraryNames || [], 'movie', server.movieCount || 0),
                fetchPlexMedia(server, server.showLibraryNames || [], 'show', server.showCount || 0)
            ]);
            mediaFromServer = movies.concat(shows);
        } else if (server.type === 'jellyfin') {
            const [movies, shows] = await Promise.all([
                fetchJellyfinMedia(server, server.movieLibraryNames || [], 'movie', server.movieCount || 0),
                fetchJellyfinMedia(server, server.showLibraryNames || [], 'show', server.showCount || 0)
            ]);
            mediaFromServer = movies.concat(shows);
        }

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

let recentlyAddedCache = null;
let recentlyAddedCacheTimestamp = 0;


// --- Admin Panel Logic ---

/**
 * Middleware to check if the user is authenticated.
 */
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/admin/login');
    }
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
        recentlyAddedSidebar: config.recentlyAddedSidebar === true,
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

    if (playlistCache && playlistCache.length > 0) {
        if (isDebug) console.log(`[Debug] Serving ${playlistCache.length} items from cache.`);
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
 * /get-recently-added:
 *   get:
 *     summary: Retrieve recently added media items
 *     description: Fetches a short, sorted list of the most recently added items from all enabled media servers.
 *     tags: [Public API]
 *     responses:
 *       200:
 *         description: An array of recently added media items.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 */
app.get('/get-recently-added', asyncHandler(async (req, res) => {
    if (config.recentlyAddedSidebar !== true) {
        return res.json([]);
    }

    const cacheTtl = (config.recentlyAddedCacheMinutes || 5) * 60 * 1000;
    if (recentlyAddedCache && (Date.now() - recentlyAddedCacheTimestamp < cacheTtl)) {
        if (isDebug) console.log(`[Debug] Serving ${recentlyAddedCache.length} recently added items from cache.`);
        return res.json(recentlyAddedCache);
    }

    if (isDebug) console.log('[Debug] Recently added cache is stale or empty, fetching fresh data.');
    const enabledServers = config.mediaServers.filter(s => s.enabled);
    let allRecent = [];

    for (const server of enabledServers) {
        if (server.type === 'plex') {
            const recent = await fetchPlexRecentlyAdded(server);
            allRecent = allRecent.concat(recent);
        } else if (server.type === 'jellyfin') {
            const recent = await fetchJellyfinRecentlyAdded(server);
            allRecent = allRecent.concat(recent);
        }
    }

    const combined = allRecent
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 5);

    recentlyAddedCache = combined;
    recentlyAddedCacheTimestamp = Date.now();

    res.json(recentlyAddedCache);
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
    } else if (type === 'jellyfin') {
        const jellyfin = await getJellyfinClient(serverConfig);
        const { data: item } = await jellyfin.getItem(process.env[serverConfig.userIdEnvVar], originalKey);
        mediaItem = processJellyfinItem(item, serverConfig);
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
        imageUrl = `http://${hostname}:${port}${imagePath}?X-Plex-Token=${token}`;
        if (isDebug) console.log(`[Image Proxy] Fetching from Plex URL: http://${hostname}:${port}${imagePath}`);
    } else if (serverConfig.type === 'jellyfin') {
        const serverUrl = process.env[serverConfig.urlEnvVar];
        const apiKey = process.env[serverConfig.apiKeyEnvVar];
        if (!serverUrl || !apiKey) {
            console.error(`[Image Proxy] Jellyfin URL or API key not configured for server "${serverName}".`);
            return res.redirect('/fallback-poster.png');
        }
        imageUrl = `${serverUrl}${imagePath}`;
        fetchOptions.headers['Authorization'] = `MediaBrowser Token="${apiKey}"`;
        if (isDebug) console.log(`[Image Proxy] Fetching from Jellyfin URL: ${imageUrl}`);
    } else {
        console.error(`[Image Proxy] Unsupported server type "${serverConfig.type}" for server "${serverName}".`);
        return res.redirect('/fallback-poster.png');
    }

    try {
        const mediaServerResponse = await fetch(imageUrl, fetchOptions);

        if (!mediaServerResponse.ok) {
            console.warn(`[Image Proxy] Media server "${serverName}" returned status ${mediaServerResponse.status} for path "${imagePath}".`);
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
    
    // Write credentials directly to .env file, without forcing 2FA on setup.
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
        throw new ApiError(401, 'Invalid 2FA code. <a href="/admin/2fa-verify">Try again</a>.');
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

app.get('/api/admin/2fa/status', isAuthenticated, (req, res) => {
    const secret = process.env.ADMIN_2FA_SECRET || '';
    const isEnabled = secret.trim() !== '';
    res.json({ enabled: isEnabled });
});

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

app.post('/api/admin/2fa/disable', isAuthenticated, express.json(), asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!password) throw new ApiError(400, 'Password is required to disable 2FA.');
    const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!isValidPassword) throw new ApiError(401, 'Incorrect password.');
    await writeEnvFile({ ADMIN_2FA_SECRET: '' });
    if (isDebug) console.log(`[Admin 2FA] 2FA disabled successfully for user "${req.session.user.username}".`);
    res.json({ success: true, message: '2FA disabled successfully.' });
}));

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
        env: envVarsToExpose
    });
}))

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
    recentlyAddedCache = null;
    Object.keys(plexClients).forEach(key => delete plexClients[key]);
    Object.keys(jellyfinClients).forEach(key => delete jellyfinClients[key]);

    // Trigger a background refresh of the playlist with the new settings.
    // We don't await this, so the admin UI gets a fast response.
    refreshPlaylistCache();

    if (isDebug) {
        console.log('[Admin] Configuration saved successfully. Caches and clients have been cleared. Triggered background playlist refresh.');
    }

    res.json({ message: 'Configuration saved successfully. Some changes may require an application restart.' });
}));

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