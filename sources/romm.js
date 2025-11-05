/**
 * RomM media source for posterrama.app
 * Handles fetching and processing game ROMs from a RomM server.
 */
const logger = require('../utils/logger');
const RommHttpClient = require('../utils/romm-http-client');

class RommSource {
    constructor(serverConfig, shuffleArray, isDebug) {
        this.server = serverConfig;
        this.shuffleArray = shuffleArray;
        this.isDebug = isDebug;

        // Initialize HTTP client
        this.client = null;

        if (this.isDebug) {
            logger.info(`[RommSource:${this.server.name}] Initialized RomM source`, {
                url: this.server.url,
                selectedPlatforms: this.server.selectedPlatforms || 'all',
            });
        }

        // Performance metrics
        this.metrics = {
            requestCount: 0,
            itemsProcessed: 0,
            itemsFiltered: 0,
            averageProcessingTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };

        // Cache
        this.cachedMedia = null;
        this.lastFetch = null;
        this.cacheDuration = 3600000; // 1 hour
    }

    /**
     * Get or create RomM HTTP client
     * @returns {Promise<RommHttpClient>}
     */
    async getClient() {
        if (this.client) {
            return this.client;
        }

        try {
            // Parse URL to extract hostname and port
            const url = new URL(this.server.url);
            const hostname = url.hostname;
            const port = url.port || (url.protocol === 'https:' ? 443 : 80);

            this.client = new RommHttpClient({
                hostname,
                port,
                username: this.server.username,
                password: this.server.password,
                basePath: url.pathname !== '/' ? url.pathname : '',
                insecureHttps: this.server.insecureHttps || false,
                timeout: this.server.timeout || 15000,
            });

            // Authenticate on first use
            await this.client.authenticate();

            logger.info(`[RommSource:${this.server.name}] Client initialized and authenticated`);
            return this.client;
        } catch (error) {
            logger.error(
                `[RommSource:${this.server.name}] Failed to initialize client:`,
                error.message
            );
            throw error;
        }
    }

    /**
     * Get performance metrics
     * @returns {object} Current performance metrics
     */
    getMetrics() {
        const filterEfficiency =
            this.metrics.itemsProcessed > 0
                ? this.metrics.itemsFiltered / this.metrics.itemsProcessed
                : 0;

        return {
            totalItems: this.cachedMedia ? this.cachedMedia.length : 0,
            lastFetch: this.lastFetch,
            cacheDuration: this.cacheDuration,
            requestCount: this.metrics.requestCount,
            itemsProcessed: this.metrics.itemsProcessed,
            itemsFiltered: this.metrics.itemsFiltered,
            averageProcessingTime: this.metrics.averageProcessingTime,
            lastRequestTime: this.metrics.lastRequestTime,
            errorCount: this.metrics.errorCount,
            filterEfficiency,
        };
    }

    /**
     * Reset performance metrics
     */
    resetMetrics() {
        this.metrics = {
            requestCount: 0,
            itemsProcessed: 0,
            itemsFiltered: 0,
            averageProcessingTime: 0,
            lastRequestTime: null,
            errorCount: 0,
        };
    }

    /**
     * Get available platforms from RomM server
     * @returns {Promise<Array>} Array of platform objects
     */
    async getAvailablePlatforms() {
        try {
            const client = await this.getClient();
            const platforms = await client.getPlatforms();

            return platforms.map(platform => ({
                id: platform.id,
                slug: platform.slug,
                name: platform.display_name || platform.name,
                romCount: platform.rom_count || 0,
            }));
        } catch (error) {
            logger.error(
                `[RommSource:${this.server.name}] Failed to fetch platforms:`,
                error.message
            );
            return [];
        }
    }

    /**
     * Process RomM ROM item to Posterrama format
     * @param {Object} rom - RomM ROM object
     * @returns {Object} Posterrama media item
     */
    processRomItem(rom) {
        const serverName = this.server.name;

        // Build composite key
        const sourceId = `romm_${serverName}_${rom.id}`;

        return {
            // Core identification
            id: sourceId,
            sourceId: sourceId,
            key: sourceId,
            title: rom.name || rom.fs_name_no_ext,
            slug: rom.slug || null,
            overview: rom.summary || null,
            type: 'game',
            source: 'romm',
            serverName: serverName,

            // Images
            poster: rom.url_cover || null,
            posterUrl: rom.url_cover || null,
            thumb: rom.url_cover || null,
            backgroundUrl: null, // RomM doesn't have background images for ROMs

            // Game-specific fields
            platform: rom.platform_name || 'Unknown',
            platformId: rom.platform_id,
            platformSlug: rom.platform_slug || null,

            // Metadata
            genres: rom.metadatum?.genres || [],
            rating: rom.metadatum?.average_rating || null,
            releaseDate: rom.metadatum?.first_release_date || null,
            year: rom.metadatum?.first_release_date
                ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
                : null,

            // Additional info
            igdbId: rom.igdb_id || null,
            alternativeNames: rom.alternative_names || [],
            languages: rom.languages || [],
            regions: rom.regions || [],

            // File info
            fileSize: rom.fs_size_bytes || 0,
            fileName: rom.fs_name || null,
            multi: rom.multi || false,

            // RetroAchievements
            raId: rom.ra_id || null,
            hasRetroAchievements: Boolean(rom.ra_id),
            achievements: null, // Will be populated if merged_ra_metadata exists
            achievementCount: 0,
            achievementEarned: 0,

            // User data (if available)
            isFavorite: rom.rom_user?.is_favorite || false,
            lastPlayed: rom.rom_user?.last_played || null,

            // Original data for reference
            originalData: {
                rommId: rom.id,
                igdbMetadata: rom.igdb_metadata || null,
                hasManual: rom.has_manual || false,
            },
        };
    }

    /**
     * Apply filters to ROM list
     * @param {Array} roms - Array of ROM objects
     * @returns {Array} Filtered ROMs
     */
    applyFilters(roms) {
        if (!this.server.filters) {
            return roms;
        }

        let filtered = roms;

        // Filter: Favorites only
        if (this.server.filters.favouritesOnly) {
            filtered = filtered.filter(rom => rom.rom_user?.is_favorite);
        }

        // Filter: Playable only
        if (this.server.filters.playableOnly) {
            filtered = filtered.filter(rom => rom.playable);
        }

        // Filter: Exclude unidentified
        if (this.server.filters.excludeUnidentified) {
            filtered = filtered.filter(rom => rom.is_identified);
        }

        return filtered;
    }

    /**
     * Fetch media from RomM server
     * @param {Array} platforms - Platform slugs to fetch (or 'all')
     * @param {string} type - Media type (should be 'game')
     * @param {number} count - Number of items to return
     * @returns {Promise<Array>} Array of media items
     */
    async fetchMedia(platforms = 'all', type = 'game', count = 50) {
        const startTime = Date.now();
        this.metrics.requestCount++;
        this.metrics.lastRequestTime = new Date().toISOString();

        try {
            // Only handle game type
            if (type !== 'game') {
                logger.warn(
                    `[RommSource:${this.server.name}] Invalid type requested: ${type}, RomM only supports 'game'`
                );
                return [];
            }

            const client = await this.getClient();

            // Get list of platforms to fetch
            let platformsToFetch = [];
            if (platforms === 'all' || !platforms || platforms.length === 0) {
                // Fetch all platforms if no selection
                const allPlatforms = await this.getAvailablePlatforms();
                platformsToFetch = allPlatforms.map(p => p.id);
            } else if (this.server.selectedPlatforms && this.server.selectedPlatforms.length > 0) {
                // Use configured platforms
                const allPlatforms = await this.getAvailablePlatforms();
                const platformMap = new Map(allPlatforms.map(p => [p.slug, p.id]));
                platformsToFetch = this.server.selectedPlatforms
                    .map(slug => platformMap.get(slug))
                    .filter(Boolean);
            }

            if (platformsToFetch.length === 0) {
                logger.warn(`[RommSource:${this.server.name}] No platforms to fetch`);
                return [];
            }

            // Fetch ROMs from all selected platforms with pagination
            const allRoms = [];
            let platformsFetched = 0;

            for (const platformId of platformsToFetch) {
                try {
                    let offset = 0;
                    const limit = 500;
                    let hasMore = true;
                    let platformRomCount = 0;

                    // Paginate through all ROMs for this platform
                    while (hasMore) {
                        const queryParams = {
                            platform_id: platformId,
                            limit: limit,
                            offset: offset,
                        };

                        const response = await client.getRoms(queryParams);

                        if (response.items && Array.isArray(response.items)) {
                            allRoms.push(...response.items);
                            platformRomCount += response.items.length;

                            // Check if there are more pages
                            // If we got fewer items than limit, we've reached the end
                            hasMore = response.items.length === limit;
                            offset += limit;
                        } else {
                            hasMore = false;
                        }
                    }

                    platformsFetched++;
                    if (this.isDebug && platformRomCount > 0) {
                        logger.debug(
                            `[RommSource:${this.server.name}] Fetched ${platformRomCount} ROMs from platform ${platformId}`
                        );
                    }
                } catch (error) {
                    logger.warn(
                        `[RommSource:${this.server.name}] Failed to fetch platform ${platformId}:`,
                        error.message
                    );
                    this.metrics.errorCount++;
                }
            }

            this.metrics.itemsProcessed = allRoms.length;

            // Note: Filters are now applied at the API level (favourite, playable, matched params)
            // No need for client-side filtering anymore
            this.metrics.itemsFiltered = 0;

            // Process ROMs to Posterrama format
            let processedItems = allRoms.map(rom => this.processRomItem(rom));

            // Shuffle and limit
            processedItems = this.shuffleArray(processedItems);
            processedItems = processedItems.slice(0, count);

            // Update metrics
            const processingTime = Date.now() - startTime;
            this.metrics.averageProcessingTime =
                this.metrics.requestCount === 1
                    ? processingTime
                    : (this.metrics.averageProcessingTime + processingTime) / 2;

            // Cache results
            this.cachedMedia = processedItems;
            this.lastFetch = new Date().toISOString();

            logger.info(
                `[RommSource:${this.server.name}] Fetched ${processedItems.length} games in ${processingTime}ms`,
                {
                    platforms: platformsToFetch.length,
                    totalRoms: allRoms.length,
                    limitApplied: count,
                }
            );

            return processedItems;
        } catch (error) {
            this.metrics.errorCount++;
            logger.error(`[RommSource:${this.server.name}] Error fetching media:`, error);
            throw error;
        }
    }

    /**
     * Test connection to RomM server
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            const client = await this.getClient();
            return await client.testConnection();
        } catch (error) {
            logger.error(`[RommSource:${this.server.name}] Connection test failed:`, error.message);
            return false;
        }
    }
}

module.exports = RommSource;
