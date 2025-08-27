/**
 * Plex media source for posterrama.app
 * Handles fetching and processing media from a Plex server.
 */
const logger = require('../utils/logger');

class PlexSource {
    constructor(
        serverConfig,
        getPlexClient,
        processPlexItem,
        getPlexLibraries,
        shuffleArray,
        rtMinScore,
        isDebug
    ) {
        this.server = serverConfig;
        this.getPlexClient = getPlexClient;
        this.processPlexItem = processPlexItem;
        this.getPlexLibraries = getPlexLibraries;
        this.shuffleArray = shuffleArray;
        this.rtMinScore = rtMinScore;
        this.isDebug = isDebug;
        this.plex = this.getPlexClient(this.server);

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
        return {
            totalItems: this.cachedMedia ? this.cachedMedia.length : 0,
            lastFetch: this.lastFetch,
            cacheDuration: 3600000, // Default cache duration
            ...this.metrics,
        };
    }

    // Get all unique content ratings from the media collection
    getAvailableRatings() {
        if (!this.cachedMedia) {
            return [];
        }

        const ratings = new Set();
        this.cachedMedia.forEach(item => {
            if (item.contentRating && item.contentRating.trim()) {
                ratings.add(item.contentRating.trim());
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
            logger.info(`Fetching media from Plex`, {
                server: this.server.name,
                type,
                count,
                libraries: libraryNames,
            });
        }

        try {
            const allLibraries = await this.getPlexLibraries(this.server);
            let allItems = [];

            for (const name of libraryNames) {
                const library = allLibraries.get(name);
                if (!library) {
                    logger.warn(`[PlexSource:${this.server.name}] Library "${name}" not found.`);
                    continue;
                }

                try {
                    const content = await this.plex.query(`/library/sections/${library.key}/all`);
                    if (content?.MediaContainer?.Metadata) {
                        allItems = allItems.concat(content.MediaContainer.Metadata);
                        if (this.isDebug) {
                            logger.debug(
                                `[PlexSource:${this.server.name}] Library "${name}" provided ${content.MediaContainer.Metadata.length} items`
                            );
                        }
                    }
                } catch (libraryError) {
                    logger.error(
                        `[PlexSource:${this.server.name}] Failed to fetch from library "${name}":`,
                        {
                            error: libraryError.message,
                            type,
                            libraryKey: library.key,
                        }
                    );
                    // Continue with other libraries
                }
            }

            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Found ${allItems.length} total items in specified libraries.`
                );

            // Apply content filtering
            const filteredItems = this.applyContentFiltering(allItems);
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] After filtering: ${filteredItems.length} items remaining.`
                );

            const shuffledItems = this.shuffleArray(filteredItems);
            const selectedItems = count > 0 ? shuffledItems.slice(0, count) : shuffledItems;

            const processedItems = await Promise.all(
                selectedItems.map(item => this.processPlexItem(item, this.server, this.plex))
            );

            const finalItems = processedItems.filter(item => {
                if (!item) return false;
                if (this.rtMinScore > 0 && item.rottenTomatoes) {
                    return item.rottenTomatoes.originalScore * 10 >= this.rtMinScore;
                }
                return true;
            });

            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Returning ${finalItems.length} processed items.`
                );
            return finalItems;
        } catch (error) {
            console.error(
                `[PlexSource:${this.server.name}] Error fetching media: ${error.message}`
            );
            return [];
        }
    }

    /**
     * Applies content filtering based on server configuration.
     * @param {object[]} items - Array of Plex media items to filter.
     * @returns {object[]} Filtered array of media items.
     */
    applyContentFiltering(items) {
        let filteredItems = [...items];

        // Rating filter (support both string and array formats)
        if (this.server.ratingFilter) {
            let hasValidRatingFilter = false;

            if (Array.isArray(this.server.ratingFilter)) {
                hasValidRatingFilter = this.server.ratingFilter.length > 0;
            } else if (typeof this.server.ratingFilter === 'string') {
                hasValidRatingFilter = this.server.ratingFilter.trim() !== '';
            }

            if (hasValidRatingFilter) {
                // Convert string to array for consistent handling
                const allowedRatings = Array.isArray(this.server.ratingFilter)
                    ? this.server.ratingFilter
                    : [this.server.ratingFilter];

                filteredItems = filteredItems.filter(item => {
                    if (!item.contentRating) {
                        // If a rating filter is set, exclude items without content rating
                        if (this.isDebug) {
                            logger.debug(
                                `[PlexSource:${this.server.name}] Filtered out "${item.title}" - No contentRating when filter "${allowedRatings.join(', ')}" is required`
                            );
                        }
                        return false;
                    } else if (!allowedRatings.includes(item.contentRating)) {
                        if (this.isDebug) {
                            logger.debug(
                                `[PlexSource:${this.server.name}] Filtered out "${item.title}" - contentRating "${item.contentRating}" not in allowed list: ${allowedRatings.join(', ')}`
                            );
                        }
                        return false;
                    }
                    return true;
                });
                if (this.isDebug)
                    logger.debug(
                        `[PlexSource:${this.server.name}] Rating filter (${allowedRatings.join(', ')}): ${filteredItems.length} items.`
                    );
            }
        }

        // Genre filter
        if (this.server.genreFilter && this.server.genreFilter.trim() !== '') {
            const genreList = this.server.genreFilter.split(',').map(g => g.trim().toLowerCase());
            filteredItems = filteredItems.filter(item => {
                if (!item.Genre || !Array.isArray(item.Genre)) return false;
                return item.Genre.some(genre =>
                    genreList.some(filterGenre => genre.tag.toLowerCase().includes(filterGenre))
                );
            });
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Genre filter (${this.server.genreFilter}): ${filteredItems.length} items.`
                );
        }

        // Recently added filter
        if (this.server.recentlyAddedOnly && this.server.recentlyAddedDays) {
            const daysAgo = Date.now() - this.server.recentlyAddedDays * 24 * 60 * 60 * 1000;
            filteredItems = filteredItems.filter(item => {
                if (!item.addedAt) return false;
                const addedDate = new Date(parseInt(item.addedAt) * 1000);
                return addedDate.getTime() >= daysAgo;
            });
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Recently added filter (${this.server.recentlyAddedDays} days): ${filteredItems.length} items.`
                );
        }

        // Quality filter
        if (this.server.qualityFilter && this.server.qualityFilter.trim() !== '') {
            filteredItems = filteredItems.filter(item => {
                if (!item.Media || !Array.isArray(item.Media)) return false;
                return item.Media.some(media => {
                    const resolution = media.videoResolution;
                    switch (this.server.qualityFilter) {
                        case 'SD':
                            return !resolution || resolution === 'sd';
                        case '720p':
                            return resolution === '720' || resolution === 'hd';
                        case '1080p':
                            return resolution === '1080';
                        case '4K':
                            return resolution === '4k';
                        default:
                            return true;
                    }
                });
            });
            if (this.isDebug)
                logger.debug(
                    `[PlexSource:${this.server.name}] Quality filter (${this.server.qualityFilter}): ${filteredItems.length} items.`
                );
        }

        return filteredItems;
    }
}

module.exports = PlexSource;
