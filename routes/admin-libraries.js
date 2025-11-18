/**
 * Admin Library Routes
 * Handles Plex/Jellyfin library management, genre endpoints, and library browsing.
 *
 * @module routes/admin-libraries
 */

module.exports = function createAdminLibrariesRouter({
    logger,
    isDebug,
    readConfig,
    asyncHandler,
    isAuthenticated,
    ApiError,
    createJellyfinClient,
    fetchJellyfinLibraries,
    getPlexGenres,
    getPlexGenresWithCounts,
}) {
    const express = require('express');
    const config = require('../config/');
    const router = express.Router();

    /**
     * @swagger
     * /api/admin/jellyfin-libraries:
     *   post:
     *     summary: Fetch Jellyfin libraries
     *     description: Retrieves all libraries/views from a Jellyfin server.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               hostname:
     *                 type: string
     *                 description: Jellyfin server hostname (e.g., '192.168.1.10')
     *               port:
     *                 type: number
     *                 description: Jellyfin server port
     *               apiKey:
     *                 type: string
     *                 description: Jellyfin API key
     *               insecureHttps:
     *                 type: boolean
     *                 description: Allow insecure HTTPS connections
     *     responses:
     *       200:
     *         description: Successfully retrieved libraries
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 libraries:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                       name:
     *                         type: string
     *                       count:
     *                         type: number
     *                       type:
     *                         type: string
     *       400:
     *         description: Could not fetch libraries (e.g., incorrect credentials).
     */
    router.post(
        '/api/admin/jellyfin-libraries',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin API] Received request to fetch Jellyfin libraries.');
            // Get server configuration with fallbacks
            const currentConfig = await readConfig();
            const {
                hostname,
                port,
                token: apiKey,
            } = require('../lib/config-helpers').getServerConfig({
                config: currentConfig,
                serverType: 'jellyfin',
                requestBody: { ...req.body, token: req.body.apiKey },
            });

            if (!hostname || !port || !apiKey) {
                throw new ApiError(
                    400,
                    'Jellyfin connection details (hostname, port, API key) are missing.'
                );
            }

            try {
                const client = await createJellyfinClient({
                    hostname,
                    port,
                    apiKey,
                    timeout: 6000,
                    insecureHttps:
                        typeof req.body.insecureHttps !== 'undefined'
                            ? !!req.body.insecureHttps
                            : process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                    retryMaxRetries: 0,
                    retryBaseDelay: 300,
                });

                // Step 1: Get user views (libraries)
                // First try to get any user to use for the Views endpoint
                let userViews = [];
                try {
                    // Try the general Views endpoint first
                    const viewsResponse = await client.http.get('/Library/Views');
                    userViews = viewsResponse?.data?.Items || [];
                } catch (viewsError) {
                    if (isDebug) {
                        logger.debug(
                            '[Jellyfin Libraries] Library/Views failed, trying Users endpoint:',
                            viewsError.message
                        );
                    }

                    try {
                        // Get users and use the first one
                        const usersResponse = await client.http.get('/Users');
                        const users = usersResponse?.data || [];

                        if (users.length > 0) {
                            const userId = users[0].Id;
                            const userViewsResponse = await client.http.get(
                                `/Users/${userId}/Views`
                            );
                            userViews = userViewsResponse?.data?.Items || [];
                        }
                    } catch (userError) {
                        if (isDebug) {
                            logger.debug(
                                '[Jellyfin Libraries] Users approach also failed:',
                                userError.message
                            );
                        }
                        // Fallback to original virtual folders approach
                        const libraries = await fetchJellyfinLibraries(client);
                        userViews = libraries.map(lib => ({
                            Id: lib.Id,
                            Name: lib.Name,
                            CollectionType: lib.CollectionType,
                        }));
                    }
                }

                if (isDebug) {
                    logger.debug(
                        '[Jellyfin Libraries] Found user views:',
                        userViews.map(view => `${view.Name} (${view.CollectionType || 'unknown'})`)
                    );
                }

                // Step 2: For each library, get the item counts
                const formattedLibraries = await Promise.all(
                    userViews.map(async view => {
                        let itemCount = 0;
                        // Map Jellyfin CollectionType to frontend-expected format (movie/show, not movies/series)
                        const libType =
                            view.CollectionType === 'movies'
                                ? 'movie'
                                : view.CollectionType === 'tvshows'
                                  ? 'show'
                                  : 'unknown';

                        try {
                            // Get the count of items in this library
                            const itemsResponse = await client.http.get('/Items', {
                                params: {
                                    ParentId: view.Id,
                                    Recursive: true,
                                    IncludeItemTypes: libType === 'movie' ? 'Movie' : 'Series',
                                    Fields: 'Id',
                                    Limit: 1, // We only need the count
                                },
                            });
                            itemCount = itemsResponse?.data?.TotalRecordCount || 0;
                        } catch (countError) {
                            if (isDebug) {
                                logger.debug(
                                    `[Jellyfin Libraries] Failed to get count for ${view.Name}:`,
                                    countError.message
                                );
                            }
                        }

                        return {
                            id: view.Id,
                            name: view.Name,
                            itemCount: itemCount, // Use itemCount for consistency with Plex
                            type: libType,
                        };
                    })
                );

                const responsePayload = {
                    libraries: formattedLibraries.filter(lib => lib.type !== 'unknown'),
                };

                if (isDebug) {
                    logger.debug(
                        `[Admin API] Jellyfin libraries fetched: ${responsePayload.libraries.length} libraries found.`
                    );
                }

                return res.json(responsePayload);
            } catch (error) {
                logger.error('[Admin API] Failed to fetch Jellyfin libraries:', error?.message);
                throw new ApiError(400, error?.message || 'Could not fetch libraries. Check logs.');
            }
        })
    );

    /**
     * @openapi
     * /api/admin/plex-genres:
     *   get:
     *     summary: Returns all Plex genres
     *     tags:
     *       - Admin
     *     security:
     *       - BearerAuth: []
     *       - SessionAuth: []
     *     responses:
     *       200:
     *         description: Successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: string
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/plex-genres',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin API] Request received for /api/admin/plex-genres.');

            const currentConfig = await readConfig();
            const { getAllEnabledServers } = require('../lib/config-helpers');
            const enabledServers = getAllEnabledServers(currentConfig, 'plex');

            if (enabledServers.length === 0) {
                return res.json({ genres: [] });
            }

            const allGenres = new Set();

            for (const server of enabledServers) {
                try {
                    const genres = await getPlexGenres(server);
                    genres.forEach(genre => allGenres.add(genre));
                } catch (error) {
                    logger.warn('[Admin API] Failed to get genres from server', {
                        serverName: server.name,
                        serverType: 'plex',
                        error: error.message,
                    });
                }
            }

            const sortedGenres = Array.from(allGenres).sort();
            if (isDebug) logger.debug(`[Admin API] Found ${sortedGenres.length} unique genres.`);

            res.json({ genres: sortedGenres });
        })
    );

    /**
     * @openapi
     * /api/admin/plex-genres-with-counts:
     *   get:
     *     summary: Returns all Plex genres with counts
     *     tags:
     *       - Admin
     *     security:
     *       - BearerAuth: []
     *       - SessionAuth: []
     *     responses:
     *       200:
     *         description: Successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       genre:
     *                         type: string
     *                       count:
     *                         type: number
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/plex-genres-with-counts',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug(
                    '[Admin API] Request received for /api/admin/plex-genres-with-counts.'
                );

            const currentConfig = await readConfig();
            const { getAllEnabledServers } = require('../lib/config-helpers');
            const enabledServers = getAllEnabledServers(currentConfig, 'plex');
            const fullScan = req.query.full === 'true';

            if (enabledServers.length === 0) {
                return res.json({ genres: [], partial: false });
            }

            const allGenreCounts = new Map();
            let isPartial = false;

            for (const server of enabledServers) {
                try {
                    const result = await getPlexGenresWithCounts(server, fullScan);
                    if (result.partial) isPartial = true;
                    // Accumulate counts across servers
                    result.genres.forEach(({ genre, count }) => {
                        allGenreCounts.set(genre, (allGenreCounts.get(genre) || 0) + count);
                    });
                } catch (error) {
                    logger.warn('[Admin API] Failed to get genres with counts', {
                        serverName: server.name,
                        serverType: 'plex',
                        error: error.message,
                    });
                }
            }

            // Convert to array and sort
            const sortedGenresWithCounts = Array.from(allGenreCounts.entries())
                .map(([genre, count]) => ({ genre, count }))
                .sort((a, b) => a.genre.localeCompare(b.genre));

            if (isDebug)
                logger.debug(
                    `[Admin API] Found ${sortedGenresWithCounts.length} unique genres with counts (${isPartial ? 'SAMPLE' : 'FULL'}).`
                );

            res.json({ genres: sortedGenresWithCounts, partial: isPartial });
        })
    );

    /**
     * @swagger
     * /api/admin/plex-genres-test:
     *   post:
     *     summary: Get Plex genres for testing (with connection parameters)
     *     description: Retrieves all available genres from a Plex server using provided connection parameters.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               hostname:
     *                 type: string
     *                 description: Plex server hostname or IP
     *               port:
     *                 type: string
     *                 description: Plex server port
     *               token:
     *                 type: string
     *                 description: Plex authentication token (optional if configured)
     *     responses:
     *       200:
     *         description: List of genres successfully retrieved
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: string
     *       400:
     *         description: Bad request - missing or invalid parameters
     *       500:
     *         description: Server error
     */
    router.post(
        '/api/admin/plex-genres-test',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug('[Admin API] Request received for /api/admin/plex-genres-test.');

            // Get server configuration with fallbacks
            const currentConfig = await readConfig();
            const {
                hostname,
                port,
                token,
                serverConfig: plexServerConfig,
            } = require('../lib/config-helpers').getServerConfig({
                config: currentConfig,
                serverType: 'plex',
                requestBody: req.body,
            });

            if (!hostname || !port || !token) {
                throw new ApiError(
                    400,
                    'Plex connection details (hostname, port, token) are missing.'
                );
            }

            try {
                const testServerConfig = {
                    hostname,
                    port,
                    tokenEnvVar: plexServerConfig?.tokenEnvVar,
                };

                const genres = await getPlexGenres(testServerConfig);

                if (isDebug) logger.debug(`[Admin API] Found ${genres.length} genres.`);

                res.json({ genres });
            } catch (error) {
                logger.error('[Admin API] Failed to get Plex genres:', error?.message);
                throw new ApiError(400, error?.message || 'Could not fetch genres. Check logs.');
            }
        })
    );

    /**
     * @swagger
     * /api/admin/plex-genres-with-counts-test:
     *   post:
     *     summary: Get Plex genres with counts for testing
     *     description: Retrieves all available genres with their counts from a Plex server using provided connection parameters.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               hostname:
     *                 type: string
     *                 description: Plex server hostname or IP
     *               port:
     *                 type: string
     *                 description: Plex server port
     *               token:
     *                 type: string
     *                 description: Plex authentication token (optional if configured)
     *     responses:
     *       200:
     *         description: List of genres with counts successfully retrieved
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       genre:
     *                         type: string
     *                       count:
     *                         type: number
     *       400:
     *         description: Bad request - missing or invalid parameters
     *       500:
     *         description: Server error
     */
    router.post(
        '/api/admin/plex-genres-with-counts-test',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug(
                    '[Admin API] Request received for /api/admin/plex-genres-with-counts-test.'
                );

            // Get server configuration with fallbacks
            const currentConfig = await readConfig();
            const {
                hostname,
                port,
                token,
                serverConfig: plexServerConfig,
            } = require('../lib/config-helpers').getServerConfig({
                config: currentConfig,
                serverType: 'plex',
                requestBody: req.body,
            });

            if (!hostname || !port || !token) {
                throw new ApiError(
                    400,
                    'Plex connection details (hostname, port, token) are missing.'
                );
            }

            try {
                const testServerConfig = {
                    hostname,
                    port,
                    tokenEnvVar: plexServerConfig?.tokenEnvVar,
                };

                const genresWithCounts = await getPlexGenresWithCounts(testServerConfig);

                if (isDebug)
                    logger.debug(
                        `[Admin API] Found ${genresWithCounts.length} genres with counts.`
                    );

                res.json({ genres: genresWithCounts });
            } catch (error) {
                logger.error('[Admin API] Failed to get Plex genres with counts:', error?.message);
                throw new ApiError(
                    400,
                    error?.message || 'Could not fetch genres with counts. Check logs.'
                );
            }
        })
    );

    /**
     * @swagger
     * /api/admin/jellyfin-genres:
     *   post:
     *     summary: Get genres from Jellyfin libraries
     *     description: |
     *       Retrieves all unique genres from the specified Jellyfin libraries.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               hostname:
     *                 type: string
     *                 description: Jellyfin server hostname or IP
     *               port:
     *                 type: number
     *                 description: Jellyfin server port
     *               apiKey:
     *                 type: string
     *                 description: Jellyfin API key
     *               insecureHttps:
     *                 type: boolean
     *                 description: Allow insecure HTTPS connections
     *               libraries:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of library IDs to fetch genres from
     *     responses:
     *       200:
     *         description: List of unique genres
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: string
     *       400:
     *         description: Bad request - missing or invalid parameters
     *       500:
     *         description: Server error
     */
    router.post(
        '/api/admin/jellyfin-genres',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug('[Admin API] Request received for /api/admin/jellyfin-genres.');

            const { libraries: selectedLibraries } = req.body;

            // Get server configuration with fallbacks
            const currentConfig = await readConfig();
            const {
                hostname,
                port,
                token: apiKey,
            } = require('../lib/config-helpers').getServerConfig({
                config: currentConfig,
                serverType: 'jellyfin',
                requestBody: { ...req.body, token: req.body.apiKey },
            });

            if (!hostname || !port || !apiKey) {
                throw new ApiError(
                    400,
                    'Jellyfin connection details (hostname, port, API key) are missing.'
                );
            }

            try {
                const client = await createJellyfinClient({
                    hostname,
                    port,
                    apiKey,
                    timeout: config.getTimeout('externalApiTestConnection'),
                    insecureHttps:
                        typeof req.body.insecureHttps !== 'undefined'
                            ? !!req.body.insecureHttps
                            : process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                    retryMaxRetries: 0,
                    retryBaseDelay: 300,
                });

                // Get all libraries to verify selected ones
                const allLibraries = await fetchJellyfinLibraries(client);
                const libraryIds = selectedLibraries?.length
                    ? allLibraries
                          .filter(lib => selectedLibraries.includes(lib.Id))
                          .map(lib => lib.Id)
                    : allLibraries.map(lib => lib.Id);

                if (libraryIds.length === 0) {
                    return res.json({ genres: [] });
                }

                // Fetch genres for the selected libraries
                const genres = await client.getGenres(libraryIds);

                // De-duplicate and sort
                const uniqueGenres = Array.from(
                    new Set(genres.map(g => (g.genre || g.name || g).toString()))
                ).sort((a, b) => a.localeCompare(b));

                if (isDebug)
                    logger.debug(`[Admin API] Found ${uniqueGenres.length} unique genres.`);

                res.json({ genres: uniqueGenres });
            } catch (error) {
                logger.error('[Admin API] Failed to get Jellyfin genres:', error?.message);
                throw new ApiError(400, error?.message || 'Could not fetch genres. Check logs.');
            }
        })
    );

    /**
     * @swagger
     * /api/admin/jellyfin-genres-with-counts:
     *   post:
     *     summary: Get genres with counts from Jellyfin libraries
     *     description: |
     *       Retrieves all unique genres with their counts from the specified Jellyfin libraries.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               hostname:
     *                 type: string
     *                 description: Jellyfin server hostname or IP
     *               port:
     *                 type: number
     *                 description: Jellyfin server port
     *               apiKey:
     *                 type: string
     *                 description: Jellyfin API key
     *               insecureHttps:
     *                 type: boolean
     *                 description: Allow insecure HTTPS connections
     *               libraries:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of library IDs to fetch genres from
     *     responses:
     *       200:
     *         description: List of unique genres with their counts
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       genre:
     *                         type: string
     *                       count:
     *                         type: number
     *       400:
     *         description: Bad request - missing or invalid parameters
     *       500:
     *         description: Server error
     */
    router.post(
        '/api/admin/jellyfin-genres-with-counts',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug(
                    '[Admin API] Request received for /api/admin/jellyfin-genres-with-counts.'
                );

            let { libraries: selectedLibraries } = req.body;

            // Get server configuration with fallbacks
            const currentConfig = await readConfig();
            const {
                hostname,
                port,
                token: apiKey,
                serverConfig: jellyfinServerConfig,
            } = require('../lib/config-helpers').getServerConfig({
                config: currentConfig,
                serverType: 'jellyfin',
                requestBody: { ...req.body, token: req.body.apiKey },
            });

            // Fallback to config libraries if none provided or empty
            if (!selectedLibraries || selectedLibraries.length === 0) {
                selectedLibraries = [
                    ...(jellyfinServerConfig?.movieLibraryNames || []),
                    ...(jellyfinServerConfig?.showLibraryNames || []),
                ];
            }

            if (!hostname || !port || !apiKey) {
                throw new ApiError(
                    400,
                    'Jellyfin connection details (hostname, port, API key) are missing.'
                );
            }

            try {
                const client = await createJellyfinClient({
                    hostname,
                    port,
                    apiKey,
                    timeout: config.getTimeout('externalApiTestConnection'),
                    insecureHttps:
                        typeof req.body.insecureHttps !== 'undefined'
                            ? !!req.body.insecureHttps
                            : process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                    retryMaxRetries: 0,
                    retryBaseDelay: 300,
                });

                // Get all libraries to verify selected ones
                const allLibraries = await fetchJellyfinLibraries(client);

                // Virtual folders use ItemId, not Id
                const libraryIds = selectedLibraries?.length
                    ? allLibraries
                          .filter(lib => selectedLibraries.includes(lib.Name))
                          .map(lib => lib.ItemId)
                    : allLibraries.map(lib => lib.ItemId);

                if (libraryIds.length === 0) {
                    logger.warn('[Admin API] No library IDs found, returning empty genres');
                    return res.json({ genres: [] });
                }

                // Fetch genres with counts for the selected libraries
                const genresResult = await client.getGenresWithCounts(libraryIds);
                const genresWithCounts = genresResult?.genres || [];

                if (isDebug)
                    logger.debug(
                        `[Admin API] Found ${genresWithCounts.length} genres with counts.`
                    );

                res.json({ genres: genresWithCounts, partial: genresResult?.partial });
            } catch (error) {
                logger.error(
                    '[Admin API] Failed to get Jellyfin genres with counts:',
                    error?.message
                );
                throw new ApiError(
                    400,
                    error?.message || 'Could not fetch genres with counts. Check logs.'
                );
            }
        })
    );

    /**
     * @swagger
     * /api/admin/jellyfin-genres-all:
     *   get:
     *     summary: Get all genres from enabled Jellyfin servers
     *     description: |
     *       Retrieves all unique genres from all enabled Jellyfin servers. This serves as a lightweight
     *       fallback when per-library counts aren't critical. Returns just the unique genre strings.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: List of all unique genres
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 genres:
     *                   type: array
     *                   items:
     *                     type: string
     *       500:
     *         description: Server error
     */
    router.get(
        '/api/admin/jellyfin-genres-all',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            try {
                const currentConfig = await readConfig();
                const jellyfinServerConfig = currentConfig.mediaServers.find(
                    s => s.type === 'jellyfin' && s.enabled
                );

                if (!jellyfinServerConfig) {
                    return res.json({ genres: [] });
                }

                const client = await createJellyfinClient({
                    hostname: (jellyfinServerConfig?.hostname || '')
                        .trim()
                        .replace(/^https?:\/\//, ''),
                    port: jellyfinServerConfig?.port,
                    apiKey: process.env[jellyfinServerConfig?.tokenEnvVar] || '',
                    timeout: config.getTimeout('externalApiTestConnection'),
                    insecureHttps: process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                    retryMaxRetries: 0,
                    retryBaseDelay: 300,
                });
                const libs = await fetchJellyfinLibraries(client);
                const ids = libs.map(l => l.Id);
                const genres = await client.getGenres(ids);
                // De-duplicate and sort
                const unique = Array.from(
                    new Set(genres.map(g => (g.genre || g.name || g).toString()))
                ).sort((a, b) => a.localeCompare(b));
                return res.json({ genres: unique });
            } catch (e) {
                logger.warn('[Admin API] jellyfin-genres-all failed:', e?.message);
                return res.json({ genres: [] });
            }
        })
    );

    return router;
};
