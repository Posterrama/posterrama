/**
 * Admin Cache Metrics Routes
 *
 * Provides endpoints for monitoring cache performance and health.
 * Supports detailed metrics, hit ratios, and optimization recommendations.
 */

const express = require('express');

/**
 * Create admin cache metrics router
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.asyncHandler - Async error handler middleware
 * @param {Function} deps.adminAuth - Admin authentication middleware
 * @returns {express.Router} Configured router
 */
module.exports = function createAdminCacheRouter({ logger: _logger, asyncHandler, adminAuth }) {
    const router = express.Router();

    // Cache instances (set via initCacheReferences)
    let cacheManager = null;
    let apiCache = null;

    const getImageCacheStats = async () => {
        const fs = require('fs').promises;
        const path = require('path');
        const imageCacheDir = path.join(process.cwd(), 'image_cache');

        const stats = {
            files: 0,
            totalSizeMB: 0,
            totalSizeBytes: 0,
        };

        try {
            const files = await fs.readdir(imageCacheDir);
            stats.files = files.length;

            let totalBytes = 0;
            for (const file of files) {
                const st = await fs.stat(path.join(imageCacheDir, file)).catch(() => null);
                if (st && st.isFile()) totalBytes += st.size;
            }

            stats.totalSizeBytes = totalBytes;
            stats.totalSizeMB = Math.round((totalBytes / 1024 / 1024) * 100) / 100;
        } catch (_) {
            // Image cache directory might not exist
        }

        return stats;
    };

    /**
     * Initialize cache references
     * Called from server.js after cache instances are created
     */
    // @ts-ignore - Custom property on Express router
    router.initCacheReferences = function (cacheManagerInstance, apiCacheInstance) {
        cacheManager = cacheManagerInstance;
        apiCache = apiCacheInstance;
    };

    /**
     * @swagger
     * /api/admin/cache/metrics:
     *   get:
     *     summary: Get detailed cache metrics
     *     description: Returns comprehensive cache statistics including hit ratios, memory usage, and performance recommendations
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache metrics retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 metrics:
     *                   type: object
     *                   properties:
     *                     memory:
     *                       type: object
     *                       description: Memory cache metrics
     *                     api:
     *                       type: object
     *                       description: API cache metrics
     *                     combined:
     *                       type: object
     *                       description: Combined cache statistics
     *       401:
     *         description: Unauthorized - authentication required
     *       500:
     *         description: Server error retrieving cache metrics
     */
    router.get(
        '/api/admin/cache/metrics',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            // Get detailed stats from all cache instances
            const memoryStats = cacheManager.getDetailedStats();
            const apiStats = apiCache ? apiCache.getDetailedStats() : null;

            const imageCacheStats = await getImageCacheStats();

            // Calculate combined metrics
            const combinedMetrics = {
                totalHits: memoryStats.hits + (apiStats?.hits || 0),
                totalMisses: memoryStats.misses + (apiStats?.misses || 0),
                totalRequests: memoryStats.totalRequests + (apiStats?.totalRequests || 0),
                combinedHitRatio:
                    memoryStats.totalRequests + (apiStats?.totalRequests || 0) > 0
                        ? Math.round(
                              ((memoryStats.hits + (apiStats?.hits || 0)) /
                                  (memoryStats.totalRequests + (apiStats?.totalRequests || 0))) *
                                  10000
                          ) / 100
                        : 0,
                totalSize: memoryStats.size + (apiStats?.size || 0),
                totalMemoryMB:
                    memoryStats.memoryUsage.totalMB + (apiStats?.memoryUsage?.totalMB || 0),
            };

            res.json({
                success: true,
                metrics: {
                    memory: memoryStats,
                    api: apiStats,
                    imageCache: imageCacheStats,
                    combined: combinedMetrics,
                },
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/metrics/summary:
     *   get:
     *     summary: Get cache metrics summary
     *     description: Returns a simplified view of cache performance
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache summary retrieved successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/cache/metrics/summary',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            const memStats = cacheManager.getStats();
            const apiStats = apiCache ? apiCache.getStats() : null;

            const imageCacheStats = await getImageCacheStats();
            const imageCacheFiles = imageCacheStats.files;
            const imageCacheSizeMB = imageCacheStats.totalSizeMB;

            const memHitRatio = Math.round(memStats.hitRate * 10000) / 100;
            const apiHitRatio = apiStats ? Math.round(apiStats.hitRate * 10000) / 100 : 0;
            const totalRequests = memStats.totalRequests + (apiStats?.totalRequests || 0);
            const totalHits = memStats.hits + (apiStats?.hits || 0);
            const combinedHitRatio =
                totalRequests > 0 ? Math.round((totalHits / totalRequests) * 10000) / 100 : 0;

            res.json({
                success: true,
                totalRequests,
                combinedHitRatio,
                memoryHitRatio: memHitRatio,
                apiHitRatio,
                totalMemoryMB: memStats.memoryUsage.totalMB + (apiStats?.memoryUsage?.totalMB || 0),
                imageCacheFiles,
                imageCacheSizeMB,
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/recommendations:
     *   get:
     *     summary: Get cache optimization recommendations
     *     description: Returns actionable recommendations for cache optimization
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Recommendations retrieved successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/cache/recommendations',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            const memoryRecommendations = cacheManager.getCacheRecommendations();
            const apiRecommendations = apiCache ? apiCache.getCacheRecommendations() : [];

            // Combine and deduplicate recommendations
            const allRecommendations = [
                ...memoryRecommendations.map(r => ({ ...r, source: 'memory' })),
                ...apiRecommendations.map(r => ({ ...r, source: 'api' })),
            ];

            // Sort by severity: high > medium > info
            const severityOrder = { high: 0, medium: 1, info: 2 };
            allRecommendations.sort((a, b) => {
                return severityOrder[a.severity] - severityOrder[b.severity];
            });

            res.json({
                success: true,
                recommendations: allRecommendations,
                count: {
                    high: allRecommendations.filter(r => r.severity === 'high').length,
                    medium: allRecommendations.filter(r => r.severity === 'medium').length,
                    info: allRecommendations.filter(r => r.severity === 'info').length,
                    total: allRecommendations.length,
                },
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/analyze:
     *   get:
     *     summary: Analyze cached images for duplicates and quality distribution
     *     description: Performs deep analysis of cached images to find potential duplicates and quality variants
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache analysis completed successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/cache/analyze',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            const fsp = require('fs').promises;
            const path = require('path');
            const imageCacheDir = path.join(process.cwd(), 'image_cache');

            try {
                const files = await fsp.readdir(imageCacheDir);
                const imageFiles = files.filter(f =>
                    ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(
                        path.extname(f).toLowerCase()
                    )
                );

                // Get detailed stats for all files
                const fileStats = [];
                for (const filename of imageFiles) {
                    try {
                        const stats = await fsp.stat(path.join(imageCacheDir, filename));
                        if (!stats.isFile()) continue;
                        fileStats.push({
                            filename,
                            size: stats.size,
                            mtime: stats.mtime.getTime(),
                        });
                    } catch {
                        // Skip unreadable files
                    }
                }

                // Group files by similar size (potential duplicates with same dimensions)
                // Files within 5% of each other might be the same poster at same quality
                const sizeGroups = {};
                for (const file of fileStats) {
                    // Round to nearest 10KB for grouping
                    const sizeKey = Math.round(file.size / 10240) * 10240;
                    if (!sizeGroups[sizeKey]) {
                        sizeGroups[sizeKey] = [];
                    }
                    sizeGroups[sizeKey].push(file);
                }

                // Find exact size duplicates (same file cached multiple times - unlikely but possible)
                const exactDuplicates = [];
                const sizeCounts = {};
                for (const file of fileStats) {
                    if (!sizeCounts[file.size]) {
                        sizeCounts[file.size] = [];
                    }
                    sizeCounts[file.size].push(file.filename);
                }
                for (const [size, filenames] of Object.entries(sizeCounts)) {
                    if (filenames.length > 1) {
                        exactDuplicates.push({
                            size: parseInt(size, 10),
                            sizeKB: Math.round(parseInt(size, 10) / 1024),
                            count: filenames.length,
                            files: filenames.slice(0, 5), // Show first 5
                        });
                    }
                }

                // Categorize by quality tier (based on file size)
                const qualityTiers = {
                    thumbnail: { min: 0, max: 50 * 1024, count: 0, totalBytes: 0 },
                    preview: { min: 50 * 1024, max: 100 * 1024, count: 0, totalBytes: 0 },
                    medium: { min: 100 * 1024, max: 200 * 1024, count: 0, totalBytes: 0 },
                    high: { min: 200 * 1024, max: 500 * 1024, count: 0, totalBytes: 0 },
                    original: { min: 500 * 1024, max: Infinity, count: 0, totalBytes: 0 },
                };

                for (const file of fileStats) {
                    for (const [tier, range] of Object.entries(qualityTiers)) {
                        if (file.size >= range.min && file.size < range.max) {
                            qualityTiers[tier].count++;
                            qualityTiers[tier].totalBytes += file.size;
                            break;
                        }
                    }
                }

                // Calculate tier percentages
                const totalFiles = fileStats.length;
                const tierStats = {};
                for (const [tier, data] of Object.entries(qualityTiers)) {
                    tierStats[tier] = {
                        count: data.count,
                        percentage:
                            totalFiles > 0 ? Math.round((data.count / totalFiles) * 100) : 0,
                        totalMB: Math.round((data.totalBytes / 1024 / 1024) * 100) / 100,
                    };
                }

                // Estimate unique posters based on quality tier distribution
                // Assumption: each unique poster might have 1-3 quality variants
                // If we have roughly equal high-res and thumbnails, divide by 2
                const highResCount = tierStats.high.count + tierStats.original.count;
                const thumbnailCount = tierStats.thumbnail.count + tierStats.preview.count;

                let estimatedUniquePosters;
                if (highResCount > 0 && thumbnailCount > 0) {
                    // Both types exist - estimate based on the larger category
                    estimatedUniquePosters = Math.max(highResCount, thumbnailCount);
                } else {
                    // Only one type - that's probably the unique count
                    estimatedUniquePosters = totalFiles;
                }

                const totalSize = fileStats.reduce((acc, f) => acc + f.size, 0);
                const avgSize = totalFiles > 0 ? totalSize / totalFiles : 0;

                // Find oldest and newest files
                const sortedByTime = [...fileStats].sort((a, b) => a.mtime - b.mtime);
                const oldest = sortedByTime[0];
                const newest = sortedByTime[sortedByTime.length - 1];

                res.json({
                    success: true,
                    analysis: {
                        totalFiles,
                        totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
                        avgSizeKB: Math.round(avgSize / 1024),
                        estimatedUniquePosters,
                        qualityTiers: tierStats,
                        exactSizeDuplicates: {
                            count: exactDuplicates.length,
                            samples: exactDuplicates.slice(0, 10), // Show first 10
                        },
                        timeRange: {
                            oldest: oldest ? new Date(oldest.mtime).toISOString() : null,
                            newest: newest ? new Date(newest.mtime).toISOString() : null,
                        },
                        explanation: {
                            whyMultipleVersions:
                                'Posterrama caches the same poster at different resolutions for performance. High-res versions are used for large displays (Wallart), while thumbnails are used for quick previews (Screensaver transitions).',
                            qualityKeyFormula:
                                'Cache key includes quality/width parameters: `-q${quality}-w${width}` for thumbnails, `-hires` for full resolution.',
                            estimationMethod:
                                'Unique poster count is estimated by taking the larger of high-res or thumbnail counts, assuming each poster has multiple cached variants.',
                        },
                    },
                    timestamp: new Date().toISOString(),
                });
            } catch (err) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to analyze image cache',
                    details: err.message,
                });
            }
        })
    );

    /**
     * @swagger
     * /api/admin/cache/browser:
     *   get:
     *     summary: Browse cached poster images
     *     description: Returns paginated list of cached poster images with thumbnails for visual inspection
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           default: 1
     *         description: Page number
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 100
     *         description: Items per page (max 500)
     *       - in: query
     *         name: sort
     *         schema:
     *           type: string
     *           enum: [newest, oldest, largest, smallest]
     *           default: newest
     *         description: Sort order
     *     responses:
     *       200:
     *         description: Cached images retrieved successfully
     *       401:
     *         description: Unauthorized
     */
    router.get(
        '/api/admin/cache/browser',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            const fsp = require('fs').promises;
            const path = require('path');
            const imageCacheDir = path.join(process.cwd(), 'image_cache');

            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
            const sort = req.query.sort || 'newest';

            try {
                const files = await fsp.readdir(imageCacheDir);
                const imageFiles = files.filter(f =>
                    ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(
                        path.extname(f).toLowerCase()
                    )
                );

                // Get file stats for sorting and analysis
                const fileStats = [];
                for (const filename of imageFiles) {
                    try {
                        const stats = await fsp.stat(path.join(imageCacheDir, filename));
                        if (!stats.isFile()) continue;
                        fileStats.push({
                            filename,
                            size: stats.size,
                            sizeKB: Math.round(stats.size / 1024),
                            mtime: stats.mtime.getTime(),
                            mtimeISO: stats.mtime.toISOString(),
                        });
                    } catch {
                        // ignore
                    }
                }

                // Sort files
                switch (sort) {
                    case 'oldest':
                        fileStats.sort((a, b) => a.mtime - b.mtime);
                        break;
                    case 'largest':
                        fileStats.sort((a, b) => b.size - a.size);
                        break;
                    case 'smallest':
                        fileStats.sort((a, b) => a.size - b.size);
                        break;
                    case 'newest':
                    default:
                        fileStats.sort((a, b) => b.mtime - a.mtime);
                        break;
                }

                // Calculate analytics
                const totalSize = fileStats.reduce((acc, f) => acc + f.size, 0);
                const avgSize = fileStats.length > 0 ? totalSize / fileStats.length : 0;

                // Categorize by size (estimate quality variants)
                const sizeCategories = {
                    thumbnail: fileStats.filter(f => f.size < 50 * 1024).length, // < 50KB
                    medium: fileStats.filter(f => f.size >= 50 * 1024 && f.size < 200 * 1024)
                        .length, // 50-200KB
                    highRes: fileStats.filter(f => f.size >= 200 * 1024).length, // > 200KB
                };

                // Pagination
                const totalFiles = fileStats.length;
                const totalPages = Math.ceil(totalFiles / limit);
                const offset = (page - 1) * limit;
                const paginatedFiles = fileStats.slice(offset, offset + limit);

                // Add URL for each file - use the admin image endpoint
                const filesWithUrls = paginatedFiles.map(f => ({
                    ...f,
                    url: `/api/admin/cache/image/${f.filename}`,
                    thumbnailUrl: `/api/admin/cache/image/${f.filename}`,
                }));

                res.json({
                    success: true,
                    pagination: {
                        page,
                        limit,
                        totalFiles,
                        totalPages,
                        hasNext: page < totalPages,
                        hasPrev: page > 1,
                    },
                    analytics: {
                        totalFiles,
                        totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
                        avgSizeKB: Math.round(avgSize / 1024),
                        sizeCategories,
                        estimatedUniquePosters: Math.round(totalFiles / 2), // Rough estimate (hires + thumbnail per poster)
                    },
                    files: filesWithUrls,
                    sort,
                    timestamp: new Date().toISOString(),
                });
            } catch (err) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to read image cache directory',
                    details: err.message,
                });
            }
        })
    );

    /**
     * @swagger
     * /api/admin/cache/image/{filename}:
     *   get:
     *     summary: Serve a cached image
     *     description: Directly serves an image file from the image cache directory
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     parameters:
     *       - in: path
     *         name: filename
     *         required: true
     *         schema:
     *           type: string
     *         description: The filename of the cached image
     *     responses:
     *       200:
     *         description: Image served successfully
     *         content:
     *           image/*: {}
     *       401:
     *         description: Unauthorized
     *       404:
     *         description: Image not found
     */
    router.get(
        '/api/admin/cache/image/:filename',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            const fs = require('fs');
            const path = require('path');
            const imageCacheDir = path.join(process.cwd(), 'image_cache');
            const { filename } = req.params;

            // Security: Prevent directory traversal
            const sanitizedFilename = path.basename(filename);
            const filePath = path.join(imageCacheDir, sanitizedFilename);

            // Validate the file is within the image_cache directory
            if (!filePath.startsWith(imageCacheDir)) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Check if file exists
            try {
                await fs.promises.access(filePath);
            } catch {
                return res.status(404).json({ error: 'Image not found' });
            }

            // Set cache headers and serve the file
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
            res.sendFile(filePath);
        })
    );

    /**
     * @swagger
     * /api/admin/cache/reset:
     *   post:
     *     summary: Reset cache statistics
     *     description: Resets hit/miss counters and access counts (does not clear cached data)
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache statistics reset successfully
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/api/admin/cache/reset',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            cacheManager.resetStats();
            if (apiCache) {
                apiCache.resetStats();
            }

            res.json({
                success: true,
                message: 'Cache statistics reset successfully',
                timestamp: new Date().toISOString(),
            });
        })
    );

    /**
     * @swagger
     * /api/admin/cache/clear:
     *   post:
     *     summary: Clear all cached data
     *     description: Removes all entries from memory and API caches
     *     tags:
     *       - Admin
     *       - Cache
     *     security:
     *       - basicAuth: []
     *     responses:
     *       200:
     *         description: Cache cleared successfully
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/api/admin/cache/clear',
        // @ts-ignore - Express router overload issue with asyncHandler
        adminAuth,
        asyncHandler(async (req, res) => {
            if (!cacheManager) {
                return res.status(503).json({
                    success: false,
                    error: 'Cache manager not initialized',
                });
            }

            const memoryCleared = cacheManager.cache.size;
            const apiCleared = apiCache ? apiCache.cache.size : 0;

            cacheManager.cache.clear();
            if (apiCache) {
                apiCache.cache.clear();
            }

            res.json({
                success: true,
                message: 'Cache cleared successfully',
                cleared: {
                    memory: memoryCleared,
                    api: apiCleared,
                    total: memoryCleared + apiCleared,
                },
                timestamp: new Date().toISOString(),
            });
        })
    );

    return router;
};
