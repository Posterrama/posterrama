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
                sourceItem = { ...showData, Media: item.Media };
                backgroundArt = showData.art; // Use the show's art for the background
            }
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
            // NEW: Advanced Metadata (Phase 3)
            extras,
            related,
            themeUrl,
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

module.exports = {
    createPlexClient,
    getPlexClient,
    clearPlexClients,
    getPlexLibraries,
    getPlexGenres,
    getPlexGenresWithCounts,
    getPlexQualitiesWithCounts,
    processPlexItem,
};
