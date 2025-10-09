const EventEmitter = require('events');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const JSZip = require('jszip');
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
     * @returns {string} Job ID
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
            setTimeout(() => this.processNextJob(), 100);
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
                const result = await this.generatePosterpackForItem(
                    item,
                    sourceType,
                    options,
                    job.exportLogger || null
                );
                results.push({
                    item: { title: item.title, year: item.year, id: item.id },
                    success: true,
                    outputPath: result.outputPath,
                    size: result.size,
                    assets: result.assets,
                });
                job.logs.push(`✅ Generated: ${item.title}`);
                if (job.exportLogger)
                    await job.exportLogger.info('Generated posterpack', {
                        title: item.title,
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
     * @returns {Object} Generation result
     */
    async generatePosterpackForItem(item, sourceType, options, exportLogger = null) {
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
                                const thumb = await sharp(posterData)
                                    .resize({
                                        width: 300,
                                        height: 300,
                                        fit: 'inside',
                                        withoutEnlargement: true,
                                    })
                                    .jpeg({ quality: 80 })
                                    .toBuffer();
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
                                            .jpeg({ quality: 85 })
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
            // Enriched metadata fields (phase 1)
            collections: item.collections || null,
            countries: item.countries || null,
            audienceRating: item.audienceRating || null,
            viewCount: item.viewCount || null,
            skipCount: item.skipCount || null,
            lastViewedAt: item.lastViewedAt || null,
            userRating: item.userRating || null,
            originalTitle: item.originalTitle || null,
            titleSort: item.titleSort || null,
            // Enriched metadata fields (phase 2)
            slug: item.slug || null,
            contentRatingAge: item.contentRatingAge || null,
            addedAt: item.addedAt || null,
            updatedAt: item.updatedAt || null,
            ultraBlurColors: item.ultraBlurColors || null,
            ratingsDetailed: item.ratingsDetailed || null,
            parentalGuidance: item.parentalGuidance || null,
            chapters: item.chapters || null,
            markers: item.markers || null,
            images: {
                poster: !!assets.poster,
                background: !!assets.background,
                clearlogo: !!assets.clearlogo,
                thumbnail: !!assets.thumbnail,
                fanartCount: assets.fanart || 0,
                discart: !!assets.discart,
                banner: !!assets.banner,
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
     * @param {Object} options - Generation options
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
     * @param {string} assetUrl - Asset URL
     * @param {string} sourceType - Source type
     * @returns {Buffer} Asset data
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

        const httpClient = this.getHttpClient(sourceType);
        if (!httpClient) {
            logger.warn(`JobQueue: No HTTP client available for ${sourceType}`);
            return null;
        }

        const sleep = ms => new Promise(res => setTimeout(res, ms));

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await httpClient.get(assetUrl, { responseType: 'arraybuffer' });
                if (response.status === 200 && response.data) {
                    return Buffer.from(response.data);
                }
                const status = response?.status;
                const retriable = status === 429 || (status >= 500 && status < 600);
                if (!retriable || attempt === maxRetries) {
                    logger.warn(
                        `JobQueue: Failed to download asset: ${assetUrl} (status: ${status})`
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
                    logger.error(`JobQueue: Asset download error for ${assetUrl}:`, error);
                    return null;
                }
                if (exportLogger) {
                    await exportLogger.info('Download retry', {
                        url: assetUrl,
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
