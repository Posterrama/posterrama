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

// Fallback image tracking for monitoring upstream health
const fallbackMetrics = {
    total: 0,
    byReason: {
        serverNotFound: 0,
        plexIncomplete: 0,
        jellyfinIncomplete: 0,
        unsupportedServer: 0,
        httpError: 0,
        networkError: 0,
        cacheError: 0,
    },
    lastFallbacks: [], // Last 20 fallback events with timestamp and reason
};

/**
 * Track fallback image usage for monitoring upstream health
 * @param {string} reason - Reason for fallback (serverNotFound, httpError, etc.)
 * @param {Object} context - Additional context (serverName, status, path, etc.)
 * @param {Object} logger - Logger instance
 */
function trackFallback(reason, context, logger) {
    fallbackMetrics.total++;
    fallbackMetrics.byReason[reason] = (fallbackMetrics.byReason[reason] || 0) + 1;

    const event = {
        timestamp: new Date().toISOString(),
        reason,
        ...context,
    };

    fallbackMetrics.lastFallbacks.unshift(event);
    if (fallbackMetrics.lastFallbacks.length > 20) {
        fallbackMetrics.lastFallbacks.pop();
    }

    logger.debug('[Image Proxy] Fallback served', {
        reason,
        totalFallbacks: fallbackMetrics.total,
        reasonCount: fallbackMetrics.byReason[reason],
        ...context,
    });
}

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
 * @param {Function} deps.getPlexLibraries - Get Plex libraries
 * @param {Function} deps.shuffleArray - Shuffle array utility
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
}) {
    const router = express.Router();

    /**
     * @swagger
     * /get-media:
     *   get:
     *     summary: Retrieve media playlist (legacy)
     *     description: |
     *       **Legacy endpoint** - Use `/api/v1/media` instead.
     *
     *       Returns the aggregated playlist from all configured media sources.
     *       This endpoint is maintained for backwards compatibility.
     *     x-internal: true
     *     tags: ['Legacy API']
     *     x-codeSamples:
     *       - lang: 'curl'
     *         label: 'cURL'
     *         source: |
     *           curl http://localhost:4000/get-media
     *       - lang: 'JavaScript'
     *         label: 'JavaScript (fetch)'
     *         source: |
     *           fetch('http://localhost:4000/get-media')
     *             .then(response => response.json())
     *             .then(data => console.log(data));
     *       - lang: 'Python'
     *         label: 'Python (requests)'
     *         source: |
     *           import requests
     *           response = requests.get('http://localhost:4000/get-media')
     *           media = response.json()
     *     parameters:
     *       - in: query
     *         name: source
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, tmdb, local]
     *         description: Optional source filter to return only items from a specific provider (romm not included in regular playlist)
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
     *         description: 'Set to "1" or "true" to return music albums instead of movies/TV shows. Requires wallartMode.musicMode.enabled=true in config. Returns items with type="music" containing album metadata (artist, album, genres, etc.)'
     *       - in: query
     *         name: gamesOnly
     *         schema:
     *           type: string
     *           enum: ['1', 'true']
     *         description: 'Set to "1" or "true" to return game covers from RomM. Requires wallartMode.gamesOnly=true in config. Returns items with type="game" containing game metadata (platform, etc.)'
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

            // Check if music mode or games mode is requested - handle this BEFORE cache check
            const wallartMode = config?.wallartMode || {};
            const musicMode = wallartMode.musicMode || {};
            const isMusicModeEnabled = musicMode.enabled === true;
            const isMusicModeRequest =
                req.query?.musicMode === '1' || req.query?.musicMode === 'true';
            const isGamesOnlyEnabled = wallartMode.gamesOnly === true;
            const isGamesOnlyRequest =
                req.query?.gamesOnly === '1' || req.query?.gamesOnly === 'true';

            // If games mode is active, fetch and return games instead (bypass regular cache)
            if (isGamesOnlyEnabled && isGamesOnlyRequest) {
                try {
                    // Find enabled RomM server
                    const RommSource = require('../sources/romm');
                    const rommServer = (config.mediaServers || []).find(
                        s => s.enabled && s.type === 'romm'
                    );

                    if (!rommServer) {
                        logger.warn('Games mode requested but no RomM server is configured');
                        return res.json([]);
                    }

                    // Get platform selections from server config
                    const platforms = rommServer.selectedPlatforms || [];
                    if (platforms.length === 0) {
                        logger.warn('Games mode enabled but no platforms selected');
                        return res.json([]);
                    }

                    // Initialize RomM source
                    const rommSource = new RommSource(rommServer, shuffleArray, isDebug);

                    // Fetch games (default to 100, can be overridden by query param)
                    const count = parseInt(req.query?.count) || 100;
                    const ROMM_GAMES_LIMIT = 2000; // Maximum games to fetch

                    logger.info(
                        `[Games Mode] Fetching ${count} games from platforms: ${platforms.join(', ')}`
                    );

                    const games = await rommSource.fetchMedia(
                        platforms,
                        'game',
                        Math.min(count, ROMM_GAMES_LIMIT)
                    );

                    logger.info(`[Games Mode] Returning ${games.length} games`);

                    return res.json(games);
                } catch (err) {
                    logger.error(`[Games Mode] Failed to fetch games: ${err.message}`, {
                        error: err.stack,
                    });
                    // Return empty array on error
                    return res.json([]);
                }
            }

            // If music mode is active, fetch and return music albums instead (bypass regular cache)
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

                    // Initialize Plex source with all required dependencies
                    const plexSource = new PlexSource(
                        plexServer,
                        getPlexClient,
                        processPlexItem,
                        getPlexLibraries,
                        shuffleArray,
                        config.rottenTomatoesMinimumScore || 0,
                        isDebug
                    );

                    // Fetch music albums (default to 50, can be overridden by query param)
                    const count = parseInt(req.query?.count) || 50;

                    logger.info(
                        `[Music Mode] Fetching ${count} albums from libraries: ${musicLibraries.join(', ')}`
                    );

                    const musicAlbums = await plexSource.fetchMusic(
                        musicLibraries,
                        count,
                        musicFilters
                    );

                    logger.info(`[Music Mode] Returning ${musicAlbums.length} music albums`);

                    return res.json(musicAlbums);
                } catch (err) {
                    logger.error(`[Music Mode] Failed to fetch music albums: ${err.message}`, {
                        error: err.stack,
                    });
                    // Return empty array on error
                    return res.json([]);
                }
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
                // Check if refresh has been stuck for too long (over 60 seconds)
                // This threshold MUST be higher than the timeout in playlist-cache.js (45s)
                // Otherwise we get infinite loops: timeout resets at 45s, stuck detection at 20s
                if (refreshStartTime && Date.now() - refreshStartTime > 60000) {
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
     * /get-music-artists:
     *   get:
     *     summary: Get random artists with complete discographies
     *     description: Fetches N random artists and all their albums for artist-cards display mode
     *     tags: ['Public API']
     *     parameters:
     *       - in: query
     *         name: count
     *         schema:
     *           type: integer
     *           minimum: 1
     *           maximum: 200
     *           default: 50
     *         description: Number of random artists to fetch (1-200, default 50)
     *     responses:
     *       200:
     *         description: Array of albums from random artists
     */
    router.get(
        '/get-music-artists',
        asyncHandler(async (req, res) => {
            const artistCount = parseInt(req.query.count) || 50;

            try {
                const mediaServers = Array.isArray(config.mediaServers) ? config.mediaServers : [];
                const plexServers = mediaServers.filter(
                    s => s.type === 'plex' && s.enabled === true
                );

                if (plexServers.length === 0) {
                    return res.json([]);
                }

                const allAlbums = [];

                for (const serverConfig of plexServers) {
                    try {
                        const plex = await getPlexClient(serverConfig);
                        const sectionsResponse = await plex.query('/library/sections');
                        const allSections = sectionsResponse?.MediaContainer?.Directory || [];
                        const musicSections = allSections.filter(s => s.type === 'artist');

                        for (const section of musicSections) {
                            // Get all artists (type=8 for artists in Plex)
                            const artistsResponse = await plex.query(
                                `/library/sections/${section.key}/all?type=8`
                            );
                            const artists = artistsResponse?.MediaContainer?.Metadata || [];

                            // Shuffle and limit to requested count
                            const selectedArtists = artists
                                .sort(() => Math.random() - 0.5)
                                .slice(0, artistCount);

                            logger.info(
                                `[Music Artists] Selected ${selectedArtists.length} random artists from ${section.title}`
                            );

                            // For each artist, fetch all albums
                            for (const artist of selectedArtists) {
                                try {
                                    // Fetch full artist metadata (the /all endpoint doesn't include all fields)
                                    // Remove /children from artist.key to get the artist metadata endpoint
                                    const artistMetadataPath = artist.key.replace(
                                        /\/children$/,
                                        ''
                                    );
                                    const fullArtistResponse = await plex.query(artistMetadataPath);
                                    const fullArtist =
                                        fullArtistResponse?.MediaContainer?.Metadata?.[0] || artist;

                                    // Debug: log artist thumb to verify it's correct
                                    if (fullArtist.title === 'Metallica') {
                                        logger.debug(
                                            `[Music Artists] Metallica thumb: ${fullArtist.thumb}`,
                                            {
                                                key: fullArtist.key,
                                                ratingKey: fullArtist.ratingKey,
                                            }
                                        );
                                    }

                                    // Fetch albums for this artist (type=9 for albums in Plex)
                                    // artist.key already includes /children (e.g., /library/metadata/{artistId}/children)
                                    const albumsResponse = await plex.query(`${artist.key}?type=9`);
                                    const albums = albumsResponse?.MediaContainer?.Metadata || [];

                                    // Add artist info to each album for grouping
                                    albums.forEach(album => {
                                        album.artistName = fullArtist.title;
                                        // Use 'art' field for artist photo (background art), fallback to 'thumb'
                                        album.artistThumb = fullArtist.art || fullArtist.thumb;
                                    });

                                    // Extract artist genres and styles from full metadata
                                    const artistGenres =
                                        fullArtist.Genre?.map(g => g.tag).filter(Boolean) || [];
                                    const artistStyles =
                                        fullArtist.Style?.map(s => s.tag).filter(Boolean) || [];

                                    // Process each album
                                    const processedAlbums = await Promise.all(
                                        albums.map(async album => {
                                            const processed = await processPlexItem(
                                                album,
                                                serverConfig,
                                                plex
                                            );
                                            if (processed) {
                                                // Add artist metadata
                                                processed.artist = fullArtist.title;

                                                // Add genres and styles from artist
                                                if (artistGenres.length > 0) {
                                                    processed.artistGenres = artistGenres;
                                                }
                                                if (artistStyles.length > 0) {
                                                    processed.artistStyles = artistStyles;
                                                }

                                                // Extract path from artist photo (prefer 'art' over 'thumb')
                                                const artistThumbPath =
                                                    fullArtist.art || fullArtist.thumb;
                                                if (artistThumbPath) {
                                                    let thumbPath = artistThumbPath;
                                                    // If it's a full URL, extract just the path part
                                                    if (thumbPath.startsWith('http')) {
                                                        try {
                                                            const url = new URL(thumbPath);
                                                            thumbPath = url.pathname + url.search;
                                                        } catch (e) {
                                                            // If parsing fails, use as-is
                                                        }
                                                    }
                                                    processed.artistPhoto = `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(thumbPath)}`;
                                                } else {
                                                    processed.artistPhoto = null;
                                                }
                                            }
                                            return processed;
                                        })
                                    );

                                    // Filter out null/undefined results before adding
                                    const validAlbums = processedAlbums.filter(
                                        album => album != null
                                    );
                                    allAlbums.push(...validAlbums);
                                } catch (err) {
                                    logger.warn(
                                        `[Music Artists] Error fetching albums for artist ${artist.title}: ${err.message}`
                                    );
                                }
                            }
                        }
                    } catch (err) {
                        logger.error(
                            `[Music Artists] Error fetching from ${serverConfig.name}: ${err.message}`
                        );
                    }
                }

                logger.info(
                    `[Music Artists] Returning ${allAlbums.length} albums from ${artistCount} artists`
                );
                res.json(allAlbums);
            } catch (err) {
                logger.error(`[Music Artists] Failed: ${err.message}`, err.stack);
                res.json([]);
            }
        })
    );

    /**
     * @swagger
     * /get-media-by-key/{key}:
     *   get:
     *     summary: Retrieve a single media item by key (legacy)
     *     description: |
     *       **Legacy endpoint** - Use `/api/v1/media/{key}` instead.
     *
     *       Fetches the full details for a specific media item.
     *       This endpoint is maintained for backwards compatibility.
     *     x-internal: true
     *     tags: ['Legacy API']
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
     *       400:
     *         description: Invalid key format
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/StandardErrorResponse'
     *             example:
     *               error: 'Invalid media key format'
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
     *           maxLength: 256
     *         description: The name of the server config from config.json (for Plex-style paths). Required if using path parameter.
     *       - in: query
     *         name: path
     *         schema:
     *           type: string
     *           maxLength: 1024
     *         description: The image path from the media item object (e.g., /library/metadata/12345/art/...). Required if using server parameter.
     *       - in: query
     *         name: url
     *         schema:
     *           type: string
     *           format: uri
     *           maxLength: 2048
     *         description: Direct URL to proxy (for Jellyfin and external images). Alternative to server+path parameters.
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
                res.setHeader('X-Cache', 'HIT');
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
                    logger.error('[Image Proxy] Server configuration not found', {
                        serverName,
                        requestPath: req.path,
                        requestId: req.id,
                    });
                    trackFallback('serverNotFound', { serverName, path: imagePath }, logger);
                    return res.redirect('/fallback-poster.png');
                }

                if (serverConfig.type === 'plex') {
                    const token = process.env[serverConfig.tokenEnvVar];
                    if (!token || !serverConfig.hostname || !serverConfig.port) {
                        logger.error('[Image Proxy] Plex connection details incomplete', {
                            serverName,
                            tokenEnvVar: serverConfig.tokenEnvVar,
                            hasToken: !!token,
                            hasHostname: !!serverConfig.hostname,
                            hasPort: !!serverConfig.port,
                            requestId: req.id,
                        });
                        trackFallback('plexIncomplete', { serverName, path: imagePath }, logger);
                        return res.redirect('/fallback-poster.png');
                    }
                    imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}`;
                    fetchOptions.headers['X-Plex-Token'] = token;
                } else if (serverConfig.type === 'jellyfin') {
                    const token = process.env[serverConfig.tokenEnvVar];
                    if (!token || !serverConfig.hostname || !serverConfig.port) {
                        logger.error('[Image Proxy] Jellyfin connection details incomplete', {
                            serverName,
                            tokenEnvVar: serverConfig.tokenEnvVar,
                            hasToken: !!token,
                            hasHostname: !!serverConfig.hostname,
                            hasPort: !!serverConfig.port,
                            requestId: req.id,
                        });
                        trackFallback(
                            'jellyfinIncomplete',
                            { serverName, path: imagePath },
                            logger
                        );
                        return res.redirect('/fallback-poster.png');
                    }
                    imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}`;
                    fetchOptions.headers['X-Emby-Token'] = token;
                } else {
                    logger.error('[Image Proxy] Unsupported server type', {
                        serverType: serverConfig.type,
                        serverName,
                        requestId: req.id,
                    });
                    trackFallback(
                        'unsupportedServer',
                        { serverName, serverType: serverConfig.type, path: imagePath },
                        logger
                    );
                    return res.redirect('/fallback-poster.png');
                }
            }

            if (isDebug) logger.debug(`[Image Proxy] Fetching from origin URL: ${imageUrl}`);

            try {
                const mediaServerResponse = await fetch(imageUrl, fetchOptions);

                if (!mediaServerResponse.ok) {
                    logger.warn('[Image Proxy] Request failed', {
                        status: mediaServerResponse.status,
                        serverName: serverName || 'direct',
                        path: imagePath,
                        directUrl: directUrl ? '[redacted]' : undefined,
                        requestId: req.id,
                    });
                    trackFallback(
                        'httpError',
                        {
                            serverName: serverName || 'direct',
                            status: mediaServerResponse.status,
                            path: imagePath,
                        },
                        logger
                    );
                    return res.redirect('/fallback-poster.png');
                }

                // Set headers on the client response
                res.setHeader('Cache-Control', 'public, max-age=86400'); // 86400 seconds = 24 hours
                res.setHeader('X-Cache', 'MISS');
                const contentType = mediaServerResponse.headers.get('content-type');
                res.setHeader('Content-Type', contentType || 'image/jpeg');

                // 3. Pipe the response to both the client and the cache file
                // Use PassThrough to tee the stream to multiple destinations without buffering
                const passthrough = new PassThrough();
                mediaServerResponse.body.pipe(passthrough);

                const fileStream = fs.createWriteStream(cachedFilePath);
                passthrough.pipe(fileStream);
                passthrough.pipe(res);

                // Handle stream errors gracefully
                fileStream.on('error', err => {
                    logger.warn('[Image Cache] Failed to write cache file', {
                        path: cachedFilePath,
                        error: err.message,
                    });
                    // Don't interrupt the response stream to client
                });

                passthrough.on('error', err => {
                    logger.error('[Image Proxy] Passthrough stream error', {
                        error: err.message,
                        imagePath,
                    });
                });

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
                    logger.error('[Image Cache] Failed to write to cache file', {
                        cachedFilePath,
                        error: err.message,
                        requestId: req.id,
                    });
                    // If caching fails, the user still gets the image, so we just log the error.
                    // We should also clean up the potentially partial file.
                    fsp.unlink(cachedFilePath).catch(unlinkErr => {
                        logger.error('[Image Cache] Failed to clean up partial cache file', {
                            cachedFilePath,
                            error: unlinkErr.message,
                            requestId: req.id,
                        });
                    });
                });
            } catch (error) {
                logger.error('[Image Proxy] Network or fetch error', {
                    serverName: serverName || 'direct',
                    path: imagePath,
                    errorName: error.name,
                    errorMessage: error.message,
                    cause: error.cause,
                    isAbortError: error.name === 'AbortError',
                    isConnectionReset: error.message.startsWith('read ECONNRESET'),
                    requestId: req.id,
                });
                trackFallback(
                    'networkError',
                    {
                        serverName: serverName || 'direct',
                        errorName: error.name,
                        errorMessage: error.message,
                        path: imagePath,
                    },
                    logger
                );
                res.redirect('/fallback-poster.png');
            }
        })
    );

    // Metrics endpoint for monitoring image proxy fallback health
    router.get('/api/media/fallback-metrics', (req, res) => {
        res.json({
            success: true,
            metrics: {
                total: fallbackMetrics.total,
                byReason: fallbackMetrics.byReason,
                recentEvents: fallbackMetrics.lastFallbacks.slice(0, 10),
            },
            timestamp: new Date().toISOString(),
        });
    });

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
