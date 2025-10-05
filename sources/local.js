const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');
const mimeTypes = require('mime-types');
const FileType = require('file-type');
const logger = require('../utils/logger');

/**
 * Local Directory Source Adapter
 * Provides media from local file system with metadata management and posterpack generation
 */
class LocalDirectorySource {
    constructor(config) {
        // Accept either the full app config or the localDirectory sub-config
        const ld = (config && config.localDirectory) || config || {};
        this.config = { localDirectory: ld };
        // Fixed default: use <install>/media when not explicitly set
        this.rootPath = ld.rootPath || path.resolve(process.cwd(), 'media');
        this.enabled = !!ld.enabled;
        this.scanInterval = ld.scanInterval ?? 300;
        this.maxFileSize = ld.maxFileSize ?? 104857600; // 100MB
        this.supportedFormats = ld.supportedFormats || [
            'jpg',
            'jpeg',
            'png',
            'webp',
            'gif',
            'mp4',
            'zip',
        ];

        // File system watcher
        this.watcher = null;

        // In-memory cache for file metadata
        this.indexCache = new Map();
        this.lastScanTime = null;

        // Metrics tracking
        this.metrics = {
            totalFiles: 0,
            totalSize: 0,
            lastScan: null,
            errors: 0,
            posterpacks: 0,
        };

        // Directory structure
        this.directories = {
            posters: 'posters',
            backgrounds: 'backgrounds',
            motion: 'motion',
            complete: 'complete',
            posterpacks: 'posterpacks',
            system: '.posterrama',
        };

        // Error handling
        this.errorHandler = {
            count: 0,
            lastError: null,
            maxErrors: 5,
        };

        logger.info('LocalDirectorySource initialized', {
            enabled: this.enabled,
            rootPath: this.rootPath,
            scanInterval: this.scanInterval,
        });
    }

    /**
     * Standard source adapter interface - fetch media items
     * @param {Array} libraryNames - Library names (unused for local)
     * @param {string} type - Media type (poster, background, motion)
     * @param {number} count - Maximum number of items to return
     * @returns {Array} Array of media items
     */
    async fetchMedia(_libraryNames = [], type = 'poster', count = 50) {
        if (!this.enabled) {
            logger.debug('LocalDirectorySource: Disabled, returning empty array');
            return [];
        }

        try {
            // Determine target directory based on type
            const targetDirectory = this.getDirectoryForType(type);
            if (!targetDirectory) {
                logger.warn(`LocalDirectorySource: Unknown media type: ${type}`);
                return [];
            }

            // Scan directory for files
            const files = await this.scanDirectory(targetDirectory);

            // Process files and create media items
            const mediaItems = await this.processFiles(files, count);

            // Update metrics
            this.updateMetrics();

            logger.debug(
                `LocalDirectorySource: Returned ${mediaItems.length} items for type ${type}`
            );
            return mediaItems;
        } catch (error) {
            await this.handleError('fetchMedia', error);
            return [];
        }
    }

    /**
     * Get directory name for media type
     * @param {string} type - Media type
     * @returns {string} Directory name
     */
    getDirectoryForType(type) {
        const typeMap = {
            poster: this.directories.posters,
            background: this.directories.backgrounds,
            motion: this.directories.motion,
            wallart: this.directories.posters, // Wallart uses posters
            cinema: this.directories.posters, // Cinema can use posters or motion
            screensaver: this.directories.backgrounds,
        };

        return typeMap[type];
    }

    /**
     * Scan directory for supported files
     * @param {string} directoryName - Name of directory to scan
     * @returns {Array} Array of file objects
     */
    async scanDirectory(directoryName) {
        const targetPath = path.join(this.rootPath, directoryName);

        if (!(await fs.pathExists(targetPath))) {
            logger.debug(`LocalDirectorySource: Directory does not exist: ${targetPath}`);
            return [];
        }

        try {
            const files = await fs.readdir(targetPath, { withFileTypes: true });
            const validFiles = [];

            for (const file of files) {
                if (file.isFile()) {
                    const filePath = path.join(targetPath, file.name);
                    const ext = path.extname(file.name).toLowerCase().slice(1);

                    // Check if file type is supported
                    if (this.supportedFormats.includes(ext)) {
                        const stats = await fs.stat(filePath);

                        // Check file size limit
                        if (stats.size <= this.maxFileSize) {
                            validFiles.push({
                                name: file.name,
                                path: filePath,
                                size: stats.size,
                                modified: stats.mtime,
                                extension: ext,
                                directory: directoryName,
                            });
                        } else {
                            logger.warn(
                                `LocalDirectorySource: File too large: ${file.name} (${stats.size} bytes)`
                            );
                        }
                    }
                }
            }

            logger.debug(
                `LocalDirectorySource: Found ${validFiles.length} valid files in ${directoryName}`
            );
            return validFiles;
        } catch (error) {
            logger.error(`LocalDirectorySource: Error scanning directory ${targetPath}:`, error);
            throw error;
        }
    }

    /**
     * Browse directory contents for admin interface
     * @param {string} relativePath - Relative path from root directory
     * @param {string} type - Type filter (all, files, directories)
     * @returns {Object} Directory contents with files and directories
     */
    async browseDirectory(relativePath = '', type = 'all') {
        try {
            // Normalize and anchor to configured rootPath
            const base = this.rootPath ? path.resolve(this.rootPath) : path.resolve('/');
            const reqRaw = typeof relativePath === 'string' ? relativePath.trim() : '';

            // Determine target path: absolute requested stays absolute, otherwise resolve from base
            let targetPath;
            if (!reqRaw || reqRaw === '/' || reqRaw === '.') {
                targetPath = base;
            } else if (path.isAbsolute(reqRaw)) {
                targetPath = path.resolve(reqRaw);
            } else {
                targetPath = path.resolve(base, reqRaw);
            }

            // Security: restrict to base (rootPath). Allow base itself.
            const withinBase =
                targetPath === base || (targetPath + path.sep).startsWith(base + path.sep);
            if (!withinBase) {
                throw new Error('Path outside configured root');
            }

            // Check if directory exists
            if (!fs.existsSync(targetPath)) {
                throw new Error('Directory not found');
            }

            const stat = await fs.stat(targetPath);
            if (!stat.isDirectory()) {
                throw new Error('Path is not a directory');
            }

            // Read directory contents
            const items = await fs.readdir(targetPath, { withFileTypes: true });

            const directories = [];
            const files = [];

            for (const item of items) {
                try {
                    if (item.isDirectory()) {
                        if (type === 'all' || type === 'directories') directories.push(item.name);
                    } else if (item.isSymbolicLink()) {
                        // Include symlinked directories
                        const linkPath = path.join(targetPath, item.name);
                        const s = await fs.stat(linkPath).catch(() => null);
                        if (s?.isDirectory() && (type === 'all' || type === 'directories')) {
                            directories.push(item.name);
                        }
                    } else if (item.isFile()) {
                        if (type === 'all' || type === 'files') files.push(item.name);
                    }
                } catch (e) {
                    // Skip entries we cannot stat
                    logger.debug(
                        `LocalDirectorySource: Skipped entry ${item.name} during browse due to error: ${e?.message}`
                    );
                }
            }

            return {
                basePath: base,
                currentPath: targetPath,
                directories: directories.sort(),
                files: files.sort(),
                totalItems: directories.length + files.length,
            };
        } catch (error) {
            logger.error('LocalDirectorySource: Browse directory error:', error);
            throw error;
        }
    }

    /**
     * Process files and create media items
     * @param {Array} files - Array of file objects
     * @param {number} limit - Maximum number of items to process
     * @returns {Array} Array of media items
     */
    async processFiles(files, limit) {
        const mediaItems = [];
        const filesToProcess = files.slice(0, limit);

        for (const file of filesToProcess) {
            try {
                // Load or create metadata for file
                const metadata = await this.loadOrCreateMetadata(file);

                // Create media item in standard format
                const mediaItem = this.createMediaItem(file, metadata);

                mediaItems.push(mediaItem);
            } catch (error) {
                logger.error(`LocalDirectorySource: Failed to process file ${file.path}:`, error);
                this.metrics.errors++;
            }
        }

        return mediaItems;
    }

    /**
     * Load existing metadata or create new from filename
     * @param {Object} file - File object
     * @returns {Object} Metadata object
     */
    async loadOrCreateMetadata(file) {
        const metadataPath = this.getMetadataPath(file.path);

        // Try to load existing metadata
        if (await fs.pathExists(metadataPath)) {
            try {
                const metadata = await fs.readJson(metadataPath);
                logger.debug(`LocalDirectorySource: Loaded metadata for ${file.name}`);
                return metadata;
            } catch (error) {
                logger.warn(
                    `LocalDirectorySource: Failed to load metadata for ${file.name}, regenerating`
                );
            }
        }

        // Generate new metadata from filename
        const metadata = this.parseFilename(file.name, file);

        // Save metadata to file
        await this.saveMetadata(metadataPath, metadata);

        logger.debug(`LocalDirectorySource: Generated metadata for ${file.name}`);
        return metadata;
    }

    /**
     * Parse filename to extract metadata
     * @param {string} filename - Original filename
     * @param {Object} file - File object with stats
     * @returns {Object} Parsed metadata
     */
    parseFilename(filename, file) {
        const nameWithoutExt = path.parse(filename).name;

        // Try to parse "Title (Year)" format
        const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
        const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim() || nameWithoutExt;
        const year = yearMatch ? parseInt(yearMatch[1]) : null;

        // Generate clean name for internal use
        const cleanTitle = this.generateCleanName(nameWithoutExt);

        return {
            originalTitle: nameWithoutExt,
            originalFilename: filename,
            cleanTitle: cleanTitle,
            title: title,
            year: year,
            genre: [],
            tags: [],
            source: 'local-directory',
            created: new Date().toISOString(),
            lastModified: file.modified.toISOString(),
            fileSize: file.size,
            resolution: null, // Will be detected later if needed
            usage: {
                cinema: true,
                wallart: true,
                screensaver: file.directory === 'backgrounds',
            },
            statistics: {
                views: 0,
                lastUsed: null,
            },
        };
    }

    /**
     * Generate clean, URL-safe name
     * @param {string} originalName - Original name
     * @returns {string} Clean name
     */
    generateCleanName(originalName) {
        return originalName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single
            .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    }

    /**
     * Get metadata file path for a media file
     * @param {string} filePath - Path to media file
     * @returns {string} Path to metadata file
     */
    getMetadataPath(filePath) {
        const dir = path.dirname(filePath);
        const basename = path.parse(filePath).name;
        return path.join(dir, `${basename}.poster.json`);
    }

    /**
     * Save metadata to JSON file
     * @param {string} metadataPath - Path to metadata file
     * @param {Object} metadata - Metadata object
     */
    async saveMetadata(metadataPath, metadata) {
        try {
            await fs.outputJson(metadataPath, metadata, { spaces: 2 });
            logger.debug(`LocalDirectorySource: Saved metadata to ${metadataPath}`);
        } catch (error) {
            logger.error(
                `LocalDirectorySource: Failed to save metadata to ${metadataPath}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Create standardized media item
     * @param {Object} file - File object
     * @param {Object} metadata - Metadata object
     * @returns {Object} Media item
     */
    createMediaItem(file, metadata) {
        // Generate URL path relative to local directory
        const relativePath = path.relative(this.rootPath, file.path);
        const mediaUrl = `/local-media/${relativePath.replace(/\\/g, '/')}`;

        return {
            title: metadata.title,
            year: metadata.year,
            poster: mediaUrl,
            background: metadata.backgroundPath || null,
            clearart: metadata.clearartPath || null,
            metadata: {
                genre: metadata.genre || [],
                rating: metadata.rating || null,
                overview: metadata.overview || null,
                cast: metadata.cast || [],
            },
            source: 'local',
            sourceId: metadata.cleanTitle,
            originalFilename: metadata.originalFilename,
            fileSize: metadata.fileSize,
            lastModified: metadata.lastModified,
            usage: metadata.usage,
            statistics: metadata.statistics,
            // Additional local directory specific fields
            localPath: file.path,
            directory: file.directory,
            extension: file.extension,
        };
    }

    /**
     * Create directory structure
     */
    async createDirectoryStructure() {
        if (!this.rootPath) {
            throw new Error('Root path not configured');
        }

        try {
            // Create main directories
            const dirsToCreate = [
                this.directories.posters,
                this.directories.backgrounds,
                this.directories.motion,
                path.join(this.directories.complete, 'plex-export'),
                path.join(this.directories.complete, 'jellyfin-export'),
                path.join(this.directories.complete, 'manual'),
                this.directories.posterpacks,
                this.directories.system,
                path.join(this.directories.system, 'logs'),
            ];

            for (const dir of dirsToCreate) {
                const fullPath = path.join(this.rootPath, dir);
                await fs.ensureDir(fullPath);
                logger.debug(`LocalDirectorySource: Created directory ${fullPath}`);
            }

            // Create system config file
            const systemConfigPath = path.join(
                this.rootPath,
                this.directories.system,
                'config.json'
            );
            if (!(await fs.pathExists(systemConfigPath))) {
                const systemConfig = {
                    version: '1.0.0',
                    created: new Date().toISOString(),
                    directories: this.directories,
                };
                await fs.writeJson(systemConfigPath, systemConfig, { spaces: 2 });
            }

            logger.info('LocalDirectorySource: Directory structure created successfully');
        } catch (error) {
            logger.error('LocalDirectorySource: Failed to create directory structure:', error);
            throw error;
        }
    }

    /**
     * Start file system watcher
     */
    async startFileWatcher() {
        if (!this.enabled || !this.rootPath || this.watcher) {
            return;
        }

        try {
            const watchRoot = path.resolve(this.rootPath);
            this.watcher = chokidar.watch(watchRoot, {
                ignored: [
                    path.join(watchRoot, this.directories.system, '**'),
                    /\.poster\.json$/, // Ignore metadata files
                ],
                persistent: true,
                ignoreInitial: true,
                depth: 2, // Limit depth to prevent excessive watching
            });

            this.watcher.on('add', filePath => {
                logger.debug(`LocalDirectorySource: File added: ${filePath}`);
                this.onFileAdded(filePath);
            });

            this.watcher.on('unlink', filePath => {
                logger.debug(`LocalDirectorySource: File removed: ${filePath}`);
                this.onFileRemoved(filePath);
            });

            this.watcher.on('change', filePath => {
                logger.debug(`LocalDirectorySource: File changed: ${filePath}`);
                this.onFileChanged(filePath);
            });

            this.watcher.on('error', error => {
                logger.error('LocalDirectorySource: File watcher error:', error);
                this.handleError('fileWatcher', error);
            });

            logger.info('LocalDirectorySource: File watcher started');
        } catch (error) {
            logger.error('LocalDirectorySource: Failed to start file watcher:', error);
            await this.handleError('startFileWatcher', error);
        }
    }

    /**
     * Stop file system watcher
     */
    async stopFileWatcher() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            logger.info('LocalDirectorySource: File watcher stopped');
        }
    }

    /**
     * Handle file added event
     * @param {string} filePath - Path of added file
     */
    async onFileAdded(filePath) {
        try {
            // Validate file type and size
            if (await this.validateFile(filePath)) {
                // Clear cache for this file
                this.indexCache.delete(filePath);
                logger.info(`LocalDirectorySource: New file detected: ${filePath}`);
            }
        } catch (error) {
            logger.error(`LocalDirectorySource: Error handling added file ${filePath}:`, error);
        }
    }

    /**
     * Handle file removed event
     * @param {string} filePath - Path of removed file
     */
    async onFileRemoved(filePath) {
        try {
            // Remove from cache
            this.indexCache.delete(filePath);

            // Remove metadata file if it exists
            const metadataPath = this.getMetadataPath(filePath);
            if (await fs.pathExists(metadataPath)) {
                await fs.remove(metadataPath);
                logger.debug(`LocalDirectorySource: Removed metadata file: ${metadataPath}`);
            }

            logger.info(`LocalDirectorySource: File removed: ${filePath}`);
        } catch (error) {
            logger.error(`LocalDirectorySource: Error handling removed file ${filePath}:`, error);
        }
    }

    /**
     * Handle file changed event
     * @param {string} filePath - Path of changed file
     */
    async onFileChanged(filePath) {
        try {
            // Clear cache for this file to force reload
            this.indexCache.delete(filePath);
            logger.debug(`LocalDirectorySource: File changed, cache cleared: ${filePath}`);
        } catch (error) {
            logger.error(`LocalDirectorySource: Error handling changed file ${filePath}:`, error);
        }
    }

    /**
     * Validate file type and size
     * @param {string} filePath - Path to file
     * @returns {boolean} True if valid
     */
    async validateFile(filePath) {
        try {
            // Check if file exists
            if (!(await fs.pathExists(filePath))) {
                return false;
            }

            // Check file extension
            const ext = path.extname(filePath).toLowerCase().slice(1);
            if (!this.supportedFormats.includes(ext)) {
                return false;
            }

            // Check file size
            const stats = await fs.stat(filePath);
            if (stats.size > this.maxFileSize) {
                logger.warn(
                    `LocalDirectorySource: File too large: ${filePath} (${stats.size} bytes)`
                );
                return false;
            }

            // Additional file type validation if enabled
            if (this.config.localDirectory?.security?.fileTypeValidation) {
                return await this.validateFileType(filePath);
            }

            return true;
        } catch (error) {
            logger.error(`LocalDirectorySource: Error validating file ${filePath}:`, error);
            return false;
        }
    }

    /**
     * Validate file type by reading file header
     * @param {string} filePath - Path to file
     * @returns {boolean} True if valid
     */
    async validateFileType(filePath) {
        try {
            // Read first 4KB of file to detect type
            const buffer = Buffer.alloc(4096);
            const fd = await fs.open(filePath, 'r');
            const { bytesRead } = await fs.read(fd, buffer, 0, 4096, 0);
            await fs.close(fd);

            if (bytesRead === 0) {
                return false;
            }

            // Detect file type from buffer
            const fileType = await FileType.fromBuffer(buffer.slice(0, bytesRead));

            if (!fileType) {
                // Fallback to MIME type detection
                const mimeType = mimeTypes.lookup(filePath);
                return mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'));
            }

            // Check if detected type matches expected types
            const validTypes = ['jpg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'avi'];
            return validTypes.includes(fileType.ext);
        } catch (error) {
            logger.error(
                `LocalDirectorySource: File type validation failed for ${filePath}:`,
                error
            );
            return false;
        }
    }

    /**
     * Update metrics
     */
    updateMetrics() {
        this.metrics.lastScan = new Date().toISOString();
        this.lastScanTime = Date.now();
    }

    /**
     * Handle errors with graceful degradation
     * @param {string} operation - Operation that failed
     * @param {Error} error - Error object
     */
    async handleError(operation, error) {
        this.errorHandler.count++;
        this.errorHandler.lastError = {
            operation,
            error: error.message,
            timestamp: new Date().toISOString(),
        };

        // Comprehensive error logging
        logger.error(`LocalDirectorySource - ${operation} failed:`, {
            error: error.message,
            stack: error.stack,
            errorCount: this.errorHandler.count,
            rootPath: this.rootPath,
            enabled: this.enabled,
        });

        // Auto-disable if too many errors
        if (this.errorHandler.count >= this.errorHandler.maxErrors) {
            await this.autoDisable();
        }

        this.metrics.errors++;
    }

    /**
     * Auto-disable local directory due to errors
     */
    async autoDisable() {
        logger.warn('LocalDirectorySource: Auto-disabled due to excessive errors');

        this.enabled = false;

        // Stop file watcher
        await this.stopFileWatcher();

        // Clear cache
        this.indexCache.clear();
    }

    /**
     * Get source metrics
     * @returns {Object} Metrics object
     */
    getMetrics() {
        return {
            ...this.metrics,
            enabled: this.enabled,
            rootPath: this.rootPath,
            errorCount: this.errorHandler.count,
            lastError: this.errorHandler.lastError,
            cacheSize: this.indexCache.size,
            watcherActive: !!this.watcher,
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            totalFiles: 0,
            totalSize: 0,
            lastScan: null,
            errors: 0,
            posterpacks: 0,
        };

        this.errorHandler.count = 0;
        this.errorHandler.lastError = null;

        logger.info('LocalDirectorySource: Metrics reset');
    }

    /**
     * Initialize local directory source
     */
    async initialize() {
        if (!this.enabled) {
            logger.info('LocalDirectorySource: Disabled, skipping initialization');
            return;
        }

        // rootPath is always set (defaults to <cwd>/media)

        try {
            // Ensure directory structure exists and start watcher
            await this.createDirectoryStructure();
            await this.startFileWatcher();

            logger.info('LocalDirectorySource: Initialization completed');
        } catch (error) {
            await this.handleError('initialization', error);
        }
    }

    /**
     * Clean up files and directories
     * @param {Array} operations - Array of cleanup operations
     * @param {boolean} dryRun - Whether to perform a dry run
     * @returns {Object} Cleanup results
     */
    async cleanupDirectory(operations = [], dryRun = true) {
        const results = {
            success: true,
            operations: [],
            errors: [],
        };

        try {
            for (const operation of operations) {
                const { type, path: targetPath } = operation;

                if (type === 'delete' && targetPath) {
                    try {
                        // Security check
                        const resolvedPath = path.resolve(targetPath);
                        if (resolvedPath.includes('..')) {
                            throw new Error('Path traversal not allowed');
                        }

                        if (!dryRun) {
                            await fs.remove(resolvedPath);
                        }

                        results.operations.push({
                            type: 'delete',
                            path: targetPath,
                            status: dryRun ? 'would_delete' : 'deleted',
                        });
                    } catch (error) {
                        results.errors.push({
                            path: targetPath,
                            error: error.message,
                        });
                    }
                }
            }

            if (results.errors.length > 0) {
                results.success = false;
            }
        } catch (error) {
            logger.error('LocalDirectorySource: Cleanup error:', error);
            results.success = false;
            results.errors.push({ error: error.message });
        }

        return results;
    }

    /**
     * Get file metadata
     * @param {string} filePath - Path to file
     * @param {boolean} refresh - Whether to refresh cached metadata
     * @returns {Object} File metadata
     */
    async getFileMetadata(filePath, _refresh = false) {
        try {
            const resolvedPath = path.resolve(filePath);

            // Security check
            if (resolvedPath.includes('..')) {
                throw new Error('Path traversal not allowed');
            }

            if (!fs.existsSync(resolvedPath)) {
                throw new Error('File not found');
            }

            const stats = await fs.stat(resolvedPath);
            const fileName = path.basename(resolvedPath);
            const ext = path.extname(fileName).toLowerCase().substr(1);

            return {
                path: resolvedPath,
                name: fileName,
                size: stats.size,
                modified: stats.mtime,
                created: stats.birthtime,
                extension: ext,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
            };
        } catch (error) {
            logger.error('LocalDirectorySource: Get file metadata error:', error);
            throw error;
        }
    }

    /**
     * Get directory statistics
     * @returns {Object} Directory statistics
     */
    async getDirectoryStats() {
        try {
            const stats = {
                totalDirectories: 0,
                totalFiles: 0,
                totalSize: 0,
                supportedFiles: 0,
                lastScan: this.lastScanTime,
            };

            // Get stats for each configured directory
            for (const dirName of Object.values(this.directories)) {
                const dirPath = path.join(this.rootPath, dirName);

                if (fs.existsSync(dirPath)) {
                    const dirStats = await this.getDirectoryStatsRecursive(dirPath);
                    stats.totalDirectories += dirStats.directories;
                    stats.totalFiles += dirStats.files;
                    stats.totalSize += dirStats.size;
                    stats.supportedFiles += dirStats.supportedFiles;
                }
            }

            return stats;
        } catch (error) {
            logger.error('LocalDirectorySource: Get directory stats error:', error);
            throw error;
        }
    }

    /**
     * Get directory statistics recursively
     * @param {string} dirPath - Directory path
     * @returns {Object} Directory statistics
     */
    async getDirectoryStatsRecursive(dirPath) {
        const stats = {
            directories: 0,
            files: 0,
            size: 0,
            supportedFiles: 0,
        };

        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);

                if (item.isDirectory()) {
                    stats.directories++;
                    const subStats = await this.getDirectoryStatsRecursive(itemPath);
                    stats.directories += subStats.directories;
                    stats.files += subStats.files;
                    stats.size += subStats.size;
                    stats.supportedFiles += subStats.supportedFiles;
                } else if (item.isFile()) {
                    stats.files++;
                    const fileStat = await fs.stat(itemPath);
                    stats.size += fileStat.size;

                    const ext = path.extname(item.name).toLowerCase().substr(1);
                    if (this.supportedFormats.includes(ext)) {
                        stats.supportedFiles++;
                    }
                }
            }
        } catch (error) {
            logger.warn(`Error reading directory ${dirPath}:`, error.message);
        }

        return stats;
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.stopFileWatcher();
        this.indexCache.clear();
        logger.info('LocalDirectorySource: Cleanup completed');
    }
}

module.exports = LocalDirectorySource;
