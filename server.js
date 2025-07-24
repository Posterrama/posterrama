/**
 * posterrama.app - Server-side logic for multiple media sources
 *
 * Author: Mark Frelink
 * Last Modified: 2024-08-02
 * License: AGPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const PlexAPI = require('plex-api');
const fetch = require('node-fetch');
const config = require('./config.json');
const pkg = require('./package.json');
const { shuffleArray } = require('./utils.js');

const app = express();
const { ApiError, NotFoundError } = require('./errors.js');

// Use process.env with a fallback to config.json
const port = process.env.SERVER_PORT || config.serverPort || 4000;
const isDebug = process.env.DEBUG === 'true';

if (isDebug) console.log('--- DEBUG MODE IS ACTIVE ---');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // For parsing form data

// Session middleware setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'please-set-a-strong-secret-in-your-env-file',
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
 * Caches PlexAPI clients to avoid re-instantiating for every request.
 * @type {Object.<string, PlexAPI>}
 */
const plexClients = {};
function getPlexClient(serverConfig) {
    if (!plexClients[serverConfig.name]) {
        const token = process.env[serverConfig.tokenEnvVar];
        if (!token) {
            throw new ApiError(500, `[${serverConfig.name}] FATAL: Token environment variable "${serverConfig.tokenEnvVar}" is not set.`);
        }
        plexClients[serverConfig.name] = new PlexAPI({
            hostname: process.env[serverConfig.hostnameEnvVar],
            port: process.env[serverConfig.portEnvVar],
            token: token,
        });
    }
    return plexClients[serverConfig.name];
}

const jellyfinClients = {};
let Jellyfin; // Will be loaded dynamically

async function getJellyfinClient(serverConfig) {
    if (!Jellyfin) {
        // Dynamically import the ESM module
        const sdk = await import('@jellyfin/sdk');
        Jellyfin = sdk.Jellyfin;
    }

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

    for (const name of libraryNames) {
        const library = libraries.get(name);
        if (library && library.type === type) {
            try {
                const content = await plex.query(`/library/sections/${library.key}/all`);
                if (content?.MediaContainer?.Metadata) {
                    allSummaries = allSummaries.concat(content.MediaContainer.Metadata);
                }
            } catch (e) {
                console.error(`[${serverConfig.name}] Error fetching media from library "${name}": ${e.message}`);
            }
        }
    }
    const randomSummaries = shuffleArray(allSummaries).slice(0, count);

    const mediaItemPromises = randomSummaries.map(itemSummary => processPlexItem(itemSummary, serverConfig, plex));
    const settledItems = await Promise.all(mediaItemPromises);
    return settledItems.filter(item => item !== null);
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

    await fs.writeFile('.env', newLines.join('\n'), 'utf-8');
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
    // Remove metadata before writing
    delete newConfig._metadata;
    await fs.writeFile('./config.json', JSON.stringify(newConfig, null, 2), 'utf-8');
    // Update the in-memory config for the current running instance
    Object.assign(config, newConfig);
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
app.get('/get-config', (req, res) => {
    res.json({
        clockWidget: config.clockWidget !== false,
        recentlyAddedSidebar: config.recentlyAddedSidebar === true,
        transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
        backgroundRefreshMinutes: config.backgroundRefreshMinutes || 30,
        showClearLogo: config.showClearLogo !== false,
        kenBurnsEffect: config.kenBurnsEffect || { enabled: true, durationSeconds: 20 }
    });
});

app.get('/get-media', asyncHandler(async (req, res) => {
    if (!playlistCache || playlistCache.length === 0) {
        // Fallback for when cache is empty (e.g., initial fetch failed)
        if (isDebug) console.log('[Debug] Cache is empty, attempting a blocking refresh.');
        await refreshPlaylistCache();
    }

    if (playlistCache && playlistCache.length > 0) {
        if (isDebug) console.log(`[Debug] Serving ${playlistCache.length} items from cache.`);
        // The playlistCache is already shuffled during the background refresh.
        // Shuffling on every request is inefficient and unnecessary, as it creates a new
        // array and shuffles it for every single client request.
        // We now send the pre-shuffled cache directly for a significant performance boost.
        res.json(playlistCache);
    } else {
        res.status(503).json({ error: "Media playlist is currently unavailable. Please try again later." });
    }
}));

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
    if (isAdminSetup()) {
        return res.status(403).send('Admin user is already configured.');
    }
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('Username and password are required.');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const sessionSecret = require('crypto').randomBytes(32).toString('hex');

    await writeEnvFile({
        ADMIN_USERNAME: username,
        ADMIN_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: sessionSecret
    });

    res.redirect('/admin/login');
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
    const isValidUser = (username === process.env.ADMIN_USERNAME);
    const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

    if (isValidUser && isValidPassword) {
        req.session.user = { username: process.env.ADMIN_USERNAME };
        res.redirect('/admin');
    } else {
        res.status(401).send('Invalid credentials. <a href="/admin/login">Try again</a>.');
    }
}));

app.get('/admin/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/admin/login');
    });
});

app.get('/api/admin/config', isAuthenticated, asyncHandler(async (req, res) => {
    const currentConfig = await readConfig();
    res.json({
        config: currentConfig,
        env: { SERVER_PORT: process.env.SERVER_PORT, DEBUG: process.env.DEBUG }
    });
}));

if (isDebug){
    app.get('/debug', asyncHandler(async (req, res) => {
        const allMedia = await getPlaylistMedia();
        res.json({ allMedia: allMedia.map(m => m?._raw) });
    }));
}

// --- Centralized Error Handling ---
// This should be the last middleware added.
app.use((err, req, res, next) => {
    // In debug mode, log the full error. In production, a shorter log might be better.
    console.error(err);

    const statusCode = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';

    // For client errors (4xx), we can expose the message. For server errors (5xx), we hide details in production.
    const message = (statusCode < 500 || !isProd) ? err.message : 'Internal Server Error';

    // Respond with HTML for browser requests, JSON for API requests
    if (req.accepts('html', 'json') === 'html') {
        res.status(statusCode);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const stackTrace = !isProd ? `<pre>${err.stack || 'No stack trace available'}</pre>` : '';
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Error ${statusCode}</title><style>body{font-family:sans-serif;padding:2em}pre{background-color:#f0f0f0;padding:1em}</style></head>
            <body>
                <h1>Error ${statusCode}</h1>
                <p>${message}</p>
                ${stackTrace}
            </body>
            </html>
        `);
    } else {
        res.status(statusCode).json({ error: message });
    }
});

app.listen(port, async () => {
    console.log(`posterrama.app is running on http://localhost:${port}`);
    if(isDebug) console.log(`Debug endpoint is available at http://localhost:${port}/debug`);

    // Initial cache population on startup
    console.log('Performing initial playlist fetch...');
    await refreshPlaylistCache();
    if (playlistCache) {
        console.log(`Initial playlist fetch complete. ${playlistCache.length} items loaded.`);
    } else {
        console.error('Initial playlist fetch failed. The application will start, but no media will be available until a refresh succeeds.');
    }

    const refreshInterval = (config.backgroundRefreshMinutes || 30) * 60 * 1000;
    if (refreshInterval > 0) {
        setInterval(refreshPlaylistCache, refreshInterval);
        console.log(`Playlist will be refreshed in the background every ${config.backgroundRefreshMinutes} minutes.`);
    }
});