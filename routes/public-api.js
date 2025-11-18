/**
 * Public API Routes
 * Non-authenticated endpoints for client applications
 * - Source ratings and filters
 * - Version information
 * - GitHub release checks
 * - Public configuration
 */

const express = require('express');
const path = require('path');
const fsp = require('fs').promises;

/**
 * Create public API router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.config - Application configuration
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.ratingCache - Rating cache instance
 * @param {Object} deps.githubService - GitHub service instance
 * @param {Function} deps.asyncHandler - Async error handler middleware
 * @param {Function} deps.isAuthenticated - Authentication middleware (for admin endpoints)
 * @param {Object} deps.ratingsUtil - Ratings utility module
 * @param {Function} deps.getJellyfinClient - Jellyfin client getter
 * @param {Function} deps.getJellyfinLibraries - Jellyfin libraries getter
 * @param {Function} deps.getPlexClient - Plex client getter
 * @param {Function} deps.readConfig - Config reader function
 * @param {boolean} deps.isDebug - Debug mode flag
 * @returns {express.Router} Configured router
 */
module.exports = function createPublicApiRouter({
    config,
    logger,
    ratingCache,
    githubService,
    asyncHandler,
    isAuthenticated,
    ratingsUtil,
    getJellyfinClient,
    getJellyfinLibraries,
    getPlexClient,
    readConfig,
    isDebug,
}) {
    const router = express.Router();

    // ============================================================================
    // RATING UTILITIES
    // ============================================================================

    // Wrapper functions that inject dependencies
    async function fetchAllJellyfinRatings(serverConfig) {
        return ratingsUtil.fetchAllJellyfinRatings({
            serverConfig,
            getJellyfinClient,
            getJellyfinLibraries,
            logger,
        });
    }

    async function fetchAllPlexRatings(serverConfig) {
        return ratingsUtil.fetchAllPlexRatings({
            serverConfig,
            getPlexClient,
            isDebug,
            logger,
        });
    }

    async function getAllSourceRatings(sourceType) {
        return ratingsUtil.getAllSourceRatings({
            sourceType,
            config,
            ratingCache,
            logger,
            fetchJellyfinRatings: fetchAllJellyfinRatings,
            fetchPlexRatings: fetchAllPlexRatings,
        });
    }

    async function getRatingsWithCounts(sourceType) {
        return ratingsUtil.getRatingsWithCounts({
            sourceType,
            config,
            getJellyfinClient,
            getJellyfinLibraries,
            getPlexClient,
            isDebug,
            logger,
        });
    }

    // isSourceTypeEnabled helper
    const { isSourceTypeEnabled: isSourceTypeEnabledUtil } = require('../lib/source-utils');
    const isSourceTypeEnabled = sourceType => isSourceTypeEnabledUtil(config, sourceType);

    // In-memory cache for ratings-with-counts (1 hour TTL)
    const ratingsWithCountsCache = new Map();
    const ratingsWithCountsInFlight = new Map(); // Track in-flight requests
    const RATINGS_WITH_COUNTS_TTL = 3600000; // 1 hour

    function getCachedRatingsWithCounts(sourceType) {
        const cached = ratingsWithCountsCache.get(sourceType);
        if (!cached) return null;

        const age = Date.now() - cached.timestamp;
        if (age > RATINGS_WITH_COUNTS_TTL) {
            ratingsWithCountsCache.delete(sourceType);
            return null;
        }

        return cached.data;
    }

    function setCachedRatingsWithCounts(sourceType, data) {
        ratingsWithCountsCache.set(sourceType, {
            data,
            timestamp: Date.now(),
        });
    }

    async function getRatingsWithCountsDeduped(sourceType) {
        // Check if request is already in flight
        const inFlight = ratingsWithCountsInFlight.get(sourceType);
        if (inFlight) {
            logger.debug(`[RatingsWithCounts] Deduping request for ${sourceType}`);
            return inFlight;
        }

        // Start new request
        const promise = getRatingsWithCounts(sourceType)
            .then(data => {
                setCachedRatingsWithCounts(sourceType, data);
                ratingsWithCountsInFlight.delete(sourceType);
                return data;
            })
            .catch(err => {
                ratingsWithCountsInFlight.delete(sourceType);
                throw err;
            });

        ratingsWithCountsInFlight.set(sourceType, promise);
        return promise;
    }

    // ============================================================================
    // PUBLIC RATING ENDPOINTS
    // ============================================================================

    /**
     * @swagger
     * /api/sources/{sourceType}/ratings:
     *   get:
     *     summary: Get available ratings for a source
     *     description: Returns the list of distinct ratings for the given source type. Disabled sources return an empty list.
     *     tags: ['Filters']
     *     parameters:
     *       - in: path
     *         name: sourceType
     *         required: true
     *         schema:
     *           type: string
     *         description: Source type (e.g. jellyfin, plex, tmdb)
     *     responses:
     *       200:
     *         description: Ratings list
     */
    router.get(
        '/api/sources/:sourceType/ratings',
        asyncHandler(async (req, res) => {
            const { sourceType } = req.params;

            try {
                // Check if the source type is enabled
                const isEnabled = isSourceTypeEnabled(sourceType);
                if (!isEnabled) {
                    return res.json({
                        success: true,
                        data: [],
                        cached: false,
                        count: 0,
                        message: `${sourceType} server is disabled`,
                    });
                }

                // Use the new intelligent rating fetching system
                const ratings = await getAllSourceRatings(sourceType);

                return res.json({
                    success: true,
                    data: ratings,
                    cached: ratingCache.isCacheValid(sourceType),
                    count: ratings.length,
                });
            } catch (error) {
                logger.error(`[API] Failed to get ratings for ${sourceType}:`, error.message);

                return res.status(500).json({
                    success: false,
                    error: `Failed to fetch ratings: ${error.message}`,
                    data: [],
                });
            }
        })
    );

    /**
     * @swagger
     * /api/sources/{sourceType}/ratings-with-counts:
     *   get:
     *     summary: Get available ratings with counts for a source
     *     description: Returns ratings along with occurrence counts for the given enabled source type.
     *     tags: ['Filters']
     */
    router.get(
        '/api/sources/:sourceType/ratings-with-counts',
        asyncHandler(async (req, res) => {
            const { sourceType } = req.params;

            try {
                // Check if the source type is enabled
                const isEnabled = isSourceTypeEnabled(sourceType);
                if (!isEnabled) {
                    return res.json({
                        success: true,
                        data: [],
                        count: 0,
                        cached: false,
                        message: `${sourceType} server is disabled`,
                    });
                }

                // Check cache first
                const cached = getCachedRatingsWithCounts(sourceType);

                if (cached) {
                    return res.json({
                        success: true,
                        data: cached,
                        count: cached.length,
                        cached: true,
                    });
                }

                // Use deduped fetch (prevents parallel requests)
                const ratingsWithCounts = await getRatingsWithCountsDeduped(sourceType);

                return res.json({
                    success: true,
                    data: ratingsWithCounts,
                    count: ratingsWithCounts.length,
                    cached: false,
                });
            } catch (error) {
                logger.error(
                    `[API] Failed to get ratings with counts for ${sourceType}:`,
                    error.message
                );

                return res.status(500).json({
                    success: false,
                    error: `Failed to fetch ratings with counts: ${error.message}`,
                    data: [],
                });
            }
        })
    );

    // ============================================================================
    // ADMIN RATING CACHE ENDPOINTS
    // ============================================================================

    /**
     * @swagger
     * /api/admin/rating-cache/stats:
     *   get:
     *     summary: Get rating cache statistics
     *     description: Admin-only. Returns cache hit/miss and size metrics for rating caches.
     *     tags: ['Admin']
     */
    router.get(
        '/api/admin/rating-cache/stats',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const stats = ratingCache.getStats();
            res.json({
                success: true,
                data: stats,
            });
        })
    );

    /**
     * @swagger
     * /api/admin/rating-cache/{sourceType}/refresh:
     *   post:
     *     summary: Refresh rating cache for a source
     *     description: Admin-only. Invalidates and rebuilds the rating cache for the given source type.
     *     tags: ['Admin']
     */
    router.post(
        '/api/admin/rating-cache/:sourceType/refresh',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const { sourceType } = req.params;

            try {
                // Invalidate cache and force refresh
                await ratingCache.invalidateCache(sourceType);
                const ratings = await getAllSourceRatings(sourceType);

                res.json({
                    success: true,
                    message: `Rating cache refreshed for ${sourceType}`,
                    data: ratings,
                    count: ratings.length,
                });
            } catch (error) {
                logger.error(
                    `[API] Failed to refresh rating cache for ${sourceType}:`,
                    error.message
                );
                res.status(500).json({
                    success: false,
                    error: error.message,
                });
            }
        })
    );

    // ============================================================================
    // VERSION & RELEASE INFORMATION
    // ============================================================================

    /**
     * @swagger
     * /api/version:
     *   get:
     *     summary: Get application version
     *     description: Returns the current version of the Posterrama application
     *     tags: ['Public API']
     */
    router.get(
        '/api/version',
        asyncHandler(async (req, res) => {
            const packageJson = require('../package.json');
            res.json({
                version: packageJson.version,
                name: packageJson.name,
            });
        })
    );

    /**
     * @swagger
     * /api/github/latest:
     *   get:
     *     summary: Get latest release information (public)
     *     description: Public endpoint to check for the latest GitHub release.
     *     tags: ['Public API']
     */
    router.get(
        '/api/github/latest',
        asyncHandler(async (req, res) => {
            try {
                // Read current version from package.json
                const packagePath = path.join(__dirname, '..', 'package.json');
                let currentVersion = 'Unknown';

                try {
                    const packageData = JSON.parse(await fsp.readFile(packagePath, 'utf8'));
                    currentVersion = packageData.version || 'Unknown';
                } catch (e) {
                    logger.warn('Could not read package.json for version info', {
                        error: e.message,
                    });
                }

                // Check for updates using GitHub service
                const updateInfo = await githubService.checkForUpdates(currentVersion);

                // Return simplified public data
                const publicInfo = {
                    currentVersion: updateInfo.currentVersion,
                    latestVersion: updateInfo.latestVersion,
                    hasUpdate: updateInfo.hasUpdate,
                    releaseUrl: updateInfo.releaseUrl,
                    publishedAt: updateInfo.publishedAt,
                    releaseName: updateInfo.releaseName,
                };

                res.json(publicInfo);
            } catch (error) {
                logger.error('Failed to check for latest release', { error: error.message });

                // Fallback response when GitHub is unavailable
                try {
                    const packagePath = path.join(__dirname, '..', 'package.json');
                    const packageData = JSON.parse(await fsp.readFile(packagePath, 'utf8'));
                    const currentVersion = packageData.version || 'Unknown';

                    res.json({
                        currentVersion,
                        latestVersion: currentVersion,
                        hasUpdate: false,
                        releaseUrl: null,
                        publishedAt: null,
                        releaseName: null,
                        error: 'Could not connect to GitHub',
                    });
                } catch (fallbackError) {
                    res.status(500).json({ error: 'Failed to check for latest release' });
                }
            }
        })
    );

    // ============================================================================
    // PUBLIC CONFIGURATION
    // ============================================================================

    /**
     * @swagger
     * /api/config:
     *   get:
     *     summary: Get public configuration
     *     description: Public endpoint that returns non-sensitive configuration data.
     *     tags: ['Public API']
     */
    router.get(
        '/api/config',
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Public API] Request received for /api/config.');

            try {
                const currentConfig = await readConfig();

                // Derive plex info from mediaServers array (post-migration) falling back to legacy structure
                let plexServerEntry = null;
                if (Array.isArray(currentConfig.mediaServers)) {
                    plexServerEntry = currentConfig.mediaServers.find(s => s.type === 'plex');
                }
                const plexServerAddress = plexServerEntry
                    ? `${plexServerEntry.hostname || ''}${
                          plexServerEntry.port ? ':' + plexServerEntry.port : ''
                      }`.replace(/:?$/, '') || null
                    : currentConfig.plex?.server || null;
                const plexTokenConfigured = !!(
                    (plexServerEntry && (plexServerEntry.token || plexServerEntry.tokenEnvVar)) ||
                    currentConfig.plex?.token
                );

                const publicConfig = {
                    plex: {
                        server: plexServerAddress,
                        token: plexTokenConfigured, // Boolean only, not the actual token
                    },
                    tmdb: {
                        enabled: !!(currentConfig.tmdb?.apiKey || currentConfig.tmdbSource?.apiKey),
                    },
                };

                if (isDebug) logger.debug('[Public API] Returning public config.');
                res.json(publicConfig);
            } catch (error) {
                if (isDebug)
                    logger.error('[Public API] Error reading config', {
                        error: error.message,
                        stack: error.stack,
                    });
                // Return empty config if file doesn't exist yet
                res.json({
                    plex: { server: null, token: false },
                    tmdb: { enabled: false },
                });
            }
        })
    );

    return router;
};
