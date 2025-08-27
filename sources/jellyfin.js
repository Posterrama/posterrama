/**
 * Jellyfin media source for posterrama.app
 * Handles fetching and processing media from a Jellyfin server.
 */
const logger = require('../utils/logger');

class JellyfinSource {
    constructor(
        serverConfig,
        getJellyfinClient,
        processJellyfinItem,
        getJellyfinLibraries,
        shuffleArray,
        rtMinScore,
        isDebug
    ) {
        this.server = serverConfig;
        this.getJellyfinClient = getJellyfinClient;
        this.processJellyfinItem = processJellyfinItem;
        this.getJellyfinLibraries = getJellyfinLibraries;
        this.shuffleArray = shuffleArray;
        this.rtMinScore = rtMinScore;
        this.isDebug = isDebug;

        // Debug: log rating filters configuration
        if (this.isDebug) {
            logger.info(
                `[JellyfinSource:${this.server.name}] Initialized with rating configuration:`,
                {
                    ratingFilter: this.server.ratingFilter || 'none',
                    legacyRatingFilters: this.server.ratingFilters || 'none',
                    rtMinScore: this.rtMinScore,
                }
            );
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
            cacheDuration: 3600000, // Default cache duration in milliseconds (1 hour)
            requestCount: this.metrics.requestCount,
            itemsProcessed: this.metrics.itemsProcessed,
            itemsFiltered: this.metrics.itemsFiltered,
            averageProcessingTime: this.metrics.averageProcessingTime,
            lastRequestTime: this.metrics.lastRequestTime,
            errorCount: this.metrics.errorCount,
            filterEfficiency,
        };
    }

    // Get all unique ratings from the media collection
    getAvailableRatings() {
        if (!this.cachedMedia) {
            return [];
        }

        const ratings = new Set();
        this.cachedMedia.forEach(item => {
            if (item.rating && item.rating.trim()) {
                ratings.add(item.rating.trim());
            }
        });

        return Array.from(ratings).sort();
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
     * Fetches a specified number of items from a list of libraries.
     * @param {string[]} libraryNames - The names of the libraries to fetch from.
     * @param {string} type - The type of media ('movie' or 'show').
     * @param {number} count - The number of items to fetch.
     * @returns {Promise<object[]>} A promise that resolves to an array of processed media items.
     */
    async fetchMedia(libraryNames, type, count) {
        if (!libraryNames || libraryNames.length === 0 || count === 0) {
            return [];
        }

        if (this.isDebug) {
            logger.info(`Fetching media from Jellyfin`, {
                server: this.server.name,
                type,
                libraryNames,
                count,
            });
        }

        const startTime = process.hrtime();
        this.metrics.requestCount++;
        this.metrics.lastRequestTime = new Date();

        try {
            const client = await this.getJellyfinClient(this.server);
            const allLibraries = await this.getJellyfinLibraries(this.server);

            let allItems = [];
            for (const name of libraryNames) {
                const library = allLibraries.get(name);
                if (!library) {
                    logger.warn(
                        `[JellyfinSource:${this.server.name}] Library "${name}" not found.`
                    );
                    continue;
                }

                try {
                    // Use our new HTTP client for better reliability
                    const items = await client.getItems({
                        parentId: library.id,
                        includeItemTypes: type === 'movie' ? ['Movie'] : ['Series'],
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
                        ],
                        sortBy: ['Random'],
                        limit: count * 2,
                    });

                    if (items && items.Items) {
                        allItems = allItems.concat(items.Items);
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Library "${name}" provided ${items.Items.length} items`
                            );
                        }
                    }
                } catch (libraryError) {
                    logger.error(
                        `[JellyfinSource:${this.server.name}] Failed to fetch from library "${name}":`,
                        {
                            error: libraryError.message,
                            type,
                            libraryId: library.id,
                        }
                    );
                    // Continue with other libraries
                }
            }

            if (this.isDebug) {
                logger.debug(
                    `[JellyfinSource:${this.server.name}] Found ${allItems.length} total items in specified libraries.`
                );
            }

            // Filter items based on ratings (CommunityRating, OfficialRating, UserData.Rating)
            let filteredItems = allItems.filter(item => {
                // Apply Rotten Tomatoes minimum score filter using CommunityRating
                if (this.rtMinScore > 0 && item.CommunityRating) {
                    // CommunityRating is typically 0-10, convert RT percentage to 0-10 scale for comparison
                    const rtScoreAsRating = this.rtMinScore / 10; // Convert percentage to 0-10 scale
                    if (item.CommunityRating < rtScoreAsRating) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - CommunityRating ${item.CommunityRating} below threshold ${rtScoreAsRating}`
                            );
                        }
                        return false;
                    }
                }

                // Apply genre filter if configured
                if (this.server.genreFilter && this.server.genreFilter.trim() !== '') {
                    const genreList = this.server.genreFilter
                        .split(',')
                        .map(g => g.trim().toLowerCase());

                    if (!item.Genres || !Array.isArray(item.Genres) || item.Genres.length === 0) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - No genres available when genre filter "${this.server.genreFilter}" is set`
                            );
                        }
                        return false;
                    }

                    const hasMatchingGenre = item.Genres.some(genre =>
                        genreList.some(filterGenre => genre.toLowerCase().includes(filterGenre))
                    );

                    if (!hasMatchingGenre) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - Genres [${item.Genres.join(', ')}] don't match filter "${this.server.genreFilter}"`
                            );
                        }
                        return false;
                    }
                }

                // Apply quality filter if configured
                if (this.server.qualityFilter && this.server.qualityFilter.trim() !== '') {
                    const qualityList = this.server.qualityFilter.split(',').map(q => q.trim());

                    // Get quality information from media sources
                    let itemQuality = null;
                    if (item.MediaSources && Array.isArray(item.MediaSources)) {
                        for (const source of item.MediaSources) {
                            if (source.MediaStreams && Array.isArray(source.MediaStreams)) {
                                const videoStream = source.MediaStreams.find(
                                    stream => stream.Type === 'Video'
                                );
                                if (videoStream && videoStream.Height) {
                                    const height = videoStream.Height;

                                    // Map video height to standardized quality labels
                                    if (height <= 576) {
                                        itemQuality = 'SD';
                                    } else if (height <= 720) {
                                        itemQuality = '720p';
                                    } else if (height <= 1080) {
                                        itemQuality = '1080p';
                                    } else if (height >= 2160) {
                                        itemQuality = '4K';
                                    } else {
                                        itemQuality = `${height}p`;
                                    }
                                    break; // Use first video stream found
                                }
                            }
                        }
                    }

                    if (!itemQuality || !qualityList.includes(itemQuality)) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - Quality "${itemQuality || 'unknown'}" not in filter list: ${qualityList.join(', ')}`
                            );
                        }
                        return false;
                    }
                }

                // Apply server-specific rating filters if configured
                // Support both new simple ratingFilter (string) and legacy ratingFilters (object)
                const ratingFilter = this.server.ratingFilter;
                const legacyFilters = this.server.ratingFilters;

                // Handle simple string rating filter (new approach)
                if (ratingFilter) {
                    // Convert string to array for consistent handling
                    const allowedRatings = Array.isArray(ratingFilter)
                        ? ratingFilter
                        : [ratingFilter];

                    if (!item.OfficialRating) {
                        // If a rating filter is set, exclude items without official rating
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - No OfficialRating when filter "${allowedRatings.join(', ')}" is required`
                            );
                        }
                        return false;
                    } else if (!allowedRatings.includes(item.OfficialRating)) {
                        if (this.isDebug) {
                            logger.debug(
                                `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - OfficialRating "${item.OfficialRating}" not in allowed list: ${allowedRatings.join(', ')}`
                            );
                        }
                        return false;
                    }
                }

                // Handle legacy rating filters object (backward compatibility)
                if (legacyFilters) {
                    const filters = legacyFilters;

                    if (this.isDebug) {
                        logger.debug(
                            `[JellyfinSource:${this.server.name}] Applying legacy rating filters for "${item.Name}": ${JSON.stringify(filters)}`
                        );
                    }

                    // Community rating filter (0-10 scale)
                    if (filters.minCommunityRating && item.CommunityRating) {
                        if (item.CommunityRating < filters.minCommunityRating) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - CommunityRating ${item.CommunityRating} below ${filters.minCommunityRating}`
                                );
                            }
                            return false;
                        }
                    }

                    // Official rating filter (MPAA ratings)
                    if (filters.allowedOfficialRatings && item.OfficialRating) {
                        if (!filters.allowedOfficialRatings.includes(item.OfficialRating)) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - OfficialRating "${item.OfficialRating}" not in allowed list: ${filters.allowedOfficialRatings.join(', ')}`
                                );
                            }
                            return false;
                        }
                    }

                    // User rating filter (personal rating)
                    if (filters.minUserRating && item.UserData?.Rating) {
                        if (item.UserData.Rating < filters.minUserRating) {
                            if (this.isDebug) {
                                logger.debug(
                                    `[JellyfinSource:${this.server.name}] Filtered out "${item.Name}" - UserRating ${item.UserData.Rating} below ${filters.minUserRating}`
                                );
                            }
                            return false;
                        }
                    }
                } else if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] No rating filters configured for server`
                    );
                }

                return true;
            });

            // Log genre filter results if applied
            if (this.server.genreFilter && this.server.genreFilter.trim() !== '') {
                if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] Genre filter (${this.server.genreFilter}): ${filteredItems.length} items.`
                    );
                }
            }

            // Log quality filter results if applied
            if (this.server.qualityFilter && this.server.qualityFilter.trim() !== '') {
                if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] Quality filter (${this.server.qualityFilter}): ${filteredItems.length} items.`
                    );
                }
            }

            // Recently added filter
            if (this.server.recentlyAddedOnly && this.server.recentlyAddedDays) {
                const daysAgo = Date.now() - this.server.recentlyAddedDays * 24 * 60 * 60 * 1000;
                filteredItems = filteredItems.filter(item => {
                    if (!item.DateCreated) return false;
                    const addedDate = new Date(item.DateCreated);
                    return addedDate.getTime() >= daysAgo;
                });
                if (this.isDebug) {
                    logger.debug(
                        `[JellyfinSource:${this.server.name}] Recently added filter (${this.server.recentlyAddedDays} days): ${filteredItems.length} items.`
                    );
                }
            }

            if (this.isDebug) {
                console.log(
                    `[JellyfinSource:${this.server.name}] After filtering: ${filteredItems.length} items remaining.`
                );
            }

            // Shuffle and limit to requested count
            const selectedItems = this.shuffleArray([...filteredItems]).slice(0, count);

            // Process items
            const processedItems = await Promise.all(
                selectedItems.map(item => this.processJellyfinItem(item, this.server, client))
            );

            // Filter out null results
            const validItems = processedItems.filter(item => item !== null);

            // Update metrics
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const processingTime = seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds
            this.metrics.averageProcessingTime =
                (this.metrics.averageProcessingTime + processingTime) / 2;
            this.metrics.itemsProcessed += allItems.length;
            this.metrics.itemsFiltered += validItems.length;

            if (this.isDebug) {
                logger.info(`[JellyfinSource:${this.server.name}] Processing completed`, {
                    requestTime: `${processingTime.toFixed(2)}ms`,
                    itemsFound: allItems.length,
                    itemsProcessed: validItems.length,
                    metrics: this.getMetrics(),
                });
            }

            return validItems;
        } catch (error) {
            this.metrics.errorCount++;
            logger.error(`[JellyfinSource:${this.server.name}] Error fetching media:`, {
                error: error.message,
                libraryNames,
                type,
                count,
            });
            throw error;
        }
    }

    /**
     * Get server information for diagnostics
     * @returns {Promise<object>} Server information
     */
    async getServerInfo() {
        try {
            const client = await this.getJellyfinClient(this.server);
            const info = await client.testConnection();

            return {
                name: this.server.name,
                type: 'jellyfin',
                version: info.version || 'Unknown',
                serverName: info.serverName || 'Unknown',
                id: info.id || 'Unknown',
                metrics: this.getMetrics(),
            };
        } catch (error) {
            logger.error(
                `[JellyfinSource:${this.server.name}] Error getting server info:`,
                error.message
            );
            throw error;
        }
    }
}

module.exports = JellyfinSource;
