/**
 * Jellyfin media source for posterrama.app
 * Handles fetching and processing media from a Jellyfin server.
 */
const logger = require('../logger');

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
            ...this.metrics,
            filterEfficiency:
                this.metrics.itemsProcessed > 0
                    ? this.metrics.itemsFiltered / this.metrics.itemsProcessed
                    : 0,
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
                            'ProductionYear',
                            'RunTimeTicks',
                            'Taglines',
                            'OriginalTitle',
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

            // Filter items based on Rotten Tomatoes score if applicable
            const filteredItems = allItems.filter(_item => {
                // For now, skip RT filtering for Jellyfin (could be added later)
                return true;
            });

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
