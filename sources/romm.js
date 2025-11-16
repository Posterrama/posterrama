/**
 * RomM media source for posterrama.app
 * Handles fetching and processing game ROMs from a RomM server.
 */
const logger = require('../utils/logger');
const RommHttpClient = require('../utils/romm-http-client');
const { logSourceError, metadataExtractors } = require('../utils/source-error-context');

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

            // Resolve password from direct value or environment variable (like Plex tokenEnvVar)
            const password =
                this.server.password ||
                (this.server.passwordEnvVar ? process.env[this.server.passwordEnvVar] : undefined);

            this.client = new RommHttpClient({
                hostname,
                port,
                username: this.server.username,
                password: password,
                basePath: url.pathname !== '/' ? url.pathname : '',
                insecureHttps: this.server.insecureHttps || false,
                timeout: this.server.timeout || 15000,
            });

            // Authenticate on first use
            await this.client.authenticate();

            logger.info(`[RommSource:${this.server.name}] Client initialized and authenticated`);
            return this.client;
        } catch (error) {
            logSourceError(logger, {
                source: `romm:${this.server.name}`,
                operation: 'getClient',
                error,
                metadata: metadataExtractors.connection(this.server),
            });
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
            logSourceError(logger, {
                source: `romm:${this.server.name}`,
                operation: 'getPlatforms',
                error,
                metadata: metadataExtractors.connection(this.server),
            });
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

        // Extract all provider IDs
        const providerIds = {
            igdb: rom.igdb_id || null,
            sgdb: rom.sgdb_id || null,
            moby: rom.moby_id || null,
            screenscraper: rom.ss_id || null,
            retroachievements: rom.ra_id || null,
            launchbox: rom.launchbox_id || null,
            hasheous: rom.hasheous_id || null,
            tgdb: rom.tgdb_id || null,
        };

        // Process IGDB metadata if available
        let igdbData = null;
        if (rom.igdb_metadata) {
            igdbData = {
                totalRating: rom.igdb_metadata.total_rating || null,
                aggregatedRating: rom.igdb_metadata.aggregated_rating || null,
                firstReleaseDate: rom.igdb_metadata.first_release_date || null,
                youtubeVideoId: rom.igdb_metadata.youtube_video_id || null,
                genres: rom.igdb_metadata.genres || [],
                franchises: rom.igdb_metadata.franchises || [],
                alternativeNames: rom.igdb_metadata.alternative_names || [],
                collections: rom.igdb_metadata.collections || [],
                companies: rom.igdb_metadata.companies || [],
                gameModes: rom.igdb_metadata.game_modes || [],
                ageRatings: rom.igdb_metadata.age_ratings || [],
                platforms: rom.igdb_metadata.platforms || [],
                expansions: rom.igdb_metadata.expansions || [],
                dlcs: rom.igdb_metadata.dlcs || [],
                remasters: rom.igdb_metadata.remasters || [],
                remakes: rom.igdb_metadata.remakes || [],
                expandedGames: rom.igdb_metadata.expanded_games || [],
                ports: rom.igdb_metadata.ports || [],
                similarGames: rom.igdb_metadata.similar_games || [],
            };
        }

        // Process Moby metadata if available
        let mobyData = null;
        if (rom.moby_metadata) {
            mobyData = {
                mobyScore: rom.moby_metadata.moby_score || null,
                genres: rom.moby_metadata.genres || [],
                alternateTitles: rom.moby_metadata.alternate_titles || [],
                platforms: rom.moby_metadata.platforms || [],
            };
        }

        // Process LaunchBox metadata if available
        let launchboxData = null;
        if (rom.launchbox_metadata) {
            launchboxData = {
                firstReleaseDate: rom.launchbox_metadata.first_release_date || null,
                maxPlayers: rom.launchbox_metadata.max_players || null,
                releaseType: rom.launchbox_metadata.release_type || null,
                cooperative: rom.launchbox_metadata.cooperative || false,
                youtubeVideoId: rom.launchbox_metadata.youtube_video_id || null,
                communityRating: rom.launchbox_metadata.community_rating || null,
                communityRatingCount: rom.launchbox_metadata.community_rating_count || null,
            };
        }

        // Process RetroAchievements metadata if available
        let retroAchievementsData = null;
        if (rom.merged_ra_metadata) {
            retroAchievementsData = {
                totalAchievements: rom.merged_ra_metadata.total_achievements || 0,
                earnedAchievements: rom.merged_ra_metadata.earned_achievements || 0,
                hardcore: rom.merged_ra_metadata.hardcore || false,
                points: rom.merged_ra_metadata.points || 0,
                retroPoints: rom.merged_ra_metadata.retro_points || 0,
                achievements: rom.merged_ra_metadata.achievements || [],
            };
        }

        return {
            // Core identification
            id: sourceId,
            sourceId: sourceId,
            key: sourceId,
            title: rom.name || rom.fs_name_no_ext,
            slug: rom.slug || null,
            overview: rom.summary || null,
            tagline: null,
            type: 'game',
            source: 'romm',
            serverName: serverName,

            // Images
            poster: rom.url_cover || null,
            posterUrl: rom.url_cover || null,
            thumb: rom.url_cover || null,
            thumbnailUrl: rom.url_cover || null,
            backgroundUrl: null, // RomM doesn't have background images for ROMs
            clearLogoUrl: null,
            screenshots: rom.merged_screenshots || [],

            // Game-specific fields
            platform: rom.platform_name || 'Unknown',
            platformId: rom.platform_id,
            platformSlug: rom.platform_slug || null,
            platformDisplayName: rom.platform_display_name || rom.platform_name || null,
            platformCustomName: rom.platform_custom_name || null,

            // Metadata - Unified from all sources
            genres: rom.metadatum?.genres || igdbData?.genres || mobyData?.genres || [],
            franchises: rom.metadatum?.franchises || igdbData?.franchises || [],
            collections: rom.metadatum?.collections || igdbData?.collections || [],
            companies: rom.metadatum?.companies || igdbData?.companies || [],
            gameModes: rom.metadatum?.game_modes || igdbData?.gameModes || [],
            ageRatings: rom.metadatum?.age_ratings || [],
            contentRating: rom.metadatum?.age_ratings?.[0] || null,

            // Ratings
            rating: rom.metadatum?.average_rating || null,
            communityRating: igdbData?.totalRating || launchboxData?.communityRating || null,
            aggregatedRating: igdbData?.aggregatedRating || null,
            mobyScore: mobyData?.mobyScore || null,

            // Release info
            releaseDate: rom.metadatum?.first_release_date || igdbData?.firstReleaseDate || null,
            year: rom.metadatum?.first_release_date
                ? new Date(rom.metadatum.first_release_date * 1000).getFullYear()
                : null,

            // Alternative names and localization
            alternativeNames: rom.alternative_names || igdbData?.alternativeNames || [],
            languages: rom.languages || [],
            regions: rom.regions || [],
            tags: rom.tags || [],
            revision: rom.revision || null,

            // Provider IDs
            providerIds: providerIds,
            igdbId: rom.igdb_id || null,
            sgdbId: rom.sgdb_id || null,
            mobyId: rom.moby_id || null,
            screenperId: rom.ss_id || null,
            raId: rom.ra_id || null,
            launchboxId: rom.launchbox_id || null,
            hasheousId: rom.hasheous_id || null,
            tgdbId: rom.tgdb_id || null,

            // File info
            fileSize: rom.fs_size_bytes || 0,
            fileName: rom.fs_name || null,
            fileNameNoTags: rom.fs_name_no_tags || null,
            fileNameNoExt: rom.fs_name_no_ext || null,
            fileExtension: rom.fs_extension || null,
            filePath: rom.fs_path || null,
            fullPath: rom.full_path || null,
            multi: rom.multi || false,
            files: rom.files || [],

            // Hashes
            crcHash: rom.crc_hash || null,
            md5Hash: rom.md5_hash || null,
            sha1Hash: rom.sha1_hash || null,

            // Manual/Documentation
            hasManual: rom.has_manual || false,
            pathManual: rom.path_manual || null,
            urlManual: rom.url_manual || null,

            // Video
            youtubeVideoId:
                rom.youtube_video_id ||
                igdbData?.youtubeVideoId ||
                launchboxData?.youtubeVideoId ||
                null,

            // RetroAchievements
            hasRetroAchievements: Boolean(rom.ra_id),
            retroAchievements: retroAchievementsData,
            achievementCount: retroAchievementsData?.totalAchievements || 0,
            achievementEarned: retroAchievementsData?.earnedAchievements || 0,

            // Related games (from IGDB)
            relatedGames: igdbData
                ? {
                      expansions: igdbData.expansions,
                      dlcs: igdbData.dlcs,
                      remasters: igdbData.remasters,
                      remakes: igdbData.remakes,
                      expandedGames: igdbData.expandedGames,
                      ports: igdbData.ports,
                      similarGames: igdbData.similarGames,
                  }
                : null,

            // Multiplayer info
            maxPlayers: launchboxData?.maxPlayers || null,
            cooperative: launchboxData?.cooperative || false,

            // Identification status
            isIdentified: rom.is_identified || false,
            isUnidentified: rom.is_unidentified || false,
            missingFromFs: rom.missing_from_fs || false,

            // Timestamps
            createdAt: rom.created_at || null,
            updatedAt: rom.updated_at || null,
            addedAt: rom.created_at ? new Date(rom.created_at).getTime() : null,

            // User data (if available)
            isFavorite: rom.rom_user?.is_favorite || false,
            lastPlayed: rom.rom_user?.last_played || null,
            userNotes: rom.user_notes || [],
            userCollections: rom.user_collections || [],
            userSaves: rom.user_saves || [],
            userStates: rom.user_states || [],
            userScreenshots: rom.user_screenshots || [],

            // Sibling ROMs (different regions/versions of same game)
            siblings: rom.siblings || [],

            // Provider-specific metadata (full objects for advanced use)
            igdbMetadata: igdbData,
            mobyMetadata: mobyData,
            ssMetadata: rom.ss_metadata || null,
            launchboxMetadata: launchboxData,
            hasheousMetadata: rom.hasheous_metadata || null,

            // Original data for reference
            originalData: {
                rommId: rom.id,
                platformFsSlug: rom.platform_fs_slug || null,
                hasManual: rom.has_manual || false,
                rawMetadata: rom.metadatum || null,
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
                            `[RommSource:${this.server.name}] Fetched ${platformRomCount} ROMs from platform ${platformId} (${platformsFetched}/${platformsToFetch.length})`
                        );
                    }
                } catch (error) {
                    logSourceError(logger, {
                        source: `romm:${this.server.name}`,
                        operation: 'fetchMedia:platform',
                        error,
                        metadata: {
                            platformId,
                            platformsFetched,
                            totalPlatforms: platformsToFetch.length,
                        },
                        level: 'warn',
                    });
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
            logSourceError(logger, {
                source: `romm:${this.server.name}`,
                operation: 'fetchMedia',
                error,
                metadata: {
                    count,
                    type,
                    platforms: platforms === 'all' ? 'all' : platforms?.length || 0,
                },
            });
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
            logSourceError(logger, {
                source: `romm:${this.server.name}`,
                operation: 'testConnection',
                error,
                metadata: metadataExtractors.connection(this.server),
            });
            return false;
        }
    }
}

module.exports = RommSource;
