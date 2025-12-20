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
const { getJellyfinClient, processJellyfinItem } = require('../lib/jellyfin-helpers');

// Metrics tracking
const metricsManager = require('../utils/metrics');

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

    // Also track in central metricsManager for KPI dashboard
    if (metricsManager.recordFallbackUsage) {
        metricsManager.recordFallbackUsage(reason, context?.mediaId || null);
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
 * @param {import('express').RequestHandler} deps.isAuthenticated - Authentication middleware
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
    isAuthenticated,
    getPlexClient,
    processPlexItem,
    getPlexLibraries,
    shuffleArray,
    getPlaylistCache,
    isPlaylistRefreshing,
    readConfig,
    cacheDiskManager,
    validateGetMediaQuery,
    validateMediaKeyParam,
    validateImageQuery,
    apiCacheMiddleware,
}) {
    const router = express.Router();

    // --- Admin preview utilities (authenticated) ---
    // Allows the admin live preview iframe to fetch media according to UNSAVED settings.
    // This is intentionally separate from /get-media (public) which is gated by saved config.

    /**
     * @swagger
     * /api/admin/media/preview:
     *   post:
     *     summary: Preview media for admin UI
     *     description: Returns a preview list of media items based on unsaved admin settings (used by the admin preview iframe).
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               count:
     *                 type: integer
     *                 minimum: 1
     *                 maximum: 2000
     *               type:
     *                 type: string
     *                 description: Media type (e.g. movie)
     *               musicMode:
     *                 type: boolean
     *               filmCards:
     *                 type: boolean
     *               gamesOnly:
     *                 type: boolean
     *               wallartMode:
     *                 type: object
     *                 description: Partial wallartMode override used for preview
     *           example:
     *             count: 200
     *             type: movie
     *             musicMode: false
     *             filmCards: false
     *             gamesOnly: false
     *     responses:
     *       200:
     *         description: Preview items (may be empty)
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *             example:
     *               - key: plex-MyPlex-12345
     *                 title: "Example Movie"
     *                 year: 2024
     *                 type: movie
     *                 source: plex
     *                 posterUrl: "/image?url=https%3A%2F%2Fexample.com%2Fposter.jpg"
     */
    router.post(
        '/api/admin/media/preview',
        // @ts-ignore - Express router overload with middleware
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const body = req.body || {};
            const wallartModeOverride = body.wallartMode || {};

            // Clamp count to a safe range; default is aligned with wallart bootstrap.
            const countRaw = Number(body.count);
            const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(2000, countRaw)) : 200;

            const requestedType = (body.type || 'movie').toString();
            const requestMusicMode = body.musicMode === true || body.musicMode === '1';
            const requestFilmCards = body.filmCards === true || body.filmCards === '1';
            const requestGamesOnly = body.gamesOnly === true || body.gamesOnly === '1';

            // Read latest saved config for server connections/credentials.
            const currentConfig =
                (await (typeof readConfig === 'function' ? readConfig() : null)) || config || {};

            // Compute an effective wallartMode for preview. We only need a shallow merge here.
            const effectiveWallartMode = {
                ...(currentConfig.wallartMode || {}),
                ...(wallartModeOverride || {}),
                musicMode: {
                    ...(currentConfig.wallartMode?.musicMode || {}),
                    ...(wallartModeOverride.musicMode || {}),
                },
                layoutSettings: {
                    ...(currentConfig.wallartMode?.layoutSettings || {}),
                    ...(wallartModeOverride.layoutSettings || {}),
                    filmCards: {
                        ...(currentConfig.wallartMode?.layoutSettings?.filmCards || {}),
                        ...(wallartModeOverride.layoutSettings?.filmCards || {}),
                    },
                },
            };

            // Lazy-load PlexSource once
            let PlexSource = null;
            const getPlexSource = () => {
                if (!PlexSource) PlexSource = require('../sources/plex');
                return PlexSource;
            };

            // Games-only preview (RomM)
            if (requestGamesOnly || effectiveWallartMode.gamesOnly === true) {
                try {
                    const RommSource = require('../sources/romm');
                    const rommServer = (currentConfig.mediaServers || []).find(
                        s => s.enabled && s.type === 'romm'
                    );
                    if (!rommServer) return res.json([]);
                    const platforms = rommServer.selectedPlatforms || [];
                    if (!platforms.length) return res.json([]);

                    const rommSource = new RommSource(rommServer, shuffleArray, isDebug);
                    const ROMM_GAMES_LIMIT = 2000;
                    const games = await rommSource.fetchMedia(
                        platforms,
                        'game',
                        Math.min(count || 2000, ROMM_GAMES_LIMIT)
                    );
                    return res.json(games);
                } catch (err) {
                    logger.error(`[Admin Preview] Games fetch failed: ${err.message}`, {
                        error: err.stack,
                    });
                    return res.json([]);
                }
            }

            // Music mode preview (Plex)
            if (requestMusicMode && effectiveWallartMode.musicMode?.enabled === true) {
                try {
                    const PlexSourceClass = getPlexSource();
                    const plexServer = (currentConfig.mediaServers || []).find(
                        s => s.enabled && s.type === 'plex'
                    );
                    if (!plexServer) return res.json([]);

                    const musicLibraries = plexServer.musicLibraryNames || [];
                    const musicFilters = plexServer.musicFilters || {};

                    const plexSource = new PlexSourceClass(
                        plexServer,
                        getPlexClient,
                        processPlexItem,
                        getPlexLibraries,
                        shuffleArray,
                        currentConfig.rottenTomatoesMinimumScore || 0,
                        isDebug
                    );

                    const albums = await plexSource.fetchMusic(
                        musicLibraries,
                        count || 50,
                        musicFilters
                    );
                    return res.json(albums);
                } catch (err) {
                    logger.error(`[Admin Preview] Music fetch failed: ${err.message}`, {
                        error: err.stack,
                    });
                    return res.json([]);
                }
            }

            // Film Cards preview requests more movies (Plex)
            if (requestFilmCards || effectiveWallartMode.layoutVariant === 'filmCards') {
                try {
                    const PlexSourceClass = getPlexSource();
                    const plexServer = (currentConfig.mediaServers || []).find(
                        s => s.enabled && s.type === 'plex'
                    );
                    if (!plexServer) return res.json([]);

                    const movieLibraries =
                        plexServer.movieLibraryNames || plexServer.libraryNames || [];
                    if (!movieLibraries.length) return res.json([]);

                    const plexSource = new PlexSourceClass(
                        plexServer,
                        getPlexClient,
                        processPlexItem,
                        getPlexLibraries,
                        shuffleArray,
                        currentConfig.rottenTomatoesMinimumScore || 0,
                        isDebug
                    );

                    const movies = await plexSource.fetchMedia(
                        movieLibraries,
                        String(requestedType || 'movie'),
                        Math.max(1, Math.min(2000, count || 1000))
                    );
                    return res.json(movies);
                } catch (err) {
                    logger.error(`[Admin Preview] FilmCards fetch failed: ${err.message}`, {
                        error: err.stack,
                    });
                    return res.json([]);
                }
            }

            // Default: for non-special preview cases, fall back to public endpoint behavior.
            // The wallart preview bootstrap will typically use /get-media directly for this.
            return res.json([]);
        })
    );

    // --- Admin utilities (authenticated) ---
    // Search against the current playlist cache (fast; avoids per-server search APIs).

    /**
     * @swagger
     * /api/admin/media/search:
     *   get:
     *     summary: Search media for admin UI
     *     description: Searches the current playlist cache and (optionally) enabled servers to help find items for pinning and preview.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: q
     *         schema:
     *           type: string
     *         required: true
     *         description: Search query (min 2 characters)
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [movie, series, all]
     *         description: Filter by type
     *       - in: query
     *         name: source
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, tmdb, romm, any]
     *         description: Filter by source
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           minimum: 1
     *           maximum: 50
     *         description: Max results
     *     responses:
     *       200:
     *         description: Search results
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 results:
     *                   type: array
     *                   items:
     *                     type: object
     *             example:
     *               results:
     *                 - key: plex-MyPlex-12345
     *                   title: "Example Movie"
     *                   year: 2024
     *                   type: movie
     *                   source: plex
     *                   posterUrl: "/image?url=https%3A%2F%2Fexample.com%2Fposter.jpg"
     */
    router.get(
        '/api/admin/media/search',
        // @ts-ignore - Express router overload with middleware
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const q = (req.query.q || '').toString().trim();
            const type = (req.query.type || '').toString().trim().toLowerCase(); // movie|series|all
            const source = (req.query.source || '').toString().trim().toLowerCase(); // plex|jellyfin|tmdb|romm|any
            const limitRaw = Number(req.query.limit);
            const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 25;

            if (!q || q.length < 2) {
                return res.json({ results: [] });
            }

            const cacheEntry = getPlaylistCache?.();
            const items = Array.isArray(cacheEntry?.cache) ? cacheEntry.cache : [];
            const qLower = q.toLowerCase();

            function inferSource(item) {
                const s = (item?.source || item?.serverType || '').toString().toLowerCase();
                if (s === 'plex' || s === 'jellyfin' || s === 'tmdb' || s === 'romm') return s;
                const k = (item?.key || '').toString().toLowerCase();
                if (k.startsWith('plex-')) return 'plex';
                if (k.startsWith('jellyfin_')) return 'jellyfin';
                if (k.startsWith('tmdb_movie_') || k.startsWith('tmdb_tv_')) return 'tmdb';
                if (k.startsWith('romm_')) return 'romm';
                return s || 'unknown';
            }

            function inferType(item) {
                const t = (item?.type || item?.mediaType || item?.itemType || '').toString();
                const tl = t.toLowerCase();
                if (!tl) return '';
                if (tl === 'movie') return 'movie';
                if (tl === 'show' || tl === 'series' || tl === 'tv') return 'series';
                return tl;
            }

            const results = [];
            const seenKeys = new Set();
            for (const item of items) {
                const title = (item?.title || item?.name || '').toString();
                if (!title) continue;

                const sourceName = inferSource(item);
                if (source && source !== 'any' && sourceName !== source) continue;

                const itemType = inferType(item);
                if (type && type !== 'all') {
                    if (type === 'movie' && itemType !== 'movie') continue;
                    if (type === 'series' && itemType !== 'series') continue;
                }

                if (title.toLowerCase().includes(qLower)) {
                    const key = (item?.key || '').toString();
                    if (key) {
                        if (seenKeys.has(key)) continue;
                        seenKeys.add(key);
                    }
                    results.push({
                        key: item?.key,
                        title,
                        year: item?.year || item?.releaseYear || null,
                        type: itemType || null,
                        source: sourceName,
                        posterUrl: item?.posterUrl || item?.poster_path || null,
                        backdropUrl: item?.backdropUrl || item?.backdrop_path || null,
                    });
                    if (results.length >= limit) break;
                }
            }

            // Deep-search enabled servers for better UX (e.g. pin poster needs full library search).
            // We keep the playlist-cache results first for quick relevance.
            if (results.length < limit) {
                const remaining = limit - results.length;
                const currentConfig =
                    (await (typeof readConfig === 'function' ? readConfig() : null)) ||
                    config ||
                    {};
                const mediaServers = Array.isArray(currentConfig.mediaServers)
                    ? currentConfig.mediaServers
                    : [];

                const wantPlex = !source || source === 'any' || source === 'plex';
                const wantJellyfin = !source || source === 'any' || source === 'jellyfin';
                const wantTmdb = !source || source === 'any' || source === 'tmdb';
                const wantRomm = !source || source === 'any' || source === 'romm';

                const wantMovie = !type || type === 'all' || type === 'movie';
                const wantSeries = !type || type === 'all' || type === 'series';

                if (wantPlex) {
                    const plexServers = mediaServers.filter(
                        s => s && s.type === 'plex' && s.enabled === true
                    );

                    for (const serverConfig of plexServers) {
                        if (results.length >= limit) break;
                        try {
                            const plex = await getPlexClient(serverConfig);
                            const targetSize = Math.max(10, Math.min(50, remaining * 3));
                            const qEnc = encodeURIComponent(q);

                            const plexItems = [];

                            const addFromResponse = resp => {
                                const container = resp?.MediaContainer || {};
                                const hubs = Array.isArray(container.Hub) ? container.Hub : [];
                                const direct = Array.isArray(container.Metadata)
                                    ? container.Metadata
                                    : [];

                                for (const h of hubs) {
                                    const metas = Array.isArray(h?.Metadata) ? h.Metadata : [];
                                    plexItems.push(...metas);
                                }
                                plexItems.push(...direct);
                            };

                            if (wantTmdb && results.length < limit) {
                                const apiKey =
                                    currentConfig?.tmdb?.apiKey ||
                                    currentConfig?.tmdbSource?.apiKey ||
                                    process.env.TMDB_API_KEY ||
                                    null;
                                if (apiKey) {
                                    try {
                                        const targetSize = Math.max(
                                            10,
                                            Math.min(50, remaining * 3)
                                        );
                                        const url = `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(
                                            apiKey
                                        )}&query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`;
                                        const resp = await fetch(url);
                                        const json = await resp.json().catch(() => null);
                                        if (resp.ok && Array.isArray(json?.results)) {
                                            for (const r of json.results) {
                                                if (results.length >= limit) break;
                                                const mt = (r?.media_type || '')
                                                    .toString()
                                                    .toLowerCase();
                                                if (mt !== 'movie' && mt !== 'tv') continue;
                                                const mappedType =
                                                    mt === 'movie' ? 'movie' : 'series';
                                                if (mappedType === 'movie' && !wantMovie) continue;
                                                if (mappedType === 'series' && !wantSeries)
                                                    continue;

                                                const id = r?.id;
                                                if (!id) continue;
                                                const key =
                                                    mt === 'movie'
                                                        ? `tmdb_movie_${id}`
                                                        : `tmdb_tv_${id}`;
                                                if (seenKeys.has(key)) continue;
                                                seenKeys.add(key);

                                                const title = (
                                                    r?.title ||
                                                    r?.name ||
                                                    ''
                                                ).toString();
                                                if (!title) continue;
                                                const yearStr = (
                                                    r?.release_date ||
                                                    r?.first_air_date ||
                                                    ''
                                                ).toString();
                                                const year = /^\d{4}/.test(yearStr)
                                                    ? Number(yearStr.slice(0, 4))
                                                    : null;

                                                const posterPath = r?.poster_path
                                                    ? String(r.poster_path)
                                                    : null;
                                                const posterAbs = posterPath
                                                    ? `https://image.tmdb.org/t/p/w342${posterPath}`
                                                    : null;
                                                const posterUrl = posterAbs
                                                    ? `/image?url=${encodeURIComponent(posterAbs)}`
                                                    : null;

                                                const backdropPath = r?.backdrop_path
                                                    ? String(r.backdrop_path)
                                                    : null;
                                                const backdropAbs = backdropPath
                                                    ? `https://image.tmdb.org/t/p/w780${backdropPath}`
                                                    : null;
                                                const backdropUrl = backdropAbs
                                                    ? `/image?url=${encodeURIComponent(backdropAbs)}`
                                                    : null;

                                                results.push({
                                                    key,
                                                    title,
                                                    year,
                                                    type: mappedType,
                                                    source: 'tmdb',
                                                    posterUrl,
                                                    backdropUrl,
                                                });
                                                if (results.length >= targetSize) break;
                                            }
                                        }
                                    } catch (_) {
                                        // Best-effort: ignore TMDB search failures
                                    }
                                }
                            }

                            if (wantRomm && results.length < limit) {
                                try {
                                    const { shuffleArray } = require('../utils/array-utils');
                                    const RommSource = require('../sources/romm');
                                    const rommServers = mediaServers.filter(
                                        s => s && s.type === 'romm' && s.enabled === true
                                    );
                                    const targetSize = Math.max(10, Math.min(50, remaining * 3));

                                    for (const serverConfig of rommServers) {
                                        if (results.length >= limit) break;
                                        try {
                                            const rommSource = new RommSource(
                                                serverConfig,
                                                shuffleArray,
                                                isDebug
                                            );
                                            const client = await rommSource.getClient();

                                            const wanted = targetSize;
                                            const selectedPlatforms = Array.isArray(
                                                serverConfig.selectedPlatforms
                                            )
                                                ? serverConfig.selectedPlatforms
                                                : [];

                                            const batches = [];
                                            if (selectedPlatforms.length) {
                                                for (const platformId of selectedPlatforms) {
                                                    batches.push(
                                                        client.getRoms({
                                                            platform_id: platformId,
                                                            search_term: q,
                                                            limit: Math.min(50, wanted),
                                                            offset: 0,
                                                        })
                                                    );
                                                    if (batches.length >= 3) break;
                                                }
                                            } else {
                                                batches.push(
                                                    client.getRoms({
                                                        search_term: q,
                                                        limit: Math.min(50, wanted),
                                                        offset: 0,
                                                    })
                                                );
                                            }

                                            for (const p of batches) {
                                                if (results.length >= limit) break;
                                                const payload = await p;
                                                const roms = Array.isArray(payload?.results)
                                                    ? payload.results
                                                    : Array.isArray(payload)
                                                      ? payload
                                                      : [];
                                                for (const rom of roms) {
                                                    if (results.length >= limit) break;
                                                    const romId = rom?.id;
                                                    if (!romId) continue;
                                                    const key = `romm_${serverConfig.name}_${romId}`;
                                                    if (seenKeys.has(key)) continue;
                                                    seenKeys.add(key);
                                                    const title = (
                                                        rom?.name ||
                                                        rom?.fs_name_no_ext ||
                                                        ''
                                                    ).toString();
                                                    if (!title) continue;
                                                    const posterAbs = rom?.url_cover
                                                        ? String(rom.url_cover)
                                                        : null;
                                                    const posterUrl = posterAbs
                                                        ? `/image?url=${encodeURIComponent(posterAbs)}`
                                                        : null;
                                                    const y = rom?.metadatum?.first_release_date
                                                        ? new Date(
                                                              Number(
                                                                  rom.metadatum.first_release_date
                                                              ) * 1000
                                                          ).getFullYear()
                                                        : null;

                                                    results.push({
                                                        key,
                                                        title,
                                                        year: Number.isFinite(Number(y))
                                                            ? Number(y)
                                                            : null,
                                                        type: 'game',
                                                        source: 'romm',
                                                        posterUrl,
                                                    });
                                                }
                                            }
                                        } catch (_) {
                                            // Ignore this RomM server
                                        }
                                    }
                                } catch (_) {
                                    // Best-effort: ignore RomM search failures
                                }
                            }

                            // Prefer /search which is typically more complete than /hubs/search.
                            try {
                                const resp = await plex.query(
                                    `/search?query=${qEnc}&X-Plex-Container-Start=0&X-Plex-Container-Size=${targetSize}`
                                );
                                addFromResponse(resp);
                            } catch (_) {
                                /* fallback below */
                            }

                            // Fallback/augment with hubs/search for servers that restrict /search.
                            try {
                                const resp = await plex.query(
                                    `/hubs/search?query=${qEnc}&X-Plex-Container-Start=0&X-Plex-Container-Size=${targetSize}`
                                );
                                addFromResponse(resp);
                            } catch (_) {
                                /* ignore */
                            }

                            for (const meta of plexItems) {
                                if (results.length >= limit) break;

                                const tl = (meta?.type || '').toString().toLowerCase();
                                const mappedType =
                                    tl === 'movie'
                                        ? 'movie'
                                        : tl === 'show' || tl === 'series' || tl === 'tv'
                                          ? 'series'
                                          : '';
                                if (!mappedType) continue;
                                if (mappedType === 'movie' && !wantMovie) continue;
                                if (mappedType === 'series' && !wantSeries) continue;

                                let ratingKeyStr = meta?.ratingKey ? String(meta.ratingKey) : '';
                                if (!ratingKeyStr) {
                                    const keyPath = meta?.key ? String(meta.key) : '';
                                    const m = keyPath.match(/(\d+)(?:\/?$)/);
                                    if (m) ratingKeyStr = m[1];
                                }
                                if (!ratingKeyStr || !/^\d+$/.test(ratingKeyStr)) continue;

                                const compositeKey = `plex-${serverConfig.name}-${ratingKeyStr}`;
                                if (seenKeys.has(compositeKey)) continue;
                                seenKeys.add(compositeKey);

                                const titleStr = (meta?.title || '').toString().trim();
                                if (!titleStr) continue;

                                const thumb = meta?.thumb ? String(meta.thumb) : '';
                                const art = meta?.art ? String(meta.art) : '';

                                results.push({
                                    key: compositeKey,
                                    title: titleStr,
                                    year: meta?.year || null,
                                    type: mappedType,
                                    source: 'plex',
                                    posterUrl: thumb
                                        ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(thumb)}`
                                        : null,
                                    backdropUrl: art
                                        ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(art)}`
                                        : null,
                                });
                            }
                        } catch (e) {
                            logger.warn('[Admin Search] Plex search failed', {
                                server: serverConfig?.name,
                                error: e?.message || String(e),
                            });
                        }
                    }
                }

                if (wantJellyfin && results.length < limit) {
                    const jfServers = mediaServers.filter(
                        s => s && s.type === 'jellyfin' && s.enabled === true
                    );

                    for (const serverConfig of jfServers) {
                        if (results.length >= limit) break;
                        try {
                            const client = await getJellyfinClient(serverConfig);
                            const include = [];
                            if (wantMovie) include.push('Movie');
                            if (wantSeries) include.push('Series');
                            if (include.length === 0) include.push('Movie', 'Series');

                            const jfItems = await client.searchItems(q, include);
                            for (const item of jfItems) {
                                if (results.length >= limit) break;
                                const id = item?.Id ? String(item.Id) : '';
                                const name = (item?.Name || '').toString().trim();
                                if (!id || !name) continue;

                                const compositeKey = `jellyfin_${serverConfig.name}_${id}`;
                                if (seenKeys.has(compositeKey)) continue;
                                seenKeys.add(compositeKey);

                                const mappedType =
                                    item?.Type === 'Movie'
                                        ? 'movie'
                                        : item?.Type === 'Series'
                                          ? 'series'
                                          : '';
                                if (!mappedType) continue;
                                if (mappedType === 'movie' && !wantMovie) continue;
                                if (mappedType === 'series' && !wantSeries) continue;

                                let posterUrl = null;
                                try {
                                    if (item?.ImageTags?.Primary) {
                                        const primaryUrl = client.getImageUrl(id, 'Primary');
                                        posterUrl = `/image?url=${encodeURIComponent(primaryUrl)}`;
                                    }
                                } catch (_) {
                                    posterUrl = null;
                                }
                                const backdropUrl = (() => {
                                    try {
                                        const hasBackdrop =
                                            !!item?.ImageTags?.Backdrop ||
                                            (Array.isArray(item?.BackdropImageTags) &&
                                                item.BackdropImageTags.length > 0);
                                        if (!hasBackdrop) return null;
                                        const backdrop = client.getImageUrl(id, 'Backdrop');
                                        return `/image?url=${encodeURIComponent(backdrop)}`;
                                    } catch (_) {
                                        return null;
                                    }
                                })();

                                results.push({
                                    key: compositeKey,
                                    title: name,
                                    year: item?.ProductionYear || null,
                                    type: mappedType,
                                    source: 'jellyfin',
                                    posterUrl,
                                    backdropUrl,
                                });
                            }
                        } catch (e) {
                            logger.warn('[Admin Search] Jellyfin search failed', {
                                server: serverConfig?.name,
                                error: e?.message || String(e),
                            });
                        }
                    }
                }
            }

            res.json({ results });
        })
    );

    // Public utilities
    // Lookup a single item in the current playlist cache by exact key.

    /**
     * @swagger
     * /api/media/lookup:
     *   get:
     *     summary: Lookup media item by key
     *     description: Looks up a single media item by exact key from the current playlist cache, with a best-effort upstream fallback.
     *     tags: ['Public API']
     *     security: []
     *     parameters:
     *       - in: query
     *         name: key
     *         schema:
     *           type: string
     *         required: true
     *         description: Composite media key (e.g. plex-ServerName-12345 or jellyfin_ServerName_ItemId)
     *     responses:
     *       200:
     *         description: Lookup result
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 result:
     *                   nullable: true
     *                   oneOf:
     *                     - type: object
     *                     - type: 'null'
     *             example:
     *               result:
     *                 key: plex-MyPlex-12345
     *                 title: "Example Movie"
     *                 year: 2024
     *                 type: movie
     */
    router.get(
        '/api/media/lookup',
        asyncHandler(async (req, res) => {
            const key = (req.query.key || '').toString().trim();
            if (!key) return res.json({ result: null });
            if (key.length > 512) {
                // @ts-ignore - ApiError is constructable
                throw new ApiError(400, 'Invalid key');
            }

            const cacheEntry = getPlaylistCache?.();
            const items = Array.isArray(cacheEntry?.cache) ? cacheEntry.cache : [];
            const found = items.find(it => (it?.key || '').toString() === key) || null;

            if (!found) {
                // Fallback: resolve by key directly from upstream server.
                // This enables pinning items that are not currently in the playlist cache.
                const currentConfig =
                    (await (typeof readConfig === 'function' ? readConfig() : null)) ||
                    config ||
                    {};
                const mediaServers = Array.isArray(currentConfig.mediaServers)
                    ? currentConfig.mediaServers
                    : [];

                // Plex composite key: plex-ServerName-12345 (server name may contain hyphens)
                if (key.startsWith('plex-')) {
                    const parts = key.split('-');
                    if (parts.length >= 3) {
                        const ratingKey = parts[parts.length - 1];
                        const serverName = parts.slice(1, -1).join('-');

                        const serverConfig = mediaServers.find(
                            s =>
                                s &&
                                s.type === 'plex' &&
                                s.enabled === true &&
                                String(s.name) === serverName
                        );

                        if (serverConfig && ratingKey && /^\d+$/.test(String(ratingKey))) {
                            try {
                                const plex = await getPlexClient(serverConfig);
                                const metaResp = await plex.query(
                                    `/library/metadata/${encodeURIComponent(String(ratingKey))}`
                                );
                                const meta = metaResp?.MediaContainer?.Metadata?.[0] || null;
                                if (meta) {
                                    const processed =
                                        (await processPlexItem(meta, serverConfig, plex)) || null;
                                    if (processed) {
                                        processed.key = key;
                                        return res.json({ result: processed });
                                    }
                                }
                            } catch (e) {
                                logger.warn('[Media Lookup] Plex fallback failed', {
                                    server: serverName,
                                    ratingKey,
                                    error: e?.message || String(e),
                                });
                            }
                        }
                    }
                }

                // Jellyfin composite key: jellyfin_<ServerName>_<ItemId> or jellyfin_<ItemId>
                if (key.startsWith('jellyfin_')) {
                    const parts = key.split('_');
                    if (parts.length >= 2) {
                        const itemId = parts[parts.length - 1];
                        const serverName = parts.length >= 3 ? parts.slice(1, -1).join('_') : '';

                        const serverConfig = serverName
                            ? mediaServers.find(
                                  s =>
                                      s &&
                                      s.type === 'jellyfin' &&
                                      s.enabled === true &&
                                      String(s.name) === serverName
                              )
                            : mediaServers.find(
                                  s => s && s.type === 'jellyfin' && s.enabled === true
                              );

                        if (serverConfig && itemId) {
                            try {
                                const client = await getJellyfinClient(serverConfig);
                                const resp = await client.http.get('/Items', {
                                    params: {
                                        Ids: itemId,
                                        IncludeItemTypes: 'Movie,Series',
                                        Recursive: true,
                                    },
                                });
                                const item = resp?.data?.Items?.[0] || null;
                                if (item) {
                                    const processed =
                                        (await processJellyfinItem(item, serverConfig, client)) ||
                                        null;
                                    if (processed) {
                                        processed.key = key;
                                        return res.json({ result: processed });
                                    }
                                }
                            } catch (e) {
                                logger.warn('[Media Lookup] Jellyfin fallback failed', {
                                    server: serverConfig?.name,
                                    itemId,
                                    error: e?.message || String(e),
                                });
                            }
                        }
                    }
                }

                return res.json({ result: null });
            }

            const source = (found?.source || found?.serverType || '').toString().toLowerCase();
            const k = (found?.key || '').toString().toLowerCase();
            const inferredSource =
                source === 'plex' || source === 'jellyfin'
                    ? source
                    : k.startsWith('plex-')
                      ? 'plex'
                      : k.startsWith('jellyfin_')
                        ? 'jellyfin'
                        : source || 'unknown';

            res.json({
                result: {
                    key: found?.key,
                    title: found?.title || found?.name || '',
                    year: found?.year || found?.releaseYear || null,
                    type: found?.type || found?.mediaType || found?.itemType || null,
                    source: inferredSource,
                    posterUrl: found?.posterUrl || found?.poster_path || null,
                    backdropUrl: found?.backdropUrl || found?.backdrop_path || null,
                },
            });
        })
    );

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
     *       - in: query
     *         name: mode
     *         schema:
     *           type: string
     *           enum: [cinema]
     *         description: When set to "cinema", includes cinema-only items (e.g., Local Directory motion posterpacks). Other modes will not receive those items.
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
        // @ts-ignore - Express router overload issue with validation middleware
        validateGetMediaQuery,
        // CRITICAL: Games mode middleware MUST run BEFORE cache middleware
        // Otherwise cache will return cached movies instead of fetching games
        asyncHandler(async (req, res, next) => {
            const wallartMode = config?.wallartMode || {};

            // Lazy-load PlexSource once for all modes that need it
            let PlexSource = null;
            const getPlexSource = () => {
                if (!PlexSource) PlexSource = require('../sources/plex');
                return PlexSource;
            };

            const isGamesOnlyEnabled = wallartMode.gamesOnly === true;
            const isGamesOnlyRequest =
                req.query?.gamesOnly === '1' ||
                req.query?.gamesOnly === 'true' ||
                req.query?.gamesOnly === true;

            // Only log when games mode is active or explicitly requested (avoid log spam)
            if (isGamesOnlyEnabled || isGamesOnlyRequest) {
                logger.info('[Games Mode Middleware]', {
                    gamesOnlyParam: req.query?.gamesOnly,
                    isGamesOnlyEnabled,
                    isGamesOnlyRequest,
                    willBypassCache: isGamesOnlyEnabled && isGamesOnlyRequest,
                });
            }

            if (isGamesOnlyEnabled && isGamesOnlyRequest) {
                // Games mode active - fetch games directly, bypass cache
                try {
                    const RommSource = require('../sources/romm');
                    const rommServer = (config.mediaServers || []).find(
                        s => s.enabled && s.type === 'romm'
                    );

                    if (!rommServer) {
                        logger.warn('Games mode requested but no RomM server configured');
                        return res.json([]);
                    }

                    const platforms = rommServer.selectedPlatforms || [];
                    if (platforms.length === 0) {
                        logger.warn('Games mode enabled but no platforms selected');
                        return res.json([]);
                    }

                    const rommSource = new RommSource(rommServer, shuffleArray, isDebug);
                    // Default to fetching all games (2000 max) instead of just 100
                    const count = parseInt(req.query?.count, 10) || 2000;
                    const ROMM_GAMES_LIMIT = 2000;

                    logger.info(
                        `[Games Mode] Fetching up to ${count} games from platforms: ${platforms.join(', ')}`
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
                    return res.json([]);
                }
            }

            // Check if music mode is requested
            const musicMode = wallartMode.musicMode || {};
            const isMusicModeEnabled = musicMode.enabled === true;
            const isMusicModeRequest =
                req.query?.musicMode === '1' || req.query?.musicMode === 'true';

            // If music mode is active, fetch and return music albums instead (bypass regular cache)
            if (isMusicModeEnabled && isMusicModeRequest) {
                try {
                    // Find enabled Plex server
                    const PlexSourceClass = getPlexSource();
                    const plexServer = (config.mediaServers || []).find(
                        s => s.enabled && s.type === 'plex'
                    );

                    if (!plexServer) {
                        logger.warn('Music mode requested but no Plex server is configured');
                        return res.json([]);
                    }

                    // Get music library names from server config.
                    // UX rule: if none configured, treat as "all music libraries".
                    const musicLibraries = plexServer.musicLibraryNames || [];

                    // Get music filters from server config
                    const musicFilters = plexServer.musicFilters || {};

                    // Initialize Plex source with all required dependencies
                    const plexSource = new PlexSourceClass(
                        plexServer,
                        getPlexClient,
                        processPlexItem,
                        getPlexLibraries,
                        shuffleArray,
                        config.rottenTomatoesMinimumScore || 0,
                        isDebug
                    );

                    // Fetch music albums (default to 50, can be overridden by query param)
                    const count = parseInt(req.query?.count, 10) || 50;

                    logger.info(
                        `[Music Mode] Fetching ${count} albums from libraries: ${musicLibraries.length ? musicLibraries.join(', ') : '(all)'}`
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

            // Check if film cards mode is requested
            const isFilmCardsModeEnabled = wallartMode.layoutVariant === 'filmCards';
            const isFilmCardsModeRequest =
                req.query?.filmCards === '1' || req.query?.filmCards === 'true';

            // If film cards mode is active, fetch more items directly from source (bypass 300-item cache)
            if (isFilmCardsModeEnabled && isFilmCardsModeRequest) {
                try {
                    // Find enabled Plex server
                    const PlexSourceClass = getPlexSource();
                    const plexServer = (config.mediaServers || []).find(
                        s => s.enabled && s.type === 'plex'
                    );

                    if (!plexServer) {
                        logger.warn('Film Cards mode requested but no Plex server is configured');
                        return res.json([]);
                    }

                    // Get movie library names from server config
                    const movieLibraries =
                        plexServer.movieLibraryNames || plexServer.libraryNames || [];
                    if (movieLibraries.length === 0) {
                        logger.warn('Film Cards mode enabled but no movie libraries configured');
                        return res.json([]);
                    }

                    const count = parseInt(req.query?.count, 10) || 1000;

                    // Film Cards cache: 30 minute TTL (library content rarely changes)
                    // Cache key based on libraries + count for proper invalidation
                    global.__filmCardsCache = global.__filmCardsCache || {
                        ts: 0,
                        data: null,
                        key: '',
                    };
                    const cacheKey = `${movieLibraries.join(',')}:${count}`;
                    const cacheTTL = 30 * 60 * 1000; // 30 minutes
                    const now = Date.now();

                    // Check cache validity
                    if (
                        global.__filmCardsCache.key === cacheKey &&
                        global.__filmCardsCache.data &&
                        now - global.__filmCardsCache.ts < cacheTTL
                    ) {
                        const cacheAge = Math.round((now - global.__filmCardsCache.ts) / 1000);
                        logger.info(
                            `[Film Cards Mode] Returning ${global.__filmCardsCache.data.length} cached movies (age: ${cacheAge}s)`
                        );
                        res.set('X-Cache', 'HIT');
                        res.set('X-Cache-Age', `${cacheAge}s`);
                        return res.json(global.__filmCardsCache.data);
                    }

                    // Cache miss - fetch from Plex
                    logger.info(
                        `[Film Cards Mode] Fetching ${count} movies from libraries: ${movieLibraries.join(', ')}`
                    );

                    // Initialize Plex source with all required dependencies
                    const plexSource = new PlexSourceClass(
                        plexServer,
                        getPlexClient,
                        processPlexItem,
                        getPlexLibraries,
                        shuffleArray,
                        config.rottenTomatoesMinimumScore || 0,
                        isDebug
                    );

                    const movies = await plexSource.fetchMedia(movieLibraries, 'movie', count);

                    logger.info(
                        `[Film Cards Mode] Returning ${movies.length} movies (cached for 30min)`
                    );

                    // Update cache
                    global.__filmCardsCache = {
                        ts: now,
                        data: movies,
                        key: cacheKey,
                    };

                    res.set('X-Cache', 'MISS');
                    return res.json(movies);
                } catch (err) {
                    logger.error(`[Film Cards Mode] Failed to fetch movies: ${err.message}`, {
                        error: err.stack,
                    });
                    // Return empty array on error
                    return res.json([]);
                }
            }

            // Not special mode - continue to normal cache middleware
            next();
        }),
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

            // NOTE: Music mode, Film Cards mode, and Games mode are all handled by middleware BEFORE cache
            // This handler only deals with cached playlist responses

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

                // Motion posterpacks are cinema-only (Local Directory feature).
                // Only return them when the client explicitly requests cinema mode.
                const mode = String(req.query?.mode || '').toLowerCase();
                if (mode !== 'cinema') {
                    filtered = filtered.filter(item => {
                        if (!item) return false;
                        if (item.motionPosterUrl || item.isMotionPoster) return false;
                        const t = String(item.type || '').toLowerCase();
                        return t !== 'motion';
                    });
                }

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

            // Special case: If games mode is active and request excludes games,
            // return empty array instead of "building" status (no movies needed in games mode)
            // This check MUST come BEFORE isRefreshing() check
            const wallartModeCheck = config?.wallartMode || {};
            const isGamesOnlyActive = wallartModeCheck.gamesOnly === true;
            const isExcludingGames =
                req.query?.excludeGames === '1' ||
                req.query?.excludeGames === 'true' ||
                req.query?.excludeGames === true;

            if (isGamesOnlyActive && isExcludingGames) {
                logger.info(
                    '[Games Mode] Request excludes games while in games mode - returning empty array'
                );
                return res.json([]);
            }

            const isRefreshing = isPlaylistRefreshing();
            if (isRefreshing) {
                // The full cache is being built. Tell the client to wait and try again.
                // No need for stuck detection - the promise-based system in playlist-cache.js
                // handles deduplication and proper state cleanup automatically
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
            const artistCount = parseInt(req.query.count, 10) || 50;

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
        // @ts-ignore - Express router overload issue with validation middleware
        validateMediaKeyParam,
        asyncHandler(async (req, res) => {
            const keyParts = req.params.key.split('-'); // e.g., ['plex', 'My', 'Server', '12345']
            if (keyParts.length < 3) {
                // Must have at least type, name, and key
                // @ts-ignore - ApiError is constructable
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
                // @ts-ignore - NotFoundError is constructable
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
                // @ts-ignore - NotFoundError is constructable
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
        // @ts-ignore - Express router overload issue with validation middleware
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
            // Include quality/width in cache key so high-res and low-res are cached separately
            const quality = parseInt(req.query.quality, 10) || 100;
            const width = parseInt(req.query.width, 10) || 0;
            const qualitySuffix = quality < 50 || width > 0 ? `-q${quality}-w${width}` : '-hires';
            const cacheKey = directUrl
                ? `${directUrl}${qualitySuffix}`
                : `${serverName}-${imagePath}${qualitySuffix}`;
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

                    // Check for quality/width parameters to determine transcode size
                    const quality = parseInt(req.query.quality, 10) || 100;
                    const width = parseInt(req.query.width, 10) || 0;

                    const encodedPath = encodeURIComponent(imagePath);

                    if (quality >= 50 && width === 0) {
                        // High quality request - use ORIGINAL image directly (no transcode)
                        imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}`;
                    } else {
                        // Low quality thumbnail - transcode to small size for fast loading
                        const thumbWidth = width || 400;
                        const thumbHeight = Math.round(thumbWidth * 1.5); // Poster aspect ratio
                        imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}/photo/:/transcode?width=${thumbWidth}&height=${thumbHeight}&minSize=1&upscale=0&url=${encodedPath}&X-Plex-Token=${token}`;
                    }
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

                    // Check for quality/width parameters
                    const quality = parseInt(req.query.quality, 10) || 100;
                    const width = parseInt(req.query.width, 10) || 0;

                    // For high quality requests, add maxWidth/maxHeight to get full resolution
                    if (quality >= 50 && width === 0) {
                        // Add quality parameters for high-res images
                        const separator = imagePath.includes('?') ? '&' : '?';
                        imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}${separator}maxWidth=1000&maxHeight=1500&quality=100`;
                        logger.info(`[Image Proxy] HIGH-RES Jellyfin request`, {
                            path: imagePath,
                            resolution: '1000x1500',
                        });
                    } else {
                        imageUrl = `http://${serverConfig.hostname}:${serverConfig.port}${imagePath}`;
                        logger.info(`[Image Proxy] LOW-RES Jellyfin request`, {
                            path: imagePath,
                            quality,
                            width,
                        });
                    }
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
                // Enforce a hard timeout so bad DNS / hung connections don't stall the server (and tests)
                const timeoutMs = Number(process.env.IMAGE_PROXY_FETCH_TIMEOUT_MS) || 8000;
                const signal =
                    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
                        ? AbortSignal.timeout(timeoutMs)
                        : (() => {
                              const controller = new AbortController();
                              setTimeout(() => controller.abort(), timeoutMs);
                              return controller.signal;
                          })();

                const mediaServerResponse = await fetch(imageUrl, { ...fetchOptions, signal });

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

    // ===== TRAILER ENDPOINT =====
    // Fetches YouTube trailer URL for a movie/show via TMDB API
    /**
     * @swagger
     * /get-trailer:
     *   get:
     *     tags: [Media]
     *     summary: Get YouTube trailer URL for a movie or show
     *     description: |
     *       Fetches the official YouTube trailer URL from TMDB for a given movie or TV show.
     *       Returns the first available trailer (prefers official trailers).
     *     parameters:
     *       - name: tmdbId
     *         in: query
     *         required: true
     *         schema:
     *           type: string
     *         description: TMDB ID of the movie or show
     *       - name: type
     *         in: query
     *         required: false
     *         schema:
     *           type: string
     *           enum: [movie, tv]
     *           default: movie
     *         description: Media type (movie or tv)
     *     responses:
     *       200:
     *         description: Trailer information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 trailer:
     *                   type: object
     *                   properties:
     *                     key:
     *                       type: string
     *                       description: YouTube video ID
     *                     name:
     *                       type: string
     *                       description: Trailer title
     *                     site:
     *                       type: string
     *                       description: Video site (YouTube)
     *                     type:
     *                       type: string
     *                       description: Video type (Trailer, Teaser, etc.)
     *                     official:
     *                       type: boolean
     *                       description: Whether this is an official trailer
     *                     embedUrl:
     *                       type: string
     *                       description: Full YouTube embed URL
     *       400:
     *         description: Missing tmdbId parameter
     *       404:
     *         description: No trailer found
     *       500:
     *         description: TMDB API error
     */
    router.get(
        '/get-trailer',
        asyncHandler(async (req, res) => {
            const { tmdbId, type = 'movie' } = req.query;

            if (!tmdbId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: tmdbId',
                });
            }

            // Get TMDB API key from config or environment.
            // Most deployments keep secrets in .env, not config.json.
            const tmdbEnvVar =
                config.tmdbSource?.apiKeyEnvVar || config.tmdb?.apiKeyEnvVar || 'TMDB_API_KEY';
            const tmdbApiKey =
                (typeof config.tmdbSource?.apiKey === 'string' && config.tmdbSource.apiKey.trim()
                    ? config.tmdbSource.apiKey.trim()
                    : null) ||
                (typeof config.tmdb?.apiKey === 'string' && config.tmdb.apiKey.trim()
                    ? config.tmdb.apiKey.trim()
                    : null) ||
                (typeof process.env[tmdbEnvVar] === 'string' && process.env[tmdbEnvVar].trim()
                    ? process.env[tmdbEnvVar].trim()
                    : null);

            if (!tmdbApiKey) {
                logger.warn('[get-trailer] TMDB API key not configured', { tmdbEnvVar });
                // Return 200 so clients (cinema QR) can silently skip without noisy console errors.
                return res.status(200).json({
                    success: false,
                    error: 'TMDB API key not configured',
                    trailer: null,
                });
            }

            try {
                const mediaType = type === 'tv' ? 'tv' : 'movie';
                const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${encodeURIComponent(
                    tmdbApiKey
                )}`;

                const response = await fetch(url);
                if (!response.ok) {
                    logger.warn(`[get-trailer] TMDB API error: ${response.status}`);
                    // Return 200 so clients can handle gracefully without console noise.
                    return res.status(200).json({
                        success: false,
                        error: `TMDB API returned ${response.status}`,
                        upstreamStatus: response.status,
                        trailer: null,
                    });
                }

                const data = await response.json();
                const videos = data.results || [];

                // Find the best trailer (prefer official YouTube trailers)
                const trailer =
                    videos.find(
                        v => v.site === 'YouTube' && v.type === 'Trailer' && v.official === true
                    ) ||
                    videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                    videos.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                    videos.find(v => v.site === 'YouTube');

                if (!trailer) {
                    // Return 200 so clients can silently skip.
                    return res.status(200).json({
                        success: false,
                        error: 'No trailer found for this title',
                        trailer: null,
                    });
                }

                res.json({
                    success: true,
                    trailer: {
                        key: trailer.key,
                        name: trailer.name,
                        site: trailer.site,
                        type: trailer.type,
                        official: trailer.official || false,
                        embedUrl: `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0`,
                    },
                });
            } catch (err) {
                logger.error(`[get-trailer] Error fetching trailer: ${err.message}`);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to fetch trailer',
                });
            }
        })
    );

    // Metrics endpoint for monitoring image proxy fallback health

    /**
     * @swagger
     * /api/media/fallback-metrics:
     *   get:
     *     summary: Get image fallback metrics
     *     description: Returns metrics about image proxy fallbacks (used for monitoring image availability/health).
     *     tags: ['Metrics']
     *     security: []
     *     responses:
     *       200:
     *         description: Fallback metrics
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *             example:
     *               success: true
     *               metrics:
     *                 total: 12
     *                 byReason:
     *                   upstream_error: 5
     *                   timeout: 7
     *                 recentEvents: []
     *               timestamp: "2025-01-01T00:00:00.000Z"
     */
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
        // Uses "Storm" theme colors:
        // Gradient: #252a3a -> #1a1d29
        // Icon Fill: #3a4553
        // Shadow: #0f111a
        // Stroke: #4a5568
        // Text Main: #b8bcc8
        // Text Sub: #8b92a5
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#252a3a"/>
            <stop offset="100%" stop-color="#1a1d29"/>
        </linearGradient>
    </defs>
    <rect width="600" height="900" fill="url(#g)"/>
    <g fill="#3a4553">
        <rect x="110" y="160" width="380" height="570" rx="8" fill="#0f111a" opacity="0.15"/>
        <circle cx="300" cy="360" r="90" stroke="#4a5568" stroke-width="10" fill="none"/>
        <rect x="200" y="550" width="200" height="16" rx="8"/>
    </g>
    <text x="50%" y="780" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#b8bcc8">
        Poster unavailable
    </text>
    <text x="50%" y="820" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#8b92a5">
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
