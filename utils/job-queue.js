const EventEmitter = require('events');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const JSZip = require('jszip');
const axios = require('axios');
const crypto = require('crypto');
let sharp;
try {
    sharp = require('sharp');
} catch (_) {
    sharp = null;
}
const logger = require('./logger');
const { createExportLogger } = require('./export-logger');

/**
 * Background Job Queue System for Posterpack Generation
 * Handles concurrent job processing with progress tracking and status management
 */
class JobQueue extends EventEmitter {
    constructor(config) {
        super();

        this.config = config;
        this.jobs = new Map();
        this.activeJobs = new Set();
        this.maxConcurrentJobs = config.localDirectory?.posterpackGeneration?.concurrentJobs || 2;

        // Job ID counter
        this.jobCounter = 0;

        // Global in-flight HTTP download limiter (optional)
        const maxInflight = Number(
            process.env.POSTERPACK_MAX_INFLIGHT_DOWNLOADS ||
                config.localDirectory?.posterpackGeneration?.maxInflightDownloads ||
                0
        );
        this._maxInflightDownloads = Math.max(0, maxInflight);
        this._inflight = 0;
        this._waiters = [];

        logger.info('JobQueue initialized', {
            maxConcurrentJobs: this.maxConcurrentJobs,
            maxInflightDownloads: this._maxInflightDownloads || 'unlimited',
        });
    }

    /**
     * Add a posterpack generation job to the queue
     * @param {string} sourceType - 'plex' or 'jellyfin'
     * @param {Array} libraryIds - Array of library IDs
     * @param {Object} options - Generation options
     * @returns {Promise<string>} Job ID
     */
    async addPosterpackGenerationJob(sourceType, libraryIds, options = {}) {
        const jobId = this.generateJobId();

        const job = {
            id: jobId,
            type: 'posterpack-generation',
            sourceType: sourceType,
            libraryIds: libraryIds,
            options: options,
            status: 'queued',
            progress: 0,
            totalItems: 0,
            processedItems: 0,
            created: new Date(),
            started: null,
            completed: null,
            results: null,
            error: null,
            logs: [],
        };

        this.jobs.set(jobId, job);

        logger.info(`JobQueue: Added job ${jobId}`, {
            type: job.type,
            sourceType: sourceType,
            libraryIds: libraryIds,
        });

        // Attach dedicated export logger for this job
        try {
            job.exportLogger = createExportLogger(this.config, jobId);
            await job.exportLogger.info('Job added', {
                jobId,
                type: job.type,
                sourceType,
                libraryIds,
                options,
            });
        } catch (_) {
            // ignore logger init failures
        }

        // Emit job added event
        this.emit('jobAdded', job);

        // Start processing if we're under the concurrent limit
        this.processNextJob();

        return jobId;
    }

    /**
     * Generate unique job ID
     * @returns {string} Unique job ID
     */
    generateJobId() {
        this.jobCounter++;
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 6);
        return `job-${timestamp}-${random}-${this.jobCounter}`;
    }

    /**
     * Process the next queued job if slots are available
     */
    processNextJob() {
        if (this.activeJobs.size >= this.maxConcurrentJobs) {
            logger.debug('JobQueue: Maximum concurrent jobs reached, waiting...');
            return;
        }

        // Find next queued job
        const queuedJob = Array.from(this.jobs.values()).find(job => job.status === 'queued');

        if (queuedJob) {
            this.processJob(queuedJob.id);
        }
    }

    // Global in-flight download limiter
    async _withInflightLimit(fn) {
        if (!this._maxInflightDownloads || this._maxInflightDownloads <= 0) {
            return fn();
        }
        await this._acquire();
        try {
            return await fn();
        } finally {
            this._release();
        }
    }

    _acquire() {
        if (this._inflight < this._maxInflightDownloads) {
            this._inflight++;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this._waiters.push(resolve);
        });
    }

    _release() {
        if (this._inflight > 0) this._inflight--;
        const next = this._waiters.shift();
        if (next) {
            this._inflight++;
            next();
        }
    }

    /**
     * Process a specific job
     * @param {string} jobId - Job ID to process
     */
    async processJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            logger.error(`JobQueue: Job ${jobId} not found`);
            return;
        }

        if (job.status !== 'queued') {
            logger.warn(`JobQueue: Job ${jobId} is not queued (status: ${job.status})`);
            return;
        }

        // Mark job as running
        this.activeJobs.add(jobId);
        job.status = 'running';
        job.started = new Date();

        logger.info(`JobQueue: Starting job ${jobId}`);
        if (job.exportLogger) await job.exportLogger.info('Job starting', { jobId });
        this.emit('jobStarted', job);

        try {
            // Process based on job type
            switch (job.type) {
                case 'posterpack-generation':
                    await this.processPosterpackGeneration(job);
                    break;
                default:
                    throw new Error(`Unknown job type: ${job.type}`);
            }

            // Mark job as completed
            job.status = 'completed';
            job.progress = 100;
            job.completed = new Date();

            logger.info(`JobQueue: Job ${jobId} completed successfully`, {
                duration: job.completed - job.started,
                processedItems: job.processedItems,
            });
            if (job.exportLogger)
                await job.exportLogger.info('Job completed', {
                    jobId,
                    durationMs: job.completed - job.started,
                    processedItems: job.processedItems,
                    totalItems: job.totalItems,
                    results: {
                        successful: job.results?.totalGenerated,
                        failed: job.results?.totalFailed,
                        totalSize: job.results?.totalSize,
                    },
                });

            this.emit('jobCompleted', job);
        } catch (error) {
            // Mark job as failed
            job.status = 'failed';
            job.error = error.message;
            job.completed = new Date();

            logger.error(`JobQueue: Job ${jobId} failed:`, error);
            if (job.exportLogger)
                await job.exportLogger.error('Job failed', { jobId, error: error.message });
            this.emit('jobFailed', job);
        } finally {
            // Remove from active jobs
            this.activeJobs.delete(jobId);

            // Process next job in queue
            const isTestRun =
                process.env.NODE_ENV === 'test' ||
                process.env.JEST_WORKER_ID != null ||
                process.env.JEST_WORKER_ID !== undefined;
            // In Jest, avoid scheduling background timers that can outlive the test and
            // trigger "import after environment torn down" warnings.
            if (!isTestRun) {
                let nextDelayMs = 100;
                try {
                    const timeoutConfig = require('../config/');
                    if (timeoutConfig && typeof timeoutConfig.getTimeout === 'function') {
                        const configured = timeoutConfig.getTimeout('jobQueueNext');
                        if (Number.isFinite(configured)) {
                            nextDelayMs = configured;
                        }
                    }
                } catch (_) {
                    // Ignore config load failures in job-queue scheduling
                }
                setTimeout(() => this.processNextJob(), nextDelayMs);
            }
        }
    }

    /**
     * Process posterpack generation job
     * @param {Object} job - Job object
     */
    async processPosterpackGeneration(job) {
        const { sourceType, libraryIds, options } = job;

        // Get source adapter
        const sourceAdapter = this.getSourceAdapter(sourceType);
        if (!sourceAdapter) {
            throw new Error(`Source adapter not found: ${sourceType}`);
        }

        // Get all items from selected libraries
        const allItems = [];

        for (const libraryId of libraryIds) {
            try {
                job.logs.push(`Fetching items from library: ${libraryId}`);
                this.emit('jobProgress', job);

                const items = await sourceAdapter.fetchLibraryItems(libraryId);
                allItems.push(...items);

                job.logs.push(`Found ${items.length} items in library ${libraryId}`);
                logger.debug(
                    `JobQueue: Fetched ${items.length} items from library ${libraryId}, total now: ${allItems.length}`
                );
                if (job.exportLogger)
                    await job.exportLogger.info('Fetched library', {
                        libraryId,
                        count: items.length,
                    });
            } catch (error) {
                job.logs.push(`Error fetching library ${libraryId}: ${error.message}`);
                logger.error(`JobQueue: Error fetching library ${libraryId}:`, error);
                if (job.exportLogger)
                    await job.exportLogger.error('Fetch library failed', {
                        libraryId,
                        error: error.message,
                    });
            }
        }

        logger.debug(`JobQueue: Total items fetched from all libraries: ${allItems.length}`);

        // Apply optional filtering based on options (mirrors Admin filter logic)
        const parseCsv = v =>
            String(v || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        const yearTester = expr => {
            if (!expr) return null;
            const parts = String(expr)
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            const ranges = [];
            for (const p of parts) {
                const m1 = p.match(/^\d{4}$/);
                const m2 = p.match(/^(\d{4})\s*-\s*(\d{4})$/);
                if (m1) {
                    const y = Number(m1[0]);
                    if (y >= 1900) ranges.push([y, y]);
                } else if (m2) {
                    const a = Number(m2[1]);
                    const b = Number(m2[2]);
                    if (a >= 1900 && b >= a) ranges.push([a, b]);
                }
            }
            if (!ranges.length) return null;
            return y => ranges.some(([a, b]) => y >= a && y <= b);
        };
        const mapResToLabel = reso => {
            const r = (reso || '').toString().toLowerCase();
            if (!r || r === 'sd') return 'SD';
            if (r === '720' || r === 'hd' || r === '720p') return '720p';
            if (r === '1080' || r === '1080p' || r === 'fullhd') return '1080p';
            if (r === '4k' || r === '2160' || r === '2160p' || r === 'uhd') return '4K';
            return r.toUpperCase();
        };
        const yearOk = yearTester(options?.yearFilter || '');
        const mediaType = (options?.mediaType || 'all').toLowerCase();
        const filtersPlex = options?.filtersPlex || {};
        const filtersJellyfin = options?.filtersJellyfin || {};
        const allowedGenresP = parseCsv(filtersPlex.genres);
        const allowedRatingsP = parseCsv(filtersPlex.ratings).map(r => r.toUpperCase());
        const allowedQualP = parseCsv(filtersPlex.qualities);
        const allowedGenresJ = parseCsv(filtersJellyfin.genres);
        const allowedRatingsJ = parseCsv(filtersJellyfin.ratings).map(r => r.toUpperCase());

        const excludeCounters = {
            mediaType: 0,
            year: 0,
            plex_genre: 0,
            plex_rating: 0,
            plex_quality: 0,
            jellyfin_genre: 0,
            jellyfin_rating: 0,
        };

        const filtered = allItems.filter(it => {
            // Media type filter (movie/show)
            if (mediaType !== 'all') {
                const t = (it.type || '').toLowerCase();
                // If type not provided by adapter, infer "movie" as default
                if (t && t !== mediaType) {
                    excludeCounters.mediaType++;
                    return false;
                }
            }
            // Year filter
            if (yearOk) {
                const y = Number(it.year);
                if (!Number.isFinite(y) || !yearOk(y)) {
                    excludeCounters.year++;
                    return false;
                }
            }
            // Source-specific filters
            if (sourceType === 'plex') {
                if (allowedGenresP.length) {
                    const g = Array.isArray(it.genre || it.genres)
                        ? (it.genre || it.genres).map(x => String(x).toLowerCase())
                        : [];
                    if (!allowedGenresP.some(need => g.includes(String(need).toLowerCase()))) {
                        excludeCounters.plex_genre++;
                        return false;
                    }
                }
                if (allowedRatingsP.length) {
                    const r = it.contentRating || it.rating || null;
                    const norm = r ? String(r).trim().toUpperCase() : '';
                    if (!norm || !allowedRatingsP.includes(norm)) {
                        excludeCounters.plex_rating++;
                        return false;
                    }
                }
                if (allowedQualP.length) {
                    const lbl = it.qualityLabel || mapResToLabel(it.videoResolution);
                    if (lbl && !allowedQualP.includes(lbl)) {
                        excludeCounters.plex_quality++;
                        return false;
                    }
                }
            } else if (sourceType === 'jellyfin') {
                if (allowedGenresJ.length) {
                    const g = Array.isArray(it.genre || it.genres)
                        ? (it.genre || it.genres).map(x => String(x).toLowerCase())
                        : [];
                    if (!allowedGenresJ.some(need => g.includes(String(need).toLowerCase()))) {
                        excludeCounters.jellyfin_genre++;
                        return false;
                    }
                }
                if (allowedRatingsJ.length) {
                    const r = it.officialRating || it.rating || null;
                    const norm = r ? String(r).trim().toUpperCase() : '';
                    if (!norm || !allowedRatingsJ.includes(norm)) {
                        excludeCounters.jellyfin_rating++;
                        return false;
                    }
                }
            }
            return true;
        });

        // Apply limit if provided
        const limit = Number(options?.limit);
        const itemsToProcess =
            Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;

        job.totalItems = itemsToProcess.length;
        job.logs.push(`Total items to process: ${job.totalItems}`);
        if (job.exportLogger) {
            await job.exportLogger.info('Filter summary', {
                sourceType,
                requested: allItems.length,
                kept: filtered.length,
                limit: Number.isFinite(limit) && limit > 0 ? limit : null,
                toProcess: job.totalItems,
                excludeCounters,
                options,
            });
        }

        if (job.totalItems === 0) {
            throw new Error('No items found in selected libraries');
        }

        // Batch timing and containers
        const batchStart = Date.now();
        const itemDurations = [];

        // Process each item with controlled concurrency
        const results = [];
        const errors = [];

        const cores = Math.max(1, Number(os.cpus()?.length || 2));
        const itemConcurrency = Math.max(
            1,
            Number(
                process.env.POSTERPACK_ITEM_CONCURRENCY ||
                    this.config?.localDirectory?.posterpackGeneration?.itemConcurrency ||
                    Math.min(2, cores)
            )
        );

        let processedSoFar = 0;
        const runWithLimit = async (arr, limit, worker) => {
            const queue = arr.slice();
            const runners = new Array(Math.min(limit, queue.length)).fill(0).map(async () => {
                while (queue.length) {
                    const item = queue.shift();
                    const idx = ++processedSoFar; // 1-based
                    try {
                        // Update progress
                        job.processedItems = Math.min(processedSoFar, job.totalItems);
                        job.progress = Math.round(
                            (job.processedItems / Math.max(job.totalItems, 1)) * 100
                        );
                        job.logs.push(`Processing: ${item.title} (${idx}/${job.totalItems})`);
                        this.emit('jobProgress', job);
                        if (job.exportLogger)
                            await job.exportLogger.info('Processing item', {
                                index: idx,
                                total: job.totalItems,
                                title: item.title,
                                year: item.year,
                                id: item.id,
                            });

                        await worker(item);
                    } catch (e) {
                        // Worker should handle logging; ensure we continue
                    }
                }
            });
            await Promise.all(runners);
        };

        await runWithLimit(itemsToProcess, itemConcurrency, async item => {
            const itemStart = Date.now();
            try {
                // Enrich item with extras (trailers, theme music) before generating posterpack
                let enrichedItem = item;
                if (sourceType === 'plex' || sourceType === 'jellyfin') {
                    try {
                        const { enrichPlexItemWithExtras } = require('../lib/plex-helpers');
                        const { enrichJellyfinItemWithExtras } = require('../lib/jellyfin-helpers');

                        // Find server config (don't require enabled=true, since we're already processing items from it)
                        const serverConfig = (this.config.mediaServers || []).find(
                            s => s.type === sourceType
                        );

                        if (serverConfig) {
                            logger.info(`JobQueue: Enriching ${item.title} with extras...`, {
                                sourceType,
                                itemId: item.id || item.sourceId,
                            });

                            if (sourceType === 'plex') {
                                enrichedItem = await enrichPlexItemWithExtras(
                                    item,
                                    serverConfig,
                                    null
                                );
                            } else if (sourceType === 'jellyfin') {
                                enrichedItem = await enrichJellyfinItemWithExtras(
                                    item,
                                    serverConfig,
                                    null
                                );
                            }
                            logger.info(`JobQueue: Enriched ${item.title} with extras`, {
                                hasExtras: !!enrichedItem.extras,
                                extrasCount: enrichedItem.extras?.length || 0,
                            });
                        } else {
                            logger.warn(`JobQueue: No server config found for ${sourceType}`);
                        }
                    } catch (enrichErr) {
                        logger.warn(
                            `JobQueue: Failed to enrich item ${item.title}: ${enrichErr.message}`
                        );
                        // Continue with original item
                    }
                }

                const result = await this.generatePosterpackForItem(
                    enrichedItem,
                    sourceType,
                    options,
                    job.exportLogger || null
                );
                results.push({
                    item: {
                        title: enrichedItem.title,
                        year: enrichedItem.year,
                        id: enrichedItem.id,
                    },
                    success: true,
                    outputPath: result.outputPath,
                    size: result.size,
                    assets: result.assets,
                });
                job.logs.push(`✅ Generated: ${enrichedItem.title}`);
                if (job.exportLogger)
                    await job.exportLogger.info('Generated posterpack', {
                        title: enrichedItem.title,
                        outputPath: result.outputPath,
                        size: result.size,
                        assets: Object.keys(result.assets || {}),
                        ms: Date.now() - itemStart,
                    });
                itemDurations.push(Date.now() - itemStart);
            } catch (error) {
                logger.error(`JobQueue: Failed to generate posterpack for ${item.title}:`, error);
                errors.push({
                    item: { title: item.title, year: item.year, id: item.id },
                    success: false,
                    error: error.message,
                });
                job.logs.push(`❌ Failed: ${item.title} - ${error.message}`);
                if (job.exportLogger)
                    await job.exportLogger.error('Generate failed', {
                        title: item.title,
                        id: item.id,
                        error: error.message,
                        ms: Date.now() - itemStart,
                    });
                itemDurations.push(Date.now() - itemStart);
            }
        });

        // Set final results
        job.processedItems = allItems.length;
        job.results = {
            successful: results,
            failed: errors,
            totalGenerated: results.length,
            totalFailed: errors.length,
            totalSize: results.reduce((sum, r) => sum + (r.size || 0), 0),
        };

        job.logs.push(`Generation complete: ${results.length} successful, ${errors.length} failed`);
        if (job.exportLogger) {
            const totalMs = Date.now() - batchStart;
            const sorted = itemDurations.slice().sort((a, b) => a - b);
            const avg = sorted.length
                ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
                : 0;
            const p95 = sorted.length
                ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
                : 0;
            const throughput =
                totalMs > 0 ? Number((results.length / (totalMs / 1000)).toFixed(2)) : 0;
            await job.exportLogger.info('Generation summary', {
                successful: results.length,
                failed: errors.length,
                totalMs,
                avgItemMs: avg,
                p95ItemMs: p95,
                throughputItemsPerSec: throughput,
            });
        }
    }

    /**
     * Generate posterpack for a single item
     * @param {Object} item - Media item
     * @param {string} sourceType - Source type (plex/jellyfin)
     * @param {Object} options - Generation options
     * @param {Object|null} exportLogger - Optional logger
     * @returns {Promise<Object>} Generation result
     */
    async generatePosterpackForItem(item, sourceType, options, exportLogger = null) {
        // Debug: Log item structure
        logger.info(`JobQueue: generatePosterpackForItem called`, {
            title: item.title,
            hasExtras: !!item.extras,
            extrasCount: item.extras?.length || 0,
            sourceType,
        });

        // Generate output filename
        const outputFilename = this.generatePosterpackFilename(item, options);
        const outputDir = path.join(
            this.config.localDirectory.rootPath,
            'complete',
            `${sourceType}-export`
        );

        await fs.ensureDir(outputDir);

        const outputPath = path.join(outputDir, outputFilename);

        // Create ZIP file
        const zip = new JSZip();
        const assets = {};

        // Download and add assets
        const includeAssets =
            options.includeAssets ||
            this.config.localDirectory?.posterpackGeneration?.includeAssets;

        // Add poster (required)
        if (!item.poster && exportLogger) {
            await exportLogger.warn('Item has no poster URL', { title: item.title, id: item.id });
        }
        // Prepare concurrent downloads for poster/background/clearlogo
        const assetConcurrency = Math.max(
            1,
            Number(
                process.env.POSTERPACK_ASSET_CONCURRENCY ||
                    this.config?.localDirectory?.posterpackGeneration?.assetConcurrency ||
                    4
            )
        );

        const basicDownloads = [];
        if (item.poster) {
            basicDownloads.push(
                (async () => {
                    const posterData = await this._withInflightLimit(() =>
                        this.downloadAsset(item.poster, sourceType, exportLogger)
                    );
                    if (posterData) {
                        zip.file('poster.jpg', posterData);
                        assets.poster = true;
                        // Optionally derive thumbnail from poster
                        try {
                            const cfgFlag =
                                this.config?.localDirectory?.posterpackGeneration
                                    ?.generateThumbnail;
                            const wantThumb =
                                options.generateThumbnail !== undefined
                                    ? options.generateThumbnail
                                    : cfgFlag === undefined
                                      ? true
                                      : cfgFlag;
                            if (wantThumb && posterData && sharp) {
                                // Generate cache key from poster URL
                                const thumbHash = crypto
                                    .createHash('md5')
                                    .update(item.poster)
                                    .digest('hex');
                                const thumbCachePath = path.join(
                                    process.cwd(),
                                    'image_cache',
                                    `thumb_${thumbHash}.jpg`
                                );

                                let thumb;
                                // Check if thumbnail exists in cache
                                if (await fs.pathExists(thumbCachePath)) {
                                    try {
                                        thumb = await fs.readFile(thumbCachePath);
                                        if (exportLogger) {
                                            await exportLogger.debug('Using cached thumbnail', {
                                                hash: thumbHash,
                                            });
                                        }
                                    } catch (e) {
                                        // Cache read failed, regenerate
                                        if (exportLogger) {
                                            await exportLogger.warn(
                                                'Thumbnail cache read failed, regenerating',
                                                {
                                                    error: e.message,
                                                }
                                            );
                                        }
                                    }
                                }

                                // Generate thumbnail if not cached
                                if (!thumb) {
                                    thumb = await sharp(posterData)
                                        .resize({
                                            width: 300,
                                            height: 300,
                                            fit: 'inside',
                                            withoutEnlargement: true,
                                        })
                                        .jpeg({
                                            quality: 80,
                                            progressive: true,
                                            mozjpeg: true,
                                            chromaSubsampling: '4:2:0',
                                        })
                                        .toBuffer();

                                    // Save to cache (fire and forget)
                                    if (thumb && thumb.length > 0) {
                                        fs.writeFile(thumbCachePath, thumb).catch(err => {
                                            logger.warn('Failed to cache thumbnail', {
                                                hash: thumbHash,
                                                error: err.message,
                                            });
                                        });
                                    }
                                }

                                if (thumb && thumb.length > 0) {
                                    zip.file('thumbnail.jpg', thumb);
                                    assets.thumbnail = true;
                                }
                            }
                        } catch (e) {
                            if (exportLogger) {
                                await exportLogger.warn('Thumbnail generation failed', {
                                    error: e.message,
                                });
                            }
                        }
                    } else if (exportLogger) {
                        await exportLogger.warn('Poster download failed', {
                            title: item.title,
                            url: item.poster,
                        });
                    }
                })()
            );
        }

        // Add background (required)
        if (!item.background && exportLogger) {
            await exportLogger.warn('Item has no background URL', {
                title: item.title,
                id: item.id,
            });
        }
        if (item.background) {
            basicDownloads.push(
                (async () => {
                    const backgroundData = await this._withInflightLimit(() =>
                        this.downloadAsset(item.background, sourceType, exportLogger)
                    );
                    if (backgroundData) {
                        zip.file('background.jpg', backgroundData);
                        assets.background = true;
                    } else if (exportLogger) {
                        await exportLogger.warn('Background download failed', {
                            title: item.title,
                            url: item.background,
                        });
                    }
                })()
            );
        }

        // Add optional assets
        // ClearLogo support (prefer new 'clearlogo' field)
        if (item.clearlogo || (includeAssets?.clearart && item.clearart)) {
            const logoUrl = item.clearlogo || item.clearart;
            basicDownloads.push(
                (async () => {
                    const clearlogoData = await this._withInflightLimit(() =>
                        this.downloadAsset(logoUrl, sourceType, exportLogger)
                    );
                    if (clearlogoData) {
                        zip.file('clearlogo.png', clearlogoData);
                        assets.clearlogo = true;
                    } else if (exportLogger) {
                        await exportLogger.warn('Clearlogo download failed', {
                            title: item.title,
                            url: logoUrl,
                        });
                    }
                })()
            );
        }

        // Execute base asset downloads in parallel
        if (basicDownloads.length) {
            await Promise.all(basicDownloads);
        }

        // Download banner if available (primarily for TV shows)
        if (item.bannerUrl) {
            const bannerData = await this._withInflightLimit(() =>
                this.downloadAsset(item.bannerUrl, sourceType, exportLogger)
            );
            if (bannerData) {
                zip.file('banner.jpg', bannerData);
                assets.banner = true;
            } else if (exportLogger) {
                await exportLogger.warn('Banner download failed', {
                    title: item.title,
                    url: item.bannerUrl,
                });
            }
        }

        // Download hero image if available (wide promotional image)
        if (item.heroUrl) {
            const heroData = await this._withInflightLimit(() =>
                this.downloadAsset(item.heroUrl, sourceType, exportLogger)
            );
            if (heroData) {
                zip.file('hero.jpg', heroData);
                assets.hero = true;
            } else if (exportLogger) {
                await exportLogger.warn('Hero image download failed', {
                    title: item.title,
                    url: item.heroUrl,
                });
            }
        }

        // Download composite image if available (collection/series composite)
        if (item.compositeUrl) {
            const compositeData = await this._withInflightLimit(() =>
                this.downloadAsset(item.compositeUrl, sourceType, exportLogger)
            );
            if (compositeData) {
                zip.file('composite.jpg', compositeData);
                assets.composite = true;
            } else if (exportLogger) {
                await exportLogger.warn('Composite image download failed', {
                    title: item.title,
                    url: item.compositeUrl,
                });
            }
        }

        // Download square background if available (1:1 aspect ratio background)
        if (item.backgroundSquareUrl) {
            const squareData = await this._withInflightLimit(() =>
                this.downloadAsset(item.backgroundSquareUrl, sourceType, exportLogger)
            );
            if (squareData) {
                zip.file('background-square.jpg', squareData);
                assets.backgroundSquare = true;
            } else if (exportLogger) {
                await exportLogger.warn('Square background download failed', {
                    title: item.title,
                    url: item.backgroundSquareUrl,
                });
            }
        }

        if (includeAssets?.fanart && item.fanart) {
            const fan = item.fanart.slice(0, 5);
            let idxFan = 0;
            const fanQueue = fan.slice();
            const workers = new Array(Math.min(assetConcurrency, fanQueue.length))
                .fill(0)
                .map(async () => {
                    while (fanQueue.length) {
                        const url = fanQueue.shift();
                        const iLocal = idxFan++;
                        const fanartData = await this._withInflightLimit(() =>
                            this.downloadAsset(url, sourceType, exportLogger)
                        );
                        if (fanartData) {
                            zip.file(`fanart-${iLocal + 1}.jpg`, fanartData);
                            assets.fanart = (assets.fanart || 0) + 1;
                        } else if (exportLogger) {
                            await exportLogger.warn('Fanart download failed', {
                                title: item.title,
                                url,
                                index: iLocal + 1,
                            });
                        }
                    }
                });
            await Promise.all(workers);
        }

        if (includeAssets?.discart && item.discart) {
            const discartData = await this._withInflightLimit(() =>
                this.downloadAsset(item.discart, sourceType, exportLogger)
            );
            if (discartData) {
                zip.file('disc.png', discartData);
                assets.discart = true;
            } else if (exportLogger) {
                await exportLogger.warn('Discart download failed', {
                    title: item.title,
                    url: item.discart,
                });
            }
        }

        // Download trailer video if available
        if (item.extras && Array.isArray(item.extras)) {
            logger.info(`JobQueue: Checking trailer for ${item.title}`, {
                extrasCount: item.extras.length,
                sourceType,
            });

            const trailer = item.extras.find(
                e =>
                    e.type === 'trailer' || e.type?.toLowerCase() === 'trailer' || e.type === 'clip'
            );

            if (trailer) {
                logger.info(`JobQueue: Found trailer for ${item.title}`, {
                    trailerTitle: trailer.title,
                    trailerType: trailer.type,
                    trailerKey: trailer.key,
                    sourceType,
                });
            }

            // Plex trailer download
            if (trailer && trailer.key && sourceType === 'plex') {
                logger.info(`JobQueue: Attempting trailer download for ${item.title}`);
                try {
                    logger.info(`JobQueue: Looking for Plex server config`, {
                        hasConfig: !!this.config,
                        hasMediaServers: !!this.config?.mediaServers,
                        mediaServersCount: this.config?.mediaServers?.length || 0,
                    });

                    // For Plex, we need to fetch the trailer metadata to get the actual video file URL
                    const serverConfig = (this.config.mediaServers || []).find(
                        s => s.type === 'plex'
                    );

                    // Build URL and get token from environment
                    const plexUrl =
                        serverConfig?.url ||
                        (serverConfig?.hostname
                            ? `http://${serverConfig.hostname}:${serverConfig.port || 32400}`
                            : null);
                    const plexToken =
                        serverConfig?.token ||
                        (serverConfig?.tokenEnvVar ? process.env[serverConfig.tokenEnvVar] : null);

                    logger.info(`JobQueue: Server config check`, {
                        hasServerConfig: !!serverConfig,
                        hasUrl: !!plexUrl,
                        hasToken: !!plexToken,
                    });

                    if (!serverConfig) {
                        logger.warn(`JobQueue: No Plex server config found for trailer download`);
                    } else if (!plexUrl || !plexToken) {
                        logger.warn(`JobQueue: Plex server config missing URL or token`, {
                            hasUrl: !!plexUrl,
                            hasToken: !!plexToken,
                        });
                    } else {
                        logger.info(`JobQueue: Fetching trailer details from ${trailer.key}`);

                        // Fetch trailer metadata directly from Plex using axios
                        const trailerMetadataUrl = `${plexUrl}${trailer.key}?X-Plex-Token=${plexToken}`;
                        // @ts-ignore - axios.get exists but TypeScript doesn't recognize require('axios') type
                        const trailerResp = await axios.get(trailerMetadataUrl, {
                            timeout: 30000,
                            validateStatus: status => status === 200,
                        });
                        const trailerItem = trailerResp?.data?.MediaContainer?.Metadata?.[0];

                        logger.info(`JobQueue: Trailer response received`, {
                            hasData: !!trailerResp?.data,
                            hasMetadata: !!trailerItem,
                            hasMedia: !!trailerItem?.Media,
                        });

                        if (trailerItem?.Media?.[0]?.Part?.[0]?.key) {
                            const videoKey = trailerItem.Media[0].Part[0].key;
                            // Construct full URL with token (use & if videoKey already has query params)
                            const separator = videoKey.includes('?') ? '&' : '?';
                            const videoUrl = `${plexUrl}${videoKey}${separator}X-Plex-Token=${plexToken}`;

                            logger.info(`JobQueue: Downloading trailer video`, {
                                title: item.title,
                                videoKey,
                                videoUrl: videoUrl.replace(plexToken, 'TOKEN_HIDDEN'),
                            });

                            if (exportLogger) {
                                await exportLogger.info('Downloading trailer', {
                                    title: item.title,
                                    trailerTitle: trailer.title,
                                });
                            }

                            // Download the video file directly using axios with streaming
                            // @ts-ignore - axios.get exists but TypeScript doesn't recognize require('axios') type
                            const response = await axios.get(videoUrl, {
                                responseType: 'arraybuffer',
                                timeout: 120000, // 2 minutes for large videos
                                maxContentLength: 500 * 1024 * 1024, // 500MB max
                            });

                            if (response.status === 200 && response.data) {
                                const trailerData = Buffer.from(response.data);
                                if (trailerData.length > 10240) {
                                    // Detect container from video key (e.g., .mp4, .mkv, .mov)
                                    const ext =
                                        videoKey.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || 'mp4';
                                    zip.file(`trailer.${ext}`, trailerData);
                                    assets.trailer = true;
                                    if (exportLogger) {
                                        await exportLogger.info('Trailer downloaded', {
                                            title: item.title,
                                            size: `${(trailerData.length / 1024 / 1024).toFixed(2)} MB`,
                                        });
                                    }
                                }
                            }
                        } else {
                            logger.warn(`JobQueue: Trailer metadata structure invalid`, {
                                title: item.title,
                                hasTrailerItem: !!trailerItem,
                                hasMedia: !!trailerItem?.Media,
                                mediaParts: trailerItem?.Media?.[0]?.Part?.length || 0,
                            });
                        }
                    }
                } catch (err) {
                    if (exportLogger) {
                        await exportLogger.warn('Trailer download error', {
                            title: item.title,
                            error: err.message,
                        });
                    }
                    logger.warn(
                        `JobQueue: Trailer download failed for ${item.title}:`,
                        err.message
                    );
                }
            }

            // Jellyfin trailer download
            if (trailer && trailer.key && sourceType === 'jellyfin') {
                logger.info(`JobQueue: Attempting Jellyfin trailer download for ${item.title}`);
                try {
                    // Find Jellyfin server config (don't require enabled, we're already processing its items)
                    const serverConfig = (this.config.mediaServers || []).find(
                        s => s.type === 'jellyfin'
                    );

                    if (!serverConfig) {
                        logger.warn(
                            `JobQueue: No Jellyfin server config found for trailer download`
                        );
                    } else {
                        const { hostname, port = 8096, apiKey } = serverConfig;
                        const protocol = port === 8920 || port === 443 ? 'https' : 'http';
                        const jellyfinUrl = `${protocol}://${hostname}:${port}`;

                        logger.info(`JobQueue: Downloading Jellyfin trailer`, {
                            title: item.title,
                            itemId: trailer.key,
                            jellyfinUrl,
                        });

                        if (exportLogger) {
                            await exportLogger.info('Downloading trailer', {
                                title: item.title,
                                trailerTitle: trailer.title,
                            });
                        }

                        // Jellyfin Download API: /Items/{ItemId}/Download
                        const downloadUrl = `${jellyfinUrl}/Items/${trailer.key}/Download?api_key=${apiKey}`;

                        // @ts-ignore - axios.get exists but TypeScript doesn't recognize require('axios') type
                        const response = await axios.get(downloadUrl, {
                            responseType: 'arraybuffer',
                            timeout: 120000, // 2 minutes for large videos
                            maxContentLength: 500 * 1024 * 1024, // 500MB max
                            headers: {
                                'X-Emby-Token': apiKey,
                            },
                        });

                        if (response.status === 200 && response.data) {
                            const trailerData = Buffer.from(response.data);
                            if (trailerData.length > 10240) {
                                // Detect extension from content-disposition or default to mp4
                                let ext = 'mp4';
                                const contentDisposition = response.headers['content-disposition'];
                                if (contentDisposition) {
                                    const match = contentDisposition.match(
                                        /filename="?.*\.([a-z0-9]+)"?/i
                                    );
                                    if (match) ext = match[1];
                                }

                                zip.file(`trailer.${ext}`, trailerData);
                                assets.trailer = true;
                                if (exportLogger) {
                                    await exportLogger.info('Trailer downloaded', {
                                        title: item.title,
                                        size: `${(trailerData.length / 1024 / 1024).toFixed(2)} MB`,
                                    });
                                }
                            }
                        }
                    }
                } catch (err) {
                    if (exportLogger) {
                        await exportLogger.warn('Trailer download error', {
                            title: item.title,
                            error: err.message,
                        });
                    }
                    logger.warn(
                        `JobQueue: Jellyfin trailer download failed for ${item.title}:`,
                        err.message
                    );
                }
            }
        }

        // Download theme music if available
        // Check for raw theme path or extract from themeUrl
        let themeKey = item.theme;
        if (!themeKey && item.themeUrl && sourceType === 'plex') {
            // Extract path from proxy URL: /proxy/plex?server=...&path=%2Flibrary%2F...
            const match = item.themeUrl.match(/[&?]path=([^&]+)/);
            if (match) {
                themeKey = decodeURIComponent(match[1]);
            }
        }

        const theme =
            item.extras?.find(e => e.type === 'theme') || (themeKey ? { key: themeKey } : null);

        logger.info(`JobQueue: Theme check for ${item.title}`, {
            hasTheme: !!theme,
            themeKey: theme?.key,
            itemTheme: item.theme,
            itemThemeUrl: item.themeUrl,
            extractedKey: themeKey,
            sourceType,
        });

        if (theme && theme.key && sourceType === 'plex') {
            logger.info(`JobQueue: Attempting theme music download for ${item.title}`, {
                themeKey: theme.key,
            });
            try {
                // Get Plex config
                const serverConfig = (this.config.mediaServers || []).find(s => s.type === 'plex');
                const plexUrl =
                    serverConfig?.url ||
                    (serverConfig?.hostname
                        ? `http://${serverConfig.hostname}:${serverConfig.port || 32400}`
                        : null);
                const plexToken =
                    serverConfig?.token ||
                    (serverConfig?.tokenEnvVar ? process.env[serverConfig.tokenEnvVar] : null);

                if (plexUrl && plexToken) {
                    // Theme key is directly downloadable (e.g., /library/metadata/{id}/theme/{timestamp})
                    const separator = theme.key.includes('?') ? '&' : '?';
                    const themeUrl = `${plexUrl}${theme.key}${separator}X-Plex-Token=${plexToken}`;

                    logger.info(`JobQueue: Downloading theme music from ${theme.key}`);

                    // @ts-ignore - axios.get exists but TypeScript doesn't recognize require('axios') type
                    const response = await axios.get(themeUrl, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        maxContentLength: 50 * 1024 * 1024, // 50MB max for audio
                    });

                    if (response.status === 200 && response.data) {
                        const themeData = Buffer.from(response.data);
                        if (themeData.length > 10240) {
                            // At least 10KB for real audio
                            // Detect format from theme.key or response headers
                            const ext = theme.key.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || 'mp3';
                            zip.file(`theme.${ext}`, themeData);
                            assets.theme = true;
                            logger.info(`JobQueue: Theme music downloaded`, {
                                title: item.title,
                                size: `${(themeData.length / 1024).toFixed(2)} KB`,
                            });
                            if (exportLogger) {
                                await exportLogger.info('Theme music downloaded', {
                                    title: item.title,
                                    size: `${(themeData.length / 1024).toFixed(2)} KB`,
                                });
                            }
                        } else {
                            logger.warn(`JobQueue: Theme music too small for ${item.title}`, {
                                size: themeData.length,
                            });
                        }
                    }
                }
            } catch (err) {
                logger.warn(
                    `JobQueue: Theme music download failed for ${item.title}:`,
                    err.message
                );
                if (exportLogger) {
                    await exportLogger.warn('Theme music download error', {
                        title: item.title,
                        error: err.message,
                    });
                }
            }
        }

        // Jellyfin theme music download
        // Use themeSongs array if available (from enrichment)
        if (sourceType === 'jellyfin' && (item.themeSongs || item.sourceId)) {
            logger.info(`JobQueue: Checking for Jellyfin theme music for ${item.title}`);
            try {
                let themeSongId = null;

                // If we have themeSongs from enrichment, use the first one
                if (item.themeSongs && item.themeSongs.length > 0) {
                    themeSongId = item.themeSongs[0].Id;
                    logger.info(`JobQueue: Using theme song from enrichment`, {
                        title: item.title,
                        themeId: themeSongId,
                    });
                }

                if (themeSongId) {
                    // Find Jellyfin server config (don't require enabled, we're already processing its items)
                    const serverConfig = (this.config.mediaServers || []).find(
                        s => s.type === 'jellyfin'
                    );

                    if (serverConfig) {
                        const { hostname, port = 8096, apiKey } = serverConfig;
                        const protocol = port === 8920 || port === 443 ? 'https' : 'http';
                        const jellyfinUrl = `${protocol}://${hostname}:${port}`;

                        logger.info(`JobQueue: Downloading Jellyfin theme music`, {
                            title: item.title,
                            themeId: themeSongId,
                        });

                        // Download theme music using /Items/{ItemId}/Download
                        const downloadUrl = `${jellyfinUrl}/Items/${themeSongId}/Download?api_key=${apiKey}`;

                        // @ts-ignore - axios.get exists but TypeScript doesn't recognize require('axios') type
                        const response = await axios.get(downloadUrl, {
                            responseType: 'arraybuffer',
                            timeout: 60000,
                            maxContentLength: 50 * 1024 * 1024, // 50MB max for audio
                            headers: {
                                'X-Emby-Token': apiKey,
                            },
                            validateStatus: status => status === 200,
                        });

                        if (response.status === 200 && response.data) {
                            const themeData = Buffer.from(response.data);
                            if (themeData.length > 10240) {
                                // At least 10KB for real audio
                                // Detect format from content-type or default to mp3
                                let ext = 'mp3';
                                const contentType = response.headers['content-type'];
                                if (contentType) {
                                    if (contentType.includes('flac')) ext = 'flac';
                                    else if (contentType.includes('ogg')) ext = 'ogg';
                                    else if (contentType.includes('wav')) ext = 'wav';
                                    else if (
                                        contentType.includes('m4a') ||
                                        contentType.includes('mp4a')
                                    )
                                        ext = 'm4a';
                                }

                                zip.file(`theme.${ext}`, themeData);
                                assets.theme = true;
                                logger.info(`JobQueue: Jellyfin theme music downloaded`, {
                                    title: item.title,
                                    size: `${(themeData.length / 1024).toFixed(2)} KB`,
                                });
                                if (exportLogger) {
                                    await exportLogger.info('Theme music downloaded', {
                                        title: item.title,
                                        size: `${(themeData.length / 1024).toFixed(2)} KB`,
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                // Theme music is optional, so only log at debug level if not found
                if (err.response?.status === 404) {
                    logger.debug(
                        `JobQueue: No theme music available for ${item.title} (404 - normal)`
                    );
                } else {
                    logger.warn(
                        `JobQueue: Jellyfin theme music download failed for ${item.title}:`,
                        err.message
                    );
                    if (exportLogger) {
                        await exportLogger.warn('Theme music download error', {
                            title: item.title,
                            error: err.message,
                        });
                    }
                }
            }
        } else if (item.themeUrl && sourceType !== 'plex') {
            logger.info(`JobQueue: Attempting theme music download for ${item.title}`, {
                themeUrl: item.themeUrl,
            });
            try {
                const themeData = await this._withInflightLimit(() =>
                    this.downloadAsset(item.themeUrl, sourceType, exportLogger)
                );

                if (themeData && themeData.length > 1024) {
                    // At least 1KB
                    // Detect format from data or default to mp3
                    const ext = 'mp3'; // Plex theme is usually mp3
                    zip.file(`theme.${ext}`, themeData);
                    assets.theme = true;
                    logger.info(`JobQueue: Theme music downloaded for ${item.title}`, {
                        size: `${(themeData.length / 1024).toFixed(2)} KB`,
                    });
                    if (exportLogger) {
                        await exportLogger.info('Theme music downloaded', {
                            title: item.title,
                            size: `${(themeData.length / 1024).toFixed(2)} KB`,
                        });
                    }
                } else {
                    logger.warn(`JobQueue: Theme music too small for ${item.title}`, {
                        size: themeData?.length || 0,
                    });
                    if (exportLogger) {
                        await exportLogger.warn('Theme music download failed or too small', {
                            title: item.title,
                            url: item.themeUrl,
                        });
                    }
                }
            } catch (err) {
                logger.warn(
                    `JobQueue: Theme music download failed for ${item.title}:`,
                    err.message
                );
                if (exportLogger) {
                    await exportLogger.warn('Theme music download error', {
                        title: item.title,
                        error: err.message,
                    });
                }
            }
        }

        // Prepare people images: download thumbs and map to local files
        const peopleImages = [];
        const addPeopleImages = async list => {
            if (!Array.isArray(list)) return [];
            const out = new Array(list.length).fill(null);
            const queue = list.map((p, i) => ({ p, i }));
            const personConcurrency = Math.min(assetConcurrency, 6);
            const workers = new Array(Math.min(personConcurrency, queue.length))
                .fill(0)
                .map(async () => {
                    while (queue.length) {
                        const { p, i } = queue.shift();
                        if (!p || !p.thumbUrl) {
                            // Do not carry thumbUrl in metadata; only embed local file reference when available
                            const rest = p
                                ? Object.fromEntries(
                                      Object.entries(p).filter(([k]) => k !== 'thumbUrl')
                                  )
                                : {};
                            out[i] = rest;
                            continue;
                        }
                        try {
                            let data = await this._withInflightLimit(() =>
                                this.downloadAsset(p.thumbUrl, sourceType, exportLogger)
                            );
                            // Skip obviously broken downloads (e.g. 1KB fallbacks)
                            if (data && data.length > 2048) {
                                // Optionally resize to fit within 500x500 while preserving aspect ratio
                                if (sharp) {
                                    try {
                                        data = await sharp(data)
                                            .resize({
                                                width: 500,
                                                height: 500,
                                                fit: 'inside',
                                                withoutEnlargement: true,
                                            })
                                            .jpeg({
                                                quality: 85,
                                                progressive: true,
                                                mozjpeg: true,
                                                chromaSubsampling: '4:2:0',
                                            })
                                            .toBuffer();
                                    } catch (e) {
                                        // If resize fails, keep original buffer
                                        logger.warn(
                                            'JobQueue: sharp resize failed for person image',
                                            {
                                                error: e.message,
                                            }
                                        );
                                    }
                                }
                                const safeName = (p.name || p.id || 'person')
                                    .toString()
                                    .replace(/[^a-z0-9_-]+/gi, '_');
                                const filename = `people/${safeName}.jpg`;
                                zip.file(filename, data);
                                const rest = Object.fromEntries(
                                    Object.entries(p || {}).filter(([k]) => k !== 'thumbUrl')
                                );
                                out[i] = { ...rest, thumb: filename };
                                peopleImages.push(filename);
                            } else {
                                const rest = Object.fromEntries(
                                    Object.entries(p || {}).filter(([k]) => k !== 'thumbUrl')
                                );
                                out[i] = rest;
                            }
                        } catch (_) {
                            const rest = Object.fromEntries(
                                Object.entries(p || {}).filter(([k]) => k !== 'thumbUrl')
                            );
                            out[i] = rest;
                        }
                    }
                });
            await Promise.all(workers);
            return out;
        };

        const castWithThumbs = await addPeopleImages(item.cast || []);
        const directorsWithThumbs = await addPeopleImages(item.directorsDetailed || []);
        const writersWithThumbs = await addPeopleImages(item.writersDetailed || []);
        const producersWithThumbs = await addPeopleImages(item.producersDetailed || []);

        // Add metadata (enriched)
        const metadata = {
            title: item.title,
            year: item.year,
            genres: item.genres || item.genre || [],
            rating: item.rating,
            contentRating: item.contentRating || item.officialRating || null,
            overview: item.overview,
            tagline: item.tagline || null,
            clearlogoPath: assets.clearlogo ? 'clearlogo.png' : null,
            cast: castWithThumbs,
            directors: item.directors || [],
            writers: item.writers || [],
            producers: item.producers || [],
            directorsDetailed: directorsWithThumbs,
            writersDetailed: writersWithThumbs,
            producersDetailed: producersWithThumbs,
            studios: item.studios || [],
            guids: item.guids || [],
            imdbUrl: item.imdbUrl || null,
            rottenTomatoes: item.rottenTomatoes || null,
            releaseDate: item.releaseDate || null,
            runtimeMs: item.runtimeMs || null,
            qualityLabel: item.qualityLabel || null,
            mediaStreams: item.mediaStreams || null,
            // Enriched metadata fields (phase 1: Collections, Statistics, Timestamps)
            collections: item.collections || null,
            countries: item.countries || null,
            audienceRating: item.audienceRating || null,
            viewCount: item.viewCount || null,
            skipCount: item.skipCount || null,
            lastViewedAt: item.lastViewedAt || null,
            userRating: item.userRating || null,
            originalTitle: item.originalTitle || null,
            titleSort: item.titleSort || null,
            // Enriched metadata fields (phase 2: Advanced Metadata)
            slug: item.slug || null,
            contentRatingAge: item.contentRatingAge || null,
            addedAt: item.addedAt || null,
            updatedAt: item.updatedAt || null,
            ultraBlurColors: item.ultraBlurColors || null,
            ratingsDetailed: item.ratingsDetailed || null,
            parentalGuidance: item.parentalGuidance || null,
            chapters: item.chapters || null,
            markers: item.markers || null,
            // Enriched metadata fields (phase 3: All Image Types)
            bannerUrl: item.bannerUrl || null,
            discArtUrl: item.discArtUrl || null,
            thumbUrl: item.thumbUrl || null,
            clearArtUrl: item.clearArtUrl || null,
            landscapeUrl: item.landscapeUrl || null,
            allArtUrls: item.allArtUrls || null,
            fanart: item.fanart || null,
            // Enriched metadata fields (phase 4: Comprehensive Technical Details)
            audioTracks: item.audioTracks || null,
            subtitles: item.subtitles || null,
            videoStreams: item.videoStreams || null,
            hasHDR: item.hasHDR || null,
            hasDolbyVision: item.hasDolbyVision || null,
            is3D: item.is3D || null,
            containerFormat: item.containerFormat || null,
            totalFileSize: item.totalFileSize || null,
            totalBitrate: item.totalBitrate || null,
            optimizedForStreaming: item.optimizedForStreaming || null,
            // Enriched metadata fields (phase 5: Advanced Metadata)
            extras: item.extras || null,
            related: item.related || null,
            themeUrl: item.themeUrl || null,
            lockedFields: item.lockedFields || null,
            // Trailer and theme music support
            trailer:
                item.extras?.find(
                    e =>
                        e.type === 'trailer' ||
                        e.type?.toLowerCase() === 'trailer' ||
                        e.type === 'clip'
                ) || null,
            themeMusic: item.themeUrl || null,
            // Enriched metadata fields (phase 6: File & Location Info)
            filePaths: item.filePaths || null,
            fileDetails: item.fileDetails || null,
            // Enriched metadata fields (phase 7: Comprehensive Plex Metadata - 2025-01-09)
            ratingImage: item.ratingImage || null,
            audienceRatingImage: item.audienceRatingImage || null,
            ratingCount: item.ratingCount || null,
            viewOffset: item.viewOffset || null,
            leafCount: item.leafCount || null,
            viewedLeafCount: item.viewedLeafCount || null,
            index: item.index || null,
            parentIndex: item.parentIndex || null,
            absoluteIndex: item.absoluteIndex || null,
            parentKey: item.parentKey || null,
            grandparentKey: item.grandparentKey || null,
            parentRatingKey: item.parentRatingKey || null,
            grandparentRatingKey: item.grandparentRatingKey || null,
            parentTitle: item.parentTitle || null,
            grandparentTitle: item.grandparentTitle || null,
            parentThumb: item.parentThumb || null,
            grandparentThumb: item.grandparentThumb || null,
            grandparentArt: item.grandparentArt || null,
            parentHero: item.parentHero || null,
            grandparentHero: item.grandparentHero || null,
            heroUrl: item.heroUrl || null,
            compositeUrl: item.compositeUrl || null,
            backgroundSquareUrl: item.backgroundSquareUrl || null,
            skipChildren: item.skipChildren || null,
            skipParent: item.skipParent || null,
            primaryExtraKey: item.primaryExtraKey || null,
            chapterSource: item.chapterSource || null,
            reviews: item.reviews || null,
            commonSenseMedia: item.commonSenseMedia || null,
            // Enriched metadata fields (phase 7: Comprehensive Jellyfin Metadata - 2025-01-09)
            seriesId: item.seriesId || null,
            seriesName: item.seriesName || null,
            seasonId: item.seasonId || null,
            seasonName: item.seasonName || null,
            parentId: item.parentId || null,
            playedPercentage: item.playedPercentage || null,
            recursiveItemCount: item.recursiveItemCount || null,
            unplayedItemCount: item.unplayedItemCount || null,
            isFavorite: item.isFavorite || null,
            userLikes: item.userLikes || null,
            artUrl: item.artUrl || null,
            boxUrl: item.boxUrl || null,
            screenshotUrl: item.screenshotUrl || null,
            seriesThumbUrl: item.seriesThumbUrl || null,
            parentThumbUrl: item.parentThumbUrl || null,
            parentBackdropUrl: item.parentBackdropUrl || null,
            parentArtUrl: item.parentArtUrl || null,
            isHD: item.isHD || null,
            hasChapters: item.hasChapters || null,
            lockData: item.lockData || null,
            status: item.status || null,
            airTime: item.airTime || null,
            airDays: item.airDays || null,
            endDate: item.endDate || null,
            criticRatingSummary: item.criticRatingSummary || null,
            images: {
                poster: !!assets.poster,
                background: !!assets.background,
                clearlogo: !!assets.clearlogo,
                thumbnail: !!assets.thumbnail,
                fanartCount: assets.fanart || 0,
                discart: !!assets.discart,
                banner: !!assets.banner,
                hero: !!assets.hero,
                composite: !!assets.composite,
                backgroundSquare: !!assets.backgroundSquare,
                trailer: !!assets.trailer,
                theme: !!assets.theme,
            },
            source: sourceType,
            sourceId: item.id,
            generated: new Date().toISOString(),
            assets: assets,
            peopleImages: peopleImages,
        };

        zip.file('metadata.json', JSON.stringify(metadata, null, 2));

        // Validate minimum requirements
        if (!assets.poster || !assets.background) {
            if (exportLogger) {
                await exportLogger.error('Missing required assets', {
                    title: item.title,
                    hasPoster: !!assets.poster,
                    hasBackground: !!assets.background,
                });
            }
            throw new Error('Missing required assets (poster and/or background)');
        }

        // Generate ZIP file
        const comp = (options && options.compression) || 'balanced';
        const level = comp === 'fast' ? 3 : comp === 'max' ? 9 : 6; // balanced default
        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level },
        });

        // Write to file
        await fs.writeFile(outputPath, zipBuffer);

        const stats = await fs.stat(outputPath);

        logger.info(`JobQueue: Generated posterpack: ${outputFilename}`, {
            size: stats.size,
            assets: Object.keys(assets),
        });

        return {
            outputPath: outputPath,
            size: stats.size,
            assets: assets,
        };
    }

    /**
     * Generate posterpack filename
     * @param {Object} item - Media item
     * @param {Object} _options - Generation options (unused)
     * @returns {string} Filename
     */
    generatePosterpackFilename(item, _options) {
        // Enforce fixed naming convention: ignore client-provided overrides
        const template =
            this.config.localDirectory?.posterpackGeneration?.outputNaming ||
            '{{title}} ({{year}})';

        let filename = template
            .replace(/\{\{title\}\}/g, item.title || 'Unknown')
            .replace(/\{\{year\}\}/g, item.year || 'Unknown');

        // Clean filename
        filename = filename
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
            .replace(/\s+/g, ' ') // Normalize spaces
            .trim();

        return `${filename}.zip`;
    }

    /**
     * Download asset from source
     * @param {string} assetUrl - Asset URL (can be full URL or path)
     * @param {string} sourceType - Source type
     * @param {Object|null} exportLogger - Optional logger
     * @returns {Promise<Buffer>} Asset data
     */
    async downloadAsset(assetUrl, sourceType, exportLogger = null) {
        // Configurable retry params
        const maxRetries = Number(
            process.env.POSTERPACK_DOWNLOAD_RETRIES ||
                this.config?.localDirectory?.posterpackGeneration?.retryMaxRetries ||
                2
        );
        const baseDelay = Number(
            process.env.POSTERPACK_DOWNLOAD_BASE_DELAY_MS ||
                this.config?.localDirectory?.posterpackGeneration?.retryBaseDelay ||
                300
        );

        // Convert asset URL to image proxy format if it's a relative path
        let downloadUrl = assetUrl;
        let useLocalProxy = false;

        // Debug: log incoming URL
        logger.debug(
            `JobQueue: downloadAsset called with URL: ${assetUrl}, sourceType: ${sourceType}`
        );

        // Check if already an image proxy URL or absolute URL
        const isAlreadyProxied =
            assetUrl && (assetUrl.startsWith('/image?') || assetUrl.includes('/image?'));
        const isAbsoluteUrl = assetUrl && assetUrl.startsWith('http');

        if (assetUrl && !isAbsoluteUrl && !isAlreadyProxied) {
            // Get server name from config
            const serverConfig = (this.config.mediaServers || []).find(s => s.type === sourceType);
            const serverName =
                serverConfig?.name || (sourceType === 'plex' ? 'Plex Server' : 'Jellyfin');

            // Use image proxy endpoint
            downloadUrl = `/image?server=${encodeURIComponent(serverName)}&path=${encodeURIComponent(assetUrl)}`;
            useLocalProxy = true;
            logger.debug(`JobQueue: Converted to proxy URL: ${downloadUrl}`);
        } else if (isAlreadyProxied) {
            useLocalProxy = true;
            logger.debug(`JobQueue: Using proxied URL as-is: ${downloadUrl}`);
        } else {
            logger.debug(`JobQueue: Using absolute URL as-is: ${downloadUrl}`);
        }

        // For image proxy URLs, use localhost axios client instead of source HTTP client
        let httpClient;
        if (useLocalProxy) {
            // In test environment, use mocked httpClient if available
            if (process.env.NODE_ENV === 'test' && this.httpClients?.[sourceType]) {
                httpClient = this.httpClients[sourceType];
                logger.debug(`JobQueue: Using mocked HTTP client for test`);
            } else {
                // Create localhost client for Posterrama's /image endpoint
                const port = process.env.PORT || this.config?.server?.port || 4000;
                const baseURL = `http://localhost:${port}`;
                // @ts-ignore - axios.create exists but TypeScript doesn't recognize require('axios') type
                httpClient = axios.create({
                    baseURL,
                    timeout: 30000,
                    maxRedirects: 5,
                });
                logger.debug(
                    `JobQueue: Using localhost client for proxy URL (${baseURL}${downloadUrl})`
                );
            }
        } else {
            // Use source-specific HTTP client for absolute URLs
            httpClient = this.getHttpClient(sourceType);
            if (!httpClient) {
                logger.warn(`JobQueue: No HTTP client available for ${sourceType}`);
                return null;
            }
        }

        const sleep = ms => new Promise(res => setTimeout(res, ms));

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await httpClient.get(downloadUrl, { responseType: 'arraybuffer' });
                if (response.status === 200 && response.data) {
                    return Buffer.from(response.data);
                }
                const status = response?.status;
                const retriable = status === 429 || (status >= 500 && status < 600);
                if (!retriable || attempt === maxRetries) {
                    logger.warn(
                        `JobQueue: Failed to download asset: ${downloadUrl} (status: ${status})`
                    );
                    return null;
                }
            } catch (error) {
                const code = error?.code || '';
                const retriableCodes = new Set([
                    'ECONNRESET',
                    'ETIMEDOUT',
                    'ENOTFOUND',
                    'EAI_AGAIN',
                    'ECONNABORTED',
                ]);
                const status = error?.response?.status;
                const retriable =
                    retriableCodes.has(code) || status === 429 || (status >= 500 && status < 600);
                if (!retriable || attempt === maxRetries) {
                    logger.error(`JobQueue: Asset download error for ${downloadUrl}:`, error);
                    return null;
                }
                if (exportLogger) {
                    await exportLogger.info('Download retry', {
                        url: downloadUrl,
                        attempt: attempt + 1,
                        remaining: Math.max(0, maxRetries - attempt),
                        status: status || null,
                        code,
                    });
                }
            }
            // Exponential backoff with jitter
            const delay = Math.round(baseDelay * Math.pow(2, attempt));
            const jitter = Math.floor(Math.random() * Math.max(50, baseDelay / 2));
            await sleep(delay + jitter);
        }

        return null;
    }

    /**
     * Get source adapter
     * @param {string} sourceType - Source type
     * @returns {Object} Source adapter
     */
    getSourceAdapter(sourceType) {
        // This will be injected by the main application
        if (this.sourceAdapters) {
            return this.sourceAdapters[sourceType];
        }

        logger.error(`JobQueue: Source adapter not available: ${sourceType}`);
        return null;
    }

    /**
     * Get HTTP client for source type
     * @param {string} sourceType - Source type
     * @returns {Object} HTTP client
     */
    getHttpClient(sourceType) {
        // This will be injected by the main application
        if (this.httpClients) {
            return this.httpClients[sourceType];
        }

        logger.error(`JobQueue: HTTP client not available: ${sourceType}`);
        return null;
    }

    /**
     * Set source adapters
     * @param {Object} adapters - Source adapters map
     */
    setSourceAdapters(adapters) {
        this.sourceAdapters = adapters;
    }

    /**
     * Set HTTP clients
     * @param {Object} clients - HTTP clients map
     */
    setHttpClients(clients) {
        this.httpClients = clients;
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {Object} Job object
     */
    getJob(jobId) {
        return this.jobs.get(jobId);
    }

    /**
     * Get all jobs
     * @param {string} status - Filter by status (optional)
     * @returns {Array} Array of jobs
     */
    getAllJobs(status = null) {
        const allJobs = Array.from(this.jobs.values());

        if (status) {
            return allJobs.filter(job => job.status === status);
        }

        return allJobs.sort((a, b) => b.created - a.created);
    }

    /**
     * Cancel a queued job
     * @param {string} jobId - Job ID
     * @returns {boolean} True if cancelled
     */
    cancelJob(jobId) {
        const job = this.jobs.get(jobId);

        if (!job) {
            return false;
        }

        if (job.status === 'queued') {
            job.status = 'cancelled';
            job.completed = new Date();
            job.logs.push('Job cancelled by user');

            logger.info(`JobQueue: Job ${jobId} cancelled`);
            this.emit('jobCancelled', job);

            return true;
        }

        return false;
    }

    /**
     * Clean up completed jobs older than specified days
     * @param {number} days - Days to keep completed jobs
     */
    cleanupOldJobs(days = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        let removedCount = 0;

        for (const [jobId, job] of this.jobs.entries()) {
            if (
                (job.status === 'completed' ||
                    job.status === 'failed' ||
                    job.status === 'cancelled') &&
                job.completed &&
                job.completed < cutoffDate
            ) {
                this.jobs.delete(jobId);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            logger.info(`JobQueue: Cleaned up ${removedCount} old jobs`);
        }
    }

    /**
     * Get queue statistics
     * @returns {Object} Queue statistics
     */
    getStatistics() {
        const jobs = Array.from(this.jobs.values());

        return {
            total: jobs.length,
            queued: jobs.filter(j => j.status === 'queued').length,
            running: jobs.filter(j => j.status === 'running').length,
            completed: jobs.filter(j => j.status === 'completed').length,
            failed: jobs.filter(j => j.status === 'failed').length,
            cancelled: jobs.filter(j => j.status === 'cancelled').length,
            activeJobs: this.activeJobs.size,
            maxConcurrentJobs: this.maxConcurrentJobs,
        };
    }
}

module.exports = JobQueue;
