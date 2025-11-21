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
        logger.info(`🚀 Creating Plex client for server: ${serverConfig.name}`);
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
 * @typedef {{ genres: Array<{genre: string, count: number}>, partial: boolean }} GenresResult
 */

/**
 * Get Plex genres with counts.
 * @param {Object} serverConfig - Plex server configuration
 * @param {boolean} [fullScan=false] - If true, scan all items; if false, use 50-item sample for speed
 * @returns {Promise<GenresResult>} Result with genres array and partial flag
 */
async function getPlexGenresWithCounts(serverConfig, fullScan = false) {
    try {
        const plex = await getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const genreCounts = new Map();
        const sampleSize = fullScan ? 10000 : 50;

        // Process libraries in parallel for faster response
        const libraryPromises = Array.from(allLibraries.entries())
            .filter(([, library]) => library.type === 'movie' || library.type === 'show')
            .map(async ([libraryName, library]) => {
                const libraryGenres = new Map();

                try {
                    // For genres, use /all for both movies and shows (Series objects have Genre tags)
                    // Episodes inherit genres from their parent series
                    const content = await plex.query(
                        `/library/sections/${library.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=${sampleSize}&includeGuids=1`
                    );

                    if (content?.MediaContainer?.Metadata) {
                        content.MediaContainer.Metadata.forEach(item => {
                            if (item.Genre && Array.isArray(item.Genre)) {
                                item.Genre.forEach(genre => {
                                    if (genre.tag) {
                                        const genreName = genre.tag;
                                        libraryGenres.set(
                                            genreName,
                                            (libraryGenres.get(genreName) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });
                    }

                    return libraryGenres;
                } catch (error) {
                    console.warn(
                        `[getPlexGenresWithCounts] Error fetching from library ${libraryName}: ${error.message}`
                    );
                    return new Map();
                }
            });

        // Wait for all library queries in parallel
        const libraryResults = await Promise.all(libraryPromises);

        // Merge all library genre counts
        libraryResults.forEach(libraryGenres => {
            libraryGenres.forEach((count, genre) => {
                genreCounts.set(genre, (genreCounts.get(genre) || 0) + count);
            });
        });

        // Convert to array of objects and sort by genre name
        const result = Array.from(genreCounts.entries())
            .map(([genre, count]) => ({ genre, count }))
            .sort((a, b) => a.genre.localeCompare(b.genre));

        const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
        if (isDebug)
            logger.debug(
                `[getPlexGenresWithCounts] Found ${result.length} unique genres with counts from ${allLibraries.size} libraries (${fullScan ? 'FULL' : 'SAMPLE'})`
            );

        return { genres: result, partial: !fullScan };
    } catch (error) {
        console.error(`[getPlexGenresWithCounts] Error: ${error.message}`);
        return { genres: [], partial: false };
    }
}

/**
 * @typedef {{ qualities: Array<{quality: string, count: number}>, partial: boolean }} QualitiesResult
 */

/**
 * Get all unique quality/resolution values with counts from a Plex server.
 * @param {Object} serverConfig - Plex server configuration
 * @param {boolean} [fullScan=false] - If true, scan all items; if false, use 50-item sample for speed
 * @returns {Promise<QualitiesResult>} Array of quality objects with counts and partial flag
 */
async function getPlexQualitiesWithCounts(serverConfig, fullScan = false) {
    try {
        const plex = await getPlexClient(serverConfig);
        const allLibraries = await getPlexLibraries(serverConfig);
        const qualityCounts = new Map();
        const sampleSize = fullScan ? 10000 : 50;

        logger.info(
            `[getPlexQualitiesWithCounts] Starting ${fullScan ? 'FULL' : 'SAMPLE'} quality scan for ${allLibraries.size} libraries (limit: ${sampleSize})`
        );

        // Process libraries in parallel with reduced sample size for faster response
        // Only scan MOVIE libraries - TV shows don't have videoResolution at series level
        const libraryPromises = Array.from(allLibraries.entries())
            .filter(([, library]) => library.type === 'movie')
            .map(async ([libraryName, library]) => {
                const libraryQualities = new Map();

                try {
                    // Only movies are scanned - TV shows don't have videoResolution at series level
                    const content = await plex.query(
                        `/library/sections/${library.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=${sampleSize}&includeGuids=1`
                    );

                    const itemCount = content?.MediaContainer?.Metadata?.length || 0;
                    logger.info(
                        `[getPlexQualitiesWithCounts] Library "${libraryName}": ${itemCount} items sampled`
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

                                        libraryQualities.set(
                                            quality,
                                            (libraryQualities.get(quality) || 0) + 1
                                        );
                                    }
                                });
                            }
                        });

                        logger.info(
                            `[getPlexQualitiesWithCounts] Library "${libraryName}": ${itemsWithMedia} items with Media array, ${itemsWithResolution} with videoResolution`
                        );
                    }

                    return libraryQualities;
                } catch (error) {
                    console.warn(
                        `[getPlexQualitiesWithCounts] Error fetching from library ${libraryName}: ${error.message}`
                    );
                    return new Map();
                }
            });

        // Wait for all library queries to complete in parallel
        const libraryResults = await Promise.all(libraryPromises);

        // Merge all library quality counts
        libraryResults.forEach(libraryQualities => {
            libraryQualities.forEach((count, quality) => {
                qualityCounts.set(quality, (qualityCounts.get(quality) || 0) + count);
            });
        });

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
                `[getPlexQualitiesWithCounts] Found ${result.length} unique qualities with counts from ${allLibraries.size} libraries (${fullScan ? 'FULL' : 'SAMPLE'})`
            );

        return { qualities: result, partial: !fullScan };
    } catch (error) {
        console.error(`[getPlexQualitiesWithCounts] Error: ${error.message}`);
        return { qualities: [], partial: false };
    }
}

/**
 * Processes a Plex item summary into a normalized media object with comprehensive metadata.
 * Fetches full item details, extracts technical specs, images, and enriched metadata.
 *
 * @param {Object} itemSummary - Plex item summary with basic info and key reference
 * @param {Object} serverConfig - Server configuration (name, type, etc.)
 * @param {Object} plex - Plex client instance for API queries
 * @param {boolean} [isDebug=false] - Enable debug logging
 * @returns {Promise<Object|null>} Normalized media object or null if processing fails
 *
 * @example
 * const media = await processPlexItem(itemSummary, serverConfig, plexClient, true);
 * console.log(media.title, media.hasHDR, media.audioTracks);
 */
async function processPlexItem(itemSummary, serverConfig, plex, isDebug = false) {
    /**
     * Extracts IMDb URL from Plex GUID array.
     * @param {Array} guids - Array of GUID objects
     * @returns {string|null} IMDb URL or null
     */
    const getImdbUrl = guids => {
        if (guids && Array.isArray(guids)) {
            const imdbGuid = guids.find(guid => guid.id.startsWith('imdb://'));
            if (imdbGuid) {
                const imdbId = imdbGuid.id.replace('imdb://', '');
                return `https://www.imdb.com/title/${imdbId}/`;
            }
        }
        return null;
    };

    /**
     * Extracts clear logo path from Plex Image array.
     * @param {Array} images - Array of image objects
     * @returns {string|null} Clear logo path or null
     */
    const getClearLogoPath = images => {
        if (images && Array.isArray(images)) {
            const logoObject = images.find(img => img.type === 'clearLogo');
            return logoObject ? logoObject.url : null;
        }
        return null;
    };

    /**
     * Extracts banner path from Plex Image array or direct banner field.
     * @param {Array} images - Array of image objects
     * @param {string} bannerField - Direct banner field value
     * @returns {string|null} Banner path or null
     */
    const getBannerPath = (images, bannerField) => {
        // First check if sourceItem.banner exists (direct field)
        if (bannerField) {
            return bannerField;
        }
        // Otherwise look in Image array for type='banner'
        if (images && Array.isArray(images)) {
            const bannerObject = images.find(img => img.type === 'banner');
            return bannerObject ? bannerObject.url : null;
        }
        return null;
    };

    /**
     * Extracts and normalizes Rotten Tomatoes data from Plex ratings.
     * @param {Array} ratings - Array of rating objects
     * @param {string} [_titleForDebug='Unknown'] - Title for debug logging
     * @returns {Object|null} Rotten Tomatoes data with score, icon, and originalScore
     */
    const getRottenTomatoesData = (ratings, _titleForDebug = 'Unknown') => {
        if (!ratings || !Array.isArray(ratings)) {
            return null;
        }

        const rtRating = ratings.find(r => r.image && r.image.includes('rottentomatoes'));

        if (!rtRating || typeof rtRating.value === 'undefined') {
            return null;
        }

        // RT Debug logging removed to reduce log noise

        const score = parseFloat(rtRating.value);
        if (isNaN(score)) {
            return null;
        }

        // The score from Plex is on a 10-point scale, so we multiply by 10 for a percentage.
        const finalScore = Math.round(score * 10);

        const imageIdentifier = rtRating.image || '';
        const isCriticRating = rtRating.type === 'critic';
        let icon = 'rotten';

        // Heuristic for "Certified Fresh": We assume a high critic score (>= 85) indicates
        // this status, as the identifier from Plex ('ripe') doesn't distinguish it from regular "Fresh".
        if (isCriticRating && finalScore >= 85) {
            icon = 'certified-fresh';
        } else if (
            imageIdentifier.includes('ripe') ||
            imageIdentifier.includes('upright') ||
            finalScore >= 60
        ) {
            // 'ripe' is for critic fresh, 'upright' is for audience fresh. The score is a fallback.
            icon = 'fresh';
        }

        // RT Debug logging removed to reduce log noise

        return {
            score: finalScore, // The 0-100 score for display
            icon: icon,
            originalScore: score, // The original 0-10 score for filtering
        };
    };

    try {
        if (!itemSummary.key) return null;

        // Query Plex metadata endpoint for this item
        const detailResponse = await plex.query(itemSummary.key);
        const item = detailResponse?.MediaContainer?.Metadata?.[0];
        if (!item) return null;

        // Preserve Extras, Related, and theme if passed in itemSummary (e.g., from enrichment)
        if (itemSummary.Extras && !item.Extras) {
            item.Extras = itemSummary.Extras;
        }
        if (itemSummary.Related && !item.Related) {
            item.Related = itemSummary.Related;
        }
        if (itemSummary.theme && !item.theme) {
            item.theme = itemSummary.theme;
        }

        // Extract theme from Theme array if present
        if (!item.theme && item.Theme?.[0]?.key) {
            item.theme = item.Theme[0].key;
        }

        // Note: Some Plex servers return complete Media.Part.Stream arrays in standard metadata query.
        // The /tree endpoint uses different structure (MetadataItem/MediaItem vs Metadata/Media).
        // Current implementation relies on standard endpoint - if Stream arrays are empty,
        // consider implementing /tree with proper structure mapping.
        let sourceItem = item; // This will be the movie or the episode/season
        let backgroundArt = item.art; // Default to item's art

        if ((item.type === 'season' || item.type === 'episode') && item.parentKey) {
            const showDetails = await plex.query(item.parentKey).catch(() => null);
            if (showDetails?.MediaContainer?.Metadata?.[0]) {
                const showData = showDetails.MediaContainer.Metadata[0];
                // Use show's art/thumb but keep the episode/season's Media (stream data)
                // Also preserve theme from item if it exists
                sourceItem = {
                    ...showData,
                    Media: item.Media,
                    theme: item.theme || showData.theme || showData.Theme?.[0]?.key || null,
                };
                backgroundArt = showData.art; // Use the show's art for the background
            }
        } else {
            // For movies/shows, check for Theme array
            if (!sourceItem.theme && sourceItem.Theme?.[0]?.key) {
                sourceItem = { ...sourceItem, theme: sourceItem.Theme[0].key };
            }
        }

        // Debug: log theme info
        if (sourceItem.theme || sourceItem.Theme) {
            logger.info(
                `[processPlexItem] ${sourceItem.title}: theme="${sourceItem.theme}", Theme=${!!sourceItem.Theme}`
            );
        }

        if (!backgroundArt || !sourceItem.thumb) return null;

        const imdbUrl = getImdbUrl(sourceItem.Guid);
        // Derive a simple quality label from Plex Media.videoResolution
        const mapResToLabel = res => {
            const r = (res || '').toString().toLowerCase();
            if (!r || r === 'sd') return 'SD';
            if (r === '720' || r === 'hd' || r === '720p') return '720p';
            if (r === '1080' || r === '1080p' || r === 'fullhd') return '1080p';
            if (r === '4k' || r === '2160' || r === '2160p' || r === 'uhd') return '4K';
            return r.toUpperCase();
        };
        let qualityLabel = null;
        if (Array.isArray(sourceItem.Media)) {
            for (const m of sourceItem.Media) {
                if (m && m.videoResolution) {
                    qualityLabel = mapResToLabel(m.videoResolution);
                    break;
                }
            }
        }
        const clearLogoPath = getClearLogoPath(sourceItem.Image);
        const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${sourceItem.ratingKey}`;
        const rottenTomatoesData = getRottenTomatoesData(sourceItem.Rating, sourceItem.title);

        // Plex Debug logging consolidated to reduce noise - individual RT logs removed

        // Extract rating images (rottentomatoes://, themoviedb://, etc.)
        const ratingImage = sourceItem.ratingImage || null;
        const audienceRatingImage = sourceItem.audienceRatingImage || null;
        const ratingCount = Number.isFinite(Number(sourceItem.ratingCount))
            ? Number(sourceItem.ratingCount)
            : null;

        // Process genres from Plex data
        const genres =
            sourceItem.Genre && Array.isArray(sourceItem.Genre)
                ? sourceItem.Genre.map(genre => genre.tag)
                : null;

        // Gather rich metadata (best-effort)
        const studios = Array.isArray(sourceItem.Studio)
            ? sourceItem.Studio.map(s => (s && s.tag) || s).filter(Boolean)
            : sourceItem.studio
              ? [sourceItem.studio]
              : null;
        const cast = Array.isArray(sourceItem.Role)
            ? sourceItem.Role.map(r => {
                  const name = r.tag || r.tagKey || r.tagValue || r.role || undefined;
                  if (!name && !r.role) return null;
                  const thumbPath = r.thumb || r.Thumb;
                  let thumbUrl = null;
                  if (thumbPath) {
                      const isAbsolute = /^https?:\/\//i.test(String(thumbPath));
                      thumbUrl = isAbsolute
                          ? `/image?url=${encodeURIComponent(String(thumbPath))}`
                          : `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(
                                String(thumbPath)
                            )}`;
                  }
                  return {
                      name,
                      role: r.role || undefined,
                      id: r.id || undefined,
                      thumbUrl: thumbUrl || undefined,
                  };
              }).filter(x => x && (x.name || x.role))
            : null;
        const directors = Array.isArray(sourceItem.Director)
            ? sourceItem.Director.map(d => d.tag).filter(Boolean)
            : null;
        const writers = Array.isArray(sourceItem.Writer)
            ? sourceItem.Writer.map(w => w.tag).filter(Boolean)
            : null;
        const producers = Array.isArray(sourceItem.Producer)
            ? sourceItem.Producer.map(p => p.tag).filter(Boolean)
            : null;
        // Detailed lists including thumbs
        const directorsDetailed = Array.isArray(sourceItem.Director)
            ? sourceItem.Director.map(d => {
                  const thumbPath = d.thumb || d.Thumb;
                  const isAbsolute = thumbPath && /^https?:\/\//i.test(String(thumbPath));
                  return {
                      name: d.tag,
                      id: d.id || undefined,
                      thumbUrl: thumbPath
                          ? isAbsolute
                              ? `/image?url=${encodeURIComponent(String(thumbPath))}`
                              : `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(
                                    String(thumbPath)
                                )}`
                          : undefined,
                  };
              }).filter(e => e.name)
            : null;
        const writersDetailed = Array.isArray(sourceItem.Writer)
            ? sourceItem.Writer.map(w => {
                  const thumbPath = w.thumb || w.Thumb;
                  const isAbsolute = thumbPath && /^https?:\/\//i.test(String(thumbPath));
                  return {
                      name: w.tag,
                      id: w.id || undefined,
                      thumbUrl: thumbPath
                          ? isAbsolute
                              ? `/image?url=${encodeURIComponent(String(thumbPath))}`
                              : `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(
                                    String(thumbPath)
                                )}`
                          : undefined,
                  };
              }).filter(e => e.name)
            : null;
        const producersDetailed = Array.isArray(sourceItem.Producer)
            ? sourceItem.Producer.map(p => {
                  const thumbPath = p.thumb || p.Thumb;
                  const isAbsolute = thumbPath && /^https?:\/\//i.test(String(thumbPath));
                  return {
                      name: p.tag,
                      id: p.id || undefined,
                      thumbUrl: thumbPath
                          ? isAbsolute
                              ? `/image?url=${encodeURIComponent(String(thumbPath))}`
                              : `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(
                                    String(thumbPath)
                                )}`
                          : undefined,
                  };
              }).filter(e => e.name)
            : null;
        // Extract structured GUIDs with source identification
        const guids = Array.isArray(sourceItem.Guid)
            ? sourceItem.Guid.map(g => {
                  const id = g.id || '';
                  // Parse source from GUID format (e.g., "imdb://tt31193180" -> {source: 'imdb', id: 'tt31193180'})
                  const match = id.match(/^([^:]+):\/\/(.+)$/);
                  if (match) {
                      return { source: match[1], id: match[2] };
                  }
                  return { source: 'unknown', id };
              }).filter(g => g.id)
            : null;

        const releaseDate = sourceItem.originallyAvailableAt || sourceItem.firstAired || null;
        const runtimeMs = Number.isFinite(Number(sourceItem.duration))
            ? Number(sourceItem.duration)
            : null;

        // ========================================================================
        // COMPREHENSIVE MEDIA STREAM EXTRACTION (Phase 1: Technical Metadata)
        // ========================================================================
        // Extract ALL technical details from Media.Part.Stream arrays

        let mediaStreams = null;
        let audioTracks = [];
        let subtitles = [];
        let videoStreams = [];
        let hasHDR = false;
        let hasDolbyVision = false;
        const is3D = false;
        let containerFormat = null;
        let totalFileSize = 0;
        let totalBitrate = null;
        let optimizedForStreaming = false;

        if (Array.isArray(sourceItem.Media)) {
            // Plex Note: Media.Part.Stream arrays are not always fully populated in the standard metadata response.
            // If Stream data is missing, we may need to make an additional API call to /library/metadata/{key}
            // with includeElements=1 or query each Part's stream endpoint directly.
            // For now, we attempt to extract whatever stream data Plex provides.

            // Legacy simple mediaStreams for backward compatibility
            mediaStreams = sourceItem.Media.map(m => ({
                videoResolution: m.videoResolution || null,
                videoCodec: m.videoCodec || null,
                audioCodec: m.audioCodec || null,
                audioChannels: m.audioChannels || null,
            }));

            // Process each Media object (typically one per file version)
            sourceItem.Media.forEach((media, mediaIndex) => {
                // Extract container-level info
                if (mediaIndex === 0) {
                    containerFormat = media.container || null;
                    totalBitrate = Number.isFinite(Number(media.bitrate))
                        ? Number(media.bitrate)
                        : null;
                    optimizedForStreaming =
                        media.optimizedForStreaming === '1' || media.optimizedForStreaming === true;
                }

                // Process Parts (file segments)
                if (Array.isArray(media.Part)) {
                    media.Part.forEach(part => {
                        // Accumulate file sizes
                        if (Number.isFinite(Number(part.size))) {
                            totalFileSize += Number(part.size);
                        }

                        // Process Streams (video/audio/subtitle tracks)
                        if (Array.isArray(part.Stream)) {
                            part.Stream.forEach(stream => {
                                const streamType = stream.streamType;

                                // VIDEO STREAMS
                                if (streamType === 1) {
                                    const videoStream = {
                                        index: stream.index || null,
                                        codec: stream.codec || stream.codecID || null,
                                        codecProfile: stream.profile || null,
                                        codecLevel: stream.level || null,
                                        bitrate: Number.isFinite(Number(stream.bitrate))
                                            ? Number(stream.bitrate)
                                            : null,
                                        bitDepth: Number.isFinite(Number(stream.bitDepth))
                                            ? Number(stream.bitDepth)
                                            : null,
                                        width: Number.isFinite(Number(stream.width))
                                            ? Number(stream.width)
                                            : null,
                                        height: Number.isFinite(Number(stream.height))
                                            ? Number(stream.height)
                                            : null,
                                        aspectRatio: stream.aspectRatio || null,
                                        frameRate: stream.frameRate || null,
                                        scanType: stream.scanType || null,
                                        refFrames: Number.isFinite(Number(stream.refFrames))
                                            ? Number(stream.refFrames)
                                            : null,
                                        colorSpace: stream.colorSpace || null,
                                        colorPrimaries: stream.colorPrimaries || null,
                                        colorTrc: stream.colorTrc || null,
                                        colorRange: stream.colorRange || null,
                                        chromaSubsampling: stream.chromaSubsampling || null,
                                        anamorphic: stream.anamorphic || null,
                                        default: stream.default === '1' || stream.default === true,
                                        forced: stream.forced === '1' || stream.forced === true,
                                        selected:
                                            stream.selected === '1' || stream.selected === true,
                                        // HDR/Dolby Vision detection
                                        DOVIPresent:
                                            stream.DOVIPresent === '1' ||
                                            stream.DOVIPresent === true,
                                        hasScalingMatrix:
                                            stream.hasScalingMatrix === '1' ||
                                            stream.hasScalingMatrix === true,
                                        pixelFormat: stream.pixelFormat || null,
                                        streamIdentifier: stream.streamIdentifier || null,
                                        cabac: stream.cabac || null,
                                        duration: Number.isFinite(Number(stream.duration))
                                            ? Number(stream.duration)
                                            : null,
                                        title: stream.title || stream.displayTitle || null,
                                        language: stream.language || stream.languageCode || null,
                                        languageTag: stream.languageTag || null,
                                    };

                                    // Detect HDR
                                    if (stream.DOVIPresent === '1' || stream.DOVIPresent === true) {
                                        hasDolbyVision = true;
                                        hasHDR = true;
                                    }
                                    if (
                                        stream.colorTrc &&
                                        (stream.colorTrc.toLowerCase().includes('pq') ||
                                            stream.colorTrc.toLowerCase().includes('hlg') ||
                                            stream.colorTrc.toLowerCase().includes('smpte2084'))
                                    ) {
                                        hasHDR = true;
                                    }
                                    if (
                                        stream.colorSpace &&
                                        stream.colorSpace.toLowerCase().includes('bt2020')
                                    ) {
                                        hasHDR = true;
                                    }

                                    videoStreams.push(videoStream);
                                }

                                // AUDIO STREAMS
                                else if (streamType === 2) {
                                    const audioTrack = {
                                        index: stream.index || null,
                                        codec: stream.codec || stream.codecID || null,
                                        codecProfile: stream.profile || null,
                                        channels: Number.isFinite(Number(stream.channels))
                                            ? Number(stream.channels)
                                            : null,
                                        channelLayout:
                                            stream.audioChannelLayout ||
                                            stream.channelLayout ||
                                            null,
                                        bitrate: Number.isFinite(Number(stream.bitrate))
                                            ? Number(stream.bitrate)
                                            : null,
                                        bitDepth: Number.isFinite(Number(stream.bitDepth))
                                            ? Number(stream.bitDepth)
                                            : null,
                                        samplingRate: Number.isFinite(Number(stream.samplingRate))
                                            ? Number(stream.samplingRate)
                                            : null,
                                        language: stream.language || stream.languageCode || null,
                                        languageTag: stream.languageTag || null,
                                        title: stream.title || stream.displayTitle || null,
                                        default: stream.default === '1' || stream.default === true,
                                        forced: stream.forced === '1' || stream.forced === true,
                                        selected:
                                            stream.selected === '1' || stream.selected === true,
                                        streamIdentifier: stream.streamIdentifier || null,
                                        duration: Number.isFinite(Number(stream.duration))
                                            ? Number(stream.duration)
                                            : null,
                                        bitrateMode: stream.bitrateMode || null,
                                    };
                                    audioTracks.push(audioTrack);
                                }

                                // SUBTITLE STREAMS
                                else if (streamType === 3) {
                                    const subtitle = {
                                        index: stream.index || null,
                                        codec: stream.codec || stream.codecID || null,
                                        format: stream.format || null,
                                        language: stream.language || stream.languageCode || null,
                                        languageTag: stream.languageTag || null,
                                        title: stream.title || stream.displayTitle || null,
                                        default: stream.default === '1' || stream.default === true,
                                        forced: stream.forced === '1' || stream.forced === true,
                                        selected:
                                            stream.selected === '1' || stream.selected === true,
                                        hearingImpaired:
                                            stream.hearingImpaired === '1' ||
                                            stream.hearingImpaired === true,
                                        key: stream.key || null, // For external subtitles
                                        streamIdentifier: stream.streamIdentifier || null,
                                    };
                                    subtitles.push(subtitle);
                                }
                            });
                        }
                    });
                }
            });
        }

        // Finalize arrays (null if empty)
        audioTracks = audioTracks.length > 0 ? audioTracks : null;
        subtitles = subtitles.length > 0 ? subtitles : null;
        videoStreams = videoStreams.length > 0 ? videoStreams : null;

        // Extract collections (e.g., "Marvel Cinematic Universe")
        const collections = Array.isArray(sourceItem.Collection)
            ? sourceItem.Collection.map(c => ({
                  name: c.tag || c.title,
                  id: c.id || undefined,
              })).filter(c => c.name)
            : null;

        // Extract countries
        const countries = Array.isArray(sourceItem.Country)
            ? sourceItem.Country.map(c => c.tag || c.code).filter(Boolean)
            : null;

        // Audience rating (user/community rating vs critic rating)
        const audienceRating = Number.isFinite(Number(sourceItem.audienceRating))
            ? Number(sourceItem.audienceRating)
            : null;

        // View statistics
        const viewCount = Number.isFinite(Number(sourceItem.viewCount))
            ? Number(sourceItem.viewCount)
            : null;
        const skipCount = Number.isFinite(Number(sourceItem.skipCount))
            ? Number(sourceItem.skipCount)
            : null;
        const lastViewedAt =
            sourceItem.lastViewedAt && !isNaN(Number(sourceItem.lastViewedAt))
                ? Number(sourceItem.lastViewedAt) * 1000
                : null;

        // User rating (personal rating if set)
        const userRating = Number.isFinite(Number(sourceItem.userRating))
            ? Number(sourceItem.userRating)
            : null;

        // Metadata timestamps (Plex provides seconds, convert to milliseconds)
        const addedAt =
            sourceItem.addedAt && !isNaN(Number(sourceItem.addedAt))
                ? Number(sourceItem.addedAt) * 1000
                : null;
        const updatedAt =
            sourceItem.updatedAt && !isNaN(Number(sourceItem.updatedAt))
                ? Number(sourceItem.updatedAt) * 1000
                : null;

        // URL slug (e.g., "sinners-2025")
        const slug = sourceItem.slug || null;

        // Content rating age (numeric age, e.g., 16)
        const contentRatingAge = Number.isFinite(Number(sourceItem.contentRatingAge))
            ? Number(sourceItem.contentRatingAge)
            : null;

        // Original title (for foreign films)
        const originalTitle = sourceItem.originalTitle || null;

        // Sort title (for proper alphabetical sorting)
        const titleSort = sourceItem.titleSort || null;

        // UltraBlurColors (hex color palette for blur effects/theming)
        const ultraBlurColors = sourceItem.UltraBlurColors
            ? {
                  topLeft: sourceItem.UltraBlurColors.topLeft || null,
                  topRight: sourceItem.UltraBlurColors.topRight || null,
                  bottomRight: sourceItem.UltraBlurColors.bottomRight || null,
                  bottomLeft: sourceItem.UltraBlurColors.bottomLeft || null,
              }
            : null;

        // Extract detailed ratings per source (IMDb, Rotten Tomatoes, TMDB, etc.)
        const ratingsDetailed = {};
        if (Array.isArray(sourceItem.Rating)) {
            sourceItem.Rating.forEach(r => {
                const value = Number.isFinite(Number(r.value)) ? Number(r.value) : null;
                const type = r.type || 'unknown'; // 'critic', 'audience', etc.
                const image = r.image || null;

                // Parse source from image URL (e.g., "imdb://image.rating" -> "imdb")
                let source = 'unknown';
                if (image) {
                    const match = image.match(/^([^:]+):\/\//);
                    if (match) source = match[1];
                }

                if (!ratingsDetailed[source]) ratingsDetailed[source] = {};
                ratingsDetailed[source][type] = { value, image };
            });
        }

        // CommonSenseMedia parental guidance
        const parentalGuidance = sourceItem.CommonSenseMedia
            ? {
                  oneLiner: sourceItem.CommonSenseMedia.oneLiner || null,
                  recommendedAge:
                      sourceItem.CommonSenseMedia.AgeRating &&
                      Number.isFinite(Number(sourceItem.CommonSenseMedia.AgeRating.age))
                          ? Number(sourceItem.CommonSenseMedia.AgeRating.age)
                          : null,
              }
            : null;

        // Extract chapter information (for timeline preview)
        const chapters = Array.isArray(sourceItem.Chapter)
            ? sourceItem.Chapter.map(ch => ({
                  index: ch.index || null,
                  startMs: Number.isFinite(Number(ch.startTimeOffset))
                      ? Number(ch.startTimeOffset) / 1000
                      : null,
                  endMs: Number.isFinite(Number(ch.endTimeOffset))
                      ? Number(ch.endTimeOffset) / 1000
                      : null,
                  thumbUrl: ch.thumb
                      ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(ch.thumb)}`
                      : null,
              })).filter(ch => ch.index !== null)
            : null;

        // Extract marker information (credits, intro skip points)
        const markers = Array.isArray(sourceItem.Marker)
            ? sourceItem.Marker.map(m => ({
                  type: m.type || null, // 'credits', 'intro', etc.
                  startMs: Number.isFinite(Number(m.startTimeOffset))
                      ? Number(m.startTimeOffset) / 1000
                      : null,
                  endMs: Number.isFinite(Number(m.endTimeOffset))
                      ? Number(m.endTimeOffset) / 1000
                      : null,
                  final: m.final === '1' || m.final === true,
              })).filter(m => m.type !== null)
            : null;

        // Banner image URL (primarily for TV shows, collections)
        // Check both sourceItem.banner field and Image array
        const bannerPath = getBannerPath(sourceItem.Image, sourceItem.banner);
        const bannerUrl = bannerPath
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(bannerPath)}`
            : null;

        // ========================================================================
        // COMPREHENSIVE IMAGE EXTRACTION (Phase 2: All Image Types)
        // ========================================================================
        // Extract ALL available image types from Image array
        let discArtUrl = null;
        let thumbUrl = null;
        let clearArtUrl = null;
        let landscapeUrl = null;
        let backgroundSquareUrl = null;
        const allArtUrls = [];

        if (Array.isArray(sourceItem.Image)) {
            sourceItem.Image.forEach(img => {
                const imgUrl = img.url || img.path;
                if (!imgUrl) return;

                const encodedUrl = `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(imgUrl)}`;

                switch (img.type) {
                    case 'discArt':
                    case 'disc':
                        if (!discArtUrl) discArtUrl = encodedUrl;
                        break;
                    case 'thumb':
                        if (!thumbUrl) thumbUrl = encodedUrl;
                        break;
                    case 'clearArt':
                        if (!clearArtUrl) clearArtUrl = encodedUrl;
                        break;
                    case 'landscape':
                        if (!landscapeUrl) landscapeUrl = encodedUrl;
                        break;
                    case 'backgroundSquare':
                    case 'squareArt':
                        if (!backgroundSquareUrl) backgroundSquareUrl = encodedUrl;
                        break;
                }

                // Collect all art URLs
                allArtUrls.push({
                    type: img.type,
                    url: encodedUrl,
                    width: img.width || null,
                    height: img.height || null,
                });
            });
        }

        // Extract multiple fanart/background images if available
        const fanart = [];
        if (backgroundArt) {
            fanart.push(
                `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(backgroundArt)}`
            );
        }
        // Plex API may expose additional art via sourceItem.Image array
        if (Array.isArray(sourceItem.Image)) {
            const artImages = sourceItem.Image.filter(
                img => img.type === 'background' || img.type === 'art'
            );
            artImages.forEach(img => {
                if (img.url && img.url !== backgroundArt) {
                    fanart.push(
                        `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(img.url)}`
                    );
                }
            });
        }

        // ========================================================================
        // ADVANCED METADATA (Phase 3: Extras, Related, Theme, Locked Fields)
        // ========================================================================

        // Extract extras (trailers, behind the scenes, deleted scenes, etc.)
        const extras = Array.isArray(sourceItem.Extras?.Metadata)
            ? sourceItem.Extras.Metadata.map(extra => ({
                  type: extra.type || extra.extraType || null,
                  title: extra.title || null,
                  thumb: extra.thumb
                      ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(extra.thumb)}`
                      : null,
                  key: extra.key || null,
                  duration: Number.isFinite(Number(extra.duration)) ? Number(extra.duration) : null,
                  year: extra.year || null,
                  addedAt:
                      extra.addedAt && !isNaN(Number(extra.addedAt))
                          ? Number(extra.addedAt) * 1000
                          : null,
              })).filter(e => e.type)
            : null;

        // Extract related items (similar movies/shows)
        const related = Array.isArray(sourceItem.Related?.Metadata)
            ? sourceItem.Related.Metadata.map(rel => ({
                  title: rel.title || null,
                  key: rel.key || null,
                  type: rel.type || null,
                  thumb: rel.thumb
                      ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(rel.thumb)}`
                      : null,
                  year: rel.year || null,
                  rating: rel.rating || null,
              })).filter(r => r.title)
            : null;

        // Theme music URL (for TV shows)
        const themeUrl = sourceItem.theme
            ? `/proxy/plex?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.theme)}`
            : null;

        // Locked fields (fields that are manually locked and won't be updated by agents)
        const lockedFields = Array.isArray(sourceItem.Field)
            ? sourceItem.Field.filter(f => f.locked === '1' || f.locked === true)
                  .map(f => f.name)
                  .filter(Boolean)
            : null;

        // ========================================================================
        // FILE & LOCATION INFO (Phase 4: File paths, sizes, optimization)
        // ========================================================================

        let filePaths = [];
        let fileDetails = [];

        if (Array.isArray(sourceItem.Media)) {
            sourceItem.Media.forEach(media => {
                if (Array.isArray(media.Part)) {
                    media.Part.forEach(part => {
                        if (part.file) {
                            filePaths.push(part.file);
                            fileDetails.push({
                                file: part.file,
                                size: Number.isFinite(Number(part.size)) ? Number(part.size) : null,
                                container: part.container || null,
                                duration: Number.isFinite(Number(part.duration))
                                    ? Number(part.duration)
                                    : null,
                                videoProfile: part.videoProfile || null,
                                audioProfile: part.audioProfile || null,
                                has64bitOffsets:
                                    part.has64bitOffsets === '1' || part.has64bitOffsets === true,
                                optimizedForStreaming:
                                    part.optimizedForStreaming === '1' ||
                                    part.optimizedForStreaming === true,
                                hasThumbnail:
                                    part.hasThumbnail === '1' || part.hasThumbnail === true,
                            });
                        }
                    });
                }
            });
        }

        filePaths = filePaths.length > 0 ? filePaths : null;
        fileDetails = fileDetails.length > 0 ? fileDetails : null;

        // Extract hierarchy fields (for episodes/seasons/tracks)
        const index = Number.isFinite(Number(sourceItem.index)) ? Number(sourceItem.index) : null;
        const parentIndex = Number.isFinite(Number(sourceItem.parentIndex))
            ? Number(sourceItem.parentIndex)
            : null;
        const absoluteIndex = Number.isFinite(Number(sourceItem.absoluteIndex))
            ? Number(sourceItem.absoluteIndex)
            : null;

        // Parent/grandparent metadata
        const parentKey = sourceItem.parentKey || null;
        const grandparentKey = sourceItem.grandparentKey || null;
        const parentRatingKey = sourceItem.parentRatingKey || null;
        const grandparentRatingKey = sourceItem.grandparentRatingKey || null;
        const parentTitle = sourceItem.parentTitle || null;
        const grandparentTitle = sourceItem.grandparentTitle || null;
        const parentThumb = sourceItem.parentThumb
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.parentThumb)}`
            : null;
        const grandparentThumb = sourceItem.grandparentThumb
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.grandparentThumb)}`
            : null;
        const grandparentArt = sourceItem.grandparentArt
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.grandparentArt)}`
            : null;
        const parentHero = sourceItem.parentHero
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.parentHero)}`
            : null;
        const grandparentHero = sourceItem.grandparentHero
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.grandparentHero)}`
            : null;

        // Hero image
        const heroUrl = sourceItem.hero
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.hero)}`
            : null;

        // Composite image (for playlists/albums)
        const compositeUrl = sourceItem.composite
            ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.composite)}`
            : null;

        // Playback position (continue watching)
        const viewOffset = Number.isFinite(Number(sourceItem.viewOffset))
            ? Number(sourceItem.viewOffset)
            : null;

        // View counts for shows/seasons
        const leafCount = Number.isFinite(Number(sourceItem.leafCount))
            ? Number(sourceItem.leafCount)
            : null;
        const viewedLeafCount = Number.isFinite(Number(sourceItem.viewedLeafCount))
            ? Number(sourceItem.viewedLeafCount)
            : null;

        // Skip flags for mini-series
        const skipChildren = sourceItem.skipChildren === true || sourceItem.skipChildren === '1';
        const skipParent = sourceItem.skipParent === true || sourceItem.skipParent === '1';

        // Primary extra (trailer/music video)
        const primaryExtraKey = sourceItem.primaryExtraKey || null;

        // Chapter source
        const chapterSource = sourceItem.chapterSource || null;

        // ========================================================================
        // REVIEWS & PARENTAL GUIDANCE (Phase 5)
        // ========================================================================

        // Extract reviews (Rotten Tomatoes reviews, critic reviews)
        const reviews = Array.isArray(sourceItem.Review)
            ? sourceItem.Review.map(review => ({
                  id: review.id || null,
                  source: review.source || null,
                  tag: review.tag || null, // Reviewer name
                  text: review.text || null,
                  image: review.image || null, // rottentomatoes://image.review.fresh
                  link: review.link || null,
              })).filter(r => r.text)
            : null;

        // Extract CommonSenseMedia details
        let commonSenseMedia = null;
        if (sourceItem.CommonSenseMedia) {
            const csm = sourceItem.CommonSenseMedia;
            commonSenseMedia = {
                oneLiner: csm.oneLiner || null,
                ageRating: csm.AgeRating
                    ? {
                          type: csm.AgeRating.type || null,
                          rating: Number.isFinite(Number(csm.AgeRating.rating))
                              ? Number(csm.AgeRating.rating)
                              : null,
                          age: Number.isFinite(Number(csm.AgeRating.age))
                              ? Number(csm.AgeRating.age)
                              : null,
                      }
                    : null,
            };
        }

        return {
            key: uniqueKey,
            title: sourceItem.title,
            backgroundUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(backgroundArt)}`,
            posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.thumb)}`,
            thumbnailUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.thumb)}`,
            clearLogoUrl: clearLogoPath
                ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(clearLogoPath)}`
                : null,
            tagline: sourceItem.tagline,
            rating: sourceItem.rating,
            contentRating: sourceItem.contentRating,
            year: sourceItem.year,
            imdbUrl: imdbUrl,
            rottenTomatoes: rottenTomatoesData,
            ratingImage,
            audienceRatingImage,
            ratingCount,
            genres: genres,
            genre_ids:
                sourceItem.Genre && Array.isArray(sourceItem.Genre)
                    ? sourceItem.Genre.map(genre => genre.id)
                    : null,
            quality: qualityLabel, // Add quality field for frontend compatibility
            qualityLabel: qualityLabel,
            library: itemSummary.librarySectionTitle || null, // Add library field from itemSummary
            overview: sourceItem.summary || null,
            studios,
            cast,
            directors,
            writers,
            producers,
            directorsDetailed,
            writersDetailed,
            producersDetailed,
            guids,
            releaseDate,
            runtimeMs,
            mediaStreams,
            // Enriched metadata fields (phase 1: Collections, Statistics, Timestamps)
            collections,
            countries,
            audienceRating,
            viewCount,
            skipCount,
            lastViewedAt,
            userRating,
            originalTitle,
            titleSort,
            bannerUrl,
            fanart: fanart.length > 0 ? fanart : null,
            // Enriched metadata fields (phase 2: Advanced Metadata)
            slug,
            contentRatingAge,
            addedAt,
            updatedAt,
            ultraBlurColors,
            ratingsDetailed: Object.keys(ratingsDetailed).length > 0 ? ratingsDetailed : null,
            parentalGuidance,
            // Episode/Season/Track hierarchy fields
            index,
            parentIndex,
            absoluteIndex,
            parentKey,
            grandparentKey,
            parentRatingKey,
            grandparentRatingKey,
            parentTitle,
            grandparentTitle,
            parentThumb,
            grandparentThumb,
            grandparentArt,
            parentHero,
            grandparentHero,
            // Additional image types
            heroUrl,
            compositeUrl,
            // Playback tracking
            viewOffset,
            leafCount,
            viewedLeafCount,
            // Special flags
            skipChildren: skipChildren || undefined,
            skipParent: skipParent || undefined,
            primaryExtraKey,
            chapterSource,
            // Reviews & enhanced parental guidance
            reviews,
            commonSenseMedia,
            chapters,
            markers,
            // NEW: Comprehensive Technical Metadata (Phase 1)
            audioTracks,
            subtitles,
            videoStreams,
            hasHDR,
            hasDolbyVision,
            is3D,
            containerFormat,
            totalFileSize: totalFileSize > 0 ? totalFileSize : null,
            totalBitrate,
            optimizedForStreaming,
            // NEW: All Image Types (Phase 2)
            discArtUrl,
            thumbUrl,
            clearArtUrl,
            landscapeUrl,
            allArtUrls: allArtUrls.length > 0 ? allArtUrls : null,
            backgroundSquareUrl,
            // NEW: Advanced Metadata (Phase 3)
            extras,
            related,
            themeUrl,
            theme: sourceItem.theme || null, // Raw Plex theme path for direct download
            lockedFields,
            // NEW: File & Location Info (Phase 4)
            filePaths,
            fileDetails,
            // Expose a unified timestamp for "recently added" client-side filtering
            // Plex provides addedAt as seconds since epoch; convert to ms. If missing, use null.
            addedAtMs:
                sourceItem && sourceItem.addedAt && !isNaN(Number(sourceItem.addedAt))
                    ? Number(sourceItem.addedAt) * 1000
                    : null,
            _raw: isDebug ? item : undefined,
        };
    } catch (e) {
        if (isDebug)
            logger.debug(
                `[Debug] Skipping item due to error fetching details for key ${itemSummary.key}: ${e.message}`
            );
        return null;
    }
}

/**
 * Enrich a Plex media item with extras (trailers, theme music) on-demand.
 * Used for streaming support without posterpack generation.
 *
 * @param {Object} item - Media item from /get-media endpoint (must include key field)
 * @param {Object} serverConfig - Server configuration object
 * @param {Object} plex - Plex client instance (optional, will be created if not provided)
 * @param {boolean} isDebug - Debug logging flag
 * @returns {Promise<Object>} Item enriched with extras and themeUrl fields
 */
async function enrichPlexItemWithExtras(item, serverConfig, plex = null, isDebug = false) {
    if (!item || !item.key || !serverConfig) {
        return item;
    }

    // Extract the ratingKey from the composite key (format: "plex-ServerName-12345")
    const keyParts = item.key.split('-');
    if (keyParts.length < 3 || keyParts[0] !== 'plex') {
        if (isDebug) logger.debug(`[enrichPlexItemWithExtras] Invalid key format: ${item.key}`);
        return item;
    }

    const ratingKey = keyParts[keyParts.length - 1]; // Last part is the ratingKey

    try {
        // Get Plex client if not provided
        if (!plex) {
            plex = await getPlexClient(serverConfig);
        }

        // Fetch extras (trailers, behind the scenes, etc.)
        let extras = null;
        try {
            const extrasResponse = await plex.query(`/library/metadata/${ratingKey}/extras`);
            if (
                extrasResponse?.MediaContainer?.Metadata &&
                Array.isArray(extrasResponse.MediaContainer.Metadata)
            ) {
                extras = extrasResponse.MediaContainer.Metadata.map(extra => ({
                    type: extra.type || extra.extraType || null,
                    title: extra.title || null,
                    thumb: extra.thumb
                        ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(extra.thumb)}`
                        : null,
                    key: extra.key || null,
                    duration: Number.isFinite(Number(extra.duration))
                        ? Number(extra.duration)
                        : null,
                    year: extra.year || null,
                    addedAt:
                        extra.addedAt && !isNaN(Number(extra.addedAt))
                            ? Number(extra.addedAt) * 1000
                            : null,
                })).filter(e => e.type);
            }
        } catch (err) {
            if (isDebug)
                logger.debug(
                    `[enrichPlexItemWithExtras] Failed to fetch extras for ${item.title}: ${err.message}`
                );
        }

        // Fetch full metadata to get theme music
        let theme = null;
        let themeUrl = null;
        try {
            const metadataResponse = await plex.query(`/library/metadata/${ratingKey}`);
            if (metadataResponse?.MediaContainer?.Metadata?.[0]) {
                const metadata = metadataResponse.MediaContainer.Metadata[0];

                // Extract theme from Theme array or theme property
                if (metadata.Theme?.[0]?.key) {
                    theme = metadata.Theme[0].key;
                } else if (metadata.theme) {
                    theme = metadata.theme;
                }

                // Build theme URL for streaming
                if (theme) {
                    themeUrl = `/proxy/plex?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(theme)}`;
                }
            }
        } catch (err) {
            if (isDebug)
                logger.debug(
                    `[enrichPlexItemWithExtras] Failed to fetch theme for ${item.title}: ${err.message}`
                );
        }

        // Find first trailer for convenience (for quick access)
        const trailer = extras?.find(e => e.type === 'clip') || null;

        // Return enriched item
        return {
            ...item,
            extras: extras && extras.length > 0 ? extras : null,
            trailer,
            theme,
            themeUrl,
        };
    } catch (err) {
        if (isDebug)
            logger.debug(
                `[enrichPlexItemWithExtras] Error enriching ${item.title}: ${err.message}`
            );
        return item; // Return original item on error
    }
}

/**
 * Gets all music libraries from a Plex server with additional metadata.
 * @param {Object} serverConfig - Server configuration from config.json
 * @returns {Promise<Array>} Array of music library objects with counts
 * @example
 * const musicLibraries = await getPlexMusicLibraries(serverConfig);
 * // [{ key: '1', title: 'Music', type: 'artist', albumCount: 150, artistCount: 42 }]
 */
async function getPlexMusicLibraries(serverConfig) {
    const plex = await getPlexClient(serverConfig);
    const sectionsResponse = await plex.query('/library/sections');
    const allSections = sectionsResponse?.MediaContainer?.Directory || [];

    // Filter for music libraries (type === 'artist')
    const musicLibraries = allSections.filter(lib => lib.type === 'artist');

    // Enrich each library with counts
    const enrichedLibraries = await Promise.all(
        musicLibraries.map(async lib => {
            try {
                // Get album count
                const albumsResponse = await plex.query(`/library/sections/${lib.key}/albums`);
                const albumCount = albumsResponse?.MediaContainer?.size || 0;

                // Get artist count
                const artistsResponse = await plex.query(`/library/sections/${lib.key}/all`);
                const artistCount = artistsResponse?.MediaContainer?.size || 0;

                return {
                    key: lib.key,
                    title: lib.title,
                    type: lib.type,
                    agent: lib.agent || null,
                    scanner: lib.scanner || null,
                    language: lib.language || null,
                    uuid: lib.uuid || null,
                    albumCount,
                    artistCount,
                };
            } catch (err) {
                logger.warn(`Failed to get counts for music library ${lib.title}: ${err.message}`);
                return {
                    key: lib.key,
                    title: lib.title,
                    type: lib.type,
                    agent: lib.agent || null,
                    scanner: lib.scanner || null,
                    language: lib.language || null,
                    uuid: lib.uuid || null,
                    albumCount: 0,
                    artistCount: 0,
                };
            }
        })
    );

    return enrichedLibraries;
}

/**
 * Gets all genres from a Plex music library with usage counts.
 * @param {Object} serverConfig - Server configuration from config.json
 * @param {string} libraryKey - The library section key
 * @returns {Promise<Array>} Array of genre objects with counts, sorted by count descending
 * @example
 * const genres = await getPlexMusicGenres(serverConfig, '1');
 * // [{ tag: 'Rock', count: 250 }, { tag: 'Jazz', count: 120 }]
 */
async function getPlexMusicGenres(serverConfig, libraryKey) {
    const plex = await getPlexClient(serverConfig);

    try {
        // Query all genres for the library section
        const response = await plex.query(`/library/sections/${libraryKey}/genre`);
        const genres = response?.MediaContainer?.Directory || [];

        // Debug: Log response structure
        // Map to simple format and sort alphabetically
        // Note: Plex API doesn't provide count data in genre list responses
        const genreList = genres
            .map(g => ({
                tag: g.title || g.tag,
            }))
            .sort((a, b) => a.tag.localeCompare(b.tag));

        return genreList;
    } catch (err) {
        logger.warn(`Failed to get genres for music library ${libraryKey}: ${err.message}`);
        return [];
    }
}

/**
 * Gets artists from a Plex music library with pagination.
 * @param {Object} serverConfig - Server configuration from config.json
 * @param {string} libraryKey - The library section key
 * @param {number} [limit=100] - Maximum number of artists to return
 * @param {number} [offset=0] - Starting offset for pagination
 * @returns {Promise<Object>} Object with artists array and total count
 * @example
 * const result = await getPlexMusicArtists(serverConfig, '1', 50, 0);
 * // { artists: [{key: '123', title: 'The Beatles', thumb: '...', albumCount: 13}], total: 250 }
 */
async function getPlexMusicArtists(serverConfig, libraryKey, limit = 100, offset = 0) {
    const plex = await getPlexClient(serverConfig);

    try {
        // Query artists with pagination
        const response = await plex.query(
            `/library/sections/${libraryKey}/all?X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${limit}`
        );

        const container = response?.MediaContainer;
        const total = container?.totalSize || container?.size || 0;
        const artistItems = container?.Metadata || [];

        // Map to simplified format
        // Note: Plex API doesn't provide album count in artist list responses
        const artists = artistItems.map(artist => ({
            key: artist.ratingKey || artist.key,
            title: artist.title,
            thumb: artist.thumb || null,
        }));

        return {
            artists,
            total,
        };
    } catch (err) {
        logger.warn(`Failed to get artists for music library ${libraryKey}: ${err.message}`);
        return {
            artists: [],
            total: 0,
        };
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
    processPlexItem,
    enrichPlexItemWithExtras,
    getPlexMusicLibraries,
    getPlexMusicGenres,
    getPlexMusicArtists,
};
