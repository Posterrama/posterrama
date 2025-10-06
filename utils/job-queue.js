const EventEmitter = require('events');
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

        logger.info('JobQueue initialized', { maxConcurrentJobs: this.maxConcurrentJobs });
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

            this.emit('jobCompleted', job);
        } catch (error) {
            // Mark job as failed
            job.status = 'failed';
            job.error = error.message;
            job.completed = new Date();

            logger.error(`JobQueue: Job ${jobId} failed:`, error);
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
            } catch (error) {
                job.logs.push(`Error fetching library ${libraryId}: ${error.message}`);
                logger.error(`JobQueue: Error fetching library ${libraryId}:`, error);
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

        const filtered = allItems.filter(it => {
            // Media type filter (movie/show)
            if (mediaType !== 'all') {
                const t = (it.type || '').toLowerCase();
                // If type not provided by adapter, infer "movie" as default
                if (t && t !== mediaType) return false;
            }
            // Year filter
            if (yearOk) {
                const y = Number(it.year);
                if (!Number.isFinite(y) || !yearOk(y)) return false;
            }
            // Source-specific filters
            if (sourceType === 'plex') {
                if (allowedGenresP.length) {
                    const g = Array.isArray(it.genre || it.genres)
                        ? (it.genre || it.genres).map(x => String(x).toLowerCase())
                        : [];
                    if (!allowedGenresP.some(need => g.includes(String(need).toLowerCase()))) {
                        return false;
                    }
                }
                if (allowedRatingsP.length) {
                    const r = it.contentRating || it.rating || null;
                    const norm = r ? String(r).trim().toUpperCase() : '';
                    if (!norm || !allowedRatingsP.includes(norm)) return false;
                }
                if (allowedQualP.length) {
                    const lbl = it.qualityLabel || mapResToLabel(it.videoResolution);
                    if (lbl && !allowedQualP.includes(lbl)) return false;
                }
            } else if (sourceType === 'jellyfin') {
                if (allowedGenresJ.length) {
                    const g = Array.isArray(it.genre || it.genres)
                        ? (it.genre || it.genres).map(x => String(x).toLowerCase())
                        : [];
                    if (!allowedGenresJ.some(need => g.includes(String(need).toLowerCase()))) {
                        return false;
                    }
                }
                if (allowedRatingsJ.length) {
                    const r = it.officialRating || it.rating || null;
                    const norm = r ? String(r).trim().toUpperCase() : '';
                    if (!norm || !allowedRatingsJ.includes(norm)) return false;
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

        if (job.totalItems === 0) {
            throw new Error('No items found in selected libraries');
        }

        // Process each item
        const results = [];
        const errors = [];

        for (let i = 0; i < itemsToProcess.length; i++) {
            const item = itemsToProcess[i];

            try {
                // Update progress
                job.processedItems = i;
                job.progress = Math.round((i / Math.max(job.totalItems, 1)) * 100);
                job.logs.push(`Processing: ${item.title} (${i + 1}/${job.totalItems})`);

                this.emit('jobProgress', job);

                // Generate posterpack for item
                const result = await this.generatePosterpackForItem(item, sourceType, options);

                results.push({
                    item: {
                        title: item.title,
                        year: item.year,
                        id: item.id,
                    },
                    success: true,
                    outputPath: result.outputPath,
                    size: result.size,
                    assets: result.assets,
                });

                job.logs.push(`✅ Generated: ${item.title}`);
            } catch (error) {
                logger.error(`JobQueue: Failed to generate posterpack for ${item.title}:`, error);

                errors.push({
                    item: {
                        title: item.title,
                        year: item.year,
                        id: item.id,
                    },
                    success: false,
                    error: error.message,
                });

                job.logs.push(`❌ Failed: ${item.title} - ${error.message}`);
            }
        }

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
    }

    /**
     * Generate posterpack for a single item
     * @param {Object} item - Media item
     * @param {string} sourceType - Source type (plex/jellyfin)
     * @param {Object} options - Generation options
     * @returns {Object} Generation result
     */
    async generatePosterpackForItem(item, sourceType, options) {
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
        if (item.poster) {
            const posterData = await this.downloadAsset(item.poster, sourceType);
            if (posterData) {
                zip.file('poster.jpg', posterData);
                assets.poster = true;
            }
        }

        // Add background (required)
        if (item.background) {
            const backgroundData = await this.downloadAsset(item.background, sourceType);
            if (backgroundData) {
                zip.file('background.jpg', backgroundData);
                assets.background = true;
            }
        }

        // Add optional assets
        // ClearLogo support (prefer new 'clearlogo' field)
        if (item.clearlogo || (includeAssets?.clearart && item.clearart)) {
            const logoUrl = item.clearlogo || item.clearart;
            const clearlogoData = await this.downloadAsset(logoUrl, sourceType);
            if (clearlogoData) {
                zip.file('clearlogo.png', clearlogoData);
                assets.clearlogo = true;
            }
        }

        if (includeAssets?.fanart && item.fanart) {
            for (let i = 0; i < item.fanart.length && i < 5; i++) {
                const fanartData = await this.downloadAsset(item.fanart[i], sourceType);
                if (fanartData) {
                    zip.file(`fanart-${i + 1}.jpg`, fanartData);
                    assets.fanart = (assets.fanart || 0) + 1;
                }
            }
        }

        if (includeAssets?.discart && item.discart) {
            const discartData = await this.downloadAsset(item.discart, sourceType);
            if (discartData) {
                zip.file('disc.png', discartData);
                assets.discart = true;
            }
        }

        // Prepare people images: download thumbs and map to local files
        const peopleImages = [];
        const addPeopleImages = async list => {
            if (!Array.isArray(list)) return [];
            const out = [];
            for (const p of list) {
                if (!p || !p.thumbUrl) {
                    // Do not carry thumbUrl in metadata; only embed local file reference when available
                    const rest = p
                        ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'thumbUrl'))
                        : {};
                    out.push(rest);
                    continue;
                }
                try {
                    let data = await this.downloadAsset(p.thumbUrl, sourceType);
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
                                logger.warn('JobQueue: sharp resize failed for person image', {
                                    error: e.message,
                                });
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
                        out.push({ ...rest, thumb: filename });
                        peopleImages.push(filename);
                    } else {
                        const rest = Object.fromEntries(
                            Object.entries(p || {}).filter(([k]) => k !== 'thumbUrl')
                        );
                        out.push(rest);
                    }
                } catch (_) {
                    const rest = Object.fromEntries(
                        Object.entries(p || {}).filter(([k]) => k !== 'thumbUrl')
                    );
                    out.push(rest);
                }
            }
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
            images: {
                poster: !!assets.poster,
                background: !!assets.background,
                clearlogo: !!assets.clearlogo,
                fanartCount: assets.fanart || 0,
                discart: !!assets.discart,
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
            throw new Error('Missing required assets (poster and/or background)');
        }

        // Generate ZIP file
        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
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
    async downloadAsset(assetUrl, sourceType) {
        try {
            // Get appropriate HTTP client for source type
            const httpClient = this.getHttpClient(sourceType);

            if (!httpClient) {
                logger.warn(`JobQueue: No HTTP client available for ${sourceType}`);
                return null;
            }

            // Download asset
            const response = await httpClient.get(assetUrl, { responseType: 'arraybuffer' });

            if (response.status === 200 && response.data) {
                return Buffer.from(response.data);
            }

            logger.warn(
                `JobQueue: Failed to download asset: ${assetUrl} (status: ${response.status})`
            );
            return null;
        } catch (error) {
            logger.error(`JobQueue: Asset download error for ${assetUrl}:`, error);
            return null;
        }
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
