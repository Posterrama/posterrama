/**
 * Modern Plex client using @ctrl/plex
 * Replaces the deprecated plex-api package
 *
 * @ctrl/plex is based on python-plexapi and provides a more robust,
 * object-oriented interface to the Plex Media Server API.
 */
const logger = require('./logger');

// Cache for ESM import
let PlexServerClass = null;

/**
 * Lazy-load the ES module
 */
async function getPlexServer() {
    if (!PlexServerClass) {
        const plexModule = await import('@ctrl/plex');
        PlexServerClass = plexModule.PlexServer;
    }
    return PlexServerClass;
}

/**
 * Creates a modern Plex client using @ctrl/plex
 * @param {object} options - Connection options
 * @param {string} options.hostname - Plex server hostname or IP
 * @param {string|number} options.port - Plex server port
 * @param {string} options.token - Plex authentication token
 * @param {number} [options.timeout] - Request timeout in milliseconds
 * @returns {Promise<PlexServer>} Connected PlexServer instance
 * @throws {Error} If connection fails or parameters are invalid
 */
async function createModernPlexClient({ hostname, port, token, timeout }) {
    const PlexServer = await getPlexServer();
    if (!hostname || !port || !token) {
        throw new Error('Plex client creation failed: missing hostname, port, or token.');
    }

    // Sanitize hostname
    let sanitizedHostname = hostname.trim();
    try {
        const fullUrl = sanitizedHostname.includes('://')
            ? sanitizedHostname
            : `http://${sanitizedHostname}`;
        const url = new URL(fullUrl);
        sanitizedHostname = url.hostname;
    } catch (e) {
        sanitizedHostname = sanitizedHostname.replace(/^https?:\/\//, '');
    }

    // Construct base URL
    const protocol = process.env.PLEX_USE_HTTPS === 'true' ? 'https' : 'http';
    const baseurl = `${protocol}://${sanitizedHostname}:${port}`;

    try {
        // Create and connect to server
        const plex = new PlexServer(baseurl, token, timeout || 30000);
        await plex.connect();

        logger.info(`Connected to Plex server: ${plex.friendlyName} (v${plex.version})`);
        return plex;
    } catch (error) {
        logger.error(`Failed to connect to Plex server at ${baseurl}: ${error.message}`);
        throw error;
    }
}

/**
 * Legacy compatibility adapter for plex-api interface
 * Wraps @ctrl/plex PlexServer to provide query() method
 */
class PlexClientAdapter {
    constructor(plexServer) {
        this.plex = plexServer;
        this.baseurl = plexServer.baseurl;
        this.token = plexServer.token;
    }

    /**
     * Legacy query interface for compatibility with plex-api
     * Maps old plex.query('/path') calls to new @ctrl/plex methods
     *
     * @param {string} path - API endpoint path
     * @returns {Promise<object>} Response data in legacy format
     */
    async query(path) {
        try {
            // Root query - get server info
            if (path === '/' || path === '') {
                // PlexServer is already loaded with server info
                return {
                    friendlyName: this.plex.friendlyName,
                    version: this.plex.version,
                    platform: this.plex.platform,
                    platformVersion: this.plex.platformVersion,
                    machineIdentifier: this.plex.machineIdentifier,
                    myPlex: this.plex.myPlex,
                    myPlexUsername: this.plex.myPlexUsername,
                    transcoderVideo: this.plex.transcoderVideo,
                    transcoderAudio: this.plex.transcoderAudio,
                };
            }

            // Library sections query
            if (path === '/library/sections' || path === '/library/sections/all') {
                const library = await this.plex.library();
                const sections = await library.sections();

                // Convert to legacy format with MediaContainer wrapper
                return {
                    MediaContainer: {
                        Directory: sections.map(section => ({
                            key: section.key,
                            title: section.title,
                            type: section.type,
                            agent: section.agent,
                            scanner: section.scanner,
                            language: section.language,
                            uuid: section.uuid,
                            updatedAt: section.updatedAt,
                            scannedAt: section.scannedAt,
                        })),
                    },
                };
            }

            // Section content query: /library/sections/{id}/all
            const sectionMatch = path.match(/^\/library\/sections\/(\d+)\/all/);
            if (sectionMatch) {
                const sectionId = sectionMatch[1];
                const library = await this.plex.library();
                const section = await library.sectionByID(sectionId);
                const items = await section.all();

                // Convert to legacy format with MediaContainer wrapper
                return {
                    MediaContainer: {
                        size: items.length,
                        totalSize: items.length, // Important: needed for library counts in admin
                        Metadata: items.map(item => ({
                            ratingKey: item.ratingKey,
                            key: item.key,
                            guid: item.guid,
                            type: item.type,
                            title: item.title,
                            titleSort: item.titleSort,
                            summary: item.summary,
                            rating: item.rating,
                            year: item.year,
                            thumb: item.thumb,
                            art: item.art,
                            duration: item.duration,
                            addedAt: item.addedAt,
                            updatedAt: item.updatedAt,
                            contentRating: item.contentRating,
                            studio: item.studio,
                            tagline: item.tagline,
                            // Media array (needed for quality detection)
                            Media:
                                item.media?.map(m => {
                                    // Derive videoResolution from height (like Plex does)
                                    let videoResolution = null;
                                    if (m.height) {
                                        const h = Number(m.height);
                                        if (h >= 2160) videoResolution = '4k';
                                        else if (h >= 1080) videoResolution = '1080';
                                        else if (h >= 720) videoResolution = '720';
                                        else videoResolution = 'sd';
                                    }

                                    return {
                                        videoResolution: videoResolution,
                                        videoCodec: m.videoCodec,
                                        audioCodec: m.audioCodec,
                                        audioChannels: m.audioChannels,
                                        width: m.width,
                                        height: m.height,
                                        bitrate: m.bitrate,
                                    };
                                }) || [],
                            // Genre mapping
                            Genre: item.genres?.map(g => ({ tag: g.tag })) || [],
                            // Director mapping
                            Director: item.directors?.map(d => ({ tag: d.tag })) || [],
                            // Writer mapping
                            Writer: item.writers?.map(w => ({ tag: w.tag })) || [],
                            // Role/Actor mapping
                            Role: item.roles?.map(r => ({ tag: r.tag })) || [],
                            // Country mapping
                            Country: item.countries?.map(c => ({ tag: c.tag })) || [],
                        })),
                    },
                };
            }

            // Section details query: /library/sections/{id}
            const sectionDetailMatch = path.match(/^\/library\/sections\/(\d+)$/);
            if (sectionDetailMatch) {
                const sectionId = sectionDetailMatch[1];
                const library = await this.plex.library();
                const section = await library.sectionByID(sectionId);

                return {
                    key: section.key,
                    title: section.title,
                    type: section.type,
                    agent: section.agent,
                    scanner: section.scanner,
                    language: section.language,
                    uuid: section.uuid,
                    updatedAt: section.updatedAt,
                    scannedAt: section.scannedAt,
                };
            }

            // Now Playing sessions query: /status/sessions
            if (path === '/status/sessions' || path.startsWith('/status/sessions')) {
                const data = await this.plex.query('/status/sessions');

                // data already contains MediaContainer from Plex API
                // Extract and normalize the sessions
                const sessions = data?.MediaContainer?.Metadata || [];

                return {
                    MediaContainer: {
                        size: sessions?.length || 0,
                        Metadata: sessions,
                    },
                };
            }

            // For unmapped paths, use debug level (these are common and non-critical)
            logger.debug(`Unmapped Plex query path: ${path}. Using raw query fallback.`);

            // Fallback: use raw query method if available
            if (typeof this.plex.query === 'function') {
                return await this.plex.query(path);
            }

            throw new Error(
                `Legacy query path not yet mapped: ${path}. Please add explicit mapping.`
            );
        } catch (error) {
            logger.error(`Plex query failed for path ${path}: ${error.message}`);
            throw error;
        }
    }
}

/**
 * Creates a legacy-compatible Plex client
 * This wraps the modern @ctrl/plex PlexServer with a query() interface
 *
 * @param {object} options - Connection options (same as createModernPlexClient)
 * @returns {Promise<PlexClientAdapter>} Adapter with query() method
 */
async function createCompatiblePlexClient(options) {
    const plexServer = await createModernPlexClient(options);
    return new PlexClientAdapter(plexServer);
}

module.exports = {
    createModernPlexClient,
    createCompatiblePlexClient,
    PlexClientAdapter,
};
