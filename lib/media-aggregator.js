/**
 * Media Aggregator Module
 *
 * Aggregates media content from multiple sources (Plex, Jellyfin, TMDB, Local, Streaming).
 * Handles error resilience per source, metadata normalization, and lastFetch tracking.
 *
 * @module lib/media-aggregator
 */

const path = require('path');
const AdmZip = require('adm-zip');

// Source classes
const PlexSource = require('../sources/plex.js');
const JellyfinSource = require('../sources/jellyfin.js');
const TMDBSource = require('../sources/tmdb.js');
const RommSource = require('../sources/romm.js');

// Helper imports
const { getPlexClient, getPlexLibraries } = require('./plex-helpers.js');
const {
    getJellyfinClient,
    getJellyfinLibraries,
    processJellyfinItem,
} = require('./jellyfin-helpers.js');

/**
 * Fixed limits for media fetching per source type to balance load and latency.
 * @constant {Object}
 */
const FIXED_LIMITS = {
    PLEX_MOVIES: 300,
    PLEX_SHOWS: 100,
    JELLYFIN_MOVIES: 300,
    JELLYFIN_SHOWS: 100,
    TMDB_MOVIES: 150,
    TMDB_TV: 50,
    STREAMING_MOVIES_PER_PROVIDER: 30,
    STREAMING_TV_PER_PROVIDER: 10,
    ROMM_GAMES: 2000, // RomM game limit - fetch more to accommodate large collections
};

/**
 * Aggregates media from all enabled sources (Plex, Jellyfin, TMDB, Local, Streaming).
 * Each source failure is isolated; other sources continue processing.
 *
 * @param {Object} params - Aggregation parameters
 * @param {Object} params.config - Full application config (mediaServers, tmdbSource, localDirectory, streamingSources)
 * @param {Function} params.processPlexItem - Function to process individual Plex items
 * @param {Function} params.shuffleArray - Function to shuffle arrays
 * @param {Object} params.localDirectorySource - Local directory source instance (optional)
 * @param {Object} params.logger - Logger instance
 * @param {boolean} params.isDebug - Debug mode flag
 * @returns {Promise<Array>} Array of normalized media items from all sources
 */
async function getPlaylistMedia({
    config,
    processPlexItem,
    shuffleArray,
    localDirectorySource,
    logger,
    isDebug,
}) {
    let allMedia = [];
    // Track latest lastFetch per source type during this aggregation
    const latestLastFetch = { plex: null, jellyfin: null, tmdb: null, local: null, romm: null };
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
            } else if (server.type === 'romm') {
                source = new RommSource(server, shuffleArray, isDebug);
            }

            // Determine per-source limits
            const movieLimit =
                server.type === 'plex'
                    ? FIXED_LIMITS.PLEX_MOVIES
                    : server.type === 'jellyfin'
                      ? FIXED_LIMITS.JELLYFIN_MOVIES
                      : 0;
            const showLimit =
                server.type === 'plex'
                    ? FIXED_LIMITS.PLEX_SHOWS
                    : server.type === 'jellyfin'
                      ? FIXED_LIMITS.JELLYFIN_SHOWS
                      : 0;

            // Accumulators per server
            let movies = [];
            let shows = [];
            let games = [];

            // RomM servers fetch games instead of movies/shows
            if (server.type === 'romm') {
                // Only include games if wallart mode is enabled
                // Games should never appear in screensaver or cinema mode
                const wallartEnabled = config.wallartMode?.enabled === true;
                if (!wallartEnabled) {
                    if (isDebug)
                        logger.debug(
                            `[Debug] Skipping ${server.name} - games only available in wallart mode`
                        );
                    continue; // Skip this server entirely
                }

                // Fetch games from configured platforms
                const platforms = server.selectedPlatforms || [];
                if (platforms.length > 0) {
                    try {
                        games = await source.fetchMedia(platforms, 'game', FIXED_LIMITS.ROMM_GAMES);
                        if (isDebug)
                            logger.debug(
                                `[Debug] Fetched ${games.length} games from ${server.name}`
                            );
                    } catch (error) {
                        logger.error(`[${server.name}] Failed to fetch games:`, {
                            error: error.message,
                            platforms,
                        });
                        // Continue even if games failed
                    }
                } else {
                    logger.warn(
                        `[${server.name}] No platforms selected - configure selectedPlatforms in config.json`
                    );
                }
            } else {
                // Plex/Jellyfin fetch movies and shows
                // Fetch movies from configured libraries
                if (server.movieLibraryNames && server.movieLibraryNames.length > 0) {
                    try {
                        movies = await source.fetchMedia(
                            server.movieLibraryNames,
                            'movie',
                            movieLimit
                        );
                        if (isDebug)
                            logger.debug(
                                `[Debug] Fetched ${movies.length} movies from ${server.name}`
                            );
                    } catch (error) {
                        logger.error(`[${server.name}] Failed to fetch movies:`, {
                            error: error.message,
                            libraries: server.movieLibraryNames,
                        });
                        // Continue even if movies failed
                    }
                }

                if (server.showLibraryNames && server.showLibraryNames.length > 0) {
                    try {
                        shows = await source.fetchMedia(server.showLibraryNames, 'show', showLimit);
                        if (isDebug)
                            logger.debug(
                                `[Debug] Fetched ${shows.length} shows from ${server.name}`
                            );
                    } catch (error) {
                        logger.error(`[${server.name}] Failed to fetch shows:`, {
                            error: error.message,
                            libraries: server.showLibraryNames,
                        });
                        // Continue even if shows failed
                    }
                }
            }

            // Update lastFetch for this source type if available
            try {
                const m = typeof source?.getMetrics === 'function' ? source.getMetrics() : null;
                const lf = m?.lastFetch ? new Date(m.lastFetch) : null;
                if (lf && !isNaN(lf)) {
                    const t = lf.getTime();
                    if (server.type === 'plex') {
                        latestLastFetch.plex = Math.max(latestLastFetch.plex || 0, t);
                    } else if (server.type === 'jellyfin') {
                        latestLastFetch.jellyfin = Math.max(latestLastFetch.jellyfin || 0, t);
                    } else if (server.type === 'romm') {
                        latestLastFetch.romm = Math.max(latestLastFetch.romm || 0, t);
                    }
                }
            } catch (_) {
                // non-fatal
            }

            const mediaFromServer = movies.concat(shows).concat(games);
            if (mediaFromServer.length > 0) {
                if (server.type === 'romm') {
                    logger.info(
                        `[${server.name}] Successfully fetched ${mediaFromServer.length} games`
                    );
                } else {
                    logger.info(
                        `[${server.name}] Successfully fetched ${mediaFromServer.length} items (${movies.length} movies, ${shows.length} shows)`
                    );
                }
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
        try {
            const m = tmdbSource.getMetrics();
            const lf = m?.lastFetch ? new Date(m.lastFetch) : null;
            if (lf && !isNaN(lf)) {
                latestLastFetch.tmdb = Math.max(latestLastFetch.tmdb || 0, lf.getTime());
            }
        } catch (_) {
            /* mkdir may already exist */
        }
        const tmdbMedia = tmdbMovies.concat(tmdbShows);

        if (isDebug) logger.debug(`[Debug] Fetched ${tmdbMedia.length} items from TMDB.`);
        allMedia = allMedia.concat(tmdbMedia);
    }

    // Process Local Directory Source
    if (config.localDirectory && config.localDirectory.enabled && localDirectorySource) {
        if (isDebug) logger.debug(`[Debug] Fetching from Local Directory source`);

        try {
            // Determine limits for local directory content (treat as posters/backgrounds)
            const localPosterLimit = FIXED_LIMITS.TMDB_MOVIES; // reuse TMDB limits for balance
            const localBackgroundLimit = FIXED_LIMITS.TMDB_TV;

            let [localPosters, localBackgrounds] = await Promise.all([
                localDirectorySource.fetchMedia([''], 'poster', localPosterLimit),
                localDirectorySource.fetchMedia([''], 'background', localBackgroundLimit),
            ]);

            // If nothing found and auto-import is enabled, try importing once (manual posterpacks only) and retry fetch
            if (
                Array.isArray(localPosters) &&
                Array.isArray(localBackgrounds) &&
                localPosters.length === 0 &&
                localBackgrounds.length === 0 &&
                config.localDirectory.autoImportPosterpacks === true &&
                typeof localDirectorySource.importPosterpacks === 'function'
            ) {
                try {
                    // Only attempt manual imports here; generated exports should not be auto-imported during fetch
                    const imported = await localDirectorySource.importPosterpacks({
                        includeGenerated: false,
                    });
                    if (imported > 0) {
                        const retried = await Promise.all([
                            localDirectorySource.fetchMedia([''], 'poster', localPosterLimit),
                            localDirectorySource.fetchMedia(
                                [''],
                                'background',
                                localBackgroundLimit
                            ),
                        ]);
                        localPosters = retried[0] || [];
                        localBackgrounds = retried[1] || [];
                        logger.info(
                            '[Local Directory] Performed auto-import from manual posterpacks and retried fetch',
                            { imported }
                        );
                    }
                } catch (e) {
                    logger.warn('[Local Directory] Auto-import on empty fetch failed', {
                        error: e?.message,
                    });
                }
            }

            // Update lastFetch for local directory
            try {
                const m = localDirectorySource.getMetrics();
                const lf = m?.lastScan ? new Date(m.lastScan) : null;
                if (lf && !isNaN(lf)) {
                    latestLastFetch.local = Math.max(latestLastFetch.local || 0, lf.getTime());
                }
            } catch (_) {
                // Non-fatal
            }

            // Normalize Local items to the common shape expected by the client (posterUrl/backgroundUrl)
            // Also load metadata.json from posterpack ZIPs to propagate tagline/overview/rating/rottenTomatoes/imdbUrl
            const zipMetaCache = new Map(); // key: absolute zip path -> partial meta
            const normalizeLocalItem = item => {
                const baseId =
                    item?.sourceId ||
                    item?.id ||
                    (item?.localPath ? path.basename(item.localPath) : item?.originalFilename) ||
                    item?.poster ||
                    Math.random().toString(36).slice(2);
                const isBackground = (item?.directory || '').toLowerCase() === 'backgrounds';
                // If this item came from a ZIP (extension .zip), derive poster/background URLs
                let posterUrl = null;
                let backgroundUrl = null;
                let thumbnailUrl = null;
                let tagline = item?.tagline || item?.metadata?.tagline || null;
                let overview = item?.overview || item?.metadata?.overview || null;
                let rating =
                    (typeof item?.rating === 'number' ? item.rating : null) ??
                    (typeof item?.metadata?.rating === 'number' ? item.metadata.rating : null);
                let contentRating = item?.contentRating || item?.metadata?.contentRating || null;
                let rottenTomatoes = item?.rottenTomatoes || item?.metadata?.rottenTomatoes || null;
                let imdbUrl = item?.imdbUrl || item?.metadata?.imdbUrl || null;
                let runtimeMs = item?.metadata?.runtimeMs || null;
                const lp = item?.localPath || '';
                const isZip = typeof lp === 'string' && lp.toLowerCase().endsWith('.zip');
                if (isZip) {
                    // Compute path relative to a configured root so /local-posterpack can access it
                    let relZip = lp;
                    try {
                        const bases = Array.isArray(localDirectorySource.rootPaths)
                            ? localDirectorySource.rootPaths
                            : [localDirectorySource.rootPath].filter(Boolean);
                        for (const b of bases) {
                            const r = path.relative(b, lp).replace(/\\/g, '/');
                            if (!r.startsWith('..')) {
                                relZip = r;
                                break;
                            }
                        }
                    } catch (_) {
                        // keep absolute as fallback; handler also supports absolute
                    }
                    const enc = encodeURIComponent(relZip);
                    posterUrl = `/local-posterpack?zip=${enc}&entry=poster`;
                    backgroundUrl = `/local-posterpack?zip=${enc}&entry=background`;
                    // tentative thumbnail URL; will keep only if found in ZIP
                    thumbnailUrl = `/local-posterpack?zip=${enc}&entry=thumbnail`;
                    // Attempt to read metadata.json inside the ZIP (once) to pull tagline/overview/rating/rottenTomatoes/imdbUrl
                    try {
                        if (!zipMetaCache.has(lp)) {
                            const zip = new AdmZip(lp);
                            const entries = zip.getEntries();
                            const metaEntry = entries.find(e =>
                                /(^|\/)metadata\.json$/i.test(e.entryName)
                            );
                            // Detect presence of poster/background/clearlogo files inside the ZIP (case-insensitive)
                            let hasPoster = false;
                            let hasBackground = false;
                            let hasClearLogo = false;
                            let hasThumbnail = false;
                            try {
                                const posterRe = /(^|\/)poster\.(jpg|jpeg|png|webp)$/i;
                                const backgroundRe = /(^|\/)background\.(jpg|jpeg|png|webp)$/i;
                                const clearlogoRe = /(^|\/)clearlogo\.(png|webp|jpg|jpeg)$/i;
                                const thumbnailRe =
                                    /(^|\/)(thumb|thumbnail)\.(jpg|jpeg|png|webp)$/i;
                                hasPoster = entries.some(e => posterRe.test(e.entryName));
                                hasBackground = entries.some(e => backgroundRe.test(e.entryName));
                                hasClearLogo = entries.some(e => clearlogoRe.test(e.entryName));
                                hasThumbnail = entries.some(e => thumbnailRe.test(e.entryName));
                            } catch (_) {
                                // best-effort detection only
                            }
                            if (metaEntry) {
                                try {
                                    const raw = metaEntry.getData().toString('utf8');
                                    const j = JSON.parse(raw) || {};
                                    let parsedRating = null;
                                    if (typeof j.rating === 'number') parsedRating = j.rating;
                                    else if (typeof j.rating === 'string') {
                                        const n = parseFloat(j.rating);
                                        if (!Number.isNaN(n)) parsedRating = n;
                                    }
                                    zipMetaCache.set(lp, {
                                        tagline: j.tagline ?? null,
                                        overview: j.overview ?? null,
                                        rating: parsedRating,
                                        contentRating: j.contentRating ?? null,
                                        rottenTomatoes: j.rottenTomatoes ?? null,
                                        imdbUrl: j.imdbUrl ?? null,
                                        runtimeMs: j.runtimeMs ?? null,
                                        hasPoster,
                                        hasBackground,
                                        hasClearLogo,
                                        hasThumbnail,
                                    });
                                } catch (_) {
                                    zipMetaCache.set(lp, {
                                        tagline: null,
                                        overview: null,
                                        rating: null,
                                        contentRating: null,
                                        rottenTomatoes: null,
                                        imdbUrl: null,
                                        runtimeMs: null,
                                        hasPoster,
                                        hasBackground,
                                        hasClearLogo,
                                        hasThumbnail,
                                    });
                                }
                            } else {
                                zipMetaCache.set(lp, {
                                    tagline: null,
                                    overview: null,
                                    rating: null,
                                    contentRating: null,
                                    rottenTomatoes: null,
                                    imdbUrl: null,
                                    runtimeMs: null,
                                    hasPoster,
                                    hasBackground,
                                    hasClearLogo,
                                    hasThumbnail,
                                });
                            }
                        }
                        const zm = zipMetaCache.get(lp);
                        if (zm) {
                            if (!tagline && zm.tagline) tagline = zm.tagline;
                            if (!overview && zm.overview) overview = zm.overview;
                            if (
                                (rating == null || Number.isNaN(rating)) &&
                                typeof zm.rating === 'number'
                            )
                                rating = zm.rating;
                            if (!contentRating && zm.contentRating)
                                contentRating = zm.contentRating;
                            if (!rottenTomatoes && zm.rottenTomatoes)
                                rottenTomatoes = zm.rottenTomatoes;
                            if (!imdbUrl && zm.imdbUrl) imdbUrl = zm.imdbUrl;
                            if (zm.runtimeMs != null) runtimeMs = zm.runtimeMs;
                            // Fallbacks: if background missing in ZIP, use poster (and vice versa)
                            try {
                                const hasPoster = !!zm.hasPoster;
                                const hasBackground = !!zm.hasBackground;
                                const hasThumbnail = !!zm.hasThumbnail;
                                if (!hasBackground && hasPoster && posterUrl && !backgroundUrl) {
                                    backgroundUrl = posterUrl;
                                } else if (
                                    !hasPoster &&
                                    hasBackground &&
                                    backgroundUrl &&
                                    !posterUrl
                                ) {
                                    posterUrl = backgroundUrl;
                                } else if (!hasBackground && hasPoster && posterUrl) {
                                    // Even if backgroundUrl has a default value, prefer explicit fallback to poster
                                    backgroundUrl = posterUrl;
                                } else if (!hasPoster && hasBackground && backgroundUrl) {
                                    posterUrl = backgroundUrl;
                                }
                                // Only keep thumbnailUrl if actually present
                                if (!hasThumbnail) thumbnailUrl = null;
                            } catch (_) {
                                // ignore fallback errors
                            }
                            // Fallback: if rating is still missing, derive from Rotten Tomatoes originalScore (0-10)
                            if ((rating == null || Number.isNaN(rating)) && zm.rottenTomatoes) {
                                const os = zm.rottenTomatoes.originalScore;
                                if (typeof os === 'number' && !Number.isNaN(os)) rating = os;
                                else if (
                                    typeof zm.rottenTomatoes.score === 'number' &&
                                    !Number.isNaN(zm.rottenTomatoes.score)
                                )
                                    rating = zm.rottenTomatoes.score / 10;
                            }
                        }
                    } catch (_) {
                        // ignore failure to read zip metadata
                    }
                } else {
                    posterUrl = item?.poster || null;
                    backgroundUrl = isBackground ? item?.poster || null : null;
                }
                return {
                    id: `local-${baseId}`,
                    title: item?.title || item?.originalFilename || 'Local Item',
                    year: item?.year || null,
                    posterUrl: isBackground ? posterUrl || null : posterUrl,
                    backgroundUrl: backgroundUrl,
                    thumbnailUrl: thumbnailUrl || null,
                    clearLogoUrl: item?.metadata?.clearlogoPath || item?.clearlogoPath || null,
                    tagline: tagline || null,
                    overview: overview || null,
                    rating: typeof rating === 'number' ? rating : null,
                    contentRating: contentRating || null,
                    rottenTomatoes: rottenTomatoes || null,
                    imdbUrl: imdbUrl || null,
                    runtime: runtimeMs != null ? Math.round(runtimeMs / 60000) : null,
                    source: 'local',
                };
            };

            // Normalize and then de-duplicate ZIP-backed items so each posterpack yields a single entry
            const normalizedAll = []
                .concat(Array.isArray(localPosters) ? localPosters.map(normalizeLocalItem) : [])
                .concat(
                    Array.isArray(localBackgrounds) ? localBackgrounds.map(normalizeLocalItem) : []
                );

            // Build a deduped list keyed by stable media id (derived from sourceId/cleanTitle)
            const dedupMap = new Map();
            for (const it of normalizedAll) {
                const key = it.id;
                const incomingIsZip =
                    typeof it.posterUrl === 'string' &&
                    it.posterUrl.startsWith('/local-posterpack?');
                const existing = dedupMap.get(key);
                if (!existing) {
                    dedupMap.set(key, { ...it });
                } else {
                    // Merge missing fields conservatively; prefer ZIP-backed URLs when present
                    const existingIsZip =
                        typeof existing.posterUrl === 'string' &&
                        existing.posterUrl.startsWith('/local-posterpack?');

                    const preferIncoming = incomingIsZip && !existingIsZip;
                    if (preferIncoming || (!existing.posterUrl && it.posterUrl))
                        existing.posterUrl = it.posterUrl || existing.posterUrl;
                    if (preferIncoming || (!existing.backgroundUrl && it.backgroundUrl))
                        existing.backgroundUrl = it.backgroundUrl || existing.backgroundUrl;
                    if (preferIncoming || (!existing.clearLogoUrl && it.clearLogoUrl))
                        existing.clearLogoUrl = it.clearLogoUrl || existing.clearLogoUrl;
                    if (
                        (existing.rating == null || Number.isNaN(existing.rating)) &&
                        typeof it.rating === 'number'
                    )
                        existing.rating = it.rating;
                    if (!existing.contentRating && it.contentRating)
                        existing.contentRating = it.contentRating;
                    if (!existing.rottenTomatoes && it.rottenTomatoes)
                        existing.rottenTomatoes = it.rottenTomatoes;
                    if (!existing.imdbUrl && it.imdbUrl) existing.imdbUrl = it.imdbUrl;
                    if (!existing.tagline && it.tagline) existing.tagline = it.tagline;
                    if (!existing.overview && it.overview) existing.overview = it.overview;
                    if (!existing.runtime && it.runtime) existing.runtime = it.runtime;
                    // Keep the earliest year/title if missing
                    if (!existing.title && it.title) existing.title = it.title;
                    if (!existing.year && it.year) existing.year = it.year;
                }
            }
            const normalized = Array.from(dedupMap.values());

            if (isDebug)
                logger.debug(
                    `[Debug] Fetched ${normalizedAll.length} raw Local items -> ${normalized.length} after dedup (${localPosters.length} posters, ${localBackgrounds.length} backgrounds)`
                );

            if (normalized.length > 0) {
                logger.info(
                    `[Local Directory] Successfully fetched ${normalized.length} items (${localPosters.length} posters, ${localBackgrounds.length} backgrounds)`
                );
                allMedia = allMedia.concat(normalized);
            } else {
                logger.info('[Local Directory] No media found in local directories');
            }
        } catch (error) {
            logger.error('[Local Directory] Failed to fetch media:', {
                error: error.message,
                rootPath: config.localDirectory.rootPath,
            });
            // Continue with other sources
        }
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

    // Publish captured lastFetch timestamps globally for admin UI
    try {
        global.sourceLastFetch = global.sourceLastFetch || {};
        if (latestLastFetch.plex) global.sourceLastFetch.plex = latestLastFetch.plex;
        if (latestLastFetch.jellyfin) global.sourceLastFetch.jellyfin = latestLastFetch.jellyfin;
        if (latestLastFetch.tmdb) global.sourceLastFetch.tmdb = latestLastFetch.tmdb;
        if (latestLastFetch.local) global.sourceLastFetch.local = latestLastFetch.local;
        if (latestLastFetch.romm) global.sourceLastFetch.romm = latestLastFetch.romm;
    } catch (_) {
        /* capture lastFetch best-effort */
    }
    return allMedia;
}

module.exports = {
    getPlaylistMedia,
};
