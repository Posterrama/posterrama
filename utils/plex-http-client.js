/**
 * Plex HTTP client utility for rating operations
 * Provides methods to fetch ratings and counts from Plex servers
 */
const logger = require('./logger');

class PlexHttpClient {
    constructor(plexClient, serverConfig, isDebug = false) {
        this.plex = plexClient;
        this.serverConfig = serverConfig;
        this.isDebug = isDebug;
    }

    /**
     * Get all unique content ratings from all libraries
     * @returns {Promise<string[]>} Array of unique content ratings
     */
    async getRatings() {
        try {
            if (this.isDebug) {
                logger.debug(
                    `[PlexHttpClient:${this.serverConfig.name}] Fetching all ratings from libraries`
                );
            }

            const ratings = new Set();

            // Get all libraries
            const librariesResponse = await this.plex.query('/library/sections');
            const libraries = librariesResponse?.MediaContainer?.Directory || [];

            // Fetch all items from all libraries
            for (const library of libraries) {
                try {
                    const contentResponse = await this.plex.query(
                        `/library/sections/${library.key}/all`
                    );
                    const items = contentResponse?.MediaContainer?.Metadata || [];

                    for (const item of items) {
                        if (item.contentRating && item.contentRating.trim()) {
                            ratings.add(item.contentRating.trim());
                        }
                    }

                    if (this.isDebug) {
                        logger.debug(
                            `[PlexHttpClient:${this.serverConfig.name}] Processed ${items.length} items from library "${library.title}"`
                        );
                    }
                } catch (libraryError) {
                    logger.warn(
                        `[PlexHttpClient:${this.serverConfig.name}] Failed to fetch library ${library.title}: ${libraryError.message}`
                    );
                }
            }

            const sortedRatings = Array.from(ratings).sort();

            if (this.isDebug) {
                logger.debug(
                    `[PlexHttpClient:${this.serverConfig.name}] Found ${sortedRatings.length} unique ratings: ${sortedRatings.join(', ')}`
                );
            }

            return sortedRatings;
        } catch (error) {
            logger.error(
                `[PlexHttpClient:${this.serverConfig.name}] Error fetching ratings: ${error.message}`
            );
            return [];
        }
    }

    /**
     * Get all unique content ratings with their counts
     * @returns {Promise<Array<{rating: string, count: number}>>} Array of ratings with counts
     */
    async getRatingsWithCounts() {
        try {
            if (this.isDebug) {
                logger.debug(
                    `[PlexHttpClient:${this.serverConfig.name}] Fetching all ratings with counts from libraries`
                );
            }

            const ratingCounts = new Map();

            // Get all libraries
            const librariesResponse = await this.plex.query('/library/sections');
            const libraries = librariesResponse?.MediaContainer?.Directory || [];

            // Fetch all items from all libraries
            for (const library of libraries) {
                try {
                    const contentResponse = await this.plex.query(
                        `/library/sections/${library.key}/all`
                    );
                    const items = contentResponse?.MediaContainer?.Metadata || [];

                    for (const item of items) {
                        if (item.contentRating && item.contentRating.trim()) {
                            const rating = item.contentRating.trim();
                            ratingCounts.set(rating, (ratingCounts.get(rating) || 0) + 1);
                        }
                    }

                    if (this.isDebug) {
                        logger.debug(
                            `[PlexHttpClient:${this.serverConfig.name}] Processed ${items.length} items from library "${library.title}"`
                        );
                    }
                } catch (libraryError) {
                    logger.warn(
                        `[PlexHttpClient:${this.serverConfig.name}] Failed to fetch library ${library.title}: ${libraryError.message}`
                    );
                }
            }

            // Convert to array format and sort
            const ratingsWithCounts = Array.from(ratingCounts.entries())
                .map(([rating, count]) => ({ rating, count }))
                .sort((a, b) => a.rating.localeCompare(b.rating));

            if (this.isDebug) {
                logger.debug(
                    `[PlexHttpClient:${this.serverConfig.name}] Found ratings with counts:`,
                    ratingsWithCounts.map(r => `${r.rating} (${r.count})`).join(', ')
                );
            }

            return ratingsWithCounts;
        } catch (error) {
            logger.error(
                `[PlexHttpClient:${this.serverConfig.name}] Error fetching ratings with counts: ${error.message}`
            );
            return [];
        }
    }
}

module.exports = PlexHttpClient;
