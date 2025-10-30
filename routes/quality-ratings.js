/**
 * Quality and Ratings Routes
 * Endpoints for Plex/Jellyfin video quality filters with content counts
 */

const express = require('express');

/**
 * Create quality/ratings router
 * @param {Object} deps - Dependencies
 * @returns {express.Router} Configured router
 */
module.exports = function createQualityRatingsRouter({
    logger,
    isDebug,
    readConfig,
    asyncHandler,
    isAuthenticated,
    getPlexQualitiesWithCounts,
    getJellyfinQualitiesWithCounts,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /api/admin/plex-qualities-with-counts:
     *   get:
     *     summary: Get Plex qualities with content counts
     *     description: Retrieves available video qualities from Plex servers with item counts
     *     tags: ['Admin']
     */
    router.get(
        '/api/admin/plex-qualities-with-counts',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug(
                    '[Admin API] Request received for /api/admin/plex-qualities-with-counts.'
                );

            const currentConfig = await readConfig();
            const enabledServers = currentConfig.mediaServers.filter(
                s => s.enabled && s.type === 'plex'
            );

            if (enabledServers.length === 0) {
                return res.json({ qualities: [] });
            }

            const allQualityCounts = new Map();

            for (const server of enabledServers) {
                try {
                    const qualitiesWithCounts = await getPlexQualitiesWithCounts(server);
                    // Accumulate counts across servers
                    qualitiesWithCounts.forEach(({ quality, count }) => {
                        allQualityCounts.set(quality, (allQualityCounts.get(quality) || 0) + count);
                    });
                } catch (error) {
                    console.warn(
                        `[Admin API] Failed to get qualities with counts from ${server.name}: ${error.message}`
                    );
                }
            }

            // Convert to array and sort by quality preference
            const qualityOrder = ['SD', '720p', '1080p', '4K'];
            const sortedQualitiesWithCounts = Array.from(allQualityCounts.entries())
                .map(([quality, count]) => ({ quality, count }))
                .sort((a, b) => {
                    const aIndex = qualityOrder.indexOf(a.quality);
                    const bIndex = qualityOrder.indexOf(b.quality);

                    if (aIndex !== -1 && bIndex !== -1) {
                        return aIndex - bIndex;
                    }
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                    return a.quality.localeCompare(b.quality);
                });

            if (isDebug)
                logger.debug(
                    `[Admin API] Found ${sortedQualitiesWithCounts.length} unique qualities with counts.`
                );

            res.json({ qualities: sortedQualitiesWithCounts });
        })
    );

    /**
     * @swagger
     * /api/admin/jellyfin-qualities-with-counts:
     *   get:
     *     summary: Get Jellyfin qualities with content counts
     *     description: Retrieves available video qualities from Jellyfin servers with item counts
     *     tags: ['Admin']
     */
    router.get(
        '/api/admin/jellyfin-qualities-with-counts',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug)
                logger.debug(
                    '[Admin API] Request received for /api/admin/jellyfin-qualities-with-counts.'
                );

            const currentConfig = await readConfig();
            const enabledServers = currentConfig.mediaServers.filter(
                s => s.enabled && s.type === 'jellyfin'
            );

            if (enabledServers.length === 0) {
                return res.json({ qualities: [] });
            }

            const allQualityCounts = new Map();

            for (const server of enabledServers) {
                try {
                    const qualitiesWithCounts = await getJellyfinQualitiesWithCounts(server);
                    // Accumulate counts across servers
                    qualitiesWithCounts.forEach(({ quality, count }) => {
                        allQualityCounts.set(quality, (allQualityCounts.get(quality) || 0) + count);
                    });
                } catch (error) {
                    console.warn(
                        `[Admin API] Failed to get qualities with counts from ${server.name}: ${error.message}`
                    );
                }
            }

            // Convert to array and sort by quality preference
            const qualityOrder = ['SD', '720p', '1080p', '4K'];
            const sortedQualitiesWithCounts = Array.from(allQualityCounts.entries())
                .map(([quality, count]) => ({ quality, count }))
                .sort((a, b) => {
                    const aIndex = qualityOrder.indexOf(a.quality);
                    const bIndex = qualityOrder.indexOf(b.quality);

                    if (aIndex !== -1 && bIndex !== -1) {
                        return aIndex - bIndex;
                    }
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                    return a.quality.localeCompare(b.quality);
                });

            if (isDebug)
                logger.debug(
                    `[Admin API] Found ${sortedQualitiesWithCounts.length} unique qualities with counts.`
                );

            res.json({ qualities: sortedQualitiesWithCounts });
        })
    );

    return router;
};
