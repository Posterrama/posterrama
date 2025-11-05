/**
 * Media Sources Manager
 * Centralized management of all media sources (Plex, Jellyfin, TMDB, RomM, Local)
 * Handles initialization, caching, and media fetching across all sources
 */

const logger = require('./logger');

// Source adapters
const PlexSource = require('../sources/plex');
const JellyfinSource = require('../sources/jellyfin');
const TMDBSource = require('../sources/tmdb');
const RommSource = require('../sources/romm');
const LocalSource = require('../sources/local');

// Helper imports
const { getPlexClient, getPlexLibraries, processPlexItem } = require('../lib/plex-helpers');
const {
    getJellyfinClient,
    getJellyfinLibraries,
    processJellyfinItem,
} = require('../lib/jellyfin-helpers');

class MediaSourcesManager {
    constructor(config, helpers) {
        this.config = config;
        this.helpers = helpers || {};
        this.sources = new Map();
        this.cache = new Map();
        this.isDebug = helpers.isDebug || false;

        // Extract helpers
        this.shuffleArray = helpers.shuffleArray;
        this.rtMinScore = helpers.rtMinScore || 0;
    }

    /**
     * Initialize all enabled media sources from config
     * @returns {Promise<void>}
     */
    async initializeSources() {
        logger.info('[MediaSourcesManager] Initializing media sources...');

        // Initialize Plex sources
        if (this.config.mediaServers) {
            for (const server of this.config.mediaServers) {
                if (!server.enabled) continue;

                try {
                    if (server.type === 'plex') {
                        await this.initializePlexSource(server);
                    } else if (server.type === 'jellyfin') {
                        await this.initializeJellyfinSource(server);
                    } else if (server.type === 'romm') {
                        await this.initializeRommSource(server);
                    }
                } catch (error) {
                    logger.error(
                        `[MediaSourcesManager] Failed to initialize ${server.type} source "${server.name}":`,
                        error.message
                    );
                }
            }
        }

        // Initialize TMDB source
        if (this.config.tmdbSource?.enabled) {
            await this.initializeTmdbSource(this.config.tmdbSource);
        }

        // Initialize Local source
        if (this.config.localSource?.enabled) {
            await this.initializeLocalSource(this.config.localSource);
        }

        logger.info(`[MediaSourcesManager] Initialized ${this.sources.size} media sources`);
    }

    /**
     * Initialize Plex source
     */
    async initializePlexSource(serverConfig) {
        const sourceKey = `plex_${serverConfig.name}`;

        const source = new PlexSource(
            serverConfig,
            getPlexClient,
            processPlexItem,
            getPlexLibraries,
            this.shuffleArray,
            this.rtMinScore,
            this.isDebug
        );

        this.sources.set(sourceKey, {
            type: 'plex',
            name: serverConfig.name,
            source,
            config: serverConfig,
        });

        logger.info(`[MediaSourcesManager] Initialized Plex source: ${serverConfig.name}`);
    }

    /**
     * Initialize Jellyfin source
     */
    async initializeJellyfinSource(serverConfig) {
        const sourceKey = `jellyfin_${serverConfig.name}`;

        const source = new JellyfinSource(
            serverConfig,
            getJellyfinClient,
            processJellyfinItem,
            getJellyfinLibraries,
            this.shuffleArray,
            this.rtMinScore,
            this.isDebug
        );

        this.sources.set(sourceKey, {
            type: 'jellyfin',
            name: serverConfig.name,
            source,
            config: serverConfig,
        });

        logger.info(`[MediaSourcesManager] Initialized Jellyfin source: ${serverConfig.name}`);
    }

    /**
     * Initialize RomM source
     */
    async initializeRommSource(serverConfig) {
        const sourceKey = `romm_${serverConfig.name}`;

        const source = new RommSource(serverConfig, this.shuffleArray, this.isDebug);

        this.sources.set(sourceKey, {
            type: 'romm',
            name: serverConfig.name,
            source,
            config: serverConfig,
        });

        logger.info(`[MediaSourcesManager] Initialized RomM source: ${serverConfig.name}`);
    }

    /**
     * Initialize TMDB source
     */
    async initializeTmdbSource(tmdbConfig) {
        const source = new TMDBSource(tmdbConfig, this.shuffleArray, this.isDebug);

        this.sources.set('tmdb', {
            type: 'tmdb',
            name: 'TMDB',
            source,
            config: tmdbConfig,
        });

        logger.info('[MediaSourcesManager] Initialized TMDB source');
    }

    /**
     * Initialize Local source
     */
    async initializeLocalSource(localConfig) {
        const source = new LocalSource(localConfig, this.isDebug);

        this.sources.set('local', {
            type: 'local',
            name: 'Local',
            source,
            config: localConfig,
        });

        logger.info('[MediaSourcesManager] Initialized Local source');
    }

    /**
     * Get all sources of a specific type
     * @param {string} type - Source type (plex, jellyfin, romm, tmdb, local)
     * @returns {Array} Array of source wrappers
     */
    getSourcesByType(type) {
        return Array.from(this.sources.values()).filter(s => s.type === type);
    }

    /**
     * Get source by key
     * @param {string} key - Source key (e.g., 'plex_ServerName', 'romm_GameServer')
     * @returns {Object|null} Source wrapper or null
     */
    getSource(key) {
        return this.sources.get(key) || null;
    }

    /**
     * Get all enabled sources
     * @returns {Array} Array of all source wrappers
     */
    getAllSources() {
        return Array.from(this.sources.values());
    }

    /**
     * Fetch media from specified source and type
     * @param {string} sourceType - Source type (plex, jellyfin, romm, tmdb, local, all)
     * @param {string} mediaType - Media type (movie, show, game)
     * @param {number} count - Number of items to fetch
     * @param {Object} options - Additional options (libraries, platforms, etc.)
     * @returns {Promise<Array>} Array of media items
     */
    async fetchMedia(sourceType, mediaType, count = 50, options = {}) {
        const { libraries, platforms, sourceName } = options;

        // Handle 'all' sources
        if (sourceType === 'all') {
            return this.fetchFromAllSources(mediaType, count, options);
        }

        // Fetch from specific source type
        const sources = sourceName
            ? [this.getSource(`${sourceType}_${sourceName}`)]
            : this.getSourcesByType(sourceType);

        if (sources.length === 0 || sources.every(s => !s)) {
            logger.warn(`[MediaSourcesManager] No ${sourceType} sources found or enabled`);
            return [];
        }

        const allMedia = [];

        for (const sourceWrapper of sources.filter(Boolean)) {
            try {
                let items;

                if (sourceType === 'romm') {
                    // RomM only supports 'game' type
                    if (mediaType !== 'game') {
                        continue;
                    }
                    items = await sourceWrapper.source.fetchMedia(
                        platforms || 'all',
                        'game',
                        count
                    );
                } else if (sourceType === 'tmdb') {
                    items = await sourceWrapper.source.fetchMedia(mediaType, count);
                } else if (sourceType === 'local') {
                    items = await sourceWrapper.source.fetchMedia(count);
                } else {
                    // Plex/Jellyfin
                    items = await sourceWrapper.source.fetchMedia(
                        libraries || 'all',
                        mediaType,
                        count
                    );
                }

                if (items && items.length > 0) {
                    allMedia.push(...items);
                }
            } catch (error) {
                logger.error(
                    `[MediaSourcesManager] Error fetching from ${sourceWrapper.name}:`,
                    error.message
                );
            }
        }

        // Shuffle and limit combined results
        if (this.shuffleArray && allMedia.length > 0) {
            const shuffled = this.shuffleArray(allMedia);
            return shuffled.slice(0, count);
        }

        return allMedia.slice(0, count);
    }

    /**
     * Fetch media from all enabled sources
     */
    async fetchFromAllSources(mediaType, count, options) {
        const allMedia = [];

        // Fetch from Plex sources
        const plexSources = this.getSourcesByType('plex');
        for (const source of plexSources) {
            try {
                const items = await source.source.fetchMedia(
                    options.libraries || 'all',
                    mediaType,
                    Math.ceil(count / 3)
                );
                if (items) allMedia.push(...items);
            } catch (error) {
                logger.error(
                    `[MediaSourcesManager] Error fetching from Plex ${source.name}:`,
                    error.message
                );
            }
        }

        // Fetch from Jellyfin sources
        const jellyfinSources = this.getSourcesByType('jellyfin');
        for (const source of jellyfinSources) {
            try {
                const items = await source.source.fetchMedia(
                    options.libraries || 'all',
                    mediaType,
                    Math.ceil(count / 3)
                );
                if (items) allMedia.push(...items);
            } catch (error) {
                logger.error(
                    `[MediaSourcesManager] Error fetching from Jellyfin ${source.name}:`,
                    error.message
                );
            }
        }

        // Fetch from RomM sources (only for games)
        if (mediaType === 'game') {
            const rommSources = this.getSourcesByType('romm');
            for (const source of rommSources) {
                try {
                    const items = await source.source.fetchMedia(
                        options.platforms || 'all',
                        'game',
                        Math.ceil(count / 3)
                    );
                    if (items) allMedia.push(...items);
                } catch (error) {
                    logger.error(
                        `[MediaSourcesManager] Error fetching from RomM ${source.name}:`,
                        error.message
                    );
                }
            }
        }

        // Fetch from TMDB
        const tmdbSource = this.getSource('tmdb');
        if (tmdbSource && mediaType !== 'game') {
            try {
                const items = await tmdbSource.source.fetchMedia(mediaType, Math.ceil(count / 3));
                if (items) allMedia.push(...items);
            } catch (error) {
                logger.error('[MediaSourcesManager] Error fetching from TMDB:', error.message);
            }
        }

        // Shuffle and limit
        if (this.shuffleArray && allMedia.length > 0) {
            const shuffled = this.shuffleArray(allMedia);
            return shuffled.slice(0, count);
        }

        return allMedia.slice(0, count);
    }

    /**
     * Get metrics from all sources
     * @returns {Object} Metrics by source
     */
    getMetrics() {
        const metrics = {};

        for (const [key, wrapper] of this.sources.entries()) {
            if (wrapper.source.getMetrics) {
                metrics[key] = wrapper.source.getMetrics();
            }
        }

        return metrics;
    }

    /**
     * Reset metrics for all sources
     */
    resetMetrics() {
        for (const wrapper of this.sources.values()) {
            if (wrapper.source.resetMetrics) {
                wrapper.source.resetMetrics();
            }
        }
    }

    /**
     * Reload sources after config change
     */
    async reloadSources(newConfig) {
        this.config = newConfig;
        this.sources.clear();
        this.cache.clear();
        await this.initializeSources();
    }
}

module.exports = MediaSourcesManager;
