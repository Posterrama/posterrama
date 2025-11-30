/**
 * Media Source Ratings Utilities
 * Handles fetching and caching of content ratings from Jellyfin and Plex
 */

/**
 * Fetch all available ratings from a Jellyfin server
 * @param {Object} params - Parameters
 * @param {Object} params.serverConfig - Jellyfin server configuration
 * @param {Function} params.getJellyfinClient - Function to get Jellyfin client
 * @param {Function} params.getJellyfinLibraries - Function to get Jellyfin libraries
 * @param {Object} params.logger - Logger instance
 * @returns {Promise<Array<string>>} Array of unique ratings
 */
async function fetchAllJellyfinRatings({
    serverConfig,
    getJellyfinClient,
    getJellyfinLibraries,
    logger,
}) {
    try {
        const client = await getJellyfinClient(serverConfig);
        const allLibraries = await getJellyfinLibraries(serverConfig);

        // Get library IDs that are configured for this server
        const configuredLibraries = [
            ...(serverConfig.movieLibraryNames || []),
            ...(serverConfig.showLibraryNames || []),
        ];
        const libraryIds = [];

        for (const libraryName of configuredLibraries) {
            const library = allLibraries.get(libraryName);
            if (library) {
                libraryIds.push(library.id);
            }
        }

        if (libraryIds.length === 0) {
            logger.warn(
                `[fetchAllJellyfinRatings] No configured libraries found for ${serverConfig.name}`
            );
            return [];
        }

        logger.info(
            `[fetchAllJellyfinRatings] Fetching ratings from ${libraryIds.length} libraries for ${serverConfig.name}`
        );
        const ratings = await client.getRatings(libraryIds);

        logger.info(
            `[fetchAllJellyfinRatings] Found ${ratings.length} unique ratings in ${serverConfig.name}:`,
            ratings
        );
        return ratings;
    } catch (error) {
        logger.error(
            `[fetchAllJellyfinRatings] Failed to fetch ratings for ${serverConfig.name}:`,
            error.message
        );
        return [];
    }
}

/**
 * Fetch all available content ratings from a Plex server
 * @param {Object} params - Parameters
 * @param {Object} params.serverConfig - Plex server configuration
 * @param {Function} params.getPlexClient - Function to get Plex client
 * @param {boolean} params.isDebug - Debug mode flag
 * @param {Object} params.logger - Logger instance
 * @returns {Promise<Array<string>>} Array of unique content ratings
 */
async function fetchAllPlexRatings({ serverConfig, getPlexClient, isDebug, logger }) {
    try {
        const PlexHttpClient = require('./plex-http-client');
        const plexClient = await getPlexClient(serverConfig);
        const client = new PlexHttpClient(plexClient, serverConfig, isDebug);

        logger.info(`[fetchAllPlexRatings] Fetching ratings from ${serverConfig.name}`);
        const ratings = await client.getRatings();

        logger.info(
            `[fetchAllPlexRatings] Found ${ratings.length} unique ratings in ${serverConfig.name}:`,
            ratings
        );
        return ratings;
    } catch (error) {
        logger.error(
            `[fetchAllPlexRatings] Failed to fetch ratings for ${serverConfig.name}:`,
            error.message
        );
        return [];
    }
}

/**
 * Get all available ratings for a source type with intelligent caching
 * @param {Object} params - Parameters
 * @param {string} params.sourceType - The source type (jellyfin, plex, etc.)
 * @param {Object} params.config - Application configuration
 * @param {Object} params.ratingCache - Rating cache instance
 * @param {Object} params.logger - Logger instance
 * @param {Function} params.fetchJellyfinRatings - Function to fetch Jellyfin ratings
 * @param {Function} params.fetchPlexRatings - Function to fetch Plex ratings
 * @returns {Promise<Array<string>>} Array of unique ratings
 */
async function getAllSourceRatings({
    sourceType,
    config,
    ratingCache,
    logger,
    fetchJellyfinRatings,
    fetchPlexRatings,
}) {
    // Check cache first
    const cachedRatings = ratingCache.getRatings(sourceType);
    if (cachedRatings.length > 0) {
        logger.debug(
            `[getAllSourceRatings] Using cached ratings for ${sourceType}: ${cachedRatings.length} ratings`
        );
        return cachedRatings;
    }

    logger.info(`[getAllSourceRatings] Cache miss for ${sourceType}, fetching from source...`);

    // Find enabled servers of this type
    const enabledServers =
        config.mediaServers?.filter(
            server => server.enabled && server.type?.toLowerCase() === sourceType.toLowerCase()
        ) || [];

    if (enabledServers.length === 0) {
        logger.warn(`[getAllSourceRatings] No enabled servers found for ${sourceType}`);
        return [];
    }

    const allRatings = new Set();

    // Fetch ratings from all enabled servers of this type
    for (const server of enabledServers) {
        try {
            let serverRatings = [];

            switch (sourceType.toLowerCase()) {
                case 'jellyfin':
                    serverRatings = await fetchJellyfinRatings(server);
                    break;
                case 'plex':
                    serverRatings = await fetchPlexRatings(server);
                    break;
                default:
                    logger.warn(`[getAllSourceRatings] Unsupported source type: ${sourceType}`);
                    continue;
            }

            // Add all ratings to the set
            serverRatings.forEach(rating => allRatings.add(rating));
        } catch (error) {
            logger.error(
                `[getAllSourceRatings] Failed to fetch ratings from server ${server.name}:`,
                error.message
            );
        }
    }

    const finalRatings = Array.from(allRatings).sort();

    // Cache the results
    await ratingCache.setRatings(sourceType, finalRatings);

    return finalRatings;
}

/**
 * Get ratings with counts for each rating
 * @param {Object} params - Parameters
 * @param {string} params.sourceType - The source type (e.g., 'jellyfin', 'plex')
 * @param {Object} params.config - Application configuration
 * @param {Function} params.getJellyfinClient - Function to get Jellyfin client
 * @param {Function} params.getJellyfinLibraries - Function to get Jellyfin libraries
 * @param {Function} params.getPlexClient - Function to get Plex client
 * @param {boolean} params.isDebug - Debug mode flag
 * @param {Object} params.logger - Logger instance
 * @returns {Promise<Array<{rating: string, count: number}>>} Array of ratings with counts
 */
async function getRatingsWithCounts({
    sourceType,
    config,
    getJellyfinClient,
    getJellyfinLibraries,
    getPlexClient,
    isDebug,
    logger,
}) {
    if (!['jellyfin', 'plex'].includes(sourceType.toLowerCase())) {
        throw new Error(`Rating counts not supported for source type: ${sourceType}`);
    }

    // Find the enabled server of the specified type
    const server = config.mediaServers.find(
        server => server.type?.toLowerCase() === sourceType.toLowerCase() && server.enabled
    );

    if (!server) {
        throw new Error(`No enabled ${sourceType} server found`);
    }

    try {
        let ratingsWithCounts = [];

        switch (sourceType.toLowerCase()) {
            case 'jellyfin': {
                const jellyfinClient = await getJellyfinClient(server);
                const allLibraries = await getJellyfinLibraries(server);

                // Get library IDs
                const configuredLibraries = [
                    ...(server.movieLibraryNames || []),
                    ...(server.showLibraryNames || []),
                ];
                const libraryIds = [];

                for (const libraryName of configuredLibraries) {
                    const library = allLibraries.get(libraryName);
                    if (library) {
                        libraryIds.push(library.id);
                    }
                }

                if (libraryIds.length === 0) {
                    logger.warn(
                        `[getRatingsWithCounts] No configured libraries found for ${server.name}`
                    );
                    return [];
                }

                ratingsWithCounts = await jellyfinClient.getRatingsWithCounts(libraryIds);
                break;
            }

            case 'plex': {
                const PlexHttpClient = require('./plex-http-client');
                const plexClient = await getPlexClient(server);
                const plexHttpClient = new PlexHttpClient(plexClient, server, isDebug);

                ratingsWithCounts = await plexHttpClient.getRatingsWithCounts();
                break;
            }
        }

        return ratingsWithCounts;
    } catch (error) {
        logger.error(
            `[getRatingsWithCounts] Failed to get ratings with counts for ${sourceType}:`,
            error.message
        );
        throw error;
    }
}

/**
 * Get all unique quality/resolution values with counts from a Jellyfin server
 * @param {Object} params - Parameters
 * @param {Object} params.serverConfig - Jellyfin server configuration
 * @param {Function} params.getJellyfinClient - Function to get Jellyfin client
 * @param {Function} params.getJellyfinLibraries - Function to get Jellyfin libraries
 * @param {boolean} params.isDebug - Debug mode flag
 * @param {Object} params.logger - Logger instance
 * @param {boolean} [params.fullScan=false] - Whether to perform full scan
 * @returns {Promise<Array>} Array of quality objects with count
 */
async function getJellyfinQualitiesWithCounts({
    serverConfig,
    getJellyfinClient,
    getJellyfinLibraries,
    isDebug,
    logger,
    fullScan = false,
}) {
    try {
        const jellyfinClient = await getJellyfinClient(serverConfig);

        // Use the existing getJellyfinLibraries function that properly handles ItemId
        const allLibrariesMap = await getJellyfinLibraries(serverConfig);

        // Filter for ONLY movie libraries - TV shows don't have quality info at series level
        const selectedLibraries = Array.from(allLibrariesMap.values()).filter(library => {
            return library.type === 'movies';
        });

        const libraryIds = selectedLibraries.map(library => library.id);

        if (isDebug)
            logger.debug(
                '[Jellyfin Qualities] Selected libraries:',
                selectedLibraries.map(lib => ({ name: lib.name, id: lib.id, type: lib.type }))
            );
        if (isDebug) logger.debug('[Jellyfin Qualities] Library IDs:', libraryIds);

        if (libraryIds.length === 0) {
            console.warn('[getJellyfinQualitiesWithCounts] No movie or TV show libraries found');
            return /** @type {any} */ ({ qualities: [], partial: false });
        }

        // Use the HTTP client method to get qualities with counts
        const result = await jellyfinClient.getQualitiesWithCounts(libraryIds, fullScan);

        if (isDebug)
            logger.debug(
                `[getJellyfinQualitiesWithCounts] Found ${result.qualities.length} unique qualities with counts from ${selectedLibraries.length} libraries (${result.partial ? 'SAMPLE' : 'FULL'})`
            );

        return result;
    } catch (error) {
        console.error(`[getJellyfinQualitiesWithCounts] Error: ${error.message}`);
        return /** @type {any} */ ({ qualities: [], partial: false });
    }
}

module.exports = {
    fetchAllJellyfinRatings,
    fetchAllPlexRatings,
    getAllSourceRatings,
    getRatingsWithCounts,
    getJellyfinQualitiesWithCounts,
};
