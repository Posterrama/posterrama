/**
 * Media Routes
 * Handles media listing, detail retrieval, and image proxying
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');

// Import enrichment functions for extras support
const { enrichPlexItemWithExtras } = require('../lib/plex-helpers');
const { enrichJellyfinItemWithExtras } = require('../lib/jellyfin-helpers');

/**
 * Enrich media items with extras (trailers, theme music) on-demand.
 * Only enriches Plex and Jellyfin items.
 *
 * @param {Array} items - Media items from playlist cache
 * @param {Object} config - Application configuration
 * @param {Object} logger - Logger instance
 * @param {boolean} isDebug - Debug mode flag
 * @returns {Promise<Array>} Enriched items
 */
async function enrichItemsWithExtras(items, config, logger, isDebug) {
    if (!Array.isArray(items) || items.length === 0) {
        return items;
    }

    // Group items by server to batch API calls efficiently
    const plexItems = [];
    const jellyfinItems = [];
    const otherItems = [];

    items.forEach(item => {
        const source = (item.source || item.serverType || '').toString().toLowerCase();
        const key = (item.key || '').toString().toLowerCase();

        if (source === 'plex' || key.startsWith('plex-')) {
            plexItems.push(item);
        } else if (source === 'jellyfin' || key.startsWith('jellyfin_')) {
            jellyfinItems.push(item);
        } else {
            // TMDB, local, and other sources don't have extras
            otherItems.push(item);
        }
    });

    // Enrich Plex items in parallel (with reasonable concurrency)
    const enrichedPlex = await Promise.all(
        plexItems.map(async item => {
            try {
                // Extract server name from key (format: plex-ServerName-12345)
                const keyParts = item.key.split('-');
                if (keyParts.length < 3) return item;

                const serverName = keyParts.slice(1, -1).join('-');
                const serverConfig = config.mediaServers?.find(
                    s => s.name === serverName && s.type === 'plex' && s.enabled
                );

                if (!serverConfig) return item;

                return await enrichPlexItemWithExtras(item, serverConfig, null, isDebug);
            } catch (err) {
                if (isDebug)
                    logger.debug(
                        `[enrichItemsWithExtras] Error enriching Plex item: ${err.message}`
                    );
                return item;
            }
        })
    );

    // Enrich Jellyfin items in parallel
    const enrichedJellyfin = await Promise.all(
        jellyfinItems.map(async item => {
            try {
                // Extract server name from key (format: jellyfin_ServerName_abc123)
                const keyParts = item.key.split('_');
                if (keyParts.length < 3) return item;

                const serverName = keyParts.slice(1, -1).join('_');
                const serverConfig = config.mediaServers?.find(
                    s => s.name === serverName && s.type === 'jellyfin' && s.enabled
                );

                if (!serverConfig) return item;

                return await enrichJellyfinItemWithExtras(item, serverConfig, null);
            } catch (err) {
                if (isDebug)
                    logger.debug(
                        `[enrichItemsWithExtras] Error enriching Jellyfin item: ${err.message}`
                    );
                return item;
            }
        })
    );

    // Combine all enriched items (maintaining original order)
    const enrichedMap = new Map();
    [...enrichedPlex, ...enrichedJellyfin].forEach(item => {
        enrichedMap.set(item.key, item);
    });

    return items.map(item => enrichedMap.get(item.key) || item);
}

/**
 * Create media router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Object} deps.config - Application configuration
 * @param {Object} deps.logger - Logger instance
 * @param {boolean} deps.isDebug - Debug mode flag
 * @param {Object} deps.fsp - File system promises API
 * @param {Function} deps.fetch - Fetch function for HTTP requests
 * @param {Function} deps.ApiError - API error class
 * @param {Function} deps.NotFoundError - Not found error class
 * @param {Function} deps.asyncHandler - Async error handler wrapper
 * @param {Function} deps.getPlexClient - Get Plex client instance
 * @param {Function} deps.processPlexItem - Process Plex media item
 * @param {Function} deps.getPlaylistCache - Get playlist cache
 * @param {Function} deps.isPlaylistRefreshing - Check if playlist is refreshing
 * @param {Function} deps.getRefreshStartTime - Get refresh start timestamp
 * @param {Function} deps.resetRefreshState - Reset refresh state
 * @param {Function} deps.refreshPlaylistCache - Trigger playlist refresh
 * @param {Function} deps.readConfig - Read configuration
 * @param {Object} deps.cacheDiskManager - Cache disk manager
 * @param {Function} deps.validateGetMediaQuery - Validate get-media query parameters
 * @param {Function} deps.validateMediaKeyParam - Validate media key parameter
 * @param {Function} deps.validateImageQuery - Validate image query parameters
 * @param {Object} deps.apiCacheMiddleware - API cache middleware
 * @param {Function} deps.cacheMiddleware - Generic cache middleware factory
 * @returns {express.Router} Configured router
 */
module.exports = function createMediaRouter({
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
}) {
    const router = express.Router();

    /**
     * @swagger
     * /get-media:
     *   get:
     *     summary: Retrieve media playlist
     *     description: Returns the aggregated playlist from all configured media sources (Plex, Jellyfin, TMDB, RomM). Cached for performance. Optionally includes extras (trailers, theme music) when includeExtras=true.
     *     tags: ['Public API']
     *     parameters:
     *       - in: query
     *         name: source
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, tmdb, local, romm]
     *         description: Optional source filter to return only items from a specific provider
     *       - in: query
     *         name: nocache
     *         schema:
     *           type: string
     *           enum: ['1']
     *         description: Set to '1' to bypass cache (admin use)
     *       - in: query
     *         name: includeExtras
     *         schema:
     *           type: boolean
     *         description: When true, enriches items with trailers and theme music URLs (Plex/Jellyfin only). Note that this adds latency to the request as it fetches additional metadata per item.
     *     responses:
     *       200:
     *         description: Playlist of media items. When includeExtras=true, items include extras array with trailers, trailer object (first trailer for convenience), theme path, and themeUrl for streaming.
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
     *       503:
     *         description: Service unavailable. Playlist fetch failed.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ApiMessage'
     */
    router.get(
        '/get-media',
        validateGetMediaQuery,
        apiCacheMiddleware.media,
        asyncHandler(async (req, res) => {
            // Helper: apply optional source filter to cached playlist
            const applySourceFilter = (items, src) => {
                if (!src || !Array.isArray(items)) return items;
                const norm = String(src).toLowerCase();
                return items.filter(it => {
                    const s = (it.source || it.serverType || '').toString().toLowerCase();
                    const key = (it.key || '').toString().toLowerCase();
                    if (norm === 'plex') return s === 'plex' || key.startsWith('plex-');
                    if (norm === 'jellyfin') return s === 'jellyfin' || key.startsWith('jellyfin_');
                    if (norm === 'romm') return s === 'romm' || key.startsWith('romm_');
                    if (norm === 'tmdb') {
                        // Include classic TMDB plus streaming-provider items fetched via TMDB
                        return s === 'tmdb' || key.startsWith('tmdb-') || !!it.tmdbId;
                    }
                    if (norm === 'local') {
                        // Include local directory items
                        return s === 'local' || key.startsWith('local-');
                    }
                    return s === norm;
                });
            };
            // Skip caching if nocache param is present (for admin invalidation)
            if (req.query.nocache === '1') {
                res.setHeader('Cache-Control', 'no-store');
            }

            // If the cache is not null, it means the initial fetch has completed (even if it found no items).
            // An empty array is a valid state if no servers are configured or no media is found.
            const { cache: playlistCache } = getPlaylistCache();
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

                // Check if music mode is enabled for wallart
                const wallartMode = config?.wallartMode || {};
                const musicMode = wallartMode.musicMode || {};
                const isMusicModeEnabled = musicMode.enabled === true;
                const isMusicModeRequest =
                    req.query?.musicMode === '1' || req.query?.musicMode === 'true';

                // If music mode is active, fetch and return music albums instead
                if (isMusicModeEnabled && isMusicModeRequest) {
                    try {
                        // Find enabled Plex server
                        const PlexSource = require('../sources/plex');
                        const plexServer = (config.mediaServers || []).find(
                            s => s.enabled && s.type === 'plex'
                        );

                        if (!plexServer) {
                            logger.warn('Music mode requested but no Plex server is configured');
                            return res.json([]);
                        }

                        // Get music library names from server config
                        const musicLibraries = plexServer.musicLibraryNames || [];
                        if (musicLibraries.length === 0) {
                            logger.warn('Music mode enabled but no music libraries configured');
                            return res.json([]);
                        }

                        // Get music filters from server config
                        const musicFilters = plexServer.musicFilters || {};

                        // Initialize Plex source
                        const plexSource = new PlexSource(plexServer);

                        // Fetch music albums (default to 50, can be overridden by query param)
                        const count = parseInt(req.query?.count) || 50;
                        const musicAlbums = await plexSource.fetchMusic(
                            musicLibraries,
                            count,
                            musicFilters
                        );

                        if (isDebug) {
                            logger.debug(
                                `[Music Mode] Fetched ${musicAlbums.length} music albums from Plex`
                            );
                        }

                        return res.json(musicAlbums);
                    } catch (err) {
                        logger.error(`Failed to fetch music albums: ${err.message}`, {
                            error: err.stack,
                        });
                        // Fall through to regular media on error
                    }
                }

                // Apply optional filtering by source
                let filtered = applySourceFilter(playlistCache, req.query?.source);

                // Exclude games if requested (for screensaver/cinema modes)
                if (
                    req.query?.excludeGames === '1' ||
                    req.query?.excludeGames === 'true' ||
                    req.query?.excludeGames === true
                ) {
                    filtered = filtered.filter(item => {
                        const itemType = (item.type || '').toLowerCase();
                        const source = (item.source || item.serverType || '').toLowerCase();
                        // Filter out games (type=game or source=romm)
                        return itemType !== 'game' && source !== 'romm';
                    });
                }

                // Enrich items with extras if requested
                if (req.query?.includeExtras === true) {
                    filtered = await enrichItemsWithExtras(filtered, config, logger, isDebug);
                }

                return res.json(filtered);
            }

            const isRefreshing = isPlaylistRefreshing();
            const refreshStartTime = getRefreshStartTime();
            if (isRefreshing) {
                // Check if refresh has been stuck for too long (over 20 seconds)
                if (refreshStartTime && Date.now() - refreshStartTime > 20000) {
                    logger.warn('Detected stuck refresh state - forcing reset', {
                        action: 'stuck_refresh_reset',
                        stuckDuration: `${Date.now() - refreshStartTime}ms`,
                    });
                    resetRefreshState();

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
    router.get(
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
            // Be defensive: handle missing or non-array mediaServers gracefully
            const mediaServers = Array.isArray(config.mediaServers) ? config.mediaServers : [];
            const serverConfig = mediaServers.find(
                s => s.name === serverName && s.type === type && s.enabled === true
            );

            if (!serverConfig) {
                throw new NotFoundError('Server configuration not found for this item.');
            }

            let mediaItem = null;
            if (type === 'plex') {
                const plex = await getPlexClient(serverConfig);
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
    router.get(
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
            const imageCacheDir = path.join(process.cwd(), 'image_cache');
            const { server: serverName, path: imagePath, url: directUrl } = req.query;

            if (isDebug) {
                logger.debug(
                    `[Image Proxy] Request: ${directUrl ? `URL: "${directUrl}"` : `Server: "${serverName}", Path: "${imagePath}"`}`
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
                    if (!token || !serverConfig.hostname || !serverConfig.port) {
                        console.error(
                            `[Image Proxy] Plex connection details incomplete for server "${serverName}". Ensure hostname/port in config.json and token env var ${serverConfig.tokenEnvVar}.`
                        );
                        return res.redirect('/fallback-poster.png');
                    }
                    imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}`;
                    fetchOptions.headers['X-Plex-Token'] = token;
                } else if (serverConfig.type === 'jellyfin') {
                    const token = process.env[serverConfig.tokenEnvVar];
                    if (!token || !serverConfig.hostname || !serverConfig.port) {
                        console.error(
                            `[Image Proxy] Jellyfin connection details incomplete for server "${serverName}". Ensure hostname/port in config.json and token env var ${serverConfig.tokenEnvVar}.`
                        );
                        return res.redirect('/fallback-poster.png');
                    }
                    imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}`;
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
                    const identifier = directUrl
                        ? `URL "${directUrl}"`
                        : `Server "${serverName}", Path "${imagePath}"`;
                    console.warn(
                        `[Image Proxy] Request failed (${mediaServerResponse.status}): ${identifier}`
                    );
                    const fallbackInfo = directUrl || imagePath;
                    console.warn(`[Image Proxy] Serving fallback image for "${fallbackInfo}".`);
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
                        // Ensure disk manager reflects the latest on-disk settings before cleanup
                        try {
                            if (
                                cacheDiskManager &&
                                typeof cacheDiskManager.updateConfig === 'function'
                            ) {
                                cacheDiskManager.updateConfig(config.cache || {});
                            }
                        } catch (e) {
                            logger.warn('Failed to refresh cache config before cleanup', {
                                error: e?.message,
                            });
                        }
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
                const fallbackInfo = directUrl || imagePath;
                console.warn(`[Image Proxy] Serving fallback image for "${fallbackInfo}".`);
                res.redirect('/fallback-poster.png');
            }
        })
    );

    // Lightweight fallback image to prevent broken redirects from the image proxy
    // Always available even if no static asset is present on disk.
    router.get('/fallback-poster.png', (req, res) => {
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2b2b2b"/>
            <stop offset="100%" stop-color="#1a1a1a"/>
        </linearGradient>
    </defs>
    <rect width="600" height="900" fill="url(#g)"/>
    <g fill="#555">
        <rect x="110" y="160" width="380" height="570" rx="8" fill="#000" opacity="0.15"/>
        <circle cx="300" cy="360" r="90" stroke="#777" stroke-width="10" fill="none"/>
        <rect x="200" y="550" width="200" height="16" rx="8"/>
    </g>
    <text x="50%" y="780" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#888">
        Poster unavailable
    </text>
    <text x="50%" y="820" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#666">
        Source did not return an image
    </text>
    <metadata>posterrama-fallback</metadata>
    <desc>Fallback placeholder image used when the origin server returns an error or is unreachable.</desc>
    <title>Poster unavailable</title>
</svg>`;
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type('image/svg+xml').send(svg);
    });

    return router;
};
