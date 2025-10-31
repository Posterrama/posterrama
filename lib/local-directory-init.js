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
        localDirectorySource = new LocalDirectorySource(config.localDirectory, logger);
        uploadMiddleware = createUploadMiddleware(config.localDirectory);

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
                                const processed = await processPlexItem(
                                    summary,
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
                        // eslint-disable-next-line no-constant-condition
                        while (true) {
                            const data = await client.getItems({
                                parentId: libraryId,
                                startIndex,
                                limit: pageSize,
                                recursive: true,
                            });
                            const items = Array.isArray(data?.Items) ? data.Items : [];
                            if (items.length === 0) break;
                            for (const it of items) {
                                try {
                                    const processed = processJellyfinItem(it, serverConfig, client);
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
                                        releaseDate: processed.releaseDate || undefined,
                                        runtimeMs: processed.runtimeMs || undefined,
                                        collections: processed.collections || undefined,
                                        countries: processed.countries || undefined,
                                        audienceRating: processed.audienceRating || undefined,
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
            },
        };

        const baseUrl = `http://127.0.0.1:${port}`;

        // Create axios-compatible HTTP clients for image downloads via image proxy
        const axios = require('axios');
        const imageProxyClient = axios.create({
            baseURL: baseUrl,
            timeout: 30000,
            maxRedirects: 5,
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
