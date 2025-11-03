/**
 * @file lib/jellyfin-helpers.js
 * Jellyfin server helper functions for client management, library access, and media processing.
 * Extracted from server.js as part of Phase 1 modularization.
 */

const logger = require('../utils/logger');
const { ApiError } = require('../utils/errors');
const crypto = require('crypto');

/**
 * Caches Jellyfin API clients to avoid re-instantiating for every request.
 * @type {Object.<string, Object>}
 */
const jellyfinClients = {};

/**
 * Tracks the creation config for each cached Jellyfin client so we can detect changes
 * and recreate clients when hostname/port/token/insecure flag changes.
 * @type {Object.<string, { hash: string, createdAt: number }>}
 */
const jellyfinClientMeta = {};

/**
 * Compute a stable hash of Jellyfin connection parameters.
 * @param {Object} params - Connection parameters
 * @param {string} params.hostname - Server hostname
 * @param {number} params.port - Server port
 * @param {string} params.apiKey - API key
 * @param {boolean} params.insecureFlag - Whether to allow insecure HTTPS
 * @returns {string} SHA256 hash of connection parameters
 */
function hashJellyfinConfig({ hostname, port, apiKey, insecureFlag }) {
    const basis = `${hostname || ''}|${port || ''}|${String(apiKey || '').trim()}|${insecureFlag ? '1' : '0'}`;
    return crypto.createHash('sha256').update(basis).digest('hex');
}

/**
 * Invalidate one or all cached Jellyfin clients.
 * @param {string} [name] - Optional client name. If omitted, clears all clients.
 */
function invalidateJellyfinClient(name) {
    if (name) {
        delete jellyfinClients[name];
        delete jellyfinClientMeta[name];
    } else {
        Object.keys(jellyfinClients).forEach(k => delete jellyfinClients[k]);
        Object.keys(jellyfinClientMeta).forEach(k => delete jellyfinClientMeta[k]);
    }
}

/**
 * Creates and caches a Jellyfin API client instance.
 * @param {Object} serverConfig - The server configuration from config.json
 * @param {string} serverConfig.name - Server name
 * @param {string} serverConfig.hostname - Server hostname
 * @param {number} serverConfig.port - Server port
 * @param {string} [serverConfig.apiKey] - Direct API key (for testing)
 * @param {string} [serverConfig.tokenEnvVar] - Environment variable containing API key
 * @param {Object} [serverConfig._directClient] - Direct client instance (for testing)
 * @returns {Promise<Object>} Jellyfin API client with authentication methods
 */
async function getJellyfinClient(serverConfig) {
    const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

    // If a direct client is provided (for testing), use that
    if (serverConfig._directClient) {
        return serverConfig._directClient;
    }

    // Support both environment variables and direct values (for testing)
    const hostname = serverConfig.hostname;
    const port = serverConfig.port;
    let apiKey = serverConfig.apiKey || process.env[serverConfig.tokenEnvVar];

    // If apiKey is still not found, try reading directly from .env file
    if (!apiKey && serverConfig.tokenEnvVar) {
        try {
            const envText = require('fs').readFileSync('.env', 'utf8');
            const re = new RegExp(`^${serverConfig.tokenEnvVar}\\s*=\\s*"?([^"\\n]*)"?`, 'm');
            const match = envText.match(re);
            if (match && match[1]) {
                apiKey = match[1].trim();
                // Update process.env for consistency
                process.env[serverConfig.tokenEnvVar] = apiKey;
                if (isDebug) {
                    logger.debug(
                        `[getJellyfinClient] Loaded ${serverConfig.tokenEnvVar} from .env file (len=${apiKey.length})`
                    );
                }
            }
        } catch (e) {
            if (isDebug) {
                logger.debug(`[getJellyfinClient] Failed to read .env: ${e.message}`);
            }
        }
    }

    const insecureFlag = process.env.JELLYFIN_INSECURE_HTTPS === 'true';

    if (isDebug) {
        logger.debug(`[getJellyfinClient] Creating client for ${serverConfig.name}:`);
        logger.debug(`[getJellyfinClient] - hostname: ${hostname}`);
        logger.debug(`[getJellyfinClient] - port: ${port}`);
        logger.debug(
            `[getJellyfinClient] - apiKey length: ${apiKey ? apiKey.length : 0}, masked: ${apiKey && apiKey.length > 8 ? apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4) : '***'}`
        );
        logger.debug(`[getJellyfinClient] - insecure: ${insecureFlag}`);
    }

    const desiredHash = hashJellyfinConfig({ hostname, port, apiKey, insecureFlag });
    const meta = jellyfinClientMeta[serverConfig.name];

    if (!jellyfinClients[serverConfig.name] || !meta || meta.hash !== desiredHash) {
        // Config changed or no client yet: (re)create Jellyfin client
        if (isDebug && meta && meta.hash !== desiredHash) {
            logger.debug(
                `[Jellyfin Client] Detected config change for "${serverConfig.name}"; recreating client.`
            );
        }
        jellyfinClients[serverConfig.name] = await createJellyfinClient({
            hostname,
            port,
            apiKey,
            insecureHttps: insecureFlag,
        });
        jellyfinClientMeta[serverConfig.name] = { hash: desiredHash, createdAt: Date.now() };
    }
    return jellyfinClients[serverConfig.name];
}

/**
 * Fetches libraries from a Jellyfin client.
 * @param {Object} client - Jellyfin HTTP client instance
 * @returns {Promise<Array>} Array of library objects
 */
async function fetchJellyfinLibraries(client) {
    const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

    try {
        const libraries = await client.getLibraries();

        if (isDebug) {
            logger.debug(
                `[fetchJellyfinLibraries] Found ${libraries.length} libraries:`,
                libraries.map(lib => `${lib.Name} (${lib.CollectionType})`)
            );
        }

        return libraries;
    } catch (error) {
        logger.error(`[fetchJellyfinLibraries] Error: ${error.message}`);
        throw error;
    }
}

/**
 * Creates a new Jellyfin HTTP client instance with the given options.
 * @param {Object} options - Client configuration options
 * @param {string} options.hostname - Jellyfin server hostname/IP
 * @param {number} options.port - Jellyfin server port
 * @param {string} options.apiKey - Jellyfin API key for authentication
 * @param {number} [options.timeout=15000] - Request timeout in milliseconds
 * @param {boolean} [options.insecureHttps=false] - Allow insecure HTTPS connections
 * @param {number} [options.retryMaxRetries=1] - Maximum number of retries
 * @param {number} [options.retryBaseDelay=500] - Base delay for retries in milliseconds
 * @returns {Promise<Object>} A new Jellyfin HTTP client instance
 * @throws {ApiError} If required parameters are missing or invalid
 */
async function createJellyfinClient({
    hostname,
    port,
    apiKey,
    timeout = 15000,
    insecureHttps = false,
    retryMaxRetries = 1,
    retryBaseDelay = 500,
}) {
    const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

    if (!hostname || !port || !apiKey) {
        throw new ApiError(
            500,
            'Jellyfin client creation failed: missing hostname, port, or API key.'
        );
    }

    const { JellyfinHttpClient } = require('../utils/jellyfin-http-client');

    // Sanitize hostname to prevent crashes if the user includes the protocol
    let sanitizedHostname = hostname.trim();
    let basePath = '';
    try {
        const fullUrl = sanitizedHostname.includes('://')
            ? sanitizedHostname
            : `http://${sanitizedHostname}`;
        const url = new URL(fullUrl);
        sanitizedHostname = url.hostname;
        // Capture any pathname as basePath for reverse proxies (e.g., /jellyfin)
        basePath = url.pathname && url.pathname !== '/' ? url.pathname : '';
        if (isDebug)
            logger.debug(
                `[Jellyfin Client] Sanitized hostname to: "${sanitizedHostname}", basePath: "${basePath}"`
            );
    } catch (e) {
        sanitizedHostname = sanitizedHostname.replace(/^https?:\/\//, '');
        if (isDebug)
            logger.debug(
                `[Jellyfin Client] Could not parse hostname as URL, falling back to simple sanitization: "${sanitizedHostname}"`
            );
    }

    const client = new JellyfinHttpClient({
        hostname: sanitizedHostname,
        port,
        apiKey: String(apiKey).trim(),
        timeout,
        basePath,
        insecure: !!insecureHttps,
        insecureHttps: !!insecureHttps,
        retryMaxRetries,
        retryBaseDelay,
    });

    // Basic token sanity check early (avoid obvious empty/placeholder)
    if (!client.apiKey || client.apiKey === 'changeme' || client.apiKey.length < 8) {
        throw new ApiError(400, 'Jellyfin API key appears invalid or missing.');
    }
    // Test connection to ensure it works; if base path looks wrong, try a sensible fallback
    try {
        await client.testConnection();
    } catch (err) {
        const looksLikeBasePathIssue =
            err && (err.code === 'EJELLYFIN_NOT_FOUND' || /404/.test(err.message));
        const noBasePathSet = !basePath || basePath === '' || basePath === '/';
        if (looksLikeBasePathIssue && noBasePathSet) {
            if (isDebug)
                logger.debug('[Jellyfin Client] 404 on test, retrying with basePath="/jellyfin"');
            const clientWithBase = new JellyfinHttpClient({
                hostname: sanitizedHostname,
                port,
                apiKey: String(apiKey).trim(),
                timeout,
                basePath: '/jellyfin',
                insecure: !!insecureHttps,
                insecureHttps: !!insecureHttps,
                retryMaxRetries,
                retryBaseDelay,
            });
            await clientWithBase.testConnection();
            return clientWithBase;
        }
        throw err;
    }

    return client;
}

/**
 * Fetches all library sections from a Jellyfin server and returns them as a Map.
 * @param {Object} serverConfig - The configuration for the Jellyfin server
 * @returns {Promise<Map<string, Object>>} A map of library names to library objects
 * @throws {ApiError} If the server connection fails or returns an error
 */
async function getJellyfinLibraries(serverConfig) {
    const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

    try {
        const client = await getJellyfinClient(serverConfig);

        // Use our new HTTP client method
        const libraries = await client.getLibraries();
        const librariesMap = new Map();

        libraries.forEach(library => {
            // Jellyfin virtual folders use ItemId instead of Id
            const libraryId = library.ItemId || library.Id;
            if (library.Name && libraryId) {
                librariesMap.set(library.Name, {
                    id: libraryId,
                    name: library.Name,
                    type: library.CollectionType || 'mixed',
                });
            }
        });

        if (isDebug) {
            logger.debug(`[getJellyfinLibraries] Found ${librariesMap.size} libraries`);
        }

        return librariesMap;
    } catch (error) {
        logger.error(`[getJellyfinLibraries] Error: ${error.message}`);
        throw new ApiError(500, `Failed to fetch Jellyfin libraries: ${error.message}`);
    }
}

/**
 * Processes a Jellyfin media item and converts it to Posterrama format.
 * @param {Object} item - Raw Jellyfin item object
 * @param {Object} serverConfig - Server configuration
 * @param {Object} client - Jellyfin client instance
 * @returns {Object|null} Processed media item or null if invalid
 */
function processJellyfinItem(item, serverConfig, client) {
    try {
        if (!item || !item.Id || !item.Name) {
            return null;
        }

        // Determine media type
        const mediaType =
            item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'show' : 'unknown';

        if (mediaType === 'unknown') {
            return null;
        }

        // Build poster and backdrop URLs using the image proxy
        let posterUrl = null;
        let backdropUrl = null;
        let clearLogoUrl = null;

        // Use the dedicated Primary endpoint for posters only if image exists
        if (item.ImageTags && item.ImageTags.Primary) {
            const primaryImageUrl = client.getImageUrl(item.Id, 'Primary');
            posterUrl = `/image?url=${encodeURIComponent(primaryImageUrl)}`;
        }

        // Use the dedicated Backdrop endpoint for backgrounds only if image exists
        if (
            (item.ImageTags && item.ImageTags.Backdrop) ||
            (item.BackdropImageTags && item.BackdropImageTags.length > 0)
        ) {
            const backdropImageUrl = client.getImageUrl(item.Id, 'Backdrop');
            backdropUrl = `/image?url=${encodeURIComponent(backdropImageUrl)}`;
        }

        // Use the dedicated Logo endpoint for clear logos only if image exists
        if (item.ImageTags && item.ImageTags.Logo) {
            const logoImageUrl = client.getImageUrl(item.Id, 'Logo');
            clearLogoUrl = `/image?url=${encodeURIComponent(logoImageUrl)}`;
        }

        // Add banner image support
        let bannerUrl = null;
        if (item.ImageTags && item.ImageTags.Banner) {
            const bannerImageUrl = client.getImageUrl(item.Id, 'Banner');
            bannerUrl = `/image?url=${encodeURIComponent(bannerImageUrl)}`;
        }

        // Add disc art support
        let discArtUrl = null;
        if (item.ImageTags && item.ImageTags.Disc) {
            const discImageUrl = client.getImageUrl(item.Id, 'Disc');
            discArtUrl = `/image?url=${encodeURIComponent(discImageUrl)}`;
        }

        // Build fanart array from all backdrop images
        const fanart = [];
        if (item.BackdropImageTags && Array.isArray(item.BackdropImageTags)) {
            item.BackdropImageTags.forEach((tag, index) => {
                const backdropUrl = client.getImageUrl(item.Id, 'Backdrop', index);
                fanart.push(`/image?url=${encodeURIComponent(backdropUrl)}`);
            });
        }

        // Add thumb URL (for episodes/chapters)
        let thumbUrl = null;
        if (item.ImageTags && item.ImageTags.Thumb) {
            const thumbImageUrl = client.getImageUrl(item.Id, 'Thumb');
            thumbUrl = `/image?url=${encodeURIComponent(thumbImageUrl)}`;
        }

        // Infer a simple quality label from MediaStreams height, when available
        let qualityLabel = null;
        const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
        for (const source of sources) {
            const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
            const vid = streams.find(s => s.Type === 'Video' && s.Height);
            if (vid && Number.isFinite(Number(vid.Height))) {
                const h = Number(vid.Height);
                if (h <= 576) qualityLabel = 'SD';
                else if (h <= 720) qualityLabel = '720p';
                else if (h <= 1080) qualityLabel = '1080p';
                else if (h >= 2160) qualityLabel = '4K';
                else qualityLabel = `${h}p`;
                break;
            }
        }

        // Extract metadata
        const processedItem = {
            id: `jellyfin_${item.Id}`,
            key: `jellyfin_${item.Id}`, // Add key property for consistency with Plex
            title: item.Name, // Use Name as primary title
            originalTitle: item.OriginalTitle || null, // Separate original title field
            titleSort: item.SortName || null, // For proper alphabetical sorting
            type: mediaType,
            year: item.ProductionYear || null,
            posterUrl: posterUrl,
            thumbnailUrl: posterUrl,
            backgroundUrl: backdropUrl, // Use backgroundUrl for consistency with Plex
            clearLogoUrl: clearLogoUrl, // Add clear logo support
            bannerUrl: bannerUrl, // Add banner support
            discArtUrl: discArtUrl, // Add disc art support
            thumbUrl: thumbUrl, // Add thumb support for episodes
            poster: posterUrl, // Keep legacy property for backward compatibility
            overview: item.Overview || '',
            tagline: item.Taglines?.[0] || null, // Use first tagline from array
            genres: item.Genres || [],
            rating: item.CommunityRating || null,
            contentRating: item.OfficialRating || null, // Alias for consistency with Plex
            // Extended ratings information from Jellyfin
            ratings: {
                community: item.CommunityRating || null, // 0-10 scale
                official: item.OfficialRating || null, // MPAA rating (PG, R, etc.)
                user: item.UserData?.Rating || null, // User's personal rating
            },
            officialRating: item.OfficialRating || null, // Keep for backward compatibility
            source: 'jellyfin',
            serverName: serverConfig.name,
            originalData: item,
            qualityLabel: qualityLabel,
            // Use DateCreated (ISO) as recently-added timestamp in ms when available
            addedAtMs: item.DateCreated ? new Date(item.DateCreated).getTime() : null,
        };

        // Enrich with best-effort fields for posterpack metadata
        try {
            processedItem.studios = Array.isArray(item.Studios)
                ? item.Studios.map(s => (s && (s.Name || s.Id)) || s).filter(Boolean)
                : [];
        } catch (_) {
            // ignore enrichment failures for studios
        }

        // Add GUID mappings for external IDs (imdb, tmdb, tvdb, etc.)
        try {
            if (item.ProviderIds) {
                processedItem.guids = [];
                if (item.ProviderIds.Imdb) {
                    const imdbId = item.ProviderIds.Imdb.replace(/^tt/, '');
                    processedItem.guids.push(`imdb://tt${imdbId}`);
                    processedItem.imdbUrl = `https://www.imdb.com/title/tt${imdbId}`;
                }
                if (item.ProviderIds.Tmdb) {
                    processedItem.guids.push(`tmdb://${item.ProviderIds.Tmdb}`);
                }
                if (item.ProviderIds.Tvdb) {
                    processedItem.guids.push(`tvdb://${item.ProviderIds.Tvdb}`);
                }
                if (item.ProviderIds.TvRage) {
                    processedItem.guids.push(`tvrage://${item.ProviderIds.TvRage}`);
                }
            }
        } catch (_) {
            // ignore enrichment failures for GUIDs
        }

        // Add Rotten Tomatoes rating if available
        try {
            if (item.CriticRating != null) {
                processedItem.rottenTomatoes = {
                    rating: item.CriticRating, // 0-100 scale
                    url: null, // Jellyfin doesn't provide direct RT URLs
                };
            }
        } catch (_) {
            // ignore enrichment failures for RT rating
        }

        // Add countries (production locations)
        try {
            if (item.ProductionLocations && item.ProductionLocations.length > 0) {
                processedItem.countries = item.ProductionLocations;
            }
        } catch (_) {
            // ignore enrichment failures for countries
        }

        // Add fanart array (multiple backdrop images)
        try {
            if (fanart.length > 0) {
                processedItem.fanart = fanart;
            }
        } catch (_) {
            // ignore enrichment failures for fanart
        }

        try {
            const people = Array.isArray(item.People) ? item.People : [];
            const mapThumb = pid =>
                pid ? `/image?url=${encodeURIComponent(client.getImageUrl(pid, 'Primary'))}` : null;
            processedItem.cast = people
                .filter(p => p && p.Type === 'Actor')
                .map(p => ({
                    name: p.Name,
                    role: p.Role || p.Type,
                    id: p.Id,
                    thumbUrl: mapThumb(p.Id) || undefined,
                }))
                .filter(x => x && x.name);
            processedItem.directors = people
                .filter(p => p && p.Type === 'Director')
                .map(p => p.Name)
                .filter(Boolean);
            processedItem.writers = people
                .filter(p => p && (p.Type === 'Writer' || p.Type === 'Screenwriter'))
                .map(p => p.Name)
                .filter(Boolean);
            processedItem.producers = people
                .filter(p => p && p.Type === 'Producer')
                .map(p => p.Name)
                .filter(Boolean);
            // Detailed lists for people with thumbs
            processedItem.directorsDetailed = people
                .filter(p => p && p.Type === 'Director')
                .map(p => ({ name: p.Name, id: p.Id, thumbUrl: mapThumb(p.Id) || undefined }))
                .filter(e => e.name);
            processedItem.writersDetailed = people
                .filter(p => p && (p.Type === 'Writer' || p.Type === 'Screenwriter'))
                .map(p => ({ name: p.Name, id: p.Id, thumbUrl: mapThumb(p.Id) || undefined }))
                .filter(e => e.name);
            processedItem.producersDetailed = people
                .filter(p => p && p.Type === 'Producer')
                .map(p => ({ name: p.Name, id: p.Id, thumbUrl: mapThumb(p.Id) || undefined }))
                .filter(e => e.name);
        } catch (_) {
            // ignore enrichment failures for people extraction
        }
        try {
            processedItem.releaseDate = item.PremiereDate || item.ProductionYear || null;
            processedItem.runtimeMs = Number.isFinite(Number(item.RunTimeTicks))
                ? Math.round(Number(item.RunTimeTicks) / 10000) // ticks to ms
                : null;
        } catch (_) {
            // ignore enrichment failures for release/runtime fields
        }

        // Add user viewing statistics (Phase 2)
        try {
            if (item.UserData) {
                processedItem.viewCount = item.UserData.PlayCount || 0;
                if (item.UserData.LastPlayedDate) {
                    processedItem.lastViewedAt = new Date(item.UserData.LastPlayedDate).getTime();
                }
            }
        } catch (_) {
            // ignore enrichment failures for user stats
        }

        // Add last updated timestamp
        try {
            if (item.DateLastSaved) {
                processedItem.updatedAt = new Date(item.DateLastSaved).getTime();
            } else if (item.DateCreated) {
                processedItem.updatedAt = new Date(item.DateCreated).getTime();
            }
        } catch (_) {
            // ignore enrichment failures for timestamps
        }

        // Generate URL-friendly slug for deep linking
        try {
            if (processedItem.title && processedItem.year) {
                processedItem.slug = `${processedItem.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')}-${processedItem.year}`;
            }
        } catch (_) {
            // ignore enrichment failures for slug generation
        }

        try {
            // Flatten minimal media stream info
            const mediaStreams = [];
            const sources2 = Array.isArray(item.MediaSources) ? item.MediaSources : [];
            for (const source of sources2) {
                const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
                const v = streams.find(s => s.Type === 'Video');
                const a = streams.find(s => s.Type === 'Audio');
                mediaStreams.push({
                    videoResolution:
                        v?.Height || v?.Width ? `${v.Height || ''}x${v.Width || ''}` : null,
                    videoCodec: v?.Codec || null,
                    audioCodec: a?.Codec || null,
                    audioChannels: a?.Channels || null,
                });
            }
            if (mediaStreams.length) processedItem.mediaStreams = mediaStreams;
        } catch (_) {
            // ignore mediaStreams extraction issues
        }

        // Extract detailed audio and subtitle tracks (Phase 4)
        try {
            const audioTracks = [];
            const subtitles = [];
            const sources3 = Array.isArray(item.MediaSources) ? item.MediaSources : [];

            for (const source of sources3) {
                const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];

                // Extract audio tracks
                streams
                    .filter(s => s.Type === 'Audio')
                    .forEach(a => {
                        audioTracks.push({
                            codec: a.Codec || null,
                            language: a.Language || a.DisplayLanguage || 'und',
                            channels: a.Channels || null,
                            channelLayout: a.ChannelLayout || null,
                            bitrate: a.BitRate || null,
                            title: a.Title || a.DisplayTitle || null,
                            isDefault: a.IsDefault || false,
                        });
                    });

                // Extract subtitle tracks
                streams
                    .filter(s => s.Type === 'Subtitle')
                    .forEach(s => {
                        subtitles.push({
                            codec: s.Codec || null,
                            language: s.Language || s.DisplayLanguage || 'und',
                            title: s.Title || s.DisplayTitle || null,
                            isForced: s.IsForced || false,
                            isDefault: s.IsDefault || false,
                            isExternal: s.IsExternal || false,
                        });
                    });
            }

            if (audioTracks.length > 0) processedItem.audioTracks = audioTracks;
            if (subtitles.length > 0) processedItem.subtitles = subtitles;
        } catch (_) {
            // ignore audio/subtitle extraction issues
        }

        // Detect HDR and 3D capabilities
        try {
            const sources4 = Array.isArray(item.MediaSources) ? item.MediaSources : [];
            let hasHDR = false;
            let is3D = false;

            for (const source of sources4) {
                const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
                const videoStream = streams.find(s => s.Type === 'Video');

                if (videoStream) {
                    // Check for HDR
                    if (videoStream.VideoRangeType && videoStream.VideoRangeType !== 'SDR') {
                        hasHDR = true;
                    }
                    // Alternative HDR detection via codec profile
                    if (
                        videoStream.Profile &&
                        (videoStream.Profile.includes('HDR') ||
                            videoStream.Profile.includes('PQ') ||
                            videoStream.Profile.includes('HLG'))
                    ) {
                        hasHDR = true;
                    }

                    // Check for 3D
                    if (videoStream.Video3DFormat && videoStream.Video3DFormat !== 'None') {
                        is3D = true;
                    }
                }

                // Also check container-level 3D flag
                if (source.Video3DFormat && source.Video3DFormat !== 'None') {
                    is3D = true;
                }
            }

            if (hasHDR) processedItem.hasHDR = true;
            if (is3D) processedItem.is3D = true;
        } catch (_) {
            // ignore HDR/3D detection issues
        }

        // Extract comprehensive video stream details (Phase 4 comprehensive extraction)
        try {
            const videoStreams = [];
            const sources5 = Array.isArray(item.MediaSources) ? item.MediaSources : [];

            for (const source of sources5) {
                const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
                const videoStream = streams.find(s => s.Type === 'Video');

                if (videoStream) {
                    videoStreams.push({
                        index: videoStream.Index || null,
                        codec: videoStream.Codec || null,
                        codecProfile: videoStream.Profile || null,
                        codecLevel: videoStream.Level || null,
                        bitrate: videoStream.BitRate || null,
                        bitDepth: videoStream.BitDepth || null,
                        width: videoStream.Width || null,
                        height: videoStream.Height || null,
                        aspectRatio: videoStream.AspectRatio || null,
                        frameRate:
                            videoStream.RealFrameRate || videoStream.AverageFrameRate || null,
                        scanType: videoStream.IsInterlaced ? 'interlaced' : 'progressive',
                        refFrames: videoStream.RefFrames || null,
                        colorSpace: videoStream.ColorSpace || null,
                        colorPrimaries: videoStream.ColorPrimaries || null,
                        colorTransfer: videoStream.ColorTransfer || null,
                        colorRange: videoStream.ColorRange || null,
                        pixelFormat: videoStream.PixelFormat || null,
                        videoRange: videoStream.VideoRangeType || null,
                        videoDoViTitle: videoStream.DvTitle || null,
                        title: videoStream.Title || videoStream.DisplayTitle || null,
                        language: videoStream.Language || null,
                        isDefault: videoStream.IsDefault || false,
                    });
                }
            }

            if (videoStreams.length > 0) processedItem.videoStreams = videoStreams;
        } catch (_) {
            // ignore video stream extraction issues
        }

        // Extract file details and container information (Phase 6)
        try {
            const filePaths = [];
            const fileDetails = [];
            let totalFileSize = 0;
            let totalBitrate = 0;
            let containerFormat = null;

            const sources6 = Array.isArray(item.MediaSources) ? item.MediaSources : [];

            for (const source of sources6) {
                if (source.Path) {
                    filePaths.push(source.Path);
                }

                if (source.Size) {
                    totalFileSize += source.Size;
                }

                if (source.Bitrate) {
                    totalBitrate = Math.max(totalBitrate, source.Bitrate);
                }

                if (source.Container && !containerFormat) {
                    containerFormat = source.Container;
                }

                // Build fileDetails entry
                if (source.Path || source.Size) {
                    fileDetails.push({
                        file: source.Path || null,
                        size: source.Size || null,
                        container: source.Container || null,
                        duration: source.RunTimeTicks
                            ? Math.round(source.RunTimeTicks / 10000)
                            : null,
                        bitrate: source.Bitrate || null,
                        videoCodec: source.VideoCodec || null,
                        audioCodec: source.AudioCodec || null,
                        isRemote: source.IsRemote || false,
                        supportsDirectPlay: source.SupportsDirectPlay || false,
                        supportsDirectStream: source.SupportsDirectStream || false,
                        supportsTranscoding: source.SupportsTranscoding || false,
                    });
                }
            }

            if (filePaths.length > 0) processedItem.filePaths = filePaths;
            if (fileDetails.length > 0) processedItem.fileDetails = fileDetails;
            if (totalFileSize > 0) processedItem.totalFileSize = totalFileSize;
            if (totalBitrate > 0) processedItem.totalBitrate = totalBitrate;
            if (containerFormat) processedItem.containerFormat = containerFormat;
        } catch (_) {
            // ignore file details extraction issues
        }

        // Detect Dolby Vision and HDR formats (comprehensive HDR detection)
        try {
            const sources7 = Array.isArray(item.MediaSources) ? item.MediaSources : [];
            let hasDolbyVision = false;
            const hdrFormats = [];

            for (const source of sources7) {
                const streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
                const videoStream = streams.find(s => s.Type === 'Video');

                if (videoStream) {
                    // Check VideoRangeType field
                    const rangeType = videoStream.VideoRangeType || '';
                    if (rangeType.toLowerCase().includes('dovi') || rangeType.includes('DV')) {
                        hasDolbyVision = true;
                        if (!hdrFormats.includes('Dolby Vision')) hdrFormats.push('Dolby Vision');
                    }
                    if (rangeType.toLowerCase().includes('hdr10+')) {
                        if (!hdrFormats.includes('HDR10+')) hdrFormats.push('HDR10+');
                    }
                    if (
                        rangeType.toLowerCase().includes('hdr10') ||
                        rangeType.toLowerCase().includes('hdr')
                    ) {
                        if (!hdrFormats.includes('HDR10')) hdrFormats.push('HDR10');
                    }
                    if (rangeType.toLowerCase().includes('hlg')) {
                        if (!hdrFormats.includes('HLG')) hdrFormats.push('HLG');
                    }

                    // Check codec profile for additional HDR hints
                    const profile = videoStream.Profile || '';
                    if (profile.toLowerCase().includes('dv') || profile.includes('dolby')) {
                        hasDolbyVision = true;
                        if (!hdrFormats.includes('Dolby Vision')) hdrFormats.push('Dolby Vision');
                    }
                }
            }

            if (hasDolbyVision) processedItem.hasDolbyVision = true;
            if (hdrFormats.length > 0) processedItem.hdrFormats = hdrFormats;
        } catch (_) {
            // ignore Dolby Vision/HDR detection issues
        }

        // Add type-specific metadata
        if (mediaType === 'movie') {
            processedItem.runtime = item.RunTimeTicks
                ? Math.round(item.RunTimeTicks / 600000000)
                : null; // Convert ticks to minutes
        } else if (mediaType === 'show') {
            processedItem.seasons = item.ChildCount || null;
        }

        return processedItem;
    } catch (error) {
        logger.warn(`[processJellyfinItem] Error processing item ${item?.Name}: ${error.message}`);
        return null;
    }
}

module.exports = {
    hashJellyfinConfig,
    invalidateJellyfinClient,
    getJellyfinClient,
    fetchJellyfinLibraries,
    createJellyfinClient,
    getJellyfinLibraries,
    processJellyfinItem,
};
