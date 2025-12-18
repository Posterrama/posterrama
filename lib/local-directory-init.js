/**
 * Local Directory Initialization
 * Sets up source adapters, HTTP clients, and job queue for local media management
 */

const JobQueue = require('../utils/job-queue');
const LocalDirectorySource = require('../sources/local');
const { createUploadMiddleware } = require('../middleware/fileUpload');

/**
 * Initialize local directory support with source adapters
 * @param {Object} params - Initialization parameters
 * @param {Object} params.config - Application configuration
 * @param {Object} params.logger - Logger instance
 * @param {number} params.port - Server port for HTTP clients
 * @param {Function} params.getPlexClient - Plex client getter
 * @param {Function} params.processPlexItem - Plex item processor
 * @param {Function} params.getJellyfinClient - Jellyfin client getter
 * @param {Function} params.processJellyfinItem - Jellyfin item processor
 * @returns {Object} Initialized instances: { jobQueue, localDirectorySource, uploadMiddleware, sourceAdapters, httpClients }
 */
function initializeLocalDirectory({
    config,
    logger,
    port,
    getPlexClient,
    processPlexItem,
    getJellyfinClient,
    processJellyfinItem,
}) {
    let jobQueue = null;
    let localDirectorySource = null;
    let uploadMiddleware = null;
    let sourceAdapters = null;
    let httpClients = null;

    if (config.localDirectory && config.localDirectory.enabled) {
        jobQueue = new JobQueue(config);
        localDirectorySource = new LocalDirectorySource(config.localDirectory);
        // NOTE: routes/local-directory.js expects uploadMiddleware to be an Express middleware function.
        uploadMiddleware = createUploadMiddleware(config.localDirectory).array('files');

        // Set up source adapters for posterpack generation
        sourceAdapters = {
            plex: {
                fetchLibraryItems: async libraryId => {
                    try {
                        const serverConfig = (config.mediaServers || []).find(
                            s => s.type === 'plex'
                        );
                        if (!serverConfig) return [];
                        const plex = await getPlexClient(serverConfig);
                        const resp = await plex.query(`/library/sections/${libraryId}/all`);
                        const items = resp?.MediaContainer?.Metadata || [];
                        const results = [];
                        for (const summary of items) {
                            try {
                                // Fetch full metadata including extras for this item
                                const ratingKey = summary.ratingKey || summary.key;
                                let enrichedItem = summary;
                                if (ratingKey) {
                                    try {
                                        logger.info(
                                            `[Posterpack] Fetching extras for ${summary.title} (ratingKey: ${ratingKey})`
                                        );

                                        // Fetch full metadata to get Theme info
                                        let fullMetadata = summary;
                                        try {
                                            const metaResp = await plex.query(
                                                `/library/metadata/${ratingKey}`
                                            );
                                            if (metaResp?.MediaContainer?.Metadata?.[0]) {
                                                fullMetadata = metaResp.MediaContainer.Metadata[0];
                                            }
                                        } catch (metaErr) {
                                            logger.debug(
                                                `[Posterpack] Could not fetch full metadata for ${summary.title}: ${metaErr.message}`
                                            );
                                        }

                                        // Fetch extras using /extras endpoint (for movies) or /children for shows
                                        let extrasData = null;
                                        try {
                                            const extrasResp = await plex.query(
                                                `/library/metadata/${ratingKey}/extras`
                                            );
                                            if (extrasResp?.MediaContainer?.Metadata?.length > 0) {
                                                extrasData = {
                                                    size: extrasResp.MediaContainer.size,
                                                    Metadata: extrasResp.MediaContainer.Metadata,
                                                };
                                                logger.info(
                                                    `[Posterpack] ${summary.title}: Found ${extrasData.Metadata.length} extras`
                                                );
                                                logger.info(
                                                    `[Posterpack] Extra types: ${extrasData.Metadata.map(e => e.type || e.extraType || e.subtype).join(', ')}`
                                                );
                                            }
                                        } catch (extrasErr) {
                                            logger.debug(
                                                `[Posterpack] No extras for ${summary.title}: ${extrasErr.message}`
                                            );
                                        }

                                        // Extract theme from full metadata
                                        const themeKey =
                                            fullMetadata.Theme?.[0]?.key ||
                                            fullMetadata.theme ||
                                            null;

                                        enrichedItem = {
                                            ...summary,
                                            Extras: extrasData,
                                            Related: null,
                                            theme: themeKey,
                                            Image: fullMetadata.Image || summary.Image,
                                        };

                                        if (themeKey) {
                                            logger.info(
                                                `[Posterpack] ${summary.title}: Has theme music at ${themeKey}`
                                            );
                                        }
                                    } catch (e) {
                                        logger.warn(
                                            `Could not fetch extras for ${summary.title}: ${e.message}`
                                        );
                                    }
                                }
                                const processed = await processPlexItem(
                                    enrichedItem,
                                    serverConfig,
                                    plex
                                );
                                if (!processed) continue;
                                results.push({
                                    title: processed.title,
                                    year: processed.year,
                                    id:
                                        processed.id ||
                                        processed.key ||
                                        summary.ratingKey ||
                                        summary.key,
                                    type:
                                        processed.type ||
                                        (summary.type === 'movie'
                                            ? 'movie'
                                            : summary.type === 'show'
                                              ? 'show'
                                              : undefined),
                                    poster: processed.posterUrl || processed.poster,
                                    background: processed.backgroundUrl || processed.backdropUrl,
                                    clearlogo: processed.clearLogoUrl || null,
                                    genres: Array.isArray(processed.genres)
                                        ? processed.genres
                                        : undefined,
                                    contentRating: processed.contentRating || undefined,
                                    qualityLabel: processed.qualityLabel || undefined,
                                    overview: processed.overview || processed.tagline || undefined,
                                    tagline: processed.tagline || undefined,
                                    imdbUrl: processed.imdbUrl || undefined,
                                    rottenTomatoes: processed.rottenTomatoes || undefined,
                                    studios: processed.studios || undefined,
                                    cast: processed.cast || undefined,
                                    directorsDetailed: processed.directorsDetailed || undefined,
                                    writersDetailed: processed.writersDetailed || undefined,
                                    producersDetailed: processed.producersDetailed || undefined,
                                    directors: processed.directors || undefined,
                                    writers: processed.writers || undefined,
                                    producers: processed.producers || undefined,
                                    guids: processed.guids || undefined,
                                    releaseDate: processed.releaseDate || undefined,
                                    runtimeMs: processed.runtimeMs || undefined,
                                    mediaStreams: processed.mediaStreams || undefined,
                                    collections: processed.collections || undefined,
                                    countries: processed.countries || undefined,
                                    audienceRating: processed.audienceRating || undefined,
                                    viewCount: processed.viewCount || undefined,
                                    skipCount: processed.skipCount || undefined,
                                    lastViewedAt: processed.lastViewedAt || undefined,
                                    userRating: processed.userRating || undefined,
                                    originalTitle: processed.originalTitle || undefined,
                                    titleSort: processed.titleSort || undefined,
                                    extras: processed.extras || undefined,
                                    related: processed.related || undefined,
                                    themeUrl: processed.themeUrl || undefined,
                                });
                            } catch (e) {
                                logger.warn('Failed to process Plex item for local directory', {
                                    itemKey: summary.key,
                                    error: e.message,
                                });
                            }
                        }
                        return results;
                    } catch (error) {
                        logger.error(
                            'Failed to fetch Plex library items for local directory:',
                            error
                        );
                        return [];
                    }
                },
                fetchItemsByIds: async itemIds => {
                    try {
                        const plexServers = Array.isArray(config.mediaServers)
                            ? config.mediaServers.filter(s => s && s.type === 'plex')
                            : [];
                        if (plexServers.length === 0) return [];

                        const parsePlexKey = raw => {
                            const v0 = String(raw || '').trim();
                            const v = v0.split('?')[0];
                            if (!v) return null;

                            // Accept raw ratingKey
                            if (/^\d+$/.test(v)) return { ratingKey: v, serverName: null };

                            // Accept Plex metadata path
                            const m = v.match(/\/library\/metadata\/(\d+)/);
                            if (m) return { ratingKey: m[1], serverName: null };

                            // Composite key (created by admin search): plex-<ServerName>-<RatingKey>
                            const m2 = v.match(/^plex-(.+)-(\d+)$/);
                            if (m2) return { ratingKey: m2[2], serverName: m2[1] };

                            return null;
                        };

                        const resolvePlexServer = serverName => {
                            if (!serverName) return plexServers[0] || null;
                            const want = String(serverName).toLowerCase();
                            return (
                                plexServers.find(
                                    s => String(s.name || '').toLowerCase() === want
                                ) ||
                                plexServers[0] ||
                                null
                            );
                        };

                        const clientByServerName = new Map();

                        const results = [];
                        const ids = Array.isArray(itemIds) ? itemIds : [];

                        const stats = {
                            itemIdsCount: ids.length,
                            parsedOk: 0,
                            parseFailed: 0,
                            resolvedServerOk: 0,
                            metaOk: 0,
                            processedOk: 0,
                            errors: [],
                        };

                        logger.info('Selected items: Plex fetchItemsByIds called', {
                            itemIdsCount: ids.length,
                            itemIdsSample: ids.slice(0, 10),
                            servers: plexServers.map(s => s?.name).filter(Boolean),
                        });

                        for (const rawId of ids) {
                            const parsed = parsePlexKey(rawId);
                            if (!parsed?.ratingKey) {
                                stats.parseFailed++;
                                if (stats.errors.length < 3)
                                    stats.errors.push({ rawId, error: 'Could not parse Plex key' });
                                continue;
                            }
                            stats.parsedOk++;
                            const ratingKey = parsed.ratingKey;
                            const serverConfig = resolvePlexServer(parsed.serverName);
                            if (!serverConfig) {
                                if (stats.errors.length < 3)
                                    stats.errors.push({
                                        rawId,
                                        error: 'Could not resolve Plex server',
                                        parsedServerName: parsed.serverName || null,
                                    });
                                continue;
                            }
                            stats.resolvedServerOk++;

                            const cacheKey = String(serverConfig.name || '__default__');
                            let plex = clientByServerName.get(cacheKey);
                            if (!plex) {
                                plex = await getPlexClient(serverConfig);
                                clientByServerName.set(cacheKey, plex);
                            }

                            try {
                                const metaResp = await plex.query(`/library/metadata/${ratingKey}`);
                                const fullMetadata = metaResp?.MediaContainer?.Metadata?.[0];
                                if (!fullMetadata) {
                                    if (stats.errors.length < 3)
                                        stats.errors.push({
                                            rawId,
                                            error: 'Plex metadata lookup returned no Metadata[0]',
                                            resolvedServerName: serverConfig?.name || null,
                                            ratingKey,
                                        });
                                    continue;
                                }
                                stats.metaOk++;

                                // Fetch extras (best-effort)
                                let extrasData = null;
                                try {
                                    const extrasResp = await plex.query(
                                        `/library/metadata/${ratingKey}/extras`
                                    );
                                    if (extrasResp?.MediaContainer?.Metadata?.length > 0) {
                                        extrasData = {
                                            size: extrasResp.MediaContainer.size,
                                            Metadata: extrasResp.MediaContainer.Metadata,
                                        };
                                    }
                                } catch (_) {
                                    // ignore extras fetch errors
                                }

                                const themeKey =
                                    fullMetadata.Theme?.[0]?.key || fullMetadata.theme || null;

                                const enrichedItem = {
                                    ...fullMetadata,
                                    Extras: extrasData,
                                    Related: null,
                                    theme: themeKey,
                                    Image: fullMetadata.Image || fullMetadata.Image,
                                };

                                const processed = await processPlexItem(
                                    enrichedItem,
                                    serverConfig,
                                    plex
                                );
                                if (!processed) {
                                    if (stats.errors.length < 3)
                                        stats.errors.push({
                                            rawId,
                                            error: 'processPlexItem returned null/undefined',
                                            resolvedServerName: serverConfig?.name || null,
                                            ratingKey,
                                        });
                                    continue;
                                }
                                stats.processedOk++;

                                results.push({
                                    title: processed.title,
                                    year: processed.year,
                                    id:
                                        processed.id ||
                                        processed.key ||
                                        fullMetadata.ratingKey ||
                                        fullMetadata.key ||
                                        ratingKey,
                                    type:
                                        processed.type ||
                                        (fullMetadata.type === 'movie'
                                            ? 'movie'
                                            : fullMetadata.type === 'show'
                                              ? 'show'
                                              : undefined),
                                    poster: processed.posterUrl || processed.poster,
                                    background: processed.backgroundUrl || processed.backdropUrl,
                                    clearlogo: processed.clearLogoUrl || null,
                                    genres: Array.isArray(processed.genres)
                                        ? processed.genres
                                        : undefined,
                                    contentRating: processed.contentRating || undefined,
                                    qualityLabel: processed.qualityLabel || undefined,
                                    overview: processed.overview || processed.tagline || undefined,
                                    tagline: processed.tagline || undefined,
                                    imdbUrl: processed.imdbUrl || undefined,
                                    rottenTomatoes: processed.rottenTomatoes || undefined,
                                    studios: processed.studios || undefined,
                                    cast: processed.cast || undefined,
                                    directorsDetailed: processed.directorsDetailed || undefined,
                                    writersDetailed: processed.writersDetailed || undefined,
                                    producersDetailed: processed.producersDetailed || undefined,
                                    directors: processed.directors || undefined,
                                    writers: processed.writers || undefined,
                                    producers: processed.producers || undefined,
                                    guids: processed.guids || undefined,
                                    releaseDate: processed.releaseDate || undefined,
                                    runtimeMs: processed.runtimeMs || undefined,
                                    mediaStreams: processed.mediaStreams || undefined,
                                    collections: processed.collections || undefined,
                                    countries: processed.countries || undefined,
                                    audienceRating: processed.audienceRating || undefined,
                                    viewCount: processed.viewCount || undefined,
                                    skipCount: processed.skipCount || undefined,
                                    lastViewedAt: processed.lastViewedAt || undefined,
                                    userRating: processed.userRating || undefined,
                                    originalTitle: processed.originalTitle || undefined,
                                    titleSort: processed.titleSort || undefined,
                                    extras: processed.extras || undefined,
                                    related: processed.related || undefined,
                                    themeUrl: processed.themeUrl || undefined,
                                });
                            } catch (e) {
                                if (stats.errors.length < 3)
                                    stats.errors.push({ rawId, error: e.message });
                            }
                        }

                        logger.info('Selected items: Plex fetchItemsByIds summary', {
                            itemIdsCount: stats.itemIdsCount,
                            parsedOk: stats.parsedOk,
                            parseFailed: stats.parseFailed,
                            resolvedServerOk: stats.resolvedServerOk,
                            metaOk: stats.metaOk,
                            processedOk: stats.processedOk,
                            errorsSample: stats.errors,
                        });

                        // Attach bounded debug info for the JobQueue/UI (arrays are objects in JS).
                        try {
                            results.__selectedItemDebug = {
                                sourceType: 'plex',
                                ...stats,
                            };
                        } catch (_) {
                            // ignore
                        }

                        if (results.length === 0) {
                            logger.warn('Selected items: Plex fetchItemsByIds returned 0 items', {
                                itemIdsCount: stats.itemIdsCount,
                                itemIdsSample: ids.slice(0, 10),
                                errorsSample: stats.errors,
                            });
                        }

                        return results;
                    } catch (error) {
                        logger.error(
                            'Failed to fetch Plex selected items for local directory:',
                            error
                        );
                        return [];
                    }
                },
            },
            jellyfin: {
                fetchLibraryItems: async libraryId => {
                    try {
                        const serverConfig = (config.mediaServers || []).find(
                            s => s.type === 'jellyfin'
                        );
                        if (!serverConfig) return [];
                        const client = await getJellyfinClient(serverConfig);
                        const pageSize = 200;
                        let startIndex = 0;
                        const all = [];

                        while (true) {
                            const data = await client.getItems({
                                parentId: libraryId,
                                startIndex,
                                limit: pageSize,
                                recursive: true,
                                fields: [
                                    'Genres',
                                    'Overview',
                                    'CommunityRating',
                                    'OfficialRating',
                                    'UserData',
                                    'ProductionYear',
                                    'RunTimeTicks',
                                    'Taglines',
                                    'OriginalTitle',
                                    'ImageTags',
                                    'BackdropImageTags',
                                    'MediaStreams',
                                    'MediaSources',
                                    'People',
                                    'Studios',
                                    'ProviderIds',
                                    'Path',
                                    'Chapters',
                                    'CriticRating',
                                    'ParentId',
                                    'SeriesId',
                                    'SeasonId',
                                    'IndexNumber',
                                    'ParentIndexNumber',
                                    'ChildCount',
                                    'RecursiveItemCount',
                                    'LockedFields',
                                    'Status',
                                    'AirTime',
                                    'AirDays',
                                    'EndDate',
                                ],
                            });
                            const items = Array.isArray(data?.Items) ? data.Items : [];
                            if (items.length === 0) break;
                            for (const it of items) {
                                try {
                                    const processed = await processJellyfinItem(
                                        it,
                                        serverConfig,
                                        client
                                    );
                                    if (!processed) continue;
                                    all.push({
                                        title: processed.title,
                                        year: processed.year,
                                        id: processed.id,
                                        type: processed.type,
                                        poster: processed.posterUrl || processed.poster,
                                        background:
                                            processed.backgroundUrl || processed.backdropUrl,
                                        clearlogo: processed.clearLogoUrl || null,
                                        genres: Array.isArray(processed.genres)
                                            ? processed.genres
                                            : undefined,
                                        contentRating: processed.contentRating || undefined,
                                        qualityLabel: processed.qualityLabel || undefined,
                                        overview:
                                            processed.overview || processed.tagline || undefined,
                                        tagline: processed.tagline || undefined,
                                        imdbUrl: processed.imdbUrl || undefined,
                                        studios: processed.studios || undefined,
                                        cast: processed.cast || undefined,
                                        directors: processed.directors || undefined,
                                        writers: processed.writers || undefined,
                                        producers: processed.producers || undefined,
                                        directorsDetailed: processed.directorsDetailed || undefined,
                                        writersDetailed: processed.writersDetailed || undefined,
                                        producersDetailed: processed.producersDetailed || undefined,
                                        releaseDate: processed.releaseDate || undefined,
                                        runtimeMs: processed.runtimeMs || undefined,
                                        collections: processed.collections || undefined,
                                        countries: processed.countries || undefined,
                                        audienceRating: processed.audienceRating || undefined,
                                        rottenTomatoes: processed.rottenTomatoes || undefined,
                                        guids: processed.guids || undefined,
                                        mediaStreams: processed.mediaStreams || undefined,
                                        viewCount: processed.viewCount || undefined,
                                        skipCount: processed.skipCount || undefined,
                                        lastViewedAt: processed.lastViewedAt || undefined,
                                        userRating: processed.userRating || undefined,
                                        originalTitle: processed.originalTitle || undefined,
                                        titleSort: processed.titleSort || undefined,
                                        extras: processed.extras || undefined,
                                        related: processed.related || undefined,
                                        themeUrl: processed.themeUrl || undefined,
                                        // Phase 7: Jellyfin comprehensive fields
                                        seriesId: processed.seriesId || undefined,
                                        seriesName: processed.seriesName || undefined,
                                        seasonId: processed.seasonId || undefined,
                                        seasonName: processed.seasonName || undefined,
                                        parentId: processed.parentId || undefined,
                                        index: processed.index || undefined,
                                        parentIndex: processed.parentIndex || undefined,
                                        absoluteIndex: processed.absoluteIndex || undefined,
                                        viewOffset: processed.viewOffset || undefined,
                                        playedPercentage: processed.playedPercentage || undefined,
                                        leafCount: processed.leafCount || undefined,
                                        viewedLeafCount: processed.viewedLeafCount || undefined,
                                        recursiveItemCount:
                                            processed.recursiveItemCount || undefined,
                                        unplayedItemCount: processed.unplayedItemCount || undefined,
                                        isFavorite: processed.isFavorite || undefined,
                                        userLikes: processed.userLikes || undefined,
                                        artUrl: processed.artUrl || undefined,
                                        boxUrl: processed.boxUrl || undefined,
                                        screenshotUrl: processed.screenshotUrl || undefined,
                                        seriesThumbUrl: processed.seriesThumbUrl || undefined,
                                        parentThumbUrl: processed.parentThumbUrl || undefined,
                                        parentBackdropUrl: processed.parentBackdropUrl || undefined,
                                        parentArtUrl: processed.parentArtUrl || undefined,
                                        isHD: processed.isHD || undefined,
                                        hasChapters: processed.hasChapters || undefined,
                                        lockedFields: processed.lockedFields || undefined,
                                        lockData: processed.lockData || undefined,
                                        status: processed.status || undefined,
                                        airTime: processed.airTime || undefined,
                                        airDays: processed.airDays || undefined,
                                        endDate: processed.endDate || undefined,
                                        criticRatingSummary:
                                            processed.criticRatingSummary || undefined,
                                        // Plex compatibility aliases
                                        heroUrl: processed.heroUrl || undefined,
                                        compositeUrl: processed.compositeUrl || undefined,
                                        backgroundSquareUrl:
                                            processed.backgroundSquareUrl || undefined,
                                        parentKey: processed.parentKey || undefined,
                                        grandparentKey: processed.grandparentKey || undefined,
                                        parentTitle: processed.parentTitle || undefined,
                                        grandparentTitle: processed.grandparentTitle || undefined,
                                        parentThumb: processed.parentThumb || undefined,
                                        grandparentThumb: processed.grandparentThumb || undefined,
                                    });
                                } catch (e) {
                                    logger.warn(
                                        'Failed to process Jellyfin item for local directory',
                                        { itemId: it.Id, error: e.message }
                                    );
                                }
                            }
                            if (items.length < pageSize) break;
                            startIndex += pageSize;
                        }
                        return all;
                    } catch (error) {
                        logger.error(
                            'Failed to fetch Jellyfin library items for local directory:',
                            error
                        );
                        return [];
                    }
                },
                fetchItemsByIds: async itemIds => {
                    try {
                        const jfServers = Array.isArray(config.mediaServers)
                            ? config.mediaServers.filter(s => s && s.type === 'jellyfin')
                            : [];
                        if (jfServers.length === 0) return [];

                        const fields = [
                            'Genres',
                            'Overview',
                            'CommunityRating',
                            'OfficialRating',
                            'UserData',
                            'ProductionYear',
                            'RunTimeTicks',
                            'Taglines',
                            'OriginalTitle',
                            'ImageTags',
                            'BackdropImageTags',
                            'MediaStreams',
                            'MediaSources',
                            'People',
                            'Studios',
                            'ProviderIds',
                            'Path',
                            'Chapters',
                            'CriticRating',
                            'ParentId',
                            'SeriesId',
                            'SeasonId',
                            'IndexNumber',
                            'ParentIndexNumber',
                            'ChildCount',
                            'RecursiveItemCount',
                            'LockedFields',
                            'Status',
                            'AirTime',
                            'AirDays',
                            'EndDate',
                        ];

                        const parseJellyfinKey = raw => {
                            const v0 = String(raw || '').trim();
                            const v = v0.split('?')[0];
                            if (!v) return null;
                            const parts = v.split('_');
                            if (parts.length >= 2 && parts[0] === 'jellyfin') {
                                // jellyfin_<ServerName>_<ItemId> (server name may contain underscores)
                                if (parts.length >= 3) {
                                    return {
                                        serverName: parts.slice(1, -1).join('_') || null,
                                        itemId: parts[parts.length - 1],
                                    };
                                }
                                // jellyfin_<ItemId>
                                return { serverName: null, itemId: parts[1] };
                            }
                            return { serverName: null, itemId: v };
                        };

                        const resolveJellyfinServer = serverName => {
                            if (!serverName) return jfServers[0] || null;
                            const want = String(serverName).toLowerCase();
                            return (
                                jfServers.find(s => String(s.name || '').toLowerCase() === want) ||
                                jfServers[0] ||
                                null
                            );
                        };

                        const clientByServerName = new Map();

                        const out = [];
                        const ids = Array.isArray(itemIds) ? itemIds : [];

                        const stats = {
                            itemIdsCount: ids.length,
                            parsedOk: 0,
                            parseFailed: 0,
                            resolvedServerOk: 0,
                            serverAttempts: 0,
                            fallbackUsed: 0,
                            fetchedOk: 0,
                            processedOk: 0,
                            errors: [],
                        };

                        logger.info('Selected items: Jellyfin fetchItemsByIds called', {
                            itemIdsCount: ids.length,
                            itemIdsSample: ids.slice(0, 10),
                            servers: jfServers.map(s => s?.name).filter(Boolean),
                        });

                        for (const rawId of ids) {
                            const parsed = parseJellyfinKey(rawId);
                            const itemId = parsed?.itemId;
                            if (!itemId) {
                                stats.parseFailed++;
                                if (stats.errors.length < 3)
                                    stats.errors.push({
                                        rawId,
                                        error: 'Could not parse Jellyfin key',
                                    });
                                continue;
                            }
                            stats.parsedOk++;
                            const explicitServerName = parsed?.serverName || null;
                            const candidateServers = explicitServerName
                                ? [resolveJellyfinServer(explicitServerName)].filter(Boolean)
                                : jfServers;

                            if (!candidateServers || candidateServers.length === 0) {
                                if (stats.errors.length < 3)
                                    stats.errors.push({
                                        rawId,
                                        error: 'Could not resolve any Jellyfin server',
                                        parsedServerName: explicitServerName,
                                    });
                                continue;
                            }
                            stats.resolvedServerOk++;

                            let itemFound = false;
                            for (let i = 0; i < candidateServers.length; i++) {
                                const serverConfig = candidateServers[i];
                                if (!serverConfig) continue;
                                stats.serverAttempts++;

                                const cacheKey = String(serverConfig.name || '__default__');
                                let client = clientByServerName.get(cacheKey);
                                if (!client) {
                                    client = await getJellyfinClient(serverConfig);
                                    clientByServerName.set(cacheKey, client);
                                }

                                try {
                                    if (!client.getItem) {
                                        throw new Error('Jellyfin client missing getItem');
                                    }
                                    const it = await client.getItem(itemId, {
                                        fields,
                                        userId: serverConfig.userId,
                                    });
                                    if (!it) {
                                        if (stats.errors.length < 3)
                                            stats.errors.push({
                                                rawId,
                                                error: 'getItem returned null/undefined',
                                                itemId,
                                                serverNameTried: serverConfig.name || null,
                                            });
                                        continue;
                                    }
                                    stats.fetchedOk++;
                                    const processed = await processJellyfinItem(
                                        it,
                                        serverConfig,
                                        client
                                    );
                                    if (!processed) {
                                        if (stats.errors.length < 3)
                                            stats.errors.push({
                                                rawId,
                                                error: 'processJellyfinItem returned null/undefined',
                                                itemId,
                                                serverNameTried: serverConfig.name || null,
                                            });
                                        continue;
                                    }
                                    stats.processedOk++;
                                    out.push({
                                        title: processed.title,
                                        year: processed.year,
                                        id: processed.id,
                                        type: processed.type,
                                        poster: processed.posterUrl || processed.poster,
                                        background:
                                            processed.backgroundUrl || processed.backdropUrl,
                                        clearlogo: processed.clearLogoUrl || null,
                                        genres: Array.isArray(processed.genres)
                                            ? processed.genres
                                            : undefined,
                                        contentRating: processed.contentRating || undefined,
                                        qualityLabel: processed.qualityLabel || undefined,
                                        overview:
                                            processed.overview || processed.tagline || undefined,
                                        tagline: processed.tagline || undefined,
                                        imdbUrl: processed.imdbUrl || undefined,
                                        studios: processed.studios || undefined,
                                        cast: processed.cast || undefined,
                                        directors: processed.directors || undefined,
                                        writers: processed.writers || undefined,
                                        producers: processed.producers || undefined,
                                        directorsDetailed: processed.directorsDetailed || undefined,
                                        writersDetailed: processed.writersDetailed || undefined,
                                        producersDetailed: processed.producersDetailed || undefined,
                                        releaseDate: processed.releaseDate || undefined,
                                        runtimeMs: processed.runtimeMs || undefined,
                                        collections: processed.collections || undefined,
                                        countries: processed.countries || undefined,
                                        audienceRating: processed.audienceRating || undefined,
                                        rottenTomatoes: processed.rottenTomatoes || undefined,
                                        guids: processed.guids || undefined,
                                        mediaStreams: processed.mediaStreams || undefined,
                                        viewCount: processed.viewCount || undefined,
                                        skipCount: processed.skipCount || undefined,
                                        lastViewedAt: processed.lastViewedAt || undefined,
                                        userRating: processed.userRating || undefined,
                                        originalTitle: processed.originalTitle || undefined,
                                        titleSort: processed.titleSort || undefined,
                                        extras: processed.extras || undefined,
                                        related: processed.related || undefined,
                                        themeUrl: processed.themeUrl || undefined,
                                        seriesId: processed.seriesId || undefined,
                                        seriesName: processed.seriesName || undefined,
                                        seasonId: processed.seasonId || undefined,
                                        seasonName: processed.seasonName || undefined,
                                        parentId: processed.parentId || undefined,
                                        index: processed.index || undefined,
                                        parentIndex: processed.parentIndex || undefined,
                                        absoluteIndex: processed.absoluteIndex || undefined,
                                        viewOffset: processed.viewOffset || undefined,
                                    });
                                    itemFound = true;
                                    if (!explicitServerName && i > 0) stats.fallbackUsed++;
                                    break;
                                } catch (e) {
                                    const status = e?.response?.status;
                                    const url = (() => {
                                        try {
                                            const u = e?.response?.config?.url;
                                            return u ? String(u) : undefined;
                                        } catch (_) {
                                            return undefined;
                                        }
                                    })();
                                    // If the key is not server-qualified and we have multiple servers,
                                    // a 404 commonly means “this item belongs to a different server”.
                                    if (
                                        !explicitServerName &&
                                        status === 404 &&
                                        i < candidateServers.length - 1
                                    ) {
                                        continue;
                                    }
                                    if (stats.errors.length < 3)
                                        stats.errors.push({
                                            rawId,
                                            itemId,
                                            error: e.message,
                                            status,
                                            url,
                                            serverNameTried: serverConfig.name || null,
                                        });
                                    break;
                                }
                            }

                            if (!itemFound) {
                                // Keep going; stats/errors already captured.
                                continue;
                            }
                        }

                        logger.info('Selected items: Jellyfin fetchItemsByIds summary', {
                            itemIdsCount: stats.itemIdsCount,
                            parsedOk: stats.parsedOk,
                            parseFailed: stats.parseFailed,
                            resolvedServerOk: stats.resolvedServerOk,
                            fetchedOk: stats.fetchedOk,
                            processedOk: stats.processedOk,
                            errorsSample: stats.errors,
                        });

                        // Attach bounded debug info for the JobQueue/UI (arrays are objects in JS).
                        try {
                            out.__selectedItemDebug = {
                                sourceType: 'jellyfin',
                                ...stats,
                            };
                        } catch (_) {
                            // ignore
                        }

                        if (out.length === 0) {
                            logger.warn(
                                'Selected items: Jellyfin fetchItemsByIds returned 0 items',
                                {
                                    itemIdsCount: stats.itemIdsCount,
                                    itemIdsSample: ids.slice(0, 10),
                                    errorsSample: stats.errors,
                                }
                            );
                        }

                        return out;
                    } catch (error) {
                        logger.error(
                            'Failed to fetch Jellyfin selected items for local directory:',
                            error
                        );
                        return [];
                    }
                },
            },
        };

        const baseUrl = `http://127.0.0.1:${port}`;

        // Create axios-compatible HTTP clients for image downloads via image proxy
        const axios = require('axios');
        // @ts-ignore - axios.create is valid but require() doesn't map types correctly
        const imageProxyClient = axios.create({
            baseURL: baseUrl,
            timeout: 30000,
        });

        httpClients = {
            plex: imageProxyClient,
            jellyfin: imageProxyClient,
            plexClient: {
                getLibraries: async () => {
                    const res = await fetch(`${baseUrl}/api/sources/plex/libraries`);
                    if (!res.ok)
                        throw new Error(`Failed to fetch Plex libraries: ${res.statusText}`);
                    const data = await res.json();
                    return data.libraries || [];
                },
            },
            jellyfinClient: {
                getLibraries: async () => {
                    const res = await fetch(`${baseUrl}/api/sources/jellyfin/libraries`);
                    if (!res.ok)
                        throw new Error(`Failed to fetch Jellyfin libraries: ${res.statusText}`);
                    const data = await res.json();
                    return data.libraries || [];
                },
            },
        };

        // Set up local directory event handlers
        if (localDirectorySource?.events?.on) {
            const debounce = (fn, wait) => {
                let t = null;
                return (...args) => {
                    clearTimeout(t);
                    t = setTimeout(() => fn(...args), wait);
                };
            };

            const refreshAfterLocalChange = async why => {
                logger.info(`[Local Media] Refreshing playlist after ${why}`);
                try {
                    const { refreshPlaylistCache } = require('../lib/playlist-cache');
                    // @ts-ignore - refreshPlaylistCache will use defaults
                    await refreshPlaylistCache();
                } catch (e) {
                    logger.warn('[Local Media] Refresh failed:', e);
                }
            };

            const debouncedRefresh = debounce(refreshAfterLocalChange, 2000);

            localDirectorySource.events.on('media-changed', ev => debouncedRefresh(ev?.kind));
            localDirectorySource.events.on('posterpacks-changed', ev =>
                debouncedRefresh(`posterpack:${ev?.kind || 'changed'}`)
            );
        }

        // Inject source adapters and HTTP clients into job queue
        if (jobQueue && sourceAdapters) {
            jobQueue.setSourceAdapters(sourceAdapters);
        }
        if (jobQueue && httpClients) {
            jobQueue.setHttpClients(httpClients);
        }
    }

    return {
        jobQueue,
        localDirectorySource,
        uploadMiddleware,
        sourceAdapters,
        httpClients,
    };
}
module.exports = { initializeLocalDirectory };
