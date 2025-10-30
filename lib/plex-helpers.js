/**
 * @file lib/plex-helpers.js
 * Plex server helper functions for client management, library access, and metadata retrieval.
 * Extracted from server.js as part of Phase 1 modularization.
 */

const logger = require('../utils/logger');
const { ApiError } = require('../utils/errors');

/**
 * Creates a Plex client instance with the specified connection parameters.
 * @param {Object} params - Connection parameters
 * @param {string} params.hostname - Plex server hostname
 * @param {number} params.port - Plex server port
 * @param {string} params.token - Plex authentication token
 * @param {number} [params.timeout] - Request timeout in milliseconds
 * @returns {Promise<Object>} Plex client instance
 * @throws {ApiError} If required parameters are missing
 * @example
 * const client = await createPlexClient({
 *   hostname: 'plex.example.com',
 *   port: 32400,
 *   token: 'xyz123',
 *   timeout: 5000
 * });
 */
async function createPlexClient({ hostname, port, token, timeout }) {
    if (!hostname || !port || !token) {
        throw new ApiError(500, 'Plex client creation failed: missing hostname, port, or token.');
    }

    // Modern @ctrl/plex client (zero vulnerabilities)
    logger.info('🚀 Using @ctrl/plex client');
    const { createCompatiblePlexClient } = require('../utils/plex-client-ctrl');
    return await createCompatiblePlexClient({ hostname, port, token, timeout });
}

/**
 * Caches PlexAPI clients to avoid re-instantiating for every request.
 * @type {Object.<string, Object>}
 */
const plexClients = {};

/**
 * Clears all cached Plex clients or a specific client by name.
 * Useful after configuration changes.
 * @param {string} [name] - Optional client name. If omitted, clears all clients.
 */
function clearPlexClients(name) {
    if (name) {
        delete plexClients[name];
    } else {
        Object.keys(plexClients).forEach(key => delete plexClients[key]);
    }
}

/**
 * Gets or creates a cached Plex client for the specified server configuration.
 * @param {Object} serverConfig - Server configuration from config.json
 * @param {string} serverConfig.name - Server name (used as cache key)
 * @param {string} serverConfig.hostname - Plex server hostname
 * @param {number} serverConfig.port - Plex server port
 * @param {string} [serverConfig.token] - Direct token (for testing)
 * @param {string} [serverConfig.tokenEnvVar] - Environment variable containing token
 * @param {Object} [serverConfig._directClient] - Direct client instance (for testing)
 * @returns {Promise<Object>} Cached or newly created Plex client
 */
async function getPlexClient(serverConfig) {
    // If a direct client is provided (for testing), use that
    if (serverConfig._directClient) {
        return serverConfig._directClient;
    }

    if (!plexClients[serverConfig.name]) {
        // Support both environment variables and direct values (for testing)
        const hostname = serverConfig.hostname;
        const port = serverConfig.port;
        const token = serverConfig.token || process.env[serverConfig.tokenEnvVar];

        // The createPlexClient function will throw an error if details are missing.
        // This replaces the explicit token check that was here before.
        plexClients[serverConfig.name] = await createPlexClient({ hostname, port, token });
    }
    return plexClients[serverConfig.name];
}

/**
 * Fetches all library sections from a Plex server and returns them as a Map.
 * @param {Object} serverConfig - The configuration for the Plex server including connection details and options.
 * @returns {Promise<Map<string, Object>>} A map of library titles to library objects containing metadata about each library section.
 * @throws {ApiError} If the server connection fails or the server returns an error response.
 * @example
 * const libraries = await getPlexLibraries(serverConfig);
 * for (const [title, library] of libraries) {
 *   console.log(`Found library: ${title}, type: ${library.type}`);
 * }
 */
async function getPlexLibraries(serverConfig) {
    const plex = await getPlexClient(serverConfig);
    const sectionsResponse = await plex.query('/library/sections');
    const allSections = sectionsResponse?.MediaContainer?.Directory || [];
    const libraries = new Map();
    allSections.forEach(dir => libraries.set(dir.title, dir));
    return libraries;
}

/**
 * Fetches all unique genres from movie and show libraries on a Plex server.
 * @param {Object} serverConfig - Plex server configuration
 * @returns {Promise<string[]>} Sorted array of unique genre names
 */
async function getPlexGenres(serverConfig) {
    try {
        const plex = await getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const genres = new Set();

        for (const [libraryName, library] of allLibraries) {
            // Only get genres from movie and show libraries
            if (library.type === 'movie' || library.type === 'show') {
                try {
                    // Get all unique genres from this library using the genre filter endpoint
                    const genreFilter = await plex.query(`/library/sections/${library.key}/genre`);
                    if (genreFilter?.MediaContainer?.Directory) {
                        genreFilter.MediaContainer.Directory.forEach(genreDir => {
                            if (genreDir.title) {
                                genres.add(genreDir.title);
                            }
                        });
                    }

                    // Fallback: if genre endpoint doesn't work, get from content
                    if (genres.size === 0) {
                        const content = await plex.query(
                            `/library/sections/${library.key}/all?limit=100`
                        );
                        if (content?.MediaContainer?.Metadata) {
                            content.MediaContainer.Metadata.forEach(item => {
                                if (item.Genre && Array.isArray(item.Genre)) {
                                    item.Genre.forEach(genre => {
                                        if (genre.tag) {
                                            genres.add(genre.tag);
                                        }
                                    });
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.warn(
                        `[getPlexGenres] Error fetching from library ${libraryName}: ${error.message}`
                    );
                }
            }
        }

        const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
        if (isDebug)
            logger.debug(
                `[getPlexGenres] Found ${genres.size} unique genres from ${allLibraries.size} libraries`
            );
        return Array.from(genres).sort();
    } catch (error) {
        console.error(`[getPlexGenres] Error: ${error.message}`);
        return [];
    }
}

/**
 * Get Plex genres with counts.
 * @param {Object} serverConfig - Plex server configuration
 * @returns {Promise<Array<{genre: string, count: number}>>} Array of genre objects with counts
 */
async function getPlexGenresWithCounts(serverConfig) {
    try {
        const plex = await getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const genreCounts = new Map();

        for (const [libraryName, library] of allLibraries) {
            // Only get genres from movie and show libraries
            if (library.type === 'movie' || library.type === 'show') {
                try {
                    // Get all unique genres with counts from this library
                    // First try the genre endpoint for available genres
                    const genreFilter = await plex.query(`/library/sections/${library.key}/genre`);
                    const availableGenres = new Set();

                    if (genreFilter?.MediaContainer?.Directory) {
                        genreFilter.MediaContainer.Directory.forEach(genreDir => {
                            if (genreDir.title) {
                                availableGenres.add(genreDir.title);
                            }
                        });
                    }

                    // Get actual content to count genres
                    const content = await plex.query(
                        `/library/sections/${library.key}/all?limit=1000&includeGuids=1`
                    );

                    if (content?.MediaContainer?.Metadata) {
                        content.MediaContainer.Metadata.forEach(item => {
                            if (item.Genre && Array.isArray(item.Genre)) {
                                item.Genre.forEach(genre => {
                                    if (genre.tag) {
                                        const genreName = genre.tag;
                                        genreCounts.set(
                                            genreName,
                                            (genreCounts.get(genreName) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.warn(
                        `[getPlexGenresWithCounts] Error fetching from library ${libraryName}: ${error.message}`
                    );
                }
            }
        }

        // Convert to array of objects and sort by genre name
        const result = Array.from(genreCounts.entries())
            .map(([genre, count]) => ({ genre, count }))
            .sort((a, b) => a.genre.localeCompare(b.genre));

        const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
        if (isDebug)
            logger.debug(
                `[getPlexGenresWithCounts] Found ${result.length} unique genres with counts from ${allLibraries.size} libraries`
            );

        return result;
    } catch (error) {
        console.error(`[getPlexGenresWithCounts] Error: ${error.message}`);
        return [];
    }
}

/**
 * Get all unique quality/resolution values with counts from a Plex server.
 * @param {Object} serverConfig - Plex server configuration
 * @returns {Promise<Array<{quality: string, count: number}>>} Array of quality objects with counts
 */
async function getPlexQualitiesWithCounts(serverConfig) {
    try {
        const plex = await getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const qualityCounts = new Map();

        logger.info(
            `[getPlexQualitiesWithCounts] Starting quality scan for ${allLibraries.size} libraries`
        );

        for (const [libraryName, library] of allLibraries) {
            // Only get qualities from movie and show libraries
            if (library.type === 'movie' || library.type === 'show') {
                try {
                    // Get actual content to extract quality information
                    const content = await plex.query(
                        `/library/sections/${library.key}/all?limit=1000&includeGuids=1`
                    );

                    const itemCount = content?.MediaContainer?.Metadata?.length || 0;
                    logger.info(
                        `[getPlexQualitiesWithCounts] Library "${libraryName}": ${itemCount} items`
                    );

                    if (content?.MediaContainer?.Metadata) {
                        let itemsWithMedia = 0;
                        let itemsWithResolution = 0;
                        let sampleLogged = false;

                        content.MediaContainer.Metadata.forEach(item => {
                            if (item.Media && Array.isArray(item.Media)) {
                                itemsWithMedia++;

                                // Log first item's Media structure for debugging
                                if (!sampleLogged && item.Media.length > 0) {
                                    sampleLogged = true;
                                    logger.info(
                                        `[getPlexQualitiesWithCounts] Sample Media from "${item.title}": ${JSON.stringify(item.Media[0])}`
                                    );
                                }

                                item.Media.forEach(media => {
                                    if (media.videoResolution) {
                                        itemsWithResolution++;
                                        let quality;
                                        const resolution = String(
                                            media.videoResolution
                                        ).toLowerCase();

                                        // Map Plex resolution values to standardized quality labels
                                        switch (resolution) {
                                            case 'sd':
                                                quality = 'SD';
                                                break;
                                            case '720':
                                            case 'hd':
                                            case '720p':
                                                quality = '720p';
                                                break;
                                            case '1080':
                                            case '1080p':
                                                quality = '1080p';
                                                break;
                                            case '4k':
                                            case '2160':
                                            case '2160p':
                                                quality = '4K';
                                                break;
                                            default:
                                                // For unknown resolutions, use the raw value
                                                quality = resolution.toUpperCase();
                                        }

                                        qualityCounts.set(
                                            quality,
                                            (qualityCounts.get(quality) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });

                        logger.info(
                            `[getPlexQualitiesWithCounts] Library "${libraryName}": ${itemsWithMedia} items with Media array, ${itemsWithResolution} with videoResolution`
                        );
                    }
                } catch (error) {
                    console.warn(
                        `[getPlexQualitiesWithCounts] Error fetching from library ${libraryName}: ${error.message}`
                    );
                }
            }
        }

        logger.info(
            `[getPlexQualitiesWithCounts] Found qualities: ${Array.from(qualityCounts.keys()).join(', ') || 'NONE'}`
        );

        // Convert to array of objects and sort by quality preference (SD, 720p, 1080p, 4K, others)
        const qualityOrder = ['SD', '720p', '1080p', '4K'];
        const result = Array.from(qualityCounts.entries())
            .map(([quality, count]) => ({ quality, count }))
            .sort((a, b) => {
                const aIndex = qualityOrder.indexOf(a.quality);
                const bIndex = qualityOrder.indexOf(b.quality);

                // If both are in the predefined order, sort by order
                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                }
                // If only one is in predefined order, prioritize it
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;
                // If neither is in predefined order, sort alphabetically
                return a.quality.localeCompare(b.quality);
            });

        const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
        if (isDebug)
            logger.debug(
                `[getPlexQualitiesWithCounts] Found ${result.length} unique qualities with counts from ${allLibraries.size} libraries`
            );

        return result;
    } catch (error) {
        console.error(`[getPlexQualitiesWithCounts] Error: ${error.message}`);
        return [];
    }
}

module.exports = {
    createPlexClient,
    getPlexClient,
    clearPlexClients,
    getPlexLibraries,
    getPlexGenres,
    getPlexGenresWithCounts,
    getPlexQualitiesWithCounts,
};
