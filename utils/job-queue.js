const EventEmitter = require('events');
const path = require('path');
const fs = require('fs-extra');
const JSZip = require('jszip');
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

        job.totalItems = allItems.length;
        job.logs.push(`Total items to process: ${job.totalItems}`);

        if (job.totalItems === 0) {
            throw new Error('No items found in selected libraries');
        }

        // Process each item
        const results = [];
        const errors = [];

        for (let i = 0; i < allItems.length; i++) {
            const item = allItems[i];

            try {
                // Update progress
                job.processedItems = i;
                job.progress = Math.round((i / job.totalItems) * 100);
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
        if (includeAssets?.clearart && item.clearart) {
            const clearartData = await this.downloadAsset(item.clearart, sourceType);
            if (clearartData) {
                zip.file('clearart.png', clearartData);
                assets.clearart = true;
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

        // Add metadata
        const metadata = {
            title: item.title,
            year: item.year,
            genre: item.genre || [],
            rating: item.rating,
            overview: item.overview,
            cast: item.cast || [],
            source: sourceType,
            sourceId: item.id,
            generated: new Date().toISOString(),
            assets: assets,
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
